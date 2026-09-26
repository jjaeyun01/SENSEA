from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .db import DEMO_COORDINATES_NOTICE, repository
from .routing import route_alternatives
from .vision import describe_image

MAX_IMAGE_BYTES = 5 * 1024 * 1024
app = FastAPI(title="SENSEA API", version="1.0.0", description="Deterministic campus-navigation hackathon API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["*"])


class RouteRequest(BaseModel):
    start_waypoint: str = Field(min_length=1, max_length=80)
    end_waypoint: str = Field(min_length=1, max_length=80)
    noise_preference: Literal["shortest", "quiet"] = "quiet"


class NoiseRequest(BaseModel):
    edge_id: str = Field(min_length=1, max_length=100)
    relative_noise: float = Field(ge=0, le=1)
    consent: bool


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "data_mode": repository.mode}


@app.get("/places")
def places(q: str = Query(default="", max_length=120)) -> dict:
    return {"places": repository.search_places(q), "coordinates_notice": DEMO_COORDINATES_NOTICE, "data_mode": repository.mode}


@app.post("/routes")
def routes(request: RouteRequest) -> dict:
    alternatives = route_alternatives(repository.get_edges(), repository.noise_observations, request.start_waypoint, request.end_waypoint)
    if not alternatives:
        raise HTTPException(status_code=404, detail="No pedestrian-verified route is available between those waypoints.")
    return {"routes": alternatives, "simulation": True, "data_mode": repository.mode}


@app.post("/noise", status_code=201)
def noise(request: NoiseRequest) -> dict:
    if request.consent is not True:
        raise HTTPException(status_code=403, detail="Explicit consent is required for a noise summary.")
    if request.edge_id not in {str(edge["id"]) for edge in repository.get_edges() if edge["pedestrian_verified"]}:
        raise HTTPException(status_code=404, detail="Unknown verified route segment.")
    return {"accepted": True, "observation": repository.add_noise(request.edge_id, request.relative_noise), "raw_audio_stored": False}


@app.post("/vision/describe")
async def vision_describe(image: UploadFile = File(...), expected_place: str | None = Form(default=None)) -> dict:
    if image.content_type != "image/jpeg":
        raise HTTPException(status_code=415, detail="Only JPEG still images are accepted.")
    contents = await image.read(MAX_IMAGE_BYTES + 1)
    await image.close()
    if not contents:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 5 MB upload limit.")
    return {**describe_image(contents, expected_place).__dict__, "image_retained": False}


@app.post("/speech/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    await audio.close()
    raise HTTPException(status_code=503, detail="Speech transcription is not configured. Use typed input and manual controls.")
