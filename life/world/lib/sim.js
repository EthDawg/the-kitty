/* A month-tick simulator. Everything that happens to the family's money happens here first, in integer cents, day by day inside a month, and is written to a book.
   Files are rendered from the book afterwards and truth is read from it, so nothing about a file can change what was true. Deterministic: no clock, no Math.random. */
"use strict";
const { Rng, addDays, dayDiff, weekday, monthRange, monthEnd, nextMonth, prevMonth, fyOf, lastDay, pad, mulDiv } = require("./std");
const { Law } = require("./law");

const ymOf = (d) => d.slice(0, 7);
const cents = (r, lo, hi) => Math.round(r.range(lo, hi) * 100);
const pctOf = (c, bps) => mulDiv(c, bps, 10000);
const biz = (d) => { let x = d; while ([0, 6].includes(weekday(x))) x = addDays(x, 1); return x; };
const inMonth = (ym, day) => `${ym}-${pad(Math.min(day, lastDay(Number(ym.slice(0, 4)), Number(ym.slice(5)))))}`;

class Sim {
  constructor(script, cast) {
    Object.assign(this, { script, cast, law: new Law(), seq: 0, lines: [], bal: {}, open: {}, opened: {}, docs: {}, traps: {}, notes: [] });
    this.start = script.start; this.end = script.end;
    this.people = {
      A: { ...cast.A, annual: [{ from: "2020-01-01", cents: cast.pay.A.annual_cents }], fte: [{ from: "2020-01-01", bps: 10000 }], anchor: cast.pay.A.anchor, packaging: cast.pay.A.packaging_fortnight_cents, every: "ACC-A-EVERY", save: "ACC-A-SAVE", help: true, leaves: [] },
      B: { ...cast.B, annual: [{ from: "2020-01-01", cents: cast.pay.B.annual_cents }], fte: [{ from: "2020-01-01", bps: 10000 }], anchor: cast.pay.B.anchor, packaging: 0, every: "ACC-B-EVERY", save: "ACC-B-SAVE", help: false, leaves: [] },
    };
    this.kids = cast.children.map((k) => ({ ...k }));
    this.pays = []; this.super = { A: { lines: [], bal: cast.opening["SUPER-A"], open: cast.opening["SUPER-A"] }, B: { lines: [], bal: cast.opening["SUPER-B"], open: cast.opening["SUPER-B"] } };
    this.help = { bal: -cast.opening["HELP-A"], ledger: [] };
    this.rsu = { vests: [], sales: [], held: cast.opening.held_units, heldCost: cast.opening.held_cost_cents, px: {}, fx: {} };
    this.tax = {}; this.bills = []; this.policies = []; this.receipts = []; this.childcare = []; this.valuations = []; this.statements = []; this.rate = { notices: [], history: [] };
    this.loan = null; this.joined = false; this.home = null; this.shared = {}; this.care = []; this.phi = []; this.interest = {}; this.gifts = [];
    for (const [k, v] of Object.entries(cast.opening)) if (/^ACC-/.test(k)) { this.open[k] = v; this.bal[k] = v; this.opened[k] = script.start; }
    this.events = [...cast.events].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
    this.spendRng = this.rng("spend"); this.billRng = this.rng("bills");
  }
  rng(name) { return new Rng(`life:${this.cast.id}:${this.cast.seed}:${name}`); }
  note(id, facts) { (this.traps[id] = this.traps[id] || []).push(facts); }

  // ---------- the book ----------
  line(acct, date, desc, c, o = {}) { this.seq += 1; const r = { seq: this.seq, acct, date, desc, cents: c, ...o }; this.lines.push(r); this.bal[acct] = (this.bal[acct] || 0) + c; return r; }
  spend(acct, date, desc, c, cat, who, o = {}) { return this.line(acct, date, desc, -c, { lens: "spending", cat, who, ...o }); }
  earn(acct, date, desc, c, cat, who, o = {}) { return this.line(acct, date, desc, c, { lens: "income", cat, who, ...o }); }
  xfer(from, dOut, descOut, to, dIn, descIn, c, o = {}) { const a = this.line(from, dOut, descOut, -c, { xfer: true, ...o }), b = this.line(to, dIn, descIn, c, { xfer: true, ...o }); return [a, b]; }
  openAccount(id, on, cents = 0) { this.opened[id] = on; if (this.open[id] == null) this.open[id] = cents; if (this.bal[id] == null) this.bal[id] = cents; }

  // ---------- pay ----------
  annualOn(p, on) { return p.annual.filter((a) => a.from <= on).pop().cents; }
  fteOn(p, on) { return p.fte.filter((a) => a.from <= on).pop().bps; }
  leaveOn(p, on) { return p.leaves.find((l) => on >= l.from && on < l.back) || null; }
  payDates(p, ym) { const out = []; const end = monthEnd(ym); let d = p.anchor; while (d < `${ym}-01`) d = addDays(d, 14); while (d <= end) { out.push(d); d = addDays(d, 14); } return out; }
  /* A fortnight is fourteen days of whatever the salary and the hours were on each day, so a raise in the middle blends. */
  fortnight(p, to) {
    const from = addDays(to, -13); let g = 0, working = 0, blended = false, first = null;
    for (let i = 0; i < 14; i++) {
      const day = addDays(from, i), l = this.leaveOn(p, day);
      if (l && day >= l.paidTo) continue;
      const v = mulDiv(this.annualOn(p, day), this.fteOn(p, day), 10000 * 26 * 14); g += v; working += 1;
      if (first == null) first = v; else if (v !== first) blended = true;
    }
    return { gross: g, working, blended, from, to };
  }
  payroll(ym) {
    for (const key of ["A", "B"]) {
      const p = this.people[key];
      for (const date of this.payDates(p, ym)) {
        const f = this.fortnight(p, date);
        if (!f.gross) continue;
        const pack = p.packaging && !this.leaveOn(p, date) ? Math.round(p.packaging * f.working / 14) : 0, taxable = f.gross - pack, tax = this.law.withhold(date, taxable, { help: p.help && this.help.bal > 0 }), sup = Math.round(f.gross * this.law.sg(date)), net = taxable - tax;
        const pay = { person: key, date, from: f.from, to: f.to, employer: p.employer, gross: taxable, full_gross: f.gross, packaging: pack, tax, sup, net, fy: fyOf(date), blended: f.blended };
        this.pays.push(pay);
        this.earn(p.every, date, `SALARY ${p.employer.toUpperCase()}`, net, "SALARY", key, { pay: true });
        if (f.blended) this.note("T3-SALARY-CHANGE-MID-MONTH", { person: key, pay_date: date, gross_cents: f.gross, period_from: f.from, period_to: f.to });
        if (pack) { const d = addDays(date, 2); this.earn(p.every, d, "PAWPACK BENEFITS PAYMENT", pack, "SALARY", key, { packaging: true }); if (d < "2027-02-28") this.note("T2-SALARY-PACKAGING", { person: key, date: d, cents: pack, pay_date: date }); }
        if (sup) this.superIn(key, date, sup, p.employer);
      }
      // the government's pay, once the employer's stops
      for (const l of p.leaves) for (let d = l.pplFrom; d < l.pplTo; d = addDays(d, 14)) {
        if (ymOf(d) !== ym) continue;
        const gross = this.cast.pay.ppl_fortnight_cents, tax = this.law.withhold(d, gross, {}), net = gross - tax;
        this.pays.push({ person: key, date: d, from: addDays(d, -13), to: d, employer: "Services Pawstralia", gross, full_gross: gross, packaging: 0, tax, sup: 0, net, fy: fyOf(d), ppl: true });
        this.earn(p.every, d, "SERVICES PAWSTRALIA PPL", net, "GOV-PAY", key, { pay: true });
      }
    }
  }
  superIn(key, date, sup, employer) {
    const s = this.super[key], r = this.rng(`super:${key}:${date}`), d = biz(addDays(date, r.int(2, 5)));
    s.lines.push({ date: d, type: "employer", desc: `Employer contribution, ${employer}`, cents: sup }, { date: d, type: "contributions_tax", desc: "Contributions tax", cents: -Math.round(sup * 0.15) });
  }
  superMonth(ym) {
    for (const key of ["A", "B"]) {
      const s = this.super[key], r = this.rng(`returns:${key}:${ym}`), y = Number(ym.slice(0, 4));
      s.lines.push({ date: `${ym}-01`, type: "fee", desc: "Administration fee", cents: -(key === "A" ? 925 : 1195) }, { date: `${ym}-01`, type: "insurance", desc: "Insurance premium, death and TPD", cents: -(key === "A" ? 3015 + (y - 2026) * 40 : 6200 + (y - 2026) * 55) });
      const flow = s.lines.filter((l) => ymOf(l.date) === ym).reduce((t, l) => t + l.cents, 0), start = s.bal;
      const pathwise = ym >= "2031-02" && ym <= "2031-08" ? -0.012 : 0.0062;
      const e = Math.round((start + flow) * (pathwise + r.range(-0.014, 0.014)));
      s.lines.push({ date: monthEnd(ym), type: "earnings", desc: "Investment earnings", cents: e });
      s.bal = start + flow + e;
    }
  }

  // ---------- events from the script ----------
  events_(ym) {
    for (const e of this.events.filter((x) => ymOf(x.on) === ym)) {
      const A = this.people.A, B = this.people.B;
      switch (e.do) {
        case "couple_transfer": { const [a, b] = this.xfer(B.every, e.on, `OSKO ${A.first.toUpperCase()} HALF BOND`, A.every, e.on, `OSKO FROM ${B.first.toUpperCase()} HALF BOND`, e.cents, { couple: true }); this.note("T3-COUPLE-TRANSFER", { out: { account: a.acct, date: a.date, cents: a.cents }, in: { account: b.acct, date: b.date, cents: b.cents } }); break; }
        case "open_account": this.openAccount(e.account, e.on); this.joined = true; break;
        case "fund_joint": this.xfer(A.save, e.on, "TFR TO JOINT", "ACC-JOINT", e.on, `TFR FROM ${A.first.toUpperCase()}`, e.cents); break;
        case "pay_change": this.people[e.person].annual.push({ from: e.on, cents: e.annual_cents }); break;
        case "bond_paid": { const r = this.line("ACC-JOINT", e.on, "BPAY RESIDENTIAL TENANCIES BOND", -e.cents, { bond: true }); this.bondOut = r; this.note("T3-BOND", { account: r.acct, date: r.date, cents: r.cents }); break; }
        case "move_in": this.rent = { from: e.on, cents: e.rent_month_cents }; this.together = e.on; break;
        case "shared_saver": this.shared[e.account] = e.on; this.note("T4-OWNER-NOT-NAME", { account: e.account, from: e.on, legal: "A", beneficial: { A: 5000, B: 5000 } }); break;
        case "cgt_value_day": this.cgtValue(e); break;
        case "amend_return": this.amendReturn(e); break;
        case "pay_deposit": this.deposit = this.spendNot("ACC-JOINT", e.on, `DEPOSIT ${this.cast.addresses.home.split(",")[0].toUpperCase()} CONVEYANCING TRUST`, e.cents); break;
        case "sell_held_units": this.sellHeld(e); break;
        case "gift": { const r = this.earn("ACC-JOINT", e.on, `OSKO FROM ${this.cast.surname.toUpperCase()} FAMILY GIFT`, e.cents, "GIFT-IN", "joint"); this.note("T5-GIFT-DEPOSIT", { account: r.acct, date: r.date, cents: r.cents }); break; }
        case "buy_home": this.buyHome(e); break;
        case "bond_back": { const back = e.cents - e.charge_cents, d = monthEnd(prevMonth(ym)) >= e.on ? e.on : e.on, r = this.line("ACC-JOINT", d, "RESIDENTIAL TENANCIES BOND REFUND", back, { bond: true }); this.rent = null; this.note("T5-BOND-BACK", { account: r.acct, date: r.date, cents: back, charge_cents: e.charge_cents }); this.bondCharge = e.charge_cents; break; }
        case "leave": {
          const p = this.people[e.person], paidTo = addDays(e.on, e.paid_weeks * 7), pplTo = addDays(paidTo, e.ppl_weeks * 7);
          p.leaves.push({ from: e.on, paidTo, pplFrom: paidTo, pplTo, back: e.back_on, for: e.for });
          p.fte.push({ from: e.back_on, bps: e.fte_bps });
          this.note("T5-PARENTAL-LEAVE-MONTH", { person: e.person, month: ymOf(paidTo), employer_pay_ends: paidTo, government_pay_begins: paidTo, child: e.for });
          break;
        }
        case "birth": { const k = this.kids.find((x) => x.role === e.child); k.joined = e.on; this.note("T5-NEW-DEPENDANT", { child: k.role, born: k.born }); break; }
        case "open_child_saver": this.openAccount("ACC-C1-SAVE", e.on); this.childSaver = e.on; this.earn("ACC-C1-SAVE", e.on, "OSKO FROM GRANDPARENTS FOR BABY", e.gift_cents, "GIFT-IN", "C1", { child_money: true }); break;
        case "wills": this.wills = e.on; break;
        case "childcare_start": this.care.push({ child: e.child, from: e.on, days: e.days_per_week, daily: e.daily_cents }); break;
        case "school_start": this.care = this.care.filter((c) => c.child !== e.child); break;
        case "rate_backdated": this.rateBackdated = e.on; break;
        case "pocket_money_intent": this.pocketMoney = e.on; break;
        case "note": break;
        default: throw new Error(`unknown life event ${e.do}`);
      }
    }
  }
  spendNot(acct, date, desc, c) { return this.line(acct, date, desc, -c, { capital: true }); }

  // ---------- everyday life ----------
  everyday(ym) {
    const r = this.spendRng, M = this.cast.merchants, days = monthRange(ym, ym).length && lastDay(Number(ym.slice(0, 4)), Number(ym.slice(5)));
    const bought = (acct, d, cat, lo, hi, who, card) => { const m = r.pick(M[cat]), c = cents(r, lo, hi); const desc = card ? m : `EFTPOS ${m}`; this.spend(acct, d, desc, c, cat, who); };
        const kidsAt = this.kids.filter((k) => k.born <= `${ym}-01`).length;
    for (let i = 1; i <= days; i++) {
      const d = `${ym}-${pad(i)}`;
      if (d < this.start) continue;
      const wd = weekday(d), joint = this.together && this.together <= d;
      if (r.next() < 0.33) bought("ACC-A-CARD", d, "DINING", 6, 36, "A", true);
      if (r.next() < 0.14) bought("ACC-A-CARD", d, "SHOPPING", 18, 160, "A", true);
      if (r.next() < 0.1) bought("ACC-A-CARD", d, "PERSONAL", 22, 95, "A", true);
      if (r.next() < 0.1) bought("ACC-A-EVERY", d, "TRANSPORT", 28, 72, "A", false);
      if (r.next() < 0.26) bought("ACC-B-EVERY", d, "DINING", 6, 44, "B", false);
      if (r.next() < 0.12) bought("ACC-B-EVERY", d, "SHOPPING", 14, 130, "B", false);
      if (r.next() < 0.1) bought("ACC-B-EVERY", d, "TRANSPORT", 12, 70, "B", false);
      if (joint) { if (r.next() < 0.3 + kidsAt * 0.05) bought("ACC-JOINT", d, "GROCERIES", 28, 190 + kidsAt * 30, "joint", false); if ((wd === 5 || wd === 6) && r.next() < 0.25) bought("ACC-JOINT", d, "DINING", 34, 120, "joint", false); if (r.next() < 0.06) bought("ACC-JOINT", d, "HEALTH", 9, 70, "joint", false); }
      else { if (r.next() < 0.2) bought("ACC-A-CARD", d, "GROCERIES", 18, 96, "A", true); if (r.next() < 0.2) bought("ACC-B-EVERY", d, "GROCERIES", 16, 92, "B", false); if (r.next() < 0.05) bought("ACC-A-EVERY", d, "HEALTH", 9, 60, "A", false); }
    }
    // the ones that are the same each month
    this.spend("ACC-A-CARD", `${ym}-11`, M.SUBS[0], 1699, "SUBS", "A");
    this.spend("ACC-B-EVERY", biz(`${ym}-05`), `EFTPOS ${M.SUBS[1]}`, 1299, "SUBS", "B");
    this.spend("ACC-A-EVERY", biz(`${ym}-03`), "DIRECT DEBIT KOALATEL MOBILE 5501", 4900, "TELCO", "A");
    this.spend("ACC-B-EVERY", biz(`${ym}-03`), "DIRECT DEBIT KOALATEL MOBILE 7702", 5500, "TELCO", "B");
    // the trap days
    if (ym === "2026-12") { const twin = `EFTPOS ${M.DINING[0]}`, a = this.spend("ACC-A-EVERY", "2026-12-20", twin, 650, "DINING", "A", { twin: true }), b = this.spend("ACC-A-EVERY", "2026-12-20", twin, 650, "DINING", "A", { twin: true }); this.note("T2-SAME-DAY-TWINS", { account: "ACC-A-EVERY", date: a.date, cents: a.cents, count: 2 }); void b; }
    if (ym === "2029-03") { const a = this.spend("ACC-A-CARD", "2029-03-29", "GOOD PAWS APPLIANCES", 18900, "SHOPPING", "A"), b = this.line("ACC-A-CARD", "2029-04-02", "GOOD PAWS APPLIANCES REFUND", 18900, { lens: "spending", cat: "SHOPPING", who: "A" }); this.note("T5-REFUND-ACROSS-MONTH", { purchase: { account: a.acct, date: a.date, cents: a.cents }, refund: { account: b.acct, date: b.date, cents: b.cents } }); }
  }
  /* Rent, power and phone before the home. */
  housing(ym) {
    const r = this.billRng, A = this.people.A, B = this.people.B, d = biz(`${ym}-01`);
    const together = this.rent && this.rent.from <= d;
    if (!this.home) {
      if (together) this.spend("ACC-JOINT", d, "RENT 9 LYGON WALK AGENT".replace("9 LYGON WALK", this.cast.addresses.rental.split(",")[0].toUpperCase()), this.rent.cents, "RENT-PAID", "joint");
      else { this.spend(A.every, d, "RENT PAYMENT FLAT AGENT", 198000, "RENT-PAID", "A"); this.spend(B.every, d, "RENT SHARE HOUSE", 110000, "RENT-PAID", "B"); }
      if (["01", "04", "07", "10"].includes(ym.slice(5))) { const acct = together ? "ACC-JOINT" : A.every, who = together ? "joint" : "A"; this.powerBill(acct, ym, who, r); }
    }
  }
  powerBill(acct, ym, who, r) {
    const c = cents(r, 180, 420), bill = biz(`${ym}-06`), paid = addDays(bill, 14), from = `${prevMonth(prevMonth(prevMonth(ym)))}-01`, to = monthEnd(prevMonth(ym));
    const U = this.cast.utilities; this.spend(acct, paid, `BPAY REDPAW ENERGY ${U.power_ref.replace(/\D/g, "")}`, c, "UTILITIES", who);
    this.bills.push({ kind: "power", issuer: "RedPaw Energy", account: U.power_ref, bill_date: bill, due_on: addDays(bill, 21), from, to, cents: c, stream: "BILL-POWER", who });
  }
  health(ym) {
    // single cover each until they join, then a family policy. Rates reset each 1 April, inside the year: the only line the bank shows is the net premium.
    const d = biz(`${ym}-07`), on = `${ym}-01`, y = Number(ym.slice(0, 4)), steps = y - 2026 + (ym.slice(5) >= "04" ? 1 : 0), lift = (c) => Math.round(c * (1.03 ** steps));
    const tier = this.phiTierNow(on), pct = this.law.phiPct(on, tier);
    const pay = (acct, base, who, policy) => { const gross = lift(base), rebate = Math.round(gross * pct / 100), net = gross - rebate; this.spend(acct, d, `BUPAW HEALTH ${policy}`, net, "HEALTH", who); this.phi.push({ month: ym, who, acct, gross, rebate, net, pct, tier, policy }); };
    const U = this.cast.utilities;
    if (on >= "2027-04-01") pay("ACC-JOINT", 42600, "joint", U.phi_family);
    else { pay("ACC-A-EVERY", 19800, "A", U.phi_single_A); pay("ACC-B-EVERY", 20400, "B", U.phi_single_B); }

  }
  /* The year before the story starts, stated so its April reset is on the record: the last reset the reference knows, inside FY2026. */
  phiHistory() {
    for (const ym of monthRange("2025-07", "2026-06")) {
      const on = `${ym}-01`, y = Number(ym.slice(0, 4)), steps = y - 2026 + (ym.slice(5) >= "04" ? 1 : 0), tier = "tier1", pct = this.law.phiPct(on, tier);
      for (const [who, base, policy] of [["A", 19800, this.cast.utilities.phi_single_A], ["B", 20400, this.cast.utilities.phi_single_B]]) { const gross = Math.round(base * (1.03 ** steps)), rebate = Math.round(gross * pct / 100); this.phi.push({ month: ym, who, acct: null, gross, rebate, net: gross - rebate, pct, tier, policy, before_story: true }); }
    }
    this.note("T4-PHI-1-APRIL", { fy: 2026, month: "2026-04", tier: "tier1", old_pct: this.law.phiPct("2026-03-01", "tier1"), new_pct: this.law.phiPct("2026-04-01", "tier1"), from_reference: true, note: "The last reset the reference holds. Later years use the last known rate, marked assumed, and the premium still moves each 1 April." });
  }
  phiTierNow(on) { const fy = fyOf(on) - 1; const t = this.tax[fy]; const inc = t ? Math.round(((t.A ? t.A.res.taxable_income_cents : 0) + (t.B ? t.B.res.taxable_income_cents : 0)) / 100) : 190000; return this.law.phiTier(on, inc, this.kids.filter((k) => k.born <= on).length); }

  // ---------- the card: closes on the 14th, paid in full on the 25th ----------
  card(ym) {
    const close = `${ym}-14`, prev = this.cardClosed || addDays(this.start, -1), rows = this.lines.filter((l) => l.acct === "ACC-A-CARD" && l.date > prev && l.date <= close).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    if (close < this.start) return;
    const openingOwed = this.cardOwed == null ? -this.open["ACC-A-CARD"] : this.cardOwed, moved = rows.reduce((t, l) => t + l.cents, 0), owed = openingOwed - moved;
    this.statements.push({ account: "ACC-A-CARD", from: addDays(prev, 1), to: close, opening: openingOwed, closing: owed, rows: rows.map((l) => ({ date: l.date, desc: l.desc, cents: l.cents })), credits: rows.filter((l) => l.cents > 0).reduce((t, l) => t + l.cents, 0), charges: -rows.filter((l) => l.cents < 0).reduce((t, l) => t + l.cents, 0) });
    this.cardClosed = close; this.cardOwed = owed;
    if (owed > 0) { const d = `${ym}-25`; this.xfer(this.people.A.every, d, "AMEWX PAYMENT 37004".replace("37004", this.cast.numbers.A_card), "ACC-A-CARD", d, "PAYMENT RECEIVED - THANK YOU", owed, { card_pay: true }); }
  }

  // ---------- interest, sweeps and the joint account ----------
  interestMonth(ym) {
    const end = monthEnd(ym), add = (acct, bps, who) => { if (this.opened[acct] == null || this.opened[acct] > end) return; const c = Math.round((this.bal[acct] || 0) * bps / 10000 / 12); if (c <= 0) return; const r = this.earn(acct, end, "CREDIT INTEREST", c, "INTEREST", who, { interest: true }); (this.interest[fyOf(end)] = this.interest[fyOf(end)] || []).push({ acct, who, cents: c, date: end }); return r; };
    add("ACC-A-SAVE", 410, this.shared["ACC-A-SAVE"] && this.shared["ACC-A-SAVE"] <= end ? "shared" : "A");
    add("ACC-B-SAVE", 385, "B");
    add("ACC-C1-SAVE", 390, "C1");
    const j = this.opened["ACC-JOINT"] && this.opened["ACC-JOINT"] <= end ? add("ACC-JOINT", 60, "shared") : null;
    if (j && !this.traps["T4-JOINT-INTEREST-SHARE"]) this.note("T4-JOINT-INTEREST-SHARE", { account: "ACC-JOINT", date: j.date, cents: j.cents, shares_bps: { A: 5000, B: 5000 } });
  }
  sweeps(ym) {
    const end = monthEnd(ym), A = this.people.A, B = this.people.B, d = addDays(end, -1);
    if (this.joined && end >= "2027-03-31") {
      const need = (this.home ? this.loan.repay + 340000 : 340000) + this.kids.filter((k) => k.born <= end).length * 90000 + this.care.length * 60000;
      const kick = (p, share, label) => { const have = this.bal[p.every] - 150000, c = Math.max(0, Math.min(have, Math.round(need * share))); if (c >= 10000) this.xfer(p.every, d, "TFR TO JOINT", "ACC-JOINT", d, `TFR FROM ${label}`, Math.round(c / 100) * 100); };
      kick(A, 0.45, A.first.toUpperCase()); kick(B, 0.55, B.first.toUpperCase());
      if (this.childSaver && ym.slice(5) !== "01") this.xfer("ACC-JOINT", d, "TFR TO SAVER FOR BABY", "ACC-C1-SAVE", d, "TFR FROM JOINT", 2500, { child_money: true });
    }
    for (const p of [A, B]) {
      const keep = 300000, spare = this.bal[p.every] - keep;
      if (spare > 50000) { const c = Math.floor(spare / 10000) * 10000; if (this.home) this.xfer(p.every, end, "TFR TO OFFSET", "ACC-OFFSET", end, `TFR FROM ${p.first.toUpperCase()}`, c); else this.xfer(p.every, end, "TFR TO SAVER", p.save, end, "TFR FROM EVERYDAY", c); }
      if (this.bal[p.every] < 40000) { const top = 200000, from = this.home && this.bal[p.save] < 300000 ? "ACC-OFFSET" : p.save; this.xfer(from, end, "TFR TO EVERYDAY", p.every, end, "TFR FROM SAVER", top); }
    }
    const jfloor = this.home ? this.loan.repay + 500000 : 60000;
    if (this.joined && this.bal["ACC-JOINT"] < jfloor) { const need = jfloor - this.bal["ACC-JOINT"] + 100000, c = Math.ceil(need / 10000) * 10000; if (this.home && this.bal["ACC-OFFSET"] > c) this.xfer("ACC-OFFSET", end, "TFR TO JOINT", "ACC-JOINT", end, "TFR FROM OFFSET", c); else { const from = this.bal[A.save] >= this.bal[B.save] ? A : B; this.xfer(from.save, end, "TFR TO JOINT", "ACC-JOINT", end, "TFR FROM SAVER", c); } }
    if (this.home && this.bal["ACC-JOINT"] > 900000) { const c = Math.floor((this.bal["ACC-JOINT"] - 600000) / 10000) * 10000; this.xfer("ACC-JOINT", end, "TFR TO OFFSET", "ACC-OFFSET", end, "TFR FROM JOINT", c); }
  }
}

module.exports = { Sim, ymOf, cents, pctOf, biz, inMonth, nextMonth, dayDiff };
