"""Checks that curated interchange evidence still resolves against a feed."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from .feed import GTFSFeed


def curated_stop_id_report(feed: GTFSFeed, path: str | Path) -> pd.DataFrame:
    """Return one row per curated stop ID and whether it exists in ``stops.txt``."""

    payload: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    references: dict[str, set[str]] = {}
    for record in payload.get("records", []):
        record_id = str(record.get("id", ""))
        for field in ("from_stop_ids", "to_stop_ids"):
            for stop_id in record.get(field, []):
                references.setdefault(str(stop_id), set()).add(record_id)

    available = set(feed.table("stops")["stop_id"].astype(str))
    rows = [
        {
            "stop_id": stop_id,
            "present": stop_id in available,
            "record_ids": tuple(sorted(record_ids)),
        }
        for stop_id, record_ids in sorted(references.items())
    ]
    return pd.DataFrame.from_records(rows, columns=["stop_id", "present", "record_ids"])
