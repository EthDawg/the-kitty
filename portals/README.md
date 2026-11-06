# The portals

Twenty-four parody portals that hold the fictional Davies household's files for eight years, the way a bank, a card
company, a property manager, a payroll, an insurer, a super fund, a tax office and a council hold them, deployed on Vercel
at https://the-kitty-portals.vercel.app. A twenty-fifth, Tabby Tax, is a parody accountant. Each has "Continue as Daisy" and
"Continue as Danny", one click and no password. Any name also signs in with the password `demo`. Nothing here is a real institution; the column shapes are real. `public/llms.txt` tells an agent how the sites work.

The seven originals generate exports on the server. Every portal also hands over the Davies world's files exactly as
delivered: the seventeen below do nothing else, and the seven carry them under a "Files as delivered" tab.

| Portal | Stands in for | Serves |
|---|---|---|
| Westpaw | Westpac | Everyday joint, Home loan offset, Rental property account (Harbour Bank shape: `Data.csv`), the two loans (statements, interest summaries by financial year) |
| CommBark | Commonwealth Bank | Jordan's old everyday (`CSVData.csv`, no header, newest first). Not on the sheet; labelled. |
| Amewx | American Express | Rewards credit card (`activity.csv`, charges positive, statement periods closing on the 14th) |
| PING | ING | Emergency saver, Japan 2027 saver (`Transactions.csv`) |
| PropertyMeow | a property manager's owner portal | Owner statements per month and per financial year for the Geelong townhouse, by ATO rental schedule line |
| Pawroll | an employer's payroll portal | A payslip per pay since March 2019 for Jordan and Mia, an income statement per financial year, `payslips.csv` in the period-close shape |
| Purrsure | an insurer's policy portal | Landlord, home and contents, and car policies: a renewal notice and a certificate of currency per period |

| Portal | Stands in for | Serves, as delivered |
|---|---|---|
| myGuv | myGov, the ATO and Services Australia | Notices of assessment, the pre-fill, Mia's HELP account and paid parental leave. |
| Purrannuation | an industry super fund | Jordan's monthly activity as CSV, with the header that changed in July 2023, and annual statements as PDF. |
| HESTAbby | HESTA | Mia's quarterly app exports as JSON and half-yearly statements as plain PDF. |
| Cedar Trade | an online share broker | The cash hub by month, holdings by year, and a contract note for every trade. |
| Computerpaw | Computershare | Distribution and dividend statements, a share split notice and the annual tax statements. |
| E\*Treat | E*TRADE | Jordan's sale confirmations, ESS statements, benefit history and plan holdings. |
| Coinpurr | a crypto exchange | Activity by financial year as CSV and one closing statement as a saved page. |
| RentPurrfect | a second property manager's owner portal | Monthly owner statements for the Ballarat cottage. |
| Ratepurr | a council's ratepayer portal | Quarterly rates notices from three councils, one per property. |
| WaterBowl | a water authority's customer portal | Quarterly water bills from three authorities, one per property. |
| PawPrice | a property value estimate service | A month-end estimate for the big things the household owns, as CSV. |
| Meowtility | an energy retailer's account page | RedPaw Energy's electricity bills as email, Origpurr Gas's bills as saved pages. |
| Bupaw | Bupa | Each person's private health insurance statement for the tax return. |
| Kittenhood | a childcare centre's family portal | Ava's monthly statements of account, as saved pages. |
| VicPaws | VicRoads | A registration notice a year, through two cars. |
| Gmeow | the household's email inbox | A working inbox: receipts, bills, statements, valuations, settlement papers, returns and noise. Search, threads, attachments, compose. |
| Litterbox | the household's Drive | A working Drive, messy on purpose: folders, search, preview, download, upload. |
| Tabby Tax | a tax agent's practice | Holds no files. Takes emailed PDFs and a zip, asks what a real practice asks, and does not open cloud links. |

Councils, water and energy share one portal each, the way Pawroll serves two employers; each stream names who sent what.
Files with no portal of their own live where they landed: Gmeow for what arrived by email, Litterbox for what the
household keeps itself.

## The estate: which family, when, who and how

Every read passes through one view of the request, `lib/view.js`: which family, when (the clock), who (the person) and how (that portal's friction).

**Two families and more.** The benchmark household, Jordan, Mia and Ava from 2019 to 2027, is the default. A generated life is chosen with `?family=<id>`. `build-vault.js`
loads each `life/world/out/<family>/` through `build-family.js`: a `manifest.json` with the vault's fields plus `person`, `visible_to` and `delivered_on`, the files it names,
`setup/party.json` for names and `mess.json` for what landed in the Drive and the inbox. A bad manifest stops the build. `test/fixtures/families/fixture/` is a hand-made
family that keeps the contract, loaded with `--fixture` and never deployed. A generated family's portals list files as delivered and generate nothing. `KITTY_FAMILIES=<folder>`
loads families from somewhere else.

**The clock is one request parameter, `today`, and it lives in `lib/clock.js`.** A listing shows what had been delivered by that day, and accounts stop at it. It goes on every
request, because the server keeps nothing; a portal's page carries it, and `family`, on every call and link. No `today` means everything.

**The files are static, under `public/vault/`.** The clock and the person filter what is listed. They do not hide a file from someone with its address, and `llms.txt` says so.
Its index stays in `estate/`, so a listing has to come through `api/files.js`.

**Sign-in chooses a person.** "Continue as Mia" on any portal is one click with no password, because an agent must not type one, even a fake one (`POST /api/login` with
`person`; `GET /api/login` lists a family's people). The mock code has a "Use this code" button for the same reason. Any name and `demo` still sees the whole household with no
friction. In the benchmark, who holds what is in `estate/benchmark/access.json`, written from the world's ownership tables, and it follows the date: the saver is joint until
1 July 2024. `data/portal-rules.json` holds the one exception, the card, where the world splits the cost and the card company signs in its member. A generated family's files
say who sees them.

**Friction is data.** `data/portal-rules.json` has a row per portal: `back_years`, `window_days`, `gap_seconds` (one export at a time) and `second_factor` (a mock code shown
on screen). It applies to a named person and never to the any-name door. Static files cannot be held back, so the gap applies to exports.

**The Drive and the inbox are read-only views.** `lib/drive.js` and `lib/mail.js` have the same tools and arguments as a real connector, at `/api/drive/<tool>` and
`/api/mail/<tool>`, with the query languages too. The writable fake Drive is a Folder store in the test harness; that, or a real demo Google or Microsoft account, is a new class
behind `driveFor()` and `mailFor()`. For the benchmark, `estate-plan.js` says where things landed and what state they are in, and `build-estate.js` builds it, with
`life/davies/ESTATE.md`, what each chapter needs and where it is. A generated family's mess comes from its `mess.json`.

**Tabby Tax.** `lib/tabby.js` answers from `data/tabby-script.json`, one checklist per family, with no model and no randomness. It knows the family's papers by hash, so
`scan0003.pdf` is read the way a person would read it, and anything else by its name and words. It stores nothing: the page sends back the `state` from the last reply.
Nothing it says is tax advice.

## What is in here

| Path | What it is |
|---|---|
| `history.py` | March 2019 to June 2025, invented month by month with the household's life events, landing every account to the cent on the sheet's opening balances (30 June 2025). Also the descriptor conventions below and the back-solved home-loan walk. |
| `build-data.py` | Builds `data/months.json` from `history.py`, `data/snapshot.json` (every month the sheet holds, unchanged) and `period-close/simulate.py` run in a scratch copy (the two months ahead). `--check` fails if the committed file is stale; `--write-sources` writes the history as bank files under `../sources/`; `public/stats.json` is written alongside. |
| `data/months.json` | The one dataset the portals serve: accounts, transactions, payslips, loans by month, properties by month, policies by period. |
| `public/` | The pages: `index.html` (the landing), `portal.html` + `portal.js` + `portal.css` (one app for every brand: overview, activity, documents, files as delivered), `brands.json` (the seven) and `vault-brands.json` (the seventeen, same shape) as the registry, `marks.js` (the original wordmarks). |
| `build-vault.js` | Copies the world's files into `public/vault/<stream>/<delivered date>/` and writes `estate/benchmark/vault.json` (brand, stream, year, date, `delivered_on`, `person`, file name, size, content type, path, hash) and `access.json`, runs `build-estate.js`, then loads each generated family. `streams` in each registry row says which portal holds what. A file with no home or two, a stream with no files, or a copy that misses its hash stops the build. `estate/` and `public/vault/` are gitignored. |
| `build-estate.js`, `estate-plan.js` | The benchmark's Drive, inbox and the files only its estate holds, and `life/davies/ESTATE.md`. |
| `build-family.js` | A generated family, from its manifest. |
| `api/` | `login`, `logout`, `accounts` (list, paged activity, documents), `export` (the download), `files` (the list of files as delivered), and `estate` (the two connectors and the practice). |
| `lib/` | `view.js`, `clock.js`, `families.js`, `people.js`, `friction.js` (the estate rules above), `data.js` (indexes, presets, documents), `shapes.js` (the exact CSV shapes, byte-for-byte what `period-close/adapters.py` writes), `pdf.js` (pdf-lib documents), `exports.js`, `vault.js`, `drive.js`, `drive-query.js`, `mail.js`, `tabby.js`, `read.js`, `mime.js`, `zip.js`, `http.js`, `auth.js`. |
| `server.js` | Mounts the same functions locally with the same rewrites; what Playwright runs against. |
| `lib/file-types.js` | The content type of each delivered file. `vercel.json` repeats it for the deployment; `test/vault.spec.js` holds the two together. |
| `test/portals.spec.js` | The proof. `test/vault.spec.js` is the vault's: two sign-ins, a PDF and a CSV hashed against the world, one home for every file. ``clock`, `people`, `family`, `estate`, `tabby` and `profile.spec.js` hold the rest. `test/screenshots.js` takes the README's screenshots. |

## Run it

```bash
cd portals && npm ci && npm start        # http://127.0.0.1:4173
npx playwright test                       # chromium only; starts the server itself
python3 build-data.py                     # after a month-end close (promote period-close/state.json first)
python3 build-data.py --write-sources     # also write any new months as bank files under sources/
```

The estate is generated, so a checkout builds it from the repo root. Without it a portal says what to run instead of listing files.

```bash
node standard/world/build.js && node portals/build-vault.js
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

The estate changes what a deploy needs:

- **Build it first.** From the repo root, where the `.vercel` link lives, never from inside `portals/`:
  `node standard/world/build.js && node portals/build-vault.js && vercel deploy --prod --archive=tgz`. Build without `--fixture`. The archive is needed: thousands of
  separate uploads abort. A new checkout or worktree has no link; copy `.vercel/` from a linked one or run `vercel link`.
- **The gitignored files still go up.** The CLI reads `.vercelignore` and not `.gitignore` (checked in CLI 59.26's source),
  and `.vercelignore` lists neither `estate/` nor `public/vault/`. Keep it that way. `buildCommand` skips when `estate/families.json` arrived with
  the upload and otherwise builds it from the repo, which a Git deploy would need; that path has not been run on Vercel.
- **Every portal needs a rewrite.** `vercel.json` lists the ids by hand. `test/vault.spec.js` fails if one is missing.
- **The files are static.** `/vault/*` is served with `Content-Disposition: attachment` and its own content types. The
  sign-in and the clock guard the listing, not the files: anyone with a URL can fetch one, which is fine for a fictional household and
  would not be for a real one. `functions` in `vercel.json` carries `estate/` into the functions that read it, and `public/vault/` into the one that hands files to the connectors.
- **`cleanUrls` touches one type.** A vault `.html` answers with a 308 to the same path without the extension. The link's
  `download` attribute keeps the file name and the bytes are unchanged.
