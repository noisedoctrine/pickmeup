"use strict";

const state = {
  manifest: null,
  summary: null,
  routes: [],
  stops: null,
  patterns: [],
  frequencies: [],
  quality: [],
  shapes: null,
  map: null,
  selectedRouteId: null,
};

const elements = {
  snapshotChip: document.querySelector("#snapshot-chip"),
  snapshotId: document.querySelector("#snapshot-id"),
  metricGrid: document.querySelector("#metric-grid"),
  provenance: document.querySelector("#provenance"),
  routeList: document.querySelector("#route-list"),
  routeDetails: document.querySelector("#route-details"),
  qualityList: document.querySelector("#quality-list"),
  mapStatus: document.querySelector("#map-status"),
  showAllRoutes: document.querySelector("#show-all-routes"),
};

window.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  try {
    const manifestUrl = new URL("./data/manifest.json", window.location.href);
    state.manifest = await fetchJson(manifestUrl, { cache: "no-cache" });
    const entries = await Promise.all(
      Object.entries(state.manifest.files).map(async ([key, relativePath]) => [
        key,
        await fetchJson(new URL(relativePath, manifestUrl)),
      ]),
    );
    const data = Object.fromEntries(entries);

    state.summary = data.summary;
    state.routes = data.routes.routes;
    state.stops = data.stops;
    state.patterns = data.patterns.patterns;
    state.frequencies = data.frequencies.frequencies;
    state.quality = data.quality.findings;
    state.shapes = data.shapes;

    renderSnapshot();
    renderRoutes();
    renderQuality();
    renderCharts();
    initializeMap();
    elements.showAllRoutes.addEventListener("click", showAllRoutes);
  } catch (error) {
    console.error(error);
    elements.snapshotChip.textContent = "Snapshot unavailable";
    elements.mapStatus.textContent = `Could not load the cached explorer data: ${error.message}`;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

function renderSnapshot() {
  const acquired = formatDate(state.manifest.acquired_at);
  elements.snapshotChip.textContent = `Cached snapshot · ${acquired}`;
  elements.snapshotId.textContent = state.manifest.active_snapshot;

  const metrics = [
    [state.summary.route_count, "routes"],
    [state.summary.stop_count, "stops"],
    [state.summary.trip_count, "trips"],
    [state.summary.route_pattern_count, "route patterns"],
  ];
  const template = document.querySelector("#metric-template");
  for (const [value, label] of metrics) {
    const card = template.content.cloneNode(true);
    card.querySelector("strong").textContent = Number(value).toLocaleString();
    card.querySelector("span").textContent = label;
    elements.metricGrid.append(card);
  }

  const rows = [
    ["Acquired", acquired],
    ["GTFS SHA-256", state.manifest.sha256],
    ["Source", state.manifest.source_url || "Local snapshot"],
    ["Transfers table", state.summary.has_transfers ? "present" : "not present"],
    [
      "Station hierarchy",
      state.summary.has_parent_stations ? "present" : "not present",
    ],
  ];
  for (const [term, description] of rows) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = description;
    if (term === "GTFS SHA-256") {
      dd.classList.add("mono");
    }
    elements.provenance.append(dt, dd);
  }
}

function renderRoutes() {
  elements.routeList.replaceChildren();
  for (const route of state.routes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-button";
    button.dataset.routeId = route.route_id;
    button.style.setProperty("--route-color", `#${route.color}`);

    const swatch = document.createElement("span");
    swatch.className = "route-swatch";
    const label = document.createElement("span");
    label.className = "route-label";
    const name = document.createElement("strong");
    const detail = document.createElement("small");
    name.textContent = route.long_name;
    detail.textContent = route.short_name === route.long_name ? route.route_id : route.short_name;
    label.append(name, detail);
    const count = document.createElement("span");
    count.className = "route-count";
    count.textContent = `${route.station_count} stops`;

    button.append(swatch, label, count);
    button.addEventListener("click", () => selectRoute(route.route_id));
    elements.routeList.append(button);
  }
}

function initializeMap() {
  if (typeof maplibregl === "undefined") {
    throw new Error("MapLibre did not load from the CDN");
  }

  state.map = new maplibregl.Map({
    container: "map",
    style: "https://demotiles.maplibre.org/style.json",
    center: [101.69, 3.14],
    zoom: 10,
    attributionControl: true,
  });
  state.map.addControl(new maplibregl.NavigationControl(), "top-right");

  state.map.on("load", () => {
    state.map.addSource("rail-shapes", { type: "geojson", data: state.shapes });
    state.map.addLayer({
      id: "rail-shapes",
      type: "line",
      source: "rail-shapes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["concat", "#", ["get", "color"]],
        "line-width": 4,
        "line-opacity": 0.88,
      },
    });

    state.map.addSource("rail-stops", { type: "geojson", data: state.stops });
    state.map.addLayer({
      id: "rail-stops",
      type: "circle",
      source: "rail-stops",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 13, 5.5],
        "circle-color": "#fffdf8",
        "circle-stroke-color": "#1c2522",
        "circle-stroke-width": 1.5,
      },
    });

    state.map.on("click", "rail-stops", showStopPopup);
    state.map.on("mouseenter", "rail-stops", () => {
      state.map.getCanvas().style.cursor = "pointer";
    });
    state.map.on("mouseleave", "rail-stops", () => {
      state.map.getCanvas().style.cursor = "";
    });

    fitFeatures(state.shapes.features, state.stops.features);
    elements.mapStatus.textContent = `${state.routes.length} routes · select a route to focus`;
  });

  state.map.on("error", (event) => {
    console.warn("MapLibre error", event.error);
  });
}

function showStopPopup(event) {
  const feature = event.features?.[0];
  if (!feature) return;

  const container = document.createElement("div");
  const name = document.createElement("strong");
  const routes = document.createElement("span");
  name.textContent = feature.properties.stop_name;
  const routeIds = parseRouteIds(feature.properties.route_ids);
  routes.textContent = routeIds.length ? `Routes: ${routeIds.join(", ")}` : "No route membership";
  container.append(name, routes);

  new maplibregl.Popup()
    .setLngLat(feature.geometry.coordinates)
    .setDOMContent(container)
    .addTo(state.map);
}

function selectRoute(routeId) {
  state.selectedRouteId = routeId;
  for (const button of elements.routeList.querySelectorAll(".route-button")) {
    button.classList.toggle("active", button.dataset.routeId === routeId);
  }

  const shapes = state.shapes.features.filter(
    (feature) => feature.properties.route_id === routeId,
  );
  const stops = state.stops.features.filter((feature) =>
    feature.properties.route_ids.includes(routeId),
  );
  updateMapData(shapes, stops);
  fitFeatures(shapes, stops);
  renderRouteDetails(routeId);

  const route = state.routes.find((candidate) => candidate.route_id === routeId);
  elements.mapStatus.textContent = `${route.long_name} · ${stops.length} mapped stops`;
}

function showAllRoutes() {
  state.selectedRouteId = null;
  for (const button of elements.routeList.querySelectorAll(".route-button")) {
    button.classList.remove("active");
  }
  updateMapData(state.shapes.features, state.stops.features);
  fitFeatures(state.shapes.features, state.stops.features);
  elements.routeDetails.className = "empty-state";
  elements.routeDetails.textContent =
    "Choose a route to inspect its patterns, stations, and frequency windows.";
  elements.mapStatus.textContent = `${state.routes.length} routes · whole network`;
}

function updateMapData(shapeFeatures, stopFeatures) {
  if (!state.map?.isStyleLoaded()) return;
  state.map.getSource("rail-shapes").setData({
    type: "FeatureCollection",
    features: shapeFeatures,
  });
  state.map.getSource("rail-stops").setData({
    type: "FeatureCollection",
    features: stopFeatures,
  });
}

function renderRouteDetails(routeId) {
  const route = state.routes.find((candidate) => candidate.route_id === routeId);
  const patterns = state.patterns.filter((pattern) => pattern.route_id === routeId);
  const frequencies = state.frequencies.filter(
    (frequency) => frequency.route_id === routeId,
  );

  elements.routeDetails.className = "route-summary";
  elements.routeDetails.replaceChildren();

  const heading = document.createElement("h3");
  const subheading = document.createElement("p");
  heading.textContent = route.long_name;
  subheading.textContent = `${route.route_id} · ${route.station_count} stops · ${route.pattern_count} patterns`;
  elements.routeDetails.append(heading, subheading);

  if (patterns.length) {
    const picker = document.createElement("select");
    picker.className = "pattern-picker";
    picker.setAttribute("aria-label", "Route pattern");
    patterns.forEach((pattern, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      const direction = pattern.direction_id ?? "?";
      option.textContent = `Direction ${direction} · ${pattern.stop_count} stops`;
      picker.append(option);
    });
    elements.routeDetails.append(picker);

    const stopContainer = document.createElement("div");
    elements.routeDetails.append(stopContainer);
    const renderPattern = () =>
      renderStopPattern(stopContainer, patterns[Number(picker.value)]);
    picker.addEventListener("change", renderPattern);
    renderPattern();
  }

  const frequencyLabel = document.createElement("p");
  frequencyLabel.className = "detail-label";
  frequencyLabel.textContent = "Frequency windows";
  elements.routeDetails.append(frequencyLabel);

  if (!frequencies.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No frequencies.txt rows for this route.";
    elements.routeDetails.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "frequency-list";
  const unique = uniqueFrequencyRows(frequencies).slice(0, 10);
  for (const frequency of unique) {
    const item = document.createElement("li");
    const service = frequency.service_id ? `${frequency.service_id}: ` : "";
    item.textContent = `${service}${frequency.start_time}–${frequency.end_time}, every ${formatHeadway(frequency.headway_secs)}`;
    list.append(item);
  }
  elements.routeDetails.append(list);
}

function renderStopPattern(container, pattern) {
  container.replaceChildren();
  const label = document.createElement("p");
  label.className = "detail-label";
  label.textContent = "Ordered stops";
  const list = document.createElement("ol");
  list.className = "stop-list";
  const stopLookup = new Map(
    state.stops.features.map((feature) => [
      feature.properties.stop_id,
      feature.properties.stop_name,
    ]),
  );
  for (const stopId of pattern.stop_ids) {
    const item = document.createElement("li");
    item.textContent = stopLookup.get(stopId) || stopId;
    list.append(item);
  }
  container.append(label, list);
}

function renderQuality() {
  elements.qualityList.replaceChildren();
  for (const finding of state.quality) {
    const details = document.createElement("details");
    details.className = "quality-item";
    const summary = document.createElement("summary");
    const severity = document.createElement("span");
    const body = document.createElement("div");
    severity.className = `severity ${finding.severity}`;
    severity.textContent = finding.severity;
    summary.append(severity, document.createTextNode(finding.message));
    body.className = "quality-body";
    body.textContent = `${finding.table || "feed"} · ${finding.count.toLocaleString()} occurrence${finding.count === 1 ? "" : "s"}${finding.examples.length ? ` · examples: ${finding.examples.join(", ")}` : ""}`;
    details.append(summary, body);
    elements.qualityList.append(details);
  }
}

function renderCharts() {
  if (typeof Chart === "undefined") {
    document.querySelectorAll(".chart-card").forEach((card) => card.remove());
    return;
  }

  new Chart(document.querySelector("#route-chart"), {
    type: "bar",
    data: {
      labels: state.routes.map((route) => route.short_name),
      datasets: [
        {
          label: "Stops",
          data: state.routes.map((route) => route.station_count),
          backgroundColor: state.routes.map((route) => `#${route.color}`),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });

  const severities = ["error", "warning", "info"];
  const counts = severities.map(
    (severity) => state.quality.filter((finding) => finding.severity === severity).length,
  );
  new Chart(document.querySelector("#quality-chart"), {
    type: "doughnut",
    data: {
      labels: severities,
      datasets: [{ data: counts }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function fitFeatures(shapeFeatures, stopFeatures) {
  if (!state.map) return;
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of shapeFeatures) {
    for (const coordinate of feature.geometry.coordinates) bounds.extend(coordinate);
  }
  for (const feature of stopFeatures) bounds.extend(feature.geometry.coordinates);
  if (!bounds.isEmpty()) {
    state.map.fitBounds(bounds, { padding: 48, duration: 600, maxZoom: 13 });
  }
}

function parseRouteIds(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function uniqueFrequencyRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [
      row.service_id,
      row.direction_id,
      row.start_time,
      row.end_time,
      row.headway_secs,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatHeadway(seconds) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric)) return "an unspecified interval";
  if (numeric % 60 === 0) return `${numeric / 60} min`;
  return `${numeric} sec`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "unknown date");
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(date);
}
