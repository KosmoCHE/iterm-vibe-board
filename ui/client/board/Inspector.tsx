// The selected item, below the list: text at first, controls after Edit or a double press.

import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { Item, Status } from "./host";
import { projectPath, scopedChildren, when } from "./model";
import { Complete, DoneFold, DriverChip, Field, Icon, Select, statusColor, T, Tint, useBoard } from "./parts";

export function Inspector() {
  const { c, m, ui, set, select, remove, copyTitle, jumpTo } = useBoard();
  const item = ui.selected ? m.byId[ui.selected] : null;
  if (!item) return null;
  const parent = item.parent ? m.byId[item.parent] : null;
  const actions: [string, () => void][] = [
    ["Copy title", () => copyTitle(item)],
    ["Delete", () => remove(item)],
  ];
  // Steps have no steps.
  if (!item.parent) actions.unshift(["Add a step", () => set(() => ({ adding: true, addParent: item.id }))]);

  return (
    <View style={{ maxHeight: "42%", borderTopWidth: 1, borderTopColor: c.border }}>
      <Tint color={c.foreground} opacity={0.05} />
      <ScrollView contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 8, paddingBottom: 4, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <T size={12} weight="700" selectable style={{ flex: 1 }}>
            {item.title}
          </T>
          <Pressable accessibilityRole="button" onPress={() => select(item.id, !ui.editing)}>
            <T size={12} color={c.accent}>
              {ui.editing ? "Done" : "Edit"}
            </T>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => select(null)}>
            <Icon name="X" size={14} />
          </Pressable>
        </View>
        <T size={10} lines={1} color={c.foregroundMuted}>
          {`${m.shortId(item.id)} · ${item.origin} · by @${m.whoName(item.created_by)} · ${projectPath(item.project)}`}
        </T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {actions.map(([label, run]) => (
            <Pressable key={label} accessibilityRole="button" onPress={run}>
              <T size={10} color={c.accent}>
                {label}
              </T>
            </Pressable>
          ))}
        </View>
        {parent && (
          <Pressable accessibilityRole="button" onPress={() => jumpTo(parent)}>
            <T size={10} color={c.accent}>
              {"‹ " + parent.title}
            </T>
          </Pressable>
        )}
        {ui.editing ? <Editor key={item.id} item={item} /> : <Details item={item} />}
      </ScrollView>
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const { c } = useBoard();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
      <T color={c.foregroundMuted} style={{ width: 62, textAlign: "right", paddingTop: 1 }}>
        {label}
      </T>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 }}>{children}</View>
    </View>
  );
}

function Editor({ item }: { item: Item }) {
  const { m, patch } = useBoard();
  const b = m.board;
  return (
    <>
      <Row label="Title">
        <Field value={item.title} onCommit={(title) => title && patch(item.id, { title })} />
      </Row>
      <Row label="Description">
        <Field multiline value={item.description} onCommit={(description) => patch(item.id, { description })} />
      </Row>
      <Row label="Status">
        <Select
          value={item.status}
          options={b.statuses.map((s) => ({ value: s, label: b.labels[s] }))}
          onChange={(status) => patch(item.id, { status: status as Status })}
        />
      </Row>
      <Row label="Driver">
        <Select value={item.driver || ""} options={m.driverOptions()} onChange={(driver) => patch(item.id, { driver: driver || null })} />
      </Row>
      <Row label="Next">
        <Field value={item.next} onCommit={(next) => patch(item.id, { next })} />
      </Row>
      <Row label="Waiting for">
        <Field value={item.waiting_for} onCommit={(waiting_for) => patch(item.id, { waiting_for })} />
      </Row>
      <Row label="Due">
        <Field value={item.due || ""} placeholder="YYYY-MM-DD" onCommit={(due) => patch(item.id, { due: due || null })} />
      </Row>
    </>
  );
}

function Details({ item }: { item: Item }) {
  const { c, m } = useBoard();
  return (
    <>
      {item.description !== "" && (
        <T selectable style={{ marginBottom: 2 }}>
          {item.description}
        </T>
      )}
      <Row label="Status">
        <Complete item={item} />
        <T color={statusColor(c, item.status)}>{m.board.labels[item.status]}</T>
      </Row>
      <Row label="Created">
        <T selectable>{when(item.created_at)}</T>
      </Row>
      {item.started_at && (
        <Row label="Started">
          <T selectable>{when(item.started_at)}</T>
        </Row>
      )}
      {item.done_at && (
        <Row label="Done">
          <T selectable>{when(item.done_at)}</T>
        </Row>
      )}
      <Row label="Driver">{item.driver ? <DriverChip item={item} /> : <T color={c.foregroundMuted}>no session</T>}</Row>
      {item.next !== "" && (
        <Row label="Next">
          <T selectable>{item.next}</T>
        </Row>
      )}
      {item.waiting_for !== "" && (
        <Row label="Waiting for">
          <T selectable color={c.accent}>
            {item.waiting_for}
          </T>
        </Row>
      )}
      {item.due && (
        <Row label="Due">
          <T selectable>{item.due}</T>
        </Row>
      )}
      <Links item={item} />
    </>
  );
}

function Dependency({ dep }: { dep: Item }) {
  const { c, jumpTo } = useBoard();
  const done = dep.status === "done";
  const color = done ? c.foregroundMuted : c.accent;
  return (
    <Pressable accessibilityRole="button" onPress={() => jumpTo(dep)} style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginVertical: 2 }}>
      <View style={{ height: 14, justifyContent: "center" }}>
        <Icon name={done ? "Check" : "ArrowUpRight"} size={11} color={color} />
      </View>
      <T size={10} color={color} style={{ flex: 1 }}>
        {dep.title}
      </T>
    </Pressable>
  );
}

// The steps of the selected task and what it waits for.
function Links({ item }: { item: Item }) {
  const { c, m, ui, set, select } = useBoard();
  const { done, active } = m.levelItems(scopedChildren(m.scopeItems(ui.tab, ui.filter))[item.id] || []);
  const key = ui.tab + ":" + item.id;
  const open = Boolean(ui.showDone[key]);
  const parent = item.parent ? m.byId[item.parent] : null;
  const known = (ids: string[]) => ids.map((id) => m.byId[id]).filter(Boolean);
  return (
    <>
      {done.length + active.length > 0 && (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 7, marginTop: 3 }}>
          <T size={10} color={c.foregroundMuted} style={{ marginBottom: 4 }}>
            Steps
          </T>
          {done.length > 0 && (
            <DoneFold
              count={done.length}
              open={open}
              onPress={() => set((now) => ({ showDone: { ...now.showDone, [key]: !open } }))}
              style={{ marginBottom: 4 }}
            />
          )}
          {(open ? [...done, ...active] : active).map((step) => (
            <View key={step.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 5, paddingVertical: 3 }}>
              <Complete item={step} />
              <Pressable accessibilityRole="button" onPress={() => select(step.id)} style={{ flex: 1 }}>
                <T
                  color={step.status === "done" || m.blocked(step) ? c.foregroundMuted : c.foreground}
                  style={step.status === "done" && { textDecorationLine: "line-through" }}
                >
                  {step.title}
                </T>
              </Pressable>
              <T size={10} color={statusColor(c, step.status)}>
                {m.board.labels[step.status]}
              </T>
            </View>
          ))}
        </View>
      )}
      {known(item.depends_on).map((dep) => (
        <Dependency key={dep.id} dep={dep} />
      ))}
      {parent && parent.depends_on.length > 0 && (
        <>
          <T size={10} color={c.foregroundMuted} style={{ marginTop: 4 }}>
            Task prerequisites
          </T>
          {known(parent.depends_on).map((dep) => (
            <Dependency key={dep.id} dep={dep} />
          ))}
        </>
      )}
    </>
  );
}
