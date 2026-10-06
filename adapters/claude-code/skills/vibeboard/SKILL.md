---
name: vibeboard
description: Keep the human's progress board (the Vibe Board panel in iTerm2) up to date. Use when you start a piece of work, when something unplanned comes up, when you are blocked, and when a step is done.
---

# Vibe Board: the human's progress board

The board in the iTerm2 toolbelt belongs to the human who runs this terminal.
Every session shares it. You update the items you push; you never keep a
private list.

## Three rules

1. **Plan before you start.** Write the plan as sub-steps of the item you were
   given (`vibeboard add "…" --parent ID`), then `vibeboard claim` the item.
2. **Register anything unplanned before handling it.** Ask: *if I ignored
   this, could the original plan still finish?*
   - No → `--origin issue`. A problem in the way: a failing build, a missing
     permission, a bug you ran into.
   - Yes → `--origin added`. New scope on top of the plan: a flag the human
     asked for in passing, a follow-up you spotted.

   Never handle it silently, whoever noticed it first.
3. **After a detour, say which planned step comes next**, both in the chat
   and with `vibeboard set ID --next "…"`.

## Commands

```
vibeboard list [--all | --project PATH] [--mine]      what is on the board
vibeboard show ID
vibeboard add "title" [--parent ID] [--origin plan|issue|added] [--desc "…"]
                   [--next "…"] [--waiting "…"] [--due 2026-10-03]
vibeboard claim ID                                     you push this item; status → doing (start time is stamped)
vibeboard set ID --desc "…" | --next "…" | --waiting "…" | --status S | --depends ID,ID
vibeboard done ID
```

Add `--json` to any command for machine-readable output. `vibeboard list` prints
each item's id first; ID is that id, any prefix of it that is unique, or a unique
part of the title.

Two levels only: an item and its steps. A step never has steps; if one needs a
plan of its own, make it an item. An item is done when all its steps are;
to add steps to a finished item, set it back to `doing` first. Depend on the smallest set: waiting for all
of an item's steps means depending on the item.

## Statuses

`todo`, `doing`, `waiting`, `later`, `done`. When you are blocked, set
`--status waiting` and say on whom in `--waiting`: `"me: approve the resize"`
when it is the human (`me` always means the human, never a session), or a
name, or a machine.

Your session and project are detected from the pane you run in; there is
nothing to configure.
