// The family profile is one source, and the portals' stand-in cast is honest about what it is.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const P = JSON.parse(fs.readFileSync(path.join(ROOT, "life", "davies", "profile.json"), "utf8"));
const CAST = require("../data/cast.json");
const setup = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "standard", ".build", "world", "setup", `${n}.json`), "utf8"));
const person = (id) => P.people.find((p) => p.id === id);

test("the canon holds, on the programme brief's dates", () => {
  expect(P.people.map((p) => p.first_name)).toEqual(["Danny", "Daisy", "Salt", "George", "Evie"]);
  expect(P.people.map((p) => p.born.slice(0, 4))).toEqual(["1993", "1995", "2028", "2030", "2033"]);
  expect(person("daisy").super.fund).toBe("HESTAbby");
  expect(person("danny").super.fund).toBe("Purrannuation");
  expect(person("daisy").business.gst).toContain("GST-free");
  expect(person("danny").business.name).toBeTruthy();
});

test("the profile is a new life and claims nothing of the benchmark world", () => {
  expect(P.not_the_benchmark).toContain("not the 2019 to 2027 benchmark world");
  const names = setup("party").filter((p) => p.kind === "person").map((p) => p.name);
  expect(names.sort(), "the world keeps its own people").toEqual(["Ava Davies", "Jordan Davies", "Mia Davies"]);
  expect(JSON.stringify(P.people)).not.toMatch(/Jordan|\bMia\b|\bAva\b/);
  expect(fs.readFileSync(path.join(ROOT, "life", "davies", "RENAME.md"), "utf8")).toContain("Status: parked");
});

test("each named sign-in stands on a real person in the benchmark world", () => {
  const parties = Object.fromEntries(setup("party").map((p) => [p.party_id, p]));
  for (const c of CAST.people) {
    expect(parties[c.party_id].name, c.id).toBe(`${c.papers_say} ${CAST.family_name}`);
    expect(c.names).toEqual(expect.arrayContaining([c.first_name.toLowerCase(), c.papers_say.toLowerCase()]));
  }
  expect(CAST._about).toContain("stand in");
});

test("PROFILE.md is written from the JSON", () => {
  execFileSync("node", ["life/davies/build-profile.js", "--check"], { cwd: ROOT, stdio: "pipe" });
});
