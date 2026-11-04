const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const resources = path.join(__dirname, '../Kitty/Resources');
const Engine = require(path.join(resources, 'engine.js'));
const context = vm.createContext({Engine});
vm.runInContext(fs.readFileSync(path.join(resources, 'bridge.js'), 'utf8'), context);
const native = context.NativeKitty;
const original = JSON.parse(fs.readFileSync(path.join(resources, 'demo.json'), 'utf8'));
const fixture = () => structuredClone(original);

test('Google-recalculated fresh household keeps missing history unavailable and never marks it reconciled', () => {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../../templates/evidence/initial-two-person.json'), 'utf8'));
  const model = native.project(native.fromGrids(source.grids));
  assert.equal(model.household, 'QA fixture - River (fictional)');
  assert.equal(model.asOf, '2026-06-30');
  assert.equal(model.transactions.length, 0);
  assert.equal(Math.round(model.metrics['networth.cash'].num * 100), 620550);
  assert.equal(model.metrics['networth.total'].num, null);
  assert.equal(model.goals[0].savedPm, null);
  assert.equal(model.publicFeedEnabled, false);
  const missing = model.reconciliation.filter(check => check.a == null || check.b == null);
  assert.ok(missing.length > 0);
  assert.ok(missing.every(check => check.ok === false));
});

test('Google-recalculated one-person setup has no invented budgets, goals or optional forecasts', () => {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../../templates/evidence/initial-solo.json'), 'utf8'));
  const model = native.project(native.fromGrids(source.grids));
  assert.equal(model.accounts.length, 1);
  assert.equal(Math.round(model.metrics['networth.cash'].num * 100), 123456);
  assert.equal(model.transactions.length, 0);
  assert.equal(model.goals.length, 0);
  assert.equal(model.budget.length, 0);
  assert.equal(model.planning.mortgage, null);
  assert.equal(model.planning.rental, null);
  assert.equal(model.planning.safety.months, null);
  assert.equal(model.planning.paydays.length, 0);
  assert.equal(model.metrics['cashflow.income.month'].num, null);
  assert.equal(model.metrics['tax.refund.current_year'].num, null);
});

test('native projection keeps pinned Sheet figures and all 925 transactions', () => {
  const model = native.project(fixture());
  assert.equal(model.transactions.length, 925);
  assert.equal(Math.round(model.metrics['networth.cash'].num * 100), 9938843);
  assert.equal(model.asOf, '2027-01-31');
});
test('public-feed projection matches the bound script first-key and yes rules', () => {
  for (const [rows, expected] of [
    [[], false],
    [[{key:'public_feed',value:'no'}], false],
    [[{key:' public_feed ',value:' YeS '}], true],
    [[{key:'PUBLIC_FEED',value:'yes'}], false],
    [[{key:'public_feed',value:true}], false],
    [[{key:'public_feed',value:'yes'},{key:'public_feed',value:'no'}], true],
    [[{key:'public_feed',value:'no'},{key:'public_feed',value:'yes'}], false],
  ]) {
    const data = fixture();
    data.kitty = data.kitty.filter(row => String(row.key).trim() !== 'public_feed').concat(rows);
    assert.equal(native.project(data).publicFeedEnabled, expected);
  }
});
test('live grid publication state includes rows above the header and after blanks', () => {
  const source = fixture();
  const setup = source.kitty.filter(row => String(row.key).trim() !== 'public_feed').map(row => [row.key,row.value]);
  for (const [grid, expected] of [
    [[['Key','Value'],...setup,[],['public_feed','yes']],true],
    [[[' public_feed ',' YeS '],['Key','Value'],...setup,['public_feed','no']],true],
    [[['public_feed','no'],['Key','Value'],...setup,['public_feed','yes']],false],
  ]) {
    const snapshot = native.fromGrids({kitty:grid});
    assert.equal(snapshot.publicFeedEnabled, expected);
    assert.equal(native.project({...fixture(),kitty:snapshot.kitty,publicFeedEnabled:snapshot.publicFeedEnabled}).publicFeedEnabled, expected);
  }
});
test('missing and malformed transaction amounts never become zero', () => {
  for (const value of [null, '', 'unreadable', NaN, true, 1e15]) {
    const data = fixture(); data.transactions[0].amount = value;
    assert.throws(() => native.project(data), /invalid amount/);
  }
  const data = fixture(); data.transactions[0].amount = 0;
  assert.equal(native.project(data).transactions.find(t => t.id === 'T0001').amount, 0);
});
test('invalid calendar dates and broken references cannot silently disappear', () => {
  for (const [key, value, message] of [['date', '2027-02-31', /invalid date/], ['date', '', /invalid date/],
      ['account_id', 'MISSING', /unknown account/], ['category_id', 'MISSING', /unknown category/]]) {
    const data = fixture(); data.transactions[0][key] = value;
    assert.throws(() => native.project(data), message);
  }
});
test('missing as-of and schema versions are never guessed', () => {
  const noDate = fixture(); noDate.settings = noDate.settings.filter(r => r.setting !== 'As-of date');
  assert.throws(() => native.project(noDate), /As-of date/);
  const noVersion = fixture(); noVersion.kitty = noVersion.kitty.filter(r => r.key !== 'sheet_version');
  assert.throws(() => native.project(noVersion), /missing version/);
});
test('duplicate record and metric identities refuse an ambiguous household', () => {
  for (const key of ['transactions', 'accounts', 'category_list', 'metrics']) {
    const data = fixture(); data[key].push(structuredClone(data[key][0]));
    assert.throws(() => native.project(data), /repeated identity/);
  }
});
test('missing chart and net-worth figures remain unknown', () => {
  const data = fixture();
  data.cashflow[0].income = null; data.cashflow[0].spending = null; data.cashflow[0].net = null;
  data.networth[0].cash = null; data.networth[0].net_worth = null;
  const model = native.project(data);
  assert.equal(model.cashflow[0].income, null); assert.equal(model.cashflow[0].net, null);
  assert.equal(model.networth[0].cash, null); assert.equal(model.networth[0].total, null);
});
test('reordered input columns and blank formula cells are handled safely', () => {
  assert.throws(() => native.fromGrids({transactions: [['Txn ID', 'Date', 'Account ID', 'Bank description', 'Merchant', 'Category ID', 'Amount']]}), /columns changed/);
  const snapshot = native.fromGrids({cashflow: [
    ['Month', '2027-01-01'], ['Total income', null], ['Total spending', 0], ['Net cash flow', '#REF!']
  ]});
  assert.equal(snapshot.cashflow[0].income, null);
  assert.equal(snapshot.cashflow[0].spending, 0);
  assert.equal(snapshot.cashflow[0].net, null);
});

test('planning preserves Sheet mortgage scenarios, payslips and exact rental totals', () => {
  const model = native.project(fixture());
  const planning = model.planning;
  assert.equal(planning.mortgage.balance, 591715.18);
  assert.equal(planning.mortgage.scenarios.length, 13);
  const higher = planning.mortgage.scenarios.find(row => Math.abs(row.change - .005) < 1e-9);
  assert.equal(Math.round(higher.repayment * 100), 399191);
  assert.equal(planning.payslips.length, 83);
  assert.equal(planning.paydays.find(row => row.person === 'Jordan').lastPaid, '2027-01-28');
  assert.equal(planning.rental.from, '2026-02-01');
  assert.equal(planning.rental.to, model.asOf);
  assert.equal(planning.rental.rent, 29510);
  assert.equal(planning.rental.net, -26989.75);
});

test('missing mortgage inputs and scenario results never become free repayments or zero changes', () => {
  const data = fixture();
  data.mortgage_inputs['Loan balance ($)'] = null;
  data.mortgage[0].change_per_month = null;
  data.mortgage[0].monthly_repayment = '#REF!';
  data.mortgage_extra[0].extra_per_month = null;
  data.mortgage_extra[0].years_saved = null;
  const mortgage = native.project(data).planning.mortgage;
  assert.equal(mortgage.balance, null);
  assert.equal(mortgage.scenarios[0].changePm, null);
  assert.equal(mortgage.scenarios[0].repayment, null);
  assert.equal(mortgage.extras[0].extra, null);
  assert.equal(mortgage.extras[0].saved, null);
});

test('safety target requires a named target and does not infer coverage from unrelated cash', () => {
  const data = fixture();
  data.accounts.forEach(row => { row.balance_at_as_of_date = 1_000_000; });
  const originalMonths = data.metrics.find(row => row.metric_id === 'emergency.months_covered').value;
  assert.equal(native.project(data).planning.safety.months, originalMonths);
  data.settings = data.settings.filter(row => row.setting !== 'Emergency fund target (months of essential spending)');
  data.metrics.find(row => row.metric_id === 'emergency.months_covered').compared_with = 'Last year';
  assert.equal(native.project(data).planning.safety.target, null);
});

test('future payslips do not change the forecast and stale history does not invent a payday', () => {
  const data = fixture();
  data.payslips.push({...data.payslips.at(-1), pay_date:'2030-01-28', net_pay:99999});
  let planning = native.project(data).planning;
  assert.equal(planning.payslips.length, 83);
  assert.equal(planning.paydays.find(row => row.person === 'Jordan').net, 3925.62);
  data.payslips = data.payslips.filter(row => row.pay_date < '2026-01-01');
  planning = native.project(data).planning;
  assert.equal(planning.paydays.length, 0);
  assert.equal(native.project(data).upcoming.filter(row => row.kind === 'pay').length, 0);
  data.payslips[0].pay_date = '2025-02-30';
  assert.throws(() => native.project(data), /payslip has an invalid date/);
});

test('rental totals exclude later transactions and use the actual as-of date', () => {
  const data = fixture();
  data.transactions.push({...data.transactions.at(-1), txn_id:'FUTURE-RENT', date:'2027-02-02', category_id:'RENT-REPAIR', amount:-99999});
  assert.equal(native.project(data).planning.rental.net, -26989.75);
  data.settings.find(row => row.setting === 'As-of date').value = '2027-01-15';
  const rental = native.project(data).planning.rental;
  assert.equal(rental.from, '2026-01-16');
  assert.equal(rental.to, '2027-01-15');
});
