# Davies demo accounts

A local, read-only source portal and reproducible ingestion proof. All fixture data is fictional. This is a source laboratory, not an imitation sign-in screen. It never asks for credentials and never connects to a bank, Google Sheet, Drive or a model.

## Run

From the repository root:

```sh
python3 -m http.server 8875 --bind 127.0.0.1
# Open http://127.0.0.1:8875/demo-portals/index.html
python3 demo-portals/verify.py
```

The portal also opens directly as `index.html`; it needs no CDN or build. `fixture-data.js` is generated alongside the manifest. Core formats are the repository's existing Harbour, Southern and Wattle adapters, with three deliberately fictional display brands. Branding never changes canonical account/provider IDs.

## The useful demo

1. Select **Harbour a Dollar** and download transactions CSV, then its human-readable HTML sample statement. The stable CSV URL is `fixtures/core/harbour-2027-02.csv`.
2. Select **Southern X-press**, then **Wattle You Save**, and download each transactions CSV. Card CSV amounts are charges-positive; the normalised ledger reverses that sign.
3. Keep the three downloaded CSVs unchanged in one directory. Run `python3 demo-portals/verify.py --download-dir /path/to/downloads`. Downloaded files must retain the names `harbour-2027-02.csv`, `southern-2027-02.csv` and `wattle-2027-02.csv`. Browser-added suffixes must be reconciled explicitly.
4. Inspect `output/staged.json`: the mystery merchant has `needs_review`; the first append is deliberately blocked. `fixtures/review-decisions.json` contains the explicit **synthetic** review, not a human decision inferred by the app.
5. Inspect `output/Transactions.rows.json` and `Transactions.csv`: 13 source rows land in the application's ten-column `Transactions!A:J` shape. Original descriptions and source row pointers survive.
6. Inspect `output/report.json`: all three closing balances reconcile; the two transfer pairs net to zero; the two identical café charges remain distinct; repeating an imported file adds no rows.
7. `output/local-ledger.json` is read back and compared exactly. `output/readback.json` is a transaction-only snapshot fragment for inspection, not a replacement for the application's full snapshot.

This is a verified **local** loop. It stops before Google Sheets/Drive. A later provider adapter must append with RAW value semantics, reread the actual target range, compare returned IDs and values, and only then mark a provider write verified. The fixture harness's local success must never be displayed as live Sheet success.

## Browser automation path

Use visible labels. The institution controls are buttons with `aria-pressed`; each download link has a provider-specific accessible name. For example:

- `Harbour a Dollar` → `Download Harbour a Dollar transactions CSV`
- `Southern X-press` → `Download Southern X-press transactions CSV`
- `Wattle You Save` → `Download Wattle You Save transactions CSV`

Download links are ordinary static files, with no synthetic click JavaScript or pop-ups. Verify each downloaded hash against `fixtures/manifest.json`. The `--download-dir` route proves the browser-delivered bytes, when used, rather than silently re-reading the checked-in originals. The default command verifies the committed fixture bytes only.

## Scope

| Source | What works | What remains |
|---|---|---|
| Everyday bank, card, saver | CSV download; sample statement; existing adapter parse; independent Decimal validation; review gate; local ledger/readback | Real provider format verification and cloud append |
| Payslip | Downloadable evidence template; net pay agrees with salary fixture | Payslip adapter and reconciliation UI |
| Property | PPOR, cash-shortfall rental and cash-surplus rental templates | Ownership/time allocation and tax treatment; no negative-gearing determination |
| Shares, RSU, ESPP | Distinct event, units, currency, FX and document fields | ESS, lots, corporate actions and cost-base engine |
| Crypto | Event/quantity/AUD valuation/wallet reference template | Chain/import reconciliation and tax classification |
| Retail super / SMSF | Separate accumulation entities and member records | Contribution/cap checks, compliance and accounting |
| Health / car / home insurance | Policy, renewal, premium and excess examples | Policy document parsing and verified coverage interpretation |
| Car / laptop | Purchase, value and replacement-plan fields | Valuation source/refresh lifecycle |
| Tax readiness | Missing-evidence checklist | Reviewed requirements and evidence collection; no lodging |

Optional fixtures are off by default in the portal. Showing them reveals documents, not enabled product features. Their CSV shapes are proposed evidence contracts, not exports verified against real institutions. The playful names are original fictional brands, not authorised variants of real providers. No logos are borrowed.

## Data guarantees and limits

- Canonical amounts use integer AUD cents after Decimal parsing. Existing float-based adapters are retained as comparison subjects, not financial arithmetic authorities. Quantity/FX fields in optional fixtures remain decimal strings; they are not imported here.
- Exact file hashes prevent byte-identical repeat ingestion. Two identical rows inside one file retain their source row identities. Overlap across different files is held for review; it is not automatically discarded or appended.
- Known transfer descriptions and explicit references identify two matched fixture pairs. This is not a general-purpose transfer inference algorithm.
- `Transactions.rows.json` preserves raw text. The CSV result escapes leading formula-like free text; amount cells remain validated numeric strings. Use RAW semantics when building a real Sheets writer.
- Known category decisions and the mystery-merchant resolution are explicitly synthetic review fixtures. Do not promote them into household rules.
- All dates belong to the fixed February 2027 demonstration. No source snapshot, pipeline state, or live Sheet is changed.
- HTML statements are printable human-readable companions. The CSV is the machine-readable import source; PDF extraction is not implemented.

## Maintain

`python3 demo-portals/build_fixtures.py` rebuilds the fixtures, hashes and portal data. `python3 demo-portals/verify.py` runs 13 tests and writes the deterministic local evidence. Do not hand-edit `fixture-data.js` without updating the generator. The original `period-close` scripts and `data/snapshot.json` are unchanged.

## Render the verified local ledger

Open `result.html` after verification. It uses the shared Kitty UI components to display the actual saved rows and their source file/row/hash. The page checks the saved ledger bytes against `report.json` SHA-256 before rendering; a changed ledger requires rerunning verification. This guards accidental artifact drift, not a malicious party able to replace both report and ledger.
