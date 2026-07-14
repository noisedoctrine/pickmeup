"""Small command-line entry point for the GTFS workbench."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .curated import curated_stop_id_report
from .feed import GTFSFeed
from .plotting import plot_network
from .quality import inspect_feed
from .source import RAPID_RAIL_KL_URL, download_feed
from .static_export import export_static_snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect Kuala Lumpur GTFS data")
    subparsers = parser.add_subparsers(dest="command", required=True)

    download_parser = subparsers.add_parser(
        "download", help="Download the current official Rapid KL rail feed"
    )
    download_parser.add_argument("destination", type=Path)
    download_parser.add_argument("--url", default=RAPID_RAIL_KL_URL)

    summary_parser = subparsers.add_parser("summary", help="Print a compact feed summary")
    summary_parser.add_argument("feed", type=Path)

    quality_parser = subparsers.add_parser("quality", help="Print exploratory quality findings")
    quality_parser.add_argument("feed", type=Path)

    curated_parser = subparsers.add_parser(
        "curated", help="Check curated interchange stop IDs against a feed"
    )
    curated_parser.add_argument("feed", type=Path)
    curated_parser.add_argument("curated_json", type=Path)

    plot_parser = subparsers.add_parser("plot", help="Render the network to an image")
    plot_parser.add_argument("feed", type=Path)
    plot_parser.add_argument("output", type=Path)
    plot_parser.add_argument("--route-id")
    plot_parser.add_argument("--label-stops", action="store_true")

    export_parser = subparsers.add_parser(
        "export-static", help="Export a checksum-addressed browser snapshot"
    )
    export_parser.add_argument("feed", type=Path)
    export_parser.add_argument("site_root", type=Path)
    export_parser.add_argument("--metadata", type=Path)
    export_parser.add_argument("--acquired-at")
    export_parser.add_argument("--source-url")

    args = parser.parse_args()
    if args.command == "download":
        feed = download_feed(args.destination, url=args.url)
        print(json.dumps(feed.summary(), indent=2))
        return

    if args.command == "export-static":
        metadata = _read_metadata(args.metadata)
        source_url = args.source_url or metadata.get("source_url")
        acquired_at = args.acquired_at or metadata.get("loaded_at")
        feed = GTFSFeed.from_zip(args.feed, source_url=source_url)
        manifest = export_static_snapshot(
            feed,
            args.site_root,
            acquired_at=str(acquired_at) if acquired_at else None,
        )
        print(json.dumps(manifest, indent=2))
        return

    feed = GTFSFeed.from_zip(args.feed)
    if args.command == "summary":
        print(json.dumps(feed.summary(), indent=2))
    elif args.command == "quality":
        report = inspect_feed(feed).to_frame()
        print(report.to_string(index=False) if not report.empty else "No findings")
    elif args.command == "curated":
        report = curated_stop_id_report(feed, args.curated_json)
        print(report.to_string(index=False))
    elif args.command == "plot":
        axes = plot_network(feed, route_id=args.route_id, label_stops=args.label_stops)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        axes.figure.savefig(args.output, dpi=160, bbox_inches="tight")
        print(args.output)


def _read_metadata(path: Path | None) -> dict[str, object]:
    if path is None:
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
