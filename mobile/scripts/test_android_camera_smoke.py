"""Regression checks for the smoke test oracle; no Android device is accessed."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("camera_smoke", Path(__file__).with_name("android-camera-smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def screen(analysis="Analyzing objects", camera="● Live camera on"):
    root = ET.Element("hierarchy")
    ET.SubElement(root, "node", {"resource-id": "com.sensea.app:id/camera-state", "text": camera})
    ET.SubElement(root, "node", {"resource-id": "com.sensea.app:id/analysis-state", "text": analysis})
    return root


class InferenceOracleTests(unittest.TestCase):
    def test_preview_and_loaded_model_do_not_prove_inference(self):
        self.assertIsNone(smoke.analysis_ready(screen(), "[SENSEA] Local model ready", 0))

    def test_old_session_marker_cannot_pass_a_restart(self):
        self.assertIsNone(smoke.analysis_ready(screen(), smoke.INFERENCE_MARKER, 1))
        self.assertEqual(smoke.analysis_ready(screen(), smoke.INFERENCE_MARKER + "\n" + smoke.INFERENCE_MARKER, 1), 2)

    def test_current_session_needs_both_live_preview_and_running_analysis(self):
        self.assertEqual(smoke.analysis_ready(screen(), smoke.INFERENCE_MARKER, 0), 1)
        self.assertIsNone(smoke.analysis_ready(screen(analysis="Waiting for a new frame analysis."), smoke.INFERENCE_MARKER, 0))
        self.assertIsNone(smoke.analysis_ready(screen(camera="Camera off"), smoke.INFERENCE_MARKER, 0))

    def test_failure_states_never_pass_even_after_successful_inference(self):
        failures = ["Object analysis stopped. The live camera view will stay on.",
                    "Could not prepare object analysis. The live camera view is still available.",
                    "Object analysis is unavailable. The camera view will stay on.",
                    "Object analysis is not supported on this device."]
        for failure in failures:
            with self.subTest(failure=failure), self.assertRaisesRegex(AssertionError, "Native frame analysis failed"):
                smoke.analysis_ready(screen(analysis=failure), smoke.INFERENCE_MARKER, 0)

    def test_failure_is_detected_before_log_polling(self):
        with patch.object(smoke, "hierarchy", return_value=screen(analysis="Object analysis stopped.")), \
             patch.object(smoke, "adb") as adb:
            with self.assertRaisesRegex(AssertionError, "Native frame analysis failed"):
                smoke.wait_for_analysis(0, "first start")
            adb.assert_not_called()


class DeviceProtectionTests(unittest.TestCase):
    def setUp(self):
        self.old_verified = smoke.EMULATOR_VERIFIED
        self.old_serial = smoke.EMULATOR_SERIAL
        smoke.EMULATOR_VERIFIED = False
        smoke.EMULATOR_SERIAL = None

    def tearDown(self):
        smoke.EMULATOR_VERIFIED = self.old_verified
        smoke.EMULATOR_SERIAL = self.old_serial

    def test_unverified_target_never_has_screen_captured(self):
        with patch.object(smoke, "adb") as adb:
            for capture in (smoke.hierarchy, lambda: smoke.evidence("should-not-exist")):
                with self.assertRaisesRegex(RuntimeError, "before emulator verification"):
                    capture()
            adb.assert_not_called()

    def test_physical_phone_is_rejected_before_install_or_diagnostics(self):
        with patch.object(smoke, "adb", side_effect=["physical-device-serial\n", "0\n"]) as adb, \
             patch.object(smoke, "evidence") as evidence:
            with self.assertRaisesRegex(RuntimeError, "requires an Android emulator"):
                smoke.run()
            self.assertFalse(smoke.EMULATOR_VERIFIED)
            self.assertEqual(adb.call_count, 2)
            evidence.assert_not_called()

    def test_commands_are_pinned_to_verified_target_serial(self):
        smoke.EMULATOR_SERIAL = "emulator-5554"
        with patch.object(smoke.subprocess, "run") as run:
            run.return_value.stdout = b"1\n"
            smoke.adb("shell", "getprop", "ro.kernel.qemu")
            self.assertEqual(run.call_args.args[0], ["adb", "-s", "emulator-5554", "shell", "getprop", "ro.kernel.qemu"])


if __name__ == "__main__":
    unittest.main()
