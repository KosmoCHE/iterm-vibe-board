# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Repository scaffold: license, README, contribution guide, lint, test and
  CI configuration.
- Store: one JSON file per item under `~/.iterm-vibe-board/projects/<key>/`,
  hash ids plus per-project numbers, statuses, origins, drivers, sub-steps and
  cross-project dependencies.
- `vibeboard` CLI: `add`, `list`, `show`, `set`, `claim`, `done`, `archive`,
  `pane`, `hook`, `serve`, `instructions`.
- Panel in the iTerm2 toolbelt with Global, Project and Session tabs, a local
  stdlib-only HTTP server and an AutoLaunch script that registers it.
- Claude Code adapter: a skill with the three rules and two hooks that map
  panes to sessions.
- `install.sh`: launcher, skill, hooks and AutoLaunch script in one go, with
  `--uninstall`.
