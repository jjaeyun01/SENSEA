import copy
import os
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.main import ROOT, create_app
from app.routing import load_graph, shortest_path


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(
            os.environ, {"SENSEA_WRITE_TOKEN": "test-token", "OPENAI_API_KEY": ""}
        )
        self.env.start()
        self.app = create_app(db_path=Path(self.tmp.name) / "noise.sqlite3")
        self.client = TestClient(self.app)
        self.headers = {"Authorization": "Bearer test-token"}

    def tearDown(self):
        self.client.close()
        self.env.stop()
        self.tmp.cleanup()

    def route(self, **overrides):
        payload = {"start_waypoint": "start", "end_waypoint": "library_entrance", **overrides}
        return self.client.post("/routes", json=payload)

    def test_places_and_unknown_nodes(self):
        places = self.client.get("/places?q=library").json()["places"]
        self.assertEqual(places[0]["name"], "Library")
        self.assertEqual(self.client.get("/places?q=missing").json()["places"], [])
        self.assertEqual(self.route(end_waypoint="missing").status_code, 404)

    def test_unknown_noise_is_not_zero_and_demo_cannot_be_live(self):
        response = self.route()
        self.assertEqual(response.status_code, 200)
        route = response.json()["routes"][0]
        self.assertEqual(route["distance_m"], 200)
        self.assertIsNone(route["relative_noise"])
        self.assertEqual(route["noise_data_status"], "unknown")
        self.assertEqual(self.route(mode="live").status_code, 409)

    def test_noise_changes_route_and_persists(self):
        samples = [
            ("start-plaza", 0.9),
            ("plaza-library", 0.9),
            ("start-garden", 0.1),
            ("garden-library", 0.1),
        ]
        for edge, score in samples:
            result = self.client.post(
                "/noise",
                headers=self.headers,
                json={"edge_id": edge, "relative_noise": score, "consent": True},
            )
            self.assertEqual(result.status_code, 201)
        result = self.route().json()
        self.assertEqual(len(result["routes"]), 2)
        self.assertEqual(result["recommended_route_id"], "noise-weighted")
        self.assertEqual(result["routes"][1]["distance_m"], 280)
        other = TestClient(create_app(db_path=Path(self.tmp.name) / "noise.sqlite3"))
        self.assertEqual(other.get("/noise").json()["edges"]["start-plaza"]["sample_count"], 1)
        other.close()

    def test_consent_auth_validation(self):
        body = {"edge_id": "start-plaza", "relative_noise": 0.5, "consent": True}
        self.assertEqual(self.client.post("/noise", json=body).status_code, 401)
        cases = [
            ({"consent": False}, 403),
            ({"relative_noise": 2}, 422),
            ({"edge_id": "missing"}, 404),
        ]
        for changes, expected in cases:
            response = self.client.post("/noise", headers=self.headers, json={**body, **changes})
            self.assertEqual(response.status_code, expected)

    def test_stale_and_expired_measurements(self):
        now = datetime.now(UTC)
        self.app.state.noise_store.add("start-plaza", 0.1, now - timedelta(hours=2))
        self.app.state.noise_store.add("start-garden", 0.1, now - timedelta(days=8))
        edges = self.client.get("/noise").json()["edges"]
        self.assertEqual(edges["start-plaza"]["status"], "stale")
        self.assertIsNone(edges["start-plaza"]["relative_noise"])
        self.assertEqual(edges["start-garden"]["status"], "unknown")

    def test_reverse_instruction_and_same_start(self):
        result = self.route(start_waypoint="library_entrance", end_waypoint="start").json()
        instruction = result["routes"][0]["segments"][0]["instruction"]
        self.assertEqual(instruction, "Continue to the plaza waypoint.")
        arrived = self.route(end_waypoint="start").json()
        self.assertTrue(arrived["arrived"])
        self.assertEqual(arrived["routes"][0]["segments"], [])

    def test_live_ignores_unverified_edges_and_one_way_is_respected(self):
        graph = load_graph(ROOT / "data/demo-campus.json")
        noise = self.app.state.noise_store.summaries(e["id"] for e in graph["edges"])
        missing = shortest_path(graph, "start", "library_entrance", noise, simulation=False)
        self.assertIsNone(missing)
        graph = copy.deepcopy(graph)
        for edge in graph["edges"]:
            edge["bidirectional"] = False
        self.assertIsNone(shortest_path(graph, "library_entrance", "start", noise))

    def test_partial_coverage_does_not_claim_quieter(self):
        self.app.state.noise_store.add("start-garden", 0)
        self.app.state.noise_store.add("garden-library", 0)
        response = self.route().json()
        self.assertEqual(response["recommended_route_id"], "shortest")
        self.assertEqual(len(response["routes"]), 2)

    def test_speech_validation_and_missing_key(self):
        rejected = self.client.post("/speech/transcribe", headers=self.headers, content=b"x")
        self.assertEqual(rejected.status_code, 415)
        unconfigured = self.client.post(
            "/speech/transcribe",
            headers={**self.headers, "Content-Type": "audio/mp4"},
            content=b"x",
        )
        self.assertEqual(unconfigured.status_code, 503)

    def test_speech_mocked_provider_success_and_limits(self):
        provider_requests = []

        class Provider:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, url, **kwargs):
                provider_requests.append(kwargs)
                return httpx.Response(
                    200, json={"text": "Take me to the library"}, request=httpx.Request("POST", url)
                )

        headers = {**self.headers, "Content-Type": "audio/mp4"}
        env = patch.dict(os.environ, {"OPENAI_API_KEY": "fake-test-key"})
        client = patch("app.main.httpx.AsyncClient", return_value=Provider())
        with env, client:
            empty = self.client.post("/speech/transcribe", headers=headers, content=b"")
            self.assertEqual(empty.status_code, 400)
            oversized = b"x" * (5 * 1024 * 1024 + 1)
            too_large = self.client.post("/speech/transcribe", headers=headers, content=oversized)
            self.assertEqual(too_large.status_code, 413)
            result = self.client.post("/speech/transcribe", headers=headers, content=b"fake-audio")
            self.assertEqual(result.json()["transcript"], "Take me to the library")
            self.assertEqual(provider_requests[0]["data"]["language"], "en")
            for _ in range(7):
                self.client.post("/speech/transcribe", headers=headers, content=b"fake-audio")
            limited = self.client.post("/speech/transcribe", headers=headers, content=b"fake-audio")
            self.assertEqual(limited.status_code, 429)

    def test_provider_failure_returns_accessible_fallback_without_details(self):
        class Provider:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def post(self, url, **kwargs):
                return httpx.Response(
                    401,
                    json={"error": "private-provider-detail"},
                    request=httpx.Request("POST", url),
                )

        env = patch.dict(os.environ, {"OPENAI_API_KEY": "fake-test-key"})
        client = patch("app.main.httpx.AsyncClient", return_value=Provider())
        with env, client:
            response = self.client.post(
                "/speech/transcribe",
                headers={**self.headers, "Content-Type": "audio/mp4"},
                content=b"fake-audio",
            )
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("private-provider-detail", response.text)


if __name__ == "__main__":
    unittest.main()
