# iterm-vibing-board

A human-first progress board that lives in the iTerm2 toolbelt, shared by you and
every AI coding agent running in your panes.

> **Status: pre-alpha.** The panel, the `vibing` CLI and the Claude Code
> adapter work when run from a clone. There is no installer yet and the data
> format may still change.

[中文说明](README.zh-CN.md)

## Why

When several Claude Code sessions run at once, iTerm2's built-in *Session
Status* already tells you which pane is working, waiting or idle. What it
cannot tell you is:

- What do **I** want done, and which pane is pushing each item?
- Which items were in the original plan, and which ones showed up on the way?
- What is waiting on me right now?

Agent-side task lists (Claude Code's own `TaskCreate`, and most "agent kanban"
tools) answer these from the agent's point of view: folded into the chat,
read-only for you, one list per agent. This board is the other way round: the
items are yours, agents are just the ones pushing them.

## What it does

- **One panel, three tabs** in the iTerm2 toolbelt (View › Toolbelt › Vibing):
  - **Global** – everything, grouped by project. A select narrows it to one
    project or one session.
  - **Project** – the items of the project the focused pane's session was
    started in (a Claude Code launch directory).
  - **Session** – the items the focused pane's session is pushing.

  Project and Session are bound to the pane you click into, like iTerm2's
  Notes.
- **Every item records** its status (`todo`, `doing`, `waiting`, `later`,
  `done`), its driver (which session pushes it, if any), its origin, who
  created it, sub-steps, dependencies (across projects too), the next step,
  what it is waiting for, and optional dates.
- **Origin says why an item exists**, so the original plan stays visible when
  things pile up:
  - `plan` – written down before starting;
  - `incident` (⚡) – a problem that showed up on the way; ignore it and the
    plan cannot finish;
  - `insert` (+) – new scope added after the plan; ignore it and the plan still
    finishes.

  A parent shows `●2/4 · +0/1 · ⚡0/1`: done/total per origin over its direct
  sub-steps.
- **You edit in the panel.** Tick a box, click for details, double-click to
  edit, `+` at the top right to add, ⌘Z to undo. Click a session badge to jump
  to that pane. When a session ends its badge greys out and you can hand the
  item to another pane.
- **Agents edit through the `vibing` CLI.** `vibing instructions` prints the
  rules: write the plan as sub-steps before starting, register anything
  unplanned before handling it, say which planned step comes next once a
  detour is done. A session is recognised by the pane it runs in.
- **Claude Code adapter**: a skill with those rules and two hooks
  (`SessionStart`, `SessionEnd`) that map panes to sessions. See
  [adapters/claude-code](adapters/claude-code/README.md).

## Try it

```sh
git clone https://github.com/KosmoCHE/iterm-vibing-board && cd iterm-vibing-board
pip install -e .                                  # puts `vibing` on your PATH; no dependencies
python3 -m venv .venv && .venv/bin/pip install iterm2
.venv/bin/python iterm/vibing_panel.py            # keep it running, then View › Toolbelt › Vibing
```

Data lives in `~/.iterm-vibing-board/`: one JSON file per item under
`projects/<key>/items/`, plus a small map from panes to sessions. Set
`VIBING_HOME` to use another directory.

## Requirements

- macOS with iTerm2 3.5 or newer and the Python API enabled
  (Settings › General › Magic).
- Python 3.9 or newer.
- Claude Code, for the first agent adapter.

## Not in the first version

Installer and AutoLaunch setup, a graph or Gantt view, Homebrew formula,
adapters for other agents. The data model already reserves the fields these
need.

## Layout

```
vibing/               Python package: store, CLI, local HTTP server (stdlib only)
panel/                the toolbelt page: plain HTML, CSS and JS, no build step
iterm/                the iTerm2 AutoLaunch script that registers the panel
adapters/claude-code/ skill and hooks for Claude Code
tests/                pytest, core logic only
```

## Development

```sh
pip install ruff pytest
ruff check . && ruff format --check .
pytest -q
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GPL-2.0-or-later. The panel is registered through the `iterm2` Python package,
which is GPLv2+, so the whole project follows it.
