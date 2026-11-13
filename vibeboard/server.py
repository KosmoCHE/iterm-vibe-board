"""Local HTTP server: serves the panel and a small JSON API over the store.

Binds to 127.0.0.1 only. Every /api request must carry the per-process token,
which the panel reads from its own URL.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from vibeboard import store

PANEL = Path(__file__).resolve().parent.parent / "ui" / "dist"  # built by ui/web/build.mjs
IT2 = shutil.which("it2") or "/Applications/iTerm.app/Contents/Resources/utilities/it2"
PASEO = shutil.which("paseo") or "/Applications/Paseo.app/Contents/Resources/bin/paseo"
LABELS = {
    "todo": "To do",
    "doing": "In progress",
    "waiting": "Waiting",
    "later": "Later",
    "done": "Done",
}
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript"}
ARCHIVE_EVERY = 3600  # seconds between two looks for finished tasks to archive


class BoardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, token: str | None):
        super().__init__(("127.0.0.1", port), Handler)
        self.token = token or secrets.token_urlsafe(24)
        self.focus: str | None = None  # pane the user is looking at, pushed by the iTerm2 script
        self._names: tuple[dict, float] = ({}, 0.0)
        self._listing = threading.Lock()
        self._silent: set[str] = set()  # listing commands whose failure was already reported
        self.settings_changed = threading.Event()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}/?token={self.token}"

    def _listed(self, command: list[str]) -> list[dict]:
        """What a host's own CLI lists, or nothing when it cannot be asked."""
        try:
            out = subprocess.run(command, capture_output=True, text=True, timeout=3)
            listed = json.loads(out.stdout)
        except (OSError, ValueError, subprocess.TimeoutExpired) as e:
            if command[0] not in self._silent:  # say it once, not every refresh
                print(f"vibeboard: {' '.join(command)} failed: {e!r}", file=sys.stderr, flush=True)
            self._silent.add(command[0])
            return []
        self._silent.discard(command[0])
        return listed

    def pane_names(self) -> dict[str, str]:
        """Names of the live panes as their hosts show them, cached briefly: iTerm2's
        sessions, and Paseo's agents once a Paseo session is on the board."""
        with self._listing:  # every open panel asks each second: one of them does the listing
            names, stamp = self._names
            if time.time() - stamp < 3:
                return names
            names = {
                s["id"].upper(): s.get("name") or s.get("title") or ""
                for s in self._listed([IT2, "session", "list", "--json"])
            }
            if any(
                p.get("host") == store.PASEO and not p.get("ended_at")
                for p in store.panes().values()
            ):
                names.update(
                    (a["id"].upper(), a.get("name") or "")
                    for a in self._listed([PASEO, "ls", "--global", "--json"])
                    if a.get("status") != "closed"
                )
            self._names = (names, time.time())
            return names

    def keep_archiving(self) -> None:
        """Take long-finished tasks off the board: now, hourly, and when the setting changes."""
        while True:
            try:
                store.archive_finished()
            except ValueError as e:  # config.json does not parse: look again once it is mended
                print(f"vibeboard: nothing archived: {e}", file=sys.stderr, flush=True)
            self.settings_changed.wait(ARCHIVE_EVERY)
            self.settings_changed.clear()

    def version(self) -> str:
        # Renaming a live session does not touch the task store.
        names = json.dumps(self.pane_names(), sort_keys=True).encode()
        return f"{store.version()}:{hashlib.sha256(names).hexdigest()}"

    def board(self) -> dict:
        names = self.pane_names()
        panes = {}
        for pane, info in store.panes().items():
            name = names.get(pane) or info.get("name", "")  # a stored name outlives the pane
            panes[pane] = dict(info, name=name, alive=pane in names)
        return {
            "version": self.version(),
            "focus": {"pane": self.focus},  # the panel works out what runs there
            "projects": store.projects(),
            "panes": panes,
            "items": list(store.load_all().values()),
            "statuses": store.STATUSES,
            "labels": {**LABELS, **store.config().get("labels", {})},
            "settings": {"archive_after_days": store.archive_after_days()},
            "me": store.ME,
        }


class Handler(BaseHTTPRequestHandler):
    server: BoardServer

    def log_message(self, fmt, *args) -> None:
        if os.environ.get("VIBEBOARD_DEBUG"):  # request log on stderr, for diagnosing the panel
            sys.stderr.write(f"{self.address_string()} {fmt % args}\n")

    # -- helpers ---------------------------------------------------------------

    def _send(self, status: int, body: bytes = b"", ctype: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, status: int = HTTPStatus.OK) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _error(self, status: int, message: str) -> None:
        self._json({"error": message}, status)

    def _authorized(self, query: dict) -> bool:
        token = query.get("token", [None])[0] or self.headers.get("X-Vibeboard-Token")
        return token is not None and secrets.compare_digest(token, self.server.token)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def _static(self, name: str) -> None:
        path = (PANEL / name).resolve()
        if PANEL not in path.parents or not path.is_file():
            self._error(HTTPStatus.NOT_FOUND, "not found")
            return
        self._send(
            HTTPStatus.OK, path.read_bytes(), TYPES.get(path.suffix, "application/octet-stream")
        )

    # -- routes ----------------------------------------------------------------

    def do_GET(self) -> None:
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if url.path == "/":
            self._static("index.html")
        elif url.path.startswith("/static/"):
            self._static(url.path[len("/static/") :])
        elif not self._authorized(query):
            self._error(HTTPStatus.UNAUTHORIZED, "bad token")
        elif url.path == "/api/version":
            self._json(
                {
                    "version": self.server.version(),
                    "assets": assets_version(),
                    "focus": self.server.focus,
                }
            )
        elif url.path == "/api/board":
            try:
                self._json(self.server.board())
            except ValueError as e:  # the user's config.json does not parse
                self._error(HTTPStatus.BAD_REQUEST, str(e))
        else:
            self._error(HTTPStatus.NOT_FOUND, "not found")

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if not self._authorized(parse_qs(url.query)):
            self._error(HTTPStatus.UNAUTHORIZED, "bad token")
            return
        try:
            body = self._body()
            if url.path == "/api/items":
                title = body.pop("title", "")
                project = body.pop("project", None)
                if not project:
                    raise ValueError("project is required")
                self._json(store.create(title, project, **body), HTTPStatus.CREATED)
            elif url.path.startswith("/api/items/") and url.path.endswith("/archive"):
                self._json([i["id"] for i in store.archive(url.path.split("/")[3])])
            elif url.path.startswith("/api/items/") and url.path.endswith("/restore"):
                self._json([i["id"] for i in store.archive(url.path.split("/")[3], restore=True)])
            elif url.path == "/api/focus":
                self.server.focus = store.pane_id(body["pane"]) if body.get("pane") else None
                self._json({"ok": True})
            elif url.path == "/api/jump":
                pane = store.pane_id(body["pane"])
                if (store.get_pane(pane) or {}).get("host") == store.PASEO:
                    raise ValueError("this session runs in Paseo: open it from the board there")
                subprocess.run([IT2, "session", "focus", pane], timeout=5, check=False)
                self._json({"ok": True})
            else:
                self._error(HTTPStatus.NOT_FOUND, "not found")
        except KeyError as e:
            self._error(HTTPStatus.NOT_FOUND, f"no such item {e}")
        except (ValueError, OSError) as e:
            self._error(HTTPStatus.BAD_REQUEST, str(e))

    def do_PATCH(self) -> None:
        url = urlparse(self.path)
        if not self._authorized(parse_qs(url.query)):
            self._error(HTTPStatus.UNAUTHORIZED, "bad token")
            return
        parts = url.path.split("/")
        try:
            if url.path == "/api/settings":
                body = self._body()
                if set(body) != {"archive_after_days"}:
                    raise ValueError("settings: archive_after_days is the one thing to set")
                store.set_archive_after_days(body["archive_after_days"])
                self.server.settings_changed.set()  # archive by the new rule right away
                self._json(body)
            elif len(parts) == 4 and parts[1:3] == ["api", "items"]:
                self._json(store.update(parts[3], **self._body()))
            else:
                self._error(HTTPStatus.NOT_FOUND, "not found")
        except KeyError as e:
            self._error(HTTPStatus.NOT_FOUND, f"no such item {e}")
        except ValueError as e:
            self._error(HTTPStatus.BAD_REQUEST, str(e))


DEFAULT_PORT = 47431


def assets_version() -> float:
    """Changes when a panel file changes, so an open page can reload itself."""
    return max(f.stat().st_mtime for f in PANEL.iterdir() if f.is_file())


def stored_token() -> str:
    """One token per machine, kept on disk so restarts keep the panel URL stable."""
    path = store.home() / "token"
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(24)
    path.write_text(token, encoding="utf-8")
    path.chmod(0o600)
    return token


def serve(
    port: int = DEFAULT_PORT, token: str | None = None, strict_port: bool = False
) -> BoardServer:
    token = token or stored_token()
    try:
        return BoardServer(port, token)
    except OSError:
        if port == 0 or strict_port:
            raise
        return BoardServer(0, token)  # the usual port is taken: any free one
