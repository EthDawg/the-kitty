// Davies Household Finance: web view and JSON feed over the demo Google Sheet.
// The sheet does all the calculation; this script only reads it and serves the page.

// Bound to the demo sheet, so it only ever has access to that one spreadsheet.

// ?format=json returns every table as JSON, for pages hosted elsewhere (diy-web), for
// snapshots, and for The Kitty's bundled demo data (kitty/snapshot.py).
function doGet(e) {
  if (e && e.parameter && e.parameter.format === 'json') {
    // The feed is public by design for a fictional sheet. A household that keeps real money here must not
    // turn it on: it serves only when the Kitty tab says public_feed = yes.
    if (!publicFeedAllowed()) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'feed_off', message: 'This sheet does not publish a JSON feed. Set public_feed to yes on the Kitty tab only if every number in the sheet may be public.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify(getData())).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('Davies Household Finance')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function publicFeedAllowed() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Kitty');
  if (!sh || sh.getLastRow() < 2) return false;
  const rows = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  const row = rows.find((r) => String(r[0]).trim() === 'public_feed');
  return !!row && String(row[1]).trim().toLowerCase() === 'yes';
}

// One call returns every table the pages draw, as raw cell values (not display text).
function getData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const clean = (v) => (v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v === '' ? null : v);
  const key = (h) => String(h).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // Raw cell values of a tab from headerRow down. Null when the tab does not exist.
  const sheetRows = (name, headerRow, lastCol) => {
    const sh = ss.getSheetByName(name);
    if (!sh) return null;
    const n = sh.getLastRow() - headerRow + 1;
    return n < 1 ? [] : sh.getRange(headerRow, 1, n, lastCol).getValues();
  };
  const objects = (values, stopAtBlank) => {
    if (!values || !values.length) return [];
    const head = values[0].map(key);
    let body = values.slice(1);
    if (stopAtBlank) {
      const end = body.findIndex((r) => r[0] === '' || r[0] === null);
      body = body.slice(0, end === -1 ? body.length : end);
    } else {
      body = body.filter((r) => r[0] !== '' && r[0] !== null);
    }
    return body.map((r) => Object.fromEntries(head.map((h, i) => [h, clean(r[i])])));
  };
  // A table that starts at headerRow and stops at the first blank row, so a second
  // table further down the same tab (e.g. extra repayments) is never read into it.
  const table = (name, headerRow, lastCol) => objects(sheetRows(name, headerRow, lastCol), true);
  // A table whose body has blank spacer rows (Budget): keep every non-blank row.
  const tableAll = (name, headerRow, lastCol) => objects(sheetRows(name, headerRow, lastCol), false);
  // A second table lower on the same tab, found by the title cell above its header row.
  const tableAfter = (name, title, lastCol) => {
    const sh = ss.getSheetByName(name);
    if (!sh) return [];
    const col = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((r) => r[0]);
    const i = col.indexOf(title);
    return i === -1 ? [] : table(name, i + 2, lastCol);
  };
  // Label/value pairs under a title cell, until the first blank label.
  const pairs = (name, title) => {
    const sh = ss.getSheetByName(name);
    if (!sh) return {};
    const rows = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
    const i = rows.findIndex((r) => r[0] === title);
    const out = {};
    for (let k = i + 1; i !== -1 && k < rows.length && rows[k][0] !== ''; k++) out[rows[k][0]] = clean(rows[k][1]);
    return out;
  };

  // Cash Flow is wide (months across); turn it into one row per month, plus a category list.
  const cf = ss.getSheetByName('Cash Flow').getRange('A4:T60').getValues();
  const lines = { 'Salary and interest': 'salary_interest', 'Rent received': 'rent', 'Total income': 'income', Housing: 'housing', Essentials: 'essentials', Lifestyle: 'lifestyle', Property: 'property', 'Work and giving': 'work_giving', Fees: 'fees', Uncategorised: 'uncategorised', 'Total spending': 'spending', 'Net cash flow': 'net', 'Savings rate': 'savings_rate' };
  const monthCols = [];
  cf[0].forEach((h, i) => { if (h instanceof Date) monthCols.push(i); });
  const cashflow = monthCols.map((i) => ({ month: clean(cf[0][i]) }));
  const catStart = cf.findIndex((r) => r[0] === 'Spending by category');
  cf.slice(1, catStart).forEach((r) => {
    const col = lines[r[0]];
    if (col) monthCols.forEach((i, k) => { cashflow[k][col] = Number(r[i]) || 0; });
  });
  const iNow = cf[0].indexOf('Average, last 3 months');
  const iThen = cf[0].indexOf('Same 3 months last year');
  const catRows = cf.slice(catStart + 1).filter((r) => r[0] !== '');
  const categories = catRows.map((r) => ({ category: r[0], avg_3m: Number(r[iNow]) || 0, avg_3m_last_year: Number(r[iThen]) || 0 }));
  const cashflow_categories = catRows.map((r) => ({ category: r[0], months: monthCols.map((i) => Number(r[i]) || 0) }));

  return {
    fetchedAt: new Date().toISOString(),
    household: pairs('Settings', 'Setting')['Household'] || null,
    metrics: table('Metrics', 4, 8),
    cashflow,
    categories,
    cashflow_categories,
    savings: table('Savings Finder', 4, 7).filter((r) => r.type === 'Recurring' || r.type === 'One-off'),
    compliance: table('Compliance Checks', 4, 7).filter((r) => r.status),
    networth: table('Net Worth', 4, 9),
    mortgage: table('Mortgage Scenarios', 14, 8).filter((r) => typeof r.rate_change === 'number'),
    mortgage_inputs: pairs('Mortgage Scenarios', 'Loan inputs'),
    mortgage_extra: tableAfter('Mortgage Scenarios', 'Extra repayment scenarios', 5),
    subscriptions: table('Subscriptions', 1, 17),
    goals: table('Goals', 1, 10),
    // Added for The Kitty (kitty/): the input tabs and the raw rows, so one JSON holds the whole household.
    settings: table('Settings', 4, 3),
    accounts: table('Accounts', 1, 16),
    category_list: table('Categories', 1, 8),
    loans: table('Loans', 1, 11),
    assets: table('Assets', 1, 4),
    budget: tableAll('Budget', 4, 9).filter((r) => r.category !== 'Total'),
    // Tax Forecast has two columns per person (prior year, current year), so positional keys, not headers.
    tax: (sheetRows('Tax Forecast', 5, 6) || []).filter((r) => r[0] !== '').map((r) => ({ label: r[0], prior_j: clean(r[1]), prior_m: clean(r[2]), cur_j: clean(r[3]), cur_m: clean(r[4]), how: clean(r[5]) })),
    transactions: table('Transactions', 1, 10),
    payslips: table('Payslips', 1, 7),
    kitty: table('Kitty', 4, 3),
    // sheet_version 2 (The Kitty 2.0, the ledger): Accounts grows to 16 columns and these tabs appear. On a 1.1 sheet
    // they do not exist and come back as empty lists, so the same feed serves both shapes.
    entries: table('Entries', 1, 21),
    balances: table('Balances', 1, 6),
    contracts: table('Contracts', 1, 17),
    decisions: table('Decisions', 1, 8),
    rules: table('Rules', 1, 10),
    valuations: table('Valuations', 1, 5),
    // sheet_version 3: five more tabs (CHANGES.md version 3). On an older sheet they do not exist and come back as empty
    // lists, and the page keeps their views dark.
    receipts: table('Receipts', 1, 20),
    receipt_lines: table('Receipt Lines', 1, 16),
    decision_options: table('Decision Options', 1, 14),
    goal_levers: table('Goal Levers', 1, 10),
    tax_returns: table('Tax Returns', 1, 14),
  };
}
