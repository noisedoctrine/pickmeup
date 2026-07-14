from __future__ import annotations

import json
from pathlib import Path
import zipfile

import matplotlib.pyplot as plt
import pytest

from pickmeup.gtfs import GTFSFeed, GTFSLoadError, GTFSStructureError, inspect_feed, plot_network


def test_loads_all_tables_and_preserves_identifiers(sample_gtfs_zip: Path) -> None:
    feed = GTFSFeed.from_zip(sample_gtfs_zip, source_url="https://example.test/feed")

    assert set(feed.tables) == {
        "agency",
        "calendar",
        "custom",
        "frequencies",
        "routes",
        "shapes",
        "stop_times",
        "stops",
        "trips",
    }
    assert feed.table("stops").loc[0, "stop_id"] == "001"
    assert str(feed.table("stops").dtypes["stop_id"]) == "string"
    assert feed.provenance.sha256
    assert feed.provenance.row_counts["stop_times"] == 5


def test_derived_views_use_normal_gtfs_relationships(sample_gtfs_zip: Path) -> None:
    feed = GTFSFeed.from_zip(sample_gtfs_zip)
    membership = feed.route_stop_membership()

    assert set(membership.query("trip_id == 'T1'")["route_id"]) == {"R1"}
    assert set(membership.query("trip_id == 'T1'")["stop_times_route_id"]) == {"LEGACY1"}
    assert set(feed.station_routes().query("stop_id == '001'")["route_id"]) == {"R1", "R2"}
    assert len(feed.route_patterns()) == 2


def test_parses_after_midnight_values_without_changing_raw_table(sample_gtfs_zip: Path) -> None:
    feed = GTFSFeed.from_zip(sample_gtfs_zip)
    parsed = feed.parsed_table("stop_times")

    assert parsed.loc[2, "arrival_time_seconds"] == 24 * 3600 + 15 * 60
    assert feed.table("stop_times").loc[2, "arrival_time"] == "24:15:00"
    bounds = feed.service_time_bounds()
    stop_arrivals = bounds.query("table == 'stop_times' and column == 'arrival_time'").iloc[0]
    assert stop_arrivals["values_at_or_after_24h"] == 2


def test_quality_report_surfaces_quirks_without_rejecting_feed(sample_gtfs_zip: Path) -> None:
    feed = GTFSFeed.from_zip(sample_gtfs_zip)
    findings = inspect_feed(feed).to_frame()

    categories = set(findings["category"])
    assert "after_midnight_service_time" in categories
    assert "nonstandard_route_id_disagreement" in categories
    assert "multi_route_stop_id" in categories
    assert "transfer_data" in categories
    assert not ((findings["category"] == "broken_reference") & (findings["severity"] == "error")).any()


def test_quality_report_handles_duplicate_parent_ids(sample_gtfs_zip: Path, tmp_path: Path) -> None:
    duplicate_zip = tmp_path / "duplicate-trip.zip"
    with zipfile.ZipFile(sample_gtfs_zip) as source, zipfile.ZipFile(duplicate_zip, "w") as target:
        for member in source.infolist():
            payload = source.read(member.filename)
            if member.filename == "trips.txt":
                payload += b"R1,weekday,T1,Gamma again,0,S1\n"
            target.writestr(member, payload)

    findings = inspect_feed(GTFSFeed.from_zip(duplicate_zip)).to_frame()
    categories = set(findings["category"])
    assert "duplicate_key" in categories
    assert "relationship_analysis_skipped" in categories


def test_summary_and_provenance_are_json_serializable(sample_gtfs_zip: Path, tmp_path: Path) -> None:
    feed = GTFSFeed.from_zip(sample_gtfs_zip)
    assert feed.summary()["route_count"] == 2
    assert feed.summary()["has_shapes"] is True

    output = tmp_path / "metadata.json"
    feed.write_provenance(output)
    data = json.loads(output.read_text())
    assert data["sha256"] == feed.provenance.sha256
    assert data["row_counts"]["routes"] == 2


def test_plot_network_returns_reusable_axes(sample_gtfs_zip: Path) -> None:
    feed = GTFSFeed.from_zip(sample_gtfs_zip)
    axes = plot_network(feed, route_id="R1", label_stops=True)
    assert axes.get_title() == "GTFS route R1"
    assert axes.lines
    plt.close(axes.figure)


def test_bad_zip_has_readable_error(tmp_path: Path) -> None:
    bad = tmp_path / "not-a-feed.zip"
    bad.write_text("nope")
    with pytest.raises(GTFSLoadError, match="Not a readable GTFS ZIP"):
        GTFSFeed.from_zip(bad)


def test_missing_required_table_has_readable_error(tmp_path: Path) -> None:
    path = tmp_path / "missing.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("stops.txt", "stop_id,stop_name,stop_lat,stop_lon\n1,A,1,1\n")
    with pytest.raises(GTFSStructureError, match="missing required table"):
        GTFSFeed.from_zip(path)


def test_curated_stop_id_report(sample_gtfs_zip: Path, tmp_path: Path) -> None:
    from pickmeup.gtfs import curated_stop_id_report

    curated = tmp_path / "curated.json"
    curated.write_text(
        json.dumps(
            {
                "records": [
                    {"id": "known", "from_stop_ids": ["001"], "to_stop_ids": ["003"]},
                    {"id": "missing", "from_stop_ids": ["999"], "to_stop_ids": []},
                ]
            }
        )
    )
    report = curated_stop_id_report(GTFSFeed.from_zip(sample_gtfs_zip), curated)
    assert report.set_index("stop_id").loc["001", "present"]
    assert not report.set_index("stop_id").loc["999", "present"]
