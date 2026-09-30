# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- `started_at` is stamped by the clock when an item first becomes `doing`,
  like `done_at`; the hand-set `start` date is gone. The inspector shows
  created, started and done times.

## [0.1.0] - 2026-09-29

First usable version. Everything runs from a clone via `install.sh`; the
data format may still change before 1.0.

### Added

- Store: one JSON file per item under `~/.iterm-vibe-board/projects/<key>/`,
  hash ids plus per-project numbers; status, origin (`plan`, `issue`,
  `added`), driver session, description, sub-steps, cross-project
  dependencies, next step, what it waits for, dates. Atomic writes and a
  per-project lock keep concurrent sessions safe.
- `vibeboard` CLI: `add`, `list`, `show`, `set`, `claim`, `done`, `archive`
  (`--restore`), `pane`, `hook`, `serve`, `instructions`. The calling session
  is recognised from the iTerm2 pane it runs in.
- Panel in the iTerm2 toolbelt: Global (filter by project or session),
  Project and Session tabs bound to the focused pane; click for details,
  double-click to edit, right-click to add a step or delete, ⌘Z undo, done
  items folded per level, per-origin progress on parents, jump to a
  session's pane from its badge.
- Local stdlib-only HTTP server and an AutoLaunch script that registers the
  panel and follows pane focus.
- Claude Code adapter: the `vibeboard` skill (plan first, register the
  unplanned before handling it, say what comes next) and `SessionStart` /
  `SessionEnd` hooks mapping panes to sessions.
- `install.sh`: launcher, skill, hooks and AutoLaunch script in one go, with
  `--uninstall`.

[Unreleased]: https://github.com/KosmoCHE/iterm-vibe-board/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/KosmoCHE/iterm-vibe-board/releases/tag/v0.1.0
