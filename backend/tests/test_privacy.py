import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.db import DemoRepository
from app.foundation import create_app
from app.middleware import UploadCapacityMiddleware
from app.models import NoiseRequest
from app.routing import find_route


@pytest.mark.parametrize("consent", [None, "false"])
def test_no_external_consent_never_calls_vision(settings, jpeg, consent):
    class ForbiddenProvider:
        async def describe(self, jpeg, expected_place):
            pytest.fail("No image may reach the provider without consent")

    fields = {"stationary": "true", "request_id": "00000000-0000-4000-8000-000000000001"}
    if consent is not None:
        fields["external_processing_consent"] = consent
    with TestClient(create_app(settings, provider=ForbiddenProvider())) as client:
        response = client.post(
            "/vision/describe",
            data=fields,
            files={"image": ("private-name.jpg", jpeg, "image/jpeg")},
        )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "external_consent_required"
    assert "private-name" not in response.text
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("path,status", [("/places?q=library", 200), ("/missing", 404)])
def test_success_and_errors_are_not_cached(client, path, status):
    response = client.get(path)
    assert response.status_code == status
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_background_retention_runs_without_requests_and_stops_on_shutdown(settings):
    async def run():
        settings.noise_ttl_seconds = 1
        settings.noise_cleanup_interval_seconds = 0.01
        repo = DemoRepository(1)
        app = create_app(settings, repository=repo)
        async with app.router.lifespan_context(app):
            repo.clear()
            repo.observations["start-quad"].append((datetime.now(UTC) - timedelta(seconds=2), 0.5))
            await asyncio.sleep(0.04)
            assert not repo.observations
            repo.observations["start-quad"].append((datetime.now(UTC), 0.5))
            assert not app.state.noise_cleanup_task.done()
        assert app.state.noise_cleanup_task.done()
        assert not repo.observations

    asyncio.run(run())


def test_retention_boundary_and_maximum_sample_count():
    repo = DemoRepository(3600)
    repo.clear()
    now = datetime.now(UTC)
    repo.observations["start-quad"].extend(
        [
            (now - timedelta(seconds=3600), 0.1),
            (now - timedelta(seconds=3599), 0.2),
        ]
    )
    assert repo.purge_expired(now) == 1
    assert repo.noise_summary("start-quad", now).sample_count == 1
    for _ in range(1005):
        repo.add_noise(NoiseRequest(edge_id="start-quad", relative_noise=0.4, consent=True))
    assert len(repo.observations["start-quad"]) == 1000


@pytest.mark.parametrize("age", [None, -1, 86400, 86401])
def test_live_routing_excludes_unreviewed_future_and_expired_edges(age):
    repo = DemoRepository(3600)
    now = datetime.now(UTC)
    for edge in repo.graph.edges:
        edge.pedestrian_verified = True
        edge.verified_at = None if age is None else now - timedelta(seconds=age)
    assert (
        find_route(
            repo.graph,
            {},
            "start",
            "library_entrance",
            noise_weight=0,
            simulation=False,
            now=now,
        )
        is None
    )


def test_fresh_verification_allows_route_but_never_asserts_safety(client):
    repo = DemoRepository(3600)
    now = datetime.now(UTC)
    for edge in repo.graph.edges:
        edge.pedestrian_verified = True
        edge.verified_at = now - timedelta(seconds=86399)
    assert find_route(
        repo.graph,
        {},
        "start",
        "library_entrance",
        noise_weight=0,
        simulation=False,
        now=now,
    )
    response = client.post(
        "/routes",
        json={
            "start_waypoint": "start",
            "end_waypoint": "library_entrance",
            "simulation": True,
        },
    )
    assert response.json()["navigation_safe"] is False


def test_upload_capacity_rejects_before_read_and_releases_after_cancel():
    async def run():
        entered = asyncio.Event()
        released = asyncio.Event()
        replies = []

        async def downstream(scope, receive, send):
            entered.set()
            await released.wait()

        async def forbidden_read():
            pytest.fail("Over-capacity upload body must never be buffered")

        async def send(message):
            replies.append(message)

        middleware = UploadCapacityMiddleware(downstream, limit=1)
        scope = {"type": "http", "path": "/vision/describe", "method": "POST"}
        first = asyncio.create_task(middleware(scope, forbidden_read, send))
        await entered.wait()
        await middleware(scope, forbidden_read, send)
        assert replies[0]["status"] == 429
        assert middleware.active == 1
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert middleware.active == 0
        released.set()
        await middleware(scope, forbidden_read, send)
        assert middleware.active == 0

    asyncio.run(run())
