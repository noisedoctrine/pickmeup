# Interchange candidate validation

This repository preserves a 2024 prototype that generated possible rail interchanges from station-name similarity and geographic proximity. Those signals are useful for candidate discovery but are not sufficient evidence that a usable passenger transfer exists.

The reviewed outcomes are stored for programmatic use in:

`data/curated/interchange_candidate_dispositions.json`

Runtime code should use the file's `runtime_use` field:

- `transfer_edge` — include as a normal curated transfer.
- `optional_out_of_station_edge` — include only when long or out-of-station transfers are enabled.
- `exclude` — do not add to the curated transit-transfer graph.

Rejected candidates are retained in the same file so future regeneration does not silently promote known false positives.

## Legacy dataset profile

The original `interchanges.pickle` is a serialized pandas DataFrame with 49 rows and six columns: `A`, `B`, `haversine_dist`, `distance`, `duration`, and `route`.

Observed structure:

- 11 zero-distance stop-alias relationships.
- 19 short direct-distance overrides.
- 19 routed walking connections.
- 38 non-zero rows representing about 29 physical relationships after aliases are collapsed.
- Walking duration is almost entirely derived from distance at approximately 5 km/h.
- No field records manual approval, rejection, evidence, or reviewer confidence.

The original binary is retained unchanged at `notebooks/legacy/interchanges.pickle`. The readable companion export remains `_interchanges_csv_for_inspection_only.csv`.

## Candidate generation for additional cities

Use broad heuristics to produce candidates, then validate rather than treating the heuristics as truth:

1. Normalize station names and generate cross-line name matches.
2. Generate additional cross-line candidates inside a configurable geographic radius.
3. Collapse known aliases before evaluating duplicate relationships.
4. Prioritize suspicious records where:
   - routed distance is shorter than straight-line distance;
   - routed/straight-line distance ratio is unusually high;
   - multiple stop IDs produce identical routes;
   - a nearby same-line station makes the proposed walk irrational;
   - the station name is historical, duplicated, or ambiguous.
5. Perform OSINT using a mixture of:
   - operator and infrastructure-owner information;
   - public maps, imagery, entrances and pedestrian geometry;
   - station guides, photographs and local transport references;
   - rider reports, forums, Reddit, local blogs and other netizen accounts.
6. Store a disposition, runtime use, classification, confidence, retrieval date, rationale and source list.
7. Never promote proximity alone into a transfer edge.

Informal sources are particularly useful for practical conditions that formal diagrams omit, including separate fare gates, walks through malls, locked or time-limited entrances, construction, poor signage, gradients and realistic passenger walking time.

## Current reviewed candidates

The initial machine-readable records cover:

- Plaza Rakyat (`AG8`/`SP8`) to Merdeka (`KG17`): normal integrated transfer.
- KL Sentral LRT (`KJ15`) to Muzium Negara (`KG15`): official connecting transfer; legacy street-routing metric is unreliable.
- Muzium Negara (`KG15`) to KL Sentral Monorail (`MR1`): usable long out-of-station transfer.
- Sentul (`AG2`/`SP2`) to Titiwangsa MRT (`PY17`): rejected proximity false positive.
- Merdeka (`KG17`) to Maharajalela (`MR3`): ordinary street-walk possibility, excluded from the curated transfer graph.

These conclusions document OSINT reviewed on 2026-07-15. They do not rewrite the notebook or yet wire the data into application logic.
