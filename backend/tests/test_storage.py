import asyncio
import json
from datetime import UTC, datetime, timedelta
from threading import Event

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import check_storage
from app.config import Settings
from app.db import DemoRepository
from app.main import create_app
from app.models import NoiseRequest
from app.storage import create_repository


def supabase_settings(**changes):
    values = dict(
        _env_file=None,
        storage_backend="supabase",
        supabase_url="https://example.supabase.co",
        supabase_secret_key="sb_secret_test_only",
        sensea_api_key="local-test-api-token",
    )
    return Settings(**(values | changes))


def test_defaults_need_no_database_and_never_promote_memory_to_live():
    settings = Settings(_env_file=None, supabase_simulation_only=False)
    repo = create_repository(settings)
    assert isinstance(repo, DemoRepository)
    assert repo.simulation_only is True
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").json() == {
            "status": "ok",
            "data_mode": "demo",
            "simulation_only": True,
            "vision_configured": False,
        }


@pytest.mark.parametrize("key", ["supabase_url", "supabase_secret_key", "sensea_api_key"])
def test_missing_supabase_configuration_fails_without_secret_leak(key):
    with pytest.raises(ValidationError) as caught:
        supabase_settings(**{key: ""})
    assert key.upper() in str(caught.value)
    assert "sb_secret_test_only" not in str(caught.value)
    assert "local-test-api-token" not in str(caught.value)


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com",
        "https://user:password@example.com",
        "https://example.com/rest/v1",
        "https://example.com?apikey=hidden",
        "https://example.com#key",
        "https://example.com:invalid",
        "example.com",
    ],
)
def test_invalid_project_origin_is_rejected(url):
    with pytest.raises(ValidationError, match="SUPABASE_URL"):
        supabase_settings(supabase_url=url)


def test_local_development_origin_and_environment_selection(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "supabase")
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test_only")
    monkeypatch.setenv("SENSEA_API_KEY", "test-only")
    settings = Settings(_env_file=None)
    assert settings.storage_backend == "supabase"
    assert settings.supabase_simulation_only is True


@pytest.mark.parametrize(
    "changes",
    [
        {"storage_backend": "invalid"},
        {"supabase_timeout_seconds": 0},
        {"supabase_timeout_seconds": 61},
        {"supabase_secret_key": "sb_publishable_test"},
    ],
)
def test_invalid_storage_configuration(changes):
    with pytest.raises(ValidationError):
        supabase_settings(**changes)


def test_factory_selects_supabase_without_connecting():
    from app.supabase import SupabaseRepository

    repository = create_repository(supabase_settings())
    try:
        assert isinstance(repository, SupabaseRepository)
        assert repository.simulation_only is True
    finally:
        repository.close()


def test_demo_ttl_boundary_and_latest_thousand_samples():
    repository = DemoRepository(3600)
    repository.observations.clear()
    now = datetime.now(UTC)
    samples = repository.observations["start-quad"]
    samples.append((now - timedelta(seconds=3601), 0.1))
    samples.append((now - timedelta(seconds=3600), 0.4))
    summary = repository.noise_summaries(["start-quad", "missing"], now)
    assert summary["start-quad"].relative_noise == 0.4
    assert summary["start-quad"].sample_count == 1
    assert summary["missing"].status == "unknown"
    for _ in range(1001):
        repository.add_noise(NoiseRequest(edge_id="start-quad", relative_noise=0.2, consent=True))
    assert repository.noise_summary("start-quad", datetime.now(UTC)).sample_count == 1000


class WorkerRepository(DemoRepository):
    def __init__(self):
        super().__init__(3600)
        self.calls = []
        self.closed = False

    def in_worker(self, name):
        with pytest.raises(RuntimeError, match="no running event loop"):
            asyncio.get_running_loop()
        self.calls.append(name)

    def search_places(self, query):
        self.in_worker("places")
        return super().search_places(query)

    def get_graph(self):
        self.in_worker("graph")
        return super().get_graph()

    def noise_summaries(self, edge_ids, now):
        self.in_worker("summaries")
        return super().noise_summaries(edge_ids, now)

    def add_noise(self, observation):
        self.in_worker("write")
        return super().add_noise(observation)

    def close(self):
        self.in_worker("close")
        self.closed = True


def test_storage_operations_run_in_workers_and_owned_store_is_closed(settings, monkeypatch):
    repository = WorkerRepository()
    monkeypatch.setattr("app.main.create_repository", lambda _: repository)
    with TestClient(create_app(settings)) as client:
        assert client.get("/places").status_code == 200
        assert (
            client.post(
                "/routes",
                json={
                    "start_waypoint": "start",
                    "end_waypoint": "library_entrance",
                    "simulation": True,
                },
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/noise",
                json={
                    "edge_id": "start-quad",
                    "relative_noise": 0.2,
                    "consent": True,
                },
            ).status_code
            == 200
        )
    assert repository.calls == ["places", "graph", "summaries", "write", "close"]
    assert repository.closed


def test_injected_repository_lifecycle_belongs_to_caller(settings):
    repository = WorkerRepository()
    with TestClient(create_app(settings, repository=repository)) as client:
        assert client.get("/health").status_code == 200
    assert not repository.closed


def test_slow_storage_does_not_block_health(settings):
    started, release = Event(), Event()

    class SlowRepository(DemoRepository):
        def search_places(self, query):
            started.set()
            assert release.wait(5), "Storage blocked the event loop"
            return []

    async def exercise():
        app = create_app(settings, repository=SlowRepository(3600))
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://test"
        ) as client:
            pending = asyncio.create_task(client.get("/places"))
            try:
                assert await asyncio.to_thread(started.wait, 2)
                health = await asyncio.wait_for(client.get("/health"), timeout=2)
                assert health.status_code == 200
            finally:
                release.set()
                assert (await pending).status_code == 200

    asyncio.run(exercise())


def test_real_check_refuses_memory_and_does_not_report_false_success(capsys):
    assert check_storage.main() == 2
    assert "STORAGE_BACKEND=supabase" in capsys.readouterr().out


def test_real_check_reads_only_and_closes_repository(monkeypatch, capsys):
    repository = DemoRepository(3600)
    calls = []
    monkeypatch.setattr(check_storage, "Settings", supabase_settings)
    monkeypatch.setattr(check_storage, "create_repository", lambda _: repository)
    monkeypatch.setattr(repository, "close", lambda: calls.append("close"))
    monkeypatch.setattr(repository, "add_noise", lambda _: pytest.fail("Check must never write"))
    assert check_storage.main() == 0
    assert json.loads(capsys.readouterr().out)["writes_checked"] is False
    assert calls == ["close"]


def test_empty_database_check_reports_unchecked_noise_rpc(monkeypatch, capsys):
    repository = DemoRepository(3600)
    repository.graph.edges.clear()
    monkeypatch.setattr(check_storage, "Settings", supabase_settings)
    monkeypatch.setattr(check_storage, "create_repository", lambda _: repository)
    assert check_storage.main() == 0
    result = json.loads(capsys.readouterr().out)
    assert result["noise_rpc_checked"] is False
    assert result["writes_checked"] is False
