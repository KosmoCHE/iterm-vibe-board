# Contributing

## Principles

- **Standard library only** on the Python side, plus the `iterm2` package that
  iTerm2 ships. No pip dependencies for users.
- **One front end.** The panel is written once (`ui/client/board`), in the
  React Native subset a Paseo plugin may use, and reaches the place it runs in
  only through `Host` (`ui/client/board/host.ts`). A new host is a new shell,
  not a second panel.
- **No Node for users.** iTerm2 loads the bundle in `ui/dist`, which is
  committed. Rebuild it with `npm run build` whenever the panel changes.
- **Tests stay light.** Test the store, the file lock and dependency
  resolution. Do not test the UI, and do not chase coverage numbers.
- **Small surface.** Before adding a field, a command or a setting, ask
  whether the panel gets clearer or just bigger.

## Running checks

```sh
pip install ruff pytest
ruff check . && ruff format --check .
pytest -q
cd ui && npm ci && npm run typecheck && npm run build
```

CI runs the same commands on macOS and fails when `ui/dist` is out of date.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), in English:

```
feat(cli): add `vibeboard claim`
fix(store): release the lock when a write fails
docs: explain the origin field
```

Versions follow [SemVer](https://semver.org/); changes go into
`CHANGELOG.md` under *Unreleased* as they land.

## Layout

```
vibeboard/               store, CLI, local HTTP server
ui/                   the panel and its two shells (iTerm2 web view, Paseo plugin)
iterm/                AutoLaunch script
adapters/<agent>/     one directory per supported agent
tests/
```

## Adding an agent adapter

An adapter is a directory under `adapters/` that teaches one agent to use the
`vibeboard` CLI: how it learns which pane it is in, when it registers and
releases items, and the rule text it loads. Look at `adapters/claude-code/`
first; the core never needs to know a new agent exists.
