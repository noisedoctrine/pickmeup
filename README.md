# pickmeup

PickMeUp is an experimental journey-planning project for finding a meeting point where a passenger using public transit can meet a driver before both continue to a shared destination.

## Project status

The repository currently contains an incomplete 2024 research prototype. It is preserved for reference in [`notebooks/original_exploration.ipynb`](notebooks/original_exploration.ipynb), but it is not yet an installable or supported application.

The prototype is notebook-driven, may require external data and an OpenRouteService API key, and contains exploratory assumptions that have not yet been validated for production use. New implementation work will be developed as package code under `src/pickmeup/` with tests under `tests/`.

Legacy interchange evidence is preserved in `notebooks/legacy/interchanges.pickle` and `_interchanges_csv_for_inspection_only.csv`. OSINT-reviewed candidate dispositions are stored in the machine-readable `data/curated/interchange_candidate_dispositions.json`; explanatory methodology is documented in `docs/interchange_candidate_validation.md`.

## Intended behavior

Given:

- a passenger origin,
- a driver origin,
- a shared destination, and
- a departure time,

PickMeUp is intended to rank feasible transit meeting candidates by considering passenger travel, driver travel, waiting, transfers, walking, and the onward drive to the final destination. Recommendations will also be compared with the direct-pickup baseline in which the driver first collects the passenger at their origin.

This intended behavior is not yet available as a stable package or command-line interface.

## Repository layout

- `notebooks/original_exploration.ipynb` — preserved 2024 prototype and exploration.
- `notebooks/legacy/interchanges.pickle` — original serialized interchange DataFrame retained as legacy evidence.
- `_interchanges_csv_for_inspection_only.csv` — readable export of the legacy interchange data.
- `data/curated/interchange_candidate_dispositions.json` — parseable OSINT decisions for reviewed candidates.
- `docs/interchange_candidate_validation.md` — candidate-generation and OSINT-validation method.
- `src/pickmeup/` — package code for the recovered implementation.
- `tests/` — automated tests for package code.

## Development

The package and reproducible development environment will be introduced in follow-up work. Importing `pickmeup` currently performs no network calls or notebook execution.
