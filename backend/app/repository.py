"""Synchronous storage boundary; API handlers call it in worker threads.

Implementations must be thread-safe and never fall back to another store.
"""

from datetime import datetime
from typing import Protocol

from app.models import Graph, NoiseRequest, NoiseSummary, Place


class Repository(Protocol):
    simulation_only: bool

    def search_places(self, query: str) -> list[Place]: ...

    def get_graph(self) -> Graph: ...

    def noise_summaries(self, edge_ids: list[str], now: datetime) -> dict[str, NoiseSummary]: ...

    def add_noise(self, observation: NoiseRequest) -> NoiseSummary: ...

    def close(self) -> None: ...
