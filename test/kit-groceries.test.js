// node --test test/kit-groceries.test.js
// The groceries module's model numbers, on the fictional Davies sample (test/fixtures/groceries-sample.json) and on small made-up inputs.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const G = require("../src/kit/groceries.js");
const sample = require(path.join(__dirname, "fixtures", "groceries-sample.json"));
const input = require("../tools/kit-demo/groceries.data.js");

const r2 = (n) => Math.round(n * 100) / 100;
const median = (a) => { const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const fresh = () => JSON.parse(JSON.stringify({ asOf: sample.asOf, receipts: sample.receipts, lines: sample.lines, people: sample.people }));
const m = G.model(fresh());

// A tiny household for edge cases: one product bought on the given dates at the given prices.
function tiny(asOf, buys, extra) {
  const receipts = [], lines = [];
  buys.forEach(([date, price, qty], i) => {
    const id = "X" + String(i + 1).padStart(3, "0");
    receipts.push({ id, date, time: "10:00", merchant: "Coles Supermarkets", store: "Coburg", items: qty || 1, total: r2(price * (qty || 1)), paidWith: "Card", entryId: "T" + (900 + i), check: "OK" });
    lines.push({ receiptId: id, line: 1, text: "THING", product: "Thing", brand: "", group: "Pantry", kind: "Item", qty: qty || 1, unit: "each", unitPrice: price, amount: r2(price * (qty || 1)), gst: "GST-free", pack: "", ppu: null });
  });
  return Object.assign({ asOf, receipts, lines, people: [] }, extra || {});
}

test("no receipts tab, or an empty one, leaves the view dark", () => {
  assert.equal(G.model(null), null);
  assert.equal(G.model({ asOf: "2027-01-31", receipts: [], lines: [] }), null);
  assert.equal(G.render(null), "");
  assert.equal(G.renderHome(null), "");
});

test("the demo input is the sample, in the MODULES.md shape", () => {
  const i = input();
  assert.equal(i.asOf, "2027-01-31");
  assert.ok(Array.isArray(i.receipts) && Array.isArray(i.lines) && Array.isArray(i.people));
  for (const k of ["id", "date", "time", "merchant", "store", "channel", "person", "items", "total", "gst", "savings", "paidWith", "entryId", "accountId", "source", "sourceKind", "check", "note"]) assert.ok(k in i.receipts[0], k);
  for (const k of ["receiptId", "line", "text", "product", "brand", "group", "kind", "qty", "unit", "unitPrice", "amount", "gst", "pack", "ppu", "code", "note"]) assert.ok(k in i.lines[0], k);
});

test("weeks: the last 26 ISO weeks, Monday first, totals by shop add up", () => {
  assert.equal(m.weeks.length, 26);
  assert.equal(m.weeks[0].start, "2026-08-03");
  assert.equal(m.weeks[25].start, "2027-01-25");
  assert.equal(m.weeks[25].label, "Week of 25 Jan");
  const inRange = sample.receipts.filter((r) => r.date >= "2026-08-03" && r.date <= "2027-01-31");
  assert.equal(r2(m.weeks.reduce((t, w) => t + w.total, 0)), r2(inRange.reduce((t, r) => t + r.total, 0)));
  for (const w of m.weeks) assert.equal(r2(Object.values(w.byShop).reduce((t, v) => t + v, 0)), w.total, w.label);
  // the Christmas week, by hand: an ALDI run on Monday 21 Dec and the big Woolworths shop on the 23rd
  const xmas = m.weeks.find((w) => w.start === "2026-12-21");
  const want = sample.receipts.filter((r) => r.date >= "2026-12-21" && r.date <= "2026-12-27");
  assert.equal(xmas.total, r2(want.reduce((t, r) => t + r.total, 0)));
  assert.equal(xmas.total, 330.9);
});

test("shops: ranked by spend, three colours plus a fourth, names cleaned", () => {
  assert.deepEqual(m.shops.map((s) => [s.name, s.slot]), [["Woolworths", 0], ["Coles", 1], ["ALDI", 2], ["Sydney Road Fresh Market", 3]]);
  assert.equal(G._internal.shopName("ALDI Stores"), "ALDI");
  assert.equal(G._internal.shopName("Coles Supermarkets"), "Coles");
  // five shops fold the fourth and fifth into Other shops
  const i = fresh(); i.receipts.push({ id: "Z1", date: "2027-01-29", merchant: "IGA", store: "Brunswick", total: 10, paidWith: "Card", entryId: "T1", check: "OK" });
  const m5 = G.model(i);
  assert.equal(m5.shops.length, 4);
  assert.equal(m5.shops[3].name, "Other shops");
  assert.deepEqual(m5.shops[3].members.sort(), ["IGA", "Sydney Road Fresh Market"]);
});

test("this week against the median of the 12 weeks before", () => {
  const tw = m.thisWeek;
  assert.equal(tw.total, 153.25); // R0041 Coles $71.62 on a gift card + R0042 ALDI $81.63
  assert.equal(tw.receipts, 2);
  assert.equal(tw.items, 30);
  assert.deepEqual(tw.receiptIds.sort(), ["R0041", "R0042"]);
  const prior = m.weeks.slice(13, 25).map((w) => w.total);
  assert.equal(tw.usual, r2(median(prior)));
  assert.equal(tw.usual, 197.87); // halfway between $189.99 and $205.75
  assert.equal(tw.diff, -44.62);
  assert.equal(tw.done, true);
  assert.equal(G._internal.againstUsual(tw.total, tw.usual), "about $45 under a usual week");
  assert.equal(G._internal.againstUsual(200, 197.87), "about the same as a usual week");
  assert.equal(G._internal.againstUsual(340, 197.87), "about $140 over a usual week");
});

test("weeks before the first receipt are unknown, not zero", () => {
  const t = tiny("2027-01-31", [["2027-01-04", 50], ["2027-01-11", 60], ["2027-01-18", 70], ["2027-01-20", 10], ["2027-01-27", 40]]);
  const mt = G.model(t);
  assert.equal(mt.weeks.filter((w) => w.known).length, 4);
  assert.equal(mt.thisWeek.usual, null); // only 3 known weeks before this one
  t.receipts.unshift({ id: "X000", date: "2026-12-29", merchant: "Coles", total: 90, paidWith: "Card", entryId: "T1", check: "OK" });
  const mu = G.model(t);
  assert.equal(mu.thisWeek.usual, r2(median([90, 50, 60, 80]))); // not diluted by the 20 unknown weeks
});

test("groups: last 13 weeks of lines, shares add to one, change against the 13 before", () => {
  const g = m.groups;
  assert.equal(g.from, "2026-11-02");
  const ids = new Set(sample.receipts.filter((r) => r.date >= "2026-11-02" && r.date <= "2027-01-31").map((r) => r.id));
  const lines = sample.lines.filter((l) => ids.has(l.receiptId));
  assert.equal(g.total, r2(lines.reduce((t, l) => t + l.amount, 0)));
  assert.ok(Math.abs(g.rows.reduce((t, r) => t + r.share, 0) - 1) < 1e-9);
  assert.equal(g.rows[0].group, "Baby");
  assert.equal(g.rows[0].amount, r2(lines.filter((l) => l.group === "Baby").reduce((t, l) => t + l.amount, 0)));
  assert.equal(g.prevKnown, true);
  const notGrouped = g.rows.find((r) => r.group === "Not grouped");
  assert.equal(notGrouped.amount, 9.99); // the unread Special Buys line
  assert.equal(notGrouped.slot, 5);
});

test("price watch: 3 or more buys, moved 8% or more, with a yearly effect at the household's rate", () => {
  const names = m.priceWatch.map((p) => p.product);
  assert.deepEqual(names, ["Nappies size 4, 50 pack", "Yoghurt pouch 120g", "Strawberries 250g", "Bananas", "Free range eggs 12 pack"]);
  assert.ok(!names.includes("Tasty cheese block 500g")); // $8.00 to $8.50 is 6.25%
  assert.ok(!names.includes("Coffee beans 1kg")); // $32.00 to $34.50 is 7.8%
  for (const p of m.priceWatch) { assert.ok(p.count >= 3, p.product); assert.ok(Math.abs(p.change) >= 0.08, p.product); }
  const n = m.priceWatch[0];
  assert.equal(n.was, 28); assert.equal(n.now, 33); assert.equal(n.count, 19);
  assert.equal(Math.round(n.change * 1000) / 1000, 0.179);
  assert.equal(n.basis, "first"); // the sample has 6 months, so "was" is the first 3 months on record
  // a year at your rate: packs bought since the first receipt, scaled to 365 days, times the $5 rise
  const nap = sample.lines.filter((l) => l.product === "Nappies size 4, 50 pack" && l.kind === "Item");
  const days = (Date.parse("2027-01-31") - Date.parse("2026-08-08")) / 864e5 + 1;
  const perYear = (nap.reduce((t, l) => t + l.qty, 0) * 365) / days;
  assert.equal(n.effect, r2(5 * perYear));
  // per kg where comparable: bananas are weighed
  const b = m.priceWatch.find((p) => p.product === "Bananas");
  assert.equal(b.measure, "kg"); assert.equal(b.was, 3.5); assert.equal(b.now, 4.4); assert.equal(b.show.measure, "kg");
  // the same pack every time reads as a pack price; the per kg comparison is kept
  const y = m.priceWatch.find((p) => p.product === "Yoghurt pouch 120g");
  assert.equal(y.measure, "kg"); assert.equal(y.was, 18.33); assert.equal(y.show.was, 2.2); assert.equal(y.show.now, 2.5);
  // a fall is watched too
  assert.ok(m.priceWatch.find((p) => p.product === "Strawberries 250g").change < 0);
  // sorted by the size of the yearly effect
  for (let i = 1; i < m.priceWatch.length; i++) assert.ok(Math.abs(m.priceWatch[i - 1].effect) >= Math.abs(m.priceWatch[i].effect));
});

test("price watch uses the median 6 to 12 months before when the history reaches that far", () => {
  const buys = [["2025-12-01", 4.0], ["2026-02-10", 2.0], ["2026-03-10", 2.1], ["2026-05-10", 2.2], ["2026-07-10", 2.3], ["2026-10-10", 2.4], ["2027-01-20", 2.5]];
  const mt = G.model(tiny("2027-01-31", buys));
  const p = mt.priceWatch[0];
  assert.equal(p.basis, "year");
  assert.equal(p.was, 2.15); // median of Feb, Mar, May, Jul 2026; Dec 2025 is more than 12 months back
  assert.equal(p.now, 2.45); // the middle of the buys since: Oct 2026 and Jan 2027
  assert.equal(p.baseFrom, "2026-02-10"); assert.equal(p.baseTo, "2026-07-10");
});

test("price watch thresholds: 8% in, 7.9% out, fewer than 3 buys out, one special out", () => {
  const at = (now) => G.model(tiny("2027-01-31", [["2026-08-03", 10], ["2026-08-17", 10], ["2026-12-01", 10], ["2027-01-06", now], ["2027-01-20", now]])).priceWatch.length;
  assert.equal(at(10.8), 1);
  assert.equal(at(10.79), 0);
  assert.equal(at(9.2), 1);
  assert.equal(at(9.21), 0);
  assert.equal(G.model(tiny("2027-01-31", [["2026-08-03", 10], ["2027-01-20", 20]])).priceWatch.length, 0); // +100% on 2 buys is not shown
  // one special is not a price change: the middle of the latest 3 buys stands
  assert.equal(G.model(tiny("2027-01-31", [["2026-08-03", 10], ["2026-08-17", 10], ["2026-12-01", 10], ["2027-01-06", 10], ["2027-01-20", 5]])).priceWatch.length, 0);
  // and "was" needs 2 buys, so a special in the first months is not a baseline on its own
  assert.equal(G.model(tiny("2027-01-31", [["2026-08-03", 5], ["2026-12-01", 10], ["2027-01-06", 10], ["2027-01-20", 10]])).priceWatch.length, 0);
});

test("outside the bank this month: no Entry ID, by Paid with", () => {
  const ob = m.outsideBank;
  assert.equal(ob.month, "2027-01"); assert.equal(ob.label, "January 2027");
  assert.equal(ob.total, 427.05);
  assert.deepEqual(ob.byPaid.map((o) => [o.paidWith, o.total, o.count]), [["Gift card", 291.56, 2], ["Card", 81.63, 1], ["Cash", 53.86, 1]]);
  assert.deepEqual(ob.outside.map((o) => o.paidWith), ["Gift card", "Cash"]);
  assert.deepEqual(ob.waiting.map((o) => o.paidWith), ["Card"]); // paid by card, bank row not imported yet
  const home = G.renderHome(m, {});
  assert.match(home, /In January, \$291\.56 was paid by gift card and \$53\.86 in cash, so your bank won&#39;t show it\./);
});

test("bought before: last date, price, shop and how often", () => {
  const r = m.boughtBefore("pouch");
  assert.deepEqual(r.map((p) => p.product), ["Yoghurt pouch 120g", "Fruit and veg pouch 120g", "Fruit pouch 120g"]);
  const y = r[0];
  assert.equal(y.count, 25); assert.equal(y.every, 7); assert.equal(y.first, "2026-08-08");
  assert.deepEqual([y.last.date, y.last.shop, y.last.store, y.last.unitPrice], ["2027-01-27", "Coles", "Coburg", 2.5]);
  assert.deepEqual(m.boughtBefore("Pouches").map((p) => p.product), r.map((p) => p.product));
  assert.deepEqual(m.boughtBefore("huggies nappies").map((p) => p.product), ["Nappies size 4, 50 pack"]);
  assert.deepEqual(m.boughtBefore(""), []);
  assert.deepEqual(m.boughtBefore("caviar"), []);
  // discount lines are not buys: pasta sauce is counted once per receipt that sold it
  const sauce = m.boughtBefore("pasta sauce")[0];
  const sold = new Set(sample.lines.filter((l) => l.product === "Pasta sauce 500g" && l.kind === "Item").map((l) => l.receiptId));
  assert.equal(sauce.count, sold.size);
});

test("problems: a receipt that does not add up and a line with no group; one bad row never blanks the view", () => {
  assert.deepEqual(m.problems.map((p) => p.kind).sort(), ["check", "nogroup"]);
  const c = m.problems.find((p) => p.kind === "check");
  assert.equal(c.receiptId, "R0033");
  assert.equal(c.text, "ALDI, 21 Dec: the lines come to $1.20 less than the printed total of $39.21.");
  assert.equal(m.receipt("R0033").diff, 1.2);
  const i = fresh(); i.receipts.push({ id: "BAD", merchant: "Coles", total: 12 }); i.lines.push({ receiptId: "NOPE", line: 1, amount: 3 });
  const mb = G.model(i);
  assert.equal(mb.counts.receipts, m.counts.receipts);
  assert.ok(mb.problems.some((p) => p.kind === "row" && /no date/.test(p.text)));
  assert.ok(mb.problems.some((p) => p.kind === "orphan"));
  assert.ok(G.render(mb, {}).length > 1000);
});

test("receipts list is latest first, and each receipt knows its bank match", () => {
  assert.equal(m.receiptsList[0].id, "R0042");
  assert.equal(m.receiptsList[m.receiptsList.length - 1].id, "R0001");
  assert.equal(m.receipt("R0042").match, "waiting");
  assert.equal(m.receipt("R0041").match, "outside");
  assert.equal(m.receipt("R0040").match, "matched");
  assert.match(G.receiptHTML(m, "R0040"), /Matched to the charge on 23 Jan\./); assert.doesNotMatch(G.receiptHTML(m, "R0040"), /T4207/);
  assert.match(G.receiptHTML(m, "R0041"), /Paid by gift card, so no bank row\./);
});

test("the lead is the largest yearly effect", () => {
  assert.equal(m.lead.kind, "price");
  assert.equal(m.lead.item.product, "Nappies size 4, 50 pack");
});

test("rendered HTML: no internal account IDs, no NaN or undefined, every percentage has a count or dollars beside it", () => {
  const html = G.render(m, {}) + G.renderHome(m, {}) + G.weekHTML(m) + G.weeksHTML(m) + G.outsideHTML(m) + G.productHTML(m, m.priceWatch[0].key) + G.groupHTML(m, "Baby") + m.receiptsList.map((r) => G.receiptHTML(m, r.id)).join("");
  assert.doesNotMatch(html, /ACC-/);
  const i = fresh(); i.receipts[0].note = "Paid wholly by gift card ACC-GC-5. Real spending.";
  assert.match(G.receiptHTML(G.model(i), i.receipts[0].id), /Note: Paid wholly by gift card\. Real spending\./);
  assert.doesNotMatch(html, /NaN|undefined|\[object/);
  assert.match(G.renderHome(m, {}), /This week's shop/);
  assert.match(G.renderHome(m, {}), /This week, about \$45 under a usual week\./);
  // price watch rows: the % sits beside its buy count
  for (const row of G.render(m, {}).split('class="kx-groc-prow"').slice(1)) assert.match(row, /[+−]\d+%<\/b><small>\d+ buys<\/small>/);
  // group shares sit beside dollars
  for (const row of G.render(m, {}).split('class="kx-groc-grow"').slice(1)) assert.match(row, /\$[\d,]+<\/span><span class="p num">(<1|\d+)%/);
});

test("a week with no receipts says so in words", () => {
  const i = fresh(); i.asOf = "2027-02-03";
  const mw = G.model(i);
  assert.equal(mw.thisWeek.receipts, 0);
  assert.match(G.renderHome(mw, {}), /No receipts yet this week\./);
  assert.doesNotMatch(G.renderHome(mw, {}), /kx-groc-big/);
});
