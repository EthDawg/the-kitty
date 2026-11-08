"""Bundle the Kitty page, the Claude artifact; no dependencies are downloaded during a build.

    python3 build.py                 # original artifact build, with the fictional v1 snapshot
    python3 build.py --no-snapshot   # original artifact build, without bundled data
    python3 build.py --v2            # published v2 artifact and local/component previews
"""
import argparse
import base64
import json
from pathlib import Path
import sys


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


def render(root, v2=False, no_snapshot=False):
    root = Path(root)
    src, brand = root / 'src', root / 'brand'
    read = lambda *parts: Path(*parts).read_text(encoding='utf-8')
    config = json.loads(read(root, 'kitty.config.json'))
    sources = json.loads(read(src, 'data-sources.json'))
    snapshot_file = 'snapshot-v2.json' if v2 else 'snapshot.json'
    snapshot = None if no_snapshot else json.loads(read(root, 'data', snapshot_file))
    # The Records tab reads the standard's generated view. Like the snapshot it is the fictional household, so a page with no bundled data has none.
    view_file = root / 'data' / 'standard-view.json'
    standard_view = json.loads(view_file.read_text(encoding='utf-8')) if v2 and not no_snapshot and view_file.is_file() else None
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
    if logo_dir.is_dir():
        for file in sorted(logo_dir.iterdir()):
            if file.suffix.lower() in ('.svg', '.png'):
                mime = 'image/svg+xml' if file.suffix.lower() == '.svg' else 'image/png'
                logos[file.stem] = f'data:{mime};base64,' + base64.b64encode(file.read_bytes()).decode()
    # module tests live beside their modules (src/kit/*.test.js) and never ship
    kit = '\n'.join(file.read_text(encoding='utf-8') for file in sorted((src / 'kit').iterdir()) if file.suffix == '.js' and not file.name.endswith('.test.js'))
    # the shared view modules' styles (src/kit/*.css, kx-* classes) and their illustrations (src/kit/art), bundled like their scripts
    kit_css = '\n'.join(file.read_text(encoding='utf-8') for file in sorted((src / 'kit').iterdir()) if file.suffix == '.css')
    kit_art = {file.stem: 'data:image/svg+xml;base64,' + base64.b64encode(file.read_bytes()).decode()
               for file in sorted((src / 'kit' / 'art').glob('*.svg'))} if (src / 'kit' / 'art').is_dir() else {}
    shell = read(src, 'shell.html')
    sprite_start = shell.index('<svg width="0" height="0"')
    sprite_end = shell.index('</svg>', sprite_start) + len('</svg>')
    shell = shell[:sprite_start] + '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' + symbols + '</defs></svg>' + shell[sprite_end:]
    styles = read(src, 'vendor', 'gridstack-14.0.0.min.css') + '\n' + read(src, 'tokens.css') + '\n' + read(src, 'style.css') + '\n' + kit_css + '\n' + read(src, 'v3-views.css') + '\n' + read(brand, 'motion', 'motion.css')
    page = (shell
            .replace('/*STYLE*/', styles)
            .replace('/*SOURCES*/', 'window.KITTY_SOURCES=' + js(sources) + ';window.KITTY_MERCHANTS=' + js(merchants) + ';window.KITTY_ART=' + js(art) + ';window.KITTY_LOGOS=' + js(logos) + ';window.KITTY_KIT_ART=' + js(kit_art) + ';')
            .replace('/*SNAPSHOT*/', 'window.KITTY_SNAPSHOT=' + js(snapshot) + ';window.KITTY_PAGE_URL=' + js(config['page_url']) + ';window.KITTY_SHEET=' + js(sheet_id) + ';'
                     + ('' if standard_view is None else 'window.KITTY_STANDARD_VIEW=' + js(standard_view) + ';'))
            .replace('/*MOTION*/', read(brand, 'motion', 'motion.js'))
            .replace('/*ENGINE*/', read(src, 'engine.js'))
            .replace('/*KIT*/', kit)
            .replace('/*APP*/', read(src, 'app.js')))
    suffix = '-v2' if v2 else ''
    name = f'kitty{suffix}.html'
    outputs = {name: page, f'local{suffix}.html': SKELETON + page + '</body></html>'}
    if v2:
        outputs['kit.html'] = SKELETON + '<script>window.__KIT_GALLERY__=1;</script>' + page + '</body></html>'
    report = (f"dist/{name}: {len(page.encode()) // 1024} KB page; snapshot "
              f"{'omitted' if no_snapshot else snapshot_file + ' bundled'}; standard view {'omitted' if standard_view is None else 'bundled'}; sheet {sheet_id}; "
              f"{len(merchants['merchants']['merchants'])} merchants; {len(logos)} logos")
    return outputs, report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--v2', action='store_true')
    parser.add_argument('--no-snapshot', action='store_true')
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parent
    try:
        outputs, report = render(root, args.v2, args.no_snapshot)
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
