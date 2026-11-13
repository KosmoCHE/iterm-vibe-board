# iterm-vibe-board

A human-first progress board that lives in the iTerm2 toolbelt and in Paseo's
sidebar, shared by you and every AI coding agent you run.

> **Status: 0.1, early.** The panel, the `vibeboard` CLI, the Claude Code
> adapter and `install.sh` work from a clone. The data format may still
> change before 1.0.

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

- **One panel, three tabs** in the iTerm2 toolbelt (View › Toolbelt › Vibe Board)
  and in the sidebar of each Paseo workspace:
  - **Global** – everything. A select narrows it to one project or one session.
  - **Project** – the items of the project the focused pane's session was
    started in (a Claude Code launch directory), including those filed under
    its sub-directories.
  - **Session** – the items the focused pane's session is pushing.

  Project and Session are bound to the pane you click into, like iTerm2's
  Notes. In Paseo they cover the agents of the workspace the panel is in.
- **One list that shows what waits for what**, drawn the way a git graph draws
  history. One line per item, prerequisites above what waits for them, a dot
  per item and a lane per dependency: lanes split where several items wait for
  one and join where one waits for several, across tasks too. A task's steps
  branch off a faint trunk below it. Select an item to light up everything
  upstream and downstream of it. Folded items keep their links as dashed
  lanes, and an arrow marks a prerequisite outside the current scope.
  Completed items start folded. A line shows the title, the status and the
  step count; the rest is one press away in the details. Folds are remembered.
  The web shell bundles a small set of Lucide icons, with no runtime download.
- **Every item records** its status (`todo`, `doing`, `waiting`, `later`,
  `done`), its driver (which session pushes it, if any), its origin, who
  created it, sub-steps, dependencies (across projects too), the next step,
  what it is waiting for, and optional dates.
- **Origin says why an item exists**, so the original plan stays visible when
  things pile up:
  - `plan` – written down before starting;
  - `issue` (⚡) – a problem that showed up on the way; ignore it and the
    plan cannot finish;
  - `added` (+) – new scope added after the plan; ignore it and the plan still
    finishes.

  A task shows `2/4`: done/total over its direct sub-steps. A line that is
  not from the plan carries its `issue` or `added` mark.
- **Finished tasks leave the board after a week.** A task that has been done
  for longer than the set number of days is archived with its steps, so the
  board stays small and quick. The settings behind the gear at the top right
  set the number of days, or never. The archive keeps everything, done times
  included: `vibeboard list --archived` reads it and
  `vibeboard archive --restore <id>` brings a task back.
- **One setting sizes all the text.** The same settings hold the text size: one
  percentage for every line, icon and control, shared by the iTerm2 panel and
  the Paseo panels.
- **You edit in the panel.** Press an item's dot to tick it off, press an item for details (adding a
  step, copying the title and deleting are there), press it twice to edit, `+`
  at the top right to add, Undo (⌘Z in iTerm2) to take a change back. Press a
  session badge to jump to that pane or agent. When a session ends its badge
  greys out and you can hand the item to another one.
- **Agents edit through the `vibeboard` CLI.** `vibeboard instructions` prints the
  rules: write the plan as sub-steps before starting, register anything
  unplanned before handling it, say which planned step comes next once a
  detour is done. A session is recognised by the pane or Paseo agent it runs in.
- **Claude Code adapter**: a skill with those rules and two hooks
  (`SessionStart`, `SessionEnd`) that map panes to sessions. See
  [adapters/claude-code](adapters/claude-code/README.md).

## Try it

```sh
git clone https://github.com/KosmoCHE/iterm-vibe-board && cd iterm-vibe-board
./install.sh
```

This puts the `vibeboard` launcher in `~/.iterm-vibe-board/bin/` (and on your
PATH), links the Claude Code skill and hooks, and registers the panel as an
iTerm2 AutoLaunch script. Then enable it under View › Toolbelt › Vibe Board.
Rerun after `git pull`; `./install.sh --uninstall` takes it all out again.

### In Paseo

```sh
paseo plugin install "$PWD/ui"
```

Turn on Settings › Plugins › Enable plugins, then open a workspace's Explorer
sidebar and add Vibe Board from its `+`. The plugin reads the same local server,
so run `./install.sh` first.

Data lives in `~/.iterm-vibe-board/`: one JSON file per item under
`projects/<key>/items/`, plus a small map from panes to sessions. Set
`VIBEBOARD_HOME` to use another directory.

## Requirements

- macOS with iTerm2 3.5 or newer, the Python API enabled
  (Settings › General › Magic) and its Python runtime installed
  (Scripts › Manage › Install Python Runtime); it runs the panel script.
- Python 3.9 or newer for the CLI (the one Xcode's command line tools ship is enough).
- Claude Code, for the first agent adapter.
- Paseo 0.14 or newer, only for the panel inside Paseo.

## Not in the first version

A Gantt view, Homebrew formula, adapters for other agents.

## Layout

```
vibeboard/               Python package: store, CLI, local HTTP server (stdlib only)
ui/                   the panel, written once in React Native, and also a Paseo plugin:
  client/board/       the board itself; it reaches its host only through host.ts
  web/, dist/         the shell for iTerm2's web view and its committed bundle
  client/paseo.tsx, server/, shared/, index.*   the shell for Paseo
iterm/                the iTerm2 AutoLaunch script that registers the panel
adapters/claude-code/ skill and hooks for Claude Code
tests/                pytest, core logic only
install.sh            links all of the above into place
```

## Development

```sh
pip install ruff pytest
ruff check . && ruff format --check .
pytest -q
cd ui && npm ci && npm run typecheck && npm run build   # after changing the panel
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GPL-2.0-or-later. The panel is registered through the `iterm2` Python package,
which is GPLv2+, so the whole project follows it.
