# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The board runs inside Paseo as a plugin panel in each workspace
  (`paseo plugin install <clone>/ui`). Paseo agents are recognised as panes
  through `PASEO_AGENT_ID`: their sessions are attributed, named and shown as
  live, and Project and Session cover the agents of the panel's workspace.

### Changed

- The panel is rewritten as one React Native front end shared by iTerm2 (through
  React Native Web) and Paseo. It reaches its host only through a small `Host`
  interface. `ui/dist` holds the committed web bundle; `panel/` is gone.
- List and Graph are one list now, drawn the way a git graph draws history: one
  line per item, a lane per dependency, a task's steps on a trunk below it.
  Steps show until a task is folded, and pressing an item's dot completes it.
  A line shows the title, the status and the step count; origin, driver,
  what it waits for and the dates are in the details.
- Row actions (add a step, copy the title, delete) moved from the right-click
  menu into the details. Hover tooltips are gone.
- The board keeps refreshing while a field is being edited and keeps what was
  typed, so the "updates pending" banner is gone.

### Fixed

- Interactive Claude sessions register even when Claude detaches their hooks.
  Terminal checks inspect the nearest Claude ancestor, so a detached diagnostic
  cannot borrow the terminal of an outer interactive session.
- Detached diagnostic sessions without a controlling terminal cannot take over an
  inherited iTerm pane. Resuming an outer session clears its stale inner chain,
  and out-of-order session endings no longer restore an already finished session.
- Supervise the panel HTTP service with a per-user macOS LaunchAgent, independent
  of the iTerm API script, and keep its URL stable across crashes.
- Show an explicit stale-data banner while disconnected, bound request timeouts,
  disable offline edits, and refresh the board on reconnection.
- Keep updates received during editing pending until the focused field is left,
  then redraw even if the server version has not changed again. Show a pending
  update notice while preserving the input.
- Restore the previous service configuration and running state after a failed
  upgrade. Confirm the old service is healthy before reporting recovery; remove
  failed first installations and report rollback failures explicitly.
- A background Claude Code job is identified by its own session instead of the
  pane it was launched from, and its hooks leave that pane's record alone. Its
  items no longer show under the launching session's name.
- A resumed session uses its focused or live pane for names and jump targets,
  so an older pane record cannot replace the current name with a short session ID.
- Renaming an iTerm session refreshes its name in the panel without a task edit
  or pane switch. Version polling includes live session names and retains the
  three-second lookup cache.
- List no longer opens custom hover tooltips. Graph task, subtask and dependency
  hints include each item's description when it is present.
- Install the panel in iTerm2's active AppSupport AutoLaunch directory, including
  modern `.config/iterm2` layouts, so it starts again after iTerm2 restarts.
  Reinstalling removes the plugin's stale link from a separate legacy directory.
- Graph task and step titles preserve their original prefixes and version information.
- Clicking a Graph task's status/count toggles its details. The whole control
  shares List's single-click toggle and double-click edit handling.
- Graph shares List's scoped hierarchy. Session and driver filters keep only
  matching tasks and steps, including in group counts and details. Links to
  parents outside the current scope switch to Global.

### Added

- Graph view alongside List, with collapsible task backgrounds, subtask
  dependency layers, and independent flow entries. Nodes resize per level
  to the available sidebar width, wrapping dense rows to keep labels readable. Full
  titles and completion controls are available in the inspector. Completed
  tasks and steps start folded; prerequisite links reveal their targets.
  Includes a bundled Lucide icon subset and its license.
- Graph step details and order within dependency layers follow
  List's actionable-first rules. Completed-step folding is shared with List.

### Changed

- Graph presents a task tree with separate dependency branches inside each task.
  Membership lines have no arrowheads; prerequisite arrows show splits and joins.
  Tasks start as compact nodes with steps folded. Saved folds are respected;
  Expand tasks / Collapse tasks controls the current scope. Selecting a task or step highlights its prerequisite
  and dependent chains. Folded endpoints retain dashed arrows with explicit
  summaries that reveal the original items; out-of-scope prerequisites remain
  navigation links. Cycle warnings use item dependencies, so interleaved steps
  across task groups do not produce false warnings. Independent flows pack by
  actual height, and compact node widths adapt to narrow and wide panels.
- Graph tooltips appear after 200 ms and switch immediately
  when another hint is hovered within 500 ms. Click, scroll and Escape dismiss them.
  Hints cover collapsed task blocks, expanded task headers and individual steps;
  nested controls retain their own hints.
- List uses Graph's task surfaces, Lucide status icons and state colours,
  with compact step rows and separate title and metadata lines. Completion
  controls remain native checkboxes, and completed-item folds support keyboard use.
- Items have no numbers any more. They are named by title, or by any unique
  prefix of their id (`vibeboard list` prints it first); the `#12` /
  `name#12` syntax and the per-project counter and lock are gone. Numbers
  written by 0.1 stay readable until those items are gone.
- Two levels only: an item and its steps. `vibeboard migrate` flattens
  deeper data from 0.1.
- A level reads now → next → waiting → blocked → later; blocked items are
  dimmed and sit below the siblings they wait for.
- Dependency badges show the blocker's title and jump to it; the context
  menu copies the title and offers "add a step" only on items.
- `started_at` is stamped by the clock when an item first becomes `doing`,
  like `done_at`; the hand-set `start` date is gone. The inspector shows
  created, started and done times.
- The project a pane belongs to is the directory Claude Code files the
  session under (changed by `/cd`, not by a shell `cd`); a session started
  inside another hands the pane back when it ends.
- An item is done only when its steps are: marking it done with an open
  step is refused, and so is adding a step under a finished item (set it
  back to `doing` first).
- A project sees the items filed under its sub-directories too, so a session
  started inside a sub-repository still shows up on the Project tab and in
  `vibeboard list --project` of the directory above. Items are not given
  sub-paths themselves; which sub-project a thing belongs to goes in its title.

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
