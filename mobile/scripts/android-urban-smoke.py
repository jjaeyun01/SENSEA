"""Check core camera lifecycle plus optional OWL-ViT inference or explicit load deferral.
Run on the owned synthetic-camera emulator: python android-urban-smoke.py app.apk.
This is integration/retained-memory evidence, not recognition accuracy evaluation.
"""
import importlib.util
import json
from pathlib import Path
import re
import time

spec = importlib.util.spec_from_file_location("camera_smoke", Path(__file__).with_name("android-camera-smoke.py"))
camera = importlib.util.module_from_spec(spec)
spec.loader.exec_module(camera)
original_validate = camera.validate_session
sessions = []

def validate(previous, name):
    count = original_validate(previous, name)
    def match(root):
        log = camera.adb("logcat", "-d")
        # A delayed optional model must not pass as successful urban inference.
        budget = re.findall(r"Expanded analysis budget: (ready|waiting)", log)
        if budget and budget[-1] == "waiting":
            return (None, None)
        current = log.rsplit("[SENSEA] Local model ready", 1)[-1]
        ready = re.findall(r"Urban frame analysis ready: (\d+)ms, quality=usable, candidates=(\d+)", current)
        if ready:
            return ready[-1]
        if "Urban status: unavailable" in current or "Urban initialization failed" in current:
            raise AssertionError("Urban native initialization failed")
        return None
    latency, candidates = camera.wait_for(match, name + ": actual urban inference", seconds=45)
    assert latency is None or int(latency) <= 1000
    memory = camera.adb("shell", "dumpsys", "meminfo", camera.PACKAGE)
    (camera.OUT / (name + "-memory.txt")).write_text(memory, encoding="utf-8")
    total = re.search(r"TOTAL PSS:\s*(\d+)", memory)
    if total:
        assert int(total.group(1)) < 4 * 1024 * 1024, "Observed app PSS exceeds 4 GiB"
    root = camera.hierarchy()
    boxes = [n.get("text", "") for n in root.iter("node") if "object-box-" in n.get("resource-id", "")]
    sessions.append({"session": name, "mode": "base_priority" if latency is None else "urban_inference",
                     "first_urban_ms": int(latency) if latency is not None else None,
                     "candidates": int(candidates) if candidates is not None else None,
                     "total_pss_kib": int(total.group(1)) if total else None, "visible_boxes": len(boxes)})
    return count

camera.validate_session = validate
camera.run()
assert len(sessions) == 3
(camera.OUT / "urban-result.json").write_text(json.dumps({"passed": True, "sessions": sessions}, indent=2), encoding="utf-8")
print(json.dumps({"camera_budget_check_passed": True, "urban_inference_sessions": sum(s["mode"] == "urban_inference" for s in sessions), "sessions": sessions}), flush=True)
