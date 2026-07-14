from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


def test_summary_cli(sample_gtfs_zip: Path) -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "pickmeup.gtfs", "summary", str(sample_gtfs_zip)],
        check=True,
        capture_output=True,
        text=True,
    )
    summary = json.loads(completed.stdout)
    assert summary["route_count"] == 2
    assert summary["stop_count"] == 3
