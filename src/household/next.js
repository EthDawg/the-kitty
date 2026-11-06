/* One step. The single most useful thing to do next, in words a person reads, with why it matters and what to do. Written for one renter with one
   account as readily as for a family with a mortgage: it reads the facts in readiness and nothing else. The order below is the whole policy. */
"use strict";
const { rebuildAt } = require("./clock");
const { readiness, DOMAINS } = require("./status");
const { money, day, monthName, monthYear, plural } = require("./words");
const { tabOf } = require("./tabs");
const { monthOf, monthEnd } = require("../../standard/engine/util");

const nameOf = (L, id) => (L.index.accounts.get(id) || {}).name || id;
const choices = (view, out) => view.setup.category.filter((c) => (out ? ["expense", "pass_through", "transfer"] : ["income", "pass_through", "transfer"]).includes(c.kind)).filter((c) => c.category_id !== "UNCAT").map((c) => ({ id: c.category_id, name: c.name }));

const lastLine = (L, account) => { const rows = (L.linesByAccount.get(account) || []).map((l) => l.date).sort(); return rows[rows.length - 1] || null; };
// A law's scope is an id or a clearing path. A person gets the name at the end of it.
function scopeName(L, scope) {
  const tail = String(scope).split(" ")[0].split(":").pop(), party = L.parties.find((p) => p.party_id === tail);
  return (L.index.accounts.get(tail) || {}).name || (party && party.name) || tail;
}
const SPOKEN = new Set(["uncategorised", "deposit_without_payslip", "open_item", "file_refused", "unresolved_account", "unpaired_transfer"]);
// A payslip newer than the last bank line is a file still to come, not a question. The stale step asks for that file.
const stillToCome = (L, r) => { if (r.kind !== "payslip_without_deposit") return false; const on = (/\d{4}-\d{2}-\d{2}/.exec(r.what) || [])[0], lines = (L.lines || []).map((l) => l.date).sort(); return !!on && on > (lines[lines.length - 1] || ""); };
const LAW_WORDS = {
  L1: (x) => `An entry for ${x} does not balance.`,
  L2: (x) => `Two sides of the same money have not met: ${x}.`,
  L3: (x) => `The balances for ${x} do not add up.`,
  L5: (x) => `A payslip for ${x} does not add up.`,
  L6: (x) => `The interest on ${x} is not what its rate says.`,
  L7: (x) => `The holdings in ${x} do not match the statement.`,
  L8: () => "What your files say you hold does not match what the ledger adds up to.",
  L9: (x) => `The owners of ${x} do not add up to 100%.`,
  L10: (x) => `${x} has two values for the same day.`,
  L11: (x) => `A tax return does not match what we worked out: ${x}.`,
  L14: (x) => `Super on a payslip did not reach the fund: ${x}.`,
  L15: () => "A number has no file behind it.",
  L17: (x) => `A decision has lost the line it was about: ${x}.`,
  other: (x) => `Two things in your files disagree: ${x}.`,
};
const steps = {
  handEdit({ view }) {
    const hashOf = (d) => (d.value || {}).found_hash;
    const asked = view.decisions.filter((d) => d.status === "proposed" && d.by === "sheet"), done = new Set(view.decisions.filter((d) => d.status === "accepted" && d.target_type === "source").map(hashOf));
    const e = asked.find((d) => !done.has(hashOf(d)));
    return e && { id: "hand_edit", say: `Someone typed in the ${tabOf(e.target_ref).tab} tab.`, why: "That tab is rebuilt from your files, so whatever was typed would be lost at the next close. Nothing has been overwritten.", action: { verb: "decide", label: "Tell us what was meant", args: { hand_edit: { table: e.target_ref } } } };
  },
  unread({ view }) {
    const s = view.sources.find((x) => /^unread:no_recipe/.test(x.note || ""));
    return s && { id: "needs_recipe", say: `We can't read ${s.name} yet.`, why: "Nothing from that file is in your numbers. It is held safe until we can.", action: { verb: "recipe", label: "Ask your agent to write a recipe for it", args: { source_id: s.source_id, fingerprint: s.note.split(":").slice(2).join(":") } } };
  },
  scan({ view }) {
    const s = view.sources.find((x) => /^unread:agent_tier/.test(x.note || ""));
    return s && { id: "needs_agent", say: `${s.name} is a picture, so no recipe can read it.`, why: "Nothing from it is in your numbers yet.", action: { verb: "agent", label: "Ask your agent to read it", args: { source_id: s.source_id } } };
  },
  refused({ view }) {
    const s = view.sources.find((x) => x.status === "quarantined");
    return s && { id: "refused", say: `${s.name} failed its checks, so none of it is in your numbers.`, why: String(s.note || "").replace(/^refused: /, "") || "A file that does not add up is left out whole, never half read.", action: { verb: "add", label: "Download it again and add the new copy", args: { source_id: s.source_id } } };
  },
  unresolved({ L }) {
    const r = L.review.find((x) => x.kind === "unresolved_account");
    return r && { id: "unresolved_account", say: r.what, why: "Its lines are held, and they are not in your numbers yet.", action: { verb: "record", label: "Add the account, or link it to one you have", args: { table: "alias" } } };
  },
  firstFile({ facts }) {
    return !facts.sources.held && { id: "first_file", say: "Add your first bank file.", why: "One file from your everyday account is enough to see where your money went.", action: { verb: "add", label: "Download the last three months as a CSV and add it" } };
  },
  changedSeal({ facts }) {
    const f = facts.laws.failing.find((x) => x.law === "L12");
    return f && { id: "seal_changed", say: `${monthYear(f.scope)} was locked, and something now changes it.`, why: "A locked month stays as it was unless you say otherwise.", action: { verb: "decide", label: `Reopen ${monthName(f.scope)}, or take back the change`, args: { reopen: f.scope }, needs: ["reason"] } };
  },
  lawFails({ L, facts }) {
    const f = facts.laws.failing.find((x) => x.law !== "L12");
    // A transfer whose other side is an account we have not met is the commonest thing a first file shows, and not a fault in anything.
    if (f && f.law === "L2" && /transfer/.test(f.scope)) return { id: "other_side", say: "Some of your money went to an account we haven't met yet.", why: "It isn't counted as spending. Add that account's file and the two sides meet.", action: { verb: "add", label: "Add that account's file", args: { check: `${f.law}|${f.scope}` } } };
    return f && { id: "does_not_add_up", say: (LAW_WORDS[f.law] || LAW_WORDS.other)(scopeName(L, f.scope)), why: f.detail || "A number you can't trust is worse than a number you don't have.", action: { verb: "review", label: "Look at it, then add the missing file, or accept it with a reason", args: { check: `${f.law}|${f.scope}` } } };
  },
  categorise({ L, view }) {
    const r = L.review.find((x) => x.kind === "uncategorised");
    if (!r) return null;
    const [, date] = r.ref.split("|"), out = r.amount_cents < 0, left = L.review.filter((x) => x.kind === "uncategorised").length;
    return { id: "categorise", say: `What was the ${money(Math.abs(r.amount_cents))} that ${out ? "left" : "came in"} on ${day(date)}, marked "${r.question}"?`, why: left === 1 ? "It is the last line we can't place." : `It is the biggest of the ${plural(left, "line")} we can't place. Answer it once and it is remembered.`, action: { verb: "decide", label: "Pick what it was", args: { item: r.item_id }, needs: ["category_id"], choices: choices(view, out) } };
  },
  // Anything else the engine wants a person for. Its own words are the question.
  otherReview({ L }) {
    const r = L.review.find((x) => !SPOKEN.has(x.kind) && !stillToCome(L, x));
    return r && { id: "review", say: r.what, why: r.do || "It needs a person.", action: { verb: "review", label: "Look at it", args: { item: r.item_id } } };
  },
  noBalance({ L, facts, clock }) {
    const id = facts.no_balance[0];
    if (!id) return null;
    const m = facts.months.find((x) => x.unconfirmed.includes(id));
    const on = m ? m.end : lastLine(L, id);
    return { id: "no_balance", say: `What did ${nameOf(L, id)} hold at the end of ${day(on)}?`, why: "Its file has no balance column, so nothing yet proves its lines are all here.", action: { verb: "decide", label: "Read the balance from your banking app", args: { balance: { account_id: id, as_at: on } }, needs: ["cents"] } };
  },
  missingMonth({ facts }) {
    const s = facts.coverage.streams.find((x) => x.missing.some((m) => /^\d{4}-\d{2}$/.test(m)));
    if (!s) return null;
    const m = s.missing.filter((x) => /^\d{4}-\d{2}$/.test(x)).sort()[0];
    return { id: "missing_month", say: `Bring in ${monthYear(m)} for ${s.name}.`, why: `We have the months around it and not that one, so ${monthName(m)} can't be closed.`, action: { verb: "add", label: `Download ${monthName(m)} and add it`, args: { stream: s.stream_id, month: m } } };
  },
  stale({ L, view, facts, clock }) {
    if (!clock.today) return null;
    const behind = view.setup.stream.filter((s) => s.subject_type === "account").map((s) => ({ s, last: lastLine(L, s.subject_id), reach: facts.reach[s.subject_id] })).filter((x) => x.last && x.reach && monthEnd(monthOf(x.reach)) < clock.today).sort((a, b) => (a.reach < b.reach ? -1 : 1))[0];
    return behind ? { id: "stale", say: `Your file for ${behind.s.name} stops on ${day(behind.last)}.`, why: `${monthName(monthOf(behind.reach))} is over, so the rest of it can come in now.`, action: { verb: "add", label: "Download everything since then and add it", args: { stream: behind.s.stream_id, from: behind.last } } } : null;
  },
  closeMonth({ facts }) {
    const m = facts.months.find((x) => x.state === "ready");
    if (m) return { id: "close", say: `Close ${monthYear(m.month)}.`, why: "Its lines add up to the balance your bank stated. Closing keeps that month as it is.", action: { verb: "close", label: `Close ${monthName(m.month)}`, args: { month: m.month } } };
    const l = facts.months.find((x) => x.state === "closed" && x.can_lock);
    return l && { id: "lock", say: `Lock ${monthYear(l.month)}.`, why: "Nothing in it is waiting on anything now. Locking keeps it as it is for good.", action: { verb: "close", label: `Lock ${monthName(l.month)}`, args: { month: l.month } } };
  },
  payslips({ L, facts }) {
    if (!L.review.some((r) => r.kind === "deposit_without_payslip") || facts.scope.said.payroll) return null;
    return { id: "payslips", say: "Do you keep your payslips?", why: "Your pay lands in the bank after tax. A payslip shows the gross, the tax and the super, and a month can only lock once a payslip backs its pay, or you say there are none.", action: { verb: "decide", label: "Add a payslip, or say you don't keep them", args: { scope: { domain: "payroll" } }, needs: ["state"], choices: [{ id: "has", name: "Yes, I'll add them" }, { id: "none", name: "No, go without" }] } };
  },
  askScope({ facts }) {
    const d = DOMAINS.find((x) => facts.scope.not_asked.includes(x.domain));
    return d && { id: "scope", say: d.asks, why: d.why, action: { verb: "decide", label: "Answer yes, no or not sure", args: { scope: { domain: d.domain } }, needs: ["state"], choices: [{ id: "has", name: "Yes" }, { id: "none", name: "No" }, { id: "unknown", name: "Not sure" }] } };
  },
  clear({ facts }) {
    const m = facts.months[facts.months.length - 1], open = facts.review.by_kind.open_item || 0;
    const waiting = open ? ` ${plural(open, "thing")} will clear by ${open === 1 ? "itself" : "themselves"} when the other side arrives.` : "";
    return { id: "clear", say: "You're up to date.", why: `${m ? `Everything we expected is here and ${monthName(m.month)} is ${m.state === "open" ? "still running" : "closed"}.` : "There is nothing waiting on you."}${waiting} That means your files are in, not that every number is right.`, action: { verb: "wait", label: "Add the next file when the month ends" } };
  },
};
// A missing file comes before a broken law: most laws fail because a file is missing. Evidence comes before judgement for the same reason.
// Payslips are asked before a close, so a month locks the first time instead of being closed and then locked.
const ORDER = ["handEdit", "unread", "refused", "firstFile", "changedSeal", "unresolved", "missingMonth", "lawFails", "categorise", "otherReview", "noBalance", "stale", "payslips", "closeMonth", "scan", "askScope", "clear"];

function pick(built) {
  const facts = readiness(built);
  for (const k of ORDER) { const s = steps[k]({ ...built, facts }); if (s) return s; }
  return null;
}
async function next(store, { today, built } = {}) {
  const probe = await store.probe();
  if (probe.empty || !probe.recognised) return { id: "start", say: "Start your Kitty.", why: "It takes a name and who is in the household. Nothing else is needed yet.", action: { verb: "init", label: "Name your household" } };
  if (probe.manifest.state !== "ready") return { id: "finish_start", say: "Finish setting up your Kitty.", why: "Setting up was cut off part way. Running it again picks up where it stopped.", action: { verb: "init", label: "Run setup again" } };
  return pick(built || (await rebuildAt(store, { today })));
}
module.exports = { next, pick };
