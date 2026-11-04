// End to end: a browser signs in to each parody portal, downloads real files, and the repo's importer takes
// them against a scratch copy of the sheet. Proves the column shapes, the de-duplication, the engine's
// structural invariants, and that a closed month downloaded here is byte-identical to the file under sources/.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const MONTHS = require("../data/months.json");
const MONTH = MONTHS.simulated[0]; // the first month after the sheet's as-of: nothing in the sheet yet, everything in the portals
const LAST = { "2027-02": "2027-02-28" }[MONTH] || monthEnd(MONTH);
const DOWNLOAD_DAY = addDays(LAST, 2);
const BANKS = [
  { brand: "westpaw", accounts: ["ACC-EVD", "ACC-OFF", "ACC-RNT"], file: "Data.csv", head: "Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial", balanceCol: 5 },
  { brand: "commbark", accounts: ["ACC-OLD"], file: "CSVData.csv", headerless: true, balanceCol: 3 },
  { brand: "amewx", accounts: ["ACC-CC"], file: "activity.csv", head: "Date,Description,Card Member,Account #,Amount" },
  { brand: "ping", accounts: ["ACC-SAV", "ACC-HOL"], file: "Transactions.csv", head: "Date,Description,Credit,Debit,Balance", balanceCol: 4 },
];
const CLOSED = [ // a month the sheet already holds: the download must equal the simulator's file byte for byte
  ["westpaw", "ACC-EVD", "2027-01", "sources/ACC-EVD/2027-02-02/Harbour-Transactions-ACC-EVD-2027-01.csv"],
  ["amewx", "ACC-CC", "2027-01", "sources/ACC-CC/2027-02-02/activity-2027-01.csv"],
  ["ping", "ACC-SAV", "2027-01", "sources/ACC-SAV/2027-02-02/Transactions-2027-01.csv"],
];

function monthEnd(m) { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`; }
function addDays(iso, n) { return new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10); }
const round2 = (n) => Math.round(n * 100) / 100;
const rowsIn = (acct, month) => MONTHS.transactions.filter((t) => t[1] === acct && t[0].startsWith(month));
const closingAt = (acct, to) => round2(MONTHS.accounts.find((a) => a.id === acct).opening_balance + MONTHS.transactions.filter((t) => t[1] === acct && t[0] <= to).reduce((s, t) => s + t[3], 0));
const csvCells = (line) => { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out; };
const num = (s) => Number(String(s).replace(/[+,$]/g, ""));
const py = (args, cwd = ROOT) => execFileSync("python3", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let scratch;
test.beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "kitty-portals-"));
  // the sheet as it stands, plus the one account the portals hold that the sheet does not, so the importer knows its
  // shape; none of its history is in the sheet, so it joins with its balance at the start of the month
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "snapshot.json"), "utf8"));
  const old = MONTHS.accounts.find((a) => a.id === "ACC-OLD");
  snap.accounts.push({ account_id: old.id, account: old.name, institution: old.institution, type: old.type, owner: old.owner, opening_balance: round2(old.opening_balance + MONTHS.transactions.filter((t) => t[1] === old.id && t[0] < `${MONTH}-01`).reduce((n, t) => n + t[3], 0)), opening_date: old.opening_date, balance_at_as_of_date: null, liquid: "Yes" });
  fs.writeFileSync(path.join(scratch, "snapshot.json"), JSON.stringify(snap));
});

async function signIn(page, brand, name = "Playwright") {
  await page.goto(`/${brand}`);
  await expect(page.locator(".demo")).toContainText("DEMO");
  await expect(page.locator("#signin, #dash").locator("visible=true").first()).toBeVisible();
  if (await page.locator("#dash").isVisible()) return; // this brand's cookie is already set from earlier in the test
  await page.fill("#name", name);
  await page.fill("#password", "demo");
  await page.click("#loginbtn");
  await expect(page.locator("#dash")).toBeVisible();
  await expect(page.locator("#whoname")).toContainText(name);
}

async function exportFile(page, accountId, from, to, format) {
  await page.check(`input[name="acct"][value="${accountId}"]`);
  await page.selectOption("#preset", "custom");
  if (!(await page.locator("#from").isDisabled())) { await page.fill("#from", from); await page.fill("#to", to); }
  await page.check(`input[name="format"][value="${format}"]`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#exportbtn")]);
  const file = path.join(scratch, "downloads", `${accountId}-${from}-${to}-${format}-${download.suggestedFilename()}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await download.saveAs(file);
  return { name: download.suggestedFilename(), file, bytes: fs.readFileSync(file) };
}

test("a wrong password is refused and nothing is listed", async ({ page }) => {
  await page.goto("/westpaw");
  await page.fill("#name", "Nobody"); await page.fill("#password", "password"); await page.click("#loginbtn");
  await expect(page.locator("#loginerror")).toContainText("demo");
  await expect(page.locator("#dash")).toBeHidden();
  const r = await page.request.get("/api/export?brand=westpaw&account=ACC-EVD&from=2027-02-01&to=2027-02-28&format=csv");
  expect(r.status()).toBe(401);
});

test("the landing page lists every portal and the brand switch moves between them", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".demo")).toContainText("DEMO");
  await expect(page.locator(".brandcard")).toHaveCount(7);
  await page.click('.brandcard[href="/ping"]');
  await expect(page).toHaveURL(/\/ping$/);
  await expect(page.locator("#mark .n")).toHaveText("PING");
  await page.selectOption("#brandswitch", "amewx");
  await expect(page).toHaveURL(/\/amewx$/);
  await expect(page.locator("#mark .n")).toHaveText("Amewx");
});

test(`each bank shape downloads for ${MONTH}, imports, reconciles to the simulator, and a repeat appends nothing`, async ({ page }) => {
  test.slow();
  const expected = [];
  for (const bank of BANKS) {
    await signIn(page, bank.brand);
    for (const acct of bank.accounts) {
      const dl = await exportFile(page, acct, `${MONTH}-01`, LAST, "csv");
      expect(dl.name, `${bank.brand} names its file as the institution does`).toBe(bank.file);
      const text = dl.bytes.toString("utf8");
      expect(text.endsWith("\r\n"), "CRLF line endings, as the banks write").toBe(true);
      const lines = text.split("\r\n").filter(Boolean);
      const rows = rowsIn(acct, MONTH);
      if (bank.headerless) {
        expect(lines.length).toBe(rows.length);
        for (const l of lines) expect(csvCells(l)[0], "CommBank shape: a date in the first column of every line, no header").toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        if (lines.length) expect(num(csvCells(lines[0])[bank.balanceCol]), "newest first, so the first line carries the closing balance").toBeCloseTo(closingAt(acct, LAST), 2);
      } else {
        expect(lines[0], `${bank.brand} header`).toBe(bank.head);
        expect(lines.length - 1).toBe(rows.length);
        if (bank.balanceCol != null && lines.length > 1) expect(num(csvCells(lines[lines.length - 1])[bank.balanceCol]), "the last running balance equals the simulator's closing balance").toBeCloseTo(closingAt(acct, LAST), 2);
      }
      const dir = path.join(scratch, "sources", acct, DOWNLOAD_DAY);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(dl.file, path.join(dir, dl.name));
      expected.push({ acct, count: rows.length, sum: round2(rows.reduce((s, t) => s + t[3], 0)) });
    }
  }
  // a month the sheet already holds comes back byte-identical to the file under sources/
  for (const [brand, acct, month, file] of CLOSED) {
    await signIn(page, brand);
    const dl = await exportFile(page, acct, `${month}-01`, monthEnd(month), "csv");
    expect(Buffer.compare(dl.bytes, fs.readFileSync(path.join(ROOT, file))), `${brand} ${acct} ${month} equals ${file}`).toBe(0);
  }

  // the importer takes every shape
  const out = path.join(scratch, "close");
  const review = py([path.join(ROOT, "period-close", "import_month.py"), MONTH, "--sheet", path.join(scratch, "snapshot.json"), "--sources", path.join(scratch, "sources"), "--out", out]);
  const rows = JSON.parse(fs.readFileSync(path.join(out, "rows.json"), "utf8"));
  const total = expected.reduce((s, e) => s + e.count, 0);
  expect(rows.length, review).toBe(total);
  expect(review).toContain(`${total} rows to append`);
  const snap = JSON.parse(fs.readFileSync(path.join(scratch, "snapshot.json"), "utf8"));
  const lastId = Math.max(...snap.transactions.map((t) => Number(t.txn_id.slice(1))));
  rows.forEach((r, i) => expect(r[0], "IDs continue from the sheet's last").toBe(`T${String(lastId + 1 + i).padStart(4, "0")}`));
  const accountIds = new Set(snap.accounts.map((a) => a.account_id)), catIds = new Set(snap.category_list.map((c) => c.category_id));
  for (const r of rows) { expect(accountIds.has(r[2]), `account ${r[2]} is on the Accounts tab`).toBe(true); expect(catIds.has(r[6]), `category ${r[6]} is on the Categories tab`).toBe(true); expect(r[1].startsWith(MONTH)).toBe(true); }
  for (const e of expected) {
    const mine = rows.filter((r) => r[2] === e.acct);
    expect(mine.length, `${e.acct} row count`).toBe(e.count);
    expect(round2(mine.reduce((s, r) => s + r[5], 0)), `${e.acct} signed total equals the simulator's`).toBeCloseTo(e.sum, 2);
  }
  // the engine's structural invariants hold over the sheet plus the appended rows
  const E = require(path.join(ROOT, "src", "engine.js"));
  const merged = JSON.parse(JSON.stringify(snap));
  merged.transactions.push(...rows.map(([txn_id, date, account_id, bank_description, merchant, amount, category_id, person, receipt_held, note]) => ({ txn_id, date, account_id, bank_description, merchant, amount, category_id, person, receipt_held: receipt_held || null, note: note || null })));
  const asOf = merged.settings.find((s) => s.setting === "As-of date"); if (asOf) asOf.value = LAST;
  const m = E.model(merged);
  expect(m.tx.length).toBe(snap.transactions.length + rows.length);
  const checks = E.reconcile(m).filter((c) => /ID is used once|category ID exists/.test(c.what));
  expect(checks.length).toBe(2);
  for (const c of checks) expect(c.ok, c.what).toBe(true);
  // the same files against the sheet that now holds them: nothing to append
  fs.writeFileSync(path.join(scratch, "snapshot-after.json"), JSON.stringify(merged));
  const again = py([path.join(ROOT, "period-close", "import_month.py"), MONTH, "--sheet", path.join(scratch, "snapshot-after.json"), "--sources", path.join(scratch, "sources"), "--out", path.join(scratch, "close-again")]);
  expect(again).toContain("0 rows to append");
  expect(again).toContain(`${total} already in the sheet`);
  expect(JSON.parse(fs.readFileSync(path.join(scratch, "close-again", "rows.json"), "utf8"))).toEqual([]);
  // the card's statement period straddles two months; the importer keeps only the month asked for
  await signIn(page, "amewx");
  await page.check('input[name="acct"][value="ACC-CC"]');
  await page.selectOption("#preset", { label: `Statement closing 14 Mar 2027` });
  await expect(page.locator("#from")).toHaveValue("2027-02-15");
  const [stmt] = await Promise.all([page.waitForEvent("download"), page.click("#exportbtn")]);
  const stmtFile = path.join(scratch, "sources-stmt", "ACC-CC", "2027-03-16", "activity.csv");
  fs.mkdirSync(path.dirname(stmtFile), { recursive: true });
  await stmt.saveAs(stmtFile);
  const dates = fs.readFileSync(stmtFile, "utf8").split("\r\n").slice(1).filter(Boolean).map((l) => csvCells(l)[0].slice(3, 5));
  expect(new Set(dates)).toEqual(new Set(["02", "03"]));
  // the card's calendar month and that statement in one run: each row once, the overlap named
  fs.mkdirSync(path.join(scratch, "sources-both", "ACC-CC", "2027-03-01"), { recursive: true });
  fs.mkdirSync(path.join(scratch, "sources-both", "ACC-CC", "2027-03-16"), { recursive: true });
  fs.copyFileSync(path.join(scratch, "sources", "ACC-CC", DOWNLOAD_DAY, "activity.csv"), path.join(scratch, "sources-both", "ACC-CC", "2027-03-01", "activity.csv"));
  fs.copyFileSync(stmtFile, path.join(scratch, "sources-both", "ACC-CC", "2027-03-16", "activity.csv"));
  const both = py([path.join(ROOT, "period-close", "import_month.py"), MONTH, "--sheet", path.join(scratch, "snapshot.json"), "--sources", path.join(scratch, "sources-both"), "--out", path.join(scratch, "close-both")]);
  expect(both).toContain("repeated across overlapping files");
  const bothRows = JSON.parse(fs.readFileSync(path.join(scratch, "close-both", "rows.json"), "utf8"));
  expect(bothRows.length).toBe(rowsIn("ACC-CC", MONTH).length);
  expect(round2(bothRows.reduce((s, r) => s + r[5], 0))).toBeCloseTo(round2(rowsIn("ACC-CC", MONTH).reduce((s, t) => s + t[3], 0)), 2);
  const febAgain = py([path.join(ROOT, "period-close", "import_month.py"), MONTH, "--sheet", path.join(scratch, "snapshot-after.json"), "--sources", path.join(scratch, "sources-stmt"), "--out", path.join(scratch, "close-stmt-feb")]);
  expect(febAgain).toContain("0 rows to append");
  const mar = py([path.join(ROOT, "period-close", "import_month.py"), "2027-03", "--sheet", path.join(scratch, "snapshot-after.json"), "--sources", path.join(scratch, "sources-stmt"), "--out", path.join(scratch, "close-stmt-mar")]);
  const marRows = JSON.parse(fs.readFileSync(path.join(scratch, "close-stmt-mar", "rows.json"), "utf8"));
  expect(marRows.length).toBe(MONTHS.transactions.filter((t) => t[1] === "ACC-CC" && t[0] >= "2027-03-01" && t[0] <= "2027-03-14").length);
  expect(marRows.every((r) => r[1] >= "2027-03-01" && r[1] <= "2027-03-14")).toBe(true);
});

test("statements, owner statements, payslips and renewals arrive as real PDFs and CSVs", async ({ page }) => {
  test.slow();
  const isPdf = (b) => b.subarray(0, 5).toString() === "%PDF-";
  await signIn(page, "westpaw");
  let dl = await exportFile(page, "ACC-EVD", `${MONTH}-01`, LAST, "pdf");
  expect(dl.name).toMatch(/^Westpaw-Statement-ACC-EVD-\d{8}\.pdf$/); expect(isPdf(dl.bytes)).toBe(true); expect(dl.bytes.length).toBeGreaterThan(2000);
  dl = await exportFile(page, "LN-HOME", "2026-07-01", LAST, "pdf");
  expect(dl.name).toMatch(/^Westpaw-LoanStatement-LN-HOME-\d{8}\.pdf$/); expect(isPdf(dl.bytes)).toBe(true);
  dl = await exportFile(page, "LN-INV", `${MONTH}-01`, LAST, "csv");
  expect(dl.bytes.toString().split("\r\n")[0]).toBe("Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial");
  expect(dl.bytes.toString()).toContain("INTEREST CHARGED,2617.00");
  await page.click("#previewbtn");
  await expect(page.locator("#preview tbody tr")).toHaveCount(1);

  await signIn(page, "commbark");
  dl = await exportFile(page, "ACC-OLD", `${MONTH}-01`, LAST, "pdf");
  expect(isPdf(dl.bytes)).toBe(true);
  await expect(page.locator(".badge.off")).toHaveText("not on the sheet");

  await signIn(page, "propertymeow");
  dl = await exportFile(page, "RENTAL", "2026-07-01", LAST, "pdf");
  expect(dl.name).toBe(`PropertyMeow-OwnerStatement-RENTAL-${LAST.replace(/-/g, "")}.pdf`); expect(isPdf(dl.bytes)).toBe(true); expect(dl.bytes.length).toBeGreaterThan(5000);
  dl = await exportFile(page, "RENTAL", `${MONTH}-01`, LAST, "csv");
  const owner = dl.bytes.toString().split("\r\n").filter(Boolean);
  expect(owner[0]).toBe("Date,Description,Rental schedule line,Money in,Money out,Handled by");
  const rental = MONTHS.properties.RENTAL.months[MONTH];
  expect(owner.length - 1).toBe(rental.lines.length);
  expect(owner.some((l) => l.includes("Gross rent") && l.includes(rental.rent.toFixed(2)))).toBe(true);

  await signIn(page, "pawroll");
  dl = await exportFile(page, "Jordan@Northwind Logistics", `${MONTH}-01`, LAST, "csv");
  expect(dl.name).toBe("payslips.csv");
  const pays = dl.bytes.toString().split("\r\n").filter(Boolean);
  expect(pays[0]).toBe("Pay date,Person,Employer,Gross pay,Tax withheld,Super (employer),Net pay");
  const mine = MONTHS.payslips.filter((p) => p[1] === "Jordan" && p[0].startsWith(MONTH));
  expect(pays.length - 1).toBe(mine.length);
  for (const p of mine) expect(pays).toContain(`${p[0]},Jordan,Northwind Logistics,${p[3].toFixed(2)},${p[4].toFixed(2)},${p[5].toFixed(2)},${p[6].toFixed(2)}`);
  dl = await exportFile(page, "Mia@Bayview Health", `${MONTH}-01`, LAST, "pdf");
  expect(dl.name).toMatch(/^Pawroll-Payslips-Mia-\d{8}-\d{8}\.pdf$/); expect(isPdf(dl.bytes)).toBe(true);

  await signIn(page, "purrsure");
  dl = await exportFile(page, "POL-RENTAL", "", "", "renewal");
  expect(dl.name).toMatch(/^Purrsure-RenewalNotice-RENTAL-\d{4}\.pdf$/); expect(isPdf(dl.bytes)).toBe(true);
  dl = await exportFile(page, "POL-HOME", "", "", "certificate");
  expect(dl.name).toMatch(/^Purrsure-CertificateOfCurrency-HOME-\d{4}\.pdf$/); expect(isPdf(dl.bytes)).toBe(true);
  await page.click("#signout");
  await expect(page.locator("#signin")).toBeVisible();
});
