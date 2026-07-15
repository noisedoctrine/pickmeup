from __future__ import annotations

import json
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PUBLISHED_FIELDS = {
    "id",
    "from_stop_ids",
    "to_stop_ids",
    "disposition",
    "runtime_use",
    "classification",
    "covered",
}


def test_browser_interchanges_publish_only_accepted_curated_records() -> None:
    curated = json.loads(
        (REPOSITORY_ROOT / "data/curated/interchange_candidate_dispositions.json").read_text()
    )
    browser = json.loads((REPOSITORY_ROOT / "docs/data/interchanges.json").read_text())

    accepted = {
        record["id"]: record
        for record in curated["records"]
        if record["disposition"] == "accepted" and record["runtime_use"] != "exclude"
    }
    published = {record["id"]: record for record in browser["records"]}

    assert published.keys() == accepted.keys()
    for record_id, published_record in published.items():
        source_record = accepted[record_id]
        assert PUBLISHED_FIELDS <= published_record.keys()
        for field in PUBLISHED_FIELDS:
            assert published_record[field] == source_record[field]
