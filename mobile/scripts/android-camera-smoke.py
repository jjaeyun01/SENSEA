"""Exercise a release APK on a verified emulator with a synthetic camera only."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = "com.sensea.app"
OUT = Path("build/camera-smoke")
EMULATOR_VERIFIED = False
EMULATOR_SERIAL = None
INFERENCE_MARKER = "[SENSEA] First frame inference ready"
ANALYSIS_RUNNING = "사물 분석 중"
ANALYSIS_FAILURES = ("분석을 중지", "분석을 준비하지 못", "분석을 사용할 수 없", "분석 방식을 지원하지")


def adb(*args, binary=False, timeout=30):
    target = ["-s", EMULATOR_SERIAL] if EMULATOR_SERIAL else []
    result = subprocess.run(["adb", *target, *args], capture_output=True, timeout=timeout, check=True)
    return result.stdout if binary else result.stdout.decode("utf-8", errors="replace")


def hierarchy():
    if not EMULATOR_VERIFIED:
        raise RuntimeError("Refusing to read screen contents before emulator verification")
    adb("shell", "uiautomator", "dump", "/sdcard/sensea-smoke.xml")
    xml = adb("shell", "cat", "/sdcard/sensea-smoke.xml")
    (OUT / "latest-ui.xml").write_text(xml, encoding="utf-8")
    return ET.fromstring(xml)


def find(root, test_id):
    return next((n for n in root.iter("node")
                 if n.get("resource-id", "").split("/")[-1] == test_id), None)


def ui_text(root, test_id):
    node = find(root, test_id)
    return node.get("text", "") if node is not None else "<not present>"


def wait_for(predicate, description, seconds=40):
    deadline = time.monotonic() + seconds
    last_state = "No hierarchy read"
    while time.monotonic() < deadline:
        root = hierarchy()
        last_state = f"camera={ui_text(root, 'camera-state')!r}, analysis={ui_text(root, 'analysis-state')!r}"
        found = predicate(root)
        if found is not None and found is not False:
            return found
        try:
            process = adb("shell", "pidof", PACKAGE).strip()
        except subprocess.CalledProcessError as error:
            raise AssertionError("App process exited while " + description) from error
        if not process:
            raise AssertionError("App process exited while " + description)
        time.sleep(0.5)
    raise AssertionError(f"Timed out: {description}. Last UI: {last_state}")


def tap_node(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds", "")))
    assert x2 > x1 and y2 > y1, "Cannot tap a node with empty bounds"
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))


def tap_id(test_id):
    node = wait_for(lambda root: find(root, test_id), test_id)
    tap_node(node)


def state(expected):
    def match(root):
        node = find(root, "camera-state")
        return node if node is not None and expected in node.get("text", "") else None
    return wait_for(match, "camera state: " + expected)


def inference_count(log):
    # Emitted once per session only after fresh, usable model inference and decoding.
    return sum(INFERENCE_MARKER in line for line in log.splitlines())


def assert_analysis_not_failed(root):
    status = ui_text(root, "analysis-state")
    if any(failure in status for failure in ANALYSIS_FAILURES):
        raise AssertionError("Native frame analysis failed: " + status)


def analysis_ready(root, log, previous_count):
    assert_analysis_not_failed(root)
    count = inference_count(log)
    if (count > previous_count
            and ui_text(root, "analysis-state") == ANALYSIS_RUNNING
            and "실시간 카메라 켜짐" in ui_text(root, "camera-state")):
        return count
    return None


def wait_for_analysis(previous_count, description):
    def match(root):
        assert_analysis_not_failed(root)
        return analysis_ready(root, adb("logcat", "-d"), previous_count)
    return wait_for(match, description + ": fresh native inference and live analysis", seconds=60)


def evidence(name):
    if not EMULATOR_VERIFIED:
        raise RuntimeError("Refusing to capture evidence before emulator verification")
    (OUT / f"{name}.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    (OUT / f"{name}.xml").write_text(ET.tostring(hierarchy(), encoding="unicode"), encoding="utf-8")
    (OUT / f"{name}-camera.txt").write_text(adb("shell", "dumpsys", "media.camera"), encoding="utf-8")


def validate_session(previous_count, name):
    state("실시간 카메라 켜짐")
    # This state is emitted by NativePreviewView.onPreviewStarted, not camera.start().
    count = wait_for_analysis(previous_count, name)
    evidence(name + "-inference")
    # The app expires stale results after one second. Requiring the running state
    # again after five seconds catches streams that deliver just one usable frame.
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        root = hierarchy()
        assert_analysis_not_failed(root)
        assert "실시간 카메라 켜짐" in ui_text(root, "camera-state"), "Preview stopped during analysis"
        time.sleep(0.5)
    wait_for_analysis(previous_count, name + " sustained stream")
    evidence(name + "-sustained")
    return count


def main():
    global EMULATOR_VERIFIED, EMULATOR_SERIAL
    # Pin every command to the same target before checking it. Never capture a
    # real user's device or install onto an attached phone, even on failure.
    EMULATOR_SERIAL = adb("get-serialno").strip()
    if not EMULATOR_SERIAL or EMULATOR_SERIAL == "unknown":
        raise RuntimeError("No unambiguous Android device is available")
    if adb("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise RuntimeError("This smoke test requires an Android emulator")
    EMULATOR_VERIFIED = True
    OUT.mkdir(parents=True, exist_ok=True)
    adb("install", "-r", sys.argv[1], timeout=120)
    adb("shell", "pm", "clear", PACKAGE)
    adb("logcat", "-c")
    adb("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    tap_id("camera-toggle")
    tap_id("notice-close")
    state("카메라 꺼짐")
    permission = adb("shell", "dumpsys", "package", PACKAGE)
    assert "android.permission.CAMERA: granted=true" not in permission, "Cancel requested camera access"
    tap_id("camera-toggle")
    tap_id("privacy-start")

    def permission_button(root):
        for node in root.iter("node"):
            rid = node.get("resource-id", "")
            if rid.endswith("/permission_allow_foreground_only_button") or rid.endswith("/permission_allow_button"):
                return node
        return None
    tap_node(wait_for(permission_button, "OS camera permission dialog"))
    count = validate_session(0, "01-initial-camera")
    native_log = adb("logcat", "-d")
    assert "[SENSEA] Local model ready" in native_log, "Bundled model did not load in standalone Android APK"
    tap_id("camera-toggle")
    state("카메라 꺼짐")
    # A prior session's successful inference must never satisfy a restart check.
    previous_count = inference_count(adb("logcat", "-d"))
    tap_id("camera-toggle")
    count = validate_session(previous_count, "02-reopened-camera")
    adb("shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    adb("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    state("카메라 꺼짐")
    previous_count = inference_count(adb("logcat", "-d"))
    tap_id("camera-toggle")
    count = validate_session(previous_count, "03-camera-after-background")
    tap_id("camera-toggle")
    state("카메라 꺼짐")
    result = {"passed": True, "device": "Android emulator with synthetic camera", "serial": EMULATOR_SERIAL,
              "inference_sessions": count,
              "checks": ["privacy cancel", "privacy confirm continues startup", "OS permission dialog",
                         "native first preview frame", "bundled model loaded from a file URL",
                         "fresh model inference and decoded usable result in every session",
                         "analysis remains active after five seconds", "stop and reopen with fresh inference",
                         "background stops camera", "explicit restart after background with fresh inference"]}
    (OUT / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False), flush=True)


def run():
    try:
        main()
    except Exception as error:
        if EMULATOR_VERIFIED:
            (OUT / "result.json").write_text(json.dumps({"passed": False, "error": str(error)}, indent=2,
                                                       ensure_ascii=False), encoding="utf-8")
            try:
                evidence("failure")
            except Exception as diagnostic_error:
                print("Could not capture failure screen:", diagnostic_error, flush=True)
        raise
    finally:
        if EMULATOR_VERIFIED:
            try:
                (OUT / "logcat.txt").write_text(adb("logcat", "-d", "-v", "threadtime"), encoding="utf-8")
            except Exception as diagnostic_error:
                print("Could not capture logcat:", diagnostic_error, flush=True)


if __name__ == "__main__":
    run()
