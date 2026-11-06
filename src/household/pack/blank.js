/* The kit a stranger gets: the same workbook with nothing in it but its formulas. Every entry cell starts empty, and empty says "not found", never 0.
   It goes through the same renderer as a real pack, so the kit cannot drift from the product. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "blank", ["pack", "tax"], function (P, Tax) {
  "use strict";
  function build({ fy, reference, person = "Your name", properties = 1 }) {
    const D = Tax.fyDates(fy), lines = [], ask = (o) => lines.push(P.line({ state: "not_asked", evidence_state: "missing", ...o }));
    for (let i = 0; i < 3; i++) ask({ id: `income.employment.${i}`, section: "income.employment", label: "1", engine: "1", name: `Employer ${i + 1}`, fields: { period: D.long } });
    ask({ id: "memo.it1", section: "memo.items", label: "IT1", name: "Reportable fringe benefits" });
    ask({ id: "memo.it2", section: "memo.items", label: "IT2", name: "Reportable employer super (salary sacrifice only, not compulsory SG)" });
    ask({ id: "memo.concessional", section: "memo.items", name: "Concessional super contributions (SG plus salary sacrifice)" });
    for (let i = 0; i < 4; i++) ask({ id: `income.interest.${i}`, section: "income.interest", label: "10", engine: "10", name: `Account ${i + 1}`, fields: { share_bps: 10000 } });
    for (const [label, name] of [["11T", "Dividends - franked"], ["11U", "Dividends - franking credit"]]) ask({ id: `income.dividends.${label}`, section: "income.dividends", label, engine: label, name });
    for (const [label, name] of [["13U", "Trust income, non primary production"], ["13C", "Trust franked distributions"], ["13Q", "Trust franking credit"], ["20M", "Other net foreign source income"]]) ask({ id: `income.trusts.${label}`, section: "income.trusts", label, engine: label, name });
    ask({ id: "income.other.24", section: "income.other", label: "24", engine: "24", name: "Other income" });
    for (const [label, name, n] of [["D1", "Work-related car expenses", 1], ["D3", "Work-related clothing, laundry", 1], ["D4", "Work-related self-education", 1], ["D5", "Other work-related expenses", 4], ["D9", "Gifts or donations", 2], ["D10", "Cost of managing tax affairs", 1]]) for (let i = 0; i < n; i++) ask({ id: `income.work.${label}.${i}`, section: "income.work", label, engine: label, name: n > 1 ? `${name}, item ${i + 1}` : name });
    for (let i = 0; i < 2; i++) ask({ id: `income.health.${i}`, section: "income.health", label: "M1", name: `Health fund, period ${i + 1}` });
    ask({ id: "income.spouse", section: "income.spouse", label: "Spouse", name: "Spouse taxable income" });
    for (let i = 0; i < 4; i++) ask({ id: `shares.ess.${i}`, section: "shares.ess", label: "12F", engine: "12", name: `Grant or vest ${i + 1}` });
    for (let i = 0; i < 6; i++) ask({ id: `shares.parcel.${i}`, section: "shares.parcels", label: "18", name: `Parcel ${i + 1}`, fields: { share_bps: 10000 } });
    ask({ id: "shares.split.carry", section: "shares.split", name: "Capital losses carried in" });
    for (let i = 0; i < 5; i++) ask({ id: `loans.row.${i}`, section: "loans.rows", name: `Loan ${i + 1}`, fields: {} });
    const props = [];
    for (let i = 0; i < properties; i++) {
      const id = `P${i + 1}`, sec = `property.${id}`;
      props.push({ id, activity: id, name: `Property ${i + 1}`, tab: `Property ${i + 1}`, section: sec, share_bps: 10000, location: "Property address", acquired_on: null, lease_from: null });
      ask({ id: `${sec}.rent.agent`, section: `${sec}.income`, name: "Rent received via managing agent", fields: { rolls: "21P" } });
      ask({ id: `${sec}.rent.direct`, section: `${sec}.income`, name: "Rent received directly", fields: { rolls: "21P" } });
      ask({ id: `${sec}.rent.other`, section: `${sec}.income`, name: "Tenant reimbursements", fields: { rolls: "21P" } });
      for (const [k, name] of [["fees", "Management and admin fees"], ["rates", "Council rates"], ["water", "Water rates"], ["repairs", "Repairs and maintenance"]]) ask({ id: `${sec}.agent.${k}`, section: `${sec}.agent`, name, fields: { rolls: "21X" } });
      ask({ id: `${sec}.agent.stated`, section: `${sec}.check`, name: "Money out, as the agent's statement adds it" });
      ask({ id: `${sec}.direct.insurance`, section: `${sec}.direct`, name: "Landlord insurance", fields: { rolls: "21X" } });
      ask({ id: `${sec}.direct.rates`, section: `${sec}.direct`, name: "Council or water paid directly", fields: { rolls: "21X" } });
      ask({ id: `${sec}.direct.interest`, section: `${sec}.direct`, label: "21Q", name: "Loan interest - deductible (from Loan Interest)", fields: { rolls: "21Q" } });
      ask({ id: `${sec}.direct.div40`, section: `${sec}.direct`, name: "Decline in value (Div 40)", fields: { rolls: "21X" } });
      ask({ id: `${sec}.direct.div43`, section: `${sec}.direct`, label: "21F", name: "Capital works (Div 43)", fields: { rolls: "21F" } });
      ask({ id: `${sec}.capital.0`, section: `${sec}.capital`, name: "Capital item, not claimed" });
    }
    const sum = (id, section, label, name, tab, engine) => lines.push(P.line({ id, section, label, engine: engine || label, name, state: "not_asked", kind: "calculated", evidence_state: "missing", fields: { tab } }));
    for (const [l, name, tab] of [["1", "Salary or wages - gross", "Income"], ["10", "Gross interest", "Income"], ["11T", "Dividends - franked", "Income"], ["11U", "Dividends - franking credit", "Income"], ["13U", "Trust income, non primary production", "Income"], ["13C", "Trust franked distributions", "Income"], ["13Q", "Trust franking credit", "Income"], ["20M", "Other net foreign source income", "Income"], ["24", "Other income", "Income"]]) sum(`summary.${l}`, "income.summary", l, name, tab);
    sum("summary.12", "income.summary", "12F", "ESS discount - deferral schemes", "Shares", "12");
    sum("summary.18A", "income.summary", "18A", "Net capital gain", "Shares", "18A");
    for (const [l, name] of [["21P", "Gross rent"], ["21Q", "Interest deductions"], ["21F", "Capital works deductions"], ["21X", "Other rental deductions"]]) sum(`summary.${l}`, "rent.summary", l, name, "Property");
    for (const [l, name] of [["D1", "Work-related car expenses"], ["D3", "Work-related clothing, laundry"], ["D4", "Work-related self-education"], ["D5", "Other work-related expenses"], ["D9", "Gifts or donations"], ["D10", "Cost of managing tax affairs"]]) sum(`summary.${l}`, "deductions.summary", l, name, "Income");
    const gaps = [{ id: "G1", owner: "taxpayer", item: "Income statement", why: "Salary and tax withheld.", where: "myGov, once it says Tax ready", amount_cents: null, status: "Open", lines: [] }, { id: "G2", owner: "taxpayer", item: "Bank interest", why: "Assessable, and the tax office matches it.", where: "Bank statements or the tax office's pre-fill", amount_cents: null, status: "Open", lines: [] }, { id: "G3", owner: "taxpayer", item: "Private health statement", why: "Rebate reconciliation and the surcharge test.", where: "Health fund or pre-fill", amount_cents: null, status: "Open", lines: [] }, { id: "G4", owner: "taxpayer", item: "All share disposals", why: "Every sale must be declared.", where: "Broker's annual statement", amount_cents: null, status: "Open", lines: [] }, { id: "G5", owner: "accountant", item: "Repair shortly after purchase", why: "Initial repairs are usually capital, not deductible. Which applies here?", where: "", amount_cents: null, status: "Open", lines: [] }, { id: "G6", owner: "accountant", item: "Replacement or repair", why: "Replacing a whole asset is depreciated; fixing one is deductible.", where: "", amount_cents: null, status: "Open", lines: [] }, { id: "G7", owner: "accountant", item: "Foreign currency convention", why: "Actual conversion rate used, or the official rate on the date?", where: "", amount_cents: null, status: "Open", lines: [] }];
    const pack = P.make({ kind: "tax", id: `kit-${fy}`, audience: "accountant", question: `What belongs on this person's ${D.label} return, and what stands behind each number?`, scope: { people: [{ party_id: "YOU", name: person }], period: { from: D.start, to: D.end, label: D.label, long: D.long, fy }, subject: "individual_return", properties: props, spouse: null, has_help: true }, as_of: D.end, boundary: Tax.BOUNDARY, parameters: Tax.parametersFor(reference, D.end), lines, evidence: [], gaps });
    pack.blank = true;
    return pack;
  }
  return { build };
});
