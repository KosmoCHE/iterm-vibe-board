import json
import subprocess
import threading
import time
import urllib.error
import urllib.request
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
    assert board["focus"] == {"pane": "PANE"}
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
        assert board["focus"] == {"pane": pane}
        assert {i["id"] for i in board["items"] if session and i["driver"] == session} == {
            i["id"] for i in expected
        }
    assert all(store.get(item["id"]) == item for item in tasks)


def test_paseo_agents_are_listed_once_one_is_on_the_board(board_server, monkeypatch):
    store.set_pane("ITERM", session="a", project="/example")
    asked = []

    def listing(command, **kwargs):
        asked.append(command[0])
        listed = [{"id": "iterm", "name": "shell"}]
        if command[0] == server.PASEO:
            listed = [
                {"id": "agent-1", "name": "Fix it", "status": "idle"},
                {"id": "agent-2", "name": "Old", "status": "closed"},
            ]
        return subprocess.CompletedProcess(command, 0, stdout=json.dumps(listed))

    monkeypatch.setattr(server.subprocess, "run", listing)
    assert board_server.pane_names() == {"ITERM": "shell"}
    assert asked == [server.IT2]

    store.set_pane("AGENT-1", host=store.PASEO, session="b", project="/example")
    store.set_pane("AGENT-2", host=store.PASEO, session="c", project="/example")
    board_server._names = ({}, 0.0)
    panes = board_server.board()["panes"]
    assert (panes["AGENT-1"]["name"], panes["AGENT-1"]["alive"]) == ("Fix it", True)
    assert panes["AGENT-2"]["alive"] is False
    assert panes["ITERM"]["alive"] is True


def test_a_listing_that_fails_with_nobody_reading_stderr_still_answers(board_server, monkeypatch):
    # iTerm2 quit: it2 cannot reach it, and the stderr it read is gone.
    class Gone:
        def write(self, text):
            raise BrokenPipeError(32, "Broken pipe")

        def flush(self):
            raise BrokenPipeError(32, "Broken pipe")

    def listing(command, **kwargs):
        return subprocess.CompletedProcess(command, 1, stdout="")

    monkeypatch.setattr(server.subprocess, "run", listing)
    monkeypatch.setattr(server.sys, "stderr", Gone())
    assert board_server.pane_names() == {}
    board_server._names = ({}, 0.0)
    assert board_server.version()  # asked again, it still answers


def test_panels_asking_at_once_share_one_listing(board_server, monkeypatch):
    asked = []

    def listing(command, **kwargs):
        asked.append(command[0])
        time.sleep(0.2)  # long enough for the other panels to ask as well
        return subprocess.CompletedProcess(command, 0, stdout="[]")

    monkeypatch.setattr(server.subprocess, "run", listing)
    panels = [threading.Thread(target=board_server.pane_names) for _ in range(5)]
    for panel in panels:
        panel.start()
    for panel in panels:
        panel.join()
    assert asked == [server.IT2]


@pytest.fixture
def live(tmp_path, monkeypatch):
    """A listening server on an empty store, and a way to call its API."""
    monkeypatch.setenv("VIBEBOARD_HOME", str(tmp_path))
    board = server.serve(port=0, token="test")
    threading.Thread(target=board.serve_forever, daemon=True).start()

    def call(method, path, body=None):
        request = urllib.request.Request(
            f"http://127.0.0.1:{board.server_port}{path}",
            data=None if body is None else json.dumps(body).encode(),
            headers={"X-Vibeboard-Token": "test"},
            method=method,
        )
        return json.load(urllib.request.urlopen(request))

    yield board, call
    board.shutdown()
    board.server_close()


def test_jump_refuses_a_paseo_agent(live, monkeypatch):
    _, call = live
    store.set_pane("AGENT-1", host=store.PASEO, session="b", project="/example")
    focused = []
    monkeypatch.setattr(server.subprocess, "run", lambda command, **kwargs: focused.append(command))
    with pytest.raises(urllib.error.HTTPError) as refused:
        call("POST", "/api/jump", {"pane": "agent-1"})
    assert refused.value.code == 400
    assert focused == []
    assert call("POST", "/api/jump", {"pane": "iterm"}) == {"ok": True}
    assert focused == [[server.IT2, "session", "focus", "ITERM"]]


def test_settings_are_read_and_changed_over_the_api(live, tmp_path, monkeypatch):
    board, call = live
    monkeypatch.setattr(server.BoardServer, "pane_names", lambda self: {})
    (tmp_path / "config.json").write_text(json.dumps({"labels": {"todo": "Next"}}))
    assert call("GET", "/api/board")["settings"] == {"archive_after_days": 7, "text_size": 100}
    before = call("GET", "/api/version")["version"]
    call("PATCH", "/api/settings", {"archive_after_days": 30})
    after = call("GET", "/api/board")
    assert after["settings"] == {"archive_after_days": 30, "text_size": 100}
    assert after["labels"]["todo"] == "Next"  # the other settings are kept
    assert after["version"] != before  # other open panels learn of it
    assert board.settings_changed.is_set()
    call("PATCH", "/api/settings", {"archive_after_days": None})
    call("PATCH", "/api/settings", {"text_size": 130})
    assert call("GET", "/api/board")["settings"] == {"archive_after_days": None, "text_size": 130}
    for bad in (
        {"archive_after_days": 0},
        {"archive_after_days": "7"},
        {"text_size": 40},
        {"text_size": 1.3},
        # One at a time: a refused one leaves nothing half done.
        {"archive_after_days": 3, "text_size": 120},
        {},
        {"labels": {}},
    ):
        with pytest.raises(urllib.error.HTTPError) as refused:
            call("PATCH", "/api/settings", bad)
        assert refused.value.code == 400
    assert call("GET", "/api/board")["settings"] == {"archive_after_days": None, "text_size": 130}


def test_a_config_that_does_not_parse_is_named_and_does_not_stop_the_archiving(
    live, tmp_path, monkeypatch, capsys
):
    board, call = live
    monkeypatch.setattr(server.BoardServer, "pane_names", lambda self: {})
    (tmp_path / "config.json").write_text("{not json")
    for method, path, body in (
        ("GET", "/api/board", None),
        ("PATCH", "/api/settings", {"archive_after_days": 3}),
    ):
        with pytest.raises(urllib.error.HTTPError) as refused:
            call(method, path, body)
        assert refused.value.code == 400
        assert json.load(refused.value)["error"].startswith("config.json: ")

    looks = []

    def wait(seconds):
        looks.append(seconds)
        if len(looks) == 2:
            raise SystemExit  # two looks are enough to see that the loop goes on

    monkeypatch.setattr(board.settings_changed, "wait", wait)
    with pytest.raises(SystemExit):
        board.keep_archiving()
    assert capsys.readouterr().err.count("nothing archived: config.json: ") == 2
