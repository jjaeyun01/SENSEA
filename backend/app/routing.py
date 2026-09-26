"""Dijkstra routing over pedestrian-verified graph edges only."""
from __future__ import annotations

import heapq
from datetime import datetime, timezone
from math import inf
from typing import Any, Literal

NoiseStatus = Literal["measured", "stale", "unknown"]
STALE_AFTER_MINUTES = 60
UNKNOWN_NOISE_PENALTY = 1.0


def noise_summary(observations: list[dict[str, Any]]) -> tuple[float | None, NoiseStatus, int | None]:
    if not observations:
        return None, "unknown", None
    latest = max(observations, key=lambda item: item["observed_at"])
    observed = datetime.fromisoformat(str(latest["observed_at"]).replace("Z", "+00:00"))
    age = max(0, int((datetime.now(timezone.utc) - observed.astimezone(timezone.utc)).total_seconds() // 60))
    values = [float(item["relative_noise"]) for item in observations]
    return round(sum(values) / len(values), 3), ("stale" if age > STALE_AFTER_MINUTES else "measured"), age


def build_graph(edges: list[dict[str, Any]], observations: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    graph: dict[str, list[dict[str, Any]]] = {}
    by_edge: dict[str, list[dict[str, Any]]] = {}
    for item in observations:
        by_edge.setdefault(str(item["edge_id"]), []).append(item)
    for edge in edges:
        if not edge.get("pedestrian_verified"):
            continue
        score, status, freshness = noise_summary(by_edge.get(str(edge["id"]), []))
        enriched = {**edge, "noise_score": score, "noise_status": status, "noise_freshness_minutes": freshness}
        graph.setdefault(str(edge["from_waypoint"]), []).append({**enriched, "neighbor": edge["to_waypoint"], "reverse": False})
        if edge.get("bidirectional", True):
            graph.setdefault(str(edge["to_waypoint"]), []).append({**enriched, "neighbor": edge["from_waypoint"], "reverse": True})
    return graph


def shortest_path(graph: dict[str, list[dict[str, Any]]], start: str, goal: str, noise_weight: float = 0.0) -> tuple[list[str] | None, list[dict[str, Any]], float]:
    queue: list[tuple[float, str]] = [(0.0, start)]
    best = {start: 0.0}
    previous: dict[str, tuple[str, dict[str, Any]]] = {}
    while queue:
        cost, node = heapq.heappop(queue)
        if cost > best.get(node, inf):
            continue
        if node == goal:
            nodes, used = [goal], []
            while nodes[-1] != start:
                prior, edge = previous[nodes[-1]]
                used.append(edge)
                nodes.append(prior)
            return list(reversed(nodes)), list(reversed(used)), cost
        for edge in graph.get(node, []):
            score = edge["noise_score"]
            effective_noise = float(score) if score is not None and edge["noise_status"] == "measured" else UNKNOWN_NOISE_PENALTY
            next_cost = cost + float(edge["distance_m"]) * (1 + noise_weight * effective_noise)
            neighbor = str(edge["neighbor"])
            if next_cost < best.get(neighbor, inf):
                best[neighbor] = next_cost
                previous[neighbor] = (node, edge)
                heapq.heappush(queue, (next_cost, neighbor))
    return None, [], inf


def _route_payload(route_id: str, label: str, nodes: list[str], edges: list[dict[str, Any]]) -> dict[str, Any]:
    distance = round(sum(float(edge["distance_m"]) for edge in edges))
    statuses = {edge["noise_status"] for edge in edges}
    status: NoiseStatus = "unknown" if "unknown" in statuses else ("stale" if "stale" in statuses else "measured")
    measured = [(float(edge["noise_score"]), float(edge["distance_m"])) for edge in edges if edge["noise_score"] is not None]
    measured_distance = sum(weight for _, weight in measured)
    relative_noise = round(sum(score * weight for score, weight in measured) / measured_distance, 2) if measured and status != "unknown" else None
    freshness = [edge["noise_freshness_minutes"] for edge in edges if edge["noise_freshness_minutes"] is not None]
    segments = []
    for index, edge in enumerate(edges):
        from_node, to_node = nodes[index], nodes[index + 1]
        instruction = str(edge["instruction"])
        if edge.get("reverse"):
            instruction = f"Continue {round(float(edge['distance_m']))} meters along the verified pedestrian segment toward {to_node.replace('_', ' ')}."
        segments.append({"edge_id": edge["id"], "from": from_node, "to": to_node, "distance_m": round(float(edge["distance_m"])), "instruction": instruction, "pedestrian_verified": True})
    return {"id": route_id, "label": label, "distance_m": distance, "relative_noise": relative_noise, "noise_data_status": status, "noise_freshness_minutes": max(freshness) if freshness and status != "unknown" else None, "segments": segments}


def route_alternatives(edges: list[dict[str, Any]], observations: list[dict[str, Any]], start: str, goal: str) -> list[dict[str, Any]]:
    graph = build_graph(edges, observations)
    shortest_nodes, shortest_edges, _ = shortest_path(graph, start, goal)
    if not shortest_nodes:
        return []
    quiet_nodes, quiet_edges, _ = shortest_path(graph, start, goal, noise_weight=1.5)
    routes = [_route_payload("shortest-route", "Shortest route", shortest_nodes, shortest_edges)]
    if quiet_nodes and quiet_nodes != shortest_nodes:
        routes.append(_route_payload("quiet-route", "Lower measured noise route", quiet_nodes, quiet_edges))
    return routes
