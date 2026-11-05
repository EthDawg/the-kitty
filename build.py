"""Bundle the shared Kitty page; no dependencies are downloaded during a build.

    python3 build.py                 # original artifact build, with the fictional v1 snapshot
    python3 build.py --no-snapshot   # original artifact build, without bundled data
    python3 build.py --v2            # published v2 artifact and local/component previews
    python3 build.py --host native   # dist/kitty-native.html: complete, offline v2 demo document

Native dependencies and licenses are pinned in src/vendor/manifest.json. The native
output uses the same app, engine, kit and brand inputs, with src/hosts/native.js and
native.css supplying the host boundary. It never embeds a household's logos/ folder.
"""
import argparse
import base64
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys


NATIVE_CSP = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    "img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; "
    "base-uri 'none'; form-action 'none'"
)
SKELETON = (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" '
    'content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}'
    'body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
)


class BuildError(ValueError):
    pass


def js(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise BuildError('Expected exactly one shell dependency/placeholder: ' + old[:120])
    return text.replace(old, new)


def inline_script(source, label):
    # Keep JavaScript bytes unchanged; an HTML end tag would truncate even a JS string.
    if re.search(r'</script\b', source, re.IGNORECASE):
        raise BuildError('Unsafe inline script terminator in ' + label)
    return '<script data-kitty-source="' + html.escape(label, quote=True) + '">' + source + '\n</script>'


def native_assets(root):
    manifest = json.loads((root / 'src/vendor/manifest.json').read_text(encoding='utf-8'))
    if manifest.get('schema') != 1 or not isinstance(manifest.get('assets'), list):
        raise BuildError('Unsupported native dependency manifest')
    seen_ids, seen_paths, assets = set(), set(), []
    for item in manifest['assets']:
        if not isinstance(item, dict):
            raise BuildError('Invalid native dependency entry')
        asset_id, relative = item.get('id'), item.get('path')
        if not isinstance(asset_id, str) or not asset_id or asset_id in seen_ids:
            raise BuildError('Missing or duplicate native dependency ID')
        if not isinstance(relative, str) or relative in seen_paths:
            raise BuildError('Missing or duplicate native dependency path')
        if item.get('kind') not in ('script', 'style', 'font', 'license', 'notice'):
            raise BuildError('Unknown native dependency kind: ' + asset_id)
        path = (root / relative).resolve()
        try:
            resolved_relative = path.relative_to(root.resolve()).as_posix()
        except ValueError as error:
            raise BuildError('Dependency path escapes repository: ' + relative) from error
        allowed = ('src/vendor/', 'brand/fonts/')
        if not relative.startswith(allowed) or not resolved_relative.startswith(allowed) or '..' in Path(relative).parts:
            raise BuildError('Dependency is outside the vendor/font folders: ' + relative)
        if not path.is_file():
            raise BuildError('Missing native dependency: ' + relative)
        data = path.read_bytes()
        if not re.fullmatch(r'[0-9a-f]{64}', str(item.get('sha256', ''))) or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise BuildError('Native dependency hash mismatch: ' + relative)
        seen_ids.add(asset_id)
        seen_paths.add(relative)
        assets.append((item, data))
    kinds = {item['id']: item['kind'] for item, _ in assets}
    for item, _ in assets:
        if item['kind'] in ('script', 'style', 'font', 'notice') and kinds.get(item.get('licenseId')) != 'license':
            raise BuildError('Missing pinned license for ' + item['id'])
    if {item['path'] for item, _ in assets if item['kind'] == 'style'} != {'src/vendor/gridstack-14.0.0.min.css'}:
        raise BuildError('The native GridStack stylesheet must be pinned')
    if {(item.get('family'), item.get('weight')) for item, _ in assets if item['kind'] == 'font'} != {
            ('Bricolage Grotesque', '500 800'), ('DM Sans', '400 700')}:
        raise BuildError('The native brand requires both pinned font families')
    return manifest, assets


class NativeAssetAudit(HTMLParser):
    """Check resource positions, not text links or URLs inside source comments."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.style = False
        self.styles = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'script' and 'src' in attributes:
            raise BuildError('Native script was not inlined')
        if tag == 'link':
            raise BuildError('Native page still contains an external resource link')
        if tag in ('iframe', 'frame', 'object', 'embed', 'base'):
            raise BuildError('Unsupported native resource element: ' + tag)
        for key in ('src', 'poster', 'srcset', 'xlink:href', 'href'):
            if key not in attributes or (tag == 'a' and key == 'href'):
                continue
            value = attributes[key] or ''
            if value and not value.startswith(('data:', '#')):
                raise BuildError('Native page has a non-inline resource: ' + value[:100])
        if 'style' in attributes:
            self.styles.append(attributes['style'])
        if tag == 'style':
            self.style = True

    def handle_endtag(self, tag):
        if tag == 'style':
            self.style = False

    def handle_data(self, data):
        if self.style:
            self.styles.append(data)

    def finish(self):
        for css in self.styles:
            if re.search(r'@import\b', css, re.IGNORECASE):
                raise BuildError('Native CSS may not import a stylesheet')
            for match in re.finditer(r'url\(\s*([\'"]?)(.*?)\1\s*\)', css, re.IGNORECASE | re.DOTALL):
                if not match.group(2).strip().startswith(('data:', '#')):
                    raise BuildError('Native CSS has a non-inline resource')


def native_shell(root, shell):
    manifest, assets = native_assets(root)
    fonts, notices = [], []
    for item, data in assets:
        kind = item['kind']
        if kind == 'script':
            shell = replace_once(shell, '<script src="' + item['shellURL'] + '"></script>',
                                 inline_script(data.decode('utf-8'), item['id']))
        elif kind == 'font':
            if item.get('format') != 'truetype' or item.get('mimeType') != 'font/ttf':
                raise BuildError('Unsupported pinned font format: ' + item['id'])
            if not re.fullmatch(r'[1-9]00 [1-9]00', item.get('weight', '')):
                raise BuildError('Invalid pinned font weights: ' + item['id'])
            fonts.append('@font-face{font-family:' + json.dumps(item['family']) + ';font-style:normal;'
                         'font-weight:' + item['weight'] + ';font-display:swap;src:url(data:font/ttf;base64,'
                         + base64.b64encode(data).decode('ascii') + ') format("truetype")}')
        elif kind in ('license', 'notice'):
            notices.append({'name': item.get('name', item['id']), 'text': data.decode('utf-8')})
    shell = replace_once(shell, '<link rel="preconnect" href="https://fonts.googleapis.com">', '')
    shell = replace_once(shell, '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>', '')
    shell = replace_once(shell, '<link rel="stylesheet" href="' + manifest['fontStylesheet'] + '">', '')
    # Both are required inputs, including before the first native app build.
    shim = (root / 'src/hosts/native.js').read_text(encoding='utf-8')
    host_css = (root / 'src/hosts/native.css').read_text(encoding='utf-8')
    shell = replace_once(shell, '<script>/*APP*/</script>',
                         inline_script(shim, 'native-host') + '\n<script>/*APP*/</script>')
    return shell, '\n'.join(fonts), host_css, notices


PERIOD_BANK_MODULES = ('period-text', 'period-adapters', 'period-writeplan', 'period-plan', 'period-core', 'period-bank')


def period_bank_script(root):
    """Byte-identical shared modules for native JavaScriptCore, with no page or network dependencies."""
    return '\n'.join((Path(root) / 'src/core' / (name + '.js')).read_text(encoding='utf-8')
                     for name in ('import', *PERIOD_BANK_MODULES))


def render(root, host='artifact', v2=False, no_snapshot=False):
    root = Path(root)
    if host not in ('artifact', 'native'):
        raise BuildError('Unknown host: ' + str(host))
    native = host == 'native'
    if native and no_snapshot:
        raise BuildError('--host native requires the bundled fictional snapshot; --no-snapshot is not allowed')
    v2 = v2 or native
    src, brand = root / 'src', root / 'brand'
    read = lambda *parts: Path(*parts).read_text(encoding='utf-8')
    config = json.loads(read(root, 'kitty.config.json'))
    sources = json.loads(read(src, 'data-sources.json'))
    snapshot_file = 'snapshot-v2.json' if v2 else 'snapshot.json'
    snapshot = None if no_snapshot else json.loads(read(root, 'data', snapshot_file))
    if native:
        versions = [str(row.get('value')) for row in snapshot.get('kitty', []) if row.get('key') == 'sheet_version']
        if versions != ['2'] or snapshot.get('household') != 'Davies household (fictional)':
            raise BuildError('Native demo requires the fictional Davies sheet_version 2 snapshot')
    sheet_id = config['v2_sheet'] if v2 else config['demo_sheet']
    sprite = read(brand, 'icons', 'sprite.svg')
    symbols = sprite[sprite.index('<symbol'):sprite.rindex('</symbol>') + len('</symbol>')]
    merchants = {'merchants': json.loads(read(root, 'merchants', 'merchants.json')),
                 'categories': json.loads(read(root, 'merchants', 'categories.json'))}
    mascot = json.loads(read(brand, 'tokens.json'))['mascot']
    if mascot not in ('cat', 'dog'):
        raise BuildError('Unknown brand mascot')
    art = {'set': mascot, 'cookie': read(brand, 'motion', 'fortune-cookie.svg' if mascot == 'cat' else 'biscuit.svg'),
           'allReviewed': read(brand, 'illustrations', mascot + '-all-reviewed.svg'),
           'emptyActivity': read(brand, 'illustrations', mascot + '-empty-activity.svg')}
    logos = {}
    logo_dir = root / 'logos'
    if not native and logo_dir.is_dir():
        for file in sorted(logo_dir.iterdir()):
            if file.suffix.lower() in ('.svg', '.png'):
                mime = 'image/svg+xml' if file.suffix.lower() == '.svg' else 'image/png'
                logos[file.stem] = f'data:{mime};base64,' + base64.b64encode(file.read_bytes()).decode()
    kit = '\n'.join(file.read_text(encoding='utf-8') for file in sorted((src / 'kit').iterdir()) if file.suffix == '.js')
    # Keep the importer byte-for-byte identical to the code exercised in Node.
    core = '\n'.join(read(src, 'core', name + '.js') for name in ('sheet-contract', 'import', 'records', 'close', *PERIOD_BANK_MODULES))
    shell = read(src, 'shell.html')
    font_css, host_css, notices = '', '', []
    if native:
        shell, font_css, host_css, notices = native_shell(root, shell)
    sprite_start = shell.index('<svg width="0" height="0"')
    sprite_end = shell.index('</svg>', sprite_start) + len('</svg>')
    shell = shell[:sprite_start] + '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' + symbols + '</defs></svg>' + shell[sprite_end:]
    styles = read(src, 'vendor', 'gridstack-14.0.0.min.css') + '\n' + read(src, 'tokens.css') + '\n' + read(src, 'style.css') + '\n' + read(brand, 'motion', 'motion.css')
    if native:
        styles = font_css + '\n' + styles + '\n' + host_css
    page = (shell
            .replace('/*STYLE*/', styles)
            .replace('/*SOURCES*/', 'window.KITTY_SOURCES=' + js(sources) + ';window.KITTY_MERCHANTS=' + js(merchants) + ';window.KITTY_ART=' + js(art) + ';window.KITTY_LOGOS=' + js(logos) + ';')
            .replace('/*SNAPSHOT*/', 'window.KITTY_SNAPSHOT=' + js(snapshot) + ';window.KITTY_PAGE_URL=' + js(config['page_url']) + ';window.KITTY_SHEET=' + js(sheet_id) + ';')
            .replace('/*MOTION*/', read(brand, 'motion', 'motion.js'))
            .replace('/*ENGINE*/', read(src, 'engine.js'))
            .replace('/*IMPORT_CORE*/', core)
            .replace('/*KIT*/', kit)
            .replace('/*APP*/', read(src, 'app.js')))
    if native:
        head, separator, body = page.partition('<header ')
        if not separator:
            raise BuildError('The shared shell has no body header')
        page = ('<!doctype html>\n<html><head><meta charset="utf-8">'
                '<meta http-equiv="Content-Security-Policy" content="' + html.escape(NATIVE_CSP, quote=True) + '">'
                '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
                '<style>img{max-width:100%}[hidden]{display:none!important}</style>'
                + head + '</head><body><header ' + body
                + '<script type="application/json" id="kitty-third-party-notices">' + js(notices) + '</script>'
                + '</body></html>')
        audit = NativeAssetAudit()
        audit.feed(page)
        audit.close()
        audit.finish()
        outputs = {'kitty-native.html': page}
        name = 'kitty-native.html'
    else:
        suffix = '-v2' if v2 else ''
        name = f'kitty{suffix}.html'
        outputs = {name: page, f'local{suffix}.html': SKELETON + page + '</body></html>'}
        if v2:
            outputs['kit.html'] = SKELETON + '<script>window.__KIT_GALLERY__=1;</script>' + page + '</body></html>'
    report = (f"dist/{name}: {len(page.encode()) // 1024} KB page; snapshot "
              f"{'omitted' if no_snapshot else snapshot_file + ' bundled'}; sheet {sheet_id}; "
              f"{len(merchants['merchants']['merchants'])} merchants; {len(logos)} logos")
    return outputs, report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', choices=('artifact', 'native'), default='artifact')
    parser.add_argument('--v2', action='store_true')
    parser.add_argument('--no-snapshot', action='store_true')
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parent
    try:
        outputs, report = render(root, args.host, args.v2, args.no_snapshot)
        out = root / 'dist'
        out.mkdir(exist_ok=True)
        for filename, content in outputs.items():
            (out / filename).write_text(content, encoding='utf-8')
        print(report)
    except (BuildError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        print('build failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
