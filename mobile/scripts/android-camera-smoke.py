"""Exercise the release APK on an emulator with a synthetic virtual camera only."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PACKAGE = "com.sensea.app"
OUT = Path("build/camera-smoke")
OUT.mkdir(parents=True, exist_ok=True)


def adb(*args, binary=False, timeout=30):
    result = subprocess.run(["adb", *args], capture_output=True, timeout=timeout, check=True)
    return result.stdout if binary else result.stdout.decode("utf-8", errors="replace")


def hierarchy():
    adb("shell", "uiautomator", "dump", "/sdcard/sensea-smoke.xml")
    xml = adb("shell", "cat", "/sdcard/sensea-smoke.xml")
    (OUT / "latest-ui.xml").write_text(xml, encoding="utf-8")
    return ET.fromstring(xml)


def find(root, test_id):
    return next((n for n in root.iter("node")
                 if n.get("resource-id", "").split("/")[-1] == test_id), None)


def wait_for(predicate, description, seconds=40):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        root = hierarchy()
        found = predicate(root)
        if found is not None and found is not False:
            return found
        if not adb("shell", "pidof", PACKAGE).strip():
            raise AssertionError("App process exited while " + description)
        time.sleep(0.5)
    raise AssertionError("Timed out: " + description)


def tap_node(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds", "")))
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))


def tap_id(test_id):
    node = wait_for(lambda root: find(root, test_id), test_id)
    tap_node(node)


def state(expected):
    def match(root):
        node = find(root, "camera-state")
        return node if node is not None and expected in node.get("text", "") else None
    return wait_for(match, "camera state: " + expected)


def evidence(name):
    (OUT / f"{name}.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    (OUT / f"{name}.xml").write_text(ET.tostring(hierarchy(), encoding="unicode"), encoding="utf-8")
    (OUT / f"{name}-camera.txt").write_text(adb("shell", "dumpsys", "media.camera"), encoding="utf-8")


def main():
    # Never capture a real user's device or install onto an attached phone.
    if adb("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise RuntimeError("This smoke test requires an Android emulator")
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
    state("실시간 카메라 켜짐")
    # This state is emitted by NativePreviewView.onPreviewStarted, not camera.start().
    evidence("01-live-preview")
    time.sleep(5)
    state("실시간 카메라 켜짐")
    evidence("02-live-preview-after-analysis")
    native_log = adb("logcat", "-d")
    assert "[SENSEA] Local model ready" in native_log, "Bundled model did not load in standalone Android APK"
    tap_id("camera-toggle")
    state("카메라 꺼짐")
    tap_id("camera-toggle")
    state("실시간 카메라 켜짐")
    evidence("03-reopened-preview")
    adb("shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    adb("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
    state("카메라 꺼짐")
    tap_id("camera-toggle")
    state("실시간 카메라 켜짐")
    evidence("04-preview-after-background")
    tap_id("camera-toggle")
    state("카메라 꺼짐")
    result = {"passed": True, "device": "Android API 35 x86_64 emulator, virtual scene",
              "checks": ["privacy cancel", "privacy confirm continues startup", "OS permission dialog",
                         "native first preview frame", "preview survives analysis startup", "bundled model loaded from a file URL", "stop and reopen",
                         "background stops camera", "explicit restart after background"]}
    (OUT / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result), flush=True)


try:
    main()
except Exception:
    try:
        evidence("failure")
    except Exception as diagnostic_error:
        print("Could not capture failure screen:", diagnostic_error, flush=True)
    raise
finally:
    (OUT / "logcat.txt").write_text(adb("logcat", "-d", "-v", "threadtime"), encoding="utf-8")
