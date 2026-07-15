"use strict";

const STATION_MODEL = Object.freeze({ coLocationDistanceM: 140 });

function buildStationModel(stops, patterns, routes) {
  const routeOrder = new Map(routes.map((route, index) => [route.route_id, index]));
  const routeById = new Map(routes.map((route) => [route.route_id, route]));
  const groups = clusterStationStops(stops.features || []);
  const groupByStopId = new Map();

  for (const group of groups) {
    group.stop_ids = stationUniqueSorted(group.raw.map((feature) => feature.properties.stop_id));
    group.route_ids = stationUniqueSorted(
      group.raw.flatMap((feature) => parseStationArray(feature.properties.route_ids)),
      routeOrder,
    );
    group.center = stationCentroid(group.raw.map((feature) => feature.geometry.coordinates));
    group.stop_name = humanizeStationName(group.raw[0].properties.stop_name);
    group.primary_route_id = group.route_ids[0] || "";
    group.primary_color = normalizeStationColor(
      routeById.get(group.primary_route_id)?.color,
      "5f6b7a",
    );
    group.display_code = stationDisplayCode(group.stop_ids);
    group.sort_key = group.route_ids.length * 10 + Math.min(group.stop_ids.length, 9);
    for (const stopId of group.stop_ids) groupByStopId.set(stopId, group);
  }

  const sequences = stationRouteSequences(patterns, groupByStopId);
  const terminals = stationRouteTerminals(sequences);
  const sharedEdges = stationSharedEdges(sequences, groups);

  for (const group of groups) {
    const incident = sharedEdges.filter((edge) => edge.group_ids.includes(group.id));
    const signatures = stationUniqueObjects(incident, (edge) => edge.route_ids.join("|")).map(
      (edge) => edge.route_ids,
    );
    const primarySignature = signatures.length === 1 ? signatures[0] : [];
    const allTerminate =
      primarySignature.length > 0 &&
      primarySignature.every((routeId) => terminals.get(routeId)?.has(group.id));
    const hasIndependentRoute = group.route_ids.some(
      (routeId) => !primarySignature.includes(routeId),
    );

    group.shared_track = incident.length > 0;
    group.shared_track_routes = stationUniqueSorted(
      incident.flatMap((edge) => edge.route_ids),
      routeOrder,
    );
    group.shared_terminus = signatures.length === 1 && allTerminate;

    if (group.route_ids.length < 2) group.marker_class = "regular";
    else if (!incident.length || signatures.length > 1 || hasIndependentRoute) {
      group.marker_class = "same_station";
    } else if (incident.length <= 1 && !allTerminate) group.marker_class = "shared_boundary";
    else if (allTerminate) group.marker_class = "shared_terminus";
    else group.marker_class = "shared_interior";
  }

  const features = {
    type: "FeatureCollection",
    features: groups.map((group) => ({
      type: "Feature",
      id: group.id,
      properties: {
        group_id: group.id,
        stop_name: group.stop_name,
        stop_ids: JSON.stringify(group.stop_ids),
        route_ids: JSON.stringify(group.route_ids),
        display_code: group.display_code,
        primary_color: `#${group.primary_color}`,
        marker_class: group.marker_class,
        sort_key: group.sort_key,
      },
      geometry: { type: "Point", coordinates: group.center },
    })),
  };
  return { groups, groupByStopId, features, sharedEdges };
}

function clusterStationStops(features) {
  const byName = new Map();
  for (const feature of features) {
    const key = normalizeStationNameForModel(feature.properties.stop_name);
    const named = byName.get(key) || [];
    named.push(feature);
    byName.set(key, named);
  }

  const groups = [];
  for (const [name, named] of byName) {
    const local = [];
    for (const feature of named) {
      const group = local.find((candidate) =>
        candidate.raw.some(
          (other) =>
            stationDistanceM(other.geometry.coordinates, feature.geometry.coordinates) <=
            STATION_MODEL.coLocationDistanceM,
        ),
      );
      if (group) group.raw.push(feature);
      else {
        local.push({
          id: `station:${stationSlug(name)}:${local.length + 1}`,
          normalized_name: name,
          raw: [feature],
        });
      }
    }
    groups.push(...local);
  }
  return groups;
}

function stationRouteSequences(patterns, groupByStopId) {
  const unique = new Map();
  for (const pattern of patterns) {
    const groupIds = [];
    for (const stopId of pattern.stop_ids || []) {
      const groupId = groupByStopId.get(stopId)?.id;
      if (groupId && groupIds.at(-1) !== groupId) groupIds.push(groupId);
    }
    if (groupIds.length < 2) continue;
    const key = `${pattern.route_id}:${groupIds.join(">")}`;
    if (!unique.has(key)) unique.set(key, { route_id: pattern.route_id, group_ids: groupIds });
  }
  return [...unique.values()];
}

function stationRouteTerminals(sequences) {
  const terminals = new Map();
  for (const sequence of sequences) {
    const routeTerminals = terminals.get(sequence.route_id) || new Set();
    routeTerminals.add(sequence.group_ids[0]);
    routeTerminals.add(sequence.group_ids.at(-1));
    terminals.set(sequence.route_id, routeTerminals);
  }
  return terminals;
}

function stationSharedEdges(sequences, groups) {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const edgeRoutes = new Map();
  for (const sequence of sequences) {
    for (let index = 0; index < sequence.group_ids.length - 1; index += 1) {
      const pair = [sequence.group_ids[index], sequence.group_ids[index + 1]].sort();
      const key = pair.join("|");
      const routes = edgeRoutes.get(key) || new Set();
      routes.add(sequence.route_id);
      edgeRoutes.set(key, routes);
    }
  }

  const edges = [];
  for (const [key, routes] of edgeRoutes) {
    const groupIds = key.split("|");
    const commonRoutes = [...routes].filter((routeId) =>
      groupIds.every((groupId) => groupsById.get(groupId)?.route_ids.includes(routeId)),
    );
    if (commonRoutes.length >= 2) {
      edges.push({ group_ids: groupIds, route_ids: commonRoutes.sort() });
    }
  }
  return edges;
}

function buildRefinedTransfers(records, model) {
  const accepted = records
    .filter((record) => record.disposition === "accepted" && record.runtime_use !== "exclude")
    .map((record) => resolveStationTransfer(record, model.groupByStopId))
    .filter(Boolean);
  const connectionIndex = new Map();
  for (const record of accepted) {
    for (const groupId of record.group_ids) {
      const connections = connectionIndex.get(groupId) || [];
      connections.push(record);
      connectionIndex.set(groupId, connections);
    }
  }
  return {
    records: accepted,
    connectionIndex,
    lines: {
      type: "FeatureCollection",
      features: accepted.map((record) => ({
        type: "Feature",
        id: record.id,
        properties: {
          id: record.id,
          runtime_use: record.runtime_use,
          classification: record.classification,
          route_ids: JSON.stringify(record.route_ids),
        },
        geometry: { type: "LineString", coordinates: [record.from_center, record.to_center] },
      })),
    },
  };
}

function resolveStationTransfer(record, groupByStopId) {
  const from = stationUniqueObjects(
    record.from_stop_ids.map((id) => groupByStopId.get(id)).filter(Boolean),
    (group) => group.id,
  );
  const to = stationUniqueObjects(
    record.to_stop_ids.map((id) => groupByStopId.get(id)).filter(Boolean),
    (group) => group.id,
  );
  if (!from.length || !to.length) return null;
  const groups = stationUniqueObjects([...from, ...to], (group) => group.id);
  return {
    ...record,
    group_ids: groups.map((group) => group.id),
    route_ids: stationUniqueSorted(groups.flatMap((group) => group.route_ids)),
    from_name: stationUniqueSorted(from.map((group) => group.stop_name)).join(" / "),
    to_name: stationUniqueSorted(to.map((group) => group.stop_name)).join(" / "),
    from_center: stationCentroid(from.map((group) => group.center)),
    to_center: stationCentroid(to.map((group) => group.center)),
  };
}

function stationMarkerFeatures(model, mode) {
  return {
    type: "FeatureCollection",
    features: model.features.features.filter((feature) => {
      if (mode === "none") return false;
      if (parseStationArray(feature.properties.route_ids).length < 2) return false;
      if (mode === "all") return true;
      return ["same_station", "shared_boundary"].includes(feature.properties.marker_class);
    }),
  };
}

function stationDisplayCode(stopIds) {
  if (stopIds.length === 1) return stopIds[0];
  if (stopIds.length === 2 && stopIds.join("").length <= 9) return stopIds.join("\n");
  return `${stopIds[0]}\n+${stopIds.length - 1}`;
}

function humanizeStationName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeStationNameForModel(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function parseStationArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function stationUniqueSorted(values, order = null) {
  const unique = [...new Set(values.filter(Boolean).map(String))];
  return order
    ? unique.sort((left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999))
    : unique.sort();
}

function stationUniqueObjects(values, key) {
  const seen = new Set();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function stationCentroid(coordinates) {
  const total = coordinates.reduce(
    (sum, point) => [sum[0] + Number(point[0]), sum[1] + Number(point[1])],
    [0, 0],
  );
  return [total[0] / coordinates.length, total[1] / coordinates.length];
}

function stationDistanceM(left, right) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitude = radians(right[1] - left[1]);
  const longitude = radians(right[0] - left[0]);
  const leftLatitude = radians(left[1]);
  const rightLatitude = radians(right[1]);
  const haversine =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitude / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(haversine));
}

function normalizeStationColor(value, fallback) {
  const normalized = String(value || fallback).trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(normalized)) {
    return normalized.split("").map((part) => `${part}${part}`).join("");
  }
  return /^[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

function stationSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildStationModel,
    buildRefinedTransfers,
    stationMarkerFeatures,
    stationDistanceM,
  };
}
