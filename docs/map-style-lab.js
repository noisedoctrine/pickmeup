"use strict";

const MAP_STYLE_LAB = Object.freeze({
  waitIntervalMs: 60,
  waitLimit: 250,
  defaultInterchange: "hub",
  defaultLine: "balanced",
  defaultStation: "outlined",
  sourceId: "metro-interchange-symbols",
  layerIds: Object.freeze({
    base: "metro-interchange-base",
    core: "metro-interchange-core",
    petals: Object.freeze([
      "metro-interchange-petal-1",
      "metro-interchange-petal-2",
      "metro-interchange-petal-3",
      "metro-interchange-petal-4",
    ]),
  }),
});

const MAP_STYLE_PRESETS = Object.freeze({
  interchange: Object.freeze({
    hub: Object.freeze({
      label: "Hub disc",
      note: "A compact white interchange hub with a dark edge and route-colour core.",
      base: true,
      core: true,
      petals: false,
      legacy: false,
    }),
    petals: Object.freeze({
      label: "Route petals",
      note: "Small route-colour petals expose the lines available at each interchange.",
      base: true,
      core: true,
      petals: true,
      legacy: false,
    }),
    target: Object.freeze({
      label: "Target rings",
      note: "A restrained double-ring symbol keeps interchanges visible without a floating halo.",
      base: true,
      core: true,
      petals: false,
      legacy: false,
    }),
    legacy: Object.freeze({
      label: "Legacy halo",
      note: "The previous white halo and dark ring remain available as a comparison baseline.",
      base: false,
      core: false,
      petals: false,
      legacy: true,
    }),
  }),
  line: Object.freeze({
    balanced: Object.freeze({
      label: "Balanced casing",
      note: "The current contrast-aware line casing balances geography and diagram clarity.",
      casingColor: ["get", "casing_color"],
      casingWidth: 7,
      casingOpacity: 0.92,
      lineWidth: 4.5,
      lineOpacity: 0.94,
    }),
    white: Object.freeze({
      label: "White-cased schematic",
      note: "A wider white casing separates crossing lines from the basemap and from each other.",
      casingColor: "rgba(255,253,248,.98)",
      casingWidth: 9.5,
      casingOpacity: 0.98,
      lineWidth: 5.5,
      lineOpacity: 1,
    }),
    dark: Object.freeze({
      label: "Dark-cased schematic",
      note: "A near-black outline gives pale routes and dense central corridors stronger definition.",
      casingColor: "rgba(8,12,11,.9)",
      casingWidth: 9.5,
      casingOpacity: 0.96,
      lineWidth: 5.5,
      lineOpacity: 1,
    }),
    ribbon: Object.freeze({
      label: "Colour ribbons",
      note: "Wide route-colour ribbons reduce casing and make the network the dominant map layer.",
      casingColor: "rgba(255,255,255,0)",
      casingWidth: 1,
      casingOpacity: 0,
      lineWidth: 7,
      lineOpacity: 0.84,
    }),
  }),
  station: Object.freeze({
    outlined: Object.freeze({
      label: "Route outline",
      note: "White stations with route-colour outlines preserve the current geographic-map treatment.",
      haloColor: "rgba(255,255,255,.94)",
      haloOpacity: ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.88],
      fillColor: "#fffdf8",
      strokeColor: ["get", "primary_color"],
    }),
    solid: Object.freeze({
      label: "Solid route colour",
      note: "Filled route-colour stations read more like compact schematic-map nodes.",
      haloColor: "rgba(255,255,255,.96)",
      haloOpacity: ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.9],
      fillColor: ["get", "primary_color"],
      strokeColor: "#fffdf8",
    }),
    diagram: Object.freeze({
      label: "Diagram node",
      note: "Neutral white nodes with dark outlines separate station identity from route colour.",
      haloColor: "rgba(255,255,255,.96)",
      haloOpacity: ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.9],
      fillColor: "#fffdf8",
      strokeColor: "#1c2522",
    }),
    minimal: Object.freeze({
      label: "Minimal dot",
      note: "Small route-colour dots remove the station halo so line geometry carries more of the map.",
      haloColor: "rgba(255,255,255,0)",
      haloOpacity: 0,
      fillColor: ["get", "primary_color"],
      strokeColor: "rgba(255,255,255,0)",
    }),
  }),
});

const metroStationMarkerFeatures =
  typeof stationMarkerFeatures === "function"
    ? stationMarkerFeatures
    : typeof require !== "undefined"
      ? require("./station-model.js").stationMarkerFeatures
      : null;

const mapStyleLabState = {
  interchange: MAP_STYLE_LAB.defaultInterchange,
  line: MAP_STYLE_LAB.defaultLine,
  station: MAP_STYLE_LAB.defaultStation,
  ready: false,
  elements: {},
};

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    installMapStyleLabControls();
    waitForMapStyleLab();
  });
}

const originalApplySharedTrackMode =
  typeof applySharedTrackMode === "function" ? applySharedTrackMode : null;
if (originalApplySharedTrackMode) {
  applySharedTrackMode = function applySharedTrackModeWithMetroStyles() {
    originalApplySharedTrackMode();
    updateMetroInterchangeSource();
  };
}

const originalApplyRefinedRouteFocus =
  typeof applyRefinedRouteFocus === "function" ? applyRefinedRouteFocus : null;
if (originalApplyRefinedRouteFocus) {
  applyRefinedRouteFocus = function applyRefinedRouteFocusWithMetroStyles(routeId) {
    originalApplyRefinedRouteFocus(routeId);
    updateMetroInterchangeSource();
  };
}

function installMapStyleLabControls() {
  const host = document.querySelector(".map-experiments");
  const walkControl = document.querySelector("#show-walk-links")?.closest("label");
  if (!host || document.querySelector("#interchange-symbol-mode")) return;

  const fields = document.createElement("div");
  fields.className = "map-style-lab-fields";
  fields.innerHTML = `
    ${styleSelectMarkup(
      "interchange-symbol-mode",
      "Interchange symbols",
      MAP_STYLE_PRESETS.interchange,
      mapStyleLabState.interchange,
    )}
    ${styleSelectMarkup(
      "rail-line-style",
      "Rail line treatment",
      MAP_STYLE_PRESETS.line,
      mapStyleLabState.line,
    )}
    ${styleSelectMarkup(
      "station-symbol-style",
      "Ordinary stations",
      MAP_STYLE_PRESETS.station,
      mapStyleLabState.station,
    )}
  `;
  host.insertBefore(fields, walkControl || document.querySelector("#map-experiment-note"));

  mapStyleLabState.elements = {
    interchange: fields.querySelector("#interchange-symbol-mode"),
    line: fields.querySelector("#rail-line-style"),
    station: fields.querySelector("#station-symbol-style"),
    note: document.querySelector("#map-experiment-note"),
  };

  for (const [group, element] of Object.entries(mapStyleLabState.elements)) {
    if (group === "note" || !element) continue;
    element.addEventListener("change", () => {
      mapStyleLabState[group] = element.value;
      applyMapStyleLab();
      showMapStyleNote(group, element.value);
    });
  }
  showMapStyleNote("interchange", mapStyleLabState.interchange);
}

function styleSelectMarkup(id, label, presets, selected) {
  const options = Object.entries(presets)
    .map(
      ([value, preset]) =>
        `<option value="${escapeMapStyleHtml(value)}"${value === selected ? " selected" : ""}>${escapeMapStyleHtml(preset.label)}</option>`,
    )
    .join("");
  return `<label class="experiment-field">${escapeMapStyleHtml(label)}<select id="${escapeMapStyleHtml(id)}">${options}</select></label>`;
}

function waitForMapStyleLab(attempt = 0) {
  if (attempt >= MAP_STYLE_LAB.waitLimit) return;
  if (
    typeof state === "undefined" ||
    !state.map ||
    !state.stationModel ||
    !state.map.getLayer("rail-casing") ||
    !state.map.getLayer("rail-shapes") ||
    !state.map.getLayer("station-halo") ||
    !state.map.getLayer("rail-stops") ||
    !state.map.getLayer("station-interchange-ring")
  ) {
    window.setTimeout(() => waitForMapStyleLab(attempt + 1), MAP_STYLE_LAB.waitIntervalMs);
    return;
  }

  addMetroInterchangeLayers();
  updateMetroInterchangeSource();
  mapStyleLabState.ready = true;
  applyMapStyleLab();
}

function addMetroInterchangeLayers() {
  if (!state.map.getSource(MAP_STYLE_LAB.sourceId)) {
    state.map.addSource(MAP_STYLE_LAB.sourceId, {
      type: "geojson",
      data: metroInterchangeFeatures(
        state.stationModel,
        state.routes,
        refinedMapState.sharedTrackMode,
        state.selectedRouteId,
      ),
    });
  }

  const beforeId = state.map.getLayer("rail-stops") ? "rail-stops" : undefined;
  addMetroLayer(
    {
      id: MAP_STYLE_LAB.layerIds.base,
      type: "circle",
      source: MAP_STYLE_LAB.sourceId,
      paint: {
        "circle-radius": metroOuterRadius(),
        "circle-color": "#fffdf8",
        "circle-stroke-color": "#1c2522",
        "circle-stroke-width": 2.5,
      },
    },
    beforeId,
  );

  const petalOffsets = [
    [0, -14],
    [14, 0],
    [0, 14],
    [-14, 0],
  ];
  MAP_STYLE_LAB.layerIds.petals.forEach((layerId, index) => {
    addMetroLayer(
      {
        id: layerId,
        type: "circle",
        source: MAP_STYLE_LAB.sourceId,
        filter: [">=", ["get", "route_count"], index + 1],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.2, 13, 4.2, 16, 4.8],
          "circle-color": ["get", `route_color_${index + 1}`],
          "circle-stroke-color": "#1c2522",
          "circle-stroke-width": 1,
          "circle-translate": petalOffsets[index],
        },
      },
      beforeId,
    );
  });

  addMetroLayer(
    {
      id: MAP_STYLE_LAB.layerIds.core,
      type: "circle",
      source: MAP_STYLE_LAB.sourceId,
      paint: {
        "circle-radius": metroCoreRadius(),
        "circle-color": ["get", "route_color_1"],
        "circle-stroke-color": "#fffdf8",
        "circle-stroke-width": 1.5,
      },
    },
    beforeId,
  );
}

function addMetroLayer(layer, beforeId) {
  if (!state.map.getLayer(layer.id)) state.map.addLayer(layer, beforeId);
}

function metroOuterRadius() {
  return ["interpolate", ["linear"], ["zoom"], 9, 8, 13, 12.5, 16, 15.5];
}

function metroCoreRadius() {
  return ["interpolate", ["linear"], ["zoom"], 9, 3.4, 13, 6, 16, 8];
}

function applyMapStyleLab() {
  if (!mapStyleLabState.ready || !state.map) return;
  applyInterchangePreset(mapStyleLabState.interchange);
  applyLinePreset(mapStyleLabState.line);
  applyStationPreset(mapStyleLabState.station);
}

function applyInterchangePreset(name) {
  const preset = MAP_STYLE_PRESETS.interchange[name] || MAP_STYLE_PRESETS.interchange.hub;
  setMetroLayerVisibility(MAP_STYLE_LAB.layerIds.base, preset.base);
  setMetroLayerVisibility(MAP_STYLE_LAB.layerIds.core, preset.core);
  for (const layerId of MAP_STYLE_LAB.layerIds.petals) {
    setMetroLayerVisibility(layerId, preset.petals);
  }

  const legacyOpacity = preset.legacy ? 1 : 0;
  const hitRadius = preset.legacy
    ? ["interpolate", ["linear"], ["zoom"], 9, 6, 13, 11, 16, 14]
    : ["interpolate", ["linear"], ["zoom"], 9, 10, 13, 15, 16, 18];
  state.map.setPaintProperty("station-interchange-halo", "circle-opacity", legacyOpacity);
  state.map.setPaintProperty("station-interchange-halo", "circle-stroke-opacity", legacyOpacity);
  state.map.setPaintProperty("station-interchange-ring", "circle-radius", hitRadius);
  state.map.setPaintProperty(
    "station-interchange-ring",
    "circle-stroke-width",
    preset.legacy ? 2 : 8,
  );
  state.map.setPaintProperty("station-interchange-ring", "circle-opacity", 0);
  state.map.setPaintProperty(
    "station-interchange-ring",
    "circle-stroke-opacity",
    legacyOpacity,
  );

  if (name === "target") {
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.base, "circle-color", "#fffdf8");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.base, "circle-stroke-color", "#1c2522");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.base, "circle-stroke-width", 3);
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.core, "circle-color", "#fffdf8");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.core, "circle-stroke-color", "#1c2522");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.core, "circle-stroke-width", 1.5);
  } else if (name === "petals") {
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.base, "circle-color", "#fffdf8");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.base, "circle-stroke-color", "#1c2522");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.base, "circle-stroke-width", 2);
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.core, "circle-color", "#fffdf8");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.core, "circle-stroke-color", "#1c2522");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.core, "circle-stroke-width", 1.25);
  } else {
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.base, "circle-color", "#fffdf8");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.base, "circle-stroke-color", "#1c2522");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.base, "circle-stroke-width", 2.5);
    state.map.setPaintProperty(
      MAP_STYLE_LAB.layerIds.core,
      "circle-color",
      ["get", "route_color_1"],
    );
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.core, "circle-stroke-color", "#fffdf8");
    state.map.setPaintProperty(MAP_STYLE_LAB.layerIds.core, "circle-stroke-width", 1.5);
  }
}

function applyLinePreset(name) {
  const preset = MAP_STYLE_PRESETS.line[name] || MAP_STYLE_PRESETS.line.balanced;
  state.map.setPaintProperty("rail-casing", "line-color", preset.casingColor);
  state.map.setPaintProperty("rail-casing", "line-width", preset.casingWidth);
  state.map.setPaintProperty("rail-casing", "line-opacity", preset.casingOpacity);
  state.map.setPaintProperty("rail-shapes", "line-width", preset.lineWidth);
  state.map.setPaintProperty("rail-shapes", "line-opacity", preset.lineOpacity);
}

function applyStationPreset(name) {
  const preset = MAP_STYLE_PRESETS.station[name] || MAP_STYLE_PRESETS.station.outlined;
  state.map.setPaintProperty("station-halo", "circle-color", preset.haloColor);
  state.map.setPaintProperty("station-halo", "circle-opacity", preset.haloOpacity);
  state.map.setPaintProperty("rail-stops", "circle-color", preset.fillColor);
  state.map.setPaintProperty("rail-stops", "circle-stroke-color", preset.strokeColor);
}

function setMetroLayerVisibility(layerId, visible) {
  if (state.map.getLayer(layerId)) {
    state.map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

function updateMetroInterchangeSource() {
  if (
    typeof state === "undefined" ||
    !state.map ||
    !state.stationModel ||
    !state.map.getSource(MAP_STYLE_LAB.sourceId)
  ) {
    return;
  }
  state.map.getSource(MAP_STYLE_LAB.sourceId).setData(
    metroInterchangeFeatures(
      state.stationModel,
      state.routes,
      refinedMapState.sharedTrackMode,
      state.selectedRouteId,
    ),
  );
}

function metroInterchangeFeatures(model, routes, mode = "boundaries", selectedRouteId = null) {
  const routeById = new Map((routes || []).map((route) => [String(route.route_id), route]));
  const source = metroStationMarkerFeatures
    ? metroStationMarkerFeatures(model, mode)
    : { type: "FeatureCollection", features: [] };
  const features = (source.features || [])
    .filter(
      (feature) =>
        !selectedRouteId ||
        parseMetroArray(feature.properties?.route_ids).includes(String(selectedRouteId)),
    )
    .map((feature) => {
      const routeIds = parseMetroArray(feature.properties?.route_ids);
      const colors = routeIds.map((routeId) =>
        normalizeMetroColor(routeById.get(routeId)?.color, "5f6b7a"),
      );
      const fallback = colors[0] || "#5f6b7a";
      return {
        ...feature,
        properties: {
          ...feature.properties,
          route_count: routeIds.length,
          route_color_1: colors[0] || fallback,
          route_color_2: colors[1] || fallback,
          route_color_3: colors[2] || fallback,
          route_color_4: colors[3] || fallback,
        },
      };
    });
  return { type: "FeatureCollection", features };
}

function parseMetroArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function normalizeMetroColor(value, fallback) {
  const normalized = String(value || fallback).trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(normalized)) {
    return `#${normalized
      .split("")
      .map((part) => `${part}${part}`)
      .join("")}`;
  }
  return /^[0-9a-f]{6}$/i.test(normalized) ? `#${normalized}` : `#${fallback}`;
}

function showMapStyleNote(group, name) {
  const note = mapStyleLabState.elements.note;
  const preset = MAP_STYLE_PRESETS[group]?.[name];
  if (note && preset) note.textContent = preset.note;
}

function escapeMapStyleHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MAP_STYLE_LAB,
    MAP_STYLE_PRESETS,
    metroInterchangeFeatures,
    normalizeMetroColor,
    parseMetroArray,
    styleSelectMarkup,
  };
}
