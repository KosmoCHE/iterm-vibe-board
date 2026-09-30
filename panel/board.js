"use strict";

const TOKEN = new URLSearchParams(location.search).get("token") || "";
const $ = (sel) => document.querySelector(sel);
const UNDO_DEPTH = 20;

const state = {
  board: null,
  version: null,
  tab: localStorage.getItem("vibeboard.tab") || "global",
  fold: JSON.parse(localStorage.getItem("vibeboard.fold") || "{}"),
  byId: {},
  children: {},
  selected: null, // shown in the inspector
  editing: false, // the inspector shows controls instead of text
  adding: false, // the add form is open (the + at the top right)
  addParent: null, // item the add form adds a step under (from the context menu)
  showDone: {}, // "tab:key": true when that level's done items are unfolded
  menu: null, // item the context menu is open for
  filter: "", // Global only: "" | "project:<path>" | "who:<session>"
  down: false, // the server was unreachable; reload when it is back to pick up new assets
  assets: null, // version of the panel files the page was loaded with
  undo: [],
  error: "",
  notice: "",
};

// --- server -----------------------------------------------------------------

function api(path, options = {}) {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(path + sep + "token=" + encodeURIComponent(TOKEN), {
    headers: { "Content-Type": "application/json" },
    ...options,
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  });
}

async function poll() {
  try {
    const { version, assets, focus } = await api("/api/version");
    if (state.down) return location.reload();
    if (state.assets && assets !== state.assets) return location.reload(); // panel files changed
    state.assets = assets;
    if (version !== state.version || focus !== state.focusPane) { // data on disk or the focused pane
      state.board = await api("/api/board");
      state.version = version;
      state.focusPane = focus;
      state.error = "";
      render();
    }
  } catch (e) {
    if (e instanceof TypeError) state.down = true; // network failure: the server is away
    showError(e);
  }
}

async function patch(id, fields, undoable = true) {
  const before = state.byId[id];
  try {
    await api("/api/items/" + id, { method: "PATCH", body: JSON.stringify(fields) });
    if (undoable && before) {
      const previous = {};
      for (const key of Object.keys(fields)) previous[key] = before[key];
      state.undo.push({ id, fields: previous, title: before.title });
      if (state.undo.length > UNDO_DEPTH) state.undo.shift();
      setNotice(`Changed “${before.title}”`);
    }
    await poll();
  } catch (e) {
    showError(e);
  }
}

// Delete is archive: the files move aside, and ⌘Z brings them back.
async function remove(item) {
  try {
    const ids = await api(`/api/items/${item.id}/archive`, { method: "POST" });
    state.undo.push({ id: item.id, restore: true, title: item.title });
    if (state.undo.length > UNDO_DEPTH) state.undo.shift();
    if (state.selected === item.id) select(null);
    setNotice(`Deleted “${item.title}”` + (ids.length > 1 ? ` and ${ids.length - 1} steps` : "") + " — ⌘Z to undo");
    await poll();
  } catch (e) {
    showError(e);
  }
}

async function undo() {
  const last = state.undo.pop();
  if (!last) return;
  if (last.restore) {
    await api(`/api/items/${last.id}/restore`, { method: "POST" }).then(poll, showError);
    setNotice(`Restored “${last.title}”`);
    return;
  }
  await patch(last.id, last.fields, false);
  setNotice(`Undid the change to “${last.title}”`);
}

function showError(e) {
  state.error = e.message || String(e);
  renderStatus();
}

function setNotice(text) {
  state.notice = text;
  state.error = "";
  renderStatus();
}

// --- model helpers ------------------------------------------------------------

function focus() {
  return state.board.focus;
}

function scopeItems() {
  const f = focus();
  const all = state.board.items;
  if (state.tab === "global") {
    const [kind, value] = state.filter.split(/:(.*)/s);
    if (kind === "project") return all.filter((i) => i.project === value);
    if (kind === "who") return all.filter((i) => i.driver === value);
    return all;
  }
  if (state.tab === "project") return f.project ? all.filter((i) => i.project === f.project) : [];
  return f.session ? all.filter((i) => i.driver === f.session) : [];
}

function paneOf(who) {
  const b = state.board;
  if (b.panes[who]) return b.panes[who];
  return Object.values(b.panes).find((p) => p.session === who) || null;
}

function whoName(who) {
  if (!who) return "";
  if (who === state.board.me) return "me";
  const pane = paneOf(who);
  const raw = pane && pane.name ? pane.name : who.slice(0, 8);
  return raw.replace(/^[^\w一-鿿]+\s*/, "").replace(/\s*\((claude|codex)\)$/, "");
}

function projectName(path) {
  const p = Object.values(state.board.projects).find((x) => x.path === path);
  return p ? p.name : path.split("/").pop();
}

function projectPath(path) {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

function driverOptions() {
  const b = state.board;
  const options = [["", "no session"]];
  Object.values(b.panes)
    .filter((p) => p.session && !p.ended_at)
    .forEach((p) => options.push([p.session, whoName(p.session)]));
  return options;
}

function progress(id) {
  // Per origin over direct children: {origin: [done, total]}.
  const out = {};
  for (const origin of state.board.origins) out[origin] = [0, 0];
  for (const it of state.children[id] || []) {
    out[it.origin][1]++;
    if (it.status === "done") out[it.origin][0]++;
  }
  return out;
}

const PROGRESS_MARK = { plan: "●", issue: "⚡", added: "+" };
const PROGRESS_WORDS = { plan: "planned", issue: "issues", added: "added" };

function isOpen(id) {
  const key = state.tab + ":" + id;
  return key in state.fold ? state.fold[key] : state.tab !== "global";
}

function typing() {
  return $("#inspector").contains(document.activeElement);
}

// --- rendering ------------------------------------------------------------------

function el(tag, cls = "", text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function render() {
  if (typing()) return; // never rebuild under the cursor
  const b = state.board;
  state.byId = Object.fromEntries(b.items.map((i) => [i.id, i]));
  state.children = {};
  for (const it of b.items) if (it.parent) (state.children[it.parent] = state.children[it.parent] || []).push(it);
  if (state.selected && !state.byId[state.selected]) state.selected = null;

  renderTabs();
  renderScope();

  const items = scopeItems();
  const inScope = new Set(items.map((i) => i.id));
  const kids = {};
  for (const it of items) {
    const key = it.parent && inScope.has(it.parent) ? it.parent : "root";
    (kids[key] = kids[key] || []).push(it);
  }
  for (const k in kids) kids[k].sort((x, y) => x.created_at.localeCompare(y.created_at));

  const tree = $("#tree");
  tree.replaceChildren();
  const roots = kids.root || [];
  if (!roots.length) tree.append(el("p", "empty", emptyText()));
  else if (state.tab === "global") {
    const byProject = {};
    roots.forEach((i) => (byProject[i.project] = byProject[i.project] || []).push(i));
    for (const project of Object.keys(byProject).sort()) {
      const h = el("h2", "project", projectName(project));
      h.append(" ", el("span", "path", projectPath(project)));
      tree.append(h);
      tree.append(...list(byProject[project], "root:" + project, 0, kids));
    }
  } else tree.append(...list(roots, "root", 0, kids));

  renderAdd();
  renderInspector();
  renderStatus();
}

function emptyText() {
  const f = focus();
  if (state.tab === "global") {
    if (state.filter) return "Nothing here for this filter.";
    return Object.keys(state.board.projects).length ? "Nothing on the board." : "No items yet. Start a session in a project, then add items here.";
  }
  if (state.tab === "project") return f.project ? "Nothing in this project yet." : "Focus a pane that runs a session.";
  return f.session ? "This session pushes nothing yet." : "Focus a pane that runs a session.";
}

function renderTabs() {
  document.querySelectorAll(".tabs button").forEach((btn) => btn.classList.toggle("on", btn.dataset.tab === state.tab));
}

function renderScope() {
  // Project and Session are bound to the focused pane, like iTerm2's Notes; Global sees
  // everything and can be narrowed to one project or one driver.
  const s = $("#scope");
  s.replaceChildren();
  if (state.tab === "global") {
    s.append(filterSelect());
    return;
  }
  const f = focus();
  if (state.tab === "project") s.append(el("span", "where", f.project ? projectPath(f.project) : "no project here"));
  if (state.tab === "session") s.append(el("span", "where", f.session ? "@" + whoName(f.session) : "no session here"));
}

function filterSelect() {
  const b = state.board;
  const sel = el("select");
  sel.append(new Option("everything", ""));
  const projects = el("optgroup");
  projects.label = "Projects";
  Object.values(b.projects)
    .sort((x, y) => x.name.localeCompare(y.name))
    .forEach((p) => projects.append(new Option(`${p.name} — ${projectPath(p.path)}`, "project:" + p.path)));
  const who = el("optgroup");
  who.label = "Sessions";
  const panes = Object.values(b.panes).filter((p) => p.session);
  panes.sort((x, y) => (y.alive - x.alive) || whoName(x.session).localeCompare(whoName(y.session)));
  panes.forEach((p) => who.append(new Option("@" + whoName(p.session) + (p.alive ? "" : " (gone)"), "who:" + p.session)));
  sel.append(projects, who);
  sel.value = state.filter;
  if (sel.value !== state.filter) state.filter = sel.value = ""; // what it pointed at is gone
  sel.onchange = () => {
    state.filter = sel.value;
    render();
  };
  return sel;
}

function rows(item, kids, depth) {
  const children = kids[item.id] || [];
  const out = [row(item, depth, children.length)];
  if (children.length && isOpen(item.id)) out.push(...list(children, item.id, depth + 1, kids));
  return out;
}

// One level of the tree: the done items first, folded into a tinted block, then the open ones.
function list(items, key, depth, kids) {
  const done = items.filter((i) => i.status === "done");
  const out = [];
  if (done.length) {
    const k = state.tab + ":" + key;
    out.push(doneFold(done.length, k, depth));
    if (state.showDone[k]) done.forEach((i) => out.push(...rows(i, kids, depth)));
  }
  items.filter((i) => i.status !== "done").forEach((i) => out.push(...rows(i, kids, depth)));
  return out;
}

function doneFold(n, key, depth) {
  const r = el("div", "row fold");
  r.style.setProperty("--depth", depth);
  const line = el("div", "line");
  line.append(el("span"), el("span", "", `${state.showDone[key] ? "Hide" : "Show"} ${n} done`));
  line.onclick = () => {
    state.showDone[key] = !state.showDone[key];
    render();
  };
  r.append(line);
  return r;
}

function row(item, depth, nChildren) {
  const b = state.board;
  const r = el("div", "row" + (item.status === "done" ? " done" : "") + (item.id === state.selected ? " selected" : ""));
  r.dataset.id = item.id;
  r.style.setProperty("--depth", depth);
  const line = el("div", "line");

  const caret = el("button", "caret" + (nChildren && isOpen(item.id) ? " open" : ""));
  caret.disabled = !nChildren;
  caret.onclick = () => {
    state.fold[state.tab + ":" + item.id] = !isOpen(item.id);
    localStorage.setItem("vibeboard.fold", JSON.stringify(state.fold));
    render();
  };

  const box = el("input", "box");
  box.type = "checkbox";
  box.checked = item.status === "done";
  box.onchange = () => patch(item.id, { status: box.checked ? "done" : "todo" });

  const num = el("span", "num", "#" + item.num);
  const title = el("span", "title", item.title);

  const badges = el("span", "badges");
  if (item.origin === "issue") badges.append(el("span", "badge issue", "⚡"));
  if (item.origin === "added") badges.append(el("span", "badge added", "+"));
  if (item.status !== "todo" && item.status !== "done") {
    const label = b.labels[item.status] + (item.status === "waiting" && item.waiting_for ? ": " + item.waiting_for : "");
    badges.append(el("span", "badge status " + item.status, label));
  }
  const p = progress(item.id);
  const parts = Object.entries(p).filter(([, [, total]]) => total);
  if (parts.length) {
    const progressBadge = el("span", "badge progress", parts.map(([o, [d, t]]) => `${PROGRESS_MARK[o]}${d}/${t}`).join(" · "));
    progressBadge.title = parts.map(([o, [d, t]]) => `${PROGRESS_WORDS[o]} ${d} of ${t} ${o === "issue" ? "resolved" : "done"}`).join(" · ");
    badges.append(progressBadge);
  }
  for (const dep of item.depends_on) {
    const d = state.byId[dep];
    if (!d || d.status === "done") continue;
    const badge = el("span", "badge dep", "⏳ " + (d.project !== item.project ? projectName(d.project) + " " : "") + "#" + d.num);
    badge.title = "waits for: " + d.title;
    badges.append(badge);
  }
  if (item.driver) badges.append(driverChip(item));
  if (item.created_by !== b.me && item.created_by !== item.driver) {
    const from = el("span", "badge from", "from " + whoName(item.created_by));
    from.title = "created by " + whoName(item.created_by);
    badges.append(from);
  }

  const content = el("div", "content"); // title and badges share a column, so wrapped badges stay aligned
  content.append(title, badges);
  if (state.tab === "session" && (item.next || item.waiting_for)) {
    const detail = el("div", "detail");
    if (item.next) detail.append(el("span", "next", "next: " + item.next));
    if (item.waiting_for) detail.append(el("span", "waiting", "waiting: " + item.waiting_for));
    content.append(detail);
  }
  line.append(caret, box, num, content);
  // Click shows or hides the details, double-click edits. The click waits a beat so a
  // double-click does not open and close the details on its way in.
  let pending = null;
  line.onclick = (e) => {
    if (e.target.closest("button, input, select")) return;
    clearTimeout(pending);
    pending = setTimeout(() => select(state.selected === item.id ? null : item.id), 220);
  };
  line.ondblclick = (e) => {
    if (e.target.closest("button, input, select")) return;
    clearTimeout(pending);
    select(item.id, true);
  };
  r.oncontextmenu = (e) => {
    e.preventDefault();
    openMenu(item, e.clientX, e.clientY);
  };
  r.append(line);
  return r;
}

// --- context menu: the few actions a right-click on a row offers ---

function openMenu(item, x, y) {
  const m = $("#menu");
  m.replaceChildren();
  const action = (label, fn) => {
    const b = el("button", "", label);
    b.onclick = () => {
      closeMenu();
      fn();
    };
    m.append(b);
  };
  action(`Add a step under #${item.num}`, () => openAdd(true, item.id));
  action(`Delete #${item.num}`, () => remove(item));
  state.menu = item.id;
  m.hidden = false;
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + "px";
}

function closeMenu() {
  state.menu = null;
  $("#menu").hidden = true;
}

function select(id, edit = false) {
  state.selected = id;
  state.editing = edit;
  document.querySelectorAll(".row").forEach((x) => x.classList.toggle("selected", x.dataset.id === id));
  renderInspector();
  const row = id && document.querySelector(`.row[data-id="${id}"]`);
  if (row) row.scrollIntoView({ block: "nearest" }); // the inspector just took space below
}

function driverChip(item) {
  const pane = paneOf(item.driver);
  const alive = pane && pane.alive;
  const name = "@" + whoName(item.driver);
  const chip = el("button", "badge driver" + (pane && !alive ? " ended" : ""), name);
  chip.title = name + (alive ? " — jump to this pane" : " — this session is gone; pick another driver below");
  chip.onclick = () => {
    if (alive) api("/api/jump", { method: "POST", body: JSON.stringify({ pane: pane.pane }) }).catch(showError);
    else {
      select(item.id, true);
      const d = $("#insp-driver");
      if (d) d.focus();
    }
  };
  return chip;
}

// --- inspector: click shows the selected item, double-click (or Edit) makes it editable ---

function renderInspector() {
  const box = $("#inspector");
  const item = state.selected && state.byId[state.selected];
  if (!item) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  if (box.contains(document.activeElement)) return;
  box.replaceChildren();

  const b = state.board;
  const head = el("div", "head");
  const meta = el("span", "meta", `${item.origin} · by @${whoName(item.created_by)} · ${projectPath(item.project)}`);
  const toggle = el("button", "toggle", state.editing ? "Done" : "Edit");
  toggle.onclick = () => select(item.id, !state.editing);
  const close = el("button", "close", "×");
  close.title = "Close (Esc)";
  close.onclick = () => select(null);
  head.append(el("b", "", `#${item.num} ${item.title}`), meta, toggle, close);
  head.title = "id " + item.id;
  box.append(head);

  if (state.editing) {
    box.append(field("Title", text(item.title, (v) => v && patch(item.id, { title: v }))));
    box.append(field("Description", textarea(item.description, (v) => patch(item.id, { description: v }))));
    box.append(field("Status", choice(b.statuses.map((s) => [s, b.labels[s]]), item.status, (v) => patch(item.id, { status: v }))));
    box.append(field("Driver", choice(driverOptions(), item.driver || "", (v) => patch(item.id, { driver: v || null }), "insp-driver")));
    box.append(field("Next", text(item.next, (v) => patch(item.id, { next: v }))));
    box.append(field("Waiting for", text(item.waiting_for, (v) => patch(item.id, { waiting_for: v }))));
    box.append(field("Due", date(item.due, (v) => patch(item.id, { due: v || null }))));
  } else {
    if (item.description) box.append(el("div", "desc", item.description));
    box.append(field("Status", el("span", "status " + item.status, b.labels[item.status])));
    box.append(field("Created", el("span", "", when(item.created_at))));
    if (item.started_at) box.append(field("Started", el("span", "", when(item.started_at))));
    if (item.done_at) box.append(field("Done", el("span", "", when(item.done_at))));
    box.append(field("Driver", el("span", item.driver ? "driver" : "", item.driver ? "@" + whoName(item.driver) : "no session")));
    if (item.next) box.append(field("Next", el("span", "next", item.next)));
    if (item.waiting_for) box.append(field("Waiting for", el("span", "waiting", item.waiting_for)));
    if (item.due) box.append(field("Due", el("span", "", item.due)));
  }
  box.hidden = false;
}

function when(iso) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function field(label, control) {
  const f = el("div", "field");
  f.append(el("label", "", label), control);
  return f;
}

function choice(options, value, onChange, id) {
  const sel = el("select");
  if (id) sel.id = id;
  options.forEach(([v, text]) => {
    const o = el("option", "", text);
    o.value = v;
    o.selected = v === value;
    sel.append(o);
  });
  sel.onchange = () => {
    sel.blur(); // so the next render is not blocked by a focused control
    onChange(sel.value);
  };
  return sel;
}

function textarea(value, onCommit) {
  const area = el("textarea");
  area.value = value || "";
  area.rows = Math.min(8, Math.max(3, (value || "").split("\n").length + 1));
  area.onkeydown = (e) => {
    if (e.key === "Enter" && e.metaKey) area.blur();
    if (e.key === "Escape") {
      area.value = value || "";
      area.blur();
    }
  };
  area.onblur = () => {
    if (area.value.trim() !== (value || "")) onCommit(area.value.trim());
  };
  return area;
}

function text(value, onCommit) {
  const input = el("input");
  input.value = value || "";
  const commit = () => {
    if (input.value.trim() !== (value || "")) onCommit(input.value.trim());
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.value = value || "";
      input.blur();
    }
  };
  input.onblur = commit;
  return input;
}

function date(value, onCommit) {
  const input = el("input");
  input.type = "date";
  input.value = value || "";
  input.onchange = () => {
    input.blur();
    onCommit(input.value);
  };
  return input;
}

function renderAdd() {
  const b = state.board;
  const f = focus();
  const sel = $("#add-project");
  sel.replaceChildren();
  Object.values(b.projects).forEach((p) => {
    const o = el("option", "", p.name);
    o.value = p.path;
    sel.append(o);
  });
  if (f.project) sel.value = f.project;
  const parent = state.addParent && state.byId[state.addParent];
  if (parent) sel.value = parent.project;
  sel.hidden = state.tab !== "global" || Boolean(parent);
  const under = $("#add-under");
  under.hidden = !parent;
  under.textContent = parent ? `under #${parent.num} ${parent.title}` : "";
  $("#add-title").placeholder = parent ? "New step, Enter to add, Esc to close" : "New item, Enter to add, Esc to close";
  const possible = state.tab === "global" ? Object.keys(b.projects).length > 0 : Boolean(f.project);
  $("#plus").disabled = !possible;
  $("#add").hidden = !(state.adding && possible);
}

function openAdd(open, parent = null) {
  state.adding = open;
  state.addParent = open ? parent : null;
  renderAdd();
  if (open) $("#add-title").focus();
}

function renderStatus() {
  const s = $("#status");
  s.textContent = state.error || state.notice;
  s.className = state.error ? "error" : "";
  $("#undo").hidden = !state.undo.length;
  $("#footer").hidden = !(state.error || state.notice || state.undo.length);
}

// --- wiring ---------------------------------------------------------------------

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.onclick = () => {
    state.tab = btn.dataset.tab;
    localStorage.setItem("vibeboard.tab", state.tab);
    state.selected = null;
    if (state.board) render();
  };
});

$("#undo").onclick = undo;

document.addEventListener("keydown", (e) => {
  const inField = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement && document.activeElement.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key === "z" && !inField) {
    e.preventDefault();
    undo();
  }
  if (e.key === "Escape" && !inField && state.selected) select(state.editing ? state.selected : null);
});

$("#plus").onclick = () => openAdd(!state.adding);
$("#add-title").onkeydown = (e) => {
  if (e.key === "Escape") openAdd(false);
};
document.addEventListener("mousedown", (e) => {
  if (state.adding && !e.target.closest("#add, #plus")) openAdd(false);
  if (state.menu && !e.target.closest("#menu")) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.menu) closeMenu();
});

$("#add").onsubmit = (e) => {
  e.preventDefault();
  const f = focus();
  const title = $("#add-title").value.trim();
  if (!title) return;
  const parent = state.addParent;
  const project = parent ? state.byId[parent].project : state.tab === "global" ? $("#add-project").value : f.project;
  if (!project) return showError(new Error("pick a project first"));
  const body = {
    title,
    project,
    parent,
    origin: "plan",
    created_by: state.board.me,
    driver: state.tab === "session" ? f.session : null,
  };
  api("/api/items", { method: "POST", body: JSON.stringify(body) })
    .then(() => {
      if (parent) state.fold[state.tab + ":" + parent] = true; // show what was just added
      $("#add-title").value = "";
      setNotice(`Added “${title}”`);
      poll();
    })
    .catch(showError);
};

poll();
setInterval(poll, 1000);
