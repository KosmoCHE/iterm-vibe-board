// List view: each task with its steps beneath it, finished ones folded away.

import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { Item } from "./host";
import { PROGRESS_WORDS, projectPath, scopedChildren } from "./model";
import { Badge, DoneFold, DriverChip, Icon, isOpen, StatusIcon, T, Tint, useBoard, useItemPress } from "./parts";

type Kids = Record<string, Item[]>;

export function List({ items }: { items: Item[] }) {
  const { c, m, ui } = useBoard();
  const kids = scopedChildren(items);
  const roots = kids.root || [];
  if (!roots.length) return <Empty />;
  if (ui.tab !== "global") {
    return (
      <View style={{ paddingVertical: 10, paddingHorizontal: 6 }}>
        <Level items={roots} foldKey="root" depth={0} kids={kids} />
      </View>
    );
  }
  const byProject: Record<string, Item[]> = {};
  for (const i of roots) (byProject[i.project] = byProject[i.project] || []).push(i);
  return (
    <View style={{ paddingVertical: 10, paddingHorizontal: 6 }}>
      {Object.keys(byProject)
        .sort()
        .map((project, n) => (
          <View key={project}>
            <View style={{ marginTop: n ? 16 : 0, marginHorizontal: 3, marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Icon name="Folder" size={13} />
                <T weight="600" style={{ flex: 1 }}>
                  {m.projectName(project)}
                </T>
              </View>
              <T size={9} lines={1} color={c.foregroundMuted} style={{ marginLeft: 18, marginTop: 3 }}>
                {projectPath(project)}
              </T>
            </View>
            <Level items={byProject[project]} foldKey={"root:" + project} depth={0} kids={kids} />
          </View>
        ))}
    </View>
  );
}

export function Empty() {
  const { c, m, ui } = useBoard();
  const f = m.focus;
  let text: string;
  if (ui.tab === "global") {
    if (ui.filter) text = "Nothing here for this filter.";
    else {
      text = Object.keys(m.board.projects).length
        ? "Nothing on the board."
        : "No items yet. Start a session in a project, then add items here.";
    }
  } else if (ui.tab === "project") text = f.project ? "Nothing in this project yet." : "Focus a pane that runs a session.";
  else text = f.session ? "This session pushes nothing yet." : "Focus a pane that runs a session.";
  return (
    <T size={12} color={c.foregroundMuted} style={{ marginVertical: 12, marginHorizontal: 14 }}>
      {text}
    </T>
  );
}

// One level of the tree: the done items first, folded into a tinted block, then the open ones.
function Level(props: { items: Item[]; foldKey: string; depth: number; kids: Kids }) {
  const { m, ui, set } = useBoard();
  const { done, active } = m.levelItems(props.items);
  const key = ui.tab + ":" + props.foldKey;
  const open = Boolean(ui.showDone[key]);
  const shown = open ? [...done, ...active] : active;
  return (
    <>
      {done.length > 0 && (
        <DoneFold
          count={done.length}
          open={open}
          onPress={() => set((now) => ({ showDone: { ...now.showDone, [key]: !open } }))}
          style={props.depth ? { marginLeft: 18, marginRight: 3, marginBottom: 4 } : { marginBottom: 10 }}
        />
      )}
      {shown.map((item) => (
        <Branch key={item.id} item={item} depth={props.depth} kids={props.kids} />
      ))}
    </>
  );
}

function Branch({ item, depth, kids }: { item: Item; depth: number; kids: Kids }) {
  const { c, ui } = useBoard();
  const children = kids[item.id] || [];
  const rows: ReactNode = (
    <>
      <Row item={item} nChildren={children.length} nested={depth > 0} />
      {children.length > 0 && isOpen(ui, item.id) && (
        <Level items={children} foldKey={item.id} depth={depth + 1} kids={kids} />
      )}
    </>
  );
  if (depth) return rows;
  return (
    <View style={{ marginBottom: 10, padding: 2, borderWidth: 1, borderColor: c.border, borderRadius: 9, backgroundColor: c.surface1 }}>
      {rows}
    </View>
  );
}

function Row({ item, nChildren, nested }: { item: Item; nChildren: number; nested: boolean }) {
  const { c, m, ui, set, patch, jumpTo } = useBoard();
  const press = useItemPress(item);
  const open = isOpen(ui, item.id);
  const labels = m.board.labels;
  const blocked = m.blocked(item);
  const done = item.status === "done";
  const tint =
    item.status === "doing"
      ? { color: c.statusWarning, opacity: 0.1 }
      : done
        ? { color: c.statusSuccess, opacity: 0.06 }
        : item.status === "waiting" || (item.status === "todo" && blocked)
          ? { color: c.accent, opacity: 0.07 }
          : null;
  const progress = Object.entries(m.progress(item.id)).filter(([, [, total]]) => total);
  const muted = done || blocked;
  const badges: ReactNode[] = [];
  if (item.origin === "issue") badges.push(<Badge key="origin" text="issue" color={c.statusDanger} weight="600" />);
  if (item.origin === "added") badges.push(<Badge key="origin" text="added" color={c.statusWarning} weight="600" />);
  if (item.status !== "todo" && !done) {
    const waits = ui.tab !== "session" && item.status === "waiting" && item.waiting_for ? ": " + item.waiting_for : "";
    const color = item.status === "doing" ? c.statusWarning : item.status === "waiting" ? c.accent : c.foregroundMuted;
    badges.push(<Badge key="status" text={labels[item.status] + waits} color={color} />);
  }
  if (progress.length) {
    badges.push(<Badge key="progress" plain icon="List" text={progress.map(([o, [d, t]]) => `${d}/${t} ${PROGRESS_WORDS[o]}`).join(" · ")} />);
  }
  for (const id of item.depends_on) {
    const dep = m.byId[id];
    if (!dep || dep.status === "done") continue;
    const prefix = dep.project !== item.project ? m.projectName(dep.project) + ": " : "";
    badges.push(<Badge key={id} plain icon="ArrowUpRight" color={c.accent} text={prefix + dep.title} onPress={() => jumpTo(dep)} />);
  }
  if (item.driver) badges.push(<DriverChip key="driver" item={item} />);
  if (item.created_by !== m.board.me && item.created_by !== item.driver) {
    badges.push(<Badge key="from" text={"from " + m.whoName(item.created_by)} />);
  }

  return (
    <Pressable
      onPress={press}
      style={[
        { paddingVertical: 5, paddingHorizontal: 7, borderWidth: 1, borderRadius: 6, borderColor: item.id === ui.selected ? c.accent : "transparent" },
        nested && { marginTop: 2, marginRight: 3, marginBottom: 4, marginLeft: 18 },
      ]}
    >
      {tint && <Tint color={tint.color} opacity={tint.opacity} radius={5} />}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5, paddingVertical: 2 }}>
        {nChildren > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={(open ? "Collapse " : "Expand ") + item.title}
            accessibilityState={{ expanded: open }}
            onPress={() => set((now) => ({ fold: { ...now.fold, [now.tab + ":" + item.id]: !open } }))}
            style={{ width: 12, height: 18, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={"Mark “" + item.title + "” " + (done ? "to do" : "done")}
          accessibilityState={{ checked: done }}
          onPress={() => patch(item.id, { status: done ? "todo" : "done" })}
          style={{ width: 16, height: 18, alignItems: "center", justifyContent: "center" }}
        >
          <StatusIcon item={item} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5 }}>
            {!item.parent && (
              <View style={{ height: 16, justifyContent: "center" }}>
                <Icon name="Folder" size={12} />
              </View>
            )}
            <T
              weight={nested ? undefined : "600"}
              color={muted ? c.foregroundMuted : c.foreground}
              style={[{ flex: 1, lineHeight: 16 }, done && { textDecorationLine: "line-through" }]}
            >
              {item.title}
            </T>
          </View>
          {badges.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>{badges}</View>}
          {ui.tab === "session" && (item.next !== "" || item.waiting_for !== "") && (
            <View style={{ gap: 2 }}>
              {item.next !== "" && <T size={10}>{"next: " + item.next}</T>}
              {item.waiting_for !== "" && (
                <T size={10} color={c.accent}>
                  {"waiting: " + item.waiting_for}
                </T>
              )}
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}
