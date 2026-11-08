"""Offline bundle contract checks; no browser, provider or native app is launched.

Temporary host stubs isolate bundling from the separately tested native bridge.
Run with: python3 -m unittest discover -s tools -p test_native_build.py
"""
import base64
import hashlib
from html.parser import HTMLParser
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
SPEC = importlib.util.spec_from_file_location('kitty_build', ROOT / 'build.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.tags, self.scripts, self.styles = [], [], []
        self.current = None
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if tag in ('script', 'style'):
            self.current = [tag, attrs, '']

    def handle_data(self, data):
        if self.current:
            self.current[2] += data

    def handle_endtag(self, tag):
        if self.current and self.current[0] == tag:
            (self.scripts if tag == 'script' else self.styles).append((self.current[1], self.current[2]))
            self.current = None


class NativeBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='kitty-native-build-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ('src', 'merchants'):
            shutil.copytree(ROOT / directory, self.root / directory)
        for relative in ('brand/fonts', 'brand/icons', 'brand/motion', 'brand/illustrations'):
            shutil.copytree(ROOT / relative, self.root / relative)
        shutil.copyfile(ROOT / 'brand/tokens.json', self.root / 'brand/tokens.json')
        (self.root / 'data').mkdir()
        for filename in ('snapshot.json', 'snapshot-v2.json'):
            shutil.copyfile(ROOT / 'data' / filename, self.root / 'data' / filename)
        shutil.copyfile(ROOT / 'kitty.config.json', self.root / 'kitty.config.json')
        hosts = self.root / 'src/hosts'
        hosts.mkdir(exist_ok=True)
        (hosts / 'native.js').write_text('window.KittyNative={};window.claude={use:async()=>null};\n')
        (hosts / 'native.css').write_text('html[data-kitty-native]{--native-build-test:1}\n')

    def native(self):
        return BUILD.render(self.root, host='native')[0]['kitty-native.html']

    def manifest(self):
        return json.loads((self.root / 'src/vendor/manifest.json').read_text())

    def save_manifest(self, manifest):
        (self.root / 'src/vendor/manifest.json').write_text(json.dumps(manifest))

    def test_deterministic_complete_v2_document_and_csp(self):
        first, report = BUILD.render(self.root, host='native')
        second, _ = BUILD.render(self.root, host='native', v2=True)
        self.assertEqual(first, second)
        self.assertEqual(list(first), ['kitty-native.html'])
        page = first['kitty-native.html']
        self.assertTrue(page.startswith('<!doctype html>'))
        self.assertTrue(page.endswith('</body></html>'))
        doc = Document(page)
        for tag in ('html', 'head', 'body'):
            self.assertEqual(sum(t == tag for t, _ in doc.tags), 1)
        meta = [a for t, a in doc.tags if t == 'meta']
        self.assertIn({'http-equiv': 'Content-Security-Policy', 'content': BUILD.NATIVE_CSP}, meta)
        self.assertIn({'name': 'viewport', 'content': 'width=device-width,initial-scale=1,viewport-fit=cover'}, meta)
        self.assertLess(page.index('Content-Security-Policy'), page.index('<style>'))
        self.assertIn('snapshot-v2.json bundled', report)
        snapshot = json.loads((self.root / 'data/snapshot-v2.json').read_text())
        self.assertIn('window.KITTY_SNAPSHOT=' + BUILD.js(snapshot) + ';', page)

    def test_every_runtime_resource_is_inline_but_text_links_survive(self):
        page = self.native()
        doc = Document(page)
        self.assertFalse(any(tag == 'link' for tag, _ in doc.tags))
        self.assertFalse(any('src' in attrs for attrs, _ in doc.scripts))
        for _, css in doc.styles:
            self.assertNotIn('@import', css)
            for url in re.findall(r'url\(([^)]+)\)', css):
                self.assertTrue(url.strip('\"\' ').startswith(('data:', '#')), url[:80])
        self.assertIn('https://github.com/EthDawg/the-kitty', page)
        self.assertIn("connect-src &#x27;none&#x27;", page)

    def test_publisher_script_bytes_order_and_shared_code_are_preserved(self):
        page = self.native()
        doc = Document(page)
        by_source = {attrs.get('data-kitty-source'): source for attrs, source in doc.scripts if attrs.get('data-kitty-source')}
        order = [attrs['data-kitty-source'] for attrs, _ in doc.scripts if attrs.get('data-kitty-source')]
        self.assertEqual(order, ['d3', 'd3-sankey', 'canvas-confetti', 'qrcode-generator', 'gridstack', 'native-host'])
        for asset in self.manifest()['assets']:
            if asset['kind'] == 'script':
                self.assertEqual(by_source[asset['id']], (self.root / asset['path']).read_text() + '\n')
        bodies = [text for _, text in doc.scripts]
        for relative in ('src/engine.js', 'src/app.js', 'brand/motion/motion.js'):
            self.assertIn((self.root / relative).read_text(), bodies)
        kit = '\n'.join(p.read_text() for p in sorted((self.root / 'src/kit').glob('*.js')) if not p.name.endswith('.test.js'))
        self.assertIn(kit, bodies)
        self.assertLess(page.index('data-kitty-source="native-host"'), page.index((self.root / 'src/app.js').read_text()))
        self.assertGreater(page.index('--native-build-test'), page.index('.erow'))

    def test_all_classic_scripts_parse_without_executing_the_app(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node is required for the inline JavaScript parsing check')
        scripts = [source for attrs, source in Document(self.native()).scripts if attrs.get('type') != 'application/json']
        check = "const vm=require('node:vm'),fs=require('node:fs');JSON.parse(fs.readFileSync(0,'utf8')).forEach((s,i)=>new vm.Script(s,{filename:'inline-'+i+'.js'}));"
        result = subprocess.run([node, '-e', check], input=json.dumps(scripts), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_original_font_bytes_and_current_brand_weights_are_embedded(self):
        page = self.native()
        encoded = re.findall(r'url\(data:font/ttf;base64,([A-Za-z0-9+/=]+)\)', page)
        fonts = [asset for asset in self.manifest()['assets'] if asset['kind'] == 'font']
        self.assertEqual(len(encoded), 2)
        for asset, data in zip(fonts, encoded):
            decoded = base64.b64decode(data, validate=True)
            self.assertEqual(hashlib.sha256(decoded).hexdigest(), asset['sha256'])
            self.assertEqual(decoded, (self.root / asset['path']).read_bytes())
            self.assertIn('font-family:' + json.dumps(asset['family']) + ';font-style:normal;font-weight:' + asset['weight'], page)

    def test_all_license_and_notice_text_is_bundled(self):
        doc = Document(self.native())
        body = next(source for attrs, source in doc.scripts if attrs.get('id') == 'kitty-third-party-notices')
        notices = json.loads(body)
        expected = [asset for asset in self.manifest()['assets'] if asset['kind'] in ('license', 'notice')]
        self.assertEqual(len(notices), len(expected))
        for item, asset in zip(notices, expected):
            self.assertEqual(item['text'], (self.root / asset['path']).read_bytes().decode('utf-8'))

    def test_native_never_embeds_household_logos(self):
        before = self.native()
        directory = self.root / 'logos'
        directory.mkdir()
        logo = b'<svg>HOUSEHOLD-PRIVATE-LOGO-SENTINEL</svg>'
        (directory / 'private.svg').write_bytes(logo)
        self.assertEqual(self.native(), before)
        self.assertIn('window.KITTY_LOGOS={};', before)
        artifact = BUILD.render(self.root, v2=True)[0]['kitty-v2.html']
        self.assertIn(base64.b64encode(logo).decode(), artifact)

    def test_native_rejects_no_snapshot_and_nonfictional_or_v1_snapshot(self):
        with self.assertRaisesRegex(BUILD.BuildError, '--no-snapshot'):
            BUILD.render(self.root, host='native', no_snapshot=True)
        path = self.root / 'data/snapshot-v2.json'
        original = json.loads(path.read_text())
        for change in ('household', 'version'):
            snapshot = json.loads(json.dumps(original))
            if change == 'household':
                snapshot['household'] = 'Another household'
            else:
                next(row for row in snapshot['kitty'] if row['key'] == 'sheet_version')['value'] = 1
            path.write_text(json.dumps(snapshot))
            with self.assertRaisesRegex(BUILD.BuildError, 'fictional Davies sheet_version 2'):
                self.native()

    def test_cli_rejects_no_snapshot_without_creating_an_output(self):
        shutil.copyfile(ROOT / 'build.py', self.root / 'build.py')
        result = subprocess.run([sys.executable, str(self.root / 'build.py'), '--host', 'native', '--no-snapshot'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--no-snapshot', result.stderr)
        self.assertFalse((self.root / 'dist').exists())

    def test_missing_or_changed_pinned_inputs_fail_loudly(self):
        assets = self.manifest()['assets']
        for kind in ('script', 'style', 'font', 'license', 'notice'):
            asset = next(a for a in assets if a['kind'] == kind)
            path = self.root / asset['path']
            original = path.read_bytes()
            with self.subTest(kind=kind, failure='missing'):
                path.unlink()
                with self.assertRaisesRegex(BUILD.BuildError, 'Missing native dependency'):
                    self.native()
            with self.subTest(kind=kind, failure='changed'):
                path.write_bytes(original + b'\nchanged')
                with self.assertRaisesRegex(BUILD.BuildError, 'hash mismatch'):
                    self.native()
            path.write_bytes(original)

    def test_missing_host_code_or_style_is_not_silently_ignored(self):
        for filename in ('native.js', 'native.css'):
            path = self.root / 'src/hosts' / filename
            original = path.read_bytes()
            path.unlink()
            with self.subTest(filename=filename), self.assertRaises(FileNotFoundError):
                self.native()
            path.write_bytes(original)

    def test_manifest_cannot_skip_css_fonts_or_licenses(self):
        original = self.manifest()
        for kind in ('style', 'font', 'license'):
            manifest = json.loads(json.dumps(original))
            manifest['assets'].remove(next(a for a in manifest['assets'] if a['kind'] == kind))
            self.save_manifest(manifest)
            with self.subTest(kind=kind), self.assertRaises(BUILD.BuildError):
                self.native()

    def test_dependency_cannot_escape_allowed_folders(self):
        manifest = self.manifest()
        manifest['assets'][0]['path'] = '../outside.js'
        self.save_manifest(manifest)
        with self.assertRaisesRegex(BUILD.BuildError, 'escapes repository'):
            self.native()

    def test_new_remote_script_or_css_dependency_is_rejected(self):
        shell_path = self.root / 'src/shell.html'
        shell = shell_path.read_text()
        shell_path.write_text(shell + '<script src="https://example.invalid/new.js"></script>')
        with self.assertRaisesRegex(BUILD.BuildError, 'not inlined'):
            self.native()
        shell_path.write_text(shell)
        css = self.root / 'src/hosts/native.css'
        for extra in ('@import "https://example.invalid/font.css";', 'body{background:url(https://example.invalid/image.png)}'):
            css.write_text(extra)
            with self.subTest(css=extra), self.assertRaises(BUILD.BuildError):
                self.native()

    def test_inline_script_terminator_is_rejected_not_rewritten(self):
        (self.root / 'src/hosts/native.js').write_text('const broken="</script>";')
        with self.assertRaisesRegex(BUILD.BuildError, 'Unsafe inline script terminator'):
            self.native()

    def test_artifact_build_does_not_depend_on_native_assets(self):
        before = BUILD.render(self.root, v2=True)
        shutil.rmtree(self.root / 'src/hosts')
        shutil.rmtree(self.root / 'brand/fonts')
        (self.root / 'src/vendor/manifest.json').unlink()
        after = BUILD.render(self.root, v2=True)
        self.assertEqual(before, after)
        self.assertEqual(set(after[0]), {'kitty-v2.html', 'local-v2.html', 'kit.html'})
        self.assertIn('<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>', after[0]['kitty-v2.html'])
        self.assertNotIn('Content-Security-Policy', after[0]['kitty-v2.html'])


if __name__ == '__main__':
    unittest.main()
