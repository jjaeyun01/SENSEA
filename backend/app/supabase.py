"""Server-only PostgREST adapter; all methods are synchronous and must run off the event loop."""

from datetime import UTC, datetime, timedelta

import httpx
from pydantic import AwareDatetime, Field, TypeAdapter, ValidationError

from app.config import Settings
from app.errors import APIError
from app.models import Edge, Graph, Model, NoiseRequest, NoiseSummary, Place, Waypoint


class _PlaceRow(Place):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    entrance_notes: str | None
    verified_at: AwareDatetime | None = None

    def to_place(self) -> Place:
        return Place.model_validate(
            self.model_dump() | {"entrance_notes": self.entrance_notes or ""}
        )


class _WaypointRow(Waypoint):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    verified_at: AwareDatetime | None = None

    def to_waypoint(self) -> Waypoint:
        # Coordinates are validated against SQL constraints but are not part of the API model.
        return Waypoint.model_validate(self.model_dump(exclude={"latitude", "longitude"}))


class _GraphRows(Model):
    places: list[_PlaceRow]
    waypoints: list[_WaypointRow]
    edges: list[Edge]


class _SummaryRow(Model):
    edge_id: str = Field(min_length=1)
    relative_noise: float | None = Field(ge=0, le=1)
    latest_observed_at: AwareDatetime | None
    sample_count: int = Field(ge=0, le=1000)


_PLACES = TypeAdapter(list[_PlaceRow])
_SUMMARIES = TypeAdapter(list[_SummaryRow])


def _invalid_response() -> APIError:
    return APIError(502, "storage_invalid_response", "저장소 응답을 처리할 수 없습니다.")


class SupabaseRepository:
    """Uses only narrow, service-role RPCs defined in migrations/002_storage.sql.

    Construction does not contact the database. Supabase failures never use demo data.
    httpx.Client is safe to share across the request worker threads used by FastAPI.
    """

    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None):
        self.simulation_only = settings.supabase_simulation_only
        self.noise_ttl_seconds = settings.noise_ttl_seconds
        key = settings.supabase_secret_key.get_secret_value()
        headers = {"apikey": key, "Accept": "application/json"}
        # New secret API keys are not JWTs; sending one as Bearer fails JWT validation.
        if not key.startswith("sb_secret_"):
            headers["Authorization"] = f"Bearer {key}"
        self._client = httpx.Client(
            base_url=f"{settings.supabase_url.rstrip('/')}/rest/v1/rpc/",
            headers=headers,
            timeout=httpx.Timeout(settings.supabase_timeout_seconds),
            follow_redirects=False,
            transport=transport,
        )

    def _rpc(self, name: str, arguments: dict) -> bytes:
        try:
            response = self._client.post(name, json=arguments)
        except httpx.TimeoutException:
            raise APIError(504, "storage_timeout", "저장소 요청 시간이 초과되었습니다.") from None
        except httpx.RequestError:
            raise APIError(503, "storage_unavailable", "저장소에 연결할 수 없습니다.") from None
        if not response.is_success:
            # Read only the machine error code. Never return database bodies, URLs or keys.
            try:
                body = response.json()
                code = body.get("code") if isinstance(body, dict) else None
            except ValueError:
                code = None
            if code == "23503" and name == "sensea_add_noise":
                raise APIError(404, "unknown_edge", "알려진 경로 구간이 아닙니다.")
            if code == "57014":
                raise APIError(504, "storage_timeout", "저장소 요청 시간이 초과되었습니다.")
            raise APIError(503, "storage_unavailable", "저장소 요청을 처리할 수 없습니다.")
        return response.content

    def search_places(self, query: str) -> list[Place]:
        raw = self._rpc("sensea_search_places", {"p_query": query})
        try:
            rows = _PLACES.validate_json(raw, strict=True)
        except ValidationError:
            raise _invalid_response() from None
        if any(not place.id or not place.waypoint_id for place in rows):
            raise _invalid_response()
        if len({place.id for place in rows}) != len(rows):
            raise _invalid_response()
        return [row.to_place() for row in rows]

    def get_graph(self) -> Graph:
        raw = self._rpc("sensea_graph", {})
        try:
            rows = _GraphRows.model_validate_json(raw, strict=True)
        except ValidationError:
            raise _invalid_response() from None
        for collection in (rows.places, rows.waypoints, rows.edges):
            if any(not item.id for item in collection):
                raise _invalid_response()
            if len({item.id for item in collection}) != len(collection):
                raise _invalid_response()
        waypoints = {waypoint.id for waypoint in rows.waypoints}
        if any(place.waypoint_id not in waypoints for place in rows.places):
            raise _invalid_response()
        for edge in rows.edges:
            if (
                edge.from_waypoint not in waypoints
                or edge.to_waypoint not in waypoints
                or edge.from_waypoint == edge.to_waypoint
                or (edge.bidirectional and edge.reverse_instruction is None)
            ):
                raise _invalid_response()
        return Graph(
            places=[row.to_place() for row in rows.places],
            waypoints=[row.to_waypoint() for row in rows.waypoints],
            edges=rows.edges,
        )

    def _summary(self, row: _SummaryRow, now: datetime | None = None) -> NoiseSummary:
        if row.sample_count == 0:
            if row.relative_noise is not None or row.latest_observed_at is not None:
                raise _invalid_response()
            return NoiseSummary(status="unknown")
        if row.relative_noise is None or row.latest_observed_at is None:
            raise _invalid_response()
        if now is not None:
            cutoff = now - timedelta(seconds=self.noise_ttl_seconds)
            if not cutoff <= row.latest_observed_at <= now:
                raise _invalid_response()
        return NoiseSummary(
            relative_noise=row.relative_noise,
            latest_observed_at=row.latest_observed_at,
            sample_count=row.sample_count,
            status="demo" if self.simulation_only else "measured",
        )

    def noise_summaries(self, edge_ids: list[str], now: datetime) -> dict[str, NoiseSummary]:
        requested = list(dict.fromkeys(edge_ids))
        if not requested:
            return {}
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("noise summary time must include a timezone")
        raw = self._rpc(
            "sensea_noise_summaries",
            {
                "p_edge_ids": requested,
                "p_now": now.astimezone(UTC).isoformat(),
                "p_ttl_seconds": self.noise_ttl_seconds,
            },
        )
        try:
            rows = _SUMMARIES.validate_json(raw, strict=True)
        except ValidationError:
            raise _invalid_response() from None
        if len(rows) != len(requested) or {row.edge_id for row in rows} != set(requested):
            raise _invalid_response()
        return {row.edge_id: self._summary(row, now) for row in rows}

    def add_noise(self, observation: NoiseRequest) -> NoiseSummary:
        if not observation.consent:
            raise APIError(400, "consent_required", "소음 요약 업로드에 동의가 필요합니다.")
        raw = self._rpc(
            "sensea_add_noise",
            {
                "p_edge_id": observation.edge_id,
                "p_relative_noise": observation.relative_noise,
                "p_ttl_seconds": self.noise_ttl_seconds,
            },
        )
        try:
            row = _SummaryRow.model_validate_json(raw, strict=True)
        except ValidationError:
            raise _invalid_response() from None
        if row.edge_id != observation.edge_id or row.sample_count == 0:
            raise _invalid_response()
        # Insertion and aggregation use the database clock in one transaction. Do not reject
        # its timestamp because this application's clock differs from the database clock.
        return self._summary(row)

    def close(self) -> None:
        self._client.close()
