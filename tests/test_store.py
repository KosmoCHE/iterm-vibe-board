import io
import json

import pytest

from vibeboard import cli, store


@pytest.fixture(autouse=True)
def tmp_home(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBEBOARD_HOME", str(tmp_path))
    monkeypatch.delenv("ITERM_SESSION_ID", raising=False)
    monkeypatch.delenv("TERM_SESSION_ID", raising=False)
    monkeypatch.delenv("TMUX", raising=False)
    return tmp_path


def test_project_key_matches_claude_code():
    assert store.project_key("/Users/x/Desktop/Dots_work") == "-Users-x-Desktop-Dots-work"


def test_create_writes_one_file_per_item(tmp_home):
    item = store.create("Ship v1.1", "/tmp/proj", origin="plan")
    path = tmp_home / "projects" / store.project_key("/tmp/proj") / "items" / f"{item['id']}.json"
    assert json.loads(path.read_text())["title"] == "Ship v1.1"
    assert store.get(item["id"])["status"] == "todo"
    assert store.projects()[store.project_key("/tmp/proj")]["path"] == "/tmp/proj"


def test_update_moves_file_when_project_changes(tmp_home):
    item = store.create("x", "/tmp/a")
    store.update(item["id"], project="/tmp/b")
    assert not list((tmp_home / "projects" / store.project_key("/tmp/a") / "items").iterdir())
    assert store.get(item["id"])["project"] == "/tmp/b"


def test_validation():
    item = store.create("x", "/tmp/a")
    with pytest.raises(ValueError):
        store.update(item["id"], status="nope")
    with pytest.raises(ValueError):
        store.update(item["id"], origin="issue")  # history, not editable
    with pytest.raises(ValueError):
        store.update(item["id"], driver=store.ME)  # the driver is a session or nothing
    with pytest.raises(ValueError):
        store.update(item["id"], parent=item["id"])
    with pytest.raises(KeyError):
        store.update(item["id"], depends_on=["missing"])
    with pytest.raises(ValueError):
        store.update(item["id"], due="tomorrow")


def test_done_sets_done_at_and_archive_moves_file(tmp_home):
    item = store.create("x", "/tmp/a")
    assert store.update(item["id"], status="done")["done_at"]
    step = store.create("step", "/tmp/a", parent=item["id"])
    assert [i["id"] for i in store.archive(item["id"])] == [item["id"], step["id"]]
    assert not store.load_all()
    assert item["id"] in store.load_all(archived=True)
    store.archive(item["id"], restore=True)
    assert set(store.load_all()) == {item["id"], step["id"]}


def test_identity_follows_the_pane(monkeypatch):
    assert store.identity() == (store.ME, None)
    monkeypatch.setenv("ITERM_SESSION_ID", "w0t1p0:abc-123")
    store.set_pane("ABC-123", session="s1", project="/tmp/a")
    assert store.identity() == ("s1", "/tmp/a")
    store.set_pane("ABC-123", ended_at=store.now())
    assert store.identity() == (store.ME, None)
    monkeypatch.setenv("TMUX", "/tmp/tmux-1")
    assert store.current_pane() is None


def test_resolve_by_id_prefix_title_or_old_number():
    a = store.create("Fix the flaky login test", "/tmp/a")
    b = store.create("Write the design doc", "/tmp/a")
    items = store.load_all()
    assert store.resolve(a["id"]) == a["id"]
    assert store.resolve(store.short(a["id"], items)) == a["id"]
    assert store.resolve("flaky") == a["id"]
    assert store.resolve("DESIGN doc") == b["id"]
    with pytest.raises(ValueError):
        store.resolve("the")  # in both titles
    with pytest.raises(KeyError):
        store.resolve("nothing like this")
    old = store.load_all()[b["id"]]
    old["num"] = 7  # written by 0.1
    store._write_json(store._item_path(old), old)
    assert store.resolve("#7") == b["id"]


def test_two_levels_only_and_migrate_flattens():
    item = store.create("item", "/tmp/a")
    step = store.create("step", "/tmp/a", parent=item["id"])
    with pytest.raises(ValueError):
        store.create("sub-step", "/tmp/a", parent=step["id"])
    with pytest.raises(ValueError):
        store.update(item["id"], parent=step["id"])  # it has steps, it stays an item
    deep = store.load_all()[step["id"]]
    deep["parent"] = step["id"]  # a 0.1 file nested three deep
    deep["id"] = "deadbe"
    store._write_json(store._item_path(deep), deep)
    assert store.migrate() == {"flattened": 1}
    assert store.load_all()["deadbe"]["parent"] == item["id"]


def test_corrupt_item_file_loses_only_that_item(tmp_home):
    keep = store.create("keep", "/tmp/a")
    bad = tmp_home / "projects" / store.project_key("/tmp/a") / "items" / "bad.json"
    bad.write_text("{not json")
    assert set(store.load_all()) == {keep["id"]}


def test_nested_session_hands_the_pane_back(monkeypatch):
    monkeypatch.setenv("ITERM_SESSION_ID", "w0t1p0:abc-123")

    def feed(e):
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(e)))

    feed({"hook_event_name": "SessionStart", "session_id": "outer", "cwd": "/tmp/a"})
    cli.main(["hook"])
    feed({"hook_event_name": "SessionStart", "session_id": "inner", "cwd": "/tmp/a/scratch"})
    cli.main(["hook"])
    assert store.identity() == ("inner", "/tmp/a/scratch")
    feed({"hook_event_name": "SessionEnd", "session_id": "inner"})
    cli.main(["hook"])
    assert store.identity() == ("outer", "/tmp/a")  # the agent's own `claude -p` came and went
    feed({"hook_event_name": "SessionEnd", "session_id": "outer"})
    cli.main(["hook"])
    assert store.identity() == (store.ME, None)


def test_start_and_done_times_come_from_the_clock():
    item = store.create("a", "/tmp/a")
    assert item["started_at"] is None
    started = store.update(item["id"], status="doing")["started_at"]
    assert started
    assert store.update(item["id"], status="waiting")["started_at"] == started  # first start sticks
    assert store.update(item["id"], status="done")["done_at"]
    with pytest.raises(ValueError):
        store.update(item["id"], started_at="2026-01-01")


def test_description_is_free_text():
    item = store.create("a", "/tmp/a", description="why\nand how")
    assert item["description"] == "why\nand how"
    assert store.update(item["id"], description=None)["description"] == ""


def test_hook_records_the_pane(monkeypatch, tmp_path):
    monkeypatch.setenv("ITERM_SESSION_ID", "w0t1p0:abc-123")
    event = {"hook_event_name": "SessionStart", "session_id": "s1", "cwd": "/tmp/a"}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(event)))
    assert cli.main(["hook"]) == 0
    assert store.identity() == ("s1", "/tmp/a")
    # started again (resume, compaction) after a cd in the shell: the project is the
    # directory Claude Code files the transcript under, decoded from the transcript
    proj = tmp_path / "proj"
    (proj / "sub").mkdir(parents=True)
    transcript = tmp_path / store.project_key(str(proj)) / "s1.jsonl"
    transcript.parent.mkdir()
    records = [{"cwd": "/tmp/elsewhere"}, {"cwd": f"{proj}/sub"}, {"cwd": str(proj)}]
    transcript.write_text("".join(json.dumps(r) + "\n" for r in records))
    again = {**event, "cwd": f"{proj}/sub", "transcript_path": str(transcript)}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(again)))
    assert cli.main(["hook"]) == 0
    assert store.identity() == ("s1", str(proj))
    monkeypatch.setattr(
        "sys.stdin", io.StringIO(json.dumps({**event, "hook_event_name": "SessionEnd"}))
    )
    assert cli.main(["hook"]) == 0
    assert store.identity() == (store.ME, None)
    monkeypatch.setattr("sys.stdin", io.StringIO("not json"))
    assert cli.main(["hook"]) == 0
