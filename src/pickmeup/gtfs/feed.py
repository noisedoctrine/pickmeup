"""Inspect-friendly GTFS feed loading and derived table views."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
from typing import Iterable, Mapping
import zipfile

import pandas as pd

from .errors import GTFSLoadError, GTFSStructureError
from .time import parse_gtfs_time

REQUIRED_COLUMNS: dict[str, set[str]] = {
    "stops": {"stop_id", "stop_name", "stop_lat", "stop_lon"},
    "routes": {"route_id", "route_type"},
    "trips": {"route_id", "service_id", "trip_id"},
    "stop_times": {"trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"},
}

TIME_COLUMNS: dict[str, tuple[str, ...]] = {
    "stop_times": ("arrival_time", "departure_time"),
    "frequencies": ("start_time", "end_time"),
}


@dataclass(frozen=True)
class FeedProvenance:
    """Facts that identify a specific feed snapshot."""

    source_url: str | None
    local_path: str
    loaded_at: str
    sha256: str
    filenames: tuple[str, ...]
    row_counts: Mapping[str, int]

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serializable representation."""

        data = asdict(self)
        data["filenames"] = list(self.filenames)
        data["row_counts"] = dict(self.row_counts)
        return data


class GTFSFeed:
    """Raw GTFS tables plus small derived views for interactive exploration.

    Raw tables are loaded as pandas string columns. Numeric conversion and GTFS
    time parsing happen only in derived views, so the original feed values remain
    available for inspection.
    """

    def __init__(self, tables: Mapping[str, pd.DataFrame], provenance: FeedProvenance):
        self.tables = dict(tables)
        self.provenance = provenance
        self.validate_structure()

    @classmethod
    def from_zip(cls, path: str | Path, *, source_url: str | None = None) -> "GTFSFeed":
        """Load every ``.txt`` table from a GTFS ZIP file."""

        zip_path = Path(path)
        try:
            payload = zip_path.read_bytes()
        except OSError as exc:
            raise GTFSLoadError(f"Could not read GTFS ZIP {zip_path}: {exc}") from exc

        digest = hashlib.sha256(payload).hexdigest()
        tables: dict[str, pd.DataFrame] = {}
        filenames: list[str] = []

        try:
            with zipfile.ZipFile(zip_path) as archive:
                members = sorted(
                    name for name in archive.namelist() if not name.endswith("/") and name.lower().endswith(".txt")
                )
                if not members:
                    raise GTFSLoadError(f"GTFS ZIP {zip_path} contains no .txt tables")

                for member in members:
                    table_name = Path(member).stem.lower()
                    if table_name in tables:
                        raise GTFSLoadError(
                            f"GTFS ZIP contains duplicate table name {table_name!r} in different folders"
                        )
                    try:
                        with archive.open(member) as handle:
                            tables[table_name] = pd.read_csv(
                                handle,
                                dtype="string",
                                keep_default_na=False,
                                encoding="utf-8-sig",
                            )
                    except Exception as exc:
                        raise GTFSLoadError(f"Could not parse {member} in {zip_path}: {exc}") from exc
                    filenames.append(member)
        except zipfile.BadZipFile as exc:
            raise GTFSLoadError(f"Not a readable GTFS ZIP: {zip_path}") from exc

        provenance = FeedProvenance(
            source_url=source_url,
            local_path=str(zip_path),
            loaded_at=datetime.now(UTC).isoformat(),
            sha256=digest,
            filenames=tuple(filenames),
            row_counts={name: len(frame) for name, frame in tables.items()},
        )
        return cls(tables, provenance)

    def validate_structure(self) -> None:
        """Check the small core needed for the current exploration workbench."""

        missing_tables = sorted(set(REQUIRED_COLUMNS) - set(self.tables))
        if missing_tables:
            names = ", ".join(f"{name}.txt" for name in missing_tables)
            raise GTFSStructureError(f"GTFS feed is missing required table(s): {names}")

        missing_columns: list[str] = []
        for table_name, required in REQUIRED_COLUMNS.items():
            absent = sorted(required - set(self.tables[table_name].columns))
            if absent:
                missing_columns.append(f"{table_name}.txt: {', '.join(absent)}")
        if missing_columns:
            raise GTFSStructureError("GTFS feed is missing required columns: " + "; ".join(missing_columns))

    def table(self, name: str) -> pd.DataFrame:
        """Return a raw table by name, with or without its ``.txt`` suffix."""

        key = name.removesuffix(".txt").lower()
        try:
            return self.tables[key]
        except KeyError as exc:
            available = ", ".join(sorted(self.tables))
            raise KeyError(f"Unknown GTFS table {name!r}. Available: {available}") from exc

    def write_provenance(self, path: str | Path) -> None:
        """Write snapshot metadata to JSON."""

        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(self.provenance.to_dict(), indent=2) + "\n", encoding="utf-8")

    def parsed_table(self, name: str) -> pd.DataFrame:
        """Return a copy with known numeric and time fields parsed for analysis."""

        key = name.removesuffix(".txt").lower()
        frame = self.table(key).copy()

        numeric_columns = {
            "stops": ("stop_lat", "stop_lon", "location_type", "wheelchair_boarding"),
            "routes": ("route_type", "route_sort_order"),
            "stop_times": ("stop_sequence", "pickup_type", "drop_off_type", "shape_dist_traveled"),
            "frequencies": ("headway_secs", "exact_times"),
            "shapes": ("shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"),
            "transfers": ("transfer_type", "min_transfer_time"),
        }.get(key, ())
        for column in numeric_columns:
            if column in frame:
                frame[column] = pd.to_numeric(frame[column], errors="coerce")

        for column in TIME_COLUMNS.get(key, ()):
            if column in frame:
                frame[f"{column}_seconds"] = frame[column].map(_parse_optional_time).astype("Int64")

        return frame

    def route_stop_membership(self) -> pd.DataFrame:
        """Derive route membership through ``trips`` and ``stop_times`` relationships."""

        stop_times = self.parsed_table("stop_times")
        if "route_id" in stop_times:
            stop_times = stop_times.rename(columns={"route_id": "stop_times_route_id"})
        if "direction_id" in stop_times:
            stop_times = stop_times.rename(columns={"direction_id": "stop_times_direction_id"})

        trip_columns = [
            column
            for column in ("trip_id", "route_id", "service_id", "direction_id", "shape_id", "trip_headsign")
            if column in self.table("trips")
        ]
        joined = stop_times.merge(
            self.table("trips")[trip_columns],
            on="trip_id",
            how="left",
            validate="many_to_one",
        )

        stop_columns = [
            column
            for column in ("stop_id", "stop_name", "stop_lat", "stop_lon", "parent_station")
            if column in self.table("stops")
        ]
        joined = joined.merge(
            self.table("stops")[stop_columns],
            on="stop_id",
            how="left",
            validate="many_to_one",
        )

        route_columns = [
            column
            for column in ("route_id", "route_short_name", "route_long_name", "route_type", "route_color")
            if column in self.table("routes")
        ]
        joined = joined.merge(
            self.table("routes")[route_columns],
            on="route_id",
            how="left",
            validate="many_to_one",
        )

        sort_columns = [
            column for column in ("route_id", "direction_id", "trip_id", "stop_sequence") if column in joined
        ]
        return joined.sort_values(sort_columns, kind="stable").reset_index(drop=True)

    def station_routes(self) -> pd.DataFrame:
        """Return unique stop-to-route relationships derived from GTFS joins."""

        membership = self.route_stop_membership()
        columns = [
            column
            for column in ("stop_id", "stop_name", "route_id", "route_short_name", "route_long_name")
            if column in membership
        ]
        return (
            membership[columns]
            .drop_duplicates()
            .sort_values([column for column in ("stop_id", "route_id") if column in columns], kind="stable")
            .reset_index(drop=True)
        )

    def route_patterns(self) -> pd.DataFrame:
        """Return distinct ordered stop patterns observed for each route/direction."""

        membership = self.route_stop_membership()
        group_columns = [column for column in ("route_id", "direction_id", "trip_id") if column in membership]
        if "trip_id" not in group_columns:
            raise GTFSStructureError("trips.txt does not expose trip_id")

        records: list[dict[str, object]] = []
        for keys, group in membership.groupby(group_columns, dropna=False, sort=True):
            key_values = keys if isinstance(keys, tuple) else (keys,)
            record = dict(zip(group_columns, key_values, strict=True))
            ordered = group.sort_values("stop_sequence", kind="stable")
            record["stop_ids"] = tuple(ordered["stop_id"].astype(str))
            record["stop_count"] = len(ordered)
            records.append(record)

        patterns = pd.DataFrame.from_records(records)
        identity_columns = [column for column in ("route_id", "direction_id", "stop_ids") if column in patterns]
        patterns = patterns.drop_duplicates(identity_columns).reset_index(drop=True)
        patterns.insert(0, "pattern_id", [f"pattern-{index + 1}" for index in range(len(patterns))])
        return patterns

    def service_time_bounds(self) -> pd.DataFrame:
        """Summarize parsed service-time ranges for tables that contain them."""

        records: list[dict[str, object]] = []
        for table_name, columns in TIME_COLUMNS.items():
            if table_name not in self.tables:
                continue
            parsed = self.parsed_table(table_name)
            for column in columns:
                seconds_column = f"{column}_seconds"
                if seconds_column not in parsed:
                    continue
                values = parsed[seconds_column].dropna()
                records.append(
                    {
                        "table": table_name,
                        "column": column,
                        "valid_values": int(values.size),
                        "invalid_values": int(parsed[seconds_column].isna().sum()),
                        "minimum_seconds": int(values.min()) if not values.empty else None,
                        "maximum_seconds": int(values.max()) if not values.empty else None,
                        "values_at_or_after_24h": int((values >= 24 * 3600).sum()),
                    }
                )
        return pd.DataFrame.from_records(records)

    def summary(self) -> dict[str, object]:
        """Return compact facts suitable for JSON, CLI output, or a notebook cell."""

        route_count = self.table("routes")["route_id"].nunique()
        stop_count = self.table("stops")["stop_id"].nunique()
        trip_count = self.table("trips")["trip_id"].nunique()
        pattern_count = len(self.route_patterns())
        return {
            "source_url": self.provenance.source_url,
            "local_path": self.provenance.local_path,
            "loaded_at": self.provenance.loaded_at,
            "sha256": self.provenance.sha256,
            "tables": dict(sorted(self.provenance.row_counts.items())),
            "route_count": int(route_count),
            "stop_count": int(stop_count),
            "trip_count": int(trip_count),
            "route_pattern_count": int(pattern_count),
            "has_shapes": "shapes" in self.tables,
            "has_frequencies": "frequencies" in self.tables,
            "has_transfers": "transfers" in self.tables,
            "has_parent_stations": "parent_station" in self.table("stops").columns,
        }


def _parse_optional_time(value: object) -> int | pd.NA:
    text = str(value).strip()
    if not text:
        return pd.NA
    try:
        return parse_gtfs_time(text)
    except ValueError:
        return pd.NA


def concatenated_values(frames: Iterable[pd.Series]) -> pd.Series:
    """Concatenate string series while preserving pandas' string dtype."""

    return pd.concat(list(frames), ignore_index=True).astype("string")
