"use strict";

const assert = require("node:assert/strict");
const {
  buildStationModel,
  stationMarkerFeatures,
} = require("../docs/station-model.js");

const routes = [
  { route_id: "AG", short_name: "AGL", color: "E8218D" },
  { route_id: "PH", short_name: "SPL", color: "7A2A90" },
  { route_id: "PYL", short_name: "PYL", color: "FFD500" },
  { route_id: "MR", short_name: "MRL", color: "77C043" },
];

function station(id, name, routeId, longitude, latitude) {
  return {
    type: "Feature",
    id,
    properties: { stop_id: id, stop_name: name, route_ids: [routeId] },
    geometry: { type: "Point", coordinates: [longitude, latitude] },
  };
}

const stops = { type: "FeatureCollection", features: [] };
for (const [index, name] of ["Sentul Timur", "Sentul", "Titiwangsa", "Chan Sow Lin"].entries()) {
  stops.features.push(station(`AG${index + 1}`, name, "AG", 101.60 + index * 0.01, 3.10));
  stops.features.push(station(`SP${index + 1}`, name, "PH", 101.60 + index * 0.01, 3.10));
}
stops.features.push(station("AG5", "Ampang Branch", "AG", 101.65, 3.09));
stops.features.push(station("SP5", "Sri Petaling Branch", "PH", 101.65, 3.11));
stops.features.push(station("PY17", "Titiwangsa", "PYL", 101.62002, 3.10001));
stops.features.push(station("MR11", "Titiwangsa", "MR", 101.61998, 3.10002));
stops.features.push(station("PY01", "Kwasa Damansara", "PYL", 101.50, 3.20));
stops.features.push(station("MR01", "Kwasa Damansara", "MR", 101.50002, 3.20001));
stops.features.push(station("PY02", "PY Branch", "PYL", 101.51, 3.21));
stops.features.push(station("MR02", "MR Branch", "MR", 101.49, 3.21));

const patterns = [
  { route_id: "AG", stop_ids: ["AG1", "AG2", "AG3", "AG4", "AG5"] },
  { route_id: "PH", stop_ids: ["SP1", "SP2", "SP3", "SP4", "SP5"] },
  { route_id: "PYL", stop_ids: ["PY01", "PY02", "PY17"] },
  { route_id: "MR", stop_ids: ["MR01", "MR02", "MR11"] },
];

const model = buildStationModel(stops, patterns, routes);
const byName = new Map(model.groups.map((group) => [group.stop_name, group]));
assert.equal(byName.get("Sentul Timur").marker_class, "shared_terminus");
assert.equal(byName.get("Sentul").marker_class, "shared_interior");
assert.equal(byName.get("Titiwangsa").marker_class, "same_station");
assert.equal(byName.get("Chan Sow Lin").marker_class, "shared_boundary");
assert.equal(byName.get("Kwasa Damansara").marker_class, "same_station");
assert.deepEqual(byName.get("Sentul").route_ids, ["AG", "PH"]);
assert.equal(byName.get("Sentul").display_code, "AG2\nSP2");

const boundaries = stationMarkerFeatures(model, "boundaries").features.map(
  (feature) => feature.properties.stop_name,
);
assert(!boundaries.includes("Sentul Timur"));
assert(!boundaries.includes("Sentul"));
assert(boundaries.includes("Chan Sow Lin"));
assert(boundaries.includes("Titiwangsa"));
assert(boundaries.includes("Kwasa Damansara"));
assert.equal(stationMarkerFeatures(model, "all").features.length, 5);
assert.equal(stationMarkerFeatures(model, "none").features.length, 0);

console.log("station model permutations passed");
