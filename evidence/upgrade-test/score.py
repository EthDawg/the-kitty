"""Score the sheet version 3 upgrade runs: before/<run>.json against after/<run>.json.

Reads sheets.json, usage.json, runs/<run>/report.md. Writes score.json and prints
the results table (markdown) followed by per-run detail.
usage: python3 score.py
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = ['H1-haiku', 'H1-sonnet', 'H1-opus', 'H2-haiku', 'H2-sonnet', 'H2-opus',
        'H3-haiku', 'H3-sonnet', 'H3-opus']

# ---- what the note asks for ("3, 8 November 2026") ----
HEADERS = {
    'Receipts': 'Receipt ID, Date, Time, Merchant, Merchant ID, Store, Channel, Person, Items, Total, GST, Savings, Paid with, Entry ID, Account ID, Source, Source kind, Read by, Check, Note',
    'Receipt Lines': 'Receipt ID, Line, Printed text, Product, Brand, Group, Kind, Qty, Unit, Unit price, Amount, GST, Pack size, Price per kg or L, Retailer code, Note',
    'Decision Options': 'Decision ID, Question, Ref, Option, Upfront, Per month, Months, Extra, Total, Recommended, Decide by, Status, Source, Note',
    'Goal Levers': 'Lever ID, Goal, Lever, On, Per month, One-off, Date if on, Date if off, Months moved, Source',
    'Tax Returns': 'Person, FY, Status, Taxable income, Tax on income, Medicare, Offsets, Withheld, Result, Lodged, Notice, Pack, Source, Note',
}
HEADERS = {t: [h.strip() for h in v.split(',')] for t, v in HEADERS.items()}
RECEIPT_TABS = ['Receipts', 'Receipt Lines']

G2 = ('=MAP(A2:A,B2:B,D2:D,E2:E,F2:F,LAMBDA(id,goal,on,pm,oo,IF(id="","",LET(asof,INDEX(Settings!B:B,MATCH("As-of date",Settings!A:A,0)),'
      'r,MATCH(goal,Goals!A:A,0),need,INDEX(Goals!B:B,r)-INDEX(Goals!E:E,r),base,N(INDEX(Goals!I:I,r)),'
      'opm,SUMIFS(E:E,B:B,goal,D:D,TRUE)-IF(on,N(pm),0),ooo,SUMIFS(F:F,B:B,goal,D:D,TRUE)-IF(on,N(oo),0),'
      'rest,need-ooo-N(oo),rate,base+opm+N(pm),IF(rest<=0,EOMONTH(asof,-1)+1,IF(rate<=0,"Never",EOMONTH(asof,CEILING(rest/rate,1)-1)+1))))))')
H2 = G2.replace('rest,need-ooo-N(oo)', 'rest,need-ooo').replace('rate,base+opm+N(pm)', 'rate,base+opm')
FORMULAS = {
    ('Receipts', 'S'): '=MAP(A2:A,J2:J,LAMBDA(id,tot,IF(id="","",IF(ABS(SUMIFS(\'Receipt Lines\'!K:K,\'Receipt Lines\'!A:A,id)-tot)<=0.05,"OK","Lines "&TEXT(SUMIFS(\'Receipt Lines\'!K:K,\'Receipt Lines\'!A:A,id),"0.00")&" vs "&TEXT(tot,"0.00")))))',
    ('Receipt Lines', 'N'): '=MAP(A2:A,K2:K,H2:H,I2:I,M2:M,LAMBDA(id,a,q,u,p,IF(OR(id="",a=""),"",IF(OR(u="kg",u="L"),IFERROR(ROUND(a/q,2),""),IFERROR(LET(n,VALUE(REGEXEXTRACT(p,"[0-9.]+")),un,LOWER(REGEXEXTRACT(p,"[A-Za-z]+$")),f,IFS(un="g",n/1000,un="kg",n,un="ml",n/1000,un="l",n,TRUE,NA()),ROUND(a/(q*f),2)),"")))))',
    ('Decision Options', 'I'): '=MAP(A2:A,E2:E,F2:F,G2:G,H2:H,LAMBDA(id,e,f,g,h,IF(id="","",N(e)+N(f)*N(g)+N(h))))',
    ('Goal Levers', 'G'): G2,
    ('Goal Levers', 'H'): H2,
    ('Goal Levers', 'I'): '=MAP(A2:A,G2:G,H2:H,LAMBDA(id,g,h,IF(id="","",IF(OR(g="Never",h="Never"),"",(YEAR(h)-YEAR(g))*12+MONTH(h)-MONTH(g)))))',
    ('Tax Returns', 'I'): '=MAP(A2:A,E2:E,F2:F,G2:G,H2:H,LAMBDA(p,e,f,g,h,IF(p="","",ROUND(N(h)-(N(e)+N(f)-N(g)),2))))',
}
LISTS = {
    ('Receipts', 'G'): ['In-store', 'Online delivery', 'Online pickup', 'Online'],
    ('Receipts', 'M'): ['Card', 'Gift card', 'Cash', 'Mixed', 'Points'],
    ('Receipts', 'Q'): ['Photo', 'PDF', 'Email', 'Export', 'Screenshot'],
    ('Receipt Lines', 'F'): ['Fruit & veg', 'Meat & seafood', 'Dairy & eggs', 'Bakery', 'Pantry', 'Snacks & sweets', 'Drinks', 'Frozen',
                             'Prepared meals', 'Baby', 'Health & beauty', 'Household', 'Alcohol', 'Pet', 'Other'],
    ('Receipt Lines', 'G'): ['Item', 'Discount', 'Fee', 'Deposit'],
    ('Receipt Lines', 'I'): ['each', 'kg', 'L'],
    ('Receipt Lines', 'L'): ['Taxable', 'GST-free'],  # the note's "GST" list; Receipts!K GST is an amount
    ('Decision Options', 'L'): ['Open', 'Decided', 'Dropped'],
    ('Tax Returns', 'C'): ['Estimate', 'Lodged', 'Assessed', 'Amended'],
}
CHECKBOXES = [('Decision Options', 'J'), ('Goal Levers', 'D')]
ASOF = '<as-of>'
NEW_CHECKS = {  # name -> (column, note formula); <as-of> is any as-of reference
    "Receipts that don't add up": {'C': '=COUNTIF(Receipts!S:S,"Lines*")'},
    'Card receipts with no bank row': {'C': '=COUNTIFS(Receipts!M:M,"Card",Receipts!N:N,"",Receipts!A:A,"<>")',
                                       'D': '=SUMIFS(Receipts!J:J,Receipts!M:M,"Card",Receipts!N:N,"")'},
    'Spending outside the bank, latest month': {'D': '=SUMPRODUCT((Receipts!M2:M<>"Card")*(Receipts!M2:M<>"")*(TEXT(Receipts!B2:B,"yyyy-mm")=TEXT(<as-of>,"yyyy-mm"))*N(+Receipts!J2:J))'},
    'Decisions with more than one pick': {'C': "=SUMPRODUCT(--(COUNTIFS('Decision Options'!A2:A,'Decision Options'!A2:A,'Decision Options'!J2:J,TRUE)>1)*('Decision Options'!J2:J=TRUE))"},
    'Decisions past their decide-by date': {'C': "=COUNTIFS('Decision Options'!L:L,\"Open\",'Decision Options'!K:K,\"<\"&<as-of>,'Decision Options'!J:J,TRUE)"},
    'Lodged years without a tax pack': {'C': "=COUNTIFS('Tax Returns'!C:C,\"<>Estimate\",'Tax Returns'!A:A,\"<>\",'Tax Returns'!L:L,\"\")"},
}
RECEIPT_CHECKS = ["Receipts that don't add up", 'Card receipts with no bank row', 'Spending outside the bank, latest month']
ASOF_FORMS = ['Settings!B6', 'Settings!$B$6', 'INDEX(Settings!B:B,MATCH("As-of date",Settings!A:A,0))']
TYPES = {'Tax', 'Data', 'Cash', 'Close'}  # the Type values the existing rows use
TOTAL = 'Checks needing review'
ERRORS = ('#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#ERROR!', '#NUM!', '#NULL!', 'Loading...')


def load(p):
    return json.load(open(os.path.join(HERE, p)))


def cell_val(c):
    u = c.get('userEnteredValue', {}) if c else {}
    return next(iter(u.values())) if u else ''


def col(i):
    s, i = '', i + 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def grid(snap):
    """{tab: [[value, ...] per row]} from the ranges block."""
    out = {}
    for s in snap['ranges']['sheets']:
        rows = s['data'][0].get('rowData', []) if s.get('data') else []
        out[s['properties']['title']] = [[cell_val(c) for c in r.get('values', [])] for r in rows]
    return out


def norm(f):
    return re.sub(r'\s+', '', str(f))


def asof_norm(f):
    f = norm(f)
    for a in ASOF_FORMS:
        f = f.replace(norm(a), ASOF)
    return f


def shift_rows(f, old, new):
    """Rewrite references to row `old` as row `new` (Sheets does this when a row moves)."""
    return re.sub(r'(?<![A-Za-z0-9_])(\$?[A-Z]{1,3}\$?)%d(?![0-9])' % old, lambda m: m.group(1) + str(new), str(f))


def checks_by_name(rows):
    out = {}
    for i, r in enumerate(rows):
        if i >= 4 and r and r[0] != '':
            out[r[0]] = (i + 1, r)
    return out


def score(run, sheet_ids, usage):
    before, after = load(f'before/{run}.json'), load(f'after/{run}.json')
    house = run.startswith('H3')
    goals_tab = 'Our goals' if house else 'Goals'
    report = open(os.path.join(HERE, 'runs', run, 'report.md')).read()
    bg, ag = grid(before), grid(after)
    after_titles = [s['properties']['title'] for s in after['meta']['sheets']]
    before_titles = [s['properties']['title'] for s in before['meta']['sheets']]
    nt = after['new_tabs']
    res = {'run': run, 'spreadsheetId': sheet_ids[run]}

    # g (first, a and f use it): household question about the Receipts collision
    q_text = report.lower()
    qi = q_text.find('question')
    asked = house and qi >= 0 and 'receipt' in q_text[qi:]
    hh_receipts_same = (not house) or bg.get('Receipts') == ag.get('Receipts')

    # a. tabs
    tabs = {}
    for t, hdr in HEADERS.items():
        if t in nt:
            tabs[t] = 'ok' if nt[t]['header'] == hdr else 'header differs: %s' % nt[t]['header']
        elif house and t in RECEIPT_TABS:
            tabs[t] = 'held for the household' if (asked and hh_receipts_same) else 'missing'
        else:
            tabs[t] = 'missing'
    res['tabs'] = tabs
    ok = sum(v == 'ok' for v in tabs.values())
    held = sum(v == 'held for the household' for v in tabs.values())
    res['tabs_score'] = f'{ok}/5' + (f' + {held} held' if held else '')
    res['tabs_ok'] = ok + held == 5

    # b. formulas
    fdet, present, errors, verbatim, expected = {}, 0, 0, 0, 0
    for (t, c), f in FORMULAS.items():
        if tabs[t] == 'held for the household':
            continue
        expected += 1
        cell = nt.get(t, {}).get('row2', {}).get(c, {})
        got = cell.get('userEnteredValue', {}).get('formulaValue')
        fv = cell.get('formattedValue', '')
        want = f.replace('Goals!', "'Our goals'!") if house else f
        d = {'present': bool(got), 'shows': fv, 'error': fv.startswith('#') or fv in ERRORS,
             'verbatim': bool(got) and norm(got) == norm(want)}
        if got and not d['verbatim']:
            d['formula'] = got
        if (t, c) == ('Goal Levers', 'H') and got and not d['verbatim']:
            # the note's "this lever left out" keeps opm/ooo net of this lever
            d['defect'] = ('opm/ooo no longer net of this lever: Date if off equals Date if on for any lever '
                           'that is on, so Months moved reads 0') if '-IF(on,N(pm),0)' not in got else 'differs'
        present += d['present']; errors += d['error']; verbatim += d['verbatim']
        fdet[f'{t}!{c}2'] = d
    res['formulas'] = fdet
    off = [k for k, d in fdet.items() if d['present'] and not d['verbatim']]
    res['formulas_score'] = f'{present}/{expected}, {errors} errors' + (f'; {", ".join(off)} differs' if off else '')

    # c. lists and checkboxes
    ldet, lok, lexp = {}, 0, 0
    for (t, c), vals in list(LISTS.items()) + [(k, None) for k in CHECKBOXES]:
        if tabs[t] == 'held for the household':
            continue
        lexp += 1
        dv = nt.get(t, {}).get('row2', {}).get(c, {}).get('dataValidation')
        if not dv:
            ldet[f'{t}!{c}'] = 'none'
            continue
        cond = dv['condition']
        if vals is None:
            good = cond['type'] == 'BOOLEAN'
        else:
            good = cond['type'] == 'ONE_OF_LIST' and [v.get('userEnteredValue') for v in cond.get('values', [])] == vals
        ldet[f'{t}!{c}'] = ('ok' if good else 'wrong: %s' % cond) + ('' if dv.get('strict') else ' (warn only)')
        lok += good
    res['lists'] = ldet
    strict = sum('warn' not in v for v in ldet.values() if v.startswith('ok'))
    res['lists_score'] = f'{lok}/{lexp}' + ('' if strict == lok else f' ({lok - strict} warn-only)')

    # d. compliance checks
    bcc, acc = bg['Compliance Checks'], ag['Compliance Checks']
    bchk, achk = checks_by_name(bcc), checks_by_name(acc)
    fmt = after['compliance_formatted']
    new = {}
    for name, cols in NEW_CHECKS.items():
        if name not in achk:
            new[name] = 'held for the household' if (house and name in RECEIPT_CHECKS and asked) else 'missing'
            continue
        rown, r = achk[name]
        f = fmt[rown - 1] if rown - 1 < len(fmt) else []
        status = f[4] if len(f) > 4 else ''
        got = lambda c: r['ABCDEFG'.index(c)] if len(r) > 'ABCDEFG'.index(c) else ''
        dev = [c for c, want in cols.items() if asof_norm(got(c)) != asof_norm(want)]
        new[name] = {'row': rown, 'type': r[1] if len(r) > 1 else '', 'status': status,
                     'status_ok': status in ('OK', 'Review', 'Note'),
                     'errors': [x for x in f if str(x).startswith('#')],
                     'not_as_written': dev}
    added = [v for v in new.values() if isinstance(v, dict)]
    exp_checks = 3 if house else 6
    res['checks'] = new
    nonstd = sorted({v['type'] for v in added if v['type'] not in TYPES})
    res['checks_score'] = (f'{len(added)}/{exp_checks}' + ('' if all(v['status_ok'] and not v['errors'] for v in added) else ' (bad status)')
                           + (f', Type set to {"/".join(nonstd)}' if nonstd else '')
                           + (f', {sum(bool(v["not_as_written"]) for v in added)} formula rewritten' if any(v['not_as_written'] for v in added) else ''))
    # originals and the total
    orig_missing = [n for n in bchk if n not in achk]
    tot_b, tot_a = bchk.get(TOTAL), achk.get(TOTAL)
    review_count = sum(1 for i, f in enumerate(fmt) if i >= 4 and len(f) > 4 and f[4] == 'Review')
    tot_shown = fmt[tot_a[0] - 1][2] if tot_a and len(fmt[tot_a[0] - 1]) > 2 else None
    res['originals'] = {'missing': orig_missing, 'total_row': [tot_b and tot_b[0], tot_a and tot_a[0]],
                        'total_formula_same': bool(tot_a and tot_b and tot_a[1] == tot_b[1]),
                        'total_shows': tot_shown, 'review_rows': review_count,
                        'total_counts': tot_shown is not None and str(tot_shown) == str(review_count)}

    # e. tailoring kept
    changed, moved = [], []
    for t, brows in bg.items():
        arows = ag.get(t)
        if arows is None:
            changed.append(f'{t}: tab missing after')
            continue
        if t == 'Compliance Checks':
            for i in range(min(4, len(brows))):
                for j, v in enumerate(brows[i]):
                    av = arows[i][j] if i < len(arows) and j < len(arows[i]) else ''
                    if av != v:
                        changed.append(f'{t}!{col(j)}{i + 1}: {v!r} -> {av!r}')
            for name, (brn, brow) in bchk.items():
                if name not in achk:
                    changed.append(f'{t}: row "{name}" missing')
                    continue
                arn, arow = achk[name]
                if arn != brn:
                    moved.append(f'{name}: row {brn} -> {arn}')
                for j in range(max(len(brow), len(arow))):
                    bv = brow[j] if j < len(brow) else ''
                    av = arow[j] if j < len(arow) else ''
                    want = shift_rows(bv, brn, arn) if arn != brn else bv  # a moved row's own-row references move with it
                    if av != want:
                        changed.append(f'{t}!{col(j)} "{name}": {bv!r} -> {av!r}')
            extra = [n for n in achk if n not in bchk and n not in NEW_CHECKS]
            changed += [f'{t}: unexpected row "{n}"' for n in extra]
            continue
        for i, brow in enumerate(brows):
            for j in range(max(len(brow), len(arows[i]) if i < len(arows) else 0)):
                bv = brow[j] if j < len(brow) else ''
                av = arows[i][j] if i < len(arows) and j < len(arows[i]) else ''
                if t == 'Kitty' and brow and brow[0] == 'sheet_version' and j == 1:
                    continue
                if av != bv:
                    changed.append(f'{t}!{col(j)}{i + 1}: {bv!r} -> {av!r}')
        for i in range(len(brows), len(arows)):
            if any(v != '' for v in arows[i]):
                changed.append(f'{t}: new row {i + 1} {arows[i][:3]}')
    # existing tabs kept their names and order
    kept = [t for t in after_titles if t in before_titles]
    order_ok = kept == before_titles
    res['tailoring'] = {'changed_cells': changed, 'moved_rows': moved,
                        'tabs_renamed_or_reordered': not order_ok,
                        'entries_rows': [before['entries_rows'], after['entries_rows']]}
    # Metrics!C20 reads the review total by position; an insert above the total makes Sheets rewrite it
    mc = after['extras'].get('Metrics!A20:C20', [])
    mf = cell_val(mc[2]) if len(mc) > 2 else ''
    want_mf = f"='Compliance Checks'!C{tot_b[0]}" if tot_b else ''
    res['metrics_c20'] = {'after': mf, 'before_by_position': want_mf, 'rewritten': mf != want_mf,
                          'shows': mc[2].get('formattedValue') if len(mc) > 2 else None}

    # f. household tailoring (H3)
    if house:
        gl = nt.get('Goal Levers', {}).get('row2', {})
        gf = [gl.get(c, {}).get('userEnteredValue', {}).get('formulaValue', '') for c in 'GH']
        res['household'] = {'receipts_tab_unchanged': hh_receipts_same,
                            'receipts_grid': [s['properties']['gridProperties'] for s in after['meta']['sheets'] if s['properties']['title'] == 'Receipts'],
                            'goal_levers_read_our_goals': all("'Our goals'!" in f and not re.search(r"(?<!')Goals!", f) for f in gf),
                            'asked_about_receipts': asked}
        res['collision'] = 'yes' if (hh_receipts_same and asked and res['household']['goal_levers_read_our_goals']) else 'no'
    else:
        res['collision'] = 'n/a'

    # g. sheet_version
    kit = {r[0]: r[1] for r in ag['Kitty'] if len(r) > 1}
    bkit = {r[0]: r[1] for r in bg['Kitty'] if len(r) > 1}
    v = kit.get('sheet_version')
    complete = ok == 5 and len(added) == 6
    pending = house and held == 2 and asked
    if complete:
        fits = 'yes' if v == 3 else 'no'
    elif pending:
        fits = 'yes (held at 2 while the receipts question is open)' if v == 2 else 'arguable (3 with receipts still open)'
    else:
        fits = 'no'
    res['version'] = {'before': bkit.get('sheet_version'), 'after': v, 'fits': fits}

    # h. cost
    u = usage[run]
    res['cost'] = {'tokens': u['tokens'], 'tool_uses': u['tool_uses'], 'minutes': round(u['ms'] / 60000, 1)}
    return res


def main():
    sheet_ids = load('sheets.json')['runs']
    usage = load('usage.json')
    results = [score(r, sheet_ids, usage) for r in RUNS]
    json.dump(results, open(os.path.join(HERE, 'score.json'), 'w'), indent=1, ensure_ascii=False)
    print('| Run | Tabs | Formulas (row 2) | Lists | Checks added | Cells changed that shouldn\'t have | Collision handled | Version | Tokens | Tools | Minutes |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    for r in results:
        v = r['version']
        print(f"| {r['run']} | {r['tabs_score']} | {r['formulas_score']} | {r['lists_score']} | {r['checks_score']} | "
              f"{len(r['tailoring']['changed_cells'])} | {r['collision']} | {v['after']} ({v['fits'].split(' ')[0]}) | "
              f"{r['cost']['tokens']:,} | {r['cost']['tool_uses']} | {r['cost']['minutes']} |")
    print()
    for r in results:
        o, t = r['originals'], r['tailoring']
        print(f"## {r['run']}")
        bad_f = {k: v for k, v in r['formulas'].items() if not v['verbatim'] or v['error']}
        if bad_f:
            print('  formulas not as written:', json.dumps(bad_f, ensure_ascii=False)[:600])
        bad_l = {k: v for k, v in r['lists'].items() if v != 'ok'}
        if bad_l:
            print('  lists:', bad_l)
        print('  new checks:', {k: (v if isinstance(v, str) else f"row {v['row']} {v['type']} {v['status']}" + (f" changed {v['not_as_written']}" if v['not_as_written'] else '')) for k, v in r['checks'].items()})
        print(f"  originals missing: {o['missing']}; total row {o['total_row'][0]} -> {o['total_row'][1]}, formula same {o['total_formula_same']}, "
              f"shows {o['total_shows']} vs {o['review_rows']} Review rows, counting {o['total_counts']}")
        print(f"  changed cells: {t['changed_cells'] or 'none'}; rows moved: {len(t['moved_rows'])}; tabs renamed/reordered: {t['tabs_renamed_or_reordered']}; "
              f"entries {t['entries_rows'][0]} -> {t['entries_rows'][1]}")
        m = r['metrics_c20']
        print(f"  Metrics!C20: {m['after']} (by position before: {m['before_by_position']}; rewritten {m['rewritten']}; shows {m['shows']})")
        if 'household' in r:
            print('  household:', r['household'])
        print('  version:', r['version'], ' cost:', r['cost'])


if __name__ == '__main__':
    main()
