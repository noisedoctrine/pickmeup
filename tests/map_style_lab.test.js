"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildStationModel } = require("../docs/station-model.js");
const {
  MAP_STYLE_LAB,
  MAP_STYLE_PRESETS,
  metroInterchangeFeatures,
  normalizeMetroColor,
  styleSelectMarkup,
} = require("../docs/map-style-lab.js");

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

const stops = {
  type: "FeatureCollection",
  features: [
    station("AG3", "Titiwangsa", "AG", 101.62000, 3.10000),
    station("SP3", "Titiwangsa", "PH", 101.62001, 3.10001),
    station("PY17", "Titiwangsa", "PYL", 101.62002, 3.10001),
    station("MR11", "Titiwangsa", "MR", 101.61998, 3.10002),
    station("AG4", "Ampang Branch", "AG", 101.63000, 3.09000),
    station("SP4", "Sri Petaling Branch", "PH", 101.63000, 3.11000),
    station("PY18", "Putrajaya Branch", "PYL", 101.61000, 3.11000),
    station("MR12", "Monorail Branch", "MR", 101.61000, 3.09000),
  ],
};

const patterns = [
  { route_id: "AG", stop_ids: ["AG3", "AG4"] },
  { route_id: "PH", stop_ids: ["SP3", "SP4"] },
  { route_id: "PYL", stop_ids: ["PY17", "PY18"] },
  { route_id: "MR", stop_ids: ["MR11", "MR12"] },
];

assert.deepEqual(Object.keys(MAP_STYLE_PRESETS.interchange), [
  "hub",
  "petals",
  "target",
  "legacy",
]);
assert.deepEqual(Object.keys(MAP_STYLE_PRESETS.line), [
  "balanced",
  "white",
  "dark",
  "ribbon",
]);
assert.deepEqual(Object.keys(MAP_STYLE_PRESETS.station), [
  "outlined",
  "solid",
  "diagram",
  "minimal",
]);

for (const group of Object.values(MAP_STYLE_PRESETS)) {
  for (const preset of Object.values(group)) {
    assert(preset.label, "Every visual preset needs a label");
    assert(preset.note, "Every visual preset needs an explanatory note");
  }
}
assert.equal(MAP_STYLE_LAB.defaultInterchange, "hub");
assert.equal(MAP_STYLE_LAB.defaultLine, "balanced");
assert.equal(MAP_STYLE_LAB.defaultStation, "outlined");

const model = buildStationModel(stops, patterns, routes);
const features = metroInterchangeFeatures(model, routes, "boundaries");
assert.equal(features.features.length, 1);
const interchange = features.features[0];
assert.equal(interchange.properties.stop_name, "Titiwangsa");
assert.equal(interchange.properties.route_count, 4);
assert.equal(interchange.properties.route_color_1, "#E8218D");
assert.equal(interchange.properties.route_color_2, "#7A2A90");
assert.equal(interchange.properties.route_color_3, "#FFD500");
assert.equal(interchange.properties.route_color_4, "#77C043");

assert.equal(metroInterchangeFeatures(model, routes, "boundaries", "PYL").features.length, 1);
assert.equal(metroInterchangeFeatures(model, routes, "boundaries", "KJ").features.length, 0);
assert.equal(metroInterchangeFeatures(model, routes, "none").features.length, 0);
assert.equal(normalizeMetroColor("abc", "000000"), "#aabbcc");
assert.equal(normalizeMetroColor("not-a-colour", "5f6b7a"), "#5f6b7a");

const markup = styleSelectMarkup(
  "interchange-style",
  "Interchange symbols",
  MAP_STYLE_PRESETS.interchange,
  "petals",
);
assert.match(markup, /value="petals" selected/);
assert.match(markup, /Route petals/);

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../docs/index.html"), "utf8");
const refinementsPosition = indexHtml.indexOf('src="map-refinements.js"');
const styleLabPosition = indexHtml.indexOf('src="map-style-lab.js"');
const routingPosition = indexHtml.indexOf('src="routing-lab.js"');
assert(refinementsPosition >= 0);
assert(styleLabPosition > refinementsPosition, "Style lab must load after refined map functions");
assert(routingPosition > styleLabPosition, "Routing overlays must load after base map styling");
assert.match(indexHtml, /href="map-style-lab\.css"/);

console.log("map style lab tests passed");
