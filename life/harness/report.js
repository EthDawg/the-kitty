/* The plain report, for a person. */
"use strict";
const pad = (s, n) => String(s).padEnd(n);
const count = (traps, chapter, v) => Object.values(traps).filter((t) => t.ch === chapter && t.verdict === v).length;
function row(r, c) {
  const tied = `${c.truth.tied}/${c.truth.tied + c.truth.off.length}`;
  const money = c.status.find((w) => /: \$/.test(w)) || c.status[1] || "";
  return { chapter: c.chapter, saw: `${money} Then: ${c.next.say}`, tied, handled: count(r.traps, c.chapter, "handled"), flagged: count(r.traps, c.chapter, "flagged"), wrong: count(r.traps, c.chapter, "silently_wrong"), notrun: count(r.traps, c.chapter, "not_run"), questions: c.questions };
}
function table(results, { fails, improved }) {
  const lines = [];
  for (const r of results) {
    lines.push(`${r.family} on ${r.store}, ${(r.ms / 1000).toFixed(1)}s`);
    for (const c of r.chapters) { const x = row(r, c); lines.push(`  ch${x.chapter} ${pad(c.title, 22)} truth ${pad(x.tied, 11)} handled ${pad(x.handled, 3)} flagged ${pad(x.flagged, 3)} wrong ${pad(x.wrong, 2)} q ${pad(x.questions, 3)} ${x.saw}`); }
  }
  lines.push("");
  const silent = new Set(results.flatMap((r) => Object.entries(r.traps).filter(([, t]) => t.verdict === "silently_wrong").map(([id]) => `${r.family} ${id}`)));
  lines.push(`Silently wrong, recorded: ${silent.size}`);
  for (const s of [...silent].sort()) lines.push(`  ${s}`);
  if (improved.length) { lines.push("Better than life/expected.json:"); for (const i of improved) lines.push(`  ${i}`); }
  lines.push(fails.length ? `FAILED, ${fails.length}:` : "All chapters pass.");
  for (const f of fails.slice(0, 40)) lines.push(`  ${f}`);
  return lines.join("\n");
}
function report(results, { fails, improved }) {
  const davies = results.find((r) => !r.variant) || results[0], out = [];
  out.push("# Scripted run: the Davies, chapters 0 to 6", "", `Written by \`node life/run.js --report\`. ${results.length} runs: ${[...new Set(results.map((r) => r.family))].join(", ")}, each on ${[...new Set(results.map((r) => r.store))].join(" and ")}. ${fails.length ? `${fails.length} failures.` : "Every chapter passes."} Fiction, and not tax advice.`, "");
  const rowsFor = (r) => r.chapters.map((c) => { const x = row(r, c); return `| ${c.chapter} | ${c.title} | ${String(x.saw).replace(/\|/g, "/")} | ${x.tied} | ${x.handled} | ${x.flagged} | ${x.wrong} | ${x.questions} |`; });
  const head = ["| Ch | Chapter | What a person saw last | Truth tied | Traps handled | Flagged | Silently wrong | Questions asked |", "|---|---|---|---|---|---|---|---|"];
  out.push("## The Davies", "", ...head, ...rowsFor(davies), "");
  for (const r of results.filter((x) => x.variant && x.store === davies.store)) out.push(`## ${r.family}, a variant family`, "", ...head, ...rowsFor(r), "");
  if (davies.join) out.push("## Joining day", "", `${davies.join.asked} questions, each with a default:`, "", ...davies.join.questions.map((q) => `- ${q}`), "", `${davies.join.rebound_decisions} decisions rebound, ${davies.join.unbound} unbound. Each person's history stayed home: ${davies.join.private.map((p) => `${p.by} ${p.lines} lines`).join(", ")}. Asked in advance, sharing back a month would have touched ${davies.join.what_if.join(", ") || "no locked month"}.`, "");
  if (davies.share) out.push(`At tax time both shared their year, which touched ${davies.share.proposals.length} locked months, each a reopen proposal.`, "");
  if (davies.pocket) { const p = davies.pocket; out.push("## Pocket money, on a store", "", `Bands from research: ${p.stages.join(", ")}. The ledger did not move: bundle hash ${p.bundle_same ? "unchanged" : "CHANGED"}, ${p.ledger_memo_cents} cents of memo in the household's totals. Update dry run: ${p.dry.summary} ${p.dry.proposals} reopen proposals, ${p.dry.moved} category amounts move. Taken: originals changed ${p.taken.originals_changed.length}, ${p.taken.locked} locked months with ${p.taken.locked_moved.length} moved, ${p.taken.unbound} unbound decisions, ${p.taken.carried.map((c) => `${c.rows} rows ${c.from} to ${c.to}`).join(", ")}. At 18, ${p.spawned.rows} rows and $${(p.spawned.moved_cents / 100).toFixed(2)} went with the eldest through spawn, and what stayed adds to nil.`, ""); }
  if (davies.move) out.push("## The base of chapter 8", "", `Everything moved from a ${davies.move.from} store to a ${davies.move.to} store. Bundle hash ${davies.move.hash.source} on both: ${davies.move.hash.same ? "identical" : "DIFFERENT"}. The old store says it has moved and refuses a file.`, "");
  out.push("## Traps", "", "| Trap | Chapter | Verdict | Note |", "|---|---|---|---|");
  for (const [id, t] of Object.entries(davies.traps)) out.push(`| ${id} | ${t.ch} | ${t.verdict} | ${String(t.note).replace(/\|/g, "/")} |`);
  const silent = new Map();
  for (const r of results) for (const [id, t] of Object.entries(r.traps)) if (t.verdict === "silently_wrong") silent.set(id, [...new Set([...(silent.get(id) || []), r.family])]);
  out.push("", "## Silently wrong, recorded", "");
  for (const [id, fam] of silent) out.push(`- ${id}: ${fam.join(", ")}`);
  if (fails.length) out.push("", "## Failures", "", ...fails.map((f) => `- ${f}`));
  if (improved.length) out.push("", "## Better than the ratchet", "", ...improved.map((f) => `- ${f}`));
  out.push("", `Timing: ${results.map((r) => `${r.family}/${r.store} ${(r.ms / 1000).toFixed(1)}s`).join(", ")}.`, "");
  return out.join("\n");
}
module.exports = { report, table };
