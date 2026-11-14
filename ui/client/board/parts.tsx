// The board's shared context and the small controls its parts use.

import { createContext, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import type { Colors, Host, IconName, Item, Status, Tab } from "./host";
import type { Model } from "./model";

/** What the board shows right now. The first two fields are remembered (Prefs). */
export interface Ui {
  tab: Tab;
  open: Record<string, boolean>;
  showDone: Record<string, boolean>; // "root:scope" or doneStepsKey(): that level's done items are unfolded
  filter: string; // Global only: "" | "project:<path>" | "who:<session>"
  selected: string | null; // shown in the inspector
  editing: boolean; // the inspector shows controls instead of text
  adding: boolean; // the add form is open
  addParent: string | null; // item the add form adds a step under
  settings: boolean; // the settings dialog is open
}

export interface Ctx {
  host: Host;
  c: Colors;
  m: Model;
  ui: Ui;
  /** A text size, or a length that sits beside text, at the text size the user set. */
  scaled(n: number): number;
  set(change: (ui: Ui) => Partial<Ui>): void;
  patch(id: string, fields: Partial<Item>): void;
  remove(item: Item): void;
  select(id: string | null, edit?: boolean): void;
  jumpTo(item: Item): void;
  jumpToDriver(item: Item): void;
  copyTitle(item: Item): void;
  /** Offer the item's menu at a point in the window. */
  openMenu(item: Item, x: number, y: number): void;
}

/**
 * Props for a right-click. The web shells (iTerm2's web view, Paseo's Electron app) get it
 * from react-native-web, which hands onContextMenu to the DOM; React Native's types do not list it.
 */
export function onRightClick(handler: (x: number, y: number) => void): object {
  return {
    onContextMenu(e: { preventDefault(): void; stopPropagation(): void; nativeEvent: { clientX: number; clientY: number } }) {
      e.preventDefault(); // not the browser's own menu
      e.stopPropagation();
      handler(e.nativeEvent.clientX, e.nativeEvent.clientY);
    },
  };
}

/** Where Ui.showDone keeps the fold of a task's finished steps: the list and the inspector share it. */
export const doneStepsKey = (ui: Ui, task: Item) => ui.tab + ":" + task.id;

export const BoardContext = createContext<Ctx | null>(null);

export function useBoard(): Ctx {
  return useContext(BoardContext)!;
}

export function statusColor(c: Colors, status: Status): string {
  return {
    todo: c.foregroundMuted,
    doing: c.statusWarning,
    waiting: c.accent,
    later: c.foregroundMuted,
    done: c.statusSuccess,
  }[status];
}

const STATUS_ICON: Record<Status, IconName> = {
  todo: "Circle",
  doing: "CircleDot",
  waiting: "Clock3",
  later: "CircleDashed",
  done: "Check",
};

export function T(props: {
  size?: number;
  color?: string;
  weight?: TextStyle["fontWeight"];
  lines?: number;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
}) {
  const { c, scaled } = useBoard();
  const size = scaled(props.size ?? 11);
  return (
    <Text
      numberOfLines={props.lines}
      selectable={props.selectable}
      style={[
        { fontSize: size, lineHeight: Math.round(size * 1.45), color: props.color ?? c.foreground, fontWeight: props.weight },
        props.style,
      ]}
    >
      {props.children}
    </Text>
  );
}

export function Icon(props: { name: IconName; size?: number; color?: string }) {
  const { host, c, scaled } = useBoard();
  return <host.Icon name={props.name} size={scaled(props.size ?? 12)} color={props.color ?? c.foregroundMuted} />;
}

/** The status icon as a checkbox: a press completes the item, or reopens a done one. */
export function Complete({ item, size, style }: { item: Item; size?: number; style?: StyleProp<ViewStyle> }) {
  const { c, m, patch } = useBoard();
  const done = item.status === "done";
  const status = m.shownStatus(item);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={"Mark “" + item.title + "” " + (done ? "to do" : "done")}
      accessibilityState={{ checked: done }}
      onPress={() => patch(item.id, { status: done ? "todo" : "done" })}
      style={style}
    >
      <Icon name={STATUS_ICON[status]} size={size ?? 13} color={statusColor(c, status)} />
    </Pressable>
  );
}

/** Words to press, in the accent colour. */
export function Link(props: { size?: number; onPress: () => void; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { c } = useBoard();
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={props.style}>
      <T size={props.size} color={c.accent}>
        {props.children}
      </T>
    </Pressable>
  );
}

/** A wash of colour over its parent: host colours come in any format, so they are never mixed. */
export function Tint({ color, opacity, radius }: { color: string; opacity: number; radius?: number }) {
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: color,
        opacity,
        borderRadius: radius,
        pointerEvents: "none",
      }}
    />
  );
}

/** The session an item is pushed by. Press jumps to its pane, or opens the editor when it is gone. */
export function DriverChip({ item }: { item: Item }) {
  const { c, m, jumpToDriver } = useBoard();
  const pane = m.paneOf(item.driver!);
  const gone = Boolean(pane && !pane.alive);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => jumpToDriver(item)}
      style={{ maxWidth: "100%", borderRadius: 4, paddingVertical: 1, paddingHorizontal: 4, borderWidth: 1, borderStyle: gone ? "dashed" : "solid", borderColor: c.border }}
    >
      <T size={9} lines={1} color={gone ? c.foregroundMuted : c.foreground}>
        {"@" + m.whoName(item.driver)}
      </T>
    </Pressable>
  );
}

/** "Show 3 done" / "Hide 3 done": the fold that keeps finished items out of the way. */
export function DoneFold(props: { count: number; open: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const { c } = useBoard();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: props.open }}
      onPress={props.onPress}
      style={[{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 6 }, props.style]}
    >
      <Tint color={c.statusSuccess} opacity={0.08} radius={6} />
      <Icon name={props.open ? "ChevronDown" : "ChevronRight"} size={11} />
      <T size={10} color={c.foregroundMuted}>{`${props.open ? "Hide" : "Show"} ${props.count} done`}</T>
    </Pressable>
  );
}

/** Press shows or hides, a second press within a beat edits. */
export function useItemPress(item: Item): () => void {
  const { ui, select } = useBoard();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = useRef(ui.selected);
  selected.current = ui.selected;
  return () => {
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
      select(item.id, true);
      return;
    }
    // The single press waits, so a double press does not open and close the details on its way in.
    pending.current = setTimeout(() => {
      pending.current = null;
      select(selected.current === item.id ? null : item.id);
    }, 220);
  };
}

export interface Option {
  value: string;
  label: string;
  group?: string;
}

/** A drop-down that opens in place, so it works the same in a web view and on a phone. */
export function Select(props: { value: string; options: Option[]; onChange: (value: string) => void }) {
  const { c } = useBoard();
  const [open, setOpen] = useState(false);
  const current = props.options.find((o) => o.value === props.value);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={[controlStyle(c), { flexDirection: "row", alignItems: "center", gap: 4 }]}
      >
        <T lines={1} style={{ flex: 1 }}>
          {current ? current.label : ""}
        </T>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={11} />
      </Pressable>
      {open && (
        <ScrollView style={{ maxHeight: 220, marginTop: 2, borderWidth: 1, borderColor: c.border, borderRadius: 6, backgroundColor: c.surface0 }}>
          {props.options.map((o, n) => (
            <View key={o.value}>
              {o.group && (n === 0 || props.options[n - 1].group !== o.group) && (
                <T size={9} color={c.foregroundMuted} weight="600" style={{ paddingHorizontal: 7, paddingTop: 5 }}>
                  {o.group}
                </T>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setOpen(false);
                  if (o.value !== props.value) props.onChange(o.value);
                }}
                style={{ paddingVertical: 4, paddingHorizontal: 7 }}
              >
                {o.value === props.value && <Tint color={c.accent} opacity={0.2} />}
                <T lines={1}>{o.label}</T>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export function controlStyle(c: Colors): ViewStyle {
  return {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 5,
    backgroundColor: c.surface0,
    paddingVertical: 3,
    paddingHorizontal: 6,
  };
}

/** A text field that commits on blur or Enter and restores the saved value on Escape. */
export function Field(props: {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const { c, scaled } = useBoard();
  const [draft, setDraft] = useState(props.value);
  const saved = useRef(props.value);
  const input = useRef<TextInput>(null);
  const cancelled = useRef(false);
  // The saved value changed elsewhere and nothing is being typed over it: show the new one.
  if (saved.current !== props.value) {
    if (draft === saved.current) setDraft(props.value);
    saved.current = props.value;
  }
  return (
    <TextInput
      ref={input}
      value={draft}
      multiline={props.multiline}
      numberOfLines={props.multiline ? Math.min(8, Math.max(3, draft.split("\n").length + 1)) : undefined}
      placeholder={props.placeholder}
      placeholderTextColor={c.foregroundMuted}
      onChangeText={setDraft}
      submitBehavior={props.multiline ? "newline" : "blurAndSubmit"}
      onKeyPress={(e) => {
        if (e.nativeEvent.key !== "Escape") return;
        cancelled.current = true;
        input.current?.blur();
      }}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(props.value);
        } else if (draft.trim() !== props.value) props.onCommit(draft.trim());
      }}
      style={[controlStyle(c), { flex: 1, minWidth: 0, fontSize: scaled(11), color: c.foreground }]}
    />
  );
}
