/* A blank Kitty, in any empty store. No template and no copy: the tabs come from the generated list, and nothing about any other family comes with
   them. A store that is not empty and not ours is refused, by name. One half made by a run that was cut off is finished. */
"use strict";
const { blankManifest } = require("./store/port");
const { TABS, STANDARD_VERSION, ABOUT } = require("./tabs");

/* A person belongs from before the first file, however late they start. Dated from the day they signed up, three months of backfilled statements
   would belong to nobody: the engine counts what members own on the day, and rightly. */
const SINCE = "1900-01-01";
const slug = (s) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
const stamp = (today) => `${today}T00:00:00Z`;
const fail = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });

function dayOne(store) {
  const about = store.capabilities.hides_tabs ? [ABOUT] : [];
  return { shown: [...about, ...TABS.filter((t) => t.visible).map((t) => t.tab)], hidden: TABS.filter((t) => !t.visible).map((t) => t.tab), total: TABS.length + about.length, cells: TABS.reduce((n, t) => n + t.rows * t.headers.length, 0) };
}
function peopleRows(people, today) {
  const party = [], membership = [], seen = new Set();
  for (const p of people) {
    const who = typeof p === "string" ? { name: p } : p;
    let id = slug(who.name);
    for (let n = 2; seen.has(id); n += 1) id = `${slug(who.name)}-${n}`;
    seen.add(id);
    party.push({ party_id: id, kind: "person", name: who.name, birth_date: who.birth_date });
    membership.push({ party_id: id, role: who.role || "adult", valid_from: who.since || SINCE, recorded_at: stamp(today) });
  }
  return { party, membership };
}
async function init(store, { name, people = [], today, household } = {}) {
  if (!today) throw fail("no_today", "init needs today: the clock is the host's to give.");
  if (!name && !household) throw fail("no_name", "A household needs a name.");
  const probe = await store.probe();
  if (probe.recognised) {
    if (probe.manifest.standard_version !== STANDARD_VERSION) throw fail("newer_standard", `This Kitty was written by ${probe.manifest.standard_version}. This one reads ${STANDARD_VERSION}, so it will not write.`);
    if (probe.manifest.state === "ready") return { already: true, household_id: probe.manifest.household_id, tabs: dayOne(store) };
  } else if (!probe.empty) {
    const what = probe.looks_like ? `This looks like ${probe.looks_like}, which is not a blank store.` : "This is not empty, and it is not a Kitty.";
    throw fail("not_empty", `${what} Nothing was changed. Found: ${probe.found.slice(0, 8).join(", ")}.`, { found: probe.found });
  } else await store.create(blankManifest());
  const row = household || { household_id: `H-${slug(name)}`, name, jurisdiction: "AU", base_currency: "AUD", fy_start_month: 7, timezone: "Australia/Melbourne", standard_version: STANDARD_VERSION, budget_date: "charged" };
  const { party, membership } = peopleRows(people, today);
  await store.tables.appendNew("household", [row]);
  await store.tables.appendNew("party", party);
  await store.tables.appendNew("membership", membership);
  await store.tables.countOriginals({ household: [row], party, membership });
  const m = await store.manifest();
  await store.setManifest({ ...m, state: "ready", household_id: row.household_id, written_at: stamp(today) });
  return { already: false, household_id: row.household_id, people: party.map((p) => p.party_id), tabs: dayOne(store) };
}
async function ready(store) {
  const probe = await store.probe();
  if (!probe.recognised) throw fail("no_kitty", "There is no Kitty here yet. Run init first.");
  if (probe.manifest.standard_version !== STANDARD_VERSION) throw fail("newer_standard", `This Kitty was written by ${probe.manifest.standard_version}. It is read-only here.`);
  if (probe.manifest.state !== "ready") throw fail("half_made", "This Kitty was not finished. Run init again; it picks up where it stopped.");
  return probe.manifest;
}
module.exports = { init, ready, slug, stamp, fail, SINCE };
