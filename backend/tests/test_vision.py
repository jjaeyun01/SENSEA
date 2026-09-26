import unittest

from app.vision import describe_demo_scene


class VisionTests(unittest.TestCase):
    def test_demo_description_always_reports_uncertainty_and_safety_notice(self) -> None:
        response = describe_demo_scene()

        self.assertTrue(response.is_demo)
        self.assertEqual(response.uncertainty, "높음")
        self.assertIn("판단하지 마세요", response.description)
        self.assertIn("보장하지 않습니다", response.safety_notice)

    def test_uploaded_filename_is_not_persisted_or_treated_as_detection(self) -> None:
        response = describe_demo_scene("campus-sign.jpg")

        self.assertIn("이미지 이름을 확인", response.description)
        self.assertTrue(response.is_demo)


if __name__ == "__main__":
    unittest.main()
