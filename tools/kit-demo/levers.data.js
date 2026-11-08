// Davies input for the Levers module: the Offset buffer goal and its Goal Levers rows (data/v3/goal-levers.csv).
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { csvRows } = { csvRows: (p) => { const t = fs.readFileSync(path.join(ROOT, p), "utf8").trim().split(/\r?\n/); const sp = (l) => { const o = []; let c = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; } else if (ch === '"') q = true; else if (ch === ",") { o.push(c); c = ""; } else c += ch; } o.push(c); return o; }; const h = sp(t[0]); return t.slice(1).map((l) => Object.fromEntries(sp(l).map((v, i) => [h[i], v]))); } };
module.exports = function (goalName = "Offset buffer") {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, "data/snapshot-v2.json"), "utf8"));
  const asOf = snap.settings.find((r) => r.setting === "As-of date").value;
  const g = snap.goals.find((x) => x.goal === goalName);
  const rows = csvRows("data/v3/goal-levers.csv").filter((r) => r.Goal === goalName);
  const on = (r) => /^(true|yes|1)$/i.test(r.On);
  const plan = rows.find(on) ? (on(rows.find(on)) ? rows.find(on)["Date if on"] : rows.find(on)["Date if off"]) : null;
  return {
    asOf,
    goal: { name: g.goal, target: g.target_amount, have: g.balance_now, planDate: plan, targetDate: g.target_date, allOffDate: null },
    levers: rows.map((r) => ({ id: r["Lever ID"], lever: r.Lever, on: on(r), perMonth: +r["Per month"] || 0, oneOff: +r["One-off"] || 0, dateIfOn: r["Date if on"], dateIfOff: r["Date if off"], monthsMoved: r["Months moved"] === "" ? null : +r["Months moved"], source: r.Source, writable: true })),
    extraDates: [],
  };
};
