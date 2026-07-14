"""GTFS service-time helpers.

GTFS times are offsets from the start of a service day. Hours may exceed 23,
so ordinary wall-clock datetime parsing is the wrong representation.
"""

from __future__ import annotations

import re

_TIME_RE = re.compile(r"^(?P<hours>\d+):(?P<minutes>\d{2}):(?P<seconds>\d{2})$")


class GTFSTimeError(ValueError):
    """Raised when a GTFS service time cannot be parsed."""


def parse_gtfs_time(value: str) -> int:
    """Convert a GTFS ``HH:MM:SS`` value to seconds from service-day start.

    Hours are intentionally unbounded. Minutes and seconds must be between 0
    and 59. Leading/trailing whitespace is ignored.
    """

    if not isinstance(value, str):
        raise GTFSTimeError(f"GTFS time must be a string, got {type(value).__name__}")

    text = value.strip()
    match = _TIME_RE.fullmatch(text)
    if match is None:
        raise GTFSTimeError(f"Invalid GTFS time {value!r}; expected HH:MM:SS")

    hours = int(match.group("hours"))
    minutes = int(match.group("minutes"))
    seconds = int(match.group("seconds"))
    if minutes > 59 or seconds > 59:
        raise GTFSTimeError(f"Invalid GTFS time {value!r}; minutes and seconds must be 00-59")

    return hours * 3600 + minutes * 60 + seconds


def format_gtfs_time(total_seconds: int) -> str:
    """Format non-negative seconds from service-day start as ``HH:MM:SS``."""

    if isinstance(total_seconds, bool) or not isinstance(total_seconds, int):
        raise GTFSTimeError("GTFS seconds must be an integer")
    if total_seconds < 0:
        raise GTFSTimeError("GTFS seconds cannot be negative")

    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def gtfs_duration(start: str, end: str) -> int:
    """Return ``end - start`` in seconds without wrapping at midnight."""

    return parse_gtfs_time(end) - parse_gtfs_time(start)
