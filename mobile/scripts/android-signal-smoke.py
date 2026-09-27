"""Verify a known pedestrian countdown photo through the installed Android APK.
Run after installing the target build on an owned emulator configured with a
synthetic signal photo. The expected number is a fixture value, not injected into
the app. Never use a physical phone or a real camera.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re

spec=importlib.util.spec_from_file_location("camera",Path(__file__).with_name("android-camera-smoke.py"))
camera=importlib.util.module_from_spec(spec);spec.loader.exec_module(camera)
args=argparse.ArgumentParser();args.add_argument("--expected-seconds",type=int,required=True);options=args.parse_args()
assert 0<=options.expected_seconds<10, "Use a short-countdown fixture"
camera.EMULATOR_SERIAL=camera.adb("get-serialno").strip()
assert camera.EMULATOR_SERIAL and camera.adb("shell","getprop","ro.kernel.qemu").strip()=="1", "Owned emulator required"
camera.EMULATOR_VERIFIED=True
camera.OUT=Path("build/signal-smoke");camera.OUT.mkdir(parents=True,exist_ok=True)
try:
 camera.adb("shell","am","force-stop",camera.PACKAGE)
 camera.adb("logcat","-c")
 camera.adb("shell","am","start","-n",camera.PACKAGE+"/.MainActivity")
 camera.tap_id("camera-toggle");camera.tap_id("privacy-start")
 camera.state("Live camera on")
 camera.wait_for_analysis(0,"signal camera start")
 camera.evidence("01-signal-preview")
 # Deliberately do not touch situation controls: the default is automatic.
 # Scroll to observe the panel, without pressing any signal/mode controls.
 for _ in range(18):
  root=camera.hierarchy();node=camera.find(root,"crossing-guidance")
  if node is not None:
   bounds=list(map(int,re.findall(r"\d+",node.get("bounds",""))))
   if len(bounds)==4 and bounds[2]>bounds[0] and bounds[3]>bounds[1]:break
  camera.adb("shell","input","swipe","350","1340","350","1050","300")
 def check(root):
  log=camera.adb("logcat","-d")
  if "Frame processing deadline exceeded" in log:raise AssertionError("Base frame processing deadline exceeded")
  text=camera.ui_text(root,"crossing-guidance")
  unit="second" if options.expected_seconds==1 else "seconds"
  expected=f"The signal shows {options.expected_seconds} {unit}."
  if expected in text and "If you have not started crossing, wait for the next WALK signal." in text:
   assert "Signal crop OCR ready:" in log
   if "[SENSEA] Automatic signal guidance: short_countdown" not in log:return None
   return text
  return None
 text=camera.wait_for(check,"actual repeated countdown OCR and waiting guidance",seconds=45)
 camera.evidence("02-countdown-guidance")
 log=camera.adb("logcat","-d")
 report={"passed":True,"expected_seconds":options.expected_seconds,"guidance":text,
         "focused_inference_observed":"Signal focus analysis ready:" in log,
         "crop_ocr_observed":"Signal crop OCR ready:" in log,
         "automatic_guidance_without_mode_taps":True,
         "scope":"Single photo through emulator camera; not real-world recognition accuracy"}
 (camera.OUT/"result.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
 print(json.dumps(report),flush=True)
except Exception as error:
 (camera.OUT/"result.json").write_text(json.dumps({"passed":False,"error":str(error)},indent=2),encoding="utf-8")
 camera.evidence("failure")
 raise
finally:
 (camera.OUT/"logcat.txt").write_text(camera.adb("logcat","-d","-v","threadtime"),encoding="utf-8")
 camera.adb("shell","am","force-stop",camera.PACKAGE)
