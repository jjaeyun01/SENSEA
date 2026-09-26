from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_places_search() -> None:
    response = client.get("/places", params={"q": "library"})
    assert response.status_code == 200
    assert response.json()["places"][0]["id"] == "library"
    assert response.json()["places"][0]["verification_status"] == "demo"


def test_routes_and_no_route() -> None:
    response = client.post("/routes", json={"start_waypoint": "start", "end_waypoint": "library_entrance", "noise_preference": "quiet"})
    assert response.status_code == 200 and len(response.json()["routes"]) == 2
    missing = client.post("/routes", json={"start_waypoint": "start", "end_waypoint": "missing", "noise_preference": "quiet"})
    assert missing.status_code == 404


def test_noise_requires_consent_and_valid_range() -> None:
    assert client.post("/noise", json={"edge_id": "edge_start_quad", "relative_noise": 0.42, "consent": False}).status_code == 403
    assert client.post("/noise", json={"edge_id": "edge_start_quad", "relative_noise": 1.2, "consent": True}).status_code == 422
    accepted = client.post("/noise", json={"edge_id": "edge_start_quad", "relative_noise": 0.42, "consent": True})
    assert accepted.status_code == 201 and accepted.json()["raw_audio_stored"] is False


def test_vision_validation_and_demo_response() -> None:
    assert client.post("/vision/describe").status_code == 422
    wrong_type = client.post("/vision/describe", files={"image": ("frame.png", b"pixels", "image/png")})
    assert wrong_type.status_code == 415
    ok = client.post("/vision/describe", data={"expected_place": "Memorial Library"}, files={"image": ("frame.jpg", b"jpeg bytes", "image/jpeg")})
    assert ok.status_code == 200
    assert ok.json()["provider_mode"] == "demo-mock" and ok.json()["image_retained"] is False
