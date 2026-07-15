"use strict";

const REFINED_MAP = Object.freeze({
  codeZoom: 12.25,
  balancedNameZoom: 14.75,
  denseNameZoom: 13.75,
  settleDelayMs: 200,
  transitionMs: 100,
});

const refinedMapState = {
  labelMode: "balanced",
  sharedTrackMode: "boundaries",
  showWalkLinks: true,
  tier: "overview",
  tierTimer: null,
  hoverPopup: null,
  hoverIdentity: null,
  hoveredFeatureId: null,
};

let refinedInterchangePromise = null;

if (typeof window !== "undefined") {
  refinedInterchangePromise = fetchJson(
    new URL("./data/interchanges.json", window.location.href),
  ).catch((error) => {
    console.warn("Could not load curated interchange data", error);
    return { records: [] };
  });

  initializeMap = function initializeRefinedMap() {
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
      cancelPendingTileRequestsWhileZooming: true,
    });
    state.map.addControl(new maplibregl.NavigationControl(), "top-right");

    state.map.on("load", async () => {
      const interchangeDocument = await refinedInterchangePromise;
      state.stationModel = buildStationModel(state.stops, state.patterns, state.routes);
      state.stationDisplay = state.stationModel.features;
      state.refinedTransfers = buildRefinedTransfers(
        interchangeDocument.records || [],
        state.stationModel,
      );

      addRailLayers();
      addRefinedInterchangeLayers();
      addRefinedStationLayers();
      bindMapExperimentControls();
      registerRefinedMapInteractions();
      applyStationTier(refinedStationTier(state.map.getZoom()), true);
      applySharedTrackMode();
      applyWalkLinksVisibility();
      fitFeatures(state.shapes.features, state.stationDisplay.features);
      elements.mapStatus.textContent = `${state.routes.length} routes · select a route to focus`;
    });

    state.map.on("zoomstart", () => {
      window.clearTimeout(refinedMapState.tierTimer);
      closeHoverPopup();
      hideStationSymbols();
    });
    state.map.on("zoomend", () => {
      window.clearTimeout(refinedMapState.tierTimer);
      refinedMapState.tierTimer = window.setTimeout(
        () => applyStationTier(refinedStationTier(state.map.getZoom())),
        REFINED_MAP.settleDelayMs,
      );
    });
    state.map.on("error", (event) => console.warn("MapLibre error", event.error));
  };

  selectRoute = function selectRefinedRoute(routeId) {
    state.selectedRouteId = routeId;
    for (const button of elements.routeList.querySelectorAll(".route-button")) {
      button.classList.toggle("active", button.dataset.routeId === routeId);
    }
    const shapes = state.shapes.features.filter(
      (feature) => feature.properties.route_id === routeId,
    );
    const stations = state.stationDisplay.features.filter((feature) =>
      parseStationArray(feature.properties.route_ids).includes(routeId),
    );
    updateMapData(shapes, stations);
    applyRefinedRouteFocus(routeId);
    fitFeatures(shapes, stations);
    renderRouteDetails(routeId);
    const route = state.routes.find((candidate) => candidate.route_id === routeId);
    elements.mapStatus.textContent = `${route.long_name} · ${stations.length} mapped stations`;
  };

  showAllRoutes = function showAllRefinedRoutes() {
    state.selectedRouteId = null;
    for (const button of elements.routeList.querySelectorAll(".route-button")) {
      button.classList.remove("active");
    }
    updateMapData(state.shapes.features, state.stationDisplay.features);
    applyRefinedRouteFocus(null);
    fitFeatures(state.shapes.features, state.stationDisplay.features);
    elements.routeDetails.className = "empty-state";
    elements.routeDetails.textContent =
      "Choose a route to inspect its patterns, stations, and frequency windows.";
    elements.mapStatus.textContent = `${state.routes.length} routes · whole network`;
  };
}

function addRefinedInterchangeLayers() {
  state.map.addSource("curated-transfers", {
    type: "geojson",
    data: state.refinedTransfers.lines,
  });
  state.map.addLayer({
    id: "transfer-casing",
    type: "line",
    source: "curated-transfers",
    paint: {
      "line-color": "rgba(255,255,255,.95)",
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
  state.map.addSource("station-interchanges", {
    type: "geojson",
    data: markerFeatures(),
  });
  state.map.addLayer({
    id: "station-interchange-halo",
    type: "circle",
    source: "station-interchanges",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 13, 11, 16, 14],
      "circle-color": "rgba(255,255,255,0)",
      "circle-stroke-color": "rgba(255,255,255,.96)",
      "circle-stroke-width": 5,
    },
  });
  state.map.addLayer({
    id: "station-interchange-ring",
    type: "circle",
    source: "station-interchanges",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 13, 11, 16, 14],
      "circle-color": "rgba(255,255,255,0)",
      "circle-stroke-color": "#1c2522",
      "circle-stroke-width": 2,
    },
  });
}

function addRefinedStationLayers() {
  const transition = { duration: REFINED_MAP.transitionMs, delay: 0 };
  state.map.addSource("rail-stops", { type: "geojson", data: state.stationDisplay });
  state.map.addLayer({
    id: "station-halo",
    type: "circle",
    source: "rail-stops",
    paint: {
      "circle-radius": 5.6,
      "circle-radius-transition": transition,
      "circle-color": "rgba(255,255,255,.94)",
      "circle-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.88],
    },
  });
  state.map.addLayer({
    id: "rail-stops",
    type: "circle",
    source: "rail-stops",
    paint: {
      "circle-radius": 3.8,
      "circle-radius-transition": transition,
      "circle-color": "#fffdf8",
      "circle-stroke-color": ["get", "primary_color"],
      "circle-stroke-width": 2,
      "circle-stroke-width-transition": transition,
    },
  });
  state.map.addLayer({
    id: "station-codes",
    type: "symbol",
    source: "rail-stops",
    layout: {
      "text-field": ["get", "display_code"],
      "text-size": 8.5,
      "text-line-height": 0.9,
      "text-anchor": "center",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      visibility: "none",
    },
    paint: {
      "text-color": "#1c2522",
      "text-halo-color": "rgba(255,255,255,.75)",
      "text-halo-width": 0.5,
      "text-opacity": 0,
      "text-opacity-transition": transition,
    },
  });
  state.map.addLayer({
    id: "station-names",
    type: "symbol",
    source: "rail-stops",
    layout: {
      "text-field": ["get", "stop_name"],
      "text-size": 11.5,
      "text-max-width": 9,
      "text-line-height": 1.08,
      "text-anchor": "top",
      "text-offset": [0, 1.35],
      "text-padding": 3,
      "text-optional": true,
      "text-allow-overlap": false,
      "symbol-sort-key": ["get", "sort_key"],
      visibility: "none",
    },
    paint: {
      "text-color": "#16201d",
      "text-halo-color": "rgba(255,255,255,.98)",
      "text-halo-width": 2.25,
      "text-halo-blur": 0.35,
      "text-opacity": 0,
      "text-opacity-transition": transition,
    },
  });
}

function bindMapExperimentControls() {
  const label = document.querySelector("#station-label-mode");
  const markers = document.querySelector("#shared-track-mode");
  const walks = document.querySelector("#show-walk-links");
  const note = document.querySelector("#map-experiment-note");
  label.value = refinedMapState.labelMode;
  markers.value = refinedMapState.sharedTrackMode;
  walks.checked = refinedMapState.showWalkLinks;

  label.addEventListener("change", () => {
    refinedMapState.labelMode = label.value;
    state.map.setLayoutProperty(
      "station-names",
      "text-size",
      label.value === "dense" ? 10.5 : 11.5,
    );
    state.map.setLayoutProperty(
      "station-names",
      "text-max-width",
      label.value === "dense" ? 8 : 9,
    );
    applyStationTier(refinedStationTier(state.map.getZoom()));
    note.textContent = label.selectedOptions[0].dataset.note;
  });
  markers.addEventListener("change", () => {
    refinedMapState.sharedTrackMode = markers.value;
    applyRefinedRouteFocus(state.selectedRouteId);
  });
  walks.addEventListener("change", () => {
    refinedMapState.showWalkLinks = walks.checked;
    applyWalkLinksVisibility();
  });
}

function registerRefinedMapInteractions() {
  registerHoverLayer("rail-stops", showStationHover);
  registerClickLayer("rail-stops", showStationPinned);
  registerHoverLayer("station-interchange-ring", showInterchangeHover);
  registerClickLayer("station-interchange-ring", showInterchangePinned);
  registerHoverLayer("transfer-integrated", showTransferHover);
  registerHoverLayer("transfer-optional", showTransferHover);
  registerClickLayer("transfer-integrated", showTransferPinned);
  registerClickLayer("transfer-optional", showTransferPinned);
}

function registerHoverLayer(layerId, handler) {
  state.map.on("mouseenter", layerId, (event) => {
    state.map.getCanvas().style.cursor = "pointer";
    handler(event);
  });
  state.map.on("mousemove", layerId, handler);
  state.map.on("mouseleave", layerId, () => {
    state.map.getCanvas().style.cursor = "";
    closeHoverPopup();
    clearHoveredStation();
  });
}

function registerClickLayer(layerId, handler) {
  state.map.on("click", layerId, handler);
}

function showStationHover(event) {
  const feature = event.features?.[0];
  if (!feature) return;
  setHoveredStation(feature);
  showHoverPopup(
    feature.geometry.coordinates,
    stationPopup(feature, false),
    feature.properties.group_id,
  );
}

function showStationPinned(event) {
  const feature = event.features?.[0];
  if (!feature) return;
  new maplibregl.Popup({ className: "station-pinned-popup" })
    .setLngLat(feature.geometry.coordinates)
    .setDOMContent(stationPopup(feature, true))
    .addTo(state.map);
}

function showInterchangeHover(event) {
  const feature = event.features?.[0];
  if (feature) {
    showHoverPopup(
      feature.geometry.coordinates,
      stationPopup(feature, false),
      feature.properties.group_id,
    );
  }
}

function showInterchangePinned(event) {
  const feature = event.features?.[0];
  if (!feature) return;
  new maplibregl.Popup({ className: "station-pinned-popup" })
    .setLngLat(feature.geometry.coordinates)
    .setDOMContent(stationPopup(feature, true))
    .addTo(state.map);
}

function showTransferHover(event) {
  const feature = event.features?.[0];
  if (feature) showHoverPopup(event.lngLat, transferPopup(feature), feature.properties.id);
}

function showTransferPinned(event) {
  const feature = event.features?.[0];
  if (!feature) return;
  new maplibregl.Popup({ className: "station-pinned-popup" })
    .setLngLat(event.lngLat)
    .setDOMContent(transferPopup(feature))
    .addTo(state.map);
}

function showHoverPopup(lngLat, content, identity) {
  if (refinedMapState.hoverIdentity === identity && refinedMapState.hoverPopup) return;
  closeHoverPopup();
  refinedMapState.hoverIdentity = identity;
  refinedMapState.hoverPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: "station-hover-popup",
    offset: 12,
  })
    .setLngLat(lngLat)
    .setDOMContent(content)
    .addTo(state.map);
}

function closeHoverPopup() {
  refinedMapState.hoverPopup?.remove();
  refinedMapState.hoverPopup = null;
  refinedMapState.hoverIdentity = null;
}

function setHoveredStation(feature) {
  clearHoveredStation();
  refinedMapState.hoveredFeatureId = feature.id;
  if (feature.id !== undefined) {
    state.map.setFeatureState({ source: "rail-stops", id: feature.id }, { hover: true });
  }
}

function clearHoveredStation() {
  if (refinedMapState.hoveredFeatureId !== null) {
    state.map.setFeatureState(
      { source: "rail-stops", id: refinedMapState.hoveredFeatureId },
      { hover: false },
    );
  }
  refinedMapState.hoveredFeatureId = null;
}

function stationPopup(feature, detailed) {
  const group = state.stationModel.groups.find(
    (candidate) => candidate.id === feature.properties.group_id,
  );
  const connections = state.refinedTransfers.connectionIndex.get(group.id) || [];
  const container = popupContainer();
  const heading = document.createElement("strong");
  heading.textContent = group.stop_name;
  const code = document.createElement("span");
  code.className = "popup-code";
  code.textContent = group.stop_ids.join(" · ");
  container.append(heading, code, routeChipRow(group.route_ids));
  const track = sharedTrackDescription(group);
  if (track) {
    const paragraph = document.createElement("p");
    paragraph.textContent = track;
    container.append(paragraph);
  }
  if (connections.length) {
    const list = document.createElement("ul");
    list.className = "connection-list";
    for (const connection of connections) {
      const item = document.createElement("li");
      item.textContent = `${interchangeTypeLabel(connection)}: ${connection.from_name} ↔ ${connection.to_name}`;
      list.append(item);
    }
    container.append(list);
  } else if (detailed && group.route_ids.length === 1) {
    const paragraph = document.createElement("p");
    paragraph.textContent = "No additional interchange is recorded for this station.";
    container.append(paragraph);
  }
  return container;
}

function transferPopup(feature) {
  const record = state.refinedTransfers.records.find(
    (candidate) => candidate.id === feature.properties.id,
  );
  const container = popupContainer();
  const heading = document.createElement("strong");
  heading.textContent = `${record.from_name} ↔ ${record.to_name}`;
  const type = document.createElement("span");
  type.className = "popup-code";
  type.textContent = interchangeTypeLabel(record);
  const paragraph = document.createElement("p");
  paragraph.textContent = record.description || record.osint_summary || "";
  container.append(heading, type, routeChipRow(record.route_ids), paragraph);
  return container;
}

function sharedTrackDescription(group) {
  if (!group.shared_track) {
    return group.route_ids.length > 1 ? "Direct same-station interchange." : "";
  }
  const names = group.shared_track_routes
    .map(
      (routeId) =>
        state.routes.find((route) => route.route_id === routeId)?.short_name || routeId,
    )
    .join(" and ");
  if (group.marker_class === "shared_boundary") {
    return `${names} share tracks here and diverge beyond this station.`;
  }
  if (group.marker_class === "shared_terminus") {
    return `${names} share this terminal section; both services end here.`;
  }
  if (group.route_ids.length > group.shared_track_routes.length) {
    return `${names} share tracks here, with additional line connections available.`;
  }
  return `${names} share the same track through this station; changing between them here adds no new direction.`;
}

function markerFeatures() {
  return stationMarkerFeatures(state.stationModel, refinedMapState.sharedTrackMode);
}

function refinedStationTier(zoom) {
  if (refinedMapState.labelMode === "hover") {
    return zoom >= REFINED_MAP.codeZoom ? "code" : "overview";
  }
  const nameZoom =
    refinedMapState.labelMode === "dense"
      ? REFINED_MAP.denseNameZoom
      : REFINED_MAP.balancedNameZoom;
  if (zoom >= nameZoom) return "name";
  if (zoom >= REFINED_MAP.codeZoom) return "code";
  return "overview";
}

function stationPresentation(tier) {
  if (tier === "name") {
    return { radius: 12, halo: 14.5, stroke: 2.5, code: 1, name: 1 };
  }
  if (tier === "code") {
    return { radius: 11, halo: 13.5, stroke: 2.5, code: 1, name: 0 };
  }
  return { radius: 3.8, halo: 5.6, stroke: 2, code: 0, name: 0 };
}

function hideStationSymbols() {
  if (!state.map?.getLayer("station-codes")) return;
  state.map.setLayoutProperty("station-codes", "visibility", "none");
  state.map.setLayoutProperty("station-names", "visibility", "none");
}

function applyStationTier(tier, immediate = false) {
  if (!state.map?.getLayer("rail-stops")) return;
  refinedMapState.tier = tier;
  const view = stationPresentation(tier);
  state.map.setPaintProperty("station-halo", "circle-radius", view.halo);
  state.map.setPaintProperty("rail-stops", "circle-radius", view.radius);
  state.map.setPaintProperty("rail-stops", "circle-stroke-width", view.stroke);
  revealSymbol("station-codes", tier !== "overview", view.code, immediate);
  revealSymbol(
    "station-names",
    tier === "name" && refinedMapState.labelMode !== "hover",
    view.name,
    immediate,
  );
}

function revealSymbol(layerId, visible, opacity, immediate) {
  state.map.setPaintProperty(layerId, "text-opacity", 0);
  state.map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  if (!visible) return;
  if (immediate) state.map.setPaintProperty(layerId, "text-opacity", opacity);
  else {
    window.requestAnimationFrame(() =>
      state.map.setPaintProperty(layerId, "text-opacity", opacity),
    );
  }
}

function applySharedTrackMode() {
  state.map.getSource("station-interchanges").setData(markerFeatures());
}

function applyWalkLinksVisibility() {
  const visibility = refinedMapState.showWalkLinks ? "visible" : "none";
  for (const layerId of ["transfer-casing", "transfer-integrated", "transfer-optional"]) {
    state.map.setLayoutProperty(layerId, "visibility", visibility);
  }
}

function applyRefinedRouteFocus(routeId) {
  const markers = markerFeatures();
  state.map.getSource("station-interchanges").setData(
    routeId
      ? {
          type: "FeatureCollection",
          features: markers.features.filter((feature) =>
            parseStationArray(feature.properties.route_ids).includes(routeId),
          ),
        }
      : markers,
  );
  const transfers = state.refinedTransfers.lines;
  state.map.getSource("curated-transfers").setData(
    routeId
      ? {
          type: "FeatureCollection",
          features: transfers.features.filter((feature) =>
            parseStationArray(feature.properties.route_ids).includes(routeId),
          ),
        }
      : transfers,
  );
}
