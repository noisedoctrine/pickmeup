"""Exploratory GTFS structure and data-quality reporting."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable

import pandas as pd

from .feed import GTFSFeed, REQUIRED_COLUMNS, TIME_COLUMNS

KNOWN_COLUMNS: dict[str, set[str]] = {
    "agency": {"agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang", "agency_phone", "agency_fare_url", "agency_email"},
    "stops": {"stop_id", "stop_code", "stop_name", "tts_stop_name", "stop_desc", "stop_lat", "stop_lon", "zone_id", "stop_url", "location_type", "parent_station", "stop_timezone", "wheelchair_boarding", "level_id", "platform_code"},
    "routes": {"route_id", "agency_id", "route_short_name", "route_long_name", "route_desc", "route_type", "route_url", "route_color", "route_text_color", "route_sort_order", "continuous_pickup", "continuous_drop_off", "network_id"},
    "trips": {"route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name", "direction_id", "block_id", "shape_id", "wheelchair_accessible", "bikes_allowed"},
    "stop_times": {"trip_id", "arrival_time", "departure_time", "stop_id", "location_group_id", "location_id", "stop_sequence", "stop_headsign", "start_pickup_drop_off_window", "end_pickup_drop_off_window", "pickup_type", "drop_off_type", "continuous_pickup", "continuous_drop_off", "shape_dist_traveled", "timepoint", "pickup_booking_rule_id", "drop_off_booking_rule_id"},
    "calendar": {"service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"},
    "calendar_dates": {"service_id", "date", "exception_type"},
    "frequencies": {"trip_id", "start_time", "end_time", "headway_secs", "exact_times"},
    "shapes": {"shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"},
    "transfers": {"from_stop_id", "to_stop_id", "from_route_id", "to_route_id", "from_trip_id", "to_trip_id", "transfer_type", "min_transfer_time"},
}

PRIMARY_KEYS: dict[str, tuple[str, ...]] = {
    "agency": ("agency_id",),
    "stops": ("stop_id",),
    "routes": ("route_id",),
    "trips": ("trip_id",),
    "calendar": ("service_id",),
    "calendar_dates": ("service_id", "date"),
    "shapes": ("shape_id", "shape_pt_sequence"),
}


@dataclass(frozen=True)
class QualityFinding:
    severity: str
    category: str
    table: str | None
    count: int
    message: str
    examples: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["examples"] = list(self.examples)
        return data


@dataclass(frozen=True)
class QualityReport:
    findings: tuple[QualityFinding, ...]

    def to_frame(self) -> pd.DataFrame:
        return pd.DataFrame.from_records(finding.to_dict() for finding in self.findings)

    def counts_by_severity(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for finding in self.findings:
            counts[finding.severity] = counts.get(finding.severity, 0) + finding.count
        return counts


def inspect_feed(feed: GTFSFeed) -> QualityReport:
    """Inspect a feed without treating every quirk as a fatal validation error."""

    findings: list[QualityFinding] = []
    findings.extend(_table_structure_findings(feed))
    findings.extend(_duplicate_key_findings(feed))
    findings.extend(_reference_findings(feed))
    findings.extend(_coordinate_findings(feed))
    findings.extend(_time_findings(feed))
    findings.extend(_sequence_findings(feed))
    findings.extend(_relationship_findings(feed))
    return QualityReport(tuple(findings))


def _table_structure_findings(feed: GTFSFeed) -> Iterable[QualityFinding]:
    for table_name in sorted(feed.tables):
        frame = feed.table(table_name)
        if table_name in REQUIRED_COLUMNS:
            missing = sorted(REQUIRED_COLUMNS[table_name] - set(frame.columns))
            if missing:
                yield QualityFinding("error", "missing_columns", table_name, len(missing), "Required columns are missing", tuple(missing))
        known = KNOWN_COLUMNS.get(table_name)
        if known is not None:
            extra = sorted(set(frame.columns) - known)
            if extra:
                yield QualityFinding(
                    "info",
                    "nonstandard_columns",
                    table_name,
                    len(extra),
                    "Columns outside the core GTFS Schedule reference are present",
                    tuple(extra[:10]),
                )

    for optional in ("calendar", "calendar_dates", "frequencies", "shapes", "transfers"):
        if optional not in feed.tables:
            yield QualityFinding("info", "missing_optional_table", optional, 1, f"{optional}.txt is not present")


def _duplicate_key_findings(feed: GTFSFeed) -> Iterable[QualityFinding]:
    for table_name, columns in PRIMARY_KEYS.items():
        if table_name not in feed.tables or not set(columns).issubset(feed.table(table_name).columns):
            continue
        frame = feed.table(table_name)
        duplicates = frame[frame.duplicated(list(columns), keep=False)]
        if not duplicates.empty:
            examples = tuple(
                "|".join(str(value) for value in row)
                for row in duplicates.loc[:, list(columns)].drop_duplicates().head(5).itertuples(index=False, name=None)
            )
            yield QualityFinding(
                "warning",
                "duplicate_key",
                table_name,
                int(len(duplicates)),
                f"Duplicate values found for key {columns}",
                examples,
            )


def _reference_findings(feed: GTFSFeed) -> Iterable[QualityFinding]:
    checks = (
        ("trips", "route_id", "routes", "route_id"),
        ("stop_times", "trip_id", "trips", "trip_id"),
        ("stop_times", "stop_id", "stops", "stop_id"),
    )
    for child_table, child_column, parent_table, parent_column in checks:
        child_values = set(feed.table(child_table)[child_column].dropna().astype(str))
        parent_values = set(feed.table(parent_table)[parent_column].dropna().astype(str))
        missing = sorted(child_values - parent_values)
        if missing:
            yield QualityFinding(
                "error",
                "broken_reference",
                child_table,
                len(missing),
                f"{child_column} values do not resolve in {parent_table}.{parent_column}",
                tuple(missing[:10]),
            )

    if "shape_id" in feed.table("trips") and "shapes" in feed.tables:
        trip_shapes = set(feed.table("trips")["shape_id"].dropna().astype(str)) - {""}
        shapes = set(feed.table("shapes")["shape_id"].dropna().astype(str))
        missing = sorted(trip_shapes - shapes)
        if missing:
            yield QualityFinding("warning", "broken_reference", "trips", len(missing), "shape_id values do not resolve in shapes.txt", tuple(missing[:10]))


def _coordinate_findings(feed: GTFSFeed) -> Iterable[QualityFinding]:
    stops = feed.parsed_table("stops")
    invalid = stops[
        stops["stop_lat"].isna()
        | stops["stop_lon"].isna()
        | ~stops["stop_lat"].between(-90, 90)
        | ~stops["stop_lon"].between(-180, 180)
    ]
    if not invalid.empty:
        yield QualityFinding(
            "error",
            "invalid_coordinates",
            "stops",
            int(len(invalid)),
            "Stops contain missing or out-of-range coordinates",
            tuple(invalid["stop_id"].astype(str).head(10)),
        )


def _time_findings(feed: GTFSFeed) -> Iterable[QualityFinding]:
    for table_name, columns in TIME_COLUMNS.items():
        if table_name not in feed.tables:
            continue
        parsed = feed.parsed_table(table_name)
        for column in columns:
            seconds_column = f"{column}_seconds"
            source_nonempty = parsed[column].astype(str).str.strip().ne("")
            invalid = parsed[source_nonempty & parsed[seconds_column].isna()]
            if not invalid.empty:
                yield QualityFinding(
                    "error",
                    "invalid_service_time",
                    table_name,
                    int(len(invalid)),
                    f"{column} contains values that are not valid GTFS service times",
                    tuple(invalid[column].astype(str).drop_duplicates().head(10)),
                )
            beyond = parsed[parsed[seconds_column].ge(24 * 3600).fillna(False)]
            if not beyond.empty:
                yield QualityFinding(
                    "info",
                    "after_midnight_service_time",
                    table_name,
                    int(len(beyond)),
                    f"{column} contains values at or after 24:00:00",
                    tuple(beyond[column].astype(str).drop_duplicates().head(10)),
                )


def _sequence_findings(feed: GTFSFeed) -> Iterable[QualityFinding]:
    stop_times = feed.parsed_table("stop_times")
    invalid_sequence = stop_times[stop_times["stop_sequence"].isna()]
    if not invalid_sequence.empty:
        yield QualityFinding(
            "error",
            "invalid_stop_sequence",
            "stop_times",
            int(len(invalid_sequence)),
            "stop_sequence contains non-numeric values",
            tuple(invalid_sequence["trip_id"].astype(str).head(10)),
        )
        return

    duplicate_sequence = stop_times[stop_times.duplicated(["trip_id", "stop_sequence"], keep=False)]
    if not duplicate_sequence.empty:
        yield QualityFinding(
            "warning",
            "duplicate_stop_sequence",
            "stop_times",
            int(len(duplicate_sequence)),
            "A trip uses the same stop_sequence more than once",
            tuple(duplicate_sequence["trip_id"].astype(str).drop_duplicates().head(10)),
        )

    negative_trips: list[str] = []
    for trip_id, group in stop_times.groupby("trip_id", sort=False):
        ordered = group.sort_values("stop_sequence", kind="stable")
        arrival = ordered["arrival_time_seconds"]
        departure = ordered["departure_time_seconds"]
        if ((departure - arrival) < 0).fillna(False).any():
            negative_trips.append(str(trip_id))
            continue
        previous_departure = departure.shift(1)
        if ((arrival - previous_departure) < 0).fillna(False).any():
            negative_trips.append(str(trip_id))
    if negative_trips:
        yield QualityFinding(
            "warning",
            "negative_or_nonmonotonic_time",
            "stop_times",
            len(negative_trips),
            "Trips contain negative dwell/travel time or non-monotonic service times",
            tuple(negative_trips[:10]),
        )


def _relationship_findings(feed: GTFSFeed) -> Iterable[QualityFinding]:
    membership = feed.station_routes()
    shared = membership.groupby("stop_id")["route_id"].nunique()
    shared = shared[shared > 1]
    if not shared.empty:
        yield QualityFinding(
            "info",
            "multi_route_stop_id",
            "stops",
            int(len(shared)),
            "Stop IDs are used by more than one route through normal GTFS relationships",
            tuple(shared.index.astype(str)[:10]),
        )

    if "route_id" in feed.table("stop_times").columns:
        membership = feed.route_stop_membership()
        mismatch = membership[
            membership["stop_times_route_id"].astype(str).str.strip().ne("")
            & membership["route_id"].astype(str).str.strip().ne("")
            & membership["stop_times_route_id"].astype(str).ne(membership["route_id"].astype(str))
        ]
        if not mismatch.empty:
            pairs = mismatch[["stop_times_route_id", "route_id"]].drop_duplicates().astype(str).agg(" -> ".join, axis=1)
            yield QualityFinding(
                "info",
                "nonstandard_route_id_disagreement",
                "stop_times",
                int(len(mismatch)),
                "Non-standard stop_times.route_id differs from trips.route_id; trips.route_id should be authoritative",
                tuple(pairs.head(10)),
            )

    if "parent_station" not in feed.table("stops").columns:
        yield QualityFinding("info", "station_hierarchy", "stops", 1, "stops.txt has no parent_station column")
    elif not feed.table("stops")["parent_station"].astype(str).str.strip().ne("").any():
        yield QualityFinding("info", "station_hierarchy", "stops", 1, "parent_station exists but is not populated")

    if "transfers" not in feed.tables:
        yield QualityFinding("info", "transfer_data", "transfers", 1, "No transfers.txt table is available; curated interchange evidence remains relevant")
