import json

import pytest

from vibing import store


@pytest.fixture(autouse=True)
def tmp_home(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBING_HOME", str(tmp_path))
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
        store.update(item["id"], origin="incident")  # history, not editable
    with pytest.raises(ValueError):
        store.update(item["id"], parent=item["id"])
    with pytest.raises(KeyError):
        store.update(item["id"], depends_on=["missing"])
    with pytest.raises(ValueError):
        store.update(item["id"], due="tomorrow")


def test_done_sets_done_at_and_archive_moves_file(tmp_home):
    item = store.create("x", "/tmp/a")
    assert store.update(item["id"], status="done")["done_at"]
    store.archive(item["id"])
    assert item["id"] not in store.load_all()
    assert item["id"] in store.load_all(archived=True)
    store.archive(item["id"], restore=True)
    assert item["id"] in store.load_all()


def test_identity_follows_the_pane(monkeypatch):
    assert store.identity() == (store.ME, None)
    monkeypatch.setenv("ITERM_SESSION_ID", "w0t1p0:abc-123")
    store.set_pane("ABC-123", session="s1", project="/tmp/a")
    assert store.identity() == ("s1", "/tmp/a")
    store.set_pane("ABC-123", ended_at=store.now())
    assert store.identity() == (store.ME, None)
    monkeypatch.setenv("TMUX", "/tmp/tmux-1")
    assert store.current_pane() is None


def test_corrupt_item_file_loses_only_that_item(tmp_home):
    keep = store.create("keep", "/tmp/a")
    bad = tmp_home / "projects" / store.project_key("/tmp/a") / "items" / "bad.json"
    bad.write_text("{not json")
    assert set(store.load_all()) == {keep["id"]}
