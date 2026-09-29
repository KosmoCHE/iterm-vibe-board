# Claude Code adapter

Two pieces, nothing else:

- **A skill** (`skills/vibing/SKILL.md`) that tells the agent how to use the
  board: plan first, register the unplanned before handling it, say what comes
  next after a detour. `vibing instructions` prints the same text, so the
  skill is the single source.
- **Two hooks** (`settings.json`) that record which pane a session runs in.
  `vibing hook` reads the hook event from stdin: `SessionStart` maps the pane
  to the session and its launch directory, `SessionEnd` marks it ended. It
  never prints and never fails the session.

The pane is taken from `TERM_SESSION_ID`, the way iTerm2's own Claude Code
integration does it. Inside tmux that variable names whichever pane started
the server, so the hook records nothing there.

## Install

`./install.sh` at the top of the clone links the skill into `~/.claude/skills/`
and adds the two hooks to `~/.claude/settings.json`, pointing at the launcher
in `~/.iterm-vibe-board/bin/`. By hand, it is the same two steps:

```sh
ln -s "$PWD/adapters/claude-code/skills/vibing" ~/.claude/skills/vibing
# merge settings.json into ~/.claude/settings.json, with `vibing` on the hook shell's PATH
```

Start a new Claude Code session in an iTerm2 pane; the Session tab of the
panel follows it.
