# Transit graph experiments

Issue #6 is validated through the GitHub Pages rail explorer rather than a command-line workflow.

The route lab is a collapsible panel over the map. It builds graph representations in the browser from the checksum-addressed GTFS snapshot already loaded by the explorer. The parser and snapshot remain the source of the route patterns; the browser does not download the live feed.

## What the highlighted path means

The highlighted result is a structural path, not a fastest-route recommendation.

The primary rule is the fewest station-to-station graph links. When equal-length alternatives exist, the deterministic tie-break prefers fewer line changes. No travel-time aggregation, waiting model, transfer penalty, timetable search, fare rule, or meeting-point objective is applied. Those belong to issue #7 and later experiments.

## Controls

- **From / To**: activate one field, then click a station on the map. After choosing From, the lab automatically prepares To. Once both are selected, the path updates immediately.
- **Graph representation**:
  - **Route-pattern multigraph** preserves parallel route-pattern edges between the same station groups.
  - **Collapsed station topology** merges parallel ride edges while retaining the routes represented by that link.
- **Curated transfer links**:
  - **Integrated links only** includes accepted `transfer_edge` records.
  - **Include optional out-of-station links** also includes accepted `optional_out_of_station_edge` records.
  - **No curated links** exposes the connectivity provided by route patterns and co-located station groups alone.
- **Respect recorded GTFS direction** uses only directed pattern edges. Turning it off adds synthetic reverse edges for representation comparison.
- **Fit map to highlighted path** controls automatic camera movement.

The panel also reports station-group count, graph-link count, parallel station pairs, and weakly connected components for the selected representation.

## Suggested Pages validation

1. Pick two stations on the same line and confirm the highlighted sequence follows the ordered pattern.
2. Pick stations on lines that meet at a co-located station group, such as Titiwangsa, and inspect the line-change step.
3. Compare the multigraph and collapsed representations. The highlighted path may remain the same while the graph-link count changes.
4. Disable curated transfers and test a pair that depends on Plaza Rakyat–Merdeka or KL Sentral–Muzium Negara connectivity.
5. Enable optional out-of-station links and test whether the Muzium Negara–KL Sentral Monorail connection creates a shorter structural path.
6. Toggle recorded direction for a one-way pattern inspection. A path appearing only with synthetic reverse edges is evidence about representation, not permission to route that way.
7. Inspect the Ampang and Sri Petaling shared corridor. The path should preserve route identity through parallel edges without marking every shared station as a transfer.
8. Collapse and reopen the panel while retaining the map result.

## Deliberate boundaries

This experiment does not:

- estimate journey duration;
- choose a departure time;
- model waiting or missed connections;
- assign transfer or walking penalties;
- rank multiple alternatives;
- call OpenRouteService;
- generate meeting-point candidates;
- claim that the highlighted path is operationally valid or preferable.

The purpose is to make graph structure visible enough to choose what should be carried into the next routing experiments.
