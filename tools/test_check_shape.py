"""Behavioral checks against small temporary Git repositories; no product fixtures copied."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CHECKER = Path(__file__).with_name("check_shape.py").resolve()


class RepositoryShapeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "--quiet")

    def git(self, *arguments):
        return subprocess.run(["git", "-C", str(self.root), *arguments],
                              check=True, capture_output=True, text=True)

    def file(self, name, content="fixture\n", tracked=False):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        if tracked:
            self.git("add", "--", name)
        return path

    def check(self, passes=True):
        result = subprocess.run([sys.executable, str(CHECKER), "--root", str(self.root)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if passes else 1, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def test_existing_product_sources_are_allowed(self):
        self.file("src/style.css", ":root { --background: #faf4eb; }")
        self.file("src/engine.js", "const sharedEngine = { version: 2 };\n")
        self.file("brand/cat/mascot.svg", '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>')
        self.file("ARCHITECTURE.md", "One product, one host.\n")
        self.check()

    def test_an_ios_folder_is_a_new_top_level_directory(self):
        self.file("ios/Kitty/App.swift", "let tint = KittyTokens.tint\n")
        self.assertIn("ios/: new top-level directory", self.check(False))

    def test_tracked_new_top_level_service_is_rejected(self):
        self.file("service/README.md", tracked=True)
        self.assertIn("service/: new top-level directory", self.check(False))

    def test_untracked_and_empty_new_top_level_directories_are_rejected(self):
        self.file("another-app/main.py", "version = 2\n")
        (self.root / "another-empty-app").mkdir()
        message = self.check(False)
        self.assertIn("another-app/", message)
        self.assertIn("another-empty-app/", message)

    def test_ignored_local_build_directories_are_excluded(self):
        mascot = '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'
        self.file(".gitignore", "dist/\nlocal-build/\nportals/public/brand/\n")
        self.file("brand/cat/mascot.svg", mascot)
        self.file("dist/kitty.html", "<script>shared()</script>")
        (self.root / "local-build").mkdir()
        self.file("portals/public/brand/mascot.svg", mascot)
        self.check()

    def test_a_tracked_copy_is_checked_even_when_ignored_later(self):
        mascot = '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'
        self.file("brand/cat/mascot.svg", mascot)
        self.file("portals/public/brand/mascot.svg", mascot, tracked=True)
        self.file(".gitignore", "portals/public/brand/\n")
        self.assertIn("portals/public/brand/mascot.svg: copied bytes from brand/cat/mascot.svg", self.check(False))

    def test_a_renamed_copy_of_the_engine_is_rejected(self):
        engine = "const sharedEngine = { project: snapshot => snapshot.entries };\n"
        self.file("src/engine.js", engine, tracked=True)
        self.file("tools/runtime.data", engine)
        self.assertIn("tools/runtime.data: copied bytes from src/engine.js", self.check(False))

    def test_renamed_brand_tokens_are_also_caught(self):
        tokens = '{"color":{"background":"#F8F6F1","text":"#253A32"}}\n'
        self.file("brand/tokens.json", tokens)
        self.file("src/copied-tokens.data", tokens)
        self.assertIn("src/copied-tokens.data: copied bytes from brand/tokens.json", self.check(False))

    def test_identical_drawings_inside_brand_are_not_copies(self):
        drawing = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'
        self.file("brand/icons/cash.svg", drawing)
        self.file("brand/icons/salary.svg", drawing)
        self.check()

    def test_paths_with_spaces_are_not_missed(self):
        icon = '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'
        self.file("brand/icons/cat.svg", icon)
        self.file("docs/Copy With Spaces.svg", icon)
        self.assertIn("docs/Copy With Spaces.svg: copied bytes", self.check(False))

    def test_deleted_tracked_copies_do_not_block_their_removal(self):
        engine = "const sharedEngine = { version: 1 };\n"
        self.file("src/engine.js", engine, tracked=True)
        path = self.file("tools/old-engine.js", engine, tracked=True)
        path.unlink()
        self.check()

    def test_deleted_new_root_directory_does_not_block_its_removal(self):
        path = self.file("discarded-service/server.py", tracked=True)
        path.unlink()
        path.parent.rmdir()
        self.check()


if __name__ == "__main__":
    unittest.main()
