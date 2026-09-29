"""Local HTTP server: serves the panel and a small JSON API over the store.

Binds to 127.0.0.1 only. Every /api request must carry the per-process token,
which the panel reads from its own URL.
"""

from __future__ import annotations

import json
import secrets
import shutil
import subprocess
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from vibing import store

PANEL = Path(__file__).resolve().parent.parent / "panel"
IT2 = shutil.which("it2") or "/Applications/iTerm.app/Contents/Resources/utilities/it2"
LABELS = {
    "todo": "To do",
    "doing": "In progress",
    "waiting": "Waiting",
    "later": "Later",
    "done": "Done",
}
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript"}


class BoardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, token: str | None):
        super().__init__(("127.0.0.1", port), Handler)
        self.token = token or secrets.token_urlsafe(24)
        self.focus: str | None = None  # pane the user is looking at, pushed by the iTerm2 script
        self._names: tuple[dict, float] = ({}, 0.0)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}/?token={self.token}"

    def pane_names(self) -> dict[str, str]:
        """Pane names as iTerm2 shows them, from `it2 session list`, cached briefly."""
        names, stamp = self._names
        if time.time() - stamp < 3:
            return names
        try:
            out = subprocess.run(
                [IT2, "session", "list", "--json"], capture_output=True, text=True, timeout=3
            )
            names = {
                s["id"].upper(): s.get("name") or s.get("title") or ""
                for s in json.loads(out.stdout)
            }
        except (OSError, ValueError, subprocess.TimeoutExpired):
            names = {}
        self._names = (names, time.time())
        return names

    def board(self) -> dict:
        names = self.pane_names()
        panes = {}
        for pane, info in store.panes().items():
            panes[pane] = dict(info, name=names.get(pane, ""), alive=pane in names)
        focus = {"pane": self.focus, "session": None, "project": None}
        info = panes.get(self.focus or "")
        if info and not info.get("ended_at"):
            focus.update(session=info.get("session"), project=info.get("project"))
        labels = dict(LABELS)
        config = store.home() / "config.json"
        if config.is_file():
            try:
                labels.update(json.loads(config.read_text(encoding="utf-8")).get("labels", {}))
            except ValueError:
                pass
        return {
            "version": store.version(),
            "focus": focus,
            "projects": store.projects(),
            "panes": panes,
            "items": list(store.load_all().values()),
            "statuses": store.STATUSES,
            "origins": store.ORIGINS,
            "labels": labels,
            "me": store.ME,
        }


class Handler(BaseHTTPRequestHandler):
    server: BoardServer

    def log_message(self, *args) -> None:
        pass

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
        token = query.get("token", [None])[0] or self.headers.get("X-Vibing-Token")
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
            self._json({"version": store.version(), "assets": assets_version()})
        elif url.path == "/api/board":
            self._json(self.server.board())
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
                self._json(store.archive(url.path.split("/")[3]))
            elif url.path == "/api/focus":
                self.server.focus = store.pane_id(body["pane"]) if body.get("pane") else None
                self._json({"ok": True})
            elif url.path == "/api/jump":
                subprocess.run(
                    [IT2, "session", "focus", store.pane_id(body["pane"])], timeout=5, check=False
                )
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
        if len(parts) != 4 or parts[1:3] != ["api", "items"]:
            self._error(HTTPStatus.NOT_FOUND, "not found")
            return
        try:
            self._json(store.update(parts[3], **self._body()))
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


def serve(port: int = DEFAULT_PORT, token: str | None = None) -> BoardServer:
    token = token or stored_token()
    try:
        return BoardServer(port, token)
    except OSError:
        if port == 0:
            raise
        return BoardServer(0, token)  # the usual port is taken: any free one
