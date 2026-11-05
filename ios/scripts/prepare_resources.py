"""Build outputs only. The shared page and brand remain the sources of truth."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
subprocess.run([sys.executable, str(ROOT / "build.py"), "--host", "native"], check=True)
resources = ROOT / "ios" / "Kitty" / "Resources"
resources.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ROOT / "dist" / "kitty-native.html", resources / "kitty-native.html")
catalog = ROOT / "ios" / "Kitty" / "Assets.xcassets"
icons = catalog / "AppIcon.appiconset"
icons.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ROOT / "brand" / "cat" / "app-icon-1024.png", icons / "app-icon.png")
(catalog / "Contents.json").write_text(json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
(icons / "Contents.json").write_text(json.dumps({"images": [{"filename": "app-icon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}], "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")
print("Prepared ignored native page and cat app icon from shared sources")
