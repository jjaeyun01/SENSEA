from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFilter

from app.foundation import create_app
from app.quality import assess_quality


def encode(image):
    output = BytesIO()
    image.save(output, "JPEG", quality=90)
    return output.getvalue()


def pattern():
    # Procedural test pixels only: no outside photos, training data or model weights.
    image = Image.new("RGB", (640, 480), (110, 110, 110))
    draw = ImageDraw.Draw(image)
    for x in range(20, 620, 24):
        draw.rectangle((x, 30, x + 10, 450), fill=(210, 210, 210))
    return image


@pytest.mark.parametrize(
    "image,reason",
    [
        (Image.new("RGB", (640, 480), "black"), "too_dark"),
        (Image.new("RGB", (640, 480), "white"), "too_bright"),
        (Image.new("RGB", (640, 480), (120, 120, 120)), "low_detail"),
        (Image.new("RGB", (64, 48), "gray"), "low_resolution"),
        (pattern().filter(ImageFilter.GaussianBlur(12)), "low_detail"),
    ],
)
def test_retake_never_calls_provider_or_returns_scene(settings, image, reason):
    class UnexpectedVision:
        async def describe(self, jpeg, expected_place):
            pytest.fail("Retake must not incur a model request")

    with TestClient(create_app(settings, provider=UnexpectedVision())) as client:
        response = client.post(
            "/vision/describe",
            files={"image": ("image.jpg", encode(image), "image/jpeg")},
            data={
                "stationary": "true",
                "external_processing_consent": "true",
                "request_id": "00000000-0000-4000-8000-000000000001",
            },
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "retake"
    assert payload["quality"]["reason"] == reason
    assert payload["quality"]["guidance"]
    assert payload["navigation_safe"] is False
    assert "description" not in payload
    assert "roadway" not in payload
    assert payload["request_id"] == "00000000-0000-4000-8000-000000000001"


def test_structured_photo_passes_but_blurred_copy_requests_retake(settings):
    assert assess_quality(encode(pattern()), settings).status == "usable"
    blurred = pattern().filter(ImageFilter.GaussianBlur(12))
    assert assess_quality(encode(blurred), settings).reason == "low_detail"


def test_flat_wall_is_not_labeled_as_confirmed_blur(settings):
    quality = assess_quality(encode(Image.new("RGB", (640, 480), "gray")), settings)
    assert quality.reason == "low_detail"
    assert "초점과 촬영 대상" in quality.guidance


def test_retake_also_consumes_request_budget(settings):
    settings.vision_requests_per_minute = 1
    with TestClient(create_app(settings)) as client:
        params = {
            "files": {"image": ("image.jpg", encode(Image.new("RGB", (640, 480))), "image/jpeg")},
            "data": {
                "stationary": "true",
                "external_processing_consent": "true",
                "request_id": "00000000-0000-4000-8000-000000000001",
            },
        }
        assert client.post("/vision/describe", **params).status_code == 200
        assert client.post("/vision/describe", **params).status_code == 429
