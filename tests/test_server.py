import json
import subprocess
from http.server import ThreadingHTTPServer

import pytest

from vibeboard import server, store


@pytest.fixture
def board_server(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBEBOARD_HOME", str(tmp_path))
    # These model checks do not need a listening socket.
    monkeypatch.setattr(ThreadingHTTPServer, "__init__", lambda *args: None)
    return server.BoardServer(0, "test-token")


def test_rename_changes_version_without_changing_tasks_or_focus(board_server, monkeypatch):
    store.set_pane("PANE", session="session", project="/example")
    task = store.create("Work", "/example", driver="session")
    board_server.focus = "PANE"
    clock = [100.0]
    sessions = [{"id": "pane", "name": "before"}]
    lookups = []

    def session_list(*args, **kwargs):
        lookups.append(clock[0])
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(sessions))

    monkeypatch.setattr(server.time, "time", lambda: clock[0])
    monkeypatch.setattr(server.subprocess, "run", session_list)
    before = board_server.version()
    stored_version = store.version()
    assert board_server.board()["panes"]["PANE"]["name"] == "before"

    sessions[0]["name"] = "after"
    clock[0] += 2
    assert board_server.version() == before
    assert len(lookups) == 1

    clock[0] += 1
    after = board_server.version()
    board = board_server.board()
    assert after != before
    assert board["version"] == after
    assert board["panes"]["PANE"]["name"] == "after"
    assert board["focus"] == {"pane": "PANE", "session": "session", "project": "/example"}
    assert board["items"] == [task]
    assert store.version() == stored_version
    assert len(lookups) == 2

    clock[0] += 3
    assert board_server.version() == after  # cache expiry alone is not a change
    assert len(lookups) == 3


def test_version_ignores_session_order_but_detects_task_changes(board_server, monkeypatch):
    task = store.create("Work", "/example")
    names = {"PANE-A": "A", "PANE-B": "B"}
    monkeypatch.setattr(board_server, "pane_names", lambda: names)
    before = board_server.version()
    names = {"PANE-B": "B", "PANE-A": "A"}
    assert board_server.version() == before

    store.update(task["id"], status="doing")
    assert board_server.version() != before


def test_focus_switch_preserves_reassigned_task_ownership(board_server, monkeypatch):
    store.set_pane("VOTE", session="vote", project="/example")
    store.set_pane("OTHER", session="other", project="/example")
    monkeypatch.setattr(board_server, "pane_names", lambda: {"VOTE": "vote-opt", "OTHER": "other"})
    tasks = [
        store.create(f"Task {index}", "/example", driver="vote", status=status)
        for index, status in enumerate(["waiting"] * 2 + ["later"] * 4)
    ]
    other = store.create("Other task", "/example", driver="other")
    for pane, session, expected in [
        ("VOTE", "vote", tasks),
        ("OTHER", "other", [other]),
        ("UNBOUND", None, []),
        ("VOTE", "vote", tasks),
    ]:
        board_server.focus = pane
        board = board_server.board()
        assert board["focus"]["session"] == session
        assert {i["id"] for i in board["items"] if session and i["driver"] == session} == {
            i["id"] for i in expected
        }
    assert all(store.get(item["id"]) == item for item in tasks)
