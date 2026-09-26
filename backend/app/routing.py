import heapq
from datetime import UTC, datetime
from math import inf

from app.errors import APIError
from app.models import Graph, NoiseSummary, Route, RouteRequest, RouteResponse, Segment
from app.repository import Repository


def find_route(
    graph: Graph,
    noise: dict[str, NoiseSummary],
    start: str,
    goal: str,
    *,
    noise_weight: float,
    simulation: bool,
) -> list[Segment] | None:
    adjacency = {waypoint.id: [] for waypoint in graph.waypoints}
    for edge in graph.edges:
        if not simulation and not edge.pedestrian_verified:
            continue
        adjacency[edge.from_waypoint].append((edge.to_waypoint, edge, edge.instruction))
        if edge.bidirectional and edge.reverse_instruction:
            adjacency[edge.to_waypoint].append((edge.from_waypoint, edge, edge.reverse_instruction))
    queue = [(0.0, start)]
    best = {start: 0.0}
    previous = {}
    while queue:
        cost, node = heapq.heappop(queue)
        if cost > best.get(node, inf):
            continue
        if node == goal:
            segments = []
            while node != start:
                parent, edge, instruction = previous[node]
                segments.append(
                    Segment(
                        edge_id=edge.id,
                        from_waypoint=parent,
                        to_waypoint=node,
                        instruction=instruction,
                        distance_m=edge.distance_m,
                        noise=noise.get(edge.id, NoiseSummary(status="unknown")),
                    )
                )
                node = parent
            return list(reversed(segments))
        for neighbor, edge, instruction in adjacency[node]:
            summary = noise.get(edge.id, NoiseSummary(status="unknown"))
            # Unknown/stale readings are not free quiet shortcuts.
            score = summary.relative_noise
            if score is None or summary.status in {"unknown", "stale"}:
                score = 1.0
            candidate = cost + edge.distance_m * (1 + noise_weight * score)
            if candidate < best.get(neighbor, inf):
                best[neighbor] = candidate
                previous[neighbor] = (node, edge, instruction)
                heapq.heappush(queue, (candidate, neighbor))
    return None


def summarize(route_id: str, segments: list[Segment], simulation: bool) -> Route:
    distance = sum(segment.distance_m for segment in segments)
    measured = [
        segment
        for segment in segments
        if segment.noise.relative_noise is not None and segment.noise.status in {"measured", "demo"}
    ]
    coverage_distance = sum(segment.distance_m for segment in measured)
    coverage = coverage_distance / distance if distance else 0
    score = (
        sum(segment.distance_m * segment.noise.relative_noise for segment in measured)
        / coverage_distance
        if coverage_distance
        else None
    )
    if simulation:
        status = "demo"
    elif coverage == 1:
        status = "measured"
    elif coverage > 0:
        status = "partial"
    elif any(segment.noise.status == "stale" for segment in segments):
        status = "stale"
    else:
        status = "unknown"
    return Route(
        id=route_id,
        distance_m=distance,
        relative_noise=score,
        noise_data_status=status,
        noise_coverage=coverage,
        segments=segments,
    )


def plan_routes(repository: Repository, request: RouteRequest) -> RouteResponse:
    if repository.simulation_only and not request.simulation:
        raise APIError(
            409,
            "simulation_required",
            "현재 데이터는 가상 예제입니다. simulation=true가 필요합니다.",
        )
    graph = repository.get_graph()
    known = {waypoint.id for waypoint in graph.waypoints}
    if request.start_waypoint not in known or request.end_waypoint not in known:
        raise APIError(404, "unknown_waypoint", "등록되지 않은 출발지 또는 목적지입니다.")
    if request.start_waypoint == request.end_waypoint:
        raise APIError(422, "same_waypoint", "출발지와 목적지가 같습니다.")
    now = datetime.now(UTC)
    noise = repository.noise_summaries([edge.id for edge in graph.edges], now)
    candidates = []
    seen = set()
    for route_id, weight in [("shortest", 0.0), ("quiet", 2.0)]:
        segments = find_route(
            graph,
            noise,
            request.start_waypoint,
            request.end_waypoint,
            noise_weight=weight,
            simulation=repository.simulation_only,
        )
        if segments is None:
            continue
        key = tuple(segment.edge_id for segment in segments)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(summarize(route_id, segments, repository.simulation_only))
    if not candidates:
        raise APIError(404, "no_route", "검증된 보행 경로를 찾지 못했습니다.")
    candidates.sort(key=lambda route: route.id != request.noise_preference)
    explanation = "소음 지수는 소리 환경의 상대값이며 인원수나 통행 안전을 의미하지 않습니다."
    if repository.simulation_only:
        explanation = "가상 경로와 예시 소음값을 사용하는 시뮬레이션입니다. " + explanation
    if len(candidates) == 2:
        shortest = next(route for route in candidates if route.id == "shortest")
        quiet = next(route for route in candidates if route.id == "quiet")
        explanation += (
            f" 소음 가중 경로는 최단 경로보다 {quiet.distance_m - shortest.distance_m:g}m 깁니다."
        )
    return RouteResponse(
        simulation_only=repository.simulation_only, routes=candidates, explanation=explanation
    )
