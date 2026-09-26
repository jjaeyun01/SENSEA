"""Explicit, read-only real connection check: python -m app.check_storage."""

import json
from datetime import UTC, datetime

from pydantic import ValidationError

from app.config import Settings
from app.errors import APIError
from app.storage import create_repository


def main() -> int:
    try:
        settings = Settings()
    except ValidationError:
        print("Invalid storage configuration; check backend environment variable names and values.")
        return 2
    if settings.storage_backend != "supabase":
        print("Set STORAGE_BACKEND=supabase explicitly for the real connection check.")
        return 2
    repository = create_repository(settings)
    try:
        graph = repository.get_graph()
        places = repository.search_places("")
        summaries = repository.noise_summaries([edge.id for edge in graph.edges], datetime.now(UTC))
        print(
            json.dumps(
                {
                    "read_check": "ok",
                    "simulation_only": repository.simulation_only,
                    "places": len(places),
                    "waypoints": len(graph.waypoints),
                    "edges": len(graph.edges),
                    "noise_summaries": len(summaries),
                    "noise_rpc_checked": bool(graph.edges),
                    "writes_checked": False,
                }
            )
        )
        return 0
    except APIError as exc:
        # Fixed application codes only; do not print upstream exceptions or credentials.
        print(json.dumps({"read_check": "failed", "code": exc.code}))
        return 1
    finally:
        repository.close()


if __name__ == "__main__":
    raise SystemExit(main())
