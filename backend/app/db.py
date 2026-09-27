from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.errors import APIError
from app.models import Graph, NoiseRequest, NoiseSummary


def discard_expired(samples: deque, cutoff: datetime) -> int:
    """Handle wall-clock changes without assuming insertion order is time order."""
    count = len(samples)
    for _ in range(count):
        sample = samples.popleft()
        if sample[0] > cutoff:
            samples.append(sample)
    return count - len(samples)


class DemoRepository:
    """Single-process simulation store. A Supabase adapter can replace this boundary."""

    simulation_only = True

    def __init__(self, noise_ttl_seconds: int):
        self.graph = Graph.model_validate_json(
            Path(__file__).with_name("data").joinpath("demo.json").read_text(encoding="utf-8")
        )
        self.noise_ttl_seconds = noise_ttl_seconds
        self.observations = defaultdict(lambda: deque(maxlen=1000))
        # Synthetic fixture readings: never present these as real microphone measurements.
        now = datetime.now(UTC)
        for edge in self.graph.edges:
            score = 0.15 if "garden" in edge.id else 0.85
            self.observations[edge.id].append((now, score))

    def purge_expired(self, now: datetime | None = None) -> int:
        """Also called by the lifespan sweeper when no requests arrive."""
        cutoff = (now or datetime.now(UTC)) - timedelta(seconds=self.noise_ttl_seconds)
        removed = 0
        for edge_id, samples in list(self.observations.items()):
            removed += discard_expired(samples, cutoff)
            if not samples:
                del self.observations[edge_id]
        return removed

    def clear(self) -> None:
        self.observations.clear()

    def search_places(self, query: str):
        return [p for p in self.graph.places if query.casefold() in p.name.casefold()]

    def add_noise(self, observation: NoiseRequest) -> NoiseSummary:
        if not observation.consent:
            raise APIError(400, "consent_required", "소음 요약 업로드에 동의가 필요합니다.")
        if observation.edge_id not in {edge.id for edge in self.graph.edges}:
            raise APIError(404, "unknown_edge", "알려진 경로 구간이 아닙니다.")
        now = datetime.now(UTC)
        samples = self.observations[observation.edge_id]
        cutoff = now - timedelta(seconds=self.noise_ttl_seconds)
        discard_expired(samples, cutoff)
        samples.append((now, observation.relative_noise))
        return self.noise_summary(observation.edge_id, now)

    def noise_summary(self, edge_id: str, now: datetime) -> NoiseSummary:
        samples = self.observations.get(edge_id)
        if samples is None:
            return NoiseSummary(status="unknown")
        cutoff = now - timedelta(seconds=self.noise_ttl_seconds)
        discard_expired(samples, cutoff)
        # A route request captures its clock once. Later observations must neither
        # affect that snapshot nor be deleted just because they are newer than it.
        eligible = [(observed_at, value) for observed_at, value in samples if observed_at <= now]
        if not eligible:
            return NoiseSummary(status="unknown")
        return NoiseSummary(
            relative_noise=sum(value for _, value in eligible) / len(eligible),
            status="demo",
            latest_observed_at=max(observed_at for observed_at, _ in eligible),
            sample_count=len(eligible),
        )
