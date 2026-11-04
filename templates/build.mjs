import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PROFILE = Object.freeze({ id: 'au-aud-basic', version: '1.0.0', sheetVersion: 1, country: 'AU', currency: 'AUD' });
export const SOURCE_SHA256 = '41743ff2a6bcbc21fc112656a4a3af71d9d2d233aa23657e801b3112ad4268ab';
const sourceBytes = readFileSync(new URL('./source/davies-v1.json', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(sourceBytes) !== SOURCE_SHA256) throw new Error('The pinned template source changed. Review and version it before generating a workbook.');
const SOURCE = JSON.parse(sourceBytes);
const MAX_MINOR = 99_999_999_999_999n;
const TYPES = ['Transaction', 'Savings', 'Offset', 'Credit card'];
const DEFAULT_CAPACITY = Object.freeze({ transactions: 2000, payslips: 500, valuations: 500 });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const clone = value => JSON.parse(JSON.stringify(value));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const digest = value => hash(canonical(value));
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function keys(value, allowed, label) {
  requireThat(plain(value), `${label} must be an object.`);
  requireThat(Object.keys(value).every(key => allowed.includes(key)), `${label} contains an unsupported field.`);
}
function name(value, label, max = 100) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value), `${label} must be nonempty text of at most ${max} characters without control characters.`);
  return value.trim().normalize('NFC');
}
function minor(value, label, nonnegative = false) {
  requireThat(typeof value === 'string' && /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value) && value.length <= 15, `${label} must be a canonical integer minor-unit string.`);
  const amount = BigInt(value);
  requireThat(amount >= -MAX_MINOR && amount <= MAX_MINOR && (!nonnegative || amount >= 0n), `${label} is outside the supported currency range.`);
  return value;
}
function day(value, label) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${label} must be YYYY-MM-DD.`);
  const date = new Date(value + 'T00:00:00Z');
  requireThat(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && +value.slice(0, 4) >= 1900 && +value.slice(0, 4) <= 2200, `${label} must be a real supported calendar date.`);
  return value;
}
function monthEnd(value) {
  const date = new Date(value + 'T00:00:00Z');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}
const nextDay = value => new Date(Date.parse(value + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const serial = value => (Date.parse(value + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000;
const decimal = value => Number(BigInt(value)) / 100;
const col = number => { let result = ''; for (; number; number = Math.floor((number - 1) / 26)) result = String.fromCharCode(65 + (number - 1) % 26) + result; return result; };
const quoted = title => "'" + title.replaceAll("'", "''") + "'";
const ref = (title, coordinate) => quoted(title) + '!' + coordinate;
const categorySource = () => {
  const table = SOURCE.sheets.find(sheet => sheet.properties.title === 'Categories');
  const rows = new Map();
  for (const cell of table.cells.filter(cell => cell.row > 1)) {
    if (!rows.has(cell.row)) rows.set(cell.row, {});
    rows.get(cell.row)[cell.column] = cell.value.stringValue ?? cell.value.numberValue;
  }
  return [...rows.values()].map(row => ({ id: row[1], name: row[2], flow: row[4] }));
};

export function validateInput(input) {
  keys(input, ['profile', 'sheetVersion', 'country', 'currency', 'householdName', 'people', 'openingDate', 'accounts', 'budgets', 'emergencyAccountId', 'goal', 'capacity'], 'Setup');
  requireThat(input.profile === PROFILE.id && input.sheetVersion === 1 && (input.country === undefined || input.country === 'AU') && (input.currency === undefined || input.currency === 'AUD'), 'Only the explicit au-aud-basic, sheetVersion 1 profile is supported.');
  const householdName = name(input.householdName, 'Household name', 100);
  requireThat(Array.isArray(input.people) && input.people.length >= 1 && input.people.length <= 2, 'Choose one or two people.');
  const people = input.people.map(value => name(value, 'Person name', 80));
  requireThat(people.every(value => !value.includes(',') && value.toLowerCase() !== 'joint') && new Set(people.map(value => value.toLowerCase())).size === people.length, 'Person names must be unique, without commas or the reserved name Joint.');
  const openingDate = day(input.openingDate, 'Opening date');
  requireThat(openingDate === monthEnd(openingDate), 'Opening date must be a calendar month end.');
  day(nextDay(openingDate), 'First import date');
  requireThat(Array.isArray(input.accounts) && input.accounts.length >= 1 && input.accounts.length <= 100, 'Configure between 1 and 100 accounts.');
  const accounts = input.accounts.map(account => {
    keys(account, ['id', 'name', 'institution', 'type', 'owner', 'openingMinor'], 'Account');
    requireThat(typeof account.id === 'string' && /^[A-Z][A-Z0-9-]{0,39}$/.test(account.id), 'Account IDs must be immutable uppercase letters, digits or hyphens, beginning with a letter.');
    requireThat(TYPES.includes(account.type), 'Choose Transaction, Savings, Offset or Credit card for each account.');
    requireThat([...people, 'Joint'].includes(account.owner), 'Every account owner must match a configured person or Joint exactly.');
    return { id: account.id, name: name(account.name, 'Account name'), institution: name(account.institution, 'Institution'), type: account.type, owner: account.owner, openingMinor: minor(account.openingMinor, 'Opening balance') };
  }).sort((a, b) => compare(a.id, b.id));
  requireThat(new Set(accounts.map(account => account.id)).size === accounts.length, 'Account IDs must be unique.');
  requireThat(accounts.reduce((total, account) => total + (BigInt(account.openingMinor) < 0n ? -BigInt(account.openingMinor) : BigInt(account.openingMinor)), 0n) <= MAX_MINOR, 'The total absolute opening balances exceed the supported exact range.');
  const categoryMap = new Map(categorySource().map(category => [category.id, category]));
  const rawBudgets = input.budgets ?? [];
  requireThat(Array.isArray(rawBudgets) && rawBudgets.length <= categoryMap.size, 'Budgets must be a bounded list of existing expense categories.');
  const budgets = rawBudgets.map(budget => {
    keys(budget, ['categoryId', 'monthlyMinor'], 'Budget');
    requireThat(categoryMap.get(budget.categoryId)?.flow === 'Expense', 'A budget must refer to an existing expense category.');
    return { categoryId: budget.categoryId, monthlyMinor: minor(budget.monthlyMinor, 'Monthly budget', true) };
  }).sort((a, b) => compare(a.categoryId, b.categoryId));
  requireThat(new Set(budgets.map(budget => budget.categoryId)).size === budgets.length, 'A category may have only one budget.');
  requireThat(budgets.reduce((total, budget) => total + BigInt(budget.monthlyMinor) * 12n, 0n) <= MAX_MINOR, 'The annual budgets exceed the supported exact range.');
  const emergencyAccountId = input.emergencyAccountId ?? null;
  if (emergencyAccountId !== null) requireThat(accounts.some(account => account.id === emergencyAccountId && account.type !== 'Credit card'), 'The emergency account must be a configured non-card account.');
  let goal = null;
  if (input.goal !== undefined && input.goal !== null) {
    keys(input.goal, ['name', 'targetMinor', 'targetDate', 'accountId'], 'Goal');
    goal = { name: name(input.goal.name, 'Goal name'), targetMinor: minor(input.goal.targetMinor, 'Goal target', true), targetDate: day(input.goal.targetDate, 'Goal date'), accountId: input.goal.accountId };
    requireThat(BigInt(goal.targetMinor) > 0n && goal.targetDate > openingDate, 'A goal needs a positive target and a date after the opening anchor.');
    requireThat(accounts.some(account => account.id === goal.accountId && account.type !== 'Credit card'), 'The goal must link to a configured non-card account.');
  }
  const capacity = { ...DEFAULT_CAPACITY };
  if (input.capacity !== undefined) {
    keys(input.capacity, Object.keys(capacity), 'Capacity');
    for (const [key, value] of Object.entries(input.capacity)) {
      requireThat(Number.isSafeInteger(value) && value >= 1 && value <= 100000, 'Raw-table capacities must be integer record counts between 1 and 100000.');
      capacity[key] = value;
    }
  }
  return { profile: PROFILE.id, sheetVersion: 1, country: 'AU', currency: 'AUD', householdName, people, openingDate, accounts, budgets, emergencyAccountId, goal, capacity };
}

class Workbook {
  constructor() {
    this.sheets = clone(SOURCE.sheets);
    // A Drive-created workbook commonly owns tab 0 already. Generated IDs must
    // never collide with that tab while the atomic batch adds this schema.
    this.sheets.forEach((sheet, index) => { sheet.properties.sheetId = 1000 + index; });
  }
  sheet(title) { const sheet = this.sheets.find(sheet => sheet.properties.title === title); requireThat(sheet, 'Unknown generated tab: ' + title); return sheet; }
  clear(title, predicate = () => true) { const sheet = this.sheet(title); sheet.cells = sheet.cells.filter(cell => !predicate(cell)); }
  set(title, row, column, value) {
    this.clear(title, cell => cell.row === row && cell.column === column);
    if (value !== null && value !== undefined) this.sheet(title).cells.push({ row, column, value });
  }
  text(title, row, column, value) { this.set(title, row, column, value === null ? null : { stringValue: value }); }
  number(title, row, column, value) { this.set(title, row, column, { numberValue: value }); }
  formula(title, row, column, value) { this.set(title, row, column, { formulaValue: value }); }
  row(title, row, values) { values.forEach((value, index) => this.set(title, row, index + 1, value === null ? null : typeof value === 'number' ? { numberValue: value } : { stringValue: value })); }
  format(title, column, startRow, endRow, type, pattern) { this.sheet(title).numberFormats.push({ column, startRow, endRow, value: { type, pattern } }); }
  finish(properties) {
    for (const sheet of this.sheets) {
      sheet.cells.sort((a, b) => a.row - b.row || a.column - b.column);
      for (const key of ['dataValidation', 'numberFormats']) sheet[key].sort((a, b) => a.column - b.column || a.startRow - b.startRow || a.endRow - b.endRow);
    }
    return { properties, sheets: this.sheets };
  }
}
const f = value => value.slice(1);
const available = 'Settings!$B$6>=Settings!$B$36';
const threeMonths = 'EDATE(Settings!$B$7,-2)>=Settings!$B$36';
const priorThreeMonths = 'EDATE(Settings!$B$7,-14)>=Settings!$B$36';
const yearCovered = 'Settings!$B$36<=DATE(YEAR(Settings!$B$6)-IF(MONTH(Settings!$B$6)<7,1,0),7,1)';
const guarded = (condition, formula) => `=IF(${condition},${f(formula)},"")`;
function rawTables(book, input) {
  for (const [title, key, columns] of [['Transactions', 'transactions', 17], ['Payslips', 'payslips', 9], ['Valuations', 'valuations', 6]]) {
    const sheet = book.sheet(title), endRow = input.capacity[key] + 1;
    sheet.properties.gridProperties = { rowCount: endRow, columnCount: columns, frozenRowCount: 1 };
    for (const kind of ['dataValidation', 'numberFormats']) sheet[kind] = sheet[kind].map(rule => ({ ...rule, startRow: 2, endRow }));
    for (const rule of sheet.dataValidation) if ((title === 'Transactions' && rule.column === 8) || (title === 'Payslips' && rule.column === 2)) rule.value.condition.values = (title === 'Transactions' ? [...input.people, 'Joint'] : input.people).map(userEnteredValue => ({ userEnteredValue }));
  }
  book.text('Payslips', 1, 9, 'Kitty record ID');
  book.text('Valuations', 1, 6, 'Kitty record ID');
  book.sheet('Transactions').dataValidation.push({ startRow: 2, endRow: input.capacity.transactions + 1, column: 2,
    value: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND(ISNUMBER(B2),B2>INDIRECT("Settings!B35"))' }] }, strict: true, showCustomUi: true,
      inputMessage: 'Use a date after the opening anchor. Earlier movements are already included in opening balances.' } });
}
function configuration(book, input, inputSha256) {
  book.clear('Kitty');
  book.row('Kitty', 1, ['Kitty settings']);
  book.row('Kitty', 2, ['Household metadata. The Google Sheet owns accepted records and calculations.']);
  book.row('Kitty', 4, ['Key', 'Value', 'Note']);
  const metadata = [
    ['household_name', input.householdName, 'The household on this Sheet.'], ['people', input.people.join(', '), 'Exact person names. Joint is an account or transaction owner, not an ownership share.'],
    ['country', 'AU', 'This template profile supports Australia.'], ['currency', 'AUD', 'All supported records use AUD; no conversion.'],
    ['lead_goal', input.goal?.name ?? null, 'Optional configured goal.'], ['greeting_name', input.people.join(' and '), 'Display greeting.'],
    ['pay_cycle', null, 'Not configured. No pay cycle is inferred.'], ['onboarded_at', null, 'Bootstrap may record this after provider readback.'],
    ['accent', 'teal', 'Template presentation default.'], ['sheet_version', 1, 'Existing raw-table contract.'],
    ['big_bill_amount', null, 'Not configured.'], ['look_ahead_days', 35, 'Presentation horizon; does not create expected payments.'],
    ['public_feed', 'no', 'The known public JSON feed is off. This is separate from Drive sharing.'],
    ['template_profile', PROFILE.id, 'Basic accounts, cash flow, explicit budgets and an optional goal.'], ['template_version', PROFILE.version, 'Generator profile version.'],
    ['template_source_sha256', SOURCE_SHA256, 'Pinned public source capture.'], ['setup_input_sha256', inputSha256, 'Digest of the original reviewed setup, not proof of later configuration.'],
    ['optional_modules', 'unavailable', 'Tax, mortgage, assets and subscriptions need a separately supported configuration.'],
  ];
  metadata.forEach((row, index) => book.row('Kitty', index + 5, row));

  // Preserve A:B positions used by captured formulas. Remove all household/tax
  // assumptions, while retaining financial-year derivations and cadence units.
  const keepFormulaRows = new Set([7, 8, 9, 10, 34]);
  book.clear('Settings', cell => cell.column >= 5 && cell.column <= 8 || cell.column === 2 && cell.row >= 5 && !keepFormulaRows.has(cell.row));
  book.text('Settings', 2, 1, 'Only explicit setup values are populated. Optional financial assumptions remain unavailable.');
  book.text('Settings', 5, 2, input.householdName);
  book.number('Settings', 6, 2, serial(input.openingDate));
  book.text('Settings', 6, 3, 'Opening anchor until the first evidence-backed close. Advance only through the close workflow.');
  for (const row of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 33]) book.text('Settings', row, 3, 'Unavailable until this optional setting is explicitly configured.');
  for (const [row, label] of [[11, 'Person 1 share of joint items'], [12, 'Person 2 share of joint items'], [14, 'Work-from-home hours, person 1, prior year'], [15, 'Work-from-home hours, person 2, prior year'], [16, 'Work-from-home hours, person 1, current year to date'], [17, 'Work-from-home hours, person 2, current year to date']]) book.text('Settings', row, 1, label);
  book.number('Settings', 31, 2, 0);
  book.text('Settings', 31, 3, 'Basic-profile policy: spending above an explicit budget is Over. No inherited tolerance.');
  book.number('Settings', 32, 2, 0);
  book.text('Settings', 32, 3, 'A growth comparison needs positive prior spending and complete comparison windows.');
  book.row('Settings', 35, ['Opening anchor date', serial(input.openingDate), 'Common statement-close opening date for configured accounts.']);
  book.row('Settings', 36, ['History starts', null, 'Earlier periods are unknown, not zero.']);
  book.formula('Settings', 36, 2, '=B35+1');
  book.row('Settings', 37, ['Emergency fund account ID', input.emergencyAccountId, 'Optional explicit account role; never inferred from its name or row.']);
  book.format('Settings', 2, 35, 36, 'DATE', 'yyyy-mm-dd');

  for (const title of ['Accounts', 'Loans', 'Assets', 'Goals', 'Subscriptions']) {
    book.clear(title, cell => cell.row > 1);
    book.sheet(title).numberFormats = [];
    book.sheet(title).dataValidation = [];
  }
  input.accounts.forEach((account, index) => {
    const row = index + 2;
    book.row('Accounts', row, [account.id, account.name, account.institution, account.type, account.owner, decimal(account.openingMinor), serial(input.openingDate), null, 'Yes']);
    book.formula('Accounts', row, 8, `=IF(Settings!$B$6<$G${row},"",$F${row}+SUMIFS(Transactions!$F:$F,Transactions!$C:$C,$A${row},Transactions!$B:$B,">"&$G${row},Transactions!$B:$B,"<="&Settings!$B$6))`);
  });
  book.format('Accounts', 6, 2, input.accounts.length + 1, 'NUMBER', '$#,##0.00;($#,##0.00);"-"');
  book.format('Accounts', 7, 2, input.accounts.length + 1, 'DATE', 'yyyy-mm-dd');
  book.format('Accounts', 8, 2, input.accounts.length + 1, 'NUMBER', '$#,##0.00;($#,##0.00);"-"');
  book.clear('Categories', cell => cell.row > 1 && cell.column === 5);
  const categoryRows = new Map(book.sheet('Categories').cells.filter(cell => cell.column === 1 && cell.row > 1).map(cell => [cell.value.stringValue, cell.row]));
  for (const budget of input.budgets) book.number('Categories', categoryRows.get(budget.categoryId), 5, decimal(budget.monthlyMinor));
}
function cashflow(book) {
  const sheet = book.sheet('Cash Flow');
  for (const cell of [...sheet.cells]) {
    const formula = cell.value.formulaValue;
    if (!formula || cell.row <= 4) continue;
    if (cell.column >= 2 && cell.column <= 17) book.formula('Cash Flow', cell.row, cell.column, guarded(`${col(cell.column)}$4>=Settings!$B$36`, formula));
    else if (cell.column === 18) book.formula('Cash Flow', cell.row, cell.column, guarded(threeMonths, formula));
    else if (cell.column === 19) book.formula('Cash Flow', cell.row, cell.column, guarded(priorThreeMonths, formula));
    else if (cell.column === 20) book.formula('Cash Flow', cell.row, cell.column, guarded(`AND(${threeMonths},${priorThreeMonths})`, formula));
  }
  book.formula('Cash Flow', 22, 1, '=IFERROR(FILTER(Categories!B2:B,Categories!D2:D="Expense"),"")');
}
function budgetAndGoal(book, input) {
  const expenseCount = categorySource().filter(category => category.flow === 'Expense').length;
  book.clear('Budget', cell => cell.row >= 5);
  book.text('Budget', 2, 1, 'Only explicitly configured budgets are shown. Monthly actuals need a closed period; year-to-date comparisons need history from 1 July. A zero budget is an explicit zero limit.');
  book.text('Budget', 5, 1, 'Total');
  book.formula('Budget', 7, 1, '=IFERROR(FILTER(Categories!B2:B,Categories!D2:D="Expense",ISNUMBER(Categories!E2:E)),"")');
  const end = 6 + expenseCount;
  for (let row = 7; row <= end; row++) {
    const ifName = expression => `=IF($A${row}="","",${expression})`;
    book.formula('Budget', row, 2, ifName(`SUMIFS(Categories!$E:$E,Categories!$B:$B,$A${row})`));
    book.formula('Budget', row, 3, ifName(`IF(${available},-SUMIFS(Transactions!$F:$F,Transactions!$M:$M,$A${row},Transactions!$K:$K,Settings!$B$7),"")`));
    book.formula('Budget', row, 4, ifName(`IF(${threeMonths},-SUMIFS(Transactions!$F:$F,Transactions!$M:$M,$A${row},Transactions!$B:$B,">"&EDATE(Settings!$B$6,-3),Transactions!$B:$B,"<="&Settings!$B$6)/3,"")`));
    book.formula('Budget', row, 5, ifName(`IF(AND(${available},${yearCovered}),-SUMIFS(Transactions!$F:$F,Transactions!$M:$M,$A${row},Transactions!$B:$B,"<="&Settings!$B$6,Transactions!$L:$L,Settings!$B$8),"")`));
    book.formula('Budget', row, 6, ifName(`IF(AND(${available},${yearCovered}),IF(COUNTIFS(Categories!$B:$B,$A${row},Categories!$I:$I,"Lumpy"),B${row}*12,B${row}*Settings!$B$10),"")`));
    book.formula('Budget', row, 7, ifName(`IF(ISNUMBER(E${row}),F${row}-E${row},"")`));
    book.formula('Budget', row, 8, ifName(`IF(ISNUMBER(E${row}),IF(F${row}=0,IF(E${row}=0,0,""),E${row}/F${row}),"")`));
    book.formula('Budget', row, 9, ifName(`IF(ISNUMBER(E${row}),IF(E${row}>F${row},"Over","Under"),"Awaiting full-year history")`));
  }
  for (let column = 2; column <= 7; column++) {
    const letter = col(column);
    book.formula('Budget', 5, column, `=IF(COUNT(${letter}7:${letter}${end})=0,"",SUM(${letter}7:${letter}${end}))`);
  }
  book.formula('Budget', 5, 8, '=IF(AND(ISNUMBER(E5),ISNUMBER(F5)),IF(F5=0,IF(E5=0,0,""),E5/F5),"")');
  book.sheet('Budget').numberFormats = [];
  for (let column = 2; column <= 7; column++) book.format('Budget', column, 5, end, 'NUMBER', '$#,##0.00;($#,##0.00);"-"');
  book.format('Budget', 8, 5, end, 'PERCENT', '0.0%');

  if (input.goal) {
    const goal = input.goal;
    book.row('Goals', 2, [goal.name, decimal(goal.targetMinor), serial(goal.targetDate), goal.accountId]);
    book.formula('Goals', 2, 5, '=IFERROR(VLOOKUP(D2,Accounts!$A:$H,8,FALSE),"")');
    book.formula('Goals', 2, 6, '=IF(ISNUMBER(E2),MIN(1,MAX(0,E2)/B2),"")');
    book.formula('Goals', 2, 7, '=IF(C2<=Settings!$B$6,0,DATEDIF(Settings!$B$6,C2,"M"))');
    book.formula('Goals', 2, 8, '=IF(ISNUMBER(E2),IF(G2=0,MAX(0,B2-E2),MAX(0,B2-E2)/G2),"")');
    book.formula('Goals', 2, 9, `=IF(${threeMonths},SUMIFS(Transactions!$F:$F,Transactions!$C:$C,D2,Transactions!$B:$B,">"&EDATE(Settings!$B$6,-3),Transactions!$B:$B,"<="&Settings!$B$6)/3,"")`);
    book.formula('Goals', 2, 10, '=IF(NOT(ISNUMBER(E2)),"Awaiting balance",IF(E2>=B2,"Reached",IF(NOT(ISNUMBER(I2)),"Awaiting three months of history",IF(I2>=H2,"On track","Behind"))))');
    for (const column of [2, 5, 8, 9]) book.format('Goals', column, 2, 2, 'NUMBER', '$#,##0.00;($#,##0.00);"-"');
    book.format('Goals', 3, 2, 2, 'DATE', 'yyyy-mm-dd');
    book.format('Goals', 6, 2, 2, 'PERCENT', '0.0%');
  }
}
function optionalDomains(book, input) {
  // Do not keep evaluable skeletons that manufacture an absent loan, tax refund
  // or whole-household net worth from unconfigured domain inputs.
  for (const title of ['Mortgage Scenarios', 'Tax Forecast', 'Savings Finder']) {
    book.clear(title);
    book.sheet(title).numberFormats = [];
    book.sheet(title).dataValidation = [];
    book.text(title, 1, 1, title);
    book.text(title, 2, 1, 'Unavailable in the basic household profile. No figures have been inferred; this domain needs a separately reviewed configuration.');
  }
  book.row('Tax Forecast', 4, ['Person', input.people[0], input.people[1] ?? null, input.people[0], input.people[1] ?? null]);
  book.row('Savings Finder', 4, ['Opportunity', 'What the data shows', 'Estimated saving ($)', 'Type', 'Effort', 'Where to look', 'Rank']);
  // Keep the view schema consumed by the app. Cash is supported; the complete
  // net-worth and optional class series are deliberately unavailable.
  book.text('Net Worth', 2, 1, 'Cash begins at the opening anchor. Whole-household net worth and asset classes are unavailable until their domains are configured.');
  for (let row = 5; row <= 20; row++) {
    book.formula('Net Worth', row, 2, `=IF($A${row}<Settings!$B$35,"",SUM(Accounts!$F$2:$F)+SUMIFS(Transactions!$F:$F,Transactions!$B:$B,">"&Settings!$B$35,Transactions!$B:$B,"<="&$A${row}))`);
    for (let column = 3; column <= 9; column++) book.set('Net Worth', row, column, null);
  }
  const disabledMetrics = new Set(['networth.total', 'savings.recurring_per_year', 'savings.one_off', 'subscriptions.unused', 'tax.refund.prior_year', 'tax.refund.current_year', 'mortgage.stress.monthly', 'mortgage.payoff_years', 'tax.refund.corrected.prior_year', 'tax.refund_at_risk.prior_year']);
  for (const cell of [...book.sheet('Metrics').cells]) if (cell.column === 1 && disabledMetrics.has(cell.value.stringValue)) {
    for (const column of [3, 5, 6, 7]) book.set('Metrics', cell.row, column, null);
    book.text('Metrics', cell.row, 5, 'Unavailable in this profile');
  }
  book.formula('Metrics', 10, 3, '=IF(COUNT(Budget!E7:E)=0,"",COUNTIF(Budget!I7:I,"Over"))');
  book.formula('Metrics', 10, 6, '=COUNT(Budget!B7:B)');
  book.formula('Metrics', 13, 6, '=IF(ISNUMBER(\'Net Worth\'!B8),\'Net Worth\'!B8,"")');
  book.formula('Metrics', 14, 3, `=IF(AND(Settings!$B$37<>"",${threeMonths}),IF(('Cash Flow'!R10+'Cash Flow'!R11)>0,MAX(0,SUMIFS(Accounts!H:H,Accounts!A:A,Settings!$B$37))/('Cash Flow'!R10+'Cash Flow'!R11),""),"")`);
  book.set('Metrics', 14, 6, null);
  book.text('Metrics', 14, 7, 'No coverage target has been configured');
  book.formula('Metrics', 23, 3, '=IF(COUNTA(Goals!A2:A)=0,"",IF(COUNT(Goals!I2:I)=0,"",COUNTIF(Goals!J2:J,"Behind")))');
  for (const row of [5, 6, 7, 8, 9, 11]) for (const column of [3, 6]) {
    const cell = book.sheet('Metrics').cells.find(cell => cell.row === row && cell.column === column);
    if (cell?.value.formulaValue) {
      const expression = f(cell.value.formulaValue);
      book.formula('Metrics', row, column, `=IF(ISNUMBER(${expression}),${expression},"")`);
    }
  }
  for (const coordinate of [[24, 3], [24, 6], [27, 3], [27, 5], [27, 6], [27, 7]]) {
    const [row, column] = coordinate, original = book.sheet('Metrics').cells.find(cell => cell.row === row && cell.column === column).value.formulaValue;
    book.formula('Metrics', row, column, `=IF(${row === 24 ? `AND(${threeMonths},${priorThreeMonths})` : available},IFERROR(${f(original)},""),"")`);
  }
}
function checks(book) {
  // Tax advice is outside this profile. Preserve check labels/rows for compatible
  // readers, while making unsupported results explicitly unavailable.
  for (const row of [5, 6, 7, 8, 9]) {
    for (const column of [3, 4]) book.set('Compliance Checks', row, column, null);
    book.text('Compliance Checks', row, 5, 'Unavailable');
    book.text('Compliance Checks', row, 6, 'Tax setup and evidence are not configured in this profile.');
  }
  // Prior-year salary checks require that entire prior year, not an empty table.
  for (const column of [3, 4]) {
    const original = book.sheet('Compliance Checks').cells.find(cell => cell.row === 10 && cell.column === column).value.formulaValue;
    book.formula('Compliance Checks', 10, column, guarded('Settings!$B$36<=Settings!$B$34', original));
  }
  book.formula('Compliance Checks', 10, 5, '=IF(ISNUMBER(C10),IF(C10>0,"Review","OK"),"Unavailable")');
  book.formula('Compliance Checks', 13, 3, '=IFERROR(ROWS(UNIQUE(FILTER({Transactions!B2:B,Transactions!C2:C,Transactions!E2:E,Transactions!F2:F},Transactions!Q2:Q>1,Transactions!O2:O="Expense",Transactions!B2:B<=Settings!B6))),0)');
  book.set('Compliance Checks', 13, 4, null);
  book.text('Compliance Checks', 13, 6, 'Identical date, account, merchant and amount need review. Repeated real charges are possible; this is not proof of money to recover.');
  book.text('Compliance Checks', 14, 6, 'A nonzero total needs review. A zero total alone does not prove matching transfer pairs; the close checks original evidence.');
  // Empty bank activity is a diagnostic, never a substitute for the source-
  // backed all-account statement check already required by KittyClose.
  book.text('Compliance Checks', 19, 1, 'Accounts with no activity in the latest month');
  book.text('Compliance Checks', 19, 2, 'Data');
  book.formula('Compliance Checks', 19, 3, `=IF(${available},SUMPRODUCT((Accounts!A2:A<>"")*(COUNTIFS(Transactions!C:C,Accounts!A2:A,Transactions!K:K,Settings!B7)=0)),"")`);
  book.formula('Compliance Checks', 19, 5, '=IF(ISNUMBER(C19),IF(C19>0,"Review","OK"),"Awaiting first close")');
  book.text('Compliance Checks', 19, 6, 'No activity can be legitimate. The authoritative close requires a reviewed statement for every account, including inactive months.');
  book.formula('Compliance Checks', 21, 3, '=IFERROR(COUNTA(FILTER(Transactions!A2:A,Transactions!A2:A<>""))-COUNTUNIQUE(FILTER(Transactions!A2:A,Transactions!A2:A<>"")),0)');
  book.text('Compliance Checks', 17, 6, 'Every configured valuation item needs month-end evidence. No asset items are configured in the basic profile.');
  book.text('Compliance Checks', 18, 6, 'Only actual salary deposits and payslips require matching evidence. A household without income does not need a fictional payslip.');
  book.formula('Compliance Checks', 23, 3, '=COUNTIF(E5:E21,"Review")+COUNTIF(E25:E28,"Review")');
  book.row('Compliance Checks', 25, ['Transactions overlap the opening anchor', 'Close', null, null, null, 'Opening balances already include earlier movements. Remove or correct overlapping source records before close.', 'Accounts, Transactions']);
  book.formula('Compliance Checks', 25, 3, '=COUNTIFS(Transactions!A2:A,"<>",Transactions!B2:B,"<="&Settings!B35)');
  book.formula('Compliance Checks', 25, 5, '=IF(C25>0,"Review","OK")');
  book.row('Compliance Checks', 26, ['Unknown account IDs', 'Close', null, null, null, 'Every transaction must identify a configured account.', 'Accounts, Transactions']);
  book.formula('Compliance Checks', 26, 3, '=SUMPRODUCT((Transactions!A2:A<>"")*(COUNTIF(Accounts!A2:A,Transactions!C2:C)=0))');
  book.formula('Compliance Checks', 26, 5, '=IF(C26>0,"Review","OK")');
  book.row('Compliance Checks', 27, ['Unknown transaction people', 'Close', null, null, null, 'Every transaction person must be a configured person or Joint.', 'Kitty, Transactions']);
  book.formula('Compliance Checks', 27, 3, '=SUMPRODUCT((Transactions!A2:A<>"")*(((Transactions!H2:H="")+((Transactions!H2:H<>"Joint")*(Transactions!H2:H<>\'Tax Forecast\'!B4)*(Transactions!H2:H<>\'Tax Forecast\'!C4)))>0))');
  book.formula('Compliance Checks', 27, 5, '=IF(C27>0,"Review","OK")');
  book.row('Compliance Checks', 28, ['As-of date precedes the opening anchor', 'Close', null, null, null, 'The opening anchor is immutable. Close advances As-of one month at a time.', 'Settings']);
  book.formula('Compliance Checks', 28, 3, '=IF(Settings!B6<Settings!B35,1,0)');
  book.formula('Compliance Checks', 28, 5, '=IF(C28>0,"Review","OK")');
  book.formula('Metrics', 20, 3, "='Compliance Checks'!C23");
}
function presentation(book, input) {
  book.clear('Dashboard');
  book.formula('Dashboard', 2, 2, '=Settings!B5&" • The Kitty"');
  book.formula('Dashboard', 3, 2, `=IF(${available},"Records through "&TEXT(Settings!B6,"d mmm yyyy"),"Opening balances at "&TEXT(Settings!B35,"d mmm yyyy")&" — awaiting the first evidence-backed close")`);
  book.text('Dashboard', 5, 2, 'TRACKED CASH'); book.formula('Dashboard', 6, 2, '=Metrics!C13');
  book.text('Dashboard', 5, 5, 'LATEST INCOME'); book.formula('Dashboard', 6, 5, '=IF(ISNUMBER(Metrics!C5),Metrics!C5,"")');
  book.text('Dashboard', 5, 8, 'LATEST SPENDING'); book.formula('Dashboard', 6, 8, '=IF(ISNUMBER(Metrics!C6),Metrics!C6,"")');
  book.text('Dashboard', 5, 11, 'LATEST NET CASH FLOW'); book.formula('Dashboard', 6, 11, '=IF(ISNUMBER(Metrics!C7),Metrics!C7,"")');
  book.text('Dashboard', 9, 2, 'REVIEW');
  book.formula('Dashboard', 10, 2, '=IFERROR(FILTER(\'Compliance Checks\'!A5:G,\'Compliance Checks\'!E5:E="Review"),"No formula review flags. Close still requires original-source evidence and a verified receipt.")');
  book.text('Dashboard', 30, 2, 'Tax, mortgage, assets and subscriptions are unavailable in this profile. Tracked cash is not whole-household net worth.');
  book.sheet('Dashboard').numberFormats = [];
  for (const column of [2, 5, 8, 11]) book.format('Dashboard', column, 6, 6, 'NUMBER', '$#,##0.00;($#,##0.00);"-"');
  book.clear('README');
  const rows = [
    ['The Kitty — ' + input.householdName], ['Template profile', PROFILE.id + '/' + PROFILE.version],
    ['Scope', 'AU/AUD, one or two people, accounts, cash flow, explicit budgets and one optional goal.'],
    ['Opening balances', 'Balances are signed: money held positive, money owing negative. All accounts start at the explicit common month-end anchor.'],
    ['First import', 'Import only transactions after the opening anchor. Earlier movements are already represented in opening balances.'],
    ['History', 'Periods before History starts are unknown. Three-month and prior-year comparisons wait for their full windows.'],
    ['Budget', 'Missing budgets mean unconfigured; zero is an explicit zero limit. Monthly actuals can be available before full financial-year comparisons. Lumpy bills retain the annual-budget treatment.'],
    ['Optional domains', 'Tax, mortgage, whole-household net worth, assets and subscription analysis are unavailable. Their original demo assumptions were removed.'],
    ['Payslips', 'Reviewed payslips can be recorded and matched to actual salary deposits; they do not enable tax forecasting.'],
    ['Close', 'The app requires original-source statement evidence for every account, reviewed exceptions and verified readback. A no-activity diagnostic is not a missing-statement proof.'],
    ['Formula flags', 'Zero close.items_missing means no formula Close flags. It is not proof of a completed close; inspect the verified close receipt.'],
    ['Sheet ownership', 'This Sheet owns accepted records. Its known public JSON feed is off. Drive sharing, protections and scripts are separate provider state.'],
    ['Raw records', 'Transactions A:J, Payslips A:G and Valuations A:C remain append-only inputs. Helper formulas and record-ID metadata columns are reserved.'],
    ['Unknown setup outcome', 'Reconcile the durable setup identity before creating another workbook. No provider verification is claimed by this generated plan.'],
  ];
  rows.forEach((row, index) => book.row('README', index + 1, row));
}

function sheetsPayload(workbook) {
  const requests = [{ updateSpreadsheetProperties: { properties: workbook.properties, fields: 'title,locale,timeZone' } }];
  for (const sheet of workbook.sheets) requests.push({ addSheet: { properties: sheet.properties } });
  for (const sheet of workbook.sheets) {
    const byRow = new Map();
    for (const cell of sheet.cells) { if (!byRow.has(cell.row)) byRow.set(cell.row, []); byRow.get(cell.row).push(cell); }
    for (const [row, cells] of byRow) {
      const start = cells[0].column, end = cells.at(-1).column;
      const values = Array.from({ length: end - start + 1 }, () => ({}));
      for (const cell of cells) values[cell.column - start] = { userEnteredValue: cell.value };
      requests.push({ updateCells: { start: { sheetId: sheet.properties.sheetId, rowIndex: row - 1, columnIndex: start - 1 }, rows: [{ values }], fields: 'userEnteredValue' } });
    }
    for (const [kind, field] of [['dataValidation', 'dataValidation'], ['numberFormats', 'userEnteredFormat.numberFormat']]) {
      for (const rule of sheet[kind]) requests.push({ repeatCell: {
        range: { sheetId: sheet.properties.sheetId, startRowIndex: rule.startRow - 1, endRowIndex: rule.endRow, startColumnIndex: rule.column - 1, endColumnIndex: rule.column },
        cell: field === 'dataValidation' ? { dataValidation: rule.value } : { userEnteredFormat: { numberFormat: rule.value } }, fields: field,
      } });
    }
    if (sheet.properties.title === 'Accounts') {
      // Keep the canonical account table readable in Sheets, including its
      // opening/closing balance headers and full institution names.
      const widths = [160, 160, 220, 130, 130, 150, 130, 150, 80];
      widths.forEach((pixelSize, column) => requests.push({ updateDimensionProperties: {
        range: { sheetId: sheet.properties.sheetId, dimension: 'COLUMNS', startIndex: column, endIndex: column + 1 },
        properties: { pixelSize }, fields: 'pixelSize',
      } }));
      requests.push({ repeatCell: {
        range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
        cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE', textFormat: { bold: true } } },
        fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment,userEnteredFormat.textFormat.bold',
      } });
      requests.push({ updateDimensionProperties: {
        range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 40 }, fields: 'pixelSize',
      } });
    }
  }
  return { spreadsheetCreate: { properties: workbook.properties }, batchUpdate: { requests, includeSpreadsheetInResponse: false } };
}
export function expectedFingerprints(cells, sheets) {
  const titles = new Map(sheets.map(sheet => [sheet.sheetId, sheet.title]));
  const tuples = cells.map(cell => [titles.get(cell.sheetId), cell.rowIndex, cell.columnIndex, cell.userEnteredValue]);
  tuples.sort((a, b) => compare(a[0], b[0]) || a[1] - b[1] || a[2] - b[2]);
  return {
    formulaFingerprint: digest(tuples.filter(row => row[3].formulaValue !== undefined).map(row => [...row.slice(0, 3), row[3].formulaValue])),
    inputFingerprint: digest(tuples.filter(row => row[3].formulaValue === undefined)),
  };
}
function verification(workbook, input) {
  const sheets = workbook.sheets.map(sheet => ({ sheetId: sheet.properties.sheetId, title: sheet.properties.title, rowCount: sheet.properties.gridProperties.rowCount, columnCount: sheet.properties.gridProperties.columnCount }));
  const cells = workbook.sheets.flatMap(sheet => sheet.cells.map(cell => ({ sheetId: sheet.properties.sheetId, rowIndex: cell.row - 1, columnIndex: cell.column - 1, userEnteredValue: cell.value })));
  const checks = [
    { id: 'as-of-opening-anchor', range: ref('Settings', 'B6'), kind: 'exact', expected: [[serial(input.openingDate)]] },
    { id: 'opening-anchor-retained', range: ref('Settings', 'B35'), kind: 'exact', expected: [[serial(input.openingDate)]] },
    { id: 'history-start', range: ref('Settings', 'B36'), kind: 'exact', expected: [[serial(nextDay(input.openingDate))]] },
    { id: 'opening-cash', range: ref('Metrics', 'C13'), kind: 'minor', currency: 'AUD', expected: [[String(input.accounts.reduce((sum, account) => sum + BigInt(account.openingMinor), 0n))]] },
    { id: 'public-feed-off', range: ref('Kitty', 'B17'), kind: 'exact', expected: [['no']] },
    { id: 'configured-budget-count', range: ref('Metrics', 'F10'), kind: 'exact', expected: [[input.budgets.length]] },
    { id: 'no-invented-cashflow', range: ref('Cash Flow', 'B5:T19'), kind: 'blank' },
    { id: 'no-invented-earlier-cash', range: ref('Net Worth', 'B5:B19'), kind: 'blank' },
    { id: 'net-worth-unavailable', range: ref('Net Worth', 'C5:I20'), kind: 'blank' },
    { id: 'tax-unavailable', range: ref('Tax Forecast', 'B5:E41'), kind: 'blank' },
    { id: 'mortgage-unavailable', range: ref('Mortgage Scenarios', 'B5:H40'), kind: 'blank' },
    { id: 'subscription-records-unconfigured', range: ref('Subscriptions', 'A2:Q1000'), kind: 'blank' },
    { id: 'no-fabricated-monthly-headlines', range: ref('Metrics', 'C5:C9'), kind: 'blank' },
  ];
  input.accounts.forEach((account, index) => checks.push({ id: 'opening-' + account.id, range: ref('Accounts', 'H' + (index + 2)), kind: 'minor', currency: 'AUD', expected: [[account.openingMinor]] }));
  if (input.goal) {
    checks.push({ id: 'goal-opening-balance', range: ref('Goals', 'E2'), kind: 'minor', currency: 'AUD', expected: [[input.accounts.find(account => account.id === input.goal.accountId).openingMinor]] });
    checks.push({ id: 'goal-no-invented-savings-history', range: ref('Goals', 'I2'), kind: 'blank' });
  }
  const rawRecordRanges = [ref('Transactions', `A2:J${input.capacity.transactions + 1}`), ref('Payslips', `A2:G${input.capacity.payslips + 1}`), ref('Valuations', `A2:C${input.capacity.valuations + 1}`)];
  for (const [index, range] of rawRecordRanges.entries()) checks.push({ id: 'empty-raw-' + index, range, kind: 'blank' });
  for (const [title, range] of [['Assets', 'A2:D1000'], ['Loans', 'A2:K1000'], ['Savings Finder', 'A5:G1000']]) checks.push({ id: 'unavailable-' + title, range: ref(title, range), kind: 'blank' });
  return { sheets, ranges: sheets.map(sheet => ref(sheet.title, `A1:${col(sheet.columnCount)}${sheet.rowCount}`)), cells, ...expectedFingerprints(cells, sheets), checks, allowErrors: [], rawRecordRanges,
    status: 'requires-provider-recalculation', inputPolicy: 'Exact userEnteredValue map, including absence of unexpected literal/formula cells. Number formats and validation are part of the batch and should also be read back.',
    creationPolicy: 'Only a new owned empty workbook. Discover and verify empty default tabs, then delete those tabs after addSheet within the same batch. Never apply this payload to an existing household.' };
}

export function buildTemplate(rawInput) {
  const input = validateInput(rawInput), inputSha256 = digest(input), book = new Workbook();
  rawTables(book, input);
  configuration(book, input, inputSha256);
  cashflow(book);
  budgetAndGoal(book, input);
  optionalDomains(book, input);
  checks(book);
  presentation(book, input);
  const workbook = book.finish({ title: 'The Kitty — ' + input.householdName, locale: 'en_AU', timeZone: 'Australia/Sydney' });
  const payload = sheetsPayload(workbook);
  const bodyBytes = Buffer.byteLength(JSON.stringify(payload.batchUpdate));
  requireThat(bodyBytes < 1_900_000, 'The initial Google batch exceeds this profile’s safe payload limit.');
  const sourceFormulas = new Map(SOURCE.sheets.flatMap(sheet => sheet.cells.filter(cell => cell.value.formulaValue).map(cell => [sheet.properties.title + ':' + cell.row + ':' + cell.column, cell.value.formulaValue])));
  const preservedFormulas = workbook.sheets.flatMap(sheet => sheet.cells.filter(cell => cell.value.formulaValue && sourceFormulas.get(sheet.properties.title + ':' + cell.row + ':' + cell.column) === cell.value.formulaValue)).length;
  return {
    schema: 'kitty-template-plan/1', profile: PROFILE, sourceSha256: SOURCE_SHA256, inputSha256, normalizedInput: input,
    reviewSummary: { householdName: input.householdName, people: input.people, currency: 'AUD', openingDate: input.openingDate, firstImportDate: nextDay(input.openingDate),
      accounts: input.accounts, openingCashMinor: String(input.accounts.reduce((sum, account) => sum + BigInt(account.openingMinor), 0n)),
      budgets: input.budgets, emergencyAccountId: input.emergencyAccountId, goal: input.goal, capacity: input.capacity,
      unavailableModules: ['tax', 'mortgage', 'whole-household net worth', 'assets', 'subscriptions', 'savings opportunities'],
      initialState: 'Opening balances only; no imported or closed periods. Historical metrics are unavailable until supported by records.' },
    ...payload, verification: verification(workbook, input),
    adaptations: { sourceFormulaCount: sourceFormulas.size, preservedFormulaCount: preservedFormulas, batchBytes: bodyBytes,
      deliberateReplacements: ['Regenerated household metadata, Accounts rows and their balance formulas; no inherited configuration.', 'Person validation follows one/two configured names and Joint where permitted.', 'Opening/history gates prevent pre-anchor history and incomplete-window comparisons.', 'Budgets are explicit, including zero limits; empty filters return blank.', 'Emergency-account selection uses Settings, not a hardcoded account ID.', 'Optional domain formulas and populated input rows are removed, not evaluated with zero defaults.', 'No-activity is a Data diagnostic; authoritative close still requires statement evidence.', 'Added Close diagnostics for pre-anchor transactions, unknown accounts/people and a backwards As-of date.', 'Generated dynamic raw capacities, validation, formats and reserved record-ID metadata headers.', 'Replaced demo dashboard/README; known public feed off. No visual/permission/script clone.'] },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , inputFile, outputFile] = process.argv;
  if (!inputFile || !outputFile) {
    process.stderr.write('Usage: node templates/build.mjs input.json output-plan.json\nNo provider calls are made.\n');
    process.exitCode = 2;
  } else {
    try { writeFileSync(outputFile, JSON.stringify(buildTemplate(JSON.parse(readFileSync(inputFile, 'utf8'))), null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
  }
}
