# Metro map style experiments

Issue #31 adds independent controls to the GitHub Pages **Map experiments** panel for interchange symbols, rail lines, and ordinary stations.

## What the controls change

The controls change only MapLibre presentation properties and derived display features. They do not modify GTFS coordinates, route membership, station grouping, shared-track classification, or curated walking links.

### Interchange symbols

- **Hub disc** is the default. It uses a compact white hub, dark outline, and route-colour core.
- **Route petals** places up to four route-colour dots around the station node.
- **Target rings** uses a neutral double-ring symbol.
- **Legacy halo** restores the previous white halo and black ring.

The existing interchange ring remains present as a transparent, enlarged hit target when a newer symbol is selected. Hover and click behavior therefore does not depend on the visible symbol size.

### Rail line treatments

- **Balanced casing** retains the existing contrast-aware line treatment.
- **White-cased schematic** separates lines strongly from the geographic basemap.
- **Dark-cased schematic** increases definition for pale routes and dense corridors.
- **Colour ribbons** emphasizes route colour and minimizes casing.

### Ordinary station treatments

- **Route outline** retains white nodes with route-colour borders.
- **Solid route colour** fills station nodes with the primary route colour.
- **Diagram node** uses neutral white nodes and dark outlines.
- **Minimal dot** removes the station halo and border.

## Pages validation

Compare the styles without moving the map between changes.

1. Start with the whole network around central Kuala Lumpur.
2. Compare **Hub disc**, **Route petals**, and **Target rings** at Titiwangsa, Chan Sow Lin, KL Sentral, and Plaza Rakyat–Merdeka.
3. Switch **Shared-track markers** between boundaries and all multi-line stops. Confirm shared interiors appear only in the broader mode.
4. Select an individual route and confirm unrelated interchange symbols disappear.
5. Compare line treatments where pale, dark, and overlapping routes meet.
6. Zoom through overview, station-code, and station-name levels while trying each ordinary-station treatment.
7. Open the Route lab and confirm highlighted paths, selected stations, and curated walking links remain visually distinct.

Record which combinations remain legible on both desktop and narrow screens before choosing permanent defaults.
