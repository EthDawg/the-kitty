"""Prepare ignored Xcode resources from the page and the canonical brand sources."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INFO = {"author": "xcode", "version": 1}


def manifest(directory, **contents):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "Contents.json").write_text(json.dumps({**contents, "info": INFO}, indent=2) + "\n")


def color_item(value, dark=False):
    rgb = [int(value[i:i + 2], 16) for i in (1, 3, 5)]
    item = {"idiom": "universal", "color": {"color-space": "srgb", "components": {
        **dict(zip(("red", "green", "blue"), (f"{n / 255:.9f}" for n in rgb))), "alpha": "1.000"}}}
    if dark:
        item["appearances"] = [{"appearance": "luminosity", "value": "dark"}]
    return item


def prepare_assets(root):
    data = json.loads((root / "brand/tokens.json").read_text())
    mascot = data["mascot"]
    if mascot not in ("cat", "dog"):
        raise ValueError("Unknown brand mascot")
    catalog = root / "ios/Kitty/Assets.xcassets"
    manifest(catalog)
    for name, kind in (("AppIcon", mascot), ("KittyAlternate", "dog" if mascot == "cat" else "cat")):
        icons = catalog / (name + ".appiconset")
        manifest(icons, images=[{"filename": "app-icon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}])
        shutil.copyfile(root / "brand" / kind / "app-icon-1024.png", icons / "app-icon.png")
    for name, key in (("KittyLaunchBackground", "bg"), ("KittyTint", "accent")):
        manifest(catalog / (name + ".colorset"), colors=[
            color_item(data["light"][key]), color_item(data["dark"][key], True)])


def main():
    sys.path.insert(0, str(ROOT))
    from build import period_bank_script
    subprocess.run([sys.executable, str(ROOT / "brand/generate_tokens.py"), "--check"], check=True)
    subprocess.run([sys.executable, str(ROOT / "build.py"), "--host", "native"], check=True)
    resources = ROOT / "ios/Kitty/Resources"
    resources.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / "dist/kitty-native.html", resources / "kitty-native.html")
    (resources / "kitty-period-bank.js").write_text(period_bank_script(ROOT), encoding="utf-8")
    prepare_assets(ROOT)
    print("Prepared bundled page, primary/alternate icons, launch colour and tint")


if __name__ == "__main__":
    main()
