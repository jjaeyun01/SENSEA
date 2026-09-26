"""Deterministic routing. AI output is never used as graph data."""
import heapq
import json
import math
from pathlib import Path


def load_graph(path: Path) -> dict:
    graph = json.loads(path.read_text())
    nodes = graph["waypoints"]
    if len(nodes) != len(set(nodes)):
        raise ValueError("Duplicate waypoint IDs")
    edge_ids = set()
    for edge in graph["edges"]:
        if edge["id"] in edge_ids:
            raise ValueError("Duplicate edge IDs")
        edge_ids.add(edge["id"])
        if edge["from"] not in nodes or edge["to"] not in nodes:
            raise ValueError("Unknown edge endpoint")
        distance = edge["distance_m"]
        if not math.isfinite(distance) or distance <= 0:
            raise ValueError("Distances must be finite and positive")
        if edge.get("bidirectional") and not edge.get("reverse_instruction"):
            raise ValueError("Bidirectional edges need reverse instructions")
    for place in graph["places"]:
        if place["waypoint_id"] not in nodes:
            raise ValueError("Unknown place waypoint")
    return graph


def shortest_path(graph, start, goal, noise, weight=0.0, simulation=True):
    adjacency = {node: [] for node in graph["waypoints"]}
    for edge in graph["edges"]:
        if not simulation and edge.get("pedestrian_verified") is not True:
            continue
        adjacency[edge["from"]].append((edge["to"], edge, False))
        if edge.get("bidirectional"):
            adjacency[edge["to"]].append((edge["from"], edge, True))
    queue, best, previous = [(0.0, start)], {start: 0.0}, {}
    while queue:
        cost, node = heapq.heappop(queue)
        if cost > best[node]:
            continue
        if node == goal:
            path = []
            while node != start:
                source, edge, reverse = previous[node]
                path.append({
                    "edge_id": edge["id"], "from": source, "to": node,
                    "distance_m": edge["distance_m"],
                    "instruction": edge["reverse_instruction"] if reverse else edge["instruction"],
                    "noise": noise[edge["id"]],
                })
                node = source
            return list(reversed(path))
        for target, edge, reverse in adjacency[node]:
            summary = noise[edge["id"]]
            # Unknown/stale data is penalized, never interpreted as silence.
            score = summary["relative_noise"] if summary["status"] == "measured" else 1.0
            candidate = cost + edge["distance_m"] * (1 + weight * score)
            if candidate < best.get(target, math.inf):
                best[target] = candidate
                previous[target] = (node, edge, reverse)
                heapq.heappush(queue, (candidate, target))
    return None


def summarize_route(segments, kind):
    distance = sum(s["distance_m"] for s in segments)
    measured = [s for s in segments if s["noise"]["status"] == "measured"]
    covered = sum(s["distance_m"] for s in measured)
    complete = bool(segments) and covered == distance
    status = "measured" if complete else "partial" if measured else "unknown"
    if segments and all(s["noise"]["status"] == "stale" for s in segments):
        status = "stale"
    return {
        "id": kind, "distance_m": distance, "segments": segments,
        "relative_noise": round(sum(s["distance_m"] * s["noise"]["relative_noise"] for s in measured) / distance, 4) if complete else None,
        "noise_data_status": status,
        "noise_coverage": covered / distance if distance else 0,
        "oldest_measurement": min((s["noise"]["oldest_observed_at"] for s in measured), default=None),
    }
