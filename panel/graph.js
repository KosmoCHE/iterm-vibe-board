"use strict";

function graphScopeKey() {
  const f = focus();
  return state.tab + ":" + (state.tab === "global" ? state.filter : state.tab === "project" ? f.project : f.session);
}

function graphLayers(items, dependencies) {
  const pending = new Set(items.map((item) => item.id));
  const layers = [];
  while (pending.size) {
    const ready = items.filter((item) => pending.has(item.id) && ![...dependencies.get(item.id)].some((id) => pending.has(id)));
    if (!ready.length) return { layers, unresolved: items.filter((item) => pending.has(item.id)) };
    layers.push(ready);
    ready.forEach((item) => pending.delete(item.id));
  }
  return { layers, unresolved: [] };
}

function graphFlows(items, dependencies) {
  const neighbors = new Map(items.map((item) => [item.id, new Set()]));
  for (const item of items) for (const id of dependencies.get(item.id)) {
    if (!neighbors.has(id)) continue;
    neighbors.get(item.id).add(id);
    neighbors.get(id).add(item.id);
  }
  const seen = new Set(), flows = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    const ids = new Set([item.id]);
    for (const id of ids) {
      seen.add(id);
      for (const neighbor of neighbors.get(id)) ids.add(neighbor);
    }
    flows.push(graphLayers(items.filter((entry) => ids.has(entry.id)), dependencies));
  }
  return flows;
}

function graphOpenKey(id) {
  return graphScopeKey() + ":" + id;
}

function saveGraphOpen() {
  localStorage.setItem("vibeboard.graphOpen", JSON.stringify(state.graphOpen));
}

function revealGraphItem(item) {
  const task = scopeItems().find((i) => i.id === item.parent) || item;
  state.graphOpen[graphOpenKey(task.id)] = true;
  if (task.status === "done") state.graphDone[graphScopeKey()] = true;
  if (task !== item && item.status === "done") state.showDone[state.tab + ":" + task.id] = true;
  saveGraphOpen();
}

function graphDoneFold(count, key, folds = state.graphDone) {
  const open = folds[key];
  const button = el("button", "graph-done");
  button.append(icon(open ? "ChevronDown" : "ChevronRight"), `${open ? "Hide" : "Show"} ${count} done`);
  button.setAttribute("aria-expanded", Boolean(open));
  button.onclick = () => { folds[key] = !open; render(); };
  return button;
}

function renderGraph(items) {
  const graph = $("#graph");
  graph.replaceChildren();
  const kids = scopedChildren(items);
  const tasks = kids.root || [];
  if (state.selected && !items.some((item) => item.id === state.selected)) state.selected = null;
  if (!tasks.length) { graph.append(el("p", "empty", emptyText())); return; }
  const { done, active } = levelItems(tasks);
  if (done.length) graph.append(graphDoneFold(done.length, graphScopeKey()));
  let visible = state.graphDone[graphScopeKey()] ? [...done, ...active] : active;
  if (state.tab === "global") {
    visible = [...new Set(visible.map((item) => item.project))].sort()
      .flatMap((project) => visible.filter((item) => item.project === project));
  }
  // A new scope opens one active task; explicit folds survive refreshes.
  if (!visible.some((item) => graphOpenKey(item.id) in state.graphOpen)) {
    const first = visible.find((item) => (kids[item.id] || []).some((step) => step.status !== "done"));
    visible.forEach((item) => { state.graphOpen[graphOpenKey(item.id)] = item === first; });
  }
  const taskDeps = new Map(visible.map((task) => [task.id, new Set()]));
  const owners = new Map(items.map((item) => [item.id, taskDeps.has(item.parent) ? item.parent : item.id]));
  // Cross-task step links also keep their groups together. Only original links are drawn.
  for (const item of items) {
    const target = owners.get(item.id);
    if (!taskDeps.has(target)) continue;
    for (const dep of item.depends_on) {
      const source = owners.get(dep);
      if (source !== target && taskDeps.has(source)) taskDeps.get(target).add(source);
    }
  }
  const network = el("div", "graph-network");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("graph-edges");
  svg.setAttribute("aria-hidden", "true");
  network.append(svg);
  const forest = el("div", "graph-forest");
  for (const { layers, unresolved } of graphFlows(visible, taskDeps)) {
    const flow = el("section", "graph-flow");
    if (unresolved.length) {
      flow.append(el("p", "graph-warning", "Task links loop between groups. Expand them to inspect the individual prerequisites."));
      layers.push(unresolved);
    }
    let weight = 1;
    for (const layer of layers) {
      const row = el("div", "graph-flow-level");
      let rowWeight = 0;
      for (const task of layer) {
        const steps = kids[task.id] || [];
        const card = steps.length ? graphGroup(task, steps) : graphNode(task);
        // Branching subgraphs get more room than a single chain or a folded node.
        const breadth = Math.max(1, ...[...card.querySelectorAll(".graph-cards")].map((cards) => cards.children.length));
        const span = Math.ceil(Math.sqrt(breadth));
        card.style.setProperty("--branch-weight", span);
        rowWeight += span;
        row.append(card);
      }
      weight = Math.max(weight, rowWeight);
      flow.append(row);
    }
    flow.dataset.weight = weight;
    forest.append(flow);
  }
  network.append(forest);
  graph.append(network);
  scheduleGraphLayout();
}

function graphGroup(task, steps) {
  const group = el("section", "graph-task " + task.status);
  group.dataset.task = task.id;
  const open = Boolean(state.graphOpen[graphOpenKey(task.id)]);
  group.classList.toggle("expanded", open);
  group.classList.toggle("selected-task", state.selected === task.id);
  const header = el("div", "graph-task-header");
  header.dataset.id = task.id;
  (open ? header : group).dataset.tooltip = itemTooltip(task);
  const toggle = el("button", "graph-task-toggle");
  toggle.setAttribute("aria-expanded", open);
  toggle.append(icon(open ? "ChevronDown" : "ChevronRight"), icon("Folder"), el("b", "", task.title));
  toggle.onclick = () => {
    state.graphOpen[graphOpenKey(task.id)] = !open;
    saveGraphOpen();
    render();
  };
  const summary = el("button", "graph-task-count");
  summary.append(statusIcon(task), el("span", "", `${steps.filter((step) => step.status === "done").length} / ${steps.length}`));
  summary.dataset.tooltip = itemTooltip(task);
  itemEvents(summary, task);
  header.append(toggle, summary);
  header.oncontextmenu = (e) => { e.preventDefault(); openMenu(task, e.clientX, e.clientY); };
  group.append(header);
  if (state.tab === "global") group.append(el("div", "graph-project", projectName(task.project)));
  if (!open) return group;

  const body = el("div", "graph-task-body");
  const { done, active } = levelItems(steps);
  const doneKey = state.tab + ":" + task.id;
  if (done.length) body.append(graphDoneFold(done.length, doneKey, state.showDone));
  // A task prerequisite belongs to the task, not to an invented child edge.
  for (const id of task.depends_on) if (state.byId[id]) body.append(graphDependency(state.byId[id]));
  const shown = state.showDone[doneKey] ? [...done, ...active] : active;
  const deps = new Map(shown.map((step) => [step.id, new Set(step.depends_on)]));
  const { layers, unresolved } = graphLayers(shown, deps);
  for (const layer of layers) {
    const level = el("section", "graph-level");
    const cards = el("div", "graph-cards");
    layer.forEach((item) => cards.append(graphNode(item)));
    level.append(cards);
    body.append(level);
  }
  if (unresolved.length) {
    body.append(el("p", "graph-warning", "Dependency loop: check the links in these steps."));
    const cards = el("div", "graph-cards graph-unresolved");
    unresolved.forEach((item) => cards.append(graphNode(item)));
    body.append(cards);
  }
  group.append(body);
  return group;
}

function graphNode(item) {
  const node = el("article", "graph-node " + item.status + (blocked(item) ? " blocked" : ""));
  node.dataset.id = item.id;
  node.classList.toggle("selected", item.id === state.selected);
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", item.title + ", " + state.board.labels[item.status]);
  node.dataset.tooltip = itemTooltip(item);
  const status = el("div", "graph-status");
  status.append(statusIcon(item), el("span", "", item.status === "todo" && blocked(item) ? "Waiting for dependencies" : state.board.labels[item.status]));
  node.append(status, el("b", "graph-title", item.title));
  if (item.driver) {
    const driver = el("div", "graph-meta");
    driver.append(driverChip(item));
    node.append(driver);
  }
  if (!item.parent && state.tab === "global") node.append(el("div", "graph-project", projectName(item.project)));
  if (item.waiting_for) node.append(el("div", "graph-waiting", item.waiting_for));
  itemEvents(node, item);
  node.onkeydown = (e) => {
    if (e.target !== node || !["Enter", " "].includes(e.key)) return;
    e.preventDefault();
    select(item.id, e.key === "Enter" && e.shiftKey);
  };
  return node;
}

function graphDependency(dep) {
  const link = el("button", "graph-dependency" + (dep.status === "done" ? " done" : ""));
  link.append(icon(dep.status === "done" ? "Check" : "ArrowUpRight"), el("span", "", dep.title));
  link.dataset.tooltip = itemTooltip(dep);
  link.onclick = () => jumpTo(dep);
  return link;
}

function graphCompletion(item) {
  const check = el("input", "graph-complete");
  check.type = "checkbox";
  check.checked = item.status === "done";
  check.setAttribute("aria-label", "Mark “" + item.title + "” " + (check.checked ? "to do" : "done"));
  check.onchange = () => {
    const status = check.checked ? "done" : "todo";
    check.checked = item.status === "done";
    check.blur();
    patch(item.id, { status });
  };
  return check;
}

function renderGraphSteps(box, item) {
  const { done, active } = levelItems(scopedChildren(scopeItems())[item.id] || []);
  if (done.length || active.length) {
    const list = el("div", "graph-steps");
    list.append(el("div", "graph-steps-title", "Steps"));
    const doneKey = state.tab + ":" + item.id;
    if (done.length) list.append(doneFold(done.length, doneKey));
    const steps = state.showDone[doneKey] ? [...done, ...active] : active;
    for (const step of steps) {
      const line = el("div", "graph-step " + step.status + (blocked(step) ? " blocked" : ""));
      line.dataset.id = step.id;
      const title = el("button", "", step.title);
      title.onclick = () => select(step.id);
      line.append(graphCompletion(step), title, el("span", "status " + step.status, state.board.labels[step.status]));
      list.append(line);
    }
    box.append(list);
  }
  for (const id of item.depends_on) if (state.byId[id]) box.append(graphDependency(state.byId[id]));
  const parent = state.byId[item.parent];
  if (parent && parent.depends_on.length) {
    box.append(el("div", "graph-steps-title", "Task prerequisites"));
    for (const id of parent.depends_on) if (state.byId[id]) box.append(graphDependency(state.byId[id]));
  }
}

let graphFrame;
function scheduleGraphLayout() {
  cancelAnimationFrame(graphFrame);
  graphFrame = requestAnimationFrame(layoutGraph);
}

function layoutGraph() {
  const graph = $("#graph");
  if (graph.hidden) return;
  const forest = graph.querySelector(".graph-forest");
  if (forest) {
    const flows = [...forest.children];
    const columns = Math.min(flows.reduce((sum, flow) => sum + Number(flow.dataset.weight), 0), Math.max(1, Math.floor((forest.clientWidth + 14) / 174)));
    forest.style.setProperty("--forest-columns", Math.max(1, columns));
    for (const flow of flows) flow.style.gridColumn = "span " + Math.min(columns, Number(flow.dataset.weight));
  }
  for (const row of graph.querySelectorAll(".graph-cards")) {
    const count = row.children.length;
    // Very crowded rows wrap inside one dependency level, never into new ranks.
    const columns = Math.min(count, Math.max(1, Math.floor((row.clientWidth + 4) / 30)));
    const width = (row.clientWidth - 4 * (columns - 1)) / columns;
    row.style.setProperty("--columns", columns);
    row.dataset.density = width < 72 ? "mini" : width < 150 ? "compact" : "full";
  }
  drawGraphEdges();
}

function drawGraphEdges() {
  const network = $("#graph .graph-network");
  if (!network) return;
  const svg = network.querySelector(".graph-edges");
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${network.clientWidth} ${network.clientHeight || 1}`);
  const bounds = network.getBoundingClientRect();
  const nodes = new Map([...network.querySelectorAll(".graph-node, .graph-task-header")].map((node) => [node.dataset.id, node]));
  for (const [id, target] of nodes) {
    if (target.closest(".graph-unresolved")) continue;
    for (const dep of state.byId[id].depends_on) {
      const source = nodes.get(dep);
      if (!source || source === target || source.closest(".graph-unresolved")) continue;
      const fromHeader = source.classList.contains("graph-task-header"), toHeader = target.classList.contains("graph-task-header");
      const a = (fromHeader ? source.closest(".graph-task") : source).getBoundingClientRect();
      const b = (toHeader ? target.closest(".graph-task") : target).getBoundingClientRect();
      const x1 = a.left + a.width / 2 - bounds.left, y1 = a.bottom - bounds.top;
      const x2 = b.left + b.width / 2 - bounds.left, y2 = b.top - bounds.top;
      const fromLevel = source.closest(".graph-level, .graph-flow-level"), toLevel = target.closest(".graph-level, .graph-flow-level");
      const simple = fromLevel && toLevel && fromLevel.nextElementSibling === toLevel &&
        fromLevel.getBoundingClientRect().bottom - a.bottom < 2 &&
        b.top - toLevel.getBoundingClientRect().top < 2;
      const mid = (y1 + y2) / 2;
      const sourceTask = source.closest(".graph-task"), targetTask = target.closest(".graph-task");
      const sameTask = sourceTask && sourceTask === targetTask;
      const flow = source.closest(".graph-flow");
      const side = flow.getBoundingClientRect().left - bounds.left + 2;
      const fromRow = fromLevel && (fromLevel.querySelector(":scope > .graph-cards") || fromLevel);
      const rowBottom = fromRow ? Math.max(a.bottom, ...[...fromRow.children].map((node) => node.getBoundingClientRect()).filter((rect) => Math.abs(rect.top - a.top) < 2).map((rect) => rect.bottom)) - bounds.top : y1;
      let route;
      if (sameTask) {
        const gutter = sourceTask.getBoundingClientRect().left - bounds.left + 5;
        route = `M${x1},${y1} V${rowBottom + 8} H${gutter} V${y2 - 8} H${x2}`;
      } else {
        const sourceGroup = sourceTask || source, targetGroup = targetTask || target;
        const from = sourceGroup.getBoundingClientRect(), to = targetGroup.getBoundingClientRect();
        const exit = sourceGroup.closest(".graph-flow-level").getBoundingClientRect().bottom - bounds.top + 10;
        const entry = targetGroup.closest(".graph-flow-level").getBoundingClientRect().top - bounds.top - 10;
        const sourceGutter = from.left - bounds.left + (fromHeader ? -3 : 5);
        const targetGutter = to.left - bounds.left - 3;
        route = `M${x1},${y1} V${rowBottom + 8} H${sourceGutter} V${exit} H${side} V${entry} H${targetGutter} V${y2 - 8} H${x2}`;
      }
      const end = `V${y2 - 2} M${x2 - 3},${y2 - 6} l3,4 l3,-4`;
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.dataset.from = dep;
      path.dataset.to = id;
      path.setAttribute("d", (simple ? `M${x1},${y1} V${mid} H${x2}` : route) + " " + end);
      path.classList.toggle("doing", state.byId[dep].status === "doing");
      path.classList.toggle("done", state.byId[dep].status === "done");
      svg.append(path);
    }
  }
}

new ResizeObserver(scheduleGraphLayout).observe(document.querySelector("#graph"));
