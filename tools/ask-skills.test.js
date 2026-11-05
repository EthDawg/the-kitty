// Run with node --test tools/ask-skills.test.js. All household records are fictional.
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../src/engine.js');
const Ask = require('../src/kit/ask-skills.js');
const snapshot = require('../data/snapshot-v2.json');

Engine.loadMerchants({
  merchants: require('../merchants/merchants.json'),
  categories: require('../merchants/categories.json'),
});
const model = Engine.model(snapshot);
const asOf = snapshot.settings.find(row => row.setting === 'As-of date').value;
const cents = value => Math.round(value * 100);

// Expected amounts come straight from signed Entries, with the Sheet's recorded category flow.
// Do not use the engine's spend/window/goal helpers to calculate their own expected results.
function sourceExpenses(from, to, filters = {}, data = snapshot) {
  return data.entries.filter(row => row.kind === 'transaction' && row.flow === 'Expense'
    && row.settled_at >= from && row.settled_at <= to
    && (!filters.category || row.category_id === filters.category)
    && (!filters.person || row.person === filters.person)
    && (!filters.merchant || row.description === filters.merchant));
}

function netSpending(rows) {
  return rows.reduce((total, row) => total - cents(row.amount), 0);
}

function moneyIn(text) {
  // Ignore layout, thousands separators and surrounding prose. Preserve the sign and exact cents.
  return [...String(text).matchAll(/([−-]?)\$\s*([\d,]+)(?:\.(\d{2}))?/g)].map(match =>
    (match[1] ? -1 : 1) * (Number(match[2].replaceAll(',', '')) * 100 + Number(match[3] || 0)));
}

function answer(question, household = model, prior) {
  const plan = Ask.plan(question, household, prior);
  const result = Ask.run(Engine, household, plan);
  assert.equal(result.ok, true, `${question}: ${result.reason || plan.reason || 'no verified answer'}`);
  return result;
}

function assertSpending(result, rows, from, to) {
  assert.equal(result.plan.kind, 'spending');
  assert.ok(result.source.includes(from) && result.source.includes(to), 'receipt must identify both date boundaries');
  assert.ok(result.facts.some(fact => moneyIn(fact.value).includes(netSpending(rows))), 'net signed expense total');
  assert.ok(result.facts.some(fact => /^\d+$/.test(fact.value) && Number(fact.value) === rows.length), 'expense row count');
  const byID = new Map(rows.map(row => [row.entry_id, row]));
  const links = result.links.filter(link => link.go.startsWith('entry:'));
  assert.equal(new Set(links.map(link => link.go)).size, links.length, 'every receipt link is distinct');
  assert.ok(links.length <= rows.length);
  if (rows.length) assert.ok(links.length > 0, 'a nonempty ledger result must open at least one supporting row');
  if (rows.length <= 4) assert.equal(links.length, rows.length, 'small answers should link every receipt');
  for (const link of links) {
    const row = byID.get(link.go.slice('entry:'.length));
    assert.ok(row, `receipt ${link.go} must satisfy the same period and filters`);
    assert.ok(moneyIn(link.label).includes(cents(row.amount)), `receipt ${link.go} must show its signed amount`);
  }
}

function assertComparison(result, current, previous, currentRows, previousRows) {
  assert.equal(result.plan.kind, 'comparison');
  const expected = new Map([[current, netSpending(currentRows)], [previous, netSpending(previousRows)]]);
  assert.deepEqual(new Set(result.periods.map(period => period.time)), new Set(expected.keys()));
  for (const period of result.periods) {
    const fact = result.facts.find(item => item.label === period.label);
    assert.ok(fact, `missing total for ${period.time}`);
    assert.deepEqual(moneyIn(fact.value), [expected.get(period.time)]);
  }
  const difference = expected.get(current) - expected.get(previous);
  const displayed = moneyIn([result.title, result.detail, ...result.facts.map(item => item.value)].join(' '));
  if (difference) assert.ok(displayed.some(value => Math.abs(value) === Math.abs(difference)), 'show the actual change in cents');
}

test('canonical October dining links every contributing source row', () => {
  const rows = sourceExpenses('2026-10-01', '2026-10-31', { category: 'DINING' });
  assert.deepEqual(rows.map(row => row.entry_id), ['T0739', 'T0749', 'T0759']);
  assert.equal(netSpending(rows), 47480);
  const result = answer('What did we spend on dining in October?');
  assert.deepEqual(result.plan, { kind: 'spending', time: '2026-10', category: 'DINING' });
  assertSpending(result, rows, '2026-10-01', '2026-10-31');
});

test('household spending excludes income, transfers, trades and valuations', () => {
  assert.equal(asOf, '2027-01-31');
  const rows = sourceExpenses('2027-01-01', asOf);
  assert.equal(netSpending(rows), 1381137);
  const reported = snapshot.metrics.find(row => row.metric_id === 'cashflow.spending.month');
  assert.equal(netSpending(rows), cents(reported.value));
  const kinds = new Set(snapshot.entries.filter(row => row.settled_at.startsWith('2027-01')).map(row => row.kind));
  assert.ok(kinds.has('valuation'));
  assert.ok(snapshot.entries.some(row => row.settled_at.startsWith('2027-01') && row.flow === 'Transfer'));
  assertSpending(answer('How much did we spend this month?'), rows, '2027-01-01', asOf);
});

test('November shopping nets the original Amazon refund against debits', () => {
  const rows = sourceExpenses('2026-11-01', '2026-11-30', { category: 'SHOPPING' });
  const refunded = rows.find(row => row.entry_id === 'T0817');
  assert.equal(cents(refunded.amount), 5400);
  assert.equal(netSpending(rows), 151444);
  assert.equal(netSpending(rows.filter(row => row.amount < 0)) - netSpending(rows), 5400);
  assertSpending(answer('How much did we spend on shopping in November?'), rows, '2026-11-01', '2026-11-30');
});

test('a zero-dollar result from two reversed charges differs from no matching entries', () => {
  const reversed = sourceExpenses('2027-01-01', asOf, { merchant: 'Paramount+' });
  assert.deepEqual(reversed.map(row => [row.entry_id, cents(row.amount)]), [['T0907', -999], ['T0917', 999]]);
  assertSpending(answer('How much did we spend at Paramount+ this month?'), reversed, '2027-01-01', asOf);
  const missing = sourceExpenses('2026-12-01', '2026-12-31', { merchant: 'Woolworths', person: 'Mia' });
  assert.equal(missing.length, 0);
  assertSpending(answer('How much did Mia spend at Woolworths last month?'), missing, '2026-12-01', '2026-12-31');
});

test('person, category and month stay scoped through a follow-up and both comparison receipts', () => {
  const filters = { person: 'Mia', category: 'DINING' };
  const oct = sourceExpenses('2026-10-01', '2026-10-31', filters);
  const sep = sourceExpenses('2026-09-01', '2026-09-30', filters);
  const initial = answer('How much did Mia spend on dining in October?');
  assertSpending(initial, oct, '2026-10-01', '2026-10-31');
  const follow = answer('And the month before that?', model, initial.plan);
  assert.equal(follow.plan.person, 'Mia'); assert.equal(follow.plan.category, 'DINING');
  assertSpending(follow, sep, '2026-09-01', '2026-09-30');
  const comparison = answer('Compare it with the previous month', model, initial.plan);
  assertComparison(comparison, '2026-10', '2026-09', oct, sep);
  for (const period of comparison.periods) {
    const receipt = Ask.run(Engine, model, { ...comparison.plan, kind: 'spending', time: period.time });
    const isOctober = period.time === '2026-10';
    assertSpending(receipt, isOctober ? oct : sep, isOctober ? '2026-10-01' : '2026-09-01', isOctober ? '2026-10-31' : '2026-09-30');
  }
  assert.equal(initial.plan.time, '2026-10', 'follow-ups must not alter the previous answer');
});

test('monthly comparison reconciles both raw periods and the largest category movement', () => {
  const current = sourceExpenses('2027-01-01', asOf), prior = sourceExpenses('2026-12-01', '2026-12-31');
  const result = answer('What changed in our spending this month?');
  assertComparison(result, '2027-01', '2026-12', current, prior);
  const categories = new Set([...current, ...prior].map(row => row.category_id));
  const changes = [...categories].map(id => ({ id,
    change: netSpending(current.filter(row => row.category_id === id)) - netSpending(prior.filter(row => row.category_id === id)) }));
  const largest = changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
  const category = snapshot.category_list.find(row => row.category_id === largest.id).category;
  assert.ok(result.detail.includes(category));
  assert.ok(moneyIn(result.detail).some(value => Math.abs(value) === Math.abs(largest.change)));
});

test('an in-progress month compares the same elapsed days, excluding later entries', () => {
  const partial = { ...model, asOf: '2027-01-10' };
  const result = answer('Compare our spending this month', partial);
  assertComparison(result, '2027-01', '2026-12', sourceExpenses('2027-01-01', '2027-01-10'), sourceExpenses('2026-12-01', '2026-12-10'));
  for (const boundary of ['2027-01-01', '2027-01-10', '2026-12-01', '2026-12-10']) assert.ok(result.source.includes(boundary));
});

test('exact merchant questions use the matching ledger entries', () => {
  const rows = sourceExpenses('2026-10-01', '2026-10-31', { merchant: 'Woolworths' });
  assert.deepEqual(rows.map(row => row.entry_id), ['T0733', 'T0767']);
  assertSpending(answer('How much did we spend at Woolworths in October?'), rows, '2026-10-01', '2026-10-31');
});

test('a source change updates the answer without relying on frozen canned text', () => {
  const changed = structuredClone(snapshot);
  changed.transactions = []; // The v2 Entries-only path remains a supported engine input.
  changed.entries.find(row => row.entry_id === 'T0739').amount -= 1.23;
  const rows = sourceExpenses('2026-10-01', '2026-10-31', { category: 'DINING' }, changed);
  assert.equal(netSpending(rows), 47603);
  assertSpending(answer('What did we spend on dining in October?', Engine.model(changed)), rows, '2026-10-01', '2026-10-31');
  assert.equal(netSpending(sourceExpenses('2026-10-01', '2026-10-31', { category: 'DINING' })), 47480);
});

test('cash and net worth quote exact Sheet metrics and refuse missing values', () => {
  for (const [question, key] of [['What is our cash balance?', 'networth.cash'], ['What is our net worth?', 'networth.total']]) {
    const record = snapshot.metrics.find(row => row.metric_id === key);
    const result = answer(question);
    assert.deepEqual(moneyIn(result.title), [cents(record.value)]);
    assert.ok(result.source.includes(key) && result.source.includes(asOf));
    const absent = { ...model, metrics: { ...model.metrics, [key]: { num: null } } };
    assert.equal(Ask.run(Engine, absent, result.plan).ok, false);
  }
});

test('the reached Japan trip quotes the raw target and linked balance without forecasting a later month', () => {
  const row = snapshot.goals.find(goal => goal.goal.startsWith('Japan trip'));
  const result = answer('When will the Japan trip be funded?');
  assert.equal(result.plan.goal, row.goal);
  assert.ok(row.balance_now >= row.target_amount);
  assert.deepEqual(new Set(result.facts.flatMap(fact => moneyIn(fact.value))), new Set([cents(row.balance_now), cents(row.target_amount)]));
  assert.match(result.title, /funded|reached/i);
  assert.ok(result.source.includes('Goals') && result.source.includes(asOf));
  assert.ok(result.links.some(link => link.go === 'goals' || link.go === 'goal:' + row.goal));
  for (const invalid of [{ target: null }, { target: 0 }, { balance: null }]) {
    const incomplete = { ...model, goals: model.goals.map(goal => goal.name === row.goal ? { ...goal, ...invalid } : goal) };
    assert.equal(Ask.run(Engine, incomplete, result.plan).ok, false, 'missing financial values cannot imply the goal was reached');
  }
});

test('duplicate goal names cannot select an arbitrary balance or scenario', () => {
  const japan = model.goals.find(goal => goal.name.startsWith('Japan trip'));
  const ambiguous = { ...model, goals: [...model.goals, { ...japan, target: 200000 }] };
  for (const kind of ['goal', 'goalScenario']) {
    const input = { kind, goal: japan.name };
    assert.equal(Ask.scope(input, ambiguous), null, 'a validated plan needs a unique Sheet goal');
    assert.equal(Ask.run(Engine, ambiguous, input).ok, false);
  }
  assert.equal(Ask.plan('When will the Japan trip be funded?', ambiguous).kind, 'unsupported');
});

test('unused commitments list the Sheet-selected services and their individual annual charges', () => {
  const records = snapshot.subscriptions.filter(row => row.usage_flag === 'Unused');
  assert.equal(records.length, 3);
  const result = answer("Which subscriptions haven't we used?");
  assert.equal(result.plan.filter, 'unused');
  assert.deepEqual(new Set(result.facts.map(fact => fact.label)), new Set(records.map(row => row.service)));
  for (const row of records) {
    assert.deepEqual(moneyIn(result.facts.find(fact => fact.label === row.service).value), [cents(row.annual_cost)]);
  }
  assert.ok(result.links.some(link => link.go === 'subs'));
});

test('goal scenario includes only confirmed unused Review amounts and reports the actual change in ETA', () => {
  const result = answer('Could our unused subscriptions help fund Emergency fund?');
  assert.deepEqual(result.plan, { kind: 'goalScenario', goal: 'Emergency fund' });
  const goal = snapshot.goals.find(row => row.goal === result.plan.goal);
  const review = snapshot.subscriptions.filter(row => row.usage_flag === 'Unused' && row.decision === 'Review' && row.annual_cost > 0);
  const annualCents = review.reduce((total, row) => total + cents(row.annual_cost), 0);
  const monthlyCents = Math.round(annualCents / 12), leftCents = cents(goal.target_amount) - cents(goal.balance_now);
  assert.equal(monthlyCents, 3749); assert.equal(leftCents, 309716);
  assert.ok(moneyIn(result.title).includes(monthlyCents));
  const facts = new Map(result.facts.map(fact => [fact.label, moneyIn(fact.value)]));
  assert.ok([...facts.values()].some(values => values.includes(leftCents)));
  for (const row of review) assert.deepEqual(facts.get(row.service), [cents(row.annual_cost)]);
  for (const row of snapshot.subscriptions.filter(row => row.decision === 'Keep')) assert.ok(!facts.has(row.service));
  const monthsNow = Math.ceil(leftCents / (goal.saved_per_month_last_3_months * 100));
  const monthsIfRedirected = Math.ceil(leftCents / (goal.saved_per_month_last_3_months * 100 + monthlyCents));
  assert.equal(monthsNow, 5); assert.equal(monthsIfRedirected, monthsNow);
  assert.match(result.detail, /June 2027/i);
  assert.match(result.detail, /stay|same|unchanged/i, 'this scenario does not bring the funding month forward');
});

test('upcoming bills exclude income and reproduce the next recorded contract charges', () => {
  const result = answer('What bills are due next?');
  assert.equal(result.plan.filter, 'bills');
  const until = '2027-03-07';
  const contracts = snapshot.contracts.filter(row => ['subscription', 'insurance'].includes(row.kind)
    && row.status === 'active' && row.next_date > asOf && row.next_date <= until);
  assert.equal(Number(result.title.match(/\d+/)[0]), contracts.length);
  const firstDay = contracts.filter(row => row.next_date === '2027-02-01');
  for (const row of firstDay) {
    const fact = result.facts.find(item => item.label.includes(row.name));
    assert.ok(fact); assert.deepEqual(moneyIn(fact.value), [-cents(row.amount)]);
  }
  assert.ok(result.facts.every(fact => !/\bpay\b/i.test(fact.label)));
  const schedule = answer("What's coming up?");
  assert.ok(schedule.links.some(link => link.go === 'upcoming'));
  const pay = Engine.upcoming(model, 35).find(event => event.kind === 'pay' && event.ref.key === 'Mia');
  const payslips = snapshot.payslips.filter(row => row.person === 'Mia').sort((a, b) => a.pay_date.localeCompare(b.pay_date));
  const expectedNext = new Date(payslips.at(-1).pay_date + 'T00:00:00Z'); expectedNext.setUTCDate(expectedNext.getUTCDate() + 14);
  assert.equal(pay.date, expectedNext.toISOString().slice(0, 10));
  assert.equal(cents(pay.amount), cents(payslips.slice(-3).map(row => row.net_pay).sort((a, b) => a - b)[1]));
});

test('v2 investment loan uses the contractual next date in the detailed schedule behind Ask', () => {
  const contract = snapshot.contracts.find(row => row.account_id === 'LN-INV' && row.kind === 'loan');
  assert.equal(contract.next_date, '2027-02-01');
  const event = Engine.upcoming(model, 35).find(row => row.kind === 'loan' && row.ref.key === contract.account_id);
  assert.ok(event);
  assert.equal(event.date, contract.next_date);
  assert.equal(cents(event.amount), -cents(contract.amount));
});

test('a subscription refund is never projected as a new recurring income payment', () => {
  const contract = snapshot.contracts.find(row => row.name === 'Paramount+');
  const lastCharge = snapshot.entries.find(row => row.entry_id === 'T0917');
  assert.ok(lastCharge.amount > 0 && /REFUND/.test(lastCharge.raw_text));
  const event = Engine.upcoming(model, 35).find(row => row.kind === 'bill' && row.ref.key === contract.name);
  assert.ok(event); assert.equal(event.date, contract.next_date);
  assert.equal(cents(event.amount), -cents(contract.amount));
});

test('the review queue links real flagged entries and distinguishes a suspected double from a confirmed one', () => {
  const seen = new Map(), flags = new Map();
  const entries = [...snapshot.entries].filter(row => row.kind === 'transaction')
    .sort((a, b) => a.settled_at.localeCompare(b.settled_at) || a.entry_id.localeCompare(b.entry_id));
  for (const row of entries) {
    if (row.category_id === 'UNCAT') flags.set(row.entry_id, { category: 'UNCAT' });
    if (row.flow === 'Expense') {
      const identity = JSON.stringify([row.settled_at, row.account_id, row.description, cents(row.amount)]);
      if (seen.has(identity)) flags.set(row.entry_id, { possibleDuplicate: seen.get(identity) });
      else seen.set(identity, row.entry_id);
    }
  }
  assert.deepEqual([...flags.keys()].sort(), ['T0413', 'T0596', 'T0687', 'T0746', 'T0761', 'T0858']);
  const result = answer('What needs a look?');
  assert.equal(Number(result.title.match(/\d+/)[0]), flags.size);
  assert.ok(result.links.some(link => link.go === 'review'));
  const links = result.links.filter(link => link.go.startsWith('entry:'));
  assert.ok(links.length > 0);
  for (const link of links) {
    const flag = flags.get(link.go.slice('entry:'.length));
    assert.ok(flag, 'every review receipt must link a source candidate');
    if (flag.possibleDuplicate) assert.ok(link.label.includes(flag.possibleDuplicate), 'possible doubles must identify their matching entry');
  }
  assert.equal(snapshot.decisions.filter(row => row.ref_kind === 'entry' && row.decision === 'merge_duplicate').length, 0);
});

test('unsupported people, merchants, dates, compound filters and write requests never broaden to household spending', () => {
  const questions = ['How much did Alex spend on dining in October?', 'What did Mia and Jordan spend on dining in October?',
    'How much did we spend at Fictional Secret Cafe in October?', 'What did we spend on dining or shopping in October?',
    'What did we spend on dining in October 2028?', 'What did we spend on dining after September 17?',
    'How much did we spend on dining over $500 in October?', 'How much did we spend on dining excluding Uber Eats in October?',
    'What did we spend on dining in October and how much was cash?', 'Email our ledger to my accountant',
    'Cancel all subscriptions and move the savings to Japan', 'What will Bitcoin be worth in 2030?'];
  for (const question of questions) {
    const proposed = Ask.plan(question, model);
    assert.equal(proposed.kind, 'unsupported', question);
    assert.equal(Ask.run(Engine, model, proposed).ok, false, question);
  }
  for (const input of [{ kind: 'spending', person: '' }, { kind: 'spending', category: false },
    { kind: 'spending', time: 0 }, { kind: 'subscriptions', filter: null }, { kind: 'comparison', person: 'Alex' },
    { kind: 'spending', person: 'Mia', time: '2030-01' }, { kind: 'goal', goal: 'Missing goal' },
    { kind: 'cash', account: 'ACC-EVD' }, { kind: 'spending', category: 'SALARY' },
    { kind: 'spending', amountMinor: '9999' }, { kind: 'spending', merchant: 'Unrecognised merchant' }]) {
    assert.equal(Ask.scope(input, model), null, JSON.stringify(input));
    assert.equal(Ask.run(Engine, model, input).ok, false);
  }
  assert.equal(Ask.run(Engine, model, { kind: 'comparison', time: '2025-07' }).ok, false, 'unavailable previous month must not become zero');
});

test('asking about me requires an explicit person and preserves the original question', () => {
  const p=Ask.plan('How much did I spend on groceries last month?',model);
  assert.equal(p.kind,'unsupported');
  const choice=p.choices.find(([label])=>label==='Mia');
  assert.ok(choice); assert.deepEqual(Ask.plan(choice[1],model),{kind:'spending',time:'last-month',person:'Mia',category:'GROCERIES'});
  assert.deepEqual(Ask.plan('what about Jordan?',model,Ask.plan(choice[1],model)),{kind:'spending',time:'last-month',person:'Jordan',category:'GROCERIES'});
});
test('the merchant suggestion excludes other accounts, later entries, duplicates and generic descriptors', () => {
  const row={kind:'transaction',raw:'MARKET LANE COFFEE',date:'2026-12-03',acct:'A',id:'new',cat:'UNCAT'};
  const other=(id,props={})=>({...row,date:'2026-11-01',cat:'DINING',id,...props});
  const m={entries:[row,other('prior'),other('other account',{acct:'B',cat:'SHOPPING'}),other('later',{date:'2026-12-04'}),other('unclear time',{date:row.date}),other('duplicate',{dupOf:'prior'})],catById:model.catById,entryById:{new:row}};
  assert.deepEqual(Ask.merchantEvidence(Engine,m,'new'),{matches:['prior'],category:'DINING'});
  m.entries.push(other('disagrees',{cat:'SHOPPING'})); assert.equal(Ask.merchantEvidence(Engine,m,'new').category,null);
  row.raw='PAYPAL'; assert.deepEqual(Ask.merchantEvidence(Engine,m,'new'),{matches:[],category:null});
});
