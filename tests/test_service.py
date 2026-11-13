import io
import plistlib
import subprocess
import threading
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from vibeboard import service
from vibeboard.server import BoardServer, serve
from vibeboard.service import runtime_snapshot, service_config


def test_runtime_snapshot_is_self_contained_and_versioned(tmp_path):
    source = Path(__file__).resolve().parent.parent
    runtime = runtime_snapshot(source, tmp_path)
    assert (runtime / "vibeboard/server.py").is_file()
    assert (runtime / "ui/dist/board.js").is_file()
    assert (runtime / "iterm/vibeboard_panel.py").is_file()
    assert runtime_snapshot(source, tmp_path) == runtime
    # A damaged installed file is restored from the verified source.
    (runtime / "ui/dist/board.js").write_text("broken")
    runtime_snapshot(source, tmp_path)
    assert (runtime / "ui/dist/board.js").read_bytes() == (source / "ui/dist/board.js").read_bytes()


def test_managed_server_has_stable_port_and_independent_lifetime():
    config = service_config("/python", Path("/repo"), Path("/data"))
    assert config["KeepAlive"] is True
    assert "--strict-port" in config["ProgramArguments"]
    assert "--exit-with-stdin" not in config["ProgramArguments"]
    assert config["EnvironmentVariables"] == {"PYTHONPATH": "/repo", "VIBEBOARD_HOME": "/data"}


def test_strict_port_does_not_silently_change_panel_url():
    server = serve(port=0, token="test")
    try:
        with pytest.raises(OSError):
            serve(port=server.server_port, token="test", strict_port=True)
    finally:
        server.server_close()


def test_same_url_works_after_server_restart(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBEBOARD_HOME", str(tmp_path))
    monkeypatch.setattr(BoardServer, "pane_names", lambda self: {})
    server = serve(port=0, token="test")
    port = server.server_port
    url = f"http://127.0.0.1:{port}/api/version?token=test"
    for _ in range(2):
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                assert response.status == 200
        finally:
            server.shutdown()
            thread.join()
            server.server_close()
        if _ == 0:
            server = serve(port=port, token="test", strict_port=True)


@pytest.fixture
def installation(tmp_path, monkeypatch):
    data = tmp_path / "data"
    old = data / "runtime/old"
    new = data / "runtime/new"
    old.mkdir(parents=True)
    new.mkdir()
    link = data / "runtime/current"
    link.symlink_to(old.name)
    path = tmp_path / "Library/LaunchAgents" / f"{service.LABEL}.plist"
    path.parent.mkdir(parents=True)
    previous = plistlib.dumps(service_config("/old-python", old, data))
    path.write_bytes(previous)
    state = SimpleNamespace(
        path=path,
        link=link,
        old=old,
        new=new,
        previous=previous,
        running=previous,
        failure=None,
        rollback_failure=None,
        partial_bootstrap=False,
        commands=[],
    )

    def launchctl(command, **kwargs):
        assert command[0] == "launchctl"
        action = command[1]
        state.commands.append(action)
        if action == "print":
            return subprocess.CompletedProcess(command, 0 if state.running else 1)
        if action == "bootout":
            state.running = None
        if action == "bootstrap":
            config = path.read_bytes()
            failure = state.rollback_failure if config == previous else state.failure
            if failure == "bootstrap":
                if state.partial_bootstrap:
                    state.running = config
                raise subprocess.CalledProcessError(1, command)
            state.running = config
        return subprocess.CompletedProcess(command, 0)

    def health(*args, **kwargs):
        failure = state.rollback_failure if state.running == previous else state.failure
        if failure == "health":
            raise OSError("unhealthy service")
        assert state.running is not None
        # The new runtime must not become current until the health check succeeds.
        assert not link.exists() or link.resolve() == old.resolve()
        return io.BytesIO(b'{"version": "ready"}')

    monkeypatch.setattr(service.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("VIBEBOARD_HOME", str(data))
    monkeypatch.setattr(service.sys, "platform", "darwin")
    monkeypatch.setattr(service.sys, "argv", ["service"])
    monkeypatch.setattr(service, "runtime_snapshot", lambda root, data: new)
    monkeypatch.setattr(service.subprocess, "run", launchctl)
    monkeypatch.setattr(service.urllib.request, "urlopen", health)
    monkeypatch.setattr(service.time, "sleep", lambda seconds: None)
    socket = MagicMock()
    socket.__enter__.return_value.connect_ex.return_value = 1
    monkeypatch.setattr(service.socket, "socket", lambda: socket)
    return state


def test_upgrade_switches_current_only_after_success(installation):
    state = installation
    service.main()
    assert state.link.resolve() == state.new.resolve()
    assert state.running == state.path.read_bytes() != state.previous
    assert state.commands == ["print", "bootout", "bootstrap"]


@pytest.mark.parametrize(
    "failure,partial", [("health", False), ("bootstrap", False), ("bootstrap", True)]
)
def test_failed_upgrade_restores_previous_service(installation, failure, partial):
    state = installation
    state.failure = failure
    state.partial_bootstrap = partial
    with pytest.raises(SystemExit, match="Previous service restored"):
        service.main()
    assert state.running == state.path.read_bytes() == state.previous
    assert state.link.resolve() == state.old.resolve()
    assert state.commands[-1] == "bootstrap"
    assert not (state.link.parent / ".current.tmp").exists()


@pytest.mark.parametrize("failure", ["health", "bootstrap"])
def test_failed_first_install_removes_registration_and_config(installation, failure):
    state = installation
    state.path.unlink()
    state.link.unlink()
    state.running = None
    state.failure = failure
    state.partial_bootstrap = True
    with pytest.raises(SystemExit, match="Failed installation removed"):
        service.main()
    assert state.running is None
    assert not state.path.exists()
    assert not state.link.exists()


def test_failed_upgrade_keeps_previously_stopped_service_stopped(installation):
    state = installation
    state.running = None
    state.failure = "health"
    with pytest.raises(SystemExit, match="Previous stopped state restored"):
        service.main()
    assert state.running is None
    assert state.path.read_bytes() == state.previous
    assert state.link.resolve() == state.old.resolve()


@pytest.mark.parametrize("failure", ["health", "bootstrap"])
def test_failed_rollback_is_reported(installation, failure):
    state = installation
    state.failure = "health"
    state.rollback_failure = failure
    with pytest.raises(SystemExit, match="rollback also failed"):
        service.main()
    assert state.path.read_bytes() == state.previous
    assert state.link.resolve() == state.old.resolve()


def test_failed_current_link_update_also_restores_service(installation, monkeypatch):
    state = installation
    original = Path.replace

    def replace(path, target):
        if path.name == ".current.tmp":
            raise PermissionError("cannot replace current")
        return original(path, target)

    monkeypatch.setattr(Path, "replace", replace)
    with pytest.raises(SystemExit, match="Previous service restored"):
        service.main()
    assert state.running == state.path.read_bytes() == state.previous
    assert state.link.resolve() == state.old.resolve()
    assert not (state.link.parent / ".current.tmp").exists()
