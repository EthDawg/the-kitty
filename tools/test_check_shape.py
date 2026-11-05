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

    def test_existing_product_sources_and_native_metadata_are_allowed(self):
        self.file("src/style.css", ":root { --background: #faf4eb; }")
        self.file("src/engine.js", "const sharedEngine = { version: 2 };\n")
        self.file("brand/cat/mascot.svg", '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>')
        self.file("ios/Kitty/Assets.xcassets/Contents.json", '{"info":{"version":1}}')
        self.file("ios/Kitty/App.swift", 'let tint = KittyTokens.tint\nlet icon = KittyIcons.offset\n')
        self.file("ARCHITECTURE.md", "One product, two hosts.\n")
        self.check()

    def test_tracked_new_top_level_service_is_rejected(self):
        self.file("service/README.md", tracked=True)
        self.assertIn("service/: new top-level directory", self.check(False))

    def test_untracked_and_empty_new_top_level_directories_are_rejected(self):
        self.file("another-app/App.swift", "let version = 2\n")
        (self.root / "another-empty-app").mkdir()
        message = self.check(False)
        self.assertIn("another-app/", message)
        self.assertIn("another-empty-app/", message)

    def test_ignored_local_build_directories_are_excluded(self):
        self.file(".gitignore", "dist/\nlocal-build/\nios/Kitty/Bundle/\nios/Kitty/GeneratedIcons/\n")
        self.file("dist/kitty.html", "<script>shared()</script>")
        (self.root / "local-build").mkdir()
        self.file("ios/Kitty/Bundle/kitty.html", "<script>shared()</script>")
        self.file("ios/Kitty/GeneratedIcons/icon.png", "generated image")
        self.check()

    def test_a_tracked_asset_is_checked_even_when_ignored_later(self):
        self.file("ios/Kitty/Bundle/kitty.html", "<script>copied()</script>", tracked=True)
        self.file(".gitignore", "ios/Kitty/Bundle/\n")
        self.assertIn("ios/Kitty/Bundle/kitty.html", self.check(False))

    def test_ios_web_sources_are_rejected_without_needing_an_exact_copy(self):
        for name in ("engine.js", "helper.mjs", "page.html", "style.css", "bridge.ts"):
            self.file("ios/Resources/" + name, "different source bytes")
        message = self.check(False)
        for name in ("engine.js", "helper.mjs", "page.html", "style.css", "bridge.ts"):
            self.assertIn(name, message)

    def test_renaming_the_engine_does_not_make_its_copy_native_source(self):
        engine = "const sharedEngine = { project: snapshot => snapshot.entries };\n"
        self.file("src/engine.js", engine, tracked=True)
        self.file("ios/Resources/runtime.data", engine)
        self.assertIn("copied bytes from src/engine.js", self.check(False))

    def test_visual_and_font_assets_under_ios_are_build_outputs_only(self):
        for name in ("mascot.svg", "icon.png", "font.woff2", "App.xcassets/Icon.imageset/icon.pdf"):
            self.file("ios/Kitty/" + name)
        message = self.check(False)
        for name in ("mascot.svg", "icon.png", "font.woff2", "icon.pdf"):
            self.assertIn(name, message)

    def test_renamed_brand_tokens_are_also_caught(self):
        tokens = '{"color":{"background":"#F8F6F1","text":"#253A32"}}\n'
        self.file("brand/tokens.json", tokens)
        self.file("ios/Kitty/copied-tokens.data", tokens)
        self.assertIn("copied bytes from brand/tokens.json", self.check(False))

    def test_swift_color_literals_report_file_and_line(self):
        self.file("ios/Kitty/View.swift", 'import SwiftUI\nlet color = Color(hex: 0xF8F6F1)\nlet text = "#abc"\n')
        message = self.check(False)
        self.assertIn("ios/Kitty/View.swift:2: raw hex color 0xF8F6F1", message)
        self.assertIn("ios/Kitty/View.swift:3: raw hex color #abc", message)

    def test_sf_symbol_initializers_and_label_convenience_are_rejected(self):
        self.file("ios/Kitty/View.swift", 'let a = Image(systemName: "cat")\nlet b = Label("Cat", systemImage: "cat")\n')
        message = self.check(False)
        self.assertIn("systemName:", message)
        self.assertIn("systemImage:", message)

    def test_only_direct_generated_swift_files_have_the_exception(self):
        source = 'let color = Color(hex: 0x112233)\nlet image = Image(systemName: "cat")\n'
        self.file("ios/Kitty/Generated/KittyTokens.swift", source)
        self.check()
        self.file("ios/Other/Generated/Tokens.swift", source)
        self.file("ios/Kitty/Generated/Nested/Tokens.swift", source)
        message = self.check(False)
        self.assertIn("ios/Other/Generated/Tokens.swift", message)
        self.assertIn("ios/Kitty/Generated/Nested/Tokens.swift", message)
        self.assertNotIn("ios/Kitty/Generated/KittyTokens.swift", message)

    def test_comments_and_quoted_api_names_do_not_count_as_symbol_calls(self):
        self.file("ios/Kitty/Notes.swift", '''// Do not write Image(systemName: "cat") or #abc.
/* A nested /* systemName: #112233 */ documentation comment. */
let description = "systemName: is an API label"
let url = "https://example.com/"
let raw = #"systemName: is not a call"#
''')
        self.check()
        self.file("ios/Kitty/Real.swift", 'let url = "https://example.com/"\nlet image = Image(systemName: "cat")\n')
        self.assertIn("ios/Kitty/Real.swift:2:", self.check(False))

    def test_raw_and_multiline_strings_do_not_hide_hex_colors(self):
        self.file("ios/Kitty/View.swift", 'let raw = #"#AABBCC"#\nlet multiline = """\n#11223344\n"""\n')
        message = self.check(False)
        self.assertIn("raw hex color #AABBCC", message)
        self.assertIn("raw hex color #11223344", message)

    def test_symbol_calls_inside_swift_string_interpolation_are_checked(self):
        self.file("ios/Kitty/View.swift", r'''let normal = "Hello \(Image(systemName: "cat"))"
let raw = #"Hello \#(Image(systemName: "dog"))"#
''')
        message = self.check(False)
        self.assertIn("ios/Kitty/View.swift:1: SF Symbol API", message)
        self.assertIn("ios/Kitty/View.swift:2: SF Symbol API", message)

    def test_paths_with_spaces_and_asset_symlinks_are_not_missed(self):
        self.file("brand/icons/cat.svg", '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>')
        self.file("ios/Kitty/Source With Spaces.swift", 'let image = Image(systemName: "cat")\n')
        alias = self.root / "ios" / "Kitty" / "brand-alias.data"
        alias.symlink_to(self.root / "brand" / "icons" / "cat.svg")
        message = self.check(False)
        self.assertIn("Source With Spaces.swift:1:", message)
        self.assertIn("brand-alias.data: source/asset symlinks", message)

    def test_deleted_tracked_copies_do_not_block_their_removal(self):
        path = self.file("ios/Kitty/old-engine.js", "old source", tracked=True)
        path.unlink()
        self.check()

    def test_deleted_new_root_directory_does_not_block_its_removal(self):
        path = self.file("discarded-service/server.py", tracked=True)
        path.unlink()
        path.parent.rmdir()
        self.check()


if __name__ == "__main__":
    unittest.main()
