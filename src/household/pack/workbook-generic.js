/* Any pack as a plain workbook: what was asked, every line with its file, what is missing. An instance earns its own layout when its audience expects one,
   as an accountant does; until then this is enough, and it proves the shape needs no tax-specific code to reach a person. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "workbookGeneric", ["pack", "xlsx"], function (P, X) {
  "use strict";
  const { Sheet } = X;
  const HELD = { held: ["Held", "ok"], at_risk: ["At risk", "warn"], missing: ["Missing", "stop"], not_needed: ["-", "muted"] };

  function render(pack) {
    const files = new Map(pack.evidence.map((e) => [e.ref, e])), who = pack.scope.people.map((p) => p.name).join(" and ");
    const s = new Sheet("Summary", { cols: [34, 18, 70], color: "23304A" });
    s.span(`${pack.title || pack.kind.toUpperCase()} | ${who} | ${pack.scope.period.label}`, "title", { ht: 24 });
    s.span(pack.question, "note");
    s.span(`Prepared from what was held on ${P.longDate(pack.as_of)}. ${pack.boundary.join(" ")}`, "note");
    s.gap();
    for (const h of pack.headline) s.row([{ v: h.name, s: "wrap" }, h.cents === null ? { v: "not found", s: "notFound" } : { v: h.cents / 100, s: "calc" }]);
    const ln = new Sheet("Lines", { cols: [20, 44, 15, 13, 12, 40, 14, 9, 40], color: "1F6FB2", freeze: 1 });
    ln.row(["Section", "Line", "Amount AUD", "Basis", "Status", "Evidence", "Page or row", "Held?", "Note"].map((c, i) => ({ v: c, s: i === 2 ? "headR" : "head" })));
    for (const l of pack.lines) {
      const list = l.evidence.filter((c) => { const e = files.get(c.ref); return e && !e.withheld; }), uniq = [...new Set(list.map((c) => c.ref))], [ht, hs] = HELD[l.evidence_state] || ["-", "muted"];
      const a = l.state === "not_found" ? { v: "not found", s: "notFound" } : { v: l.amount_cents / 100, s: l.kind === "calculated" ? "calc" : "input" };
      const file = uniq.length === 1 ? { v: files.get(uniq[0]).path.split("/").pop(), file: files.get(uniq[0]).path, s: "link" } : { v: uniq.length ? `${uniq.length} files` : "None held", s: "muted", go: uniq.length ? `ev.${l.id}` : undefined };
      ln.row([{ v: l.section, s: "muted" }, { v: l.name, s: "wrap" }, a, { v: l.basis === "stock" ? `At ${l.as_at}` : "Over the period", s: "muted" }, { v: l.state === "not_found" ? "Not found" : l.state === "nil" ? "Nil" : "Value", s: l.state === "not_found" ? "stop" : "text" }, file, { v: uniq.length === 1 ? [...new Set(list.map((c) => c.locator))].slice(0, 3).join(", ") : null, s: "muted" }, { v: ht, s: hs }, { v: l.state === "nil" ? `Nil: ${l.nil_basis}` : l.note, s: "muted" }]);
    }
    const ev = new Sheet("Evidence", { cols: [44, 62, 16, 12], color: "4A4A55", freeze: 1 });
    ev.row(["Line", "File", "Page or row", "File ref"].map((c) => ({ v: c, s: "head" })));
    for (const l of pack.lines) { let first = true; for (const c of l.evidence) { const e = files.get(c.ref); ev.row([{ v: l.name, s: "wrap", key: first ? `ev.${l.id}` : undefined }, e.withheld ? { v: `${e.path.split("/").pop()} (held back)`, s: "warn" } : { v: e.path.replace(/^evidence\//, ""), file: e.path, s: "link" }, { v: c.locator, s: "muted" }, { v: e.ref, s: "muted" }]); first = false; } }
    const g = new Sheet("Open Items", { cols: [44, 56, 40, 15, 12], color: "B3261E" });
    g.row(["Item", "Why it is needed", "Where to get it", "Amount", "Owner"].map((c, i) => ({ v: c, s: i === 3 ? "headR" : "head" })));
    for (const x of pack.gaps) g.row([{ v: x.item, s: "wrap" }, { v: x.why, s: "wrap" }, { v: x.where, s: "wrap" }, x.amount_cents === null ? { v: "unknown", s: "muted" } : { v: x.amount_cents / 100, s: "input" }, { v: x.owner, s: "warn" }]);
    if (!pack.gaps.length) g.row([{ v: "Nothing open.", s: "muted" }]);
    const book = { sheets: [s, ln, ev, g] };
    const solved = X.resolve(book);
    return { book, ties: [], valueOf: solved.valueOf };
  }

  return { render };
});
