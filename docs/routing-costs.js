"use strict";

const ROUTING_COSTS = Object.freeze({
  timezone: "Asia/Kuala_Lumpur",
  defaultMode: "time-aware",
});

const routingCostState = {
  schedule: null,
  mode: ROUTING_COSTS.defaultMode,
  date: null,
  time: null,
  currentPath: null,
  elements: {},
};

class HeadwaySchedule {
  constructor(frequencies = []) {
    this.rows = frequencies
      .map(normalizeFrequencyRow)
      .filter((row) => row.route_id && Number.isFinite(row.headway_secs))
      .sort(compareFrequencyRows);
  }

  activeWindow(routeId, directionId, date, seconds) {
    const candidates = [
      { serviceDate: date, serviceSeconds: seconds },
      { serviceDate: addCalendarDays(date, -1), serviceSeconds: seconds + 86400 },
    ];

    for (const candidate of candidates) {
      const serviceId = serviceIdForDate(candidate.serviceDate);
      const matching = this.rows.filter(
        (row) =>
          row.route_id === String(routeId) &&
          row.service_id === serviceId &&
          row.start_time_seconds <= candidate.serviceSeconds &&
          candidate.serviceSeconds < row.end_time_seconds,
      );
      if (!matching.length) continue;

      const exactDirection = matching.filter(
        (row) =>
          directionId !== null &&
          directionId !== undefined &&
          row.direction_id === String(directionId),
      );
      const selected = (exactDirection.length ? exactDirection : matching).sort(compareFrequencyRows)[0];
      return {
        ...selected,
        service_date: candidate.serviceDate,
        service_seconds: candidate.serviceSeconds,
        expected_wait_seconds: selected.headway_secs / 2,
      };
    }
    return null;
  }

  legacyExpectedWaitSeconds(routeId) {
    const rows = this.rows.filter((row) => row.route_id === String(routeId));
    const maxByService = new Map();
    for (const row of rows) {
      maxByService.set(
        row.service_id,
        Math.max(maxByService.get(row.service_id) || 0, row.headway_secs),
      );
    }
    const weekday = maxByService.get("MonFri");
    const saturday = maxByService.get("Sat");
    const sunday = maxByService.get("Sun");
    if (![weekday, saturday, sunday].every(Number.isFinite)) return null;
    return (weekday * 5 + saturday + sunday) / 14;
  }
}

function normalizeFrequencyRow(row) {
  return {
    route_id: String(row.route_id || ""),
    direction_id:
      row.direction_id === null || row.direction_id === undefined
        ? null
        : String(row.direction_id),
    service_id: String(row.service_id || ""),
    start_time: String(row.start_time || ""),
    end_time: String(row.end_time || ""),
    start_time_seconds: Number(row.start_time_seconds),
    end_time_seconds: Number(row.end_time_seconds),
    headway_secs: Number(row.headway_secs),
  };
}

function compareFrequencyRows(left, right) {
  return (
    left.start_time_seconds - right.start_time_seconds ||
    left.end_time_seconds - right.end_time_seconds ||
    left.headway_secs - right.headway_secs ||
    String(left.direction_id || "").localeCompare(String(right.direction_id || ""))
  );
}

function serviceIdForDate(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 6) return "Sat";
  if (day === 0) return "Sun";
  return "MonFri";
}

function addCalendarDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function parseClockTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatClockSeconds(seconds) {
  const normalized = ((Math.round(seconds) % 86400) + 86400) % 86400;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "Unavailable";
  const roundedMinutes = Math.round(seconds / 60);
  if (roundedMinutes < 60) return `${roundedMinutes} min`;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return `${hours} hr${hours === 1 ? "" : "s"}${minutes ? ` ${minutes} min` : ""}`;
}

function advanceClock(date, seconds, deltaSeconds) {
  let nextSeconds = seconds + Number(deltaSeconds || 0);
  let nextDate = date;
  while (nextSeconds >= 86400) {
    nextSeconds -= 86400;
    nextDate = addCalendarDays(nextDate, 1);
  }
  while (nextSeconds < 0) {
    nextSeconds += 86400;
    nextDate = addCalendarDays(nextDate, -1);
  }
  return { date: nextDate, seconds: nextSeconds };
}

function estimateRoutingPath(path, schedule, options = {}) {
  const mode = options.mode || ROUTING_COSTS.defaultMode;
  const startDate = options.date;
  const startSeconds = Number(options.seconds);
  if (!path || !schedule || !startDate || !Number.isFinite(startSeconds)) return null;

  let clock = { date: startDate, seconds: startSeconds };
  let currentRoute = null;
  let totalWaitingSeconds = 0;
  let knownTravelSeconds = 0;
  let missingTravelTimes = 0;
  let unavailableBoardings = 0;
  const boardings = [];

  for (const edge of path.edges || []) {
    if (edge.kind === "ride") {
      const routeId = String(edge.route_id || "");
      if (routeId !== currentRoute) {
        let waitSeconds = 0;
        let window = null;
        let available = mode === "none";
        if (mode === "time-aware") {
          window = schedule.activeWindow(routeId, edge.direction_id, clock.date, clock.seconds);
          available = Boolean(window);
          if (!window) unavailableBoardings += 1;
          else waitSeconds = window.expected_wait_seconds;
        } else if (mode === "legacy") {
          const legacyWait = schedule.legacyExpectedWaitSeconds(routeId);
          available = Number.isFinite(legacyWait);
          if (!available) unavailableBoardings += 1;
          else waitSeconds = legacyWait;
        }

        boardings.push({
          route_id: routeId,
          direction_id: edge.direction_id ?? null,
          boarding_date: clock.date,
          boarding_seconds: clock.seconds,
          headway_seconds: window?.headway_secs ?? null,
          wait_seconds: waitSeconds,
          service_id: window?.service_id ?? null,
          start_time: window?.start_time ?? null,
          end_time: window?.end_time ?? null,
          available,
        });

        totalWaitingSeconds += waitSeconds;
        clock = advanceClock(clock.date, clock.seconds, waitSeconds);
        currentRoute = routeId;
      }
    } else {
      currentRoute = null;
    }

    const travelSeconds = Number(edge.travel_time_seconds);
    if (Number.isFinite(travelSeconds) && travelSeconds >= 0) {
      knownTravelSeconds += travelSeconds;
      clock = advanceClock(clock.date, clock.seconds, travelSeconds);
    } else {
      missingTravelTimes += 1;
    }
  }

  return {
    mode,
    start_date: startDate,
    start_seconds: startSeconds,
    end_date: clock.date,
    end_seconds: clock.seconds,
    boardings,
    total_waiting_seconds: totalWaitingSeconds,
    known_travel_seconds: knownTravelSeconds,
    known_total_seconds: totalWaitingSeconds + knownTravelSeconds,
    missing_travel_times: missingTravelTimes,
    unavailable_boardings: unavailableBoardings,
  };
}

function kualaLumpurNowParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ROUTING_COSTS.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    installRoutingCostControls();
    waitForRoutingCostData();
  });
}

const renderStructuralRoutingResult =
  typeof renderRoutingResult === "function" ? renderRoutingResult : null;
if (renderStructuralRoutingResult) {
  renderRoutingResult = function renderRoutingResultWithCosts(path) {
    renderStructuralRoutingResult(path);
    routingCostState.currentPath = path;
    renderRoutingCostResult();
  };
}

const clearStructuralRoutingPath =
  typeof clearRoutingPath === "function" ? clearRoutingPath : null;
if (clearStructuralRoutingPath) {
  clearRoutingPath = function clearRoutingPathWithCosts(clearMessage = true) {
    routingCostState.currentPath = null;
    clearStructuralRoutingPath(clearMessage);
    renderRoutingCostResult();
  };
}

function installRoutingCostControls() {
  const body = document.querySelector("#routing-lab-panel .routing-lab-body");
  const graphSummary = document.querySelector("#routing-graph-summary");
  if (!body || !graphSummary || document.querySelector("#routing-cost-controls")) return;

  const now = kualaLumpurNowParts();
  routingCostState.date = now.date;
  routingCostState.time = now.time;

  const section = document.createElement("section");
  section.id = "routing-cost-controls";
  section.className = "routing-cost-controls";
  section.innerHTML = `
    <div class="routing-cost-heading">
      <div>
        <p class="eyebrow">Issue #7</p>
        <h3>Journey clock</h3>
      </div>
      <button class="secondary-button" id="routing-use-now" type="button">Use KL now</button>
    </div>
    <div class="routing-clock-grid">
      <label class="routing-field">
        Date
        <input id="routing-current-date" type="date" value="${now.date}" />
      </label>
      <label class="routing-field">
        Time
        <input id="routing-current-time" type="time" step="60" value="${now.time}" />
      </label>
    </div>
    <label class="routing-field">
      Waiting model
      <select id="routing-waiting-model">
        <option value="time-aware">Half the active headway</option>
        <option value="legacy">2024 weekly-average half-headway</option>
        <option value="none">No waiting time</option>
      </select>
    </label>
    <p class="routing-cost-note">
      Waiting is evaluated after the structural path is selected, matching the 2024 two-stage approach.
    </p>
    <div class="routing-cost-result empty-state" id="routing-cost-result">
      Select a route to inspect its time-dependent boarding waits.
    </div>
  `;
  body.insertBefore(section, graphSummary);

  routingCostState.elements = {
    date: section.querySelector("#routing-current-date"),
    time: section.querySelector("#routing-current-time"),
    mode: section.querySelector("#routing-waiting-model"),
    useNow: section.querySelector("#routing-use-now"),
    result: section.querySelector("#routing-cost-result"),
  };

  routingCostState.elements.date.addEventListener("change", updateRoutingCostInputs);
  routingCostState.elements.time.addEventListener("change", updateRoutingCostInputs);
  routingCostState.elements.mode.addEventListener("change", updateRoutingCostInputs);
  routingCostState.elements.useNow.addEventListener("click", () => {
    const current = kualaLumpurNowParts();
    routingCostState.elements.date.value = current.date;
    routingCostState.elements.time.value = current.time;
    updateRoutingCostInputs();
  });
}

function waitForRoutingCostData(attempt = 0) {
  if (attempt > 250) return;
  if (typeof state === "undefined" || !Array.isArray(state.frequencies)) {
    window.setTimeout(() => waitForRoutingCostData(attempt + 1), 60);
    return;
  }
  routingCostState.schedule = new HeadwaySchedule(state.frequencies);
  renderRoutingCostResult();
}

function updateRoutingCostInputs() {
  routingCostState.date = routingCostState.elements.date.value;
  routingCostState.time = routingCostState.elements.time.value;
  routingCostState.mode = routingCostState.elements.mode.value;
  renderRoutingCostResult();
}

function renderRoutingCostResult() {
  const result = routingCostState.elements.result;
  if (!result) return;
  if (!routingCostState.currentPath || !routingCostState.schedule) {
    result.className = "routing-cost-result empty-state";
    result.textContent = "Select a route to inspect its time-dependent boarding waits.";
    return;
  }

  const seconds = parseClockTime(routingCostState.time);
  const estimate = estimateRoutingPath(routingCostState.currentPath, routingCostState.schedule, {
    mode: routingCostState.mode,
    date: routingCostState.date,
    seconds,
  });
  if (!estimate) {
    result.className = "routing-cost-result empty-state error";
    result.textContent = "Choose a valid date and time.";
    return;
  }

  result.className = "routing-cost-result";
  result.replaceChildren();

  const summary = document.createElement("p");
  summary.className = "routing-cost-summary";
  summary.innerHTML = `<strong>${escapeRoutingHtml(formatDuration(estimate.total_waiting_seconds))}</strong><span>expected waiting · ${estimate.boardings.length} boarding${estimate.boardings.length === 1 ? "" : "s"}</span>`;
  result.append(summary);

  const context = document.createElement("p");
  context.className = "routing-cost-context";
  context.textContent = `${serviceIdForDate(estimate.start_date)} service · ${estimate.start_date} ${formatClockSeconds(estimate.start_seconds)} · Kuala Lumpur time`;
  result.append(context);

  if (estimate.unavailable_boardings) {
    const warning = document.createElement("p");
    warning.className = "routing-cost-warning";
    warning.textContent = `${estimate.unavailable_boardings} boarding${estimate.unavailable_boardings === 1 ? " is" : "s are"} outside a published frequency window.`;
    result.append(warning);
  }

  const list = document.createElement("ol");
  list.className = "routing-wait-list";
  for (const boarding of estimate.boardings) {
    const item = document.createElement("li");
    const route = state.routes.find((candidate) => candidate.route_id === boarding.route_id);
    const name = route?.long_name || boarding.route_id;
    const direction = boarding.direction_id === null ? "" : ` · direction ${boarding.direction_id}`;
    const heading = document.createElement("strong");
    heading.textContent = `${name}${direction}`;
    const detail = document.createElement("span");
    if (routingCostState.mode === "time-aware" && boarding.available) {
      detail.textContent = `${formatClockSeconds(boarding.boarding_seconds)} boarding · ${formatDuration(boarding.headway_seconds)} headway · ${formatDuration(boarding.wait_seconds)} expected wait`;
    } else if (routingCostState.mode === "legacy" && boarding.available) {
      detail.textContent = `${formatDuration(boarding.wait_seconds)} weekly-average expected wait`;
    } else if (routingCostState.mode === "none") {
      detail.textContent = "Waiting disabled";
    } else {
      detail.textContent = `${formatClockSeconds(boarding.boarding_seconds)} · no active frequency window`;
      item.classList.add("unavailable");
    }
    item.append(heading, detail);
    list.append(item);
  }
  result.append(list);

  if (estimate.missing_travel_times) {
    const note = document.createElement("p");
    note.className = "routing-cost-footnote";
    note.textContent = "This snapshot does not yet publish station-to-station run times, so the estimate reports waiting only. The selected path remains the topology result above.";
    result.append(note);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HeadwaySchedule,
    addCalendarDays,
    advanceClock,
    estimateRoutingPath,
    formatClockSeconds,
    formatDuration,
    kualaLumpurNowParts,
    parseClockTime,
    serviceIdForDate,
  };
}
