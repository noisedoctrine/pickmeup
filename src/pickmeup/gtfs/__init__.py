"""GTFS sourcing, parsing, inspection, plotting, and static export tools."""

from .curated import curated_stop_id_report
from .errors import GTFSError, GTFSLoadError, GTFSStructureError
from .feed import FeedProvenance, GTFSFeed
from .plotting import plot_network
from .quality import QualityFinding, QualityReport, inspect_feed
from .source import RAPID_RAIL_KL_URL, download_feed
from .static_export import SNAPSHOT_SCHEMA_VERSION, export_static_snapshot
from .time import GTFSTimeError, format_gtfs_time, gtfs_duration, parse_gtfs_time

__all__ = [
    "FeedProvenance",
    "GTFSFeed",
    "GTFSError",
    "GTFSLoadError",
    "GTFSStructureError",
    "GTFSTimeError",
    "QualityFinding",
    "QualityReport",
    "RAPID_RAIL_KL_URL",
    "SNAPSHOT_SCHEMA_VERSION",
    "curated_stop_id_report",
    "download_feed",
    "export_static_snapshot",
    "format_gtfs_time",
    "gtfs_duration",
    "inspect_feed",
    "parse_gtfs_time",
    "plot_network",
]
