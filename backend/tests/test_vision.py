import asyncio
import json
from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import AsyncOpenAI
from PIL import Image
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.errors import APIError
from app.images import prepare_image
from app.main import create_app
from app.models import VisionScene
from app.vision import OpenAIVisionProvider

SCENE = VisionScene(
    description="도서관이라고 적힌 표지판이 보입니다.",
    recognized_text=["도서관"],
    uncertainty="medium",
    roadway="uncertain",
    sidewalk="uncertain",
)


class FakeVision:
    async def describe(self, jpeg, expected_place):
        assert jpeg.startswith(b"\xff\xd8")
        return SCENE


def upload(client, jpeg, **kwargs):
    return client.post(
        "/vision/describe",
        files={"image": ("frame.jpg", jpeg, "image/jpeg")},
        data={"stationary": "true", "request_id": "00000000-0000-4000-8000-000000000001"},
        **kwargs,
    )


def test_success_returns_description_without_navigation_permission(settings, jpeg):
    with TestClient(create_app(settings, provider=FakeVision())) as client:
        response = upload(client, jpeg)
    assert response.status_code == 200
    assert response.json()["status"] == "described"
    assert response.json()["quality"]["status"] == "usable"
    assert response.json()["request_id"] == "00000000-0000-4000-8000-000000000001"
    assert response.json()["recognized_text"] == ["도서관"]
    assert response.json()["navigation_safe"] is False


def test_disabled_provider_is_not_fake_success(client, jpeg):
    response = upload(client, jpeg)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "vision_not_configured"


def test_user_must_be_stopped(client, jpeg):
    response = client.post(
        "/vision/describe",
        files={"image": ("frame.jpg", jpeg, "image/jpeg")},
        data={"stationary": "false", "request_id": "00000000-0000-4000-8000-000000000001"},
    )
    assert response.status_code == 409


@pytest.mark.parametrize(
    "content,mime,status",
    [
        (b"not an image", "image/jpeg", 422),
        (b"not an image", "application/octet-stream", 415),
    ],
)
def test_bad_uploads(client, content, mime, status):
    response = client.post(
        "/vision/describe",
        files={"image": ("frame", content, mime)},
        data={"stationary": "true", "request_id": "00000000-0000-4000-8000-000000000001"},
    )
    assert response.status_code == status


def test_file_and_total_request_limits(settings, jpeg):
    settings.max_image_bytes = len(jpeg) - 1
    with TestClient(create_app(settings)) as client:
        assert upload(client, jpeg).status_code == 413
        # The stream lacks a Content-Length and must still be bounded.
        response = client.post(
            "/vision/describe",
            content=iter([b"x" * (settings.max_image_bytes + 1), b"x" * (64 * 1024)]),
            headers={"Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 413


def test_image_metadata_removed_and_pixels_limited(jpeg):
    source = Image.new("RGB", (32, 24))
    exif = Image.Exif()
    exif[270] = "private description"
    output = BytesIO()
    source.save(output, "JPEG", exif=exif)
    cleaned = prepare_image(output.getvalue(), "image/jpeg", 1000)
    with Image.open(BytesIO(cleaned)) as image:
        assert not image.getexif()
    with pytest.raises(APIError) as exc:
        prepare_image(jpeg, "image/jpeg", 10)
    assert exc.value.status == 413
    with pytest.raises(APIError) as exc:
        prepare_image(jpeg, "image/png", 1000)
    assert exc.value.status == 415


def test_vision_rate_limit(settings, jpeg):
    settings.vision_requests_per_minute = 1
    with TestClient(create_app(settings, provider=FakeVision())) as client:
        assert upload(client, jpeg).status_code == 200
        assert upload(client, jpeg).status_code == 429


def test_vision_timeout(settings, jpeg):
    class SlowVision:
        async def describe(self, jpeg, expected_place):
            await asyncio.sleep(1)
            return SCENE

    settings.vision_timeout_seconds = 0.01
    with TestClient(create_app(settings, provider=SlowVision())) as client:
        assert upload(client, jpeg).status_code == 504


def test_auth_and_no_secret_in_error(settings, jpeg):
    settings.sensea_api_key = SecretStr("test-access-token")
    with TestClient(create_app(settings, provider=FakeVision())) as client:
        rejected = upload(client, jpeg)
        assert rejected.status_code == 401
        assert "test-access-token" not in rejected.text
        assert upload(client, jpeg, headers={"X-API-Key": "test-access-token"}).status_code == 200


def test_openai_mode_requires_server_keys():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, vision_provider="openai", openai_api_key="", sensea_api_key="")


def test_sdk_request_and_structured_response_without_network(settings, jpeg):
    observed = {}

    def handler(request):
        observed.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "resp_test",
                "created_at": 0,
                "model": "gpt-4.1-mini",
                "object": "response",
                "status": "completed",
                "output": [
                    {
                        "id": "msg_test",
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {
                                "type": "output_text",
                                "text": SCENE.model_dump_json(),
                                "annotations": [],
                            }
                        ],
                    }
                ],
                "parallel_tool_calls": False,
                "tool_choice": "auto",
                "tools": [],
            },
        )

    async def run():
        provider = OpenAIVisionProvider.__new__(OpenAIVisionProvider)
        provider.model = "gpt-4.1-mini"
        provider.client = AsyncOpenAI(
            api_key="test-key",
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        try:
            return await provider.describe(jpeg, "library")
        finally:
            await provider.close()

    assert asyncio.run(run()).recognized_text == ["도서관"]
    assert observed["store"] is False
    assert observed["text"]["format"]["type"] == "json_schema"
    assert observed["input"][0]["content"][1]["image_url"].startswith("data:image/jpeg;base64,")


def test_provider_refusal_becomes_error():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    async def run():
        provider = OpenAIVisionProvider.__new__(OpenAIVisionProvider)
        provider.model = "test"
        provider.client = SimpleNamespace(
            responses=SimpleNamespace(
                parse=AsyncMock(
                    return_value=SimpleNamespace(status="completed", output_parsed=None)
                )
            )
        )
        with pytest.raises(APIError) as exc:
            await provider.describe(b"image", None)
        assert exc.value.code == "vision_incomplete"

    asyncio.run(run())


def test_sdk_timeout_becomes_gateway_timeout():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from openai import APITimeoutError

    async def run():
        provider = OpenAIVisionProvider.__new__(OpenAIVisionProvider)
        provider.model = "test"
        provider.client = SimpleNamespace(
            responses=SimpleNamespace(
                parse=AsyncMock(
                    side_effect=APITimeoutError(
                        request=httpx.Request("POST", "https://api.openai.com")
                    )
                )
            )
        )
        with pytest.raises(APIError) as exc:
            await provider.describe(b"image", None)
        assert exc.value.status == 504

    asyncio.run(run())


@pytest.mark.parametrize("request_id", [None, "not-a-uuid", ""])
def test_capture_id_is_required_and_validated(client, jpeg, request_id):
    data = {"stationary": "true"}
    if request_id is not None:
        data["request_id"] = request_id
    response = client.post(
        "/vision/describe",
        files={"image": ("image.jpg", jpeg, "image/jpeg")},
        data=data,
    )
    assert response.status_code == 422
