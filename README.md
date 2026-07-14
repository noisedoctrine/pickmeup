# pickmeup

PickMeUp is a personal transport experiment built around a question that sounded fun enough to investigate:

> Where could someone taking the train meet someone driving, so they can continue to the same destination without making either journey unnecessarily awful?

Kuala Lumpur is the test bed. The interesting parts are the data, maps, route choices, waiting, transfers, and all the tradeoffs that appear once two journeys have to meet in the middle.

## Where the project is now

The original 2024 notebook is preserved in [`notebooks/original_exploration.ipynb`](notebooks/original_exploration.ipynb). It contains the first GTFS, NetworkX, OpenRouteService, interchange, and plotting experiments. It also contains shortcuts and assumptions that are useful to study rather than blindly carry forward.

The current package work starts with a GTFS data workbench under `src/pickmeup/gtfs/`. It can:

- download or reopen a Rapid KL rail GTFS ZIP;
- keep every included table available as raw string-valued pandas DataFrames;
- parse GTFS service times, including values after midnight such as `24:15:00`;
- derive route, stop, trip, pattern, and service-time views through normal GTFS relationships;
- report feed quirks without pretending every oddity makes the whole feed unusable;
- check curated interchange stop IDs against a feed snapshot;
- plot route shapes and station locations for quick inspection.

It does **not** choose transit routes or meeting points yet. That comes after the data is understood well enough to make the experiments interesting.

## Setup

PickMeUp requires Python 3.12 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
```

On Windows, activate the environment with `.venv\Scripts\activate`.

## GTFS workbench

Download the current official Rapid KL rail feed:

```bash
python -m pickmeup.gtfs download data/raw/rapid-rail-kl.zip
```

The ZIP is ignored by Git. A metadata sidecar is written next to it with the source URL, checksum, filenames, row counts, and load time.

Inspect a local feed:

```bash
python -m pickmeup.gtfs summary data/raw/rapid-rail-kl.zip
python -m pickmeup.gtfs quality data/raw/rapid-rail-kl.zip
python -m pickmeup.gtfs curated \
  data/raw/rapid-rail-kl.zip \
  data/curated/interchange_candidate_dispositions.json
python -m pickmeup.gtfs plot \
  data/raw/rapid-rail-kl.zip \
  data/raw/rapid-rail-kl.png
```

The Python API is intentionally small and notebook-friendly:

```python
from pickmeup.gtfs import GTFSFeed, inspect_feed, plot_network

feed = GTFSFeed.from_zip("data/raw/rapid-rail-kl.zip")
feed.summary()
feed.route_patterns()
inspect_feed(feed).to_frame()
plot_network(feed)
```

The 2024 assumptions and the inspected 2026 feed snapshot are compared in [`docs/gtfs_2024_to_2026.md`](docs/gtfs_2024_to_2026.md).

## Repository guide

- `src/pickmeup/gtfs/` — current GTFS sourcing, parsing, inspection, and plotting code.
- `tests/` — focused tests for objective parsing and relationship behaviour.
- `notebooks/original_exploration.ipynb` — the preserved 2024 prototype.
- `notebooks/legacy/interchanges.pickle` — the original interchange DataFrame retained as evidence.
- `_interchanges_csv_for_inspection_only.csv` — a readable export of that legacy data.
- `data/curated/interchange_candidate_dispositions.json` — reviewed interchange decisions that later experiments can consume.
- `docs/interchange_candidate_validation.md` — notes on how those candidate decisions were investigated.

## API key

OpenRouteService is not needed for GTFS parsing. Later road-routing experiments will use the `OPENROUTESERVICE` environment variable shown in `.env.example`.

Do not commit real credentials.
