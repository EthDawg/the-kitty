/* The second instance, small on purpose: what a lender asks of a couple applying together. It is here to test the shape, and it did change it.
   Tax asks about one person over one year. A lender asks about two people on one day, so scope holds people and a period rather than a person and a year,
   and a line can be a balance true on a date (`basis: stock`, `as_at`) rather than a flow across the period. Every tax line reads the same as before. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "lender", ["pack", "evidence"], function (P, E) {
  "use strict";
  const { line } = P;
  const shift = (d, months) => { const [y, m] = d.split("-").map(Number), t = y * 12 + (m - 1) + months; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-${d.split("-")[2]}`; };

  function build({ L, people, asOf }) {
    const R = L.resolver, book = new E.Book(L), lines = [], gaps = [], X = L.index;
    const from = shift(asOf, -12), month = asOf.slice(0, 7);
    const gap = (o) => gaps.push({ id: `G${gaps.length + 1}`, status: "Open", amount_cents: null, lines: [], ...o });
    const who = people.map((id) => L.parties.find((p) => p.party_id === id)).filter(Boolean);
    const push = (o) => lines.push(line({ section: "x", ...o }));

    // Income: the two latest payslips for each person, annualised from the year to date is the lender's job, so the pack hands over the evidence and the year-to-date figure.
    who.forEach((p) => {
      const f = book.folder(`Income ${p.name}`);
      const slips = (R.byKind.get("payslip") || []).filter((o) => R.partyOf(o.payload.person_ref, o.payload.pay_date) === p.party_id && o.payload.pay_date <= asOf).sort((a, b) => (a.payload.pay_date < b.payload.pay_date ? 1 : -1)).slice(0, 2);
      if (slips.length) {
        const s = slips[0].payload;
        push({ id: `income.${p.party_id}`, section: "income.summary", name: `${p.name}, ${s.employer_ref}, gross year to date`, amount_cents: s.ytd_gross_cents ?? s.gross_cents, basis: "stock", as_at: s.pay_date, evidence: slips.map((o) => book.cite(o, f)), evidence_state: "held", fields: { counted: true } });
      } else {
        push({ id: `income.${p.party_id}`, section: "income.summary", name: `${p.name}, salary`, state: "not_found", evidence_state: "missing", fields: { counted: true } });
        gap({ owner: "household", item: `Payslips, ${p.name}`, why: "Lenders ask for the two most recent.", where: "Employer's pay system" });
      }
      const noas = R.collapseDocs("tax_assessment").filter((o) => R.partyOf(o.payload.person_ref, o.payload.assessed_on) === p.party_id && o.payload.assessed_on <= asOf).sort((a, b) => (a.payload.assessed_on < b.payload.assessed_on ? 1 : -1)).slice(0, 1);
      if (noas.length) push({ id: `noa.${p.party_id}`, section: "income.summary", name: `${p.name}, taxable income, ${noas[0].payload.fy}`, amount_cents: noas[0].payload.taxable_income_cents, basis: "flow", evidence: noas.map((o) => book.cite(o, f)), evidence_state: "held", fields: { counted: true } });
      else gap({ owner: "household", item: `Latest notice of assessment, ${p.name}`, why: "Lenders ask for it when income has a rental or bonus part.", where: "myGov" });
    });
    // Rent over the twelve months, in the owners' share.
    for (const a of (L.activities || []).filter((x) => x.kind === "rental")) {
      const as = L.assets.find((x) => x.asset_id === a.asset_id), f = book.folder(`Rent ${as.name}`);
      const st = (R.byKind.get("owner_statement") || []).filter((o) => { const q = o.payload, id = R.alias("asset", q.property_ref, q.period_end); return (id === a.asset_id || q.property_ref === a.asset_id) && q.period_end > from && q.period_end <= asOf; });
      push(st.length ? { id: `rent.${a.asset_id}`, section: "income.summary", name: `Rent, ${as.name}, ${st.length} months`, amount_cents: st.reduce((s, o) => s + (o.payload.gross_rent_cents || 0), 0), evidence: st.map((o) => book.cite(o, f)), evidence_state: "held", fields: { counted: true } } : { id: `rent.${a.asset_id}`, section: "income.summary", name: `Rent, ${as.name}`, state: "not_found", evidence_state: "missing", fields: { counted: true } });
    }
    // Liabilities: what is owed on the day, to whom.
    const f = book.folder("Liabilities");
    const bal = (id) => { const v = L.balances.at(id, month); return v === null || v === undefined ? null : v; };
    for (const c of L.contracts.filter((x) => x.kind === "loan" && x.account_id)) {
      const a = X.accounts.get(c.account_id); if (a.opened_on && a.opened_on > asOf) continue;
      const st = (R.byKind.get("loan_statement") || []).filter((o) => { const q = o.payload; return (R.alias("contract", q.account_ref, q.period_end) === c.contract_id || R.alias("account", q.account_ref, q.period_end) === c.account_id) && q.period_end <= asOf; }).sort((x, y) => (x.payload.period_end < y.payload.period_end ? 1 : -1))[0];
      const owed = st ? st.payload.closing_cents : bal(c.account_id) === null ? null : Math.abs(bal(c.account_id));
      push({ id: `debt.${c.contract_id}`, section: "liabilities.summary", name: c.name, amount_cents: owed, state: owed === null ? "not_found" : owed === 0 ? "nil" : "value", nil_basis: owed === 0 ? "The lender's statement shows nothing owing." : null, basis: "stock", as_at: st ? st.payload.period_end : asOf, evidence: st ? [book.cite(st, f)] : [], evidence_state: st ? "held" : "at_risk", fields: { counted: true } });
    }
    for (const a of L.accounts.filter((x) => x.type === "credit_card")) {
      const limit = L.terms.find((t) => t.subject_id === a.account_id && t.term === "credit_limit");
      const id = `limit.${a.account_id}`;
      push(limit ? { id, section: "liabilities.summary", name: `${a.name}, limit`, amount_cents: Math.round(Number(limit.value) * 100), basis: "stock", as_at: asOf, evidence_state: "at_risk", fields: { counted: true } } : { id, section: "liabilities.summary", name: `${a.name}, limit`, state: "not_found", basis: "stock", as_at: asOf, evidence_state: "missing", fields: { counted: true }, note: "A lender counts the limit, not the balance." });
      if (!limit) gap({ owner: "household", item: `Credit limit, ${a.name}`, why: "Lenders assess the limit, not what is owed. The Kitty has no limit recorded.", where: "The card's latest statement" });
    }
    for (const a of L.accounts.filter((x) => x.type === "help_debt")) {
      const o = (R.byKind.get("help_balance") || []).filter((h) => h.payload.as_at <= asOf).sort((x, y) => (x.payload.as_at < y.payload.as_at ? 1 : -1))[0];
      push(o ? { id: `help.${a.account_id}`, section: "liabilities.summary", name: a.name, amount_cents: o.payload.balance_cents, basis: "stock", as_at: o.payload.as_at, evidence: [book.cite(o, f)], evidence_state: "held", fields: { counted: true } } : { id: `help.${a.account_id}`, section: "liabilities.summary", name: a.name, state: "not_found", basis: "stock", as_at: asOf, evidence_state: "missing", fields: { counted: true } });
    }
    gap({ owner: "lender", item: "Serviceability", why: "This pack shows what is held. It does not work out borrowing capacity.", where: "Your own calculator" });

    const { list, map } = book.seal();
    for (const l of lines) l.evidence = l.evidence.filter(Boolean).map((c) => ({ ...c, ref: map.get(c.ref) }));
    const byRef = new Map(list.map((e) => [e.ref, e]));
    for (const l of lines) for (const c of l.evidence) byRef.get(c.ref).supports.add(l.name);
    const owed = lines.filter((l) => l.section === "liabilities.summary" && !/, limit$/.test(l.name));
    const pack = P.make({
      kind: "lender", id: `lender-${people.join("-")}-${asOf}`, audience: "lender", question: `What do ${who.map((p) => p.name).join(" and ")} earn and owe on ${P.longDate(asOf)}, and what shows it?`,
      scope: { people: who.map((p) => ({ party_id: p.party_id, name: p.name })), period: { from, to: asOf, label: `12 months to ${P.longDate(asOf)}` }, subject: "borrowing" },
      as_of: asOf, boundary: ["This shows what the household holds. It is not an application and not a statement of borrowing capacity.", "No tax file number is in this pack."],
      headline: [{ name: "Owed across all loans and HELP, where known", cents: owed.reduce((s, l) => s + (l.amount_cents || 0), 0) }], lines, evidence: list.map((e) => ({ ...e, supports: [...e.supports] })), gaps,
    });
    pack.title = "Lender pack";
    return P.validate(pack);
  }

  return { build };
});
