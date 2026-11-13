// Reading the board's data: scopes, ordering, names. No UI, no host.

import type { BoardData, Item, Pane, Status, Tab } from "./host";

export const PROGRESS_WORDS: Record<string, string> = {
  plan: "planned",
  issue: "issues",
  added: "added",
};

/** A project sees its own items and those filed under its sub-directories. */
export function within(path: string, project: string): boolean {
  return path === project || path.startsWith(project.replace(/\/+$/, "") + "/");
}

export function projectPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const byCreation = (x: Item, y: Item) => x.created_at.localeCompare(y.created_at);

/** Items grouped under their parent, or under "root" when the parent is out of scope. */
export function scopedChildren(items: Item[]): Record<string, Item[]> {
  const inScope = new Set(items.map((i) => i.id));
  const kids: Record<string, Item[]> = {};
  for (const it of items) {
    const key = it.parent && inScope.has(it.parent) ? it.parent : "root";
    (kids[key] = kids[key] || []).push(it);
  }
  for (const k in kids) kids[k].sort(byCreation);
  return kids;
}

/** Layers of a dependency graph: each layer depends only on the ones above it. */
export function graphLayers(items: Item[], dependencies: Map<string, Set<string>>) {
  const pending = new Set(items.map((item) => item.id));
  const layers: Item[][] = [];
  while (pending.size) {
    const ready = items.filter(
      (item) => pending.has(item.id) && ![...dependencies.get(item.id)!].some((id) => pending.has(id)),
    );
    if (!ready.length) return { layers, unresolved: items.filter((item) => pending.has(item.id)) };
    layers.push(ready);
    ready.forEach((item) => pending.delete(item.id));
  }
  return { layers, unresolved: [] as Item[] };
}

/** Connected groups of items, each layered on its own. */
export function graphFlows(items: Item[], dependencies: Map<string, Set<string>>) {
  const neighbors = new Map(items.map((item) => [item.id, new Set<string>()]));
  for (const item of items) {
    for (const id of dependencies.get(item.id)!) {
      if (!neighbors.has(id)) continue;
      neighbors.get(item.id)!.add(id);
      neighbors.get(id)!.add(item.id);
    }
  }
  const seen = new Set<string>();
  const flows = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    const ids = new Set([item.id]);
    for (const id of ids) {
      seen.add(id);
      for (const neighbor of neighbors.get(id)!) ids.add(neighbor);
    }
    flows.push(graphLayers(items.filter((entry) => ids.has(entry.id)), dependencies));
  }
  return flows;
}

/** The board as seen from the panes it sits beside: the focused one, or those the host names. */
export function model(board: BoardData, beside?: (pane: Pane) => boolean) {
  const byId: Record<string, Item> = Object.fromEntries(board.items.map((i) => [i.id, i]));
  const children: Record<string, Item[]> = {};
  for (const it of board.items) if (it.parent) (children[it.parent] = children[it.parent] || []).push(it);

  // Project and Session follow the sessions running beside the board, newest first.
  // A pane record gets its session, project and start time together.
  const here = Object.values(board.panes)
    .filter((p) => p.session && !p.ended_at && (beside ? beside(p) : p.pane === board.focus.pane))
    .sort((x, y) => (y.started_at || "").localeCompare(x.started_at || ""));
  const focus = {
    sessions: [...new Set(here.map((p) => p.session!))],
    projects: [...new Set(here.map((p) => p.project!))],
  };

  function scopeItems(tab: Tab, filter: string): Item[] {
    const all = board.items;
    if (tab === "global") {
      const [kind, value] = filter.split(/:(.*)/s);
      if (kind === "project") return all.filter((i) => within(i.project, value));
      if (kind === "who") return all.filter((i) => i.driver === value);
      return all;
    }
    if (tab === "project") return all.filter((i) => focus.projects.some((p) => within(i.project, p)));
    return all.filter((i) => i.driver !== null && focus.sessions.includes(i.driver));
  }

  function paneOf(who: string): Pane | null {
    if (board.panes[who]) return board.panes[who];
    const matches = Object.values(board.panes).filter((p) => p.session === who);
    // A resumed session can leave old pane records behind. Prefer its current pane.
    return (
      matches.find((p) => here.includes(p)) ||
      matches.find((p) => p.alive && !p.ended_at) ||
      matches.find((p) => !p.ended_at && p.name) ||
      matches.find((p) => p.name) ||
      matches[0] ||
      null
    );
  }

  function whoName(who: string | null): string {
    if (!who) return "";
    if (who === board.me) return "me";
    const p = paneOf(who);
    const raw = p && p.name ? p.name : who.slice(0, 8);
    return raw.replace(/^[^\w一-鿿]+\s*/, "").replace(/\s*\((claude|codex)\)$/, "");
  }

  function projectName(path: string): string {
    const p = Object.values(board.projects).find((x) => x.path === path);
    return p ? p.name : path.split("/").pop()!;
  }

  /** The shortest prefix, at least 4 characters, that names only this item: what agents type. */
  function shortId(id: string): string {
    const ids = Object.keys(byId);
    for (let n = 4; n < id.length; n++) {
      if (ids.filter((x) => x.startsWith(id.slice(0, n))).length === 1) return id.slice(0, n);
    }
    return id;
  }

  function driverOptions(): { value: string; label: string }[] {
    const options = [{ value: "", label: "no session" }];
    for (const p of Object.values(board.panes)) {
      if (p.session && !p.ended_at) options.push({ value: p.session, label: whoName(p.session) });
    }
    return options;
  }

  /** Per origin over direct children: {origin: [done, total]}. */
  function progress(id: string): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const origin of board.origins) out[origin] = [0, 0];
    for (const it of children[id] || []) {
      out[it.origin][1]++;
      if (it.status === "done") out[it.origin][0]++;
    }
    return out;
  }

  /** Is anything this item depends on still open? */
  function blocked(item: Item): boolean {
    return item.depends_on.some((d) => byId[d] && byId[d].status !== "done");
  }

  /** The status its icon shows: a to-do that waits on another item reads as waiting. */
  function shownStatus(item: Item): Status {
    return item.status === "todo" && blocked(item) ? "waiting" : item.status;
  }

  // One level reads top to bottom as now → next → waiting → blocked → later, oldest first
  // within a group, and a blocked item always below the siblings it waits for.
  const RANK: Record<string, number> = { doing: 0, todo: 1, waiting: 2, later: 4 };
  function ordered(items: Item[]): Item[] {
    const rank = (i: Item) => (blocked(i) && i.status !== "later" ? 3 : RANK[i.status]);
    const out = items.slice().sort((x, y) => rank(x) - rank(y) || byCreation(x, y));
    const seen = new Set<string>();
    for (let n = 0; n < out.length; n++) {
      const last = Math.max(
        -1,
        ...out[n].depends_on.map((d) => out.findIndex((i) => i.id === d && i.status !== "done")),
      );
      if (last > n) {
        // Graph can expose dependency loops. Keep the list responsive on that data too.
        const key = out.map((i) => i.id).join(",");
        if (seen.has(key)) break;
        seen.add(key);
        out.splice(last + 1, 0, ...out.splice(n--, 1)); // move it just below its last blocker
      }
    }
    return out;
  }

  /** One level of the tree: the done items, oldest first, and the open ones in reading order. */
  function levelItems(items: Item[]) {
    return {
      done: items.filter((i) => i.status === "done").sort(byCreation),
      active: ordered(items.filter((i) => i.status !== "done")),
    };
  }

  return {
    board,
    byId,
    children,
    focus,
    scopeItems,
    paneOf,
    whoName,
    projectName,
    shortId,
    driverOptions,
    progress,
    blocked,
    shownStatus,
    levelItems,
  };
}

export type Model = ReturnType<typeof model>;
