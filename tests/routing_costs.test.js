"use strict";

const assert = require("node:assert/strict");
const {
  HeadwaySchedule,
  addCalendarDays,
  estimateRoutingPath,
  parseClockTime,
  routingFrequencyDataLoaded,
  serviceIdForDate,
} = require("../docs/routing-costs.js");

const frequencies = [
  {
    route_id: "AG",
    direction_id: "0",
    service_id: "MonFri",
    start_time: "6:00:00",
    end_time: "9:00:00",
    start_time_seconds: 21600,
    end_time_seconds: 32400,
    headway_secs: 180,
  },
  {
    route_id: "AG",
    direction_id: "0",
    service_id: "MonFri",
    start_time: "9:00:00",
    end_time: "17:00:00",
    start_time_seconds: 32400,
    end_time_seconds: 61200,
    headway_secs: 300,
  },
  {
    route_id: "AG",
    direction_id: "0",
    service_id: "Sat",
    start_time: "6:00:00",
    end_time: "23:25:00",
    start_time_seconds: 21600,
    end_time_seconds: 84300,
    headway_secs: 300,
  },
  {
    route_id: "AG",
    direction_id: "0",
    service_id: "Sun",
    start_time: "6:00:00",
    end_time: "23:25:00",
    start_time_seconds: 21600,
    end_time_seconds: 84300,
    headway_secs: 360,
  },
  {
    route_id: "BRT",
    direction_id: "1",
    service_id: "MonFri",
    start_time: "23:30:00",
    end_time: "24:30:00",
    start_time_seconds: 84600,
    end_time_seconds: 88200,
    headway_secs: 600,
  },
  {
    route_id: "BRT",
    direction_id: "1",
    service_id: "Sat",
    start_time: "6:00:00",
    end_time: "24:00:00",
    start_time_seconds: 21600,
    end_time_seconds: 86400,
    headway_secs: 600,
  },
  {
    route_id: "BRT",
    direction_id: "1",
    service_id: "Sun",
    start_time: "6:00:00",
    end_time: "24:00:00",
    start_time_seconds: 21600,
    end_time_seconds: 86400,
    headway_secs: 600,
  },
  {
    route_id: "KJ",
    direction_id: "0",
    service_id: "MonFri",
    start_time: "6:00:00",
    end_time: "24:00:00",
    start_time_seconds: 21600,
    end_time_seconds: 86400,
    headway_secs: 240,
  },
];

const schedule = new HeadwaySchedule(frequencies);

assert.equal(serviceIdForDate("2026-07-17"), "MonFri");
assert.equal(serviceIdForDate("2026-07-18"), "Sat");
assert.equal(serviceIdForDate("2026-07-19"), "Sun");
assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
assert.equal(parseClockTime("08:15"), 29700);
assert.equal(parseClockTime("24:00"), null);
assert.equal(routingFrequencyDataLoaded({ summary: null, frequencies: [] }), false);
assert.equal(routingFrequencyDataLoaded({ summary: {}, frequencies: [] }), true);

const peak = schedule.activeWindow("AG", "0", "2026-07-17", parseClockTime("08:15"));
assert.equal(peak.headway_secs, 180);
assert.equal(peak.expected_wait_seconds, 90);

const midday = schedule.activeWindow("AG", "0", "2026-07-17", parseClockTime("12:00"));
assert.equal(midday.headway_secs, 300);
assert.equal(midday.expected_wait_seconds, 150);

const afterMidnight = schedule.activeWindow("BRT", "1", "2026-07-18", parseClockTime("00:10"));
assert.equal(afterMidnight.service_id, "MonFri");
assert.equal(afterMidnight.service_date, "2026-07-17");
assert.equal(afterMidnight.headway_secs, 600);

assert.equal(schedule.legacyExpectedWaitSeconds("AG"), (300 * 5 + 300 + 360) / 14);

const path = {
  edges: [
    { kind: "ride", route_id: "AG", direction_id: "0", from: "A", to: "B" },
    { kind: "ride", route_id: "AG", direction_id: "0", from: "B", to: "C" },
    { kind: "transfer", from: "C", to: "D" },
    { kind: "ride", route_id: "BRT", direction_id: "1", from: "D", to: "E" },
  ],
};

const estimate = estimateRoutingPath(path, schedule, {
  mode: "time-aware",
  date: "2026-07-17",
  seconds: parseClockTime("08:15"),
});
assert.equal(estimate.boardings.length, 2);
assert.equal(estimate.boardings[0].wait_seconds, 90);
assert.equal(estimate.boardings[1].available, false);
assert.equal(estimate.total_waiting_seconds, 90);
assert.equal(estimate.missing_travel_times, 4);
assert.equal(estimate.unavailable_boardings, 1);
assert.equal(estimate.boardings[1].clock_basis, "selected");
assert.equal(estimate.boardings[1].boarding_seconds, parseClockTime("08:15"));

assert.equal(
  estimateRoutingPath(path, schedule, { mode: "time-aware", date: "2026-07-17", seconds: null }),
  null,
);

const progressed = estimateRoutingPath(
  {
    edges: [
      {
        kind: "ride",
        route_id: "AG",
        direction_id: "0",
        from: "A",
        to: "B",
        travel_time_seconds: 60,
      },
      { kind: "transfer", from: "B", to: "C", travel_time_seconds: 120 },
      {
        kind: "ride",
        route_id: "KJ",
        direction_id: "0",
        from: "C",
        to: "D",
        travel_time_seconds: 90,
      },
    ],
  },
  schedule,
  { mode: "time-aware", date: "2026-07-17", seconds: parseClockTime("08:15") },
);
assert.equal(progressed.boardings[1].clock_basis, "progressed");
assert.equal(progressed.boardings[1].boarding_seconds, parseClockTime("08:19:30"));
assert.equal(progressed.boardings[1].wait_seconds, 120);
assert.equal(progressed.missing_travel_times, 0);

const legacy = estimateRoutingPath(
  { edges: path.edges.slice(0, 2) },
  schedule,
  { mode: "legacy", date: "2026-07-17", seconds: parseClockTime("08:15") },
);
assert.equal(legacy.boardings.length, 1);
assert.equal(legacy.unavailable_boardings, 0);
assert.equal(legacy.total_waiting_seconds, schedule.legacyExpectedWaitSeconds("AG"));

console.log("routing cost tests passed");
