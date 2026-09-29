"""The `vibing` command: the only write path, for humans at a shell and for agents."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict

from vibing import store

INSTRUCTIONS = """\
vibing -- the progress board shared with the human who runs this terminal.

The board is the human's. You update the items you push; you never keep a
private list. Three rules:

1. Before starting a piece of work, write the plan as sub-steps of the item
   you were given (origin plan), then claim the item.
2. Anything unplanned that comes up is registered BEFORE you handle it:
   --origin incident if it blocks you, --origin insert if it is new scope.
   Never handle it silently.
3. When an unplanned item is done, say which planned step comes next.

Commands (add --json for machine-readable output):
  vibing list [--all | --project PATH] [--mine]     what is on the board
  vibing show ID
  vibing add "title" [--parent ID] [--origin plan|incident|insert]
                     [--next "..."] [--waiting "..."] [--due 2026-10-03]
  vibing claim ID                                    you push this item; status -> doing
  vibing set ID --next "..." | --waiting "..." | --status S | --depends ID,ID
  vibing done ID

Statuses: todo doing waiting_me waiting_others later done.
Use --status waiting_me when the human has to decide something.
Your session and project are detected from the pane you run in.
"""

STATUS_MARK = {
    "todo": "·",
    "doing": "▸",
    "waiting_me": "?",
    "waiting_others": "…",
    "later": "~",
    "done": "✓",
}
ORIGIN_MARK = {"plan": "", "incident": " ⚡", "insert": " +"}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args) or 0
    except KeyError as e:
        print(f"vibing: no such item {e}", file=sys.stderr)
    except ValueError as e:
        print(f"vibing: {e}", file=sys.stderr)
    return 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="vibing", description="Progress board in the iTerm2 toolbelt.")
    sub = p.add_subparsers(dest="command", required=True)

    a = sub.add_parser("add", help="add an item")
    a.add_argument("title")
    a.add_argument(
        "--project", help="project path (default: the parent's, the session's, then the cwd)"
    )
    a.add_argument("--parent", help="id of the item this is a sub-step of")
    a.add_argument("--origin", choices=store.ORIGINS, default="plan")
    a.add_argument("--status", choices=store.STATUSES)
    a.add_argument("--driver", help="session id, 'me' or 'none' (default: the calling session)")
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
    st.add_argument("--driver", help="session id, 'me' or 'none'")
    st.add_argument("--parent", help="item id or 'none'")
    st.add_argument("--project")
    _field_args(st)
    st.add_argument("--json", action="store_true")
    st.set_defaults(func=cmd_set)

    for name, help_text, func in (
        ("claim", "push this item: driver = caller, status = doing", cmd_claim),
        ("done", "mark an item done", cmd_done),
        ("archive", "move an item out of the live board", cmd_archive),
    ):
        c = sub.add_parser(name, help=help_text)
        c.add_argument("id")
        c.add_argument("--json", action="store_true")
        c.set_defaults(func=func)

    pane = sub.add_parser("pane", help="record which session runs in this pane (used by hooks)")
    pane_sub = pane.add_subparsers(dest="event", required=True)
    ps = pane_sub.add_parser("start")
    ps.add_argument("--session", required=True)
    ps.add_argument("--project", required=True)
    ps.set_defaults(func=cmd_pane_start)
    pe = pane_sub.add_parser("end")
    pe.add_argument("--session", required=True)
    pe.set_defaults(func=cmd_pane_end)

    sv = sub.add_parser("serve", help="run the panel server")
    sv.add_argument("--port", type=int, default=0)
    sv.add_argument("--token")
    sv.add_argument(
        "--json", action="store_true", help="print one JSON line with the url, then serve"
    )
    sv.set_defaults(func=cmd_serve)

    ins = sub.add_parser("instructions", help="how an agent should use the board")
    ins.set_defaults(func=lambda a: print(INSTRUCTIONS, end=""))
    return p


def _field_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--next", dest="next_step", help="what happens next")
    p.add_argument("--waiting", dest="waiting_for", help="who or what this waits for")
    p.add_argument("--depends", help="comma-separated ids this depends on")
    p.add_argument("--due", help="YYYY-MM-DD")
    p.add_argument("--start", help="YYYY-MM-DD")


def _fields(args: argparse.Namespace) -> dict:
    out = {}
    for attr, key in (
        ("next_step", "next"),
        ("waiting_for", "waiting_for"),
        ("due", "due"),
        ("start", "start"),
    ):
        value = getattr(args, attr, None)
        if value is not None:
            out[key] = value or None if key in ("due", "start") else value
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
        print(store.ref(item))


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
    _emit(store.archive(_resolve(args.id, args)), args.json)


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
    if p["total"]:
        summary = f"{p['plan_done']}/{p['plan_total']}"
        if p["incidents"]:
            summary += f" ⚡{p['incidents']}"
        if p["inserts"]:
            summary += f" +{p['inserts']}"
        tags.append(summary)
    if item["waiting_for"]:
        tags.append("waits: " + item["waiting_for"])
    for dep in item["depends_on"]:
        d = everything.get(dep)
        if d and d["status"] != "done":
            same = d["project"] == item["project"]
            tags.append("⏳" + ("" if same else os.path.basename(d["project"])) + store.ref(d))
    mark = STATUS_MARK[item["status"]]
    num = store.ref(item).rjust(5)
    line = f"{'  ' * depth}{num}  {mark} {item['title']}{ORIGIN_MARK[item['origin']]}"
    if tags:
        line += "  [" + ", ".join(tags) + "]"
    print(line)
    for child in children.get(item["id"], []):
        _print_item(child, children, everything, depth + 1)


def cmd_pane_start(args: argparse.Namespace) -> None:
    pane = store.current_pane()
    if pane:  # outside iTerm2 or inside tmux there is nothing trustworthy to record
        store.set_pane(
            pane,
            session=args.session,
            project=os.path.abspath(args.project),
            started_at=store.now(),
            ended_at=None,
        )


def cmd_pane_end(args: argparse.Namespace) -> None:
    pane = store.current_pane()
    info = store.get_pane(pane) if pane else None
    if info and info.get("session") == args.session:
        store.set_pane(pane, ended_at=store.now())


def cmd_serve(args: argparse.Namespace) -> None:
    from vibing.server import serve

    server = serve(port=args.port, token=args.token)
    if args.json:
        print(
            json.dumps({"url": server.url, "port": server.server_port, "token": server.token}),
            flush=True,
        )
    else:
        print(f"vibing panel: {server.url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    raise SystemExit(main())
