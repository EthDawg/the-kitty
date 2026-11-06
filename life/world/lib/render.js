/* From the book to the files each institution would hand over. Layouts are the ones standard/world writes, with the family's own names, so public recipes read them.
   A file carries who holds it and when it exists; which chapter a household first holds it comes from the script. */
"use strict";
const crypto = require("crypto");
const { fix, money, aud, addDays, fmtDate, fmtMonth, fyOf, fyStart, fyEnd, csvLines, monthRange, monthEnd, nextMonth, prevMonth, dmy, pad, Doc: StandardDoc, MUTED, M, period, eml, page, row, htmlEsc, workbook } = require("./std");
const { bankFile } = require("./shapes");

/* The shared PDF writer signs every page as the Davies' world. A variant family must not, so a variant says only that it is a test household. */
let FOOT = null;
class Doc extends StandardDoc { constructor(o) { super({ ...o, ...(FOOT ? { footer: FOOT(o.brand.name) } : {}) }); } }

const PAWROLL = { name: "Pawroll", tagline: "Every pay, every paw, on time.", color: "#3b6fb5" };
const WESTPAW = { name: "Westpaw", tagline: "Banking with a wag.", color: "#b5243a" };
const ETREAT = { name: "E*Treat", tagline: "Stock plans, with a biscuit.", color: "#4c1d95" };
const GOV = { name: "myGuv", tagline: "Your tax, your paws on it.", color: "#1e3a8a" };
const AMEWX = { name: "Amewx", tagline: "Don't leave home without your whiskers.", color: "#0b5cab" };
const BUPAW = { name: "Bupaw", tagline: "Health cover for the whole litter.", color: "#0369a1" };
const SURE = { name: "Purrsure", tagline: "Cover for the curious.", color: "#0f766e" };
const FUND = { hestabby: { name: "HESTAbby", color: "#a0522d", tag: "Super for the tabby at heart." }, purrannuation: { name: "Purrannuation", color: "#1f6f8b", tag: "Nine lives, one retirement." } };
const ymOf = (d) => d.slice(0, 7);

class Files {
  constructor(sim) { this.sim = sim; this.cast = sim.cast; this.list = []; this.seen = new Set(); this.deflate = (b) => new Uint8Array(require("zlib").deflateSync(b, { level: 6 })); this.deflateRaw = (b) => new Uint8Array(require("zlib").deflateRawSync(b, { level: 6 })); }
  add(f) {
    if (f.text != null) f.bytes = new TextEncoder().encode(this.cast.variant ? f.text.replace(/The Kitty's Davies world/g, "a Kitty test household") : f.text);
    if (!(f.bytes instanceof Uint8Array)) f.bytes = new Uint8Array(f.bytes);
    delete f.text;
    f.path = `sources/${f.stream}/${f.delivered_on}/${f.name}`;
    if (this.seen.has(f.path)) throw new Error(`two files at ${f.path}`);
    this.seen.add(f.path);
    f.sha256 = crypto.createHash("sha256").update(f.bytes).digest("hex");
    f.size = f.bytes.length;
    f.where = f.where || "portal";
    this.list.push(f);
    return f;
  }
  rows(acct, from, to) { return this.sim.lines.filter((l) => l.acct === acct && l.date >= from && l.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq)).map((l) => ({ date: l.date, desc: l.desc, cents: l.cents })); }
  openingOn(acct, from) { const s = this.sim; return s.lines.filter((l) => l.acct === acct && l.date < from).reduce((t, l) => t + l.cents, s.open[acct] || 0); }
  /* One download of one window from a bank. */
  bank(role, acct, stream, number, from, to, delivered, person, o = {}) {
    const inst = this.cast.institutions[role], spec = inst.spec, rows = this.rows(acct, from, to);
    if (!rows.length) return null;
    const opening = this.openingOn(acct, from), closing = rows.reduce((t, r) => t + r.cents, opening);
    const made = bankFile(spec, { number, rows, opening, from, to, closing });
    const ext = spec.special === "ofx" ? "ofx" : spec.special === "qif" ? "qif" : "csv";
    const base = o.name || `${inst.brand}-${stream}-${from}-to-${to}.${ext}`;
    return this.add({ stream, brand: inst.brand, person, visible_to: o.visible_to || [person], delivered_on: delivered, name: base, text: made.text, family: spec.family || spec.key || "life-variant-csv", container: ext, origin: "portal", issued_on: to, account: acct, rows: rows.length, window: { from, to }, held_from: o.held_from, shape: role, note: o.note });
  }
}

// ---------- payroll ----------
function payslipDoc(fs, p, who, ytd, last4) {
  const d = new Doc({ brand: PAWROLL, title: "Payslip", kicker: `${fmtDate(p.from)} to ${fmtDate(p.to)}`, deflate: fs.deflate });
  d.h1(`Payslip for ${who}`);
  d.kv([["Employer", p.employer], ["Pay date", fmtDate(p.date)], ["Pay period", `${fmtDate(p.from)} to ${fmtDate(p.to)}`], ["Pay frequency", p.weekly ? "Weekly" : "Fortnightly"]], 3);
  d.h2("This pay");
  const rows = [["Ordinary hours, salary", money(p.gross), money(ytd.gross)], ["PAYG withholding", money(-p.tax), money(-ytd.tax)], ["Superannuation guarantee (paid to fund on payday)", money(p.sup), money(ytd.sup)]];
  if (p.packaging) rows.push(["Salary packaging, PawPack Benefits, before tax and not in gross", money(p.packaging), money(ytd.packaging)]);
  if (p.hours != null) rows.push([`Hours worked this period: ${p.hours}`, "", ""]);
  d.table([{ label: "Item", w: 300 }, { label: "This pay", w: 90, align: "right" }, { label: "Year to date", w: 90, align: "right" }], rows, { foot: [`Net pay, to ${p.to_account || "nominated account"}`, money(p.net), money(ytd.net)] });
  d.para(`Net pay of ${aud(p.net)} was paid on ${fmtDate(p.date)} to the account ending ${last4} with the description SALARY ${p.employer.toUpperCase()}. Year to date covers the financial year from ${fmtDate(fyStart(fyOf(p.date)))}.`, { color: MUTED, size: 8.5 });
  return d.finish();
}
function incomeStatementDoc(fs, who, employer, rows, fy, packaged) {
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const d = new Doc({ brand: PAWROLL, title: "Income statement", kicker: `FY${fy}, 01 Jul ${fy - 1} to ${fmtDate(fyEnd(fy))}`, deflate: fs.deflate });
  d.h1(`Income statement for ${who}`);
  d.kv([["Payer", employer], ["Payee", who], ["Income year", `1 July ${fy - 1} to 30 June ${fy}`], ["Status", "Tax ready"], ["Pays in the year", String(rows.length)], ["Payment basis", "Salary and wages, fortnightly"]], 3);
  d.h2("Amounts reported");
  const amounts = [["Gross payments (salary, wages, allowances, bonuses)", money(sum("gross"))], ["Tax withheld (PAYG withholding)", money(sum("tax"))], ["Reportable employer superannuation contributions", money(0)], ["Superannuation guarantee paid on your behalf (for information)", money(sum("sup"))], ["Net pay received", money(sum("net"))]];
  if (packaged) amounts.push(["Reportable fringe benefits amount, salary packaging", money(Math.round(packaged * 1.8868))]);
  d.table([{ label: "Item", w: 300 }, { label: "Amount", w: 100, align: "right" }], amounts);
  d.h2("Pays in the year");
  d.table([{ label: "Pay date", w: 90 }, { label: "Gross", w: 80, align: "right" }, { label: "Tax withheld", w: 80, align: "right" }, { label: "Super", w: 80, align: "right" }, { label: "Net", w: 80, align: "right" }], rows.map((p) => [fmtDate(p.date), money(p.gross), money(p.tax), money(p.sup), money(p.net)]), { foot: ["Total", money(sum("gross")), money(sum("tax")), money(sum("sup")), money(sum("net"))] });
  d.para("An income statement is what an employer reports to the tax office each year through Single Touch Payroll; the figures here add up the pays above. Fictional employer, fictional employee.", { color: MUTED, size: 8.5 });
  return d.finish();
}
function payroll(fs) {
  const s = fs.sim, end = s.end, N = fs.cast.numbers;
  for (const key of ["A", "B"]) {
    const p = s.people[key], running = {}, all = s.pays.filter((x) => x.person === key);
    const last4 = key === "A" ? N.last4_A : N.last4_B;
    for (const x of all) {
      const y = running[x.fy] = running[x.fy] || { gross: 0, tax: 0, sup: 0, net: 0, packaging: 0 };
      y.gross += x.gross; y.tax += x.tax; y.sup += x.sup; y.net += x.net; y.packaging += x.packaging;
      const stream = x.ppl ? "PPL" : `PAY-${key}`;
      fs.add({ stream, brand: x.ppl ? "myguv" : "pawroll", person: p.id, visible_to: [p.id], delivered_on: x.date, name: `${x.ppl ? "Paid-Parental-Leave" : "Pawroll-Payslip"}-${x.date}.pdf`, bytes: payslipDoc(fs, x, p.name, y, last4), family: "pawroll-payslip-pdf", container: "pdf", origin: "portal", issued_on: x.date });
    }
    for (let fy = 2027; fyEnd(fy) < end; fy++) {
      const ppl = all.filter((x) => x.fy === fy && x.ppl), on2 = `${fy}-07-14`;
      if (ppl.length) fs.add({ stream: "PPL", brand: "myguv", person: p.id, visible_to: [p.id], delivered_on: on2, name: `Paid-Parental-Leave-IncomeStatement-FY${fy}.pdf`, bytes: incomeStatementDoc(fs, p.name, "Services Pawstralia", ppl, fy, 0), family: "pawroll-income-statement-pdf", container: "pdf", origin: "portal", issued_on: on2 });
      const rows = all.filter((x) => x.fy === fy && !x.ppl); if (!rows.length) continue;
      const packaged = rows.reduce((t, r) => t + r.packaging, 0), on = `${fy}-07-14`;
      fs.add({ stream: `IS-${key}`, brand: "pawroll", person: p.id, visible_to: [p.id], delivered_on: on, name: `Pawroll-IncomeStatement-FY${fy}.pdf`, bytes: incomeStatementDoc(fs, p.name, p.employer, rows, fy, packaged), family: "pawroll-income-statement-pdf", container: "pdf", origin: "portal", issued_on: on });
    }
  }
}

// ---------- banks ----------
function monthly(fs, role, acct, stream, number, person, from, delivery = 2, visible) {
  const last = fs.sim.end.slice(0, 7);
  for (const ym of monthRange(from.slice(0, 7), last)) fs.bank(role, acct, stream, number, ym < from ? from : `${ym}-01` < from ? from : `${ym}-01`, monthEnd(ym), `${nextMonth(ym)}-${pad(delivery)}`, person, { visible_to: visible });
}
function banks(fs) {
  const s = fs.sim, C = fs.cast, N = C.numbers, A = s.people.A, B = s.people.B;
  // chapter 0's dropped file: three months in one
  fs.bank("A_every", "ACC-A-EVERY", "EVERY-A", N.A_every, "2026-10-01", "2026-12-31", "2027-01-09", A.id, { name: C.institutions.A_every.spec.file, held_from: 0, note: "The file she drops. Three months in one." });
  // the first close: the backfill, and a window that overlaps what she already holds
  fs.bank("A_every", "ACC-A-EVERY", "EVERY-A", N.A_every, "2026-07-01", "2026-09-30", "2027-02-07", A.id, { held_from: 2, note: "Back to 1 July, for the tax year." });
  fs.bank("A_every", "ACC-A-EVERY", "EVERY-A", N.A_every, "2026-12-17", "2027-01-31", "2027-02-07", A.id, { held_from: 2, note: "Overlaps the first file." });
  s.note("T2-OVERLAP-WINDOW", { account: "ACC-A-EVERY", overlap_from: "2026-12-17", overlap_to: "2026-12-31", lines: fs.rows("ACC-A-EVERY", "2026-12-17", "2026-12-31").length });
  s.note("T0-NO-RECIPE", { account: "ACC-A-EVERY", file: C.institutions.A_every.spec.file, shape: C.institutions.A_every.spec.key || "variant" });
  s.note("T0-SECOND-ACCOUNT-FREE", { account: "ACC-A-SAVE" });
  monthly(fs, "A_every", "ACC-A-EVERY", "EVERY-A", N.A_every, A.id, "2027-02-01");
  fs.bank("A_save", "ACC-A-SAVE", "SAVE-A", N.A_save, "2026-07-01", "2027-01-31", "2027-02-07", A.id, { held_from: 2 });
  monthly(fs, "A_save", "ACC-A-SAVE", "SAVE-A", N.A_save, A.id, "2027-02-01");
  fs.bank("B_every", "ACC-B-EVERY", "EVERY-B", N.B_every, "2026-07-01", "2027-02-28", "2027-03-02", B.id, { held_from: 3 });
  monthly(fs, "B_every", "ACC-B-EVERY", "EVERY-B", N.B_every, B.id, "2027-03-01");
  fs.bank("B_save", "ACC-B-SAVE", "SAVE-B", N.B_save, "2026-07-01", "2027-02-28", "2027-03-02", B.id, { held_from: 3 });
  monthly(fs, "B_save", "ACC-B-SAVE", "SAVE-B", N.B_save, B.id, "2027-03-01");
  // the joint account, downloaded by both, overlapping. Chapter 3's trap.
  const both = [A.id, B.id], open = s.opened["ACC-JOINT"], J = (from, to, on, who, tag) => fs.bank("joint", "ACC-JOINT", "JOINT", N.joint, from, to, on, who, { visible_to: both, name: `Joint-${tag}-${on}.${C.institutions.joint.spec.special ? C.institutions.joint.spec.special : "csv"}` });
  const same = "2027-03-21", a1 = J(open, same, "2027-03-22", A.id, A.id), b1 = J(open, same, "2027-03-22", B.id, B.id);
  s.note("T3-JOINT-SAME-FILE", { paths: [a1.path, b1.path], sha256: a1.sha256 });
  const a2 = J(open, "2027-03-30", "2027-03-30", A.id, A.id), b2 = J("2027-03-11", "2027-03-31", "2027-03-31", B.id, B.id);
  s.note("T3-JOINT-TWICE", { account: "ACC-JOINT", a: a2.path, b: b2 ? b2.path : null, overlap_from: "2027-03-11", overlap_to: "2027-03-30", lines: fs.rows("ACC-JOINT", "2027-03-11", "2027-03-30").length });
  for (const ym of monthRange("2027-04", s.end.slice(0, 7))) J(`${ym}-01`, monthEnd(ym), `${nextMonth(ym)}-03`, A.id, A.id);
  { // his: every seven weeks, ninety days back
    const r = s.rng("joint-b"); let d = "2027-05-20";
    while (d <= addDays(s.end, 30)) { const to = addDays(d, -1); J(addDays(to, -89), to > s.end ? s.end : to, d, B.id, B.id); d = addDays(d, 49 + r.int(-3, 3)); }
  }
  // the card: an activity file a month, a statement closing on the 14th
  const card = N.A_card, inst = C.institutions.A_card;
  for (const ym of monthRange("2026-07", s.end.slice(0, 7))) {
    const rows = fs.rows("ACC-A-CARD", `${ym}-01`, monthEnd(ym)); if (!rows.length) continue;
    const text = csvLines([["Date", "Description", "Card Member", "Account #", "Amount"], ...rows.map((r) => [dmy(r.date), r.desc, A.name.toUpperCase(), `-${card}`, fix(-r.cents)])]);
    fs.add({ stream: "CARD-A", brand: inst.brand, person: A.id, visible_to: [A.id], delivered_on: `${nextMonth(ym)}-02`, name: `activity-${ym}.csv`, text, family: "southern-activity-csv", container: "csv", origin: "portal", issued_on: monthEnd(ym), account: "ACC-A-CARD", rows: rows.length, window: { from: `${ym}-01`, to: monthEnd(ym) } });
  }
  for (const st of s.statements) {
    const d = new Doc({ brand: AMEWX, title: "Card statement", kicker: period(st.from, st.to), deflate: fs.deflate, rowH: 24 });
    d.h1("Rewards credit card");
    d.kv([["Card member", A.name.toUpperCase()], ["Account", `Card ending ${card}`], ["Previous balance", aud(st.opening)], ["New balance", aud(st.closing)], ["Payments and credits", aud(st.credits)], ["New charges", aud(st.charges)]], 3);
    d.h2("Transactions");
    d.table([{ label: "Date", w: 68 }, { label: "Description", w: 292 }, { label: "Amount", w: 80, align: "right" }], st.rows.map((r) => [fmtDate(r.date), r.desc, money(-r.cents)]), { foot: ["", "New balance", money(st.closing)] });
    if (!st.rows.length) d.para("No transactions in this period.", { color: MUTED });
    fs.add({ stream: "CARD-A-STMT", brand: inst.brand, person: A.id, visible_to: [A.id], delivered_on: addDays(st.to, 2), name: `Amewx-Statement-${st.to}.pdf`, bytes: d.finish(), family: "amewx-statement-pdf", container: "pdf", origin: "portal", issued_on: st.to, account: "ACC-A-CARD" });
  }
  // a child's saver, in a parent's name
  if (s.childSaver) monthly(fs, "A_save", "ACC-C1-SAVE", "SAVE-C1", N.child_save, A.id, s.childSaver, 2);
  if (s.loan) monthly(fs, "loan", "ACC-OFFSET", "OFFSET", N.offset, A.id, s.loan.opened, 3, both);
}

// ---------- super ----------
function fundDoc(fs, key, s, from, to, title, style, cast) {
  const p = cast[key], f = FUND[p.super], before = s.rows.filter((l) => l.date < from), opening = before.length ? before[before.length - 1].bal : s.open, upTo = s.rows.filter((l) => l.date <= to), closing = upTo.length ? upTo[upTo.length - 1].bal : opening;
  const sum = (k) => s.rows.filter((l) => l.date >= from && l.date <= to && l.type === k).reduce((t, l) => t + l.cents, 0);
  const d = new Doc({ brand: { name: f.name, tagline: f.tag, color: f.color }, title, kicker: period(from, to), deflate: fs.deflate, style });
  d.h1(`${title} for ${p.name}`);
  d.kv([["Member number", p.member], ["Member", p.name], ["Statement period", `${fmtDate(from)} to ${fmtDate(to)}`], ["Opening balance", aud(opening)], ["Closing balance", aud(closing)], ["Investment option", "Balanced growth"]], 3);
  d.h2("Your account summary");
  d.table([{ label: "Item", w: 320 }, { label: "Amount", w: 120, align: "right" }], [["Opening balance", money(opening)], ["Employer contributions", money(sum("employer"))], ["Investment earnings", money(sum("earnings"))], ["Contributions tax", money(-sum("contributions_tax"))], ["Administration fees", money(-sum("fee"))], ["Insurance premiums", money(-sum("insurance"))], ["Closing balance", money(closing)]]);
  d.para("Employer contributions are reported when the fund received them. Fictional fund, fictional member, nothing here is advice.", { size: 8.5, color: MUTED });
  return d.finish();
}
const V2 = { employer: "CONTRIB-SG", contributions_tax: "TAX-15", fee: "FEE-ADMIN", insurance: "INS-DTPD", earnings: "EARNINGS" };
const CODE = { employer: "SG", contributions_tax: "TAX", fee: "FEE", insurance: "INS", earnings: "EARN" };
const ORDER = { employer: 1, contributions_tax: 2, fee: 3, insurance: 4, earnings: 5 };
const num = (c) => Number(fix(c));
function superFiles(fs) {
  const s = fs.sim, C = fs.cast;
  for (const key of ["A", "B"]) {
    const f = s.super[key], p = C[key]; let bal = f.open;
    f.rows = f.lines.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ORDER[a.type] - ORDER[b.type])).map((l) => { bal += l.cents; return { ...l, bal }; });
    const stream = `SUPER-${key}`, stmt = `SUPER-${key}-STMT`, last = s.end.slice(0, 7), who = p.id, vis = [p.id];
    if (p.super === "purrannuation") {
      for (const ym of monthRange("2026-07", last)) {
        const rows = f.rows.filter((l) => ymOf(l.date) === ym);
        const text = csvLines([["Effective Date", "Category", "Narrative", "Amount (AUD)", "Running Balance", "Reference"], ...rows.map((l, i) => [l.date, V2[l.type], l.desc, fix(l.cents), fix(l.bal), `PN${l.date.replace(/-/g, "")}${pad(i + 1, 3)}`])]);
        fs.add({ stream, brand: "purrannuation", person: who, visible_to: vis, delivered_on: `${nextMonth(ym)}-05`, name: `Purrannuation-Activity-${ym}.csv`, text, family: "purrannuation-csv-v2", container: "csv", origin: "portal", issued_on: monthEnd(ym), account: stream });
      }
      for (let fy = 2027; fyEnd(fy) < s.end; fy++) fs.add({ stream: stmt, brand: "purrannuation", person: who, visible_to: vis, delivered_on: `${fy}-08-20`, name: `Purrannuation-Annual-Statement-FY${fy}.pdf`, bytes: fundDoc(fs, key, f, fyStart(fy), fyEnd(fy), "Annual member statement", "band", C), family: "fund-statement-pdf", container: "pdf", origin: "portal", issued_on: `${fy}-08-20`, account: stream });
    } else {
      const quarters = monthRange("2026-07", last).filter((ym) => ["03", "06", "09", "12"].includes(ym.slice(5)));
      for (const ym of quarters) {
        const b = monthEnd(ym), a = `${prevMonth(prevMonth(ym))}-01`, rows = f.rows.filter((l) => l.date >= a && l.date <= b), before = f.rows.filter((l) => l.date < a), opening = before.length ? before[before.length - 1].bal : f.open;
        const doc = { schema: "hestabby.app/2", member: { number: p.member, name: p.name }, period: { from: a, to: b }, balance: { opening: num(opening), closing: num(rows[rows.length - 1].bal) }, transactions: rows.map((l) => ({ date: l.date, code: CODE[l.type], label: l.desc, amount: num(l.cents), balanceAfter: num(l.bal) })) };
        fs.add({ stream, brand: "hestabby", person: who, visible_to: vis, delivered_on: addDays(b, 6), name: `HESTAbby-app-export-${b}.json`, text: `${JSON.stringify(doc, null, 2)}\n`, family: "hestabby-app-json", container: "json", origin: "connector", issued_on: addDays(b, 6), account: stream });
      }
      for (let y = 2026; y <= 2035; y++) for (const [a, b] of [[`${y}-01-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-12-31`]]) {
        if (a < "2026-07-01" || b > s.end) continue;
        fs.add({ stream: stmt, brand: "hestabby", person: who, visible_to: vis, delivered_on: addDays(b, 45), name: `HESTAbby-Statement-${b}.pdf`, bytes: fundDoc(fs, key, f, a, b, "Half-yearly statement", "plain", C), family: "fund-statement-plain-pdf", container: "pdf", origin: "portal", issued_on: addDays(b, 45), account: stream });
      }
    }
  }
}

// ---------- tax ----------
const DESC = { 1: "Salary or wages", 10: "Gross interest", 12: "Employee share schemes", "18A": "Net capital gain", "18H": "Total current year capital gains", D5: "Other work-related expenses", D10: "Cost of managing tax affairs" };
function returnLines(labels, a) {
  const rows = [], leaf = (k, section, up) => { if (labels[k]) rows.push({ line_id: k, section, cents: labels[k], desc: DESC[k], up }); };
  for (const k of ["1", "10", "12", "18A"]) leaf(k, "Income", "TI");
  rows.push({ line_id: "TI", section: "Income", cents: a.total_income_cents, desc: "Total income" });
  for (const k of ["D5", "D10"]) leaf(k, "Deductions", "TD");
  rows.push({ line_id: "TD", section: "Deductions", cents: a.deductions_cents, desc: "Total deductions" });
  rows.push({ line_id: "TX", section: "Taxable", cents: a.taxable_income_cents, desc: "Taxable income" });
  if (labels["18H"]) rows.push({ line_id: "18H", section: "Memo", cents: labels["18H"], desc: DESC["18H"] });
  return rows;
}
const cr = (c) => `${money(Math.abs(c))} ${c >= 0 ? "CR" : "DR"}`;
function returnDoc(fs, who, r) {
  const a = r.res, d = new Doc({ brand: { name: r.agent }, title: "Tax return", kicker: `Year ended ${fmtDate(fyEnd(r.fy))}`, deflate: fs.deflate, style: "plain" });
  d.h1(`FY${r.fy} tax return for ${who}`);
  d.kv([["Taxpayer", who], ["Financial year", `FY${r.fy}`], ["Version", String(r.version)], ["Lodged on", fmtDate(r.lodged_on)], ["Assessed on", fmtDate(r.assessed_on)], ["Prepared by", r.agent]], 3);
  d.h2("Return labels");
  d.table([{ label: "Section", w: 70 }, { label: "Label", w: 50 }, { label: "Description", w: 240 }, { label: "Amount", w: 90, align: "right" }], returnLines(r.labels, a).map((x) => [x.section, x.line_id, x.desc, money(x.cents)]));
  d.h2("Assessment");
  d.table([{ label: "Item", w: 300 }, { label: "Amount", w: 120, align: "right" }], [["Gross tax", money(a.gross_tax_cents)], ["Offsets", money(a.offsets_cents)], ["Medicare levy", money(a.medicare_levy_cents)], ["HELP repayment", money(a.help_cents)], ["PAYG credits", money(a.payg_credits_cents)], ["Other credits", money(a.other_credits_cents)], ["Result", cr(a.result_cents)]]);
  d.para("A copy of the return as lodged, with the assessment, kept by your tax agent. Fictional, and not advice.", { size: 8.5, color: MUTED });
  return d.finish();
}
function noaDoc(fs, who, tag, r) {
  const a = r.res, d = new Doc({ brand: GOV, title: "Notice of assessment", deflate: fs.deflate }), L = M, R = 316; let y = d.y;
  d.text(L, y, r.version > 1 ? "Notice of amended assessment" : "Notice of assessment", { size: 16, bold: true }); y -= 26;
  const left = [["Name", who], ["Financial year", `FY${r.fy}`], ["Date of issue", fmtDate(r.assessed_on)], ["Return lodged", fmtDate(r.lodged_on)], ["Version", String(r.version)], ["Reference", `NOA-${tag}-${r.fy}-${r.version}`]];
  const right = [["Taxable income", money(a.taxable_income_cents)], ["Gross tax", money(a.gross_tax_cents)], ["Less offsets", money(a.offsets_cents)], ["Medicare levy", money(a.medicare_levy_cents)], ["HELP repayment", money(a.help_cents)], ["PAYG credits", money(a.payg_credits_cents)], ["Other credits", money(a.other_credits_cents)], ["Result of this notice", cr(a.result_cents)]];
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) { if (left[i]) { d.text(L, y, left[i][0], { size: 9, color: MUTED }); d.text(L + 84, y, left[i][1], { size: 9.5 }); } if (right[i]) { d.text(R, y, right[i][0], { size: 9, color: MUTED }); d.text(R + 220, y, right[i][1], { size: 9.5, align: "right", bold: i === right.length - 1 }); } y -= 16; }
  d.y = y - 10;
  d.para(`${a.result_cents >= 0 ? "Your refund goes to the bank account we hold for you." : "Pay by the date on your statement of account."} A parody of a government notice. Fictional, and not advice.`, { size: 8.5, color: MUTED });
  return d.finish();
}
function healthDoc(fs, who, fy, h) {
  const d = new Doc({ brand: BUPAW, title: "Private health insurance statement", kicker: `Year ended ${fmtDate(fyEnd(fy))}`, deflate: fs.deflate });
  d.h1(`Tax statement for ${who}`);
  d.kv([["Member", who], ["Policy", h.policy], ["Financial year", `FY${fy}`], ["Year end", fmtDate(fyEnd(fy))], ["Rebate tier", h.tier], ["Benefit code", "30"]], 3);
  d.h2("Statement details");
  d.table([{ label: "Item", w: 320 }, { label: "Amount", w: 120, align: "right" }], [["Your share of premiums paid", money(h.premium)], ["Australian Government rebate received", money(h.rebate)], ["Days covered", String(h.days)]]);
  d.para("Use these figures for the private health insurance policy details on your tax return. Fictional, a parody insurer.", { size: 8.5, color: MUTED });
  return d.finish();
}
function helpPage(who, fy, rows, closing) {
  const body = `<h1>HELP account</h1><p>Name: ${htmlEsc(who)}</p><p>Financial year: FY${fy}</p><table>${row(["Date", "Description", "Amount", "Balance"], "th")}${rows.map((r) => row([fmtDate(r.date), r.desc, fix(r.cents), fix(r.balance)])).join("")}</table><p>Closing balance: ${fix(closing)}</p>`;
  return page(`myGuv HELP account FY${fy}`, body);
}
function tax(fs) {
  const s = fs.sim, C = fs.cast, law = s.law;
  for (const [fyS, recs] of Object.entries(s.tax)) for (const key of ["A", "B"]) {
    const fy = Number(fyS), rec = recs[key], p = s.people[key], streamT = `TAX-${key}`;
    for (const v of rec.amended ? [rec, rec.amended] : [rec]) {
      const tag = v.version > 1 ? "-amended" : "", vis = [p.id];
      fs.add({ stream: streamT, brand: "myguv", person: p.id, visible_to: vis, delivered_on: v.assessed_on, name: `Notice-of-Assessment-FY${fy}${tag}.pdf`, bytes: noaDoc(fs, p.name, key, v), family: "myguv-noa-pdf", container: "pdf", origin: "portal", issued_on: v.assessed_on });
      if (fy >= 2027 || v.version > 1) fs.add({ stream: streamT, brand: "accountant", person: p.id, visible_to: vis, delivered_on: v.assessed_on, name: `Tax-Return-FY${fy}${tag}.pdf`, bytes: returnDoc(fs, p.name, v), family: "agent-return-pdf", container: "pdf", origin: "email", where: "email", issued_on: v.assessed_on });
    }
    if (fy >= 2027) {
      const next = `${fy}-08-01`, interest = [];
      const items = [], wages = {};
      for (const x of s.pays.filter((y) => y.person === key && y.fy === fy)) { const k = wages[x.employer] = wages[x.employer] || { gross: 0, tax: 0 }; k.gross += x.gross; k.tax += x.tax; }
      for (const [payer, v] of Object.entries(wages)) items.push({ label: "1", source: payer, amount: num(v.gross), withheld: num(v.tax) });
      // pre-fill follows the TFN on the account, whoever owns the money
      const named = (s.interest[fy] || []).filter((i) => (key === "A" ? ["ACC-A-SAVE", "ACC-C1-SAVE"].includes(i.acct) : i.acct === "ACC-B-SAVE") || (i.acct === "ACC-JOINT")).reduce((t, i) => t + (i.acct === "ACC-JOINT" ? (key === "A" ? Math.ceil(i.cents / 2) : Math.floor(i.cents / 2)) : i.cents), 0);
      if (named) items.push({ label: "10", source: "Banks and financial institutions", amount: num(named) });
      if (rec.labels["12"]) items.push({ label: "12", source: "E*Treat", amount: num(rec.labels["12"]) });
      void interest;
      fs.add({ stream: `PREFILL-${key}`, brand: "myguv", person: p.id, visible_to: [p.id], delivered_on: next, name: `myGuv-prefill-FY${fy}.json`, text: `${JSON.stringify({ service: "myGuv", person: p.name, financialYear: `${fy - 1}-${String(fy).slice(2)}`, periodEnd: fyEnd(fy), status: "Pre-fill ready", items }, null, 2)}\n`, family: "myguv-prefill-json", container: "json", origin: "connector", issued_on: next });
      const ded = Object.entries(rec.labels).filter(([k]) => /^D\d/.test(k)).map(([k, c]) => ({ label: k, desc: DESC[k], cents: c }));
      const data = [[`Deductions worksheet, ${p.name}`], ["Financial year", `FY${fy}`], ["Year end", { date: fyEnd(fy) }], [], ["Label", "Description", "Amount"], ...ded.map((r) => [r.label, r.desc, r.cents / 100]), [], ["Total", "", ded.reduce((t, r) => t + r.cents, 0) / 100]];
      fs.add({ stream: `DED-${key}`, brand: "family", person: p.id, visible_to: [p.id], delivered_on: next, name: `Deductions-Worksheet-FY${fy}.xlsx`, bytes: workbook([{ name: "Worksheet", rows: data }], fs.deflateRaw), family: "deductions-xlsx", container: "xlsx", origin: "manual", where: "drive", issued_on: next });
      if (key === "B") {
        const vs = s.rsu.vests.filter((v) => v.fy === fy), total = vs.reduce((t, v) => t + v.cents, 0), plan = C.B.plan;
        const d = new Doc({ brand: ETREAT, title: "Employee share scheme statement", kicker: `Year ended ${fmtDate(fyEnd(fy))}`, deflate: fs.deflate });
        d.h1(`ESS statement, FY${fy}`);
        d.kv([["Plan account", plan.account], ["Participant", p.name], ["Financial year", `FY${fy}`], ["Year end", fmtDate(fyEnd(fy))], ["Provider", plan.parent], ["Scheme", "Restricted stock units, deferred"]], 3);
        d.h2("Discount from taxed-deferred interests");
        d.table([{ label: "Taxing point", w: 100 }, { label: "Units", w: 60, align: "right" }, { label: "Market value (USD)", w: 110, align: "right" }, { label: "AUD per USD", w: 90, align: "right" }, { label: "Discount (AUD)", w: 100, align: "right" }], vs.map((v) => [fmtDate(v.date), String(v.units), v.price, v.fx, money(v.cents)]), { foot: ["Total", "", "", "", money(total)] });
        d.para("Report the total at the employee share scheme item of your return. Fictional statement.", { size: 8.5, color: MUTED });
        fs.add({ stream: "RSU-ESS", brand: "etreat", person: p.id, visible_to: [p.id], delivered_on: `${fy}-07-14`, name: `ETreat-ESS-Statement-FY${fy}.pdf`, bytes: d.finish(), family: "etreat-ess-pdf", container: "pdf", origin: "portal", issued_on: `${fy}-07-14` });
      }
    }
    void law;
  }
  // private health: a statement a person a year, the year's two rates folded into one total
  for (let fy = 2026; fyEnd(fy) < s.end; fy++) {
    const months = monthRange(`${fy - 1}-07`, `${fy}-06`), rows = s.phi.filter((x) => months.includes(x.month)), days = fy % 4 === 0 ? 366 : 365;
    const part = (key) => rows.reduce((t, x) => { const f = x.who === key ? 1 : x.who === "joint" ? 0.5 : 0; return { premium: t.premium + Math.round(x.net * f), rebate: t.rebate + Math.round(x.rebate * f), gross: t.gross + Math.round(x.gross * f) }; }, { premium: 0, rebate: 0, gross: 0 });
    for (const key of ["A", "B"]) {
      const h = part(key), tier = rows[rows.length - 1].tier, p = s.people[key], label = { base: "Base", tier1: "Tier 1", tier2: "Tier 2", tier3: "Tier 3" }[tier];
      fs.add({ stream: `PHI-${key}`, brand: "bupaw", person: p.id, visible_to: [p.id], delivered_on: `${fy}-07-12`, name: `Bupaw-Tax-Statement-FY${fy}.pdf`, bytes: healthDoc(fs, p.name, fy, { ...h, days, tier: label, policy: rows[rows.length - 1].policy }), family: "bupaw-statement-pdf", container: "pdf", origin: "portal", issued_on: `${fy}-07-12` });
    }
  }
  // HELP: one page a year, plus the one she fetches in the first close
  const led = [{ date: "2026-06-01", kind: "open", desc: "Balance brought forward", cents: 0, balance: -C.opening["HELP-A"], fy: 2026 }, ...s.help.ledger].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  s.help.full = led;
  const P = s.people.A, page1 = (fy, rows, on, name) => { if (!rows.length) return; fs.add({ stream: "HELP-A", brand: "myguv", person: P.id, visible_to: [P.id], delivered_on: on, name, text: helpPage(P.name, fy, rows, rows[rows.length - 1].balance), family: "myguv-help-html", container: "html", origin: "portal", issued_on: on }); };
  page1(2026, led.filter((e) => e.fy === 2026), "2026-07-15", "myGuv-HELP-account-FY2026.html");
  page1(2027, led.filter((e) => e.date >= "2026-07-01" && e.date < "2027-02-10"), "2027-02-10", "myGuv-HELP-account-FY2027-to-date.html");
  for (let fy = 2027; fyEnd(fy) < s.end; fy++) page1(fy, led.filter((e) => e.date >= fyStart(fy) && e.date <= fyEnd(fy)), `${fy}-07-15`, `myGuv-HELP-account-FY${fy}.html`);
  s.note("T2-HELP-NO-BANK-LINE", { opening_cents: -C.opening["HELP-A"], first_repayment: led.find((e) => e.kind === "repay") });
}

// ---------- shares ----------
function rsu(fs) {
  const s = fs.sim, C = fs.cast, p = s.people.B, plan = C.B.plan, vis = [p.id];
  for (const x of s.rsu.sales) {
    const d = new Doc({ brand: ETREAT, title: "Sale confirmation", kicker: `Confirmation ${x.ref}`, deflate: fs.deflate });
    d.h1(`Sold ${x.units} ${plan.code}`);
    d.kv([["Plan account", plan.account], ["Participant", p.name], ["Security", plan.code], ["Trade date", fmtDate(x.date)], ["Settlement date", fmtDate(x.settle)], ["Reference", x.ref]], 3);
    d.h2("Trade");
    d.table([{ label: "Item", w: 320 }, { label: "Amount", w: 120, align: "right" }], [["Quantity", String(x.units)], ["Price (USD)", x.price], ["Proceeds (USD)", money(x.usd)], ["Commission (USD)", money(0)], ["Exchange rate (AUD per USD)", x.fx], ["Net proceeds (AUD)", money(x.cents)]]);
    d.para(`Net proceeds were sent to your nominated bank account ending ${C.numbers.last4_B}. Fictional confirmation.`, { size: 8.5, color: MUTED });
    fs.add({ stream: "RSU-SALE", brand: "etreat", person: p.id, visible_to: vis, delivered_on: x.settle, name: `ETreat-Sale-${x.ref}.pdf`, bytes: d.finish(), family: "etreat-sale-pdf", container: "pdf", origin: "portal", issued_on: x.date });
  }
  const HEAD = ["Participant", "Plan Account", "Security", "Vest Date", "Qty Vested", "Vest FMV (USD)", "AUD per USD", "Taxable Value (AUD)", "Taxing Point", "Status"];
  const history = (name, list, on, held_from) => { if (list.length) fs.add({ stream: "RSU-HIST", brand: "etreat", person: p.id, visible_to: vis, delivered_on: on, name, text: csvLines([HEAD, ...list.map((v) => [p.name, plan.account, plan.code, dmy(v.date), String(v.units), v.price, v.fx, fix(v.cents), dmy(v.date), v.status || "Sold"])]), family: "etreat-benefit-csv", container: "csv", origin: "portal", issued_on: on, held_from }); };
  // what he already held when the story starts: four parcels, taxed when they vested
  const held = s.cast.opening.held_units, cost = s.cast.opening.held_cost_cents, part = Math.floor(held / 4), early = ["2025-01-15", "2025-04-15", "2025-07-15", "2025-10-15"].map((date, i) => { const units = i === 3 ? held - part * 3 : part, cents = i === 3 ? cost - Math.round(cost * part / held) * 3 : Math.round(cost * part / held), fx = (15500 + i * 40) / 10000; return { date, units, cents, fx: fx.toFixed(4), price: (cents / 100 / units / fx).toFixed(3), status: "Held" }; });
  history("ETreat-BenefitHistory-held-parcels.csv", early, "2027-03-03", 3);
  history("ETreat-BenefitHistory-FY2027-to-date.csv", s.rsu.vests.filter((v) => v.fy === 2027 && v.date <= "2027-03-03"), "2027-03-03", 3);
  for (let fy = 2027; fyEnd(fy) < s.end; fy++) history(`ETreat-BenefitHistory-FY${fy}.csv`, s.rsu.vests.filter((v) => v.fy === fy), `${fy}-07-10`);
  history(`ETreat-BenefitHistory-FY${fyOf(s.end)}-to-date.csv`, s.rsu.vests.filter((v) => v.fy === fyOf(s.end) && v.date <= "2036-03-01"), "2036-03-02");
  const hold = (date, units, on, held_from, note) => { const ym = date.slice(0, 7), px = (s.rsu.px[ym] / 1000).toFixed(4), fx = (s.rsu.fx[ym] / 10000).toFixed(4); fs.add({ stream: "RSU-HOLD", brand: "etreat", person: p.id, visible_to: vis, delivered_on: on, name: `ETreat-Holdings-${date}.csv`, text: csvLines([["Plan", "Security", "Units", "Price (USD)", "AUD per USD", "Value (AUD)", "As At"], [plan.account, plan.code, String(units), px, fx, fix(s.value(units, ym)), dmy(date)]]), family: "etreat-holdings-csv", container: "csv", origin: "portal", issued_on: on, held_from, note }); };
  hold("2027-01-31", s.cast.opening.held_units, "2027-02-01", 3, "What he holds when he joins.");
  // the value on the day the law changes. Portal only: nobody downloads it until they know they need it.
  hold("2027-06-30", s.cast.opening.held_units, "2027-07-01", 5, "On the portal from 1 July 2027. Not in anything the household downloaded by chapter 4.");
}

// ---------- the home ----------
function home(fs) {
  const s = fs.sim, C = fs.cast, H = s.home, L = s.loan, N = C.numbers, both = [C.A.id, C.B.id], A = C.A.id, names = `${C.A.first} and ${C.B.first} ${C.surname}`; if (!H) return;
  const conveyancer = `${C.surname.split(/[- ]/)[0]} Conveyancing Pty Ltd`, sd = new Doc({ brand: { name: conveyancer }, title: "Settlement statement", deflate: fs.deflate, style: "plain" });
  sd.h1(`Settlement statement, ${H.address}`);
  sd.kv([["Matter", "TC-28-0128"], ["Purchaser", names], ["Settlement date", fmtDate(H.on)], ["Property reference", "HOME"]], 2);
  sd.h2("Statement of adjustments");
  sd.table([{ label: "Item", w: 340 }, { label: "Amount", w: 100, align: "right" }], [["Purchase price", money(H.price)], ["Land transfer duty", money(H.duty)], ["Legal and conveyancing", money(H.legal)], ["Adjustments, council and water", money(H.adjustments)], ["Loan funds drawn at settlement", money(-H.loan)], ["Cash paid by purchaser", money(H.cash)]]);
  sd.para(`Loan drawn from Harbour Bank, loan number ${L.number}. Prepared for the purchaser's records; a fictional document.`, { size: 8.5, color: MUTED });
  fs.add({ stream: "SETTLEMENT", brand: "conveyancer", person: A, visible_to: both, delivered_on: addDays(H.on, 6), name: "Settlement-Statement.pdf", bytes: sd.finish(), family: "settlement-pdf", container: "pdf", origin: "email", where: "email", issued_on: H.on });
  for (const y of L.rows) {
    const rows = L.lines.filter((l) => ymOf(l.date) === y.ym); if (!rows.length) continue;
    const made = bankFile(C.institutions.loan.spec, { number: L.number, rows: rows.map((r) => ({ ...r })), opening: -y.opening, from: `${y.ym}-01`, to: monthEnd(y.ym) });
    fs.add({ stream: "LOAN", brand: "westpaw", person: A, visible_to: both, delivered_on: `${nextMonth(y.ym)}-03`, name: `Westpaw-Loan-${y.ym}.csv`, text: made.text, family: C.institutions.loan.spec.family || "life-variant-csv", container: "csv", origin: "portal", issued_on: monthEnd(y.ym), account: "LN-HOME", shape: "loan" });
  }
  for (let fy = fyOf(H.on); fy <= fyOf(s.end); fy++) {
    const r = L.rows.filter((x) => fyOf(`${x.ym}-01`) === fy); if (!r.length) continue;
    const from = `${r[0].ym}-01`, to = monthEnd(r[r.length - 1].ym), interest = r.reduce((t, x) => t + x.interest, 0), repaid = r.reduce((t, x) => t + x.repaid, 0), last = r[r.length - 1];
    const d = new Doc({ brand: WESTPAW, title: "Loan statement", kicker: period(from, to), deflate: fs.deflate });
    d.h1("Home loan");
    d.kv([["Loan number", L.number], ["Borrowers", names], ["Interest rate", `${last.rate.toFixed(2)}% p.a. variable`], ["Repayment type", "Principal and interest"], ["Opening balance", aud(r[0].opening)], ["Closing balance", aud(last.closing)], ["Interest charged", aud(interest)], ["Repayments received", aud(repaid)]], 4);
    d.h2("Monthly summary");
    d.table([{ label: "Month", w: 80 }, { label: "Rate", w: 50, align: "right" }, { label: "Opening", w: 85, align: "right" }, { label: "Interest charged", w: 80, align: "right" }, { label: "Repayments", w: 80, align: "right" }, { label: "Closing", w: 85, align: "right" }, { label: "Offset", w: 75, align: "right" }], r.map((x) => [fmtMonth(x.ym), `${x.rate.toFixed(2)}%`, money(x.opening), money(x.interest), money(x.repaid), money(x.closing), money(x.offset)]), { foot: ["Total", "", "", money(interest), money(repaid), money(last.closing), ""] });
    d.para("Interest is calculated daily on the balance less any linked offset and charged on the last day of the month. The rate column shows the variable rate that applied at the start of each month.", { color: MUTED, size: 8.5 });
    fs.add({ stream: "LOAN-STMT", brand: "westpaw", person: A, visible_to: both, delivered_on: addDays(to, 5), name: `Westpaw-LoanStatement-FY${fy}.pdf`, bytes: d.finish(), family: "westpaw-loan-statement-pdf", container: "pdf", origin: "portal", issued_on: to, account: "LN-HOME" });
  }
  for (const n of s.rate.notices) {
    const subject = n.correction ? `Correction: your ${n.name} interest rate` : `Your ${n.name} interest rate is changing`;
    const text = [`Dear ${C.A.first} and ${C.B.first},`, "", n.correction ? "Our earlier notice gave the wrong date. The new rate took effect earlier than we said." : "Your variable interest rate is changing.", "", `Loan number: ${n.number}`, `Old rate: ${n.old.toFixed(2)}% p.a.`, `New rate: ${n.rate.toFixed(2)}% p.a.`, `Effective date: ${fmtDate(n.effective_on)}`, `Notice date: ${fmtDate(n.notified_on)}`, "", "Interest is calculated daily and charged on the last day of each month.", "", "Westpaw, a fictional lender."].join("\n");
    const html = `<html><body><p>Dear ${C.A.first} and ${C.B.first},</p><table>${row(["Loan number", n.number])}${row(["Old rate", `${n.old.toFixed(2)}% p.a.`])}${row(["New rate", `${n.rate.toFixed(2)}% p.a.`])}${row(["Effective date", fmtDate(n.effective_on)])}${row(["Notice date", fmtDate(n.notified_on)])}</table><p>${htmlEsc("Westpaw, a fictional lender.")}</p></body></html>`;
    fs.add({ stream: "RATE-LOAN", brand: "westpaw", person: A, visible_to: both, delivered_on: n.notified_on, name: `Rate-notice-${n.notified_on}.eml`, text: eml({ from: "Westpaw Home Loans <notices@westpaw.example>", to: `${names} <${C.shared_mail}>`, subject, date: n.notified_on, id: `rate-${n.effective_on}-${n.notified_on}`, text, html }), family: "westpaw-rate-notice-eml", container: "eml", origin: "email", where: "email", issued_on: n.notified_on });
  }
  for (const v of s.valuations) {
    const rows = [["Subject", "As At", "Estimate", "Method", "Provider"], [H.address, dmy(v.end), fix(v.home), "appraisal", "PawPrice Estimates"], ["Family car", dmy(v.end), fix(v.car), "estimate", "PawPrice Estimates"]];
    fs.add({ stream: "VALUE", brand: "pawprice", person: A, visible_to: both, delivered_on: addDays(v.end, 2), name: `PawPrice-Estimates-${v.ym}.csv`, text: csvLines(rows), family: "pawprice-estimates-csv", container: "csv", origin: "portal", issued_on: addDays(v.end, 2) });
  }
}

// ---------- bills, policies, receipts, childcare ----------
function bills(fs) {
  const s = fs.sim, C = fs.cast, both = [C.A.id, C.B.id], A = C.A.id, names = `${C.A.first} and ${C.B.first} ${C.surname}`, H = s.home;
  for (const x of s.bills) {
    const situs = H && x.bill_date >= H.on ? H.address : C.addresses.rental, base = { stream: x.stream, person: A, visible_to: both, delivered_on: x.bill_date, issued_on: x.bill_date };
    if (x.kind === "rates") {
      const d = new Doc({ brand: { name: x.issuer, tagline: "Rates and charges, one paw at a time.", color: "#365314" }, title: "Rates notice", kicker: `Instalment notice ${x.ref}`, deflate: fs.deflate });
      d.h1("Your rates instalment");
      d.kv([["Assessment number", x.account], ["Ratepayer", names], ["Issue date", fmtDate(x.bill_date)], ["Due date", fmtDate(x.due_on)], ["Rating period", `${fmtDate(x.from)} to ${fmtDate(x.to)}`], ["Instalment due", aud(x.cents)]], 3);
      d.para(`Property: ${situs}. Pay by the due date. A fictional council.`, { size: 9 });
      fs.add({ ...base, brand: "ratepurr", name: `Rates-${x.bill_date}.pdf`, bytes: d.finish(), family: "council-rates-pdf", container: "pdf", origin: "portal" });
    } else if (x.kind === "water") {
      const d = new Doc({ brand: { name: x.issuer }, title: "Water bill", deflate: fs.deflate, style: "plain" }), L = M, R = 316; let y = d.y;
      d.text(L, y, "Your water bill", { size: 16, bold: true }); d.text(R, y, "Charges", { size: 12, bold: true }); y -= 24;
      const usage = Math.round(x.cents * 0.42), service = x.cents - usage;
      const left = [["Account", x.account], ["Customer", names], ["Bill date", fmtDate(x.bill_date)], ["Due date", fmtDate(x.due_on)], ["Period from", fmtDate(x.from)], ["Period to", fmtDate(x.to)]], right = [["Water usage", money(usage)], ["Service charges", money(service)], ["Concession", money(0)], ["Amount due", money(x.cents)]];
      for (let i = 0; i < left.length; i++) { d.text(L, y, left[i][0], { size: 9, color: MUTED }); d.text(L + 84, y, left[i][1], { size: 9.5 }); if (right[i]) { d.text(R, y, right[i][0], { size: 9, color: MUTED }); d.text(R + 200, y, right[i][1], { size: 9.5, align: "right", bold: i === 3 }); } y -= 16; }
      d.y = y - 8;
      d.para(`Supply address: ${situs}. A fictional water authority.`, { size: 9 });
      fs.add({ ...base, brand: "waterbowl", name: `Water-${x.bill_date}.pdf`, bytes: d.finish(), family: "water-bill-pdf", container: "pdf", origin: "portal" });
    } else if (x.kind === "power") {
      const gst = Math.round(x.cents / 11), first = C.A.first, text = [`Hi ${first},`, "", "Your electricity bill is ready.", "", `Account: ${x.account}`, `Bill date: ${fmtDate(x.bill_date)}`, `Due date: ${fmtDate(x.due_on)}`, `Supply from: ${fmtDate(x.from)}`, `Supply to: ${fmtDate(x.to)}`, `Usage: ${Math.round(x.cents / 31)} kWh`, `GST included: ${money(gst)}`, `Amount due: ${money(x.cents)}`, "", `${x.issuer}, a fictional retailer.`].join("\n");
      const html = `<html><body><p>Your electricity bill is ready.</p><table>${row(["Account", x.account])}${row(["Amount due", money(x.cents)])}${row(["Due date", fmtDate(x.due_on)])}</table></body></html>`;
      fs.add({ ...base, brand: "meowtility", name: `Electricity-${x.bill_date}.eml`, text: eml({ from: `${x.issuer} <bills@redpaw.example>`, to: `${C.A.name} <${C.shared_mail}>`, subject: `Your electricity bill for ${fmtMonth(x.to.slice(0, 7))}`, date: x.bill_date, id: `elec-${x.bill_date}`, text, html }), family: "energy-bill-eml", container: "eml", origin: "email", where: "email" });
    } else if (x.kind === "gas") {
      const gst = Math.round(x.cents / 11), body = `<h1>Gas bill</h1><table>${row(["Retailer", x.issuer])}${row(["Account", x.account])}${row(["Supply address", situs])}${row(["Bill date", fmtDate(x.bill_date)])}${row(["Due date", fmtDate(x.due_on)])}${row(["Period from", fmtDate(x.from)])}${row(["Period to", fmtDate(x.to)])}${row(["GST included", money(gst)])}${row(["Amount due", money(x.cents)])}</table>`;
      fs.add({ ...base, brand: "meowtility", name: `Gas-${x.bill_date}.html`, text: page(`Origpurr Gas bill ${fmtDate(x.bill_date)}`, body), family: "gas-bill-html", container: "html", origin: "portal" });
    } else if (x.kind === "rego") {
      const d = new Doc({ brand: { name: "VicPaws", tagline: "Roads, rego and the odd dog.", color: "#1d4ed8" }, title: "Vehicle registration", kicker: `Notice ${x.ref}`, deflate: fs.deflate });
      d.h1("Vehicle registration renewal");
      d.kv([["Registration number", x.account], ["Vehicle", x.vehicle], ["Registered operator", x.operator], ["Issue date", fmtDate(x.bill_date)], ["Due date", fmtDate(x.due_on)], ["Registered until", fmtDate(x.until)], ["Amount payable", aud(x.cents)], ["TAC charge included", "Yes"]], 3);
      d.para("Fictional notice from a parody road authority.", { size: 8.5, color: MUTED });
      fs.add({ ...base, brand: "vicpaws", name: `VicPaws-Rego-${x.bill_date.slice(0, 4)}.pdf`, bytes: d.finish(), family: "vicpaws-rego-pdf", container: "pdf", origin: "portal" });
    }
  }
  for (const p of s.policies) {
    const cover = p.id === "POL-HOME" ? [["Building sum insured", aud(p.sum)], ["Contents sum insured", aud(Math.round(p.sum * 0.14))], ["Excess", aud(p.excess)]] : [["Agreed value", aud(p.sum)], ["Excess", aud(p.excess)]];
    const per = period(p.from, p.to), r = new Doc({ brand: SURE, title: "Renewal notice", kicker: `Policy period ${per}`, deflate: fs.deflate });
    r.h1(`${p.kind} renewal`);
    r.kv([["Policy number", p.number], ["Insured", names], ["Situation", p.situation], ["Period of insurance", `${fmtDate(p.from)} to ${fmtDate(p.to)}, 4pm`], ["Total premium", aud(p.premium)], ["Payment due", fmtDate(p.from)], ["Status", `Paid ${fmtDate(p.paid_on)} from Joint account`], ["Premium includes", "GST, stamp duty and levies"]], 4);
    r.h2("Your cover");
    r.table([{ label: "Cover", w: 260 }, { label: "Sum insured or limit", w: 140, align: "right" }], cover);
    r.para("Your policy renews automatically when the premium is paid by the due date. Read the Product Disclosure Statement for what is and is not covered. This notice was generated for a fictional household; no policy exists.", { color: MUTED, size: 8.5 });
    const tag = p.id === "POL-HOME" ? "Home" : "Car";
    fs.add({ stream: "POLICY", brand: "purrsure", person: A, visible_to: both, delivered_on: p.from, name: `Purrsure-RenewalNotice-${tag}-${p.from.slice(0, 4)}.pdf`, bytes: r.finish(), family: "purrsure-renewal-pdf", container: "pdf", origin: "portal", issued_on: p.from });
    const c = new Doc({ brand: SURE, title: "Certificate of currency", kicker: `Issued ${fmtDate(p.from)}`, deflate: fs.deflate });
    c.h1("Certificate of currency");
    c.kv([["Policy number", p.number], ["Policy", p.kind], ["Insured", names], ["Situation", p.situation], ["Period of insurance", `${fmtDate(p.from)} to ${fmtDate(p.to)}`], ["Premium paid", aud(p.premium)]], 3);
    c.h2("Cover in force");
    c.table([{ label: "Cover", w: 260 }, { label: "Sum insured or limit", w: 140, align: "right" }], cover);
    c.para("This certificate confirms that the policy described is current for the period shown. It is a summary only and does not alter the policy. Fictional, for a demo.", { color: MUTED, size: 8.5 });
    fs.add({ stream: "POLICY", brand: "purrsure", person: A, visible_to: both, delivered_on: addDays(p.from, 1), name: `Purrsure-CertificateOfCurrency-${tag}-${p.from.slice(0, 4)}.pdf`, bytes: c.finish(), family: "purrsure-certificate-pdf", container: "pdf", origin: "portal", issued_on: p.from });
  }
  for (const t of s.receipts) {
    const gst = Math.round(t.cents / 11), base = { stream: "RECEIPTS", brand: "family", person: A, visible_to: both, delivered_on: t.date, issued_on: t.date };
    if (t.via === "eml") {
      const text = [`Thanks for shopping at ${t.merchant}.`, "", `Order date: ${fmtDate(t.date)}`, `Item: ${t.name}`, `Product type: ${t.kind}`, `Serial number: ${t.serial}`, `Warranty until: ${fmtDate(t.warranty)}`, `Paid with: ${t.pay}`, `GST included: ${money(gst)}`, `Total: ${money(t.cents)}`, "", "A fictional receipt from a parody store."].join("\n");
      fs.add({ ...base, name: `Receipt-${t.name.replace(/\s/g, "-")}.eml`, text: eml({ from: `${t.merchant} <orders@store.example>`, to: `${C.A.name} <${C.shared_mail}>`, subject: `Your ${t.merchant} receipt`, date: t.date, id: `rcpt-${t.serial}`, text, html: `<html><body><h2>${t.merchant}</h2><table>${row(["Item", t.name])}${row(["Total", money(t.cents)])}</table></body></html>` }), family: "receipt-eml", container: "eml", origin: "email", where: "email" });
    } else {
      const d = new Doc({ brand: { name: t.merchant }, title: "Tax invoice", deflate: fs.deflate, style: "plain" });
      d.h1("Tax invoice");
      d.kv([["Merchant", t.merchant], ["Invoice date", fmtDate(t.date)], ["Payment", t.pay], ["Product type", t.kind], ["Serial number", t.serial], ["Warranty until", fmtDate(t.warranty)]], 3);
      d.table([{ label: "Item", w: 300 }, { label: "Qty", w: 40, align: "right" }, { label: "Amount", w: 100, align: "right" }], [[t.name, "1", money(t.cents)]]);
      d.table([{ label: "Summary", w: 340 }, { label: "Amount", w: 100, align: "right" }], [["GST included", money(gst)], ["Total paid", money(t.cents)]]);
      d.para("A fictional invoice from a parody store.", { size: 8.5, color: MUTED });
      fs.add({ ...base, name: `Receipt-${t.name.replace(/\s/g, "-")}.pdf`, bytes: d.finish(), family: "receipt-pdf", container: "pdf", origin: "drive", where: "drive" });
    }
    s.note("T5-WARRANTY", { name: t.name, warranty_until: t.warranty, cents: t.cents, via: t.via });
  }
  for (const x of s.childcare) {
    const body = `<h1>Statement of account</h1><p>Provider: Kittenhood Early Learning</p><p>Child: ${htmlEsc(x.child)}</p><table>${row(["Item", "Amount"], "th")}${row(["Period start", fmtDate(`${x.ym}-01`)])}${row(["Period end", fmtDate(monthEnd(x.ym))])}${row(["Sessions", String(x.days)])}${row(["Daily fee", money(x.daily)])}${row(["Gross fee", money(x.gross)])}${row(["Child Care Subsidy", money(-x.subsidy)])}${row(["Gap you pay", money(x.gap)])}</table>`;
    fs.add({ stream: "CHILDCARE", brand: "kittenhood", person: A, visible_to: both, delivered_on: `${nextMonth(x.ym)}-03`, name: `Kittenhood-Statement-${x.child.split(" ")[0]}-${x.ym}.html`, text: page(`Kittenhood statement ${fmtMonth(x.ym)}`, body), family: "kittenhood-statement-html", container: "html", origin: "portal", issued_on: `${nextMonth(x.ym)}-03` });
  }
}

// ---------- later chapters ----------
function later(fs) {
  const s = fs.sim, C = fs.cast, A = s.people.A, k = s.kids[0], job = s.job, biz = s.biz, spec = C.institutions.loan.spec;
  for (const ym of monthRange(biz.lines[0].date.slice(0, 7), "2037-09")) {
    const rows = fs.rows("ACC-BIZ", `${ym}-01`, monthEnd(ym)); if (!rows.length) continue;
    const opening = fs.openingOn("ACC-BIZ", `${ym}-01`), made = bankFile(spec, { number: "732-998 120 447", rows, opening, from: `${ym}-01`, to: monthEnd(ym), closing: 0 });
    fs.add({ stream: "BIZ-A", brand: "westpaw", person: A.id, visible_to: [A.id], delivered_on: `${nextMonth(ym)}-02`, name: `Business-${ym}.csv`, text: made.text, family: spec.family || "life-variant-csv", container: "csv", origin: "portal", issued_on: monthEnd(ym), account: "ACC-BIZ", window: { from: `${ym}-01`, to: monthEnd(ym) }, shape: "loan", simplified: true });
  }
  for (const q of biz.bas.filter(Boolean)) {
    const d = new Doc({ brand: GOV, title: "Business activity statement", kicker: period(q.from, q.to), deflate: fs.deflate });
    d.h1(`BAS for ${A.name}`);
    d.kv([["Period start", fmtDate(q.from)], ["Period end", fmtDate(q.to)], ["G1 Total sales", money(q.sales)], ["G3 GST-free sales", money(q.free)], ["1A GST on sales", money(q.gst)], ["1B GST on purchases", money(q.paid_gst)]], 3);
    d.para("A parody of a government form. Simplified stream. Fictional, and not advice.", { size: 8.5, color: MUTED });
    fs.add({ stream: "BAS-A", brand: "myguv", person: A.id, visible_to: [A.id], delivered_on: addDays(q.to, 28), name: `BAS-Q${q.q}-${q.from.slice(0, 4)}.pdf`, bytes: d.finish(), family: "life-bas-pdf", container: "pdf", origin: "portal", issued_on: addDays(q.to, 28), simplified: true });
  }
  s.note("T7-GST-FREE", { quarters: biz.bas.filter(Boolean).map((q) => ({ from: q.from, g1_cents: q.sales, gst_free_cents: q.free, gst_cents: q.gst })) });
  const emp = C.later.teen.employer, running = {};
  for (const x of job.pays) {
    const y = running[x.fy] = running[x.fy] || { gross: 0, tax: 0, sup: 0, net: 0, packaging: 0 }; y.gross += x.gross; y.tax += x.tax; y.sup += x.sup; y.net += x.net;
    fs.add({ stream: "PAY-C1", brand: "pawroll", person: k.id, visible_to: [k.id], delivered_on: x.date, name: `Pawroll-Payslip-${x.date}.pdf`, bytes: payslipDoc(fs, { ...x, employer: emp, weekly: true, packaging: 0 }, k.name, y, "5502"), family: "pawroll-payslip-pdf", container: "pdf", origin: "portal", issued_on: x.date, simplified: true });
  }
  for (const ym of monthRange(job.pays[0].date.slice(0, 7), C.later.teen.to.slice(0, 7))) {
    const rows = fs.rows("ACC-C1-EVERY", `${ym}-01`, monthEnd(ym)); if (!rows.length) continue;
    const opening = fs.openingOn("ACC-C1-EVERY", `${ym}-01`), inst = C.institutions.A_save, made = bankFile(inst.spec, { number: C.numbers.child_every, rows, opening, from: `${ym}-01`, to: monthEnd(ym), closing: 0 });
    fs.add({ stream: "EVERY-C1", brand: inst.brand, person: k.id, visible_to: [k.id], delivered_on: `${nextMonth(ym)}-02`, name: `Transactions-${ym}.csv`, text: made.text, family: inst.spec.family || inst.spec.key || "life-variant-csv", container: "csv", origin: "portal", issued_on: monthEnd(ym), account: "ACC-C1-EVERY", window: { from: `${ym}-01`, to: monthEnd(ym) }, shape: "A_save", simplified: true });
  }
}

function wills(fs) {
  const s = fs.sim, C = fs.cast; if (!s.wills) return;
  for (const key of ["A", "B"]) {
    const p = s.people[key], d = new Doc({ brand: { name: "Merri Legal Wills" }, title: "Last will", deflate: fs.deflate, style: "plain" });
    d.h1(`Last will of ${p.name}`);
    d.para(`Signed ${fmtDate(s.wills)} at ${C.addresses.home}. Everything to my partner, then to our children in equal shares. Names an executor. This document has no money in it. Fictional.`, { size: 10 });
    fs.add({ stream: "WILLS", brand: "family", person: p.id, visible_to: [C.A.id, C.B.id], delivered_on: s.wills, name: `Will-${p.first}.pdf`, bytes: d.finish(), family: "life-will-pdf", container: "pdf", origin: "drive", where: "drive", issued_on: s.wills });
  }
  s.note("T5-WILL-NO-KIND", { signed: s.wills });
}

function renderAll(sim) {
  FOOT = sim.cast.variant ? (name) => `Fictional document from a Kitty test household. ${name} is a parody; not a real institution. Nothing here is advice.` : null;
  const fs = new Files(sim);
  superFiles(fs); payroll(fs); banks(fs); tax(fs); rsu(fs); home(fs); bills(fs); wills(fs); later(fs);
  fs.list.sort((a, b) => (a.path < b.path ? -1 : 1));
  return fs;
}

module.exports = { renderAll };
