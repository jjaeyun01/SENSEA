from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .routing import RouteRequest, RoutesResponse, build_demo_routes
from .vision import VisionResponse, describe_demo_scene


app = FastAPI(
    title="SENSEA API",
    version="0.1.0",
    description="Hackathon API for accessible campus navigation demos.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081", "http://127.0.0.1:8081"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "sensea-api"}


@app.post("/routes", response_model=RoutesResponse)
async def routes(request: RouteRequest) -> RoutesResponse:
    return build_demo_routes(request.destination)


@app.post("/vision/describe", response_model=VisionResponse)
async def describe_scene(
    image: UploadFile | None = File(default=None),
) -> VisionResponse:
    # Do not persist uploads in the MVP. A future implementation should enforce
    # size/type limits and process the frame in memory with explicit consent.
    return describe_demo_scene(image.filename if image else None)

