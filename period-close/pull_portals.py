"""Download every file the demo portals serve into a sources/ folder, the way the bank-export skill would.

    node portals/server.js &                                   # or any deployment of the portals
    python3 period-close/pull_portals.py --base http://127.0.0.1:4173 --out /tmp/scratch/sources

Signs in to each brand with the password `demo` (the portals are a parody; there is no real credential anywhere),
lists its accounts, and for every month the portal holds downloads the CSV export of each bank account, loan,
property and employment, plus each policy's renewal notice and certificate of currency, saving each file exactly
as delivered under sources/<account id>/<download date>/<original filename>. The download date is two days after
the month end, as the simulator names its folders; payslips land under sources/payslips/<date>-<person>/ because
every employment's file is called payslips.csv. Standard library only. Used by the scale run, never by a household.
"""
import argparse
import calendar
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


def month_end(m):
    y, mo = int(m[:4]), int(m[5:7])
    return f'{m}-{calendar.monthrange(y, mo)[1]:02d}'


def add_days(iso, n):
    from datetime import date, timedelta
    return (date.fromisoformat(iso) + timedelta(days=n)).isoformat()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--base', default='http://127.0.0.1:4173')
    p.add_argument('--out', required=True)
    p.add_argument('--months', default=None, help='YYYY-MM..YYYY-MM to limit the range (default: every month the portal holds)')
    p.add_argument('--brands', default=None, help='comma-separated brand ids (default: all)')
    p.add_argument('--formats', default='csv,policy', help='csv: the CSV exports; policy: the insurer PDFs; pdf: every PDF too')
    a = p.parse_args()
    out = Path(a.out)
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def get(path, **qs):
        url = a.base + path + ('?' + urllib.parse.urlencode(qs) if qs else '')
        with opener.open(url, timeout=60) as r:
            return r.headers, r.read()

    brands = json.loads(get('/brands.json')[1])
    want = set(a.brands.split(',')) if a.brands else {b['id'] for b in brands}
    formats = set(a.formats.split(','))
    total, t0 = 0, time.time()
    for b in brands:
        if b['id'] not in want:
            continue
        body = urllib.parse.urlencode({'brand': b['id'], 'name': 'Scale run', 'password': 'demo'}).encode()
        req = urllib.request.Request(a.base + '/api/login', data=body, headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'})
        with opener.open(req, timeout=60) as r:
            assert r.status == 200, f'{b["id"]}: sign-in failed'
        listing = json.loads(get('/api/accounts', brand=b['id'])[1])
        months = listing['months']
        if a.months:
            lo, hi = a.months.split('..')
            months = [m for m in months if lo <= m <= hi]
        for acct in listing['accounts']:
            if acct['kind'] == 'policy':
                if 'policy' not in formats and 'pdf' not in formats:
                    continue
                for preset in acct['presets']:
                    for fmt in ('renewal', 'certificate'):
                        headers, data = get('/api/export', brand=b['id'], account=acct['id'], **{'from': preset['from'], 'to': preset['to']}, format=fmt)
                        name = re.search(r'filename="([^"]+)"', headers.get('Content-Disposition', '')).group(1)
                        folder = out / acct['id'] / add_days(preset['from'], 1)
                        folder.mkdir(parents=True, exist_ok=True)
                        (folder / name).write_bytes(data)
                        total += 1
                continue
            for m in months:
                for fmt in (['csv'] if 'csv' in formats else []) + (['pdf'] if 'pdf' in formats else []):
                    if not any(f == fmt for f, _ in acct['formats']):
                        continue
                    try:
                        headers, data = get('/api/export', brand=b['id'], account=acct['id'], **{'from': f'{m}-01', 'to': month_end(m)}, format=fmt)
                    except urllib.error.HTTPError as e:
                        print(f'  {b["id"]} {acct["id"]} {m} {fmt}: HTTP {e.code} {e.read()[:120]!r}', file=sys.stderr)
                        continue
                    name = re.search(r'filename="([^"]+)"', headers.get('Content-Disposition', '')).group(1)
                    day = add_days(month_end(m), 2)
                    if acct['kind'] == 'payroll':
                        person = acct['id'].split('@')[0].lower()
                        folder = out / 'payslips' / f'{day}-{person}'
                    else:
                        folder = out / acct['id'] / day
                    folder.mkdir(parents=True, exist_ok=True)
                    (folder / name).write_bytes(data)
                    total += 1
        print(f'{b["name"]}: {len(listing["accounts"])} accounts, {len(months)} months', file=sys.stderr)
    print(f'{total} files into {out} in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
