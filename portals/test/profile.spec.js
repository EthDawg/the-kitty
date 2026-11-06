// The family profile: one source, with its world facts held to the world, so the two cannot drift apart.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const P = JSON.parse(fs.readFileSync(path.join(ROOT, "life", "davies", "profile.json"), "utf8"));
const setup = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "standard", ".build", "world", "setup", `${n}.json`), "utf8"));
const MONTHS = require("../data/months.json");
const person = (id) => P.people.find((p) => p.id === id);

test("the canon holds", () => {
  expect(P.people.map((p) => p.first_name)).toEqual(["Danny", "Daisy", "Salt", "George", "Evie"]);
  expect(person("danny").born.slice(0, 4)).toBe("1985");
  expect(person("daisy").born.slice(0, 4)).toBe("1987");
  expect(person("george").born > "2027-12-31").toBe(true);
  expect(person("evie").born > person("george").born).toBe(true);
  expect(person("daisy").super.fund).toBe("HESTAbby");
  expect(person("danny").super.fund).toBe("Purrannuation");
  expect(person("daisy").business.gst).toContain("GST-free");
  expect(person("danny").business.name).toBeTruthy();
});

test("every world fact agrees with the world", () => {
  const parties = Object.fromEntries(setup("party").map((p) => [p.party_id, p]));
  for (const p of P.people.filter((x) => x.world)) {
    expect(parties[p.world.party_id].name, p.id).toBe(`${p.world.first_name} ${p.family_name}`);
    expect(parties[p.world.party_id].birth_date, p.id).toBe(p.born);
  }
  const contracts = Object.fromEntries(setup("contract").map((c) => [c.contract_id, c]));
  for (const j of P.people.flatMap((p) => p.jobs || []).filter((j) => j.contract_id)) {
    expect(contracts[j.contract_id].name, j.employer).toBe(j.employer);
    expect(contracts[j.contract_id].started_on, j.employer).toBe(j.from);
    if (contracts[j.contract_id].ended_on) expect(contracts[j.contract_id].ended_on, j.employer).toBe(j.to);
  }
  const assets = Object.fromEntries(setup("asset").map((a) => [a.asset_id, a]));
  for (const h of P.things_held.properties) { expect(assets[h.asset_id].location).toBe(h.address); expect(assets[h.asset_id].acquired_on).toBe(h.settled); }
  expect(P.household.home.settled).toBe(assets.HOME.acquired_on);
  expect(P.household.home.address).toBe(assets.HOME.location);
  const accounts = Object.fromEntries(setup("account").map((a) => [a.account_id, a]));
  for (const a of P.things_held.accounts) if (accounts[a.id]) expect(accounts[a.id].opened_on, a.id).toBe(a.from);
  const truth = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "standard", ".build", "world", "truth", `${n}.json`), "utf8"));
  const settle = Object.fromEntries(truth("settlements").map((s) => [s.asset, s]));
  for (const h of P.things_held.properties.filter((x) => x.price)) expect(settle[h.asset_id].price_cents, h.asset_id).toBe(h.price * 100);
  const help = truth("help").pop();
  const row = person("daisy").help.find((h) => h.account_id === "HELP-M");
  expect(help.balance_cents).toBe(Math.round(row.balance * 100));
  expect(help.date).toBe(row.balance_at);
});

test("every pay rise in the profile is the world's, to the fortnight and the dollar", () => {
  for (const id of ["danny", "daisy"]) {
    const p = person(id);
    const pays = MONTHS.payslips.filter((x) => x[1] === p.world.first_name);
    for (const r of p.pay) {
      const pay = pays.find((x) => x[0] === r.from);
      expect(pay, `${id} ${r.from}`).toBeTruthy();
      expect(Math.round(pay[3] * 26), `${id} ${r.from}`).toBe(r.annual_gross);
    }
    for (const b of p.bonuses || []) { const pay = pays.find((x) => x[0] === b.paid); expect(Math.round(pay[3] - pays[pays.indexOf(pay) + 1][3]), `${id} ${b.paid}`).toBe(b.gross); }
  }
});

test("PROFILE.md is written from the JSON", () => {
  execFileSync("node", ["life/davies/build-profile.js", "--check"], { cwd: ROOT, stdio: "pipe" });
});
