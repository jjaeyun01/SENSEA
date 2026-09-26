import hmac
import os
import time
from collections import deque
from pathlib import Path
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .noise import NoiseStore
from .routing import load_graph, shortest_path, summarize_route

ROOT = Path(__file__).resolve().parents[1]
MAX_AUDIO_BYTES = 5 * 1024 * 1024


class RouteRequest(BaseModel):
    start_waypoint: str = Field(min_length=1, max_length=100)
    end_waypoint: str = Field(min_length=1, max_length=100)
    noise_preference: Literal["shortest", "quiet"] = "quiet"
    mode: Literal["simulation", "live"] = "simulation"


class NoiseRequest(BaseModel):
    edge_id: str = Field(min_length=1, max_length=100)
    relative_noise: float = Field(ge=0, le=1, allow_inf_nan=False)
    consent: bool


def require_write_token(authorization: str | None = Header(default=None)):
    token = os.getenv("SENSEA_WRITE_TOKEN", "")
    if not token:
        raise HTTPException(503, "SENSEA_WRITE_TOKEN must be configured on the server.")
    if not hmac.compare_digest((authorization or "").encode(), f"Bearer {token}".encode()):
        raise HTTPException(401, "A valid demo access token is required.")


def create_app(graph_path=None, db_path=None):
    app = FastAPI(title="SENSEA API", version="0.1.0")
    graph = load_graph(Path(graph_path or os.getenv("SENSEA_GRAPH_PATH", ROOT / "data/demo-campus.json")))
    store = NoiseStore(db_path or os.getenv("SENSEA_DB_PATH", ROOT / "sensea.sqlite3"))
    edge_ids = {edge["id"] for edge in graph["edges"]}
    app.state.noise_store = store
    # Global cap for a single-process demo; use a shared limiter before scaling.
    speech_requests = deque()

    @app.get("/health")
    def health():
        return {"status": "ok", "simulation_only": graph.get("simulation_only", True)}

    @app.get("/places")
    def places(q: str = ""):
        query = q.strip().casefold()
        return {"places": [p for p in graph["places"] if any(query in name.casefold() for name in [p["name"], *p.get("aliases", [])])]}

    @app.get("/graph")
    def get_graph():
        return graph

    @app.post("/routes")
    def routes(body: RouteRequest):
        if body.start_waypoint not in graph["waypoints"] or body.end_waypoint not in graph["waypoints"]:
            raise HTTPException(404, "Unknown waypoint.")
        if body.mode == "live" and graph.get("simulation_only", True):
            raise HTTPException(409, "The demo map is available in simulation mode only.")
        noise = store.summaries(edge_ids)
        options = []
        for kind, weight in [("shortest", 0.0), ("noise-weighted", 2.0)]:
            segments = shortest_path(graph, body.start_waypoint, body.end_waypoint, noise, weight, body.mode == "simulation")
            if segments is None:
                raise HTTPException(404, "No pedestrian route is available.")
            if options and [s["edge_id"] for s in segments] == [s["edge_id"] for s in options[0]["segments"]]:
                continue
            options.append(summarize_route(segments, kind))
        preferred = options[0]["id"]
        if body.noise_preference == "quiet" and len(options) > 1:
            a, b = options
            # Claim lower measured noise only with complete fresh coverage.
            if a["relative_noise"] is not None and b["relative_noise"] is not None and b["relative_noise"] < a["relative_noise"]:
                preferred = b["id"]
        return {
            "mode": body.mode, "routes": options, "recommended_route_id": preferred,
            "arrived": body.start_waypoint == body.end_waypoint,
            "notice": "This is a simulated route." if body.mode == "simulation" else "This route uses verified pedestrian segments but does not provide real-time safety assessments.",
        }

    @app.post("/noise", status_code=201, dependencies=[Depends(require_write_token)])
    def noise(body: NoiseRequest):
        if not body.consent:
            raise HTTPException(403, "Consent is required to share noise summaries.")
        if body.edge_id not in edge_ids:
            raise HTTPException(404, "Unknown route segment.")
        store.add(body.edge_id, body.relative_noise)
        return {"accepted": True, "edge_id": body.edge_id}

    @app.get("/noise")
    def noise_summaries():
        return {"edges": store.summaries(edge_ids), "fresh_for_seconds": 3600}

    @app.post("/speech/transcribe", dependencies=[Depends(require_write_token)], openapi_extra={
        "requestBody": {"required": True, "content": {
            mime: {"schema": {"type": "string", "format": "binary"}}
            for mime in ["audio/mp4", "audio/mpeg", "audio/wav", "audio/webm"]
        }}
    })
    async def transcribe(request: Request):
        """Raw audio body avoids multipart temp files; never persist the recording."""
        mime = request.headers.get("content-type", "").split(";")[0].lower()
        extensions = {"audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm"}
        if mime not in extensions:
            raise HTTPException(415, "Please upload m4a, mp3, wav, or webm audio.")
        key = os.getenv("OPENAI_API_KEY")
        if not key:
            raise HTTPException(503, "Speech transcription is not configured. Please use text input.")
        now = time.monotonic()
        while speech_requests and speech_requests[0] < now - 60:
            speech_requests.popleft()
        if len(speech_requests) >= 10:
            raise HTTPException(429, "Too many speech requests. Please try again shortly.")
        speech_requests.append(now)
        audio = bytearray()
        async for chunk in request.stream():
            if len(audio) + len(chunk) > MAX_AUDIO_BYTES:
                raise HTTPException(413, "Audio must be 5 MiB or smaller.")
            audio.extend(chunk)
        if not audio:
            raise HTTPException(400, "The recording is empty.")
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {key}"},
                    data={"model": os.getenv("TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"), "response_format": "json", "language": "en"},
                    files={"file": (f"speech.{extensions[mime]}", bytes(audio), mime)},
                )
            response.raise_for_status()
            transcript = response.json()["text"].strip()
            if not transcript:
                raise HTTPException(422, "No speech was recognized. Please try speaking again or use text input.")
            return {"transcript": transcript}
        except (httpx.HTTPError, ValueError, KeyError, AttributeError) as exc:
            raise HTTPException(502, "Speech transcription failed. Please use text input.") from exc
        finally:
            audio.clear()

    return app


app = create_app()
