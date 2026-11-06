#!/usr/bin/env node
/* PROFILE.md is written from profile.json, so the two cannot disagree. node life/davies/build-profile.js writes it; --check fails if it is stale. */
"use strict";
const fs = require("fs");
const path = require("path");

const P = JSON.parse(fs.readFileSync(path.join(__dirname, "profile.json"), "utf8"));
const OUT = path.join(__dirname, "PROFILE.md");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const date = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const money = (n) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })}`;
const nameOf = (id) => P.people.find((p) => p.id === id).first_name;
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];

const person = (p) => {
  const out = [`## ${p.first_name} ${p.family_name}`, "", `Born ${date(p.born)}. ${p.summary}`, ""];
  if (p.world) out.push(`The world still calls ${p.first_name} ${p.world.first_name} (\`${p.world.party_id}\`). See [RENAME.md](RENAME.md).`, "");
  if (p.study) out.push("**Study**", "", ...p.study.map((s) => `- ${s.what}, ${s.where}, ${date(s.from)} to ${date(s.to)}.`), "");
  if (p.help) out.push("**HELP**", "", ...p.help.map((h) => `- ${h.what}: ${h.repaid_by ? `${money(h.borrowed)} borrowed, repaid by ${date(h.repaid_by)}` : `opened ${date(h.opened)}, ${money(h.balance)} owing at ${date(h.balance_at)}`}.`), "");
  if (p.jobs) out.push("**Work**", "", ...table(["Employer", "Role", "From", "To"], p.jobs.map((j) => [j.employer, j.title, date(j.from), date(j.to)])), "");
  if (p.pay) out.push("**Pay rises**", "", ...table(["From", "Annual gross", "Note"], p.pay.map((x) => [date(x.from), money(x.annual_gross), x.note || ""])), "");
  if (p.bonuses) out.push(`**Bonuses:** ${p.bonuses.map((b) => `${money(b.gross)} on ${date(b.paid)}`).join(", ")}.`, "");
  if (p.leave) out.push("**Leave**", "", ...p.leave.map((l) => `- ${l.what} (${date(l.from)} to ${date(l.to)}).`), "");
  if (p.super) out.push(`**Super:** ${p.super.fund}, member ${p.super.member}.`, "");
  if (p.salary_packaging) out.push(`**Salary packaging:** ${p.salary_packaging.state} ${p.salary_packaging.note}`, "");
  if (p.shares) out.push(`**Shares:** ${p.shares.plan}, ${p.shares.units_per_quarter} ${p.shares.code} units a quarter from ${date(p.shares.first_vest)}. ${p.shares.issuer} is listed in ${p.shares.currency}.`, "");
  if (p.childcare) out.push(`**Childcare:** ${p.childcare.provider} from ${date(p.childcare.from)}.`, "");
  if (p.milestones) out.push("**Milestones**", "", ...p.milestones.map((m) => `- ${date(m.date)}: ${m.what}.`), "");
  if (p.business) {
    const b = p.business;
    out.push(`**Business: ${b.name}, from ${date(b.from)}.** ${b.what} ${b.structure}`, "", `- GST: ${b.gst}`, `- BAS: ${b.bas}`);
    if (b.caution) out.push(`- ${b.caution}`);
    out.push("");
  }
  return out;
};

const T = P.things_held;
const lines = [
  "# The Davies family", "",
  "Generated from [profile.json](profile.json) by `build-profile.js`. Edit the JSON, not this page.", "",
  P.about, "",
  "Each fact in the JSON says where it came from. **Canon** is the project owner's. **World** is already stated by `standard/world` and a test holds it there. **Invented** is ours to change.", "",
  "Danny and Daisy are referred to by name throughout. The children's pronouns are unstated, so write *they* or avoid one.", "",
  `**Voice.** ${P.voice}`, "",
  ...table(["Person", "Born", "Role"], P.people.map((p) => [`${p.first_name} ${p.family_name}`, date(p.born), p.role])), "",
  ...P.people.flatMap(person),
  "## What the household holds", "",
  "**Properties**", "",
  ...table(["Property", "Address", "Settled", "Owners", "Use"], T.properties.map((x) => [x.name, x.address, date(x.settled), x.owners.map(nameOf).join(" and "), x.use])), "",
  "**Accounts**", "",
  ...table(["Account", "At", "Held by", "From", "Note"], T.accounts.map((a) => [a.name, a.at, a.holders.map(nameOf).join(" and "), date(a.from), a.note || ""])), "",
  "**Vehicles**", "",
  ...T.vehicles.map((v) => `- ${v.name}, from ${date(v.acquired)}${v.disposed ? ` to ${date(v.disposed)}` : ""}.`), "",
  "## Advisers", "",
  ...P.advisers.map((a) => `- **${a.name}.** ${a.role}`), "",
];
const text = lines.join("\n");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, "utf8") !== text) { console.error("PROFILE.md is stale. Run node life/davies/build-profile.js"); process.exit(1); }
  console.log("PROFILE.md is current");
} else { fs.writeFileSync(OUT, text); console.log("wrote PROFILE.md"); }
