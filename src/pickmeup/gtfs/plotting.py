"""Lightweight plotting helpers for GTFS inspection."""

from __future__ import annotations

from typing import Any

import matplotlib.pyplot as plt
import pandas as pd

from .feed import GTFSFeed


def plot_network(
    feed: GTFSFeed,
    *,
    route_id: str | None = None,
    ax: Any | None = None,
    label_stops: bool = False,
) -> Any:
    """Plot route shapes (or stop sequences) and station points.

    The function intentionally returns the Matplotlib axes so notebooks and a
    future local UI can add their own annotations and layers.
    """

    if ax is None:
        _, ax = plt.subplots(figsize=(10, 8))

    routes = feed.table("routes")
    route_colors = {
        str(row.route_id): _matplotlib_color(getattr(row, "route_color", ""))
        for row in routes.itertuples(index=False)
    }

    used_shapes = False
    if "shapes" in feed.tables and "shape_id" in feed.table("trips").columns:
        shapes = feed.parsed_table("shapes")
        shape_routes = (
            feed.table("trips")[["shape_id", "route_id"]]
            .query("shape_id != ''")
            .drop_duplicates("shape_id")
        )
        shapes = shapes.merge(shape_routes, on="shape_id", how="left")
        if route_id is not None:
            shapes = shapes[shapes["route_id"] == route_id]
        for (shape_id, current_route), points in shapes.groupby(["shape_id", "route_id"], dropna=False, sort=True):
            points = points.sort_values("shape_pt_sequence", kind="stable")
            ax.plot(
                points["shape_pt_lon"],
                points["shape_pt_lat"],
                linewidth=2,
                alpha=0.8,
                color=route_colors.get(str(current_route)),
                label=str(current_route),
            )
            used_shapes = True

    if not used_shapes:
        membership = feed.route_stop_membership()
        if route_id is not None:
            membership = membership[membership["route_id"] == route_id]
        for (_, _, trip_id), stops in membership.groupby(["route_id", "direction_id", "trip_id"], dropna=False, sort=True):
            stops = stops.sort_values("stop_sequence", kind="stable")
            lon = pd.to_numeric(stops["stop_lon"], errors="coerce")
            lat = pd.to_numeric(stops["stop_lat"], errors="coerce")
            current_route = str(stops["route_id"].iloc[0])
            ax.plot(lon, lat, linewidth=1.5, alpha=0.7, color=route_colors.get(current_route), label=current_route)

    stops = feed.parsed_table("stops")
    if route_id is not None:
        stop_ids = set(feed.station_routes().query("route_id == @route_id")["stop_id"])
        stops = stops[stops["stop_id"].isin(stop_ids)]
    ax.scatter(stops["stop_lon"], stops["stop_lat"], s=12, zorder=3)

    if label_stops:
        for stop in stops.itertuples(index=False):
            ax.annotate(str(stop.stop_id), (stop.stop_lon, stop.stop_lat), fontsize=6)

    handles, labels = ax.get_legend_handles_labels()
    unique = dict(zip(labels, handles, strict=False))
    if unique:
        ax.legend(unique.values(), unique.keys(), title="Route", fontsize=8)
    ax.set_title("Kuala Lumpur GTFS network" if route_id is None else f"GTFS route {route_id}")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.set_aspect("equal", adjustable="datalim")
    return ax


def _matplotlib_color(value: object) -> str | None:
    text = str(value).strip().lstrip("#")
    if len(text) == 6 and all(character in "0123456789abcdefABCDEF" for character in text):
        return f"#{text}"
    return None
