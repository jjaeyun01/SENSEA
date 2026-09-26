from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings():
    return Settings(_env_file=None, vision_provider="disabled", sensea_api_key="")


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as instance:
        yield instance


@pytest.fixture
def jpeg():
    stream = BytesIO()
    image = Image.new("RGB", (640, 480), "gray")
    draw = ImageDraw.Draw(image)
    for x in range(20, 620, 24):
        draw.rectangle((x, 30, x + 10, 450), fill="white")
    image.save(stream, "JPEG")
    return stream.getvalue()
