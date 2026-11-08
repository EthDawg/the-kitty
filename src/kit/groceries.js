/* The Kitty kit: groceries. Receipts and their printed lines, read the way a household would: this week's shop against a usual week,
   each week by shop, where the money goes, prices that moved, "bought before?", and every receipt with its lines and its bank match.
   model() is pure and node-tested; render() and renderHome() return HTML strings; bind() and bindDrawer() use event delegation.
   The module never knows which household it draws. Runs in the page (window.Kit.Groceries) and in node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Kit = Object.assign(root.Kit || {}, { Groceries: factory() });
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const G = {};
  const DAY = 864e5, WEEKS = 26, USUAL_WEEKS = 12, GROUP_WEEKS = 13, MOVE = 0.08, MIN_BUYS = 3;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // ---------- small helpers ----------
  const isISO = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
  const ms = (s) => Date.parse(s.slice(0, 10) + "T00:00:00Z");
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (s, n) => iso(ms(s) + n * DAY);
  const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const addMonths = (s, n) => {
    const y = +s.slice(0, 4), mo = +s.slice(5, 7) - 1 + n, d = +s.slice(8, 10);
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return iso(Date.UTC(y, mo, Math.min(d, last)));
  };
  const weekStart = (s) => addDays(s, -((new Date(ms(s)).getUTCDay() + 6) % 7));
  const num = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (v == null) return null;
    const s = String(v).replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const r2 = (n) => Math.round(n * 100) / 100;
  const sum = (a, f) => a.reduce((t, x) => t + (f ? f(x) : x), 0);
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const commas = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const money0 = (n) => (n < -0.5 ? "−" : "") + "$" + commas(String(Math.round(Math.abs(n))));
  const money2 = (n) => { const a = Math.abs(n).toFixed(2).split("."); return (n < -0.004 ? "−" : "") + "$" + commas(a[0]) + "." + a[1]; };
  const dShort = (s) => `${+s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]}`;
  const dLong = (s) => `${dShort(s)} ${s.slice(0, 4)}`;
  const dDay = (s) => `${WD[new Date(ms(s)).getUTCDay()]} ${dShort(s)}`;
  const monthLong = (k) => `${MONTH[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
  const monthRange = (a, b) => {
    const ya = a.slice(0, 4), yb = b.slice(0, 4), ma = MON[+a.slice(5, 7) - 1], mb = MON[+b.slice(5, 7) - 1];
    if (a.slice(0, 7) === b.slice(0, 7)) return `${ma} ${ya}`;
    return ya === yb ? `${ma} to ${mb} ${yb}` : `${ma} ${ya} to ${mb} ${yb}`;
  };
  const time12 = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); if (!m) return ""; const h = +m[1]; return `${h % 12 || 12}:${m[2]}${h < 12 ? "am" : "pm"}`; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const shopName = (m) => { const s = String(m || "").trim(); const c = s.replace(/\s+(supermarkets?|stores?|pty\.?\s*ltd\.?|limited|ltd\.?)$/i, "").trim(); return c || s || "Unknown shop"; };
  const isTaxable = (g) => /^(taxable|yes|y|gst)$/i.test(String(g || "").trim());
  const kindOf = (k) => { const s = String(k || "").trim().toLowerCase(); return s === "discount" ? "Discount" : s === "fee" ? "Fee" : s === "deposit" ? "Deposit" : "Item"; };
  const PAID_OUTSIDE = (p) => !/^(card|mixed)$/i.test(String(p || "").trim());
  const measureOf = (unit, pack) => {
    const u = String(unit || "").toLowerCase(), p = String(pack || "").toLowerCase().trim();
    if (u === "kg") return "kg"; if (u === "l") return "L";
    if (/\d\s*(kg|g)$/.test(p)) return "kg"; if (/\d\s*(ml|l)$/.test(p)) return "L";
    return null;
  };

  // ---------- model ----------
  function normReceipt(r) {
    const date = isISO(r.date) ? r.date.slice(0, 10) : null;
    return {
      id: String(r.id == null ? "" : r.id).trim(), date, time: String(r.time || "").trim(), merchant: String(r.merchant || "").trim(), shop: shopName(r.merchant),
      store: String(r.store || "").trim(), channel: String(r.channel || "").trim(), person: String(r.person || "").trim(), items: num(r.items), total: num(r.total),
      gst: num(r.gst), savings: num(r.savings), paidWith: String(r.paidWith || "").trim(), entryId: String(r.entryId == null ? "" : r.entryId).trim(),
      source: String(r.source || "").trim(), sourceKind: String(r.sourceKind || "").trim(), check: String(r.check == null ? "" : r.check).trim(), note: String(r.note || "").trim(), lines: [],
    };
  }
  function normLine(l) {
    return {
      receiptId: String(l.receiptId == null ? "" : l.receiptId).trim(), line: num(l.line), text: String(l.text || "").trim(), product: String(l.product || "").trim(),
      brand: String(l.brand || "").trim(), group: String(l.group || "").trim(), kind: kindOf(l.kind), qty: num(l.qty), unit: String(l.unit || "each").trim() || "each",
      unitPrice: num(l.unitPrice), amount: num(l.amount), gst: String(l.gst || "").trim(), taxable: isTaxable(l.gst), pack: String(l.pack || "").trim(), ppu: num(l.ppu),
      code: String(l.code || "").trim(), note: String(l.note || "").trim(),
    };
  }
  const productKey = (l) => norm(l.product) + "|" + norm(l.brand);

  G.model = function model(input) {
    if (!input || !Array.isArray(input.receipts) || !input.receipts.length) return null;
    const problems = [];
    const all = input.receipts.filter(Boolean).map(normReceipt);
    let asOf = isISO(input.asOf) ? input.asOf.slice(0, 10) : null;
    if (!asOf) asOf = all.map((r) => r.date).filter(Boolean).sort().pop() || null;
    if (!asOf) return null;
    const receipts = [];
    for (const r of all) {
      if (!r.date || r.total == null) { problems.push({ kind: "row", receiptId: r.id, shop: r.shop, date: r.date, text: `A ${r.shop} receipt has no ${!r.date ? "date" : "total"}, so it is left out of the totals.` }); continue; }
      if (r.date > asOf) continue;
      receipts.push(r);
    }
    if (!receipts.length) return null;
    const byId = new Map(receipts.map((r) => [r.id, r]));
    let orphans = 0;
    for (const raw of Array.isArray(input.lines) ? input.lines : []) {
      if (!raw) continue;
      const l = normLine(raw); const r = byId.get(l.receiptId);
      if (!r) { if (!all.some((x) => x.id === l.receiptId)) orphans += 1; continue; }
      if (l.amount == null) { problems.push({ kind: "line", receiptId: r.id, shop: r.shop, date: r.date, text: `${r.shop}, ${dShort(r.date)}: line ${l.line == null ? "" : l.line} has no amount.` }); continue; }
      r.lines.push(l);
    }
    if (orphans) problems.push({ kind: "orphan", text: `${plural(orphans, "line")} on Receipt Lines match no receipt.` });
    receipts.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : a.date + a.time > b.date + b.time ? 1 : a.id < b.id ? -1 : 1));
    const recordStart = receipts[0].date;

    for (const r of receipts) {
      r.lines.sort((a, b) => (a.line || 0) - (b.line || 0));
      r.linesTotal = r2(sum(r.lines, (l) => l.amount));
      r.diff = r.lines.length ? r2(r.total - r.linesTotal) : null;
      r.ok = r.check ? /^ok$/i.test(r.check) : r.diff != null && Math.abs(r.diff) <= 0.05;
      r.match = r.entryId ? "matched" : PAID_OUTSIDE(r.paidWith) ? "outside" : "waiting";
      if (!r.ok) {
        const d = r.diff;
        const text = d != null && Math.abs(d) > 0.05 ? `${r.shop}, ${dShort(r.date)}: the lines come to ${money2(Math.abs(d))} ${d > 0 ? "less" : "more"} than the printed total of ${money2(r.total)}.`
          : !r.lines.length ? `${r.shop}, ${dShort(r.date)}: no lines have been read for this receipt yet.` : `${r.shop}, ${dShort(r.date)}: the check says "${r.check}".`;
        problems.push({ kind: "check", receiptId: r.id, shop: r.shop, date: r.date, text });
      }
      for (const l of r.lines) if (!l.group) problems.push({ kind: "nogroup", receiptId: r.id, shop: r.shop, date: r.date, line: l.line, text: `${r.shop}, ${dShort(r.date)}: line ${l.line}${l.text ? ` (${l.text})` : ""} has no group.` });
    }

    // Weeks: the last 26 ISO weeks, Monday first, ending with the week that holds the as-of date.
    const thisStart = weekStart(asOf);
    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const start = addDays(thisStart, -7 * (WEEKS - 1 - i)), end = addDays(start, 6);
      return { start, end, label: "Week of " + dShort(start), total: 0, byShop: {}, receipts: [], items: 0, known: end >= recordStart };
    });
    const first = weeks[0].start;
    // Shops by spend over the 26 weeks; the top three keep their own colour, a fourth keeps its name, more than four fold into "Other shops".
    const shopTotals = new Map();
    for (const r of receipts) if (r.date >= first) shopTotals.set(r.shop, (shopTotals.get(r.shop) || 0) + r.total);
    const ranked = [...shopTotals.entries()].sort((a, b) => b[1] - a[1]);
    const fold = ranked.length > 4;
    const shopKey = new Map(ranked.map(([n], i) => [n, i < 3 || !fold ? n : "Other shops"]));
    const shops = [];
    for (const [n, t] of ranked) {
      const k = shopKey.get(n); let s = shops.find((x) => x.name === k);
      if (!s) { s = { name: k, slot: Math.min(shops.length, 3), total: 0, members: [] }; shops.push(s); }
      s.total += t; s.members.push(n);
    }
    shops.forEach((s) => { s.total = r2(s.total); });
    const slotOf = (shop) => { const s = shops.find((x) => x.name === (shopKey.get(shop) || shop)); return s ? s.slot : 3; };
    for (const r of receipts) {
      r.slot = slotOf(r.shop);
      if (r.date < first) continue;
      const w = weeks[Math.floor(daysBetween(first, r.date) / 7)];
      const k = shopKey.get(r.shop) || r.shop;
      w.total += r.total; w.byShop[k] = (w.byShop[k] || 0) + r.total; w.receipts.push(r.id); w.items += r.items || 0;
    }
    for (const w of weeks) { w.total = r2(w.total); for (const k in w.byShop) w.byShop[k] = r2(w.byShop[k]); }

    // This week against the median of the 12 weeks before (weeks before the first receipt are unknown, not zero).
    const tw = weeks[WEEKS - 1];
    const prior = weeks.slice(WEEKS - 1 - USUAL_WEEKS, WEEKS - 1).filter((w) => w.known);
    const usual = prior.length >= 4 ? r2(median(prior.map((w) => w.total))) : null;
    const thisWeek = {
      start: tw.start, end: tw.end, label: tw.label, total: tw.total, items: tw.items, receipts: tw.receipts.length, receiptIds: tw.receipts.slice(),
      usual, diff: usual == null ? null : r2(tw.total - usual), usualWeeks: prior.map((w) => ({ start: w.start, label: w.label, total: w.total })), done: asOf >= tw.end,
    };

    // Groups over the last 13 weeks, with the 13 weeks before for comparison when the record covers them.
    const gFrom = weeks[WEEKS - GROUP_WEEKS].start, pFrom = weeks[0].start, pTo = addDays(gFrom, -1);
    const prevKnown = weeks.slice(0, WEEKS - GROUP_WEEKS).every((w) => w.known);
    const gNow = new Map(), gPrev = new Map(); let gReceipts = 0;
    for (const r of receipts) {
      const inNow = r.date >= gFrom, inPrev = r.date >= pFrom && r.date <= pTo;
      if (!inNow && !inPrev) continue;
      if (inNow && r.lines.length) gReceipts += 1;
      for (const l of r.lines) { const g = l.group || "Not grouped"; const map = inNow ? gNow : gPrev; map.set(g, (map.get(g) || 0) + l.amount); }
    }
    const gTotal = r2(sum([...gNow.values()]));
    const groupRows = [...gNow.entries()].map(([group, amount]) => ({ group, amount: r2(amount), share: gTotal ? amount / gTotal : 0, prev: prevKnown ? r2(gPrev.get(group) || 0) : null }))
      .sort((a, b) => b.amount - a.amount);
    groupRows.forEach((g, i) => { g.slot = g.group === "Not grouped" ? 5 : Math.min(i, 5); g.change = g.prev == null ? null : r2(g.amount - g.prev); });
    const groups = { from: gFrom, to: asOf, total: gTotal, receipts: gReceipts, prevFrom: pFrom, prevTo: pTo, prevKnown, rows: groupRows };

    // Products: every Item line with a product name, keyed by product and brand.
    const products = new Map();
    for (const r of receipts) for (const l of r.lines) {
      if (l.kind !== "Item" || !l.product) continue;
      const k = productKey(l); let p = products.get(k);
      if (!p) { p = { key: k, product: l.product, brand: l.brand, group: l.group, buys: [], texts: new Set() }; products.set(k, p); }
      p.texts.add(l.text);
      p.buys.push({ date: r.date, time: r.time, receiptId: r.id, shop: r.shop, store: r.store, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount, ppu: l.ppu, pack: l.pack });
    }
    for (const p of products.values()) {
      p.count = new Set(p.buys.map((b) => b.receiptId)).size;
      p.first = p.buys[0].date; p.last = p.buys[p.buys.length - 1];
      p.every = p.count >= 3 ? Math.round(daysBetween(p.first, p.last.date) / (p.count - 1)) : null;
      p.measure = p.buys.every((b) => b.ppu != null && b.ppu > 0) ? measureOf(p.buys[0].unit, p.buys[0].pack) || "kg" : null;
      p.hay = norm([p.product, p.brand, p.group, ...p.texts].join(" "));
    }

    // Price watch: bought at least 3 times; the latest price against the median 6 to 12 months before the as-of date. With less history
    // than that, the median of the first 3 months on record, as long as those buys are at least 8 weeks before the latest. Moves of 8% or
    // more. Receipts print a special as the shelf price, so one special must not read as a price change: "was" needs at least 2 buys, and
    // "now" is the middle of the latest 3 buys after the "was" period (just the latest when there is only one).
    const specFrom = addMonths(asOf, -12), specTo = addMonths(asOf, -6), firstTo = addMonths(recordStart, 3);
    const rateFrom = recordStart > addDays(asOf, -364) ? recordStart : addDays(asOf, -364), rateDays = daysBetween(rateFrom, asOf) + 1;
    const priceWatch = [];
    for (const p of products.values()) {
      if (p.count < MIN_BUYS) continue;
      const price = (b) => (p.measure ? b.ppu : b.unitPrice);
      const buys = p.buys.filter((b) => price(b) != null && price(b) > 0);
      if (buys.length < MIN_BUYS) continue;
      const latest = buys[buys.length - 1];
      let base = buys.filter((b) => b.date >= specFrom && b.date <= specTo), basis = "year";
      if (base.length < 2 || latest.date <= specTo) { base = buys.filter((b) => b.date < firstTo && daysBetween(b.date, latest.date) >= 56); basis = "first"; }
      if (base.length < 2) continue;
      const recent = buys.filter((b) => b.date > base[base.length - 1].date).slice(-3);
      if (!recent.length) continue;
      const was = r2(median(base.map(price))), now = r2(median(recent.map(price)));
      const change = (now - was) / was;
      if (Math.abs(change) < MOVE) continue;
      const inRate = buys.filter((b) => b.date >= rateFrom);
      const volume = sum(inRate, (b) => (p.measure ? b.amount / b.ppu : b.qty || 0));
      const perYear = (volume * 365) / rateDays;
      // The same pack every time reads better as a pack price ("$2.50 each") than per kg; the change is the same.
      const samePack = !!p.measure && buys.every((b) => b.pack === buys[0].pack && String(b.unit).toLowerCase() === "each" && b.unitPrice > 0);
      const show = samePack
        ? { was: r2(median(base.map((b) => b.unitPrice))), now: r2(median(recent.map((b) => b.unitPrice))), measure: "each", perYear: (sum(inRate, (b) => b.qty || 0) * 365) / rateDays, pack: buys[0].pack }
        : { was, now, measure: p.measure || "each", perYear, pack: null };
      priceWatch.push({
        key: p.key, product: p.product, brand: p.brand, group: p.group, measure: p.measure || "each", was, now, change, count: p.count, perYear,
        effect: r2((show.now - show.was) * show.perYear), show, basis, baseFrom: base[0].date, baseTo: base[base.length - 1].date, baseBuys: base.length, nowBuys: recent.length,
        latestDate: latest.date, latestShop: latest.shop, latestStore: latest.store, onlyShop: new Set(buys.map((b) => b.shop)).size === 1 ? latest.shop : null,
        series: buys.map((b) => ({ date: b.date, price: r2(samePack ? b.unitPrice : price(b)) })),
      });
    }
    priceWatch.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));

    // Outside the bank this month: receipts with no Entry ID, by Paid with.
    const month = asOf.slice(0, 7);
    const outRows = receipts.filter((r) => r.date.slice(0, 7) === month && !r.entryId);
    const byPaid = new Map();
    for (const r of outRows) { const k = r.paidWith || "Not recorded"; const o = byPaid.get(k) || { paidWith: k, total: 0, count: 0, receiptIds: [], outside: PAID_OUTSIDE(r.paidWith) }; o.total += r.total; o.count += 1; o.receiptIds.push(r.id); byPaid.set(k, o); }
    const outsideList = [...byPaid.values()].map((o) => ({ ...o, total: r2(o.total) })).sort((a, b) => b.total - a.total);
    const outsideBank = {
      month, label: monthLong(month), total: r2(sum(outsideList, (o) => o.total)), byPaid: outsideList,
      outside: outsideList.filter((o) => o.outside), waiting: outsideList.filter((o) => !o.outside),
    };

    const receiptsList = receipts.slice().reverse();
    const recent = weeks.slice(WEEKS - GROUP_WEEKS);
    const last13 = { from: gFrom, to: asOf, total: r2(sum(recent, (w) => w.total)), receipts: sum(recent, (w) => w.receipts.length), weeks: recent.filter((w) => w.known).length };

    // The one thing worth knowing: the largest yearly effect of a price move, or the largest change in a group against the 13 weeks before.
    const cands = [];
    if (priceWatch.length && Math.abs(priceWatch[0].effect) >= 20) cands.push({ kind: "price", score: Math.abs(priceWatch[0].effect), item: priceWatch[0] });
    // A group leads only on a large, regular change: $100 or more and a fifth or more of the 13 weeks before.
    if (prevKnown) for (const g of groupRows) if (g.group !== "Not grouped" && Math.abs(g.change) >= 100 && g.prev > 0 && Math.abs(g.change) >= 0.2 * g.prev) cands.push({ kind: "group", score: Math.abs(g.change) * (52 / GROUP_WEEKS), item: g });
    cands.sort((a, b) => b.score - a.score);
    const lead = cands[0] || { kind: "steady" };

    const m = {
      asOf, recordStart, recordEnd: receipts[receipts.length - 1].date, people: Array.isArray(input.people) ? input.people.slice() : [], counts: { receipts: receipts.length, lines: sum(receipts, (r) => r.lines.length) },
      weeks, shops, thisWeek, groups, priceWatch, outsideBank, receiptsList, problems, lead, last13,
    };
    const prods = [...products.values()];
    m.product = (key) => products.get(key) || null;
    m.mostBought = (n) => prods.slice().sort((a, b) => b.count - a.count || (a.last.date < b.last.date ? 1 : -1)).slice(0, n || 4).map(summary);
    // Bought before? Every word must appear in the product, brand, group or printed text; "pouches" finds "pouch".
    m.boughtBefore = (query) => {
      const words = norm(query).split(" ").filter(Boolean);
      if (!words.length) return [];
      const hit = (hay, w) => hay.includes(w) || (w.length > 3 && w.endsWith("es") && hay.includes(w.slice(0, -2))) || (w.length > 2 && w.endsWith("s") && hay.includes(w.slice(0, -1)));
      return prods.filter((p) => words.every((w) => hit(p.hay, w))).sort((a, b) => b.count - a.count || (a.last.date < b.last.date ? 1 : -1)).map(summary);
    };
    function summary(p) {
      const l = p.last;
      return { key: p.key, product: p.product, brand: p.brand, group: p.group, count: p.count, first: p.first, every: p.every,
        last: { date: l.date, shop: l.shop, store: l.store, unitPrice: l.unitPrice, unit: l.unit, qty: l.qty, amount: l.amount, receiptId: l.receiptId } };
    }
    m.receipt = (id) => byId.get(id) || null;
    return m;
  };

  // ---------- copy ----------
  const fx = (opts) => ({ m0: (opts && opts.fmt) || money0, m2: money2, dl: (opts && opts.fmtDate) || dLong });
  const perWord = (measure) => (measure === "kg" ? "per kg" : measure === "L" ? "per litre" : "each");
  const pct = (c) => `${c > 0 ? "+" : "−"}${Math.round(Math.abs(c) * 100)}%`;
  function againstUsual(total, usual) {
    if (usual == null) return null;
    const d = total - usual;
    if (Math.abs(d) < Math.max(10, usual * 0.05)) return "about the same as a usual week";
    const step = Math.abs(d) < 100 ? 5 : 10;
    return `about ${money0(Math.max(step, Math.round(Math.abs(d) / step) * step))} ${d < 0 ? "under" : "over"} a usual week`;
  }
  const oftenText = (p) => (p.count === 1 ? "once" : p.count === 2 ? "twice" : p.every == null ? plural(p.count, "time")
    : `${p.count} times, ${p.every <= 10 ? `about every ${plural(p.every, "day")}` : p.every <= 60 ? `about every ${plural(Math.round(p.every / 7), "week")}` : `about every ${plural(Math.round(p.every / 30), "month")}`}`);
  const paidPhrase = (p) => (/gift/i.test(p) ? "by gift card" : /cash/i.test(p) ? "in cash" : /points/i.test(p) ? "with points" : `by ${String(p).toLowerCase()}`);
  function outsideSentence(m, X) {
    const o = m.outsideBank.outside; if (!o.length) return null;
    const parts = o.map((p, i) => `${X.m2(p.total)} ${i === 0 ? "was paid " : ""}${paidPhrase(p.paidWith)}`);
    const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
    return `In ${MONTH[+m.outsideBank.month.slice(5, 7) - 1]}, ${list}, so your bank won't show it.`;
  }
  const matchSentence = (r) => (r.match === "matched" ? `Matched to bank row ${r.entryId}, ${dShort(r.date)}.${/mixed/i.test(r.paidWith) ? " Part was paid another way, so the bank row is less than the total." : ""}`
    : r.match === "outside" ? (/gift/i.test(r.paidWith) ? "Paid by gift card, so no bank row." : /cash/i.test(r.paidWith) ? "Paid in cash, so no bank row." : `Paid ${paidPhrase(r.paidWith || "another way")}, so no bank row.`)
      : "Paid by card, but no bank row matches it yet. It should match after the next bank import.");
  const matchChip = (r) => (r.match === "matched" ? `<span class="kx-groc-chip good">Matched</span>` : r.match === "outside" ? `<span class="kx-groc-chip">No bank row</span>` : `<span class="kx-groc-chip amber">Not matched yet</span>`);
  const paidChip = (r) => `<span class="kx-groc-chip line">${esc(r.paidWith || "Not recorded")}</span>`;
  const where = (r) => esc(r.store && !/^online$/i.test(r.store) ? `${r.shop} ${r.store}` : r.shop);
  // Notes are typed by people and agents; account and merchant keys are for the sheet, not the reader.
  const plainNote = (t) => String(t).replace(/\s*\b(?:ACC|MER|CAT)-[A-Z0-9-]+\b/g, "").replace(/\s+([.,;])/g, "$1").trim();
  const sourceLabel = (k) => ({ photo: "Open the receipt photo", pdf: "Open the receipt PDF", email: "Open the emailed receipt", export: "Open the export", screenshot: "Open the screenshot" }[String(k || "").toLowerCase()] || "Open the source file");

  // ---------- charts ----------
  const roundTop = (x, y, w, h, r) => { r = Math.max(0, Math.min(r, w / 2, h)); return `M${x.toFixed(1)},${(y + h).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}V${(y + h).toFixed(1)}Z`; };
  const niceStep = (max) => [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find((s) => max / s <= 4) || 20000;
  function weeksSVG(m, narrow) {
    const W = narrow ? 340 : 640, H = narrow ? 222 : 316, pl = narrow ? 34 : 42, pr = narrow ? 44 : 56, pt = 34, pb = 22;
    const pw = W - pl - pr, ph = H - pt - pb, ws = m.weeks, n = ws.length, tw = m.thisWeek;
    const max = Math.max(1, ...ws.map((w) => w.total));
    const top = Math.max(max, tw.usual || 0) * 1.12, y = (v) => pt + ph - (v / top) * ph, step = niceStep(max);
    const slot = pw / n, bw = Math.min(narrow ? 8 : 16, slot * 0.64), gap = 2;
    const out = [];
    out.push(`<rect class="kx-groc-now" x="${(pl + (n - 1) * slot).toFixed(1)}" y="${pt - 4}" width="${slot.toFixed(1)}" height="${ph + 4}" rx="6"/>`);
    for (let v = step; v <= max; v += step) out.push(`<line class="kx-groc-gl" x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="kx-groc-ax" x="${pl - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">$${commas(String(v))}</text>`);
    out.push(`<line class="kx-groc-base" x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}"/><text class="kx-groc-ax" x="${pl - 6}" y="${y(0) + 3.5}" text-anchor="end">$0</text>`);
    let maxI = 0; ws.forEach((w, i) => { if (w.total > ws[maxI].total) maxI = i; });
    ws.forEach((w, i) => {
      const x = pl + i * slot + (slot - bw) / 2; let acc = 0;
      const segs = m.shops.map((s) => [s, w.byShop[s.name] || 0]).filter(([, v]) => v > 0);
      segs.forEach(([s, v], j) => {
        const y1 = y(acc + v), y0 = y(acc) - (j ? gap : 0), h = Math.max(0.5, y0 - y1);
        out.push(j === segs.length - 1 ? `<path class="kx-groc-s${s.slot}" d="${roundTop(x, y1, bw, h, narrow ? 2 : 3)}"/>` : `<rect class="kx-groc-s${s.slot}" x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>`);
        acc += v;
      });
      const prev = i ? ws[i - 1].start.slice(5, 7) : null, mo = w.start.slice(5, 7);
      if (mo !== prev && !(narrow && i === n - 1)) out.push(`<text class="kx-groc-ax" x="${(pl + i * slot + 1).toFixed(1)}" y="${H - 6}">${MON[+mo - 1]}</text>`);
    });
    const label = (i, txt, cls) => { const w = ws[i], cx = pl + i * slot + slot / 2; const anchor = i >= n - 2 ? "end" : i <= 1 ? "start" : "middle"; const ax = anchor === "end" ? pl + (i + 1) * slot : anchor === "start" ? pl + i * slot : cx; return `<text class="${cls}" x="${ax.toFixed(1)}" y="${(y(w.total) - 7).toFixed(1)}" text-anchor="${anchor}">${txt}</text>`; };
    // The usual week: a line across the plot, named in the right margin so it never sits on a bar.
    if (tw.usual != null) out.push(`<line class="kx-groc-usual" x1="${pl}" x2="${W - pr + 4}" y1="${y(tw.usual).toFixed(1)}" y2="${y(tw.usual).toFixed(1)}"/><text class="kx-groc-ul" x="${W - pr + 8}" y="${(y(tw.usual) - 2).toFixed(1)}">Usual</text><text class="kx-groc-ul v" x="${W - pr + 8}" y="${(y(tw.usual) + 11).toFixed(1)}">${money0(tw.usual)}</text>`);
    if (maxI < n - 2 && ws[maxI].total > 0) out.push(label(maxI, money0(ws[maxI].total), "kx-groc-vl"));
    out.push(`<text class="kx-groc-ul" x="${(pl + n * slot).toFixed(1)}" y="${pt - 21}" text-anchor="end">This week</text><text class="kx-groc-vl now" x="${(pl + n * slot).toFixed(1)}" y="${pt - 8}" text-anchor="end">${tw.total > 0 ? money0(tw.total) : "None yet"}</text>`);
    ws.forEach((w, i) => out.push(`<rect class="kx-groc-hit" data-wk="${i}" x="${(pl + i * slot).toFixed(1)}" y="${pt}" width="${slot.toFixed(1)}" height="${ph}"/>`));
    const aria = `Grocery spending each week for ${n} weeks to ${dLong(m.asOf)}, stacked by shop. This week ${money0(tw.total)}${tw.usual != null ? `, a usual week ${money0(tw.usual)}` : ""}; the most was ${money0(ws[maxI].total)} in the ${ws[maxI].label.toLowerCase()}.`;
    return `<svg class="kx-groc-svg kx-groc-wk ${narrow ? "narrow" : "wide"}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${out.join("")}</svg>`;
  }
  function weekSpark(m, wide) {
    const ws = m.weeks.slice(-12), tw = m.thisWeek, W = wide ? 300 : 156, H = wide ? 56 : 52, bw = wide ? 17 : 9, slot = W / 12;
    const max = Math.max(1, ...ws.map((w) => w.total), tw.usual || 0) * 1.05, y = (v) => H - 2 - (v / max) * (H - 4);
    const bars = ws.map((w, i) => { const h = Math.max(w.total > 0 ? 2 : 0, H - 2 - y(w.total)); const x = i * slot + (slot - bw) / 2; return h ? `<path class="${i === ws.length - 1 ? "now" : "past"}" d="${roundTop(x, H - 2 - h, bw, h, wide ? 3 : 2.5)}"/>` : `<rect class="past" x="${x.toFixed(1)}" y="${H - 3}" width="${bw}" height="1"/>`; }).join("");
    const usual = tw.usual != null ? `<line class="kx-groc-usual" x1="0" x2="${W}" y1="${y(tw.usual).toFixed(1)}" y2="${y(tw.usual).toFixed(1)}"/>` : "";
    const aria = `The last 12 weeks of groceries: this week ${money0(tw.total)}${tw.usual != null ? `, against a usual week of ${money0(tw.usual)}` : ""}.`;
    return `<svg class="kx-groc-svg kx-groc-hspark ${wide ? "wide" : "small"}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${bars}${usual}<line class="kx-groc-base" x1="0" x2="${W}" y1="${H - 1.5}" y2="${H - 1.5}"/></svg>`;
  }
  function priceSpark(p, W, H, big) {
    const s = p.series; if (!s.length) return "";
    const pad = big ? { l: 44, r: 54, t: 16, b: 22 } : { l: 4, r: 6, t: 6, b: 6 };
    const t0 = ms(s[0].date), t1 = Math.max(t0 + DAY, ms(s[s.length - 1].date));
    const lo = Math.min(...s.map((x) => x.price), p.show.was), hi = Math.max(...s.map((x) => x.price), p.show.was), span = Math.max(hi - lo, hi * 0.06);
    const x = (d) => pad.l + ((ms(d) - t0) / (t1 - t0)) * (W - pad.l - pad.r), y = (v) => pad.t + (1 - (v - (lo - span * 0.1)) / (span * 1.2)) * (H - pad.t - pad.b);
    const dir = p.change > 0 ? "up" : "down";
    let d = ""; s.forEach((pt, i) => { d += (i ? "L" : "M") + x(pt.date).toFixed(1) + "," + y(pt.price).toFixed(1); });
    const last = s[s.length - 1], out = [];
    out.push(`<line class="kx-groc-wasline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(p.show.was).toFixed(1)}" y2="${y(p.show.was).toFixed(1)}"/>`);
    out.push(`<path class="kx-groc-pline ${dir}" d="${d}"/>`);
    if (big) {
      s.forEach((pt) => out.push(`<circle class="kx-groc-pdot" cx="${x(pt.date).toFixed(1)}" cy="${y(pt.price).toFixed(1)}" r="3"/>`));
      out.push(`<text class="kx-groc-ax" x="${pad.l - 6}" y="${(y(p.show.was) + 3.5).toFixed(1)}" text-anchor="end">${money2(p.show.was)}</text>`);
      out.push(`<text class="kx-groc-vl" x="${(x(last.date) + 8).toFixed(1)}" y="${(y(last.price) + 4).toFixed(1)}">${money2(last.price)}</text>`);
      let prev = null; s.forEach((pt) => { const mo = pt.date.slice(0, 7); if (mo !== prev) { out.push(`<text class="kx-groc-ax" x="${x(mo + "-01" < s[0].date ? s[0].date : mo + "-01").toFixed(1)}" y="${H - 5}">${MON[+mo.slice(5, 7) - 1]}</text>`); prev = mo; } });
    }
    out.push(`<circle class="kx-groc-pend ${dir}" cx="${x(last.date).toFixed(1)}" cy="${y(last.price).toFixed(1)}" r="${big ? 4.5 : 3.5}"/>`);
    const aria = `${p.product}: ${money2(p.show.was)} ${perWord(p.show.measure)} before, ${money2(p.show.now)} now, over ${plural(p.count, "buy")}.`;
    return `<svg class="kx-groc-svg kx-groc-pspark${big ? " big" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${out.join("")}</svg>`;
  }

  // ---------- home card ----------
  G.renderHome = function renderHome(m, opts) {
    if (!m) return "";
    const X = fx(opts), tw = m.thisWeek, cmp = againstUsual(tw.total, tw.usual);
    const head = `<div class="cardhead"><span class="q">This week's shop</span><span class="sub">${esc(tw.label)}</span></div>`;
    const fig = tw.receipts
      ? `<button class="kx-groc-big" data-kxg="week" aria-label="${esc(`${X.m0(tw.total)} ${tw.done ? "this week" : "so far this week"}. See the receipts.`)}">${esc(X.m0(tw.total))}</button>
         <p class="say">${tw.done ? "This week" : "So far this week"}${cmp ? `, ${cmp}` : ""}.</p>`
      : `<p class="kx-groc-none">No receipts yet this week.</p><p class="say">The latest receipt is from ${esc(dDay(m.recordEnd))}.</p>`;
    const basis = tw.usual != null ? `A usual week is ${esc(X.m0(tw.usual))}, the middle of the ${plural(tw.usualWeeks.length, "week")} before.` : "Not enough weeks yet to say what a usual week is.";
    const counts = tw.receipts ? `${plural(tw.receipts, "receipt")} and ${plural(tw.items, "item")}. ` : "";
    const outside = outsideSentence(m, X);
    return `<section class="card kx-groc-home kx-groc-c" aria-label="This week's shop">${head}
      <div class="kx-groc-hrow"><div class="kx-groc-hfig">${fig}</div><figure class="kx-groc-hsp">${weekSpark(m, false)}${weekSpark(m, true)}<figcaption><span>12 weeks</span><span>This week</span></figcaption></figure></div>
      <p class="sub kx-groc-basis">${counts}${basis}</p>
      ${outside ? `<p class="kx-groc-note"><span class="kx-groc-ic" aria-hidden="true">${ICON.card}</span><span>${esc(outside)}</span></p>` : ""}
      <div class="kx-groc-foot"><span class="sub">From receipts to ${esc(X.dl(m.recordEnd))}</span><button class="linkbtn" data-kxg="go">Groceries →</button></div>
    </section>`;
  };

  // ---------- full view ----------
  const ICON = {
    card: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>`,
    search: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17.2v.1"/></svg>`,
  };
  function leadHTML(m, X) {
    const L = m.lead;
    if (L.kind === "price") {
      const p = L.item, up = p.effect > 0, sh = p.show;
      const title = `${p.product}: about ${X.m0(Math.abs(p.effect))} ${up ? "more" : "less"} a year`;
      const say = `Was ${money2(sh.was)} ${perWord(sh.measure)}${packNote(p)} in ${monthRange(p.baseFrom, p.baseTo)}, now ${money2(sh.now)}: ${up ? "up" : "down"} ${Math.round(Math.abs(p.change) * 100)}% over ${plural(p.count, "buy")}. You buy about ${rateText(p)}.`;
      return { title, say, chip: true, btn: `<button class="linkbtn" data-kxg="product" data-key="${esc(p.key)}">See every price →</button>` };
    }
    if (L.kind === "group") {
      const g = L.item, up = g.change > 0;
      return { title: `${X.m0(Math.abs(g.change))} ${up ? "more" : "less"} on ${g.group} than the 13 weeks before`, say: `${X.m0(g.amount)} in the last 13 weeks, against ${X.m0(g.prev)} in the 13 weeks before that.`, btn: `<button class="linkbtn" data-kxg="group" data-group="${esc(g.group)}">See what's in it →</button>` };
    }
    return { title: "Groceries are steady", say: `About ${X.m0(m.last13.total / Math.max(1, m.last13.weeks))} a week over the last 13 weeks, and no price on your receipts moved 8% or more.` };
  }
  const rateText = (p) => { const sh = p.show; return sh.measure === "each" ? `${Math.round(sh.perYear)} a year` : `${sh.perYear >= 10 ? Math.round(sh.perYear) : sh.perYear.toFixed(1)} ${sh.measure === "L" ? "litres" : "kg"} a year`; };
  const packNote = (p) => (p.show.pack && !norm(p.product).includes(norm(p.show.pack)) ? ` (${p.show.pack})` : "");
  const wasNow = (p) => `was ${money2(p.show.was)}, now ${money2(p.show.now)} ${perWord(p.show.measure)}${packNote(p)}`;
  function statsHTML(m, X) {
    const tw = m.thisWeek, ob = m.outsideBank, l13 = m.last13;
    const cmp = againstUsual(tw.total, tw.usual);
    const obSub = ob.byPaid.length ? ob.outside.concat(ob.waiting).map((o) => `${o.outside ? esc(o.paidWith) : "Card, not matched yet"} ${money2(o.total)}`).join(" · ") : `Every ${esc(MONTH[+ob.month.slice(5, 7) - 1])} receipt is in the bank`;
    return `<div class="kx-groc-stats">
      <button class="kx-groc-stat" data-kxg="week"><span class="k">${esc(tw.label)}</span><b>${tw.receipts ? esc(X.m0(tw.total)) : "None yet"}</b><span class="d">${tw.receipts ? esc(cmp || plural(tw.receipts, "receipt")) : tw.usual != null ? `A usual week is ${esc(X.m0(tw.usual))}` : "No receipts this week"}</span></button>
      <button class="kx-groc-stat" data-kxg="weeks"><span class="k">Last 13 weeks</span><b>${esc(X.m0(l13.total))}</b><span class="d">about ${esc(X.m0(l13.total / Math.max(1, l13.weeks)))} a week, ${plural(l13.receipts, "receipt")}</span></button>
      <button class="kx-groc-stat" data-kxg="outside"><span class="k">Not in the bank, ${esc(MONTH[+ob.month.slice(5, 7) - 1])}</span><b>${ob.byPaid.length ? esc(X.m0(ob.total)) : "None"}</b><span class="d">${obSub}</span></button>
    </div>`;
  }
  function problemsHTML(m) {
    if (!m.problems.length) return "";
    const rows = m.problems.slice(0, 4).map((p) => p.receiptId && m.receipt(p.receiptId)
      ? `<li><button class="kx-groc-prob" data-kxg="receipt" data-id="${esc(p.receiptId)}"><span class="kx-groc-ic" aria-hidden="true">${ICON.alert}</span><span>${esc(p.text)}</span><span class="go" aria-hidden="true">›</span></button></li>`
      : `<li><div class="kx-groc-prob"><span class="kx-groc-ic" aria-hidden="true">${ICON.alert}</span><span>${esc(p.text)}</span></div></li>`).join("");
    const more = m.problems.length > 4 ? `<li class="sub">and ${plural(m.problems.length - 4, "more")}</li>` : "";
    return `<div class="kx-groc-probs"><p class="kx-groc-kick">Needs a look</p><ul>${rows}${more}</ul></div>`;
  }
  function legendHTML(m, X) {
    return `<ul class="kx-groc-legend">${m.shops.map((s) => `<li><i class="kx-groc-sw kx-groc-bg${s.slot}" aria-hidden="true"></i><span class="nm">${esc(s.name)}</span><span class="v num">${esc(X.m0(s.total))}</span></li>`).join("")}</ul>`;
  }
  function groupsHTML(m, X) {
    const g = m.groups;
    if (!g.rows.length) return `<p class="empty">No receipt lines in the last 13 weeks.</p>`;
    const top = g.rows.slice(0, 5), rest = g.rows.slice(5), restAmt = sum(rest, (r) => r.amount);
    const segs = top.map((r) => [r.group, r.amount, `kx-groc-bg g${r.slot}`]).concat(restAmt > 0 ? [[`${plural(rest.length, "other group")}`, restAmt, "kx-groc-bg g5"]] : []);
    const aria = `Where the groceries went in the last 13 weeks: ${top.map((r) => `${r.group} ${money0(r.amount)}`).join(", ")}${restAmt > 0 ? `, and ${money0(restAmt)} in ${rest.length} other groups` : ""}.`;
    const bar = `<div class="kx-groc-share" role="img" aria-label="${esc(aria)}">${segs.filter((s) => s[1] > 0).map((s) => `<span class="${s[2]}" style="flex-grow:${(s[1] / g.total).toFixed(4)}"></span>`).join("")}</div>`;
    const rows = g.rows.map((r) => {
      const ch = r.change == null ? "" : Math.abs(r.change) < 1 ? "same" : `${r.change > 0 ? "+" : "−"}${money0(Math.abs(r.change))}`;
      return `<li><button class="kx-groc-grow" data-kxg="group" data-group="${esc(r.group)}"><i class="kx-groc-sw kx-groc-bg g${r.slot}" aria-hidden="true"></i><span class="nm">${esc(r.group)}</span><span class="v num">${esc(X.m0(r.amount))}</span><span class="p num">${r.share < 0.005 ? "<1" : Math.round(r.share * 100)}%</span>${g.prevKnown ? `<span class="ch num" title="Against the 13 weeks before">${ch}</span>` : ""}</button></li>`;
    });
    const SHOW = 6, cls = `kx-groc-glist${g.prevKnown ? " cmp" : ""}`, hidden = g.rows.length - SHOW;
    const head = `<div class="kx-groc-ghead${g.prevKnown ? " cmp" : ""}" aria-hidden="true"><span></span><span class="nm">Group</span><span class="v">13 weeks</span><span class="p">Share</span>${g.prevKnown ? `<span class="ch">Change</span>` : ""}</div>`;
    const list = hidden > 0
      ? `<ol class="${cls}">${rows.slice(0, SHOW).join("")}</ol><ol class="${cls}" id="kxg-gmore" hidden>${rows.slice(SHOW).join("")}</ol>
         <button class="kx-groc-morebtn" data-kxg="more" aria-expanded="false" aria-controls="kxg-gmore" data-more="${esc(`Show ${plural(hidden, "more group")}, ${money0(sum(g.rows.slice(SHOW), (r) => r.amount))}`)}" data-less="Show fewer groups">Show ${plural(hidden, "more group")}, ${esc(X.m0(sum(g.rows.slice(SHOW), (r) => r.amount)))}</button>`
      : `<ol class="${cls}">${rows.join("")}</ol>`;
    return `${bar}${head}${list}
      <p class="sub">${esc(X.m0(g.total))} from the lines of ${plural(g.receipts, "receipt")}, ${esc(dShort(g.from))} to ${esc(dLong(g.to))}.${g.prevKnown ? ` Change is against the 13 weeks before.` : ""}</p>`;
  }
  function priceRows(m, X) {
    if (!m.priceWatch.length) return `<p class="empty">No price on your receipts moved 8% or more. A product needs 3 buys before it is watched.</p>`;
    return `<ul class="kx-groc-plist">${m.priceWatch.slice(0, 8).map((p) => {
      const up = p.change > 0;
      return `<li><button class="kx-groc-prow" data-kxg="product" data-key="${esc(p.key)}">
        <span class="nm"><b>${esc(p.product)}</b><small>${p.brand ? esc(p.brand) + " · " : p.onlyShop ? "at " + esc(p.onlyShop) + " · " : ""}${esc(wasNow(p))}</small></span>
        ${priceSpark(p, 96, 34, false)}
        <span class="ch ${up ? "up" : "down"}"><b class="num">${pct(p.change)}</b><small>${plural(p.count, "buy")}</small></span>
        <span class="yr"><b class="num">about ${esc(X.m0(Math.abs(p.effect)))}</b><small>a year ${up ? "more" : "less"} at your rate</small></span>
      </button></li>`;
    }).join("")}</ul>`;
  }
  function resultRows(list, empty) {
    if (!list.length) return `<p class="kx-groc-bempty">${esc(empty)}</p>`;
    return `<ul class="kx-groc-blist">${list.slice(0, 6).map((p) => {
      const l = p.last, price = l.unit === "kg" ? `${money2(l.unitPrice)} per kg` : `${money2(l.unitPrice)} each`;
      return `<li><button class="kx-groc-brow" data-kxg="product" data-key="${esc(p.key)}"><span class="t"><b>${esc(p.product)}</b>${p.brand ? `<small>${esc(p.brand)}</small>` : ""}</span>
        <span class="s">Last bought ${esc(dShort(l.date))} at ${esc(l.store ? `${l.shop} ${l.store}` : l.shop)}, ${price}</span>
        <span class="s">${esc(oftenText(p))} since ${esc(monthRange(p.first, p.first))}</span></button></li>`;
    }).join("")}</ul>${list.length > 6 ? `<p class="sub">${plural(list.length - 6, "more match", "more matches")}. Add a word to narrow it.</p>` : ""}`;
  }
  const searchResults = (m, q) => (String(q || "").trim()
    ? resultRows(m.boughtBefore(q), `Nothing on your receipts matches "${String(q).trim()}".`)
    : `<p class="kx-groc-kick">Most bought</p>${resultRows(m.mostBought(4), "No products read yet.")}`);
  function receiptRow(r, X) {
    return `<li><button class="kx-groc-rrow" data-kxg="receipt" data-id="${esc(r.id)}">
      <span class="dt"><b>${+r.date.slice(8, 10)}</b><span>${MON[+r.date.slice(5, 7) - 1]}</span></span>
      <span class="mid"><span class="t"><i class="kx-groc-sw kx-groc-bg${r.slot}" aria-hidden="true"></i>${where(r)}</span><span class="s">${esc(WD[new Date(ms(r.date)).getUTCDay()])}${r.time ? " " + esc(time12(r.time)) : ""}${r.person ? " · " + esc(r.person) : ""} · ${r.items != null ? plural(r.items, "item") : "items not counted"}${r.channel && !/^in-store$/i.test(r.channel) ? " · " + esc(r.channel) : ""}</span></span>
      <span class="chips">${paidChip(r)}${matchChip(r)}${r.ok ? "" : `<span class="kx-groc-chip warn">Check</span>`}</span>
      <span class="amt num">${esc(X.m2(r.total))}</span></button></li>`;
  }
  function receiptsHTML(m, X) {
    const list = m.receiptsList, SHOW = 12, groups = [];
    list.forEach((r, i) => { const k = r.date.slice(0, 7); let g = groups[groups.length - 1]; if (!g || g.k !== k) { g = { k, rows: [], total: 0 }; groups.push(g); } g.rows.push([r, i]); g.total += r.total; });
    const block = (g, pick) => { const rows = g.rows.filter(([, i]) => pick(i)); return rows.length ? `<h3 class="kx-groc-month"><span>${esc(monthLong(g.k))}</span><span class="sub num">${plural(g.rows.length, "receipt")} · ${esc(X.m0(g.total))}</span></h3><ul class="kx-groc-rlist">${rows.map(([r]) => receiptRow(r, X)).join("")}</ul>` : ""; };
    const head = groups.map((g) => block(g, (i) => i < SHOW)).join("");
    const more = list.length > SHOW ? `<div class="kx-groc-more" id="kxg-more" hidden>${groups.map((g) => block(g, (i) => i >= SHOW).replace(/<h3 class="kx-groc-month">/, g.rows.some(([, i]) => i < SHOW) ? '<h3 class="kx-groc-month cont">' : '<h3 class="kx-groc-month">')).join("")}</div>
      <button class="kx-groc-morebtn" data-kxg="more" aria-expanded="false" aria-controls="kxg-more" data-more="Show all ${list.length} receipts" data-less="Show fewer receipts">Show all ${list.length} receipts</button>` : "";
    return head + more;
  }

  G.render = function render(m, opts) {
    if (!m) return "";
    const X = fx(opts), L = leadHTML(m, X);
    return `<div class="kx-groc-view">
      <section class="card kx-groc-lead kx-groc-c">
        <p class="kx-groc-kick">Groceries · ${plural(m.counts.receipts, "receipt")}, ${esc(dShort(m.recordStart))} ${m.recordStart.slice(0, 4) !== m.recordEnd.slice(0, 4) ? esc(m.recordStart.slice(0, 4)) + " " : ""}to ${esc(X.dl(m.recordEnd))}</p>
        <h2 class="kx-groc-h">${esc(L.title)}${L.chip ? ` <span class="kx-groc-chip est">Estimate</span>` : ""}</h2>
        <p class="say">${L.say}</p>${L.btn || ""}
        ${statsHTML(m, X)}${problemsHTML(m)}
      </section>
      <div class="kx-groc-grid">
        <section class="card kx-groc-weeks kx-groc-c">
          <div class="cardhead"><span class="q">Each week, by shop</span><button class="linkbtn" data-kxg="weeks">See each week →</button></div>
          <p class="sub">${WEEKS} weeks to ${esc(dLong(m.asOf))}. The shaded column is this week${m.thisWeek.usual != null ? "; the line is a usual week" : ""}.</p>
          ${legendHTML(m, X)}
          <div class="kx-groc-chart">${weeksSVG(m, false)}${weeksSVG(m, true)}<div class="kx-groc-tip" role="presentation" hidden></div></div>
        </section>
        <section class="card kx-groc-groups kx-groc-c">
          <div class="cardhead"><span class="q">Where it goes</span><span class="sub">Last 13 weeks</span></div>
          ${groupsHTML(m, X)}
        </section>
        <section class="card kx-groc-prices kx-groc-c">
          <div class="cardhead"><span class="q">Price watch</span><span class="kx-groc-chip est">Estimate</span></div>
          <p class="sub">Prices that moved 8% or more on products bought at least 3 times. "Was" is the middle price ${m.priceWatch.some((p) => p.basis === "first") ? "of your first 3 months of receipts" : "6 to 12 months ago"}; a year at your rate is an estimate.</p>
          ${priceRows(m, X)}
        </section>
        <section class="card kx-groc-bought kx-groc-c">
          <div class="cardhead"><span class="q">Bought before?</span></div>
          <label class="kx-groc-search"><span class="kx-groc-sr">Search your receipts</span>${ICON.search}<input type="search" data-kxg-q placeholder="Try pouch, nappies or milk" autocomplete="off" spellcheck="false"></label>
          <div class="kx-groc-bres" data-kxg-res aria-live="polite">${searchResults(m, "")}</div>
        </section>
        <section class="card kx-groc-receipts kx-groc-c">
          <div class="cardhead"><span class="q">Receipts</span><span class="sub">${plural(m.counts.receipts, "receipt")}, latest first</span></div>
          ${receiptsHTML(m, X)}
        </section>
      </div>
    </div>`;
  };

  // ---------- drawers ----------
  G.receiptHTML = function receiptHTML(m, id, opts) {
    const r = m.receipt(id); if (!r) return `<div class="kx-groc-dr"><p class="empty">That receipt is not on the sheet any more.</p></div>`;
    const X = fx(opts);
    const items = r.lines.filter((l) => l.kind === "Item"), disc = r.lines.filter((l) => l.kind === "Discount"), other = r.lines.filter((l) => l.kind === "Fee" || l.kind === "Deposit");
    const gstLines = r.lines.filter((l) => l.taxable), gstCalc = r2(sum(gstLines, (l) => l.amount) / 11);
    const row = (l) => {
      const isD = l.kind === "Discount", wq = l.unit === "kg" || l.unit === "L";
      const qty = isD || l.qty == null ? "" : wq ? `${l.qty.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} ${l.unit}` : String(l.qty);
      const each = isD || l.unitPrice == null ? "" : wq ? `${money2(l.unitPrice)}/${l.unit}` : money2(l.unitPrice);
      const name = isD ? "Saving" + (l.product ? ` on ${l.product}` : "") : l.kind === "Fee" ? l.product || "Fee" : l.kind === "Deposit" ? l.product || "Deposit" : l.product || "Not read";
      return `<tr class="${isD ? "disc" : ""}${!l.group ? " nogroup" : ""}"><td class="it"><span class="pr">${esc(name)}</span><span class="g">${l.group ? `${esc(l.group)} · ` : `<b>No group</b> · `}${esc(l.text)}</span></td>
        <td class="n q" data-l="Qty">${esc(qty)}</td><td class="n e" data-l="Each">${esc(each)}</td><td class="n a">${esc(money2(l.amount))}</td><td class="gst" data-l="GST">${l.taxable ? `<abbr title="Includes GST">GST</abbr>` : `<span class="kx-groc-sr">GST-free</span>`}</td></tr>`;
    };
    const tot = (k, v, cls) => (v == null ? "" : `<div${cls ? ` class="${cls}"` : ""}><dt>${k}</dt><dd class="num">${esc(v)}</dd></div>`);
    const savings = r.savings != null ? r.savings : -sum(disc, (l) => l.amount);
    const check = r.ok ? `<p class="kx-groc-ok">The lines add up to the printed total.</p>`
      : `<p class="kx-groc-warnline"><span class="kx-groc-ic" aria-hidden="true">${ICON.alert}</span><span>${esc((m.problems.find((p) => p.kind === "check" && p.receiptId === r.id) || {}).text || "This receipt's check is not OK.")}</span></p>`;
    return `<div class="kx-groc-dr kx-groc-c">
      <p class="kx-groc-kick">Receipt · ${esc(dDay(r.date))} ${esc(r.date.slice(0, 4))}${r.time ? ` at ${esc(time12(r.time))}` : ""}</p>
      <h2 class="kx-groc-dh">${where(r)}</h2>
      <p class="sub">${[r.channel, r.person, r.items != null ? plural(r.items, "item") : ""].filter(Boolean).map(esc).join(" · ")}</p>
      <div class="kx-groc-drsum"><b class="kx-groc-drbig">${esc(X.m2(r.total))}</b><span class="chips">${paidChip(r)}${matchChip(r)}</span></div>
      <p class="kx-groc-match ${r.match}">${esc(matchSentence(r))}</p>
      ${check}
      <table class="kx-groc-lines"><caption class="kx-groc-sr">Every line on this receipt, in printed order</caption>
        <thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Each</th><th class="n">Amount</th><th class="gst"><span class="kx-groc-sr">GST</span></th></tr></thead>
        <tbody>${r.lines.length ? r.lines.map(row).join("") : `<tr><td colspan="5" class="empty">No lines read yet.</td></tr>`}</tbody></table>
      <dl class="kx-groc-totals">
        ${tot(`Items (${items.length} ${items.length === 1 ? "line" : "lines"})`, money2(sum(items, (l) => l.amount)))}
        ${savings ? tot("Savings", money2(-Math.abs(savings)), "save") : ""}
        ${other.length ? tot("Fees and deposits", money2(sum(other, (l) => l.amount))) : ""}
        ${tot("Total", money2(r.total), "total")}
        ${tot("GST included", r.gst != null ? money2(r.gst) : `${money2(gstCalc)} (worked out)`)}
      </dl>
      <p class="sub">GST marks the lines that include GST. The rest are GST-free.${r.note ? ` Note: ${esc(plainNote(r.note))}` : ""}</p>
      ${/^https?:\/\//i.test(r.source) ? `<a class="kx-groc-src" href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">${esc(sourceLabel(r.sourceKind))} <span aria-hidden="true">↗</span></a>` : r.source ? `<p class="kx-groc-srcname"><span class="sub">Source file${r.sourceKind ? ` (${esc(r.sourceKind.toLowerCase())})` : ""}</span><b>${esc(r.source)}</b></p>` : `<p class="sub">No source file is linked for this receipt.</p>`}
    </div>`;
  };
  const listOf = (m, ids, X) => `<ul class="kx-groc-rlist">${ids.map((id) => m.receipt(id)).filter(Boolean).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)).map((r) => receiptRow(r, X)).join("")}</ul>`;
  G.weekHTML = function weekHTML(m, opts) {
    const X = fx(opts), tw = m.thisWeek, cmp = againstUsual(tw.total, tw.usual), med = tw.usual;
    const prior = tw.usualWeeks.slice().reverse();
    const sorted = tw.usualWeeks.slice().sort((a, b) => a.total - b.total), h = sorted.length >> 1;
    const mids = new Set((sorted.length % 2 ? [sorted[h]] : [sorted[h - 1], sorted[h]]).filter(Boolean).map((w) => w.start));
    return `<div class="kx-groc-dr kx-groc-c">
      <p class="kx-groc-kick">This week's shop</p><h2 class="kx-groc-dh">${esc(tw.label)}</h2>
      <div class="kx-groc-drsum"><b class="kx-groc-drbig">${esc(X.m2(tw.total))}</b></div>
      <p class="say">${tw.receipts ? `${plural(tw.receipts, "receipt")} and ${plural(tw.items, "item")}${cmp ? `, ${cmp}` : ""}.` : "No receipts yet this week."}</p>
      ${tw.receipts ? listOf(m, tw.receiptIds, X) : ""}
      <h3 class="kx-groc-sh">How a usual week is worked out</h3>
      ${med != null ? `<p class="sub">The middle of the ${plural(prior.length, "week")} before this one: ${esc(money2(med))}${prior.length % 2 ? "" : ", halfway between the two middle weeks"}. The middle is used so one big shop does not move it.</p>
      <ul class="kx-groc-wlist">${prior.map((w) => `<li${mids.has(w.start) ? ` class="mid"` : ""}><span>${esc(w.label)}${mids.has(w.start) ? ` <span class="kx-groc-chip est">Middle</span>` : ""}</span><span class="num">${esc(money2(w.total))}</span></li>`).join("")}</ul>` : `<p class="sub">Fewer than 4 weeks of receipts before this one, so there is no usual week yet.</p>`}
    </div>`;
  };
  G.weeksHTML = function weeksHTML(m, opts) {
    const X = fx(opts);
    return `<div class="kx-groc-dr kx-groc-c">
      <p class="kx-groc-kick">Each week, by shop</p><h2 class="kx-groc-dh">${WEEKS} weeks to ${esc(dShort(m.asOf))}</h2>
      <p class="sub">The receipts' printed totals, Monday to Sunday. Weeks before the first receipt show as not recorded.</p>
      <ul class="kx-groc-wlist big">${m.weeks.slice().reverse().map((w) => `<li><span class="w"><b>${esc(w.label)}</b><small>${w.known ? (w.receipts.length ? m.shops.filter((s) => w.byShop[s.name]).map((s) => `<i class="kx-groc-sw kx-groc-bg${s.slot}" aria-hidden="true"></i>${esc(s.name)} ${esc(money2(w.byShop[s.name]))}`).join(" · ") : "No receipts") : "Not recorded"}</small></span><span class="num">${w.known ? esc(X.m2(w.total)) : "–"}</span></li>`).join("")}</ul>
    </div>`;
  };
  G.outsideHTML = function outsideHTML(m, opts) {
    const X = fx(opts), ob = m.outsideBank;
    const sec = (o) => `<h3 class="kx-groc-sh">${o.outside ? `Paid ${esc(paidPhrase(o.paidWith))}` : "Card, not matched yet"} · ${esc(money2(o.total))}</h3>${listOf(m, o.receiptIds, X)}`;
    return `<div class="kx-groc-dr kx-groc-c">
      <p class="kx-groc-kick">Outside the bank</p><h2 class="kx-groc-dh">${esc(ob.label)}</h2>
      <p class="say">${ob.byPaid.length ? `${esc(X.m2(ob.total))} on ${plural(sum(ob.byPaid, (o) => o.count), "receipt")} with no bank row.` : "Every receipt this month matches a bank row."}</p>
      <p class="sub">A gift card or cash is still spending, so these receipts count in every total here. Your bank statement will not show them.</p>
      ${ob.outside.map(sec).join("")}${ob.waiting.map(sec).join("")}
    </div>`;
  };
  G.productHTML = function productHTML(m, key, opts) {
    const p = m.product(key); if (!p) return `<div class="kx-groc-dr"><p class="empty">Not found.</p></div>`;
    const X = fx(opts), w = m.priceWatch.find((x) => x.key === key);
    const buys = p.buys.slice().reverse();
    const watch = w ? `<div class="kx-groc-pbox"><p><b>${pct(w.change)}</b> over ${plural(w.count, "buy")}: ${esc(wasNow(w))}.${w.show.measure === "each" && w.measure !== "each" ? ` Per ${w.measure}, ${money2(w.was)} to ${money2(w.now)}.` : ""}</p>
        ${priceSpark(w, 480, 150, true)}
        <p class="sub">"Was" is the middle price in ${esc(monthRange(w.baseFrom, w.baseTo))} (${plural(w.baseBuys, "buy")}); "now" is the middle of your latest ${w.nowBuys === 1 ? "buy" : plural(w.nowBuys, "buy")}, so one special does not count. A year at your rate: (${money2(w.show.now)} − ${money2(w.show.was)}) × about ${esc(rateText(w))} = about ${esc(X.m0(Math.abs(w.effect)))} ${w.effect > 0 ? "more" : "less"}. <span class="kx-groc-chip est">Estimate</span></p></div>` : "";
    return `<div class="kx-groc-dr kx-groc-c">
      <p class="kx-groc-kick">${esc(p.group || "No group")}${p.brand ? ` · ${esc(p.brand)}` : ""}</p><h2 class="kx-groc-dh">${esc(p.product)}</h2>
      <p class="say">Bought ${esc(oftenText(p))}, since ${esc(dLong(p.first))}. Last bought ${esc(dShort(p.last.date))} at ${esc(p.last.store ? `${p.last.shop} ${p.last.store}` : p.last.shop)}.</p>
      ${watch}
      <table class="kx-groc-lines buys"><caption class="kx-groc-sr">Every time this was bought, latest first</caption><thead><tr><th>Date</th><th class="n">Qty</th><th class="n">Each</th><th class="n">Amount</th></tr></thead>
      <tbody>${buys.map((b) => { const wq = b.unit === "kg" || b.unit === "L"; return `<tr><td class="it"><button class="kx-groc-tlink" data-kxg="receipt" data-id="${esc(b.receiptId)}">${esc(dLong(b.date))}</button><span class="g">${esc(b.store ? `${b.shop} ${b.store}` : b.shop)}</span></td>
        <td class="n q" data-l="Qty">${esc(b.qty == null ? "" : wq ? `${+b.qty.toFixed(3)} ${b.unit}` : String(b.qty))}</td><td class="n e" data-l="Each">${esc(b.unitPrice == null ? "" : wq ? `${money2(b.unitPrice)}/${b.unit}` : money2(b.unitPrice))}</td><td class="n a">${esc(money2(b.amount))}</td></tr>`; }).join("")}</tbody></table>
    </div>`;
  };
  G.groupHTML = function groupHTML(m, group, opts) {
    const X = fx(opts), g = m.groups.rows.find((r) => r.group === group); if (!g) return `<div class="kx-groc-dr"><p class="empty">Not found.</p></div>`;
    const tally = new Map();
    for (const r of m.receiptsList) if (r.date >= m.groups.from) for (const l of r.lines) if ((l.group || "Not grouped") === group) {
      const k = l.kind === "Item" ? (l.product ? productKey(l) : "~" + l.text) : "~" + l.kind; const t = tally.get(k) || { name: l.kind === "Discount" ? "Savings" : l.product || l.text || l.kind, key: l.kind === "Item" && l.product ? productKey(l) : null, amount: 0, buys: new Set() };
      t.amount += l.amount; t.buys.add(r.id); tally.set(k, t);
    }
    const rows = [...tally.values()].sort((a, b) => b.amount - a.amount);
    return `<div class="kx-groc-dr kx-groc-c">
      <p class="kx-groc-kick">Where it goes · last 13 weeks</p><h2 class="kx-groc-dh">${esc(group)}</h2>
      <p class="say">${esc(X.m0(g.amount))}, ${Math.round(g.share * 100)}% of ${esc(X.m0(m.groups.total))}${g.change != null ? `; ${Math.abs(g.change) < 1 ? "the same as" : `${money0(Math.abs(g.change))} ${g.change > 0 ? "more than" : "less than"}`} the 13 weeks before` : ""}.</p>
      <ul class="kx-groc-wlist big">${rows.map((t) => `<li>${t.key ? `<button class="kx-groc-tlink w" data-kxg="product" data-key="${esc(t.key)}"><b>${esc(t.name)}</b><small>${plural(t.buys.size, "receipt")}</small></button>` : `<span class="w"><b>${esc(t.name)}</b><small>${plural(t.buys.size, "receipt")}</small></span>`}<span class="num">${esc(money2(t.amount))}</span></li>`).join("")}</ul>
    </div>`;
  };

  // ---------- binding ----------
  function act(b, m, opts, root) {
    const open = (html) => opts.onOpen && opts.onOpen(html);
    switch (b.dataset.kxg) {
      case "receipt": return open(G.receiptHTML(m, b.dataset.id, opts));
      case "week": return open(G.weekHTML(m, opts));
      case "weeks": return open(G.weeksHTML(m, opts));
      case "outside": return open(G.outsideHTML(m, opts));
      case "product": return open(G.productHTML(m, b.dataset.key, opts));
      case "group": return open(G.groupHTML(m, b.dataset.group, opts));
      case "go": return opts.onGo && opts.onGo("groceries");
      case "more": {
        const box = root.querySelector("#" + b.getAttribute("aria-controls")); if (!box) return;
        const on = b.getAttribute("aria-expanded") !== "true"; box.hidden = !on; b.setAttribute("aria-expanded", String(on));
        b.textContent = on ? b.dataset.less : b.dataset.more;
        return undefined;
      }
      default: return undefined;
    }
  }
  G.bind = function bind(el, m, opts) {
    if (!el || !m) return;
    opts = opts || {};
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-kxg]"); if (b && el.contains(b)) act(b, m, opts, el); });
    el.addEventListener("input", (e) => {
      if (!e.target.matches || !e.target.matches("[data-kxg-q]")) return;
      const res = e.target.closest(".kx-groc-bought").querySelector("[data-kxg-res]"); if (res) res.innerHTML = searchResults(m, e.target.value);
    });
    // Hover on a week: name the week, its total and each shop.
    el.addEventListener("pointermove", (e) => {
      const hit = e.target.closest && e.target.closest("[data-wk]"); const chart = e.target.closest && e.target.closest(".kx-groc-chart");
      if (!chart) return; const tip = chart.querySelector(".kx-groc-tip"); if (!tip) return;
      if (!hit) { tip.hidden = true; return; }
      const w = m.weeks[+hit.dataset.wk];
      const parts = m.shops.filter((s) => w.byShop[s.name]).map((s) => `<span><i class="kx-groc-sw kx-groc-bg${s.slot}"></i>${esc(s.name)} ${esc(money0(w.byShop[s.name]))}</span>`).join("");
      tip.innerHTML = `<b>${esc(w.label)}</b><span class="num">${w.known ? (w.total ? esc(money0(w.total)) : "No receipts") : "Not recorded"}</span>${parts}`;
      tip.hidden = false;
      const cr = chart.getBoundingClientRect(), hr = hit.getBoundingClientRect();
      const right = hr.right - cr.left + 6, left = right + tip.offsetWidth <= cr.width ? right : Math.max(0, hr.left - cr.left - tip.offsetWidth - 6);
      tip.style.left = left + "px"; tip.style.top = Math.max(0, hr.top - cr.top) + "px";
    });
    el.addEventListener("pointerleave", () => { el.querySelectorAll(".kx-groc-tip").forEach((t) => { t.hidden = true; }); });
  };
  // The page's drawer: links inside a drawer (a receipt in a week, a product's buys) open the next drawer. Bound once per drawer element.
  G.bindDrawer = function bindDrawer(el, m, opts) {
    if (!el) return;
    el.__kxgModel = m; el.__kxgOpts = opts || {};
    if (el.dataset.kxgBound) return;
    el.dataset.kxgBound = "1";
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-kxg]"); if (b && el.contains(b)) act(b, el.__kxgModel, el.__kxgOpts, el); });
  };
  G._internal = { weekStart, addMonths, median, againstUsual, shopName, money0, money2 };
  return G;
});
