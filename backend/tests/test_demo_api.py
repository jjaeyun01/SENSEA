from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.demo_api import router


def test_explicit_demo_contract():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    response = client.post("/demo/routes", json={"destination": "Morgridge"})
    assert response.status_code == 200
    assert response.json()["simulation_only"] is True
    assert len(response.json()["routes"]) == 3
    assert client.post("/demo/routes", json={"destination": "unknown"}).status_code == 404
