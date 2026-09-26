from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

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
    Image.new("RGB", (32, 24), "white").save(stream, "JPEG")
    return stream.getvalue()
