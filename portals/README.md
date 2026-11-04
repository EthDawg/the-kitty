# The portals

Seven parody portals that hold the fictional Davies household's files for eight years, the way a bank, a card company,
a property manager, a payroll and an insurer hold them, deployed on Vercel at https://the-kitty-portals.vercel.app.
Any name signs in with the password `demo`. Nothing here is a real institution; the column shapes are real.

| Portal | Stands in for | Serves |
|---|---|---|
| Westpaw | Westpac | Everyday joint, Home loan offset, Rental property account (Harbour Bank shape: `Data.csv`), the two loans (statements, interest summaries by financial year) |
| CommBark | Commonwealth Bank | Jordan's old everyday (`CSVData.csv`, no header, newest first). Not on the sheet; labelled. |
| Amewx | American Express | Rewards credit card (`activity.csv`, charges positive, statement periods closing on the 14th) |
| PING | ING | Emergency saver, Japan 2027 saver (`Transactions.csv`) |
| PropertyMeow | a property manager's owner portal | Owner statements per month and per financial year for the Geelong townhouse, by ATO rental schedule line |
| Pawroll | an employer's payroll portal | A payslip per pay since March 2019 for Jordan and Mia, an income statement per financial year, `payslips.csv` in the period-close shape |
| Purrsure | an insurer's policy portal | Landlord, home and contents, and car policies: a renewal notice and a certificate of currency per period |

## What is in here

| Path | What it is |
|---|---|
| `history.py` | March 2019 to June 2025, invented month by month with the household's life events, landing every account to the cent on the sheet's opening balances (30 June 2025). Also the descriptor conventions below and the back-solved home-loan walk. |
| `build-data.py` | Builds `data/months.json` from `history.py`, `data/snapshot.json` (every month the sheet holds, unchanged) and `period-close/simulate.py` run in a scratch copy (the two months ahead). `--check` fails if the committed file is stale; `--write-sources` writes the history as bank files under `../sources/`; `public/stats.json` is written alongside. |
| `data/months.json` | The one dataset the portals serve: accounts, transactions, payslips, loans by month, properties by month, policies by period. |
| `public/` | The pages: `index.html` (the landing), `portal.html` + `portal.js` + `portal.css` (one app for every brand: overview, activity, documents), `brands.json` (the registry), `marks.js` (the original wordmarks). |
| `api/` | Four Node functions: `login`, `logout`, `accounts` (list, paged activity, documents), `export` (the download). |
| `lib/` | `data.js` (indexes, presets, documents), `shapes.js` (the exact CSV shapes, byte-for-byte what `period-close/adapters.py` writes), `pdf.js` (pdf-lib documents), `exports.js`, `http.js`, `auth.js`. |
| `server.js` | Mounts the same functions locally with the same rewrites; what Playwright runs against. |
| `test/portals.spec.js` | The proof. `test/screenshots.js` takes the README's screenshots. |

## Run it

```bash
cd portals && npm ci && npm start        # http://127.0.0.1:4173
npx playwright test                       # chromium only; starts the server itself
python3 build-data.py                     # after a month-end close (promote period-close/state.json first)
python3 build-data.py --write-sources     # also write any new months as bank files under sources/
```

## Rebuilding the sheet from the files

The point of the portals is that an agent can populate the sheet from nothing but what the institutions hand over.
The recipe: open each account on the Accounts tab at its balance the day before the first file (the portals' overview
shows it; `data/months.json` carries `opening_balance` and `opening_date` per account), then run
`period-close/import_month.py <month> --sources sources` for every month in order, appending each month's rows before
the next. The importer's closing-balance check compares each file's printed balance with the opening balance plus
every row to that date and holds a month that does not reconcile, which is what happens when a month is imported out
of order; the Playwright test does exactly this for the 2021-22 financial year of the everyday account.

## Descriptor conventions (for the merchant dictionary)

The sheet's own months (from July 2025) keep the sheet's plain descriptors, because the sheet's Rules were written
from them. The years before vary the way real exports vary, deterministically:

- **Harbour Bank (Westpac shape).** Card purchases on the everyday account carry a state and country token about 70%
  of the time (`WOOLWORTHS 3021 BRUNSWICK VIC AU`) and are cut at 24 characters about 30% of the time
  (`WOOLWORTHS 3021 BRUNSWIC`). Direct debits and salary keep the biller's own string. Transfers between own accounts
  read `TRANSFER TO <account>` / `TRANSFER FROM <account>`, `SWEEP TO OFFSET` / `SWEEP FROM EVERYDAY`.
- **Southern Card (Amex shape).** The merchant's own string, sometimes a city or entity token
  (`UBER* EATS MELBOURNE`, `AMAZON MKTPLC AU SYDNEY SOUTH`, `MENULOG PTY LTD`, `APPLE.COM/BILL SYDNEY`); no card suffix,
  the Card Member column carries the person. Foreign charges carry `USD 20.00` and a separate
  `INTERNATIONAL TRANSACTION FEE` line.
- **Bark Bank (CommBank shape).** `<merchant> Card xx4471 Value Date: dd/mm/yyyy` on card purchases;
  `MONTHLY ACCOUNT FEE`, `CREDIT INTEREST`.
- **Wattle Credit Union (ING shape).** Transfers and `INTEREST CREDIT` only.
- **Store numbers** move between two stores per chain (`WOOLWORTHS 3021 BRUNSWICK` / `WOOLWORTHS 1124 COBURG`,
  `COLES 0457 COBURG` / `COLES 0433 BRUNSWICK`, `KMART 1127 COBURG` / `KMART 1066 NORTHLAND`). **Trading names change**
  over the years (`TPG INTERNET` → `AUSSIE BROADBAND`, `TELSTRA MOBILE x2` → `BELONG MOBILE x2`, `AGL ELECTRICITY` →
  `RED ENERGY ELECTRICITY`, `MORELAND CITY COUNCIL RATES` → `MERRI-BEK CITY COUNCIL RATES`, `YARRA VALLEY WATER` →
  `GREATER WESTERN WATER`, `CALTEX COBURG` → `AMPOL FOODARY COBURG`).
- **Rent lines** carry the month (`BAYSIDE PROPERTY MGMT RENT SEP`); the fee line does not.

## Deploy notes

Vercel project `the-kitty-portals` (team less-go), root directory `portals/`, framework Other, four Node functions;
`vercel.json` carries the rewrites and an `ignoreCommand` so pushes that do not touch `portals/` do not deploy. What is
live was deployed with the Vercel CLI; Git auto-deploys and a preview URL per pull request need the Vercel account's
GitHub login connection (`vercel git connect` once it exists). Deployment protection is at Vercel's default: the
production domain is public, unique deployment URLs ask for a Vercel sign-in.
