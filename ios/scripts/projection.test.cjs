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

test('native projection keeps pinned Sheet figures and all 925 transactions', () => {
  const model = native.project(fixture());
  assert.equal(model.transactions.length, 925);
  assert.equal(Math.round(model.metrics['networth.cash'].num * 100), 9938843);
  assert.equal(model.asOf, '2027-01-31');
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
