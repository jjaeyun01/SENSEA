from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.db import DemoRepository
from app.main import create_app
from app.models import NoiseSummary
from app.routing import find_route, summarize

REQUEST = {
    "start_waypoint": "start",
    "end_waypoint": "library_entrance",
    "noise_preference": "quiet",
    "simulation": True,
}


def test_route_alternatives_use_distance_and_noise(client):
    response = client.post("/routes", json=REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["simulation_only"] is True
    quiet, shortest = body["routes"]
    assert quiet["id"] == "quiet"
    assert quiet["distance_m"] == 280
    assert shortest["distance_m"] == 200
    assert quiet["relative_noise"] < shortest["relative_noise"]
    assert all(route["noise_data_status"] == "demo" for route in body["routes"])
    assert quiet["segments"][0]["noise"]["latest_observed_at"]


def test_demo_requires_explicit_simulation(client):
    response = client.post("/routes", json={**REQUEST, "simulation": False})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "simulation_required"


def test_live_algorithm_excludes_unverified_edges():
    repo = DemoRepository(3600)
    assert (
        find_route(repo.graph, {}, "start", "library_entrance", noise_weight=0, simulation=False)
        is None
    )
    for edge in repo.graph.edges:
        if edge.id in {"start-quad", "quad-library"}:
            edge.pedestrian_verified = True
    path = find_route(repo.graph, {}, "start", "library_entrance", noise_weight=0, simulation=False)
    assert [segment.edge_id for segment in path] == ["start-quad", "quad-library"]


def test_unknown_noise_is_not_silently_zero():
    repo = DemoRepository(3600)
    noise = {
        "start-garden": NoiseSummary(relative_noise=0.1, status="measured"),
        "garden-library": NoiseSummary(relative_noise=0.1, status="measured"),
        # Stale low scores must not make the short route appear quiet.
        "start-quad": NoiseSummary(relative_noise=0, status="stale"),
    }
    path = find_route(
        repo.graph, noise, "start", "library_entrance", noise_weight=2, simulation=True
    )
    assert path[0].edge_id == "start-garden"


def test_partial_measurements_report_coverage():
    repo = DemoRepository(3600)
    path = find_route(
        repo.graph,
        {"start-quad": NoiseSummary(relative_noise=0.4, status="measured")},
        "start",
        "library_entrance",
        noise_weight=0,
        simulation=True,
    )
    result = summarize("shortest", path, simulation=False)
    assert result.noise_data_status == "partial"
    assert result.noise_coverage == 0.5
    assert result.relative_noise == 0.4


def test_reverse_route_uses_reverse_instruction(client):
    response = client.post(
        "/routes",
        json={
            **REQUEST,
            "start_waypoint": "library_entrance",
            "end_waypoint": "start",
        },
    )
    assert response.status_code == 200
    for route in response.json()["routes"]:
        assert route["segments"][-1]["to_waypoint"] == "start"
        assert "출발점" in route["segments"][-1]["instruction"]


@pytest.mark.parametrize(
    "change,code",
    [
        ({"end_waypoint": "missing"}, 404),
        ({"end_waypoint": "start"}, 422),
        ({"noise_preference": "invalid"}, 422),
    ],
)
def test_invalid_route_requests(client, change, code):
    assert client.post("/routes", json={**REQUEST, **change}).status_code == code


def test_identical_alternatives_are_not_duplicated(settings):
    repo = DemoRepository(3600)
    repo.observations.clear()
    with TestClient(create_app(settings, repository=repo)) as client:
        routes = client.post("/routes", json=REQUEST).json()["routes"]
    assert len(routes) == 1
    assert routes[0]["relative_noise"] is None
    assert routes[0]["noise_coverage"] == 0


def test_consent_and_validation_do_not_write(settings):
    repo = DemoRepository(3600)
    original = len(repo.observations["start-quad"])
    with TestClient(create_app(settings, repository=repo)) as client:
        for consent, value, status in [(False, 0.2, 400), ("true", 0.2, 422), (True, 1.1, 422)]:
            response = client.post(
                "/noise",
                json={
                    "edge_id": "start-quad",
                    "relative_noise": value,
                    "consent": consent,
                },
            )
            assert response.status_code == status
        assert len(repo.observations["start-quad"]) == original
        assert (
            client.post(
                "/noise",
                json={
                    "edge_id": "missing",
                    "relative_noise": 0.2,
                    "consent": True,
                },
            ).status_code
            == 404
        )
        response = client.post(
            "/noise",
            json={
                "edge_id": "start-quad",
                "relative_noise": 0.2,
                "consent": True,
            },
        )
        assert response.status_code == 200
        assert response.json()["summary"]["sample_count"] == original + 1


def test_expired_measurements_are_removed():
    repo = DemoRepository(1)
    later = datetime.now(UTC) + timedelta(seconds=2)
    summary = repo.noise_summary("start-quad", later)
    assert summary.relative_noise is None
    assert summary.status == "unknown"
    assert not repo.observations["start-quad"]


def test_places_are_searchable_and_marked_synthetic(client):
    result = client.get("/places", params={"q": "LIBRARY"}).json()
    assert result["simulation_only"] is True
    assert result["places"][0]["waypoint_id"] == "library_entrance"
    assert result["places"][0]["latitude"] is None
    assert client.get("/places?q=missing").json()["places"] == []
