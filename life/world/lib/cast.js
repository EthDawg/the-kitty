/* Who plays the script. The Davies come from life.json. A variant keeps the script and changes everyone in it: names, employers, suburbs, numbers, pay, dates inside a chapter,
   which parody bank holds what, and the small format changes real banks make. A variant must not be recognisable as the Davies, so nothing of theirs is reused but the plot. */
"use strict";
const { Rng, addDays, pad } = require("./std");
const { BASE, mutate } = require("./shapes");

const FIRST_A = ["Priya", "Mele", "Ingrid", "Thandi", "Noor", "Carmen", "Hana", "Rosa", "Aiko", "Bridie", "Yara", "Linh"];
const FIRST_B = ["Tomas", "Kofi", "Arjun", "Luca", "Mateo", "Sione", "Ravi", "Callum", "Emeka", "Jonah", "Anders", "Tevita"];
const KIDS = ["Wren", "Milo", "Asha", "Theo", "Indi", "Kai", "Nell", "Otis", "Zadie", "Remy", "Juno", "Arlo"];
const SURNAMES = ["Nakamura-Bell", "Okonkwo", "Ferreira", "Lindholm", "Sharma", "Tupou", "Marchetti", "Nguyen", "Kowalski", "O'Rourke", "Haidari", "Vasquez", "Papadakis", "Mbeki-Shaw"];
const HEALTH = ["Riverbend Health", "Tallowood Public Hospital", "Southgate Community Health", "Cedar Ridge Health Service", "Kingfisher District Hospital"];
const WORK_A = ["Hospital speech pathologist", "Hospital occupational therapist", "Hospital dietitian", "Hospital radiographer", "Hospital pharmacist"];
const WORK_B = ["Treasury analyst", "Product accountant", "Business analyst", "Risk analyst", "Finance business partner"];
const CORPS = [["Harrowgate Systems", "Harrowgate Corp", "HGTE"], ["Bluegum Freight", "Bluegum Global Inc", "BGMG"], ["Ironwood Retail", "Ironwood Inc", "IRNW"], ["Marlin Logistics", "Marlin Global Inc", "MRLN"], ["Quarry Hill Software", "Quarry Hill Inc", "QHIL"]];
const PLACES = [
  { state: "VIC", areas: [["Footscray", 3011], ["Preston", 3072], ["Essendon", 3040], ["Hawthorn", 3122]] },
  { state: "NSW", areas: [["Marrickville", 2204], ["Parramatta", 2150], ["Newtown", 2042], ["Ryde", 2112]] },
  { state: "QLD", areas: [["Paddington", 4064], ["Woolloongabba", 4102], ["Nundah", 4012], ["Toowong", 4066]] },
  { state: "SA", areas: [["Norwood", 5067], ["Prospect", 5082], ["Unley", 5061], ["Glenelg", 5045]] },
];
const STREETS = ["Tamarind", "Ashgrove", "Kestrel", "Bellbird", "Quince", "Marlin", "Sorrel", "Juniper", "Corella", "Heron"];
const WORDS = ["Copper", "Juniper", "Harbourlight", "Little Fig", "Tin Roof", "Sunday", "Lantern", "Ferngully", "Red Door", "Northside", "Old Mill", "Pepper"];

const digits = (rng, n) => { let s = ""; for (let i = 0; i < n; i++) s += String(rng.int(0, 9)); return s; };
const round = (c, step) => Math.round(c / step) * step;

const MERCHANTS_DAVIES = {
  GROCERIES: ["FRESHPAW MARKET COBURG", "CORNER PANTRY BRUNSWICK", "MERRI GROCER NORTHCOTE"], DINING: ["THE GREY TABBY CAFE", "LITTLE LYGON PIZZA", "SECOND CUP ROASTERS", "NOODLE ALLEY"], TRANSPORT: ["PAWPUMP FUEL", "METROCARD TOPUP"],
  SHOPPING: ["BUNNYPAWS WAREHOUSE", "THE GOOD BOOKSHOP", "LINEN AND THREAD"], HEALTH: ["CORNER PHARMACY", "MERRI PHYSIO SUPPLIES"], PERSONAL: ["SHORT BACK AND SIDES", "CLOUD NINE NAILS"], SUBS: ["NORTHLIGHT STREAM", "SOUNDBOX MUSIC"],
};
function merchants(rng, suburb) {
  const w = (t) => `${rng.pick(WORDS).toUpperCase()} ${t}`, S = suburb.toUpperCase();
  return { GROCERIES: [w("MARKET"), w(`GROCER ${S}`), w("PANTRY")], DINING: [w("CAFE"), w("KITCHEN"), w("ROASTERS"), w("NOODLES")], TRANSPORT: [w("FUEL"), "METROCARD TOPUP"], SHOPPING: [w("HARDWARE"), w("BOOKS"), w("HOME")], HEALTH: [w("PHARMACY"), w("HEALTH SUPPLIES")], PERSONAL: [w("BARBER"), w("NAILS")], SUBS: [w("STREAM"), w("MUSIC")] };
}

function davies(script, seed) {
  const c = script.cast;
  return {
    id: "davies", seed, variant: false, surname: c.surname, household: c.household, shared_mail: c.shared_mail, state: c.state,
    A: { ...c.A, role: "A", name: `${c.A.first} ${c.surname}` }, B: { ...c.B, role: "B", name: `${c.B.first} ${c.surname}` },
    children: c.children.map((k) => ({ ...k, name: `${k.first} ${c.surname}` })), addresses: c.addresses, numbers: c.numbers,
    institutions: Object.fromEntries(Object.entries(script.institutions).filter(([k]) => k !== "provenance").map(([k, v]) => [k, { ...v, spec: BASE[v.shape] }])),
    opening: { ...script.opening }, pay: script.pay, events: script.events.map((e) => ({ ...e })), merchants: MERCHANTS_DAVIES, scale: 1,
    agency: { accountant: "Tabby Tax", prior_agent: "Paws and Claws Tax Agents" }, later: script.later, shifts: {},
  };
}

/* Everything in a variant comes from one seeded stream per purpose, so a change to one never moves another. */
function variant(script, seed) {
  const r = (n) => new Rng(`life-variant:${seed}:${n}`);
  const names = r("names"), place = r("place"), nums = r("numbers"), inst = r("institutions"), money = r("money"), when = r("when");
  const pl = place.pick(PLACES), area = place.pick(pl.areas), area2 = place.pick(pl.areas), street = () => `${place.int(2, 96)} ${place.pick(STREETS)} ${place.pick(["Street", "Road", "Avenue", "Lane"])}`;
  const surname = names.pick(SURNAMES), firstA = names.pick(FIRST_A), firstB = names.pick(FIRST_B);
  const corp = names.pick(CORPS), hospital = names.pick(HEALTH);
  const jitter = when.int(-70, 70);
  const shiftBorn = (iso, lo, hi) => addDays(iso, when.int(lo, hi));
  const kids = script.cast.children.map((k) => { let f; do { f = names.pick(KIDS); } while (f === firstA || f === firstB); return { role: k.role, id: f.toLowerCase(), first: f, born: shiftBorn(k.born, -60, 90), name: `${f} ${surname}` }; });
  // two kids never share a name
  const seen = new Set(); kids.forEach((k, i) => { while (seen.has(k.first)) { k.first = KIDS[(KIDS.indexOf(k.first) + 1 + i) % KIDS.length]; k.id = k.first.toLowerCase(); k.name = `${k.first} ${surname}`; } seen.add(k.first); });
  const superA = inst.pick(["hestabby", "purrannuation"]), superB = superA === "hestabby" ? "purrannuation" : "hestabby";
  const memberOf = (f) => (f === "hestabby" ? `HB-${digits(nums, 4)}-${digits(nums, 4)}` : `PN-${digits(nums, 6)}`);
  const safe = (o) => o.replace(/[^a-z]/gi, "").toLowerCase();
  const cast = {
    id: `variant-${seed}`, seed, variant: true, surname, household: `The ${surname} household (fictional)`, shared_mail: `the.${safe(surname)}@mail.example`, state: pl.state,
    A: { id: firstA.toLowerCase(), role: "A", first: firstA, name: `${firstA} ${surname}`, born: shiftBorn(script.cast.A.born, -900, 900), work: names.pick(WORK_A), employer: hospital, payroll_portal: "Pawroll", super: superA, member: memberOf(superA) },
    B: { id: firstB.toLowerCase(), role: "B", first: firstB, name: `${firstB} ${surname}`, born: shiftBorn(script.cast.B.born, -900, 900), work: names.pick(WORK_B), employer: corp[0], payroll_portal: "Pawroll", super: superB, member: memberOf(superB), plan: { parent: corp[1], code: corp[2], account: `ET-${digits(nums, 5)}-RSU` } },
    children: kids,
    addresses: { A_flat: `${place.int(1, 9)}/${street()}, ${area[0]} ${pl.state} ${area[1]}`, B_share: `${street()}, ${area2[0]} ${pl.state} ${area2[1]}`, rental: `${street()}, ${area[0]} ${pl.state} ${area[1]}`, home: `${street()}, ${area2[0]} ${pl.state} ${area2[1]}` },
    numbers: { A_every: `${digits(nums, 4)} ${digits(nums, 4)} ${digits(nums, 4)}`, A_save: `${digits(nums, 4)} ${digits(nums, 4)} ${digits(nums, 4)}`, A_card: digits(nums, 5), B_every: `${digits(nums, 4)} ${digits(nums, 4)} ${digits(nums, 4)}`, B_save: `${digits(nums, 4)} ${digits(nums, 4)} ${digits(nums, 4)}`, joint: `${digits(nums, 3)}-${digits(nums, 3)} ${digits(nums, 3)} ${digits(nums, 3)}`, offset: `${digits(nums, 3)}-${digits(nums, 3)} ${digits(nums, 3)} ${digits(nums, 3)}`, loan: `${digits(nums, 3)} ${digits(nums, 3)} ${digits(nums, 3)}`, child_save: `${digits(nums, 4)} ${digits(nums, 4)} ${digits(nums, 4)}` },
    merchants: merchants(r("merchants"), area[0]), agency: { accountant: `${surname.split(/[- ]/)[0]} and Co Tax`, prior_agent: "Paws and Claws Tax Agents" }, later: script.later,
  };
  cast.numbers.last4_A = cast.numbers.A_every.replace(/\D/g, "").slice(-4); cast.numbers.last4_B = cast.numbers.B_every.replace(/\D/g, "").slice(-4);

  // the bank mix. The first account always has a layout no public recipe reads: chapter 0 needs it.
  const hasBase = (k) => BASE[k];
  // one bank has one export format, whoever downloads it
  const house = {};
  const pick = (role, brands) => { const brand = inst.pick(brands); const base = brand === "westpaw" ? "westpaw" : brand === "commbark" ? inst.pick(["bark", "bark", "qif"]) : inst.pick(["ping", "ping", "ofx"]); const k = `${brand}|${base}`; if (!house[k]) house[k] = inst.next() < 0.55 ? mutate(hasBase(base), inst) : BASE[base]; return { brand, shape: base, spec: house[k] }; };
  const first = (() => { const brand = inst.pick(["westpaw", "commbark", "ping"]), base = brand === "westpaw" ? "westpaw" : brand === "commbark" ? "bark" : "ping"; let spec; do { spec = mutate(BASE[base], inst); } while (spec.special || !spec.changes.length); house[`${brand}|${base}`] = spec; return { brand, shape: base, spec }; })();
  cast.institutions = { A_every: first, A_save: first, A_card: { brand: "amewx", shape: "amewx", spec: null }, B_every: pick("B_every", ["westpaw", "commbark", "ping"]), B_save: pick("B_save", ["ping", "commbark"]), joint: pick("joint", ["westpaw", "ping", "commbark"]), loan: { brand: "westpaw", shape: "westpaw", spec: house["westpaw|westpaw"] || BASE.westpaw } };
  if (cast.institutions.joint.spec.special) cast.institutions.joint = cast.institutions.loan;

  // money, scaled and rounded so no figure repeats the Davies'
  const scale = (key) => money.range(0.78, 1.34);
  const op = {}; for (const [k, v] of Object.entries(script.opening)) op[k] = k === "provenance" ? v : k === "held_units" ? round(v * money.range(0.6, 1.6), 5) : Math.round(v * scale(k)) + money.int(-4000, 4000);
  cast.opening = op;
  cast.pay = { A: { ...script.pay.A, annual_cents: round(script.pay.A.annual_cents * money.range(0.82, 1.2), 10000), anchor: addDays(script.pay.A.anchor, money.pick([0, 1, -1, 7, 8])) }, B: { ...script.pay.B, annual_cents: round(script.pay.B.annual_cents * money.range(0.8, 1.3), 10000), anchor: addDays(script.pay.B.anchor, money.pick([0, 1, -1, 7, 6])) } };
  cast.pay.ppl_fortnight_cents = round(script.pay.ppl_fortnight_cents * money.range(0.95, 1.05), 100);
  cast.pay.A.packaging_fortnight_cents = round(script.pay.A.packaging_fortnight_cents * money.range(0.7, 1), 100);

  // the same plot, on other days and other amounts
  const child = (role) => kids.find((k) => k.role === role);
  cast.events = script.events.map((e) => {
    const x = { ...e };
    for (const k of Object.keys(x)) if (/_cents$/.test(k) && k !== "daily_cents") x[k] = round(x[k] * money.range(0.85, 1.25), 100);
    if (x.do === "birth") { x.on = child(x.child).born; return x; }
    if (x.do === "pocket_money_intent") { x.on = `2036${child(x.child).born.slice(4)}`; return x; }
    if (x.do === "leave") { const c = child(x.for), d = addDays(c.born, -14); return { ...x, on: d, back_on: addDays(x.back_on, jitterDays(c.born, script, x.for)) }; }
    if (x.do === "open_child_saver") { x.on = addDays(child(x.child).born, 14); return x; }
    if (x.do === "childcare_start" || x.do === "school_start") { x.on = addDays(x.on, jitterDays(child(x.child).born, script, x.child)); return x; }
    // the home and the wills move as one, and never out of chapter 5; March 2027 stays in March so chapter 3 holds
    if (["pay_deposit", "sell_held_units", "gift", "buy_home", "bond_back", "wills", "rate_backdated"].includes(x.do)) { x.on = addDays(x.on, Math.max(-10, Math.min(16, Math.round(jitter / 6)))); return x; }
    return x;
  });
  const buy = cast.events.find((e) => e.do === "buy_home");
  buy.deposit_paid_cents = cast.events.find((e) => e.do === "pay_deposit").cents;
  // a buyer's numbers have to add up for this family, or the plot fails on a bad day
  buy.loan_cents = round(buy.price_cents * 0.82, 100000);
  cast.scale = 1;
  void pad;
  return cast;
}
function jitterDays(born, script, role) { const canon = script.cast.children.find((k) => k.role === role); const { dayDiff } = require("./std"); return dayDiff(canon.born, born); }

module.exports = { davies, variant };
