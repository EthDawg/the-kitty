/* What each person would tell a Kitty, and when. Every row carries recorded_at: the chapter it was told in, so a harness rebuilding at a chapter filters setup the way it filters files.
   Setup is what a person answers at onboarding: no rules, no decisions, nothing a document can tell. */
"use strict";
const path = require("path");
const { STD, monthRange, monthEnd, fyStart, fyEnd, pad } = require("./std");
const { CATEGORIES } = require(path.join(STD, "world", "domains", "setup"));

const TABLES = ["household", "party", "membership", "account", "alias", "ownership", "link", "category", "instrument", "asset", "activity", "contract", "term", "period", "stream", "scope", "tax_map", "budget", "goal", "reservation", "scenario", "assumption"];

function buildSetup(sim, script) {
  const C = sim.cast, S = Object.fromEntries(TABLES.map((t) => [t, []])), chapterToday = Object.fromEntries(script.chapters.map((c) => [c.chapter, c.today]));
  const at = (ch) => `${chapterToday[ch]}T00:00:00Z`, N = C.numbers, A = C.A, B = C.B, id = (x) => x.id.toUpperCase();
  const HH = `H-${C.id.toUpperCase()}`, PA = id(A), PB = id(B), home = sim.home, L = sim.loan;
  const push = (t, ch, row) => { S[t].push({ recorded_at: at(ch), ...row }); return row; };
  const org = (ch, party_id, name, kind = "organisation") => { if (!S.party.some((p) => p.party_id === party_id)) { push("party", ch, { party_id, kind, name }); push("alias", ch, { subject_type: "party", subject_id: party_id, scheme: "name", value: name, valid_from: "2000-01-01" }); } };
  const al = (ch, subject_type, subject_id, scheme, value, valid_from = "2000-01-01") => push("alias", ch, { subject_type, subject_id, scheme, value, valid_from });
  const own = (ch, subject_type, subject_id, shares, from, to) => { for (const [party, bps, bases] of shares) for (const basis of bases || ["legal", "beneficial", "tax"]) push("ownership", ch, { subject_type, subject_id, party_id: party, basis, share_bps: bps, valid_from: from, ...(to ? { valid_to: to } : {}) }); };
  // a term is told when it starts: chapter 5 spans years, and a rate told in 2030 would read as newer than every notice since 2028
  const term = (ch, subject_type, subject_id, t, value, unit, valid_from) => S.term.push({ term_id: `TERM-${String(S.term.length + 1).padStart(4, "0")}`, subject_type, subject_id, term: t, value: String(value), unit, valid_from, recorded_at: ch >= 5 ? `${valid_from}T00:00:00Z` : at(ch) });
  const acct = (ch, a) => push("account", ch, { currency: "AUD", in_scope: true, fidelity: "ledger", ...a });
  const bank = (ch, id_, name, type, inst, extra) => acct(ch, { account_id: id_, name, class: "asset", type, reporting_group: "cash", institution_party_id: inst, liquid: true, ...extra });
  const stream = (ch, stream_id, name, doc_kind, subject_type, subject_id, cadence, valid_from, extra) => push("stream", ch, { stream_id, name, doc_kind, subject_type, subject_id, cadence, valid_from, ...extra });
  const link = (ch, relation, from_type, from_id, to_type, to_id, valid_from, share_bps) => push("link", ch, { relation, from_type, from_id, to_type, to_id, valid_from, ...(share_bps != null ? { share_bps } : {}) });
  const scope = (ch, domain, state, by, valid_from, note) => push("scope", ch, { subject_type: "household", subject_id: HH, domain, state, by, valid_from, ...(note ? { note } : {}) });
  const bankName = { westpaw: "Harbour Bank", commbark: "Bark Bank", ping: "Wattle Credit Union", amewx: "Southern Card" }, inst = (role) => bankName[C.institutions[role].brand];
  const instId = (role) => inst(role).toUpperCase().replace(/[^A-Z]/g, "");
  const inOrg = (ch, role) => org(ch, instId(role), inst(role));

  // chapter 0 and 1: one person, one account
  push("household", 0, { household_id: HH, name: C.household, jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Melbourne", standard_version: "household-standard/1", budget_date: "posted" });
  push("party", 0, { party_id: PA, kind: "person", name: A.name, birth_date: A.born }); al(0, "party", PA, "name", A.name);
  push("membership", 0, { party_id: PA, role: "adult", valid_from: "2026-07-01" });
  for (const c of CATEGORIES) push("category", 0, c);
  inOrg(0, "A_every"); bank(0, "ACC-A-EVERY", `${A.first}'s everyday`, "transaction", instId("A_every"));
  own(0, "account", "ACC-A-EVERY", [[PA, 10000]], "2026-07-01");
  al(0, "account", "ACC-A-EVERY", "account_number", N.A_every); al(0, "account", "ACC-A-EVERY", "name", "EVERY-A");
  stream(0, "EVERY-A", "Everyday download", "txn_csv", "account", "ACC-A-EVERY", "monthly", "2026-07-01", { issuer_party_id: instId("A_every"), grace_days: 14 });
  scope(1, "banking", "partial", A.first, "2026-07-01", "One account so far.");
  // chapter 2: the first close
  inOrg(2, "A_save"); inOrg(2, "A_card");
  bank(2, "ACC-A-SAVE", `${A.first}'s saver`, "savings", instId("A_save")); own(2, "account", "ACC-A-SAVE", [[PA, 10000]], "2026-07-01", "2027-03-20");
  own(3, "account", "ACC-A-SAVE", [[PA, 10000, ["legal"]], [PA, 5000, ["beneficial", "tax"]], [PB, 5000, ["beneficial", "tax"]]], "2027-03-20");
  al(2, "account", "ACC-A-SAVE", "account_number", N.A_save); al(2, "account", "ACC-A-SAVE", "name", "SAVE-A");
  stream(2, "SAVE-A", "Saver download", "txn_csv", "account", "ACC-A-SAVE", "monthly", "2026-07-01", { issuer_party_id: instId("A_save"), grace_days: 14 });
  acct(2, { account_id: "ACC-A-CARD", name: `${A.first}'s card`, class: "liability", type: "credit_card", reporting_group: "cash", institution_party_id: instId("A_card"), liquid: true }); own(2, "account", "ACC-A-CARD", [[PA, 10000]], "2026-07-01");
  al(2, "account", "ACC-A-CARD", "card_last4", N.A_card);
  stream(2, "CARD-A", "Card activity", "txn_csv", "account", "ACC-A-CARD", "monthly", "2026-07-01", { issuer_party_id: instId("A_card"), grace_days: 14 });
  stream(2, "CARD-A-STMT", "Card statements", "statement_pdf", "account", "ACC-A-CARD", "monthly", "2026-07-01", { issuer_party_id: instId("A_card"), grace_days: 14 });
  const fund = (ch, key, p) => {
    const name = p.super === "hestabby" ? "HESTAbby" : "Purrannuation", party = name.toUpperCase(); org(ch, party, name);
    const cid = `SUPER-${key}`;
    acct(ch, { account_id: cid, name: `Super, ${p.first}`, class: "asset", type: "super", reporting_group: "super", institution_party_id: party, liquid: false });
    own(ch, "account", cid, [[id(p), 10000]], "2026-07-01"); al(ch, "account", cid, "member_number", p.member); al(ch, "account", cid, "name", cid);
    push("contract", ch, { contract_id: `C-${cid}`, kind: "super_fund", name, counterparty_party_id: party, holder_party_id: id(p), account_id: cid, started_on: "2026-07-01" });
    stream(ch, cid, `${name} activity`, "transactions", "account", cid, p.super === "hestabby" ? "quarterly" : "monthly", "2026-07-01", { issuer_party_id: party, grace_days: 14 });
    stream(ch, `${cid}-STMT`, `${name} statement`, "super_statement", "account", cid, p.super === "hestabby" ? "half_yearly" : "yearly", "2026-07-01", { issuer_party_id: party, grace_days: 60 });
    link(ch, "contributes_to", "contract", `C-EMP-${key}`, "account", cid, "2026-07-01");
  };
  org(2, "ATO", "Australian Taxation Office", "government"); org(2, "EMP-A", A.employer);
  push("contract", 2, { contract_id: "C-EMP-A", kind: "employment", name: A.employer, counterparty_party_id: "EMP-A", holder_party_id: PA, category_id: "SALARY", started_on: "2026-07-01" }); term(2, "contract", "C-EMP-A", "pay_cadence", "fortnightly", "enum", "2026-07-01");
  fund(2, "A", A);
  acct(2, { account_id: "HELP-A", name: `HELP debt, ${A.first}`, class: "liability", type: "help_debt", reporting_group: "tax", in_scope: true }); own(2, "account", "HELP-A", [[PA, 10000]], "2026-05-31");
  stream(2, "PAY-A", "Payslips", "payslip", "party", PA, "fortnightly", "2026-07-02", { grace_days: 7 });
  stream(2, "HELP-A", "HELP account", "help_balance", "party", PA, "yearly", "2026-06-01", { issuer_party_id: "ATO", grace_days: 60 });
  stream(2, "TAX-A", "Assessments", "tax_assessment", "party", PA, "yearly", "2026-07-01", { issuer_party_id: "ATO", grace_days: 120 });
  term(2, "party", PA, "tax_resident", "true", "bool", "2026-07-01");
  for (const [d, st] of [["banking", "has"], ["payroll", "has"], ["super", "has"], ["help_debt", "has"], ["credit_card", "has"]]) scope(2, d, st, A.first, "2026-07-01");
  for (const [d, note] of [["home_loan", "Renting."], ["rental", null], ["business", "No ABN."], ["trust", null], ["smsf", null], ["crypto", null], ["foreign_accounts", null]]) scope(2, d, "none", A.first, "2026-07-01", note);
  // chapter 3: the second person, and the joint account
  push("party", 3, { party_id: PB, kind: "person", name: B.name, birth_date: B.born }); al(3, "party", PB, "name", B.name);
  push("membership", 3, { party_id: PB, role: "adult", valid_from: "2027-03-20" });
  inOrg(3, "B_every"); inOrg(3, "B_save"); inOrg(3, "joint"); org(3, "EMP-B", B.employer);
  bank(3, "ACC-B-EVERY", `${B.first}'s everyday`, "transaction", instId("B_every")); own(3, "account", "ACC-B-EVERY", [[PB, 10000]], "2026-07-01");
  al(3, "account", "ACC-B-EVERY", "account_number", N.B_every); al(3, "account", "ACC-B-EVERY", "name", "EVERY-B");
  bank(3, "ACC-B-SAVE", `${B.first}'s saver`, "savings", instId("B_save")); own(3, "account", "ACC-B-SAVE", [[PB, 10000]], "2026-07-01");
  al(3, "account", "ACC-B-SAVE", "account_number", N.B_save); al(3, "account", "ACC-B-SAVE", "name", "SAVE-B");
  bank(3, "ACC-JOINT", "Joint account", "transaction", instId("joint"), { opened_on: sim.opened["ACC-JOINT"] }); own(3, "account", "ACC-JOINT", [[PA, 5000], [PB, 5000]], sim.opened["ACC-JOINT"]);
  al(3, "account", "ACC-JOINT", "account_number", N.joint); al(3, "account", "ACC-JOINT", "name", "JOINT");
  for (const [sid, n, a, r] of [["EVERY-B", "Everyday download", "ACC-B-EVERY", "B_every"], ["SAVE-B", "Saver download", "ACC-B-SAVE", "B_save"], ["JOINT", "Joint download", "ACC-JOINT", "joint"]]) stream(3, sid, n, "txn_csv", "account", a, "monthly", a === "ACC-JOINT" ? sim.opened["ACC-JOINT"] : "2026-07-01", { issuer_party_id: instId(r), grace_days: 14 });
  push("contract", 3, { contract_id: "C-EMP-B", kind: "employment", name: B.employer, counterparty_party_id: "EMP-B", holder_party_id: PB, category_id: "SALARY", started_on: "2026-07-01" }); term(3, "contract", "C-EMP-B", "pay_cadence", "fortnightly", "enum", "2026-07-01");
  fund(3, "B", B);
  stream(3, "PAY-B", "Payslips", "payslip", "party", PB, "fortnightly", "2026-07-08", { grace_days: 7 });
  stream(3, "TAX-B", "Assessments", "tax_assessment", "party", PB, "yearly", "2026-07-01", { issuer_party_id: "ATO", grace_days: 120 });
  term(3, "party", PB, "tax_resident", "true", "bool", "2026-07-01");
  org(3, "ETREAT", "E*Treat"); push("party", 3, { party_id: "PLANPARENT", kind: "company", name: B.plan.parent });
  push("instrument", 3, { instrument_id: B.plan.code, kind: "rsu", code: B.plan.code, name: B.plan.parent, currency: "USD", issuer_party_id: "PLANPARENT" }); al(3, "instrument", B.plan.code, "name", B.plan.code);
  acct(3, { account_id: "SHR-RSU", name: `RSUs, ${B.first}`, class: "asset", type: "ess_plan", reporting_group: "shares", institution_party_id: "ETREAT", parent_account_id: "ACC-B-EVERY", contract_id: "C-ESS" }); own(3, "account", "SHR-RSU", [[PB, 10000]], "2026-07-01");
  push("contract", 3, { contract_id: "C-ESS", kind: "ess_plan", name: "RSU plan", counterparty_party_id: "PLANPARENT", holder_party_id: PB, account_id: "SHR-RSU", started_on: "2026-07-01" });
  al(3, "account", "SHR-RSU", "member_number", B.plan.account); al(3, "contract", "C-ESS", "member_number", B.plan.account);
  stream(3, "RSU-HIST", "Benefit history", "vest", "contract", "C-ESS", "yearly", "2026-07-01", { issuer_party_id: "ETREAT", grace_days: 30 });
  stream(3, "RSU-SALE", "Sale confirmations", "contract_note", "account", "SHR-RSU", "event", "2026-07-01", { issuer_party_id: "ETREAT" });
  stream(3, "RSU-HOLD", "Plan holdings", "holding", "account", "SHR-RSU", "event", "2027-01-31", { issuer_party_id: "ETREAT" });
  scope(3, "banking", "has", B.first, "2027-03-20"); scope(3, "employee_shares", "has", B.first, "2026-07-01");
  // chapter 4: tax time
  org(4, "BUPAW", "Bupaw"); org(4, "AGENT", C.agency.accountant); org(4, "PAWPACK", "PawPack Benefits");
  for (const [k, p] of [["A", A], ["B", B]]) {
    stream(4, `IS-${k}`, "Income statements", "income_statement", "party", id(p), "yearly", "2026-07-01", { grace_days: 30 });
    stream(4, `PREFILL-${k}`, "Pre-fill", "prefill", "party", id(p), "yearly", "2026-07-01", { issuer_party_id: "ATO", grace_days: 45 });
    stream(4, `PHI-${k}`, "Health insurance statement", "health_statement", "party", id(p), "yearly", "2026-07-01", { issuer_party_id: "BUPAW", grace_days: 30 });
    stream(4, `DED-${k}`, "Deductions worksheet", "work_log", "party", id(p), "yearly", "2026-07-01", { grace_days: 60 });
  }
  stream(4, "RSU-ESS", "ESS statement", "ess_statement", "contract", "C-ESS", "yearly", "2026-07-01", { issuer_party_id: "ETREAT", grace_days: 45 });
  for (const [sel, label, treatment, basis] of [["INTEREST", "10", "income", "ownership"], ["WORK-OTHER", "D5", "deduction", "person"], ["WORK-EQUIP", "D5", "deduction", "person"], ["DONATION", "D9", "deduction", "person"]]) push("tax_map", 4, { selector_type: "category", selector: sel, label, treatment, basis, valid_from: "2018-07-01" });
  scope(4, "private_health", "has", A.first, "2026-07-01"); scope(4, "insurance", "has", A.first, "2026-07-01");
  // chapter 5: the home, the children, the estate
  for (const k of sim.kids.filter((x) => x.born <= chapterToday[6])) {
    const ch = k.born <= chapterToday[5] ? 5 : 6, pid = id(k);
    push("party", ch, { party_id: pid, kind: "person", name: k.name, birth_date: k.born }); al(ch, "party", pid, "name", k.name);
    push("membership", ch, { party_id: pid, role: "dependant", valid_from: k.born });
  }
  if (home) {
    org(5, "HARBOURBANK", "Harbour Bank"); org(5, "CONVEY", `${C.surname.split(/[- ]/)[0]} Conveyancing Pty Ltd`); org(5, "PURRSURE", "Purrsure"); org(5, "PAWPRICE", "PawPrice Estimates"); org(5, "COUNCIL", C.utilities.council); org(5, "WATER", C.utilities.water); org(5, "POWER", "RedPaw Energy"); org(5, "GAS", "Origpurr Gas"); org(5, "VICPAWS", "VicPaws"); org(5, "KITTENHOOD", "Kittenhood Early Learning"); org(5, "SERVICESP", "Services Pawstralia", "government");
    push("asset", 5, { asset_id: "HOME", kind: "property", name: "Family home", account_id: "HOME", location: home.address, acquired_on: home.on });
    push("asset", 5, { asset_id: "CAR", kind: "vehicle", name: "Family car", account_id: "CAR", acquired_on: "2021-02-01" });
    acct(5, { account_id: "HOME", name: "Family home", class: "asset", type: "property", reporting_group: "property", asset_id: "HOME", opened_on: home.on }); own(5, "account", "HOME", [[PA, 5000], [PB, 5000]], home.on); own(5, "asset", "HOME", [[PA, 5000], [PB, 5000]], home.on);
    acct(5, { account_id: "CAR", name: "Family car", class: "asset", type: "vehicle", reporting_group: "vehicle", asset_id: "CAR", opened_on: home.on }); own(5, "account", "CAR", [[PA, 5000], [PB, 5000]], home.on); own(5, "asset", "CAR", [[PA, 5000], [PB, 5000]], home.on);
    acct(5, { account_id: "LN-HOME", name: "Home loan", class: "liability", type: "loan", reporting_group: "loans", institution_party_id: "HARBOURBANK", contract_id: "C-HOME", opened_on: home.on }); own(5, "account", "LN-HOME", [[PA, 5000], [PB, 5000]], home.on);
    bank(5, "ACC-OFFSET", "Offset", "offset", "HARBOURBANK", { opened_on: home.on }); own(5, "account", "ACC-OFFSET", [[PA, 5000], [PB, 5000]], home.on);
    al(5, "account", "ACC-OFFSET", "account_number", N.offset); al(5, "account", "ACC-OFFSET", "name", "OFFSET");
    al(5, "account", "LN-HOME", "loan_number", L.number, home.on); al(5, "account", "LN-HOME", "account_number", L.number, home.on); al(5, "contract", "C-HOME", "loan_number", L.number, home.on);
    al(5, "asset", "HOME", "name", home.address, home.on); al(5, "asset", "HOME", "name", "HOME", home.on); for (const k of ["rates_ref", "water_ref", "power_ref", "gas_ref"]) al(5, "asset", "HOME", "name", C.utilities[k]);
    al(5, "asset", "CAR", "name", "Family car"); al(5, "asset", "CAR", "name", C.utilities.rego);
    push("contract", 5, { contract_id: "C-HOME", kind: "loan", name: "Home loan", counterparty_party_id: "HARBOURBANK", account_id: "LN-HOME", asset_id: "HOME", category_id: "MORTGAGE", started_on: home.on });
    link(5, "funds_purpose", "contract", "C-HOME", "asset", "HOME", home.on, 10000); link(5, "secures", "contract", "C-HOME", "asset", "HOME", home.on); link(5, "offsets", "account", "ACC-OFFSET", "contract", "C-HOME", home.on);
    term(5, "contract", "C-HOME", "interest_rate", sim.rate.history[0].rate.toFixed(2), "pct", home.on); term(5, "contract", "C-HOME", "repayment_type", "principal_and_interest", "enum", home.on); term(5, "contract", "C-HOME", "term_end", `${Number(home.on.slice(0, 4)) + 30}${home.on.slice(4)}`, "date", home.on);
    term(5, "asset", "HOME", "use", "owner_occupied", "enum", home.on); term(5, "asset", "HOME", "main_residence", "true", "bool", home.on);
    for (const [sid, name, dk, st, sub, cad, from, extra] of [["OFFSET", "Offset download", "txn_csv", "account", "ACC-OFFSET", "monthly", home.on, { issuer_party_id: "HARBOURBANK", grace_days: 14 }], ["LOAN", "Loan ledger", "txn_csv", "account", "LN-HOME", "monthly", home.on, { issuer_party_id: "HARBOURBANK", grace_days: 14 }], ["LOAN-STMT", "Loan statements", "loan_statement", "account", "LN-HOME", "yearly", home.on, { issuer_party_id: "HARBOURBANK", grace_days: 30 }], ["RATE-LOAN", "Rate notices", "rate_notice", "contract", "C-HOME", "event", home.on, { issuer_party_id: "HARBOURBANK" }], ["SETTLEMENT", "Settlement statement", "settlement", "asset", "HOME", "event", home.on, { issuer_party_id: "CONVEY" }], ["VALUE", "PawPrice estimates", "valuation", "asset", "HOME", "monthly", home.on, { issuer_party_id: "PAWPRICE", grace_days: 7 }], ["POLICY", "Policies", "policy", "asset", "HOME", "yearly", home.on, { issuer_party_id: "PURRSURE", grace_days: 21 }], ["BILL-RATES", "Rates", "bill", "asset", "HOME", "quarterly", home.on, { issuer_party_id: "COUNCIL", grace_days: 21 }], ["BILL-WATER", "Water", "bill", "asset", "HOME", "quarterly", home.on, { issuer_party_id: "WATER", grace_days: 21 }], ["BILL-POWER", "Electricity", "bill", "asset", "HOME", "quarterly", home.on, { issuer_party_id: "POWER", grace_days: 21 }], ["BILL-GAS", "Gas", "bill", "asset", "HOME", "quarterly", home.on, { issuer_party_id: "GAS", grace_days: 21 }], ["CHILDCARE", "Childcare statements", "childcare_statement", "party", PA, "monthly", sim.care.length ? "2029-02-05" : "2029-02-05", { issuer_party_id: "KITTENHOOD", grace_days: 14 }], ["RECEIPTS", "Receipts", "receipt", "party", PA, "event", home.on, {}], ["REGO", "Registration", "bill", "asset", "CAR", "yearly", "2026-11-01", { issuer_party_id: "VICPAWS", grace_days: 14 }], ["PPL", "Paid parental leave", "payslip", "party", PA, "event", "2028-06-12", { issuer_party_id: "SERVICESP" }]]) stream(5, sid, name, dk, st, sub, cad, from, extra);
    push("contract", 5, { contract_id: "C-PPL", kind: "employment", name: "Paid parental leave", counterparty_party_id: "SERVICESP", holder_party_id: PA, category_id: "GOV-PAY", started_on: "2028-06-12" });
    push("tax_map", 5, { selector_type: "category", selector: "GOV-PAY", label: "1", treatment: "income", basis: "person", valid_from: "2018-07-01", note: "Parental leave pay, at the same label as a wage." });
    for (const [cid, name, asset, cat] of [["POL-HOME", "Home and contents", "HOME", "HOME-INS"], ["POL-CAR", "Comprehensive car", "CAR", "CAR"]]) { push("contract", 5, { contract_id: cid, kind: "insurance", name, counterparty_party_id: "PURRSURE", asset_id: asset, category_id: cat, started_on: home.on }); link(5, "covers", "contract", cid, "asset", asset, home.on); }
    for (const p of sim.policies) al(5, "contract", p.id, "policy_number", p.number, p.from);
    for (const [d, st, note] of [["home_loan", "has", null], ["vehicle", "has", null], ["things", "has", null], ["childcare", "has", null]]) scope(5, d, st, A.first, home.on, note);
  }
  if (sim.childSaver) {
    const kid = sim.kids[0], pid = id(kid);
    bank(5, "ACC-C1-SAVE", `${kid.first}'s saver`, "savings", instId("A_save"), { opened_on: sim.childSaver });
    own(5, "account", "ACC-C1-SAVE", [[PA, 10000, ["legal"]], [pid, 10000, ["beneficial", "tax"]]], sim.childSaver);
    al(5, "account", "ACC-C1-SAVE", "account_number", N.child_save); al(5, "account", "ACC-C1-SAVE", "name", "SAVE-C1");
    stream(5, "SAVE-C1", "Child's saver download", "txn_csv", "account", "ACC-C1-SAVE", "monthly", sim.childSaver, { issuer_party_id: instId("A_save"), grace_days: 14 });
  }
  // chapters 7 and 9: their own small households
  const biz = sim.biz, kid = sim.kids[0];
  if (biz) {
    bank(7, "ACC-BIZ", "Practice account", "transaction", "HARBOURBANK", { opened_on: C.later.biz.from }); own(7, "account", "ACC-BIZ", [[PA, 10000]], C.later.biz.from); al(7, "account", "ACC-BIZ", "account_number", "732-998 120 447"); al(7, "account", "ACC-BIZ", "name", "BIZ-A");
    stream(7, "BIZ-A", "Practice account", "txn_csv", "account", "ACC-BIZ", "monthly", C.later.biz.from, { issuer_party_id: "HARBOURBANK", grace_days: 14 });
    stream(7, "BAS-A", "Business activity statements", "activity_statement", "party", PA, "quarterly", C.later.biz.from, { issuer_party_id: "ATO", grace_days: 28 });
    S.scope.push({ subject_type: "household", subject_id: HH, domain: "business", state: "has", by: A.first, valid_from: C.later.biz.from, recorded_at: at(7) });
  }
  if (sim.job) {
    bank(9, "ACC-C1-EVERY", `${kid.first}'s everyday`, "transaction", instId("A_save"), { opened_on: C.later.teen.job_from }); own(9, "account", "ACC-C1-EVERY", [[id(kid), 10000]], C.later.teen.job_from); al(9, "account", "ACC-C1-EVERY", "name", "EVERY-C1"); al(9, "account", "ACC-C1-EVERY", "account_number", N.child_every);
    org(9, "EMP-C1", C.later.teen.employer); push("contract", 9, { contract_id: "C-EMP-C1", kind: "employment", name: C.later.teen.employer, counterparty_party_id: "EMP-C1", holder_party_id: id(kid), category_id: "SALARY", started_on: C.later.teen.job_from });
    stream(9, "EVERY-C1", "Everyday download", "txn_csv", "account", "ACC-C1-EVERY", "monthly", C.later.teen.job_from, { issuer_party_id: instId("A_save"), grace_days: 14 });
    stream(9, "PAY-C1", "Payslips", "payslip", "party", id(kid), "event", C.later.teen.job_from, {});
  }
  // periods, for every month the script reaches
  for (const ym of monthRange("2026-07", "2036-06")) push("period", 0, { period_id: ym, kind: "month", start_on: `${ym}-01`, end_on: monthEnd(ym), status: "open" });
  for (let fy = 2027; fy <= 2036; fy++) { push("period", 0, { period_id: `FY${fy}`, kind: "fy", start_on: fyStart(fy), end_on: fyEnd(fy), status: "open" }); [["Q1", 7, fy - 1], ["Q2", 10, fy - 1], ["Q3", 1, fy], ["Q4", 4, fy]].forEach(([q, m, y]) => push("period", 0, { period_id: `FY${fy}${q}`, kind: "quarter", start_on: `${y}-${pad(m)}-01`, end_on: monthEnd(`${y}-${pad(m + 2)}`), status: "open" })); }
  return S;
}

/* Setup as a chapter knows it. Rows told later are not yet known. */
function setupAt(setup, today) {
  const cut = `${today}T23:59:59Z`, out = {};
  for (const [t, rows] of Object.entries(setup)) out[t] = rows.filter((r) => !r.recorded_at || r.recorded_at <= cut);
  return out;
}

module.exports = { buildSetup, setupAt, TABLES };
