// The list: every task with its steps, and what waits for what, drawn the way a git
// graph draws history.
//
// One line per item, prerequisites above what waits for them. The rail on the left
// carries a dot per item and a lane per dependency: a lane leaves its prerequisite,
// runs down, and ends in the dot of the item that waits for it. A task's steps branch
// off a faint trunk below the task. Details stay in the inspector. Everything is
// positioned by arithmetic, so nothing is measured.

import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { ViewStyle } from "react-native";
import type { Item } from "./host";
import { graphFlows, graphLayers, scopedChildren } from "./model";
import type { Model } from "./model";
import { Complete, doneStepsKey, Icon, Link, T, Tint, useBoard, useItemPress } from "./parts";
import type { Ui } from "./parts";

// --- what to draw ---------------------------------------------------------------

interface Fold {
  key: string; // in Ui.showDone
  count: number;
  open: boolean;
}
interface Row {
  key: string;
  item?: Item; // absent on a fold row
  fold?: Fold;
  parent?: string; // on a step, and on the fold of a task's done steps: the task's row
  steps?: { key: string; done: number; total: number; open: boolean }; // a task that has steps; key in Ui.open
  outside?: boolean; // waits for something the current scope does not show
}
interface Edge {
  source: string; // row keys
  target: string;
  links: [string, string][]; // the item pairs it stands for
  summary: boolean; // an end stands in for a hidden item: drawn dashed
}

function scopeKey(ui: Ui, m: Model): string {
  const f = m.focus;
  return ui.tab + ":" + (ui.tab === "global" ? ui.filter : (ui.tab === "project" ? f.projects : f.sessions).join("|"));
}

// Where the folds are kept. Ui.open: a task's steps, per scope. Ui.showDone: a level's
// finished items, the top level here and a task's steps under parts.doneStepsKey.
const stepsKey = (scope: string, task: Item) => scope + ":" + task.id;
const doneKey = (scope: string) => "root:" + scope;

/** Ui.open with the steps under these keys folded or shown. Steps show until folded, so only folds are kept. */
function folded(open: Ui["open"], keys: string[], fold: boolean): Ui["open"] {
  const next = { ...open };
  for (const key of keys) {
    if (fold) next[key] = false;
    else delete next[key];
  }
  return next;
}

/** Ui.open as it is worth remembering: without the folds of tasks that have left the board. */
export function lasting(open: Ui["open"], m: Model): Ui["open"] {
  // A key ends in its task's id: see stepsKey.
  return Object.fromEntries(Object.entries(open).filter(([key]) => key.slice(key.lastIndexOf(":") + 1) in m.byId));
}

/** The folds to open so that an item shows. `openTask` also unfolds a task's own steps. */
export function reveal(ui: Ui, m: Model, item: Item, openTask: boolean): Partial<Ui> {
  const task = m.scopeItems(ui.tab, ui.filter).find((i) => i.id === item.parent) || item;
  const scope = scopeKey(ui, m);
  const out: Partial<Ui> = {};
  const steps = stepsKey(scope, task);
  if ((task !== item || openTask) && ui.open[steps] === false) out.open = folded(ui.open, [steps], false);
  const showDone = { ...ui.showDone };
  if (task.status === "done") showDone[doneKey(scope)] = true;
  if (task !== item && item.status === "done") showDone[doneStepsKey(ui, task)] = true;
  return { ...out, showDone };
}

function plan(items: Item[], ui: Ui, m: Model) {
  const kids = scopedChildren(items);
  const scope = scopeKey(ui, m);
  const { done, active } = m.levelItems(kids.root || []);
  const rootOpen = Boolean(ui.showDone[doneKey(scope)]);
  const tasks = rootOpen ? [...done, ...active] : active;
  const loop = graphLayers(items, new Map(items.map((item) => [item.id, new Set(item.depends_on)]))).unresolved.length > 0;

  // Project step links onto their tasks, only to put the tasks in order. Lanes keep the step ends.
  const taskDeps = new Map(tasks.map((task) => [task.id, new Set<string>()]));
  const owners = new Map(items.map((item) => [item.id, item.parent && taskDeps.has(item.parent) ? item.parent : item.id]));
  for (const item of items) {
    const target = owners.get(item.id)!;
    if (!taskDeps.has(target)) continue;
    for (const dep of item.depends_on) {
      const source = owners.get(dep);
      if (source && source !== target && taskDeps.has(source)) taskDeps.get(target)!.add(source);
    }
  }

  const rows: Row[] = [];
  const shownAt = new Map<string, string>(); // item id → key of the row that shows it
  if (done.length) {
    rows.push({ key: "f:root", fold: { key: doneKey(scope), count: done.length, open: rootOpen } });
    if (!rootOpen) for (const item of done) shownAt.set(item.id, "f:root");
  }
  let anyOpen = false;
  // Tasks that depend on each other stay together, each below what it waits for.
  for (const { layers, unresolved } of graphFlows(tasks, taskDeps)) {
    for (const task of [...layers.flat(), ...unresolved]) {
      const steps = kids[task.id] || [];
      const key = stepsKey(scope, task);
      const open = steps.length > 0 && ui.open[key] !== false; // rows are small: open until folded
      anyOpen = anyOpen || open;
      shownAt.set(task.id, "n:" + task.id);
      rows.push({
        key: "n:" + task.id,
        item: task,
        steps: steps.length ? { key, done: steps.filter((s) => s.status === "done").length, total: steps.length, open } : undefined,
      });
      if (!open) continue;
      const inside = m.levelItems(steps);
      const doneFold = doneStepsKey(ui, task);
      const foldOpen = Boolean(ui.showDone[doneFold]);
      if (inside.done.length) {
        rows.push({ key: "f:" + task.id, fold: { key: doneFold, count: inside.done.length, open: foldOpen }, parent: "n:" + task.id });
        if (!foldOpen) for (const step of inside.done) shownAt.set(step.id, "f:" + task.id);
      }
      for (const step of foldOpen ? [...inside.done, ...inside.active] : inside.active) {
        shownAt.set(step.id, "n:" + step.id);
        rows.push({ key: "n:" + step.id, item: step, parent: "n:" + task.id });
      }
    }
  }

  // A hidden step is stood in for by the fold or the folded task that hides it.
  const endpoint = (item: Item) => shownAt.get(item.id) || (item.parent ? shownAt.get(item.parent) : undefined);
  const inScope = new Set(items.map((item) => item.id));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const edges = new Map<string, Edge>();
  for (const item of items) {
    const target = endpoint(item);
    if (!target) continue;
    for (const id of item.depends_on) {
      const dep = m.byId[id];
      const source = dep && inScope.has(id) ? endpoint(dep) : undefined;
      if (!dep || source === target) continue;
      if (!source) {
        byKey.get(target)!.outside = true; // scope boundaries are marks, never extra rows
        continue;
      }
      const summary = source !== "n:" + id || target !== "n:" + item.id;
      const known = edges.get(source + ">" + target);
      if (known) {
        known.links.push([id, item.id]);
        known.summary = known.summary && summary;
      } else edges.set(source + ">" + target, { source, target, links: [[id, item.id]], summary });
    }
  }
  const ends = new Map(items.map((item) => [item.id, endpoint(item)]));
  return { rows, edges: [...edges.values()], ends, tasks, anyOpen, loop, scope };
}

type Plan = ReturnType<typeof plan>;

// What the selection touches: everything upstream and downstream of it.
function trace(p: Plan, items: Item[], m: Model, selected: string | null) {
  const roots = new Set(selected ? [selected] : []);
  // Selecting a task traces its visible scope's steps as well.
  if (selected) for (const item of items) if (item.parent === selected) roots.add(item.id);
  const downstream = new Map<string, string[]>();
  for (const item of m.board.items) {
    for (const dep of item.depends_on) downstream.set(dep, [...(downstream.get(dep) || []), item.id]);
  }
  const follow = (neighbors: (id: string) => string[] | undefined) => {
    const ids = new Set(roots);
    for (const id of ids) for (const next of neighbors(id) || []) ids.add(next);
    return ids;
  };
  const before = follow((id) => m.byId[id]?.depends_on); // a prerequisite may have left the board
  const after = follow((id) => downstream.get(id));
  const related = new Set<string>();
  for (const id of [...before, ...after]) {
    const at = p.ends.get(id);
    if (at) related.add(at);
  }
  const onPath = (edge: Edge) =>
    edge.links.some(([from, to]) => (before.has(from) && before.has(to)) || (after.has(from) && after.has(to)));
  return { related, onPath };
}

// --- lanes ------------------------------------------------------------------------

/** One stroke inside a row's rail. */
type Stroke =
  | { kind: "line"; lane: number; from: number; to: number; paint: Paint } // fractions of the row's height
  | { kind: "turn"; col: number; lane: number; up: boolean; paint: Paint } // from the dot sideways, then along the lane
  | { kind: "tick"; col: number; lane: number; paint: Paint }; // from the trunk sideways to a step's dot
type Paint = "tree" | "plain" | "dashed" | "lit" | "back";

/**
 * Give every row a column for its dot and every dependency a lane, like `git log --graph`:
 * a lane is reserved for the item it leads to, later prerequisites of that item join it,
 * and the item's dot sits where its lane arrives. Below a task its column is the trunk:
 * the steps sit to its right, and each chain of steps is tied to the trunk once.
 */
function lanes(p: Plan, lit: (edge: Edge) => boolean) {
  const index = new Map(p.rows.map((row, n) => [row.key, n]));
  const at = (key: string) => index.get(key)!; // every edge joins two rows
  const leaving = p.rows.map(() => [] as Edge[]);
  const back: Edge[] = []; // the prerequisite sits below: only loops and interleaved tasks do this
  for (const edge of p.edges) {
    if (at(edge.source) < at(edge.target)) leaving[at(edge.source)].push(edge);
    else back.push(edge);
  }
  const reserved: (string | null)[] = []; // lane → the row it leads to
  const free = () => {
    const n = reserved.indexOf(null);
    return n < 0 ? reserved.length : n;
  };
  const cols: number[] = [];
  const strokes = p.rows.map(() => new Map<string, Stroke>());
  const rank: Record<Paint, number> = { tree: 0, dashed: 1, plain: 2, back: 3, lit: 4 };
  const draw = (row: number, stroke: Stroke) => {
    const key = stroke.kind === "line" ? `l${stroke.lane}:${stroke.from}` : `${stroke.kind}${stroke.col}:${stroke.lane}:${stroke.kind === "turn" && stroke.up}`;
    const known = strokes[row].get(key);
    // Edges that share a lane overlap exactly; the stronger paint shows.
    if (!known || rank[stroke.paint] > rank[known.paint]) strokes[row].set(key, stroke);
  };
  const run = (lane: number, top: number, bottom: number, paint: Paint) => {
    for (let n = top + 1; n < bottom; n++) draw(n, { kind: "line", lane, from: 0, to: 1, paint });
  };

  const chained = new Set<string>(); // steps that follow another step of their task
  for (const edge of p.edges) {
    const target = p.rows[at(edge.target)];
    if (target.parent && target.parent === p.rows[at(edge.source)].parent) chained.add(edge.target);
  }
  let trunk: { key: string; row: number; col: number; last: number } | null = null;
  const endTrunk = () => {
    if (!trunk) return;
    if (reserved[trunk.col] === "trunk") reserved[trunk.col] = null;
    if (trunk.last > trunk.row) {
      draw(trunk.row, { kind: "line", lane: trunk.col, from: 0.5, to: 1, paint: "tree" });
      run(trunk.col, trunk.row, trunk.last, "tree");
      draw(trunk.last, { kind: "line", lane: trunk.col, from: 0, to: 0.5, paint: "tree" });
    }
    trunk = null;
  };

  p.rows.forEach((row, n) => {
    if (!row.parent) endTrunk();
    let col = reserved.indexOf(row.key);
    if (col < 0) col = free();
    reserved[col] = null;
    cols[n] = col;
    if (trunk && row.parent === trunk.key && !chained.has(row.key)) {
      draw(n, { kind: "tick", col: trunk.col, lane: col, paint: "tree" });
      trunk.last = n;
    }
    // The nearest dependent continues straight down; the others branch off to the side.
    for (const edge of leaving[n].sort((a, b) => at(a.target) - at(b.target))) {
      let lane = reserved.indexOf(edge.target);
      if (lane < 0) {
        lane = reserved[col] === null ? col : free();
        reserved[lane] = edge.target;
      }
      const paint: Paint = lit(edge) ? "lit" : edge.summary ? "dashed" : "plain";
      const end = at(edge.target);
      if (lane === col) draw(n, { kind: "line", lane, from: 0.5, to: 1, paint });
      else draw(n, { kind: "turn", col, lane, up: false, paint });
      run(lane, n, end, paint);
      draw(end, { kind: "line", lane, from: 0, to: 0.5, paint });
    }
    if (row.steps && row.steps.open) {
      trunk = { key: row.key, row: n, col, last: n };
      if (reserved[col] === null) reserved[col] = "trunk"; // keep the steps out of the trunk's column
    }
  });
  endTrunk();

  // Upward links each get a lane of their own, right of everything else.
  let width = Math.max(1, reserved.length);
  for (const edge of back) {
    const top = at(edge.target);
    const bottom = at(edge.source);
    const paint: Paint = lit(edge) ? "lit" : "back";
    draw(top, { kind: "turn", col: cols[top], lane: width, up: false, paint });
    run(width, top, bottom, paint);
    draw(bottom, { kind: "turn", col: cols[bottom], lane: width, up: true, paint });
    width++;
  }
  return p.rows.map((_, n) => ({ col: cols[n], strokes: [...strokes[n].values()] }));
}

// --- the view ---------------------------------------------------------------------

// Lengths at the default text size: the rail grows with the text beside it, its lines do not.
const LANE = 14; // distance between lanes
const LINE = 1.5;
const DOT = 18; // width of the slot a row's dot sits in
const DISC = 7; // radius of the disc behind a dot, and of a turn

export function List({ items }: { items: Item[] }) {
  const { c, m, ui, set } = useBoard();
  const p = plan(items, ui, m);
  if (!p.rows.length) return <Empty />;
  const t = trace(p, items, m, ui.selected);
  const rails = lanes(p, t.onPath);
  const hasSteps = p.rows.some((row) => row.steps);
  return (
    <View style={{ paddingVertical: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 3, marginHorizontal: 10, marginBottom: 6 }}>
        <T size={9} color={c.foregroundMuted}>
          ↓ Prerequisite above, next below
        </T>
        {p.edges.some((edge) => edge.summary) && (
          <T size={9} color={c.foregroundMuted}>
            Dashed: hidden items
          </T>
        )}
        {hasSteps && (
          <Link
            size={9}
            style={{ marginLeft: "auto" }}
            onPress={() => set((now) => ({ open: folded(now.open, p.tasks.map((task) => stepsKey(p.scope, task)), p.anyOpen) }))}
          >
            {p.anyOpen ? "Collapse tasks" : "Expand tasks"}
          </Link>
        )}
      </View>
      {p.loop && (
        <T size={10} color={c.statusDanger} style={{ marginHorizontal: 10, marginBottom: 6 }}>
          Dependency loop: check the task and step prerequisites.
        </T>
      )}
      {p.rows.map((row, n) => {
        const dim = ui.selected !== null && !t.related.has(row.key);
        return row.item ? (
          <ItemRow key={row.key} row={row} item={row.item} rail={rails[n]} dim={dim} />
        ) : (
          <FoldRow key={row.key} row={row} fold={row.fold!} rail={rails[n]} dim={dim} />
        );
      })}
    </View>
  );
}

function Empty() {
  const { c, m, ui } = useBoard();
  let text: string;
  if (ui.tab === "global") {
    if (ui.filter) text = "Nothing here for this filter.";
    else {
      text = Object.keys(m.board.projects).length
        ? "Nothing on the board."
        : "No items yet. Start a session in a project, then add items here.";
    }
  } else if (ui.tab === "project") text = m.focus.projects.length ? "Nothing in this project yet." : "No session is running here.";
  else text = m.focus.sessions.length ? "This session pushes nothing yet." : "No session is running here.";
  return (
    <T size={12} color={c.foregroundMuted} style={{ marginVertical: 12, marginHorizontal: 14 }}>
      {text}
    </T>
  );
}

type RailOf = ReturnType<typeof lanes>[number];

function Rail({ rail, height, children }: { rail: RailOf; height: number; children: ReactNode }) {
  const { c, scaled } = useBoard();
  const color: Record<Paint, string> = { tree: c.foregroundMuted, plain: c.foregroundMuted, dashed: c.foregroundMuted, lit: c.accent, back: c.statusDanger };
  const widest = Math.max(rail.col, ...rail.strokes.map((stroke) => stroke.lane));
  const mid = height / 2;
  const dot = scaled(DOT);
  const disc = scaled(DISC);
  const laneX = (lane: number) => dot / 2 + scaled(lane * LANE); // centre of a lane
  const across = (stroke: { col: number; lane: number }) => Math.abs(laneX(stroke.lane) - laneX(stroke.col));
  return (
    <View style={{ width: laneX(widest) + dot / 2, height }}>
      {rail.strokes.map((stroke, n) => {
        const paint = color[stroke.paint];
        const fade = stroke.paint === "lit" || stroke.paint === "back" ? 1 : stroke.paint === "tree" ? 0.3 : 0.7;
        if (stroke.kind === "tick") {
          const left = laneX(Math.min(stroke.col, stroke.lane));
          return <View key={n} style={{ position: "absolute", left, top: mid - 0.5, width: across(stroke), height: 1, backgroundColor: paint, opacity: fade }} />;
        }
        if (stroke.kind === "line") {
          const wide = stroke.paint === "tree" ? 1 : LINE;
          const frame: ViewStyle = { position: "absolute", left: laneX(stroke.lane) - wide / 2, top: stroke.from * height, width: wide, height: (stroke.to - stroke.from) * height, opacity: fade };
          if (stroke.paint !== "dashed") return <View key={n} style={[frame, { backgroundColor: paint }]} />;
          return (
            <View key={n} style={[frame, { gap: 3, overflow: "hidden" }]}>
              {Array.from({ length: Math.ceil(height / 6) }).map((_, d) => (
                <View key={d} style={{ width: LINE, height: 3, backgroundColor: paint }} />
              ))}
            </View>
          );
        }
        // Sideways from the dot, then a rounded turn into the lane.
        const right = stroke.lane > stroke.col;
        const frame: ViewStyle = {
          position: "absolute",
          left: laneX(Math.min(stroke.col, stroke.lane)) - LINE / 2,
          width: across(stroke) + LINE,
          top: stroke.up ? 0 : mid - LINE / 2,
          height: mid + LINE / 2,
          borderColor: paint,
          borderStyle: stroke.paint === "dashed" ? "dashed" : "solid",
          opacity: fade,
        };
        const corner: ViewStyle = stroke.up
          ? { borderBottomWidth: LINE, ...(right ? { borderRightWidth: LINE, borderBottomRightRadius: disc } : { borderLeftWidth: LINE, borderBottomLeftRadius: disc }) }
          : { borderTopWidth: LINE, ...(right ? { borderRightWidth: LINE, borderTopRightRadius: disc } : { borderLeftWidth: LINE, borderTopLeftRadius: disc }) };
        return <View key={n} style={[frame, corner]} />;
      })}
      {/* The dot: a disc that hides the lines meeting behind it, in a slot as tall as the row. */}
      <View style={{ position: "absolute", left: laneX(rail.col) - dot / 2, top: 0, width: dot, height, alignItems: "center", justifyContent: "center" }}>
        <View style={{ position: "absolute", left: dot / 2 - disc, top: mid - disc, width: 2 * disc, height: 2 * disc, borderRadius: disc, backgroundColor: c.surface0 }} />
        {/* In a view of its own: on the web a bare icon would paint under the disc. */}
        <View>{children}</View>
      </View>
    </View>
  );
}

const ROW = 24;
const TASK = 28;

function ItemRow({ row, item, rail, dim }: { row: Row; item: Item; rail: RailOf; dim: boolean }) {
  const { c, m, ui, set, scaled } = useBoard();
  const press = useItemPress(item);
  const done = item.status === "done";
  const quiet = done || item.status === "later" || m.blocked(item);
  const steps = row.steps;
  const step = Boolean(row.parent);
  const height = scaled(step ? ROW : TASK);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title + ", " + m.board.labels[item.status]}
      onPress={press}
      style={{ flexDirection: "row", alignItems: "center", height, paddingRight: 8 }}
    >
      {item.id === ui.selected && <Tint color={c.accent} opacity={0.16} />}
      <Rail rail={rail} height={height}>
        <Complete
          item={item}
          size={step ? 11 : 13}
          style={{ width: scaled(DOT), height, alignItems: "center", justifyContent: "center", opacity: dim ? 0.4 : 1 }}
        />
      </Rail>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5, opacity: dim ? 0.4 : 1 }}>
        {steps && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={(steps.open ? "Collapse " : "Expand ") + item.title}
            accessibilityState={{ expanded: steps.open }}
            hitSlop={6}
            onPress={() => set((now) => ({ open: folded(now.open, [steps.key], steps.open) }))}
          >
            <Icon name={steps.open ? "ChevronDown" : "ChevronRight"} size={12} />
          </Pressable>
        )}
        <T
          size={step ? 11 : 12}
          weight={step ? undefined : "600"}
          lines={1}
          color={quiet ? c.foregroundMuted : c.foreground}
          style={[{ flex: 1 }, done && { textDecorationLine: "line-through" }]}
        >
          {item.title}
        </T>
        {/* Why it exists, when it was not in the plan. */}
        {item.origin !== "plan" && (
          <T size={9} weight="600" color={item.origin === "issue" ? c.statusDanger : c.statusWarning}>
            {item.origin}
          </T>
        )}
        {row.outside && <Icon name="ArrowUpRight" size={11} color={c.accent} />}
        {steps && (
          <T size={9} color={c.foregroundMuted}>
            {`${steps.done}/${steps.total}`}
          </T>
        )}
        {!step && ui.tab === "global" && (
          <T size={9} lines={1} color={c.foregroundMuted} style={{ maxWidth: scaled(80) }}>
            {m.projectName(item.project)}
          </T>
        )}
      </View>
    </Pressable>
  );
}

function FoldRow({ row, fold, rail, dim }: { row: Row; fold: Fold; rail: RailOf; dim: boolean }) {
  const { c, set, scaled } = useBoard();
  const height = scaled(ROW);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: fold.open }}
      onPress={() => set((now) => ({ showDone: { ...now.showDone, [fold.key]: !fold.open } }))}
      style={{ flexDirection: "row", alignItems: "center", height, paddingRight: 8, opacity: dim && !fold.open ? 0.4 : 1 }}
    >
      <Rail rail={rail} height={height}>
        <Icon name="Check" size={11} color={c.statusSuccess} />
      </Rail>
      <T size={row.parent ? 10 : 11} color={c.foregroundMuted}>{`${fold.open ? "Hide" : "Show"} ${fold.count} done`}</T>
    </Pressable>
  );
}
