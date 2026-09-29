# Contributing

## Principles

- **Standard library only** on the Python side, plus the `iterm2` package that
  iTerm2 ships. No pip dependencies for users.
- **No build step** for the panel. Plain HTML, CSS and JS that a browser and
  the iTerm2 webview run as-is.
- **Tests stay light.** Test the store, the file lock and dependency
  resolution. Do not test the UI, and do not chase coverage numbers.
- **Small surface.** Before adding a field, a command or a setting, ask
  whether the panel gets clearer or just bigger.

## Running checks

```sh
pip install ruff pytest
ruff check . && ruff format --check .
pytest -q
```

CI runs the same three commands on macOS.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), in English:

```
feat(cli): add `vibing claim`
fix(store): release the lock when a write fails
docs: explain the origin field
```

Versions follow [SemVer](https://semver.org/); changes go into
`CHANGELOG.md` under *Unreleased* as they land.

## Layout

```
vibing/               store, CLI, local HTTP server
panel/                toolbelt page
iterm/                AutoLaunch script
adapters/<agent>/     one directory per supported agent
tests/
```

## Adding an agent adapter

An adapter is a directory under `adapters/` that teaches one agent to use the
`vibing` CLI: how it learns which pane it is in, when it registers and
releases items, and the rule text it loads. Look at `adapters/claude-code/`
first; the core never needs to know a new agent exists.
