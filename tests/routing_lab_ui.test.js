"use strict";

const assert = require("node:assert/strict");
const {
  nearestRoutingCoordinateIndex,
  routingShapeSegment,
} = require("../docs/routing-lab-ui.js");

const from = { center: [101.60, 3.10] };
const to = { center: [101.62, 3.10] };
const shapes = [
  {
    type: "Feature",
    properties: { route_id: "R1" },
    geometry: {
      type: "LineString",
      coordinates: [
        [101.59, 3.10],
        [101.60, 3.10],
        [101.605, 3.104],
        [101.61, 3.106],
        [101.615, 3.103],
        [101.62, 3.10],
        [101.63, 3.10],
      ],
    },
  },
  {
    type: "Feature",
    properties: { route_id: "R1" },
    geometry: {
      type: "LineString",
      coordinates: [
        [101.63, 3.10],
        [101.62, 3.10],
        [101.61, 3.106],
        [101.60, 3.10],
        [101.59, 3.10],
      ],
    },
  },
];

assert.equal(nearestRoutingCoordinateIndex(shapes[0].geometry.coordinates, from.center), 1);
const segment = routingShapeSegment({ route_id: "R1" }, from, to, shapes);
assert(segment.length > 2, "highlight should follow the recorded shape rather than a straight chord");
assert.deepEqual(segment[0], from.center);
assert.deepEqual(segment.at(-1), to.center);
assert(segment.some((coordinate) => coordinate[1] > 3.10));

const fallback = routingShapeSegment({ route_id: "missing" }, from, to, shapes);
assert.deepEqual(fallback, [from.center, to.center]);

console.log("routing lab shape highlighting passed");
