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
const requestedPhase = process.argv[2] || "all";
const cache = {};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

function snapshotContext() {
  if (cache.snapshot) return cache.snapshot;
  const manifest = readJson("docs/data/manifest.json");
  const snapshot = {};
  for (const [name, relativePath] of Object.entries(manifest.files)) {
    const fullPath = path.join(docsRoot, "data", relativePath);
    assert(fs.existsSync(fullPath), `Manifest target is missing: ${relativePath}`);
    snapshot[name] = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  }
  cache.snapshot = { manifest, snapshot };
  return cache.snapshot;
}

function modelContext() {
  if (cache.model) return cache.model;
  const { snapshot } = snapshotContext();
  const routes = snapshot.routes.routes;
  const patterns = snapshot.patterns.patterns;
  const stops = snapshot.stops;
  const interchangeDocument = readJson("docs/data/interchanges.json");
  const stationModel = buildStationModel(stops, patterns, routes);
  const transfers = buildRefinedTransfers(interchangeDocument.records, stationModel);
  cache.model = { routes, patterns, stops, stationModel, transfers, snapshot };
  return cache.model;
}

function graphContext() {
  if (cache.graph) return cache.graph;
  const { stationModel, patterns, routes, transfers } = modelContext();
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
  cache.graph = {
    integratedGraph,
    integratedSummary: summarizeRoutingGraph(integratedGraph),
    collapsedGraph,
    noTransferGraph,
    optionalGraph,
  };
  return cache.graph;
}

function sameLineContext() {
  if (cache.sameLine) return cache.sameLine;
  const { stationModel } = modelContext();
  const { integratedGraph } = graphContext();
  const kj1 = stationModel.groupByStopId.get("KJ1")?.id;
  const kj37 = stationModel.groupByStopId.get("KJ37")?.id;
  const sameLinePath = findRoutingPath(integratedGraph, kj1, kj37);
  cache.sameLine = { kj1, kj37, sameLinePath };
  return cache.sameLine;
}

function testAssets() {
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

  const { manifest } = snapshotContext();
  assert.match(manifest.active_snapshot, /^[0-9a-f]{12}$/);
  assert.equal(manifest.sha256.startsWith(manifest.active_snapshot), true);
}

function testModel() {
  const { stationModel, stops, transfers } = modelContext();
  assert.equal(stationModel.groupByStopId.size, stops.features.length);
  assert(stationModel.groups.length > 100, "Expected a substantial KL station graph");
  assert(transfers.records.length >= 3, "Expected accepted curated transfer evidence");
}

function testGraphs() {
  const {
    integratedGraph,
    integratedSummary,
    collapsedGraph,
    noTransferGraph,
    optionalGraph,
  } = graphContext();
  const { stationModel } = modelContext();
  assert.equal(integratedSummary.nodes, stationModel.groups.length);
  assert(integratedSummary.edges > integratedSummary.nodes);
  assert(integratedSummary.parallel_pairs > 0, "Expected shared-corridor parallel edges");
  assert(collapsedGraph.edges.length < integratedGraph.edges.length);
  assert.equal(noTransferGraph.edges.some((edge) => edge.kind === "transfer"), false);
  assert(
    optionalGraph.edges.some(
      (edge) =>
        edge.kind === "transfer" &&
        edge.runtime_use === "optional_out_of_station_edge",
    ),
    "Expected optional out-of-station transfer edges",
  );
}

function testPath() {
  const { sameLinePath } = sameLineContext();
  assert(sameLinePath, "Expected an end-to-end Kelana Jaya path");
  assert(sameLinePath.edges.every((edge) => edge.kind === "ride"));
  assert.equal(sameLinePath.line_changes, 0);
}

function testShapes() {
  const { sameLinePath } = sameLineContext();
  assert(sameLinePath, "Expected an end-to-end Kelana Jaya path before shape clipping");
  const { integratedGraph } = graphContext();
  const { snapshot } = snapshotContext();
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
}

function testTransfers() {
  const { stationModel } = modelContext();
  const { integratedGraph } = graphContext();
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
}

const phases = {
  assets: testAssets,
  model: testModel,
  graphs: testGraphs,
  path: testPath,
  shapes: testShapes,
  transfers: testTransfers,
};

if (requestedPhase === "all") {
  for (const [name, test] of Object.entries(phases)) {
    test();
    console.log(`Pages snapshot phase passed: ${name}`);
  }
} else {
  const test = phases[requestedPhase];
  assert(test, `Unknown Pages snapshot phase: ${requestedPhase}`);
  test();
  console.log(`Pages snapshot phase passed: ${requestedPhase}`);
}

const { manifest } = snapshotContext();
const { integratedSummary } = graphContext();
console.log(
  `Pages snapshot ${manifest.active_snapshot}: ${integratedSummary.nodes} nodes, ${integratedSummary.edges} links, ${integratedSummary.weak_components} weak components`,
);
