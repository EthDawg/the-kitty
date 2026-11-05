/* The Kitty — the page. Reads the engine's model, draws, and talks to the viewer's connectors.
   Three data modes: demo (bundled snapshot of the fictional Davies household), live (the viewer's own
   sheet through their Google Sheets connector) and local (a test build). Nothing here computes a number
   the sheet already computes; see engine.js for the rest. */
(function () {
  "use strict";
  const E = window.Engine, SOURCES = window.KITTY_SOURCES || { countries: [] }, SNAP = window.KITTY_SNAPSHOT || null;
  if (window.KITTY_MERCHANTS) E.loadMerchants(window.KITTY_MERCHANTS);   // the merchant dictionary (merchants/), bundled at build
  const Kit = window.Kit, ART = window.KITTY_ART || {}, LOGOS = window.KITTY_LOGOS || {}, Motion = window.KittyMotion || null;
  const GS = "Google Sheets";
  const DEMO_SHEET = window.KITTY_SHEET || "1zfiCnqO36a0YmMwC8-J6iGHUGvmLdXmhbL5aPWNlExM";   // the sheet the bundled snapshot came from; `build.py --v2` points it at the v2 sheet
  const PAGE_URL = window.KITTY_PAGE_URL || "";
  const VERSION = "2.0 (phase B)"; const REPO = "https://github.com/EthDawg/the-kitty";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, o) => E.fmt(n, o), fmt0 = (n) => E.fmt0(n), fmtS = (n) => E.fmtS(n);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phone = () => window.innerWidth < 820;
  const ico = (id, cls) => `<svg class="${cls || "ic"}" aria-hidden="true"><use href="#${id}"/></svg>`;

  // ---------- per-viewer conveniences (never money data) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("kitty:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("kitty:" + k, JSON.stringify(v)); } catch (e) { /* private window */ } },
    del(k) { try { localStorage.removeItem("kitty:" + k); } catch (e) { /* ignore */ } },
  };
  const DEFAULT_PREFS = { sheet: "", onboarded: false, greeting: "", country: "", leadGoal: "", accent: "", safetyMonths: null, installed: false, moneyView: null, hidden: [] };
  const S = {
    tab: "home", m: null, grids: null, mode: SNAP ? "demo" : "none", mcp: null, user: null, db: null, sample: null, downloads: null,
    storedAt: null, unknownReadAge: false, err: {}, loading: false, liveTried: false, isOwner: false, canWrite: false,
    prefs: Object.assign({}, DEFAULT_PREFS, store.get("prefs", {})), period: { kind: "month", anchor: null },
    feed: { person: "", flow: "", q: "", limit: 80, period: { kind: "all", anchor: null } }, chat: [], asking: false, kittyRows: null, settingsRows: null, goalsRowBase: 2,
    sessionDecisions: [], sessionCats: {}, cookie: null, perf: {},
  };
  if (window.__LOCAL__) S.mode = "local";
  // test flags for local checks: ?noonb skips the tour, ?noanim freezes motion, ?tab=insights opens a tab
  const FLAGS = new URLSearchParams((location.search || "") + "&" + (location.hash || "").replace(/^#/, ""));
  if (FLAGS.has("noanim")) document.documentElement.setAttribute("data-noanim", "");
  if (FLAGS.get("theme")) S.prefs.theme = FLAGS.get("theme");   // local checks only: ?theme=dark
  const LOCAL_HOST = location.protocol === "file:" || location.hostname === "127.0.0.1" || location.hostname === "localhost";   // ?open=trust opens the trust drawer on load, for screenshots of a local build
  // entrance animations only while the page is visible: a hidden tab pauses CSS animations at their first frame
  const setAnim = () => document.documentElement.classList.toggle("anim", document.visibilityState === "visible" && !FLAGS.has("noanim") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  setAnim(); document.addEventListener("visibilitychange", setAnim);
  // every model goes through here so the per-render caches (merchant context, review queue) reset with it
  let CTX = null, REVIEW = null;
  const setModel = (m) => { S.m = m; CTX = null; REVIEW = null; return m; };
  const review = () => REVIEW || (REVIEW = E.review(S.m));
  const ctx = () => CTX || (CTX = Kit.context(S.m, { reviewIds: review().byId, cookie: ART.cookie || "", logos: LOGOS, sampleOn: !!S.sample }));
  // the demo and a read-only sheet keep this visit's judgments in memory only: the sheet is never written and nothing is remembered
  const demoModel = () => { if (!SNAP) return null; const snap = Object.assign({}, SNAP, { decisions: (SNAP.decisions || []).concat(S.sessionDecisions), entries: Object.keys(S.sessionCats).length ? (SNAP.entries || []).map((e) => (S.sessionCats[e.entry_id] ? Object.assign({}, e, { category_id: S.sessionCats[e.entry_id] }) : e)) : SNAP.entries }); return applyLocalGoals(E.model(snap)); };
  const sheetId = () => (S.prefs.sheet || DEMO_SHEET).trim();
  const isDemoSheet = () => sheetId() === DEMO_SHEET;
  const savePrefs = (patch) => { const at = Date.now(); Object.assign(S.prefs, patch); store.set("prefs", S.prefs); store.set("prefsSavedAt", at); if (S.dbDoc) S.dbDoc.set({ ...S.prefs, savedAt: at }).catch(() => {}); };
  const pref = (k, fallback) => { const v = S.prefs[k]; return v == null || v === "" ? fallback : v; };
  const today = () => (S.m ? S.m.asOf : new Date().toISOString().slice(0, 10));
  const greeting = () => pref("greeting", S.m && S.m.kitty.greeting_name ? S.m.kitty.greeting_name : "") || (S.m && S.m.people.length ? S.m.people.join(" and ") : S.m ? S.m.householdName.replace(/^The /, "") : "there");
  const leadGoal = () => { if (!S.m) return null; const want = pref("leadGoal", S.m.kitty.lead_goal || ""); return S.m.goals.find((g) => g.name === want) || S.m.goals.find((g) => g.status !== "Reached") || S.m.goals[0] || null; };
  // demo viewers' goal changes live in prefs and are laid over the model after every build
  function applyLocalGoals(m) {
    const ed = S.prefs.goalEdits || {}, added = S.prefs.localGoals || [];
    for (const [name, e] of Object.entries(ed)) { const g = m.goals.find((x) => x.name === name); if (!g) continue; if (e.target) g.target = e.target; if (e.date) g.date = e.date; if (e.acct) { g.acct = e.acct; g.balance = (m.acctById[e.acct] || {}).balance || g.balance; } localGoalRecalc(g, m); }
    for (const a of added) { if (m.goals.some((x) => x.name === a.name)) continue; const g = { row: m.goals.length + 2, name: a.name, target: a.target, date: a.date, acct: a.acct, balance: (m.acctById[a.acct] || {}).balance || 0, savedPm: E.spend(m.tx, E.window("quarter", m.asOf), (t) => t.acct === a.acct && t.amount > 0).in / 3, local: true }; localGoalRecalc(g, m); m.goals.push(g); }
    if (S.prefs.safetyMonths) m.settings["Emergency fund target (months of essential spending)"] = S.prefs.safetyMonths;
    return m;
  }
  const applyTheme = () => { const t = S.prefs.theme || "system"; if (t === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); };
  const applyAccent = () => { const a = pref("accent", S.m && S.m.kitty.accent) || "violet"; if (a === "violet") document.documentElement.removeAttribute("data-accent"); else document.documentElement.setAttribute("data-accent", a); };
  // "$11k of $12k": the one way the page states progress toward a target; the ring or bar shows the share
  const ofFmt = (v) => (Math.abs(v) >= 10000 ? fmtS(v) : fmt0(v));
  const ofText = (v, t) => `${ofFmt(v || 0)} of ${ofFmt(t || 0)}`;
  const toGo = (v, t) => { const left = Math.max(0, (t || 0) - (v || 0)); return left <= 0 ? "done" : `${ofFmt(left)} to go`; };
  const buzz = (ms = 8) => { try { if (navigator.vibrate && !reduced()) navigator.vibrate(ms); } catch (e) { /* ignore */ } };

  // ---------- connector ----------
  function errText(e, what) {
    const code = e && e.code;
    switch (code) {
      case "needs_reauth": return `Google Sheets needs reconnecting. Open claude.ai Settings → Connectors, reconnect it, then reload.`;
      case "server_not_connected": return `This page reads a sheet through the Google Sheets connector. Add it in claude.ai Settings → Connectors, then reload.`;
      case "selection_required": return `You have more than one Google Sheets connector. Pick one when claude.ai asks, then reload.`;
      case "not_in_manifest": case "approval_required": case "consent_required": return `This page needs your OK to read Google Sheets.`;
      case "blocked_by_policy": return `Your organisation's settings block Google Sheets here.`;
      case "rate_limited": return `Google is limiting how fast this account can read Sheets. Wait a minute, then try again.`;
      case "tool_error": return `Google Sheets returned an error for ${what || "the sheet"}${e.message ? `: “${esc(String(e.message).slice(0, 160))}”` : "."} Check that this Google account can open the sheet.`;
      case "server_unavailable": case "upstream_error": return `Google Sheets didn't answer just now. Try again in a moment.`;
      case "invalid_response": return `The connector returned unreadable data for ${what || "the sheet"}.`;
      case "no_mcp": return `Connectors aren't available in this view, so the page shows the bundled demo household.`;
      default: return `Couldn't read ${what || "the sheet"} (${esc(code || "unknown")}).`;
    }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function call(tool, input, refresh) {
    const opts = { cache: { staleTime: 30 * 60e3, gcTime: 7 * 864e5 } };
    if (refresh) opts.cache.refresh = true;
    let res;
    const quota = (e) => e && (e.code === "rate_limited" || /429|quota|rate.?limit|RESOURCE_EXHAUSTED|too many requests/i.test(String(e.message || "")));
    for (let attempt = 0; ; attempt++) {
      try { res = await S.mcp.callTool(GS, tool, input, opts); break; }
      catch (e) {
        if (quota(e) && attempt < 2) { setPill("warn", "Google is pacing reads…"); await sleep((e.retryAfterMs || 15000 * (attempt + 1)) + Math.random() * 2000); continue; }
        const blip = e && (e.retryable || /unavailable|\b50[234]\b|backend error|internal error|timed? ?out|deadline/i.test(String(e.message || "")));
        if (blip && attempt < 3) { await sleep((e.retryAfterMs || [1500, 4000, 9000][attempt]) + Math.random() * 800); continue; }
        throw quota(e) ? { ...e, code: "rate_limited" } : e;
      }
    }
    if (!res || typeof res !== "object" || !("payload" in res)) throw { code: "invalid_response" };
    const stamp = res.cache && res.cache.storedAt;
    const at = typeof stamp === "number" ? stamp : typeof stamp === "string" && stamp.trim() ? (/^\d+$/.test(stamp) ? Number(stamp) : Date.parse(stamp)) : NaN;
    if (!Number.isFinite(at) || at < 1e12 || at > Date.now()) S.unknownReadAge = true; else S.storedAt = S.storedAt == null ? at : Math.min(S.storedAt, at);
    let p = res.payload; if (typeof p === "string") { try { p = JSON.parse(p); } catch (e) { /* leave */ } }
    return p;
  }
  async function values(range, refresh) {
    const p = await call("get_values", { spreadsheetId: sheetId(), range }, refresh);
    if (!p || typeof p !== "object" || Array.isArray(p)) throw { code: "invalid_response" };
    const rows = p.values === undefined && typeof p.range === "string" ? [] : p.values;
    if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r))) throw { code: "invalid_response" };
    return rows;
  }
  // open-ended rows so a tab resized smaller never turns a read into a grid error
  const RANGES = {
    settings: "Settings!A1:C", accounts: "Accounts!A1:P", category_list: "Categories!A1:H", goals: "Goals!A1:J", subscriptions: "Subscriptions!A1:Q", loans: "Loans!A1:K", assets: "Assets!A1:D",
    metrics: "Metrics!A1:H", compliance: "'Compliance Checks'!A1:G", networth: "'Net Worth'!A1:I", cashflow: "'Cash Flow'!A1:T", budget: "Budget!A1:I", savings: "'Savings Finder'!A1:G",
    mortgage: "'Mortgage Scenarios'!A1:H", tax: "'Tax Forecast'!A1:F", transactions: "Transactions!A1:J", payslips: "Payslips!A1:G", kitty: "Kitty!A1:C",
    // sheet_version 2: the ledger tabs. A 1.1 sheet has none of them and the page carries on without.
    entries: "Entries!A1:U", balances: "Balances!A1:F", contracts: "Contracts!A1:Q", decisions: "Decisions!A1:H", rules: "Rules!A1:J",
  };
  const OPTIONAL = new Set(["kitty", "payslips", "tax", "mortgage", "savings", "budget", "assets", "loans", "entries", "balances", "contracts", "decisions", "rules"]);
  const CHUNK = 2500;
  async function loadBig(tab, lastCol, refresh) {
    // one read for a household-sized tab; chunks of 2,500 rows past that, three at a time, so a 20,000-row Transactions or Entries tab still opens
    const meta = await call("get_spreadsheet", { spreadsheetId: sheetId(), fields: ["sheets.properties.title", "sheets.properties.gridProperties.rowCount"] }, refresh);
    const sh = ((meta && meta.sheets) || []).find((x) => x.properties && x.properties.title === tab);
    const rows = sh && sh.properties.gridProperties ? sh.properties.gridProperties.rowCount : 0;
    if (!rows || rows <= CHUNK) return values(`${tab}!A1:${lastCol}`, refresh);
    const header = await values(`${tab}!A1:${lastCol}1`, refresh);
    const tasks = []; for (let a = 2; a <= rows; a += CHUNK) { const b = Math.min(rows, a + CHUNK - 1); tasks.push(() => values(`${tab}!A${a}:${lastCol}${b}`, refresh)); }
    const parts = []; let i = 0; const worker = async () => { while (i < tasks.length) { const k = i++; parts[k] = await tasks[k](); } };
    await Promise.all([worker(), worker(), worker()]);
    const out = header.concat(...parts); while (out.length > 1 && !(out[out.length - 1] || [])[0]) out.pop(); return out;
  }
  async function loadLive(refresh) {
    if (!S.mcp) return false;
    S.loading = true; S.storedAt = null; S.unknownReadAge = false; S.err = {};
    setPill("warn", refresh ? "Refreshing…" : "Reading your sheet…");
    const grids = {};
    await Promise.all(Object.entries(RANGES).map(([k, r]) => (k === "transactions" || k === "entries" ? loadBig(r.split("!")[0], r.split(":")[1], refresh) : values(r, refresh)).then((v) => (grids[k] = v)).catch((e) => { grids[k] = []; S.err[k] = e; })));
    S.loading = false;
    const fatal = Object.entries(S.err).filter(([k]) => !OPTIONAL.has(k));
    if (fatal.length) { S.liveErr = fatal[0][1]; setPill(S.mode === "live" ? "bad" : "demo", S.mode === "live" ? "Sheet unavailable" : "Demo data"); return false; }
    try {
      const snap = E.fromConnector(grids);
      snap.fetchedAt = null;
      const m = E.model(snap);
      if (!m.accounts.length) throw { code: "invalid_response" };
      S.grids = grids; setModel(m); S.mode = "live"; S.liveErr = null;
      S.kittyRows = grids.kitty; S.settingsRows = grids.settings;
      renderAll();
      return true;
    } catch (e) { S.liveErr = e; setPill("bad", "Sheet unreadable"); return false; }
  }
  // find the 1-based row of a key in a two-column grid (Kitty, Settings)
  const rowOf = (grid, col0) => { const i = (grid || []).findIndex((r) => r && String(r[0]).trim() === col0); return i < 0 ? null : i + 1; };
  async function writeCells(range, rows) {
    if (!S.mcp) throw { code: "no_mcp" };
    const res = await S.mcp.callTool(GS, "update_values", { spreadsheetId: sheetId(), range, values: rows });
    try { await S.mcp.invalidate(GS, "get_values"); } catch (e) { /* older shell */ }
    return res;
  }
  async function writeKitty(key, value) {
    let r = rowOf(S.kittyRows, key);
    if (!r) { // add the key at the end of the Kitty tab
      const next = (S.kittyRows || []).length + 1;
      await writeCells(`Kitty!A${next}:B${next}`, [[key, value]]); S.kittyRows = (S.kittyRows || []).concat([[key, value]]); return;
    }
    await writeCells(`Kitty!B${r}`, [[value]]); S.kittyRows[r - 1][1] = value;
  }
  const canWriteSheet = () => S.mode === "live" && S.canWrite;

  // ---------- small UI helpers ----------
  function toast(msg, ms = 2600, action) { const t = $("#toast"); t.textContent = msg; if (action) { const b = document.createElement("button"); b.textContent = action.label; b.addEventListener("click", () => { t.classList.remove("on"); action.fn(); }); t.append(" ", b); } t.classList.add("on"); clearTimeout(toast.tm); toast.tm = setTimeout(() => { t.classList.remove("on"); if (action) t.querySelector("button")?.remove(); }, ms); }
  function setPill(kind, text) { const p = $("#trustpill"); p.className = "pill " + kind + (kind === "live" ? " live" : ""); p.querySelector(".txt").textContent = text; }
  function ago(ms) { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; }
  function readAgeText() { if (S.mode !== "live") return ""; if (S.unknownReadAge || S.storedAt == null) return "Connector read age unavailable; Refresh asks for fresh data."; return `Oldest connector read ${ago(S.storedAt)}. That is the connector's cache, not the date of the money.`; }
  const tip = () => $("#tip");
  function bindTips(root) {
    $$("[data-tip]", root).forEach((el) => {
      el.addEventListener("mouseenter", (e) => { const t = tip(); t.textContent = el.dataset.tip; t.classList.add("on"); moveTip(e); });
      el.addEventListener("mousemove", moveTip); el.addEventListener("mouseleave", () => tip().classList.remove("on"));
      el.addEventListener("focus", (e) => { const t = tip(); t.textContent = el.dataset.tip; t.classList.add("on"); const r = el.getBoundingClientRect(); t.style.left = r.left + "px"; t.style.top = (r.top - t.offsetHeight - 8) + "px"; });
      el.addEventListener("blur", () => tip().classList.remove("on"));
    });
  }
  function moveTip(e) { const t = tip(); t.style.left = Math.min(window.innerWidth - t.offsetWidth - 8, e.clientX + 14) + "px"; t.style.top = Math.max(8, e.clientY - t.offsetHeight - 12) + "px"; }
  // numbers count up from 0 on first paint; later renders just set them
  const counted = new Set();
  function countUp(el, to, f, key) {
    if (counted.has(key) || reduced() || to == null) { el.textContent = f(to); counted.add(key); return; }
    counted.add(key);
    const t0 = performance.now(), dur = 1100;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4); el.textContent = f(to * e); if (p < 1) requestAnimationFrame(step); else el.textContent = f(to); };
    requestAnimationFrame(step);
  }
  function tableToggle(id, html) { return `<button class="tbtn" data-tt="${id}">Show as table</button><div class="tablewrap" id="${id}" hidden>${html}</div>`; }
  function bindTables(root) { $$("[data-tt]", root).forEach((b) => b.addEventListener("click", () => { const el = document.getElementById(b.dataset.tt); el.hidden = !el.hidden; b.textContent = el.hidden ? "Show as table" : "Hide table"; })); }

  // ---------- category colour: one fixed hue per category, never cycled ----------
  const CAT_HUE = { GROCERIES: 95, DINING: 22, SUBS: 268, SHOPPING: 330, TRANSPORT: 205, CAR: 222, UTILITIES: 46, TELCO: 188, HEALTH: 352, CHILDCARE: 160, "KIDS-ACT": 142, HOLIDAYS: 180, GIFTS: 318, PERSONAL: 296, MORTGAGE: 252, "RATES-HOME": 240, "HOME-INS": 232, "HOME-MAINT": 32, "RENT-INT": 36, "RENT-MGMT": 40, "RENT-RATES": 28, "RENT-STRATA": 44, "RENT-INS": 20, "RENT-REPAIR": 14, "WORK-EQUIP": 62, "WORK-OTHER": 70, DONATION: 120, FEES: 0, UNCAT: 0, SALARY: 160, INTEREST: 170, "RENT-INC": 150, TRANSFER: 260, "CC-PAY": 260 };
  const MUTED = new Set(["UNCAT", "FEES", "TRANSFER", "CC-PAY"]);
  const hashHue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  // a hex (categories.json) to a hue in degrees, for the jar and the swatches that tint with hsl()
  const hexHue = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim()); if (!m) { const h = /hsl\((\d+)/.exec(String(hex)); return h ? +h[1] : null; } const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 260; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h; };
  const catHue = (c) => { const h = hexHue(E.catHue(c, S.m)); return h != null ? h : CAT_HUE[c] != null ? CAT_HUE[c] : hashHue(c); };
  const catSwatch = (c) => `--h:${catHue(c)};--s:${MUTED.has(c) ? 18 : 70}%`;
  const GROUP_COLOR = { Housing: "var(--c-loan)", Essentials: "var(--c-in)", Lifestyle: "var(--accent)", Property: "var(--amber)", "Work and giving": "var(--c-kept)", Fees: "var(--c-dip)", Uncategorised: "var(--c-move)" };
  const initials = (s) => String(s || "?").replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  // every row on the page is the kit's EntryRow; a 1.1 transaction maps to its entry of the same id
  const entryOf = (t) => (t && t.kind ? t : (S.m.entryById && S.m.entryById[t.id]) || t);
  function avatar(t, size) { return Kit.monogram(entryOf(t), ctx(), size); }
  function amtHtml(t) { return Kit.amount(entryOf(t)); }
  function txRow(t, o = {}) { return Kit.EntryRow(entryOf(t), ctx(), Object.assign({ category: true }, o)); }
  const catDisc = (cat, size) => `<span class="catdisc ${size || ""}" style="--ch:${esc(E.catHue(cat, S.m))}" aria-hidden="true">${ico("i-" + E.catIcon(cat, S.m))}</span>`;

  // ---------- charts (hand SVG; d3 only where it does real work) ----------
  const CW = (frac) => { const w = ($("main") && $("main").clientWidth) || 900; const card = phone() ? w - 32 : w * (frac || 1) - 40; return Math.round(Math.min(760, Math.max(280, card))); };
  function sparkSVG(vals, w = 72, h = 26, color = "currentColor") {
    const v = vals.filter((x) => x != null); if (v.length < 2) return "";
    const min = Math.min(...v), max = Math.max(...v), r = max - min || 1;
    const pts = v.map((y, i) => [2 + (i * (w - 4)) / (v.length - 1), h - 3 - ((y - min) / r) * (h - 6)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d} L${last[0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h}Z" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
  }
  function monthBarsSVG(months, W) {
    const w = W || CW(7 / 12), h = 190, pad = { l: 44, r: 8, t: 10, b: 26 };
    const max = Math.max(1, ...months.map((m) => Math.max(m.in, m.out)));
    const n = months.length, slot = (w - pad.l - pad.r) / n, bw = Math.max(5, Math.min(18, slot * 0.32));
    const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
    const grid = [0.5, 1].map((f) => `<line class="gridline" x1="${pad.l}" x2="${w - pad.r}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}"/><text class="axis" x="${pad.l - 6}" y="${(y(max * f) + 4).toFixed(1)}" text-anchor="end">${fmtS(max * f)}</text>`).join("") + `<line class="gridline" x1="${pad.l}" x2="${w - pad.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
    const bars = months.map((m, i) => { const x = pad.l + i * slot + slot / 2; const kept = m.in - m.out; return `<g class="mb" data-i="${i}" tabindex="0" role="img" aria-label="${E.fmtMonth(m.month)}: in ${fmt0(m.in)}, out ${fmt0(m.out)}, kept ${fmt0(kept)}"><rect x="${(x - bw - 1).toFixed(1)}" y="${y(m.in).toFixed(1)}" width="${bw}" height="${(y(0) - y(m.in)).toFixed(1)}" rx="3" fill="var(--c-in)"/><rect x="${(x + 1).toFixed(1)}" y="${y(m.out).toFixed(1)}" width="${bw}" height="${(y(0) - y(m.out)).toFixed(1)}" rx="3" fill="var(--c-out)"/><text class="axis" x="${x.toFixed(1)}" y="${h - 8}" text-anchor="middle">${E.fmtMonth(m.month, true).slice(0, 3)}</text><rect x="${(x - slot / 2).toFixed(1)}" y="${pad.t}" width="${slot.toFixed(1)}" height="${h - pad.t - pad.b}" fill="transparent"/></g>`; }).join("");
    return `<div class="chartwrap" style="position:relative"><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Money in and out by month">${grid}${bars}</svg><div class="tipbox"></div></div><div class="flowlegend"><span><i style="background:var(--c-in)"></i>Money in</span><span><i style="background:var(--c-out)"></i>Money out</span></div>`;
  }
  function bindMonthBars(root, months) {
    const box = $(".tipbox", root); if (!box) return;
    $$("g.mb", root).forEach((g) => { const show = () => { const m = months[+g.dataset.i]; box.innerHTML = `<b>${E.fmtMonth(m.month)}</b><br>In ${fmt0(m.in)} · Out ${fmt0(m.out)}<br>Kept <b>${fmt0(m.in - m.out)}</b>`; box.classList.add("on"); const r = g.getBoundingClientRect(), pr = root.getBoundingClientRect(); box.style.left = Math.min(pr.width - box.offsetWidth - 4, Math.max(0, r.left - pr.left + r.width / 2 - box.offsetWidth / 2)) + "px"; box.style.top = Math.max(0, r.top - pr.top - box.offsetHeight - 6) + "px"; }; g.addEventListener("mouseenter", show); g.addEventListener("focus", show); g.addEventListener("mouseleave", () => box.classList.remove("on")); g.addEventListener("blur", () => box.classList.remove("on")); });
  }
  function areaSVG(series, W, o = {}) {
    const w = W || CW(6 / 12), h = o.h || 170, pad = { l: 8, r: 10, t: 12, b: 24 };
    const vals = series.map((s) => s.v); const min = o.zero ? 0 : Math.min(...vals) * 0.985, max = Math.max(...vals) * 1.01;
    const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, series.length - 1), y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - min) / (max - min || 1));
    const line = d3.line().x((d, i) => x(i)).y((d) => y(d.v)).curve(d3.curveMonotoneX)(series);
    const area = d3.area().x((d, i) => x(i)).y0(h - pad.b).y1((d) => y(d.v)).curve(d3.curveMonotoneX)(series);
    const ticks = [0, Math.floor(series.length / 2), series.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    const color = o.color || "var(--accent)";
    const last = series[series.length - 1];
    return `<div class="chartwrap" style="position:relative"><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.label || "")}"><line class="gridline" x1="${pad.l}" x2="${w - pad.r}" y1="${y(min).toFixed(1)}" y2="${y(min).toFixed(1)}"/><line class="gridline" x1="${pad.l}" x2="${w - pad.r}" y1="${y((min + max) / 2).toFixed(1)}" y2="${y((min + max) / 2).toFixed(1)}"/><text class="axis" x="${pad.l}" y="${(y((min + max) / 2) - 3).toFixed(1)}">${fmtS((min + max) / 2)}</text><path d="${area}" fill="${color}" opacity=".13"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/><circle cx="${x(series.length - 1).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>${ticks.map((i) => `<text class="axis" x="${x(i).toFixed(1)}" y="${h - 6}" text-anchor="${i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}">${E.fmtMonth(series[i].month, true)}</text>`).join("")}${series.map((s, i) => `<g class="pt" data-i="${i}" tabindex="0" aria-label="${E.fmtMonth(s.month)}: ${fmt0(s.v)}"><rect x="${(x(i) - (w / series.length) / 2).toFixed(1)}" y="${pad.t}" width="${(w / series.length).toFixed(1)}" height="${h - pad.t - pad.b}" fill="transparent"/><circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(s.v).toFixed(1)}" r="0" fill="${color}"/></g>`).join("")}</svg><div class="tipbox"></div></div>`;
  }
  function bindArea(root, series, f) {
    const box = $(".tipbox", root); if (!box) return;
    $$("g.pt", root).forEach((g) => { const show = () => { const s = series[+g.dataset.i]; box.innerHTML = `<b>${E.fmtMonth(s.month)}</b><br>${f ? f(s) : fmt0(s.v)}`; box.classList.add("on"); $$("g.pt .dot", root).forEach((c) => c.setAttribute("r", 0)); $(".dot", g).setAttribute("r", 4); const r = g.getBoundingClientRect(), pr = root.getBoundingClientRect(); box.style.left = Math.min(pr.width - box.offsetWidth - 4, Math.max(0, r.left - pr.left + r.width / 2 - box.offsetWidth / 2)) + "px"; box.style.top = "0px"; }; g.addEventListener("mouseenter", show); g.addEventListener("focus", show); g.addEventListener("mouseleave", () => { box.classList.remove("on"); $(".dot", g).setAttribute("r", 0); }); });
  }
  function ringSVG(pct, color, label, sub, size = 132) {
    const r = 54, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
    return `<div class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="${esc(label)} ${esc(sub || "")}"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" fill="none" stroke="color-mix(in srgb,var(--ink) 9%,transparent)" stroke-width="12"/><circle class="fg" cx="66" cy="66" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/></svg><div class="c">${label}${sub ? `<small>${sub}</small>` : ""}</div></div>`;
  }
  function stackHTML(parts) { const tot = parts.reduce((a, p) => a + p.v, 0) || 1; return `<div class="stack" role="img" aria-label="${parts.map((p) => `${p.k} ${fmt0(p.v)}`).join(", ")}">${parts.map((p) => `<div style="flex:0 0 ${((p.v / tot) * 100).toFixed(2)}%;background:${p.c}" title="${esc(p.k)} ${fmt0(p.v)}"></div>`).join("")}</div><div class="legendlist">${parts.map((p) => `<div class="li"><span class="sw" style="background:${p.c}"></span><span class="nm">${esc(p.k)}</span><b class="num">${fmtS(p.v)}</b><span class="muted small">${Math.round((p.v / tot) * 100)}%</span></div>`).join("")}</div>`; }
  function jarSVG(sp, W) {
    const w = Math.min(520, W || CW(5 / 12)), h = Math.round(w * 0.82);
    const items = sp.byCat.filter(([, v]) => v > 0).slice(0, 14).map(([cat, v]) => ({ cat, v, name: (S.m.catById[cat] || {}).name || cat }));
    if (!items.length) return `<div class="empty">Nothing spent in this period.</div>`;
    const pack = d3.pack().size([w - 24, h - 60]).padding(5);
    const root = d3.hierarchy({ children: items }).sum((d) => d.v);
    pack(root);
    const over = new Set(S.m.budget.filter((b) => /over/i.test(b.status)).map((b) => b.name));
    const shortName = (s) => String(s).replace(/ and takeaway| and transport| and water| and mobile|\s*\(home\)/i, "").replace(/^Home loan repayments$/, "Home loan").replace(/^Investment loan interest$/, "Loan interest").replace(/^Property management fees$/, "Agent fees").replace(/^Rental rates and water$/, "Rental rates");
    const bubbles = root.leaves().map((n, i) => { const d = n.data, r = n.r; const name = shortName(d.name); const cap = Math.max(4, Math.floor(r / 3.4)); let lines = [name]; if (name.length > cap) { const sp2 = name.lastIndexOf(" ", cap); lines = sp2 > 2 ? [name.slice(0, sp2), name.slice(sp2 + 1)] : [name.slice(0, cap - 1) + "…"]; if (lines[1] && lines[1].length > cap) lines[1] = lines[1].slice(0, cap - 1) + "…"; } const lab = r > 30 ? `${lines.map((l, k) => `<text class="bubl" x="${n.x.toFixed(1)}" y="${(n.y - 3 - (lines.length - 1 - k) * 12).toFixed(1)}" text-anchor="middle">${esc(l)}</text>`).join("")}<text class="bubv" x="${n.x.toFixed(1)}" y="${(n.y + 11).toFixed(1)}" text-anchor="middle">${fmtS(d.v)}</text>` : r > 16 ? `<text class="bubv" x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle">${fmtS(d.v)}</text>` : ""; return `<g class="bubg" data-cat="${esc(d.cat)}" tabindex="0" role="button" aria-label="${esc(d.name)} ${fmt0(d.v)}" style="--i:${i};--fall:${-(n.y + r + 40).toFixed(0)}px;${catSwatch(d.cat)}"><circle class="bub" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r.toFixed(1)}"/>${over.has(d.name) ? `<circle class="bubover" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(r + 3).toFixed(1)}"/>` : ""}${lab}</g>`; }).join("");
    return `<svg class="jar" viewBox="0 0 ${w} ${h}" role="img" aria-label="Spending by category as bubbles"><rect class="jarlid" x="${w / 2 - 70}" y="4" width="140" height="18" rx="9"/><path class="jarglass" d="M24 26 h${w - 48} a12 12 0 0 1 12 12 v${h - 50} a12 12 0 0 1 -12 12 h-${w - 48} a12 12 0 0 1 -12 -12 v-${h - 50} a12 12 0 0 1 12 -12z"/><g transform="translate(12,36)">${bubbles}</g></svg>`;
  }
  function flowSVG(sp, income, W) {
    const w = W || CW(7 / 12), h = Math.max(280, Math.min(420, 60 + sp.byGroup.length * 44)), pad = { l: 8, r: 8, t: 8, b: 8 };
    if (!window.d3 || !d3.sankey) return "";
    const kept = Math.max(0, sp.in - sp.out); const keptName = sp.scoped ? "Left after everyday" : "Kept";
    const nodes = [], links = [], id = (n) => { let i = nodes.findIndex((x) => x.name === n); if (i < 0) { nodes.push({ name: n }); i = nodes.length - 1; } return i; };
    const inc = income.filter((x) => x.v > 0); for (const x of inc) links.push({ source: id(x.k), target: id("Money in"), value: x.v, c: "var(--c-in)" });
    const floor = Math.max(sp.in, sp.out) * 0.025; let small = 0;
    for (const [g, v] of sp.byGroup) { if (v <= 0) continue; if (v < floor) { small += v; continue; } links.push({ source: id("Money in"), target: id(g), value: v, c: GROUP_COLOR[g] || "var(--c-out)" }); }
    if (small >= Math.max(sp.in, sp.out) * 0.005) links.push({ source: id("Money in"), target: id("Other small"), value: small, c: "var(--c-move)" });
    if (kept > 0) links.push({ source: id("Money in"), target: id(keptName), value: kept, c: "var(--c-kept)" });
    if (!links.length) return `<div class="empty">Nothing to show for this period.</div>`;
    const sk = d3.sankey().nodeWidth(12).nodePadding(phone() ? 14 : 22).nodeSort(null).extent([[pad.l, pad.t], [w - pad.r, h - pad.b]]);
    const g = sk({ nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });
    const path = d3.sankeyLinkHorizontal();
    const L = g.links.map((l) => `<path d="${path(l)}" fill="none" stroke="${l.c}" stroke-opacity=".32" stroke-width="${Math.max(1, l.width).toFixed(1)}"><title>${esc(l.source.name)} → ${esc(l.target.name)}: ${fmt0(l.value)}</title></path>`).join("");
    const N = g.nodes.map((n) => { const left = n.x0 < w / 2; const col = n.name === "Money in" ? "var(--ink)" : n.name === keptName ? "var(--c-kept)" : (GROUP_COLOR[n.name] || "var(--c-in)"); return `<g><rect x="${n.x0.toFixed(1)}" y="${n.y0.toFixed(1)}" width="${(n.x1 - n.x0).toFixed(1)}" height="${Math.max(1, n.y1 - n.y0).toFixed(1)}" rx="3" fill="${col}"/><text x="${(left ? n.x1 + 6 : n.x0 - 6).toFixed(1)}" y="${((n.y0 + n.y1) / 2).toFixed(1)}" dy=".35em" text-anchor="${left ? "start" : "end"}" font-size="12" font-weight="700">${esc(n.name)}</text><text x="${(left ? n.x1 + 6 : n.x0 - 6).toFixed(1)}" y="${((n.y0 + n.y1) / 2 + 14).toFixed(1)}" dy=".35em" text-anchor="${left ? "start" : "end"}" font-size="11" class="axis">${fmtS(n.value)}</text></g>`; }).join("");
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Where the money went: income on the left, spending groups and what was kept on the right">${L}${N}</svg>`;
  }
  function barsHTML(rows, o = {}) {
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
    return `<div class="bars">${rows.map((r) => `<${r.go ? `button class="r" data-go="${esc(r.go)}"` : 'div class="r"'}><span class="lab">${esc(r.k)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span><span class="track">${o.diverging ? '<span class="mid0"></span>' : ""}<span class="b ${o.diverging ? (r.v >= 0 ? "up" : "down") : "plain"}" style="width:${((Math.abs(r.v) / max) * (o.diverging ? 50 : 100)).toFixed(1)}%;${r.color ? `background:${r.color}` : ""}"></span></span><span class="val num">${r.val != null ? r.val : fmt0(r.v)}${r.vsub ? `<small>${esc(r.vsub)}</small>` : ""}</span></${r.go ? "button" : "div"}>`).join("")}</div>`;
  }

  // ---------- render ----------
  function renderAll() {
    if (!S.m) return;
    applyTheme(); applyAccent();
    // one broken card must never blank a tab: each view renders inside its own boundary
    for (const [name, fn] of [["header", renderHeader], ["home", renderHome], ["activity", renderActivity], ["insights", renderInsights], ["goals", renderGoals], ["setup", renderSetup]]) {
      try { fn(); } catch (e) { console.error("render " + name, e); const v = $(`#v-${name}`); if (v) v.innerHTML = `<div class="card"><div class="cardhead"><span class="q">This part couldn't be drawn</span></div><p class="sub">${esc(e && e.message ? e.message : String(e))}. The other tabs still work. If it keeps happening, <a href="${REPO}/issues" target="_blank" rel="noopener">report it</a> with the sheet's tab names.</p></div>`; }
    }
    moveGlow();
  }
  function renderHeader() {
    const m = S.m;
    if (S.mode === "live") setPill("live", isDemoSheet() ? "Live · demo sheet" : "Live from your sheet");
    else if (S.mode === "local") setPill("demo", "Local test copy");
    else setPill("demo", "Demo household");
    document.title = `The ${m.householdName.replace(/^The /, "")} Kitty`;
    $("#askbtn").hidden = !S.sample;
  }
  const period = () => E.window(S.period.kind, S.period.anchor || S.m.asOf);
  function periodBar(id) {
    const p = period(); const atEnd = (S.period.anchor || S.m.asOf) >= S.m.asOf;
    return `<div class="periodbar" id="${id}"><span class="seg mini" role="group" aria-label="Period">${[["month", "Month"], ["quarter", "3 months"], ["year", "12 months"], ["fy", "This FY"]].map(([k, l]) => `<button data-pk="${k}" aria-pressed="${S.period.kind === k}">${l}</button>`).join("")}</span><span class="nav"><button data-pn="-1" aria-label="Earlier">${ico("i-back")}</button><button data-pn="1" aria-label="Later" ${atEnd ? "disabled" : ""}>${ico("i-chev")}</button></span><span class="label">${esc(p.label)}</span></div>`;
  }
  function bindPeriod(root) {
    $$("[data-pk]", root).forEach((b) => b.addEventListener("click", () => { S.period.kind = b.dataset.pk; S.period.anchor = null; buzz(); renderInsights(); }));
    $$("[data-pn]", root).forEach((b) => b.addEventListener("click", () => { const step = { month: 1, quarter: 3, year: 12, fy: 12 }[S.period.kind]; const a = E.addMonths(E.monthStart(S.period.anchor || S.m.asOf), +b.dataset.pn * step); S.period.anchor = a >= S.m.asOf.slice(0, 7) + "-01" ? S.m.asOf : E.monthEnd(a); renderInsights(); }));
  }

  // ----- Home -----
  // ----- The kit gallery (dist/kit.html): every component from the functions the page really uses, on the bundled household -----
  function renderGallery() {
    const m = S.m, v = $("#v-home"); const es = m.entries.filter((e) => e.kind === "transaction").slice(-6).reverse(); const sp = E.spend(m.tx, E.window("quarter", m.asOf));
    const months = m.cashflow.slice(-12).map((c) => ({ month: c.month, in: c.income, out: c.spending })); const item = review().items[0];
    const sect = (id, html, wide) => `<div class="card${wide ? " wide" : ""}" data-kit="${id}"><h3>${id}</h3>${html}</div>`;
    v.innerHTML = `<div class="kitg">${[
      sect("Ring", ringSVG(0.92, "var(--accent)", "$11k", "of $12k")),
      sect("Bar", monthBarsSVG(months)),
      sect("StatTile", `<div class="statline">${Kit.StatTile("In", fmt0(months[11].in))}${Kit.StatTile("Out", fmt0(months[11].out), "last month")}</div>`),
      sect("Sparkline", sparkSVG(months.map((x) => x.out), 320, 60, "var(--accent)")),
      sect("Sankey", flowSVG(sp, [{ k: "Income", v: sp.in }], CW(1)), true),
      sect("Pack", jarSVG(sp, CW(1 / 2))),
      sect("EntryRow", es.slice(0, 2).map((e) => Kit.EntryRow(e, ctx(), { category: true })).join("")),
      sect("EntryList", Kit.EntryList(es, ctx(), {}), true),
      sect("Table", `<div class="tablewrap"><table class="t"><thead><tr><th>Month</th><th>In</th><th>Out</th></tr></thead><tbody>${months.slice(-4).map((c) => `<tr><td>${esc(E.fmtMonth(c.month, true))}</td><td class="num">${fmt0(c.in)}</td><td class="num">${fmt0(c.out)}</td></tr>`).join("")}</tbody></table></div>`),
      sect("Drawer", `<div class="static-drawer"><h2>A drawer</h2><p class="sub">Slides over the page; its content is any kit component.</p></div>`),
      sect("ReviewCard", item ? Kit.ReviewCard(item, ctx()) : Kit.EmptyState("Nothing to review")),
      sect("Chip", `<div class="chips">${Kit.Chip("Everyone", true)}${Kit.Chip("Jordan")}${Kit.Chip("Mia")}</div>`),
      sect("EmptyState", Kit.EmptyState("Nothing due in the next 35 days.")),
      sect("Skeleton", Kit.Skeleton(4)),
      sect("Toast", `<div class="toast static-toast">Back to the default page</div>`),
      sect("Tray", Kit.Tray([{ id: "x", title: "Property" }, { id: "y", title: "Super" }])),
    ].join("")}</div>`;
    $$("header.top, nav.tabs").forEach((x) => { x.style.display = "none"; });
  }
  // ----- Home is the canvas: widgets from the kit, laid out per person. The page is always a plain CSS grid, so spacing never depends on
  // measuring. GridStack mounts only while arranging, on the grid's own geometry; a blocked script costs dragging, not the page. -----
  const PHONE = window.matchMedia("(max-width:819px), (pointer:coarse) and (max-height:540px)");   // a phone on its side is still a phone
  const isPhone = () => PHONE.matches;
  const fixedLayout = () => FLAGS.get("layout") === "default";   // ?layout=default for screenshots: no saved layout, nothing written
  const WID = (m) => Kit.eligible(m, E.signals(m));
  const savedLayout = () => (fixedLayout() ? null : S.prefs.layout || null);
  const writeLayout = ({ items, hidden, seen }) => savePrefs({ layout: { items: Kit.keepAbsent(items, (S.prefs.layout || {}).items, hidden), hidden, seen } });
  const saveLayout = (items) => { if (fixedLayout()) return; const l = S.prefs.layout || {}; writeLayout({ items, hidden: l.hidden || [], seen: l.seen || [] }); };
  function homeLayout() {
    const lay = Kit.layout(WID(S.m), savedLayout());
    // an owner's first render is the bundled demo: wait for the live read, so `seen` records this household's own widgets
    if (S.settled && lay.added.length && !fixedLayout()) {
      const was = S.prefs.layout || {}; const hidden = was.hidden || [], seen = (was.seen || []).concat(lay.added), added = lay.added;
      writeLayout({ items: lay.items, hidden, seen });
      const names = added.map((id) => Kit.widget(id).title);
      toast(`New on Home: ${names.join(", ")}, because this household has them`, 7000, { label: "Undo", fn: () => { const l = S.prefs.layout; writeLayout({ items: l.items.filter((i) => !added.includes(i.id)), hidden: l.hidden.concat(added), seen: l.seen }); renderHome(); mountCanvas(); } });
    }
    return lay;
  }
  function canvasHTML(lay) {
    const m = S.m; const a = !!S.arrange, phone = isPhone(); const asked = new Map(lay.items.map((i) => [i.id, i.w]));
    const cell = (it, i, n) => {
      const w = Kit.widget(it.id), variant = Kit.variant(w, it.w), sized = !phone && w.sizes.length > 1 ? Kit.nextSize(w, asked.get(it.id)) : null;
      const body = w.core ? w.render(w.data(m), variant) : `<div class="card">${w.render(w.data(m), variant)}</div>`;
      const tools = a ? `<div class="wtools"><span class="whandle" aria-hidden="true">⠿</span><span class="wname">${esc(w.title)}</span><button class="wbtn" data-wmove="${esc(it.id)}:-1" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(w.title)} up">↑</button><button class="wbtn" data-wmove="${esc(it.id)}:1" ${i === n - 1 ? "disabled" : ""} aria-label="Move ${esc(w.title)} down">↓</button>${sized ? `<button class="wbtn" data-wsize="${esc(it.id)}" aria-label="Make ${esc(w.title)} ${sized > asked.get(it.id) ? "wider" : "narrower"}">${sized > asked.get(it.id) ? "Wider" : "Narrower"}</button>` : ""}<button class="wbtn" data-whide="${esc(it.id)}" aria-label="Hide ${esc(w.title)}">Hide</button></div>` : "";
      return `<div class="wcell grid-stack-item" data-wid="${esc(it.id)}" gs-id="${esc(it.id)}" gs-x="${it.x}" gs-y="${it.y}" gs-w="${it.w}" gs-h="1" gs-min-w="${Math.min(...w.sizes.map((s) => s.w))}" style="--ww:${it.w};--i:${Math.min(i, 5)}"><div class="grid-stack-item-content"><div class="wbox">${tools}${body}</div></div></div>`;
    };
    const bar = `<div class="arrangebar">${a ? `${lay.hiddenOn.length ? `<span class="sub">Hidden:</span>${Kit.Tray(lay.hiddenOn.map((id) => ({ id, title: Kit.widget(id).title })))}` : ""}<button class="linkbtn" data-wreset>Back to the default</button><button class="btn sm" data-arrange>Done</button>` : `<button class="linkbtn" data-arrange>Arrange this page</button>`}</div>`;
    return `<div class="canvas${a ? " arranging" : ""}${phone ? " phone" : ""}" id="canvas">${Kit.flow(lay.items).map((it, i, all) => cell(it, i, all.length)).join("")}</div>${fixedLayout() ? "" : bar}`;
  }
  function unmountCanvas() { if (S.grid) { try { S.grid.destroy(false); } catch (e) { /* the DOM is about to go */ } S.grid = null; } }
  // GridStack takes over the grid's geometry exactly, so arranging moves nothing until a card is moved. A drop saves the reading order and
  // redraws, so the page closes up: there are no holes to leave. Never destroy the grid inside its own event.
  function mountCanvas() {
    const el = $("#canvas"); if (!el || S.grid || S.tab !== "home" || !S.arrange || isPhone() || !window.GridStack) return;
    const CELL = 4, top = el.getBoundingClientRect().top;
    $$(".wcell", el).forEach((c) => { const r = c.getBoundingClientRect(); c.setAttribute("gs-y", Math.round((r.top - top) / CELL)); c.setAttribute("gs-h", Math.ceil((r.height + 16) / CELL)); });
    el.classList.add("grid-stack");
    try {
      S.grid = window.GridStack.init({ column: 12, cellHeight: CELL, margin: 8, float: false, animate: false, resizable: { handles: "e" }, alwaysShowResizeHandle: true, cancel: ".wbtn" }, el);
      S.grid.on("dragstop resizestop", (ev, item) => {   // the drawn widths include fill: only the widget being resized takes a new one
        const asked = new Map(currentItems().map((i) => [i.id, i.w])), resized = ev.type === "resizestop" ? item.getAttribute("gs-id") : null;
        saveLayout(Kit.order(S.grid.engine.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.id === resized ? Kit.snapWidth(Kit.widget(n.id), n.w).w : asked.get(n.id) || n.w })))); setTimeout(renderHome);
      });
    } catch (e) { console.error("canvas", e); S.grid = null; el.classList.remove("grid-stack"); }
  }
  function setArrange(on) { S.arrange = on; const b = $("#arrangebtn"); if (b) b.setAttribute("aria-pressed", String(on)); renderHome(); const d = on ? $(".arrangebar .btn") : b; if (d && !d.hidden) d.focus({ preventScroll: true }); }
  // the reading order, for the phone's handle and for the arrows
  const currentItems = () => Kit.order(Kit.layout(WID(S.m), savedLayout()).items);
  function applyOrder(items) { saveLayout(Kit.pack(items)); renderHome(); }
  function bindCanvas(v) {
    $$("[data-arrange]", v).forEach((b) => b.addEventListener("click", () => setArrange(!S.arrange)));
    $$("[data-wreset]", v).forEach((b) => b.addEventListener("click", () => { const ws = WID(S.m); savePrefs({ layout: { items: Kit.layout(ws, null).items, hidden: [], seen: ws.filter((w) => !w.core).map((w) => w.id) } }); renderHome(); toast("Back to the default page"); }));
    $$("[data-wmove]", v).forEach((b) => b.addEventListener("click", () => { const [id, d] = b.dataset.wmove.split(":"); applyOrder(Kit.reorder(currentItems(), id, +d)); toast(`${Kit.widget(id).title} moved ${+d < 0 ? "up" : "down"}`, 1400); const n = $(`[data-wmove="${id}:${d}"]`); if (n && !n.disabled) n.focus(); }));
    $$("[data-wsize]", v).forEach((b) => b.addEventListener("click", () => { const id = b.dataset.wsize, w = Kit.widget(id); applyOrder(currentItems().map((i) => (i.id === id ? { ...i, w: Kit.nextSize(w, i.w) } : i))); const c = $(`.wcell[data-wid="${id}"]`), n = $(`[data-wsize="${id}"]`); if (n) n.focus(); if (c && +c.getAttribute("gs-w") !== currentItems().find((i) => i.id === id).w) toast(`${w.title} fills its row until a neighbour joins it`, 2600); }));
    $$("[data-whide]", v).forEach((b) => b.addEventListener("click", () => { const id = b.dataset.whide; const l = S.prefs.layout || {}; writeLayout({ items: (l.items || currentItems()).filter((i) => i.id !== id), hidden: (l.hidden || []).concat(id), seen: l.seen || [] }); renderHome(); const d = $(".arrangebar .btn"); if (d) d.focus(); }));
    $$("[data-wshow]", v).forEach((b) => b.addEventListener("click", () => { const id = b.dataset.wshow; const l = S.prefs.layout || {}; const hidden = (l.hidden || []).filter((x) => x !== id); writeLayout({ items: Kit.layout(WID(S.m), { items: l.items, hidden, seen: (l.seen || []).filter((x) => x !== id) }).items, hidden, seen: l.seen || [] }); renderHome(); const d = $(`[data-whide="${id}"]`); if (d) d.focus(); }));
    // the phone reorders by a handle: drag it past a neighbour and the cells swap, keeping the reading order as the only state
    const c = $("#canvas"); if (!c || !c.classList.contains("phone") || !S.arrange) return;
    $$(".whandle", c).forEach((h) => h.addEventListener("pointerdown", (ev) => {
      ev.preventDefault(); const cell = h.closest(".wcell"); cell.classList.add("lifted");   // on window, because moving the cell drops any pointer capture
      const move = (e) => { const over = document.elementFromPoint(e.clientX, e.clientY); const t = over && over.closest(".wcell"); if (!t || t === cell) return; const r = t.getBoundingClientRect(); c.insertBefore(cell, e.clientY > r.top + r.height / 2 ? t.nextSibling : t); };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); cell.classList.remove("lifted"); const byId = new Map(currentItems().map((i) => [i.id, i])); applyOrder($$(".wcell", c).map((x) => byId.get(x.dataset.wid))); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    }));
  }
  function renderHome() {
    if (window.__KIT_GALLERY__) return renderGallery();   // a resize re-renders; the gallery stays the gallery
    const m = S.m, v = $("#v-home");
    unmountCanvas();
    if (!m.tx.length) { v.innerHTML = `<div class="card hero"><div class="blob"></div><div class="hi">The Kitty</div><h1 class="vh">Your sheet is set up. It just has no transactions yet.</h1><p class="vs">Bring in the last three months from each account (Setup → Getting your data in), run the importer, append the rows, move the As-of date. The page fills in as the sheet does.</p><div class="heronum"><button class="btn lime" data-go="setup">How to bring data in</button></div></div>`; bindCommon(v); return; }
    const nd = E.needs(m); const last = m.cashflow[m.cashflow.length - 1];
    const nw = m.metrics["networth.total"], sr = m.metrics["cashflow.savings_rate.3m"], cash = m.metrics["networth.cash"], sav = m.metrics["savings.recurring_per_year"];
    const sf = E.safety(m); const up = E.upcoming(m); const ahead = E.num(m.kitty.look_ahead_days) || 35; const pay = E.payday(m)[0]; const lead = leadGoal();
    const nwDelta = nw && nw.comp != null ? nw.num - nw.comp : null;
    const hour = new Date().getHours(); const hello = hour < 5 ? "Still up" : hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
    const parts = {
      hero: `<div class="card hero"><div class="blob"></div><div class="blob2"></div>
        <div class="hi"><span>${hello}, ${esc(greeting())}</span><span class="wave" aria-hidden="true">👋</span>${greeting() !== m.householdName.replace(/^The /, "") ? `<span class="muted">· ${esc(m.householdName)}</span>` : ""}</div>
        <h1 class="vh">${esc(nd.verdict)}</h1>
        <p class="vs">${esc(nd.line)} ${last ? `In ${E.fmtMonth(last.month).split(" ")[0]} you kept <b>${fmt0(last.net)}</b> of the <b>${fmt0(last.income)}</b> that came in.` : ""}</p>
        <div class="heronum"><button class="big num" id="heronum" data-open="trust" aria-label="Cash and offset, tap for the accounts behind it"><span id="heroval">${fmt0(cash ? cash.num : 0)}</span><small>cash and offset across ${m.accounts.filter((a) => a.liquid && a.type !== "Credit card").length} accounts · tap for the breakdown</small></button></div>
        <div class="facts">
          <button class="fact" data-open="networth"><b class="num">${fmtS(nw ? nw.num : null)}</b><span class="k">net worth</span>${nwDelta != null ? `<span class="d ${nwDelta >= 0 ? "gain" : "loss"}">${nwDelta >= 0 ? "▲" : "▼"} ${fmtS(Math.abs(nwDelta))} on a year ago</span>` : ""}</button>
          <button class="fact" data-go="insights"><b class="num">${E.fmtPct(sr ? sr.num : null, 1)}</b><span class="k">savings rate, 3 months</span>${sr && sr.comp != null ? `<span class="d ${sr.num >= sr.comp ? "gain" : "loss"}">${sr.num >= sr.comp ? "▲" : "▼"} ${E.fmtPct(sr.comp, 1)} last year</span>` : ""}</button>
          <button class="fact" data-go="goals"><b class="num">${sf.months != null ? sf.months.toFixed(1) : "—"} of ${sf.target}</b><span class="k">months of safety net</span>${sf.months != null ? `<span class="d ${sf.months >= sf.target ? "gain" : "loss"}">${sf.months >= sf.target ? "covered" : `${fmtS(sf.short)} short`}</span>` : ""}</button>
          <button class="fact" data-go="goals:save"><b class="num">${fmtS(sav ? sav.num : null)}</b><span class="k">a year the sheet found to save</span><span class="d">${m.savings.length} ideas</span></button>
        </div>
      </div>`,
      review: review().items.length ? `<button class="card rtile" data-go="review"><span class="ric">${ico("i-review")}</span><span class="mid"><span class="t">${review().items.length === 1 ? "One entry needs a look" : `${review().items.length} entries need a look`}</span><span class="s">${Object.entries(review().counts).filter(([, n]) => n).map(([k, n]) => `${n} ${{ uncategorised: "uncategorised", unresolved: "no rule knows", duplicate: "doubled", unpaired: "unpaired transfer", first_big: "first big bill" }[k]}`).join(" · ")} · one or two taps each</span></span>${ico("i-chev", "chev")}</button>` : "" || null,
      needs: `<div class="card needs">
        <div class="cardhead"><span class="q">What needs you</span>${nd.more ? `<button class="linkbtn" data-open="needs">All ${nd.all.length} →</button>` : ""}</div>
        ${nd.items.length ? `<div class="nlist">${nd.items.map(needHTML).join("")}</div>` : `<div class="okline">${ico("i-check")} Nothing needs you today.</div>`}
      </div>`,
      upcoming: `<div class="card">
          <div class="cardhead"><span class="q">What's coming up</span><button class="linkbtn" data-open="upcoming">Next ${ahead} days →</button></div>
          ${pay ? (() => { const sp = E.sinceLastPay(m); return `<div class="payday"><span class="n num">${pay.days}</span><span><span>day${pay.days === 1 ? "" : "s"} to ${esc(pay.person)}'s pay day</span><span class="s"> · about ${fmt0(pay.net)} on ${E.weekday(pay.next)}</span>${sp ? `<span class="s" style="display:block">Since the last pay (${E.fmtDay(sp.date)}): ${fmt0(sp.out)} spent, ${sp.days} day${sp.days === 1 ? "" : "s"}</span>` : ""}</span></div>`; })() : ""}
          <div class="uplist" style="margin-top:10px">${up.filter((u) => u.kind !== "pay").slice(0, 5).map(upHTML).join("") || `<div class="empty">Nothing due in the next ${ahead} days.</div>`}</div>
        </div>`,
      months: `<div class="card">
          <div class="cardhead"><span class="q">The last 12 months</span><button class="linkbtn" data-go="insights">Insights →</button></div>
          <div class="statline">${last ? `<div class="stat"><div class="k">In · ${E.fmtMonth(last.month, true)}</div><div class="v num" style="color:var(--c-in)">${fmt0(last.income)}</div></div><div class="stat"><div class="k">Out</div><div class="v num" style="color:var(--c-out)">${fmt0(last.spending)}</div></div><div class="stat"><div class="k">Kept</div><div class="v num" style="color:${last.net >= 0 ? "var(--c-kept)" : "var(--c-dip)"}">${fmt0(last.net)}<small>${E.fmtPct(last.rate, 0)}</small></div></div>` : ""}</div>
          <div id="homebars">${monthBarsSVG(m.cashflow.slice(-12).map((c) => ({ month: c.month, in: c.income, out: c.spending })))}</div>
        </div>`,
      goals: m.goals.length ? `<div class="card">
        <div class="cardhead"><span class="q">Saving for</span><button class="linkbtn" data-go="goals">Goals →</button></div>
        <div class="gtiles" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))">${m.goals.map((g) => goalTile(g, g === lead)).join("")}</div>
      </div>` : null,
      ideas: m.savings.length ? `<div class="card">
        <div class="cardhead"><span class="q">Ways to get there faster</span><button class="linkbtn" data-go="goals:save">All ${m.savings.length} →</button></div>
        <div class="gtiles" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))">${m.savings.slice(0, 3).map(ideaTile).join("")}</div>
      </div>` : null,
    };
    Kit.bindCore(Object.fromEntries(Object.entries(parts).map(([id, html]) => [id, { data: () => html, render: (p) => p }])));
    const lay = homeLayout();
    v.innerHTML = `${canvasHTML(lay)}
      <p class="sub" style="padding:0 6px">${S.mode === "live" ? `Live from ${isDemoSheet() ? "the demo sheet" : "your sheet"}. ${esc(readAgeText())}` : "Demo household: the Davies, a fictional family in Melbourne, numbers made up to tell a story."} <button class="linkbtn" data-open="trust">Where the numbers come from</button></p>`;
    const hv = $("#heroval"); if (hv && cash) countUp(hv, cash.num, (x) => fmt0(x), "hero");
    bindCommon(v); bindMonthBars($("#homebars"), m.cashflow.slice(-12).map((c) => ({ month: c.month, in: c.income, out: c.spending }))); bindCanvas(v); mountCanvas();
    // confetti once per device, and only when the person is looking at Home
    if (lead && lead.status === "Reached" && !store.get("celebrated:" + lead.name) && S.tab === "home" && document.visibilityState === "visible") { store.set("celebrated:" + lead.name, true); setTimeout(celebrate, 500); }
  }
  const needHTML = (i) => `<button class="need${i.warn ? " warn" : ""}" data-need="${esc(i.go)}"><span class="em" aria-hidden="true">${i.em}</span><span class="mid"><span class="t">${esc(E.cap(i.t))}</span><span class="s">${esc(i.s)}</span></span>${i.amt != null ? `<span class="amt num">${fmtS(Math.abs(i.amt))}${i.amtNote ? `<small>${esc(i.amtNote)}</small>` : ""}</span>` : ""}${ico("i-chev", "chev")}</button>`;
  const upHTML = (u) => { const d = new Date(u.date + "T00:00:00Z"); return `<button class="upc ${u.kind}${u.warn ? " warn" : ""}" data-up="${esc(u.ref.type)}:${esc(u.ref.key)}"><span class="date"><b>${d.getUTCDate()}</b><span>${E.fmtDay(u.date).split(" ")[1].toUpperCase()}</span></span><span class="mid"><span class="t">${esc(u.title)}</span><span class="s">${esc(u.sub)} · ${E.rel(S.m.asOf, u.date)}</span></span>${u.amount != null ? `<span class="amt num ${u.amount > 0 ? "in" : ""}">${u.amount > 0 ? "+" : "−"}${fmt0(Math.abs(u.amount))}</span>` : ""}</button>`; };
  function goalTile(g, big) {
    const pct = g.progress || 0, eta = E.goalEta(g, 0, S.m.asOf), col = E.goalColor(g.name);
    const line = g.status === "Reached" ? `Reached. ${fmt0(g.balance)} saved.` : eta.date ? `At ${fmt0(g.savedPm)} a month, ${eta.late ? `<b>${E.fmtMonth(eta.date, true)}</b>, after the ${E.fmtMonth(g.date, true)} target` : `there by <b>${E.fmtMonth(eta.date, true)}</b>${g.date ? `, ahead of ${E.fmtMonth(g.date, true)}` : ""}`}.` : `Nothing has gone in lately; needs ${fmt0(g.needPm)} a month.`;
    return `<button class="gtile${big ? " big" : ""}" data-open="goal:${esc(g.name)}"><div class="gtop"><span class="gem" aria-hidden="true">${E.goalIcon(g.name)}</span><span class="gt">${esc(g.name)}</span><span class="gof num"><b>${ofFmt(g.balance || 0)}</b> of ${ofFmt(g.target || 0)}</span></div><div class="gbar"><span data-w="${(pct * 100).toFixed(1)}" style="background:${col}"></span></div><div class="gline">${toGo(g.balance, g.target) === "done" ? "" : `${toGo(g.balance, g.target)} · `}${line} <span class="tag ${g.status === "Behind" ? "warn" : g.status === "Reached" ? "lime" : "good"}">${esc(g.status || "")}</span></div></button>`;
  }
  const EFFORT = { Low: "an hour", Medium: "an evening", High: "a weekend" };
  function ideaTile(s) {
    const hidden = (S.prefs.hidden || []).includes(s.title);
    return `<div class="idea${hidden ? " muted" : ""}" data-idea="${esc(s.title)}"><div class="mid"><div class="kind">${esc(s.type)} · ${esc(s.effort || "")} effort</div><h3>${esc(s.title)}</h3><p>${esc(s.shows)}</p><div class="acts"><button class="linkbtn" data-where="${esc(s.where)}">Where to look</button><span class="effort">about ${EFFORT[s.effort] || "some time"}</span>${S.mode !== "none" ? `<button class="linkbtn muted" data-hide="${esc(s.title)}">${hidden ? "Unhide" : "Hide on this device"}</button>` : ""}</div></div><div class="save num">${fmt0(s.amount)}<small>${s.type === "Recurring" ? "a year" : "once"}</small></div></div>`;
  }

  // ----- Activity: the review queue, worth it?, then every entry on EntryRow, grouped by day -----
  const feedPeriod = () => { const p = S.feed.period; return p.kind === "all" ? null : E.window(p.kind, p.anchor || S.m.asOf); };
  function feedRows() {
    const m = S.m, f = S.feed; const w = feedPeriod();
    let rows = m.entries.slice().reverse();   // newest first
    if (f.flow === "bal") rows = rows.filter((e) => e.kind !== "transaction"); else rows = rows.filter((e) => e.kind === "transaction");
    if (w) rows = rows.filter((e) => E.inWin(e, w));
    if (f.q) rows = E.match(m, f.q, rows);
    if (f.person) rows = rows.filter((e) => (e.person || "Joint") === f.person);
    if (f.flow === "out") rows = rows.filter((e) => e.flow === "Expense"); else if (f.flow === "in") rows = rows.filter((e) => e.flow === "Income"); else if (f.flow === "move") rows = rows.filter((e) => e.flow === "Transfer"); else if (f.flow !== "bal") rows = rows.filter((e) => e.flow !== "Transfer" || f.q);
    return rows;
  }
  function renderActivity() {
    const t0 = performance.now();
    const m = S.m, v = $("#v-activity"); const f = S.feed; const c = ctx(); const rv = review();
    const rows = feedRows(); const shown = rows.slice(0, f.limit);
    const sumOut = rows.reduce((a, e) => (e.kind === "transaction" && e.flow === "Expense" ? a - e.amount : a), 0), sumIn = rows.reduce((a, e) => (e.kind === "transaction" && e.flow === "Income" ? a + e.amount : a), 0);
    const everyday = (t) => t.group !== "Housing" && t.group !== "Property";
    const mo = E.spend(m.tx, E.window("month", m.asOf), everyday);
    const topMerchant = mo.byMerchant[0], biggest = m.tx.filter((t) => E.inWin(t, E.window("month", m.asOf)) && t.flow === "Expense" && everyday(t)).sort((a, b) => a.amount - b.amount)[0];
    const freq = new Map(); for (const t of m.tx) if (E.inWin(t, E.window("quarter", m.asOf)) && t.flow === "Expense" && everyday(t)) freq.set(t.merchant, (freq.get(t.merchant) || 0) + 1); const most = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    const w = feedPeriod(); const wc = E.worthCandidates(m); const canJudge = canWriteSheet() || S.mode !== "live";
    const quiet = !f.q && !f.person && !f.flow && !w;
    const pk = S.feed.period; const atEnd = (pk.anchor || m.asOf) >= m.asOf;
    v.innerHTML = `
      ${rv.items.length ? `<div class="card" id="reviewcard" style="--i:0">
        <div class="cardhead"><span class="q">${ico("i-review")} Needs a look</span><span class="sub">${rv.items.length} ${rv.items.length === 1 ? "entry" : "entries"} · ${Object.entries(rv.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${{ uncategorised: "uncategorised", unresolved: "unknown", duplicate: "doubled", unpaired: "unpaired", first_big: "first big bill" }[k]}`).join(" · ")}</span></div>
        <p class="sub" style="margin:-6px 0 10px">One or two taps each. ${canWriteSheet() ? "A category writes the Entries cell and a Decisions row; everything else writes a Decisions row. The sheet keeps the judgment, this page only reads it back." : S.mode === "live" ? "This sheet is read-only for you, so judgments stay on screen for this visit." : "In the demo a judgment stays on screen for this visit; the demo sheet is never written."}${phone() ? "" : " On a keyboard: 1 to 3 pick a suggestion, C categorise, Enter confirm, D merge, T match, S split, J and K move."}</p>
        <div class="rcards" id="rcards">${rv.items.slice(0, 20).map((it) => Kit.ReviewCard(it, c)).join("")}</div>
        ${rv.items.length > 20 ? `<p class="sub" style="margin-top:10px">${rv.items.length - 20} more after these.</p>` : ""}
      </div>` : S.reviewCleared ? `<div class="card" id="reviewcard" style="--i:0"><div class="rdone">${ART.allReviewed || ""}<p><b>All reviewed.</b> Every judgment is a row on the Decisions tab${canWriteSheet() ? "" : S.mode === "live" ? " (yours stayed on screen; the sheet is read-only for you)" : " (in the demo, for this visit only)"}.</p></div></div>` : ""}
      ${wc.items.length && canJudge ? `<div class="card" id="worthcard" style="--i:0.5">
        <div class="cardhead"><span class="q">${ico("i-worth")} Worth it?</span><span class="sub">${wc.items.length} from the week to ${E.fmtDay(wc.to)} · over ${fmt0(wc.floor)}</span></div>
        <div class="wrows" id="wrows">${wc.items.map((e) => Kit.WorthRow(e, c)).join("")}</div>
        <p class="wnote">Not a budget, a memory check. The research on money and happiness (Dunn, Gilbert and Wilson, 2011) says experiences outlast things, many small pleasures beat a few large ones, and paying now to enjoy later feels better than the reverse. Five rows a week, one tap each, no score. Each answer is a Decisions row; once five are in, Goals shows the spend that earned a yes.</p>
      </div>` : ""}
      <div class="card" style="--i:1">
        <div class="searchbox">${ico("i-search")}<input id="feedq" type="search" placeholder="Search: woolworths, mia dining, >500 october, cat:subs, the bank's own words" value="${esc(f.q)}" autocomplete="off" aria-label="Search entries">${f.q ? `<button class="iconbtn" id="feedclear" aria-label="Clear search" style="width:32px;height:32px">${ico("i-x")}</button>` : ""}</div>
        <div class="chips scroll" style="margin-top:12px" role="group" aria-label="Filters">
          ${[["", "Everyone"]].concat(m.people.map((p) => [p, p])).concat([["Joint", "Joint"]]).map(([k, l]) => `<button class="chip" data-fp="${esc(k)}" aria-pressed="${f.person === k}">${esc(l)}</button>`).join("")}
          <span style="width:1px;background:var(--line);margin:4px 2px"></span>
          ${[["", "Spending & income"], ["out", "Spending"], ["in", "Income"], ["move", "Transfers"]].concat(m.sheetVersion >= 2 && m.entries.some((e) => e.kind !== "transaction") ? [["bal", "Balances & trades"]] : []).map(([k, l]) => `<button class="chip" data-ff="${k}" aria-pressed="${f.flow === k}">${l}</button>`).join("")}
        </div>
        <div class="periodbar" id="feedperiod" style="margin-top:10px"><span class="seg mini" role="group" aria-label="Window">${[["all", "All time"], ["month", "Month"], ["quarter", "3 months"], ["year", "12 months"], ["fy", "This FY"]].map(([k, l]) => `<button data-fpk="${k}" aria-pressed="${pk.kind === k}">${l}</button>`).join("")}</span>${pk.kind !== "all" ? `<span class="nav"><button data-fpn="-1" aria-label="Earlier">${ico("i-back")}</button><button data-fpn="1" aria-label="Later" ${atEnd ? "disabled" : ""}>${ico("i-chev")}</button></span><span class="label" style="font-size:16px">${esc(w.label)}</span>` : ""}</div>
        <div class="sumbar"><span><b class="num">${rows.length}</b> ${f.flow === "bal" ? "valuations and trades" : "transactions"}${f.q ? ` for “${esc(f.q)}”` : quiet && rows.length ? " since " + E.fmtMonth(rows[rows.length - 1].date, true) : w ? ` in ${esc(w.label)}` : ""}</span><span>${f.flow !== "bal" ? `out <b class="num" style="color:var(--c-out)">${fmt0(sumOut)}</b>${sumIn ? ` · in <b class="num" style="color:var(--c-in)">${fmt0(sumIn)}</b>` : ""}` : ""}${S.downloads ? ` · <button class="linkbtn" id="csvbtn">${ico("i-dl")} CSV</button>` : ""}</span></div>
      </div>
      ${quiet ? `<div class="grid" style="--i:2">
        ${biggest ? `<button class="card span-4 erow" data-entry="${esc(biggest.id)}" style="align-items:center">${avatar(biggest, "lg")}<span class="mid"><span class="s">Biggest everyday buy this month</span><span class="t">${esc(biggest.merchant)}</span><span class="s">${esc(biggest.catName)} · ${E.fmtDay(biggest.date)}</span></span><span class="amt num">${fmt0(-biggest.amount)}</span></button>` : ""}
        ${topMerchant ? `<button class="card span-4 erow" data-merchant="${esc(topMerchant[0])}" style="align-items:center">${avatar(m.tx.find((t) => t.merchant === topMerchant[0]), "lg")}<span class="mid"><span class="s">Most spent with, outside the home</span><span class="t">${esc(topMerchant[0])}</span><span class="s">${E.fmtMonth(m.asOf)}</span></span><span class="amt num">${fmt0(topMerchant[1])}</span></button>` : ""}
        ${most ? `<button class="card span-4 erow" data-merchant="${esc(most[0])}" style="align-items:center">${avatar(m.tx.find((t) => t.merchant === most[0]), "lg")}<span class="mid"><span class="s">Most often, last 3 months</span><span class="t">${esc(most[0])}</span><span class="s">${most[1]} visits</span></span></button>` : ""}
      </div>` : ""}
      <div class="card" style="--i:3">
        <div id="feedlist">${Kit.EntryList(shown, c, { date: false, empty: `Nothing matches. Try a merchant, a person, a month, the bank's own words, or <code>cat:groceries</code>.` })}</div>
        ${rows.length > shown.length ? `<div style="text-align:center;margin-top:12px"><button class="btn ghost" id="feedmore">Show ${Math.min(120, rows.length - shown.length)} more of ${rows.length - shown.length}</button></div>` : ""}
      </div>`;
    const q = $("#feedq"); let tm;
    q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { S.feed.q = q.value.trim(); S.feed.limit = 80; renderActivity(); const nq = $("#feedq"); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }, 220); });
    const fc = $("#feedclear"); if (fc) fc.addEventListener("click", () => { S.feed.q = ""; renderActivity(); });
    $$("[data-fp]", v).forEach((b) => b.addEventListener("click", () => { S.feed.person = b.dataset.fp; buzz(); renderActivity(); }));
    $$("[data-ff]", v).forEach((b) => b.addEventListener("click", () => { S.feed.flow = b.dataset.ff; S.feed.limit = 80; buzz(); renderActivity(); }));
    $$("[data-fpk]", v).forEach((b) => b.addEventListener("click", () => { S.feed.period = { kind: b.dataset.fpk, anchor: null }; S.feed.limit = 80; buzz(); renderActivity(); }));
    $$("[data-fpn]", v).forEach((b) => b.addEventListener("click", () => { const step = { month: 1, quarter: 3, year: 12, fy: 12 }[S.feed.period.kind] || 1; const a = E.addMonths(E.monthStart(S.feed.period.anchor || m.asOf), +b.dataset.fpn * step); S.feed.period.anchor = a >= m.asOf.slice(0, 7) + "-01" ? m.asOf : E.monthEnd(a); renderActivity(); }));
    const more = $("#feedmore"); if (more) { more.addEventListener("click", () => { S.feed.limit += 120; renderActivity(); window.scrollTo({ top: more.getBoundingClientRect().top + window.scrollY - 400 }); }); if ("IntersectionObserver" in window) { const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); more.click(); } }, { rootMargin: "600px" }); io.observe(more); } }
    const csv = $("#csvbtn"); if (csv) csv.addEventListener("click", () => exportCSV(rows));
    bindReview(v); bindWorth(v); bindCommon(v);
    S.perf.activity = performance.now() - t0;
  }
  async function exportCSV(rows) {
    if (!S.downloads) return;
    const m = S.m;
    const text = E.csv(rows, [{ key: "id", label: "Entry ID" }, { key: "kind", label: "Kind" }, { key: "date", label: "Date" }, { label: "Account", get: (e) => (m.acctById[e.acct] || {}).name || e.acct }, { key: "raw", label: "Raw text" }, { label: "Merchant", get: (e) => Kit.nameOf(e) }, { key: "amount", label: "Amount" }, { label: "Category", get: (e) => (m.catById[e.cat] || {}).name || e.cat || "" }, { key: "person", label: "Person" }, { key: "status", label: "Status" }, { key: "transferId", label: "Transfer ID" }]);
    try { const r = await S.downloads.save({ filename: `kitty-entries-${today()}.csv`, data: new Blob([text], { type: "text/csv" }) }); if (r && r.status === "saved") toast("Saved the CSV"); } catch (e) { if (e && e.code !== "cancelled") toast("Couldn't save the file here"); }
  }
  // local measurement: ?perf runs Activity five times over the model and reports the median, for the PR's number
  window.__kittyPerf = { activity: (n = 5) => { const was = { ...S.feed, period: { ...S.feed.period } }; S.feed = { person: "", flow: "", q: "", limit: 80, period: { kind: "all", anchor: null } }; const ts = []; for (let i = 0; i < n; i++) { renderActivity(); ts.push(S.perf.activity); } S.feed = was; renderActivity(); ts.sort((a, b) => a - b); return { median: ts[Math.floor(ts.length / 2)], runs: ts, entries: S.m.entries.length }; }, entries: () => S.m.entries.length };

  // ----- the review queue's writes: a category is a cell plus a Decisions row; everything else is a Decisions row -----
  const byName = () => (S.userName || pref("greeting", "") || "the page").slice(0, 60);
  const nowDate = () => new Date().toISOString().slice(0, 10);
  const nextId = (grid, prefix, width) => { let mx = 0; for (const r of grid || []) { const mm = /^([A-Z])(\d+)$/.exec(String(r && r[0] || "").trim()); if (mm && mm[1] === prefix) mx = Math.max(mx, +mm[2]); } return prefix + String(mx + 1).padStart(width, "0"); };
  const lastRow = (grid) => { let n = 0; (grid || []).forEach((r, i) => { if (r && r[0] !== "" && r[0] != null) n = i + 1; }); return n; };
  function entryRowNumber(id) { const g = S.grids && S.grids.entries; if (!g) return null; const i = g.findIndex((r) => r && String(r[0]).trim() === id); return i < 0 ? null : i + 1; }
  // decision rows: [ref_kind, ref_id, decision, value, note]; writes Decisions!A{n}:H{m} by explicit range and mirrors the grid
  async function writeDecisions(specs) {
    if (!specs.length) return [];
    const rows = []; let id = nextId(S.grids ? S.grids.decisions : (S.m.decisions.map((d) => [d.id])).concat(S.sessionDecisions.map((d) => [d.decision_id])), "D", 4);
    for (const sp of specs) { rows.push([id, sp[0], sp[1], sp[2], sp[3] == null ? "" : String(sp[3]), byName(), nowDate(), sp[4] || ""]); id = "D" + String(+id.slice(1) + 1).padStart(4, "0"); }
    if (canWriteSheet()) {
      const g = S.grids.decisions; const n = lastRow(g) + 1;
      await writeCells(`Decisions!A${n}:H${n + rows.length - 1}`, rows);
      while (g.length < n - 1) g.push([]); for (const r of rows) g.push(r.slice());
    } else {
      for (const r of rows) S.sessionDecisions.push({ decision_id: r[0], ref_kind: r[1], ref_id: r[2], decision: r[3], value: r[4], by: r[5], at: r[6], note: r[7] });
    }
    return rows;
  }
  async function writeCategory(id, cat) {
    if (canWriteSheet()) { const row = entryRowNumber(id); if (!row) throw { code: "tool_error", message: `${id} is not on the Entries tab` }; await writeCells(`Entries!H${row}`, [[cat]]); S.grids.entries[row - 1][7] = cat; }
    else S.sessionCats[id] = cat;
  }
  function rebuild() { if (S.mode === "live" && S.grids) { const snap = E.fromConnector(S.grids); snap.fetchedAt = null; setModel(applyLocalGoals(E.model(snap))); } else setModel(demoModel()); }
  const judgedWhere = () => (canWriteSheet() ? "written to the sheet" : S.mode === "live" ? "kept on screen (read-only sheet)" : "kept for this visit (demo)");
  async function act(fn, okText) {
    try { await fn(); rebuild(); if (!review().items.length) S.reviewCleared = true; renderAll(); if (okText) toast(`${okText} · ${judgedWhere()}`); return true; }
    catch (e) { console.error(e); toast("Couldn't write: " + errText(e, "the sheet")); return false; }
  }
  const catName = (id) => (S.m.catById[id] || {}).name || id;
  const categorise = (id, cat) => act(async () => { await writeCategory(id, cat); await writeDecisions([["entry", id, "categorise", cat, ""]]); }, `${id}: ${catName(cat)}`);
  const confirmEntry = (id) => act(() => writeDecisions([["entry", id, "confirm", (S.m.entryById[id] || {}).cat || "", ""]]), `${id} confirmed`);
  const mergeDup = (id, of) => act(() => writeDecisions([["entry", id, "merge_duplicate", of, "same merchant, amount, account and day"]]), `${id} merged into ${of}`);
  const matchTransfer = (id, mate) => act(() => writeDecisions([["entry", id, "match_transfer", mate, ""]]), `${id} matched with ${mate}`);
  const splitEntry = (id, parts) => act(() => writeDecisions([["entry", id, "split", E.formatSplit(parts), ""]]), `${id} split ${parts.length} ways`);
  const worthIt = (id, v) => act(() => writeDecisions([["entry", id, "worth_it", v, ""]]), null);
  // "Make it a rule": a Rules row by explicit range, then the category on this row and every unreviewed row the pattern matches
  async function makeRule(id, proposal) {
    const m = S.m, e = m.entryById[id]; if (!e) return;
    const pattern = E.normalise(e.raw) || String(e.raw || "").toUpperCase(); const others = E.rowsForPattern(m, pattern, id);
    const ok = await act(async () => {
      const ruleRow = [nextId(S.grids ? S.grids.rules : m.rules.map((r) => [r.id]), "R", 4), pattern, "normalised", proposal.merchant, proposal.category_id, e.person || "", "", "", `cookie ${nowDate()}`, String(proposal.why || "").slice(0, 200)];
      if (canWriteSheet()) { const g = S.grids.rules; const n = lastRow(g) + 1; await writeCells(`Rules!A${n}:J${n}`, [ruleRow]); g.push(ruleRow.slice()); }
      else { S.sessionRules = (S.sessionRules || []).concat([ruleRow]); }
      await writeCategory(id, proposal.category_id); for (const o of others) await writeCategory(o.id, proposal.category_id);
      await writeDecisions([["entry", id, "categorise", proposal.category_id, `rule ${ruleRow[0]}`]].concat(others.map((o) => ["entry", o.id, "categorise", proposal.category_id, `rule ${ruleRow[0]}`])));
    }, null);
    if (ok) toast(`Rule saved: ${proposal.merchant} → ${catName(proposal.category_id)}. ${others.length ? `Applied to ${others.length} other row${others.length === 1 ? "" : "s"}.` : "No other unreviewed rows matched."} ${judgedWhere()}.`, 5000);
  }
  function bindReview(root) {
    const box = $("#rcards", root); if (!box) return;
    const cardOf = (el) => el.closest(".rcard"); const idOf = (el) => cardOf(el).dataset.rid;
    const item = (id) => review().items.find((i) => i.id === id);
    const run = (card, action, arg) => {
      const id = card.dataset.rid, it = item(id); if (!it) return;
      if (action === "pick") return categorise(id, arg);
      if (action === "cat") return openCategoryPicker(id);
      if (action === "confirm") return confirmEntry(id);
      if (action === "merge") return it.dupOf ? mergeDup(id, it.dupOf) : openEntry(id);
      if (action === "mate") return matchTransfer(id, arg);
      if (action === "match") { const mates = E.transferMates(S.m, it.entry); return mates.length === 1 ? matchTransfer(id, mates[0].id) : openEntry(id); }
      if (action === "split") return openSplitEditor(id);
    };
    $$("[data-ract]", box).forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); run(cardOf(b), b.dataset.ract, b.dataset.cat || b.dataset.mate); }));
    $$("[data-cookie]", box).forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); crackCookie(cardOf(b), b); }));
    box.addEventListener("keydown", (ev) => {
      if (/input|textarea|select/i.test(document.activeElement.tagName)) return;
      const card = cardOf(ev.target); if (!card) return; const k = ev.key.toLowerCase();
      const cards = $$(".rcard", box); const i = cards.indexOf(card);
      if (k === "j" || k === "arrowdown") { ev.preventDefault(); (cards[i + 1] || card).focus(); return; }
      if (k === "k" || k === "arrowup") { ev.preventDefault(); (cards[i - 1] || card).focus(); return; }
      if (/^[1-9]$/.test(k)) { const sug = $$(".rsugg .chip", card)[+k - 1]; if (sug) { ev.preventDefault(); sug.click(); } return; }
      const map = { c: "cat", enter: "confirm", d: "merge", t: "match", s: "split" }; const action = map[k]; if (!action) return;
      const btn = $(`[data-ract="${action}"]`, card); if (btn) { ev.preventDefault(); btn.click(); }
    });
    if (!phone() && S.focusReview) { S.focusReview = false; const first = $(".rcard", box); if (first) setTimeout(() => first.focus(), 80); }
  }
  function bindWorth(root) {
    const box = $("#wrows", root); if (!box) return;
    const answer = async (row, v) => { row.classList.add("answered"); $$("button", row).forEach((b) => (b.disabled = true)); await worthIt(row.dataset.wid, v); toast({ yes: "Noted: worth it.", meh: "Noted: meh.", no: "Noted: not worth it." }[v] + " " + judgedWhere()); };
    $$("[data-worth]", box).forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); answer(b.closest(".wrow"), b.dataset.worth); }));
    box.addEventListener("keydown", (ev) => { const row = ev.target.closest(".wrow"); if (!row) return; const v = { y: "yes", m: "meh", n: "no" }[ev.key.toLowerCase()]; if (v) { ev.preventDefault(); answer(row, v); } });
  }
  // the fortune cookie: Ask proposes a merchant and a category from the raw descriptor; the person decides. One open at a time, never on load.
  async function crackCookie(card, btn) {
    if (!Motion) return;
    if (!S.sample) { toast("Claude isn't available in this view, so the cookie stays closed. Open the page in Claude."); return; }
    if (S.cookie && S.cookie !== btn) { S.cookie.classList.remove("open"); const sv = S.cookie.querySelector("svg"); if (sv) sv.classList.remove("open"); const old = S.cookie.closest(".rcard"); const os = old && $(".rslip", old); if (os) os.hidden = true; }
    S.cookie = btn; const id = card.dataset.rid; const m = S.m, e = m.entryById[id]; if (!e) return;
    const slip = $(".rslip", card); slip.hidden = false; slip.innerHTML = `<span class="sub">Asking the Kitty… the first time, claude.ai asks you to allow “Use Claude” for this page.</span>`;
    const open = Motion.fortune(btn, "Thinking…", null); open(); btn.onclick = null;
    const acct = m.acctById[e.acct]; const cands = E.candidates(e.raw, 5);
    const prompt = `You name merchants on an Australian household's bank statement. Reply with only one JSON object: {"merchant": "the clean trading name in Title Case, no store numbers, cities or company suffixes", "category_id": "one id from the list below", "confidence": "high|medium|low", "why": "one short sentence"}.
Bank descriptor: ${JSON.stringify(e.raw || e.desc)}
Normalised: ${JSON.stringify(E.normalise(e.raw || e.desc))}
Amount ${e.amount} on ${e.date}, account "${acct ? acct.name : e.acct}" (${acct ? acct.type : ""}), person ${e.person || "Joint"}.
Nearest dictionary entries: ${cands.length ? cands.map((c) => `${c.name} (${c.category_id})`).join(", ") : "none"}.
Categories: ${m.cats.filter((c) => c.id !== "UNCAT").map((c) => `${c.id} = ${c.name} (${c.group})`).join("; ")}.
Prefixes such as SQ, SP, TST, PAYPAL and PP name a payment processor, not the shop: name the shop after the prefix. A descriptor that reads "TRANSFER FROM <a person>" is money from a person, not a shop; name the person and pick the category that fits an incoming payment. If several readings are plausible pick the most common for an Australian household and say so in why.`;
    try {
      const res = await S.sample.json(prompt, { modelTier: "quick" });
      const merchant = String((res && res.merchant) || "").trim().slice(0, 60); const cat = String((res && res.category_id) || "").trim().toUpperCase();
      if (!merchant || !m.catById[cat]) throw { code: "invalid_json", text: JSON.stringify(res) };
      const prop = { merchant, category_id: cat, confidence: String((res && res.confidence) || "medium").toLowerCase(), why: String((res && res.why) || "").slice(0, 300) };
      const sl = btn.querySelector(".k-slip"); if (sl) sl.textContent = prop.merchant; btn.setAttribute("aria-label", `The Kitty proposes ${prop.merchant}, ${catName(prop.category_id)}`);
      slip.innerHTML = `<div class="prop">${catDisc(prop.category_id)}<span><b>${esc(prop.merchant)}</b> → ${esc(catName(prop.category_id))} <span class="tag ${prop.confidence === "high" ? "good" : prop.confidence === "low" ? "warn" : "amber"}">${esc(prop.confidence)}</span></span></div>${prop.why ? `<p class="why">${esc(prop.why)}</p>` : ""}<p class="why">Make it a rule: a Rules row <code>${esc(E.normalise(e.raw))}</code> → ${esc(prop.merchant)}, ${esc(catName(prop.category_id))}, then this row and every unreviewed row it matches get the category.</p><div class="acts"><button class="btn sm" data-rule="yes">${ico("i-rule")} Make it a rule</button><button class="btn sm ghost" data-rule="no">Not this</button></div>`;
      $("[data-rule=yes]", slip).addEventListener("click", () => { $$("button", slip).forEach((b) => (b.disabled = true)); makeRule(id, prop); });
      $("[data-rule=no]", slip).addEventListener("click", () => { slip.hidden = true; openCategoryPicker(id); });
    } catch (err) {
      const code = err && err.code;
      slip.innerHTML = `<span class="sub">${code === "not_granted" ? "Claude was not allowed for this page, so the cookie stays quiet. Categorise by hand instead." : code === "rate_limited" ? "Claude is busy; try the cookie again in a minute." : code === "invalid_json" ? "The Kitty's answer wasn't a clear proposal. Try again, or categorise by hand." : `Couldn't ask${code ? ` (${esc(code)})` : ""}.`}</span>`;
      if (code === "not_granted") { S.sample = null; renderHeader(); }
    }
  }
  // the category picker: keyboard first (type to filter, Enter picks the first), one tap on a phone
  function openCategoryPicker(id) {
    const m = S.m, e = m.entryById[id]; if (!e) return;
    const cats = m.cats.filter((c) => c.id !== "UNCAT" && c.flow !== "Transfer" || c.flow === "Transfer");
    const list = (q) => { const qq = q.trim().toLowerCase(); return cats.filter((c) => !qq || c.name.toLowerCase().includes(qq) || c.id.toLowerCase().includes(qq) || c.group.toLowerCase().includes(qq)); };
    const draw = (q) => `${list(q).map((c, i) => `<button class="cp${i === 0 && q ? " hot" : ""}" data-pickcat="${esc(c.id)}">${catDisc(c.id)}<span><b>${esc(c.name)}</b>${c.id === e.cat ? ` <span class="tag">current</span>` : ""}</span><span class="g">${esc(c.group)}</span></button>`).join("") || `<div class="empty">No category matches.</div>`}`;
    openDrawer(`${h2(`Categorise ${Kit.nameOf(e)}`, `${esc(e.raw || "")} · ${E.fmtDay(e.date, { year: true })} · ${fmt(Math.abs(e.amount))}`)}
      <div class="searchbox" style="margin-top:12px">${ico("i-search")}<input id="catq" type="search" placeholder="Type to filter, Enter picks the first" autocomplete="off" aria-label="Filter categories"></div>
      <div class="catpick" id="catpick">${draw("")}</div>
      <p class="sub" style="margin-top:10px">${canWriteSheet() ? "Writes the category to this row's cell on the Entries tab and a categorise row on Decisions." : "Kept on screen for this visit; the sheet is not written here."}</p>`);
    const q = $("#catq"), box = $("#catpick"); const bind = () => $$("[data-pickcat]", box).forEach((b) => b.addEventListener("click", () => { closeDrawer(); categorise(id, b.dataset.pickcat); }));
    bind(); q.addEventListener("input", () => { box.innerHTML = draw(q.value); bind(); });
    q.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { const first = $("[data-pickcat]", box); if (first) first.click(); } });
    if (!phone()) setTimeout(() => q.focus(), 80);
  }
  // split: two or more parts that add up to the row; the sheet keeps the parts as one Decisions row
  function openSplitEditor(id) {
    const m = S.m, e = m.entryById[id]; if (!e) return; const total = Math.abs(e.amount); const cats = m.cats.filter((c) => c.flow !== "Transfer" && c.id !== "UNCAT");
    const opt = (sel) => cats.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    let n = 2;
    const rowHtml = (i, cat, amt) => `<div class="splitrow"><select data-sc="${i}" aria-label="Category ${i + 1}">${opt(cat)}</select><input data-sa="${i}" type="number" inputmode="decimal" step="0.01" min="0" value="${amt}" aria-label="Amount ${i + 1}"></div>`;
    openDrawer(`${h2(`Split ${Kit.nameOf(e)}`, `${fmt(total)} on ${E.fmtDay(e.date, { year: true })} · the parts must add up to the row`)}
      <div class="splitrows" id="splitrows">${rowHtml(0, e.cat && e.cat !== "UNCAT" ? e.cat : cats[0].id, (total / 2).toFixed(2))}${rowHtml(1, cats.find((c) => c.id !== e.cat).id, (total - +(total / 2).toFixed(2)).toFixed(2))}</div>
      <div class="dacts"><button class="btn sm ghost" id="splitadd">${ico("i-plus")} Another part</button><span class="sub" id="splitleft" style="align-self:center"></span></div>
      <div class="dacts"><button class="btn" id="splitsave">${canWriteSheet() ? "Write the split" : "Keep the split"}</button><button class="btn ghost" id="splitcancel">Cancel</button></div>
      <p class="sub">One Decisions row, <code>split</code>, with the parts (${esc(E.formatSplit([{ cat: "GROCERIES", amount: 60 }, { cat: "DINING", amount: 24.2 }]))}). The sheet's totals stay the row's; the parts show on the row.</p>`);
    const parts = () => $$("#splitrows .splitrow").map((r) => ({ cat: $("select", r).value, amount: +$("input", r).value || 0 }));
    const left = () => { const sum = parts().reduce((a, p) => a + p.amount, 0); const d = Math.round((total - sum) * 100) / 100; $("#splitleft").textContent = d === 0 ? "Adds up." : d > 0 ? `${fmt(d)} still to place` : `${fmt(-d)} over`; return d; };
    $("#splitrows").addEventListener("input", left); left();
    $("#splitadd").addEventListener("click", () => { const d = Math.max(0, left()); $("#splitrows").insertAdjacentHTML("beforeend", rowHtml(n++, cats[Math.min(n, cats.length - 1)].id, d.toFixed(2))); left(); });
    $("#splitcancel").addEventListener("click", closeDrawer);
    $("#splitsave").addEventListener("click", () => { const ps = parts().filter((p) => p.amount > 0); if (ps.length < 2) { toast("Two parts at least"); return; } if (Math.abs(left()) > 0.005) { toast("The parts must add up to " + fmt(total)); return; } closeDrawer(); splitEntry(id, ps); });
  }

  // ----- Insights -----
  function renderInsights() {
    const m = S.m, v = $("#v-insights"); const w = period(); const sp = E.spend(m.tx, w);
    const months = Math.max(1, E.monthsBetween(w.from, w.to) + 1);
    const prevW = { from: E.addMonths(w.from, -months), to: E.addMonths(w.to, -months) }; const prev = E.spend(m.tx, prevW); const pm = new Map(prev.byCat);
    const scope = S.prefs.scope || "all"; const everyday = (t) => t.group !== "Housing" && t.group !== "Property";
    const spv = scope === "everyday" ? Object.assign(E.spend(m.tx, w, everyday), { scoped: true }) : sp; const prevv = scope === "everyday" ? E.spend(m.tx, prevW, everyday) : prev; const pmv = new Map(prevv.byCat);
    const income = [["Salary", E.spend(m.tx, w, (t) => t.cat === "SALARY").in], ["Rent", E.spend(m.tx, w, (t) => t.cat === "RENT-INC").in], ["Interest", E.spend(m.tx, w, (t) => t.cat === "INTEREST").in]].map(([k, v]) => ({ k, v }));
    const mv = E.movers(m); const lk = E.leaks(m); const prop = E.property(m); const own = E.ownership(m);
    const view = S.prefs.moneyView || (phone() ? "jar" : "flow");
    const nwSeries = m.networth.filter((n) => n.total != null).map((n) => ({ month: n.month, v: n.total }));
    const risk = m.metrics["tax.refund_at_risk.prior_year"], refund = m.metrics["tax.refund.prior_year"], corrected = m.metrics["tax.refund.corrected.prior_year"], curRefund = m.metrics["tax.refund.current_year"];
    const taxItems = m.checks.filter((c) => c.type === "Tax" && c.status === "Review");
    const sc = m.mortgage.scenarios, base = sc.findIndex((s) => Math.abs(s.change) < 1e-6);
    v.innerHTML = `
      <div class="card" style="--i:0">${periodBar("pb1")}
        <div class="statline" style="margin-top:14px"><div class="stat"><div class="k">In</div><div class="v num" style="color:var(--c-in)">${fmt0(sp.in)}</div></div><div class="stat"><div class="k">Out</div><div class="v num" style="color:var(--c-out)">${fmt0(sp.out)}</div></div><div class="stat"><div class="k">Kept</div><div class="v num" style="color:${sp.net >= 0 ? "var(--c-kept)" : "var(--c-dip)"}">${fmt0(sp.net)}<small>${sp.in ? E.fmtPct(sp.net / sp.in, 0) : ""}</small></div></div><div class="stat"><div class="k">vs the ${months === 1 ? "month" : `${months} months`} before</div><div class="v num" style="color:${sp.out <= prev.out ? "var(--good)" : "var(--warn)"}">${sp.out <= prev.out ? "▼" : "▲"} ${fmtS(Math.abs(sp.out - prev.out))}<small>spent</small></div></div></div>
      </div>
      <div class="card" style="--i:1">
        <div class="cardhead"><span class="q">Where did the money go?</span><span class="cardtools"><span class="seg mini" role="group" aria-label="Scope"><button data-scope="all" aria-pressed="${scope === "all"}">Everything</button><button data-scope="everyday" aria-pressed="${scope === "everyday"}">Everyday</button></span><span class="seg mini" role="group" aria-label="Show as"><button data-mv="flow" aria-pressed="${view === "flow"}">Flow</button><button data-mv="jar" aria-pressed="${view === "jar"}">Jar</button></span></span></div>
        ${scope === "everyday" ? `<p class="sub" style="margin:-6px 0 10px">Everyday leaves out housing and the rental: ${fmt0(sp.out - spv.out)} of fixed costs this period.</p>` : ""}
        <div class="moneyview ${view === "jar" ? "mv-jar" : ""}" id="moneyview">${view === "jar" ? `<div>${jarSVG(spv)}<p class="sub jarlegend">Bubble size is money spent. A dashed red ring means the category is over its budget this year. Tap a bubble.</p></div><div class="jarlist">${spv.byCat.slice(0, 10).map(([c, val]) => { const p0 = pmv.get(c) || 0; const d = p0 ? (val - p0) / p0 : null; return `<button class="jrow" data-cat="${esc(c)}" style="${catSwatch(c)};--mh:${esc(E.catHue(c, m))}">${ico("i-" + E.catIcon(c, m), "ci")}<span class="nm">${esc((m.catById[c] || {}).name || c)}</span><span class="pct num">${Math.round((val / (spv.out || 1)) * 100)}%</span><span class="amt num">${fmt0(val)}</span><span class="d ${d == null ? "" : d > 0.05 ? "more" : d < -0.05 ? "less" : ""}">${d == null ? "new this period" : `${d >= 0 ? "▲" : "▼"} ${Math.round(Math.abs(d) * 100)}% on the period before`}</span></button>`; }).join("")}</div>` : `<div id="flowhost">${flowSVG(spv, income) || barsHTML(spv.byGroup.map(([g, val]) => ({ k: g, v: val, color: GROUP_COLOR[g] })))}</div><p class="sub">Money in on the left, where it went on the right. Transfers between your own accounts are left out. Hover a band for the amount.</p>`}</div>
      </div>
      <div class="grid" style="--i:2">
        <div class="card span-6">
          <div class="cardhead"><span class="q">Where spending grew</span><span class="sub">last 3 months vs the same 3 last year</span></div>
          ${barsHTML(mv.slice(0, 5).concat(mv.slice(-3).filter((r) => r.diff < 0)).map((r) => ({ k: r.name, sub: `${fmt0(r.thenPm)} → ${fmt0(r.nowPm)} a month`, v: r.diff, val: `${r.diff >= 0 ? "+" : "−"}${fmt0(Math.abs(r.diff))}`, vsub: r.pct != null ? `${r.pct >= 0 ? "+" : ""}${Math.round(r.pct * 100)}%` : "new", go: "cat:" + r.cat })), { diverging: true })}
          ${mv.fastest ? `<p class="sub" style="margin-top:10px">Fastest growing by share: <b>${esc(mv.fastest.name)}</b>, ${Math.round(mv.fastest.pct * 100)}% up on last year (the sheet's own ranking).</p>` : ""}
        </div>
        <div class="card span-6">
          <div class="cardhead"><span class="q">Budget pace</span><span class="sub">${esc(m.settings["Current financial year"] || "this year")} to date</span></div>
          ${barsHTML(m.budget.filter((b) => b.monthly > 0).sort((a, b) => (b.used || 0) - (a.used || 0)).slice(0, 8).map((b) => ({ k: b.name, sub: `${ofFmt(b.ytd || 0)} of ${ofFmt(b.toDate || 0)}`, v: Math.min(1.6, b.used || 0), val: (b.left || 0) < 0 ? `${fmt0(-b.left)} over` : `${fmt0(b.left)} left`, vsub: b.status, color: /over/i.test(b.status) ? "var(--warn)" : /watch/i.test(b.status) ? "var(--amber)" : "var(--good)", go: "cat:" + ((m.cats.find((c) => c.name === b.name) || {}).id || "") })))}
          <p class="sub" style="margin-top:10px">Lumpy bills are measured against their full-year budget, so a renewal doesn't read as overspending.</p>
        </div>
      </div>
      <div class="grid" style="--i:3">
        <div class="card span-6">
          <div class="cardhead"><span class="q">Subscriptions</span><span class="sub"><b class="num">${fmt0(lk.total)}</b> a year across ${m.subs.filter((s) => !/cancel/i.test(s.decision)).length}</span></div>
          ${lk.stillCharging.map((s) => subRow(s, "warn", `Still charging after you cancelled`)).join("")}
          ${lk.unused.map((s) => subRow(s, "amber", s.daysSince != null ? `Unused for ${s.daysSince} days` : "Never used")).join("")}
          ${lk.rises.map((s) => subRow(s, "", `Price rose ${fmt(s.riseEach)} a charge · ${fmt0(s.riseYear)} a year`)).join("")}
          <button class="linkbtn" data-open="subs">All subscriptions and bills →</button>
        </div>
        <div class="card span-6">
          <div class="cardhead"><span class="q">Net worth</span><span class="sub"><b class="num">${fmtS(nwSeries.length ? nwSeries[nwSeries.length - 1].v : null)}</b> at ${E.fmtDay(m.asOf, { year: true })}</span></div>
          <div id="nwchart">${nwSeries.length > 1 ? areaSVG(nwSeries, CW(6 / 12), { label: "Net worth by month" }) : '<div class="empty">Net worth appears once two month-end valuations are in the sheet.</div>'}</div>
          <div style="margin-top:10px">${stackHTML(own)}</div>
          ${tableToggle("nwtable", `<table class="t"><thead><tr><th>Month</th><th class="n">Cash</th><th class="n">Property</th><th class="n">Super</th><th class="n">Shares</th><th class="n">Loans</th><th class="n">Net worth</th></tr></thead><tbody>${m.networth.slice().reverse().map((n) => `<tr><td>${E.fmtMonth(n.month, true)}</td><td class="n">${fmt0(n.cash)}</td><td class="n">${fmt0(n.property)}</td><td class="n">${fmt0(n.super)}</td><td class="n">${fmt0(n.shares)}</td><td class="n">${fmt0(n.loans)}</td><td class="n">${fmt0(n.total)}</td></tr>`).join("")}</tbody></table>`)}
        </div>
      </div>
      <div class="grid" style="--i:4">
        <div class="card span-6">
          <div class="cardhead"><span class="q">Home loan</span><span class="sub">${fmtS(m.mortgage.balance)} at ${E.fmtPct(m.mortgage.rate, 2)} · ${fmtS(m.mortgage.offset)} in offset</span></div>
          ${sc.length ? `<div class="whatif"><div class="lab"><span>If rates move</span><b id="rateval">${E.fmtPct(sc[base >= 0 ? base : 0].rate, 2)}</b></div><input id="rateslider" type="range" min="0" max="${sc.length - 1}" value="${base >= 0 ? base : 0}" aria-label="Interest rate scenario"><p class="sub" id="ratetext"></p></div>` : ""}
          ${m.mortgage.extras.length > 1 ? `<div class="whatif"><div class="lab"><span>Pay extra each month</span><b id="extraval">${fmt0(0)}</b></div><input id="extraslider" type="range" min="0" max="${m.mortgage.extras.length - 1}" value="0" aria-label="Extra repayment scenario"><p class="sub" id="extratext"></p></div>` : ""}
        </div>
        <div class="card span-6">
          <div class="cardhead"><span class="q">The rental</span><span class="sub">${esc(prop.asset ? prop.asset.name : "Investment property")}</span></div>
          <div class="statline"><div class="stat"><div class="k">Rent in</div><div class="v num" style="color:var(--c-in)">${fmt0(prop.rentPm)}<small>a month</small></div></div><div class="stat"><div class="k">Costs</div><div class="v num" style="color:var(--c-out)">${fmt0(prop.costPm)}</div></div><div class="stat"><div class="k">Net</div><div class="v num" style="color:${prop.netPm >= 0 ? "var(--good)" : "var(--warn)"}">${fmt0(prop.netPm)}</div></div></div>
          <div class="props">${prop.byCat.map((c) => `<button class="prop" data-go="cat:${esc(c.cat)}"><span class="t">${esc(c.name)}</span><span class="s">${esc(((m.catById[c.cat] || {}).ato || "").replace(/^Item 21 /, "tax item 21: "))}</span><span class="amt num">${fmt0(c.pm)}<span class="muted small"> /mo</span></span></button>`).join("")}</div>
          <p class="sub">Last 12 months, from the transactions. The sheet's tax forecast carries the deductions; ${prop.loan ? `the ${esc(prop.loan.type.toLowerCase())} loan of ${fmtS(prop.loan.balance)} at ${E.fmtPct(prop.loan.rate, 2)} is the largest.` : ""}</p>
        </div>
      </div>
      <div class="card" style="--i:5">
        <div class="cardhead"><span class="q">Tax</span><span class="sub">estimates from the sheet, not advice</span></div>
        <div class="statline"><div class="stat"><div class="k">Refund expected · ${esc(refund ? refund.period : "")}</div><div class="v num">${fmt0(refund ? refund.num : null)}</div></div><div class="stat"><div class="k">If flagged claims are fixed</div><div class="v num">${fmt0(corrected ? corrected.num : null)}</div></div><div class="stat"><div class="k">Resting on flagged claims</div><div class="v num" style="color:var(--amber)">${fmt0(risk ? risk.num : null)}</div></div><div class="stat"><div class="k">Projected · ${esc(curRefund ? curRefund.period : "")}</div><div class="v num">${fmt0(curRefund ? curRefund.num : null)}</div></div></div>
        <div class="nlist">${taxItems.map((c) => `<button class="need" data-open="check:${esc(c.name)}"><span class="em" aria-hidden="true">🧾</span><span class="mid"><span class="t">${esc(c.name)}</span><span class="s">${esc(c.why)}</span></span><span class="amt num">${fmt0(c.amount)}<small>${c.items} item${c.items === 1 ? "" : "s"}</small></span>${ico("i-chev", "chev")}</button>`).join("")}</div>
      </div>`;
    bindPeriod($("#pb1", v));
    $$("[data-mv]", v).forEach((b) => b.addEventListener("click", () => { savePrefs({ moneyView: b.dataset.mv }); renderInsights(); }));
    $$("[data-scope]", v).forEach((b) => b.addEventListener("click", () => { savePrefs({ scope: b.dataset.scope }); buzz(); renderInsights(); }));
    $$(".bubg,[data-cat]", v).forEach((b) => b.addEventListener("click", () => openCategory(b.dataset.cat, w)));
    $$(".bubg", v).forEach((b) => b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCategory(b.dataset.cat, w); } }));
    if (nwSeries.length > 1) bindArea($("#nwchart"), nwSeries, (s) => `Net worth <b>${fmt0(s.v)}</b>`);
    const rs = $("#rateslider"); if (rs) { const upd = () => { const s = sc[+rs.value]; $("#rateval").textContent = E.fmtPct(s.rate, 2) + (s.change ? ` (${s.change > 0 ? "+" : ""}${(s.change * 100).toFixed(2)}%)` : " (today)"); $("#ratetext").innerHTML = `Repayment <b>${fmt0(s.repayment)}</b> a month${s.changePm ? ` (${s.changePm > 0 ? "+" : "−"}${fmt0(Math.abs(s.changePm))})` : ""}, leaving <b>${fmt0(s.netAfter)}</b> a month after spending. Paid off in <b>${s.years != null ? s.years.toFixed(1) : "—"} years</b> at today's repayment with the offset.`; }; rs.addEventListener("input", upd); upd(); }
    const es = $("#extraslider"); if (es) { const upd = () => { const x = m.mortgage.extras[+es.value]; $("#extraval").textContent = fmt0(x.extra); $("#extratext").innerHTML = x.extra ? `Paid off in <b>${x.years.toFixed(1)} years</b>, <b>${x.saved.toFixed(1)} years</b> sooner, saving about <b>${fmtS(x.interestSaved)}</b> in interest.` : `Today: paid off in <b>${x.years.toFixed(1)} years</b> with the offset. Slide to see what extra does.`; }; es.addEventListener("input", upd); upd(); }
    bindCommon(v); bindTables(v);
  }
  const subRow = (s, cls, line) => `<button class="row" data-open="sub:${esc(s.service)}"><span class="ava sm" style="${catSwatch(s.cat)}">${esc(initials(s.service))}</span><span class="mid"><span class="t">${esc(s.service)}${s.owner && s.owner !== "Joint" ? ` <span class="muted small">· ${esc(s.owner)}</span>` : ""}</span><span class="s">${line}</span></span><span class="amt num"><span class="tag ${cls}">${fmt0(s.annual)}/yr</span></span></button>`;

  // ----- Goals -----
  function renderGoals() {
    const m = S.m, v = $("#v-goals"); const lead = leadGoal(); const sf = E.safety(m);
    const extra = S.goalExtra || 0;
    const hero = lead ? (() => { const eta = E.goalEta(lead, extra, m.asOf); const pct = lead.progress || 0; return `<div class="card" style="--i:0"><div class="cardhead"><span class="q">${esc(lead.name)}</span><span class="cardtools">${canWriteSheet() || S.mode !== "live" ? `<button class="linkbtn" data-editgoal="${esc(lead.name)}">Edit</button>` : ""}<button class="linkbtn" data-open="goal:${esc(lead.name)}">Details</button></span></div>
      <div class="goalhero">${ringSVG(pct, E.goalColor(lead.name), ofFmt(lead.balance || 0), `of ${ofFmt(lead.target || 0)}`, 150)}<div>
        <p style="font-size:17px">${lead.status === "Reached" ? `<b>Reached.</b> ${fmt0(lead.balance)} is sitting in ${esc((m.acctById[lead.acct] || {}).name || "the saver")}.` : eta.date ? `At <b>${fmt0((lead.savedPm || 0) + extra)}</b> a month you get there <b>${E.fmtMonth(eta.date)}</b>${lead.date ? eta.late ? `, <span style="color:var(--warn)">after the ${E.fmtMonth(lead.date, true)} target</span>` : `, <span style="color:var(--good)">ahead of the ${E.fmtMonth(lead.date, true)} target</span>` : ""}.` : `Nothing has gone in for three months. To make ${E.fmtMonth(lead.date, true)} it needs <b>${fmt0(lead.needPm)}</b> a month.`}</p>
        <p class="sub" style="margin-top:6px">${lead.status === "Reached" ? `Target met ${lead.date ? `with ${E.monthsBetween(m.asOf, lead.date)} month${E.monthsBetween(m.asOf, lead.date) === 1 ? "" : "s"} to spare` : ""} · the last 3 months put in ${fmt0(lead.savedPm)} a month.` : `${toGo(lead.balance, lead.target)} · needs ${fmt0(lead.needPm)} a month for the target date · the last 3 months put in ${fmt0(lead.savedPm)} a month.`}</p>
        ${lead.status === "Reached" ? `<div class="whatif"><div class="lab"><span>Done. Lead with the next one?</span></div><div class="chips" style="margin-top:6px">${m.goals.filter((g) => g !== lead && g.status !== "Reached").map((g) => `<button class="chip" data-lead="${esc(g.name)}">${E.goalIcon(g.name)} ${esc(g.name)}</button>`).join("") || '<span class="sub">Every goal is reached. Add one below.</span>'}</div><p class="sub" style="margin-top:8px">The ${fmt0(lead.savedPm)} a month that went to ${esc(lead.name)} could move to it.</p></div>` : `<div class="whatif"><div class="lab"><span>What if you added each month</span><b id="extraval2">${extra ? "+" + fmt0(extra) : "nothing extra"}</b></div><input id="goalextra" type="range" min="0" max="2000" step="50" value="${extra}" aria-label="Extra per month"><p class="sub" id="extraline">${extra && eta.date ? `${eta.months} month${eta.months === 1 ? "" : "s"} instead of ${E.goalEta(lead, 0, m.asOf).months || "—"}.` : "Slide to see the date move."}</p></div>`}
      </div></div></div>`; })() : `<div class="card" style="--i:0"><div class="empty">No goals yet. Add one below.</div></div>`;
    v.innerHTML = `${hero}
      <div class="card" style="--i:1"><div class="cardhead"><span class="q">All goals</span><span class="cardtools">${canWriteSheet() || S.mode !== "live" ? `<button class="btn sm" id="addgoal">${ico("i-plus")} Add a goal</button>` : `<span class="sub">Edit goals on the Goals tab of the sheet</span>`}</span></div>
        <div class="gtiles" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))">${m.goals.map((g) => goalTile(g, false)).join("")}</div>
        <p class="sub" style="margin-top:10px">Each goal is a row on the sheet's Goals tab, linked to one saver account. The sheet works out progress and pace; this page only reads it${canWriteSheet() ? ", and writes a target or date back when you change one here" : ""}.</p>
      </div>
      <div class="grid" style="--i:2">
        <div class="card span-5"><div class="cardhead"><span class="q">Safety net</span></div>
          <div class="goalrow">${ringSVG(sf.pct, "var(--c-in)", sf.months != null ? sf.months.toFixed(1) : "—", `of ${sf.target} months`)}<div class="txt"><p>${sf.months != null ? `Cash and offset would cover <b>${sf.months.toFixed(1)} months</b> of essential spending (about ${fmt0(sf.essentialPm)} a month).` : "The sheet has no safety-net figure yet."}</p><p class="sub" style="margin-top:6px">${sf.short ? `About ${fmtS(sf.short)} more would reach the ${sf.target}-month target you set. ` : ""}Essential means the categories marked Essential on the Categories tab.</p>${canWriteSheet() || S.mode !== "live" ? `<button class="linkbtn" id="editsafety">Change the target</button>` : ""}</div></div>
        </div>
        ${(() => { const ws = E.worthSummary(m); if (ws.count < 5) return ""; return `<div class="card span-12" id="yescard"><div class="cardhead"><span class="q">${ico("i-worth")} Spend that earned a yes</span><span class="sub"><b class="num">${fmt0(ws.yesTotal)}</b> of ${fmt0(ws.total)} you were asked about · ${ws.yes} yes, ${ws.meh} meh, ${ws.no} no</span></div>
          <div class="yesblock"><div><h3 style="font-size:15px;margin-bottom:6px">By category</h3>${barsHTML(ws.byCat.slice(0, 6).map(([k, v]) => ({ k, v })))}</div><div><h3 style="font-size:15px;margin-bottom:6px">By merchant</h3>${barsHTML(ws.byMerchant.slice(0, 6).map(([k, v]) => ({ k, v, go: "merchant:" + k })))}</div></div>
          <p class="sub" style="margin-top:10px">What you said was worth it, summed. ${ws.noByMerchant.length ? `The no's: ${ws.noByMerchant.slice(0, 3).map(([k, v]) => `${esc(k)} (${fmt0(v)})`).join(", ")}.` : ""} Experiences, small pleasures and things enjoyed with others tend to collect the yeses (Dunn, Gilbert and Wilson, 2011); the point is noticing, not scoring.</p></div>`; })()}
        <div class="card span-7" id="savecard"><div class="cardhead"><span class="q">Ways to get there faster</span><span class="sub"><b class="num">${fmt0(m.savings.filter((s) => s.type === "Recurring").reduce((a, s) => a + (s.amount || 0), 0))}</b> a year, the sheet's estimate</span></div>
          <div class="gtiles">${m.savings.filter((s) => !(S.prefs.hidden || []).includes(s.title)).map(ideaTile).join("")}</div>
          ${(S.prefs.hidden || []).length ? `<button class="linkbtn" id="unhideall">Show ${S.prefs.hidden.length} hidden on this device</button>` : ""}
        </div>
      </div>`;
    const ge = $("#goalextra"); if (ge) ge.addEventListener("input", () => { S.goalExtra = +ge.value; const eta = E.goalEta(lead, S.goalExtra, m.asOf); $("#extraval2").textContent = S.goalExtra ? "+" + fmt0(S.goalExtra) : "nothing extra"; $("#extraline").textContent = eta.date ? `${eta.months} month${eta.months === 1 ? "" : "s"} instead of ${E.goalEta(lead, 0, m.asOf).months || "—"} · ${E.fmtMonth(eta.date)}` : "Slide to see the date move."; });
    ge && ge.addEventListener("change", () => renderGoals());
    const ag = $("#addgoal"); if (ag) ag.addEventListener("click", () => openGoalEditor(null));
    $$("[data-lead]", v).forEach((b) => b.addEventListener("click", async () => { const name = b.dataset.lead; savePrefs({ leadGoal: name }); toast(`${name} now leads`); if (canWriteSheet()) { try { await writeKitty("lead_goal", name); } catch (e) { toast("Saved here; the sheet write failed: " + errText(e)); } } renderAll(); }));
    $$("[data-editgoal]", v).forEach((b) => b.addEventListener("click", () => openGoalEditor(m.goals.find((g) => g.name === b.dataset.editgoal))));
    const es = $("#editsafety"); if (es) es.addEventListener("click", openSafetyEditor);
    const ua = $("#unhideall"); if (ua) ua.addEventListener("click", () => { savePrefs({ hidden: [] }); renderGoals(); renderHome(); });
    bindCommon(v);
  }

  // ----- Setup: the mini project page -----
  const platform = () => { const ua = navigator.userAgent || ""; const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); const android = /Android/.test(ua); const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; return { ios, android, standalone, mobile: ios || android }; };
  function installStepsHTML() {
    const p = platform();
    if (p.standalone) return `<div class="okline">${ico("i-check")} You're reading this from your home screen. Nice.</div>`;
    const ios = `<div class="steps"><div class="st"><i>1</i><span>Open this page in <b>Safari</b> (not inside another app).</span></div><div class="st"><i>2</i><span>Tap the Share button ${ico("i-share")} in the toolbar.</span></div><div class="st"><i>3</i><span>Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b>.</span></div></div>`;
    const android = `<div class="steps"><div class="st"><i>1</i><span>Open this page in <b>Chrome</b>.</span></div><div class="st"><i>2</i><span>Tap the ⋮ menu, then <b>Add to Home screen</b> or <b>Install app</b>.</span></div><div class="st"><i>3</i><span>Tap <b>Install</b>. It opens full screen, with its own icon.</span></div></div>`;
    if (p.ios) return ios; if (p.android) return android;
    return `<p class="sub" style="margin-bottom:8px">On a phone, this page installs like an app: full screen, its own icon, no browser bars. ${PAGE_URL ? "Scan the code with your phone's camera, then:" : "Open the page on your phone, then:"}</p><details><summary style="font-weight:700;cursor:pointer">iPhone</summary>${ios}</details><details style="margin-top:8px"><summary style="font-weight:700;cursor:pointer">Android</summary>${android}</details>`;
  }
  function qrHTML() { if (!PAGE_URL || !window.qrcode) return ""; try { const q = window.qrcode(0, "M"); q.addData(PAGE_URL); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) { return ""; } }
  function diagramSVG() {
    return `<svg viewBox="0 0 960 372" role="img" aria-label="Bank files land in a sources folder, an importer appends rows to the sheet's raw tabs, the sheet's views and Metrics compute everything, and The Kitty reads the sheet through the viewer's connector or a bundled snapshot; onboarding writes only to the Kitty, Goals and Settings tabs">
      <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" fill="currentColor"/></marker></defs>
      <g class="dg">
        <rect class="dg-box" x="10" y="40" width="150" height="70" rx="12"/><text class="dg-t" x="85" y="68" text-anchor="middle">Banks</text><text class="dg-s" x="85" y="86" text-anchor="middle">CSV export · Up API</text>
        <rect class="dg-box" x="10" y="210" width="150" height="70" rx="12"/><text class="dg-t" x="85" y="238" text-anchor="middle">sources/</text><text class="dg-s" x="85" y="256" text-anchor="middle">files as delivered, never edited</text>
        <rect class="dg-box" x="210" y="120" width="150" height="100" rx="12"/><text class="dg-t" x="285" y="150" text-anchor="middle">Importer</text><text class="dg-s" x="285" y="168" text-anchor="middle">a person or an agent</text><text class="dg-s" x="285" y="184" text-anchor="middle">dedupe · categorise · review</text><text class="dg-s" x="285" y="200" text-anchor="middle">then append</text>
        <rect class="dg-box owner" x="410" y="20" width="250" height="300" rx="16"/><text class="dg-t" x="535" y="46" text-anchor="middle">Google Sheet · the one owner</text>
        <rect class="dg-box" x="425" y="60" width="220" height="56" rx="10"/><text class="dg-t" x="535" y="82" text-anchor="middle">Raw tabs</text><text class="dg-s" x="535" y="100" text-anchor="middle">Transactions · Payslips · Valuations</text>
        <rect class="dg-box" x="425" y="128" width="220" height="56" rx="10"/><text class="dg-t" x="535" y="150" text-anchor="middle">Input tabs</text><text class="dg-s" x="535" y="168" text-anchor="middle">Accounts · Categories · Goals · Settings · Kitty</text>
        <rect class="dg-box" x="425" y="196" width="220" height="56" rx="10"/><text class="dg-t" x="535" y="218" text-anchor="middle">Views, formulas only</text><text class="dg-s" x="535" y="236" text-anchor="middle">Cash Flow · Budget · Checks · Tax · Loans</text>
        <rect class="dg-box" x="425" y="264" width="220" height="40" rx="10"/><text class="dg-t" x="535" y="289" text-anchor="middle">Metrics · one row per headline</text>
        <rect class="dg-box" x="740" y="40" width="100" height="60" rx="12"/><text class="dg-t" x="790" y="64" text-anchor="middle">Apps Script</text><text class="dg-s" x="790" y="82" text-anchor="middle">JSON snapshot</text>
        <rect class="dg-box" x="740" y="210" width="100" height="60" rx="12"/><text class="dg-t" x="790" y="234" text-anchor="middle">Sheets</text><text class="dg-s" x="790" y="252" text-anchor="middle">viewer's connector</text>
        <rect class="dg-box page" x="865" y="110" width="90" height="110" rx="16"/><text class="dg-t dg-page" x="910" y="150" text-anchor="middle">The Kitty</text><text class="dg-s dg-page" x="910" y="170" text-anchor="middle" opacity=".75">this page</text><text class="dg-s dg-page" x="910" y="188" text-anchor="middle" opacity=".75">phone · desktop</text>
        <path class="dg-edge" d="M85 110 V210" marker-end="url(#arr)"/><text class="dg-lab" x="92" y="164">downloaded monthly</text>
        <path class="dg-edge" d="M160 245 H185 V170 H210" marker-end="url(#arr)"/>
        <path class="dg-edge" d="M360 170 H385 V88 H425" marker-end="url(#arr)"/>
        <path class="dg-edge" d="M535 116 V128"/><path class="dg-edge" d="M535 184 V196" marker-end="url(#arr)"/><path class="dg-edge" d="M535 252 V264" marker-end="url(#arr)"/>
        <path class="dg-edge" d="M660 70 H740" marker-end="url(#arr)"/><text class="dg-lab" x="700" y="62" text-anchor="middle">reads all tabs</text>
        <path class="dg-edge" d="M660 240 H740" marker-end="url(#arr)"/><text class="dg-lab" x="700" y="232" text-anchor="middle">reads live</text>
        <path class="dg-edge" d="M840 70 H852 V150 H865" marker-end="url(#arr)"/><text class="dg-lab" x="846" y="122" text-anchor="end">bundled demo</text>
        <path class="dg-edge" d="M840 240 H852 V180 H865" marker-end="url(#arr)"/>
        <path class="dg-edge write" d="M910 220 V345 H535 V322" marker-end="url(#arr)"/><text class="dg-lab" x="722" y="360" text-anchor="middle">onboarding writes, each to its owning tab: Kitty · Goals · Settings</text>
      </g></svg>`;
  }
  function renderSetup() {
    const m = S.m, v = $("#v-setup"); const cc = S.setupCountry || pref("country", m.kitty.country || "AU");
    const country = SOURCES.countries.find((c) => c.code === cc) || SOURCES.countries[0];
    const sheetLink = `https://docs.google.com/spreadsheets/d/${sheetId()}/edit`;
    const onNow = WID(m).filter((w) => !w.core).map((w) => w.title);
    v.innerHTML = `
      <div class="card" style="--i:0"><div class="cardhead"><span class="q">Why Home looks the way it does</span></div>
        <div class="prose"><p>Home is made of widgets, and what's in your sheet switches them on, not a setting. Add a property to Accounts and its widgets appear once, with a note and an undo. A widget with nothing to say stays off, so you never see an empty tile. Arrange moves, resizes and hides them, and that layout is yours, kept with you and never in the sheet. Anything marked beta stays off until you make it active.</p>
        <p class="sub">${onNow.length ? `On for this household: ${esc(onNow.join(", "))}.` : "Nothing beyond the everyday set is on yet."}</p></div>
      </div>
      <div class="card" style="--i:0"><div class="cardhead"><span class="q">How The Kitty is built</span><span class="sub">and why, so you can keep it or copy it</span></div>
        <div class="statline"><div class="stat"><div class="k">Source of truth</div><div class="v">1 sheet</div></div><div class="stat"><div class="k">Servers</div><div class="v">0</div></div><div class="stat"><div class="k">Page</div><div class="v">1 file</div></div><div class="stat"><div class="k">Monthly upkeep</div><div class="v">~20 min</div></div></div>
        <div class="prose"><p>The whole system is <b>one Google Sheet</b> that does every calculation, and <b>one page</b> (this one) that reads it and never computes a number the sheet already owns. Bank files are appended as raw rows; formulas turn them into views; a Metrics tab names each headline figure; the page draws those and says where each came from. There is no database, no server, no account to keep alive. If this page vanished tomorrow the household would still have everything, in a format their accountant can open.</p></div>
        <figure class="diagram">${diagramSVG()}<figcaption>Solid arrows are reads and appends. The one dashed arrow is the only thing this page writes: the settings it owns, a goal's target or date, and the safety-net target, each to the tab that owns it.</figcaption></figure>
      </div>
      <div class="card" style="--i:1"><div class="cardhead"><span class="q">One owner per number</span></div>
        <div class="prose"><p>Every figure on this page has exactly one home. The Goals tab owns targets and pace. Settings owns the as-of date and the safety-net target. Subscriptions owns prices and decisions. Metrics owns the headlines. The page re-derives nothing it can read, and when it must derive (a search, a window of spending) it checks itself against the sheet: the trust drawer shows those reconciliations live. Estimates are labelled as estimates, never published as fact.</p>
        <ul><li><b>Raw tabs are append-only.</b> A mistake is fixed with a new row, not by editing history.</li><li><b>Views are formulas only.</b> Nobody types into them, so nothing silently drifts.</li><li><b>The page follows the sheet.</b> Change a target in Goals and the page's dates move; change them here and the sheet gets the write.</li><li><b>Agents append, people decide.</b> An importer proposes categories and a review list; a person settles it before anything lands.</li></ul></div>
      </div>
      <div class="card" style="--i:2"><div class="cardhead"><span class="q">Why this, not that</span></div>
        <div class="why">${[
          ["A sheet as the store", "<b>Google Sheets.</b> Readable by a person, an accountant and an agent; formulas are the business logic; free; survives any app.", "<b>A database or SaaS budgeting app.</b> Faster at scale a household never reaches; locks the data in; needs a server or a subscription."],
          ["A Claude artifact as the app", "<b>One published page.</b> Installs on a phone, reads the viewer's own connectors with their consent, can ask Claude questions about the data, costs nothing to host.", "<b>A native app or a hosted web app.</b> App-store review, a backend, auth, hosting bills, and the data would have to leave the sheet."],
          ["How data gets in", "<b>Monthly CSV exports, filed as delivered.</b> Works at every bank in every country today; an agent can drive the browser while the person signs in.", "<b>Screen-scraping aggregators.</b> Hold your password and break on bank changes. Open banking is better where you can reach it as an individual (Up, Monzo, Akahu) and is listed as the first choice there."],
          ["Reading the sheet", "<b>The viewer's Google Sheets connector</b>, with a 30-minute cache and a read-age indicator. The viewer's credentials, never ours.", "<b>A service account or API key in the page.</b> Would make the sheet readable by anyone with the page."],
          ["The demo data", "<b>Bundled snapshot.</b> Fictional, so bundling is safe; the page opens instantly for anyone and still goes live for the owner.", "<b>Fetch at runtime.</b> Blocked by the artifact sandbox for outside hosts, and a demo should never wait on a connector."],
          ["Charts", "<b>Hand-drawn SVG, with d3 only for layout maths</b> (circle packing, the flow). Small, themeable, no runtime fetches.", "<b>A charting library.</b> Hundreds of kilobytes for a dozen charts, each with its own look."],
          ["Writes from the page", "<b>Three narrow writes</b>, each to the tab that owns the value, each behind a click, each reread afterwards.", "<b>A general editor.</b> Would make the page a second place where numbers get typed, and the sheet's checks would stop being the last word."],
          ["Where the logic lives", "<b>engine.js, pure functions with tests</b> that use the sheet as the oracle (transactions must add up to the Cash Flow tab, every month).", "<b>Logic in the templates.</b> Untestable, and two copies of every rule."]].map(([k, a, b]) => `<div class="whyrow"><div class="k">${k}</div><div class="pick">${a}</div><div class="alt">${b}</div></div>`).join("")}</div>
      </div>
      <div class="card" style="--i:3"><div class="cardhead"><span class="q">Getting your data in</span><span class="cardtools"><span class="seg mini" role="group" aria-label="Country">${SOURCES.countries.map((c) => `<button data-cc="${c.code}" aria-pressed="${c.code === country.code}">${c.code}</button>`).join("")}</span></span></div>
        <div class="prose"><p><b>${esc(country.name)}</b> · ${esc(country.currency)} · financial year ${esc(country.fy)}. ${esc(country.best)}</p></div>
        <h3 style="margin:16px 0 8px;font-size:15px">Options, ranked</h3>
        <div class="verdicts">${country.verdict.map(([a, b, c]) => `<div class="vrow"><span class="a">${esc(a)}</span><span class="b">${esc(b)}</span><span class="tag ${/recommended|best/i.test(c) ? "good" : /avoid/i.test(c) ? "warn" : ""}">${esc(c)}</span></div>`).join("")}</div>
        <h3 style="margin:16px 0 8px;font-size:15px">Where the export lives, bank by bank</h3>
        <div class="inst">${country.institutions.map((i) => `<div class="instrow"><span class="n">${esc(i.name)}</span><span class="p">${esc(i.path)}</span><span class="f">${esc(i.formats)}${i.app ? ` · app: ${esc(i.app)}` : ""} · ${i.verified ? `verified ${esc(i.verified)}` : `documented ${esc(i.documented)}, not yet verified in a browser`}</span><span class="c">Columns: ${esc(i.columns)}${i.notes ? ` · ${esc(i.notes)}` : ""}</span></div>`).join("")}</div>
        <p class="sub" style="margin-top:10px">Paths move. Each row says when it was written down and whether an agent has since confirmed it on the bank's own site; the skill below confirms before trusting one and records the date.</p>
        <h3 style="margin:16px 0 8px;font-size:15px">If an agent does the download</h3>
        <div class="prose"><p>${esc(country.agent)}</p><p>The repo ships this as a skill (<code>kitty/skills/bank-export/SKILL.md</code>) that Claude Code or Codex follows: pick the country and bank from this list, open the export page in a supervised browser, let the person or their password manager sign in, never touch a credential or a one-time code, save the file as delivered into <code>sources/&lt;account&gt;/&lt;date&gt;/</code>, run the importer, and hand back the review list. Banks and payments are high-risk sites: the browser asks the person before every click there, and that is the point.</p></div>
        <h3 style="margin:16px 0 8px;font-size:15px">How a file lands in the sheet</h3>
        <div class="prose"><p>${esc(SOURCES.landing.rule)}</p></div>
        <div class="tablewrap"><table class="t"><thead><tr><th>Transactions column</th><th>From the file</th></tr></thead><tbody>${SOURCES.landing.map.map(([a, b]) => `<tr><td><b>${esc(a)}</b></td><td>${esc(b)}</td></tr>`).join("")}</tbody></table></div>
      </div>
      <div class="card" style="--i:4" id="yours"><div class="cardhead"><span class="q">Make it yours</span><span class="sub">about an hour, once</span></div>
        <div class="clone">
          <div class="st"><div><b>Copy the sheet.</b><span><a href="https://docs.google.com/spreadsheets/d/${DEMO_SHEET}/copy" target="_blank" rel="noopener">Make a copy of the Davies demo sheet</a> (Google asks you to confirm). The Kitty tab, the formulas and the bound script copy with it. Clear the three raw tabs (Transactions, Payslips, Valuations) and fill Accounts, Categories, Goals and Settings for your household.</span></div></div>
          <div class="st"><div><b>Add the Google Sheets connector in claude.ai</b><span>Settings → Connectors → Google Sheets, with the Google account that owns your copy. This page reads through it with your consent; nothing else ever sees the sheet.</span></div></div>
          <div class="st"><div><b>Point this page at your sheet.</b><span>Paste the sheet's ID (the long part of its URL) below. It is remembered on this device${S.dbDoc ? " and in your Claude account" : ""}. The page will read it live and go back to the demo if it can't.</span></div></div>
          <div class="st"><div><b>Bring in the first files.</b><span>Export the last three months from each account using the guide above, run <code>period-close/import_month.py</code> (or ask your agent to), settle the review list, append. Move the As-of date in Settings. The Compliance Checks tab tells you when the month is whole.</span></div></div>
          <div class="st"><div><b>Run the setup here.</b><span>Name, country, lead goal, safety net, colour, phone. Five screens; it writes to the Kitty tab.</span></div></div>
          <div class="st"><div><b>Optional: your own copy of the page.</b><span>The source is in the repo (<code>kitty/</code>: engine, page, build, tests). <code>python3 kitty/build.py --no-snapshot</code> gives a page with no data in it, which you publish privately from Claude with the Google Sheets connector declared. Use that one for real money; this demo page stays public.</span></div></div>
        </div>
        <div class="sheetform"><input id="sheetinput" type="text" inputmode="text" placeholder="Paste your sheet ID or its URL" value="${esc(S.prefs.sheet || "")}" aria-label="Your Google Sheet ID"><button class="btn sm" id="sheetgo">${S.mcp ? "Read it live" : "Save for when connectors are available"}</button>${S.prefs.sheet ? `<button class="btn sm ghost" id="sheetdemo">Back to the demo</button>` : ""}</div>
        <p class="sub" style="margin-top:8px">${S.mode === "live" ? `Reading <a href="${sheetLink}" target="_blank" rel="noopener">${isDemoSheet() ? "the demo sheet" : "your sheet"}</a> live.` : S.mcp ? (S.liveErr ? `Last live read failed: ${errText(S.liveErr)}` : isDemoSheet() ? "Showing the bundled demo. The owner's view reads the demo sheet live; paste your own ID to read yours." : "") : "Connectors aren't available in this view, so the page shows the bundled demo household."} <button class="linkbtn" id="rerunonb">Run the setup again</button></p>
      </div>
      <div class="card" style="--i:4.5" id="lookcard"><div class="cardhead"><span class="q">Appearance</span><span class="sub">remembered with your other choices</span></div>
        <div class="cardtools"><span class="seg" role="group" aria-label="Theme">${[["system", "Match my device"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => `<button data-theme-pick="${k}" aria-pressed="${(S.prefs.theme || "system") === k}">${l}</button>`).join("")}</span><span class="swatches">${[["violet", "#5B3DF5"], ["coral", "#F0533D"], ["teal", "#0E8F8E"], ["lime", "#7DB91D"]].map(([n, c]) => `<button class="swatch" data-accent-pick="${n}" aria-pressed="${(pref("accent", m.kitty.accent) || "violet") === n}" aria-label="${n}" style="background:${c};width:34px;height:34px"></button>`).join("")}</span></div>
      </div>
      <div class="card" style="--i:5" id="phonecard"><div class="cardhead"><span class="q">On your phone</span><span class="sub">it installs like an app</span></div>
        <div class="qr">${qrHTML() ? `<div>${qrHTML()}</div>` : ""}<div>${installStepsHTML()}<p class="sub" style="margin-top:10px">Claude publishes every artifact with a web-app manifest, so the home-screen icon, the full-screen window and the name “${esc(document.title)}” come for free. Your connector sign-in travels with your Claude session, so the phone copy is live too.</p></div></div>
      </div>
      <div class="card" style="--i:6"><div class="cardhead"><span class="q">What it costs to keep</span><span class="sub">realistic, not aspirational</span></div>
        <div class="cost">
          <div class="c"><b>20 min</b><span>a month: export each account, run the importer, settle 5 to 15 review items, move the as-of date. The agent can do all but the sign-ins.</span></div>
          <div class="c"><b>1 hour</b><span>a quarter: add a valuation per asset, check Subscriptions decisions, read Compliance Checks, update work-from-home hours.</span></div>
          <div class="c"><b>$0</b><span>to run. Google Sheets and a Claude plan you already have. No hosting, no database, no key to rotate.</span></div>
          <div class="c"><b>What breaks</b><span>A bank changes its CSV columns (fix the adapter, a 10-minute job), a connector needs re-consent (one click), a new merchant needs a rule (one row). Nothing breaks silently: the Checks tab and the trust drawer say so.</span></div>
        </div>
      </div>
      <div class="card" style="--i:7"><div class="cardhead"><span class="q">Where this goes</span><span class="sub">what the design already allows for</span></div>
        <div class="roadmap">
          <div class="road"><span class="when">Now</span><div><b>Ask the Kitty.</b><span>The page can hand Claude your numbers with tools (spending, search, goals, bills) and answer in plain words: “what did we spend on dining in October?”. It runs with your consent, in the page, and remembers nothing between questions.</span></div></div>
          <div class="road"><span class="when">Next</span><div><b>The month-end close as an agent job.</b><span>A scheduled agent opens each bank in a supervised browser, waits for the sign-in, exports, imports, writes the review list, and emails three questions instead of thirty rows. The Compliance Checks tab is its definition of done.</span></div></div>
          <div class="road"><span class="when">Soon</span><div><b>Open banking as the feed.</b><span>Where an individual can hold a token over their own accounts (Up, Monzo, Akahu, GoCardless) the importer reads JSON instead of CSV and the chore disappears. The sheet does not change at all.</span></div></div>
          <div class="road"><span class="when">Later</span><div><b>Two people, one page.</b><span>Presence (“Mia is looking at Goals”), a shared what-if slider, and a decision log in the sheet, so a couple settles a cancellation or a target together and the record shows who decided what.</span></div></div>
          <div class="road"><span class="when">Always</span><div><b>The sheet outlives the page.</b><span>Every improvement is judged by one test: could the household walk away from this page and still have everything? Yes today; yes after each step above.</span></div></div>
        </div>
      </div>
      <div class="card" style="--i:7.5"><div class="cardhead"><span class="q">Privacy, plainly</span></div>
        <div class="prose"><ul style="margin:0"><li><b>Nothing is collected.</b> No analytics, no tracking, no server of ours. This page is a file served by claude.ai.</li><li><b>Your sheet is read with your own Google connector,</b> through claude.ai, only after you allow it, and only the tabs listed in the trust drawer. The demo household is fictional and bundled in the page.</li><li><b>Ask the Kitty sends numbers to Claude only when you ask a question,</b> after you allow "Use Claude". It keeps nothing between questions.</li><li><b>Your preferences</b> (name, country, lead goal, colours, theme, your own sheet ID) stay on this device and, when available, in your Claude account's private store for this page. Nothing else is written anywhere except the three sheet cells described above, by your click.</li></ul></div>
      </div>
      <p class="sub" style="--i:8;padding:0 6px">The Kitty ${VERSION} · fictional household · <button class="linkbtn" data-open="trust">Where the numbers come from</button> · <a href="${sheetLink}" target="_blank" rel="noopener">open the sheet</a> · <a href="${REPO}" target="_blank" rel="noopener">source on GitHub</a> · <a href="${REPO}/issues/new" target="_blank" rel="noopener">report a problem</a></p>`;
    $$("[data-cc]", v).forEach((b) => b.addEventListener("click", () => { S.setupCountry = b.dataset.cc; renderSetup(); }));
    $$("[data-theme-pick]", v).forEach((b) => b.addEventListener("click", () => { savePrefs({ theme: b.dataset.themePick }); applyTheme(); renderSetup(); buzz(); }));
    $$("[data-accent-pick]", v).forEach((b) => b.addEventListener("click", async () => { savePrefs({ accent: b.dataset.accentPick }); applyAccent(); renderSetup(); if (canWriteSheet()) { try { await writeKitty("accent", b.dataset.accentPick); } catch (e) { /* stays local */ } } }));
    const go = $("#sheetgo"); if (go) go.addEventListener("click", async () => { const raw = $("#sheetinput").value.trim(); const mt = raw.match(/\/d\/([A-Za-z0-9_-]{20,})/); const id = mt ? mt[1] : raw; if (!id) { toast("Paste a sheet ID first"); return; } savePrefs({ sheet: id === DEMO_SHEET ? "" : id }); S.canWrite = S.isOwner || !!S.prefs.sheet; if (S.mcp) { const ok = await loadLive(true); toast(ok ? "Reading your sheet live" : "Couldn't read that sheet: " + errText(S.liveErr || {}, "it")); if (!ok && SNAP) { setModel(demoModel()); S.mode = "demo"; } renderAll(); } else { toast("Saved. It will read live where connectors are available."); renderSetup(); } });
    const sd = $("#sheetdemo"); if (sd) sd.addEventListener("click", () => { savePrefs({ sheet: "" }); S.canWrite = S.isOwner; if (SNAP) { setModel(demoModel()); S.mode = "demo"; } renderAll(); toast("Back to the demo household"); });
    const ro = $("#rerunonb"); if (ro) ro.addEventListener("click", () => startOnboarding(true));
    bindCommon(v);
  }

  // ---------- drawers ----------
  let lastFocus = null;
  function openDrawer(html) {
    if (!$("#drawer").classList.contains("on")) lastFocus = document.activeElement;
    const d = $("#drawer"); d.innerHTML = `<div class="grab" id="grab"></div><button class="close" id="dclose" aria-label="Close">${ico("i-x")}</button>${html}`;
    d.classList.add("on"); $("#scrim").classList.add("on"); d.scrollTop = 0;
    $("#dclose").addEventListener("click", closeDrawer); bindCommon(d); bindTables(d);
    const g = $("#grab"); let y0 = null;
    g.addEventListener("pointerdown", (e) => { y0 = e.clientY; d.classList.add("dragging"); g.setPointerCapture(e.pointerId); });
    g.addEventListener("pointermove", (e) => { if (y0 == null) return; const dy = Math.max(0, e.clientY - y0); d.style.transform = `translateY(${dy}px)`; });
    const end = (e) => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; d.classList.remove("dragging"); d.style.transform = ""; if (dy > 110) closeDrawer(); };
    g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
    $("#app").setAttribute("aria-hidden", "true"); $("header.top").setAttribute("aria-hidden", "true");
    const first = d.querySelector("input, select, button:not(.close)"); setTimeout(() => (first || $("#dclose")).focus({ preventScroll: true }), 60);
    buzz(5);
  }
  function closeDrawer() {
    const was = $("#drawer").classList.contains("on");
    $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); $("#app").removeAttribute("aria-hidden"); $("header.top").removeAttribute("aria-hidden");
    if (was && lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }
  const h2 = (t, s) => `<h2>${esc(t)}</h2>${s ? `<p class="sub">${s}</p>` : ""}`;
  function openTx(id) { openEntry(id); }
  function openEntry(id) {
    const m = S.m, e = m.entryById[id]; if (!e) return; const t = m.tx.find((x) => x.id === id);
    const acct = m.acctById[e.acct], cat = m.catById[e.cat]; const name = Kit.nameOf(e); const c = ctx();
    const series = t ? E.merchantSeries(m, t.merchant, 12) : []; const others = t ? m.tx.filter((x) => x.merchant === t.merchant && x.id !== t.id).slice(0, 8) : [];
    const total12 = series.reduce((a, s) => a + s.v, 0); const canJudge = canWriteSheet() || S.mode !== "live"; const rv = review(); const item = rv.items.find((i) => i.id === id);
    const mates = e.flow === "Transfer" && !e.transferId && !e.matchedWith ? E.transferMates(m, e).slice(0, 4) : [];
    const decs = (e.decisions || []).slice().sort((a, b) => (a.at < b.at ? 1 : -1));
    openDrawer(`<div style="display:flex;gap:14px;align-items:center;margin-top:4px">${Kit.monogram(e, c, "lg")}<div style="min-width:0"><h2 style="margin:0">${e.kind === "trade" ? Kit.title(e, c) : esc(name)}</h2><p class="sub">${E.weekday(e.date)} ${E.fmtDay(e.date, { year: true })}${e.kind !== "transaction" ? ` · ${Kit.subtitle(e, c)}` : ""}</p></div></div>
      <p style="font-family:var(--display);font-size:40px;font-weight:800;letter-spacing:-.03em;margin:10px 0 2px" class="num ${e.amount > 0 && e.kind !== "valuation" ? "amt in" : ""}">${e.kind === "valuation" ? fmt0(e.amount) : (e.amount > 0 ? "+" : "−") + fmt(Math.abs(e.amount))}</p>
      <div class="chips" style="margin:8px 0 4px">${e.kind === "transaction" ? `<button class="tag" data-pickfor="${esc(e.id)}" style="--ch:${esc(E.catHue(e.cat, m))};background:color-mix(in srgb,var(--ch) 16%,var(--surface));color:color-mix(in oklab,var(--ch) 58%,var(--ink))" ${canJudge ? "" : "disabled"}>${ico("i-" + E.catIcon(e.cat, m))} ${esc(cat ? cat.name : "Uncategorised")}${canJudge ? " ✎" : ""}</button><span class="tag">${esc(cat ? cat.group : "")}</span>` : ""}${e.person && e.person !== "Joint" ? `<span class="tag">${esc(e.person)}</span>` : ""}${e.receipt ? `<span class="tag ${e.receipt === "Y" ? "good" : "warn"}">receipt ${e.receipt === "Y" ? "held" : "missing"}</span>` : ""}${cat && cat.tax ? `<span class="tag amber">${esc(cat.tax)}</span>` : ""}${e.status !== "settled" ? `<span class="tag">${esc(e.status)}</span>` : ""}${Kit.badges(e, c)}</div>
      <dl class="kv">${e.raw ? `<dt>Bank said</dt><dd><code style="font-size:12.5px">${esc(e.raw)}</code>${e.mer ? ` <span class="sub">· ${e.mer.source === "rule" ? `rule ${esc(e.mer.rule.id)}` : e.mer.source === "dictionary" ? "merchant dictionary" : "no rule knows this descriptor"}</span>` : ""}</dd>` : ""}<dt>Account</dt><dd>${acct ? `${esc(acct.name)}${acct.bank ? ` · ${esc(acct.bank)}` : ""}` : esc(e.acct)}</dd>${e.transferAcct ? `<dt>Other side</dt><dd>${esc((m.acctById[e.transferAcct] || {}).name || e.transferAcct)}${e.transferId ? ` · ${esc(e.transferId)}` : ""}</dd>` : ""}<dt>Row</dt><dd>${esc(e.id)} on the ${m.sheetVersion >= 2 ? "Entries" : "Transactions"} tab${S.grids && entryRowNumber(e.id) ? `, row ${entryRowNumber(e.id)}` : ""}</dd>${e.note ? `<dt>Note</dt><dd>${esc(e.note)}</dd>` : ""}${e.source ? `<dt>Source</dt><dd>${esc(e.source)}</dd>` : ""}${e.units != null ? `<dt>Units</dt><dd>${esc(e.units)} at ${fmt(e.price)}</dd>` : ""}${cat && cat.ato ? `<dt>Tax return</dt><dd>${esc(cat.ato)}</dd>` : ""}${cat && cat.budget ? `<dt>Budget</dt><dd>${fmt0(cat.budget)} a month for ${esc(cat.name)}</dd>` : ""}${e.split && e.split.length ? `<dt>Split</dt><dd>${e.split.map((p) => `${esc(catName(p.cat))} ${fmt(p.amount)}`).join(" · ")}</dd>` : ""}${e.dupOf ? `<dt>Merged</dt><dd>into ${esc(e.dupOf)}</dd>` : ""}${e.matchedWith ? `<dt>Matched</dt><dd>with ${esc(e.matchedWith)}</dd>` : ""}</dl>
      ${item ? `<div class="note accent" style="margin-bottom:8px">${ico("i-review")} ${esc(E.cap(item.why))}</div>` : ""}
      ${e.kind === "transaction" && canJudge ? `<div class="dacts"><button class="btn sm ghost" data-act="cat">${ico("i-edit")} Categorise</button>${!e.reviewed ? `<button class="btn sm ghost" data-act="confirm">${ico("i-check")} Looks right</button>` : ""}<button class="btn sm ghost" data-act="split">${ico("i-split")} Split</button>${item && item.dupOf ? `<button class="btn sm ghost" data-act="merge">${ico("i-duplicate")} Merge into ${esc(item.dupOf)}</button>` : ""}${E.discretionary(e, m) && !e.worth ? `<span class="wbtns" style="margin-left:4px">${[["yes", "Worth it"], ["meh", "Meh"], ["no", "Not worth it"]].map(([v, l]) => `<button class="chip w-${v}" data-act="worth" data-v="${v}">${l}</button>`).join("")}</span>` : ""}</div>${mates.length ? `<h3>Could be the other side of</h3><div class="chips">${mates.map((x) => `<button class="chip" data-act="mate" data-mate="${esc(x.id)}">${ico("i-transfer")} ${esc((m.acctById[x.acct] || {}).name || x.acct)} · ${E.fmtDay(x.date)} · ${esc(x.id)}</button>`).join("")}</div>` : ""}` : ""}
      ${decs.length ? `<h3>Decisions on this row</h3><div class="dlist">${decs.map((d) => `<div class="d"><b>${esc(d.decision.replace(/_/g, " "))}</b><span>${esc(d.value)}</span><span class="muted">· ${esc(d.by || "")} ${d.at ? E.fmtDay(d.at, { year: true }) : ""}${d.note ? ` · ${esc(d.note)}` : ""}</span></div>`).join("")}</div>` : ""}
      ${total12 > 0 && e.flow === "Expense" ? `<h3>${esc(name)}, last 12 months</h3><div style="display:flex;gap:14px;align-items:center">${sparkSVG(series.map((s) => s.v), 160, 44, "var(--accent)")}<div><b class="num">${fmt0(total12)}</b> <span class="sub">in 12 months · ${fmt0(total12 / 12)} a month</span></div></div>` : ""}
      ${others.length ? `<h3>Other times</h3>${others.map((x) => txRow(x, { date: true, acct: false })).join("")}` : ""}
      ${t ? `<div style="margin-top:14px"><button class="btn ghost sm" data-merchant="${esc(t.merchant)}">Everything from ${esc(t.merchant)}</button></div>` : ""}`);
    $$("[data-pickfor]").forEach((b) => b.addEventListener("click", () => openCategoryPicker(b.dataset.pickfor)));
    $$("#drawer [data-act]").forEach((b) => b.addEventListener("click", () => { const a = b.dataset.act; if (a === "cat") openCategoryPicker(id); else if (a === "split") openSplitEditor(id); else { closeDrawer(); if (a === "confirm") confirmEntry(id); else if (a === "merge") mergeDup(id, item.dupOf); else if (a === "mate") matchTransfer(id, b.dataset.mate); else if (a === "worth") worthIt(id, b.dataset.v).then(() => toast(`Noted. ${judgedWhere()}`)); } }));
  }
  function openMerchant(name) {
    const m = S.m; const rows = m.tx.filter((t) => t.merchant === name); const series = E.merchantSeries(m, name, 12);
    const total12 = series.reduce((a, s) => a + s.v, 0);
    openDrawer(`${h2(name, `${rows.length} transactions · ${fmt0(total12)} in the last 12 months`)}${total12 > 0 ? `<div style="margin:8px 0">${sparkSVG(series.map((s) => s.v), 320, 60, "var(--accent)")}</div>` : ""}${rows.slice(0, 60).map((t) => txRow(t, { date: true })).join("")}`);
  }
  function openCategory(cat, w) {
    const m = S.m, c = m.catById[cat] || { name: cat, group: "" }; w = w || period();
    const rows = m.tx.filter((t) => t.cat === cat && E.inWin(t, w)); const sp = E.spend(m.tx, w, (t) => t.cat === cat);
    const series = E.monthly(m, 12).map((mo) => ({ month: mo.month, v: E.spend(m.tx, mo, (t) => t.cat === cat).out }));
    const b = m.budget.find((x) => x.name === c.name); const months = Math.max(1, E.monthsBetween(w.from, w.to) + 1);
    openDrawer(`<div style="display:flex;gap:12px;align-items:center;margin-top:4px">${catDisc(cat, "lg")}<div><h2 style="margin:0">${esc(c.name)}</h2><p class="sub">${esc(c.group)} · ${esc(w.label)}</p></div></div>
      <p style="font-family:var(--display);font-size:36px;font-weight:800;letter-spacing:-.03em;margin:10px 0 2px" class="num">${fmt0(sp.out)}<span class="sub" style="font-size:14px;font-family:var(--body);font-weight:600;letter-spacing:0"> · ${fmt0(sp.out / months)} a month</span></p>
      ${b ? `<div class="note" style="margin:8px 0">Budget <b>${fmt0(b.monthly)}</b> a month · this year <b>${ofText(b.ytd, b.toDate)}</b>, ${(b.left || 0) < 0 ? `${fmt0(-b.left)} over` : `${fmt0(b.left)} left`} <span class="tag ${/over/i.test(b.status) ? "warn" : /watch/i.test(b.status) ? "amber" : "good"}">${esc(b.status)}</span></div>` : ""}
      ${c.tax ? `<div class="note" style="margin:8px 0">Tax: ${esc(c.tax)}${c.ato ? ` · ${esc(c.ato)}` : ""}</div>` : ""}
      <h3>By month</h3>${sparkSVG(series.map((s) => s.v), 320, 60, "var(--accent)")}
      <h3>Who you paid</h3>${barsHTML(sp.byMerchant.slice(0, 6).map(([k, v]) => ({ k, v, go: "merchant:" + k })))}
      <h3>${rows.length} transactions</h3>${rows.slice(0, 80).map((t) => txRow(t, { date: true })).join("") || '<div class="empty">None in this period.</div>'}`);
  }
  function openGoal(name) {
    const m = S.m, g = m.goals.find((x) => x.name === name); if (!g) return; const acct = m.acctById[g.acct]; const eta = E.goalEta(g, 0, m.asOf);
    const ins = m.tx.filter((t) => t.acct === g.acct && t.amount > 0).slice(0, 10);
    openDrawer(`${h2(`${E.goalIcon(g.name)} ${g.name}`, `${esc(acct ? acct.name + " · " + acct.bank : g.acct)}`)}
      <div style="display:flex;gap:18px;align-items:center;margin:12px 0">${ringSVG(g.progress, E.goalColor(g.name), ofFmt(g.balance || 0), `of ${ofFmt(g.target || 0)}`, 120)}<div><p><b class="num" style="font-family:var(--display);font-size:22px">${toGo(g.balance, g.target) === "done" ? "Target met" : toGo(g.balance, g.target)}</b></p><p class="sub">${g.date ? `Target ${E.fmtDay(g.date, { year: true })} · ${g.monthsLeft} month${g.monthsLeft === 1 ? "" : "s"} left` : "No target date"}</p></div></div>
      <dl class="kv"><dt>Needed</dt><dd><b>${fmt0(g.needPm)}</b> a month to hit the date</dd><dt>Going in</dt><dd><b>${fmt0(g.savedPm)}</b> a month, last 3 months</dd><dt>At this pace</dt><dd>${g.status === "Reached" ? "Reached" : eta.date ? `${E.fmtMonth(eta.date)}${eta.late ? `, after the target` : ", before the target"}` : "won't get there without deposits"}</dd><dt>Status</dt><dd><span class="tag ${g.status === "Behind" ? "warn" : g.status === "Reached" ? "lime" : "good"}">${esc(g.status)}</span> (the sheet's word)</dd></dl>
      ${canWriteSheet() || S.mode !== "live" ? `<button class="btn sm" data-editgoal2="${esc(g.name)}">Change target or date</button>` : ""}
      ${ins.length ? `<h3>Recent deposits</h3>${ins.map((t) => txRow(t, { date: true, acct: false })).join("")}` : ""}`);
    $$("[data-editgoal2]").forEach((b) => b.addEventListener("click", () => openGoalEditor(g)));
    if (g.status === "Reached") celebrate();
  }
  function openSub(service) {
    const m = S.m, s = m.subs.find((x) => x.service === service); if (!s) return;
    const charges = m.tx.filter((t) => t.merchant === s.merchant).slice(0, 12); const series = E.merchantSeries(m, s.merchant, 12);
    const row = S.grids ? (S.grids.subscriptions || []).findIndex((r) => r && r[0] === service) + 1 : 0;
    openDrawer(`<div style="display:flex;gap:12px;align-items:center;margin-top:4px"><span class="ava lg" style="${catSwatch(s.cat)}">${esc(initials(s.service))}</span><div><h2 style="margin:0">${esc(s.service)}</h2><p class="sub">${esc(s.cadence)} · ${esc(s.owner)} · <span class="tag ${/still charging/i.test(s.flag) ? "warn" : /unused|never/i.test(s.flag) ? "amber" : /cancelled/i.test(s.flag) ? "" : "good"}">${esc(s.flag)}</span></p></div></div>
      <p style="font-family:var(--display);font-size:36px;font-weight:800;letter-spacing:-.03em;margin:10px 0 2px" class="num">${fmt(s.latest)}<span class="sub" style="font-size:14px;font-family:var(--body);font-weight:600;letter-spacing:0"> ${String(s.cadence).toLowerCase() === "annual" ? "a year" : "a month"} · ${fmt0(s.annual)} a year</span></p>
      <dl class="kv"><dt>Last charged</dt><dd>${E.fmtDay(s.lastCharged, { year: true })}</dd><dt>Next charge</dt><dd>${(() => { const d = E.nextCharge(s, m.asOf); return d ? `${E.fmtDay(d, { year: true })} · ${E.rel(m.asOf, d)}` : "—"; })()}</dd><dt>Last used</dt><dd>${s.lastUsed ? `${E.fmtDay(s.lastUsed, { year: true })} · ${s.daysSince} days ago` : esc(s.lastUsedRaw || "not tracked")}</dd>${s.riseEach ? `<dt>Price rise</dt><dd>${fmt(s.lowest)} → ${fmt(s.latest)} a charge · ${fmt0(s.riseYear)} a year more</dd>` : ""}<dt>Decision</dt><dd><b>${esc(s.decision || "none yet")}</b> <span class="sub">(the Subscriptions tab's word)</span></dd></dl>
      ${canWriteSheet() && row > 1 ? `<div class="note accent"><b>Record a decision in the sheet</b><div class="chips" style="margin-top:8px">${["Keep", "Review", "Cancel"].map((d) => `<button class="chip" data-decide="${d}" aria-pressed="${s.decision === d}">${d}</button>`).join("")}</div></div>` : ""}
      <h3>Charges</h3>${sparkSVG(series.map((x) => x.v), 320, 56, "var(--accent)")}${charges.map((t) => txRow(t, { date: true, acct: false })).join("") || '<div class="empty">No charges found under this merchant name.</div>'}`);
    $$("[data-decide]").forEach((b) => b.addEventListener("click", async () => { try { await writeCells(`Subscriptions!G${row}`, [[b.dataset.decide]]); toast(`${s.service}: ${b.dataset.decide}, written to the sheet`); await loadLive(true); openSub(service); } catch (e) { toast("Couldn't write: " + errText(e, "Subscriptions")); } }));
  }
  function openCheck(name) {
    const m = S.m, c = m.checks.find((x) => x.name === name); if (!c) return;
    const map = { "Work expenses without a receipt": (t) => /^WORK-/.test(t.cat) && t.receipt !== "Y", "Work equipment over the immediate-deduction limit": (t) => t.cat === "WORK-EQUIP" && Math.abs(t.amount) > 300, "Large rental repairs": (t) => t.cat === "RENT-REPAIR" && Math.abs(t.amount) >= 5000, "Donations without a receipt": (t) => t.cat === "DONATION" && t.receipt !== "Y", "Uncategorised transactions": (t) => t.cat === "UNCAT", "Card interest charged (last 12 months)": (t) => t.cat === "FEES" && /interest/i.test(t.desc) };
    const f = map[name]; const rows = f ? m.tx.filter(f) : [];
    openDrawer(`${h2(c.name, `${esc(c.type)} check · <span class="tag ${c.status === "OK" ? "good" : c.status === "Review" ? "amber" : ""}">${esc(c.status)}</span> · ${c.items} item${c.items === 1 ? "" : "s"}${c.amount ? ` · ${fmt0(c.amount)}` : ""}`)}
      <p style="margin-top:10px">${esc(c.why)}</p><p class="sub" style="margin-top:6px">Where to look: ${esc(c.where)}</p>
      ${rows.length ? `<h3>The rows</h3>${rows.slice(0, 20).map((t) => txRow(t, { date: true })).join("")}` : ""}
      <p class="sub" style="margin-top:12px">Fixing it means a new row or a changed cell in the sheet (a receipt mark, a category), never an edit here.</p>`);
  }
  function openDupes() {
    const m = S.m; const seen = new Map(), pairs = [];
    for (const t of m.tx) { if (t.flow !== "Expense") continue; const k = `${t.date}|${t.acct}|${t.merchant}|${t.amount}`; if (seen.has(k)) pairs.push([seen.get(k), t]); else seen.set(k, t); }
    openDrawer(`${h2("Charges that look doubled", "Same merchant, amount, account and day. Usually worth a dispute, sometimes two real coffees.")}${pairs.map(([a, b]) => `<div class="note" style="margin-top:10px"><b>${esc(a.merchant)}</b> · ${E.fmtDay(a.date, { year: true })} · ${fmt(-a.amount)} twice${txRow(a, { acct: false })}${txRow(b, { acct: false })}</div>`).join("") || '<div class="empty">None found.</div>'}`);
  }
  function openChecks() {
    const m = S.m;
    openDrawer(`${h2("The sheet's checks", "Tax and data-quality checks over the raw rows, run by the Compliance Checks tab.")}<div style="margin-top:10px">${m.checks.map((c) => `<button class="row" data-open="check:${esc(c.name)}"><span class="tag ${c.status === "OK" ? "good" : c.status === "Review" ? "amber" : ""}" style="min-width:64px;justify-content:center">${esc(c.status)}</span><span class="mid"><span class="t" style="white-space:normal">${esc(c.name)}</span><span class="s">${esc(c.type)}${c.items ? ` · ${c.items} item${c.items === 1 ? "" : "s"}` : ""}${c.amount ? ` · ${fmt0(c.amount)}` : ""}</span></span>${ico("i-chev", "chev")}</button>`).join("")}</div>`);
  }
  function openSubs() {
    const m = S.m; const groups = [["Still charging after cancel", (s) => /still charging/i.test(s.flag)], ["Unused", (s) => /unused|never/i.test(s.flag) && !/still/i.test(s.flag)], ["In use", (s) => /in use/i.test(s.flag)], ["Cancelled", (s) => /^cancelled/i.test(s.flag)]];
    openDrawer(`${h2("Subscriptions and bills", `${m.subs.length} tracked on the Subscriptions tab · usage, price and decision live there`)}${groups.map(([t, f]) => { const xs = m.subs.filter(f); return xs.length ? `<h3>${t} · ${fmt0(xs.reduce((a, s) => a + (s.annual || 0), 0))} a year</h3>${xs.map((s) => subRow(s, /still/i.test(s.flag) ? "warn" : /unused|never/i.test(s.flag) ? "amber" : "", `${esc(s.cadence)} · last charged ${E.fmtDay(s.lastCharged)}${s.decision ? ` · decision: ${esc(s.decision)}` : ""}`)).join("")}` : ""; }).join("")}`);
  }
  function openUpcoming() {
    const m = S.m; const up = E.upcoming(m); const ahead = E.num(m.kitty.look_ahead_days) || 35; const out = up.filter((u) => u.amount != null && u.amount < 0).reduce((a, u) => a - u.amount, 0), inc = up.filter((u) => u.amount > 0).reduce((a, u) => a + u.amount, 0);
    openDrawer(`${h2(`The next ${ahead} days`, `${fmt0(out)} going out · ${fmt0(inc)} coming in, from the Subscriptions, Loans and Payslips tabs`)}<div class="uplist" style="margin-top:10px">${up.map(upHTML).join("")}</div><p class="sub" style="margin-top:10px">Next charges roll forward from each bill's last charge at its cadence; pay days from the last payslip. Nothing here is a prediction of the amount, only of the date.</p>`);
  }
  function openNeeds() { const nd = E.needs(S.m); openDrawer(`${h2(nd.verdict, nd.line)}<div class="nlist" style="margin-top:10px;grid-template-columns:1fr">${nd.all.map(needHTML).join("")}</div>`); }
  function openLoan(id) { const l = S.m.loans.find((x) => x.id === id); if (!l) return; openDrawer(`${h2(l.name, `${esc(l.lender)} · ${esc(l.type)} · ${esc(l.purpose)}`)}<dl class="kv"><dt>Balance</dt><dd><b>${fmt0(l.balance)}</b></dd><dt>Rate</dt><dd>${E.fmtPct(l.rate, 2)}</dd><dt>Repayment</dt><dd>${fmt0(l.repayment)} a month</dd><dt>Ends</dt><dd>${E.fmtDay(l.end, { year: true })} · ${l.monthsLeft} months</dd>${l.offset ? `<dt>Offset</dt><dd>${esc((S.m.acctById[l.offset] || {}).name || l.offset)} · ${fmt0((S.m.acctById[l.offset] || {}).balance)}</dd>` : ""}</dl><button class="btn ghost sm" data-go="insights">Rate and extra-repayment scenarios</button>`); }
  function openPay(person) { const m = S.m; const p = E.payday(m).find((x) => x.person === person); const slips = m.payslips.filter((x) => x.person === person).slice(-6).reverse(); openDrawer(`${h2(`${person}'s pay`, p ? `${esc(p.employer)} · next ${E.fmtDay(p.next, { year: true })} (${E.rel(m.asOf, p.next)})` : "")}<h3>Recent payslips</h3><div class="tablewrap"><table class="t"><thead><tr><th>Paid</th><th class="n">Gross</th><th class="n">Tax</th><th class="n">Super</th><th class="n">Net</th></tr></thead><tbody>${slips.map((s) => `<tr><td>${E.fmtDay(s.date, { year: true })}</td><td class="n">${fmt0(s.gross)}</td><td class="n">${fmt0(s.tax)}</td><td class="n">${fmt0(s.super)}</td><td class="n"><b>${fmt0(s.net)}</b></td></tr>`).join("")}</tbody></table></div>`); }
  function openTrust() {
    const m = S.m; const rec = E.reconcile(m);
    const tabs = S.mode === "live" ? Object.entries(RANGES).map(([k, r]) => [k, r.split("!")[0].replace(/'/g, ""), (S.grids[k] || []).length, S.err[k]]) : [["snapshot", "Apps Script JSON", m.tx.length + " transactions", null]];
    const liquid = m.accounts.filter((a) => a.liquid);
    openDrawer(`${h2("Where the numbers come from", S.mode === "live" ? `Live from <a href="https://docs.google.com/spreadsheets/d/${sheetId()}/edit" target="_blank" rel="noopener">${isDemoSheet() ? "the demo sheet" : "your sheet"}</a> through your Google Sheets connector. ${esc(readAgeText())}` : S.mode === "local" ? "A local test copy of the bundled data." : `A bundled snapshot of the fictional Davies household, read from the demo sheet's own script${m.fetchedAt ? ` on ${E.fmtDay(m.fetchedAt.slice(0, 10), { year: true })}` : ""}. The sheet's as-of date is ${E.fmtDay(m.asOf, { year: true })}; the page treats that as today.`)}
      <div class="chips" style="margin:10px 0">${S.mcp ? `<button class="btn sm" id="refreshbtn">${ico("i-refresh")} ${S.mode === "live" ? "Refresh" : "Read the sheet live"}</button>` : ""}${S.mode === "live" && SNAP ? `<button class="btn sm ghost" id="demobtn">Show the bundled snapshot instead</button>` : ""}</div>
      ${S.liveErr ? `<div class="secterr">${errText(S.liveErr)}</div>` : ""}
      <h3>Cash and offset, account by account</h3><div class="tablewrap"><table class="t"><thead><tr><th>Account</th><th>Bank</th><th class="n">Balance</th></tr></thead><tbody>${liquid.map((a) => `<tr><td>${esc(a.name)}</td><td class="muted">${esc(a.bank)}</td><td class="n">${fmt(a.balance)}</td></tr>`).join("")}<tr><td><b>Together</b></td><td></td><td class="n"><b>${fmt(liquid.reduce((s, a) => s + a.balance, 0))}</b></td></tr></tbody></table></div>
      <h3>Does the page agree with the sheet?</h3><p class="sub">${rec.filter((r) => r.account).length ? `${rec.filter((r) => r.account && r.ok).length} of ${rec.filter((r) => r.account).length} accounts reconcile to the sheet at ${E.fmtDay(m.asOf, { year: true })}${m.sheetVersion >= 2 ? "; the ledger's own invariants follow" : ""}.` : ""}</p>${rec.map((r) => `<div class="row" style="cursor:default"><span class="tick" style="${r.ok ? "" : "background:var(--warn)"}">${ico(r.ok ? "i-check" : "i-x")}</span><span class="mid"><span class="t" style="white-space:normal">${esc(r.what)}</span><span class="s">${r.count ? `${r.a} found` : `${fmt(r.a)} here · ${fmt(r.b)} in the sheet`}</span></span></div>`).join("")}
      <h3>What was read</h3><div class="tablewrap"><table class="t"><thead><tr><th>Tab</th><th class="n">Rows</th><th>Feeds</th></tr></thead><tbody>${tabs.map(([k, name, n, err]) => `<tr><td>${esc(name)}</td><td class="n">${err ? (OPTIONAL.has(k) ? `<span class="tag">not in this sheet</span>` : `<span class="tag warn">error</span>`) : esc(String(n))}</td><td class="muted">${esc({ settings: "as-of date, targets", accounts: "every store of value", category_list: "names, groups, budgets", goals: "Goals, Home", subscriptions: "bills, leaks, upcoming", loans: "loan card, upcoming", assets: "the rental", metrics: "hero facts, tax", compliance: "what needs you", networth: "net worth chart", cashflow: "12-month bars, kept", budget: "budget pace", savings: "ways to save", mortgage: "rate scenarios", tax: "tax card", transactions: "activity, jar, flow, search", payslips: "pay day", kitty: "your settings", entries: "the ledger: balances, transfers", balances: "balance by month, the oracle", contracts: "subscriptions, leases, loan terms", decisions: "your judgments: review, worth it", rules: "descriptor to merchant and category; the cookie adds rows here", snapshot: "everything" }[k] || "")}</td></tr>`).join("")}</tbody></table></div>
      <p class="sub" style="margin-top:12px">Nothing is cached in the sheet and nothing is stored by this page except your own preferences${S.dbDoc ? " (on this device and in your Claude account)" : " (on this device)"}.</p>`);
    const rb = $("#refreshbtn"); if (rb) rb.addEventListener("click", async () => { rb.disabled = true; const ok = await loadLive(true); toast(ok ? "Fresh read done" : "Couldn't read live: " + errText(S.liveErr || {})); if (ok) openTrust(); else rb.disabled = false; });
    const db = $("#demobtn"); if (db) db.addEventListener("click", () => { setModel(demoModel()); S.mode = "demo"; renderAll(); openTrust(); });
  }
  // ----- editors: the three writes the page is allowed -----
  function localGoalRecalc(g, mm) { const m = mm || S.m; g.progress = g.target ? Math.min(1, (g.balance || 0) / g.target) : 0; g.monthsLeft = g.date && g.date > m.asOf ? E.monthsBetween(m.asOf, g.date) : 0; g.needPm = g.monthsLeft ? Math.max(0, g.target - (g.balance || 0)) / g.monthsLeft : Math.max(0, g.target - (g.balance || 0)); g.status = (g.balance || 0) >= g.target ? "Reached" : (g.savedPm || 0) >= g.needPm ? "On track" : "Behind"; }
  function openGoalEditor(g) {
    const m = S.m; const savers = m.accounts.filter((a) => a.type !== "Credit card" && a.liquid);
    openDrawer(`${h2(g ? `Change ${g.name}` : "A new goal", g ? "The target and date live on the Goals tab; the sheet recomputes pace from them." : "One row on the Goals tab, linked to the account the money sits in.")}
      <div class="field" style="margin-top:12px"><label for="gname">Name</label><input id="gname" class="plain" value="${esc(g ? g.name : "")}" ${g ? "readonly" : ""} placeholder="Europe 2028"></div>
      <div class="fields2" style="margin-top:10px"><div class="field"><label for="gtarget">Target (${esc(E.currency)})</label><input id="gtarget" type="number" inputmode="decimal" min="0" step="100" value="${g ? g.target : ""}" placeholder="12000"></div><div class="field"><label for="gdate">By</label><input id="gdate" type="date" value="${g ? g.date : ""}"></div></div>
      <div class="field" style="margin-top:10px"><label for="gacct">Money sits in</label><select id="gacct">${savers.map((a) => `<option value="${esc(a.id)}" ${g && g.acct === a.id ? "selected" : ""}>${esc(a.name)} · ${fmt0(a.balance)}</option>`).join("")}</select></div>
      <p class="sub" style="margin-top:10px">${canWriteSheet() ? `Saving writes ${g ? `row ${g.row} of` : "a new row to"} the Goals tab in the sheet, with the sheet's own formulas, then rereads it.` : S.mode === "live" ? "This sheet is read-only for you, so the change stays on this device." : "In the demo the change stays on this device; the sheet is untouched."}</p>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn" id="gsave">${canWriteSheet() ? "Write to the sheet" : "Save here"}</button><button class="btn ghost" id="gcancel">Cancel</button></div>`);
    $$(".drawer .field input, .drawer .field select").forEach((i) => { i.style.cssText = "background:var(--surface);border:2px solid var(--line);color:var(--ink);font-size:16px"; });
    $("#gcancel").addEventListener("click", closeDrawer);
    $("#gsave").addEventListener("click", async () => {
      const name = $("#gname").value.trim(), target = +$("#gtarget").value, date = $("#gdate").value, acct = $("#gacct").value;
      if (!name || !(target > 0) || !date) { toast("A name, a target and a date, please"); return; }
      const btn = $("#gsave"); btn.disabled = true;
      if (canWriteSheet()) {
        try {
          const r = g ? g.row : m.goals.length + 2;
          const rows = g ? [[target, date]] : [[name, target, date, acct, `=IFERROR(VLOOKUP(D${r},Accounts!$A:$H,8,FALSE),0)`, `=IF(B${r}=0,0,MIN(1,E${r}/B${r}))`, `=IF(C${r}<=Settings!$B$6,0,DATEDIF(Settings!$B$6,C${r},"M"))`, `=IF(G${r}=0,MAX(0,B${r}-E${r}),MAX(0,B${r}-E${r})/G${r})`, `=SUMIFS(Transactions!$F:$F,Transactions!$C:$C,D${r},Transactions!$B:$B,">"&EDATE(Settings!$B$6,-3),Transactions!$B:$B,"<="&Settings!$B$6)/3`, `=IF(E${r}>=B${r},"Reached",IF(I${r}>=H${r},"On track","Behind"))`]];
          await writeCells(g ? `Goals!B${r}:C${r}` : `Goals!A${r}:J${r}`, rows);
          toast(g ? `${name} updated in the sheet` : `${name} added to the Goals tab`); closeDrawer(); await loadLive(true); switchTab("goals");
        } catch (e) { btn.disabled = false; toast("Couldn't write: " + errText(e, "Goals")); }
        return;
      }
      if (g) { const ed = { ...(S.prefs.goalEdits || {}) }; ed[g.name] = { target, date, acct }; savePrefs({ goalEdits: ed }); }
      else { savePrefs({ localGoals: (S.prefs.localGoals || []).concat([{ name, target, date, acct }]), leadGoal: name }); }
      applyLocalGoals(m); toast(`Saved on this device${S.mode === "demo" ? " (demo sheet untouched)" : ""}`); closeDrawer(); renderAll(); switchTab("goals");
    });
  }
  function openSafetyEditor() {
    const m = S.m, sf = E.safety(m); const label = "Emergency fund target (months of essential spending)";
    openDrawer(`${h2("Safety net target", "Months of essential spending you want in cash and offset. The sheet's emergency metric and the Home verdict both read it.")}
      <div class="slide" style="margin-top:14px"><div class="val num"><span id="sfv">${sf.target}</span><small>months</small></div><input id="sfr" type="range" min="1" max="12" step="1" value="${sf.target}" aria-label="Months of safety net"><div class="marks"><span>1</span><span>3</span><span>6</span><span>9</span><span>12</span></div><p class="sub" id="sft"></p></div>
      <div style="display:flex;gap:10px;margin-top:14px"><button class="btn" id="sfsave">${canWriteSheet() ? "Write to Settings" : "Save here"}</button><button class="btn ghost" id="sfcancel">Cancel</button></div>`);
    const r = $("#sfr"), upd = () => { const t = +r.value; $("#sfv").textContent = t; $("#sft").textContent = sf.months != null && sf.essentialPm ? (sf.months >= t ? `Covered: cash would last ${sf.months.toFixed(1)} months.` : `About ${fmtS((t - sf.months) * sf.essentialPm)} more in cash would reach ${t} months.`) : ""; }; r.addEventListener("input", upd); upd();
    $("#sfcancel").addEventListener("click", closeDrawer);
    $("#sfsave").addEventListener("click", async () => { const t = +r.value; if (canWriteSheet()) { const row = rowOf(S.settingsRows, label); if (!row) { toast("Couldn't find the setting's row in the sheet"); return; } try { await writeCells(`Settings!B${row}`, [[t]]); toast(`Safety net target: ${t} months, written to Settings`); closeDrawer(); await loadLive(true); } catch (e) { toast("Couldn't write: " + errText(e, "Settings")); } } else { m.settings[label] = t; savePrefs({ safetyMonths: t }); toast("Saved on this device"); closeDrawer(); renderAll(); } });
  }

  // ---------- Ask the Kitty (the sample capability, with the engine as its tools) ----------
  const TOOLS = () => {
    const m = S.m;
    const win = (from, to) => ({ from: from || E.window("month", m.asOf).from, to: to || m.asOf });
    return [
      { name: "spending", description: "Spending and income between two dates (YYYY-MM-DD), excluding transfers; totals by category, group and merchant. Optional category id or name, person (Jordan, Mia, Joint).", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, category: { type: "string" }, person: { type: "string" } } }, execute: (i) => { const w = win(i.from, i.to); const cat = i.category ? m.cats.find((c) => c.id.toLowerCase() === i.category.toLowerCase() || c.name.toLowerCase() === i.category.toLowerCase() || c.name.toLowerCase().includes(i.category.toLowerCase())) : null; const sp = E.spend(m.tx, w, (t) => (!cat || t.cat === cat.id) && (!i.person || t.person.toLowerCase() === i.person.toLowerCase())); return { from: w.from, to: w.to, category: cat ? cat.name : null, out: Math.round(sp.out), in: Math.round(sp.in), count: sp.count, by_category: sp.byCat.slice(0, 12).map(([c, v]) => [(m.catById[c] || {}).name || c, Math.round(v)]), by_group: sp.byGroup.map(([g, v]) => [g, Math.round(v)]), by_merchant: sp.byMerchant.slice(0, 10).map(([k, v]) => [k, Math.round(v)]) }; } },
      { name: "search_transactions", description: "Find transactions by free text (merchant, description), with the same mini-language as the page: a person name, a month name, >100, <50, cat:groceries. Returns up to 25.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, execute: (i) => E.match(m, i.query).slice(0, 25).map((t) => ({ id: t.id, date: t.date, merchant: t.merchant, amount: t.amount, category: t.catName, person: t.person, account: (m.acctById[t.acct] || {}).name })) },
      { name: "goals", description: "Every savings goal: target, date, balance, progress, needed per month, saved per month and the sheet's status, plus the date at the current pace.", inputSchema: { type: "object", properties: {} }, execute: () => m.goals.map((g) => ({ name: g.name, target: g.target, by: g.date, balance: Math.round(g.balance), progress: Math.round((g.progress || 0) * 100) + "%", needed_per_month: Math.round(g.needPm), saved_per_month: Math.round(g.savedPm), status: g.status, eta_at_current_pace: E.goalEta(g, 0, m.asOf).date })) },
      { name: "subscriptions", description: "Every subscription and bill with cadence, latest price, annual cost, last used, usage flag (In use, Unused, Still charging, Cancelled) and the household's decision.", inputSchema: { type: "object", properties: {} }, execute: () => m.subs.map((s) => ({ service: s.service, owner: s.owner, cadence: s.cadence, latest: s.latest, annual: Math.round(s.annual || 0), last_used: s.lastUsed, flag: s.flag, decision: s.decision, price_rise_per_year: s.riseYear })) },
      { name: "upcoming", description: "Bills, loan repayments, pay days and goal dates in the next N days (default 35).", inputSchema: { type: "object", properties: { days: { type: "number" } } }, execute: (i) => E.upcoming(m, i.days || 35).map((u) => ({ date: u.date, what: u.title, detail: u.sub, amount: u.amount })) },
      { name: "headlines", description: "The sheet's Metrics tab: every headline figure with its comparison, and the safety-net position, net worth, tax refund estimates and what needs attention.", inputSchema: { type: "object", properties: {} }, execute: () => ({ as_of: m.asOf, household: m.householdName, metrics: Object.values(m.metrics).map((x) => ({ id: x.id, label: x.label, value: x.raw, comparison: x.compRaw, compared_with: x.comparedWith })), needs_attention: E.needs(m).all.map((i) => i.t), accounts: m.accounts.map((a) => ({ name: a.name, balance: Math.round(a.balance) })) }) },
      { name: "budget", description: "Budget versus actual this financial year, by category, with the sheet's status (Under, Watch, Over).", inputSchema: { type: "object", properties: {} }, execute: () => m.budget.map((b) => ({ category: b.name, monthly_budget: b.monthly, year_to_date: Math.round(b.ytd || 0), budget_to_date: Math.round(b.toDate || 0), used: Math.round((b.used || 0) * 100) + "%", status: b.status })) },
    ];
  };
  const SUGGEST = ["What did we spend on dining in October?", "Which subscriptions haven't we used?", "When will the Japan trip be funded?", "What are the three best ways to save this month?", "How much did Mia spend on shopping this year?"];
  // the pages an answer may point at; anything else the model invents is dropped before it reaches a button
  const PAGE_GO = { review: "the review queue", dupes: "the doubled charges", checks: "the sheet's checks", subs: "all subscriptions and bills", upcoming: "the next bills and pay days", budget: "budget pace", networth: "net worth", goals: "goals", safety: "the safety net", insights: "insights", trust: "where the numbers come from", activity: "activity" };
  function validGo(go) {
    if (!go || typeof go !== "string") return null; const m = S.m; const i = go.indexOf(":"); const kind = i < 0 ? go : go.slice(0, i), key = i < 0 ? "" : go.slice(i + 1).trim();
    if (PAGE_GO[kind] && !key) return kind;
    if (kind === "entry") return m.entryById && m.entryById[key] ? "entry:" + key : null;
    if (kind === "cat") { const c = m.cats.find((c) => c.id.toLowerCase() === key.toLowerCase() || c.name.toLowerCase() === key.toLowerCase()); return c ? "cat:" + c.id : null; }
    if (kind === "sub") { const x = m.subs.find((x) => x.service.toLowerCase() === key.toLowerCase()); return x ? "sub:" + x.service : null; }
    if (kind === "goal") { const g = m.goals.find((g) => g.name.toLowerCase() === key.toLowerCase()); return g ? "goal:" + g.name : null; }
    if (kind === "merchant") { const t = m.tx.find((t) => t.merchant.toLowerCase() === key.toLowerCase()); return t ? "merchant:" + t.merchant : null; }
    if (kind === "check") { const c = m.checks.find((c) => c.name.toLowerCase() === key.toLowerCase()); return c ? "check:" + c.name : null; }
    return null;
  }
  const TONE = { good: ["good", "Looking good"], mixed: ["amber", "Mostly fine"], warn: ["warn", "Worth a look"] };
  function cardHTML(c) {
    const a = c.card; const facts = (a.facts || []).slice(0, 4), points = (a.points || []).slice(0, 6), actions = (a.actions || []).slice(0, 4);
    const tone = TONE[a.tone] || null;
    return `<div class="plan">
      <div class="plan-top">${tone ? `<span class="tag ${tone[0]}">${tone[1]}</span>` : ""}<h3>${esc(a.headline || "")}</h3>${a.summary ? `<p class="sub">${esc(a.summary)}</p>` : ""}</div>
      ${facts.length ? `<div class="plan-facts">${facts.map((f) => { const go = validGo(f.go); return `<button class="pf" ${go ? `data-go="${esc(go)}"` : "disabled"}><b class="num">${esc(f.value)}</b><span>${esc(f.label)}</span>${f.note ? `<small>${esc(f.note)}</small>` : ""}</button>`; }).join("")}</div>` : ""}
      ${points.length ? `<ul class="plan-points">${points.map((p) => { const go = validGo(p.go); return `<li>${go ? `<button class="pp" data-go="${esc(go)}">` : `<div class="pp">`}<span class="txt">${esc(p.text)}</span>${p.amount ? `<b class="num">${esc(p.amount)}</b>` : ""}${go ? ico("i-chev") : ""}${go ? "</button>" : "</div>"}</li>`; }).join("")}</ul>` : ""}
      ${actions.length ? `<div class="plan-actions">${actions.map((x) => { const go = validGo(x.go); return `<button class="btn sm ghost" ${go ? `data-go="${esc(go)}"` : "disabled"}>${esc(x.label)}${x.impact ? `<em>${esc(x.impact)}</em>` : ""}</button>`; }).join("")}</div>` : ""}
      ${a.novel ? `<div class="plan-novel"><span class="em" aria-hidden="true">💡</span><span>${esc(a.novel)}</span></div>` : ""}
      <div class="plan-foot">${c.receipts && c.receipts.length ? `Looked at ${esc(c.receipts.join(" · "))}.` : ""}${a.caveat ? ` ${esc(a.caveat)}` : ""}</div>
    </div>`;
  }
  function msgHTML(c, isLast) {
    if (c.role === "user") return `<div class="msg me">${esc(c.text)}</div>`;
    if (c.card) return `<div class="msg kit card">${cardHTML(c)}</div>${isLast && c.card.followups && c.card.followups.length ? `<div class="sugg">${c.card.followups.slice(0, 3).map((q) => `<button class="chip" data-sugg="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}`;
    if (!c.text) return `<div class="msg kit thinking">${esc(c.status || "Thinking")}${c.steps && c.steps.length ? `<span class="steps">${esc(c.steps.join(" · "))}</span>` : ""}</div>`;
    return `<div class="msg kit">${esc(c.text)}</div>`;
  }
  function openAsk() {
    openDrawer(`${h2("Ask the Kitty", `Claude answers from the numbers on this page, with your consent, and keeps nothing between questions. Today is ${E.fmtDay(S.m.asOf, { year: true })} for the household.`)}
      <div class="ask" style="margin-top:12px"><div class="msgs" id="msgs">${S.chat.map((c, i) => msgHTML(c, i === S.chat.length - 1)).join("") || `<div class="sugg">${SUGGEST.map((s) => `<button class="chip" data-sugg="${esc(s)}">${esc(s)}</button>`).join("")}</div>`}</div>
      <div class="askrow"><div class="searchbox">${ico("i-spark")}<input id="askq" type="text" placeholder="Ask about the money…" autocomplete="off" aria-label="Your question"></div><button class="btn" id="asksend" ${S.asking ? "disabled" : ""}>Ask</button></div>
      ${S.chat.length ? `<button class="linkbtn" id="askclear">Start again</button>` : ""}</div>`);
    const q = $("#askq"); const send = () => { const t = q.value.trim(); if (t) { q.value = ""; ask(t); } };
    $("#asksend").addEventListener("click", send); q.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
    bindAsk();
    if (!phone()) q.focus();
  }
  function bindAsk() { const box = $("#msgs"); if (!box) return; $$("[data-sugg]", box.parentElement).forEach((b) => b.addEventListener("click", () => ask(b.dataset.sugg))); bindCommon(box); const c = $("#askclear"); if (c) c.addEventListener("click", () => { S.chat = []; openAsk(); }); }
  function askBrief() {
    const m = S.m;
    const cats = m.cats.filter((c) => c.flow === "Expense").map((c) => `${c.id}=${c.name}`).join(", ");
    return `You are The Kitty, a plain-spoken household money helper, part accountant and part financial planner, for ${m.householdName} (${m.people.join(" and ")}). Today, for the household, is ${m.asOf} (the sheet's as-of date); the financial year runs July to June; currency ${E.currency}. Use the tools for every number; never guess a figure; say which period you used.
Reply with ONLY one JSON object, no prose around it, shaped like this:
{"headline":"the answer in one line, under 14 words","tone":"good|mixed|warn","summary":"one or two short sentences, optional","facts":[{"label":"Dining, Oct 2026","value":"$385","note":"budget $250","go":"cat:DINING"}],"points":[{"text":"one finding in one sentence","amount":"$1,349 a year","go":"subs"}],"actions":[{"label":"Cancel Paramount+","impact":"$120 a year","go":"sub:Paramount+"}],"novel":"one thing a careful accountant would raise that was not asked, with its number","caveat":"what the data cannot tell, optional","followups":["a natural next question","another"]}
Rules: 2 to 4 facts (the numbers the answer rests on), 3 to 6 points, up to 4 actions, each action concrete and tied to a page. State progress as money, "$11k of $12k" or "$1,000 to go", never as a percentage. Short sentences, no markdown. tone is good when nothing needs attention, warn when money is leaking or a date cannot be met, mixed otherwise.
"go" opens a page and must be one of: cat:<ID> with ID from [${cats}]; sub:<service> from [${m.subs.map((x) => x.service).join(", ")}]; goal:<name> from [${m.goals.map((g) => g.name).join(", ")}]; merchant:<name exactly as the data spells it>; or a page word: ${Object.entries(PAGE_GO).map(([k, v]) => `${k} (${v})`).join(", ")}. Leave "go" out when none fits.`;
  }
  function receipt(name, i) {
    const w = (f, t) => `${E.fmtMonth(f || E.window("month", S.m.asOf).from)}${t && t.slice(0, 7) !== (f || "").slice(0, 7) ? ` to ${E.fmtMonth(t)}` : ""}`;
    return { spending: () => `spending ${w(i.from, i.to)}${i.category ? ` (${i.category})` : ""}${i.person ? ` for ${i.person}` : ""}`, search_transactions: () => `search “${i.query}”`, goals: () => "goals", subscriptions: () => "subscriptions", upcoming: () => `the next ${i.days || 35} days`, headlines: () => "the headline metrics", budget: () => "budget pace" }[name]();
  }
  async function ask(question) {
    if (!S.sample || S.asking) return;
    S.asking = true; const turn = { role: "assistant", text: "", card: null, status: "Thinking", steps: [], receipts: [] };
    S.chat.push({ role: "user", text: question }); S.chat.push(turn);
    const draw = () => { const box = $("#msgs"); if (!box) return; box.innerHTML = S.chat.map((c, i) => msgHTML(c, i === S.chat.length - 1)).join(""); bindAsk(); box.lastElementChild && box.lastElementChild.scrollIntoView({ block: "end" }); };
    draw(); const sendBtn = $("#asksend"); if (sendBtn) sendBtn.disabled = true;
    // tools report what they looked at, so the note can show its receipts and the bubble can show progress
    const tools = TOOLS().map((t) => ({ ...t, execute: (input, ctx) => { const i = input || {}; let r = t.name; try { r = receipt(t.name, i); } catch (e) { /* keep the name */ } if (!turn.receipts.includes(r)) turn.receipts.push(r); turn.status = "Reading " + r; turn.steps = turn.receipts.slice(); draw(); return t.execute(i, ctx); } }));
    // earlier turns travel as compact text so a follow-up keeps its thread
    const prior = S.chat.slice(0, -2).map((c, i) => ({ role: c.role, content: c.role === "user" ? (i === 0 ? askBrief() + "\n\nQuestion: " + c.text : c.text) : c.card ? [c.card.headline].concat((c.card.points || []).map((p) => p.text)).join(" ") : c.text || "(no answer)" }));
    const msgs = prior.length ? prior.concat([{ role: "user", content: question }]) : [{ role: "user", content: askBrief() + "\n\nQuestion: " + question }];
    const structured = typeof S.sample.json === "function";
    const run = () => structured ? S.sample.json(msgs, { tools, modelTier: "default" }) : S.sample(msgs, { tools, modelTier: "default", onText: ({ text }) => { turn.text = text; draw(); } });
    try {
      let res;
      try { res = await run(); }
      catch (e1) { if (e1 && e1.retryable && !turn.text) { await sleep(Math.min(8000, e1.retryAfterMs || 2500)); res = await run(); } else throw e1; }
      if (structured) {
        if (res && typeof res === "object" && !Array.isArray(res) && (res.headline || res.points || res.facts)) turn.card = res;
        else turn.text = typeof res === "string" ? res : JSON.stringify(res);
      } else turn.text = (res && res.text) || turn.text || "I couldn't put an answer together.";
    } catch (e) {
      const code = e && e.code, msg = e && e.message ? String(e.message).slice(0, 160) : "";
      turn.text =
        code === "invalid_json" && e.text ? String(e.text) :
        code === "not_granted" ? "Asking needs your OK for Claude to read the page's numbers; the prompt was declined, so this stays off." :
        code === "approval_required" || code === "consent_required" ? "Claude needs your OK first: allow “Use Claude” when claude.ai asks, then ask again." :
        code === "rate_limited" ? "Claude is busy or your plan's limit is reached. Try again in a minute." :
        code === "cancelled" ? "Stopped." :
        (e && e.text) || `Couldn't ask${code ? ` (${code})` : ""}${msg ? `: ${msg}` : "."} Try again.`;
      if (code === "not_granted") { S.sample = null; renderHeader(); }
    }
    S.asking = false; turn.status = ""; draw(); const sb = $("#asksend"); if (sb) sb.disabled = false;
  }
  // local check only: a canned planner note so the card can be looked at without a live runtime
  if (FLAGS.has("mockask") && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    const canned = { headline: "Four leaks and two over-budget habits: about $4,100 a year to claw back.", tone: "warn", summary: "Three things this month, one longer game, and a tax note.", facts: [{ label: "Unused subscriptions", value: "$1,349", note: "a year", go: "subs" }, { label: "Shopping, FY27 to date", value: "$2,381", note: "budget $1,000", go: "cat:SHOPPING" }, { label: "Doubled charges", value: "$296", note: "to dispute", go: "dupes" }, { label: "Japan trip", value: "92%", note: "full by Jan 2027", go: "goal:Japan trip, April 2027" }], points: [{ text: "Paramount+ is still charging after you cancelled; Anytime Fitness, YouTube Premium and Dropbox have not been used in months.", amount: "$1,349 a year", go: "subs" }, { text: "Shopping and dining are both well over budget this financial year.", amount: "$2,005 over", go: "budget" }, { text: "Two same-day charges at JB Hi-Fi and Uber Eats look doubled.", amount: "$296", go: "dupes" }, { text: "Once Japan is full in January, its $500 a month could move to the emergency fund, which is behind.", go: "goal:Emergency fund" }], actions: [{ label: "Cancel Paramount+", impact: "$120 a year", go: "sub:Paramount+" }, { label: "Dispute the doubled charges", impact: "$296", go: "dupes" }, { label: "Move the emergency fund date", go: "goal:Emergency fund" }], novel: "Last year's tax refund estimate of $12,039 rests on $4,665 of claims with no receipts; the corrected figure is $7,374.", caveat: "The sheet's as-of date is 30 November 2026; nothing after that is in it.", followups: ["Which charges look doubled?", "What would moving the emergency fund date to June do?"] };
    const mock = async (input, opts) => { for (const t of opts.tools || []) if (/spending|subscriptions|goals/.test(t.name)) await t.execute(t.name === "spending" ? { from: "2026-11-01", to: "2026-11-30" } : {}); await sleep(900); return { text: canned.headline }; };
    mock.json = async (input, opts) => { await mock(input, opts); return canned; };
    setTimeout(() => { S.sample = mock; renderHeader(); }, 50);
  }

  // ---------- onboarding ----------
  const OB = { step: 0, dir: 1, greeting: "", country: "", lead: "", safety: null, accent: "", goalEdits: {} };
  function startOnboarding(again) {
    const m = S.m; if (!m) return;
    OB.step = 0; OB.greeting = greeting() === m.householdName.replace(/^The /, "") ? "" : greeting(); OB.country = pref("country", m.kitty.country || "AU"); OB.lead = (leadGoal() || {}).name || ""; OB.safety = E.safety(m).target; OB.accent = pref("accent", m.kitty.accent) || "violet"; OB.again = !!again;
    $("#onb").hidden = false; document.body.style.overflow = "hidden"; renderOnb();
  }
  function endOnboarding() { $("#onb").hidden = true; document.body.style.overflow = ""; }
  const OB_STEPS = ["welcome", "who", "goal", "safety", "look", "phone"];
  function renderOnb() {
    const m = S.m, k = OB_STEPS[OB.step], el = $("#onb"); const sf = E.safety(m); const p = platform();
    const dots = `<div class="dots" aria-hidden="true">${OB_STEPS.map((s, i) => `<i class="${i === OB.step ? "on" : ""}"></i>`).join("")}</div>`;
    let body = "";
    if (k === "welcome") body = `<div class="pawbig" aria-hidden="true">${ico("i-paw")}</div><div class="eyebrow">Meet The Kitty</div><h1>One page that answers one question: are we on track?</h1><p class="lede">It reads a Google Sheet that owns every number, says what needs a person, and shows where the money went without a single chart you have to decode. ${OB.again ? "Let's run through your setup again." : `It already knows <b>${esc(m.householdName)}</b>. Five quick screens make it yours.`}</p>`;
    if (k === "who") body = `<div class="eyebrow">Step 1 of 5</div><h1>Who's reading?</h1><p class="lede">The page greets you by name and formats money for your country. ${esc(m.householdName)} is the household on the sheet.</p><div class="fields2"><div class="field"><label for="obname">Call you</label><input id="obname" value="${esc(OB.greeting)}" placeholder="${esc(m.people[0] || "your name")}" autocomplete="given-name"></div><div class="field"><label for="obcountry">Where you bank</label><select id="obcountry">${SOURCES.countries.map((c) => `<option value="${c.code}" ${c.code === OB.country ? "selected" : ""}>${esc(c.name)} · ${c.currency}</option>`).join("")}</select></div></div><p class="lede" style="font-size:14px">${esc((SOURCES.countries.find((c) => c.code === OB.country) || {}).best || "")}</p>`;
    if (k === "goal") body = `<div class="eyebrow">Step 2 of 5</div><h1>What are you saving for?</h1><p class="lede">Pick the goal the Home page leads with. Tap again to change its target or date${canWriteSheet() ? "; that writes to the Goals tab" : ""}.</p><div class="opts">${m.goals.map((g) => { const on = OB.lead === g.name; const ed = OB.goalEdits[g.name] || {}; return `<div><button class="opt" data-oblead="${esc(g.name)}" aria-pressed="${on}"><span class="em" aria-hidden="true">${E.goalIcon(g.name)}</span><span class="mid"><span class="t">${esc(g.name)}</span><span class="s">${fmt0(g.balance)} of ${fmt0(ed.target || g.target)} · by ${E.fmtMonth(ed.date || g.date, true)} · ${esc(g.status)}</span><span class="gbar"><span style="width:${((g.progress || 0) * 100).toFixed(0)}%"></span></span></span><span class="r">${ofFmt(g.balance || 0)}<small> of ${ofFmt(ed.target || g.target || 0)}</small></span></button>${on ? `<div class="edit opt" style="border-color:transparent;margin-top:-6px;border-radius:0 0 18px 18px"><div class="field"><label for="obt">Target</label><input id="obt" type="number" inputmode="decimal" step="100" value="${ed.target || g.target}"></div><div class="field"><label for="obd">By</label><input id="obd" type="date" value="${ed.date || g.date}"></div></div>` : ""}</div>`; }).join("")}</div>`;
    if (k === "safety") body = `<div class="eyebrow">Step 3 of 5</div><h1>How safe do you want to feel?</h1><p class="lede">Months of essential spending to keep in cash and offset. Right now you have <b>${sf.months != null ? sf.months.toFixed(1) : "—"} months</b>.</p><div class="slide"><div class="val num"><span id="obsv">${OB.safety}</span><small>months</small></div><input id="obsr" type="range" min="1" max="12" step="1" value="${OB.safety}" aria-label="Months of safety net"><div class="marks"><span>1 · tight</span><span>3</span><span>6 · classic</span><span>9</span><span>12 · relaxed</span></div><p class="lede" style="font-size:15px" id="obst"></p></div>`;
    if (k === "look") body = `<div class="eyebrow">Step 4 of 5</div><h1>Make it yours.</h1><p class="lede">One accent colour runs through the page. The rest stays calm so the numbers speak.</p><div class="swatches">${[["violet", "#5B3DF5"], ["coral", "#F0533D"], ["teal", "#0E8F8E"], ["lime", "#7DB91D"]].map(([n, c]) => `<button class="swatch" data-obacc="${n}" aria-pressed="${OB.accent === n}" aria-label="${n}" style="background:${c}"></button>`).join("")}</div><div class="opts" style="margin-top:6px">${[["system", "Match my device", "Light by day, dark by night, as your phone decides"], ["light", "Always light", ""], ["dark", "Always dark", ""]].map(([k, t, sub]) => `<button class="opt" data-obtheme="${k}" aria-pressed="${(OB.theme || S.prefs.theme || "system") === k}"><span class="mid"><span class="t">${t}</span>${sub ? `<span class="s">${sub}</span>` : ""}</span></button>`).join("")}</div><div style="margin-top:8px"><div class="pawbig" style="animation:none;width:64px;height:64px;border-radius:20px" aria-hidden="true">${ico("i-paw")}</div></div>`;
    if (k === "phone") body = `<div class="eyebrow">Step 5 of 5</div><h1>${p.standalone ? "You're on the home screen." : "Put it on your phone."}</h1><p class="lede">${p.standalone ? "This is the app now: full screen, your icon, live numbers." : p.mobile ? "Thirty seconds, then it opens full screen from your home screen with its own icon, like any app." : "On a phone this page installs like an app. Open it there (scan the code on the Setup tab) and follow three taps."}</p><div class="phone"><div class="phoneimg" aria-hidden="true"><div class="notch"></div><div class="apps"><i></i><i></i><i></i><i></i><i></i><i class="kit">${ico("i-paw")}</i><i></i><i></i></div><div class="lbl" style="top:112px;left:46px;right:auto;width:30px">Kitty</div></div><div>${installStepsHTML()}</div></div>`;
    const last = OB.step === OB_STEPS.length - 1;
    el.innerHTML = `<div class="blob"></div><div class="blob2"></div><div class="onbhead"><span style="font-family:var(--display);font-weight:800">${ico("i-paw", "ic")} The Kitty</span>${dots}<button class="skip" id="obskip">${last ? "" : "Skip"}</button></div><div class="onbbody"><div class="step ${OB.dir < 0 ? "back" : ""}">${body}</div></div><div class="onbfoot">${OB.step > 0 ? `<button class="back" id="obback">${ico("i-back")} Back</button>` : "<span></span>"}<button class="btn lime" id="obnext">${k === "welcome" ? "Let's set it up" : last ? (p.standalone || !p.mobile ? "Done" : "I've added it") : "Next"} ${ico("i-chev")}</button></div>`;
    const nameI = $("#obname"); if (nameI) nameI.addEventListener("input", () => (OB.greeting = nameI.value.trim()));
    const cI = $("#obcountry"); if (cI) cI.addEventListener("change", () => { OB.country = cI.value; renderOnb(); });
    $$("[data-oblead]", el).forEach((b) => b.addEventListener("click", () => { OB.lead = b.dataset.oblead; buzz(); renderOnb(); }));
    const obt = $("#obt"), obd = $("#obd"); if (obt) obt.addEventListener("input", () => { OB.goalEdits[OB.lead] = { ...(OB.goalEdits[OB.lead] || {}), target: +obt.value }; }); if (obd) obd.addEventListener("input", () => { OB.goalEdits[OB.lead] = { ...(OB.goalEdits[OB.lead] || {}), date: obd.value }; });
    const sr = $("#obsr"); if (sr) { const upd = () => { OB.safety = +sr.value; $("#obsv").textContent = OB.safety; $("#obst").textContent = sf.months != null && sf.essentialPm ? (sf.months >= OB.safety ? "Already covered." : `About ${fmtS((OB.safety - sf.months) * sf.essentialPm)} more in cash would get there.`) : ""; }; sr.addEventListener("input", upd); upd(); }
    $$("[data-obtheme]", el).forEach((b) => b.addEventListener("click", () => { OB.theme = b.dataset.obtheme; savePrefs({ theme: OB.theme }); applyTheme(); renderOnb(); }));
    $$("[data-obacc]", el).forEach((b) => b.addEventListener("click", () => { OB.accent = b.dataset.obacc; if (OB.accent === "violet") document.documentElement.removeAttribute("data-accent"); else document.documentElement.setAttribute("data-accent", OB.accent); buzz(); renderOnb(); }));
    $("#obskip").addEventListener("click", () => finishOnboarding(true));
    const bb = $("#obback"); if (bb) bb.addEventListener("click", () => { OB.dir = -1; OB.step--; renderOnb(); });
    $("#obnext").addEventListener("click", () => { buzz(); if (last) finishOnboarding(false); else { OB.dir = 1; OB.step++; renderOnb(); } });
    if (nameI && !phone()) setTimeout(() => nameI.focus(), 300);
  }
  async function finishOnboarding(skipped) {
    const m = S.m;
    if (!skipped) {
      savePrefs({ onboarded: true, greeting: OB.greeting, country: OB.country, leadGoal: OB.lead, accent: OB.accent, safetyMonths: OB.safety, installed: platform().standalone });
      const label = "Emergency fund target (months of essential spending)";
      if (!canWriteSheet()) { const ed = { ...(S.prefs.goalEdits || {}) }; for (const [name, e] of Object.entries(OB.goalEdits)) ed[name] = { ...(ed[name] || {}), ...e }; savePrefs({ goalEdits: ed }); applyLocalGoals(m); }
      endOnboarding(); applyAccent(); renderAll(); celebrate(); toast(canWriteSheet() ? "You're set. Writing your choices to the sheet…" : "You're set. Saved on this device.");
      if (canWriteSheet()) {
        try {
          await writeKitty("greeting_name", OB.greeting); await writeKitty("country", OB.country); await writeKitty("lead_goal", OB.lead); await writeKitty("accent", OB.accent); await writeKitty("onboarded_at", new Date().toISOString());
          const row = rowOf(S.settingsRows, label); if (row && +S.settingsRows[row - 1][1] !== OB.safety) await writeCells(`Settings!B${row}`, [[OB.safety]]);
          for (const [name, ed] of Object.entries(OB.goalEdits)) { const g = m.goals.find((x) => x.name === name); if (g && (ed.target || ed.date)) await writeCells(`Goals!B${g.row}:C${g.row}`, [[ed.target || g.target, ed.date || g.date]]); }
          await loadLive(true); toast("Written to the sheet");
        } catch (e) { toast("Saved here, but the sheet write failed: " + errText(e)); }
      }
    } else { savePrefs({ onboarded: true }); endOnboarding(); }
  }
  function celebrate() { if (reduced() || !window.confetti) return; try { const colors = ["#5B3DF5", "#FF5CC8", "#D9F94B", "#0E9F9E"]; confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors, zIndex: 90, disableForReducedMotion: true }); setTimeout(() => confetti({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0, y: 0.8 }, colors, zIndex: 90 }), 200); setTimeout(() => confetti({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1, y: 0.8 }, colors, zIndex: 90 }), 350); } catch (e) { /* ignore */ } }

  // ---------- wiring ----------
  function go(target) {
    const [kind, ...rest] = String(target).split(":"); const key = rest.join(":");
    switch (kind) {
      case "insights": case "goals": case "setup": case "home": case "activity": switchTab(kind); if (key === "save") setTimeout(() => { const el = $("#savecard"); el && el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }); }, 80); break;
      case "cat": openCategory(key); break;
      case "entry": openEntry(key); break;
      case "review": S.focusReview = true; switchTab("activity"); setTimeout(() => { const el = $("#reviewcard"); if (el) el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }); const first = $("#rcards .rcard"); if (first && !phone()) first.focus({ preventScroll: true }); }, 80); break;
      case "merchant": openMerchant(key); break;
      case "sub": openSub(key); break;
      case "goal": openGoal(key); break;
      case "loan": openLoan(key); break;
      case "pay": openPay(key); break;
      case "check": openCheck(key); break;
      case "dupes": openDupes(); break;
      case "checks": openChecks(); break;
      case "subs": openSubs(); break;
      case "upcoming": openUpcoming(); break;
      case "needs": openNeeds(); break;
      case "trust": openTrust(); break;
      case "safety": switchTab("goals"); break;
      case "budget": case "networth": switchTab("insights"); setTimeout(() => { const el = $(kind === "networth" ? "#nwchart" : "#v-insights .grid"); el && el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }); }, 80); break;
      default: break;
    }
  }
  function bindCommon(root) {
    $$("[data-tx]", root).forEach((b) => b.addEventListener("click", () => openTx(b.dataset.tx)));
    $$("[data-entry]", root).forEach((b) => { if (b.tagName === "BUTTON" && !b.closest(".wrow")) b.addEventListener("click", () => openEntry(b.dataset.entry)); });
    $$("[data-go]", root).forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
    $$("[data-open]", root).forEach((b) => b.addEventListener("click", () => go(b.dataset.open)));
    $$("[data-need]", root).forEach((b) => b.addEventListener("click", () => go(b.dataset.need)));
    $$("[data-up]", root).forEach((b) => b.addEventListener("click", () => go(b.dataset.up)));
    $$("[data-merchant]", root).forEach((b) => b.addEventListener("click", () => openMerchant(b.dataset.merchant)));
    $$("[data-where]", root).forEach((b) => b.addEventListener("click", () => toast("In the sheet: " + b.dataset.where, 3600)));
    $$("[data-hide]", root).forEach((b) => b.addEventListener("click", () => { const h = new Set(S.prefs.hidden || []); if (h.has(b.dataset.hide)) h.delete(b.dataset.hide); else h.add(b.dataset.hide); savePrefs({ hidden: [...h] }); renderHome(); renderGoals(); }));
    $$(".gbar span[data-w]", root).forEach((s) => requestAnimationFrame(() => requestAnimationFrame(() => (s.style.width = s.dataset.w + "%"))));
    bindTips(root);
  }
  function moveGlow() { const nav = $("nav.tabs"), on = $('nav.tabs button[aria-selected="true"]'), g = $(".tabglow"); if (!nav || !on || !g) return; g.style.left = on.offsetLeft + "px"; g.style.width = on.offsetWidth + "px"; }
  function switchTab(t, quiet) {
    if (!$(`#v-${t}`)) return;
    const was = S.tab; S.tab = t;
    $$("nav.tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    $$("section.view").forEach((s) => s.classList.toggle("on", s.id === `v-${t}`));
    moveGlow(); closeDrawer(); const ab = $("#arrangebtn"); if (ab) ab.hidden = t !== "home" || fixedLayout() || !!window.__KIT_GALLERY__;
    if (t === "home" && was !== "home" && S.m) { mountCanvas(); const lead = leadGoal(); if (lead && lead.status === "Reached" && !store.get("celebrated:" + lead.name)) { store.set("celebrated:" + lead.name, true); setTimeout(celebrate, 400); } }
    if (!quiet) { window.scrollTo({ top: 0, behavior: "auto" }); if (was !== t) buzz(); }
    store.set("tab", t);
  }
  function openSearch() { switchTab("activity"); const q = $("#feedq"); if (q) { q.focus(); q.select(); } }
  function gate(msg, sub) { $("#v-home").innerHTML = `<div class="card hero" style="margin-top:8px"><div class="blob"></div><div class="hi">The Kitty</div><h1 class="vh">${esc(msg)}</h1><p class="vs">${sub || ""}</p></div>`; }

  // worth_it_min is a Kitty-tab key (default 40); written once if the sheet lacks it, so the threshold has a sheet owner
  async function ensureWorthKey() { if (!canWriteSheet() || S.m.sheetVersion < 2 || S.m.kitty.worth_it_min != null && S.m.kitty.worth_it_min !== "" || S.wroteWorthKey) return; S.wroteWorthKey = true; try { await writeKitty("worth_it_min", 40); S.m.kitty.worth_it_min = "40"; } catch (e) { /* the default stands */ } }
  async function boot() {
    PHONE.addEventListener("change", () => { if (S.m) renderHome(); });
    const saved = window.__KIT_GALLERY__ ? "home" : store.get("tab", "home"); if (saved && $(`#v-${saved}`)) switchTab(saved, true);
    if (SNAP) { setModel(demoModel()); renderAll(); }
    if (SNAP && LOCAL_HOST && FLAGS.get("open") === "trust") setTimeout(openTrust, 50);
    else gate("Opening your sheet…", "This copy bundles no data. It reads your Google Sheet through your connector.");
    $$("nav.tabs button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
    $("#brandbtn").addEventListener("click", () => switchTab("home"));
    $("#trustpill").addEventListener("click", () => S.m && openTrust());
    $("#askbtn").addEventListener("click", () => S.m && openAsk());
    $("#topsearch").addEventListener("click", openSearch);
    $("#scrim").addEventListener("click", closeDrawer);
    window.addEventListener("scroll", () => $("header.top").classList.toggle("scrolled", window.scrollY > 6), { passive: true });
    window.addEventListener("resize", () => { moveGlow(); if (S.grid) { clearTimeout(S.resizeTm); S.resizeTm = setTimeout(renderHome, 150); } });   // heights changed: remount on the new geometry
    $("#arrangebtn").addEventListener("click", () => setArrange(!S.arrange));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { if (!$("#onb").hidden) return; if (S.arrange && !$("#drawer").classList.contains("on")) setArrange(false); closeDrawer(); }
      if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
      if (e.key === "Tab" && $("#drawer").classList.contains("on")) { const f = $$("#drawer a[href], #drawer button:not([disabled]), #drawer input, #drawer select, #drawer [tabindex='0']").filter((x) => x.offsetParent !== null); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    });
    requestAnimationFrame(moveGlow); setTimeout(moveGlow, 400); if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveGlow);
    const use = (n) => (window.claude && window.claude.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
    const [mcp, user, db, sample, downloads] = await Promise.all([use("mcp"), use("user"), use("db"), use("sample"), use("downloads")]);
    S.sample = sample; S.downloads = downloads; S.user = user;
    if (user) { try { S.isOwner = await user.isOwner(); } catch (e) { S.isOwner = false; } try { const me = await user.me(); S.userName = (me && me.name) || ""; } catch (e) { S.userName = ""; } }
    if (db && user) { try { const id = await user.id(); if (id) { S.dbDoc = db.doc(`data/users/${id}/kitty`); const snap = await S.dbDoc.get(); if (snap.exists) { const d = snap.data() || {}; if ((d.savedAt || 0) > (store.get("prefsSavedAt", 0))) { Object.assign(S.prefs, d); store.set("prefs", S.prefs); } } } } catch (e) { S.dbDoc = null; } }
    S.canWrite = S.isOwner || !!S.prefs.sheet;
    if (S.m) renderAll();
    if (window.__KIT_GALLERY__ && S.m) { switchTab("home", true); return; }
    if (mcp) { S.mcp = mcp; if (S.isOwner || S.prefs.sheet || !SNAP) { const ok = await loadLive(false); if (!ok && !SNAP) gate("Couldn't read the sheet", errText(S.liveErr || { code: "unknown" }) + ' <button class="lnk" data-open="trust">Details</button>'); if (ok) ensureWorthKey(); } else renderHeader(); }
    else if (!SNAP) gate("This copy needs a connector", errText({ code: "no_mcp" }));
    S.settled = true; if (S.m) renderHome();
    if (S.m && !S.prefs.onboarded && !FLAGS.has("noonb")) setTimeout(() => startOnboarding(false), 700);
    if (FLAGS.get("tab")) switchTab(FLAGS.get("tab"), true);
    if (FLAGS.has("onb")) startOnboarding(true);
  }
  boot();
})();
