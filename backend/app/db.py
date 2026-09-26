"""Deterministic demo data shaped like the intended Supabase tables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from supabase import Client, create_client

DEMO_COORDINATES_NOTICE = "Demo campus coordinates; not verified for real-world navigation."

PLACES: list[dict[str, Any]] = [
    {"id": "library", "name": "Memorial Library", "latitude": 43.07520, "longitude": -89.39710, "entrance_waypoint": "library_entrance", "entrance_notes": "Demo north entrance; verification required before field use.", "verification_status": "demo"},
    {"id": "student_center", "name": "Campus Student Center", "latitude": 43.07465, "longitude": -89.39800, "entrance_waypoint": "student_center_entrance", "entrance_notes": "Demo east entrance; verification required before field use.", "verification_status": "demo"},
    {"id": "science_hall", "name": "Science Hall", "latitude": 43.07565, "longitude": -89.39625, "entrance_waypoint": "science_entrance", "entrance_notes": "Demo south entrance; verification required before field use.", "verification_status": "demo"},
]

WAYPOINTS: dict[str, dict[str, Any]] = {
    "start": {"latitude": 43.07420, "longitude": -89.39900, "landmark_description": "Demo campus welcome sign"},
    "quad": {"latitude": 43.07465, "longitude": -89.39845, "landmark_description": "Center of the demo quad"},
    "garden": {"latitude": 43.07435, "longitude": -89.39790, "landmark_description": "Demo garden path marker"},
    "arcade": {"latitude": 43.07500, "longitude": -89.39755, "landmark_description": "Covered demo walkway"},
    "library_entrance": {"latitude": 43.07520, "longitude": -89.39710, "landmark_description": "Memorial Library demo north entrance"},
    "student_center_entrance": {"latitude": 43.07465, "longitude": -89.39800, "landmark_description": "Student Center demo east entrance"},
    "science_entrance": {"latitude": 43.07565, "longitude": -89.39625, "landmark_description": "Science Hall demo south entrance"},
}

# The quad path is shorter and noisier; the garden path is longer and quieter.
PATH_EDGES: list[dict[str, Any]] = [
    {"id": "edge_start_quad", "from_waypoint": "start", "to_waypoint": "quad", "distance_m": 180.0, "pedestrian_verified": True, "bidirectional": True, "instruction": "Continue 180 meters toward the verified quad marker."},
    {"id": "edge_quad_arcade", "from_waypoint": "quad", "to_waypoint": "arcade", "distance_m": 170.0, "pedestrian_verified": True, "bidirectional": True, "instruction": "Continue 170 meters toward the covered walkway."},
    {"id": "edge_start_garden", "from_waypoint": "start", "to_waypoint": "garden", "distance_m": 230.0, "pedestrian_verified": True, "bidirectional": True, "instruction": "Continue 230 meters toward the verified garden marker."},
    {"id": "edge_garden_arcade", "from_waypoint": "garden", "to_waypoint": "arcade", "distance_m": 210.0, "pedestrian_verified": True, "bidirectional": True, "instruction": "Follow the garden path 210 meters to the covered walkway."},
    {"id": "edge_arcade_library", "from_waypoint": "arcade", "to_waypoint": "library_entrance", "distance_m": 120.0, "pedestrian_verified": True, "bidirectional": True, "instruction": "Continue 120 meters. The Memorial Library demo entrance is at the next waypoint."},
    {"id": "edge_quad_student", "from_waypoint": "quad", "to_waypoint": "student_center_entrance", "distance_m": 90.0, "pedestrian_verified": True, "bidirectional": True, "instruction": "Continue 90 meters to the Student Center demo entrance."},
    {"id": "edge_arcade_science", "from_waypoint": "arcade", "to_waypoint": "science_entrance", "distance_m": 160.0, "pedestrian_verified": True, "bidirectional": True, "instruction": "Continue 160 meters to the Science Hall demo entrance."},
    {"id": "edge_unverified_shortcut", "from_waypoint": "start", "to_waypoint": "library_entrance", "distance_m": 30.0, "pedestrian_verified": False, "bidirectional": True, "instruction": "Unverified shortcut."},
]


def _minutes_ago(minutes: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


INITIAL_NOISE: list[dict[str, Any]] = [
    {"edge_id": "edge_start_quad", "relative_noise": 0.82, "observed_at": _minutes_ago(8), "source": "demo"},
    {"edge_id": "edge_quad_arcade", "relative_noise": 0.76, "observed_at": _minutes_ago(8), "source": "demo"},
    {"edge_id": "edge_start_garden", "relative_noise": 0.18, "observed_at": _minutes_ago(8), "source": "demo"},
    {"edge_id": "edge_garden_arcade", "relative_noise": 0.22, "observed_at": _minutes_ago(8), "source": "demo"},
    {"edge_id": "edge_arcade_library", "relative_noise": 0.30, "observed_at": _minutes_ago(8), "source": "demo"},
]


@dataclass
class DemoRepository:
    """Process-local repository: summaries only, never raw media or movement traces."""
    noise_observations: list[dict[str, Any]] = field(default_factory=lambda: [dict(item) for item in INITIAL_NOISE])

    @property
    def mode(self) -> str:
        return "demo-memory"

    def search_places(self, query: str) -> list[dict[str, Any]]:
        needle = query.strip().casefold()
        return [dict(place) for place in PLACES if not needle or needle in place["name"].casefold() or needle in place["id"].casefold()]

    def get_edges(self) -> list[dict[str, Any]]:
        return [dict(edge) for edge in PATH_EDGES]

    def add_noise(self, edge_id: str, relative_noise: float) -> dict[str, Any]:
        item = {"edge_id": edge_id, "relative_noise": relative_noise, "observed_at": datetime.now(timezone.utc).isoformat(), "source": "user-summary"}
        self.noise_observations.append(item)
        return dict(item)


class SupabaseRepository:
    """Thin adapter for the README's places, path_edges and noise_observations tables."""
    def __init__(self, url: str, key: str) -> None:
        self.client: Client = create_client(url, key)

    @property
    def mode(self) -> str:
        return "supabase"

    def search_places(self, query: str) -> list[dict[str, Any]]:
        request = self.client.table("places").select("id,name,latitude,longitude,entrance_notes,verified_at")
        if query.strip():
            request = request.ilike("name", f"%{query.strip()}%")
        rows = request.execute().data
        return [{**row, "entrance_waypoint": f"{str(row['id'])}_entrance", "verification_status": "verified" if row.get("verified_at") else "unknown"} for row in rows]

    def get_edges(self) -> list[dict[str, Any]]:
        return list(self.client.table("path_edges").select("*").execute().data)

    @property
    def noise_observations(self) -> list[dict[str, Any]]:
        return list(self.client.table("noise_observations").select("edge_id,relative_noise,observed_at").execute().data)

    def add_noise(self, edge_id: str, relative_noise: float) -> dict[str, Any]:
        payload = {"edge_id": edge_id, "relative_noise": relative_noise, "observed_at": datetime.now(timezone.utc).isoformat()}
        rows = self.client.table("noise_observations").insert(payload).execute().data
        return dict(rows[0] if rows else payload)


def build_repository() -> DemoRepository | SupabaseRepository:
    url, key = os.getenv("SUPABASE_URL", "").strip(), os.getenv("SUPABASE_ANON_KEY", "").strip()
    return SupabaseRepository(url, key) if url and key else DemoRepository()


repository = build_repository()
