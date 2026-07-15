"""Export browser-friendly, checksum-addressed GTFS snapshots."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from .feed import GTFSFeed
from .quality import inspect_feed

SNAPSHOT_SCHEMA_VERSION = 1


def export_static_snapshot(
    feed: GTFSFeed,
    site_root: str | Path,
    *,
    acquired_at: str | None = None,
) -> dict[str, object]:
    """Write immutable browser data and update the active-snapshot manifest.

    The snapshot directory is derived from the complete GTFS ZIP checksum. The
    immutable files contain only feed-derived data, so exporting the same feed
    produces the same bytes. When an existing manifest already points at the same
    checksum, its acquisition time is retained so a no-op refresh creates no diff.
    """

    root = Path(site_root)
    manifest_path = root / "data" / "manifest.json"
    snapshot_id = feed.provenance.sha256[:12]
    snapshot_root = root / "data" / "snapshots" / snapshot_id
    snapshot_root.mkdir(parents=True, exist_ok=True)

    filenames = {
        "summary": "summary.json",
        "routes": "routes.json",
        "stops": "stops.geojson",
        "patterns": "patterns.json",
        "frequencies": "frequencies.json",
        "quality": "quality.json",
        "shapes": "shapes.geojson",
    }
    payloads: dict[str, object] = {
        "summary": _summary(feed),
        "routes": {"routes": _route_records(feed)},
        "stops": _stop_geojson(feed),
        "patterns": {"patterns": _records(feed.route_patterns())},
        "frequencies": {"frequencies": _frequency_records(feed)},
        "quality": {
            "findings": [finding.to_dict() for finding in inspect_feed(feed).findings]
        },
        "shapes": _shape_geojson(feed),
    }

    for key, filename in filenames.items():
        _write_json(snapshot_root / filename, payloads[key])

    effective_acquired_at = (
        _existing_acquired_at(manifest_path, feed.provenance.sha256)
        or acquired_at
        or feed.provenance.loaded_at
    )
    manifest: dict[str, object] = {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "active_snapshot": snapshot_id,
        "acquired_at": effective_acquired_at,
        "sha256": feed.provenance.sha256,
        "source_url": feed.provenance.source_url,
        "files": {
            key: f"snapshots/{snapshot_id}/{filename}"
            for key, filename in filenames.items()
        },
    }
    _write_json(manifest_path, manifest)
    return manifest


def _summary(feed: GTFSFeed) -> dict[str, object]:
    summary = feed.summary()
    return {
        "sha256": feed.provenance.sha256,
        "tables": summary["tables"],
        "route_count": summary["route_count"],
        "stop_count": summary["stop_count"],
        "trip_count": summary["trip_count"],
        "route_pattern_count": summary["route_pattern_count"],
        "has_shapes": summary["has_shapes"],
        "has_frequencies": summary["has_frequencies"],
        "has_transfers": summary["has_transfers"],
        "has_parent_stations": summary["has_parent_stations"],
        "service_time_bounds": _records(feed.service_time_bounds()),
    }


def _route_records(feed: GTFSFeed) -> list[dict[str, object]]:
    routes = feed.table("routes").copy()
    station_counts = (
        feed.station_routes().groupby("route_id")["stop_id"].nunique().to_dict()
    )
    pattern_counts = (
        feed.route_patterns().groupby("route_id")["pattern_id"].nunique().to_dict()
    )

    records: list[dict[str, object]] = []
    for row in routes.sort_values("route_id", kind="stable").to_dict("records"):
        route_id = str(row["route_id"])
        records.append(
            {
                "route_id": route_id,
                "short_name": _text(row.get("route_short_name"), route_id),
                "long_name": _text(
                    row.get("route_long_name"),
                    _text(row.get("route_short_name"), route_id),
                ),
                "route_type": _clean(row.get("route_type")),
                "color": _color(row.get("route_color"), "5f6b7a"),
                "text_color": _color(row.get("route_text_color"), "ffffff"),
                "station_count": int(station_counts.get(route_id, 0)),
                "pattern_count": int(pattern_counts.get(route_id, 0)),
            }
        )
    return records


def _stop_geojson(feed: GTFSFeed) -> dict[str, object]:
    stops = feed.parsed_table("stops")
    route_lookup = (
        feed.station_routes()
        .groupby("stop_id")["route_id"]
        .apply(lambda values: sorted({str(value) for value in values}))
        .to_dict()
    )

    features: list[dict[str, object]] = []
    for row in stops.sort_values("stop_id", kind="stable").to_dict("records"):
        latitude = _clean(row.get("stop_lat"))
        longitude = _clean(row.get("stop_lon"))
        if latitude is None or longitude is None:
            continue
        stop_id = str(row["stop_id"])
        features.append(
            {
                "type": "Feature",
                "id": stop_id,
                "properties": {
                    "stop_id": stop_id,
                    "stop_name": _text(row.get("stop_name"), stop_id),
                    "route_ids": route_lookup.get(stop_id, []),
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(str(longitude)), float(str(latitude))],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _shape_geojson(feed: GTFSFeed) -> dict[str, object]:
    if "shapes" not in feed.tables or "shape_id" not in feed.table("trips"):
        return {"type": "FeatureCollection", "features": []}

    route_columns = [
        column
        for column in (
            "route_id",
            "route_short_name",
            "route_long_name",
            "route_color",
        )
        if column in feed.table("routes")
    ]
    mappings = (
        feed.table("trips")[["shape_id", "route_id"]]
        .loc[lambda frame: frame["shape_id"].astype(str).str.strip().ne("")]
        .drop_duplicates()
        .merge(feed.table("routes")[route_columns], on="route_id", how="left")
        .sort_values(["route_id", "shape_id"], kind="stable")
    )
    shapes = feed.parsed_table("shapes")

    features: list[dict[str, object]] = []
    for mapping in mappings.to_dict("records"):
        shape_id = str(mapping["shape_id"])
        points = shapes[shapes["shape_id"].astype(str).eq(shape_id)].sort_values(
            "shape_pt_sequence", kind="stable"
        )
        points = points.dropna(subset=["shape_pt_lon", "shape_pt_lat"])
        coordinates = [
            [float(row.shape_pt_lon), float(row.shape_pt_lat)]
            for row in points.itertuples(index=False)
        ]
        if len(coordinates) < 2:
            continue
        route_id = str(mapping["route_id"])
        features.append(
            {
                "type": "Feature",
                "id": f"{route_id}:{shape_id}",
                "properties": {
                    "route_id": route_id,
                    "shape_id": shape_id,
                    "short_name": _text(mapping.get("route_short_name"), route_id),
                    "long_name": _text(
                        mapping.get("route_long_name"),
                        _text(mapping.get("route_short_name"), route_id),
                    ),
                    "color": _color(mapping.get("route_color"), "5f6b7a"),
                },
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _frequency_records(feed: GTFSFeed) -> list[dict[str, object]]:
    if "frequencies" not in feed.tables:
        return []

    frequencies = feed.parsed_table("frequencies")
    trip_columns = [
        column
        for column in ("trip_id", "route_id", "service_id", "direction_id")
        if column in feed.table("trips")
    ]
    joined = frequencies.merge(
        feed.table("trips")[trip_columns], on="trip_id", how="left"
    )
    sort_columns = [
        column
        for column in (
            "route_id",
            "service_id",
            "direction_id",
            "start_time_seconds",
            "trip_id",
        )
        if column in joined
    ]
    return _records(joined.sort_values(sort_columns, kind="stable"))


def _records(frame: pd.DataFrame) -> list[dict[str, object]]:
    return [
        {str(key): _clean(value) for key, value in record.items()}
        for record in frame.to_dict("records")
    ]


def _text(value: object, fallback: str) -> str:
    cleaned = _clean(value)
    return str(cleaned) if cleaned not in (None, "") else fallback


def _color(value: object, fallback: str) -> str:
    text = _text(value, fallback).strip().removeprefix("#")
    return text.lower() if len(text) in (3, 6) else fallback


def _clean(value: Any) -> object:
    if value is None or value is pd.NA:
        return None
    if isinstance(value, tuple):
        return [_clean(item) for item in value]
    if isinstance(value, list):
        return [_clean(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _clean(item) for key, item in value.items()}
    try:
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        return value.item()
    return value


def _existing_acquired_at(path: Path, sha256: str) -> str | None:
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    acquired_at = current.get("acquired_at")
    if current.get("sha256") == sha256 and isinstance(acquired_at, str):
        return acquired_at
    return None


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
