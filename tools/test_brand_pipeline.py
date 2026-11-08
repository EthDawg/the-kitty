"""Exercise the page build after a brand-only change, in an isolated checkout."""
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD = load("kitty_build_for_brand", ROOT / "build.py")
TOKENS = load("kitty_brand_tokens", ROOT / "brand/generate_tokens.py")


class BrandDrill(unittest.TestCase):
    def test_brand_only_change_reaches_the_page(self):
        with tempfile.TemporaryDirectory(prefix="kitty-brand-drill-") as folder:
            root = Path(folder)
            for name in ("src", "brand", "merchants", "data"):
                shutil.copytree(ROOT / name, root / name)
            shutil.copyfile(ROOT / "kitty.config.json", root / "kitty.config.json")
            self.assertEqual(TOKENS.generate(ROOT, check=True), [])
            css_ui = (root / "src/style.css").read_bytes()
            js_ui = (root / "src/app.js").read_bytes()

            def outputs():
                page = BUILD.render(root, v2=True)[0]["kitty-v2.html"]
                return (re.search(r'<symbol id="i-offset".*?</symbol>', page).group(),
                        json.JSONDecoder().raw_decode(page.split("window.KITTY_ART=", 1)[1])[0], page)

            before = outputs()
            source = root / "brand/build_brand.py"
            icon_input = source.read_text().replace('P(HOUSE) + P("M12 11v6', 'P(HOUSE) + P("M12 12v7', 1)
            self.assertNotEqual(icon_input, source.read_text())
            source.write_text(icon_input)
            token_file = root / "brand/tokens.json"
            data = json.loads(token_file.read_text())
            data["light"]["bg"] = "#123456"
            data["mascot"] = "dog" if data["mascot"] == "cat" else "cat"
            token_file.write_text(json.dumps(data))
            subprocess.run([sys.executable, str(source), "--icons-only"], check=True)
            TOKENS.generate(root)
            self.assertEqual(TOKENS.generate(root, check=True), [])
            (old_icon, old_art, old_page), (icon, art, page) = before, outputs()
            self.assertNotIn("--bg: #123456;", old_page)
            self.assertIn("--bg: #123456;", page)
            self.assertNotEqual(icon, old_icon)
            self.assertNotEqual(old_art["allReviewed"], art["allReviewed"])
            self.assertNotEqual(old_art["cookie"], art["cookie"])
            self.assertEqual(art["set"], data["mascot"])
            self.assertEqual(art["allReviewed"], (root / f"brand/illustrations/{art['set']}-all-reviewed.svg").read_text())
            self.assertEqual(js_ui, (root / "src/app.js").read_bytes())
            self.assertEqual(css_ui, (root / "src/style.css").read_bytes())
