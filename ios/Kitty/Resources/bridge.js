(function(root) {
  'use strict';
  const N = {};
  const fail = message => { throw new Error(message); };
  const validDay = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
    return {household:m.householdName, asOf:m.asOf, currency:m.kitty.currency || 'AUD', sheetVersion:Number(versions[0].value),
      accounts:m.accounts, transactions:m.tx, categories:m.cats, goals:m.goals, metrics:m.metrics,
      cashflow:m.cashflow, budget:m.budget, subscriptions:m.subs, checks:m.checks,
      savings:m.savings, networth:m.networth, upcoming:Engine.upcoming(m),
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
  root.NativeKitty = N;
})(this);
