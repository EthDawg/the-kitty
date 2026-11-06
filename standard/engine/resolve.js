/* Resolution: observations in, events out. Deterministic: same inputs give the same output in any file order.
   Recognise once, clear everywhere (SPEC 6). No LLM touches this; models write recipes and propose decisions. */
"use strict";
const { byKey, groupBy, cmp, addDays, daysBetween, monthOf, monthEnd, fyOf, fyRange, hash64, parseUnits, fmtUnits, unitsValueCents, subsetSum } = require("./util");
const { collapse, similarity } = require("./lines");
const { indexTerms, termAt, timeline, activeOn } = require("./temporal");
const Engine = require("../../src/engine.js");
const VOCAB = require("../schema/observations.json");
const MATCHING = require("../schema/matching.json");
const WINDOW = Object.fromEntries(Object.entries(MATCHING.windows_days).map(([k, v]) => [k, v.days]));
const TRANSFER_WORDS = new Set(MATCHING.transfer_words.words), STOP_WORDS = new Set(MATCHING.stop_words.words);
const AGENT_LINE = /RENT|PROPERTY|AGENT|OWNER|MGMT|REALTY|REAL ESTATE/i;
const SALE_FLOOR = 5000000, CLOSED_GRACE = 14;
const OWN_ENTITY = new Set(["company", "trust", "smsf"]);
// Who a line is with, by the first two words of what the dictionary or the bank calls them. A refund's text differs after that.
const payee = (l) => l.cls.contract_id || String(l.cls.merchant || l.desc).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).slice(0, 2).join(" ");

const dollarsToCents = (v) => Math.round(Number(v) * 100);
const nz = (v) => (v == null ? 0 : v);
const normRef = (s) => String(s == null ? "" : s).toUpperCase().replace(/[\s\-_.]/g, "");

const planOf = (R, person) => { const c = (R.ctx.setup.contract || []).find((k) => k.kind === "ess_plan" && k.holder_party_id === person); return c ? c.contract_id : "plan"; };

class Resolver {
  constructor(ctx) {
    this.ctx = ctx;
    this.setup = ctx.setup;
    this.fyStart = (ctx.setup.household && ctx.setup.household[0] && ctx.setup.household[0].fy_start_month) || 7;
    this.events = [];
    this.review = [];
    this.notes = [];
    this.accounts = byKey(ctx.setup.account || [], "account_id");
    this.categories = byKey(ctx.setup.category || [], "category_id");
    this.parties = byKey(ctx.setup.party || [], "party_id");
    this.contracts = byKey(ctx.setup.contract || [], "contract_id");
    this.instruments = byKey(ctx.setup.instrument || [], "instrument_id");
    this.assets = byKey(ctx.setup.asset || [], "asset_id");
    this.streams = byKey(ctx.setup.stream || [], "stream_id");
    this.sources = byKey(ctx.sources || [], "source_id");
    this.aliases = groupBy(ctx.setup.alias || [], (a) => `${a.subject_type}|${normRef(a.value)}`);
    this.aliasRows = ctx.setup.alias || [];
    const active = new Set((ctx.sources || []).filter((s) => s.status === "active").map((s) => s.source_id));
    this.obs = (ctx.observations || []).filter((o) => o.status === "active" && (!ctx.sources || active.has(o.source_id)));
    // An observation missing a required field stays in evidence and out of the ledger, with a question. It never crashes a rebuild.
    const required = new Map(Object.entries(VOCAB.kinds).map(([k, v]) => [k, v.fields.filter((f) => f.endsWith("*")).map((f) => f.slice(0, -1))]));
    this.incomplete = [];
    this.obs = this.obs.filter((o) => {
      const need = required.get(o.kind);
      if (!need && !String(o.kind).startsWith("x_")) { this.incomplete.push({ o, why: `kind ${o.kind} is not in the vocabulary` }); return false; }
      const miss = (need || []).filter((f) => o.payload == null || o.payload[f] === undefined || o.payload[f] === null || o.payload[f] === "");
      if (miss.length) { this.incomplete.push({ o, why: `no ${miss.join(", ")}` }); return false; }
      return true;
    });
    for (const x of this.incomplete) this.review.push({ kind: "unreadable_observation", ref: x.o.obs_id, amount_cents: null, what: `${x.o.kind} at ${x.o.locator}: ${x.why}.`, do: "The file's format may have changed. It stays out of the ledger until it is read." });
    const replaced = new Set(this.obs.map((o) => o.supersedes_obs_id).filter(Boolean));
    this.obs = this.obs.filter((o) => !replaced.has(o.obs_id));
    this.byKind = groupBy(this.obs, (o) => o.kind);
    this.decisions = (ctx.decisions || []).filter((d) => d.status === "accepted");
    this.rules = (ctx.rules || ctx.setup.rule || []).map((r) => ({ ...r, cat: r.category_id }));
    this.merchantModel = { rules: this.rules.map((r) => ({ pattern: r.pattern, match: r.match, merchant: r.merchant || "", cat: r.category_id, person: r.person, tax: "", property: "", _r: r })), merMemo: new Map() };
    this.terms = [...(ctx.setup.term || [])];
    this.links = ctx.setup.link || [];
    this.ownership = ctx.setup.ownership || [];
  }

  // ---------- entity resolution ----------
  alias(type, value, on) {
    const rows = this.aliases.get(`${type}|${normRef(value)}`) || [];
    const hit = rows.find((r) => r.valid_from <= (on || "9999") && (r.valid_to == null || (on || "0") < r.valid_to));
    return hit ? hit.subject_id : rows.length ? rows[0].subject_id : null;
  }
  accountOf(o, ref, on) {
    if (ref != null && ref !== "") {
      if (this.accounts.has(ref)) return ref;
      const a = this.alias("account", ref, on);
      if (a) return a;
      // A masked number: match on its digits' tail.
      const tail = normRef(ref).replace(/[^0-9]/g, "");
      if (tail.length >= 4) {
        const hit = this.aliasRows.find((r) => r.subject_type === "account" && normRef(r.value).replace(/[^0-9]/g, "").endsWith(tail));
        if (hit) return hit.subject_id;
      }
    }
    const src = this.sources.get(o.source_id);
    const st = src && this.streams.get(src.stream_id);
    if (st && st.subject_type === "account") return st.subject_id;
    return null;
  }
  partyOf(ref, on) {
    if (ref == null) return null;
    if (this.parties.has(ref)) return ref;
    const a = this.alias("party", ref, on);
    if (a) return a;
    const low = String(ref).toLowerCase();
    for (const p of this.ctx.setup.party || []) {
      const n = String(p.name).toLowerCase();
      if (n === low || (p.kind === "person" && (low.includes(n.split(" ")[0]) || n.includes(low)))) return p.party_id;
    }
    return null;
  }
  ownersOf(type, id, on, basis = "beneficial") {
    const rows = activeOn(this.ownership.filter((o) => o.subject_type === type && o.subject_id === id && o.basis === basis), on);
    return rows.length ? rows : activeOn(this.ownership.filter((o) => o.subject_type === type && o.subject_id === id && o.basis === "legal"), on);
  }
  personOfAccount(account, on) {
    const owners = this.ownersOf("account", account, on);
    if (owners.length === 1) return owners[0].party_id;
    return null;
  }

  // ---------- step: dated facts arriving in documents become terms ----------
  materialiseTerms() {
    const notices = [];
    const add = (subject_type, subject_id, term, value, unit, valid_from, valid_to, recorded_at, o) => {
      if (!subject_id) { this.fault("unresolved_subject", o, `No subject for ${term}.`); return; }
      notices.push({ subject_type, subject_id, term, value: String(value), unit, valid_from, valid_to: valid_to || null, recorded_at: `${recorded_at}T00:00:00Z`, source_obs_id: o.obs_id });
    };
    for (const o of this.byKind.get("rate_notice") || []) {
      const p = o.payload;
      const c = this.alias("contract", p.contract_ref, p.effective_on) || (this.contracts.has(p.contract_ref) ? p.contract_ref : null);
      add("contract", c, p.term, p.value, null, p.effective_on, null, p.notified_on || p.effective_on, o);
    }
    for (const o of this.byKind.get("term_notice") || []) {
      const p = o.payload;
      const ref = p.subject_ref;
      for (const [type, map] of [["contract", this.contracts], ["asset", this.assets], ["account", this.accounts], ["party", this.parties], ["instrument", this.instruments]]) {
        const id = map.has(ref) ? ref : this.alias(type, ref, p.valid_from);
        if (id) { add(type, id, p.term, p.value, null, p.valid_from, p.valid_to, p.notified_on || p.valid_from, o); break; }
      }
    }
    for (const o of this.collapseDocs("policy")) {
      const p = o.payload;
      const c = this.alias("contract", p.contract_ref, p.period_start) || (this.contracts.has(p.contract_ref) ? p.contract_ref : null);
      add("contract", c, "premium_cents", p.premium_cents, "cents", p.period_start, null, p.period_start, o);
      if (p.sum_insured_cents != null) add("contract", c, "sum_insured_cents", p.sum_insured_cents, "cents", p.period_start, null, p.period_start, o);
      if (p.excess_cents != null) add("contract", c, "excess_cents", p.excess_cents, "cents", p.period_start, null, p.period_start, o);
      add("contract", c, "renewal_on", p.period_end, "date", p.period_start, null, p.period_start, o);
    }
    for (const [key, rows] of groupBy(notices, (n) => `${n.subject_type}|${n.subject_id}|${n.term}`)) {
      const [subject_type, subject_id, term] = key.split("|");
      this.terms = this.terms.filter((t) => !(t.subject_type === subject_type && t.subject_id === subject_id && t.term === term && t.derived));
      const seed = this.terms.filter((t) => t.subject_type === subject_type && t.subject_id === subject_id && t.term === term);
      const tl = timeline({ subject_type, subject_id, term }, [...seed.map((t) => ({ value: t.value, unit: t.unit, valid_from: t.valid_from, valid_to: t.valid_to, recorded_at: t.recorded_at, note: t.note })), ...rows]);
      this.terms = this.terms.filter((t) => !(t.subject_type === subject_type && t.subject_id === subject_id && t.term === term));
      this.terms.push(...tl);
    }
    this.termIdx = indexTerms(this.terms);
  }
  term(type, id, name, on, at) { return termAt(this.termIdx, type, id, name, on, at); }

  // ---------- step: several documents saying one thing are one claim ----------
  docKey(o) {
    const p = o.payload;
    switch (o.kind) {
      case "payslip": return `${p.person_ref}|${p.employer_ref}|${p.pay_date}|${p.net_cents}`;
      case "income_statement": return `${p.person_ref}|${p.employer_ref}|${p.fy}|${p.finalised ?? ""}`;
      case "loan_statement": case "super_statement": case "statement": return `${this.accountOf(o, p.account_ref, p.period_end)}|${p.period_start}|${p.period_end}`;
      case "owner_statement": return `${p.property_ref}|${p.period_start}|${p.period_end}`;
      case "contract_note": return p.reference ? `${p.account_ref}|${p.reference}` : `${p.account_ref}|${p.instrument_ref}|${p.side}|${p.trade_date}|${p.units}|${p.price}`;
      case "dividend": return `${p.account_ref}|${p.instrument_ref}|${p.pay_date}`;
      case "distribution": return `${p.account_ref}|${p.instrument_ref}|${p.fy}`;
      case "vest": return `${p.plan_ref}|${p.instrument_ref}|${p.vest_date}`;
      case "crypto_txn": return p.txid ? `${p.wallet_ref}|${p.txid}|${p.type}|${p.asset}` : `${p.wallet_ref}|${p.time}|${p.type}|${p.asset}|${p.units}`;
      case "tax_assessment": return `${p.person_ref}|${p.fy}|${p.version}`;
      case "policy": return `${p.contract_ref}|${p.period_start}`;
      case "settlement": return `${p.asset_ref}|${p.settled_on}`;
      default: return null;
    }
  }
  collapseDocs(kind) {
    const rows = this.byKind.get(kind) || [];
    const out = [];
    for (const [, group] of groupBy(rows, (o) => this.docKey(o) ?? o.obs_id)) {
      const ranked = [...group].sort((a, b) => Number(b.confidence) - Number(a.confidence) || cmp(a.obs_id, b.obs_id));
      const lead = ranked[0];
      lead.alsoSeen = ranked.slice(1);
      out.push(lead);
    }
    return out.sort((a, b) => cmp(a.occurred_on || "", b.occurred_on || "") || cmp(a.obs_id, b.obs_id));
  }

  // ---------- events ----------
  event(e) {
    const key = e.key;
    e.event_id = `ev_${hash64(key)}`;
    e.witnesses = e.witnesses || [];
    e.status = e.status || "recognised";
    e.fields = e.fields || {};
    e.refs = e.refs || {};
    if (e.asset_id && !e.activity_id) { const a = (this.ctx.setup.activity || []).find((x) => x.asset_id === e.asset_id); if (a) e.activity_id = a.activity_id; }
    this.events.push(e);
    return e;
  }
  fault(kind, o, what, doIt, cents) {
    this.review.push({ kind, ref: o && o.obs_id ? o.obs_id : String(o || ""), amount_cents: cents ?? null, what, do: doIt || "" });
  }
  claim(line, role) { line.claimed = role; }
  w(obs, role) { return (Array.isArray(obs) ? obs : [obs]).filter(Boolean).map((o) => ({ obs_id: o.obs_id, role })); }
  lineWitness(line, role = "recognises") {
    return line.witnesses.map((o, i) => ({ obs_id: o.obs_id, role: i === 0 ? role : "corroborates", amount_cents: line.cents }));
  }
  docWitness(o, role = "recognises") {
    return [{ obs_id: o.obs_id, role }, ...(o.alsoSeen || []).map((x) => ({ obs_id: x.obs_id, role: "corroborates" }))];
  }

  // ---------- step: lines ----------
  collapseLines() {
    const items = [];
    const take = (o, seq) => {
      const p = o.payload;
      const date = p.posting_date;
      if (!date || !Number.isInteger(p.amount_cents)) { this.fault("unreadable_line", o, `A line in ${o.locator} has no readable date or amount.`, "The file's format may have changed. It stays out of the ledger until it is read."); return; }
      const account = this.accountOf(o, p.account_ref, date);
      if (!account) { this.fault("unresolved_account", o, `No account for ${p.account_ref} on ${date}.`, "Add an alias for this account."); return; }
      const src = this.sources.get(o.source_id);
      // A line well after an account closed cannot be that account's. It is usually another account's file in the wrong folder, so it stays evidence and asks once per file.
      const closed = (this.accounts.get(account) || {}).closed_on;
      if (closed && date > addDays(closed, CLOSED_GRACE)) { (this.strays = this.strays || new Map()).set(o.source_id, [...(this.strays.get(o.source_id) || []), { o, account }]); return; }
      items.push({ obs: o, account, date, valueDate: p.value_date, cents: p.amount_cents, desc: p.description, ref: p.reference, status: p.status || "posted",
        sourceId: o.source_id, stream: src && src.stream_id, seq, balanceAfter: p.balance_after_cents, cardMember: p.card_member, foreignAmount: p.foreign_amount, foreignCurrency: p.foreign_currency,
        capturedAt: src && src.captured_at, issuedOn: src && src.issued_on, dateBasis: p.date_basis, lineType: p.line_type });
    };
    let seq = 0;
    for (const o of this.byKind.get("txn_line") || []) take(o, ++seq);
    for (const [src, rows] of this.strays || []) {
      const name = (this.sources.get(src) || {}).name || src, account = rows[0].account;
      this.review.push({ kind: "lines_after_close", ref: `${account}|${src}`, amount_cents: rows.reduce((t, r) => t + (r.o.payload.amount_cents || 0), 0), what: `${name} holds ${rows.length} lines dated after ${this.accountName(account)} closed. They are not in the ledger.`, do: "Is this another account's file? Move it, or say the account was still open." });
      this.heldOnly = [...(this.heldOnly || []), ...rows.map((r) => r.o)];
    }
    const { lines, faults } = collapse(items);
    for (const f of faults) this.review.push({ kind: f.kind, ref: f.ref, amount_cents: f.cents ?? null, what: f.what, do: "" });
    this.lines = lines;
    this.linesByAccount = groupBy(lines, (l) => l.account);
    // super lines collapse the same way, in their own space
    const superItems = [];
    let s2 = 0;
    for (const o of this.byKind.get("super_line") || []) {
      const p = o.payload; const account = this.accountOf(o, p.account_ref, p.posting_date);
      if (!account) { this.fault("unresolved_account", o, `No account for ${p.account_ref}.`); continue; }
      superItems.push({ obs: o, account, date: p.posting_date, cents: p.amount_cents, desc: `${p.line_type} ${p.description}`, ref: p.reference, status: "posted", sourceId: o.source_id, seq: ++s2, balanceAfter: p.balance_after_cents, lineType: p.line_type });
    }
    const sup = collapse(superItems);
    for (const l of sup.lines) l.lineType = (l.witnesses[0].payload || {}).line_type;
    this.superLines = sup.lines;
  }

  // ---------- step: what a line means ----------
  targetDecision(line) {
    if (!this.decisionIdx) {
      this.decisionIdx = new Map();
      for (const d of this.decisions) if (d.target_type === "line") {
        const k = d.target_ref;
        if (!this.decisionIdx.has(k)) this.decisionIdx.set(k, []);
        this.decisionIdx.get(k).push(d);
      }
    }
    const [account, date, cents] = line.key.split("|");
    return this.decisionIdx.get(line.key) || this.decisionIdx.get(`${account}|${date}|${cents}`) || [];
  }
  classify() {
    const dict = new Map();
    for (const line of [...this.lines]) {
      const ds = this.targetDecision(line);
      const cls = { category_id: null, merchant: null, person: null, event_kind: null, contract_id: null, via: null, asset_id: null, party: null };
      for (const d of ds) {
        const v = d.value || {};
        if (d.verb === "categorise") { cls.category_id = v.category_id; cls.via = "decision"; if (v.merchant) cls.merchant = v.merchant; if (v.person) cls.person = this.partyOf(v.person, line.date); if (v.event_kind) cls.event_kind = v.event_kind; }
        if (d.verb === "set_event_kind") { cls.event_kind = v.event_kind; cls.via = "decision"; Object.assign(cls, v); }
        if (d.verb === "assign_person") cls.person = v.person;
        if (d.verb === "assign_claimant") cls.claimant = v.person;
        if (d.verb === "exclude") line.excluded = d.decision_id;
        if (d.verb === "include") line.excluded = null;
        if (d.verb === "link") { if (v.asset_id) cls.asset_id = v.asset_id; if (v.activity_id) cls.activity_id = v.activity_id; if (v.contract_id) cls.contract_id = v.contract_id; }
        if (d.verb === "unlink") line.noPair = true;
        if (d.verb === "split") line.split = v.parts;
      }
      let m = this.ruleFor(line) || Engine.merchant(line.desc, this.scopedModel(line.account, line.cents));
      // A rule learned later does not rewrite history: outside its dates it does not apply, and the line reads as if it were not there.
      const hit = m.source === "rule" && m.rule && m.rule._r;
      if (hit && ((hit.valid_from && line.date < hit.valid_from) || (hit.valid_to && line.date >= hit.valid_to))) m = Engine.merchant(line.desc, { rules: [], merMemo: new Map() });
      cls.merchant = cls.merchant || m.name;
      if (!cls.category_id && m.source === "rule" && m.rule) {
        cls.category_id = m.cat; cls.via = "rule";
        const r = (m.rule && m.rule._r) || {};
        if (r.event_kind) cls.event_kind = r.event_kind;
        if (r.contract_id) cls.contract_id = r.contract_id;
        if (r.asset_id) cls.asset_id = r.asset_id;
        if (r.activity_id) cls.activity_id = r.activity_id;
      }
      // The dictionary can know who a line is and not what it is. UNCAT from it is a name, not an answer, so the line is still asked.
      cls.unplaced = m.source === "dictionary" && m.cat === "UNCAT";
      if (!cls.category_id && m.source === "dictionary" && m.cat && !cls.unplaced && this.categories.has(m.cat)) { cls.category_id = m.cat; cls.via = "dictionary"; }
      if (!cls.category_id && line.cents > 0 && /\bINTEREST\b/i.test(line.desc) && this.categories.has("INTEREST")) { cls.category_id = "INTEREST"; cls.via = "keyword"; }
      cls.dictKind = m.kind;
      if (!cls.person && m.person && !/^joint$/i.test(m.person)) cls.person = this.partyOf(m.person, line.date);
      if (!cls.person && line.cardMember) cls.person = this.partyOf(line.cardMember, line.date);
      if (!cls.person) cls.person = this.personOfAccount(line.account, line.date);
      cls.norm = m.norm;
      line.cls = cls;
      if (cls.category_id && cls.via === "decision") dict.set(m.norm, cls);
    }
    // A premium on a policy we hold names its line: the amount, near the date, whatever the bank calls it.
    for (const o of this.collapseDocs("policy")) {
      const p = o.payload;
      const c = this.alias("contract", p.contract_ref, p.period_start) || (this.contracts.has(p.contract_ref) ? p.contract_ref : null);
      const k = c && this.contracts.get(c);
      if (!k) continue;
      const on = p.paid_on || p.period_start;
      const l = this.lines.find((x) => x.cents === -p.premium_cents && !x.cls.contract_id && Math.abs(daysBetween(on, x.date)) <= WINDOW.policy && (!x.cls.category_id || x.cls.via !== "decision"));
      if (!l) continue;
      l.cls.contract_id = c; l.policyWitness = o;
      if (k.category_id) { l.cls.category_id = k.category_id; l.cls.via = "contract"; }
    }
    // On an account that serves a rental, the same plumber is a rental repair. The category says what it becomes.
    for (const line of this.lines) {
      const c = line.cls.category_id && this.categories.get(line.cls.category_id);
      if (!c || !c.property_twin_id || line.cls.via === "decision") continue;
      const asset = this.assetOfAccount(line.account, line.date);
      if (asset && this.term("asset", asset, "use", line.date) === "rental") { line.cls.category_id = c.property_twin_id; line.cls.via = "account"; }
    }
    // A credit saying rent on an account that serves a rental is rent, whoever paid it.
    for (const line of this.lines) {
      if (line.cls.category_id || line.cents <= 0 || !/\bRENT\b/i.test(line.desc) || !this.categories.has("RENT-INC")) continue;
      const asset = this.assetOfAccount(line.account, line.date);
      if (asset && this.term("asset", asset, "use", line.date) === "rental") { line.cls.category_id = "RENT-INC"; line.cls.via = "account"; line.cls.asset_id = line.cls.asset_id || asset; }
    }
    // A contract says what its money is. A line naming its counterparty takes its category, in the direction that category runs. A loan's lines have their own reading.
    const priced = (this.ctx.setup.contract || []).filter((k) => k.category_id && k.counterparty_party_id && k.kind !== "loan" && this.categories.has(k.category_id));
    // Two contracts with one party, in two categories: its name alone does not say which. An amount can, and the policy step reads that.
    const meanings = groupBy(priced, (k) => k.counterparty_party_id);
    const entities = (this.setup.party || []).filter((p) => OWN_ENTITY.has(p.kind));
    for (const line of this.lines) {
      // A guess from the dictionary never stands over the household's own company or trust. A question beats a quiet wrong number.
      if (line.cls.via === "dictionary" && entities.some((p) => this.namesParty(line, p.party_id))) { line.cls.category_id = null; line.cls.via = null; }
      // What the person set up beats a dictionary guess about money coming in. A contract is what most of a party's lines mean, not all of them: a bond, or a line far above the price, stays a question.
      if (line.cls.category_id && !(line.cls.via === "dictionary" && line.cents > 0)) continue;
      if (/\b(BOND|DEPOSIT)\b/i.test(line.desc)) continue;
      const k = priced.find((x) => {
        if (this.catKind(x.category_id) === "income" && line.cents <= 0) return false;
        const price = this.term("contract", x.contract_id, "price_cents", line.date);
        if (new Set(meanings.get(x.counterparty_party_id).map((y) => y.category_id)).size > 1) return false;
        return !(price != null && Math.abs(line.cents) > 2 * Math.abs(Number(price))) && this.namesParty(line, x.counterparty_party_id);
      });
      if (k && (!line.cls.category_id || this.catKind(k.category_id) === "income")) { line.cls.category_id = k.category_id; line.cls.contract_id = k.contract_id; line.cls.via = "contract"; }
    }
    // History: what this household decided about the same merchant elsewhere.
    for (const line of this.lines) {
      if (!line.cls.category_id && dict.has(line.cls.norm)) { line.cls.category_id = dict.get(line.cls.norm).category_id; line.cls.via = "history"; }
    }
  }
  catKind(id) { const c = this.categories.get(id); return c ? c.kind : null; }
  // A party's own name, or an alias, in the line: a person by initial and surname, anyone else by the first two words that are theirs.
  namesParty(l, id) {
    const p = this.parties.get(id);
    if (!p) return false;
    const words = String(l.desc).toUpperCase().split(/[^A-Z0-9]+/);
    if (this.aliasRows.some((a) => a.subject_type === "party" && a.subject_id === id && normRef(l.desc).includes(normRef(a.value)))) return true;
    const parts = String(p.name).toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 1);
    if (p.kind === "person") { const first = parts[0], last = parts[parts.length - 1]; return words.some((w, i) => i > 0 && parts.length > 1 && w === last && (words[i - 1] === first || words[i - 1] === first[0])); }
    const own = parts.filter((w) => !STOP_WORDS.has(w) && w.length > 2).slice(0, 2);
    return own.length > 0 && own.every((w) => words.includes(w));
  }
  // Rules scoped to another account do not apply here. A rule with a priority is tried first, highest first, and beats any length.
  scopedModel(account, cents) {
    this.scoped = this.scoped || new Map();
    const way = cents > 0 ? "credit" : "debit", key = `${account}|${way}`;
    if (!this.scoped.has(key)) this.scoped.set(key, { rules: this.merchantModel.rules.filter((r) => (!r._r.account_id || r._r.account_id === account) && (!r._r.direction || r._r.direction === way)), merMemo: new Map() });
    return this.scoped.get(key);
  }
  // Compiled once, and a miss costs no dictionary scan: a household can carry a long ordered list. The first hit is read in full.
  ruleFor(line) {
    this.prioritised = this.prioritised || this.merchantModel.rules.filter((r) => r._r.priority != null).sort((a, b) => b._r.priority - a._r.priority).map((r) => ({ r, x: Engine.compileRule(r) }));
    if (!this.prioritised.length) return null;
    const probe = Engine.ruleProbe(line.desc), way = line.cents > 0 ? "credit" : "debit";
    for (const { r, x } of this.prioritised) {
      if ((r._r.account_id && r._r.account_id !== line.account) || (r._r.direction && r._r.direction !== way)) continue;
      if (Engine.ruleHit(x, probe)) return Engine.merchant(line.desc, { rules: [r], merMemo: new Map() });
    }
    return null;
  }

  // ---------- step: payroll ----------
  recognisePayroll() {
    const slips = this.collapseDocs("payslip");
    const open = this.lines.filter((l) => l.cents > 0);
    const byAmount = groupBy(open, (l) => l.cents);
    for (const o of slips) {
      const p = o.payload;
      const person = this.partyOf(p.person_ref, p.pay_date);
      const employer = this.partyOf(p.employer_ref, p.pay_date) || p.employer_ref;
      const contract = (this.ctx.setup.contract || []).find((c) => c.kind === "employment" && c.holder_party_id === person && c.counterparty_party_id === employer) || null;
      const fundLink = contract ? activeOn(this.links.filter((k) => k.relation === "contributes_to" && k.from_id === contract.contract_id), p.pay_date)[0] : null;
      const named = fundLink ? fundLink.to_id : contract ? this.term("contract", contract.contract_id, "super_fund", p.pay_date) : null;
      // contributes_to may name the member account or the fund's contract. Both are the same money, and it meets the fund at the account.
      const fund = named && this.contracts.has(named) ? this.contracts.get(named).account_id || this.defaultFund(person) : named;
      const key = `wage|${person}|${employer}|${p.pay_date}|${p.net_cents}`;
      const ev = this.event({ key, kind: "wage", occurred_on: p.pay_date, description: `Pay, ${this.name(employer)}`, category_id: "SALARY", person, contract_id: contract && contract.contract_id, amount_cents: p.gross_cents,
        grade: "stated", rule: "payslip", witnesses: this.docWitness(o),
        fields: { gross: p.gross_cents, tax: p.tax_cents, super: nz(p.super_cents), plan_contribution: nz(p.plan_contribution_cents), sacrifice: nz(p.salary_sacrifice_cents), allowance: nz(p.allowance_cents), reimbursement: nz(p.reimbursement_cents), post_tax: nz(p.post_tax_deductions_cents) },
        refs: { person, employer, fund: fund || this.defaultFund(person), plan: planOf(this, person) } });
      const near = (l) => !l.claimed && Math.abs(daysBetween(p.pay_date, l.date)) <= WINDOW.wage;
      const cand = (byAmount.get(p.net_cents) || []).filter(near)
        .sort((a, b) => Math.abs(daysBetween(p.pay_date, a.date)) - Math.abs(daysBetween(p.pay_date, b.date)) || similarity(b.desc, this.name(employer)) - similarity(a.desc, this.name(employer)) || cmp(a.key, b.key));
      // A person can split their pay across accounts: several deposits from this employer that add to the net.
      let parts = cand.length ? [cand[0]] : null;
      if (!parts) {
        const pool = open.filter((l) => near(l) && (similarity(l.desc, this.name(employer)) > 0 || /SALARY|PAY/i.test(l.desc))).map((l) => ({ ...l, cents: -l.cents, src: l }));
        const hit = subsetSum(pool, p.net_cents);
        if (hit && hit.length > 1) parts = hit.map((x) => x.src);
      }
      if (parts) {
        for (const l of parts) {
          this.claim(l, "wage_receipt");
          this.event({ key: `wage_receipt|${l.key}`, kind: "wage_receipt", occurred_on: l.date, description: l.desc, merchant: this.name(employer), category_id: "SALARY", person, amount_cents: l.cents, grade: "corroborated", rule: "payslip+bank",
            witnesses: [...this.lineWitness(l, "clears"), { obs_id: o.obs_id, role: "corroborates", amount_cents: p.net_cents }], fields: { amount: l.cents }, refs: { account: l.account, employer }, line: l });
          ev.witnesses.push({ obs_id: l.witnesses[0].obs_id, role: "corroborates", amount_cents: l.cents });
        }
        ev.grade = "corroborated";
      } else {
        this.fault("payslip_without_deposit", o, `Payslip of ${p.pay_date} shows net ${p.net_cents / 100} with no bank line.`, "Find the deposit, or check the account the employer pays into.", p.net_cents);
      }
    }
  }
  // A salary deposit with no payslip is income on the bank's word alone: provisional, net, with a question. It upgrades when the payslip arrives.
  recogniseUnmatchedWages() {
    for (const l of this.lines) {
      if (l.claimed || l.cents <= 0 || l.cls.category_id !== "SALARY") continue;
      this.claim(l, "wage_unmatched");
      this.event({ key: `wage_unmatched|${l.key}`, kind: "wage_unmatched", occurred_on: l.date, description: l.desc, merchant: l.cls.merchant, category_id: "SALARY", person: l.cls.person, amount_cents: l.cents, status: "provisional", grade: "stated", rule: "bank_only", witnesses: this.lineWitness(l), fields: { amount: l.cents }, refs: { account: l.account }, line: l });
      this.review.push({ kind: "deposit_without_payslip", ref: l.key, amount_cents: l.cents, what: `A salary deposit of ${l.cents / 100} on ${l.date} has no payslip.`, do: "Add the payslip. Until then gross, tax and super for this pay are unknown." });
    }
  }
  defaultFund(person) {
    const row = (this.ctx.setup.account || []).find((a) => a.type === "super" && this.ownersOf("account", a.account_id, "2100-01-01").some((x) => x.party_id === person));
    return row ? row.account_id : `SUPER-${person}`;
  }
  name(id) { const p = this.parties.get(id); return p ? p.name : id; }

  // ---------- step: rental ----------
  /* An agent is an account. A statement says what it owes; every credit from it pays that down. A credit normally answers one statement, and one that does not
     (two part payments, a late one, a new agent's name) is still the agent's money, so what is left at the end is what the agent still holds. */
  recogniseRental() {
    const short = [];
    const receipt = (l, assetId) => {
      this.claim(l, "rent_receipt");
      const own = l.cls.via === "decision" || l.cls.via === "rule" ? l.cls.category_id : null;
      this.event({ key: `rent_receipt|${l.key}`, kind: "rent_receipt", occurred_on: l.date, description: l.desc, merchant: l.cls.merchant, category_id: l.cents > 0 ? (this.catKind(own) === "income" ? own : "RENT-INC") : own || "RENT-MGMT", asset_id: assetId, amount_cents: l.cents, grade: "corroborated", rule: "owner_statement+bank",
        witnesses: this.lineWitness(l, "clears"), fields: { amount: l.cents }, refs: { account: l.account, property: assetId }, line: l });
    };
    for (const o of this.collapseDocs("owner_statement")) {
      const p = o.payload;
      const assetId = this.assets.has(p.property_ref) ? p.property_ref : this.alias("asset", p.property_ref, p.period_end);
      if (!assetId) { this.fault("unresolved_property", o, `No property for ${p.property_ref}.`); continue; }
      const serving = activeOn(this.links.filter((k) => k.relation === "serves" && k.to_id === assetId), p.period_end).map((k) => k.from_id);
      const account = serving[0] || (this.assets.get(assetId) || {}).account_id;
      let repairs = nz(p.repairs_cents), fees = p.fees_cents;
      // An agent can net a repair into its fees box and still list it.
      if (!repairs) {
        const listed = (p.lines || []).filter((x) => /repair|maint/i.test(`${x.schedule_line || ""} ${x.description || ""}`)).reduce((s, x) => s + nz(x.money_out_cents), 0);
        if (listed && listed <= fees) { repairs = listed; fees -= listed; }
      }
      const other = nz(p.other_expenses_cents);
      const key = `rent_statement|${assetId}|${p.period_start}|${p.period_end}`;
      this.event({ key, kind: "rent_statement", occurred_on: p.period_end, description: `Owner statement, ${this.assetName(assetId)}`, category_id: "RENT-INC", asset_id: assetId, amount_cents: p.gross_rent_cents, grade: "stated", rule: "owner_statement",
        witnesses: this.docWitness(o), fields: { rent: p.gross_rent_cents, fees, repairs, other }, refs: { property: assetId } });
      const net = p.disbursed_cents ?? p.gross_rent_cents - fees - repairs - other;
      if (net !== p.gross_rent_cents - fees - repairs - other) this.fault("owner_statement_arithmetic", o, `Owner statement ${p.period_end} does not add up.`, "", net);
      if (!net && !p.gross_rent_cents) continue;
      const lo = p.period_start, hi = addDays(p.period_end, WINDOW.rent_disbursement);
      const candidates = (this.linesByAccount.get(account) || []).filter((l) => !l.claimed && l.date >= lo && l.date <= hi && (AGENT_LINE.test(l.desc) || this.agentHint(l, p) || l.cls.category_id === "RENT-INC"));
      let chosen = null;
      const exact = candidates.find((l) => l.cents === net);
      if (exact) chosen = [exact];
      else {
        const inMonth = candidates.filter((l) => monthOf(l.date) === monthOf(p.period_end));
        if (inMonth.length && inMonth.reduce((s, l) => s + l.cents, 0) === net) chosen = inMonth;
        else { const hit = subsetSum(candidates.filter((l) => l.cents > 0), net); if (hit) chosen = hit; }
      }
      // The last statement's disbursement can land after the files stop: an open item, not a question.
      const lastHeld = this.lines.reduce((m, l) => (l.date > m ? l.date : m), "");
      if (!chosen && hi > lastHeld) continue;
      if (!chosen) { short.push({ o, p, assetId, account, net }); continue; }
      for (const l of chosen) receipt(l, assetId);
    }
    for (const [assetId, rows] of groupBy(short, (x) => x.assetId)) {
      const owed = rows.reduce((s, x) => s + x.net, 0), from = rows.map((x) => x.p.period_start).sort()[0], to = addDays(rows.map((x) => x.p.period_end).sort().pop(), 45);
      const paid = (this.linesByAccount.get(rows[0].account) || []).filter((l) => !l.claimed && l.cents > 0 && l.date >= from && l.date <= to && (AGENT_LINE.test(l.desc) || l.cls.category_id === "RENT-INC") && !/\b(OSKO|PAYID)\b/i.test(l.desc)).sort((a, b) => cmp(a.date, b.date) || cmp(a.key, b.key));
      let got = 0;
      for (const l of paid) { if (got + l.cents > owed) continue; receipt(l, assetId); got += l.cents; }
      if (got !== owed) this.fault("owner_statement_unmatched", rows[0].o, `Owner statements for ${this.assetName(assetId)} from ${from} disburse ${owed / 100} and the bank lines add to ${got / 100}.`, "Check the account the agent pays into.", owed - got);
    }
  }
  agentHint(l, p) { return p.agent_ref && similarity(l.desc, p.agent_ref) > 0; }
  assetName(id) { const a = this.assets.get(id); return a ? a.name : id; }

  // ---------- step: loans ----------
  loanOf(account) { return (this.ctx.setup.contract || []).find((c) => c.kind === "loan" && c.account_id === account) || null; }
  interestCategory(loanContract, assetId, on) {
    if (assetId) {
      const use = this.term("asset", assetId, "use", on);
      if (use === "rental") return "RENT-INT";
      if (use === "owner_occupied" || use === "holiday" || use === "vacant") return use === "vacant" ? "RENT-INT" : "HOME-INT";
    }
    return (loanContract && loanContract.category_id) || "HOME-INT";
  }
  /* A loan's own lines, where held, are the detail and its statement is a control. Where only a statement is held, it recognises.
     Lender-to-lender movements have no bank side. Bank lines clear repayments by the period's total: a lump sum and the
     monthly payment arrive as two bank lines and may show on the lender's side as one. */
  recogniseLoans() {
    const statements = groupBy(this.collapseDocs("loan_statement"), (o) => this.accountOf(o, o.payload.account_ref, o.payload.period_end));
    const loanAccounts = new Set([...statements.keys(), ...(this.ctx.setup.account || []).filter((a) => a.type === "loan").map((a) => a.account_id)]);
    for (const loan of [...loanAccounts].filter(Boolean).sort()) {
      const contract = this.loanOf(loan);
      const docs = statements.get(loan) || [];
      const lines = (this.linesByAccount.get(loan) || []).slice().sort((a, b) => cmp(a.date, b.date) || a.seq - b.seq);
      const periods = new Map();
      const period = (m) => { if (!periods.has(m)) periods.set(m, { m, doc: null, interest: [], fees: [], applied: [], redraws: [], payout: null }); return periods.get(m); };
      for (const o of docs) period(monthOf(o.payload.period_end)).doc = o;
      for (const l of lines) {
        const q = period(monthOf(l.date));
        this.claim(l, "loan_line");
        const item = { date: l.date, cents: Math.abs(l.cents), witnesses: this.lineWitness(l), desc: l.desc };
        if (l.cents < 0 && /INTEREST/i.test(l.desc)) q.interest.push(item);
        else if (l.cents < 0 && /FEE/i.test(l.desc)) q.fees.push(item);
        else if (l.cents > 0) q.applied.push(item);
        else q.redraws.push(item);
      }
      for (const q of periods.values()) {
        const o = q.doc, p = o ? o.payload : null;
        if (o) {
          const on = p.period_end, ctl = this.docWitness(o, q.interest.length || q.applied.length ? "control" : "recognises");
          if (!q.interest.length && p.interest_cents) q.interest.push({ date: on, cents: p.interest_cents, witnesses: ctl });
          else if (q.interest.length) q.interest[0].witnesses.push(...ctl);
          if (!q.fees.length && p.fees_cents) q.fees.push({ date: on, cents: p.fees_cents, witnesses: ctl });
          if (!q.applied.length && p.repayments_cents) q.applied.push({ date: on, cents: p.repayments_cents, witnesses: ctl });
          else if (q.applied.length) q.applied[0].witnesses.push(...ctl);
          if (!q.redraws.length && p.redraws_cents) q.redraws.push({ date: on, cents: p.redraws_cents, witnesses: ctl });
          if (p.payout_cents) {
            const to = this.accountOf({ source_id: null }, p.payout_to_ref, on);
            if (!to) this.fault("refinance_target_unknown", o, `Payout of ${p.payout_cents / 100} names no known loan.`, "Add the new loan.", p.payout_cents);
            else {
              this.event({ key: `loan_payout|${loan}|${on}`, kind: "loan_payout", occurred_on: on, description: `Refinance out of ${this.accountName(loan)}`, contract_id: contract && contract.contract_id, amount_cents: p.payout_cents, grade: "stated", rule: "loan_statement",
                witnesses: this.docWitness(o, "control"), fields: { amount: p.payout_cents, fee: nz(p.discharge_fee_cents) }, refs: { old_loan: loan, new_loan: to } });
              this.capitalLoans = this.capitalLoans || new Map();
              this.capitalLoans.set(to, (this.capitalLoans.get(to) || 0) + p.payout_cents + nz(p.discharge_fee_cents));
            }
          }
        }
        for (const it of q.interest) {
          const purposes = contract ? activeOn(this.links.filter((k) => k.relation === "funds_purpose" && k.from_id === contract.contract_id), it.date) : [];
          const parts = purposes.length ? this.split(it.cents, purposes.map((k) => ({ key: k.to_id, weight: k.share_bps || 10000 }))) : [{ key: contract && contract.asset_id, cents: it.cents }];
          for (const part of parts) {
            const category = this.interestCategory(contract, part.key, it.date);
            this.event({ key: `loan_interest|${loan}|${it.date}|${part.key}`, kind: "loan_interest", occurred_on: it.date, description: `Interest, ${this.accountName(loan)}`, category_id: category, asset_id: part.key || null, contract_id: contract && contract.contract_id, amount_cents: part.cents, grade: "stated", rule: "lender",
              witnesses: it.witnesses, fields: { amount: part.cents }, refs: { loan, category } });
          }
        }
        for (const it of q.fees) this.event({ key: `loan_fee|${loan}|${it.date}|${it.cents}`, kind: "loan_fee", occurred_on: it.date, description: it.desc || `Fees, ${this.accountName(loan)}`, category_id: "FEES", contract_id: contract && contract.contract_id, amount_cents: it.cents, grade: "stated", rule: "lender", witnesses: it.witnesses, fields: { amount: it.cents }, refs: { loan, category: "FEES" } });
        for (const it of q.applied) this.event({ key: `loan_applied|${loan}|${it.date}|${it.cents}`, kind: "loan_applied", occurred_on: it.date, description: `Repayment applied, ${this.accountName(loan)}`, contract_id: contract && contract.contract_id, amount_cents: it.cents, grade: "stated", rule: "lender", witnesses: it.witnesses, fields: { amount: it.cents }, refs: { loan } });
        for (const it of q.redraws) {
          const m = this.lines.find((x) => !x.claimed && x.cents === it.cents && monthOf(x.date) === q.m);
          if (!m) {
            // Money that went straight to a seller still moved the loan. It posts, and asks.
            this.fault("loan_redraw_unmatched", loan, `Redraw of ${it.cents / 100} in ${q.m} has no matching bank line.`, "Is it a new drawing that went straight to a seller?", it.cents);
            this.event({ key: `loan_advance|${loan}|${it.date}|${it.cents}`, kind: "loan_advance", occurred_on: it.date, description: it.desc || `Advance, ${this.accountName(loan)}`, contract_id: contract && contract.contract_id, amount_cents: it.cents, grade: "stated", rule: "lender", witnesses: it.witnesses, fields: { amount: it.cents }, refs: { loan } });
            continue;
          }
          this.claim(m, "loan_redraw");
          this.event({ key: `loan_redraw|${m.key}`, kind: "loan_redraw", occurred_on: m.date, description: m.desc, amount_cents: m.cents, grade: "corroborated", rule: "lender+bank", witnesses: [...it.witnesses, ...this.lineWitness(m, "clears")], fields: { amount: m.cents }, refs: { loan, account: m.account }, line: m });
        }
        const want = q.applied.reduce((s2, it) => s2 + it.cents, 0);
        if (!want) continue;
        const tokens = ["LOAN"]; for (const a of this.aliasRows) if (a.subject_type === "account" && a.subject_id === loan) tokens.push(normRef(a.value));
        let cands = this.lines.filter((l) => !l.claimed && l.cents < 0 && monthOf(l.date) === q.m && this.loanFor(l, tokens, contract));
        if (cands.reduce((s2, l) => s2 - l.cents, 0) !== want) {
          // Several loans can pay out of one month. The amounts say which lines belong to this one.
          const pool = this.lines.filter((l) => !l.claimed && l.cents < 0 && monthOf(l.date) === q.m && /LOAN|REPAYMENT|MORTGAGE/i.test(l.desc)).sort((a, b) => a.cents - b.cents || cmp(a.key, b.key));
          const hit = subsetSum(pool, want);
          if (hit) cands = hit;
        }
        const total = cands.reduce((s2, l) => s2 - l.cents, 0);
        if (total !== want) (this.loanGaps = this.loanGaps || []).push({ loan, month: q.m, want, total, on: q.applied[q.applied.length - 1].date });
        for (const l of cands) {
          this.claim(l, "loan_payment");
          const category = l.cls.category_id || (contract && contract.category_id) || "MORTGAGE";
          this.event({ key: `loan_payment|${l.key}`, kind: "loan_payment", occurred_on: l.date, description: l.desc, merchant: l.cls.merchant, category_id: category, contract_id: contract && contract.contract_id, asset_id: contract && contract.asset_id, amount_cents: -l.cents, grade: "corroborated", rule: "lender+bank",
            witnesses: this.lineWitness(l, "clears"), fields: { amount: -l.cents }, refs: { loan, account: l.account }, line: l });
        }
      }
    }
    this.settleLoanGaps(statements);
  }
  /* A refinance need not call itself one. The old lender shows a final repayment no bank line paid; a new lender opens near that date owing that much,
     plus any cash taken out, which lands in the bank as a credit. The amounts prove it. Anything else stays a question. */
  settleLoanGaps(statements) {
    for (const g of this.loanGaps || []) {
      const gap = g.want - g.total;
      const taken = gap > 0 && [...statements].some(([other, docs]) => {
        if (other === g.loan || (this.capitalLoans && this.capitalLoans.get(other))) return false;
        const first = [...docs].sort((a, b) => cmp(a.payload.period_start, b.payload.period_start))[0];
        if (!first || Math.abs(daysBetween(g.on, first.payload.period_start)) > WINDOW.bill) return false;
        const out = first.payload.opening_cents - gap;
        if (out < 0) return false;
        const line = out ? this.lines.find((l) => !l.claimed && l.cents === out && Math.abs(daysBetween(g.on, l.date)) <= WINDOW.bill) : null;
        if (out && !line) return false;
        const on = line ? line.date : g.on, contract = this.loanOf(other);
        this.event({ key: `loan_takeout|${g.loan}|${other}|${on}`, kind: "loan_takeout", occurred_on: on, description: `Refinance out of ${this.accountName(g.loan)}`, contract_id: contract && contract.contract_id, amount_cents: gap, grade: "stated", rule: "lender+lender",
          witnesses: this.docWitness(first, "control"), fields: { amount: gap }, refs: { old_loan: g.loan, new_loan: other } });
        if (line) {
          this.claim(line, "loan_redraw");
          this.event({ key: `loan_redraw|${line.key}`, kind: "loan_redraw", occurred_on: line.date, description: line.desc, amount_cents: line.cents, grade: "corroborated", rule: "lender+bank", witnesses: this.lineWitness(line, "clears"), fields: { amount: line.cents }, refs: { loan: other, account: line.account }, line });
        }
        this.capitalLoans = this.capitalLoans || new Map();
        this.capitalLoans.set(other, gap + out);
        return true;
      });
      if (!taken) this.fault("loan_repayment_gap", g.loan, `${g.month}: the lender shows repayments of ${g.want / 100}; bank lines add to ${g.total / 100}.`, "Check for a lump sum, a redraw, or a repayment from another account.", gap);
    }
  }
  loanFor(line, tokens, contract) {
    if (line.cls.contract_id && contract) return line.cls.contract_id === contract.contract_id;
    if (line.cls.event_kind === "loan_payment") return !contract || !line.cls.contract_id;
    const up = normRef(line.desc);
    const named = tokens.slice(1).some((t) => t && up.includes(t));
    if (named) return true;
    if (!/LOAN/.test(up)) return false;
    // "HARBOUR BANK INVESTMENT LOAN INTEREST": choose the loan whose purpose word appears, else the only loan.
    const loans = (this.ctx.setup.contract || []).filter((c) => c.kind === "loan" && c.account_id);
    if (loans.length === 1) return true;
    const words = String(contract ? contract.name : "").toUpperCase().split(/[^A-Z]+/).filter((w) => w.length > 3 && w !== "LOAN" && w !== "TERMS");
    return words.some((w) => up.includes(w));
  }
  accountName(id) { const a = this.accounts.get(id); return a ? a.name : id; }
  split(cents, parts) { return require("./util").allocate(cents, parts); }

  // ---------- step: own transfers, once everything with a better explanation has claimed its lines ----------
  isTransferLine(l) {
    if (l.noPair) return false;
    const c = l.cls.category_id;
    if (c && this.catKind(c) === "transfer") return true;
    if (!c && l.cls.dictKind === "transfer" && !l.cls.unplaced) return true;
    return false;
  }
  // Money lent to or borrowed from a person or the household's own company sits on an account that holds the debt. A line naming them as a loan moves money to or from it; it is neither spending nor income.
  recogniseLending() {
    const side = (p) => p && (p.kind === "person" || OWN_ENTITY.has(p.kind));
    for (const k of (this.ctx.setup.contract || []).filter((c) => c.kind === "loan" && c.account_id && side(this.parties.get(c.counterparty_party_id)))) {
      // The line must say it is a loan. A lender can also be an employer, a relative, or one of two names on a line.
      for (const l of this.lines.filter((x) => !x.claimed && x.account !== k.account_id && /\b(LOAN|REPAY|REPAYMENT|LENT|BORROW)\b/i.test(x.desc) && this.namesParty(x, k.counterparty_party_id))) {
        this.claim(l, "transfer");
        const out = l.cents < 0, cents = Math.abs(l.cents);
        this.event({ key: `transfer|${l.key}|lent`, kind: "transfer", occurred_on: l.date, description: l.desc, category_id: "TRANSFER", contract_id: k.contract_id, amount_cents: cents, grade: "stated", rule: "contract",
          witnesses: this.lineWitness(l), fields: { amount: cents }, refs: { from_account: out ? l.account : k.account_id, to_account: out ? k.account_id : l.account }, lines: [l] });
      }
    }
  }
  pairTransfers() {
    // One side reading as a transfer is enough: the other side may be a broker's plain "DEPOSIT". An exact opposite amount on another
    // of the household's own accounts within days is a mate. Everything else stays a question.
    const open = this.lines.filter((l) => !l.claimed);
    const byCents = groupBy(open, (l) => l.cents);
    const legs = open.filter((l) => this.isTransferLine(l)).sort((a, b) => cmp(a.date, b.date) || cmp(a.key, b.key));
    for (const leg of legs) {
      if (leg.claimed) continue;
      const unexplained = (c) => this.isTransferLine(c) || !c.cls.category_id || c.cls.category_id === "UNCAT";
      const mates = (byCents.get(-leg.cents) || []).filter((c) => !c.claimed && c.account !== leg.account && unexplained(c) && Math.abs(daysBetween(leg.date, c.date)) <= WINDOW.transfer)
        .sort((a, b) => Number(this.isTransferLine(b)) - Number(this.isTransferLine(a)) || Math.abs(daysBetween(leg.date, a.date)) - Math.abs(daysBetween(leg.date, b.date)) || this.transferHint(b, leg) - this.transferHint(a, leg) || cmp(a.key, b.key));
      if (!mates.length) continue;
      const d = leg.cents < 0 ? leg : mates[0], c = leg.cents < 0 ? mates[0] : leg;
      this.claim(d, "transfer"); this.claim(c, "transfer");
      const category = d.cls.category_id || c.cls.category_id || "TRANSFER";
      this.event({ key: `transfer|${d.key}|${c.key}`, kind: "transfer", occurred_on: d.date, settled_on: c.date, leg_dates: { [d.account]: d.date, [c.account]: c.date }, description: d.desc, category_id: category, amount_cents: c.cents, grade: "corroborated", rule: "pair",
        witnesses: [...this.lineWitness(d, "recognises"), ...this.lineWitness(c, "clears")], fields: { amount: c.cents }, refs: { from_account: d.account, to_account: c.account }, lines: [d, c] });
    }
    this.pairUnexplained();
    for (const l of this.lines) {
      if (l.claimed || !this.isTransferLine(l)) continue;
      this.claim(l, "open_transfer");
      this.event({ key: `open_transfer|${l.key}`, kind: "open_transfer", occurred_on: l.date, description: l.desc, category_id: l.cls.category_id || "TRANSFER", amount_cents: l.cents, status: "open", grade: "stated", rule: "unpaired",
        witnesses: this.lineWitness(l), fields: { amount: l.cents }, refs: { account: l.account }, line: l });
      this.review.push({ kind: "unpaired_transfer", ref: l.key, question: l.cls.norm || l.desc, amount_cents: l.cents, what: `${l.desc} has no other side in the household's accounts.`, do: "Is this someone outside the household? If so it is spending, income or a loan to them." });
    }
  }
  /* Neither side was named a transfer, but both are unexplained, opposite to the cent, days apart, on two of the household's own accounts. A rail word says money moved;
     something must also say it stayed in the household: a member by initial and surname, a word the two lines share, or the other account's name. Only a person can
     make that a stranger. The same evidence pairs two sides that differ by a small fee taken off the way through. */
  pairUnexplained() {
    const open = this.lines.filter((l) => !l.claimed && !l.noPair && !l.excluded && (!l.cls.category_id || l.cls.category_id === "UNCAT"));
    const cash = (l) => { const a = this.accounts.get(l.account); return a && !["loans", "super"].includes(a.reporting_group); };
    const pool = open.filter(cash), byCents = groupBy(pool, (l) => l.cents);
    const debits = pool.filter((l) => l.cents < 0).sort((a, b) => cmp(a.date, b.date) || cmp(a.key, b.key));
    const nearest = (d) => (a, b) => Math.abs(daysBetween(d.date, a.date)) - Math.abs(daysBetween(d.date, b.date)) || similarity(b.desc, d.desc) - similarity(a.desc, d.desc) || cmp(a.key, b.key);
    const fits = (d, c) => !c.claimed && c.account !== d.account && Math.abs(daysBetween(d.date, c.date)) <= WINDOW.transfer && (this.saysMoved(d) || this.saysMoved(c)) && this.staysHome(d, c);
    const pair = (d, c, fee) => {
      this.claim(d, "transfer"); this.claim(c, "transfer");
      this.event({ key: `transfer|${d.key}|${c.key}`, kind: "transfer", occurred_on: d.date, settled_on: c.date, leg_dates: { [d.account]: d.date, [c.account]: c.date }, description: d.desc, category_id: "TRANSFER", amount_cents: c.cents, grade: "stated", rule: "pair_unexplained",
        witnesses: [...this.lineWitness(d, "recognises"), ...this.lineWitness(c, "clears")], fields: { amount: c.cents }, refs: { from_account: d.account, to_account: c.account }, lines: [d, c] });
      if (fee) this.event({ key: `purchase|${d.key}|fee`, kind: "purchase", occurred_on: d.date, description: `Fee taken off ${d.desc}`, category_id: "FEES", amount_cents: -fee, grade: "stated", rule: "pair_unexplained", witnesses: this.lineWitness(d, "corroborates"), fields: { cost: fee }, refs: { account: d.account, category: "FEES" } });
    };
    for (const d of debits) {
      const c = (byCents.get(-d.cents) || []).filter((x) => fits(d, x)).sort(nearest(d))[0];
      if (c) pair(d, c, 0);
    }
    const credits = pool.filter((l) => l.cents > 0);
    for (const d of debits) {
      if (d.claimed) continue;
      const c = credits.filter((x) => { const fee = -d.cents - x.cents; return fee > 0 && fee <= Math.min(3000, -d.cents * 0.02) && fits(d, x); }).sort(nearest(d))[0];
      if (c) pair(d, c, -d.cents - c.cents);
    }
  }
  saysMoved(l) { return String(l.desc).toUpperCase().split(/[^A-Z0-9]+/).some((w) => TRANSFER_WORDS.has(w)); }
  namesMember(l) {
    const words = String(l.desc).toUpperCase().split(/[^A-Z0-9]+/);
    const member = (id) => (this.setup.membership || []).some((m) => m.party_id === id && m.valid_from <= l.date && (m.valid_to == null || l.date < m.valid_to));
    return (this.setup.party || []).some((p) => {
      if (p.kind !== "person" || !member(p.party_id)) return false;
      const parts = String(p.name).toUpperCase().split(/\s+/), first = parts[0], last = parts[parts.length - 1];
      return words.some((w, i) => i > 0 && ((parts.length > 1 && w === last && (words[i - 1] === first || words[i - 1] === first[0])) || (w === first && first.length > 2 && ["TO", "FROM"].includes(words[i - 1]))));
    });
  }
  staysHome(d, c) {
    if (this.namesMember(d) || this.namesMember(c) || this.transferHint(d, c) || this.transferHint(c, d)) return true;
    // A shared word can be a town. A shared reference number is the same payment.
    const numbers = (l) => new Set(String(l.desc).split(/[^0-9]+/).filter((w) => w.length >= 4));
    const theirs = numbers(c);
    return [...numbers(d)].some((w) => theirs.has(w));
  }
  transferHint(a, b) {
    const name = this.accountName(b.account).toUpperCase();
    return String(a.desc).toUpperCase().split(/\s+/).filter((w) => w.length > 3 && name.includes(w)).length;
  }

  // ---------- step: everything else on a line is everyday ----------
  recogniseEveryday() {
    for (const l of this.lines) {
      if (l.claimed || l.excluded) continue;
      const c = l.cls;
      let kind = c.event_kind;
      let category = c.category_id;
      if (kind === "on_behalf" || kind === "recovery" || this.catKind(category) === "pass_through") {
        const k = kind || (l.cents < 0 ? "on_behalf" : "recovery");
        const party = c.party || c.person || "third-party";
        this.claim(l, k);
        this.event({ key: `${k}|${l.key}`, kind: k, occurred_on: l.date, description: l.desc, merchant: c.merchant, category_id: category, person: c.person, amount_cents: Math.abs(l.cents), grade: this.lineGrade(l), rule: c.via, witnesses: this.lineWitness(l), fields: { amount: Math.abs(l.cents) }, refs: { account: l.account, party }, line: l });
        continue;
      }
      if (kind && kind.startsWith("x_")) {
        this.claim(l, kind);
        this.event({ key: `${kind}|${l.key}`, kind, occurred_on: l.date, description: l.desc, merchant: c.merchant, category_id: category, person: c.person, amount_cents: Math.abs(l.cents), grade: this.lineGrade(l), rule: "x_ decision", witnesses: this.lineWitness(l), fields: { amount: Math.abs(l.cents) }, refs: { account: l.account, category }, line: l });
        continue;
      }
      if (l.split) {
        const total = l.split.reduce((s2, x) => s2 + x.amount_cents, 0);
        if (total === l.cents) {
          this.claim(l, "split");
          l.split.forEach((part, i) => {
            // A part in a pass-through category is someone else's money (SPEC 4.4c): the household's share of the line is a cost, the rest is owed by that party. It posts to receivable:{party}, so the other side clears it.
            const third = this.catKind(part.category_id) === "pass_through";
            const pk = third ? (part.amount_cents < 0 ? "on_behalf" : "recovery") : this.catKind(part.category_id) === "income" ? "income" : part.amount_cents < 0 ? "purchase" : "refund";
            this.event({ key: `${pk}|${l.key}|${i}`, kind: pk, occurred_on: l.date, description: part.note || l.desc, merchant: c.merchant, category_id: part.category_id, person: part.person || c.person, asset_id: part.asset_id || c.asset_id || this.assetOfAccount(l.account, l.date), amount_cents: third ? Math.abs(part.amount_cents) : part.amount_cents, grade: this.lineGrade(l), rule: "split", claimant: part.claimant,
              witnesses: i === 0 ? this.lineWitness(l) : this.lineWitness(l, "corroborates"), fields: pk === "purchase" ? { cost: -part.amount_cents } : { amount: third ? Math.abs(part.amount_cents) : part.amount_cents }, refs: third ? { account: l.account, party: part.party || part.person || "third-party" } : { account: l.account, category: part.category_id }, line: i === 0 ? l : undefined });
          });
          continue;
        }
        this.fault("split_does_not_add", l.key, `The split of ${l.desc} adds to ${total / 100}, not ${l.cents / 100}.`, "Fix the parts. The line stays whole until they add up.", l.cents - total);
      }
      // A credit is a refund only from someone the household paid, or if it says so. A person-to-person payment the dictionary guessed at is not an answer, and it is money nobody has explained.
      const refund = l.cents > 0 && (/REFUND|REVERSAL|CHARGEBACK|RETURN/i.test(l.witnesses.map((o) => o.payload.description).join(" ")) || (!this.saysMoved(l) && this.paidBefore(l) >= l.cents && this.largestPaid(l) >= l.cents));
      if (category && l.cents > 0 && c.via === "dictionary" && this.catKind(category) === "expense" && !refund && this.saysMoved(l)) category = null;
      // A contract or a guess cannot make a refund of a credit larger than anything ever paid to that payee.
      if (category && l.cents > 0 && (c.via === "dictionary" || c.via === "contract") && this.catKind(category) === "expense" && this.largestPaid(l) > 0 && l.cents > this.largestPaid(l)) category = null;
      if (!category) {
        category = "UNCAT";
        this.review.push({ kind: "uncategorised", ref: l.key, question: c.norm || l.desc, amount_cents: l.cents, what: `What is ${l.desc}?`, do: "Pick a category. The answer is kept across rebuilds." });
      }
      // A very large credit no document explains may be an asset leaving. The file that would prove it may not have been read.
      if (category === "UNCAT" && l.cents >= SALE_FLOOR && /SALE|SETTLEMENT|CONVEYANC|SOLICITOR|VENDOR|PROCEEDS/i.test(l.desc)) {
        for (const a of this.ctx.setup.asset || []) if (a.kind === "property" && a.account_id) this.review.push({ kind: "possible_sale", ref: `${a.account_id}|${l.key}`, amount_cents: l.cents, what: `${l.desc} of ${l.cents / 100} reads like a sale. Was ${a.name} sold?`, do: "Add the settlement statement, or say what this is. Until then the asset stays on the books." });
      }
      const k = this.catKind(category);
      const isIncome = k === "income";
      const ev = isIncome ? "income" : l.cents < 0 ? "purchase" : "refund";
      this.claim(l, ev);
      const fields = ev === "purchase" ? { cost: -l.cents } : { amount: l.cents };
      this.event({ key: `${ev}|${l.key}`, kind: ev, occurred_on: l.date, settled_on: l.valueDate, charged_on: l.valueDate, unexplained: ev === "refund" && category === "UNCAT" && !refund, description: l.desc, merchant: c.merchant, category_id: category, person: c.person, claimant: c.claimant, asset_id: c.asset_id || this.assetOfAccount(l.account, l.date), activity_id: c.activity_id, contract_id: c.contract_id, amount_cents: l.cents, status: category === "UNCAT" || l.provisional ? "provisional" : "recognised", grade: this.lineGrade(l), rule: c.via || "none",
        witnesses: [...this.lineWitness(l), ...(l.docs || []).map((o) => ({ obs_id: o.obs_id, role: "corroborates", amount_cents: l.cents })), ...(l.policyWitness ? [{ obs_id: l.policyWitness.obs_id, role: "corroborates", amount_cents: l.cents }] : [])], fields, refs: { account: l.account, category }, line: l });
    }
  }
  // What the household paid this payee in the year before a credit. A refund cannot be larger.
  // Nor larger than the most ever paid at once: a claim on a policy is not a refund of a premium.
  largestPaid(line) {
    if (!this.paid) this.paid = groupBy(this.lines.filter((l) => l.cents < 0), payee);
    return (this.paid.get(payee(line)) || []).reduce((m, l) => Math.max(m, -l.cents), 0);
  }
  paidBefore(line) {
    if (!this.paid) this.paid = groupBy(this.lines.filter((l) => l.cents < 0), payee);
    return (this.paid.get(payee(line)) || []).filter((l) => l.date <= line.date && daysBetween(l.date, line.date) <= 365).reduce((s, l) => s - l.cents, 0);
  }
  assetOfAccount(account, on) {
    const k = activeOn(this.links.filter((x) => x.relation === "serves" && x.from_id === account), on);
    return k.length === 1 ? k[0].to_id : null;
  }
  lineGrade(l) { return l.balanceAfter != null ? "reconciled" : l.witnesses.length > 1 ? "corroborated" : "stated"; }

  // A person can book what no document says. It carries its decision as evidence.
  recogniseAdjustments() {
    for (const d of this.decisions.filter((x) => x.verb === "adjust")) {
      const v = d.value || {};
      this.event({ key: `adjustment|${d.decision_id}`, kind: "adjustment", occurred_on: v.date, description: d.reason || "Adjustment", category_id: v.category_id, amount_cents: v.amount_cents, grade: "estimated", rule: "setup", fields: { amount: v.amount_cents }, refs: { account: v.account_id, category: v.category_id } });
    }
  }
  // Bills, receipts and childcare statements add detail to a line and change no amount. A bill can say which property a line belongs to.
  corroborate() {
    const attach = (o, cents, on, window, apply) => {
      const options = this.lines.filter((x) => x.cents === -cents && !x.claimed && Math.abs(daysBetween(on, x.date)) <= window && !(x.docs || []).some((q) => q.kind === o.kind));
      const prefer = o.payload.subject_ref ? this.links.filter((k) => k.relation === "serves" && k.to_id === o.payload.subject_ref).map((k) => k.from_id) : [];
      // An amount alone proves little. A line naming the issuer wins, and only a line that names it, or sits on the subject's own account, takes the bill's asset.
      const issuer = o.payload.issuer_ref, named = issuer ? options.filter((x) => similarity(x.desc, issuer) > 0) : [];
      const l = named.find((x) => prefer.includes(x.account)) || named[0] || options.find((x) => prefer.includes(x.account)) || options[0];
      if (!l) return false;
      (l.docs = l.docs || []).push(o);
      if (apply && (!issuer || named.includes(l) || prefer.includes(l.account))) apply(l);
      return true;
    };
    for (const o of this.byKind.get("bill") || []) {
      const p = o.payload;
      const asset = p.subject_ref ? (this.assets.has(p.subject_ref) ? p.subject_ref : this.alias("asset", p.subject_ref, p.bill_date)) : null;
      attach(o, p.amount_cents, p.due_on || p.bill_date, WINDOW.bill, (l) => { if (asset && !l.cls.asset_id) l.cls.asset_id = asset; });
    }
    for (const o of this.byKind.get("receipt") || []) attach(o, o.payload.total_cents, o.payload.date, WINDOW.receipt);
    // One debit can pay for two children. Statements for one provider and period are tried together first.
    for (const [, group] of groupBy(this.byKind.get("childcare_statement") || [], (o) => `${o.payload.provider_ref}|${o.payload.period_end}`)) {
      const total = group.reduce((s, o) => s + o.payload.gap_cents, 0);
      if (group.length > 1 && attach(group[0], total, group[0].payload.period_end, WINDOW.childcare)) {
        const line = this.lines.find((x) => (x.docs || []).includes(group[0]));
        line.docs.push(...group.slice(1));
        continue;
      }
      for (const o of group) attach(o, o.payload.gap_cents, o.payload.period_end, WINDOW.childcare);
    }
  }

  decisionBound(d) {
    if (d.target_type !== "line") return true;
    return this.lines.some((l) => { const [a, b, c] = l.key.split("|"); return l.key === d.target_ref || `${a}|${b}|${c}` === d.target_ref; });
  }
  unitsOn(ref, date, accountRef) {
    const instrument = this.instrumentOf(ref, date);
    let units = 0n;
    const order = { action: 0, buy: 1, adjust: 2, move: 3, sell: 4 };
    // Units are held somewhere: read for one account, a coin moved to another wallet has left it.
    const named = accountRef ? this.accountOf({ source_id: null }, accountRef, date) : null, holding = named ? this.holdingOf(instrument, named) : null;
    const here = (t) => !holding || t.holding === holding;
    for (const t of [...(this.tradeLog || [])].sort((a, b) => cmp(a.date, b.date) || order[a.kind] - order[b.kind] || cmp(a.ref, b.ref))) {
      if (t.instrument !== instrument || t.date > date) continue;
      if (t.kind === "buy" && here(t)) units += t.units;
      if (t.kind === "sell" && here(t)) units -= t.units;
      if (t.kind === "move" && holding) { if (t.from === holding) units -= t.units; if (t.to === holding) units += t.units; }
      if (t.kind === "action" && (t.action === "split" || t.action === "consolidation")) {
        const [a, b] = String(t.ratio).split(":").map(Number);
        units = (units * BigInt(a)) / BigInt(b);
      }
    }
    return units;
  }

  run() {
    this.materialiseTerms();
    this.collapseLines();
    this.classify();
    this.corroborate();
    this.recogniseAdjustments();
    this.recogniseCapital();
    this.recognisePayroll();
    this.recogniseRental();
    this.recogniseLoans();
    this.recogniseSuper();
    this.recogniseMarkets();
    this.recogniseTrusts();
    this.recogniseTax();
    this.recogniseLending();
    this.recogniseUnmatchedWages();
    this.pairTransfers();
    this.recogniseEveryday();
    this.finishOpenings();
    this.revalue();
    // A file can read clean in another currency. Nothing here converts it, so it is counted at face value and says so.
    const base = (this.setup.household && this.setup.household[0] && this.setup.household[0].base_currency) || "AUD";
    for (const a of this.setup.account || []) if (a.currency && a.currency !== base) this.review.push({ kind: "foreign_currency", ref: a.account_id, amount_cents: null, what: `${a.name} is held in ${a.currency} and no rate is held. Net worth counts it at face value.`, do: "Add a dated rate. Until then this balance is not in dollars." });
    return this;
  }
}

require("./resolve-capital")(Resolver);
require("./resolve-markets")(Resolver);

module.exports = { Resolver, dollarsToCents };
