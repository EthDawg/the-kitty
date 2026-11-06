/* What a person is told about a file: how many lines, from when to when, which account, and where the file itself is kept. */
"use strict";
const { dayYear, money, plural } = require("./words");
const { bytesState } = require("./add");
const { latest } = require("./clock");
const { init, fail } = require("./init");
const { TABS } = require("./tabs");

const BYTES = { held: "The file itself is kept in your Google Drive.", on_device: "The file itself is kept on this device.", not_held: "The file itself was not kept, only what was read from it.", unknown: "" };
/* A file with no bank lines in it can still say something: a balance, a debt, a payslip. It is told as what it is, and never as nothing. */
function heldWords({ L, view }, sourceId) {
  const rows = view.observations.filter((o) => o.source_id === sourceId), latest = (kinds, on) => rows.filter((o) => kinds.includes(o.kind)).sort((a, b) => (on(a) < on(b) ? 1 : -1))[0];
  const named = (ref) => { const a = (view.setup.account || []).find((x) => x.account_id === ref) || (view.setup.alias || []).map((x) => (x.value === ref ? (view.setup.account || []).find((y) => y.account_id === x.subject_id) : null)).find(Boolean); return a ? a.name : null; };
  const help = latest(["help_balance"], (o) => o.payload.as_at);
  if (help) return { stated: true, say: `Your HELP debt: ${money(help.payload.balance_cents)} at ${dayYear(help.payload.as_at)}.` };
  const st = latest(["statement", "super_statement", "loan_statement"], (o) => o.payload.period_end);
  if (st) { const name = named(st.payload.account_ref) || st.payload.account_ref || "account"; return { stated: true, say: `Your ${/^[A-Z][a-z]+$/.test(name) ? name.toLowerCase() : name}: ${money(Math.abs(st.payload.closing_cents))} at ${dayYear(st.payload.period_end)}.` }; }
  const bal = latest(["balance"], (o) => o.payload.as_at);
  if (bal) return { stated: true, say: `${named(bal.payload.account_ref) || "This account"}: ${money(bal.payload.balance_cents)} at ${dayYear(bal.payload.as_at)}.` };
  const slip = latest(["payslip"], (o) => o.payload.pay_date);
  if (slip) return { stated: true, say: `A payslip for ${dayYear(slip.payload.pay_date)}: ${money(slip.payload.net_cents)} in your pay, from ${money(slip.payload.gross_cents)} before tax.` };
  return { say: rows.length ? "We read it, and it holds nothing for your numbers yet." : "We kept it, and there is nothing in it for your numbers." };
}
function fileWords({ L, view }, sourceId) {
  const lines = (L.lines || []).filter((l) => (l.witnesses || []).some((w) => w.source_id === sourceId)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const source = view.sources.find((s) => s.source_id === sourceId);
  if (!lines.length) return { lines: 0, ...heldWords({ L, view }, sourceId), bytes: source ? BYTES[bytesState(source)] : "" };
  const accounts = [...new Set(lines.map((l) => l.account))].map((id) => (L.index.accounts.get(id) || {}).name || id), from = lines[0].date, to = lines[lines.length - 1].date;
  return { lines: lines.length, from, to, accounts, say: `${plural(lines.length, "line")} from ${dayYear(from)} to ${dayYear(to)}, in ${accounts.join(" and ")}.`, bytes: source ? BYTES[bytesState(source)] : "" };
}
/* From this device to a Sheet: everything a person or a file wrote, the latest row of each, into a store that is empty. Not `transfer`, which is a dated slice between two
   households with consent. This is one household changing where it lives, on day one. Managed tabs are written at the next close. */
async function moveStore(from, to, { today }) {
  const household = latest("household", await from.tables.read("household"))[0], made = await init(to, { household, today });
  if (made.already) throw fail("not_empty", "That sheet already holds a Kitty. Nothing was changed.");
  for (const t of TABS) if (t.class !== "managed") { const rows = latest(t.table, await from.tables.read(t.table)); if (rows.length) await to.tables.appendNew(t.table, rows); }
}
module.exports = { fileWords, moveStore };
