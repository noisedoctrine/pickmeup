"use strict";

const ROUTING_LAB = Object.freeze({
  waitIntervalMs: 60,
  waitLimit: 250,
  pathSource: "routing-lab-path",
  selectionSource: "routing-lab-selections",
});

const routingLabState = {
  fromId: null,
  toId: null,
  pickTarget: null,
  representation: "multigraph",
  transferMode: "integrated",
  respectDirection: true,
  fitPath: true,
  ready: false,
  graph: null,
  panel: null,
  elements: {},
};

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    injectRoutingLabPanel();
    waitForRoutingLabMap();
  });
}

function injectRoutingLabPanel() {
  const mapPanel = document.querySelector(".map-panel");
  if (!mapPanel || document.querySelector("#routing-lab-panel")) return;

  const panel = document.createElement("details");
  panel.id = "routing-lab-panel";
  panel.className = "routing-lab-panel";
  panel.open = true;
  panel.innerHTML = `
    <summary>
      <span>Route lab</span>
      <small>Issue #6 · topology only</small>
    </summary>
    <div class="routing-lab-body">
      <p class="routing-lab-warning">
        This highlights a structural path through the recorded rail graph. It is not a fastest-route or journey recommendation.
      </p>

      <div class="routing-pick-grid">
        <button class="routing-pick" id="routing-pick-from" type="button">
          <span>From</span>
          <strong id="routing-from-name">Choose on map</strong>
        </button>
        <button class="routing-pick" id="routing-pick-to" type="button">
          <span>To</span>
          <strong id="routing-to-name">Choose on map</strong>
        </button>
      </div>

      <div class="routing-action-row">
        <button class="secondary-button" id="routing-swap" type="button">Swap</button>
        <button class="secondary-button" id="routing-clear" type="button">Clear</button>
      </div>

      <label class="routing-field">
        Graph representation
        <select id="routing-representation">
          <option value="multigraph">Route-pattern multigraph</option>
          <option value="collapsed">Collapsed station topology</option>
        </select>
      </label>

      <label class="routing-field">
        Curated transfer links
        <select id="routing-transfer-mode">
          <option value="integrated">Integrated links only</option>
          <option value="all">Include optional out-of-station links</option>
          <option value="none">No curated links</option>
        </select>
      </label>

      <label class="routing-check">
        <input id="routing-respect-direction" type="checkbox" checked />
        Respect recorded GTFS direction
      </label>
      <label class="routing-check">
        <input id="routing-fit-path" type="checkbox" checked />
        Fit map to highlighted path
      </label>

      <div class="routing-graph-summary" id="routing-graph-summary">Waiting for map data…</div>
      <div class="routing-result empty-state" id="routing-result">
        Select <strong>From</strong>, then select <strong>To</strong> on the map.
      </div>
    </div>
  `;
  mapPanel.append(panel);

  routingLabState.panel = panel;
  routingLabState.elements = {
    pickFrom: panel.querySelector("#routing-pick-from"),
    pickTo: panel.querySelector("#routing-pick-to"),
    fromName: panel.querySelector("#routing-from-name"),
    toName: panel.querySelector("#routing-to-name"),
    swap: panel.querySelector("#routing-swap"),
    clear: panel.querySelector("#routing-clear"),
    representation: panel.querySelector("#routing-representation"),
    transferMode: panel.querySelector("#routing-transfer-mode"),
    respectDirection: panel.querySelector("#routing-respect-direction"),
    fitPath: panel.querySelector("#routing-fit-path"),
    graphSummary: panel.querySelector("#routing-graph-summary"),
    result: panel.querySelector("#routing-result"),
  };

  routingLabState.elements.pickFrom.addEventListener("click", () => setPickTarget("from"));
  routingLabState.elements.pickTo.addEventListener("click", () => setPickTarget("to"));
  routingLabState.elements.swap.addEventListener("click", swapRoutingStations);
  routingLabState.elements.clear.addEventListener("click", clearRoutingSelection);
  routingLabState.elements.representation.addEventListener("change", () => {
    routingLabState.representation = routingLabState.elements.representation.value;
    rebuildRoutingGraph();
  });
  routingLabState.elements.transferMode.addEventListener("change", () => {
    routingLabState.transferMode = routingLabState.elements.transferMode.value;
    rebuildRoutingGraph();
  });
  routingLabState.elements.respectDirection.addEventListener("change", () => {
    routingLabState.respectDirection = routingLabState.elements.respectDirection.checked;
    rebuildRoutingGraph();
  });
  routingLabState.elements.fitPath.addEventListener("change", () => {
    routingLabState.fitPath = routingLabState.elements.fitPath.checked;
    if (routingLabState.fitPath) fitHighlightedPath();
  });
}

function waitForRoutingLabMap(attempt = 0) {
  if (attempt >= ROUTING_LAB.waitLimit) {
    setRoutingMessage("The routing lab could not attach to the map.", true);
    return;
  }
  if (typeof state === "undefined" || !state.map || !state.stationModel) {
    window.setTimeout(() => waitForRoutingLabMap(attempt + 1), ROUTING_LAB.waitIntervalMs);
    return;
  }
  if (!state.map.isStyleLoaded()) {
    state.map.once("idle", () => setupRoutingLabMap());
    return;
  }
  setupRoutingLabMap();
}

function setupRoutingLabMap() {
  if (routingLabState.ready) return;
  addRoutingLabLayers();
  state.map.on("click", "rail-stops", handleRoutingStationClick);
  routingLabState.ready = true;
  rebuildRoutingGraph();
  setPickTarget("from");
}

function addRoutingLabLayers() {
  const empty = { type: "FeatureCollection", features: [] };
  if (!state.map.getSource(ROUTING_LAB.pathSource)) {
    state.map.addSource(ROUTING_LAB.pathSource, { type: "geojson", data: empty });
  }

  const beforeLayer = state.map.getLayer("station-halo") ? "station-halo" : undefined;
  addLayerIfMissing(
    {
      id: "routing-lab-ride-casing",
      type: "line",
      source: ROUTING_LAB.pathSource,
      filter: ["==", ["get", "kind"], "ride"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(255,255,255,.96)",
        "line-width": 11,
        "line-opacity": 0.95,
      },
    },
    beforeLayer,
  );
  addLayerIfMissing(
    {
      id: "routing-lab-ride",
      type: "line",
      source: ROUTING_LAB.pathSource,
      filter: ["==", ["get", "kind"], "ride"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 6,
        "line-opacity": 0.97,
      },
    },
    beforeLayer,
  );
  addLayerIfMissing(
    {
      id: "routing-lab-transfer-casing",
      type: "line",
      source: ROUTING_LAB.pathSource,
      filter: ["==", ["get", "kind"], "transfer"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(255,255,255,.98)",
        "line-width": 9,
        "line-opacity": 0.95,
      },
    },
    beforeLayer,
  );
  addLayerIfMissing(
    {
      id: "routing-lab-transfer",
      type: "line",
      source: ROUTING_LAB.pathSource,
      filter: ["==", ["get", "kind"], "transfer"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 4,
        "line-dasharray": [1.5, 1.2],
        "line-opacity": 0.98,
      },
    },
    beforeLayer,
  );

  if (!state.map.getSource(ROUTING_LAB.selectionSource)) {
    state.map.addSource(ROUTING_LAB.selectionSource, { type: "geojson", data: empty });
  }
  addLayerIfMissing({
    id: "routing-lab-selection-halo",
    type: "circle",
    source: ROUTING_LAB.selectionSource,
    paint: {
      "circle-radius": 12,
      "circle-color": "rgba(255,255,255,.96)",
      "circle-stroke-color": "rgba(28,37,34,.35)",
      "circle-stroke-width": 1,
    },
  });
  addLayerIfMissing({
    id: "routing-lab-selection",
    type: "circle",
    source: ROUTING_LAB.selectionSource,
    paint: {
      "circle-radius": 8,
      "circle-color": ["match", ["get", "target"], "from", "#176b87", "#d85c3f"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  addLayerIfMissing({
    id: "routing-lab-selection-label",
    type: "symbol",
    source: ROUTING_LAB.selectionSource,
    layout: {
      "text-field": ["match", ["get", "target"], "from", "A", "B"],
      "text-size": 10,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "rgba(0,0,0,.2)",
      "text-halo-width": 0.5,
    },
  });
}

function addLayerIfMissing(layer, beforeId) {
  if (!state.map.getLayer(layer.id)) state.map.addLayer(layer, beforeId);
}

function setPickTarget(target) {
  if (!routingLabState.ready) return;
  routingLabState.pickTarget = target;
  routingLabState.elements.pickFrom.classList.toggle("active", target === "from");
  routingLabState.elements.pickTo.classList.toggle("active", target === "to");
  state.map.getCanvas().classList.toggle("routing-pick-active", Boolean(target));
  const label = target === "from" ? "From" : "To";
  elements.mapStatus.textContent = `Route lab · click a station to set ${label}`;
}

function handleRoutingStationClick(event) {
  if (!routingLabState.pickTarget) return;
  const feature = event.features?.[0];
  const groupId = feature?.properties?.group_id;
  if (!groupId) return;

  if (routingLabState.pickTarget === "from") {
    routingLabState.fromId = groupId;
    routingLabState.pickTarget = null;
    updateRoutingSelectionDisplay();
    if (!routingLabState.toId) setPickTarget("to");
  } else {
    routingLabState.toId = groupId;
    routingLabState.pickTarget = null;
    updateRoutingSelectionDisplay();
  }
  state.map.getCanvas().classList.remove("routing-pick-active");
  recomputeRoutingPath();
}

function swapRoutingStations() {
  [routingLabState.fromId, routingLabState.toId] = [
    routingLabState.toId,
    routingLabState.fromId,
  ];
  updateRoutingSelectionDisplay();
  recomputeRoutingPath();
}

function clearRoutingSelection() {
  routingLabState.fromId = null;
  routingLabState.toId = null;
  routingLabState.pickTarget = null;
  state.map?.getCanvas().classList.remove("routing-pick-active");
  updateRoutingSelectionDisplay();
  clearRoutingPath();
  setRoutingMessage("Select From, then select To on the map.");
  setPickTarget("from");
}

function rebuildRoutingGraph() {
  if (!routingLabState.ready) return;
  routingLabState.graph = buildRoutingGraph(
    state.stationModel,
    state.patterns,
    state.routes,
    state.refinedTransfers?.records || [],
    {
      representation: routingLabState.representation,
      transferMode: routingLabState.transferMode,
      respectDirection: routingLabState.respectDirection,
    },
  );
  renderRoutingGraphSummary(summarizeRoutingGraph(routingLabState.graph));
  recomputeRoutingPath();
}

function buildRoutingGraph(model, patterns, routes, transferRecords = [], options = {}) {
  const representation = options.representation || "multigraph";
  const transferMode = options.transferMode || "integrated";
  const respectDirection = options.respectDirection !== false;
  const routeById = new Map(routes.map((route) => [route.route_id, route]));
  const nodes = new Map(model.groups.map((group) => [group.id, group]));
  const rawEdges = [];

  const sortedPatterns = [...patterns].sort((left, right) =>
    [left.route_id, left.direction_id ?? "", left.pattern_id ?? "", (left.stop_ids || []).join(">")]
      .join("|")
      .localeCompare(
        [right.route_id, right.direction_id ?? "", right.pattern_id ?? "", (right.stop_ids || []).join(">")].join("|"),
      ),
  );

  for (const pattern of sortedPatterns) {
    const groupIds = [];
    for (const stopId of pattern.stop_ids || []) {
      const groupId = model.groupByStopId.get(stopId)?.id;
      if (groupId && groupIds.at(-1) !== groupId) groupIds.push(groupId);
    }
    for (let index = 0; index < groupIds.length - 1; index += 1) {
      const edgeColor = normalizeRoutingColor(routeById.get(pattern.route_id)?.color, "315c4f");
      const edge = {
        from: groupIds[index],
        to: groupIds[index + 1],
        kind: "ride",
        route_id: String(pattern.route_id),
        route_ids: [String(pattern.route_id)],
        pattern_id: String(pattern.pattern_id || `${pattern.route_id}:${pattern.direction_id ?? "?"}`),
        direction_id: pattern.direction_id ?? null,
        color: edgeColor,
        route_colors: { [String(pattern.route_id)]: edgeColor },
      };
      rawEdges.push(edge);
      if (!respectDirection) rawEdges.push({ ...edge, from: edge.to, to: edge.from, synthetic_reverse: true });
    }
  }

  if (transferMode !== "none") {
    for (const record of [...transferRecords].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      if (record.runtime_use === "exclude") continue;
      if (transferMode === "integrated" && record.runtime_use !== "transfer_edge") continue;
      const fromGroups = uniqueRoutingValues(
        (record.from_stop_ids || []).map((stopId) => model.groupByStopId.get(stopId)?.id),
      );
      const toGroups = uniqueRoutingValues(
        (record.to_stop_ids || []).map((stopId) => model.groupByStopId.get(stopId)?.id),
      );
      for (const from of fromGroups) {
        for (const to of toGroups) {
          const edge = {
            from,
            to,
            kind: "transfer",
            route_id: null,
            route_ids: [],
            transfer_id: String(record.id),
            runtime_use: String(record.runtime_use),
            color: record.runtime_use === "optional_out_of_station_edge" ? "#b96516" : "#33413d",
          };
          rawEdges.push(edge);
          if (record.bidirectional !== false) rawEdges.push({ ...edge, from: to, to: from });
        }
      }
    }
  }

  const edges = representation === "collapsed" ? collapseRoutingEdges(rawEdges) : rawEdges;
  const adjacency = new Map([...nodes.keys()].map((nodeId) => [nodeId, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge);
  }
  for (const values of adjacency.values()) values.sort(compareRoutingEdges);

  return { nodes, edges, rawEdges, adjacency, representation, transferMode, respectDirection };
}

function collapseRoutingEdges(edges) {
  const grouped = new Map();
  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.kind}|${edge.transfer_id || ""}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        ...edge,
        route_ids: [...edge.route_ids],
        route_colors: { ...(edge.route_colors || {}) },
      });
      continue;
    }
    current.route_ids = uniqueRoutingValues([...current.route_ids, ...edge.route_ids]);
    current.route_colors = { ...current.route_colors, ...(edge.route_colors || {}) };
    if (!current.route_id && current.route_ids.length === 1) current.route_id = current.route_ids[0];
  }
  return [...grouped.values()].sort(compareRoutingEdges);
}

function compareRoutingEdges(left, right) {
  return [left.to, left.kind, left.route_id || "", left.pattern_id || "", left.transfer_id || ""]
    .join("|")
    .localeCompare([right.to, right.kind, right.route_id || "", right.pattern_id || "", right.transfer_id || ""].join("|"));
}

function summarizeRoutingGraph(graph) {
  const pairCounts = new Map();
  for (const edge of graph.rawEdges.filter((candidate) => candidate.kind === "ride")) {
    const key = `${edge.from}|${edge.to}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  return {
    nodes: graph.nodes.size,
    edges: graph.edges.length,
    raw_edges: graph.rawEdges.length,
    parallel_pairs: [...pairCounts.values()].filter((count) => count > 1).length,
    weak_components: countWeakRoutingComponents(graph),
  };
}

function countWeakRoutingComponents(graph) {
  const neighbors = new Map([...graph.nodes.keys()].map((nodeId) => [nodeId, new Set()]));
  for (const edge of graph.edges) {
    if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set());
    if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
    neighbors.get(edge.from).add(edge.to);
    neighbors.get(edge.to).add(edge.from);
  }
  const seen = new Set();
  let components = 0;
  for (const nodeId of neighbors.keys()) {
    if (seen.has(nodeId)) continue;
    components += 1;
    const stack = [nodeId];
    seen.add(nodeId);
    while (stack.length) {
      const current = stack.pop();
      for (const next of neighbors.get(current) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  }
  return components;
}

function findRoutingPath(graph, fromId, toId) {
  if (!fromId || !toId || !graph.nodes.has(fromId) || !graph.nodes.has(toId)) return null;
  if (fromId === toId) return { nodes: [fromId], edges: [], hops: 0, line_changes: 0, transfers: 0 };

  const frontier = [{ node: fromId, route: null, hops: 0, changes: 0, signature: "" }];
  const best = new Map([[routingStateKey(fromId, null), { hops: 0, changes: 0, signature: "" }]]);
  const previous = new Map();
  let goal = null;

  while (frontier.length) {
    frontier.sort(compareRoutingFrontier);
    const current = frontier.shift();
    const currentKey = routingStateKey(current.node, current.route);
    const known = best.get(currentKey);
    if (!known || compareRoutingCost(current, known) !== 0) continue;
    if (current.node === toId) {
      goal = current;
      break;
    }

    for (const edge of graph.adjacency.get(current.node) || []) {
      const routeOptions = edge.kind === "ride" ? edge.route_ids.length ? edge.route_ids : [edge.route_id] : [null];
      for (const routeId of routeOptions) {
        const routeChange = edge.kind === "transfer" ? 1 : current.route && current.route !== routeId ? 1 : 0;
        const nextRoute = edge.kind === "transfer" ? null : routeId;
        const next = {
          node: edge.to,
          route: nextRoute,
          hops: current.hops + 1,
          changes: current.changes + routeChange,
          signature: `${current.signature}|${edge.kind}:${routeId || edge.transfer_id || "transfer"}:${edge.to}`,
        };
        const nextKey = routingStateKey(next.node, next.route);
        const existing = best.get(nextKey);
        if (!existing || compareRoutingCost(next, existing) < 0) {
          best.set(nextKey, { hops: next.hops, changes: next.changes, signature: next.signature });
          previous.set(nextKey, {
            previousKey: currentKey,
            edge: {
              ...edge,
              route_id: routeId,
              route_ids: routeId ? [routeId] : [],
              color: routeId ? edge.route_colors?.[routeId] || edge.color : edge.color,
            },
          });
          frontier.push(next);
        }
      }
    }
  }

  if (!goal) return null;
  const edges = [];
  let cursorKey = routingStateKey(goal.node, goal.route);
  while (previous.has(cursorKey)) {
    const step = previous.get(cursorKey);
    edges.push(step.edge);
    cursorKey = step.previousKey;
  }
  edges.reverse();
  const nodes = [fromId, ...edges.map((edge) => edge.to)];
  return {
    nodes,
    edges,
    hops: edges.length,
    line_changes: goal.changes,
    transfers: edges.filter((edge) => edge.kind === "transfer").length,
  };
}

function compareRoutingFrontier(left, right) {
  return compareRoutingCost(left, right) || String(left.node).localeCompare(String(right.node)) || String(left.route || "").localeCompare(String(right.route || ""));
}

function compareRoutingCost(left, right) {
  return left.hops - right.hops || left.changes - right.changes || String(left.signature || "").localeCompare(String(right.signature || ""));
}

function routingStateKey(node, route) {
  return `${node}|${route || ""}`;
}

function recomputeRoutingPath() {
  if (!routingLabState.ready || !routingLabState.graph) return;
  updateRoutingSelectionDisplay();
  if (!routingLabState.fromId || !routingLabState.toId) {
    clearRoutingPath();
    return;
  }

  const path = findRoutingPath(
    routingLabState.graph,
    routingLabState.fromId,
    routingLabState.toId,
  );
  if (!path) {
    clearRoutingPath(false);
    setRoutingMessage("No path exists under the current representation, direction, and transfer settings.", true);
    elements.mapStatus.textContent = "Route lab · no structural path under current settings";
    return;
  }

  renderRoutingPath(path);
  renderRoutingResult(path);
  if (routingLabState.fitPath) fitHighlightedPath(path);
  elements.mapStatus.textContent = `Route lab · ${path.hops} station links · ${path.line_changes} structural change${path.line_changes === 1 ? "" : "s"}`;
}

function updateRoutingSelectionDisplay() {
  if (!routingLabState.panel || typeof state === "undefined" || !state.stationModel) return;
  routingLabState.elements.fromName.textContent = routingStationName(routingLabState.fromId) || "Choose on map";
  routingLabState.elements.toName.textContent = routingStationName(routingLabState.toId) || "Choose on map";
  updateRoutingSelectionSource();
}

function updateRoutingSelectionSource() {
  if (!state.map?.getSource(ROUTING_LAB.selectionSource)) return;
  const features = [];
  for (const [target, groupId] of [["from", routingLabState.fromId], ["to", routingLabState.toId]]) {
    const group = state.stationModel.groups.find((candidate) => candidate.id === groupId);
    if (!group) continue;
    features.push({
      type: "Feature",
      properties: { target, group_id: group.id, stop_name: group.stop_name },
      geometry: { type: "Point", coordinates: group.center },
    });
  }
  state.map.getSource(ROUTING_LAB.selectionSource).setData({ type: "FeatureCollection", features });
}

function renderRoutingPath(path) {
  const features = [];
  let rideRun = null;
  const flushRideRun = () => {
    if (!rideRun) return;
    features.push({
      type: "Feature",
      properties: {
        kind: "ride",
        route_id: rideRun.route_id,
        color: rideRun.color,
      },
      geometry: { type: "LineString", coordinates: rideRun.coordinates },
    });
    rideRun = null;
  };

  for (const edge of path.edges) {
    const from = routingGroup(edge.from);
    const to = routingGroup(edge.to);
    if (!from || !to) continue;
    if (edge.kind === "ride") {
      if (rideRun && rideRun.route_id === edge.route_id && rideRun.last === edge.from) {
        rideRun.coordinates.push(to.center);
        rideRun.last = edge.to;
      } else {
        flushRideRun();
        rideRun = {
          route_id: edge.route_id,
          color: edge.color,
          coordinates: [from.center, to.center],
          last: edge.to,
        };
      }
    } else {
      flushRideRun();
      features.push({
        type: "Feature",
        properties: {
          kind: "transfer",
          transfer_id: edge.transfer_id,
          color: edge.color,
        },
        geometry: { type: "LineString", coordinates: [from.center, to.center] },
      });
    }
  }
  flushRideRun();
  state.map.getSource(ROUTING_LAB.pathSource).setData({ type: "FeatureCollection", features });
}

function renderRoutingResult(path) {
  const result = routingLabState.elements.result;
  result.className = "routing-result";
  result.replaceChildren();

  const summary = document.createElement("p");
  summary.className = "routing-result-summary";
  summary.textContent = `${path.hops} station links · ${path.line_changes} structural changes · ${path.transfers} curated walking links`;
  result.append(summary);

  const note = document.createElement("p");
  note.className = "routing-result-note";
  note.textContent = "Primary rule: fewest station links. Equal-length alternatives prefer fewer line changes.";
  result.append(note);

  const list = document.createElement("ol");
  list.className = "routing-step-list";
  for (const step of routingPathSteps(path)) {
    const item = document.createElement("li");
    if (step.kind === "ride") {
      const route = state.routes.find((candidate) => candidate.route_id === step.route_id);
      item.innerHTML = `<strong>${escapeRoutingHtml(route?.long_name || step.route_id)}</strong><span>${escapeRoutingHtml(step.from_name)} → ${escapeRoutingHtml(step.to_name)} · ${step.links} link${step.links === 1 ? "" : "s"}</span>`;
      item.style.setProperty("--step-color", step.color);
    } else {
      item.classList.add("transfer");
      item.innerHTML = `<strong>Curated walking connection</strong><span>${escapeRoutingHtml(step.from_name)} → ${escapeRoutingHtml(step.to_name)}</span>`;
      item.style.setProperty("--step-color", step.color);
    }
    list.append(item);
  }
  result.append(list);
}

function routingPathSteps(path) {
  const steps = [];
  for (const edge of path.edges) {
    const fromName = routingStationName(edge.from) || edge.from;
    const toName = routingStationName(edge.to) || edge.to;
    const previous = steps.at(-1);
    if (edge.kind === "ride" && previous?.kind === "ride" && previous.route_id === edge.route_id) {
      previous.to_name = toName;
      previous.links += 1;
    } else {
      steps.push({
        kind: edge.kind,
        route_id: edge.route_id,
        from_name: fromName,
        to_name: toName,
        links: 1,
        color: edge.color,
      });
    }
  }
  return steps;
}

function renderRoutingGraphSummary(summary) {
  routingLabState.elements.graphSummary.textContent = `${summary.nodes} station groups · ${summary.edges} graph links · ${summary.parallel_pairs} parallel station pairs · ${summary.weak_components} weak component${summary.weak_components === 1 ? "" : "s"}`;
}

function setRoutingMessage(message, isError = false) {
  if (!routingLabState.elements.result) return;
  routingLabState.elements.result.className = `routing-result empty-state${isError ? " error" : ""}`;
  routingLabState.elements.result.textContent = message;
}

function clearRoutingPath(clearMessage = true) {
  if (state.map?.getSource(ROUTING_LAB.pathSource)) {
    state.map.getSource(ROUTING_LAB.pathSource).setData({ type: "FeatureCollection", features: [] });
  }
  if (clearMessage && routingLabState.elements.result) {
    setRoutingMessage("Select From, then select To on the map.");
  }
}

function fitHighlightedPath(path = null) {
  if (!routingLabState.fitPath || !state.map) return;
  const nodeIds = path?.nodes || [routingLabState.fromId, routingLabState.toId].filter(Boolean);
  const coordinates = nodeIds.map((nodeId) => routingGroup(nodeId)?.center).filter(Boolean);
  if (!coordinates.length) return;
  if (coordinates.length === 1) {
    state.map.easeTo({ center: coordinates[0], zoom: Math.max(state.map.getZoom(), 13) });
    return;
  }
  const bounds = coordinates.reduce(
    (current, coordinate) => current.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  state.map.fitBounds(bounds, { padding: 80, duration: 550, maxZoom: 14.5 });
}

function routingStationName(groupId) {
  return routingGroup(groupId)?.stop_name || null;
}

function routingGroup(groupId) {
  return state.stationModel?.groups.find((group) => group.id === groupId) || null;
}

function normalizeRoutingColor(value, fallback) {
  const normalized = String(value || fallback).trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(normalized) ? `#${normalized}` : `#${fallback}`;
}

function uniqueRoutingValues(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function escapeRoutingHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildRoutingGraph,
    collapseRoutingEdges,
    countWeakRoutingComponents,
    findRoutingPath,
    routingPathSteps,
    summarizeRoutingGraph,
  };
}
