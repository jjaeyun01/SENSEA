"""On-demand UW map lookup. No harvested directory or floor plans are stored."""

import hmac
import json
import math
import os
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path as FilePath
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Response
from pydantic import BaseModel, Field, ValidationError

BASE = "https://map.wisc.edu"


def no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/campus", tags=["campus"], dependencies=[Depends(no_cache)])


class CampusPlaceSummary(BaseModel):
    id: str = Field(pattern=r"^[0-9]+$")
    name: str = Field(min_length=1)


class CampusSearchResponse(BaseModel):
    places: list[CampusPlaceSummary]
    source: str


class Coordinate(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


class SurveyedEntrance(Coordinate):
    verified: Literal[True]
    accuracy_m: float = Field(gt=0, le=10, allow_inf_nan=False)
    surveyed_at: datetime
    description: str = Field(min_length=1, max_length=300)


class CampusPlaceDetail(CampusPlaceSummary):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    address: str | None = None
    coordinate_kind: Literal["building_representative_point"]
    entrance: SurveyedEntrance | None = None
    entrance_verified: bool = False


def verified_entrance(place_id: int) -> SurveyedEntrance | None:
    """Return only explicitly verified, manually curated entrance coordinates."""
    default = FilePath(__file__).parents[1] / "data/entrances.json"
    path = FilePath(os.getenv("SENSEA_ENTRANCES_PATH", default))
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        item = raw.get(str(place_id))
        if not isinstance(item, dict):
            return None
        return SurveyedEntrance.model_validate(item)
    except (OSError, ValueError, TypeError, ValidationError):
        return None


class SearchResults(HTMLParser):
    def __init__(self):
        super().__init__()
        self.places = {}
        self.current = None
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag != "li":
            return
        attrs = dict(attrs)
        self.current = None
        self.parts = []
        identifier = attrs.get("data-map-object-id") or ""
        if (
            attrs.get("data-model") == "MapObject"
            and attrs.get("data-object-type") in {"building", "building_partial"}
            and identifier.isascii()
            and identifier.isdigit()
        ):
            self.current = identifier

    def handle_data(self, data):
        if self.current is not None:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == "li" and self.current is not None:
            name = " ".join("".join(self.parts).split())
            if name:
                self.places.setdefault(self.current, {"id": self.current, "name": name})
            self.current = None


async def fetch(path, params=None):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(BASE + path, params=params)
            response.raise_for_status()
            return response
    except httpx.HTTPError as exc:
        raise HTTPException(502, "UW 건물 검색에 연결하지 못했습니다. 다시 시도해 주세요.") from exc


@router.get("/places", response_model=CampusSearchResponse)
async def search_places(q: str = Query(default="", max_length=100)):
    query = q.strip()
    if len(query) < 2:
        return {"places": [], "source": BASE}
    response = await fetch("/api/v1/search.html", {"s": query})
    parser = SearchResults()
    parser.feed(response.text)
    # A changed upstream format must not masquerade as an empty search result.
    if "<html" in response.text.lower():
        raise HTTPException(502, "UW 검색 응답을 읽지 못했습니다.")
    return {"places": list(parser.places.values())[:30], "source": BASE}


@router.get("/places/{place_id}", response_model=CampusPlaceDetail)
async def place_details(place_id: int = Path(gt=0)):
    response = await fetch(f"/api/v1/map_objects/{place_id}.geojson")
    try:
        data = response.json()
        if data["object_type"] not in {"building", "building_partial"}:
            raise ValueError("Not a building")
        lon, lat = data["lnglat"]
        if not (
            all(type(v) in (float, int) and math.isfinite(v) for v in (lat, lon))
            and -90 <= lat <= 90
            and -180 <= lon <= 180
        ):
            raise ValueError("Invalid coordinates")
        name = data["name"]
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Invalid name")
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(502, "UW 건물 위치를 확인하지 못했습니다.") from exc
    entrance = verified_entrance(place_id)
    return {
        "id": str(place_id),
        "name": name,
        "latitude": lat,
        "longitude": lon,
        "address": data.get("street_address") or None,
        "coordinate_kind": "building_representative_point",
        "entrance": entrance,
        "entrance_verified": entrance is not None,
    }


class CampusRouteRequest(BaseModel):
    origin: Coordinate
    destination_id: int = Field(gt=0)


class Step(BaseModel):
    polyline: dict = Field(default_factory=dict)
    startLocation: dict
    endLocation: dict
    distanceMeters: int = Field(default=0, ge=0)
    navigationInstruction: dict = Field(default_factory=dict)


async def authorize_routes(x_sensea_token: str | None = Header(default=None)):
    expected = os.getenv("SENSEA_WRITE_TOKEN", "")
    if not expected:
        raise HTTPException(503, "경로 서버의 접근 토큰이 설정되지 않았습니다.")
    if not hmac.compare_digest((x_sensea_token or "").encode(), expected.encode()):
        raise HTTPException(401, "경로 서버 인증이 필요합니다.")


@router.post("/routes", dependencies=[Depends(authorize_routes)])
async def campus_routes(body: CampusRouteRequest):
    key = os.getenv("GOOGLE_ROUTES_API_KEY", "")
    if not key:
        raise HTTPException(503, "Google Routes API 키가 설정되지 않았습니다.")
    destination = await place_details(body.destination_id)
    entrance = destination["entrance"]
    target = entrance or Coordinate(
        latitude=destination["latitude"], longitude=destination["longitude"]
    )
    payload = {
        "origin": {"location": {"latLng": body.origin.model_dump()}},
        "destination": {
            "location": {
                "latLng": {
                    "latitude": target.latitude,
                    "longitude": target.longitude,
                }
            }
        },
        "travelMode": "WALK",
        "computeAlternativeRoutes": True,
        "languageCode": "en-US",
        "units": "METRIC",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://routes.googleapis.com/directions/v2:computeRoutes",
                headers={
                    "X-Goog-Api-Key": key,
                    "X-Goog-FieldMask": ",".join(
                        [
                            "routes.distanceMeters",
                            "routes.duration",
                            "routes.warnings",
                            "routes.polyline.encodedPolyline",
                            "routes.legs.steps.startLocation",
                            "routes.legs.steps.endLocation",
                            "routes.legs.steps.navigationInstruction",
                            "routes.legs.steps.distanceMeters",
                            "routes.legs.steps.polyline.encodedPolyline",
                        ]
                    ),
                },
                json=payload,
            )
            response.raise_for_status()
        routes = []
        for index, route in enumerate(response.json().get("routes", [])):
            steps = []
            for leg in route["legs"]:
                for raw in leg["steps"]:
                    step = Step.model_validate(raw)
                    start = Coordinate.model_validate(step.startLocation["latLng"])
                    end = Coordinate.model_validate(step.endLocation["latLng"])
                    steps.append(
                        {
                            "start": start.model_dump(),
                            "end": end.model_dump(),
                            "distance_m": step.distanceMeters,
                            "encoded_polyline": step.polyline.get("encodedPolyline", ""),
                            "instruction": str(step.navigationInstruction.get("instructions", "")),
                            "maneuver": str(step.navigationInstruction.get("maneuver", "")),
                        }
                    )
            duration = float(route["duration"].removesuffix("s"))
            distance = int(route.get("distanceMeters", 0))
            if not steps or not math.isfinite(duration) or duration < 0 or distance < 0:
                raise ValueError("Invalid route")
            routes.append(
                {
                    "id": str(index),
                    "distance_m": distance,
                    "duration_seconds": duration,
                    "steps": steps,
                    "warnings": route.get("warnings", []),
                    "accessibility": "unknown",
                    "encoded_polyline": route.get("polyline", {}).get("encodedPolyline", ""),
                }
            )
        if not routes:
            raise HTTPException(404, "도보 경로를 찾지 못했습니다.")
        return {
            "destination": destination,
            "arrival_target": {
                "latitude": target.latitude,
                "longitude": target.longitude,
                "verified_entrance": destination["entrance_verified"],
                "accuracy_m": entrance.accuracy_m if entrance else None,
                "surveyed_at": entrance.surveyed_at if entrance else None,
                "description": entrance.description if entrance else None,
                "kind": "verified_entrance"
                if destination["entrance_verified"]
                else "building_representative_point",
            },
            "routes": routes,
            "attribution": "Google Maps",
        }
    except (
        httpx.HTTPError,
        KeyError,
        ValueError,
        TypeError,
        AttributeError,
        ValidationError,
    ) as exc:
        raise HTTPException(502, "도보 경로를 가져오지 못했습니다. 다시 시도해 주세요.") from exc
