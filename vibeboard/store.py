"""On-disk store: one JSON file per item, one directory per project.

Layout under VIBEBOARD_HOME (default ~/.iterm-vibe-board):

    projects/<key>/project.json       the project's real path
    projects/<key>/items/<id>.json    live items
    projects/<key>/archive/<id>.json  archived items
    panes/<pane>.json                 which session runs in which iTerm2 pane

<key> is the project path encoded the way Claude Code names ~/.claude/projects/.
Every write replaces a whole small file atomically, so concurrent writers to
different items never touch each other and a torn write can lose at most one item.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path

STATUSES = ["todo", "doing", "waiting", "later", "done"]
ORIGINS = ["plan", "issue", "added"]
ME = "me"

DEFAULTS = {
    "title": "",
    "description": "",
    "status": "todo",
    "origin": "plan",
    "created_by": ME,
    "driver": None,
    "project": None,
    "parent": None,
    "depends_on": [],
    "next": "",
    "waiting_for": "",
    "due": None,
    "started_at": None,  # set by the clock when the status first becomes doing
    "done_at": None,
}
# Fields a caller may set. `origin` and `created_by` are history: fixed at creation.
EDITABLE = {
    "title",
    "description",
    "status",
    "driver",
    "project",
    "parent",
    "depends_on",
    "next",
    "waiting_for",
    "due",
}
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def home() -> Path:
    return Path(os.environ.get("VIBEBOARD_HOME") or Path.home() / ".iterm-vibe-board")


def now() -> str:
    """UTC with milliseconds, so items created in the same second still sort by creation."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def project_key(path: str) -> str:
    """Encode a path the way Claude Code names ~/.claude/projects/<key>."""
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def project_dir(path: str) -> Path:
    return home() / "projects" / project_key(path)


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def _read_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def version() -> float:
    """Changes whenever any item, project or pane file is written, moved or removed."""
    latest = 0.0
    for d in [
        home() / "panes",
        *(home() / "projects").glob("*/items"),
        *(home() / "projects").glob("*/archive"),
    ]:
        try:
            latest = max(latest, d.stat().st_mtime)
        except FileNotFoundError:
            pass
    return latest


# --- projects -----------------------------------------------------------------


def register_project(path: str) -> dict:
    path = os.path.abspath(path)
    meta = project_dir(path) / "project.json"
    if not meta.exists():
        _write_json(meta, {"path": path, "name": os.path.basename(path), "created_at": now()})
    return _read_json(meta)


def projects() -> dict[str, dict]:
    out = {}
    root = home() / "projects"
    if root.is_dir():
        for d in sorted(root.iterdir()):
            meta = d / "project.json"
            if meta.is_file():
                out[d.name] = _read_json(meta)
    return out


# --- items --------------------------------------------------------------------


def _item_path(item: dict, archived: bool = False) -> Path:
    sub = "archive" if archived else "items"
    return project_dir(item["project"]) / sub / f"{item['id']}.json"


def load_all(archived: bool = False) -> dict[str, dict]:
    out = {}
    sub = "archive" if archived else "items"
    for f in (home() / "projects").glob(f"*/{sub}/*.json"):
        try:
            item = _read_json(f)
        except ValueError:
            continue  # a torn or corrupt file loses one item, never the board
        out[item["id"]] = item
    return out


def get(item_id: str) -> dict:
    items = load_all()
    if item_id not in items:
        raise KeyError(item_id)
    return items[item_id]


def progress(item_id: str, items: dict) -> dict:
    """Per origin over direct children: {origin: [done, total]}."""
    out = {origin: [0, 0] for origin in ORIGINS}
    for it in items.values():
        if it["parent"] == item_id:
            out[it["origin"]][1] += 1
            out[it["origin"]][0] += it["status"] == "done"
    return out


def new_id(existing: dict) -> str:
    """The stable key: a short random hash, so concurrent creators never collide."""
    while True:
        candidate = secrets.token_hex(3)
        if candidate not in existing:
            return candidate


def _next_num(project: str) -> int:
    """The human-facing number, sequential within a project. The only locked write."""
    d = project_dir(project)
    d.mkdir(parents=True, exist_ok=True)
    with open(d / ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        counter = d / "counter"
        n = int(counter.read_text()) + 1 if counter.exists() else 1
        counter.write_text(str(n))
        return n


def ref(item: dict) -> str:
    return f"#{item['num']}"


def resolve(text: str, project: str | None = None, items: dict | None = None) -> str:
    """Turn what a human types into an id: a hash, '#12' in a project, or 'name#12'."""
    items = load_all() if items is None else items
    if text in items:
        return text
    prefix, _, number = text.rpartition("#")
    if not number.isdigit():
        raise KeyError(text)
    matches = [i for i in items.values() if i.get("num") == int(number)]
    if prefix:
        matches = [i for i in matches if os.path.basename(i["project"]) == prefix]
    elif project and any(i["project"] == project for i in matches):
        matches = [i for i in matches if i["project"] == project]
    if not matches:
        raise KeyError(text)
    if len(matches) > 1:
        names = ", ".join(sorted(os.path.basename(i["project"]) for i in matches))
        raise ValueError(f"{text} exists in several projects ({names}); write name#{number}")
    return matches[0]["id"]


def create(title: str, project: str, **fields) -> dict:
    project = os.path.abspath(project)
    register_project(project)
    items = load_all()
    item = dict(DEFAULTS, id=new_id(items), project=project, created_at=now(), updated_at=now())
    item.update(_validated(fields, items, creating=True))
    _stamp(item, item["status"])
    item["title"] = title.strip()
    if not item["title"]:
        raise ValueError("title is empty")
    item["num"] = _next_num(project)
    _write_json(_item_path(item), item)
    return item


def update(item_id: str, **fields) -> dict:
    items = load_all()
    item = items[item_id]
    changes = _validated(fields, items, creating=False, self_id=item_id)
    old_path = _item_path(item)
    item.update(changes)
    if "status" in changes:
        _stamp(item, changes["status"])
    item["updated_at"] = now()
    new_path = _item_path(item)
    if new_path != old_path:  # moved to another project: numbers are per project
        item["num"] = _next_num(item["project"])
        new_path = _item_path(item)
    _write_json(new_path, item)
    if new_path != old_path:
        old_path.unlink()
    return item


def _stamp(item: dict, status: str) -> None:
    """Timestamps come from the clock, never from the caller."""
    if status == "doing" and not item.get("started_at"):
        item["started_at"] = now()
    item["done_at"] = now() if status == "done" else None


def archive(item_id: str, restore: bool = False) -> list[dict]:
    """Move an item and everything under it out of the live board, or back into it.

    Returns the items moved, the one asked for first.
    """
    items = load_all(archived=restore)
    moved = []
    todo = [items[item_id]]
    while todo:
        item = todo.pop(0)
        src = _item_path(item, archived=restore)
        dst = _item_path(item, archived=not restore)
        dst.parent.mkdir(parents=True, exist_ok=True)
        os.replace(src, dst)
        moved.append(item)
        todo += [i for i in items.values() if i["parent"] == item["id"]]
    return moved


def _validated(fields: dict, items: dict, creating: bool, self_id: str | None = None) -> dict:
    allowed = EDITABLE | ({"origin", "created_by"} if creating else set())
    out = {}
    for key, value in fields.items():
        if key not in allowed:
            raise ValueError(f"cannot set {key}")
        if key == "status" and value not in STATUSES:
            raise ValueError(f"status must be one of {', '.join(STATUSES)}")
        if key == "origin" and value not in ORIGINS:
            raise ValueError(f"origin must be one of {', '.join(ORIGINS)}")
        if key == "driver" and value == ME:
            raise ValueError("the driver is a session; leave it empty for work you do yourself")
        if key == "title" and not str(value).strip():
            raise ValueError("title is empty")
        if key == "project":
            value = os.path.abspath(value)
            register_project(value)
        if key == "parent" and value is not None:
            if value == self_id:
                raise ValueError("an item cannot be its own parent")
            if value not in items:
                raise KeyError(value)
        if key == "depends_on":
            value = list(dict.fromkeys(value))
            for dep in value:
                if dep not in items:
                    raise KeyError(dep)
        if key == "due" and value is not None and not _DATE.match(str(value)):
            raise ValueError(f"{key} must look like 2026-09-29")
        if key in ("description", "next", "waiting_for") and value is None:
            value = ""
        out[key] = value
    return out


# --- panes: which session runs where -------------------------------------------


def pane_id(raw: str) -> str:
    """'w0t0p0:GUID' (the env var) and 'GUID' (it2, the API) name the same pane."""
    return raw.split(":")[-1].upper()


def current_pane() -> str | None:
    """The iTerm2 pane this process runs in, or None when that cannot be trusted."""
    if os.environ.get("TMUX"):
        return None  # inside tmux the variable names whichever pane started the server
    raw = os.environ.get("ITERM_SESSION_ID") or os.environ.get("TERM_SESSION_ID")
    return pane_id(raw) if raw else None


def set_pane(pane: str, **fields) -> dict:
    path = home() / "panes" / f"{pane_id(pane)}.json"
    info = _read_json(path) if path.exists() else {"pane": pane_id(pane)}
    info.update(fields)
    _write_json(path, info)
    return info


def get_pane(pane: str) -> dict | None:
    path = home() / "panes" / f"{pane_id(pane)}.json"
    return _read_json(path) if path.exists() else None


def panes() -> dict[str, dict]:
    out = {}
    for f in (home() / "panes").glob("*.json"):
        try:
            info = _read_json(f)
        except ValueError:
            continue
        out[info["pane"]] = info
    return out


def identity() -> tuple[str, str | None]:
    """Who is calling: the session registered in this pane, or the human.

    Returns (who, project). `who` is a session id or ME.
    """
    pane = current_pane()
    info = get_pane(pane) if pane else None
    if info and info.get("session") and not info.get("ended_at"):
        return info["session"], info.get("project")
    return ME, None
