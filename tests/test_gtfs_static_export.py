from __future__ import annotations

import json
from pathlib import Path

from pickmeup.gtfs import GTFSFeed, export_static_snapshot


def test_exports_browser_ready_checksum_snapshot(
    sample_gtfs_zip: Path, tmp_path: Path
) -> None:
    feed = GTFSFeed.from_zip(
        sample_gtfs_zip, source_url="https://example.test/rapid-rail-kl"
    )

    manifest = export_static_snapshot(
        feed,
        tmp_path / "docs",
        acquired_at="2026-07-15T08:00:00+08:00",
    )

    snapshot_id = feed.provenance.sha256[:12]
    snapshot_root = tmp_path / "docs" / "data" / "snapshots" / snapshot_id
    assert manifest["active_snapshot"] == snapshot_id
    assert manifest["sha256"] == feed.provenance.sha256
    assert manifest["acquired_at"] == "2026-07-15T08:00:00+08:00"
    assert snapshot_root.is_dir()

    routes = json.loads((snapshot_root / "routes.json").read_text())
    stops = json.loads((snapshot_root / "stops.geojson").read_text())
    shapes = json.loads((snapshot_root / "shapes.geojson").read_text())
    patterns = json.loads((snapshot_root / "patterns.json").read_text())

    assert [route["route_id"] for route in routes["routes"]] == ["R1", "R2"]
    assert {feature["id"] for feature in stops["features"]} == {
        "001",
        "002",
        "003",
    }
    assert len(shapes["features"]) == 2
    assert patterns["patterns"][0]["stop_ids"] == ["001", "002", "003"]


def test_immutable_snapshot_files_are_deterministic(
    sample_gtfs_zip: Path, tmp_path: Path
) -> None:
    feed = GTFSFeed.from_zip(sample_gtfs_zip)
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"

    export_static_snapshot(
        feed,
        first_root,
        acquired_at="2026-07-15T08:00:00+08:00",
    )
    export_static_snapshot(
        feed,
        second_root,
        acquired_at="2026-07-16T08:00:00+08:00",
    )

    snapshot_id = feed.provenance.sha256[:12]
    first_snapshot = first_root / "data" / "snapshots" / snapshot_id
    second_snapshot = second_root / "data" / "snapshots" / snapshot_id
    first_files = sorted(path.relative_to(first_snapshot) for path in first_snapshot.iterdir())
    second_files = sorted(path.relative_to(second_snapshot) for path in second_snapshot.iterdir())

    assert first_files == second_files
    for relative_path in first_files:
        assert (first_snapshot / relative_path).read_bytes() == (
            second_snapshot / relative_path
        ).read_bytes()

    first_manifest = json.loads((first_root / "data" / "manifest.json").read_text())
    second_manifest = json.loads((second_root / "data" / "manifest.json").read_text())
    assert first_manifest["acquired_at"] != second_manifest["acquired_at"]
    first_manifest.pop("acquired_at")
    second_manifest.pop("acquired_at")
    assert first_manifest == second_manifest
