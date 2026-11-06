/* Two funds, two shapes. Purrannuation: a monthly CSV with a header change in July 2023 and an annual PDF. HESTAbby: a quarterly app export as JSON and a
   half-yearly PDF. Contributions come from the payslips' super field and arrive with a lag: quarterly up to 28 days after quarter end, within days
   of payday from 1 July 2026. From 2025-06 each month-end lands on the sheet's valuation, through earnings. */
"use strict";
const { toCents, money, aud, fix, dmy, addDays, weekday, monthRange, monthEnd, nextMonth, prevMonth, fmtDate, fyOf, fyStart, fyEnd, csvLines, pad } = require("../lib/util");
const { Doc, MUTED, period } = require("../lib/pdf");
const { stream } = require("./setup");

const FUND = {
  "SUPER-J": { person: "Jordan", party: "JORDAN", name: "Purrannuation", member: "PN-884213", fee: [[2019, 950], [2022, 1050], [2024, 1195]], ins: [[2019, 4820], [2022, 5310], [2025, 6200]], lag: [19, 26], color: "#1f6f8b", tag: "Nine lives, one retirement." },
  "SUPER-M": { person: "Mia", party: "MIA", name: "HESTAbby", member: "HB-2210-7744", fee: [[2019, 800], [2023, 925]], ins: [[2019, 2210], [2023, 2480], [2025, 3015]], lag: [21, 27], color: "#a0522d", tag: "Super for the tabby at heart." },
};
const at = (tbl, y) => { let v = tbl[0][1]; for (const [k, x] of tbl) if (y >= k) v = x; return v; };
const quarterEnd = (d) => { const [y, m] = d.split("-").map(Number); const q = Math.ceil(m / 3) * 3; return monthEnd(`${y}-${pad(q)}`); };
const weekdayOn = (d) => { let x = d; while ([0, 6].includes(weekday(x))) x = addDays(x, -1); return x; };

// a return path: calm, one crash, one bad year
function returns(rng, ym) {
  if (ym === "2020-02") return -0.031; if (ym === "2020-03") return -0.082; if (ym === "2020-04") return 0.036;
  const base = ym >= "2022-01" && ym <= "2022-09" ? -0.003 : 0.0068;
  return base + rng.range(-0.012, 0.012);
}

function model(w, id) {
  const f = FUND[id], rng = w.rng(`super:${id}`), lines = [];
  const pays = [...w.preHistory[f.person], ...w.pays.filter((p) => p.person === f.person), ...(f.person === "Mia" ? w.agencyPays.filter((p) => p.sup) : [])];
  const add = (date, type, desc, cents) => lines.push({ date, type, desc, cents });
  // quarterly to the June 2026 quarter, then payday super
  const byQ = {}; for (const p of pays) if (p.date < "2026-07-01" && p.date >= "2019-01-01") { const k = `${quarterEnd(p.date)}|${p.employer}`; (byQ[k] = byQ[k] || []).push(p); }
  const contributions = [];
  for (const k of Object.keys(byQ).sort()) {
    const [q, employer] = k.split("|"), total = byQ[k].reduce((s, p) => s + p.sup, 0); if (!total) continue;
    const date = weekdayOn(addDays(q, rng.int(f.lag[0], f.lag[1])));
    add(date, "employer", `Employer contribution, ${employer}`, total); add(date, "contributions_tax", "Contributions tax", -Math.round(total * 0.15));
    contributions.push({ fund: id, date, quarter_end: q, employer, cents: total, pays: byQ[k].length });
  }
  for (const p of pays) if (p.date >= "2026-07-01" && p.sup) {
    const date = addDays(p.date, rng.int(2, 6)), d2 = [0, 6].includes(weekday(date)) ? addDays(date, 2) : date;
    add(d2, "employer", `Employer contribution, ${p.employer}`, p.sup); add(d2, "contributions_tax", "Contributions tax", -Math.round(p.sup * 0.15));
    contributions.push({ fund: id, date: d2, pay_date: p.date, employer: p.employer, cents: p.sup, pays: 1 });
  }
  if (id === "SUPER-J") add("2021-05-18", "rollover_in", "Rollover in from Whisker Super, member 40771", 821463);
  const months = monthRange("2019-03", "2027-03"), r = {};
  for (const ym of months) {
    const y = Number(ym.slice(0, 4));
    add(`${ym}-01`, "fee", "Administration fee", -at(f.fee, y)); add(`${ym}-01`, "insurance", "Insurance premium, death and TPD", -at(f.ins, y));
    r[ym] = returns(rng, ym);
  }
  const flows = {}; for (const l of lines) flows[l.date.slice(0, 7)] = (flows[l.date.slice(0, 7)] || 0) + l.cents;
  const target = {}; for (const b of w.sheet.balances) if (b.account_id === id) target[b.month_end.slice(0, 7)] = toCents(b.balance);
  const closing = {}, earnings = {};
  // back from June 2025
  let c = target["2025-06"];
  for (const ym of months.slice().reverse()) {
    if (ym > "2025-06") continue;
    closing[ym] = c;
    const flow = flows[ym] || 0, open = Math.round((c - flow) / (1 + r[ym]));
    earnings[ym] = c - flow - open; c = open;
  }
  const opening = c;
  // forward to the sheet's last month, then on
  let prev = closing["2025-06"];
  for (const ym of months) {
    if (ym <= "2025-06") continue;
    const flow = flows[ym] || 0;
    if (target[ym] != null) { earnings[ym] = target[ym] - prev - flow; closing[ym] = target[ym]; } else { earnings[ym] = Math.round(prev * r[ym]); closing[ym] = prev + flow + earnings[ym]; }
    prev = closing[ym];
  }
  for (const ym of months) add(monthEnd(ym), "earnings", "Investment earnings", earnings[ym]);
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ORDER[a.type] - ORDER[b.type]));
  let bal = opening; lines.forEach((l) => { bal += l.cents; l.bal = bal; });
  return { lines, opening, closing, contributions };
}
const ORDER = { rollover_in: 0, employer: 1, contributions_tax: 2, fee: 3, insurance: 4, earnings: 5 };

const V1 = { employer: "Employer Contribution", contributions_tax: "Contributions Tax", fee: "Administration Fee", insurance: "Insurance Premium", earnings: "Investment Earnings", rollover_in: "Rollover In" };
const V2 = { employer: "CONTRIB-SG", contributions_tax: "TAX-15", fee: "FEE-ADMIN", insurance: "INS-DTPD", earnings: "EARNINGS", rollover_in: "ROLL-IN" };

function summary(lines, from, to) {
  const s = { employer: 0, rollover_in: 0, contributions_tax: 0, fee: 0, insurance: 0, earnings: 0 };
  for (const l of lines) if (l.date >= from && l.date <= to) s[l.type] += l.cents;
  return s;
}

function statementDoc(w, id, m, from, to, title, style) {
  const f = FUND[id], s = summary(m.lines, from, to), before = m.lines.filter((l) => l.date < from), opening = before.length ? before[before.length - 1].bal : m.opening;
  const inPeriod = m.lines.filter((l) => l.date <= to), closing = inPeriod[inPeriod.length - 1].bal;
  const d = new Doc({ brand: { name: f.name, tagline: f.tag, color: f.color }, title, kicker: period(from, to), deflate: w.deflate, style });
  d.h1(`${title} for ${f.person} Davies`);
  d.kv([["Member number", f.member], ["Member", `${f.person} Davies`], ["Statement period", `${fmtDate(from)} to ${fmtDate(to)}`], ["Opening balance", aud(opening)], ["Closing balance", aud(closing)], ["Investment option", "Balanced growth"]], 3);
  d.h2("Your account summary");
  const rows = [["Opening balance", money(opening)], ["Employer contributions", money(s.employer)]];
  if (s.rollover_in) rows.push(["Rollovers in", money(s.rollover_in)]);
  rows.push(["Investment earnings", money(s.earnings)], ["Contributions tax", money(-s.contributions_tax)], ["Administration fees", money(-s.fee)], ["Insurance premiums", money(-s.insurance)], ["Closing balance", money(closing)]);
  d.table([{ label: "Item", w: 320 }, { label: "Amount", w: 120, align: "right" }], rows);
  d.para("Employer contributions are reported when the fund received them. Fictional fund, fictional member, nothing here is advice.", { size: 8.5, color: MUTED });
  return d.finish();
}

function purrCsv(rows, ym) {
  if (ym < "2023-07") return csvLines([["Date", "Transaction Type", "Description", "Amount", "Balance"], ...rows.map((l) => [dmy(l.date), V1[l.type], l.desc, fix(l.cents), fix(l.bal)])]);
  return csvLines([["Effective Date", "Category", "Narrative", "Amount (AUD)", "Running Balance", "Reference"], ...rows.map((l, i) => [l.date, V2[l.type], l.desc, fix(l.cents), fix(l.bal), `PN${l.date.replace(/-/g, "")}${pad(i + 1, 3)}`])]);
}

const CODE = { employer: "SG", contributions_tax: "TAX", fee: "FEE", insurance: "INS", earnings: "EARN", rollover_in: "ROLLIN" };
const num = (c) => Number(fix(c));

function run(w) {
  const S = w.setup;
  S.party.push({ party_id: "PURRANNUATION", kind: "organisation", name: "Purrannuation" }, { party_id: "HESTABBY", kind: "organisation", name: "HESTAbby" });
  const truth = { months: {}, contributions: [], by_type_fy: {} };
  for (const id of Object.keys(FUND)) {
    const f = FUND[id], m = model(w, id);
    S.account.push({ account_id: id, name: `Superannuation, ${f.person}`, class: "asset", type: "super", reporting_group: "super", currency: "AUD", institution_party_id: f.name === "HESTAbby" ? "HESTABBY" : "PURRANNUATION", opened_on: "2019-03-01", in_scope: true, fidelity: "ledger", opening_balance_cents: m.opening, opening_date: "2019-03-01" });
    ["legal", "beneficial", "tax"].forEach((basis) => S.ownership.push({ subject_type: "account", subject_id: id, party_id: f.party, basis, share_bps: 10000, valid_from: "2019-03-01", recorded_at: "2019-03-01T00:00:00Z" }));
    S.contract.push({ contract_id: `C-${id}`, kind: "super_fund", name: f.name, counterparty_party_id: f.name === "HESTAbby" ? "HESTABBY" : "PURRANNUATION", holder_party_id: f.party, account_id: id, started_on: "2019-03-01" });
    w.linkRow("contributes_to", "contract", f.person === "Jordan" ? "C-EMP-J" : "C-EMP-M", "account", id, "2019-03-01");
    w.alias("account", id, "member_number", f.member, "2019-03-01"); w.alias("account", id, "name", id, "2019-03-01");
    stream(w, id, `${f.name} activity`, "transactions", "account", id, f.person === "Jordan" ? "monthly" : "quarterly", "2019-03-01", { issuer_party_id: f.name === "HESTAbby" ? "HESTABBY" : "PURRANNUATION", grace_days: 14 });
    stream(w, `${id}-STMT`, `${f.name} member statement`, "super_statement", "account", id, f.person === "Jordan" ? "yearly" : "half_yearly", "2019-07-01", { issuer_party_id: f.name === "HESTAbby" ? "HESTABBY" : "PURRANNUATION", grace_days: 45 });
    truth.months[id] = monthRange("2019-03", "2027-03").map((ym) => ({ month: ym, closing_cents: m.closing[ym] }));
    truth.opening = truth.opening || {}; truth.opening[id] = m.opening;
    truth.contributions.push(...m.contributions);
    const types = truth.by_type_fy[id] = {};
    for (const l of m.lines) { const fy = `FY${fyOf(l.date)}`, t = types[fy] = types[fy] || {}; t[l.type] = (t[l.type] || 0) + l.cents; }
    if (id === "SUPER-J") {
      for (const ym of monthRange("2019-03", "2027-03")) {
        const rows = m.lines.filter((l) => l.date.startsWith(ym));
        const fam = ym < "2023-07" ? "purrannuation-csv-v1" : "purrannuation-csv-v2";
        w.file({ stream_id: id, download_date: `${nextMonth(ym)}-05`, name: `Purrannuation-Activity-${ym}.csv`, text: purrCsv(rows, ym), family: fam, container: "csv", expect: { super_line: rows.length, statement: 1 }, origin: "portal", issued_on: monthEnd(ym) });
      }
      for (let fy = 2020; fy <= 2026; fy++) w.file({ stream_id: `${id}-STMT`, download_date: `${fy}-08-20`, name: `Purrannuation-Annual-Statement-FY${fy}.pdf`, bytes: statementDoc(w, id, m, fyStart(fy), fyEnd(fy), "Annual member statement", "band"), family: "fund-statement-pdf", container: "pdf", expect: { super_statement: 1 }, origin: "portal", issued_on: `${fy}-08-20` });
    } else {
      const qs = []; let from = "2019-03-01";
      for (const ym of monthRange("2019-03", "2027-03")) if (["03", "06", "09", "12"].includes(ym.slice(5))) { qs.push([from, monthEnd(ym)]); from = `${nextMonth(ym)}-01`; }
      for (const [a, b] of qs) {
        const rows = m.lines.filter((l) => l.date >= a && l.date <= b), before = m.lines.filter((l) => l.date < a), opening = before.length ? before[before.length - 1].bal : m.opening;
        const doc = { schema: "hestabby.app/2", member: { number: f.member, name: "Mia Davies" }, period: { from: a, to: b }, balance: { opening: num(opening), closing: num(rows[rows.length - 1].bal) }, transactions: rows.map((l) => ({ date: l.date, code: CODE[l.type], label: l.desc, amount: num(l.cents), balanceAfter: num(l.bal) })) };
        w.file({ stream_id: id, download_date: addDays(b, 6), name: `HESTAbby-app-export-${b}.json`, text: `${JSON.stringify(doc, null, 2)}\n`, family: "hestabby-app-json", container: "json", expect: { super_line: rows.length, super_statement: 1 }, origin: "connector", issued_on: addDays(b, 6) });
      }
      for (let y = 2019; y <= 2026; y++) for (const [a, b] of [[`${y}-01-01`, `${y}-06-30`], [`${y}-07-01`, `${y}-12-31`]]) {
        if (a < "2019-03-01" || b > "2026-12-31") continue;
        w.file({ stream_id: `${id}-STMT`, download_date: addDays(b, 45), name: `HESTAbby-Statement-${b}.pdf`, bytes: statementDoc(w, id, m, a, b, "Half-yearly statement", "plain"), family: "fund-statement-plain-pdf", container: "pdf", expect: { super_statement: 1 }, origin: "portal", issued_on: addDays(b, 45) });
      }
    }
  }
  w.truth.super = truth;
}

module.exports = { run, FUND };
