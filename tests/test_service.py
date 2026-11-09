import threading
import urllib.request
from pathlib import Path

import pytest

from vibeboard.server import serve
from vibeboard.service import runtime_snapshot, service_config


def test_runtime_snapshot_is_self_contained_and_versioned(tmp_path):
    source = Path(__file__).resolve().parent.parent
    runtime = runtime_snapshot(source, tmp_path)
    assert (runtime / "vibeboard/server.py").is_file()
    assert (runtime / "panel/board.js").is_file()
    assert (runtime / "iterm/vibeboard_panel.py").is_file()
    assert runtime_snapshot(source, tmp_path) == runtime
    # A damaged installed file is restored from the verified source.
    (runtime / "panel/board.js").write_text("broken")
    runtime_snapshot(source, tmp_path)
    assert (runtime / "panel/board.js").read_bytes() == (source / "panel/board.js").read_bytes()


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


def test_same_url_works_after_server_restart():
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
