import unittest

from pydantic import ValidationError

from app.routing import RouteRequest, UnknownDestinationError, build_demo_routes


class RoutingTests(unittest.TestCase):
    def test_demo_routes_are_accessible_and_nonempty(self) -> None:
        response = build_demo_routes("학생회관")

        self.assertEqual(response.destination, "학생회관")
        self.assertEqual(len(response.routes), 3)
        self.assertTrue(any(not route.hasStairs for route in response.routes))
        self.assertTrue(all(route.steps for route in response.routes))
        self.assertEqual({route.routeType for route in response.routes}, {"shortest", "flat", "safe"})
        self.assertTrue(all(route.verificationStatus == "verified-demo" for route in response.routes))
        self.assertTrue(all(route.dataFreshness for route in response.routes))
        self.assertTrue(all(route.uncertainty for route in response.routes))
        self.assertEqual({route.noiseDataStatus for route in response.routes}, {"fresh", "stale", "unknown"})

    def test_destination_is_trimmed(self) -> None:
        response = build_demo_routes("  도서관  ")
        self.assertEqual(response.destination, "도서관")

    def test_blank_destination_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            RouteRequest(destination="   ")

    def test_unknown_destination_is_rejected_without_inventing_a_route(self) -> None:
        with self.assertRaisesRegex(UnknownDestinationError, "검증된 데모 목적지"):
            build_demo_routes("존재하지 않는 건물")

    def test_known_alias_resolves_to_verified_destination(self) -> None:
        response = build_demo_routes("중앙도서관")
        self.assertEqual(response.destination, "도서관")

    def test_morgridge_design_destination_is_supported(self) -> None:
        response = build_demo_routes("Morgridge")
        self.assertEqual(response.destination, "Morgridge Hall")


if __name__ == "__main__":
    unittest.main()
