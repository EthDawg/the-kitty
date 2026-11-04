(function(root) {
  'use strict';
  const N = {};
  const fail = message => { throw new Error(message); };
  const validDay = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const planning = (snapshot, m) => {
    const inputs = snapshot.mortgage_inputs || {};
    const rates = (snapshot.mortgage || []).map((row, index) => ({id: 'rate-' + index,
      change:number(row.rate_change), rate:number(row.interest_rate), repayment:number(row.monthly_repayment),
      changePm:number(row.change_per_month), changePy:number(row.change_per_year),
      netAfter:number(row.net_cash_flow_after_change), interest:number(row.interest_over_remaining_term),
      years:number(row.years_to_repay_at_today_s_repayment_with_offset)}));
    const extras = (snapshot.mortgage_extra || []).map((row, index) => ({id:'extra-' + index,
      extra:number(row.extra_per_month), total:number(row.total_monthly_repayment),
      years:number(row.years_to_repay_with_offset), saved:number(row.years_saved), interestSaved:number(row.interest_saved)}));
    const mortgage = Object.keys(inputs).length || rates.length || extras.length ? {
      balance:number(inputs['Loan balance ($)']), offset:number(inputs['Offset balance ($)']),
      rate:number(inputs['Current interest rate']), monthsLeft:number(inputs['Months remaining']),
      repayment:number(inputs['Current monthly repayment ($)']),
      netPm:number(inputs['Average monthly net cash flow, last 3 months ($)']), scenarios:rates, extras
    } : null;
    for (const row of snapshot.payslips || []) {
      if (!validDay(Engine.date(row.pay_date)) || !String(row.person || '').trim()) {
        fail('A payslip has an invalid date or missing person. Repair the original record in your Sheet.');
      }
    }
    const payslips = (snapshot.payslips || []).map((row, index) => ({id:'payslip-' + index,
      date:Engine.date(row.pay_date), person:String(row.person), employer:String(row.employer || ''),
      gross:number(row.gross_pay), tax:number(row.tax_withheld), super:number(row.super), net:number(row.net_pay)
    })).filter(row => row.date <= m.asOf).sort((a,b) => a.date.localeCompare(b.date));
    const past = {...m, payslips, tx:m.tx.filter(row => row.date <= m.asOf)};
    const cycle = {weekly:7, fortnightly:14, monthly:31}[String(m.kitty.pay_cycle || '').toLowerCase()];
    const paydays = (cycle ? Engine.payday(past) : []).flatMap(pay => {
      const recent = payslips.filter(row => row.person === pay.person).slice(-3);
      const last = recent[recent.length-1];
      if (!last || pay.next <= m.asOf || Engine.daysBetween(last.date, m.asOf) > cycle * 3) return [];
      const nets = recent.map(row => row.net).sort((a,b) => a-b);
      return [{...pay, lastPaid:last.date, net:nets.every(value => value != null) ? nets[Math.floor(nets.length/2)] : null}];
    });
    const from = Engine.addDays(Engine.addMonths(m.asOf, -12), 1);
    const rent = Engine.spend(past.tx, {from,to:m.asOf}, row => row.cat === 'RENT-INC');
    const costs = Engine.spend(past.tx, {from,to:m.asOf}, row => /^RENT-/.test(row.cat) && row.cat !== 'RENT-INC');
    const hasRental = past.tx.some(row => /^RENT-/.test(row.cat)) || m.assets.some(row => row.id === 'RENTAL');
    const metric = m.metrics['emergency.months_covered'];
    const settingTarget = number(m.settings['Emergency fund target (months of essential spending)']);
    return {mortgage, safety:{months:metric ? metric.num : null,
        target:settingTarget != null && settingTarget > 0 ? settingTarget
          : metric && /target/i.test(metric.comparedWith || '') && metric.comp > 0 ? metric.comp : null},
      paydays, payslips:payslips.slice().reverse(),
      rental:hasRental ? {from,to:m.asOf,rent:rent.in,costs:costs.out,net:rent.in-costs.out,
        byCategory:costs.byCat.map(([id,amount]) => ({id,name:(m.catById[id] || {}).name || id,amount}))} : null,
      financialYear:m.settings['Current financial year'] == null ? null : String(m.settings['Current financial year'])};
  };
  const unique = (rows, field, label) => {
    const seen = new Set();
    for (const row of rows || []) {
      const id = String(row[field] || '');
      if (!id || seen.has(id)) fail(label + ' has a missing or repeated identity. Repair it in the Sheet before refreshing.');
      seen.add(id);
    }
    return seen;
  };
  N.project = function(snapshot) {
    const versions = (snapshot.kitty || []).filter(row => row.key === 'sheet_version');
    if (versions.length !== 1 || !['1', '2'].includes(String(versions[0].value))) {
      fail('This Sheet has an unknown or missing version. Choose a supported Kitty workbook.');
    }
    const m = Engine.model(snapshot);
    const accounts = unique(snapshot.accounts, 'account_id', 'Accounts');
    if (!accounts.size) fail('No accounts found. Choose a Kitty workbook with an Accounts tab.');
    const categories = unique(snapshot.category_list, 'category_id', 'Categories');
    const rows = snapshot.transactions && snapshot.transactions.length ? snapshot.transactions
      : (snapshot.entries || []).filter(row => String(row.kind || 'transaction').toLowerCase() === 'transaction')
        .map(row => ({txn_id: row.entry_id, date: row.settled_at || row.date, account_id: row.account_id,
          amount: row.amount, category_id: row.category_id}));
    unique(rows, 'txn_id', 'Transactions');
    for (const row of rows) {
      if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || Math.abs(row.amount) > Number.MAX_SAFE_INTEGER / 100) {
        fail('Transaction ' + row.txn_id + ' has a missing or invalid amount. It has not been treated as zero.');
      }
      if (!validDay(Engine.date(row.date))) fail('Transaction ' + row.txn_id + ' has an invalid date. Repair the date in your Sheet.');
      if (!accounts.has(String(row.account_id))) fail('Transaction ' + row.txn_id + ' refers to an unknown account.');
      if (!categories.has(String(row.category_id || 'UNCAT'))) fail('Transaction ' + row.txn_id + ' refers to an unknown category.');
    }
    const dateRows = (snapshot.settings || []).filter(row => row.setting === 'As-of date');
    if (dateRows.length !== 1 || !validDay(Engine.date(dateRows[0].value))) {
      fail('The Sheet needs one valid As-of date. Its freshness has not been guessed from transaction dates.');
    }
    unique(snapshot.metrics, 'metric_id', 'Metrics');
    // Preserve unknown chart values. The original artifact engine is tolerant of blanks;
    // a native projection must not turn a missing formula result into a confident zero.
    for (const month of m.cashflow) {
      const raw = (snapshot.cashflow || []).find(row => Engine.date(row.month) === month.month);
      for (const key of ['income', 'spending', 'net']) month[key] = Engine.num(raw && raw[key]);
    }
    for (const month of m.networth) {
      const raw = (snapshot.networth || []).find(row => Engine.date(row.month_end) === month.month);
      for (const key of ['cash', 'property', 'super', 'shares', 'vehicle', 'loans']) month[key] = Engine.num(raw && raw[key]);
      month.total = Engine.num(raw && raw.net_worth);
    }
    const details = planning(snapshot, m);
    const horizon = Math.min(365, Math.max(1, Number(m.kitty.look_ahead_days) || 35));
    const upcoming = Engine.upcoming({...m,payslips:[]}, horizon).map(row => {
      if (row.kind === 'bill') {
        const source = m.subs.find(item => item.service === row.ref.key);
        return {...row,amount:source && source.latest != null ? -source.latest : null};
      }
      return row;
    });
    for (const pay of details.paydays) if (pay.next <= Engine.addDays(m.asOf,horizon)) {
      upcoming.push({date:pay.next,kind:'pay',title:pay.person + "'s estimated pay",sub:pay.employer,amount:pay.net});
    }
    upcoming.sort((a,b) => a.date.localeCompare(b.date));
    return {household:m.householdName, asOf:m.asOf, currency:m.kitty.currency || 'AUD', sheetVersion:Number(versions[0].value),
      accounts:m.accounts, transactions:m.tx, categories:m.cats, goals:m.goals, metrics:m.metrics,
      cashflow:m.cashflow, budget:m.budget, subscriptions:m.subs, checks:m.checks,
      savings:m.savings, networth:m.networth, upcoming, planning:details,
      reconciliation:Engine.reconcile(m), mortgage:m.mortgage,
      people:m.people, fetchedAt:m.fetchedAt};
  };
  const HEADERS = {
    kitty: ['Key', 'Value'], settings: ['Setting', 'Value'],
    accounts: ['Account ID', 'Account', 'Institution', 'Type', 'Owner', 'Opening balance', 'Opening date', 'Balance at as-of date', 'Liquid'],
    category_list: ['Category ID', 'Category', 'Group', 'Flow'],
    transactions: ['Txn ID', 'Date', 'Account ID', 'Bank description', 'Merchant', 'Amount', 'Category ID', 'Person', 'Receipt held', 'Note'],
    entries: ['Entry ID', 'Kind', 'Settled at', 'Account ID', 'Raw text', 'Description', 'Amount', 'Category ID', 'Person', 'Receipt held', 'Note', 'Status', 'Created at', 'Transfer ID', 'Transfer account', 'Foreign amount', 'Foreign currency', 'Units', 'Unit price', 'Source'],
    goals: ['Goal', 'Target amount', 'Target date', 'Linked account', 'Balance now'],
    payslips: ['Pay date', 'Person', 'Employer', 'Gross pay', 'Tax withheld', 'Super (employer)', 'Net pay'],
    metrics: ['Metric ID', 'Metric', 'Value', 'Unit', 'Period']
  };
  N.fromGrids = function(grids) {
    for (const [key, expected] of Object.entries(HEADERS)) {
      if (!Object.prototype.hasOwnProperty.call(grids, key)) continue;
      const headers = (grids[key] || []).find(row => row && row[0] === expected[0]);
      if (!headers || !expected.every((value, index) => Engine.key(headers[index]) === Engine.key(value))) {
        fail('The ' + key + ' columns changed. Restore the Kitty headers before connecting this Sheet.');
      }
    }
    const snapshot = Engine.fromConnector(grids);
    const grid = grids.cashflow || [];
    const index = grid.findIndex(row => row && row[0] === 'Month');
    if (index >= 0) {
      const columns = [];
      grid[index].forEach((value, col) => { if (col > 0 && Engine.month(value)) columns.push(col); });
      for (const [label, key] of [['Total income', 'income'], ['Total spending', 'spending'], ['Net cash flow', 'net']]) {
        const row = grid.slice(index + 1).find(row => row && row[0] === label);
        columns.forEach((col, month) => { snapshot.cashflow[month][key] = Engine.num(row && row[col]); });
      }
    }
    return snapshot;
  };
  // Practice-only canonical input. Live import baselines come from the authenticated writer.
  N.demoSourceBaseline = function(snapshot) {
    const m = N.project(snapshot);
    const minor = value => {
      if (typeof value !== 'number' || !Number.isFinite(value)
          || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) return null;
      return String(Math.round(value * 100));
    };
    const accounts = (snapshot.accounts || []).map(row => ({id:row.account_id,name:row.account,
      owner:row.owner,type:row.type,currency:m.currency,ledger:true,status:'active',method:'ledger',
      openingMinor:minor(row.opening_balance),openingDate:Engine.date(row.opening_date),
      balanceMinor:minor(row.balance_at_as_of_date)}));
    const items = (snapshot.assets || []).map(row => ({id:row.item_id,name:row.item,
      kind:/loan/i.test(row.class) ? 'liability' : 'asset',currency:m.currency,
      method:'statement',status:'active',valuationRequired:true}));
    const categories = new Map((snapshot.category_list || []).map(row => [row.category_id,row]));
    const transactions = m.transactions.map(row => ({id:row.id,date:row.date,accountId:row.acct,
      amountMinor:minor(row.amount),categoryId:row.cat,person:row.person,description:row.desc,status:'posted',transferGroup:'',
      flow:(categories.get(row.cat) || {}).flow || ''}));
    const payslips = (snapshot.payslips || []).map((row,index) => ({kind:'payslip',
      recordId:'demo-payslip-' + index,fields:{payDate:Engine.date(row.pay_date),person:row.person,
        employer:row.employer,currency:m.currency,valueBasis:'current-period',grossMinor:minor(row.gross_pay),
        taxMinor:minor(row.tax_withheld),superMinor:minor(row.super),netMinor:minor(row.net_pay)}}));
    return {schemaVersion:m.sheetVersion,currency:m.currency,asOf:m.asOf,people:m.people,
      accounts,items,transactions,payslips,valuations:[],projectedBalances:accounts.map(row =>
        ({accountId:row.id,date:m.asOf,amountMinor:row.balanceMinor})),
      checks:[],unresolvedReviews:[],practiceOnly:true};
  };
  root.NativeKitty = N;
})(this);
