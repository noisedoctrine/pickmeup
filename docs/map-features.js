"use strict";

const STATION_DETAIL = Object.freeze({
  codeZoom: 12.25,
  nameZoom: 14.25,
  settleDelayMs: 200,
  transitionMs: 100,
});

const interchangeDataPromise = fetchJson(
  new URL("./data/interchanges.json", window.location.href),
).catch((error) => {
  console.warn("Could not load curated interchange data", error);
  return { records: [] };
});

initializeMap = function initializeEnhancedMap() {
  if (typeof maplibregl === "undefined") {
    throw new Error("MapLibre did not load from the CDN");
  }

  addRailContrastProperties();
  state.map = new maplibregl.Map({
    container: "map",
    style: "https://demotiles.maplibre.org/style.json",
    center: [101.69, 3.14],
    zoom: 10,
    attributionControl: true,
  });
  state.map.addControl(new maplibregl.NavigationControl(), "top-right");

  let stationTier = stationDetailTier(state.map.getZoom());
  let stationTierTimer = null;

  state.map.on("load", async () => {
    const interchangeDocument = await interchangeDataPromise;
    state.interchangeData = buildInterchangeData(interchangeDocument.records || []);

    addRailLayers();
    addInterchangeLayers();
    addStationLayers(stationTier);
    registerMapInteractions();

    fitFeatures(state.shapes.features, state.stops.features);
    elements.mapStatus.textContent = `${state.routes.length} routes · select a route to focus`;
  });

  state.map.on("zoom", () => {
    const requestedTier = stationDetailTier(state.map.getZoom());
    window.clearTimeout(stationTierTimer);
    if (requestedTier === stationTier) return;

    stationTierTimer = window.setTimeout(() => {
      stationTier = requestedTier;
      applyStationDetailTier(stationTier);
    }, STATION_DETAIL.settleDelayMs);
  });

  state.map.on("error", (event) => {
    console.warn("MapLibre error", event.error);
  });
};

function addRailContrastProperties() {
  for (const feature of state.shapes.features) {
    const color = normalizeHexColor(feature.properties.color, "5f6b7a");
    feature.properties.color = color;
    feature.properties.casing_color = contrastCasingColor(color);
  }
}

function addRailLayers() {
  state.map.addSource("rail-shapes", { type: "geojson", data: state.shapes });
  state.map.addLayer({
    id: "rail-casing",
    type: "line",
    source: "rail-shapes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "casing_color"],
      "line-width": 7,
      "line-opacity": 0.92,
    },
  });
  state.map.addLayer({
    id: "rail-shapes",
    type: "line",
    source: "rail-shapes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["concat", "#", ["get", "color"]],
      "line-width": 4.5,
      "line-opacity": 0.94,
    },
  });
}

function addInterchangeLayers() {
  const { sameStationPoints, curatedTransferLines } = state.interchangeData;

  state.map.addSource("curated-transfers", {
    type: "geojson",
    data: curatedTransferLines,
  });
  state.map.addLayer({
    id: "transfer-casing",
    type: "line",
    source: "curated-transfers",
    paint: {
      "line-color": "rgba(255, 255, 255, 0.95)",
      "line-width": 6,
      "line-opacity": zoomFade(10.25, 11.25, 0.92),
    },
  });
  state.map.addLayer({
    id: "transfer-integrated",
    type: "line",
    source: "curated-transfers",
    filter: ["==", ["get", "runtime_use"], "transfer_edge"],
    paint: {
      "line-color": "#33413d",
      "line-width": 3,
      "line-dasharray": [2, 1.5],
      "line-opacity": zoomFade(10.25, 11.25, 0.95),
    },
  });
  state.map.addLayer({
    id: "transfer-optional",
    type: "line",
    source: "curated-transfers",
    filter: ["==", ["get", "runtime_use"], "optional_out_of_station_edge"],
    paint: {
      "line-color": "#b96516",
      "line-width": 3,
      "line-dasharray": [1, 2.2],
      "line-opacity": zoomFade(10.25, 11.25, 0.95),
    },
  });

  state.map.addSource("same-station-interchanges", {
    type: "geojson",
    data: sameStationPoints,
  });
  state.map.addLayer({
    id: "same-station-halo",
    type: "circle",
    source: "same-station-interchanges",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 13, 11, 16, 14],
      "circle-color": "rgba(255, 255, 255, 0)",
      "circle-stroke-color": "rgba(255, 255, 255, 0.96)",
      "circle-stroke-width": 5,
      "circle-opacity": zoomFade(9, 10.5, 1),
      "circle-stroke-opacity": zoomFade(9, 10.5, 1),
    },
  });
  state.map.addLayer({
    id: "same-station-ring",
    type: "circle",
    source: "same-station-interchanges",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 13, 11, 16, 14],
      "circle-color": "rgba(255, 255, 255, 0)",
      "circle-stroke-color": "#1c2522",
      "circle-stroke-width": 2,
      "circle-opacity": zoomFade(9, 10.5, 1),
      "circle-stroke-opacity": zoomFade(9, 10.5, 1),
    },
  });
}

function addStationLayers(initialTier) {
  const presentation = stationTierPresentation(initialTier);
  const transition = { duration: STATION_DETAIL.transitionMs, delay: 0 };

  state.map.addSource("rail-stops", { type: "geojson", data: state.stops });
  state.map.addLayer({
    id: "rail-stops",
    type: "circle",
    source: "rail-stops",
    paint: {
      "circle-radius": presentation.radius,
      "circle-radius-transition": transition,
      "circle-color": "#fffdf8",
      "circle-stroke-color": "#1c2522",
      "circle-stroke-width": presentation.strokeWidth,
      "circle-stroke-width-transition": transition,
    },
  });
  state.map.addLayer({
    id: "station-codes",
    type: "symbol",
    source: "rail-stops",
    layout: {
      "text-field": ["get", "stop_id"],
      "text-size": 9,
      "text-anchor": "center",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#1c2522",
      "text-opacity": presentation.codeOpacity,
      "text-opacity-transition": transition,
    },
  });
  state.map.addLayer({
    id: "station-names",
    type: "symbol",
    source: "rail-stops",
    layout: {
      "text-field": ["get", "stop_name"],
      "text-size": 12,
      "text-max-width": 10,
      "text-line-height": 1.05,
      "text-variable-anchor": ["top", "bottom", "left", "right"],
      "text-radial-offset": 1.35,
      "text-padding": 2,
      "text-optional": true,
    },
    paint: {
      "text-color": "#1c2522",
      "text-halo-color": "rgba(255, 255, 255, 0.96)",
      "text-halo-width": 1.5,
      "text-halo-blur": 0.5,
      "text-opacity": presentation.nameOpacity,
      "text-opacity-transition": transition,
    },
  });
}

function registerMapInteractions() {
  registerClickableLayer("rail-stops", showEnhancedStationPopup);
  registerClickableLayer("same-station-ring", showSameStationPopup);
  registerClickableLayer("transfer-integrated", showCuratedTransferPopup);
  registerClickableLayer("transfer-optional", showCuratedTransferPopup);
}

function registerClickableLayer(layerId, handler) {
  state.map.on("click", layerId, handler);
  state.map.on("mouseenter", layerId, () => {
    state.map.getCanvas().style.cursor = "pointer";
  });
  state.map.on("mouseleave", layerId, () => {
    state.map.getCanvas().style.cursor = "";
  });
}

function stationDetailTier(zoom) {
  if (zoom >= STATION_DETAIL.nameZoom) return "name";
  if (zoom >= STATION_DETAIL.codeZoom) return "code";
  return "overview";
}

function stationTierPresentation(tier) {
  if (tier === "name") {
    return { radius: 12.5, strokeWidth: 2, codeOpacity: 1, nameOpacity: 1 };
  }
  if (tier === "code") {
    return { radius: 11, strokeWidth: 2, codeOpacity: 1, nameOpacity: 0 };
  }
  return { radius: 3.5, strokeWidth: 1.5, codeOpacity: 0, nameOpacity: 0 };
}

function applyStationDetailTier(tier) {
  if (!state.map?.getLayer("rail-stops")) return;
  const presentation = stationTierPresentation(tier);
  state.map.setPaintProperty("rail-stops", "circle-radius", presentation.radius);
  state.map.setPaintProperty("rail-stops", "circle-stroke-width", presentation.strokeWidth);
  state.map.setPaintProperty("station-codes", "text-opacity", presentation.codeOpacity);
  state.map.setPaintProperty("station-names", "text-opacity", presentation.nameOpacity);
}

function buildInterchangeData(curatedRecords) {
  const stopById = new Map(
    state.stops.features.map((feature) => [feature.properties.stop_id, feature]),
  );
  const connectionIndex = new Map();
  const sameStationRecords = deriveSameStationRecords();
  const acceptedCuratedRecords = curatedRecords
    .filter((record) => record.disposition === "accepted")
    .filter((record) => record.runtime_use !== "exclude")
    .map((record) => resolveCuratedRecord(record, stopById))
    .filter(Boolean);

  for (const record of [...sameStationRecords, ...acceptedCuratedRecords]) {
    for (const stopId of record.stop_ids) {
      const connections = connectionIndex.get(stopId) || [];
      connections.push(record);
      connectionIndex.set(stopId, connections);
    }
  }

  return {
    connectionIndex,
    sameStationRecords,
    curatedRecords: acceptedCuratedRecords,
    sameStationPoints: {
      type: "FeatureCollection",
      features: sameStationRecords.map((record) => ({
        type: "Feature",
        id: record.id,
        properties: {
          id: record.id,
          kind: record.kind,
          stop_name: record.stop_name,
          stop_ids: JSON.stringify(record.stop_ids),
          route_ids: JSON.stringify(record.route_ids),
        },
        geometry: { type: "Point", coordinates: record.center },
      })),
    },
    curatedTransferLines: {
      type: "FeatureCollection",
      features: acceptedCuratedRecords.map((record) => ({
        type: "Feature",
        id: record.id,
        properties: {
          id: record.id,
          kind: record.kind,
          runtime_use: record.runtime_use,
          classification: record.classification,
          route_ids: JSON.stringify(record.route_ids),
          stop_ids: JSON.stringify(record.stop_ids),
          from_name: record.from_name,
          to_name: record.to_name,
          covered: record.covered ? "yes" : "no",
          osint_summary: record.description || record.osint_summary || "",
        },
        geometry: {
          type: "LineString",
          coordinates: [record.from_center, record.to_center],
        },
      })),
    },
  };
}

function deriveSameStationRecords() {
  const groups = new Map();
  for (const feature of state.stops.features) {
    const name = normalizeStationName(feature.properties.stop_name);
    const group = groups.get(name) || [];
    group.push(feature);
    groups.set(name, group);
  }

  const records = [];
  for (const [normalizedName, features] of groups) {
    const routeIds = uniqueSorted(features.flatMap((feature) => parseRouteIds(feature.properties.route_ids)));
    if (routeIds.length < 2) continue;

    const coordinates = features.map((feature) => feature.geometry.coordinates);
    records.push({
      id: `same-station:${normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      kind: "same_station",
      stop_name: String(features[0].properties.stop_name).trim(),
      stop_ids: uniqueSorted(features.map((feature) => feature.properties.stop_id)),
      route_ids: routeIds,
      center: coordinateCentroid(coordinates),
    });
  }
  return records;
}

function resolveCuratedRecord(record, stopById) {
  const fromStops = record.from_stop_ids.map((stopId) => stopById.get(stopId)).filter(Boolean);
  const toStops = record.to_stop_ids.map((stopId) => stopById.get(stopId)).filter(Boolean);
  if (!fromStops.length || !toStops.length) {
    console.warn("Curated interchange does not resolve in the cached snapshot", record.id);
    return null;
  }

  const allStops = [...fromStops, ...toStops];
  return {
    ...record,
    kind: "curated_transfer",
    stop_ids: uniqueSorted(allStops.map((feature) => feature.properties.stop_id)),
    route_ids: uniqueSorted(allStops.flatMap((feature) => parseRouteIds(feature.properties.route_ids))),
    from_name: joinedStationNames(fromStops),
    to_name: joinedStationNames(toStops),
    from_center: coordinateCentroid(fromStops.map((feature) => feature.geometry.coordinates)),
    to_center: coordinateCentroid(toStops.map((feature) => feature.geometry.coordinates)),
  };
}

function showEnhancedStationPopup(event) {
  const feature = event.features?.[0];
  if (!feature) return;

  const stopId = feature.properties.stop_id;
  const directRouteIds = parseRouteIds(feature.properties.route_ids);
  const connections = state.interchangeData.connectionIndex.get(stopId) || [];
  const connectedRouteIds = uniqueSorted([
    ...directRouteIds,
    ...connections.flatMap((connection) => connection.route_ids),
  ]);

  const container = popupContainer();
  const heading = document.createElement("strong");
  heading.textContent = feature.properties.stop_name;
  const code = document.createElement("span");
  code.className = "popup-code";
  code.textContent = stopId;
  container.append(heading, code, routeChipRow(connectedRouteIds));

  if (connections.length) {
    const list = document.createElement("ul");
    list.className = "connection-list";
    for (const connection of connections) {
      const item = document.createElement("li");
      item.append(connectionDescription(connection, stopId));
      list.append(item);
    }
    container.append(list);
  }

  new maplibregl.Popup()
    .setLngLat(feature.geometry.coordinates)
    .setDOMContent(container)
    .addTo(state.map);
}

function showSameStationPopup(event) {
  const feature = event.features?.[0];
  if (!feature) return;
  const stopIds = parseJsonArray(feature.properties.stop_ids);
  const record = state.interchangeData.sameStationRecords.find(
    (candidate) => candidate.id === feature.properties.id,
  );
  if (!record) return;

  const container = popupContainer();
  const heading = document.createElement("strong");
  heading.textContent = record.stop_name;
  const code = document.createElement("span");
  code.className = "popup-code";
  code.textContent = stopIds.join(" · ");
  const detail = document.createElement("p");
  detail.textContent = "Same-station connection between these lines.";
  container.append(heading, code, routeChipRow(record.route_ids), detail);

  new maplibregl.Popup()
    .setLngLat(feature.geometry.coordinates)
    .setDOMContent(container)
    .addTo(state.map);
}

function showCuratedTransferPopup(event) {
  const feature = event.features?.[0];
  if (!feature) return;
  const record = state.interchangeData.curatedRecords.find(
    (candidate) => candidate.id === feature.properties.id,
  );
  if (!record) return;

  const container = popupContainer();
  const heading = document.createElement("strong");
  heading.textContent = `${record.from_name} ↔ ${record.to_name}`;
  const type = document.createElement("span");
  type.className = "popup-code";
  type.textContent = interchangeTypeLabel(record);
  const summary = document.createElement("p");
  summary.textContent = record.description || record.osint_summary || "";
  container.append(heading, type, routeChipRow(record.route_ids), summary);

  new maplibregl.Popup()
    .setLngLat(event.lngLat)
    .setDOMContent(container)
    .addTo(state.map);
}

function popupContainer() {
  const container = document.createElement("div");
  container.className = "station-popup";
  return container;
}

function routeChipRow(routeIds) {
  const row = document.createElement("div");
  row.className = "route-chip-row";
  for (const routeId of routeIds) {
    const route = state.routes.find((candidate) => candidate.route_id === routeId);
    if (!route) continue;
    const chip = document.createElement("span");
    chip.className = "route-chip";
    chip.style.backgroundColor = `#${route.color}`;
    chip.style.color = readableTextColor(route.color);
    chip.textContent = route.short_name || route.route_id;
    chip.title = route.long_name;
    row.append(chip);
  }
  return row;
}

function connectionDescription(connection, stopId) {
  const wrapper = document.createElement("div");
  const heading = document.createElement("strong");
  const detail = document.createElement("span");

  if (connection.kind === "same_station") {
    const otherCodes = connection.stop_ids.filter((candidate) => candidate !== stopId);
    heading.textContent = `Same station · ${otherCodes.join(" · ")}`;
    detail.textContent = "Direct connection between lines at the same named station.";
  } else {
    heading.textContent = interchangeTypeLabel(connection);
    detail.textContent = `${connection.from_name} ↔ ${connection.to_name}. ${connection.description || connection.osint_summary || ""}`;
  }
  wrapper.append(heading, detail);
  return wrapper;
}

function interchangeTypeLabel(record) {
  if (record.runtime_use === "optional_out_of_station_edge") {
    return "Optional out-of-station walk";
  }
  if (record.classification === "official_integrated_transfer") {
    return "Integrated interchange";
  }
  return "Connecting interchange";
}

function zoomFade(startZoom, endZoom, maximumOpacity) {
  return ["interpolate", ["linear"], ["zoom"], startZoom, 0, endZoom, maximumOpacity];
}

function normalizeStationName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function coordinateCentroid(coordinates) {
  const total = coordinates.reduce(
    (accumulator, coordinate) => [
      accumulator[0] + Number(coordinate[0]),
      accumulator[1] + Number(coordinate[1]),
    ],
    [0, 0],
  );
  return [total[0] / coordinates.length, total[1] / coordinates.length];
}

function joinedStationNames(features) {
  return uniqueSorted(features.map((feature) => String(feature.properties.stop_name).trim())).join(" / ");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function normalizeHexColor(value, fallback) {
  const normalized = String(value || fallback).trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(normalized)) {
    return normalized.split("").map((part) => `${part}${part}`).join("");
  }
  return /^[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

function contrastCasingColor(hexColor) {
  return relativeLuminance(hexColor) > 0.48 ? "#1c2522" : "#fffdf8";
}

function readableTextColor(hexColor) {
  return relativeLuminance(normalizeHexColor(hexColor, "5f6b7a")) > 0.48
    ? "#1c2522"
    : "#ffffff";
}

function relativeLuminance(hexColor) {
  const channels = [0, 2, 4]
    .map((offset) => Number.parseInt(hexColor.slice(offset, offset + 2), 16) / 255)
    .map((channel) =>
      channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
