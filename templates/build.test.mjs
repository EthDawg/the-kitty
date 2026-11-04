import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildTemplate, canonical, expectedFingerprints, PROFILE, SOURCE_SHA256, validateInput } from './build.mjs';

const source = JSON.parse(readFileSync(new URL('./source/davies-v1.json', import.meta.url)));
const base = (change = {}) => ({ profile: 'au-aud-basic', sheetVersion: 1, householdName: 'River household', people: ['Sam'], openingDate: '2026-06-30', accounts: [
  { id: 'ACC-DAILY', name: 'Everyday', institution: 'Example institution', type: 'Transaction', owner: 'Sam', openingMinor: '12345' },
], ...change });
const make = change => buildTemplate(base(change));
const cellKey = cell => [cell.sheetId, cell.rowIndex, cell.columnIndex].join(':');
function table(plan, title) { return plan.verification.sheets.find(sheet => sheet.title === title); }
function cell(plan, title, row, column) { return plan.verification.cells.find(cell => cell.sheetId === table(plan, title).sheetId && cell.rowIndex === row - 1 && cell.columnIndex === column - 1)?.userEnteredValue; }
function formula(plan, title, row, column) { return cell(plan, title, row, column)?.formulaValue; }
function values(plan, title) { const id = table(plan, title).sheetId; return plan.verification.cells.filter(cell => cell.sheetId === id); }
function effectiveEmptyWorkbook(plan) {
  // An independent decoder for standard Google request shapes. It does not
  // evaluate formulas and deliberately leaves the provider-owned default tab.
  const sheets = new Map([[0, { title: 'Sheet1', values: new Map(), rules: [] }]]);
  for (const request of plan.batchUpdate.requests) {
    if (request.addSheet) {
      const properties = request.addSheet.properties;
      assert.ok(!sheets.has(properties.sheetId), 'Generated tabs may not collide with the initial default tab.');
      sheets.set(properties.sheetId, { ...properties, values: new Map(), rules: [] });
    } else if (request.updateCells) {
      const { start, rows, fields } = request.updateCells;
      assert.equal(fields, 'userEnteredValue');
      const sheet = sheets.get(start.sheetId);
      assert.ok(sheet);
      rows.forEach((row, ri) => row.values.forEach((value, ci) => {
        const key = `${start.rowIndex + ri}:${start.columnIndex + ci}`;
        if (value.userEnteredValue !== undefined) sheet.values.set(key, value.userEnteredValue);
        else sheet.values.delete(key);
      }));
    } else if (request.repeatCell) {
      const { range } = request.repeatCell;
      const sheet = sheets.get(range.sheetId);
      assert.ok(sheet);
      assert.ok(range.startRowIndex >= 0 && range.endRowIndex <= sheet.gridProperties.rowCount);
      assert.ok(range.startColumnIndex >= 0 && range.endColumnIndex <= sheet.gridProperties.columnCount);
      sheet.rules.push(request.repeatCell);
    } else if (request.updateDimensionProperties) {
      const { range, properties, fields } = request.updateDimensionProperties;
      const sheet = sheets.get(range.sheetId);
      assert.ok(sheet);
      assert.ok(['ROWS', 'COLUMNS'].includes(range.dimension));
      assert.ok(range.startIndex >= 0 && range.endIndex > range.startIndex);
      assert.ok(range.endIndex <= sheet.gridProperties[range.dimension === 'ROWS' ? 'rowCount' : 'columnCount']);
      assert.equal(fields, 'pixelSize');
      assert.ok(properties.pixelSize > 0);
    } else assert.ok(request.updateSpreadsheetProperties);
  }
  return sheets;
}
function balancedFormula(expression) {
  let quoted = false, depth = 0;
  for (let i = 0; i < expression.length; i++) {
    const character = expression[i];
    if (character === '"') { if (quoted && expression[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && character === '(') depth++;
    else if (!quoted && character === ')') { depth--; if (depth < 0) return false; }
  }
  return !quoted && depth === 0;
}

test('the source and capture check are pinned; generation is deterministic and does not mutate its input', () => {
  const bytes = readFileSync(new URL('./source/davies-v1.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SOURCE_SHA256);
  const capture = JSON.parse(readFileSync(new URL('./source/capture-check.json', import.meta.url)));
  assert.deepEqual(capture.checks.errors, []);
  assert.equal(capture.checks.formulas, 1981);
  const input = base(), before = structuredClone(input);
  const a = buildTemplate(input), b = buildTemplate(input);
  assert.deepEqual(input, before);
  assert.deepEqual(a, b);
  assert.equal(a.inputSha256, createHash('sha256').update(canonical(a.normalizedInput)).digest('hex'));
  assert.deepEqual(buildTemplate(a.normalizedInput), a, 'A normalized native review request must round-trip unchanged.');
  assert.deepEqual(a.profile, PROFILE);
  assert.ok(a.adaptations.batchBytes < 1_900_000);
  assert.equal(createHash('sha256').update(readFileSync(new URL('./source/davies-v1.json', import.meta.url))).digest('hex'), SOURCE_SHA256);
});

test('normalization is explicit, stable across input ordering and preserves exact monetary strings', () => {
  const input = base({ householdName: '  River household  ', people: ['  Zo\u0065\u0308  ', 'Ana'], accounts: [
    { id: 'Z-CARD', name: ' Card ', institution: ' Institution ', type: 'Credit card', owner: 'Ana', openingMinor: '-29' },
    { id: 'A-CASH', name: 'Cash', institution: 'Institution', type: 'Savings', owner: 'Zoë', openingMinor: '29' },
  ], budgets: [{ categoryId: 'SHOPPING', monthlyMinor: '0' }, { categoryId: 'GROCERIES', monthlyMinor: '12345' }] });
  const normalized = validateInput(input);
  assert.equal(normalized.householdName, 'River household');
  assert.deepEqual(normalized.people, ['Zoë', 'Ana']);
  assert.deepEqual(normalized.accounts.map(account => account.id), ['A-CASH', 'Z-CARD']);
  assert.deepEqual(normalized.budgets.map(budget => budget.categoryId), ['GROCERIES', 'SHOPPING']);
  assert.equal(normalized.accounts[1].openingMinor, '-29');
  assert.equal(normalized.goal, null);
  assert.equal(normalized.emergencyAccountId, null);
  assert.deepEqual(normalized.capacity, { transactions: 2000, payslips: 500, valuations: 500 });
  assert.equal(normalized.country, 'AU'); assert.equal(normalized.currency, 'AUD');
  const reversed = { ...input, accounts: [...input.accounts].reverse(), budgets: [...input.budgets].reverse() };
  assert.equal(buildTemplate(input).inputSha256, buildTemplate(reversed).inputSha256);
});

test('ambiguous names, unsupported profiles, malformed dates and unknown fields fail before a plan exists', () => {
  const changes = [
    { profile: 'general-finance' }, { sheetVersion: 2 }, { currency: 'USD' }, { country: 'NZ' }, { tax: { enabled: true } },
    { people: [] }, { people: ['A', 'B', 'C'] }, { people: ['Sam', 'sam'] }, { people: ['Joint'] }, { people: ['A,B'] }, { people: ['Sam\nOther'] },
    { householdName: '' }, { people: ['x'.repeat(81)] }, { openingDate: '2026-02-29' }, { openingDate: '2026-06-29' }, { openingDate: '30/06/2026' },
    { capacity: { transactions: 0 } }, { capacity: { transactions: 1.2 } }, { capacity: { transactions: 100001 } }, { capacity: { accounts: 2 } },
  ];
  for (const change of changes) assert.throws(() => make(change), JSON.stringify(change));
});

test('account ownership, IDs, exact cents, aggregate bounds and configured references are enforced', () => {
  for (const openingMinor of ['-0', '01', '1.0', '1e3', 100, '100000000000000', '-100000000000000']) assert.throws(() => make({ accounts: [{ ...base().accounts[0], openingMinor }] }));
  for (const change of [{ owner: 'Someone else' }, { id: 'a b' }, { id: 'a' }, { type: 'Loan' }, { institution: '' }, { currency: 'AUD' }]) assert.throws(() => make({ accounts: [{ ...base().accounts[0], ...change }] }));
  assert.throws(() => make({ accounts: [] }));
  assert.throws(() => make({ accounts: [base().accounts[0], base().accounts[0]] }));
  assert.throws(() => make({ accounts: [{ ...base().accounts[0], openingMinor: '99999999999999' }, { ...base().accounts[0], id: 'OTHER', openingMinor: '-1' }] }));
  assert.throws(() => make({ emergencyAccountId: 'MISSING' }));
  assert.throws(() => make({ accounts: [{ ...base().accounts[0], type: 'Credit card' }], emergencyAccountId: 'ACC-DAILY' }));
  for (const goal of [{ name: 'Trip', targetMinor: '0', targetDate: '2027-01-01', accountId: 'ACC-DAILY' }, { name: 'Trip', targetMinor: '100', targetDate: '2026-06-30', accountId: 'ACC-DAILY' }, { name: 'Trip', targetMinor: '100', targetDate: '2027-01-01', accountId: 'MISSING' }]) assert.throws(() => make({ goal }));
  for (const budgets of [[{ categoryId: 'NOPE', monthlyMinor: '100' }], [{ categoryId: 'SALARY', monthlyMinor: '100' }], [{ categoryId: 'GROCERIES', monthlyMinor: '-1' }], [{ categoryId: 'GROCERIES', monthlyMinor: '99999999999999' }], [{ categoryId: 'GROCERIES', monthlyMinor: '1' }, { categoryId: 'GROCERIES', monthlyMinor: '2' }]]) assert.throws(() => make({ budgets }));
});

test('the Google payload reconstructs the exact expected entered-cell map without assuming the default tab ID', () => {
  const plan = make(), sheets = effectiveEmptyWorkbook(plan);
  assert.equal(sheets.size, 22, 'The verified-empty initial provider tab is the bootstrap writer’s explicit cleanup responsibility.');
  assert.equal(plan.verification.sheets.length, 21);
  assert.ok(plan.verification.sheets.every(sheet => sheet.sheetId >= 1000 && sheet.sheetId <= 1020));
  const actual = [];
  for (const expected of plan.verification.sheets) {
    const sheet = sheets.get(expected.sheetId);
    assert.equal(sheet.title, expected.title);
    for (const [key, userEnteredValue] of sheet.values) {
      const [rowIndex, columnIndex] = key.split(':').map(Number);
      assert.ok(rowIndex < expected.rowCount && columnIndex < expected.columnCount);
      actual.push({ sheetId: expected.sheetId, rowIndex, columnIndex, userEnteredValue });
    }
  }
  assert.deepEqual(new Map(actual.map(cell => [cellKey(cell), cell.userEnteredValue])), new Map(plan.verification.cells.map(cell => [cellKey(cell), cell.userEnteredValue])));
  assert.deepEqual(expectedFingerprints(actual, plan.verification.sheets), { formulaFingerprint: plan.verification.formulaFingerprint, inputFingerprint: plan.verification.inputFingerprint });
  const tampered = structuredClone(actual);
  tampered.find(cell => cell.userEnteredValue.formulaValue).userEnteredValue.formulaValue = '=0';
  assert.notEqual(expectedFingerprints(tampered, plan.verification.sheets).formulaFingerprint, plan.verification.formulaFingerprint);
});

test('blank setup retains no fictional records or input configuration and exposes unavailable domains without numeric stand-ins', () => {
  const plan = make();
  for (const title of ['Loans', 'Assets', 'Goals', 'Subscriptions']) assert.ok(values(plan, title).every(cell => cell.rowIndex === 0));
  for (const title of ['Mortgage Scenarios', 'Tax Forecast', 'Savings Finder']) assert.ok(values(plan, title).every(cell => !cell.userEnteredValue.formulaValue && cell.userEnteredValue.numberValue === undefined));
  assert.ok(!/Davies|Calder|Jordan|Mia|Harbour Bank|Southern Card|Wattle Credit Union|Brunswick|Geelong/.test(JSON.stringify(plan.verification.cells)));
  assert.equal(cell(plan, 'Kitty', 17, 2).stringValue, 'no');
  for (const row of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 29, 33]) assert.equal(cell(plan, 'Settings', row, 2), undefined);
  assert.ok(values(plan, 'Settings').filter(cell => cell.columnIndex >= 4 && cell.columnIndex <= 7).length === 0, 'No inherited tax-rate tables.');
  assert.ok(values(plan, 'Categories').every(cell => cell.rowIndex === 0 || cell.columnIndex !== 4));
  for (const row of [12, 15, 16, 17, 18, 19, 21, 22, 25, 26]) assert.equal(cell(plan, 'Metrics', row, 3), undefined);
  assert.ok(plan.reviewSummary.unavailableModules.includes('whole-household net worth'));
  assert.equal(plan.verification.status, 'requires-provider-recalculation');
  assert.deepEqual(plan.verification.allowErrors, []);
});

test('raw headers and helper anchors preserve the existing importer contract and metadata columns are explicitly reserved', () => {
  const plan = make();
  for (const title of ['Transactions', 'Payslips', 'Valuations']) {
    const original = source.sheets.find(sheet => sheet.properties.title === title);
    for (const originalCell of original.cells.filter(cell => cell.row === 1 || cell.value.formulaValue)) assert.deepEqual(cell(plan, title, originalCell.row, originalCell.column), originalCell.value, `${title} ${originalCell.row}:${originalCell.column}`);
  }
  assert.equal(cell(plan, 'Payslips', 1, 9).stringValue, 'Kitty record ID');
  assert.equal(cell(plan, 'Valuations', 1, 6).stringValue, 'Kitty record ID');
  for (const range of plan.verification.rawRecordRanges) assert.ok(plan.verification.checks.some(check => check.range === range && check.kind === 'blank'));
});

test('all generated formulas are balanced, internal and free of captured person/role branches', () => {
  const plan = make();
  const titles = new Set(plan.verification.sheets.map(sheet => sheet.title));
  for (const expected of plan.verification.cells) {
    const expression = expected.userEnteredValue.formulaValue;
    if (!expression) continue;
    assert.ok(balancedFormula(expression), expression);
    assert.doesNotMatch(expression, /Jordan|Mia|ACC-SAV|Loans!\$?[A-Z]+\$?2|IMPORTRANGE|IMPORTXML|IMPORTDATA|https?:/);
    const withoutStrings = expression.replace(/"(?:[^"]|"")*"/g, '');
    for (const match of withoutStrings.matchAll(/(?:'([^']+)'|([A-Za-z_][A-Za-z_0-9 ]*))!/g)) assert.ok(titles.has(match[1] || match[2]), expression);
  }
});

test('opening values are exact and historical formulas explicitly exclude the opening period and overlapping movements', () => {
  const plan = make({ accounts: [
    { ...base().accounts[0], id: 'A-CASH', openingMinor: '29' },
    { ...base().accounts[0], id: 'B-CARD', type: 'Credit card', openingMinor: '-19' },
  ], emergencyAccountId: 'A-CASH' });
  assert.equal(cell(plan, 'Accounts', 2, 6).numberValue, 0.29);
  assert.equal(cell(plan, 'Accounts', 3, 6).numberValue, -0.19);
  assert.equal(plan.reviewSummary.openingCashMinor, '10');
  assert.equal(plan.verification.checks.find(check => check.id === 'opening-cash').expected[0][0], '10');
  assert.equal(plan.verification.checks.find(check => check.id === 'opening-B-CARD').kind, 'minor');
  assert.match(formula(plan, 'Accounts', 2, 8), /Transactions!\$B:\$B,">"&\$G2/);
  for (let row = 5; row <= 20; row++) {
    assert.match(formula(plan, 'Net Worth', row, 2), new RegExp(`IF\\(\\$A${row}<Settings!\\$B\\$35,""`));
    assert.match(formula(plan, 'Net Worth', row, 2), /Transactions!\$B:\$B,">"&Settings!\$B\$35/);
  }
  assert.match(formula(plan, 'Cash Flow', 5, 2), /B\$4>=Settings!\$B\$36/);
  assert.match(formula(plan, 'Cash Flow', 5, 18), /EDATE\(Settings!\$B\$7,-2\)>=Settings!\$B\$36/);
  assert.match(formula(plan, 'Cash Flow', 5, 19), /EDATE\(Settings!\$B\$7,-14\)>=Settings!\$B\$36/);
  assert.equal(cell(plan, 'Settings', 37, 2).stringValue, 'A-CASH');
  assert.match(formula(plan, 'Metrics', 14, 3), /Settings!\$B\$37/);
  assert.ok(plan.verification.checks.some(check => check.id === 'no-invented-earlier-cash' && check.kind === 'blank'));
});

test('no-activity stays diagnostic while overlap and unknown identities remain Close blockers', () => {
  const plan = make();
  assert.equal(cell(plan, 'Compliance Checks', 19, 2).stringValue, 'Data');
  assert.match(cell(plan, 'Compliance Checks', 19, 6).stringValue, /statement for every account/);
  for (const row of [25, 26, 27, 28]) assert.equal(cell(plan, 'Compliance Checks', row, 2).stringValue, 'Close');
  assert.match(formula(plan, 'Compliance Checks', 25, 3), /"<="&Settings!B35/);
  assert.match(formula(plan, 'Compliance Checks', 27, 3), /Transactions!H2:H=""/);
  assert.match(formula(plan, 'Metrics', 28, 3), /"Close"/);
  assert.match(cell(plan, 'README', 11, 2).stringValue, /not proof/);
});

test('budgets distinguish omitted and explicit zero, and a goal uses the selected account without premature progress claims', () => {
  const plan = make({ budgets: [{ categoryId: 'GROCERIES', monthlyMinor: '0' }, { categoryId: 'SHOPPING', monthlyMinor: '2500' }], goal: { name: 'Learning trip', targetMinor: '500000', targetDate: '2027-06-30', accountId: 'ACC-DAILY' } });
  assert.equal(cell(plan, 'Categories', 9, 5).numberValue, 0);
  assert.equal(cell(plan, 'Categories', 18, 5).numberValue, 25);
  assert.equal(cell(plan, 'Categories', 16, 5), undefined);
  assert.match(formula(plan, 'Budget', 7, 1), /IFERROR\(FILTER/);
  assert.match(formula(plan, 'Budget', 7, 1), /ISNUMBER\(Categories!E2:E\)/);
  assert.match(formula(plan, 'Budget', 7, 9), /E7>F7/);
  assert.match(formula(plan, 'Budget', 7, 5), /Settings!\$B\$36<=DATE/);
  assert.equal(cell(plan, 'Goals', 2, 4).stringValue, 'ACC-DAILY');
  assert.equal(cell(plan, 'Goals', 2, 2).numberValue, 5000);
  assert.match(formula(plan, 'Goals', 2, 10), /Awaiting three months of history/);
  assert.equal(values(plan, 'Goals').filter(cell => cell.columnIndex === 0 && cell.rowIndex > 0).length, 1);
});

test('100 accounts and enlarged raw capacities receive formulas, formats and person validation beyond the demo limits', () => {
  const accounts = Array.from({ length: 100 }, (_, index) => ({ ...base().accounts[0], id: 'ACC-' + String(index).padStart(3, '0'), openingMinor: '1' }));
  const plan = make({ people: ['Sam', 'Lee'], accounts, capacity: { transactions: 10000, payslips: 2000, valuations: 1500 } });
  assert.ok(formula(plan, 'Accounts', 101, 8));
  assert.equal(table(plan, 'Transactions').rowCount, 10001);
  assert.equal(table(plan, 'Payslips').rowCount, 2001);
  assert.equal(table(plan, 'Valuations').rowCount, 1501);
  const txId = table(plan, 'Transactions').sheetId, payId = table(plan, 'Payslips').sheetId;
  const rules = plan.batchUpdate.requests.flatMap(request => request.repeatCell ? [request.repeatCell] : []);
  const txPeople = rules.find(rule => rule.range.sheetId === txId && rule.range.startColumnIndex === 7 && rule.fields === 'dataValidation');
  assert.equal(txPeople.range.endRowIndex, 10001);
  assert.deepEqual(txPeople.cell.dataValidation.condition.values.map(value => value.userEnteredValue), ['Sam', 'Lee', 'Joint']);
  const payPeople = rules.find(rule => rule.range.sheetId === payId && rule.range.startColumnIndex === 1 && rule.fields === 'dataValidation');
  assert.equal(payPeople.range.endRowIndex, 2001);
  assert.deepEqual(payPeople.cell.dataValidation.condition.values.map(value => value.userEnteredValue), ['Sam', 'Lee']);
  assert.ok(rules.some(rule => rule.range.sheetId === txId && rule.range.endRowIndex === 10001 && rule.cell.userEnteredFormat?.numberFormat.type === 'DATE'));
  assert.ok(plan.adaptations.batchBytes < 1_900_000);
});

test('formula-like user names remain literal strings rather than executable formulas', () => {
  const attack = '=IMPORTRANGE("https://example.invalid","A1")';
  const plan = make({ householdName: attack, accounts: [{ ...base().accounts[0], name: attack, institution: attack }], goal: { name: attack, targetMinor: '100', targetDate: '2026-12-31', accountId: 'ACC-DAILY' } });
  assert.equal(cell(plan, 'Settings', 5, 2).stringValue, attack);
  assert.equal(cell(plan, 'Accounts', 2, 2).stringValue, attack);
  assert.equal(cell(plan, 'Goals', 2, 1).stringValue, attack);
  assert.ok(plan.verification.cells.filter(cell => cell.userEnteredValue.formulaValue).every(cell => !cell.userEnteredValue.formulaValue.includes('IMPORTRANGE')));
});

test('an initial readback fixture follows the existing native projection contract; this does not recalculate Google formulas', () => {
  const plan = make(), grids = {};
  const keys = { Settings: 'settings', Kitty: 'kitty', Accounts: 'accounts', Categories: 'category_list', Goals: 'goals', Subscriptions: 'subscriptions', Loans: 'loans', Assets: 'assets', Metrics: 'metrics', 'Compliance Checks': 'compliance', 'Net Worth': 'networth', 'Cash Flow': 'cashflow', Budget: 'budget', 'Savings Finder': 'savings', 'Mortgage Scenarios': 'mortgage', 'Tax Forecast': 'tax', Transactions: 'transactions', Payslips: 'payslips' };
  for (const sheet of plan.verification.sheets) {
    if (!keys[sheet.title]) continue;
    const rows = [];
    for (const entered of values(plan, sheet.title)) {
      rows[entered.rowIndex] ??= [];
      rows[entered.rowIndex][entered.columnIndex] = entered.userEnteredValue.stringValue ?? entered.userEnteredValue.numberValue ?? '';
    }
    for (let index = 0; index < rows.length; index++) rows[index] ??= [];
    grids[keys[sheet.title]] = rows;
  }
  // Supply only the known initial effective facts asserted by provider acceptance.
  grids.accounts[1][7] = 123.45;
  grids.metrics[12][2] = 123.45;
  const context = { console }; vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../ios/Kitty/Resources/bridge.js', import.meta.url), 'utf8'), context);
  const snapshot = context.NativeKitty.fromGrids(grids);
  const projected = context.NativeKitty.project(snapshot);
  assert.equal(projected.household, 'River household');
  assert.equal(projected.accounts[0].id, 'ACC-DAILY');
  assert.equal(projected.accounts[0].balance, 123.45);
  assert.deepEqual(Array.from(projected.people), ['Sam']);
  assert.equal(projected.transactions.length, 0);
  assert.equal(projected.planning.mortgage, null);
  assert.equal(projected.metrics['networth.total'].num, null);
  assert.equal(projected.publicFeedEnabled, false);
});
