/* The Kitty engine: every number on the page comes through here.
   Pure functions, no DOM. Runs in the page (window.Engine) and in node tests (module.exports).
   Input is either the Apps Script snapshot (typed values) or Google Sheets connector grids
   (display strings), normalised to one shape by fromConnector(); model() parses both alike. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(); else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const E = {};

  // ---------- parsing: tolerant of "$4,530.47", "($2,850.00)", "85.0%", "(0.8%)", "-", 46356, "30/11/2026" ----------
  E.num = (v) => {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "boolean") return v ? 1 : 0;
    let s = String(v).trim();
    if (!s || s === "-" || s === "–" || s === "—" || /^n\/?a$/i.test(s) || /^never/i.test(s) || /^not /i.test(s)) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[,\s$A-Za-z%]/g, "");
    if (s.startsWith("-") || s.startsWith("−")) { neg = !neg; s = s.slice(1); }
    if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.?\d*$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? (neg ? -n : n) : null;
  };
  E.pct = (v) => {
    if (typeof v === "number") return v;
    const n = E.num(v);
    if (n == null) return null;
    return /%/.test(String(v)) ? n / 100 : n;
  };
  const pad2 = (n) => String(n).padStart(2, "0");
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  E.date = (v) => {
    if (v == null || v === "") return null;
    if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { const mdy = E.dateOrder === "mdy" && +m[1] <= 12; const dd = mdy ? m[2] : m[1], mm = mdy ? m[1] : m[2]; return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad2(mm)}-${pad2(dd)}`; }
    m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/);
    if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${pad2(MON[m[2].toLowerCase()])}-${pad2(m[1])}`;
    m = s.match(/^([A-Za-z]{3})[a-z]* (\d{2,4})$/);
    if (m && MON[m[1].toLowerCase()]) return `${m[2].length === 2 ? "20" + m[2] : m[2]}-${pad2(MON[m[1].toLowerCase()])}-01`;
    return null;
  };
  E.dateOrder = "dmy";   // set from the Kitty tab's country before a model is built; US and some others show month first
  E.month = (v) => { const d = E.date(v); return d ? d.slice(0, 7) + "-01" : null; };
  E.key = (h) => String(h == null ? "" : h).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  // ---------- dates (all 'YYYY-MM-DD', computed in UTC so no timezone drift) ----------
  const toD = (s) => new Date(s + "T00:00:00Z");
  const iso = (d) => d.toISOString().slice(0, 10);
  E.addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  E.addMonths = (s, n) => { const d = toD(s); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return iso(d); };
  E.daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / 86400000);
  E.monthStart = (s) => s.slice(0, 7) + "-01";
  E.monthEnd = (s) => { const d = toD(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
  E.monthsBetween = (a, b) => { const A = toD(a), B = toD(b); return (B.getUTCFullYear() - A.getUTCFullYear()) * 12 + (B.getUTCMonth() - A.getUTCMonth()); };
  E.fyOf = (s, startMonth = 7) => { const d = toD(s); return d.getUTCFullYear() + (d.getUTCMonth() + 1 >= startMonth ? 1 : 0); };

  // ---------- formatting ----------
  E.currency = "AUD"; E.locale = "en-AU";
  E.fmt = (n, o = {}) => {
    if (n == null || !Number.isFinite(n)) return "—";
    const abs = Math.abs(n), sign = n < 0 ? "−" : o.plus && n > 0 ? "+" : "";
    if (o.short && abs >= 10000) {
      const v = abs >= 1e6 ? abs / 1e6 : abs / 1e3, suf = abs >= 1e6 ? "m" : "k";
      const digits = v >= 100 ? 0 : v >= 10 ? 1 : 1;
      return sign + E.sym() + v.toFixed(digits).replace(/\.0$/, "") + suf;
    }
    const cents = o.cents != null ? o.cents : abs < 1000 && !o.whole;
    return sign + new Intl.NumberFormat(E.locale, { style: "currency", currency: E.currency, minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }).format(abs).replace(/^[A-Z]{1,3}\s?/, (m) => (/[A-Z]{2,}/.test(m) ? "" : m));
  };
  E.sym = () => { const p = new Intl.NumberFormat(E.locale, { style: "currency", currency: E.currency }).formatToParts(1).find((x) => x.type === "currency"); return p ? p.value.replace(/^[A-Z]{1,3}(?=\W|$)/, (m) => (m.length >= 2 ? "" : m)) || "$" : "$"; };
  E.fmt0 = (n) => E.fmt(n, { cents: false });
  E.fmtS = (n) => E.fmt(n, { short: true, cents: false });
  E.fmtPct = (p, d = 0) => (p == null ? "—" : `${(p * 100).toFixed(d)}%`);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  E.fmtMonth = (s, short) => { if (!s) return ""; const d = toD(E.date(s)); const m = MONTHS[d.getUTCMonth()]; return `${short ? m.slice(0, 3) : m} ${short ? String(d.getUTCFullYear()).slice(2) : d.getUTCFullYear()}`; };
  E.fmtDay = (s, o = {}) => { if (!s) return ""; const d = toD(s); const day = d.getUTCDate(), m = MONTHS[d.getUTCMonth()].slice(0, 3); return o.year ? `${day} ${m} ${d.getUTCFullYear()}` : `${day} ${m}`; };
  E.weekday = (s) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][toD(s).getUTCDay()];
  E.rel = (from, to) => { const n = E.daysBetween(from, to); if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday"; if (n > 0 && n < 14) return `in ${n} days`; if (n < 0 && n > -14) return `${-n} days ago`; if (n > 0 && n < 60) return `in ${Math.round(n / 7)} weeks`; if (n < 0 && n > -60) return `${Math.round(-n / 7)} weeks ago`; const m = Math.round(n / 30.4); return n > 0 ? `in ${m} months` : `${-m} months ago`; };
  E.dayLabel = (s, today) => { const n = E.daysBetween(s, today); if (n === 0) return "Today"; if (n === 1) return "Yesterday"; if (n < 7) return E.weekday(s); return E.fmtDay(s, { year: s.slice(0, 4) !== today.slice(0, 4) }); };
  E.words = (n) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n);
  E.cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

  // ---------- connector grids → the snapshot shape ----------
  // Each tab's table starts at the first row whose first cell is the known header word.
  const HEAD = { metrics: "Metric ID", compliance: "Check", networth: "Month end", savings: "Opportunity", budget: "Category", settings: "Setting", kitty: "Key", accounts: "Account ID", category_list: "Category ID", goals: "Goal", subscriptions: "Service", loans: "Loan ID", assets: "Item ID", transactions: "Txn ID", payslips: "Pay date" };
  const blank = (r) => !r || r.every((v) => v == null || v === "");
  function gridTable(grid, head, opts = {}) {
    if (!Array.isArray(grid)) return [];
    const hi = grid.findIndex((r) => r && String(r[0]).trim() === head);
    if (hi < 0) return [];
    const keys = grid[hi].map(E.key);
    const out = [];
    for (let i = hi + 1; i < grid.length; i++) {
      const r = grid[i];
      if (blank(r) || r[0] === "" || r[0] == null) { if (opts.all) continue; break; }
      const o = {}; keys.forEach((k, j) => { if (k) o[k] = r[j] == null || r[j] === "" ? null : r[j]; }); out.push(o);
    }
    return out;
  }
  function gridPairs(grid, title) {
    const i = Array.isArray(grid) ? grid.findIndex((r) => r && r[0] === title) : -1; const out = {};
    for (let k = i + 1; i >= 0 && k < grid.length && grid[k] && grid[k][0] !== "" && grid[k][0] != null; k++) out[grid[k][0]] = grid[k][1];
    return out;
  }
  function gridAfter(grid, title, head) { const i = grid.findIndex((r) => r && r[0] === title); return i < 0 ? [] : gridTable(grid.slice(i + 1), head); }
  E.fromConnector = (g) => {
    const s = {};
    for (const [k, head] of Object.entries(HEAD)) s[k] = gridTable(g[k], head, { all: k === "budget" });
    s.budget = s.budget.filter((r) => r.category !== "Total");
    s.compliance = s.compliance.filter((r) => r.status);
    s.savings = s.savings.filter((r) => r.type === "Recurring" || r.type === "One-off");
    const mg = g.mortgage || [];
    s.mortgage_inputs = gridPairs(mg, "Loan inputs");
    s.mortgage = gridTable(mg, "Rate change").filter((r) => E.num(r.interest_rate) != null);
    s.mortgage_extra = gridAfter(mg, "Extra repayment scenarios", "Extra per month ($)");
    const tx = g.tax || []; const ti = tx.findIndex((r) => r && r[0] === "Person");
    s.tax = ti < 0 ? [] : tx.slice(ti + 1).filter((r) => r && r[0]).map((r) => ({ label: r[0], prior_j: r[1], prior_m: r[2], cur_j: r[3], cur_m: r[4], how: r[5] }));
    // Cash Flow is wide: months across the header row
    const cf = g.cashflow || []; const hi = cf.findIndex((r) => r && r[0] === "Month");
    s.cashflow = []; s.cashflow_categories = [];
    if (hi >= 0) {
      const hdr = cf[hi]; const cols = []; hdr.forEach((h, i) => { if (i > 0 && E.month(h)) cols.push(i); });
      const lines = { "Salary and interest": "salary_interest", "Rent received": "rent", "Total income": "income", Housing: "housing", Essentials: "essentials", Lifestyle: "lifestyle", Property: "property", "Work and giving": "work_giving", Fees: "fees", Uncategorised: "uncategorised", "Total spending": "spending", "Net cash flow": "net", "Savings rate": "savings_rate" };
      s.cashflow = cols.map((i) => ({ month: E.month(hdr[i]) }));
      const catStart = cf.findIndex((r, i) => i > hi && r && r[0] === "Spending by category");
      cf.slice(hi + 1, catStart < 0 ? cf.length : catStart).forEach((r) => { const k = lines[r && r[0]]; if (k) cols.forEach((i, j) => { s.cashflow[j][k] = k === "savings_rate" ? E.pct(r[i]) : E.num(r[i]) || 0; }); });
      if (catStart >= 0) s.cashflow_categories = cf.slice(catStart + 1).filter((r) => r && r[0]).map((r) => ({ category: r[0], months: cols.map((i) => E.num(r[i]) || 0) }));
    }
    s.household = s.settings.find((r) => r.setting === "Household")?.value || null;
    return s;
  };

  // ---------- the model: typed, cross-linked ----------
  const by = (f) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
  E.model = (snap) => {
    const kitty = {}; for (const r of snap.kitty || []) if (r.key) kitty[r.key] = r.value == null ? "" : String(r.value);
    E.dateOrder = ["US", "PH", "CA"].includes(String(kitty.country || "").toUpperCase()) && kitty.date_order !== "dmy" ? "mdy" : kitty.date_order === "mdy" ? "mdy" : "dmy";
    const settings = {}; for (const r of snap.settings || []) if (r.setting) settings[r.setting] = r.value;
    E.currency = kitty.currency || "AUD"; E.locale = { AU: "en-AU", NZ: "en-NZ", GB: "en-GB", US: "en-US", CA: "en-CA", SG: "en-SG", IE: "en-IE", EU: "de-DE" }[kitty.country] || "en-AU";
    const cats = (snap.category_list || []).map((c) => ({ id: c.category_id, name: c.category, group: c.group, flow: c.flow || "Expense", budget: E.num(c.monthly_budget), essential: c.essential === "Yes", tax: c.tax_treatment || "", ato: c.ato_label || "" }));
    const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
    const accounts = (snap.accounts || []).map((a) => ({ id: a.account_id, name: a.account, bank: a.institution, type: a.type, owner: a.owner, opening: E.num(a.opening_balance), balance: E.num(a.balance_at_as_of_date), liquid: a.liquid === "Yes" }));
    const acctById = Object.fromEntries(accounts.map((a) => [a.id, a]));
    const tx = (snap.transactions || []).map((t) => {
      const c = catById[t.category_id] || { name: "Uncategorised", group: "Uncategorised", flow: "Expense" };
      return { id: t.txn_id, date: E.date(t.date), acct: t.account_id, desc: t.bank_description || "", merchant: t.merchant || t.bank_description || "", amount: E.num(t.amount) || 0, cat: t.category_id || "UNCAT", catName: c.name, group: c.group, flow: c.flow, person: t.person || "Joint", receipt: t.receipt_held || "", note: t.note || "" };
    }).filter((t) => t.date).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
    const asOf = E.date(settings["As-of date"]) || (tx[0] && tx[0].date) || iso(new Date());
    const goals = (snap.goals || []).map((g, i) => ({ row: i + 2, name: g.goal, target: E.num(g.target_amount), date: E.date(g.target_date), acct: g.linked_account, balance: E.num(g.balance_now), progress: E.pct(g.progress), monthsLeft: E.num(g.months_left), needPm: E.num(g.needed_per_month), savedPm: E.num(g.saved_per_month_last_3_months), status: g.status || "" })).filter((g) => g.name);
    const subs = (snap.subscriptions || []).map((s) => ({ service: s.service, merchant: s.merchant, owner: s.owner, cadence: s.cadence || "Monthly", cat: s.category_id, lastUsed: E.date(s.last_used), lastUsedRaw: s.last_used, decision: s.decision || "", lastCharged: E.date(s.last_charged), latest: E.num(s.latest_charge), lowest: E.num(s.lowest_charge_in_look_back), perYear: E.num(s.charges_per_year), annual: E.num(s.annual_cost), riseEach: E.num(s.price_rise_per_charge), riseYear: E.num(s.annual_cost_of_price_rise), daysSince: E.num(s.days_since_used), flag: s.usage_flag || "" })).filter((s) => s.service);
    const loans = (snap.loans || []).map((l) => ({ id: l.loan_id, name: l.loan, lender: l.lender, purpose: l.purpose, type: l.repayment_type, rate: E.pct(l.interest_rate), end: E.date(l.loan_end_date), offset: l.offset_account || "", balance: E.num(l.balance_at_as_of_date), monthsLeft: E.num(l.months_remaining), repayment: E.num(l.monthly_repayment_calculated) }));
    const assets = (snap.assets || []).map((a) => ({ id: a.item_id, name: a.item, cls: a.class, owner: a.owner }));
    const metrics = {}; for (const m of snap.metrics || []) if (m.metric_id) metrics[m.metric_id] = { id: m.metric_id, label: m.metric, raw: m.value, num: m.unit === "Percent" ? E.pct(m.value) : E.num(m.value), text: m.unit === "Text" ? String(m.value == null ? "" : m.value) : null, unit: m.unit, period: m.period, compRaw: m.comparison_value, comp: m.unit === "Percent" && /%/.test(String(m.comparison_value)) ? E.pct(m.comparison_value) : E.num(m.comparison_value), comparedWith: m.compared_with || "", better: m.better_when || "" };
    const checks = (snap.compliance || []).map((c) => ({ name: c.check, type: c.type, items: E.num(c.items) || 0, amount: E.num(c.amount), status: c.status, why: c.why_it_matters || "", where: c.where_to_look || "" }));
    const networth = (snap.networth || []).map((n) => ({ month: E.date(n.month_end), cash: E.num(n.cash), property: E.num(n.property), super: E.num(n.super), shares: E.num(n.shares), vehicle: E.num(n.vehicle), loans: E.num(n.loans), total: E.num(n.net_worth), change: E.num(n.change_in_month) })).filter((n) => n.month);
    const cashflow = (snap.cashflow || []).map((c) => ({ month: E.month(c.month), income: E.num(c.income) || 0, salary: E.num(c.salary_interest) || 0, rent: E.num(c.rent) || 0, spending: E.num(c.spending) || 0, net: E.num(c.net) || 0, rate: E.pct(c.savings_rate), groups: { Housing: E.num(c.housing) || 0, Essentials: E.num(c.essentials) || 0, Lifestyle: E.num(c.lifestyle) || 0, Property: E.num(c.property) || 0, "Work and giving": E.num(c.work_giving) || 0, Fees: E.num(c.fees) || 0, Uncategorised: E.num(c.uncategorised) || 0 } })).filter((c) => c.month);
    const cfcats = (snap.cashflow_categories || []).map((c) => ({ name: c.category, months: (c.months || []).map((v) => E.num(v) || 0) }));
    const budget = (snap.budget || []).map((b) => ({ name: b.category, monthly: E.num(b.monthly_budget), latest: E.num(b.latest_month), avg3: E.num(b.average_last_3_months), ytd: E.num(b.year_to_date), toDate: E.num(b.budget_to_date), left: E.num(b.left_in_budget), used: E.pct(b.budget_used), status: b.status || "" })).filter((b) => b.name && b.name !== "Total");
    const savings = (snap.savings || []).map((s) => ({ title: s.opportunity, shows: s.what_the_data_shows || "", amount: E.num(s.estimated_saving), type: s.type, effort: s.effort, where: s.where_to_look || "", rank: E.num(s.rank) || 99 })).sort(by((s) => s.rank));
    const mi = snap.mortgage_inputs || {};
    const mortgage = {
      balance: E.num(mi["Loan balance ($)"]), offset: E.num(mi["Offset balance ($)"]), rate: E.pct(mi["Current interest rate"]), monthsLeft: E.num(mi["Months remaining"]), repayment: E.num(mi["Current monthly repayment ($)"]), netPm: E.num(mi["Average monthly net cash flow, last 3 months ($)"]), step: E.pct(mi["Rate step"]),
      scenarios: (snap.mortgage || []).map((r) => ({ change: E.pct(r.rate_change), rate: E.pct(r.interest_rate), repayment: E.num(r.monthly_repayment), changePm: E.num(r.change_per_month) || 0, changePy: E.num(r.change_per_year) || 0, netAfter: E.num(r.net_cash_flow_after_change), interest: E.num(r.interest_over_remaining_term), years: E.num(r.years_to_repay_at_today_s_repayment_with_offset) })).filter((r) => r.rate != null),
      extras: (snap.mortgage_extra || []).map((r) => ({ extra: E.num(r.extra_per_month) || 0, total: E.num(r.total_monthly_repayment), years: E.num(r.years_to_repay_with_offset), saved: E.num(r.years_saved) || 0, interestSaved: E.num(r.interest_saved) || 0 })),
    };
    const tax = {}; for (const r of snap.tax || []) if (r.label) tax[r.label] = { pj: E.num(r.prior_j), pm: E.num(r.prior_m), cj: E.num(r.cur_j), cm: E.num(r.cur_m), rawPj: r.prior_j, rawCj: r.cur_j, how: r.how || "" };
    const payslips = (snap.payslips || []).map((p) => ({ date: E.date(p.pay_date), person: p.person, employer: p.employer, gross: E.num(p.gross_pay), tax: E.num(p.tax_withheld), super: E.num(p.super), net: E.num(p.net_pay) })).filter((p) => p.date).sort(by((p) => p.date));
    const people = (kitty.people || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!people.length) for (const p of payslips) if (!people.includes(p.person)) people.push(p.person);
    const householdName = kitty.household_name || (settings.Household ? String(settings.Household).replace(/\s*\(.*\)\s*$/, "") : "This household");
    return { asOf, settings, kitty, householdName, people, cats, catById, accounts, acctById, tx, goals, subs, loans, assets, metrics, checks, networth, cashflow, cfcats, budget, savings, mortgage, tax, payslips, fetchedAt: snap.fetchedAt || null };
  };

  // ---------- windows and spending ----------
  E.window = (kind, anchor) => {
    const a = E.date(anchor);
    if (kind === "month") return { from: E.monthStart(a), to: E.monthEnd(a), label: E.fmtMonth(a) };
    if (kind === "quarter") { const from = E.addMonths(E.monthStart(a), -2); return { from, to: E.monthEnd(a), label: `${E.fmtMonth(from, true)} – ${E.fmtMonth(a, true)}` }; }
    if (kind === "year") { const from = E.addMonths(E.monthStart(a), -11); return { from, to: E.monthEnd(a), label: `${E.fmtMonth(from, true)} – ${E.fmtMonth(a, true)}` }; }
    if (kind === "fy") { const y = E.fyOf(a); return { from: `${y - 1}-07-01`, to: E.monthEnd(a), label: `FY${String(y).slice(2)} so far` }; }
    return { from: a, to: a, label: E.fmtDay(a) };
  };
  E.inWin = (t, w) => t.date >= w.from && t.date <= w.to;
  // Spending mirrors the sheet: expense categories summed by sign, transfers left out, income by category.
  E.spend = (tx, w, filter) => {
    const byCat = new Map(), byGroup = new Map(), byMerchant = new Map(); let out = 0, inc = 0, count = 0;
    for (const t of tx) {
      if (!E.inWin(t, w) || (filter && !filter(t))) continue;
      if (t.flow === "Transfer") continue;
      if (t.flow === "Income") { inc += t.amount; continue; }
      out -= t.amount; count++;
      byCat.set(t.cat, (byCat.get(t.cat) || 0) - t.amount);
      byGroup.set(t.group, (byGroup.get(t.group) || 0) - t.amount);
      byMerchant.set(t.merchant, (byMerchant.get(t.merchant) || 0) - t.amount);
    }
    const sortMap = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { out, in: inc, net: inc - out, count, byCat: sortMap(byCat), byGroup: sortMap(byGroup), byMerchant: sortMap(byMerchant) };
  };
  E.monthly = (m, n = 12) => {
    const out = []; let w = E.window("month", m.asOf);
    for (let i = 0; i < n; i++) { const s = E.spend(m.tx, w); out.unshift({ month: w.from, from: w.from, to: w.to, in: s.in, out: s.out, net: s.net }); w = E.window("month", E.addMonths(w.from, -1)); }
    return out;
  };
  E.merchantSeries = (m, merchant, n = 12) => E.monthly(m, n).map((mo) => ({ month: mo.month, v: E.spend(m.tx, mo, (t) => t.merchant === merchant).out }));
  // Where spending grew: last 3 months against the same 3 months a year earlier, per category.
  E.movers = (m, minPm) => {
    const min = minPm != null ? minPm : E.num(m.settings["Smallest monthly spend for the growth ranking ($)"]) || 100;
    const now = E.window("quarter", m.asOf), then = { from: E.addMonths(now.from, -12), to: E.addMonths(now.to, -12) };
    const a = E.spend(m.tx, now), b = E.spend(m.tx, then); const bm = new Map(b.byCat);
    const seen = new Set();
    const rows = [];
    for (const [cat, v] of a.byCat) { seen.add(cat); const prev = bm.get(cat) || 0; const nowPm = v / 3, thenPm = prev / 3; if (nowPm < min && thenPm < min) continue; rows.push({ cat, name: (m.catById[cat] || {}).name || cat, nowPm, thenPm, diff: nowPm - thenPm, pct: thenPm > 0 ? (nowPm - thenPm) / thenPm : null }); }
    for (const [cat, prev] of b.byCat) if (!seen.has(cat) && prev / 3 >= min) rows.push({ cat, name: (m.catById[cat] || {}).name || cat, nowPm: 0, thenPm: prev / 3, diff: -prev / 3, pct: -1 });
    rows.sort((x, y) => y.diff - x.diff);   // biggest dollar increase first; decreases at the end
    // the sheet's "fastest growing": the largest percentage rise among categories still above the floor
    const grown = rows.filter((r) => r.nowPm >= min && r.thenPm > 0 && r.pct > 0).sort((x, y) => y.pct - x.pct);
    rows.fastest = grown[0] || null;
    return rows;
  };

  // ---------- what's coming up ----------
  E.cadenceMonths = (c) => ({ weekly: 0.25, fortnightly: 0.5, monthly: 1, quarterly: 3, annual: 12, yearly: 12 }[String(c || "monthly").toLowerCase()] || 1);
  E.nextCharge = (s, today) => {
    if (!s.lastCharged) return null;
    const mo = E.cadenceMonths(s.cadence);
    let d = s.lastCharged, guard = 0;
    while (d <= today && guard++ < 200) d = mo < 1 ? E.addDays(d, Math.round(mo * 28)) : E.addMonths(d, mo);
    return d;
  };
  E.payday = (m) => {
    const cycle = { weekly: 7, fortnightly: 14, monthly: 30 }[String(m.kitty.pay_cycle || "fortnightly").toLowerCase()] || 14;
    const out = [];
    for (const p of m.people) {
      const mine = m.payslips.filter((x) => x.person === p); if (!mine.length) continue;
      const last = mine[mine.length - 1]; let next = last.date, guard = 0;
      while (next <= m.asOf && guard++ < 60) next = cycle === 30 ? E.addMonths(next, 1) : E.addDays(next, cycle);
      const nets = mine.slice(-3).map((x) => x.net).sort((a, b) => a - b);
      out.push({ person: p, employer: last.employer, next, net: nets[Math.floor(nets.length / 2)], days: E.daysBetween(m.asOf, next) });
    }
    return out.sort(by((p) => p.next));
  };
  // Up's "this pay cycle": spending since the household's most recent pay day
  E.sinceLastPay = (m) => {
    const last = m.payslips.filter((p) => p.date <= m.asOf).map((p) => p.date).sort().pop(); if (!last) return null;
    const sp = E.spend(m.tx, { from: last, to: m.asOf }); return { date: last, out: sp.out, days: E.daysBetween(last, m.asOf) + 1 };
  };
  E.upcoming = (m, days) => {
    if (days == null) days = E.num(m.kitty.look_ahead_days) || 35;
    const today = m.asOf, until = E.addDays(today, days), items = [];
    for (const s of m.subs) { if (/cancel/i.test(s.decision) && /cancelled/i.test(s.flag)) continue; const d = E.nextCharge(s, today); if (d && d <= until) items.push({ date: d, kind: "bill", title: s.service, sub: `${E.cap(String(s.cadence).toLowerCase())}${s.owner && s.owner !== "Joint" ? ` · ${s.owner}` : ""}${/still charging/i.test(s.flag) ? " · still charging after cancel" : ""}`, amount: -(s.latest || 0), warn: /still charging/i.test(s.flag), ref: { type: "sub", key: s.service } }); }
    for (const l of m.loans) { if (!l.repayment) continue; let d = E.monthStart(E.addMonths(today, 1)); if (l.purpose === "Investment") d = E.addDays(E.monthEnd(today), 0) <= today ? E.monthEnd(E.addMonths(today, 1)) : E.monthEnd(today); if (d > today && d <= until) items.push({ date: d, kind: "loan", title: `${l.name} ${l.type === "Interest only" ? "interest" : "repayment"}`, sub: `${l.lender} · ${E.fmtPct(l.rate, 2)}`, amount: -l.repayment, ref: { type: "loan", key: l.id } }); }
    for (const p of E.payday(m)) if (p.next <= until) items.push({ date: p.next, kind: "pay", title: `${p.person}'s pay`, sub: p.employer, amount: p.net, ref: { type: "pay", key: p.person } });
    for (const g of m.goals) if (g.date > today && g.date <= until) items.push({ date: g.date, kind: "goal", title: `${g.name} target date`, sub: g.status === "Reached" ? "Reached" : `${E.fmt0(g.target - (g.balance || 0))} still to go`, amount: null, ref: { type: "goal", key: g.name } });
    return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  };

  // ---------- safety net, goals, forecasts ----------
  E.safety = (m) => {
    const target = E.num(m.settings["Emergency fund target (months of essential spending)"]) || (m.metrics["emergency.months_covered"] && m.metrics["emergency.months_covered"].comp) || 6;
    const months = m.metrics["emergency.months_covered"] ? m.metrics["emergency.months_covered"].num : null;
    const liquid = m.accounts.filter((a) => a.liquid && a.type !== "Credit card").reduce((s, a) => s + (a.balance || 0), 0);
    const essentialPm = months ? liquid / months : null;
    return { months, target, liquid, essentialPm, short: months != null && essentialPm ? Math.max(0, (target - months) * essentialPm) : null, pct: months != null ? Math.min(1, months / target) : null };
  };
  E.goalEta = (g, extraPm = 0, asOf) => {
    const left = Math.max(0, (g.target || 0) - (g.balance || 0)), pace = (g.savedPm || 0) + extraPm;
    if (left <= 0) return { months: 0, date: asOf, reached: true };
    if (pace <= 0) return { months: null, date: null, reached: false };
    const months = Math.ceil(left / pace);
    return { months, date: E.addMonths(asOf, months), reached: false, late: g.date ? E.addMonths(asOf, months) > g.date : false };
  };
  E.goalIcon = (name) => { const n = String(name).toLowerCase(); if (/emergency|safety|buffer|rainy/.test(n)) return "🛟"; if (/japan|trip|holiday|travel|europe|bali|ski/.test(n)) return "✈️"; if (/offset|loan|mortgage|house|home|deposit/.test(n)) return "🏡"; if (/car|wheels/.test(n)) return "🚗"; if (/wedding|ring/.test(n)) return "💍"; if (/baby|kid|school/.test(n)) return "🧸"; if (/reno|kitchen|bath/.test(n)) return "🔨"; return "🎯"; };
  E.goalColor = (name) => { const n = String(name).toLowerCase(); if (/emergency|safety|buffer/.test(n)) return "var(--c-in)"; if (/japan|trip|holiday|travel/.test(n)) return "var(--accent)"; if (/offset|loan|mortgage|home/.test(n)) return "var(--amber)"; return "var(--c-kept)"; };

  // ---------- subscriptions and leaks ----------
  E.leaks = (m) => {
    const unused = m.subs.filter((s) => /unused|never/i.test(s.flag) && !/cancel/i.test(s.decision));
    const stillCharging = m.subs.filter((s) => /still charging/i.test(s.flag));
    const rises = m.subs.filter((s) => (s.riseYear || 0) > 0 && !/cancel/i.test(s.decision));
    const review = m.subs.filter((s) => /review/i.test(s.decision));
    const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
    return { unused, stillCharging, rises, review, unusedYear: sum(unused, (s) => s.annual), stillYear: sum(stillCharging, (s) => s.annual), risesYear: sum(rises, (s) => s.riseYear), total: m.subs.filter((s) => !/cancel/i.test(s.decision) || /still charging/i.test(s.flag)).reduce((a, s) => a + (s.annual || 0), 0) };
  };

  // ---------- the verdict and the one list of what needs a person ----------
  E.needs = (m) => {
    const items = [];
    const push = (x) => items.push(x);
    const ck = (name) => m.checks.find((c) => c.name.startsWith(name));
    const close = m.metrics["close.items_missing"];
    if (close && close.num > 0) push({ em: "📥", t: `${E.words(close.num)} month-end item${close.num > 1 ? "s are" : " is"} missing`, s: "Valuations, payslips or a bank import have not landed, so some numbers are provisional.", warn: true, go: "setup", amt: null });
    const dup = ck("Possible duplicate charges");
    if (dup && dup.status === "Review" && dup.items) push({ em: "👯", t: `${E.words(dup.items)} charge${dup.items > 1 ? "s look" : " looks"} doubled`, s: "Same merchant, amount, account and day. Usually worth a dispute.", warn: true, go: "dupes", amt: dup.amount, amtNote: "to recover" });
    const lk = E.leaks(m);
    for (const s of lk.stillCharging) push({ em: "🧟", t: `${s.service} is still charging after you cancelled`, s: `Last charged ${E.fmtDay(s.lastCharged)} · ${E.fmt(s.latest)} ${String(s.cadence).toLowerCase()}`, warn: true, go: "sub:" + s.service, amt: s.annual, amtNote: "a year" });
    const taxItems = m.checks.filter((c) => c.type === "Tax" && c.status === "Review");
    const risk = m.metrics["tax.refund_at_risk.prior_year"];
    if (taxItems.length) push({ em: "🧾", t: `${E.words(taxItems.reduce((a, c) => a + c.items, 0))} tax claim${taxItems.length > 1 ? "s need" : " needs"} evidence`, s: `${E.fmt0(risk ? risk.num : null)} of the expected refund rests on them. ${taxItems[0].why}`, warn: false, go: "checks", amt: risk ? risk.num : null, amtNote: "at risk" });
    const interest = ck("Card interest charged");
    if (interest && interest.status === "Review") push({ em: "💳", t: "The card charged interest this year", s: interest.why, warn: false, go: "cat:FEES", amt: interest.amount, amtNote: "interest" });
    if (lk.unused.length) push({ em: "😴", t: `${E.words(lk.unused.length)} subscription${lk.unused.length > 1 ? "s haven't" : " hasn't"} been used in months`, s: lk.unused.map((s) => s.service).join(", "), warn: false, go: "subs", amt: lk.unusedYear, amtNote: "a year" });
    const behind = m.goals.filter((g) => /behind/i.test(g.status));
    for (const g of behind.slice(0, 2)) push({ em: E.goalIcon(g.name), t: `${g.name} is behind pace`, s: `Needs ${E.fmt0(g.needPm)} a month until ${E.fmtMonth(g.date, true)}; the last 3 months put in ${E.fmt0(g.savedPm)}.`, warn: false, go: "goal:" + g.name, amt: g.needPm - g.savedPm, amtNote: "a month short" });
    const sf = E.safety(m);
    if (sf.months != null && sf.months < sf.target) push({ em: "🛟", t: `Safety net covers ${sf.months.toFixed(1)} of ${sf.target} months`, s: `About ${E.fmtS(sf.short)} more in cash would reach the target you set.`, warn: false, go: "safety", amt: null });
    const over = m.budget.filter((b) => /over/i.test(b.status));
    if (over.length) push({ em: "📈", t: `${over.length === 1 ? over[0].name + " is" : over.length === 2 ? `${over[0].name} and ${over[1].name} are` : `${over.length} categories are`} over budget this year`, s: over.slice(0, 3).map((b) => `${b.name} ${E.fmtPct(b.used)}`).join(" · "), warn: false, go: "budget", amt: -over.reduce((a, b) => a + (b.left || 0), 0), amtNote: "over so far" });
    const uncat = ck("Uncategorised transactions");
    if (uncat && uncat.items) push({ em: "🏷️", t: `${E.words(uncat.items)} transaction${uncat.items > 1 ? "s need" : " needs"} a category`, s: "Left out of budgets and tax totals until someone names them.", warn: false, go: "cat:UNCAT", amt: uncat.amount });
    const bigAt = E.num(m.kitty.big_bill_amount) || 500;
    const big = E.upcoming(m, 14).filter((u) => u.kind === "bill" && -u.amount >= bigAt);
    for (const u of big) push({ em: "📅", t: `${u.title} is due ${E.rel(m.asOf, u.date)}`, s: u.sub, warn: false, go: "upcoming", amt: -u.amount });
    items.sort((a, b) => (b.warn === true) - (a.warn === true));
    const n = items.length;
    const verdict = items.some((i) => i.warn) ? "Worth a look." : n ? "Mostly on track." : "On track.";
    const line = !n ? "Nothing needs you today." : n === 1 ? "One thing needs you." : `${E.cap(E.words(n))} things need you.${n > 4 ? " The first four are here." : ""}`;
    return { verdict, line, items: items.slice(0, 4), all: items, more: Math.max(0, n - 4) };
  };

  // ---------- property, net worth ----------
  E.property = (m) => {
    const w = E.window("year", m.asOf); const rentIn = E.spend(m.tx, w, (t) => t.cat === "RENT-INC").in;
    const costs = E.spend(m.tx, w, (t) => /^RENT-/.test(t.cat) && t.cat !== "RENT-INC");
    const loan = m.loans.find((l) => l.purpose === "Investment");
    return { rentPm: rentIn / 12, costPm: costs.out / 12, netPm: (rentIn - costs.out) / 12, byCat: costs.byCat.map(([c, v]) => ({ cat: c, name: (m.catById[c] || {}).name || c, pm: v / 12 })), loan, asset: m.assets.find((a) => a.id === "RENTAL"), value: (m.networth[m.networth.length - 1] || {}).property };
  };
  E.ownership = (m) => { const n = m.networth[m.networth.length - 1]; if (!n) return []; return [["Property", n.property, "var(--c-loan)"], ["Super", n.super, "var(--accent)"], ["Cash", n.cash, "var(--c-in)"], ["Shares", n.shares, "var(--c-kept)"], ["Vehicle", n.vehicle, "var(--c-move)"]].filter((x) => x[1] > 0).map(([k, v, c]) => ({ k, v, c })); };

  // ---------- search ----------
  E.parseQuery = (q, m) => {
    const f = { text: [], person: null, cat: null, min: null, max: null, from: null, to: null, acct: null };
    for (const tok of String(q || "").toLowerCase().split(/\s+/).filter(Boolean)) {
      let x;
      if ((x = tok.match(/^person:(\w+)$/))) f.person = x[1];
      else if ((x = tok.match(/^(?:cat|category):([\w-]+)$/))) f.cat = x[1];
      else if ((x = tok.match(/^(?:acct|account):([\w-]+)$/))) f.acct = x[1];
      else if ((x = tok.match(/^>\$?(\d+)$/))) f.min = +x[1];
      else if ((x = tok.match(/^<\$?(\d+)$/))) f.max = +x[1];
      else if (MON[tok.slice(0, 3)] && tok.length >= 3 && /^[a-z]+$/.test(tok)) { const mo = MON[tok.slice(0, 3)]; const y = E.fyOf(m.asOf) - (mo >= 7 ? 1 : 0); const yy = `${y}-${pad2(mo)}-01` > m.asOf ? y - 1 : y; f.from = `${yy}-${pad2(mo)}-01`; f.to = E.monthEnd(f.from); }
      else if (/^\d{4}$/.test(tok)) { f.from = `${tok}-01-01`; f.to = `${tok}-12-31`; }
      else if (m.people.some((p) => p.toLowerCase() === tok)) f.person = tok;
      else f.text.push(tok);
    }
    return f;
  };
  E.match = (m, q) => {
    const f = E.parseQuery(q, m);
    const catIds = f.cat ? m.cats.filter((c) => c.id.toLowerCase() === f.cat || c.name.toLowerCase().includes(f.cat) || c.group.toLowerCase() === f.cat).map((c) => c.id) : null;
    return m.tx.filter((t) => {
      if (f.person && t.person.toLowerCase() !== f.person) return false;
      if (catIds && !catIds.includes(t.cat)) return false;
      if (f.acct && t.acct.toLowerCase() !== f.acct) return false;
      if (f.min != null && Math.abs(t.amount) < f.min) return false;
      if (f.max != null && Math.abs(t.amount) > f.max) return false;
      if (f.from && (t.date < f.from || t.date > f.to)) return false;
      const hay = `${t.merchant} ${t.desc} ${t.catName} ${t.group} ${t.note} ${t.person}`.toLowerCase();
      return f.text.every((w) => hay.includes(w));
    });
  };
  E.csv = (rows, cols) => { const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return [cols.map((c) => q(c.label || c.key)).join(",")].concat(rows.map((r) => cols.map((c) => q(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","))).join("\n"); };

  // ---------- consistency checks the page shows in its trust drawer ----------
  E.reconcile = (m) => {
    const out = [];
    const liquid = m.accounts.filter((a) => a.liquid).reduce((s, a) => s + (a.balance || 0), 0);
    const cashM = m.metrics["networth.cash"]; if (cashM && cashM.num != null) out.push({ what: "Accounts add up to the Cash metric", a: liquid, b: cashM.num, ok: Math.abs(liquid - cashM.num) < 1 });
    const last = m.cashflow[m.cashflow.length - 1];
    if (last) { const s = E.spend(m.tx, E.window("month", last.month)); out.push({ what: `Transactions add up to the Cash Flow tab for ${E.fmtMonth(last.month)}`, a: s.out, b: last.spending, ok: Math.abs(s.out - last.spending) < 1 }); }
    const ids = new Set(); let dupIds = 0; for (const t of m.tx) { if (ids.has(t.id)) dupIds++; ids.add(t.id); } out.push({ what: "Every transaction ID is used once", a: dupIds, b: 0, ok: dupIds === 0, count: true });
    const unknown = m.tx.filter((t) => !m.catById[t.cat]).length; out.push({ what: "Every category ID exists on the Categories tab", a: unknown, b: 0, ok: unknown === 0, count: true });
    return out;
  };

  return E;
});
