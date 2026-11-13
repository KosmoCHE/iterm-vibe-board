// The board: keeps the data fresh, owns what is shown, and lays out the panel.

import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { BoardData, Host, Item, Tab } from "./host";
import { Inspector } from "./Inspector";
import { List, reveal } from "./List";
import { model, projectPath } from "./model";
import type { Model } from "./model";
import { BoardContext, controlStyle, Icon, Select, T, Tint, useBoard } from "./parts";
import type { Ctx, Option, Ui } from "./parts";

const UNDO_DEPTH = 20;
const TABS: [Tab, string][] = [
  ["global", "Global"],
  ["project", "Project"],
  ["session", "Session"],
];

type Undo = { id: string; title: string } & ({ fields: Partial<Item> } | { restore: true });

export function Board({ host }: { host: Host }) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [ui, setUi] = useState<Ui>(() => ({
    ...host.prefs,
    showDone: {},
    filter: "",
    selected: null,
    editing: false,
    adding: false,
    addParent: null,
  }));
  const [down, setDown] = useState(false); // the server is unreachable; what is shown is stale
  const [message, setMessage] = useState({ text: "", error: false });
  const [undos, setUndos] = useState<Undo[]>([]);
  const sync = useRef({
    host,
    polling: false,
    down: false,
    version: null as string | null,
    focus: undefined as string | null | undefined,
    at: null as Date | null,
  });
  sync.current.host = host;

  const notice = (text: string) => setMessage({ text, error: false });
  const showError = (e: unknown) => setMessage({ text: e instanceof Error ? e.message : String(e), error: true });

  async function poll() {
    const s = sync.current;
    if (s.polling) return;
    s.polling = true;
    try {
      const { version, focus } = (await s.host.request("GET", "/api/version")) as { version: string; focus: string | null };
      if (s.down || version !== s.version || focus !== s.focus) {
        setBoard((await s.host.request("GET", "/api/board")) as BoardData);
        s.version = version;
        s.focus = focus;
        setMessage((now) => (now.error ? { text: "", error: false } : now));
      }
      s.down = false;
      s.at = new Date();
      setDown(false);
    } catch (e) {
      s.down = true;
      setDown(true);
      showError(e);
    } finally {
      s.polling = false;
    }
  }

  useEffect(() => {
    poll();
    const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  }, []);

  const remembered = useRef(false);
  useEffect(() => {
    if (remembered.current) host.savePrefs({ tab: ui.tab, open: ui.open });
    remembered.current = true;
  }, [ui.tab, ui.open]);

  const m = useMemo(() => board && model(board, host), [board, host.beside, host.project]);

  function change(method: "POST" | "PATCH", path: string, body?: unknown): Promise<unknown> {
    if (sync.current.down) return Promise.reject(new Error("看板已断线，请等待重新连接后再修改任务"));
    return host.request(method, path, body);
  }

  function remember(undo: Undo) {
    setUndos((stack) => [...stack, undo].slice(-UNDO_DEPTH));
  }

  async function patch(id: string, fields: Partial<Item>, undoable = true) {
    const before = m!.byId[id];
    try {
      await change("PATCH", "/api/items/" + id, fields);
      if (undoable && before) {
        const previous: Record<string, unknown> = {};
        for (const key of Object.keys(fields) as (keyof Item)[]) previous[key] = before[key];
        remember({ id, fields: previous, title: before.title });
        notice(`Changed “${before.title}”`);
      }
      await poll();
    } catch (e) {
      showError(e);
    }
  }

  // Delete is archive: the files move aside, and Undo brings them back.
  async function remove(item: Item) {
    try {
      const ids = (await change("POST", `/api/items/${item.id}/archive`)) as string[];
      remember({ id: item.id, restore: true, title: item.title });
      setUi((now) => (now.selected === item.id ? { ...now, selected: null, editing: false } : now));
      notice(`Deleted “${item.title}”` + (ids.length > 1 ? ` and ${ids.length - 1} steps` : "") + " — Undo brings it back");
      await poll();
    } catch (e) {
      showError(e);
    }
  }

  async function undo() {
    const last = undos[undos.length - 1];
    if (!last) return;
    setUndos((stack) => stack.slice(0, -1));
    if ("restore" in last) {
      try {
        await change("POST", `/api/items/${last.id}/restore`);
        await poll();
        notice(`Restored “${last.title}”`);
      } catch (e) {
        showError(e);
      }
      return;
    }
    await patch(last.id, last.fields, false);
    notice(`Undid the change to “${last.title}”`);
  }

  async function add(title: string, project: string) {
    const parent = ui.addParent;
    try {
      await change("POST", "/api/items", {
        title,
        project,
        parent,
        origin: "plan",
        created_by: board!.me,
        driver: ui.tab === "session" ? m!.focus.sessions[0] : null, // the newest session here
      });
      if (parent) set((now) => reveal(now, m!, m!.byId[parent], true)); // show what was just added
      notice(`Added “${title}”`);
      await poll();
    } catch (e) {
      showError(e);
    }
  }

  const set: Ctx["set"] = (changeOf) => setUi((now) => ({ ...now, ...changeOf(now) }));

  function select(id: string | null, edit = false) {
    set((now) => {
      const item = id ? m!.byId[id] : null;
      return { ...(item ? reveal(now, m!, item, false) : {}), selected: id, editing: Boolean(id) && edit };
    });
  }

  // Show an item wherever it is: switch to Global if the current tab cannot see it,
  // unfold what hides it, then select it.
  function jumpTo(item: Item) {
    set((now) => {
      const seen = m!.scopeItems(now.tab, now.filter).some((i) => i.id === item.id);
      const next: Ui = seen ? now : { ...now, tab: "global", filter: "" };
      return { ...next, ...reveal(next, m!, item, true), selected: item.id, editing: false };
    });
  }

  function jumpToDriver(item: Item) {
    const where = m!.paneOf(item.driver!);
    if (where && where.alive) host.jump(where).catch(showError);
    else select(item.id, true); // the session is gone: pick another driver in the editor
  }

  function copyTitle(item: Item) {
    host.copyText(item.title).then(() => notice("Copied the title"), showError);
  }

  const commands = useRef({ undo, escape() {} });
  commands.current = {
    undo,
    escape() {
      if (ui.selected) select(ui.editing ? ui.selected : null);
    },
  };
  useEffect(
    () => host.shortcuts?.({ undo: () => commands.current.undo(), escape: () => commands.current.escape() }),
    [],
  );

  const c = host.colors;
  if (!board || !m) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface0, padding: 9 }}>
        {/* Nothing has arrived yet: say why. */}
        {message.error && <Text style={{ fontSize: 11, color: c.statusDanger }}>{message.text}</Text>}
      </View>
    );
  }

  // What the remembered state points at may be gone.
  const filter = filterOptions(m).some((o) => o.value === ui.filter) ? ui.filter : "";
  const items = m.scopeItems(ui.tab, filter);
  const selected = items.some((i) => i.id === ui.selected) ? ui.selected : null;
  const shown: Ui = { ...ui, filter, selected, editing: Boolean(selected) && ui.editing };
  const ctx: Ctx = { host, c, m, ui: shown, set, patch, remove, select, jumpTo, jumpToDriver, copyTitle };
  const canAdd = ui.tab === "global" ? Object.keys(board.projects).length > 0 : m.focus.projects.length > 0;

  return (
    <BoardContext.Provider value={ctx}>
      <View style={{ flex: 1, backgroundColor: c.surface0 }}>
        {down && (
          <View accessibilityRole="alert" style={{ padding: 9, backgroundColor: c.statusWarning }}>
            <T weight="600" color={c.surface0}>
              {"看板连接已断开，正在重连。当前显示的是旧数据" +
                (sync.current.at ? `（最后同步 ${sync.current.at.toLocaleTimeString()}）` : "") +
                "。"}
            </T>
          </View>
        )}
        <Header canAdd={canAdd && !down} />
        <View style={{ flex: 1, pointerEvents: down ? "none" : "auto" }}>
          {ui.adding && canAdd && <AddForm onAdd={add} />}
          <ScrollView style={{ flex: 1, opacity: down ? 0.5 : 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
            <List items={items} />
          </ScrollView>
          <Inspector />
          {(message.text !== "" || undos.length > 0) && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: c.border }}>
              <T lines={1} color={message.error ? c.statusDanger : c.foregroundMuted} style={{ flex: 1 }}>
                {message.text}
              </T>
              {undos.length > 0 && (
                <Pressable accessibilityRole="button" onPress={undo}>
                  <T color={c.accent}>Undo</T>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>
    </BoardContext.Provider>
  );
}

function filterOptions(m: Model): Option[] {
  const options: Option[] = [{ value: "", label: "everything" }];
  for (const p of Object.values(m.board.projects).sort((x, y) => x.name.localeCompare(y.name))) {
    options.push({ value: "project:" + p.path, label: `${p.name} — ${projectPath(p.path)}`, group: "Projects" });
  }
  const panes = Object.values(m.board.panes).filter((p) => p.session);
  panes.sort((x, y) => Number(y.alive) - Number(x.alive) || m.whoName(x.session!).localeCompare(m.whoName(y.session!)));
  const listed = new Set<string>();
  for (const p of panes) {
    if (listed.has(p.session!)) continue; // a resumed session leaves several pane records
    listed.add(p.session!);
    options.push({ value: "who:" + p.session, label: "@" + m.whoName(p.session!) + (p.alive ? "" : " (gone)"), group: "Sessions" });
  }
  return options;
}

function Header({ canAdd }: { canAdd: boolean }) {
  const { c, m, ui, set } = useBoard();
  const f = m.focus;
  return (
    <View style={{ paddingTop: 6, paddingHorizontal: 8, paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View accessibilityRole="tablist" style={{ flex: 1, flexDirection: "row", gap: 2, padding: 2, borderRadius: 7, backgroundColor: c.surface2 }}>
          {TABS.map(([tab, label]) => (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: ui.tab === tab }}
              onPress={() => set(() => ({ tab, selected: null, editing: false }))}
              style={{ flex: 1, alignItems: "center", paddingVertical: 2, borderRadius: 5, backgroundColor: ui.tab === tab ? c.surface0 : undefined }}
            >
              <T size={12} weight="500" color={ui.tab === tab ? c.foreground : c.foregroundMuted}>
                {label}
              </T>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add an item"
          disabled={!canAdd}
          onPress={() => set((now) => ({ adding: !now.adding, addParent: null }))}
          style={{ opacity: canAdd ? 1 : 0.4 }}
        >
          <Icon name="Plus" size={15} />
        </Pressable>
      </View>
      {/* Project and Session follow the sessions beside the board; Global sees everything
          and can be narrowed to one project or one driver. */}
      <View style={{ flexDirection: "row", marginTop: 5, minHeight: 18 }}>
        {ui.tab === "global" && (
          <Select value={ui.filter} options={filterOptions(m)} onChange={(filter) => set(() => ({ filter }))} />
        )}
        {ui.tab === "project" && (
          <T size={12} lines={1} color={c.foregroundMuted}>
            {f.projects.length ? f.projects.map(projectPath).join(", ") : "no project here"}
          </T>
        )}
        {ui.tab === "session" && (
          <T size={12} lines={1} color={c.foregroundMuted}>
            {f.sessions.length ? f.sessions.map((s) => "@" + m.whoName(s)).join(", ") : "no session here"}
          </T>
        )}
      </View>
    </View>
  );
}

function AddForm({ onAdd }: { onAdd: (title: string, project: string) => void }) {
  const { c, m, ui, set } = useBoard();
  const parent = ui.addParent ? m.byId[ui.addParent] : null;
  const projects = Object.values(m.board.projects);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState(
    () => m.focus.projects.find((path) => projects.some((p) => p.path === path)) ?? projects[0].path,
  );
  const project = parent ? parent.project : ui.tab === "global" ? picked : m.focus.projects[0];
  const close = () => set(() => ({ adding: false, addParent: null }));
  return (
    <View style={{ gap: 6, padding: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Tint color={c.foreground} opacity={0.04} />
      {parent && (
        <T lines={1} color={c.foregroundMuted}>
          {"under: " + parent.title}
        </T>
      )}
      <TextInput
        autoFocus
        value={title}
        onChangeText={setTitle}
        placeholder={parent ? "New step, Enter to add, Esc to close" : "New item, Enter to add, Esc to close"}
        placeholderTextColor={c.foregroundMuted}
        submitBehavior="submit"
        onSubmitEditing={() => {
          if (!title.trim()) return;
          onAdd(title.trim(), project);
          setTitle("");
        }}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === "Escape") close();
        }}
        style={[controlStyle(c), { fontSize: 11, color: c.foreground }]}
      />
      {ui.tab === "global" && !parent && (
        <View style={{ flexDirection: "row" }}>
          <Select value={picked} options={projects.map((p) => ({ value: p.path, label: p.name }))} onChange={setPicked} />
        </View>
      )}
    </View>
  );
}
