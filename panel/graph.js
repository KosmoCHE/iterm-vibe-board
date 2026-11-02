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

function graphDoneFold(items, key, folds = state.graphDone) {
  const open = folds[key];
  const button = el("button", "graph-done");
  button.append(icon(open ? "ChevronDown" : "ChevronRight"), `${open ? "Hide" : "Show"} ${items.length} done`);
  if (!open) button.dataset.items = items.map((item) => item.id).join(" ");
  button.setAttribute("aria-expanded", Boolean(open));
  button.onclick = () => { folds[key] = !open; render(); };
  return button;
}

function renderGraph(items) {
  const graph = $("#graph");
  graph.replaceChildren();
  graphLinks = [];
  graphEndpoints = new Map();
  const kids = scopedChildren(items);
  const tasks = kids.root || [];
  if (state.selected && !items.some((item) => item.id === state.selected)) state.selected = null;
  if (!tasks.length) { graph.append(el("p", "empty", emptyText())); return; }
  const { done, active } = levelItems(tasks);
  let visible = state.graphDone[graphScopeKey()] ? [...done, ...active] : active;
  if (state.tab === "global") {
    visible = [...new Set(visible.map((item) => item.project))].sort()
      .flatMap((project) => visible.filter((item) => item.project === project));
  }
  const guide = el("div", "graph-guide");
  guide.append(el("span", "graph-key tree", "Task / steps"), el("span", "graph-key dependency", "Prerequisite → next"));
  const anyOpen = visible.some((task) => (kids[task.id] || []).length && state.graphOpen[graphOpenKey(task.id)]);
  const expand = el("button", "graph-expand", anyOpen ? "Collapse tasks" : "Expand tasks");
  expand.onclick = () => {
    visible.forEach((task) => { state.graphOpen[graphOpenKey(task.id)] = !anyOpen; });
    saveGraphOpen();
    render();
  };
  guide.append(expand);
  graph.append(guide);
  const dependencies = new Map(items.map((item) => [item.id, new Set(item.depends_on)]));
  if (graphLayers(items, dependencies).unresolved.length) {
    graph.append(el("p", "graph-warning", "Dependency loop: check the task and step prerequisites."));
  }
  const taskDeps = new Map(visible.map((task) => [task.id, new Set()]));
  const owners = new Map(items.map((item) => [item.id, taskDeps.has(item.parent) ? item.parent : item.id]));
  // Project step links only for grouping. Arrows retain the original step endpoints.
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
  if (done.length) network.append(graphDoneFold(done, graphScopeKey()));
  const forest = el("div", "graph-forest");
  for (const { layers, unresolved } of graphFlows(visible, taskDeps)) {
    const flow = el("section", "graph-flow");
    // Interleaved steps can loop between groups without a dependency cycle.
    if (unresolved.length) layers.push(unresolved);
    let weight = 1;
    for (const layer of layers) {
      const row = el("div", "graph-flow-level");
      let rowWeight = 0;
      for (const task of layer) {
        const steps = kids[task.id] || [];
        const card = steps.length ? graphGroup(task, steps) : graphNode(task);
        // Branching subgraphs get more room than a single chain or a folded node.
        const breadth = Math.max(1, ...[...card.querySelectorAll(".graph-cards")].map((cards) => cards.children.length));
        const span = card.classList.contains("expanded") ? Math.max(2, Math.ceil(Math.sqrt(breadth))) : 1;
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
  prepareGraphLinks(network, items);
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
  if (done.length) body.append(graphDoneFold(done, doneKey, state.showDone));
  const shown = state.showDone[doneKey] ? [...done, ...active] : active;
  const deps = new Map(shown.map((step) => [step.id, new Set(step.depends_on)]));
  // Independent chains are separate branches of the task tree, not one card wall.
  for (const { layers, unresolved } of graphFlows(shown, deps)) {
    const branch = el("div", "graph-branch");
    if (unresolved.length) layers.push(unresolved);
    for (const layer of layers) {
      const level = el("section", "graph-level");
      const cards = el("div", "graph-cards");
      layer.forEach((item) => cards.append(graphNode(item)));
      level.append(cards);
      branch.append(level);
    }
    body.append(branch);
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
  const parentBlocked = state.byId[item.parent] && blocked(state.byId[item.parent]);
  const label = item.status !== "todo" ? state.board.labels[item.status] : blocked(item) ? "Blocked" : parentBlocked ? "To do" : "Ready";
  status.append(statusIcon(item), el("span", "", label));
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

function graphDependency(dep, prefix = "") {
  const link = el("button", "graph-dependency" + (dep.status === "done" ? " done" : ""));
  link.append(icon(dep.status === "done" ? "Check" : "ArrowUpRight"), el("span", "", prefix + dep.title));
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
let graphLinks = [];
let graphEndpoints = new Map();

function prepareGraphLinks(network, items) {
  const visible = new Map([...network.querySelectorAll(".graph-node, .graph-task-header")].map((node) => [node.dataset.id, node]));
  for (const fold of network.querySelectorAll(".graph-done[data-items]")) {
    for (const id of fold.dataset.items.split(" ")) visible.set(id, fold);
  }
  graphEndpoints = new Map(items.map((item) => [item.id, visible.get(item.id) || visible.get(item.parent)]));
  graphLinks = [];
  const notes = new Map();
  const noteBox = (endpoint) => {
    if (!notes.has(endpoint)) {
      const box = el("div", "graph-link-notes");
      if (endpoint.matches(".graph-task-header, .graph-done")) endpoint.after(box);
      else endpoint.append(box);
      notes.set(endpoint, box);
    }
    return notes.get(endpoint);
  };
  const summaries = new Map();
  for (const item of items) {
    const target = graphEndpoints.get(item.id);
    if (!target) continue;
    for (const id of item.depends_on) {
      const source = graphEndpoints.get(id), dep = state.byId[id];
      if (!dep || source === target) continue;
      if (!source) {
        // Scope boundaries are links, never extra nodes from another session.
        const box = noteBox(target);
        if (!box.querySelector(`[data-dep="${id}"]`)) {
          const link = graphDependency(dep, "Outside view: ");
          link.dataset.dep = id;
          box.append(link);
        }
        continue;
      }
      const summary = source.dataset.id !== id || target.dataset.id !== item.id;
      const link = { from: id, to: item.id, source, target, summary };
      graphLinks.push(link);
      if (summary) for (const [endpoint, original] of [[source, id], [target, item.id]]) {
        if (endpoint.dataset.id === original) continue;
        if (!summaries.has(endpoint)) summaries.set(endpoint, []);
        summaries.get(endpoint).push(link);
      }
    }
  }
  for (const [endpoint, links] of summaries) {
    const button = el("button", "graph-summary", `${links.length} hidden link${links.length === 1 ? "" : "s"}`);
    button.dataset.tooltip = "Dashed arrows summarize these prerequisites. Click to reveal the items.\n" +
      links.map((link) => state.byId[link.from].title + " → " + state.byId[link.to].title).join("\n");
    button.onclick = () => {
      for (const link of links) for (const id of [link.from, link.to]) revealGraphItem(state.byId[id]);
      render();
    };
    noteBox(endpoint).append(button);
  }
  if (summaries.size) $(".graph-guide").append(el("span", "graph-key summary", "Dashed: hidden items"));
}

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
    const nodeWidth = parseFloat(getComputedStyle(graph).fontSize) * 12;
    const columns = Math.min(flows.reduce((sum, flow) => sum + Number(flow.dataset.weight), 0), Math.max(1, Math.floor((forest.clientWidth + 16) / (nodeWidth + 16))));
    forest.style.setProperty("--forest-columns", Math.max(1, columns));
    for (const flow of flows) flow.style.gridColumn = "span " + Math.min(columns, Number(flow.dataset.weight));
  }
  for (const row of graph.querySelectorAll(".graph-cards")) {
    const count = row.children.length;
    // Keep titles readable; wrap crowded branches without inventing dependencies.
    const columns = Math.min(count, Math.max(1, Math.floor((row.clientWidth + 12) / 124)));
    const width = (row.clientWidth - 12 * (columns - 1)) / columns;
    row.style.setProperty("--columns", columns);
    row.dataset.density = width < 160 ? "compact" : "full";
  }
  // Pack independent flows by their actual height, without a tall flow reserving a whole row.
  if (forest) for (const flow of forest.children) flow.style.gridRowEnd = "span " + Math.ceil((flow.offsetHeight + 16) / 4);
  drawGraphEdges();
  highlightGraph();
}

function drawGraphEdges() {
  const network = $("#graph .graph-network");
  if (!network) return;
  const svg = network.querySelector(".graph-edges");
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${network.clientWidth} ${network.clientHeight || 1}`);
  const bounds = network.getBoundingClientRect();
  const pathFor = (route, cls) => {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", route);
    path.setAttribute("class", cls);
    svg.append(path);
    return path;
  };
  // These lines show membership only. They never have arrowheads.
  for (const group of network.querySelectorAll(".graph-task.expanded")) {
    const header = group.querySelector(".graph-task-header").getBoundingClientRect();
    const rail = header.left - bounds.left + 12;
    for (const branch of group.querySelectorAll(".graph-branch")) {
      const first = branch.querySelector(".graph-node").getBoundingClientRect();
      const y = first.top + first.height / 2 - bounds.top;
      pathFor(`M${rail},${header.bottom - bounds.top} V${y} H${first.left - bounds.left - 3}`, "graph-tree-edge");
    }
  }
  for (const link of graphLinks) {
    const { source, target } = link;
    const sourceTask = source.closest(".graph-task"), targetTask = target.closest(".graph-task");
    const fromHeader = source.matches(".graph-task-header"), toHeader = target.matches(".graph-task-header");
    const a = (fromHeader ? sourceTask : source).getBoundingClientRect();
    const b = (toHeader ? targetTask : target).getBoundingClientRect();
    const x1 = a.left + a.width / 2 - bounds.left, y1 = a.bottom - bounds.top;
    const x2 = b.left + b.width / 2 - bounds.left, y2 = b.top - bounds.top;
    const fromLevel = source.closest(".graph-level, .graph-flow-level"), toLevel = target.closest(".graph-level, .graph-flow-level");
    const simple = fromLevel && toLevel && fromLevel.nextElementSibling === toLevel &&
      fromLevel.getBoundingClientRect().bottom - a.bottom < 2 &&
      b.top - toLevel.getBoundingClientRect().top < 2;
    const fromRow = fromLevel && (fromLevel.querySelector(":scope > .graph-cards") || fromLevel);
    const rowBottom = fromRow ? Math.max(a.bottom, ...[...fromRow.children].map((node) => node.getBoundingClientRect()).filter((rect) => Math.abs(rect.top - a.top) < 2).map((rect) => rect.bottom)) - bounds.top : y1;
    let route;
    if (simple) {
      route = `M${x1},${y1} V${(y1 + y2) / 2} H${x2}`;
    } else if (sourceTask && sourceTask === targetTask) {
      const gutter = sourceTask.getBoundingClientRect().left - bounds.left + 21;
      route = `M${x1},${y1} V${rowBottom + 10} H${gutter} V${y2 - 10} H${x2}`;
    } else {
      const from = (sourceTask || source).getBoundingClientRect(), to = (targetTask || target).getBoundingClientRect();
      const fromRank = source.closest(".graph-flow-level"), toRank = target.closest(".graph-flow-level");
      const exit = (fromRank ? fromRank.getBoundingClientRect().bottom : from.bottom) - bounds.top + 12;
      const entry = (toRank ? toRank.getBoundingClientRect().top : to.top) - bounds.top - 12;
      const flow = source.closest(".graph-flow") || target.closest(".graph-flow") || network;
      const side = flow.getBoundingClientRect().left - bounds.left + 2;
      const sourceGutter = from.left - bounds.left + (fromHeader ? -4 : 5);
      const targetGutter = to.left - bounds.left + (toHeader ? -4 : 5);
      route = `M${x1},${y1} V${rowBottom + 10} H${sourceGutter} V${exit} H${side} V${entry} H${targetGutter} V${y2 - 10} H${x2}`;
    }
    const path = pathFor(route + ` V${y2 - 3}`, "graph-dependency-edge");
    path.dataset.from = link.from;
    path.dataset.to = link.to;
    path.classList.toggle("summary", link.summary);
    path.classList.toggle("doing", state.byId[link.from].status === "doing");
    path.classList.toggle("done", state.byId[link.from].status === "done");
    // A separate solid arrowhead keeps folded links legible despite their dashes.
    const arrow = pathFor(`M${x2 - 3},${y2 - 7} l3,4 l3,-4`, path.getAttribute("class") + " graph-arrow");
    link.paths = [path, arrow];
  }
}

function highlightGraph() {
  const network = $("#graph .graph-network");
  if (!network) return;
  const selected = state.selected;
  const roots = new Set(selected ? [selected] : []);
  // Selecting a task traces its visible scope's steps as well.
  if (selected) for (const item of scopeItems()) if (item.parent === selected) roots.add(item.id);
  const upstream = new Map(), downstream = new Map();
  for (const item of state.board.items) {
    upstream.set(item.id, item.depends_on);
    for (const dep of item.depends_on) {
      if (!downstream.has(dep)) downstream.set(dep, []);
      downstream.get(dep).push(item.id);
    }
  }
  const trace = (neighbors) => {
    const ids = new Set(roots);
    for (const id of ids) for (const next of neighbors.get(id) || []) ids.add(next);
    return ids;
  };
  const before = trace(upstream), after = trace(downstream);
  const related = new Set([...before, ...after]);
  const endpoints = new Set([...related].map((id) => graphEndpoints.get(id)).filter(Boolean));
  for (const node of network.querySelectorAll(".graph-node, .graph-task-header, .graph-done")) {
    node.classList.toggle("graph-related", Boolean(selected) && endpoints.has(node));
    node.classList.toggle("graph-muted", Boolean(selected) && !endpoints.has(node));
  }
  for (const group of network.querySelectorAll(".graph-task")) {
    const relatedGroup = [...endpoints].some((node) => group.contains(node));
    group.classList.toggle("graph-related-task", Boolean(selected) && relatedGroup);
    if (relatedGroup) group.querySelector(".graph-task-header").classList.remove("graph-muted");
  }
  for (const link of graphLinks) {
    const onPath = (before.has(link.from) && before.has(link.to)) || (after.has(link.from) && after.has(link.to));
    for (const path of link.paths || []) {
      path.classList.toggle("highlighted", Boolean(selected) && onPath);
      path.classList.toggle("graph-muted", Boolean(selected) && !onPath);
    }
  }
}

new ResizeObserver(scheduleGraphLayout).observe(document.querySelector("#graph"));
