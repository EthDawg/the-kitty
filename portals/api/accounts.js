"use strict";
const { query, json } = require("../lib/http");
const { who } = require("../lib/auth");
const { brandById, accountsFor, presets, documents, today, D } = require("../lib/data");
const { preview, ExportError } = require("../lib/exports");
const { viewOf } = require("../lib/view");
const Clock = require("../lib/clock");

module.exports = async (req, res) => {
  const qs = query(req);
  const brand = brandById[String(qs.brand || "")];
  if (!brand) return json(res, 404, { error: "No such portal." });
  const name = who(req, brand.id);
  if (!name) return json(res, 401, { error: "Sign in first." });
  try {
    const view = viewOf(req, brand.id);
    if (qs.account && qs.docs) return json(res, 200, { account: qs.account, groups: documents(brand.id, qs.account, view) });
    if (qs.account) return json(res, 200, preview({ brand: brand.id, account: qs.account, from: qs.from, to: qs.to, q: qs.q, page: qs.page, size: qs.size, view }));
    const accounts = accountsFor(brand.id, view).map((a) => ({ ...a, presets: presets(brand.id, a.kind, a.id, view) }));
    const clocked = view.as_of ? { months: D.months.filter((m) => `${m}-01` <= view.as_of), history: { from: D.history.from, to: Clock.upTo(view, D.history.to) } } : { months: D.months, history: D.history };
    return json(res, 200, { brand: brand.id, name, today: Clock.upTo(view, today), as_of: view.as_of, chapter: view.chapter, person: view.person, rules: view.rules, sheet_from: D.sheet_from, sheet_through: D.sheet_through, simulated: D.simulated, rows: D.transactions.length, accounts, ...clocked });
  } catch (e) {
    if (e instanceof ExportError || e.status) return json(res, e.status || 500, { error: e.message });
    throw e;
  }
};
