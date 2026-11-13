"""Install the panel HTTP server as a per-user macOS LaunchAgent.

The server must outlive the iTerm API connection. launchd owns its lifetime and
restarts it at the same URL; no agent hooks or task files are modified here.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import plistlib
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from vibeboard import store
from vibeboard.server import DEFAULT_PORT, stored_token

LABEL = "com.github.kosmoche.vibeboard.server"


def runtime_snapshot(root: Path, data: Path) -> Path:
    """Install immutable runtime files outside macOS-protected Documents folders."""
    files = sorted(
        [*root.glob("vibeboard/*.py"), *root.glob("ui/dist/*"), root / "iterm/vibeboard_panel.py"]
    )
    digest = hashlib.sha256()
    for source in files:
        digest.update(str(source.relative_to(root)).encode())
        digest.update(source.read_bytes())
    target = data / "runtime" / digest.hexdigest()[:16]
    for source in files:
        dest = target / source.relative_to(root)
        # Repair a partial install; identical runtime paths keep the launch URL stable.
        if not dest.exists() or dest.read_bytes() != source.read_bytes():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, dest)
    (target / "source.json").write_text(
        json.dumps({"source": str(root), "sha256": digest.hexdigest()}, indent=2) + "\n"
    )
    return target


def service_config(python: str, root: Path, data: Path) -> dict:
    return {
        "Label": LABEL,
        "ProgramArguments": [
            python,
            "-m",
            "vibeboard",
            "serve",
            "--port",
            str(DEFAULT_PORT),
            "--strict-port",
        ],
        "WorkingDirectory": str(root),
        "EnvironmentVariables": {"PYTHONPATH": str(root), "VIBEBOARD_HOME": str(data)},
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 5,
        "StandardOutPath": "/dev/null",  # serve's startup URL contains the token
        "StandardErrorPath": str(data / "server.log"),
    }


def wait_healthy(req: urllib.request.Request) -> None:
    for _ in range(20):
        try:
            with urllib.request.urlopen(req, timeout=1) as response:
                json.load(response)
            return
        except (OSError, ValueError):
            time.sleep(0.25)
    raise RuntimeError("Server did not become healthy")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("LaunchAgent installation requires macOS")
    path = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    domain = f"gui/{os.getuid()}"
    target = f"{domain}/{LABEL}"
    loaded = subprocess.run(["launchctl", "print", target], capture_output=True).returncode == 0
    if args.uninstall:
        if loaded:
            subprocess.run(["launchctl", "bootout", target], check=True)
        path.unlink(missing_ok=True)
        return
    data = store.home().resolve()
    data.mkdir(parents=True, exist_ok=True)
    token = stored_token()  # create once, before the service and panel race to read it
    root = runtime_snapshot(Path(__file__).resolve().parent.parent, data)
    content = plistlib.dumps(service_config(sys.executable, root, data))
    if not loaded:
        # Do not kill or adopt an arbitrary listener, or start an endless crash loop.
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", DEFAULT_PORT)) == 0:
                raise SystemExit(
                    f"Port {DEFAULT_PORT} is already in use. Stop the old Vibe Board "
                    "panel script in iTerm2's Scripts console, then retry. "
                    "No existing process was stopped."
                )
    previous = path.read_bytes() if path.exists() else None
    if loaded and previous is None:
        raise SystemExit(
            f"Cannot safely upgrade without the existing service configuration: {path}"
        )
    changed = not loaded or previous != content
    if changed and loaded:
        subprocess.run(["launchctl", "bootout", target], check=True)
    req = urllib.request.Request(
        f"http://127.0.0.1:{DEFAULT_PORT}/api/version",
        headers={"X-Vibeboard-Token": token},
    )
    link = data / "runtime/current"
    temp = link.with_name(".current.tmp")
    try:
        if changed:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            path.chmod(0o600)
            subprocess.run(["launchctl", "bootstrap", domain, str(path)], check=True)
        wait_healthy(req)
        temp.unlink(missing_ok=True)
        temp.symlink_to(root.name)
        temp.replace(link)
    except (OSError, subprocess.CalledProcessError, RuntimeError) as error:
        if not changed:
            raise SystemExit(f"{error}; inspect {data / 'server.log'}") from error
        try:
            # Bootstrap can fail after registering a job, so check before removing it.
            if subprocess.run(["launchctl", "print", target], capture_output=True).returncode == 0:
                subprocess.run(["launchctl", "bootout", target], check=True)
            if previous is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(previous)
                path.chmod(0o600)
            if loaded:
                subprocess.run(["launchctl", "bootstrap", domain, str(path)], check=True)
                wait_healthy(req)
        except (OSError, subprocess.CalledProcessError, RuntimeError) as rollback_error:
            raise SystemExit(
                f"{error}; rollback also failed: {rollback_error}. Inspect {data / 'server.log'}"
            ) from rollback_error
        result = "Previous service restored" if loaded else "Previous stopped state restored"
        if previous is None:
            result = "Failed installation removed"
        raise SystemExit(f"{error}; {result}. Inspect {data / 'server.log'}") from error
    finally:
        with contextlib.suppress(OSError):
            temp.unlink(missing_ok=True)
    print("Vibe Board server installed; launchd will restart it after an unexpected exit.")


if __name__ == "__main__":
    main()
