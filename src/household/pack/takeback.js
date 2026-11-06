/* What came back. A lodged return and a notice of assessment are evidence: they enter through intake like any other file, and the Standard stores them append only.
   This sets the draft a person sent beside what was lodged, label by label, and hands back a new version of the pack. The earlier version is not touched,
   and neither is an earlier return: an amendment is another version, so the year can be read as it stood on any day. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "takeback", ["pack", "tax"], function (P, Tax) {
  "use strict";
  const dollars = (c) => (c === null || c === undefined ? null : Math.trunc(c / 100) * 100);
  const TOLERANCE = 100;   // the Standard's own: law L11 ties within a dollar, because the return drops cents label by label

  function reconcile(draft, L) {
    const person = draft.scope.people[0].party_id, fy = draft.scope.period.fy;
    const versions = (L.returns ? L.returns.returns : []).filter((r) => r.party_id === person && r.fy === fy).sort((a, b) => a.version - b.version);
    if (!versions.length) return null;
    const latest = versions[versions.length - 1];
    const leaves = L.returns.lines.filter((l) => l.return_id === latest.return_id && l.role === "leaf" && l.label);
    const drafted = new Map(draft.lines.filter((l) => l.section.endsWith(".summary") && l.engine).map((l) => [l.engine, l]));
    const labels = [...new Set([...leaves.map((l) => l.label), ...drafted.keys()])].filter((k) => !/^(18H|18V|20O)$/.test(k) || drafted.has(k));
    const rows = labels.map((label) => {
      const d = drafted.get(label), lodged = leaves.filter((l) => l.label === label), lodgedC = lodged.length ? lodged.reduce((s, l) => s + l.amount_cents, 0) : null;
      const memoOnly = !lodged.length && /^(18H|18V|20O)$/.test(label);
      const draftC = d ? d.amount_cents : null;
      const gap = draftC === null || lodgedC === null ? null : dollars(lodgedC) - dollars(draftC);
      const ties = gap !== null ? Math.abs(gap) <= TOLERANCE : memoOnly;
      return { label, name: d ? d.name : Tax.NAMES[label] || label, draft_cents: draftC, lodged_cents: lodgedC, gap_cents: gap, status: ties ? "ties" : "differs", note: memoOnly ? "Memo line, not a leaf on the return." : draftC === null ? "On the return, not in the draft." : lodgedC === null ? "In the draft, not on the return." : null };
    });
    const est = draft.lines.find((l) => l.id === "estimate.taxable"), res = draft.lines.find((l) => l.id === "estimate.result");
    const taxable = { draft: est ? est.amount_cents : null, lodged: latest.taxable_income_cents, gap: est ? latest.taxable_income_cents - est.amount_cents : null };
    const result = { draft: res ? res.amount_cents : null, lodged: latest.result_cents, gap: res ? latest.result_cents - res.amount_cents : null };
    const differs = rows.filter((r) => r.status !== "ties").length;
    const engineTie = (L.tax.ties || []).find((t) => t.person === person && t.fy === fy) || null;
    return {
      pack_id: draft.id, draft_version: draft.version, fy, person,
      return: { return_id: latest.return_id, version: latest.version, lodged_on: latest.lodged_on, assessed_on: latest.assessed_on, status: latest.status, supersedes: latest.supersedes_return_id },
      versions: versions.map((r) => ({ return_id: r.return_id, version: r.version, assessed_on: r.assessed_on, taxable_income_cents: r.taxable_income_cents, result_cents: r.result_cents, status: versions.some((x) => x.supersedes_return_id === r.return_id) ? "superseded, kept" : r.status })),
      taxable, result, lines: rows, status: differs || (taxable.gap !== null && Math.abs(taxable.gap) > TOLERANCE) ? "differs" : "ties", differs, standard: engineTie ? { status: engineTie.status, gap_cents: engineTie.gap, result_gap_cents: engineTie.result_gap } : null,
    };
  }

  /* The next version: the same question asked again of everything now held, with what came back set beside the draft. */
  function take(draft, L, reference) {
    const rec = reconcile(draft, L);
    if (!rec) return null;
    const person = draft.scope.people[0].party_id, fy = draft.scope.period.fy;
    const next = Tax.build({ L, reference, person, fy, asOf: rec.return.assessed_on, version: draft.version + 1, supersedes: `${draft.id} version ${draft.version}` });
    next.state = rec.return.version > 1 ? "amended" : "assessed";
    next.takeback = rec;
    next.headline = [{ name: "Taxable income, as lodged", cents: rec.taxable.lodged }, { name: "Result, as assessed", cents: rec.result.lodged }];
    if (rec.status === "differs") next.gaps.push({ id: `G${next.gaps.length + 1}`, owner: "accountant", item: `The return differs from the draft at ${rec.differs} label${rec.differs === 1 ? "" : "s"}`, why: `See the Lodged tab. Taxable income: draft ${P.money(rec.taxable.draft)}, lodged ${P.money(rec.taxable.lodged)}. A lodged return outranks the draft, and a difference may mean something was missed.`, where: "Lodged tab", amount_cents: rec.taxable.gap || null, status: "Open", lines: [] });
    return next;
  }

  return { reconcile, take, TOLERANCE };
});
