from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Place(Model):
    id: str
    name: str
    waypoint_id: str
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    entrance_notes: str
    verified_at: datetime | None = None


class Waypoint(Model):
    id: str
    landmark_description: str
    verified_at: datetime | None = None


class Edge(Model):
    id: str
    from_waypoint: str
    to_waypoint: str
    distance_m: float = Field(gt=0)
    pedestrian_verified: bool = False
    verified_at: AwareDatetime | None = None
    instruction: str
    reverse_instruction: str | None = None
    bidirectional: bool = True


class Graph(Model):
    places: list[Place]
    waypoints: list[Waypoint]
    edges: list[Edge]


class NoiseRequest(Model):
    edge_id: str = Field(min_length=1, max_length=100)
    relative_noise: float = Field(ge=0, le=1)
    consent: StrictBool


class NoiseSummary(Model):
    relative_noise: float | None = None
    status: Literal["measured", "unknown", "stale", "demo"]
    latest_observed_at: datetime | None = None
    sample_count: int = 0


class RouteRequest(Model):
    start_waypoint: str = Field(min_length=1, max_length=100)
    end_waypoint: str = Field(min_length=1, max_length=100)
    noise_preference: Literal["shortest", "quiet"] = "quiet"
    simulation: StrictBool = False


class Segment(Model):
    edge_id: str
    from_waypoint: str
    to_waypoint: str
    instruction: str
    distance_m: float
    noise: NoiseSummary


class Route(Model):
    id: Literal["shortest", "quiet"]
    distance_m: float
    relative_noise: float | None
    noise_data_status: Literal["measured", "partial", "unknown", "stale", "demo"]
    noise_coverage: float
    segments: list[Segment]


class RouteResponse(Model):
    navigation_safe: Literal[False] = False
    simulation_only: bool
    routes: list[Route]
    explanation: str


class VisionScene(Model):
    description: str = Field(min_length=1, max_length=600)
    recognized_text: list[str] = Field(max_length=10)
    uncertainty: Literal["low", "medium", "high"]
    roadway: Literal["detected", "not_detected", "uncertain"]
    sidewalk: Literal["detected", "not_detected", "uncertain"]


class ImageQuality(Model):
    status: Literal["usable", "retake"]
    reason: Literal["low_resolution", "too_dark", "too_bright", "low_detail"] | None
    guidance: str | None


class VisionDescriptionResponse(VisionScene):
    status: Literal["described"] = "described"
    request_id: UUID
    quality: ImageQuality
    navigation_safe: Literal[False] = False


class VisionRetakeResponse(Model):
    status: Literal["retake"] = "retake"
    request_id: UUID
    quality: ImageQuality
    navigation_safe: Literal[False] = False


VisionResponse = Annotated[
    VisionDescriptionResponse | VisionRetakeResponse, Field(discriminator="status")
]
