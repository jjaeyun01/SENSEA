"""Inspect built packages; permission removal directives alone are not evidence."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import zipfile

platform, target = sys.argv[1:]
config = json.loads(Path("app.json").read_text())["expo"]
manifest = json.loads(Path("assets/models/manifest.json").read_text())

if platform == "android":
    sdk = Path(os.environ.get("ANDROID_HOME") or os.environ["ANDROID_SDK_ROOT"])
    analyzer = sdk / "cmdline-tools/latest/bin/apkanalyzer"
    permissions = subprocess.check_output(
        [str(analyzer), "manifest", "permissions", target], text=True,
    )
    declared = set(permissions.split())
    assert "android.permission.CAMERA" in declared, permissions
    assert not declared.intersection(config["android"]["blockedPermissions"]), permissions
    with zipfile.ZipFile(target) as package:
        assert "assets/index.android.bundle" in package.namelist()
        models = [name for name in package.namelist() if name.endswith(".tflite")]
        assert len(models) == 1, models
        assert hashlib.sha256(package.read(models[0])).hexdigest() == manifest["sha256"]
    print("Merged APK permissions and bundled model verified.")
elif platform == "ios":
    app = Path(target)
    info = plistlib.loads((app / "Info.plist").read_bytes())
    assert info.get("NSCameraUsageDescription")
    assert info.get("NSMicrophoneUsageDescription")
    assert info.get("NSSpeechRecognitionUsageDescription")
    assert info.get("NSLocationWhenInUseUsageDescription")
    forbidden = [key for key in info if key.startswith((
        "NSLocationAlways", "NSPhotoLibrary",
    ))]
    assert not forbidden, forbidden
    assert (app / "main.jsbundle").is_file()
    print("iPhone camera, speech and foreground-location purposes verified; no background location/photo access.")
else:
    raise SystemExit("Expected android or ios")
