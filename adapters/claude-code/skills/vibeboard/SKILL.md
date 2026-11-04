---
name: vibeboard
description: Record and update the human's todos on the Vibe Board (the progress board in iTerm2). Use whenever the user asks to add, change or look up a todo, task, step, memo or plan in any wording ("登记 todo", "记到看板", "记个备忘", "加个 task"), and on your own when you start work, hit something unplanned, get blocked, or finish a step.
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

4. **Keep titles short.** Keep a task or step title within 60 characters. Put
   context, acceptance criteria, paths, and long explanations in `--desc`.
   Example: use `修复评测部署` as the title and put the affected service and
   failure details in the description.

5. **Clean up after completion.** After marking work `done`, clear stale
   `next` and `waiting_for` text, review dependencies that no longer describe
   live work, and archive temporary issue or handoff items with
   `vibeboard archive ID` when they are no longer useful. Keep completed work
   that serves as history, and report the cleanup in the handoff.

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

When handing work to another session, leave the item or step in a truthful
status, write the current result and the next action in `description` and
`next`, name the blocker in `waiting_for` when one exists, and keep only the
smallest real prerequisites in `depends_on`. The receiving session reads this
context before it claims the item.

Your session and project are detected from the pane you run in; a background
job is known by its own session and files new items under the current
directory. There is nothing to configure.
