"""Offline tests: all coordinates and paths below are synthetic adapter fixtures."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import APIError
from app.main import create_app
from app.models import NoiseRequest
from app.supabase import SupabaseRepository

NOW = datetime(2026, 1, 2, 12, tzinfo=UTC)
SECRET = "sb_secret_fixture_only_not_a_real_key"
PLACE_ID = "00000000-0000-4000-8000-000000000001"
EDGE_ID = "fixture-start-end"
SECOND_EDGE_ID = "fixture-end-third"


@pytest.fixture
def graph_payload():
    # Zero coordinates are arbitrary schema fixtures, never real navigation data.
    return {
        "places": [
            {
                "id": PLACE_ID,
                "name": "Synthetic Library",
                "waypoint_id": "fixture-end",
                "latitude": 0.0,
                "longitude": 0.0,
                "entrance_notes": None,
                "verified_at": None,
            }
        ],
        "waypoints": [
            {
                "id": waypoint,
                "latitude": 0.0,
                "longitude": 0.0,
                "landmark_description": f"Synthetic {waypoint}",
                "verified_at": None,
            }
            for waypoint in ("fixture-start", "fixture-end", "fixture-third")
        ],
        "edges": [
            {
                "id": edge_id,
                "from_waypoint": start,
                "to_waypoint": end,
                "distance_m": 10.0,
                "pedestrian_verified": False,
                "instruction": "Fixture forward instruction",
                "reverse_instruction": "Fixture reverse instruction",
                "bidirectional": True,
            }
            for edge_id, start, end in (
                (EDGE_ID, "fixture-start", "fixture-end"),
                (SECOND_EDGE_ID, "fixture-end", "fixture-third"),
            )
        ],
    }


def summary_payload(edge_id=EDGE_ID, *, observed_at=NOW, relative_noise=0.4, sample_count=2):
    return {
        "edge_id": edge_id,
        "relative_noise": relative_noise,
        "latest_observed_at": observed_at.isoformat() if observed_at is not None else None,
        "sample_count": sample_count,
    }


@pytest.fixture
def make_repository():
    repositories = []

    def make(handler, **overrides):
        settings = Settings(
            _env_file=None,
            vision_provider="disabled",
            sensea_api_key="fixture-api-key",
            **{
                "storage_backend": "supabase",
                "supabase_url": "https://fixture.supabase.invalid",
                "supabase_secret_key": SECRET,
                "supabase_timeout_seconds": 2.5,
                "supabase_simulation_only": True,
                "noise_ttl_seconds": 3600,
                **overrides,
            },
        )
        requests = []

        def record(request):
            requests.append(request)
            return handler(request)

        repository = SupabaseRepository(settings, transport=httpx.MockTransport(record))
        repositories.append(repository)
        return repository, requests, settings

    yield make
    for repository in repositories:
        repository.close()


def assert_storage_error(call, status, code="storage_invalid_response"):
    with pytest.raises(APIError) as raised:
        call()
    assert raised.value.status == status
    assert raised.value.code == code
    assert SECRET not in raised.value.message
    return raised.value


def test_graph_maps_initial_schema_without_exposing_waypoint_coordinates(
    make_repository, graph_payload
):
    repository, requests, _ = make_repository(
        lambda request: httpx.Response(200, json=graph_payload)
    )
    graph = repository.get_graph()
    assert graph.places[0].id == PLACE_ID
    assert graph.places[0].entrance_notes == ""
    assert graph.places[0].latitude == 0.0
    assert graph.waypoints[0].model_dump() == {
        "id": "fixture-start",
        "landmark_description": "Synthetic fixture-start",
        "verified_at": None,
    }
    assert graph.edges[0].from_waypoint == "fixture-start"
    assert graph.edges[0].distance_m == 10.0
    assert graph.edges[0].pedestrian_verified is False
    assert requests[0].url.path == "/rest/v1/rpc/sensea_graph"
    assert json.loads(requests[0].content) == {}


def test_search_passes_literal_query_as_rpc_json(make_repository, graph_payload):
    query = 'LIBRARY%_"\\,()'
    graph_payload["places"][0]["entrance_notes"] = "Synthetic entrance note"
    repository, requests, _ = make_repository(
        lambda request: httpx.Response(200, json=graph_payload["places"])
    )
    places = repository.search_places(query)
    assert places[0].entrance_notes == "Synthetic entrance note"
    assert requests[0].method == "POST"
    assert requests[0].url.path == "/rest/v1/rpc/sensea_search_places"
    assert not requests[0].url.query
    assert json.loads(requests[0].content) == {"p_query": query}


@pytest.mark.parametrize("payload", [{}, None, [None], [{"id": "incomplete"}]])
def test_search_rejects_malformed_rows(make_repository, payload):
    repository, _, _ = make_repository(lambda request: httpx.Response(200, json=payload))
    assert_storage_error(lambda: repository.search_places(""), 502)


@pytest.mark.parametrize(
    "defect",
    [
        "missing_collection",
        "duplicate_waypoint",
        "duplicate_edge",
        "duplicate_place",
        "dangling_place",
        "dangling_edge",
        "self_loop",
        "missing_reverse",
        "invalid_distance",
        "invalid_coordinates",
    ],
)
def test_graph_rejects_invalid_rows_and_inconsistent_references(
    make_repository, graph_payload, defect
):
    if defect == "missing_collection":
        del graph_payload["edges"]
    elif defect == "duplicate_waypoint":
        graph_payload["waypoints"].append(deepcopy(graph_payload["waypoints"][0]))
    elif defect == "duplicate_edge":
        graph_payload["edges"].append(deepcopy(graph_payload["edges"][0]))
    elif defect == "duplicate_place":
        graph_payload["places"].append(deepcopy(graph_payload["places"][0]))
    elif defect == "dangling_place":
        graph_payload["places"][0]["waypoint_id"] = "missing"
    elif defect == "dangling_edge":
        graph_payload["edges"][0]["to_waypoint"] = "missing"
    elif defect == "self_loop":
        graph_payload["edges"][0]["to_waypoint"] = "fixture-start"
    elif defect == "missing_reverse":
        graph_payload["edges"][0]["reverse_instruction"] = None
    elif defect == "invalid_distance":
        graph_payload["edges"][0]["distance_m"] = 0
    elif defect == "invalid_coordinates":
        graph_payload["waypoints"][0]["latitude"] = 91
    repository, _, _ = make_repository(lambda request: httpx.Response(200, json=graph_payload))
    assert_storage_error(repository.get_graph, 502)


def test_empty_graph_is_valid(make_repository):
    payload = {"places": [], "waypoints": [], "edges": []}
    repository, _, _ = make_repository(lambda request: httpx.Response(200, json=payload))
    graph = repository.get_graph()
    assert graph.model_dump() == payload


@pytest.mark.parametrize("simulation_only,expected", [(True, "demo"), (False, "measured")])
def test_noise_batch_maps_measured_demo_and_unknown(make_repository, simulation_only, expected):
    payload = [
        summary_payload(),
        summary_payload(SECOND_EDGE_ID, observed_at=None, relative_noise=None, sample_count=0),
    ]
    repository, requests, _ = make_repository(
        lambda request: httpx.Response(200, json=payload),
        supabase_simulation_only=simulation_only,
    )
    summaries = repository.noise_summaries([EDGE_ID, SECOND_EDGE_ID], NOW)
    assert summaries[EDGE_ID].relative_noise == 0.4
    assert summaries[EDGE_ID].status == expected
    assert summaries[EDGE_ID].sample_count == 2
    assert summaries[EDGE_ID].latest_observed_at == NOW
    assert summaries[SECOND_EDGE_ID].model_dump() == {
        "relative_noise": None,
        "status": "unknown",
        "latest_observed_at": None,
        "sample_count": 0,
    }
    assert len(requests) == 1
    assert requests[0].url.path == "/rest/v1/rpc/sensea_noise_summaries"
    body = json.loads(requests[0].content)
    assert body["p_edge_ids"] == [EDGE_ID, SECOND_EDGE_ID]
    assert datetime.fromisoformat(body["p_now"]) == NOW
    assert body["p_ttl_seconds"] == 3600


def test_empty_noise_batch_never_calls_database(make_repository):
    def unexpected(request):
        pytest.fail("Empty edge list must not call the database")

    repository, requests, _ = make_repository(unexpected)
    assert repository.noise_summaries([], NOW) == {}
    assert requests == []


@pytest.mark.parametrize(
    "changes",
    [
        {"relative_noise": -0.1},
        {"relative_noise": 1.1},
        {"relative_noise": "0.4"},
        {"relative_noise": True},
        {"sample_count": -1},
        {"sample_count": 1001},
        {"sample_count": 1.5},
        {"sample_count": "2"},
        {"sample_count": True},
        {"sample_count": 0},
        {"relative_noise": None},
        {"latest_observed_at": None},
        {"latest_observed_at": "invalid"},
        {"latest_observed_at": "2026-01-02T12:00:00"},
        {"latest_observed_at": (NOW + timedelta(seconds=10)).isoformat()},
        {"latest_observed_at": (NOW - timedelta(seconds=3601)).isoformat()},
    ],
)
def test_noise_rejects_out_of_range_and_inconsistent_summary(make_repository, changes):
    row = {**summary_payload(), **changes}
    repository, _, _ = make_repository(lambda request: httpx.Response(200, json=[row]))
    assert_storage_error(lambda: repository.noise_summaries([EDGE_ID], NOW), 502)


@pytest.mark.parametrize("defect", ["missing", "duplicate", "unexpected", "not_list"])
def test_noise_batch_must_match_requested_edges(make_repository, defect):
    payload = [summary_payload()]
    if defect == "missing":
        payload = []
    elif defect == "duplicate":
        payload.append(summary_payload())
    elif defect == "unexpected":
        payload.append(summary_payload("unrequested-edge"))
    elif defect == "not_list":
        payload = summary_payload()
    repository, _, _ = make_repository(lambda request: httpx.Response(200, json=payload))
    assert_storage_error(lambda: repository.noise_summaries([EDGE_ID], NOW), 502)


def test_noise_write_sends_only_existing_summary_contract(make_repository):
    def respond(request):
        return httpx.Response(
            200, json=summary_payload(observed_at=datetime.now(UTC), sample_count=1)
        )

    repository, requests, _ = make_repository(respond)
    summary = repository.add_noise(NoiseRequest(edge_id=EDGE_ID, relative_noise=0.4, consent=True))
    assert summary.status == "demo"
    assert summary.relative_noise == 0.4
    assert requests[0].url.path == "/rest/v1/rpc/sensea_add_noise"
    assert len(requests) == 1
    assert json.loads(requests[0].content) == {
        "p_edge_id": EDGE_ID,
        "p_relative_noise": 0.4,
        "p_ttl_seconds": 3600,
    }


def test_noise_consent_rejected_before_any_database_call(make_repository):
    def unexpected(request):
        pytest.fail("Consent rejection must happen before database access")

    repository, requests, _ = make_repository(unexpected)
    assert_storage_error(
        lambda: repository.add_noise(
            NoiseRequest(edge_id=EDGE_ID, relative_noise=0.4, consent=False)
        ),
        400,
        "consent_required",
    )
    assert requests == []


def test_unknown_edge_preserves_existing_api_error(make_repository):
    repository, _, _ = make_repository(
        lambda request: httpx.Response(
            409, json={"code": "23503", "message": f"private foreign key detail {SECRET}"}
        )
    )
    assert_storage_error(
        lambda: repository.add_noise(
            NoiseRequest(edge_id="missing", relative_noise=0.4, consent=True)
        ),
        404,
        "unknown_edge",
    )


@pytest.mark.parametrize("status", [301, 307, 401, 403, 404, 429, 500, 503])
def test_http_errors_are_unavailable_and_never_leak_database_body(make_repository, status):
    repository, _, _ = make_repository(
        lambda request: httpx.Response(status, json={"message": f"database detail {SECRET}"})
    )
    error = assert_storage_error(lambda: repository.search_places(""), 503, "storage_unavailable")
    assert "database detail" not in error.message


@pytest.mark.parametrize(
    "exception_type,status,code",
    [
        (httpx.ConnectTimeout, 504, "storage_timeout"),
        (httpx.ReadTimeout, 504, "storage_timeout"),
        (httpx.ConnectError, 503, "storage_unavailable"),
        (httpx.ReadError, 503, "storage_unavailable"),
    ],
)
def test_transport_errors_have_bounded_safe_api_errors(
    make_repository, exception_type, status, code
):
    def fail(request):
        assert set(request.extensions["timeout"].values()) == {2.5}
        raise exception_type(f"internal diagnostic {SECRET}", request=request)

    repository, _, _ = make_repository(fail)
    assert_storage_error(repository.get_graph, status, code)


def test_database_statement_timeout_is_reported_as_timeout(make_repository):
    repository, _, _ = make_repository(
        lambda request: httpx.Response(500, json={"code": "57014", "message": SECRET})
    )
    assert_storage_error(repository.get_graph, 504, "storage_timeout")


def test_invalid_json_is_reported_without_echoing_body(make_repository):
    repository, _, _ = make_repository(
        lambda request: httpx.Response(200, content=f"not JSON: {SECRET}")
    )
    assert_storage_error(repository.get_graph, 502)


@pytest.mark.parametrize(
    "key,expected_authorization",
    [(SECRET, None), ("eyJhbGciOiJIUzI1NiJ9.fixture.signature", "legacy")],
)
def test_secret_key_and_legacy_service_role_headers(make_repository, key, expected_authorization):
    repository, requests, _ = make_repository(
        lambda request: httpx.Response(200, json=[]), supabase_secret_key=key
    )
    repository.search_places("")
    assert requests[0].headers["apikey"] == key
    if expected_authorization is None:
        assert "authorization" not in requests[0].headers
    else:
        assert requests[0].headers["authorization"] == f"Bearer {key}"
    assert key not in str(requests[0].url)
    assert key not in requests[0].content.decode()


@pytest.mark.parametrize("endpoint", ["/places", "/routes", "/noise"])
def test_api_database_outage_does_not_fall_back_to_demo(make_repository, endpoint):
    repository, requests, settings = make_repository(
        lambda request: httpx.Response(503, json={"message": SECRET})
    )
    with TestClient(
        create_app(settings, repository=repository), headers={"X-API-Key": "fixture-api-key"}
    ) as client:
        if endpoint == "/places":
            response = client.get(endpoint)
        elif endpoint == "/routes":
            response = client.post(
                endpoint,
                json={
                    "start_waypoint": "fixture-start",
                    "end_waypoint": "fixture-third",
                    "simulation": True,
                },
            )
        else:
            response = client.post(
                endpoint, json={"edge_id": EDGE_ID, "relative_noise": 0.4, "consent": True}
            )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "storage_unavailable"
    assert SECRET not in response.text
    assert len(requests) == 1


def test_route_fetches_one_graph_and_one_batch_for_all_edges(make_repository, graph_payload):
    def respond(request):
        if request.url.path.endswith("/sensea_graph"):
            return httpx.Response(200, json=graph_payload)
        if request.url.path.endswith("/sensea_noise_summaries"):
            body = json.loads(request.content)
            now = datetime.fromisoformat(body["p_now"])
            return httpx.Response(
                200,
                json=[summary_payload(edge_id, observed_at=now) for edge_id in body["p_edge_ids"]],
            )
        pytest.fail(f"Unexpected database request: {request.url.path}")

    repository, requests, settings = make_repository(respond)
    with TestClient(
        create_app(settings, repository=repository), headers={"X-API-Key": "fixture-api-key"}
    ) as client:
        response = client.post(
            "/routes",
            json={
                "start_waypoint": "fixture-start",
                "end_waypoint": "fixture-third",
                "simulation": True,
            },
        )
    assert response.status_code == 200
    assert response.json()["simulation_only"] is True
    assert response.json()["routes"][0]["noise_data_status"] == "demo"
    assert len(requests) == 2
    assert json.loads(requests[1].content)["p_edge_ids"] == [EDGE_ID, SECOND_EDGE_ID]


def test_live_storage_still_excludes_unverified_edges(make_repository, graph_payload):
    def respond(request):
        if request.url.path.endswith("/sensea_graph"):
            return httpx.Response(200, json=graph_payload)
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json=[
                summary_payload(edge_id, observed_at=None, relative_noise=None, sample_count=0)
                for edge_id in body["p_edge_ids"]
            ],
        )

    repository, _, settings = make_repository(respond, supabase_simulation_only=False)
    with TestClient(
        create_app(settings, repository=repository), headers={"X-API-Key": "fixture-api-key"}
    ) as client:
        response = client.post(
            "/routes",
            json={"start_waypoint": "fixture-start", "end_waypoint": "fixture-third"},
        )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "no_route"


def test_close_releases_transport_and_is_repeatable():
    class TrackingTransport(httpx.MockTransport):
        closed = False

        def close(self):
            self.closed = True
            super().close()

    transport = TrackingTransport(lambda request: httpx.Response(200, json=[]))
    settings = Settings(
        _env_file=None,
        storage_backend="supabase",
        sensea_api_key="fixture-api-key",
        supabase_url="https://fixture.supabase.invalid",
        supabase_secret_key=SECRET,
    )
    repository = SupabaseRepository(settings, transport=transport)
    repository.search_places("")
    repository.close()
    repository.close()
    assert transport.closed is True


def test_summary_accepts_ttl_boundary_and_maximum_retained_count(make_repository):
    repository, requests, _ = make_repository(
        lambda request: httpx.Response(
            200,
            json=[summary_payload(observed_at=NOW - timedelta(seconds=37), sample_count=1000)],
        ),
        noise_ttl_seconds=37,
    )
    summaries = repository.noise_summaries([EDGE_ID], NOW)
    assert summaries[EDGE_ID].sample_count == 1000
    assert summaries[EDGE_ID].latest_observed_at == NOW - timedelta(seconds=37)
    assert json.loads(requests[0].content)["p_ttl_seconds"] == 37


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
def test_summary_rejects_nonfinite_numbers(make_repository, token):
    payload = json.dumps([summary_payload()]).replace(
        '"relative_noise": 0.4', f'"relative_noise": {token}'
    )
    repository, _, _ = make_repository(
        lambda request: httpx.Response(
            200, content=payload, headers={"content-type": "application/json"}
        )
    )
    assert_storage_error(lambda: repository.noise_summaries([EDGE_ID], NOW), 502)


def test_noise_write_rejects_summary_for_different_edge(make_repository):
    repository, _, _ = make_repository(
        lambda request: httpx.Response(
            200, json=summary_payload("different-edge", observed_at=datetime.now(UTC))
        )
    )
    assert_storage_error(
        lambda: repository.add_noise(
            NoiseRequest(edge_id=EDGE_ID, relative_noise=0.4, consent=True)
        ),
        502,
    )


def test_successful_noise_write_cannot_return_empty_summary(make_repository):
    repository, _, _ = make_repository(
        lambda request: httpx.Response(
            200, json=summary_payload(observed_at=None, relative_noise=None, sample_count=0)
        )
    )
    assert_storage_error(
        lambda: repository.add_noise(
            NoiseRequest(edge_id=EDGE_ID, relative_noise=0.4, consent=True)
        ),
        502,
    )
