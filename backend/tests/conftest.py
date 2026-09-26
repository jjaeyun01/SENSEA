import json
import os
from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import Settings


def pytest_configure():
    # All default tests use configuration defaults, even on a configured developer PC.
    # Explicit Settings arguments/monkeypatch in each test can still exercise other modes.
    for name, field in Settings.model_fields.items():
        value = field.default
        if hasattr(value, "get_secret_value"):
            value = ""
        os.environ[name.upper()] = (
            json.dumps(value) if isinstance(value, (bool, list)) else str(value)
        )


@pytest.fixture(autouse=True)
def no_external_http(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Default tests must use an injected HTTP mock, never the network")

    async def async_blocked(*args, **kwargs):
        blocked()

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", async_blocked)


@pytest.fixture
def settings():
    return Settings(_env_file=None, vision_provider="disabled", sensea_api_key="")


@pytest.fixture
def client(settings):
    from app.main import create_app

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
