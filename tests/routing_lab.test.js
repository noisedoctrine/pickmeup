"use strict";

const assert = require("node:assert/strict");
const {
  buildRoutingGraph,
  findRoutingPath,
  summarizeRoutingGraph,
} = require("../docs/routing-lab.js");

function group(id, name, stopIds, routeIds, x) {
  return {
    id,
    stop_name: name,
    stop_ids: stopIds,
    route_ids: routeIds,
    center: [x, 3.1],
  };
}

const groups = [
  group("A", "Alpha", ["A1"], ["R1"], 101.60),
  group("B", "Bravo", ["B1", "B2"], ["R1", "R2"], 101.61),
  group("C", "Charlie", ["C1"], ["R1"], 101.62),
  group("D", "Delta", ["D2"], ["R2"], 101.63),
  group("E", "Echo", ["E3"], ["R3"], 101.64),
];
const groupByStopId = new Map();
for (const current of groups) {
  for (const stopId of current.stop_ids) groupByStopId.set(stopId, current);
}
const model = { groups, groupByStopId };
const routes = [
  { route_id: "R1", color: "ff0000" },
  { route_id: "R2", color: "0000ff" },
  { route_id: "R3", color: "00aa00" },
];
const patterns = [
  { pattern_id: "r1-out", route_id: "R1", direction_id: "0", stop_ids: ["A1", "B1", "C1"] },
  { pattern_id: "r1-back", route_id: "R1", direction_id: "1", stop_ids: ["C1", "B1", "A1"] },
  { pattern_id: "r2-out", route_id: "R2", direction_id: "0", stop_ids: ["B2", "D2"] },
  { pattern_id: "r2-parallel", route_id: "R2", direction_id: "1", stop_ids: ["B2", "C1"] },
  { pattern_id: "r3-out", route_id: "R3", direction_id: "0", stop_ids: ["E3"] },
];
const transfers = [
  {
    id: "c-e",
    from_stop_ids: ["C1"],
    to_stop_ids: ["E3"],
    bidirectional: true,
    runtime_use: "transfer_edge",
  },
  {
    id: "d-e-optional",
    from_stop_ids: ["D2"],
    to_stop_ids: ["E3"],
    bidirectional: true,
    runtime_use: "optional_out_of_station_edge",
  },
];

const multigraph = buildRoutingGraph(model, patterns, routes, transfers, {
  representation: "multigraph",
  transferMode: "integrated",
  respectDirection: true,
});
const collapsed = buildRoutingGraph(model, patterns, routes, transfers, {
  representation: "collapsed",
  transferMode: "integrated",
  respectDirection: true,
});

assert(multigraph.edges.length > collapsed.edges.length, "collapsed topology should merge parallel ride links");
assert.equal(summarizeRoutingGraph(multigraph).nodes, 5);
assert.equal(summarizeRoutingGraph(multigraph).parallel_pairs, 1);
assert.equal(summarizeRoutingGraph(multigraph).weak_components, 1);

const alphaToDelta = findRoutingPath(multigraph, "A", "D");
assert(alphaToDelta, "route should exist through the co-located Bravo station group");
assert.deepEqual(alphaToDelta.nodes, ["A", "B", "D"]);
assert.equal(alphaToDelta.hops, 2);
assert.equal(alphaToDelta.line_changes, 1);
assert.deepEqual(alphaToDelta.edges.map((edge) => edge.route_id), ["R1", "R2"]);

const alphaToEcho = findRoutingPath(multigraph, "A", "E");
assert(alphaToEcho);
assert.deepEqual(alphaToEcho.nodes, ["A", "B", "C", "E"]);
assert.equal(alphaToEcho.transfers, 1);

const noTransfers = buildRoutingGraph(model, patterns, routes, transfers, {
  representation: "multigraph",
  transferMode: "none",
  respectDirection: true,
});
assert.equal(findRoutingPath(noTransfers, "A", "E"), null);

const allTransfers = buildRoutingGraph(model, patterns, routes, transfers, {
  representation: "multigraph",
  transferMode: "all",
  respectDirection: true,
});
const deltaToEcho = findRoutingPath(allTransfers, "D", "E");
assert(deltaToEcho);
assert.equal(deltaToEcho.hops, 1);
assert.equal(deltaToEcho.edges[0].transfer_id, "d-e-optional");

const directed = buildRoutingGraph(model, [patterns[0]], routes, [], {
  representation: "multigraph",
  transferMode: "none",
  respectDirection: true,
});
assert.equal(findRoutingPath(directed, "C", "A"), null);
const bidirectional = buildRoutingGraph(model, [patterns[0]], routes, [], {
  representation: "multigraph",
  transferMode: "none",
  respectDirection: false,
});
assert(findRoutingPath(bidirectional, "C", "A"));

const continuityGraph = buildRoutingGraph(
  model,
  [
    { pattern_id: "r1", route_id: "R1", stop_ids: ["A1", "B1", "C1"] },
    { pattern_id: "r2", route_id: "R2", stop_ids: ["A1", "B2", "C1"] },
  ],
  routes,
  [],
  { representation: "multigraph", transferMode: "none", respectDirection: true },
);
const continuityPath = findRoutingPath(continuityGraph, "A", "C");
assert(continuityPath);
assert.equal(continuityPath.line_changes, 0, "equal-hop paths should prefer route continuity");
assert.equal(new Set(continuityPath.edges.map((edge) => edge.route_id)).size, 1);

console.log("routing lab graph and path experiments passed");
