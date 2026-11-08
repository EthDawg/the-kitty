/* The Kitty kit: sheet version 3, read for the page. The five tabs CHANGES.md version 3 adds (Receipts, Receipt Lines,
   Decision Options, Goal Levers, Tax Returns), read from the bundled snapshot in demo mode or from connector grids in live
   mode, and mapped onto the inputs of the shared view modules (things.js, levers.js, taxview.js, groceries.js).
   The mappings are the ones tools/kit-demo/*.data.js use for the Davies, written over the engine's model so they read a
   live sheet the same way; test/v3-page.test.js keeps them in step. A tab that is missing or empty maps to null, and the
   page keeps that view dark. Nothing here computes a number the sheet computes, except the lever dates in demo mode,
   which follow the Goal Levers formulas exactly. Runs in the page (window.Kit.V3) and in node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../engine.js"));
  else root.Kit = Object.assign(root.Kit || {}, { V3: factory(root.Engine) });
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";
  const V = {};
  // snapshot key -> the tab, its first header (the header row is found by it) and its last column
  V.TABS = {
    receipts: { tab: "Receipts", head: "Receipt ID", last: "T" },
    receipt_lines: { tab: "Receipt Lines", head: "Receipt ID", last: "P" },
    decision_options: { tab: "Decision Options", head: "Decision ID", last: "N" },
    goal_levers: { tab: "Goal Levers", head: "Lever ID", last: "J" },
    tax_returns: { tab: "Tax Returns", head: "Person", last: "N" },
  };
  V.KEYS = Object.keys(V.TABS);
  V.range = (k) => `'${V.TABS[k].tab}'!A1:${V.TABS[k].last}`;

  // ---------- reading ----------
  const filled = (rows) => (Array.isArray(rows) && rows.length ? rows : null);
  // demo: the snapshot already holds feed-shaped rows
  V.fromSnapshot = (snap) => Object.fromEntries(V.KEYS.map((k) => [k, filled(snap && snap[k]) ? snap[k].filter((r) => r && typeof r === "object") : null]));
  // live: get_values grids, header row first. Each row keeps its sheet row number in _row, for writes.
  V.fromGrid = (grid, head) => {
    if (!Array.isArray(grid)) return null;
    const hi = grid.findIndex((r) => Array.isArray(r) && String(r[0] == null ? "" : r[0]).trim() === head);
    if (hi < 0) return null;
    const keys = grid[hi].map(E.key), out = [];
    for (let i = hi + 1; i < grid.length; i++) {
      const r = grid[i];
      if (!Array.isArray(r) || r[0] == null || String(r[0]).trim() === "") continue;
      const o = { _row: i + 1 };
      keys.forEach((k, j) => { if (k) o[k] = r[j] == null || r[j] === "" ? null : r[j]; });
      out.push(o);
    }
    return filled(out);
  };
  V.fromGrids = (grids) => Object.fromEntries(V.KEYS.map((k) => [k, V.fromGrid(grids && grids[k], V.TABS[k].head)]));
  V.lit = (t) => V.KEYS.filter((k) => t && t[k]);

  // the feed types its cells; a connector read gives display strings. These read both.
  const num = (v) => E.num(v);
  const bool = (v) => v === true || (typeof v === "string" && /^(true|yes|y|1)$/i.test(v.trim())) || v === 1;
  const date = (v) => E.date(v);
  const dateOrNever = (v) => (v != null && /^\s*never/i.test(String(v)) ? "Never" : E.date(v));
  const text = (v) => (v == null ? "" : String(v));
  V.bool = bool;

  // ---------- Things: Contracts mapped onto things, Decision Options onto decision cards ----------
  // The Davies placement (tools/kit-demo/things.data.js): which thing each contract belongs to and the group it sits in.
  // A row applies only to the contract of that ID and name; anything else is placed by the general rule below.
  const PLACE = {
    C0011: ["CAR", "Family car", "Wheels", "Car insurance"], C0012: ["HOME", "Family home, Brunswick", "Home & property", "Home and contents insurance"], C0014: ["HOME", "Family home, Brunswick", "Home & property", "Internet"],
    C0013: ["RENTAL", "Investment townhouse, Geelong", "Home & property", "Landlord insurance"], C0015: ["PHONES", "Phones", "Phones & devices", "Mobile plans"], C0010: ["HEALTH", "Health cover", "Plans", "Bupa health cover"],
    C0001: ["STREAM", "Streaming and music", "Plans", "Netflix"], C0002: ["STREAM", "Streaming and music", "Plans", "Spotify Family"], C0003: ["STREAM", "Streaming and music", "Plans", "Disney+"], C0004: ["STREAM", "Streaming and music", "Plans", "Kayo Sports"], C0005: ["STREAM", "Streaming and music", "Plans", "Paramount+"], C0017: ["STREAM", "Streaming and music", "Plans", "YouTube Premium"],
    C0006: ["CLOUD", "Cloud storage", "Storage", "iCloud+ 2TB"], C0007: ["CLOUD", "Cloud storage", "Storage", "Dropbox Plus"], C0008: ["AI", "ChatGPT Plus", "Plans", "ChatGPT Plus"],
    C0009: ["ACTIVE", "Gym and swim school", "Plans", "Anytime Fitness"], C0016: ["ACTIVE", "Gym and swim school", "Plans", "Swim school"],
  };
  const NEXT = { C0011: "Renews", C0012: "Renews", C0013: "Renews", C0010: "Next payment" };
  const IMG = { HOME: "house", RENTAL: "townhouse", CAR: "car-wagon", PHONES: "sim", HEALTH: "health", STREAM: "streaming", CLOUD: "cloud", AI: "ai", ACTIVE: "active" };
  const CLASS_GROUP = { property: "Home & property", vehicle: "Wheels", device: "Phones & devices" };
  // Loans and leases live on Property and Goals, so they are not things.
  function place(c, m) {
    const p = PLACE[c.id];
    if (p && p[3] === c.name) return { id: p[0], name: p[1], group: p[2], image: IMG[p[0]] || null, next: NEXT[c.id] };
    if (c.kind === "loan" || c.kind === "lease") return null;
    const a = c.acct && m.acctById[c.acct], cls = a && String(a.cls || a.type || "").toLowerCase();
    if (a && CLASS_GROUP[cls]) return { id: a.id, name: a.name, group: CLASS_GROUP[cls], image: cls === "vehicle" ? "car-wagon" : cls === "device" ? "laptop" : /invest|rental/i.test(`${a.purpose} ${a.name}`) ? "townhouse" : "house" };
    if (c.kind === "insurance") return { id: c.id, name: c.name, group: "Insurance", image: /health/i.test(`${c.cat} ${c.name}`) ? "health" : "shield" };
    return { id: c.id, name: c.name, group: "Subscriptions", image: null };
  }
  const perMonth = (c) => { const a = c.amount || 0; return /annual|year/i.test(c.cadence) ? a / 12 : /week/i.test(c.cadence) ? (a * 52) / 12 : a; };
  V.thingsInput = (m, t, art) => {
    if (!m) return null;
    const asOf = m.asOf, pics = art || {};
    const decided = new Map(m.decisions.filter((d) => d.refKind === "contract").map((d) => [d.ref, d.value]));
    const things = new Map(), thingOf = {};
    for (const c of m.contracts) {
      const p = place(c, m); if (!p || c.status !== "active") continue;
      thingOf[c.id] = p.id;
      if (decided.get(c.id) === "Cancel") continue;   // decided and gone; the Decisions tab keeps the history
      if (!things.has(p.id)) things.set(p.id, { id: p.id, name: p.name, group: p.group, owner: c.owner, image: (p.image && pics[p.image]) || null, monthly: 0, owed: 0, exit: 0, nextDate: null, nextLabel: "", confidence: "Measured", contracts: [], source: "Contracts tab" });
      const th = things.get(p.id), mo = Math.round(perMonth(c) * 100) / 100;
      th.monthly = Math.round((th.monthly + mo) * 100) / 100;
      if (th.owner !== c.owner) th.owner = "Joint";
      th.contracts.push({ id: c.id, product: c.name, provider: c.provider, monthly: mo, cost: c.amount, cadence: (c.cadence || "").toLowerCase(), start: c.start, end: c.end, nextDate: c.next, exit: 0, decision: decided.get(c.id) || "", confidence: "Measured", source: `Contracts ${c.id}` });
      if (c.next && c.next >= asOf && (!th.nextDate || c.next < th.nextDate)) { th.nextDate = c.next; th.nextLabel = `${p.next || "Next charge"}: ${c.name}`; }
    }
    // one card per Decision ID, options in sheet order; the ref is a contract, so it points at that contract's thing
    const byId = new Map();
    for (const o of t && t.decision_options ? t.decision_options : []) {
      const id = text(o.decision_id); if (!id) continue;
      if (!byId.has(id)) byId.set(id, { id, question: text(o.question), ref: thingOf[o.ref] || text(o.ref), decideBy: date(o.decide_by), status: text(o.status) || "Open", source: "", options: [] });
      const d = byId.get(id); if (o.question && !d.question) d.question = text(o.question);
      d.options.push({ option: text(o.option), upfront: num(o.upfront) || 0, perMonth: num(o.per_month) || 0, months: num(o.months) || 0, extra: num(o.extra) || 0, total: num(o.total), recommended: bool(o.recommended), note: text(o.note), source: text(o.source) });
    }
    for (const d of byId.values()) d.source = [...new Set(d.options.map((o) => o.source).filter(Boolean))].join("; ");
    const decisions = [...byId.values()];
    if (!things.size && !decisions.some((d) => d.status === "Open")) return null;
    return { asOf, today: asOf, things: [...things.values()], decisions };
  };

  // ---------- What moves the date: Goal Levers for one goal ----------
  // Goals with levers, the one to show first: the lead goal if it has levers, then the goals behind, those whose levers
  // move the date most first, then the rest in sheet order.
  V.leverGoals = (m, t, lead) => {
    if (!m || !t || !t.goal_levers) return [];
    const rows = t.goal_levers, named = m.goals.filter((g) => rows.some((r) => r.goal === g.name));
    const reach = (g) => rows.filter((r) => r.goal === g.name).reduce((s, r) => s + Math.abs(num(r.months_moved) || 0), 0);
    const rank = (g) => (lead && g.name === lead ? 0 : g.status === "Behind" ? 1 : g.status === "Reached" ? 3 : 2);
    return named.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || reach(b.g) - reach(a.g) || a.i - b.i).map((x) => x.g.name);
  };
  V.leversInput = (m, t, goalName, opts = {}) => {
    if (!m || !t || !t.goal_levers) return null;
    const g = m.goals.find((x) => x.name === goalName);
    const rows = t.goal_levers.filter((r) => r.goal === goalName);
    if (!g || !rows.length) return null;
    const levers = rows.map((r) => ({ id: text(r.lever_id), lever: text(r.lever), on: bool(r.on), perMonth: num(r.per_month) || 0, oneOff: num(r.one_off) || 0, dateIfOn: dateOrNever(r.date_if_on), dateIfOff: dateOrNever(r.date_if_off), monthsMoved: num(r.months_moved), source: text(r.source), writable: !!opts.writable, row: r._row || null }));
    return { asOf: m.asOf, goal: { name: g.name, target: g.target, have: g.balance, planDate: V.planDate(levers), targetDate: g.date, allOffDate: null }, levers, extraDates: [] };
  };
  // "with the levers as set, Date if on for any lever that is on equals the plan date" (CHANGES.md version 3)
  V.planDate = (levers) => { const on = levers.find((l) => l.on); return on ? on.dateIfOn : levers.length ? levers[0].dateIfOff : null; };
  // The Goal Levers formulas (G, H, I), for the demo, where a switch is worked out on the page instead of in the sheet.
  const monthIdx = (iso) => +iso.slice(0, 4) * 12 + (+iso.slice(5, 7) - 1);
  const fromIdx = (n) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;
  V.leverDates = (goal, levers, asOf) => {
    const need = (goal.target || 0) - (goal.balance != null ? goal.balance : goal.have || 0), base = goal.savedPm || 0, now = monthIdx(asOf);
    const at = (rest, rate) => (rest <= 0 ? fromIdx(now) : rate <= 0 ? "Never" : fromIdx(now + Math.ceil(rest / rate - 1e-9)));
    const on = levers.filter((l) => l.on), pm = on.reduce((s, l) => s + (l.perMonth || 0), 0), oo = on.reduce((s, l) => s + (l.oneOff || 0), 0);
    return levers.map((l) => {
      const opm = pm - (l.on ? l.perMonth || 0 : 0), ooo = oo - (l.on ? l.oneOff || 0 : 0);
      const dOn = at(need - ooo - (l.oneOff || 0), base + opm + (l.perMonth || 0)), dOff = at(need - ooo, base + opm);
      return { ...l, dateIfOn: dOn, dateIfOff: dOff, monthsMoved: dOn === "Never" || dOff === "Never" ? null : monthIdx(dOff) - monthIdx(dOn) };
    });
  };

  // ---------- Tax: Tax Returns, with this year so far from the Tax Forecast (tools/kit-demo/taxview.data.js) ----------
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WORDS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
  const dollars = (x) => "$" + String(Math.round(Math.abs(x))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dayText = (iso) => { const [y, mo, d] = iso.split("-").map(Number); return `${d} ${SHORT[mo - 1]} ${y}`; };
  V.taxInput = (m, t) => {
    if (!m || !t || !t.tax_returns) return null;
    const returns = t.tax_returns.map((r) => ({
      person: text(r.person), fy: text(r.fy), status: text(r.status),
      taxable: num(r.taxable_income), tax: num(r.tax_on_income), medicare: num(r.medicare), offsets: num(r.offsets), withheld: num(r.withheld), result: num(r.result),
      lodged: date(r.lodged), notice: date(r.notice), pack: r.pack || null, source: r.source || null, note: r.note || null,
    }));
    const people = [...new Set(returns.map((r) => r.person).filter(Boolean))];
    return { people, asOf: m.asOf, current: taxCurrent(m, people), returns };
  };
  function taxCurrent(m, people) {
    const setting = (name) => m.settings[name];
    const asOf = m.asOf, fy = String(setting("Current financial year") || ""), monthsElapsed = num(setting("Months elapsed in current financial year"));
    if (!/^FY\d{2}$/.test(fy) || !monthsElapsed || !Object.keys(m.tax || {}).length) return null;
    const fyEnd = 2000 + Number(fy.slice(2)), fyStart = `${fyEnd - 1}-07-01`, lodgeMonth = `July ${fyEnd}`;
    // The Tax Forecast keeps two columns per person: the first person's, then the second's
    const order = m.people.length ? m.people : people;
    const col = (p) => ["cj", "cm"][order.indexOf(p)];
    const line = (label, p) => { const r = m.tax[label], c = col(p); return r && c ? r[c] || 0 : 0; };
    const medicareRate = num(setting("Medicare levy rate")) || 0.02;
    const wfhRate = num(setting("Work-from-home rate per hour ($)")) || 0;
    const factor = 12 / monthsElapsed;
    const inYear = (x) => x.date >= fyStart && x.date <= asOf;
    const check = (name) => m.checks.find((c) => c.name === name) || {};
    const firstSentence = (s) => (s ? String(s).split(/(?<=\.)\s/)[0] : "");
    const donationWhy = firstSentence(check("Donations without a receipt").why) || "Only gifts to registered charities, with a receipt, can be claimed.";
    const workWhy = check("Work expenses without a receipt").why || "A claim can be denied without written evidence.";
    const repairWhy = check("Large rental repairs").why || "";
    const perPerson = {}, missing = [];
    for (const p of people) {
      if (!col(p)) continue;
      const gross = line("Gross rent (share)", p), costs = -line("Rental expenses paid (share)", p), capital = -line("Depreciation and capital works (share)", p);
      // large repairs are held out as a flagged claim, so the counted rental result is the corrected one
      const repairsBack = line("Add back large rental repairs (share)", p) + line("Less capital works on those improvements", p);
      const rentNet = line("Net rental income or loss", p) + repairsBack;
      const work = -line("Work-related expenses", p), workNoReceipt = line("Add back work expenses without a receipt", p);
      const gifts = -line("Gifts and donations", p), giftsNoReceipt = line("Add back donations without a receipt", p);
      const wfh = -line("Work-from-home deduction", p);
      const hoursSoFar = num(setting(`Work-from-home hours, ${p}, current year to date`)) || 0;
      const deductions = [];
      if (work - workNoReceipt > 0) deductions.push({ label: "Work-related expenses", amount: work - workNoReceipt, flagged: false, why: "", source: "Transactions, as recorded so far, not projected" });
      if (wfh > 0) deductions.push({ label: "Work from home", amount: wfh, flagged: false, why: "", source: `${hoursSoFar} hours so far, about ${Math.round(hoursSoFar * factor)} by June, at ${Math.round(wfhRate * 100)}c an hour` });
      if (gifts - giftsNoReceipt > 0) deductions.push({ label: "Donations", amount: gifts - giftsNoReceipt, flagged: false, why: "", source: "Transactions, as recorded so far" });
      if (workNoReceipt > 0) deductions.push({ label: "Work-related expenses", amount: workNoReceipt, flagged: true, flag: "has no receipt", why: workWhy, source: "Transactions, Receipt held is N" });
      if (repairsBack > 0) deductions.push({ label: "Rental repairs", amount: repairsBack, flagged: true, flag: "looks like an improvement", why: repairWhy, source: "Transactions, category RENT-REPAIR" });
      if (giftsNoReceipt > 0) {
        const list = m.tx.filter((x) => inYear(x) && x.cat === "DONATION" && x.person === p && x.receipt !== "Y").sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const who = list.map((x) => `${dollars(x.amount)} to ${x.merchant} on ${dayText(x.date)}`).join(", ");
        deductions.push({ label: "Donations", amount: giftsNoReceipt, flagged: true, flag: "has no receipt", why: donationWhy, source: who ? `${who}, no receipt recorded` : "Transactions, no receipt recorded" });
        missing.push({ label: `Donation receipt for ${list.length ? list.map((x) => `${dollars(x.amount)} to ${x.merchant}`).join(", ") : dollars(giftsNoReceipt)}`, why: `${dollars(giftsNoReceipt)} is claimed without a receipt, so the estimate leaves it out until one is found.`, when: "Before you lodge", person: p });
      }
      if (hoursSoFar > 0) missing.push({ label: "Work-from-home hours", why: `Keep logging: ${hoursSoFar} hours so far, about ${Math.round(hoursSoFar * factor)} by 30 June at this pace. The fixed rate needs a record of every hour.`, when: `Until 30 June ${fyEnd}`, person: p });
      const taxable = line("Corrected taxable income", p);
      const medicare = Math.round(taxable * medicareRate * 100) / 100;
      perPerson[p] = {
        salary: line("Salary and wages", p), withheld: line("Tax withheld (PAYG)", p), otherIncome: line("Interest income (share)", p), rentNet, rentParts: { gross, costs, capital }, deductions, taxable,
        tax: Math.round((line("Corrected total tax", p) - medicare) * 100) / 100, medicare, offsets: 0,
        result: line("Corrected refund (negative means tax payable)", p), atRisk: line("Refund at risk", p),
        sources: {
          salary: `Payslips, gross pay, July to ${MONTHS[(6 + monthsElapsed - 1) % 12]} × 12/${monthsElapsed}`,
          withheld: `Payslips, tax withheld, × 12/${monthsElapsed}`,
          otherIncome: `Transactions, interest, ${p}'s half, × 12/${monthsElapsed}`,
          rentNet: `Rent ${dollars(gross)}, less ${dollars(costs)} of costs and ${dollars(capital)} of depreciation and capital works, ${p}'s half; rent and costs × 12/${monthsElapsed}`,
          tax: `Resident rates for ${fy}`,
          medicare: `${Math.round(medicareRate * 100)}% of taxable income`,
        },
      };
    }
    if (!Object.keys(perPerson).length) return null;
    // income statements: employers finalise them in myGov by 14 July while the year still has months to run
    if (monthsElapsed < 12) {
      for (const p of people) {
        const emp = [...new Set(m.payslips.filter((s) => s.person === p && s.date >= fyStart).map((s) => s.employer))];
        const left = 12 - monthsElapsed;
        if (emp.length) missing.push({ label: `Income statement from ${emp.join(" and ")}`, why: `${WORDS[left] || left} month${left === 1 ? "" : "s"} of pay ${left === 1 ? "is" : "are"} still to come. Employers mark income statements tax ready in myGov by 14 July.`, when: lodgeMonth, person: p });
      }
    }
    const fees = m.tx.filter((x) => inYear(x) && x.cat === "RENT-MGMT");
    const agent = fees.length ? fees[fees.length - 1].merchant : null;   // the model lists newest first; the earliest fee names the agent
    if (agent) missing.push({ label: `Rental statement for the year from ${agent}`, why: "It lists the year's rent, the agent's fees and anything the agent paid on your behalf.", when: lodgeMonth });
    const cover = m.subs.find((s) => /health cover/i.test(s.service || ""));
    if (cover) missing.push({ label: `${cover.service} statement`, why: `${cover.merchant} reports your cover to the ATO and it shows in myGov. It settles the private health rebate and the Medicare levy surcharge, which this estimate leaves out.`, when: lodgeMonth });
    const uncat = m.tx.filter((x) => inYear(x) && x.cat === "UNCAT");
    if (uncat.length) missing.push({ label: `${uncat.length} transaction${uncat.length === 1 ? "" : "s"} to sort, ${dollars(uncat.reduce((s, x) => s + Math.abs(x.amount), 0))}`, why: "They are left out of the tax totals until they have a category.", when: "Now" });
    const rank = (x) => (x.when === "Now" ? 0 : x.when === "Before you lodge" ? 1 : /^Until/.test(x.when) ? 2 : 3);
    missing.sort((a, b) => rank(a) - rank(b));
    return { fy, monthsElapsed, source: "Tax Forecast tab", perPerson, missing };
  }

  // ---------- Groceries: Receipts and Receipt Lines, camelCased (MODULES.md groceries.js) ----------
  V.groceriesInput = (m, t) => {
    if (!m || !t || !t.receipts) return null;
    // a matched receipt names the charge it explains (account, amount, date), from the Entries row it points at; never the row ID
    const entry = (id) => (id && ((m.entryById && m.entryById[id]) || m.tx.find((x) => x.id === id))) || null;
    const receipts = t.receipts.map((r) => {
      const id = text(r.entry_id), e = entry(id), a = e && m.acctById[e.acct];
      return { id: text(r.receipt_id), date: date(r.date), time: text(r.time), merchant: text(r.merchant), store: text(r.store), channel: text(r.channel), person: text(r.person), items: num(r.items), total: num(r.total), gst: num(r.gst), savings: num(r.savings), paidWith: text(r.paid_with),
        entryId: id, entryDate: e ? e.date : "", entryAccount: a ? a.name : "", entryAmount: e ? e.amount : null, accountId: text(r.account_id), source: text(r.source), sourceKind: text(r.source_kind), check: text(r.check), note: text(r.note) };
    });
    const lines = (t.receipt_lines || []).map((l) => ({ receiptId: text(l.receipt_id), line: num(l.line), text: text(l.printed_text), product: text(l.product), brand: text(l.brand), group: text(l.group), kind: text(l.kind), qty: num(l.qty), unit: text(l.unit), unitPrice: num(l.unit_price), amount: num(l.amount), gst: text(l.gst), pack: text(l.pack_size), ppu: num(l.price_per_kg_or_l), code: text(l.retailer_code), note: text(l.note) }));
    return { asOf: m.asOf, receipts, lines, people: m.people.slice() };
  };
  return V;
});
