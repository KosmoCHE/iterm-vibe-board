# iterm-vibing-board

A human-first task board that lives in the iTerm2 toolbelt, shared by you and
every AI coding agent running in your panes.

> **Status: pre-alpha.** Nothing works yet. The design is settled; the code is
> being written.

[中文说明](README.zh-CN.md)

## Why

When several Claude Code sessions run at once, iTerm2's built-in *Session
Status* already tells you which pane is working, waiting or idle. What it
cannot tell you is:

- What do **I** want done, and which pane is pushing each item?
- Which items were in the original plan, and which ones showed up on the way
  (an incident, an idea, something another session handed over)?
- What is waiting on me right now?

Agent-side task lists (Claude Code's own `TaskCreate`, and most "agent kanban"
tools) answer these from the agent's point of view: folded into the chat,
read-only for you, one list per agent. This board is the other way round: the
items are yours, agents are just the ones pushing them.

## What it does

- **One panel, three tabs** in the iTerm2 toolbelt (View › Toolbelt):
  - **Global** – items that cut across projects.
  - **Workspace** – items of the project the focused pane was started in
    (a Claude Code launch directory).
  - **Session** – the same items, filtered to the ones the focused pane's
    session is pushing.
  The last two follow whichever pane you click into.
- **Every item records** its column (waiting on me / in progress / waiting on
  others / later / done), who is pushing it (a session, or you), its origin
  (planned / incident / inserted), who created it, sub-steps, dependencies
  (across projects too), next step, what it is waiting for, and optional
  dates.
- **You edit in the panel.** Tick a box, double-click to change text, add
  from the input at the bottom. Click a session badge to jump to that pane.
- **Agents edit through the `vibing` CLI.** File locking keeps concurrent
  writers safe. The Claude Code adapter adds two hooks and a three-line rule:
  write the plan before starting, register anything unplanned before handling
  it, and say which planned step comes next once the detour is done.
- **Sessions are temporary, items are not.** When a session ends its badge
  greys out and you can hand the item to another pane.

## Planned layout

```
vibing/               Python package: store, CLI, local HTTP server (stdlib only)
panel/                the toolbelt page: plain HTML, CSS and JS, no build step
iterm/                the iTerm2 AutoLaunch script that registers the panel
adapters/claude-code/ hooks and rule file for Claude Code
tests/                pytest, core logic only
install.sh            one-shot installer
```

Data lives in `~/.iterm-vibing-board/`: `global.json`, one JSON file per
workspace, and a small map from panes to sessions.

## Requirements

- macOS with iTerm2 3.5 or newer, Python API enabled, and the iTerm2 Python
  runtime installed (Scripts › Manage › Install Python Runtime).
- Claude Code, for the first agent adapter.

## Not in the first version

Gantt view, Homebrew formula, adapters for other agents. The data model
already reserves the fields these need.

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
