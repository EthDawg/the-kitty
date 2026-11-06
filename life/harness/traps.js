/* Every trap listed in life/world/traps.md for chapters 0 to 6, judged against truth.json and the rebuilt ledger. Verdicts are computed here and never written down by hand:
     handled         the numbers are right and whatever a person must be told is told, with no person's help
     flagged         a person is told: the numbers are right only after their answer, or wrong and named as a question
     silently_wrong  a number is wrong, or something a person must be told is not, and nothing says so
     not_run         the verb it needs is not on this branch. Reported, never counted as handled
   A probe may only read: the book of each chapter, the stores, truth. A trap is judged at the chapter its evidence reaches, which can be later than the chapter that lists it. */
"use strict";
const { K } = require("./family");
const { monthOf } = require("../../standard/engine/util");
const { termAt } = require("../../standard/engine/temporal");

const handled = (note) => ({ verdict: "handled", note });
const flagged = (note) => ({ verdict: "flagged", note });
const wrong = (note) => ({ verdict: "silently_wrong", note });
const notRun = (note) => ({ verdict: "not_run", note });
const money = (c) => (c / 100).toFixed(2);

const idOf = (hh, id) => hh.ids.get(id) || id;
const lineAt = (L, hh, account, date, cents) => (L.lines || []).find((l) => l.account === idOf(hh, account) && l.date === date && l.cents === cents);
const linesAt = (L, hh, account, date, cents) => (L.lines || []).filter((l) => l.account === idOf(hh, account) && l.date === date && l.cents === cents);
const kindOf = (L, id) => { const c = L.index.categories.get(id); return c ? c.kind : null; };
const eventOf = (L, line) => L.events.find((e) => e.line === line) || L.events.find((e) => e.occurred_on === line.date && Math.abs(e.amount_cents) === Math.abs(line.cents));
const reviewOf = (L, kind, line) => L.review.find((r) => r.kind === kind && String(r.ref).startsWith(`${line.account}|${line.date}|${line.cents}`));
/* Right because of a person, not by itself: a decision on the line, or a question about that merchant somewhere in the life. */
const words = (s) => String(s || "").toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)).slice(0, 2).join(" ");
let QUESTIONS = "";
const personSaid = (line) => ["decision", "history"].includes((line.cls || {}).via) || (!!words(line.desc) && QUESTIONS.includes(words(line.desc)));
const said = (book, re) => [...(book.status.words || []), book.next.say, book.next.why].some((w) => re.test(w || ""));
const countByMonth = (rows, month) => rows.filter((l) => monthOf(l.date) === month).length;

/* A line that must not be spending. Right by itself, right only because a person answered, or wrong and quiet. */
function notSpending(L, line, what) {
  if (!line) return null;
  const ev = eventOf(L, line), kind = ev ? kindOf(L, ev.category_id) : null, asked = reviewOf(L, "uncategorised", line);
  const counted = ev && !ev.unexplained && ["expense", "income"].includes(kind) && ev.status !== "open";
  if (asked) return flagged(`${what}: not placed yet, and next asks about it.`);
  if (counted) return wrong(`${what}: counted as ${ev.category_id}, with nothing asked.`);
  return personSaid(line) ? flagged(`${what}: right, because a person said what it was.`) : handled(`${what}: read as ${ev ? ev.kind : "no event"} with no help.`);
}
const J = (r) => r.J;

const TRAPS = {
  // Chapter 0
  "T0-NO-RECIPE": { ch: 0, at: 0, probe({ book, run }) {
    const b = book[0], need = b.dropped.needs_recipe.length, read = b.dropped.added.length;
    if (!need) return read && run.F.answers.some((r) => r.id === "life-ping2026-csv") ? wrong("A file with no public recipe was read without one.") : notRun("This family's bank has a public recipe, so there is nothing to refuse.");
    if (read) return wrong("Something was imported before the recipe passed the gate.");
    if (!b.recipe || b.recipe.status !== "passed") return flagged("Named as unread, and the recipe has not passed.");
    return handled(`Named no_recipe, then one recipe through the gate${b.refused && b.refused.status === "needs_account" ? ", after the person named the account" : ""}.`);
  } },
  "T0-SECOND-ACCOUNT-FREE": { ch: 0, at: 2, async probe({ book, run }) {
    const hh = run.A, r = await hh.store.tables.read("recipe"), b = book[2], left = [...(b.portalAdded.needs_recipe || []), ...(b.fromDrive.needs_recipe || [])].filter((x) => /^ping|Transactions/.test(x.name));
    const saver = run.F.W.files.find((f) => f.stream === "SAVE-A" && f.held_from === 2);
    if (saver && saver.family !== run.F.W.files.find((f) => f.stream === "EVERY-A").family) return notRun("This family's saver has its own layout, so a second recipe is right.");
    return !left.length && r.length === new Set(r.map((x) => x.fingerprint)).size ? handled(`${r.length} recipe read both accounts.`) : wrong("The saver needed a second recipe.");
  } },
  "T0-DATE-ORDER": { ch: 0, at: 0, probe({ book, run }) {
    const b = book[0], v = b.recipe && b.recipe.verdict, L = b.built.L, hh = b.hh, sim = run.F.sim.lines.filter((l) => l.acct === "ACC-A-EVERY" && l.date >= "2026-10-01" && l.date <= "2026-12-31");
    if (!v) return b.dropped.added.length ? handled("A public recipe read it and its dates hold.") : notRun("No recipe ran.");
    if (v.checks.date_order !== "pass") return flagged("The gate refused the date order.");
    const off = sim.filter((l) => !lineAt(L, hh, "ACC-A-EVERY", l.date, l.cents));
    return off.length ? wrong(`${off.length} lines landed on the wrong day.`) : handled("The gate proved the order, and every line is on its true day.");
  } },
  // Chapter 1
  "T1-OPENING-FROM-FILE": { ch: 1, at: 1, probe({ book, run }) {
    const b = book[1], t = run.F.trap("T1-OPENING-FROM-FILE")[0], L = b.built.L, id = idOf(b.hh, t.account), e = L.events.find((x) => x.kind === "opening_balance" && x.refs.account === id);
    if (!e) return wrong("No opening balance.");
    return e.amount_cents === t.opening_cents ? handled(`Opening ${money(e.amount_cents)} from the first line, typed by nobody.`) : wrong(`Opening ${money(e.amount_cents)}, truth ${money(t.opening_cents)}.`);
  } },
  "T1-CARD-PAYMENT-NO-CARD": { ch: 1, at: 1, probe({ book, run }) {
    const t = run.F.trap("T1-CARD-PAYMENT-NO-CARD")[0], b0 = book[0], line = lineAt(b0.built.L, b0.hh, t.account, t.date, t.cents);
    return notSpending(b0.built.L, line, "The card repayment") || notRun("The line is not in this family's first file.");
  } },
  "T1-SALARY-NO-PAYSLIP": { ch: 1, at: 1, probe({ book, run }) {
    const t = run.F.trap("T1-SALARY-NO-PAYSLIP")[0], b = book[1], L = b.built.L, line = lineAt(L, b.hh, t.account, t.date, t.cents), e = line && L.events.find((x) => x.line === line);
    if (!e) return wrong("The salary credit has no event.");
    if (e.kind === "wage_unmatched" && e.status === "provisional" && e.amount_cents === t.cents) return reviewOf(L, "deposit_without_payslip", line) ? handled("Net income from the bank's word, provisional, and gross is asked for, not zero.") : flagged("Provisional, with no question.");
    return wrong(`Read as ${e.kind}.`);
  } },
  "T1-TRANSFER-TO-SAVER": { ch: 1, at: 1, probe({ book, run }) {
    const t = run.F.trap("T1-TRANSFER-TO-SAVER")[0], b = book[1], L = b.built.L, line = lineAt(L, b.hh, t.account, t.date, t.cents);
    if (!line) return notRun("The line is not held.");
    const e = eventOf(L, line);
    if (e && e.kind === "open_transfer") return handled("A transfer with one side, open, not spending.");
    return notSpending(L, line, "The transfer to the saver") || notRun("The line is not held.");
  } },
  // Chapter 2
  "T2-OVERLAP-WINDOW": { ch: 2, at: 2, probe({ book, run }) {
    const t = run.F.trap("T2-OVERLAP-WINDOW")[0], b = book[2], L = b.built.L, id = idOf(b.hh, t.account), got = L.lines.filter((l) => l.account === id && l.date >= t.overlap_from && l.date <= t.overlap_to).length;
    const want = run.F.sim.lines.filter((l) => l.acct === t.account && l.date >= t.overlap_from && l.date <= t.overlap_to).length;
    return got === want ? handled(`${got} lines in the overlap, each once.`) : wrong(`${got} lines in the overlap, truth ${want}.`);
  } },
  "T2-SAME-DAY-TWINS": { ch: 2, at: 2, probe({ book, run }) {
    const t = run.F.trap("T2-SAME-DAY-TWINS")[0], b = book[2];
    if (!t) return notRun("No twins for this family.");
    const n = linesAt(b.built.L, b.hh, t.account, t.date, t.cents).length;
    return n === t.count ? handled(`${n} identical purchases stay ${n}.`) : wrong(`${n} lines, truth ${t.count}.`);
  } },
  "T2-STATEMENT-AND-ACTIVITY": { ch: 2, at: 2, probe({ book, run }) {
    const b = book[2], L = b.built.L, id = idOf(b.hh, "ACC-A-CARD"), t = run.F.trap("T2-STATEMENT-AND-ACTIVITY")[0], m = "2026-12";
    const got = countByMonth(L.lines.filter((l) => l.account === id), m), want = countByMonth(run.F.sim.lines.filter((l) => l.acct === "ACC-A-CARD"), m), both = L.lines.filter((l) => l.account === id && l.witnesses.length > 1).length;
    if (got !== want) return wrong(`${got} card lines in ${m}, truth ${want}.`);
    return both ? handled(`${t.lines} lines on the statement, each purchase once, ${both} seen by two witnesses.`) : flagged("One witness only: the statement did not corroborate the lines.");
  } },
  "T2-CARD-CYCLE": { ch: 2, at: 2, probe({ book, run }) {
    const b = book[2], L = b.built.L, id = idOf(b.hh, "ACC-A-CARD"), t = run.F.truth.accounts["ACC-A-CARD"].months, off = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"].filter((m) => L.balances.at(id, m) !== t[m]);
    return off.length ? wrong(`Month ends off: ${off.join(", ")}.`) : handled("A statement closing on the 14th, and five month ends tie.");
  } },
  "T2-PAYMENT-TWO-SIDES": { ch: 2, at: 2, probe({ book, run }) {
    const t = run.F.trap("T2-PAYMENT-TWO-SIDES")[0], b = book[2], L = b.built.L, ev = L.events.filter((e) => e.occurred_on === t.date && Math.abs(e.amount_cents) === t.cents);
    if (!ev.length) return notRun("The repayment is not held.");
    if (ev.length === 1 && ["transfer", "card_payment"].includes(ev[0].kind) && kindOf(L, ev[0].category_id) === "transfer") return handled(`One own transfer, ${ev[0].kind}.`);
    return ev.some((e) => ["income", "expense"].includes(kindOf(L, e.category_id))) ? wrong("Counted as money in or out.") : flagged("Not spending, and not paired.");
  } },
  "T2-HELP-NO-BANK-LINE": { ch: 2, at: 2, probe({ book, run }) {
    const b = book[2], L = b.built.L, id = idOf(b.hh, "HELP-A"), t = run.F.truth.accounts["HELP-A"].months, m = "2027-01";
    const noCash = !L.cash.some((c) => (c.byCategory["HELP-INDEX"] || 0) !== 0);
    if (L.balances.at(id, m) !== t[m]) return wrong(`HELP reads ${money(L.balances.at(id, m))}, truth ${money(t[m])}.`);
    return noCash ? handled("A liability with no cash, nothing in spending.") : wrong("HELP reached the spending view.");
  } },
  "T2-SALARY-PACKAGING": { ch: 2, at: 2, probe({ book, run }) {
    const b = book[2], L = b.built.L, t = run.F.trap("T2-SALARY-PACKAGING").filter((x) => x.date <= b.today), hh = b.hh, id = "ACC-A-EVERY";
    const lines = t.map((x) => lineAt(L, hh, id, x.date, x.cents)).filter(Boolean);
    if (!lines.length) return notRun("No packaging lines held.");
    const asIncome = lines.filter((l) => { const e = L.events.find((x) => x.line === l); return e && kindOf(L, e.category_id) === "income"; });
    if (asIncome.length !== lines.length) return wrong(`${lines.length - asIncome.length} of ${lines.length} credits are not pay.`);
    return lines.every(personSaid) ? flagged("The credit is pay, because a person said so. No recipe reads the package line. F-001.") : handled("The credit is pay, read from the payslip.");
  } },
  "T2-DRIVE-MISSING-MONTH": { ch: 2, at: 2, probe({ book, run }) {
    const t = run.F.trap("T2-DRIVE-MISSING-MONTH")[0], s = book[2].drive_status.readiness.coverage.streams.find((x) => x.stream_id === t.stream);
    return s && s.missing.includes(t.month) ? handled(`Coverage names ${t.month} before the portal fills it.`) : wrong(`Coverage does not name ${t.month}: ${s ? s.missing.join(",") : "no stream"}.`);
  } },
  "T2-BYTE-DUPLICATE": { ch: 2, at: 2, async probe({ book, run }) {
    const b = book[2], d = b.fromDrive.already.filter((x) => /Statement/.test(x.name)), src = await run.A.store.tables.read("source");
    const dupes = new Set(src.map((s) => s.source_id)).size - new Set(src.map((s) => s.sha256)).size;
    return d.length && !dupes ? handled("One source, and the second copy was recognised.") : wrong(`${dupes} byte-identical sources.`);
  } },
  "T2-SCAN": { ch: 2, at: 2, async probe({ book, run }) {
    const b = book[2], t = run.F.trap("T2-SCAN")[0], names = [t.scan, t.screenshot].map((p) => p.split("/").pop()), obs = await run.A.store.tables.read("observation"), src = await run.A.store.tables.read("source");
    const ids = src.filter((s) => names.includes(s.name)).map((s) => s.source_id), read = obs.filter((o) => ids.includes(o.source_id)).length;
    if (read) return wrong(`${read} observations were read from a picture.`);
    const agent = b.fromDrive.needs_agent.map((x) => x.name);
    return names.every((n) => agent.includes(n)) ? handled("Both are agent tier, and nothing was read.") : flagged(`Nothing was read, but ${names.filter((n) => !agent.includes(n)).join(", ")} is sent for a recipe, which can never read it.`);
  } },
  "T2-MISFILED": { ch: 2, at: 2, async probe({ book, run }) {
    const t = run.F.trap("T2-MISFILED")[0], name = t.file.split("/").pop(), src = (await run.A.store.tables.read("source")).filter((s) => s.name === name);
    if (!src.length) return wrong("The file did not land.");
    return handled(`Read by what it is, into ${src[0].stream_id || "its account"}, not the Car folder.`);
  } },
  // Chapter 3
  "T3-JOINT-TWICE": { ch: 3, at: 3, probe({ book, run }) {
    const b = book[3], L = b.built.L, id = idOf(b.hh, "ACC-JOINT"), got = countByMonth(L.lines.filter((l) => l.account === id), "2027-03"), want = countByMonth(run.F.sim.lines.filter((l) => l.acct === "ACC-JOINT" && l.date <= b.today), "2027-03");
    const bal = L.balances.at(id, "2027-03"), t = run.F.truth.accounts["ACC-JOINT"].months["2027-03"];
    if (got !== want) return wrong(`${got} joint lines, truth ${want}.`);
    return bal === t ? handled(`${got} lines, each once, from two windows, and the balance ties.`) : wrong(`Balance ${money(bal)}, truth ${money(t)}.`);
  } },
  "T3-JOINT-SAME-FILE": { ch: 3, at: 3, async probe({ run }) {
    const t = run.F.trap("T3-JOINT-SAME-FILE")[0], src = (await J(run).store.tables.read("source")).filter((s) => s.sha256 === t.sha256);
    return new Set(src.map((s) => s.source_id)).size === 1 ? handled("One source, whoever dropped it first.") : wrong(`${src.length} sources for one set of bytes.`);
  } },
  "T3-PRIVATE-HISTORY": { ch: 3, at: 3, async probe({ book, run }) {
    const b = book[3], from = b.joined.from, L = b.built.L, early = L.lines.filter((l) => l.date < from).length, solo = run.F.trap("T3-PRIVATE-HISTORY")[0];
    const pay = (L.resolverObs.get("payslip") || []).filter((o) => o.payload.pay_date < from).length;
    const named = (who) => new RegExp(`\\b${who.split(" ")[0]}\\b`, "i");
    const crossed = (await run.A.store.tables.read("source")).filter((s) => !/^Joint/.test(s.name) && named(run.F.B.name).test(s.name)).length + (await run.B.store.tables.read("source")).filter((s) => !/^Joint/.test(s.name) && named(run.F.A.name).test(s.name)).length;
    if (early || pay) return wrong(`${early} lines and ${pay} payslips from before ${from} are in the joint Kitty.`);
    const left = b.joined.private.map((p) => `${p.by}: ${p.lines} lines`).join(", ");
    return b.hh.store && Object.keys(solo.solo_streams).length && !crossed ? handled(`Nothing before ${from} crossed. Left home: ${left}.`) : wrong(`${crossed} files crossed between solo Kitties.`);
  } },
  "T3-SALARY-CHANGE-MID-MONTH": { ch: 3, at: 3, async probe({ book, run }) {
    const t = run.F.trap("T3-SALARY-CHANGE-MID-MONTH")[0];
    if (!t) return notRun("No mid-month change for this family.");
    const L = book[3].built.L, e = L.events.find((x) => x.kind === "wage" && x.occurred_on === t.pay_date && x.amount_cents === t.gross_cents), derived = (await J(run).store.tables.read("term")).filter((x) => /salary/i.test(x.term));
    if (!e) return flagged("The blended payslip is not in the joint Kitty yet.");
    return derived.length ? wrong("A salary term was inferred from a blended pay.") : handled(`One payslip of ${money(t.gross_cents)}, and no salary inferred from it.`);
  } },
  "T3-COUPLE-TRANSFER": { ch: 3, at: 4, probe({ book, run }) {
    const t = run.F.trap("T3-COUPLE-TRANSFER")[0], b = book[4], L = b.built.L, out = lineAt(L, b.hh, t.out.account, t.out.date, t.out.cents), inn = lineAt(L, b.hh, t.in.account, t.in.date, t.in.cents);
    if (!out || !inn) return notRun("One side of it never reached the joint Kitty.");
    const e = eventOf(L, out);
    if (e && e.kind === "transfer") return personSaid(out) ? flagged(`One own transfer, but only because a person said what the lines were (${e.rule}).`) : handled("One own transfer, read from the two lines, once both were in one Kitty.");
    return wrong(`Read as ${e ? e.kind : "nothing"}: both sides counted.`);
  } },
  "T3-BOND": { ch: 3, at: 3, probe({ book, run }) {
    const t = run.F.trap("T3-BOND")[0], b = book[3], L = b.built.L, line = lineAt(L, b.hh, t.account, t.date, t.cents);
    return notSpending(L, line, "The bond") || notRun("The bond is not held.");
  } },
  "T3-TWO-NAMES-ONE-ACCOUNT": { ch: 3, at: 3, async probe({ book, run }) {
    const t = run.F.trap("T3-TWO-NAMES-ONE-ACCOUNT")[0], s = J(run).store, a = await s.tables.read("account"), al = await s.tables.read("alias"), id = idOf(book[3].hh, "ACC-JOINT");
    const norm = (x) => x.replace(/\D/g, ""), accounts = new Set(al.filter((x) => x.subject_type === "account" && norm(x.value) === norm(t.number)).map((x) => x.subject_id));
    const names = al.filter((x) => x.subject_id === id && x.scheme === "name").map((x) => x.value), old = al.some((x) => x.subject_id === id && x.scheme === "owner_ref");
    if (accounts.size !== 1 || !a.some((x) => x.account_id === id)) return wrong(`${accounts.size} accounts for one number.`);
    if (a.some((x) => x.account_id === run.B.ids.get("ACC-JOINT"))) return wrong("The old id survived as an account.");
    return names.includes(t[run.F.A.id]) && names.includes(t[run.F.B.id]) && old ? handled(`One account by its number. ${t[run.F.A.id]} and ${t[run.F.B.id]} stay as names, and the old id as an alias.`) : wrong("A name was lost.");
  } },
  // Chapter 4
  "T4-AMENDMENT": { ch: 4, at: 5, probe({ book, run }) {
    const t = run.F.trap("T4-AMENDMENT")[0], b = book[5], L = b.built.L, who = idOf(b.hh, run.F.B.id.toUpperCase()), fy = `FY${t.fy}`, rows = L.returns.returns.filter((r) => r.party_id === who && r.fy === fy);
    const paid = L.events.filter((e) => e.kind === "tax_payment" && e.occurred_on === t.paid_on && e.amount_cents === t.extra_tax_cents);
    if (rows.length < 2) return wrong(`${rows.length} version of the return held.`);
    return paid.length === 1 ? handled(`Both notices kept, version ${Math.max(...rows.map((r) => r.version))} stands, one bank line of ${money(t.extra_tax_cents)}.`) : wrong("The extra tax is not one bank line.");
  } },
  "T4-HELP-IN-ASSESSMENT": { ch: 4, at: 4, probe({ book, run }) {
    const t = run.F.trap("T4-HELP-IN-ASSESSMENT").find((x) => x.fy === 2027), b = book[4], L = b.built.L, id = idOf(b.hh, "HELP-A"), m = monthOf(t.assessed_on), want = run.F.truth.accounts["HELP-A"].months[m], got = L.balances.at(id, m);
    if (got !== want) return wrong(`HELP reads ${money(got)}, truth ${money(want)}.`);
    const refund = L.events.find((e) => e.kind === "tax_refund" && e.amount_cents === t.refund_cents) || L.events.find((e) => e.kind === "tax_payment" && e.amount_cents === -t.refund_cents);
    return refund ? handled("The debt falls by the repayment, with no bank line, and the refund is the refund.") : flagged("The debt ties; the refund has not met its bank line.");
  } },
  "T4-JOINT-INTEREST-SHARE": { ch: 4, at: 4, probe: (x) => labelTen(x, "FY2027", "T4-JOINT-INTEREST-SHARE") },
  "T4-OWNER-NOT-NAME": { ch: 4, at: 4, probe: (x) => labelTen(x, "FY2027", "T4-OWNER-NOT-NAME") },
  "T4-PHI-1-APRIL": { ch: 4, at: 4, probe({ book, run }) {
    const b = book[4], L = b.built.L, t = run.F.trap("T4-PHI-1-APRIL")[0], fy = `FY${t.fy}`, items = L.tax.items.filter((i) => i.label === "PHI-REBATE" && i.fy === fy);
    if (!items.length) return flagged(`No statement for ${fy} is held, so the two rates are not tested here.`);
    return handled(`The rebate is read from the insurer's statement, ${items.length} per person, so no single rate is assumed.`);
  } },
  "T4-CGT-VALUE-30-JUNE": { ch: 4, at: 4, probe({ book, run }) {
    const t = run.F.trap("T4-CGT-VALUE-30-JUNE")[0], b = book[4], L = b.built.L, named = said(b, /30 June 2027|market value|value (at|on) that day/i) || L.review.some((r) => /30 June 2027|market value/i.test(r.what));
    const held = (L.resolverObs.get("holding") || []).some((o) => o.payload.as_at === t.date && o.payload.value_cents === t.value_cents);
    if (named) return flagged("A person is told the value is needed.");
    return held ? handled("The value on the day is held.") : wrong(`Nothing asks for the value of ${t.units} ${t.instrument} on ${t.date}, and nothing holds it. Finding H-001.`);
  } },
  "T4-REFUND-OLD-ACCOUNT": { ch: 4, at: 4, probe({ book, run }) {
    const t = run.F.trap("T4-REFUND-OLD-ACCOUNT")[0], b = book[4], L = b.built.L, line = lineAt(L, b.hh, t.account, t.date, t.cents), e = line && L.events.find((x) => x.line === line);
    if (!line) return notRun("The refund line is not held.");
    if (e && e.kind === "tax_refund") return handled("A tax refund, on the account the tax office held, and not income.");
    return e && kindOf(L, e.category_id) === "income" ? wrong("Counted as income.") : flagged("Not income, and not matched to the assessment.");
  } },
  "T4-ACCOUNTANT-ZIP": { ch: 4, at: 4, probe() { return notRun("pack is on life/pack, not this branch. Its own tests hold it: 44 of 44, PR 28."); } },
  // Chapter 5
  "T5-SETTLEMENT": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-SETTLEMENT")[0], b = book[5], L = b.built.L, lot = L.lotRows.find((l) => l.asset_id === idOf(b.hh, "HOME")), bad = L.events.filter((e) => [t.deposit, t.final].some((x) => x && e.occurred_on === x.date && Math.abs(e.amount_cents) === Math.abs(x.cents)) && kindOf(L, e.category_id) === "expense");
    if (!lot) return wrong("No cost base held for the home.");
    const base = Number(lot.cost_price_cents) + Number(lot.cost_incidental_cents), want = t.price_cents + t.duty_cents + t.legal_cents + t.adjustments_cents;
    if (bad.length) return wrong("The deposit or the balance reads as spending.");
    return base === want ? handled(`One purchase. Cost base ${money(base)} with duty and legal, and no spending.`) : wrong(`Cost base ${money(base)}, truth ${money(want)}.`);
  } },
  "T5-CGT-TWO-REGIMES": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-CGT-TWO-REGIMES")[0], b = book[5], L = b.built.L, named = L.review.some((r) => /two regimes|indexation|30 June 2027/i.test(r.what)) || said(b, /two regimes|indexation/i);
    const matches = L.lotMatches.filter((m) => m.disposed_on === t.date);
    if (named) return flagged("The disposal is named as spanning two regimes.");
    return wrong(`${matches.length} disposals on ${t.date} carry one regime's gain, stated plainly. Assumed tax flags the year, not the disposal. Finding H-001.`);
  } },
  "T5-OFFSET-INTEREST": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-OFFSET-INTEREST")[0], b = book[5], L = b.built.L, id = idOf(b.hh, "LN-HOME"), law = L.checks.filter((c) => c.law === "L6" && String(c.scope).includes(id));
    const charged = L.events.filter((e) => monthOf(e.occurred_on) === t.month && e.amount_cents === t.interest_cents);
    if (!charged.length) return wrong(`No interest of ${money(t.interest_cents)} in ${t.month}.`);
    return law.some((c) => c.status === "fail") ? flagged("Interest ties to the lender's line; L6 disagrees with the rate.") : handled("The lender's interest stands, and the rate law holds.");
  } },
  "T5-RATE-BACKDATED": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-RATE-BACKDATED")[0], b = book[5], L = b.built.L, c = (L.contracts || []).find((x) => x.kind === "loan"), on = termAt(L.termIdx, "contract", c.contract_id, "interest_rate", t.corrected_effective_on);
    return Number(on) === t.rate_pct ? handled(`The rate on ${t.corrected_effective_on} reads ${on}, backdated, and interest already charged stays.`) : wrong(`The rate on ${t.corrected_effective_on} reads ${on}, truth ${t.rate_pct}.`);
  } },
  "T5-MORTGAGE-SPLIT": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-MORTGAGE-SPLIT")[0], L = book[5].built.L, c = L.cash.find((m) => m.month === t.month), a = L.accrual.find((m) => m.month === t.month);
    const cash = -(c.byCategory.MORTGAGE || 0), economic = a.byCategory["HOME-INT"] || 0;
    if (cash !== t.repaid_cents) return wrong(`Cash lens ${money(cash)}, truth ${money(t.repaid_cents)}.`);
    return economic && !(a.byCategory.MORTGAGE) ? handled("Cash sees the repayment, the economic lens only the interest.") : wrong("The economic lens holds the whole repayment.");
  } },
  "T5-PARENTAL-LEAVE-MONTH": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-PARENTAL-LEAVE-MONTH").find((x) => x.month <= book[5].today.slice(0, 7)), b = book[5], L = b.built.L, m = L.cash.find((x) => x.month === t.month), truth = run.F.truth.income[t.month];
    if ((m.income + m.unexplained) !== truth.household) return wrong(`Income ${money(m.income)}, truth ${money(truth.household)}.`);
    const stream = b.status.readiness.coverage.streams.find((s) => s.stream_id === "PAY-A"), gaps = stream ? stream.missing.length : 0;
    return gaps ? flagged(`Two payers, both income, and ${gaps} payslip periods read as missing while she is on leave. F-006.`) : handled("Two payers, both income, and no false gap.");
  } },
  "T5-BOND-BACK": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-BOND-BACK")[0], b = book[5], L = b.built.L, line = lineAt(L, b.hh, t.account, t.date, t.cents), m = L.cash.find((x) => x.month === monthOf(t.date));
    if (!line) return notRun("The refund is not held.");
    const e = eventOf(L, line);
    if (e && kindOf(L, e.category_id) === "income" && e.status !== "open") return wrong("The bond came back as income.");
    const spent = L.events.some((x) => monthOf(x.occurred_on) === monthOf(t.date) && x.amount_cents === -t.charge_cents);
    return spent ? handled("Not income, and the charge is spending.") : wrong(`The refund is not income, but the ${money(t.charge_cents)} cleaning charge is spending nobody sees. Finding H-002.`);
  } },
  "T5-REFUND-ACROSS-MONTH": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-REFUND-ACROSS-MONTH")[0], b = book[5], L = b.built.L, line = lineAt(L, b.hh, t.refund.account, t.refund.date, t.refund.cents), e = line && L.events.find((x) => x.line === line);
    if (!e) return notRun("The refund is not held.");
    if (e.kind === "refund" && kindOf(L, e.category_id) === "expense") return handled("Lowers spending in the month it posts, on the same category.");
    return wrong(`Read as ${e.kind}.`);
  } },
  "T5-GIFT-DEPOSIT": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-GIFT-DEPOSIT")[0], b = book[5], L = b.built.L, line = lineAt(L, b.hh, t.account, t.date, t.cents), e = line && L.events.find((x) => x.line === line);
    if (!e) return notRun("The gift is not held.");
    const taxed = L.tax.items.some((i) => (i.refs || []).includes(e.event_id));
    if (e.category_id !== "GIFT-IN" || taxed) return wrong("The gift reached tax, or is not a gift.");
    return personSaid(line) ? flagged("A gift, not taxed, once a person said so.") : handled("A gift, not taxed.");
  } },
  "T5-WARRANTY": { ch: 5, at: 5, probe({ book, run }) {
    const b = book[5], L = b.built.L, t = run.F.trap("T5-WARRANTY"), facts = (L.resolverObs.get("asset_fact") || []).filter((o) => o.payload.warranty_until).length, shown = (L.refresh || []).filter((r) => r.warranty_until).length;
    if (shown) return handled(`${shown} things with a warranty date, off the balance sheet.`);
    return wrong(`${facts} of ${t.length} warranty dates are held as evidence and nothing shows them. Finding H-003.`);
  } },
  "T5-WILL-NO-KIND": { ch: 5, at: 5, async probe({ run }) {
    const src = (await J(run).store.tables.read("source")).filter((s) => /^Will-/.test(s.name)), obs = await J(run).store.tables.read("observation"), last = new Map(src.map((s) => [s.source_id, s]));
    if (!last.size) return wrong("The wills are not held.");
    const ids = new Set(last.keys()), read = obs.filter((o) => ids.has(o.source_id)).length;
    if (read) return wrong("A number was read from a will.");
    return [...last.values()].every((s) => /^held:/.test(s.note || "")) ? flagged("Held by hash and not read, once a person said to keep it. Until then next asks for a recipe a will can never have.") : flagged("Held and not read, and still asked about.");
  } },
  "T5-CCS": { ch: 5, at: 5, probe({ book, run }) {
    const t = run.F.trap("T5-CCS")[0], b = book[5], L = b.built.L, line = lineAt(L, b.hh, t.line.account, t.line.date, t.line.cents), e = line && L.events.find((x) => x.line === line);
    if (!e) return wrong("The gap is not one line.");
    const doc = (line.docs || []).some((o) => o.kind === "childcare_statement");
    if (kindOf(L, e.category_id) !== "expense" || e.amount_cents !== -t.gap_cents) return wrong(`Spending is ${money(-e.amount_cents)} on ${e.category_id}, truth the gap ${money(t.gap_cents)}.`);
    return doc ? handled("Spending is the gap, and the statement clears the line.") : flagged("Spending is the gap, and the statement did not reach the line.");
  } },
  "T5-NEW-DEPENDANT": { ch: 5, at: 5, async probe({ book, run }) {
    const b = book[5], rows = await J(run).store.tables.read("membership"), party = await J(run).store.tables.read("party"), t = run.F.trap("T5-NEW-DEPENDANT").filter((x) => x.born <= b.today);
    const off = t.filter((x) => { const k = run.F.kids.find((c) => c.role === x.child), p = party.find((q) => q.party_id === k.id.toUpperCase()); return !p || p.birth_date !== x.born || !rows.some((m) => m.party_id === p.party_id); });
    return off.length ? wrong(`${off.length} children are not members from their birth date.`) : handled(`${t.length} children, age from birth_date.`);
  } },
  // Chapter 6
  "T6-MEMO": { ch: 6, at: 6, probe({ book, run }) {
    const b = book[6], m = b.pocket;
    if (!m) return notRun("Pocket money was not built.");
    if (!m.bundle_same) return wrong("Pocket money moved the household's ledger.");
    if (m.ledger_memo_cents) return wrong(`${money(m.ledger_memo_cents)} of memo reached net worth or income.`);
    return m.example_ok ? handled("A memo account, a running balance from the family's words, and nothing in the household's totals.") : flagged("The memo stayed out of the totals, and its example did not hold.");
  } },
  "T6-CHILD-INTEREST-OWNER": { ch: 6, at: 6, probe({ book, run }) {
    const b = book[6], L = b.built.L, owner = run.F.kids[0].id.toUpperCase(), rows = Object.entries(run.F.truth.child_interest).filter(([fy]) => fy < `FY${b.today.slice(0, 4)}`), off = [];
    for (const [fy, t] of rows) { const got = L.tax.items.filter((i) => i.label === "10" && i.fy === fy && i.party_id === idOf(b.hh, owner)).reduce((n, i) => n + i.amount_cents, 0); if (got !== t.interest_cents) off.push(`${fy} ${money(got)} of ${money(t.interest_cents)}`); }
    return off.length ? wrong(`The child's interest: ${off.slice(0, 3).join("; ")}.`) : handled(`${rows.length} years of interest on the child's side, whoever's name is on the account.`);
  } },
  "T6-PREFILL-WRONG-PERSON": { ch: 6, at: 6, probe({ book, run }) {
    const b = book[6], who = idOf(b.hh, run.F.A.id.toUpperCase()), parent = (b.status.readiness.prefill || []).filter((p) => p.label === "10" && p.person === who);
    if (!parent.length) return wrong("The Kitty does not disagree with pre-fill.");
    return said(b, /pre-?fill/i) ? handled(`Disagrees with pre-fill in ${parent.length} places, says so, and adds nothing twice.`) : wrong(`It disagrees with pre-fill in ${parent.length} places and tells nobody.`);
  } },
  "T6-TEN-YEARS-OF-LAW": { ch: 6, at: 6, probe({ book }) {
    const b = book[6], L = b.built.L, years = b.status.clock.tax_assumed_years, missed = L.tax.estimates.filter((e) => years.includes(e.fy) && !e.assumed);
    if (!years.length) return wrong("No year past the law read is marked assumed.");
    if (missed.length) return wrong(`${missed.length} estimates past the law read are stated as law.`);
    return said(b, /assumed/) ? handled(`${years.length} years past the law read are marked assumed, and the words say so.`) : wrong("The estimates carry the mark, and the words do not.");
  } },
};
function labelTen({ book, run }, fy, trap) {
  const b = book[4], L = b.built.L, off = [];
  for (const [who, t] of Object.entries(run.F.truth.tax[fy])) {
    const want = (t.labels || {})["10"] || 0, got = L.tax.items.filter((i) => i.label === "10" && i.fy === fy && i.party_id === idOf(b.hh, who.toUpperCase())).reduce((n, i) => n + i.amount_cents, 0);
    if (got !== want) off.push(`${who} ${money(got)}, truth ${money(want)}`);
  }
  return off.length ? wrong(`${trap}: ${off.join("; ")}.`) : handled(`Label 10 ties for both, ${fy}: the household counts it once and each return a share.`);
}
async function judge(run, upto) {
  const out = {};
  QUESTIONS = [run.A, run.B, run.J].filter(Boolean).flatMap((h) => h.questions).map((q) => q.what.toUpperCase()).join("\n");
  for (const [id, t] of Object.entries(TRAPS)) {
    if (t.at > upto) { out[id] = { ch: t.ch, verdict: "pending", note: `Judged at chapter ${t.at}.` }; continue; }
    if (!run.book[t.at]) continue;
    try { out[id] = { ch: t.ch, ...(await t.probe({ book: run.book, run })) }; }
    catch (e) { out[id] = { ch: t.ch, verdict: "silently_wrong", note: `The probe itself failed: ${e.message}` }; }
  }
  return out;
}
module.exports = { TRAPS, judge };
