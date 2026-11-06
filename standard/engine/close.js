/* Close and lock. A month is closed when every ledger account it touches is confirmed by a stated balance and its clearing accounts are
   zero or explained. It is lockable when nothing in it is provisional. A lock stores a hash; law L12 then holds it. SPEC 3.4. */
"use strict";
const { monthEnd, monthOf } = require("./util");
const { sealOf } = require("./laws");

function closeStatus(L) {
  const provisional = new Set(L.events.filter((e) => e.status === "provisional").map((e) => monthOf(e.occurred_on)));
  const out = [];
  for (const m of L.balances.months) {
    const end = monthEnd(m);
    const touched = new Set((L.lines || []).filter((l) => monthOf(l.date) === m).map((l) => l.account));
    const unconfirmed = [...touched].filter((a) => !(L.stated || []).some((s) => s.account === a && monthOf(s.date) === m) && (L.index.accounts.get(a) || {}).fidelity !== "snapshot");
    out.push({ period_id: m, status: unconfirmed.length ? "open" : provisional.has(m) ? "closed" : "lockable", unconfirmed, end });
  }
  return out;
}
function seal(L, months) {
  return months.map((m) => { const p = { period_id: m, kind: "month", start_on: `${m}-01`, end_on: monthEnd(m), status: "locked" }; return { ...p, seal_hash: sealOf(L, p) }; });
}
module.exports = { closeStatus, seal };
