"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildRefinedTransfers,
  buildStationModel,
} = require("../docs/station-model.js");
const {
  buildRoutingGraph,
  findRoutingPath,
  summarizeRoutingGraph,
} = require("../docs/routing-lab.js");
const {
  routingShapeSegment,
} = require("../docs/routing-lab-ui.js");

const repositoryRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(repositoryRoot, "docs");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

function assertLocalPageAssetsExist() {
  const indexPath = path.join(docsRoot, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  const localReferences = references
    .filter((reference) => !/^(?:https?:)?\/\//.test(reference))
    .filter((reference) => !reference.startsWith("#"))
    .map((reference) => reference.split(/[?#]/, 1)[0])
    .filter(Boolean);

  for (const reference of localReferences) {
    assert(
      fs.existsSync(path.join(docsRoot, reference)),
      `docs/index.html references missing local asset: ${reference}`,
    );
  }

  const scriptOrder = [
    "app.js",
    "station-model.js",
    "map-refinements.js",
    "routing-lab.js",
    "routing-lab-ui.js",
  ].map((filename) => html.indexOf(`src="${filename}"`));
  assert(scriptOrder.every((position) => position >= 0), "Expected Pages scripts are present");
  assert.deepEqual(scriptOrder, [...scriptOrder].sort((left, right) => left - right));
}

function loadCachedSnapshot() {
  const manifest = readJson("docs/data/manifest.json");
  const snapshot = {};
  for (const [name, relativePath] of Object.entries(manifest.files)) {
    const fullPath = path.join(docsRoot, "data", relativePath);
    assert(fs.existsSync(fullPath), `Manifest target is missing: ${relativePath}`);
    snapshot[name] = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  }
  return { manifest, snapshot };
}

assertLocalPageAssetsExist();

const { manifest, snapshot } = loadCachedSnapshot();
assert.match(manifest.active_snapshot, /^[0-9a-f]{12}$/);
assert.equal(manifest.sha256.startsWith(manifest.active_snapshot), true);

const routes = snapshot.routes.routes;
const patterns = snapshot.patterns.patterns;
const stops = snapshot.stops;
const interchangeDocument = readJson("docs/data/interchanges.json");

const stationModel = buildStationModel(stops, patterns, routes);
const transfers = buildRefinedTransfers(interchangeDocument.records, stationModel);

assert.equal(stationModel.groupByStopId.size, stops.features.length);
assert(stationModel.groups.length > 100, "Expected a substantial KL station graph");
assert(transfers.records.length >= 3, "Expected accepted curated transfer evidence");

const integratedGraph = buildRoutingGraph(
  stationModel,
  patterns,
  routes,
  transfers.records,
  {
    representation: "multigraph",
    transferMode: "integrated",
    respectDirection: true,
  },
);
const integratedSummary = summarizeRoutingGraph(integratedGraph);
assert.equal(integratedSummary.nodes, stationModel.groups.length);
assert(integratedSummary.edges > integratedSummary.nodes);
assert(integratedSummary.parallel_pairs > 0, "Expected shared-corridor parallel edges");

const collapsedGraph = buildRoutingGraph(
  stationModel,
  patterns,
  routes,
  transfers.records,
  {
    representation: "collapsed",
    transferMode: "integrated",
    respectDirection: true,
  },
);
assert(collapsedGraph.edges.length < integratedGraph.edges.length);

const noTransferGraph = buildRoutingGraph(
  stationModel,
  patterns,
  routes,
  transfers.records,
  {
    representation: "multigraph",
    transferMode: "none",
    respectDirection: true,
  },
);
assert.equal(noTransferGraph.edges.some((edge) => edge.kind === "transfer"), false);

const optionalGraph = buildRoutingGraph(
  stationModel,
  patterns,
  routes,
  transfers.records,
  {
    representation: "multigraph",
    transferMode: "all",
    respectDirection: true,
  },
);
assert(
  optionalGraph.edges.some(
    (edge) =>
      edge.kind === "transfer" &&
      edge.runtime_use === "optional_out_of_station_edge",
  ),
  "Expected optional out-of-station transfer edges",
);

const kj1 = stationModel.groupByStopId.get("KJ1")?.id;
const kj37 = stationModel.groupByStopId.get("KJ37")?.id;
const sameLinePath = findRoutingPath(integratedGraph, kj1, kj37);
assert(sameLinePath, "Expected an end-to-end Kelana Jaya path");
assert(sameLinePath.edges.every((edge) => edge.kind === "ride"));
assert.equal(sameLinePath.line_changes, 0);

const shapeSegments = sameLinePath.edges.map((edge) =>
  routingShapeSegment(
    edge,
    integratedGraph.nodes.get(edge.from),
    integratedGraph.nodes.get(edge.to),
    snapshot.shapes.features,
  ),
);
assert(
  shapeSegments.every((segment) => segment.length >= 2),
  "Every ride link should produce drawable route geometry",
);
assert(
  shapeSegments.some((segment) => segment.length > 2),
  "Expected the highlighted journey to use cached GTFS shape geometry rather than only straight chords",
);

const kj15 = stationModel.groupByStopId.get("KJ15")?.id;
const kg15 = stationModel.groupByStopId.get("KG15")?.id;
assert(
  integratedGraph.edges.some(
    (edge) => edge.kind === "transfer" && edge.from === kj15 && edge.to === kg15,
  ),
  "Expected the curated KL Sentral–Muzium Negara transfer edge",
);

const integratedPath = findRoutingPath(integratedGraph, kj15, kg15);
assert(integratedPath, "Expected the curated transfer to be traversable");
assert.equal(integratedPath.hops, 1);
assert.equal(integratedPath.transfers, 1);

console.log(
  `Pages snapshot ${manifest.active_snapshot}: ${integratedSummary.nodes} nodes, ${integratedSummary.edges} links, ${integratedSummary.weak_components} weak components`,
);
