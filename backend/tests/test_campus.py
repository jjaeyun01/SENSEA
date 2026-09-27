import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import campus

SEARCH = """<li data-model="MapObject" data-object-type="building" data-map-object-id="432">
Memorial <b>Union</b></li>
<li data-model="MapObject" data-object-type="building" data-map-object-id="432">
The Wisconsin Union</li>
<li data-model="MapObject" data-object-type="natural_area" data-map-object-id="502">Park</li>"""
BUILDING = {
    "id": 432,
    "name": "Memorial Union",
    "object_type": "building",
    "lnglat": [-89.399, 43.076],
    "street_address": "800 Langdon St.",
}
ROUTE = {
    "routes": [
        {
            "duration": "120s",
            "distanceMeters": 100,
            "polyline": {"encodedPolyline": "abc"},
            "legs": [
                {
                    "steps": [
                        {
                            "startLocation": {"latLng": {"latitude": 43.075, "longitude": -89.4}},
                            "endLocation": {"latLng": {"latitude": 43.076, "longitude": -89.399}},
                            "distanceMeters": 100,
                            "navigationInstruction": {
                                "instructions": "Walk north",
                                "maneuver": "DEPART",
                            },
                        }
                    ]
                }
            ],
        }
    ]
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SENSEA_WRITE_TOKEN", "test-token")
    monkeypatch.setenv("GOOGLE_ROUTES_API_KEY", "test-key")
    app = FastAPI()
    app.include_router(campus.router)
    return TestClient(app)


def upstream(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        campus.httpx,
        "AsyncClient",
        lambda **kwargs: original(
            transport=httpx.MockTransport(handler),
            **kwargs,
        ),
    )


def test_search_filters_and_deduplicates(client, monkeypatch):
    def handler(request):
        assert request.url.params["s"] == "Memorial & Union"
        return httpx.Response(200, text=SEARCH)

    upstream(monkeypatch, handler)
    response = client.get("/campus/places", params={"q": "Memorial & Union"})
    assert response.json()["places"] == [{"id": "432", "name": "Memorial Union"}]


def test_blank_search_does_not_fetch(client, monkeypatch):
    upstream(monkeypatch, lambda _: pytest.fail("Must not fetch"))
    assert client.get("/campus/places?q= ").json()["places"] == []


def test_search_failure_not_empty_success(client, monkeypatch):
    upstream(monkeypatch, lambda _: httpx.Response(503))
    assert client.get("/campus/places?q=Union").status_code == 502


def test_details_address_no_external_redirect(client, monkeypatch):
    upstream(monkeypatch, lambda _: httpx.Response(200, json=BUILDING))
    result = client.get("/campus/places/432").json()
    assert result["address"] == "800 Langdon St."
    assert result["latitude"] == 43.076
    assert result["entrance"] is None
    assert result["entrance_verified"] is False
    assert "directions_url" not in result
    assert client.get("/campus/places/432/directions").status_code == 404


def test_only_fully_surveyed_entrance_is_used(client, monkeypatch, tmp_path):
    entrance_file = tmp_path / "entrances.json"
    entrance_file.write_text(
        """{
          "432": {
            "latitude": 43.0759,
            "longitude": -89.3991,
            "verified": true,
            "accuracy_m": 3,
            "surveyed_at": "2026-09-27T12:00:00-05:00",
            "description": "Field-surveyed east public entrance"
          }
        }""",
        encoding="utf-8",
    )
    monkeypatch.setenv("SENSEA_ENTRANCES_PATH", str(entrance_file))
    upstream(monkeypatch, lambda _: httpx.Response(200, json=BUILDING))

    result = client.get("/campus/places/432").json()

    assert result["entrance_verified"] is True
    assert result["entrance"]["accuracy_m"] == 3
    assert result["entrance"]["description"] == "Field-surveyed east public entrance"


def test_incomplete_entrance_record_is_not_treated_as_verified(client, monkeypatch, tmp_path):
    entrance_file = tmp_path / "entrances.json"
    entrance_file.write_text(
        '{"432":{"latitude":43.0759,"longitude":-89.3991,"verified":true}}',
        encoding="utf-8",
    )
    monkeypatch.setenv("SENSEA_ENTRANCES_PATH", str(entrance_file))
    upstream(monkeypatch, lambda _: httpx.Response(200, json=BUILDING))

    result = client.get("/campus/places/432").json()

    assert result["entrance"] is None
    assert result["entrance_verified"] is False


@pytest.mark.parametrize(
    "patch", [{"lnglat": [999, 43]}, {"lnglat": None}, {"object_type": "parking"}, {"name": None}]
)
def test_invalid_building_rejected(client, monkeypatch, patch):
    upstream(monkeypatch, lambda _: httpx.Response(200, json={**BUILDING, **patch}))
    assert client.get("/campus/places/432").status_code == 502


PAYLOAD = {"origin": {"latitude": 43.075, "longitude": -89.4}, "destination_id": 432}
HEADERS = {"X-Sensea-Token": "test-token"}


def test_routes_request_stays_server_side(client, monkeypatch):
    import json

    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, json=BUILDING)
        body = json.loads(request.content)
        assert body["travelMode"] == "WALK"
        assert body["computeAlternativeRoutes"] is True
        assert body["origin"]["location"]["latLng"] == PAYLOAD["origin"]
        assert request.headers["X-Goog-Api-Key"] == "test-key"
        return httpx.Response(200, json=ROUTE)

    upstream(monkeypatch, handler)
    result = client.post("/campus/routes", headers=HEADERS, json=PAYLOAD)
    assert result.status_code == 200
    assert result.json()["routes"][0]["steps"][0]["instruction"] == "Walk north"
    assert result.json()["routes"][0]["accessibility"] == "unknown"
    assert result.json()["arrival_target"]["kind"] == "building_representative_point"
    assert result.json()["arrival_target"]["verified_entrance"] is False
    assert "test-key" not in result.text


def test_no_key_or_token_never_calls_provider(client, monkeypatch):
    upstream(monkeypatch, lambda _: pytest.fail("Must not fetch"))
    assert client.post("/campus/routes", json=PAYLOAD).status_code == 401
    monkeypatch.delenv("GOOGLE_ROUTES_API_KEY")
    assert client.post("/campus/routes", headers=HEADERS, json=PAYLOAD).status_code == 503


def test_invalid_origin_rejected(client):
    assert (
        client.post(
            "/campus/routes",
            headers=HEADERS,
            json={
                **PAYLOAD,
                "origin": {"latitude": 100, "longitude": -89},
            },
        ).status_code
        == 422
    )


def test_no_route_is_explicit(client, monkeypatch):
    upstream(
        monkeypatch, lambda req: httpx.Response(200, json=BUILDING if req.method == "GET" else {})
    )
    assert client.post("/campus/routes", headers=HEADERS, json=PAYLOAD).status_code == 404
