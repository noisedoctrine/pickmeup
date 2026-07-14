"""Errors raised by the GTFS data workbench."""


class GTFSError(Exception):
    """Base error for GTFS loading and inspection."""


class GTFSLoadError(GTFSError):
    """Raised when a feed cannot be read."""


class GTFSStructureError(GTFSError):
    """Raised when required GTFS tables or columns are unavailable."""
