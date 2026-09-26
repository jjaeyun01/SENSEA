from datetime import datetime, timedelta, timezone

from app.db import INITIAL_NOISE, PATH_EDGES
from app.routing import build_graph, noise_summary, route_alternatives, shortest_path


def test_shortest_and_quiet_paths_differ() -> None:
    routes = route_alternatives(PATH_EDGES, INITIAL_NOISE, "start", "library_entrance")
    assert [segment["to"] for segment in routes[0]["segments"]] == ["quad", "arcade", "library_entrance"]
    assert [segment["to"] for segment in routes[1]["segments"]] == ["garden", "arcade", "library_entrance"]
    assert routes[1]["distance_m"] > routes[0]["distance_m"]
    assert routes[1]["relative_noise"] < routes[0]["relative_noise"]


def test_unverified_edge_is_ignored() -> None:
    graph = build_graph(PATH_EDGES, INITIAL_NOISE)
    nodes, edges, _ = shortest_path(graph, "start", "library_entrance")
    assert nodes != ["start", "library_entrance"]
    assert all(edge["id"] != "edge_unverified_shortcut" for edge in edges)


def test_missing_noise_is_unknown_not_zero() -> None:
    score, status, freshness = noise_summary([])
    assert score is None and status == "unknown" and freshness is None
    routes = route_alternatives(PATH_EDGES, [], "start", "library_entrance")
    assert routes[0]["relative_noise"] is None
    assert routes[0]["noise_data_status"] == "unknown"


def test_stale_noise_remains_distinct() -> None:
    old = [{"relative_noise": 0.3, "observed_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()}]
    score, status, freshness = noise_summary(old)
    assert score == 0.3 and status == "stale" and freshness >= 120


def test_no_route_is_empty() -> None:
    assert route_alternatives(PATH_EDGES, INITIAL_NOISE, "start", "missing") == []
