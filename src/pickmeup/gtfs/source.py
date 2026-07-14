"""Feed download helpers."""

from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .errors import GTFSLoadError
from .feed import GTFSFeed

RAPID_RAIL_KL_URL = "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl"


def download_feed(
    destination: str | Path,
    *,
    url: str = RAPID_RAIL_KL_URL,
    timeout: float = 60.0,
    metadata_path: str | Path | None = None,
) -> GTFSFeed:
    """Download a GTFS ZIP, validate that it loads, and record provenance.

    Existing files are replaced only after the downloaded payload has been parsed
    successfully.
    """

    output = Path(destination)
    output.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": "pickmeup-gtfs-workbench/0.0"})

    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - explicit project data source
            with tempfile.NamedTemporaryFile(delete=False, suffix=".zip", dir=output.parent) as temporary:
                shutil.copyfileobj(response, temporary)
                temporary_path = Path(temporary.name)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise GTFSLoadError(f"Could not download GTFS feed from {url}: {exc}") from exc

    try:
        feed = GTFSFeed.from_zip(temporary_path, source_url=url)
        temporary_path.replace(output)
        feed = GTFSFeed.from_zip(output, source_url=url)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

    sidecar = Path(metadata_path) if metadata_path is not None else output.with_suffix(".metadata.json")
    feed.write_provenance(sidecar)
    return feed
