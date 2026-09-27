from datetime import UTC, datetime, timedelta

import pytest

from app.db import DemoRepository
from app.models import NoiseRequest

NOW = datetime(2026, 9, 26, 18, tzinfo=UTC)


@pytest.mark.parametrize("read_first", [False, True])
def test_expiry_does_not_depend_on_insertion_order(read_first):
    repo = DemoRepository(60)
    repo.clear()
    repo.observations["start-quad"].extend(
        [
            (NOW - timedelta(seconds=1), 0.2),
            (NOW - timedelta(seconds=61), 1.0),
            (NOW - timedelta(seconds=10), 0.4),
            (NOW - timedelta(seconds=60), 1.0),
        ]
    )
    if not read_first:
        assert repo.purge_expired(NOW) == 2
    summary = repo.noise_summary("start-quad", NOW)
    assert summary.sample_count == 2
    assert summary.relative_noise == pytest.approx(0.3)
    assert summary.latest_observed_at == NOW - timedelta(seconds=1)
    assert len(repo.observations["start-quad"]) == 2


def test_future_observations_are_excluded_without_deleting_the_next_snapshot():
    repo = DemoRepository(60)
    repo.clear()
    later = NOW + timedelta(seconds=1)
    repo.observations["start-quad"].extend([(NOW, 0.2), (later, 0.8)])
    summary = repo.noise_summary("start-quad", NOW)
    assert summary.sample_count == 1
    assert summary.relative_noise == 0.2
    assert summary.latest_observed_at == NOW
    assert len(repo.observations["start-quad"]) == 2
    next_summary = repo.noise_summary("start-quad", later)
    assert next_summary.sample_count == 2
    assert next_summary.relative_noise == 0.5
    assert next_summary.latest_observed_at == later


def test_only_future_or_missing_samples_are_unknown():
    repo = DemoRepository(60)
    repo.clear()
    repo.observations["start-quad"].append((NOW + timedelta(seconds=1), 0.1))
    for edge in ["start-quad", "missing"]:
        summary = repo.noise_summary(edge, NOW)
        assert summary.status == "unknown"
        assert summary.relative_noise is None
        assert summary.latest_observed_at is None
        assert summary.sample_count == 0


def test_writing_after_a_clock_adjustment_uses_observation_times(monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW

    repo = DemoRepository(60)
    repo.clear()
    repo.observations["start-quad"].extend(
        [
            (NOW + timedelta(seconds=10), 0.9),
            (NOW - timedelta(seconds=70), 1.0),
        ]
    )
    monkeypatch.setattr("app.db.datetime", Clock)
    summary = repo.add_noise(NoiseRequest(edge_id="start-quad", relative_noise=0.2, consent=True))
    assert summary.sample_count == 1
    assert summary.relative_noise == 0.2
    assert summary.latest_observed_at == NOW
    assert len(repo.observations["start-quad"]) == 2
