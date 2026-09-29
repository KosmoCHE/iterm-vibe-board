"use strict";

const TOKEN = new URLSearchParams(location.search).get("token") || "";
const $ = (sel) => document.querySelector(sel);
const UNDO_DEPTH = 20;

const state = {
  board: null,
  version: null,
  tab: localStorage.getItem("vibing.tab") || "global",
  fold: JSON.parse(localStorage.getItem("vibing.fold") || "{}"),
  pickedPane: localStorage.getItem("vibing.pane") || "", // browser preview only
  byId: {},
  children: {},
  selected: null, // pinned in the inspector
  hovered: null, // previewed in the inspector while nothing is pinned
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
    const { version } = await api("/api/version");
    if (version !== state.version) {
      state.board = await api("/api/board");
      state.version = version;
      state.error = "";
      render();
    }
  } catch (e) {
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

async function undo() {
  const last = state.undo.pop();
  if (!last) return;
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
  const b = state.board;
  if (b.focus.pane) return b.focus;
  const pane = b.panes[state.pickedPane];
  if (!pane || pane.ended_at) return { pane: state.pickedPane || null, session: null, project: null };
  return { pane: pane.pane, session: pane.session, project: pane.project };
}

function scopeItems() {
  const f = focus();
  const all = state.board.items;
  if (state.tab === "global") return all;
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

function driverOptions() {
  const b = state.board;
  const options = [["", "unassigned"], [b.me, "me"]];
  Object.values(b.panes)
    .filter((p) => p.session && !p.ended_at)
    .forEach((p) => options.push([p.session, whoName(p.session)]));
  return options;
}

function progress(id) {
  const out = { total: 0, plan_done: 0, plan_total: 0, incidents: 0, inserts: 0 };
  const stack = [...(state.children[id] || [])];
  while (stack.length) {
    const it = stack.pop();
    out.total++;
    if (it.origin === "plan") {
      out.plan_total++;
      if (it.status === "done") out.plan_done++;
    } else if (it.origin === "incident") out.incidents++;
    else out.inserts++;
    stack.push(...(state.children[it.id] || []));
  }
  return out;
}

function isOpen(id) {
  const key = state.tab + ":" + id;
  return key in state.fold ? state.fold[key] : state.tab !== "global";
}

function typing() {
  const a = document.activeElement;
  return a && (a.classList.contains("edit") || $("#inspector").contains(a));
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
      tree.append(el("h2", "project", projectName(project)));
      byProject[project].forEach((i) => tree.append(...rows(i, kids, 0)));
    }
  } else roots.forEach((i) => tree.append(...rows(i, kids, 0)));

  renderAdd();
  renderInspector();
  renderStatus();
}

function emptyText() {
  const f = focus();
  if (state.tab === "global") return Object.keys(state.board.projects).length ? "Nothing on the board." : "No items yet. Start a session in a project, then add items here.";
  if (state.tab === "project") return f.project ? "Nothing in this project yet." : "Focus a pane that runs a session.";
  return f.session ? "This session pushes nothing yet." : "Focus a pane that runs a session.";
}

function renderTabs() {
  document.querySelectorAll(".tabs button").forEach((btn) => btn.classList.toggle("on", btn.dataset.tab === state.tab));
}

function renderScope() {
  const b = state.board;
  const f = focus();
  const s = $("#scope");
  s.replaceChildren();
  if (!b.focus.pane) {
    // No iTerm2 script pushing focus (browser preview): let the user pick a pane.
    const sel = el("select");
    const none = el("option", "", "pick a pane…");
    none.value = "";
    sel.append(none);
    Object.values(b.panes).forEach((p) => {
      const o = el("option", "", whoName(p.session || p.pane) + (p.alive ? "" : " (gone)"));
      o.value = p.pane;
      sel.append(o);
    });
    sel.value = state.pickedPane;
    sel.onchange = () => {
      state.pickedPane = sel.value;
      localStorage.setItem("vibing.pane", sel.value);
      render();
    };
    s.append(sel);
  }
  if (state.tab === "project") s.append(el("span", "where", f.project ? projectName(f.project) : "no project for this pane"));
  if (state.tab === "session") s.append(el("span", "where", f.session ? whoName(f.session) : "no session in this pane"));
}

function rows(item, kids, depth) {
  const children = kids[item.id] || [];
  const out = [row(item, depth, children.length)];
  if (children.length && isOpen(item.id)) children.forEach((c) => out.push(...rows(c, kids, depth + 1)));
  return out;
}

function row(item, depth, nChildren) {
  const b = state.board;
  const r = el("div", "row" + (item.status === "done" ? " done" : "") + (item.id === state.selected ? " selected" : ""));
  r.dataset.id = item.id;
  r.style.setProperty("--depth", depth);
  const line = el("div", "line");

  const caret = el("button", "caret", nChildren ? (isOpen(item.id) ? "▾" : "▸") : "");
  caret.disabled = !nChildren;
  caret.onclick = () => {
    state.fold[state.tab + ":" + item.id] = !isOpen(item.id);
    localStorage.setItem("vibing.fold", JSON.stringify(state.fold));
    render();
  };

  const box = el("input", "box");
  box.type = "checkbox";
  box.checked = item.status === "done";
  box.onchange = () => patch(item.id, { status: box.checked ? "done" : "todo" });

  const num = el("span", "num", "#" + item.num);
  const title = el("span", "title", item.title);
  title.ondblclick = () => editTitle(title, item);

  const badges = el("span", "badges");
  if (item.origin === "incident") badges.append(el("span", "badge incident", "⚡"));
  if (item.origin === "insert") badges.append(el("span", "badge insert", "+"));
  if (item.status !== "todo" && item.status !== "done") {
    const label = b.labels[item.status] + (item.status === "waiting" && item.waiting_for ? ": " + item.waiting_for : "");
    badges.append(el("span", "badge status " + item.status, label));
  }
  const p = progress(item.id);
  if (p.total) {
    let s = `${p.plan_done}/${p.plan_total}`;
    if (p.incidents) s += ` ⚡${p.incidents}`;
    if (p.inserts) s += ` +${p.inserts}`;
    badges.append(el("span", "badge progress", s));
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

  line.append(caret, box, num, title, badges);
  line.onclick = (e) => {
    if (e.target.closest("button, input, select")) return;
    select(state.selected === item.id ? null : item.id);
  };
  r.append(line);
  if (state.tab === "session" && (item.next || item.waiting_for)) {
    const detail = el("div", "detail");
    if (item.next) detail.append(el("span", "", "next: " + item.next));
    if (item.waiting_for) detail.append(el("span", "", "waiting: " + item.waiting_for));
    r.append(detail);
  }
  r.onmouseenter = () => {
    state.hovered = item.id;
    if (!state.selected) renderInspector();
  };
  r.onmouseleave = () => {
    state.hovered = null;
    if (!state.selected) renderInspector();
  };
  return r;
}

function select(id) {
  state.selected = id;
  document.querySelectorAll(".row").forEach((x) => x.classList.toggle("selected", x.dataset.id === id));
  renderInspector();
}

function driverChip(item) {
  const pane = paneOf(item.driver);
  const alive = pane && pane.alive;
  const name = whoName(item.driver);
  const chip = el("button", "badge driver" + (pane && !alive ? " ended" : ""), name);
  chip.title = name + (alive ? " — jump to this pane" : " — this session is gone; pick another driver below");
  chip.onclick = () => {
    if (alive) api("/api/jump", { method: "POST", body: JSON.stringify({ pane: pane.pane }) }).catch(showError);
    else {
      select(item.id);
      const d = $("#insp-driver");
      if (d) d.focus();
    }
  };
  return chip;
}

function editTitle(span, item) {
  const input = el("input", "edit");
  input.value = item.title;
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (save && value && value !== item.title) patch(item.id, { title: value });
    else render();
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  };
  input.onblur = () => finish(true);
  span.replaceWith(input);
  input.focus();
  input.select();
}

// --- inspector: hover previews, click pins, pinned is editable -------------------

function renderInspector() {
  const box = $("#inspector");
  const id = state.selected || state.hovered;
  const item = id && state.byId[id];
  if (!item) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  if (box.contains(document.activeElement)) return;
  const preview = !state.selected;
  box.className = "inspector" + (preview ? " preview" : "");
  box.replaceChildren();

  const head = el("div", "head");
  head.append(el("b", "", `#${item.num} ${item.title}`), el("span", "meta", `${item.origin} · by ${whoName(item.created_by)} · ${projectName(item.project)}`));
  head.title = "id " + item.id;
  box.append(head);

  if (preview) {
    if (item.next) box.append(field("Next", el("span", "", item.next)));
    if (item.waiting_for) box.append(field("Waiting for", el("span", "", item.waiting_for)));
    if (item.due) box.append(field("Due", el("span", "", item.due)));
    if (!item.next && !item.waiting_for && !item.due) box.append(el("div", "meta", "Click the row to pin and edit."));
  } else {
    const b = state.board;
    box.append(field("Status", choice(b.statuses.map((s) => [s, b.labels[s]]), item.status, (v) => patch(item.id, { status: v }))));
    box.append(field("Driver", choice(driverOptions(), item.driver || "", (v) => patch(item.id, { driver: v || null }), "insp-driver")));
    box.append(field("Next", text(item.next, (v) => patch(item.id, { next: v }))));
    box.append(field("Waiting for", text(item.waiting_for, (v) => patch(item.id, { waiting_for: v }))));
    box.append(field("Due", date(item.due, (v) => patch(item.id, { due: v || null }))));
  }
  box.hidden = false;
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
  sel.hidden = state.tab !== "global";
  $("#add").hidden = state.tab === "global" ? !Object.keys(b.projects).length : !f.project;
}

function renderStatus() {
  const s = $("#status");
  s.textContent = state.error || state.notice;
  s.className = state.error ? "error" : "";
  $("#undo").hidden = !state.undo.length;
}

// --- wiring ---------------------------------------------------------------------

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.onclick = () => {
    state.tab = btn.dataset.tab;
    localStorage.setItem("vibing.tab", state.tab);
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
  if (e.key === "Escape" && !inField && state.selected) select(null);
});

$("#add").onsubmit = (e) => {
  e.preventDefault();
  const f = focus();
  const title = $("#add-title").value.trim();
  if (!title) return;
  const project = state.tab === "global" ? $("#add-project").value : f.project;
  if (!project) return showError(new Error("pick a project first"));
  const body = {
    title,
    project,
    origin: $("#add-origin").value,
    created_by: state.board.me,
    driver: state.tab === "session" ? f.session : null,
  };
  api("/api/items", { method: "POST", body: JSON.stringify(body) })
    .then(() => {
      $("#add-title").value = "";
      setNotice(`Added “${title}”`);
      poll();
    })
    .catch(showError);
};

poll();
setInterval(poll, 1000);
