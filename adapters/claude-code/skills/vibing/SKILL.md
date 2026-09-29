---
name: vibing
description: Keep the human's progress board (the Vibing panel in iTerm2) up to date. Use when you start a piece of work, when something unplanned comes up, when you are blocked, and when a step is done.
---

# Vibing: the human's progress board

The board in the iTerm2 toolbelt belongs to the human who runs this terminal.
Every session shares it. You update the items you push; you never keep a
private list.

## Three rules

1. **Plan before you start.** Write the plan as sub-steps of the item you were
   given (`vibing add "…" --parent ID`), then `vibing claim` the item.
2. **Register anything unplanned before handling it.** Ask: *if I ignored
   this, could the original plan still finish?*
   - No → `--origin incident`. A problem in the way: a failing build, a missing
     permission, a bug you ran into.
   - Yes → `--origin insert`. New scope on top of the plan: a flag the human
     asked for in passing, a follow-up you spotted.

   Never handle it silently, whoever noticed it first.
3. **After a detour, say which planned step comes next**, both in the chat
   and with `vibing set ID --next "…"`.

## Commands

```
vibing list [--all | --project PATH] [--mine]      what is on the board
vibing show ID
vibing add "title" [--parent ID] [--origin plan|incident|insert]
                   [--next "…"] [--waiting "…"] [--due 2026-10-03]
vibing claim ID                                     you push this item; status → doing
vibing set ID --next "…" | --waiting "…" | --status S | --depends ID,ID
vibing done ID
```

Add `--json` to any command for machine-readable output. `#12` names item 12
in your project, `name#12` one in another project.

## Statuses

`todo`, `doing`, `waiting`, `later`, `done`. When you are blocked, set
`--status waiting` and say on whom in `--waiting`: `"me: approve the resize"`
when it is the human (`me` always means the human, never a session), or a
name, or a machine.

Your session and project are detected from the pane you run in; there is
nothing to configure.
