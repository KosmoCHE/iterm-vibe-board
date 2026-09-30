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


def test_numbers_are_sequential_per_project_and_resolve():
    a1 = store.create("a1", "/tmp/a")
    a2 = store.create("a2", "/tmp/a")
    b1 = store.create("b1", "/tmp/b")
    assert (a1["num"], a2["num"], b1["num"]) == (1, 2, 1)
    assert store.resolve(a2["id"]) == a2["id"]
    assert store.resolve("#2") == a2["id"]  # unique across projects
    assert store.resolve("#1", project="/tmp/b") == b1["id"]
    assert store.resolve("a#1") == a1["id"]
    with pytest.raises(ValueError):
        store.resolve("#1")  # ambiguous
    with pytest.raises(KeyError):
        store.resolve("#9")
    moved = store.update(b1["id"], project="/tmp/a")
    assert moved["num"] == 3  # renumbered in the new project


def test_corrupt_item_file_loses_only_that_item(tmp_home):
    keep = store.create("keep", "/tmp/a")
    bad = tmp_home / "projects" / store.project_key("/tmp/a") / "items" / "bad.json"
    bad.write_text("{not json")
    assert set(store.load_all()) == {keep["id"]}


def test_description_is_free_text():
    item = store.create("a", "/tmp/a", description="why\nand how")
    assert item["description"] == "why\nand how"
    assert store.update(item["id"], description=None)["description"] == ""


def test_hook_records_the_pane(monkeypatch):
    monkeypatch.setenv("ITERM_SESSION_ID", "w0t1p0:abc-123")
    event = {"hook_event_name": "SessionStart", "session_id": "s1", "cwd": "/tmp/a"}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(event)))
    assert cli.main(["hook"]) == 0
    assert store.identity() == ("s1", "/tmp/a")
    # the same session starting again after /cd (resume, compaction) keeps its launch directory
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({**event, "cwd": "/tmp/a/sub"})))
    assert cli.main(["hook"]) == 0
    assert store.identity() == ("s1", "/tmp/a")
    monkeypatch.setattr(
        "sys.stdin", io.StringIO(json.dumps({**event, "hook_event_name": "SessionEnd"}))
    )
    assert cli.main(["hook"]) == 0
    assert store.identity() == (store.ME, None)
    monkeypatch.setattr("sys.stdin", io.StringIO("not json"))
    assert cli.main(["hook"]) == 0
