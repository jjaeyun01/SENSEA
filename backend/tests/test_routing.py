import unittest

from pydantic import ValidationError

from app.routing import RouteRequest, build_demo_routes


class RoutingTests(unittest.TestCase):
    def test_demo_routes_are_accessible_and_nonempty(self) -> None:
        response = build_demo_routes("학생회관")

        self.assertEqual(response.destination, "학생회관")
        self.assertGreaterEqual(len(response.routes), 2)
        self.assertTrue(any(not route.hasStairs for route in response.routes))
        self.assertTrue(all(route.steps for route in response.routes))

    def test_destination_is_trimmed(self) -> None:
        response = build_demo_routes("  도서관  ")
        self.assertEqual(response.destination, "도서관")

    def test_blank_destination_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            RouteRequest(destination="   ")


if __name__ == "__main__":
    unittest.main()
