"use strict";

const routingLabUiState = {
  pathFeatures: [],
};

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    installRoutingSidebarTabs();
    moveRoutingLabIntoSidebar();
    disableAutomaticRouteFitting();
    waitForRoutingHighlightLayers();
  });
}

if (typeof renderRoutingPath === "function") {
  renderRoutingPath = function renderRoutingPathOnShapes(path) {
    const features = [];
    const shapeFeatures = state.shapes?.features || [];

    for (const edge of path.edges) {
      const from = routingGroup(edge.from);
      const to = routingGroup(edge.to);
      if (!from || !to) continue;

      if (edge.kind === "ride") {
        features.push({
          type: "Feature",
          properties: {
            kind: "ride",
            route_id: edge.route_id,
            color: edge.color,
          },
          geometry: {
            type: "LineString",
            coordinates: routingShapeSegment(edge, from, to, shapeFeatures),
          },
        });
      } else {
        features.push({
          type: "Feature",
          properties: {
            kind: "transfer",
            transfer_id: edge.transfer_id,
            color: edge.color,
          },
          geometry: {
            type: "LineString",
            coordinates: [from.center, to.center],
          },
        });
      }
    }

    routingLabUiState.pathFeatures = features;
    state.map.getSource(ROUTING_LAB.pathSource).setData({
      type: "FeatureCollection",
      features,
    });
  };
}

if (typeof fitHighlightedPath === "function") {
  fitHighlightedPath = function fitRenderedRoute() {
    if (!state.map || !routingLabUiState.pathFeatures.length) return;
    const coordinates = routingLabUiState.pathFeatures.flatMap(
      (feature) => feature.geometry?.coordinates || [],
    );
    if (!coordinates.length) return;
    const bounds = coordinates.reduce(
      (current, coordinate) => current.extend(coordinate),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );
    state.map.fitBounds(bounds, { padding: 70, duration: 500, maxZoom: 14.5 });
  };
}

function installRoutingSidebarTabs() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || sidebar.querySelector(".sidebar-tabs")) return;

  const currentChildren = [...sidebar.children];
  const tabList = document.createElement("div");
  tabList.className = "sidebar-tabs";
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "Explorer sections");
  tabList.innerHTML = `
    <button class="sidebar-tab active" id="sidebar-tab-explorer" type="button" role="tab" aria-selected="true" aria-controls="sidebar-panel-explorer">Explorer</button>
    <button class="sidebar-tab" id="sidebar-tab-routing" type="button" role="tab" aria-selected="false" aria-controls="sidebar-panel-routing">Route lab</button>
  `;

  const explorerPanel = document.createElement("div");
  explorerPanel.id = "sidebar-panel-explorer";
  explorerPanel.className = "sidebar-tab-panel";
  explorerPanel.setAttribute("role", "tabpanel");
  explorerPanel.setAttribute("aria-labelledby", "sidebar-tab-explorer");
  currentChildren.forEach((child) => explorerPanel.append(child));

  const routingPanel = document.createElement("div");
  routingPanel.id = "sidebar-panel-routing";
  routingPanel.className = "sidebar-tab-panel";
  routingPanel.setAttribute("role", "tabpanel");
  routingPanel.setAttribute("aria-labelledby", "sidebar-tab-routing");
  routingPanel.hidden = true;

  sidebar.append(tabList, explorerPanel, routingPanel);
  tabList.querySelector("#sidebar-tab-explorer").addEventListener("click", () => {
    activateRoutingSidebarTab("explorer");
  });
  tabList.querySelector("#sidebar-tab-routing").addEventListener("click", () => {
    activateRoutingSidebarTab("routing");
  });
}

function activateRoutingSidebarTab(name) {
  const explorerButton = document.querySelector("#sidebar-tab-explorer");
  const routingButton = document.querySelector("#sidebar-tab-routing");
  const explorerPanel = document.querySelector("#sidebar-panel-explorer");
  const routingPanel = document.querySelector("#sidebar-panel-routing");
  if (!explorerButton || !routingButton || !explorerPanel || !routingPanel) return;

  const routingActive = name === "routing";
  explorerButton.classList.toggle("active", !routingActive);
  routingButton.classList.toggle("active", routingActive);
  explorerButton.setAttribute("aria-selected", String(!routingActive));
  routingButton.setAttribute("aria-selected", String(routingActive));
  explorerPanel.hidden = routingActive;
  routingPanel.hidden = !routingActive;
}

function moveRoutingLabIntoSidebar() {
  const panel = document.querySelector("#routing-lab-panel");
  const host = document.querySelector("#sidebar-panel-routing");
  if (!panel || !host) return;

  panel.open = true;
  panel.classList.add("routing-lab-sidebar-panel");

  const heading = document.createElement("div");
  heading.className = "section-heading routing-sidebar-heading";
  heading.innerHTML = `
    <div>
      <p class="eyebrow routing-sidebar-eyebrow">Issue #6</p>
      <h2>Route lab</h2>
    </div>
    <span class="muted">topology only</span>
  `;

  host.append(heading, panel);
  routingLabState.panel = panel;
}

function disableAutomaticRouteFitting() {
  if (typeof routingLabState === "undefined") return;
  routingLabState.fitPath = false;

  const checkbox = document.querySelector("#routing-fit-path");
  const checkboxLabel = checkbox?.closest("label");
  if (!checkboxLabel) return;

  const fitButton = document.createElement("button");
  fitButton.id = "routing-fit-route";
  fitButton.className = "secondary-button routing-fit-button";
  fitButton.type = "button";
  fitButton.textContent = "Fit highlighted route";
  fitButton.addEventListener("click", () => fitHighlightedPath());
  checkboxLabel.replaceWith(fitButton);
}

function waitForRoutingHighlightLayers(attempt = 0) {
  if (attempt > 250) return;
  if (
    typeof state === "undefined" ||
    !state.map ||
    !state.map.getLayer("routing-lab-ride-casing")
  ) {
    window.setTimeout(() => waitForRoutingHighlightLayers(attempt + 1), 60);
    return;
  }

  state.map.setPaintProperty("routing-lab-ride-casing", "line-color", "rgba(8,12,11,.94)");
  state.map.setPaintProperty("routing-lab-ride-casing", "line-width", 12);
  state.map.setPaintProperty("routing-lab-ride", "line-width", 7);
  state.map.setPaintProperty("routing-lab-transfer-casing", "line-color", "rgba(8,12,11,.94)");
  state.map.setPaintProperty("routing-lab-transfer-casing", "line-width", 10);
  state.map.setPaintProperty("routing-lab-transfer", "line-width", 5);
}

function routingShapeSegment(edge, fromGroup, toGroup, shapeFeatures) {
  const candidates = (shapeFeatures || []).filter(
    (feature) =>
      feature?.geometry?.type === "LineString" &&
      String(feature.properties?.route_id) === String(edge.route_id),
  );
  let bestForward = null;
  let bestFallback = null;

  for (const feature of candidates) {
    const coordinates = feature.geometry.coordinates || [];
    if (coordinates.length < 2) continue;

    const fromIndex = nearestRoutingCoordinateIndex(coordinates, fromGroup.center);
    const toIndex = nearestRoutingCoordinateIndex(coordinates, toGroup.center);
    if (fromIndex === toIndex) continue;

    const forward = fromIndex < toIndex;
    const segment = forward
      ? coordinates.slice(fromIndex, toIndex + 1)
      : coordinates.slice(toIndex, fromIndex + 1).reverse();
    const score =
      routingCoordinateDistanceSquared(coordinates[fromIndex], fromGroup.center) +
      routingCoordinateDistanceSquared(coordinates[toIndex], toGroup.center);
    const candidate = { coordinates: segment, score };

    if (forward && (!bestForward || score < bestForward.score)) bestForward = candidate;
    if (!bestFallback || score < bestFallback.score) bestFallback = candidate;
  }

  return (bestForward || bestFallback)?.coordinates || [fromGroup.center, toGroup.center];
}

function nearestRoutingCoordinateIndex(coordinates, target) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < coordinates.length; index += 1) {
    const distance = routingCoordinateDistanceSquared(coordinates[index], target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function routingCoordinateDistanceSquared(left, right) {
  const latitudeScale = Math.cos(
    (((Number(left[1]) + Number(right[1])) / 2) * Math.PI) / 180,
  );
  const longitude = (Number(left[0]) - Number(right[0])) * latitudeScale;
  const latitude = Number(left[1]) - Number(right[1]);
  return longitude * longitude + latitude * latitude;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    nearestRoutingCoordinateIndex,
    routingShapeSegment,
  };
}
