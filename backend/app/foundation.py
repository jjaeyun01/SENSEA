import asyncio
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager, suppress
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.db import DemoRepository
from app.errors import APIError, register_error_handlers
from app.images import prepare_image
from app.middleware import (
    BodySizeLimitMiddleware,
    PrivacyHeadersMiddleware,
    UploadCapacityMiddleware,
)
from app.models import (
    NoiseRequest,
    RouteRequest,
    RouteResponse,
    VisionDescriptionResponse,
    VisionResponse,
    VisionRetakeResponse,
)
from app.quality import assess_quality
from app.routing import plan_routes
from app.vision import DisabledVisionProvider, OpenAIVisionProvider, VisionProvider

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def create_app(
    settings: Settings | None = None,
    repository: DemoRepository | None = None,
    provider: VisionProvider | None = None,
) -> FastAPI:
    settings = settings or Settings()
    repository = repository or DemoRepository(settings.noise_ttl_seconds)
    vision_calls = deque()

    async def sweep_noise():
        interval = min(settings.noise_cleanup_interval_seconds, settings.noise_ttl_seconds)
        while True:
            await asyncio.sleep(interval)
            repository.purge_expired()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        owned = None
        if provider is not None:
            app.state.vision = provider
        elif settings.vision_provider == "openai":
            owned = OpenAIVisionProvider(settings)
            app.state.vision = owned
        else:
            app.state.vision = DisabledVisionProvider()
        repository.purge_expired()
        cleanup = asyncio.create_task(sweep_noise())
        app.state.noise_cleanup_task = cleanup
        try:
            yield
        finally:
            cleanup.cancel()
            with suppress(asyncio.CancelledError):
                await cleanup
            repository.clear()
            if owned is not None:
                await owned.close()

    app = FastAPI(title="SENSEA API", version="0.3.0", lifespan=lifespan)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_image_bytes + 64 * 1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key"],
    )
    # Capacity is checked before buffering or parsing any upload bytes.
    app.add_middleware(UploadCapacityMiddleware, limit=settings.max_concurrent_uploads)
    app.add_middleware(PrivacyHeadersMiddleware)
    register_error_handlers(app)

    async def authenticate(key: Annotated[str | None, Depends(api_key_header)]):
        expected = settings.sensea_api_key.get_secret_value()
        if expected and (
            key is None or not secrets.compare_digest(key.encode(), expected.encode())
        ):
            raise APIError(401, "unauthorized", "API 인증이 필요합니다.")

    @app.get("/health", tags=["system"])
    async def health():
        return {
            "status": "ok",
            "data_mode": "demo",
            "simulation_only": repository.simulation_only,
            "vision_configured": settings.vision_provider != "disabled",
        }

    @app.get("/places", dependencies=[Depends(authenticate)], tags=["places"])
    async def places(q: Annotated[str, Query(max_length=100)] = ""):
        return {
            "simulation_only": repository.simulation_only,
            "places": repository.search_places(q.strip()),
        }

    @app.post(
        "/routes",
        response_model=RouteResponse,
        dependencies=[Depends(authenticate)],
        tags=["routes"],
    )
    async def routes(payload: RouteRequest):
        return plan_routes(repository, payload, settings.path_verification_ttl_seconds)

    @app.post("/noise", dependencies=[Depends(authenticate)], tags=["noise"])
    async def noise(payload: NoiseRequest):
        return {
            "accepted": True,
            "simulation_only": repository.simulation_only,
            "summary": repository.add_noise(payload),
        }

    @app.post(
        "/vision/describe",
        response_model=VisionResponse,
        dependencies=[Depends(authenticate)],
        tags=["vision"],
    )
    async def describe(
        request: Request,
        image: Annotated[UploadFile, File(description="Stationary JPEG, PNG or WebP snapshot")],
        stationary: Annotated[bool, Form(description="User confirms they are stopped")],
        request_id: Annotated[UUID, Form(description="New UUID for every capture attempt")],
        external_processing_consent: Annotated[
            bool,
            Form(description="Explicit consent to send this photo to the configured AI service"),
        ] = False,
        expected_place: Annotated[str | None, Form(max_length=200)] = None,
    ):
        try:
            if not external_processing_consent:
                raise APIError(
                    409,
                    "external_consent_required",
                    "외부 AI로 사진을 보내는 데 동의가 필요합니다.",
                )
            if not stationary:
                raise APIError(
                    409, "stationary_required", "이동을 멈춘 뒤 주변 설명을 요청해 주세요."
                )
            data = await image.read(settings.max_image_bytes + 1)
            content_type = image.content_type
        finally:
            await image.close()
        if len(data) > settings.max_image_bytes:
            raise APIError(413, "image_too_large", "이미지 파일 크기 제한을 초과했습니다.")
        # Global per-process budget suits the single-worker hackathon demo.
        now = time.monotonic()
        while vision_calls and now - vision_calls[0] >= 60:
            vision_calls.popleft()
        if len(vision_calls) >= settings.vision_requests_per_minute:
            raise APIError(429, "vision_rate_limited", "잠시 후 카메라 설명을 다시 요청해 주세요.")
        vision_calls.append(now)
        jpeg = await run_in_threadpool(prepare_image, data, content_type, settings.max_image_pixels)
        del data
        quality = await run_in_threadpool(assess_quality, jpeg, settings)
        if quality.status == "retake":
            return VisionRetakeResponse(request_id=request_id, quality=quality)
        try:
            async with asyncio.timeout(settings.vision_timeout_seconds):
                scene = await request.app.state.vision.describe(jpeg, expected_place)
        except TimeoutError as exc:
            raise APIError(504, "vision_timeout", "카메라 설명 시간이 초과되었습니다.") from exc
        return VisionDescriptionResponse(
            request_id=request_id, quality=quality, **scene.model_dump()
        )

    @app.post("/speech/transcribe", dependencies=[Depends(authenticate)], tags=["speech"])
    async def transcribe():
        raise APIError(501, "speech_not_configured", "음성 인식은 아직 연결되지 않았습니다.")

    return app


app = create_app()
