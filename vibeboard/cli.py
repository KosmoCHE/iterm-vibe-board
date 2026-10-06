"""The `vibeboard` command: the only write path, for humans at a shell and for agents."""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from collections import defaultdict
from pathlib import Path

from vibeboard import store

# The agent-facing rules live in the Claude Code skill; `vibeboard instructions` prints them.
SKILL = Path(__file__).resolve().parent.parent / "adapters/claude-code/skills/vibeboard/SKILL.md"

STATUS_MARK = {
    "todo": "·",
    "doing": "▸",
    "waiting": "…",
    "later": "~",
    "done": "✓",
}
ORIGIN_MARK = {"plan": "", "issue": " ⚡", "added": " +"}
PROGRESS_MARK = {"plan": "●", "issue": "⚡", "added": "+"}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args) or 0
    except KeyError as e:
        print(f"vibeboard: no such item {e}", file=sys.stderr)
    except ValueError as e:
        print(f"vibeboard: {e}", file=sys.stderr)
    return 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="vibeboard", description="Progress board in the iTerm2 toolbelt."
    )
    sub = p.add_subparsers(dest="command", required=True)

    a = sub.add_parser("add", help="add an item")
    a.add_argument("title")
    a.add_argument(
        "--project", help="project path (default: the parent's, the session's, then the cwd)"
    )
    a.add_argument("--parent", help="id of the item this is a sub-step of")
    a.add_argument("--origin", choices=store.ORIGINS, default="plan")
    a.add_argument("--status", choices=store.STATUSES)
    a.add_argument("--driver", help="session id or 'none' (default: the calling session)")
    _field_args(a)
    a.add_argument("--json", action="store_true")
    a.set_defaults(func=cmd_add)

    ls = sub.add_parser("list", help="show the board as a tree")
    scope = ls.add_mutually_exclusive_group()
    scope.add_argument("--all", action="store_true", help="every project")
    scope.add_argument("--project", help="one project path")
    ls.add_argument("--mine", action="store_true", help="only items the caller pushes")
    ls.add_argument("--archived", action="store_true")
    ls.add_argument("--json", action="store_true")
    ls.set_defaults(func=cmd_list)

    sh = sub.add_parser("show", help="print one item as JSON")
    sh.add_argument("id")
    sh.set_defaults(func=cmd_show)

    st = sub.add_parser("set", help="change fields of an item")
    st.add_argument("id")
    st.add_argument("--title")
    st.add_argument("--status", choices=store.STATUSES)
    st.add_argument("--driver", help="session id or 'none'")
    st.add_argument("--parent", help="item id or 'none'")
    st.add_argument("--project")
    _field_args(st)
    st.add_argument("--json", action="store_true")
    st.set_defaults(func=cmd_set)

    for name, help_text, func in (
        ("claim", "push this item: driver = caller, status = doing", cmd_claim),
        ("done", "mark an item done", cmd_done),
        ("archive", "move an item and its steps out of the live board", cmd_archive),
    ):
        c = sub.add_parser(name, help=help_text)
        c.add_argument("id")
        c.add_argument("--json", action="store_true")
        c.set_defaults(func=func)
    sub.choices["archive"].add_argument(
        "--restore", action="store_true", help="bring an archived item back"
    )

    pane = sub.add_parser("pane", help="record which session runs in this pane (used by hooks)")
    pane_sub = pane.add_subparsers(dest="event", required=True)
    ps = pane_sub.add_parser("start")
    ps.add_argument("--session", required=True)
    ps.add_argument("--project", required=True)
    ps.set_defaults(func=cmd_pane_start)
    pe = pane_sub.add_parser("end")
    pe.add_argument("--session", required=True)
    pe.set_defaults(func=cmd_pane_end)

    hk = sub.add_parser(
        "hook", help="Claude Code hook: reads the event from stdin (SessionStart/End)"
    )
    hk.set_defaults(func=cmd_hook)

    sv = sub.add_parser("serve", help="run the panel server")
    sv.add_argument("--port", type=int, default=None, help="default 47431, any free port if taken")
    sv.add_argument("--token", help="default: the one stored in the data directory")
    sv.add_argument(
        "--json", action="store_true", help="print one JSON line with the url, then serve"
    )
    sv.add_argument(
        "--exit-with-stdin",
        action="store_true",
        help="stop when stdin closes, so a launcher that dies takes the server with it",
    )
    sv.set_defaults(func=cmd_serve)

    mg = sub.add_parser("migrate", help="update data written by an earlier version")
    mg.set_defaults(func=lambda a: print(store.migrate()))

    ins = sub.add_parser("instructions", help="how an agent should use the board")
    ins.set_defaults(func=cmd_instructions)
    return p


def _field_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--desc", dest="description", help="what this item is about, in detail")
    p.add_argument("--next", dest="next_step", help="what happens next")
    p.add_argument("--waiting", dest="waiting_for", help="who or what this waits for")
    p.add_argument("--depends", help="comma-separated ids this depends on")
    p.add_argument("--due", help="YYYY-MM-DD")


def _fields(args: argparse.Namespace) -> dict:
    out = {}
    for attr, key in (
        ("description", "description"),
        ("next_step", "next"),
        ("waiting_for", "waiting_for"),
        ("due", "due"),
    ):
        value = getattr(args, attr, None)
        if value is not None:
            out[key] = value or None if key == "due" else value
    if getattr(args, "depends", None) is not None:
        out["depends_on"] = [d.strip() for d in args.depends.split(",") if d.strip()]
    return out


def _driver(value: str | None, who: str) -> str | None:
    if value is None:
        return who if who != store.ME else None  # a human at a shell leaves it unassigned
    return None if value == "none" else value


def _emit(item: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(item, ensure_ascii=False))
    else:
        print(store.short(item["id"], store.load_all()))


def _resolve(text: str, args: argparse.Namespace, project: str | None = None) -> str:
    """'#12' means the caller's project unless --project or 'name#12' says otherwise."""
    context = getattr(args, "project", None) or project or store.identity()[1]
    return store.resolve(text, os.path.abspath(context) if context else None)


def _resolved_fields(fields: dict, args: argparse.Namespace, project: str | None) -> dict:
    if "depends_on" in fields:
        fields["depends_on"] = [_resolve(d, args, project) for d in fields["depends_on"]]
    return fields


def cmd_add(args: argparse.Namespace) -> None:
    who, session_project = store.identity()
    project = args.project
    parent = _resolve(args.parent, args) if args.parent else None
    if project is None and parent:
        project = store.get(parent)["project"]
    project = project or session_project or os.getcwd()
    fields = _resolved_fields(_fields(args), args, project)
    fields["origin"] = args.origin
    fields["created_by"] = who
    fields["driver"] = _driver(args.driver, who)
    if parent:
        fields["parent"] = parent
    if args.status:
        fields["status"] = args.status
    _emit(store.create(args.title, project, **fields), args.json)


def cmd_set(args: argparse.Namespace) -> None:
    who, _ = store.identity()
    item_id = _resolve(args.id, args)
    project = store.get(item_id)["project"]
    fields = _resolved_fields(_fields(args), args, project)
    if args.title is not None:
        fields["title"] = args.title
    if args.status:
        fields["status"] = args.status
    if args.driver is not None:
        fields["driver"] = _driver(args.driver, who)
    if args.parent is not None:
        fields["parent"] = None if args.parent == "none" else _resolve(args.parent, args, project)
    if args.project:
        fields["project"] = args.project
    if not fields:
        raise ValueError("nothing to change")
    _emit(store.update(item_id, **fields), args.json)


def cmd_claim(args: argparse.Namespace) -> None:
    who, _ = store.identity()
    _emit(store.update(_resolve(args.id, args), driver=who, status="doing"), args.json)


def cmd_done(args: argparse.Namespace) -> None:
    _emit(store.update(_resolve(args.id, args), status="done"), args.json)


def cmd_archive(args: argparse.Namespace) -> None:
    items = store.load_all(archived=True) if args.restore else None
    item_id = store.resolve(args.id, None, items) if args.restore else _resolve(args.id, args)
    _emit(store.archive(item_id, restore=args.restore)[0], args.json)


def cmd_show(args: argparse.Namespace) -> None:
    print(json.dumps(store.get(_resolve(args.id, args)), ensure_ascii=False, indent=2))


def cmd_list(args: argparse.Namespace) -> None:
    who, session_project = store.identity()
    items = store.load_all(archived=args.archived)
    if not args.all:
        project = args.project or session_project or os.getcwd()
        project = os.path.abspath(project)
        items = {k: v for k, v in items.items() if v["project"] == project}
    if args.mine:
        items = {k: v for k, v in items.items() if v["driver"] == who}
    if args.json:
        print(json.dumps(list(items.values()), ensure_ascii=False, indent=2))
        return
    _print_tree(items, store.load_all(archived=args.archived))


def _print_tree(items: dict, everything: dict) -> None:
    children: dict = defaultdict(list)
    roots: dict = defaultdict(list)
    for item in sorted(items.values(), key=lambda i: i["created_at"]):
        if item["parent"] in items:
            children[item["parent"]].append(item)
        else:
            roots[item["project"]].append(item)
    for project in sorted(roots):
        print(f"{os.path.basename(project)}  ({project})")
        for item in roots[project]:
            _print_item(item, children, everything, depth=1)
    if not roots:
        print("(nothing here)")


def _print_item(item: dict, children: dict, everything: dict, depth: int) -> None:
    tags = []
    if item["status"] not in ("todo", "done"):
        tags.append(item["status"])
    if item["driver"]:
        tags.append("@" + item["driver"][:8])
    p = store.progress(item["id"], everything)
    summary = " ".join(f"{PROGRESS_MARK[o]}{d}/{t}" for o, (d, t) in p.items() if t)
    if summary:
        tags.append(summary)
    if item["waiting_for"]:
        tags.append("waits: " + item["waiting_for"])
    for dep in item["depends_on"]:
        d = everything.get(dep)
        if d and d["status"] != "done":
            same = d["project"] == item["project"]
            where = "" if same else os.path.basename(d["project"]) + "/"
            tags.append("⏳" + where + store.short(d["id"], everything))
    mark = STATUS_MARK[item["status"]]
    ident = store.short(item["id"], everything).ljust(6)
    line = f"{'  ' * depth}{ident}  {mark} {item['title']}{ORIGIN_MARK[item['origin']]}"
    if tags:
        line += "  [" + ", ".join(tags) + "]"
    print(line)
    for child in children.get(item["id"], []):
        _print_item(child, children, everything, depth + 1)


def cmd_pane_start(args: argparse.Namespace) -> None:
    _pane_start(args.session, args.project)


def cmd_pane_end(args: argparse.Namespace) -> None:
    _pane_end(args.session)


def _pane_start(session: str, project: str) -> None:
    pane = store.current_pane()
    if not pane:  # outside iTerm2 or inside tmux there is nothing trustworthy to record
        return
    info = store.get_pane(pane) or {}
    outer = info.get("outer") or []
    if info.get("session") and info["session"] != session and not info.get("ended_at"):
        # A session started inside a running one: the agent ran `claude` itself. The
        # pane belongs to the inner one until it ends, then goes back to the outer.
        outer = outer + [{k: info[k] for k in ("session", "project", "started_at")}]
    same = info.get("session") == session
    store.set_pane(
        pane,
        session=session,
        project=os.path.abspath(project),
        started_at=(info.get("started_at") if same else None) or store.now(),
        ended_at=None,
        outer=outer,
    )


def _pane_end(session: str) -> None:
    pane = store.current_pane()
    info = store.get_pane(pane) if pane else None
    if not info or info.get("session") != session:
        return
    outer = info.get("outer") or []
    if outer:  # back to the session this one ran inside
        store.set_pane(pane, **outer[-1], ended_at=None, outer=outer[:-1])
    else:
        store.set_pane(pane, ended_at=store.now())


def cmd_hook(args: argparse.Namespace) -> None:
    """Claude Code hook. Quiet and forgiving: a hook must never break the session."""
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    session = event.get("session_id")
    if not session:
        return
    _hook_log(event)
    if event.get("hook_event_name") == "SessionStart" and event.get("cwd"):
        _pane_start(session, _project_dir(event))
    elif event.get("hook_event_name") == "SessionEnd":
        _pane_end(session)


def _hook_log(event: dict) -> None:
    """One line per hook event in <home>/hook.log, for when a pane looks wrong."""
    try:
        path = store.home() / "hook.log"
        if path.exists() and path.stat().st_size > 200_000:
            path.unlink()
        with open(path, "a", encoding="utf-8") as f:
            f.write(
                f"{store.now()} {event.get('hook_event_name')} {event.get('source', '')} "
                f"session={event.get('session_id', '')[:8]} pane={store.current_pane()} "
                f"cwd={event.get('cwd')}\n"
            )
    except OSError:
        pass


def _project_dir(event: dict) -> str:
    """The directory Claude Code itself files this session under.

    That is where the session was launched, moved only by /cd, never by a cd in the
    shell. It shows in the transcript's location, ~/.claude/projects/<key>/, but the
    key is a lossy encoding of the path. The event's cwd follows the shell, so it is
    taken only when it encodes to that key; otherwise the transcript's own records
    (each carries the cwd of its moment) are searched for a directory that does.
    """
    cwd = event["cwd"]
    path = event.get("transcript_path")
    if not path:
        return cwd
    key = os.path.basename(os.path.dirname(path))
    if store.project_key(cwd) == key:
        return cwd
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                seen = record.get("cwd")
                if seen and store.project_key(seen) == key and os.path.isdir(seen):
                    return seen  # isdir: the directory may have been renamed since
    except OSError:
        pass
    return cwd


def cmd_instructions(args: argparse.Namespace) -> None:
    text = SKILL.read_text(encoding="utf-8")
    if text.startswith("---"):
        text = text.split("---", 2)[2].lstrip()  # drop the skill's front matter
    print(text, end="")


def cmd_serve(args: argparse.Namespace) -> None:
    from vibeboard.server import serve

    server = serve(
        **{k: v for k, v in (("port", args.port), ("token", args.token)) if v is not None}
    )
    if args.json:
        print(
            json.dumps({"url": server.url, "port": server.server_port, "token": server.token}),
            flush=True,
        )
    else:
        print(f"vibeboard panel: {server.url}", flush=True)
    if args.exit_with_stdin:
        threading.Thread(target=_exit_when_stdin_closes, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


def _exit_when_stdin_closes() -> None:
    sys.stdin.read()  # blocks until the other end goes away, even by kill -9
    os._exit(0)


if __name__ == "__main__":
    raise SystemExit(main())
