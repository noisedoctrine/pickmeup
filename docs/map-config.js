"use strict";

(() => {
  if (typeof maplibregl === "undefined") {
    throw new Error("MapLibre must load before the Klang Valley map configuration");
  }

  const OriginalMap = maplibregl.Map;
  const KLANG_VALLEY_BOUNDS = [
    [100.75, 2.45],
    [102.35, 3.85],
  ];

  maplibregl.Map = class PickMeUpMap extends OriginalMap {
    constructor(options = {}) {
      super({
        ...options,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [101.69, 3.14],
        zoom: 9.4,
        minZoom: 8.25,
        maxBounds: KLANG_VALLEY_BOUNDS,
        renderWorldCopies: false,
      });
    }
  };
})();
