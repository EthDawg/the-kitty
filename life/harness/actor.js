/* How this family answers what `next` asks. Knowledge a person has, read from the world: what a line was, what they own, what a balance said. Each answer goes through a verb, and
   anything a person had to say is counted as a question. A step with no answer here ends the sitting, and the harness reports where it stopped. */
"use strict";
const { K } = require("./family");
const { addFiles, ask, tell } = require("./household");

const DOMAIN_WORDS = { credit_card: /card/i, super: /super/i };
function worldIdOf(hh, id) { for (const [w, h] of hh.ids) if (h === id) return w; return id; }
function lineOf(F, hh, ref) {
  const [account, date, cents] = ref.split("|"), acct = worldIdOf(hh, account);
  return F.sim.lines.find((l) => l.acct === acct && l.date === date && l.cents === Number(cents));
}
function categoryOf(line) {
  // Salary packaging lands as its own credit. A person knows it is pay, on top of the payslip, and it will never have a payslip of its own.
  if (line.packaging) return "SALARY-ALLOW";
  if (line.cat) return line.cat;
  const d = line.desc.toUpperCase();
  if (/PAYMENT RECEIVED|PAYMENT \d|CARD/.test(d)) return "CC-PAY";
  if (/\bATO\b/.test(d)) return "TAX-REFUND";
  return "TRANSFER";
}
function scopeAnswer(F, hh, domain, today) {
  const rows = F.setup.scope.filter((s) => s.domain === domain);
  const said = rows.filter((s) => s.recorded_at <= `${today}T23:59:59Z`).pop() || rows[0];
  if (said) return said.state;
  // What the family would say of something the script never mentions.
  return { rental: "none", crypto: "none", shares: "none", insurance: "unknown" }[domain] || "unknown";
}
const monthOf = (d) => d.slice(0, 7);
/* A bank moved its columns, so a public recipe claims the file and the gate refuses it. The family's agent writes the recipe for the new shape. Each stands or falls at the gate. */
async function writeRecipes(F, hh, today, account) {
  for (const recipe of F.answers) {
    const r = await K.addRecipe(hh.store, recipe, { today, author: "agent", account });
    if (r.status === "passed") return r;
  }
  return null;
}
function actor(F, opts = {}) {
  const pool = opts.pool || [];
  const fetch = async (hh, today, match) => {
    const got = pool.filter(match); if (!got.length) return false;
    for (const f of got) pool.splice(pool.indexOf(f), 1);
    await addFiles(hh, got, today); return true;
  };
  return async function act(step, ctx) {
    const { hh, today, built } = ctx, a = step.action.args || {}, say = (what) => ask(hh, today, what);
    const answers = {
      async start() { return false; },
      async first_file() { return false; },
      async needs_recipe() {
        const recipe = F.answers.find((r) => r.fingerprints.includes(a.fingerprint));
        if (!recipe) {
          say(`${step.say} A person says what it is.`);
          await K.decide(hh.store, { hold: a.source_id, reason: "There are no numbers in this file. Keep it as evidence." }, { today }); return true;
        }
        const s = (await hh.store.tables.read("source")).reverse().find((x) => x.source_id === a.source_id);
        const r = await K.addRecipe(hh.store, recipe, { today, author: "agent", account: s.stream_id || undefined });
        return r.status === "passed";
      },
      async refused() {
        const s = (await hh.store.tables.read("source")).reverse().find((x) => x.source_id === a.source_id);
        return !!(await writeRecipes(F, hh, today, s.stream_id || undefined));
      },
      async needs_agent() {
        say(`${step.say} Nobody keys it in today.`);
        await K.decide(hh.store, { hold: a.source_id, reason: "A picture. No recipe may claim it and no agent has read it." }, { today }); return true;
      },
      async categorise() {
        const item = built.L.review.find((r) => r.item_id === a.item), line = item && lineOf(F, hh, item.ref);
        if (!line) return false;
        say(step.say);
        await K.decide(hh.store, { item: a.item, category_id: categoryOf(line), always: true }, { today, built }); return true;
      },
      async payslips() { say(step.say); await K.decide(hh.store, { scope: { domain: "payroll", state: "has" } }, { today }); return true; },
      async scope() { say(step.say); await K.decide(hh.store, { scope: { domain: a.scope.domain, state: scopeAnswer(F, hh, a.scope.domain, today) } }, { today }); return true; },
      async no_balance() {
        const { account_id, as_at } = a.balance, t = F.truth.accounts[worldIdOf(hh, account_id)];
        const cents = t && t.months[monthOf(as_at)];
        if (cents == null) return false;
        say(step.say); await K.decide(hh.store, { balance: { account_id, as_at, cents } }, { today }); return true;
      },
      async missing_month() { return fetch(hh, today, (f) => (hh.ids.get(f.stream) || f.stream) === a.stream); },
      async stale() { return fetch(hh, today, (f) => (hh.ids.get(f.stream) || f.stream) === a.stream); },
      async close() { const r = await K.close(hh.store, a.month, { today }); return ["locked", "closed", "already"].includes(r.status); },
      async lock() { const r = await K.close(hh.store, a.month, { today }); return ["locked", "closed", "already"].includes(r.status); },
      // A check a person can't fix from here. They say so, with what would change their mind, and it stays visible as accepted.
      async does_not_add_up() {
        if (!/^L11\|/.test(a.check || "")) return false;
        say(step.say);
        await K.decide(hh.store, { check: a.check, reason: "The lodged return stands. The difference is not explained yet.", reopen_if: "The accountant explains it, or the engine's parcels change." }, { today }); return true;
      },
      async review() {
        say(step.say);
        await K.decide(hh.store, { seen: a.item, reason: "Nobody here can answer it yet.", reopen_if: "The plan's statements explain it." }, { today }); return true;
      },
      // One answer for every month the same evidence touched: a person says yes once.
      async seal_changed() {
        say(step.say);
        const failing = built.L.checks.filter((c) => c.law === "L12" && c.status === "fail").map((c) => c.scope);
        for (const m of [...new Set([a.reopen, ...failing])]) await K.decide(hh.store, { reopen: m, reason: "New evidence came in for it." }, { today });
        return true;
      },
    };
    const fn = answers[step.id];
    return fn ? fn() : false;
  };
}
module.exports = { actor, worldIdOf, lineOf, categoryOf, writeRecipes };
