/* The rest of the month tick: shares, tax, the home and its loan, bills, children, and the later chapters' simplified streams. */
"use strict";
const { addDays, dayDiff, weekday, monthRange, monthEnd, nextMonth, prevMonth, fyOf, lastDay, pad } = require("./std");
const { Sim, ymOf, cents, biz, inMonth } = require("./sim");

const usd = (milli) => (milli / 1000).toFixed(3);

class Life extends Sim {
  // ---------- prices ----------
  prices(ym) {
    const r = this.rng(`px:${ym}`), R = this.rsu, last = R.lastPx || 31400, lastFx = R.lastFx || 15200;
    R.lastPx = Math.max(9000, Math.round(last * (1 + r.range(-0.05, 0.062)))); R.lastFx = Math.max(12000, Math.round(lastFx * (1 + r.range(-0.012, 0.012))));
    R.px[ym] = R.lastPx; R.fx[ym] = R.lastFx;
  }
  value(units, ym) { return Math.round(units * this.rsu.px[ym] * this.rsu.fx[ym] / 100000); } // units × USD milli × AUD 1e-4, in cents
  rsuMonth(ym) {
    if (!["01", "04", "07", "10"].includes(ym.slice(5))) return;
    const date = `${ym}-15`, R = this.rsu, units = 25, price = usd(R.px[ym]), fx = (R.fx[ym] / 10000).toFixed(4), c = this.value(units, ym), settle = addDays(date, 3), ref = `ETS-${date.replace(/-/g, "").slice(2)}`, B = this.people.B;
    R.vests.push({ date, units, price, fx, cents: c, fy: fyOf(date), sold: date });
    R.sales.push({ vest: date, date, units, price, fx, usd: Math.round(units * R.px[ym] / 10), cents: c, settle, ref });
    this.line(B.every, settle, `ETREAT STOCK PLAN ${ref}`, c, { rsu: true });
  }
  cgtValue(e) {
    const ym = ymOf(e.on), R = this.rsu, v = this.value(R.held, ym);
    R.mv = { date: e.on, units: R.held, price: usd(R.px[ym]), fx: (R.fx[ym] / 10000).toFixed(4), value_cents: v, cost_cents: R.heldCost, status: e.status };
    this.note("T4-CGT-VALUE-30-JUNE", { ...R.mv, instrument: this.cast.B.plan.code, why: e.why });
  }
  sellHeld(e) {
    const ym = ymOf(e.on), R = this.rsu, units = R.held, px = R.px[ym], fx = R.fx[ym], c = this.value(units, ym), settle = addDays(e.on, 3), ref = `ETS-${e.on.replace(/-/g, "").slice(2)}`, B = this.people.B;
    R.sales.push({ vest: null, date: e.on, units, price: usd(px), fx: (fx / 10000).toFixed(4), usd: Math.round(units * px / 10), cents: c, settle, ref, held: true });
    this.line(B.every, settle, `ETREAT STOCK PLAN ${ref}`, c, { rsu: true });
    const mv = R.mv ? R.mv.value_cents : c, before = mv - R.heldCost, after = c - mv;
    R.gain = { date: e.on, proceeds_cents: c, cost_cents: R.heldCost, value_30_june_2027_cents: mv, gain_to_30_june_cents: before, gain_after_cents: after, fy: fyOf(e.on), status: "unconfirmed", treatment: "Discount on the gain to 30 June 2027, indexation after: Act 49 of 2026 as read by the research. Indexation is left at nil in this model because the factor is not in the reference." };
    this.note("T5-CGT-TWO-REGIMES", { ...R.gain, instrument: this.cast.B.plan.code });
    R.held = 0; R.heldCost = 0;
    // the money heads for the home
    this.xfer(B.every, addDays(settle, 2), "TFR TO JOINT", "ACC-JOINT", addDays(settle, 2), `TFR FROM ${B.first.toUpperCase()}`, Math.floor(c / 100) * 100);
  }

  // ---------- tax ----------
  labelsFor(key, fy) {
    const pays = this.pays.filter((p) => p.person === key && p.fy === fy), gross = pays.reduce((t, p) => t + p.gross, 0), payg = pays.reduce((t, p) => t + p.tax, 0), L = {};
    if (gross) L["1"] = gross;
    let interest = 0;
    for (const i of this.interest[fy] || []) { if (i.who === key) interest += i.cents; else if (i.who === "shared") interest += key === "A" ? Math.ceil(i.cents / 2) : Math.floor(i.cents / 2); }
    if (interest) L["10"] = interest;
    if (key === "B") { const v = this.rsu.vests.filter((x) => x.fy === fy).reduce((t, x) => t + x.cents, 0); if (v) L["12"] = v; const g = this.rsu.gain; if (g && g.fy === fy) { const net = Math.floor(g.gain_to_30_june_cents * (1 - this.law.cgtDiscount(g.date))) + g.gain_after_cents; L["18A"] = Math.max(0, net); L["18H"] = g.gain_to_30_june_cents + g.gain_after_cents; } }
    L.D5 = key === "A" ? 214000 + (fy - 2027) * 2000 : 41000 + (fy - 2027) * 1500;
    if (fy >= 2028) L.D10 = 19800;
    return { L, payg };
  }
  fileReturn(key, fy, labels, payg, lodged, assessed, version = 1) {
    const res = this.law.assess(fy, labels, { payg_cents: payg, help_debt_cents: key === "A" ? this.help.bal : 0 });
    const rec = { person: key, fy, labels, res, version, lodged_on: lodged, assessed_on: assessed, agent: fy >= 2027 ? this.cast.agency.accountant : this.cast.agency.prior_agent };
    return rec;
  }
  settle(rec, desc) {
    const p = this.people[rec.person], paid = addDays(rec.assessed_on, 9), c = rec.res.result_cents;
    if (c >= 0) this.line(p.every, paid, desc || "ATO TAX REFUND", c, { tax: true }); else this.line(p.every, paid, desc || "ATO TAX PAYMENT", c, { tax: true });
    rec.paid_on = paid;
    if (c > 0 && rec.fy >= 2027 && !this.traps["T4-REFUND-OLD-ACCOUNT"]) this.note("T4-REFUND-OLD-ACCOUNT", { person: rec.person, fy: rec.fy, account: p.every, date: paid, cents: c });
    if (rec.res.help_cents) { this.help.bal -= rec.res.help_cents; this.help.ledger.push({ date: rec.assessed_on, kind: "repay", desc: "Compulsory repayment on assessment", cents: -rec.res.help_cents, balance: this.help.bal, fy: rec.fy }); this.note("T4-HELP-IN-ASSESSMENT", { fy: rec.fy, assessed_on: rec.assessed_on, repayment_cents: rec.res.help_cents, refund_cents: c }); }
  }
  taxMonth(ym) {
    const m = ym.slice(5), y = Number(ym.slice(0, 4));
    if (ym === "2026-09") {
      // FY2026 sits before the simulation: stated, not simulated
      const out = {};
      for (const key of ["A", "B"]) {
        const p = this.people[key], gross = Math.round(p.annual[0].cents * 0.97), L = { 1: gross, D5: key === "A" ? 58000 : 36000 };
        const reported = key === "A" ? 118042 : 0, unreported = key === "B" ? 191230 : 0;
        if (reported) L["10"] = reported;
        const payg = this.law.withhold("2026-06-30", Math.round(gross / 26), { help: p.help }) * 26;
        const rec = this.fileReturn(key, 2026, L, payg, key === "A" ? "2026-09-02" : "2026-09-09", key === "A" ? "2026-09-14" : "2026-09-21");
        rec.unreported_interest = unreported; rec.payg = payg;
        this.settle(rec); out[key] = rec;
      }
      this.tax[2026] = out;
    }
    if (m === "09" && y >= 2027) {
      const fy = y, out = {};
      for (const key of ["A", "B"]) { const { L, payg } = this.labelsFor(key, fy), rec = this.fileReturn(key, fy, L, payg, `${y}-09-${key === "A" ? "08" : "09"}`, `${y}-09-${key === "A" ? "20" : "27"}`); rec.payg = payg; this.settle(rec); out[key] = rec; }
      this.tax[fy] = out;
    }
  }
  amendReturn(e) {
    const was = this.tax[e.fy][e.person], L = { ...was.labels, 10: (was.labels["10"] || 0) + was.unreported_interest };
    const rec = this.fileReturn(e.person, e.fy, L, was.payg, e.on, addDays(e.on, 21), 2), extra = was.res.result_cents - rec.res.result_cents, paid = addDays(rec.assessed_on, 9);
    if (extra <= 0) throw new Error("an amendment that adds income must cost tax");
    rec.paid_on = paid; rec.payg = was.payg; was.amended = rec;
    this.line(this.people[e.person].every, paid, "ATO AMENDED ASSESSMENT PAYMENT", -extra, { tax: true });
    this.note("T4-AMENDMENT", { person: e.person, fy: e.fy, lodged_on: e.on, assessed_on: rec.assessed_on, extra_tax_cents: extra, paid_on: paid, omitted_interest_cents: was.unreported_interest });
  }
  helpMonth(ym) {
    if (ym.slice(5) !== "06") return;
    const d = `${ym}-01`, c = Math.round(this.help.bal * this.law.helpIndex(d));
    this.help.bal += c; this.help.ledger.push({ date: d, kind: "index", desc: "Indexation, 1 June", cents: c, balance: this.help.bal, fy: fyOf(d) });
  }

  // ---------- the home ----------
  cashMoves() {
    if (this.moves) return this.moves;
    // the cash rate past the reference is the story's, not the law: seeded, and marked assumed in truth. One cut is forced for the lender to backdate.
    const r = this.rng("cash"), out = [], firstWed = (on) => { let x = on; while (weekday(x) !== 3) x = addDays(x, 1); return x; };
    const back = this.events.find((e) => e.do === "rate_backdated"), cut = back ? firstWed(`${ymOf(back.on)}-01`) : null;
    let d = "2028-03-01", level = this.law.cashRate("2028-01-01"), done = !cut;
    while (d < "2037-01-01") {
      const wed = firstWed(d);
      if (!done && wed >= addDays(cut, -120)) { level = Math.round((level - 0.25) * 100) / 100; out.push({ on: cut, cash: level }); done = true; d = addDays(cut, r.int(150, 290)); continue; }
      const step = level >= 5.1 ? -0.25 : level <= 3.35 ? 0.25 : r.next() < 0.55 ? -0.25 : 0.25;
      level = Math.round((level + step) * 100) / 100; out.push({ on: wed, cash: level });
      d = addDays(wed, r.int(150, 290));
    }
    this.moves = out;
    return out;
  }
  rateOn(d) { let c = this.law.cashRate(d); for (const m of this.cashMoves()) if (m.on <= d) c = m.cash; return Math.round((c + this.loan.margin) * 100) / 100; }
  buyHome(e) {
    const A = this.people.A, B = this.people.B, on = e.on, addr = this.cast.addresses.home, cash = e.price_cents + e.duty_cents + e.legal_cents + e.adjustments_cents - e.loan_cents, final = cash - e.deposit_paid_cents;
    this.openAccount("ACC-OFFSET", on);
    // the savers empty towards the settlement
    const before = addDays(on, -1), want = final + 300000 - this.bal["ACC-JOINT"];
    if (want > 0) {
      let left = want;
      for (const p of [B, A]) { const c = Math.min(left, Math.max(0, this.bal[p.save] - 200000)); if (c > 0) { this.xfer(p.save, before, "TFR TO JOINT", "ACC-JOINT", before, "TFR FROM SAVER", c); left -= c; } }
      if (left > 0) throw new Error(`${this.cast.id}: short by ${left} at settlement`);
    }
    const line = this.line("ACC-JOINT", on, `SETTLEMENT ${addr.split(",")[0].toUpperCase()} BALANCE TO VENDOR`, -final, { capital: true });
    const margin = e.margin_pct, rate = Math.round((this.law.cashRate(on) + margin) * 100) / 100;
    this.loan = { id: "LN-HOME", number: this.cast.numbers.loan, opened: on, margin, drawn: e.loan_cents, bal: e.loan_cents, rows: [], rate, repay: 0, lines: [] };
    this.home = { on, address: addr, price: e.price_cents, duty: e.duty_cents, legal: e.legal_cents, adjustments: e.adjustments_cents, loan: e.loan_cents, cash, final, deposit: e.deposit_paid_cents };
    this.loan.repay = this.pmt(this.loan.bal, rate, 30 * 12);
    this.rate.history.push({ on, rate });
    this.note("T5-SETTLEMENT", { settled_on: on, price_cents: e.price_cents, duty_cents: e.duty_cents, legal_cents: e.legal_cents, adjustments_cents: e.adjustments_cents, loan_cents: e.loan_cents, deposit: this.deposit && { date: this.deposit.date, cents: this.deposit.cents }, final: { date: line.date, cents: line.cents } });
    this.home.value = e.price_cents;
    this.car = { value: 2240000 };
  }
  pmt(bal, ratePct, n) { const i = ratePct / 100 / 12, f = (1 + i) ** n; return Math.round(bal * i * f / (f - 1)); }
  offsetOn(d) { let c = this.open["ACC-OFFSET"] || 0; for (const l of this.offsetLines || []) if (l.date <= d) c += l.cents; return c; }
  loanPay(ym) {
    if (!this.loan || ym === ymOf(this.loan.opened)) return;
    const L = this.loan, paid = Math.min(L.repay, L.bal); L.due = paid;
    this.spend("ACC-JOINT", `${ym}-01`, `LOAN REPAYMENT ${L.number.replace(/\s/g, "")}`, paid, "MORTGAGE", "joint", { loan: true });
  }
  loanMonth(ym) {
    if (!this.loan) return;
    const L = this.loan, from = ym === ymOf(L.opened) ? L.opened : `${ym}-01`, end = monthEnd(ym);
    this.offsetLines = this.lines.filter((l) => l.acct === "ACC-OFFSET");
    const opening = L.bal, y = { ym, opening, offset: null, rate: null, repaid: 0 };
    // a rate change at the start of the month's reckoning
    const startRate = this.rateOn(from);
    for (const m of this.cashMoves()) if (ymOf(m.on) === ym) this.rateNotice(m);
    if (ym !== ymOf(L.opened)) {
      const paid = L.due, d = `${ym}-01`;
      L.bal -= paid; y.repaid = paid; L.lines.push({ date: d, desc: "REPAYMENT RECEIVED", cents: paid });
      if (!this.traps["T5-MORTGAGE-SPLIT"]) this.note("T5-MORTGAGE-SPLIT", { month: ym, repaid_cents: paid });
    }
    let accrued = 0, day = from;
    while (day <= end) { const net = Math.max(0, L.bal - this.offsetOn(day)); accrued += net * this.rateOn(day) / 100 / 365; day = addDays(day, 1); }
    const interest = Math.round(accrued);
    L.bal += interest; if (interest) L.lines.push({ date: end, desc: "INTEREST CHARGED", cents: -interest });
    y.interest = interest; y.closing = L.bal; y.rate = startRate; y.offset = this.offsetOn(end); L.rows.push(y);
    if (ym === "2029-06") this.note("T5-OFFSET-INTEREST", { month: ym, loan_closing_cents: L.bal, offset_cents: y.offset, interest_cents: interest, rate_pct: startRate });
    const r = this.rateOn(`${nextMonth(ym)}-01`); if (r !== L.rate) { L.rate = r; const left = Math.max(12, 30 * 12 - L.rows.length); L.repay = this.pmt(L.bal, r, left); }
  }
  rateNotice(m) {
    const L = this.loan, was = this.rateOn(addDays(m.on, -1)), rate = this.rateOn(m.on);
    this.rate.notices.push({ number: L.number, old: was, rate, effective_on: m.on, notified_on: addDays(m.on, 2), name: "Home loan" });
    if (this.rateBackdated && ymOf(this.rateBackdated) === ymOf(m.on) && rate < was) {
      const back = addDays(m.on, -11), notified = addDays(m.on, 14);
      this.rate.notices.push({ number: L.number, old: was, rate, effective_on: back, notified_on: notified, correction: addDays(m.on, 2), name: "Home loan" });
      this.note("T5-RATE-BACKDATED", { first_effective_on: m.on, corrected_effective_on: back, notified_on: notified, rate_pct: rate, old_pct: was });
    }
  }
  homeMonth(ym) {
    if (!this.home) return;
    const r = this.billRng, m = Number(ym.slice(5)), H = this.home, addr = H.address, q = m % 3 === 1, U = this.cast.utilities, up = (s) => s.toUpperCase(), digit = (x) => x.replace(/\D/g, "");
    if (m % 3 === 2) { const c = cents(r, 470, 560), bill = `${ym}-01`, due = `${ym}-28`, paid = addDays(due, -3), from = `${ym}-01`, to = monthEnd(nextMonth(nextMonth(ym))); this.spend("ACC-JOINT", paid, `BPAY ${up(U.council)} ${digit(U.rates_ref)}`, c, "RATES-HOME", "joint"); this.bills.push({ kind: "rates", issuer: U.council, account: U.rates_ref, bill_date: bill, due_on: due, from, to, cents: c, stream: "BILL-RATES", ref: `RN-${ym.replace("-", "")}` }); }
    if (q) { this.powerBill("ACC-JOINT", ym, "joint", r);
      { const c = cents(r, 210, 340), bill = biz(`${ym}-11`), due = addDays(bill, 21), paid = addDays(bill, 16); this.spend("ACC-JOINT", paid, `BPAY ${up(U.water)} ${digit(U.water_ref)}`, c, "UTILITIES", "joint"); this.bills.push({ kind: "water", issuer: U.water, account: U.water_ref, bill_date: bill, due_on: due, from: addDays(bill, -92), to: addDays(bill, -2), cents: c, stream: "BILL-WATER" }); }
      { const c = cents(r, 120, 380), bill = biz(`${ym}-19`), due = addDays(bill, 21), paid = addDays(bill, 12); this.spend("ACC-JOINT", paid, `BPAY ORIGPURR GAS ${digit(U.gas_ref)}`, c, "UTILITIES", "joint"); this.bills.push({ kind: "gas", issuer: "Origpurr Gas", account: U.gas_ref, bill_date: bill, due_on: due, from: `${prevMonth(prevMonth(prevMonth(ym)))}-01`, to: monthEnd(prevMonth(ym)), cents: c, stream: "BILL-GAS" }); }
    }
    if (ym === ymOf(H.on) || (ym.slice(5) === H.on.slice(5, 7) && ym > ymOf(H.on))) {
      const y = Number(ym.slice(0, 4)), from = `${y}${H.on.slice(4)}`, c = Math.round((194000 + (y - 2028) * 12000) * this.rng(`prem:${y}`).range(0.97, 1.03)), paid = addDays(from, -3 < 0 ? 0 : 0);
      this.spend("ACC-JOINT", paid, `PURRSURE HOME PH-${String(40771882 + y)}`, c, "HOME-INS", "joint");
      this.policies.push({ id: "POL-HOME", kind: "Home and contents", number: `PH-${String(40771882 + y)}`, from, to: addDays(`${y + 1}${H.on.slice(4)}`, -1), premium: c, paid_on: paid, situation: addr, sum: 92000000 + (y - 2028) * 3000000, excess: 75000 });
    }
  }
  /* The car's rego and cover run the whole life. */
  carMonth(ym) {
    const r = this.billRng, acct = this.home || (this.joined && `${ym}-01` >= "2027-04-01") ? "ACC-JOINT" : "ACC-A-EVERY", who = acct === "ACC-JOINT" ? "joint" : "A", y = Number(ym.slice(0, 4));
    if (ym.slice(5) === "11") { const c = 87300 + (y - 2026) * 2100, bill = `${ym}-02`, due = `${ym}-22`; this.spend(acct, addDays(due, -5), `BPAY VICPAWS REGO ${this.cast.utilities.rego}`, c, "CAR", who); this.bills.push({ kind: "rego", issuer: "VicPaws", account: this.cast.utilities.rego, bill_date: bill, due_on: due, until: `${y + 1}-11-22`, cents: c, stream: "REGO", ref: `RG-${y}`, vehicle: "Hatchback, 2021", operator: this.people.A.name }); }
    if (ym.slice(5) === "08") { const from = `${y}-08-14`, c = Math.round((113000 + (y - 2026) * 4100) * r.range(0.97, 1.03)); this.spend(acct, from, `PURRSURE CAR PC-${y}`, c, "CAR", who); this.policies.push({ id: "POL-CAR", kind: "Comprehensive car", number: `PC-${y}-4471`, from, to: `${y + 1}-08-13`, premium: c, paid_on: from, situation: "Hatchback, 2021", sum: 2200000, excess: 80000 }); }
  }
  childcareMonth(ym) {
    const end = monthEnd(ym);
    for (const c of this.care) {
      if (c.from > end) continue;
      let days = 0; for (let d = c.from > `${ym}-01` ? c.from : `${ym}-01`; d <= end; d = addDays(d, 1)) { const wd = weekday(d); if (wd >= 1 && wd <= c.days) days += 1; }
      if (!days) continue;
      const fy = fyOf(end) - 1, t = this.tax[fy], income = t ? Math.round(((t.A ? t.A.res.taxable_income_cents : 0) + (t.B ? t.B.res.taxable_income_cents : 0)) / 100) : 170000, pct = this.law.ccsPct(end, income), gross = days * c.daily, subsidy = Math.round(gross * pct / 100), gap = gross - subsidy;
      const child = this.kids.find((k) => k.role === c.child), pay = `${nextMonth(ym)}-08`, r = this.spend("ACC-JOINT", pay, `DIRECT DEBIT KITTENHOOD ${child.first.toUpperCase()}`, gap, "CHILDCARE", "joint");
      this.childcare.push({ ym, child: child.name, days, daily: c.daily, gross, subsidy, gap, pct });
      if (!this.traps["T5-CCS"]) this.note("T5-CCS", { month: ym, gross_cents: gross, subsidy_cents: subsidy, gap_cents: gap, line: { account: r.acct, date: r.date, cents: r.cents } });
    }
  }
  thingsMonth(ym) {
    const T = this.cast.things || THINGS;
    for (const t of T) { if (ymOf(t.date) !== ym) continue; const acct = t.card ? "ACC-A-CARD" : "ACC-JOINT", desc = t.card ? t.merchant.toUpperCase() : `EFTPOS ${t.merchant.toUpperCase()}`; this.spend(acct, t.date, desc, t.cents, "SHOPPING", t.card ? "A" : "joint", { thing: t.name }); this.receipts.push({ ...t, pay: t.card ? `Card ending ${this.cast.numbers.A_card}` : "Debit card", warranty: `${Number(t.date.slice(0, 4)) + t.wy}${t.date.slice(4)}`, acct }); }
  }
  valueMonth(ym) {
    if (!this.home) return;
    const r = this.rng(`value:${ym}`), H = this.home;
    H.value = Math.round(H.value * (1 + r.range(-0.002, 0.0075)) / 100) * 100; this.car.value = Math.round(this.car.value * 0.991 / 100) * 100;
    this.valuations.push({ ym, end: monthEnd(ym), home: H.value, car: this.car.value });
  }

  // ---------- later chapters: new streams only ----------
  business() {
    const b = this.cast.later.biz, A = this.people.A, r = this.rng("biz"); this.biz = { lines: [], bas: [] };
    this.openAccount("ACC-BIZ", b.from);
    const push = (date, desc, c, o) => { this.biz.lines.push({ date, desc, cents: c, ...o }); this.line("ACC-BIZ", date, desc, c, o); };
    let quarter = null;
    for (const ym of monthRange(ymOf(b.from), ymOf(b.to))) {
      const weeks = 4, gross = cents(r, 0.9, 1.08) / 100 * b.consult_cents * b.per_week * weeks, sales = Math.round(gross / 100) * 100, free = Math.round(sales * b.gst_free_bps / 10000), taxed = sales - free, gst = Math.round(taxed / 10);
      push(`${ym}-27`, "HICAPS CLAIMS SETTLEMENT", free, { lens: "income", cat: "SIDE-INC", who: "A" });
      push(`${ym}-28`, "PRIVATE CLIENT PAYMENTS", taxed + gst, { lens: "income", cat: "SIDE-INC", who: "A" });
      push(`${ym}-02`, "ROOM HIRE CONSULTING SUITE", -b.room_month_cents, { lens: "spending", cat: "SIDE-INC", who: "A" });
      const q = Math.ceil(Number(ym.slice(5)) / 3); quarter = (this.biz.bas[q - 1] = this.biz.bas[q - 1] || { q, from: `${ym.slice(0, 4)}-${pad((q - 1) * 3 + 1)}-01`, to: monthEnd(`${ym.slice(0, 4)}-${pad(q * 3)}`), sales: 0, free: 0, gst: 0, paid_gst: 0 }); quarter.sales += taxed + free + gst; quarter.free += free; quarter.gst += gst; quarter.paid_gst += Math.round(b.room_month_cents / 11);
    }
    void A;
  }
  teen() {
    const t = this.cast.later.teen, k = this.kids[0], r = this.rng("teen"), turns18 = `${Number(k.born.slice(0, 4)) + 18}${k.born.slice(4)}`; this.job = { pays: [], super: [], bal: 0 };
    this.openAccount("ACC-C1-EVERY", t.job_from);
    let d = t.job_from, sbal = 0; const ytd = {};
    while (d <= t.to) {
      const hols = ["01", "07", "12"].includes(d.slice(5, 7)) && Number(d.slice(8)) <= 21, hours = hols && r.next() < 0.7 ? r.int(31, 38) : r.int(8, 22), adult = d >= turns18;
      const gross = Math.round(hours * t.hourly_cents * (adult ? 1.2 : 1)), owes = adult || hours > 30, sup = owes ? Math.round(gross * this.law.sg(d)) : 0, tax = Math.round(this.law.withhold(d, gross * 2, {}) / 2 / 100) * 100, net = gross - tax;
      const fy = fyOf(d), y = ytd[fy] = ytd[fy] || { gross: 0, tax: 0, sup: 0 }; y.gross += gross; y.tax += tax; y.sup += sup;
      this.job.pays.push({ date: d, from: addDays(d, -6), to: d, hours, gross, tax, sup, net, owes, adult, ytd: { ...y }, fy });
      this.earn("ACC-C1-EVERY", d, `SALARY ${t.employer.toUpperCase()}`, net, "SALARY", "C1", { pay: true });
      if (sup) { sbal += sup; this.job.super.push({ date: biz(addDays(d, 4)), type: "employer", desc: `Employer contribution, ${t.employer}`, cents: sup }); }
      d = addDays(d, 7);
    }
    this.job.super_balance = sbal;
    const weeks = this.job.pays.filter((p) => !p.adult), over = weeks.filter((p) => p.owes);
    this.note("T9-UNDER-18-SUPER", { weeks_under_18: weeks.length, weeks_over_30_hours: over.length, super_cents: over.reduce((s, p) => s + p.sup, 0), wrong_if_12_percent_cents: Math.round(weeks.reduce((s, p) => s + p.gross, 0) * this.law.sg(t.job_from)) });
  }

  run() {
    this.ym = null; this.phiHistory();
    for (const ym of monthRange(this.start.slice(0, 7), this.end.slice(0, 7))) {
      this.ym = ym;
      this.prices(ym); this.events_(ym); this.payroll(ym); this.housing(ym); this.health(ym); this.everyday(ym); this.rsuMonth(ym); this.homeMonth(ym); this.carMonth(ym); this.childcareMonth(ym); this.thingsMonth(ym); this.taxMonth(ym); this.helpMonth(ym); this.card(ym); this.superMonth(ym); this.loanPay(ym); this.interestMonth(ym); this.sweeps(ym); this.loanMonth(ym); this.valueMonth(ym);
      const low = ["ACC-A-EVERY", "ACC-B-EVERY", "ACC-A-SAVE", "ACC-B-SAVE", "ACC-JOINT", "ACC-OFFSET"].filter((a) => (this.bal[a] || 0) < -5000);
      if (low.length) this.notes.push(`${ym} overdrawn: ${low.map((a) => `${a} ${this.bal[a]}`).join(", ")}`);
    }
    this.business(); this.teen();
    return this;
  }
}

/* Durable things, with a warranty. A person says what they bought; the receipt proves it. */
const THINGS = [
  { name: "Fridge", kind: "appliance", merchant: "Good Paws Appliances", date: "2028-02-02", cents: 219900, card: false, via: "eml", serial: "GP-FRG-31904", wy: 3 },
  { name: "Pram", kind: "appliance", merchant: "Baby Bunny", date: "2028-03-02", cents: 88600, card: true, via: "pdf", serial: "BB-PRM-7310", wy: 3 },
  { name: "Laptop", kind: "device", merchant: "Appurr Store", date: "2029-05-10", cents: 329900, card: true, via: "pdf", serial: "AP-LT-C04XK1", wy: 2 },
  { name: "Washing machine", kind: "appliance", merchant: "Good Paws Appliances", date: "2030-02-16", cents: 119900, card: false, via: "eml", serial: "GP-WSH-40418", wy: 2 },
  { name: "Dishwasher", kind: "appliance", merchant: "Harvey Whiskers", date: "2032-03-14", cents: 129900, card: false, via: "pdf", serial: "HW-DSH-97120", wy: 5 },
  { name: "Television", kind: "device", merchant: "JB Hi-Fur", date: "2034-11-28", cents: 149900, card: true, via: "eml", serial: "JB-TV-91120", wy: 2 },
];

module.exports = { Life, THINGS };
