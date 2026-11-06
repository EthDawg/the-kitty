/* Shares, ETFs, RSUs and crypto. Holdings are carried at market; tax cost lives in lots.
   A sale never moves net worth by itself: proceeds leave the holding and the next price moves the rest. */
"use strict";
const { groupBy, cmp, addDays, daysBetween, parseUnits, fmtUnits, unitsValueCents, fyOf, UNIT_SCALE } = require("./util");

const nz = (v) => (v == null ? 0 : v);
const CGT_MONTHS = 12;

module.exports = (Resolver) => {
  const P = Resolver.prototype;

  P.instrumentOf = function (ref, on) {
    if (this.instruments.has(ref)) return ref;
    const a = this.alias("instrument", ref, on);
    if (a) return a;
    for (const i of this.ctx.setup.instrument || []) if (i.code === ref || i.name === ref) return i.instrument_id;
    return null;
  };
  // Which account holds this instrument: an explicit holding account, else the account named.
  P.holdingOf = function (instrument, account) {
    const a = (this.ctx.setup.account || []).find((x) => x.type === "holding" && x.parent_account_id === account && (x.instrument_id === instrument || x.note === instrument))
      || (this.ctx.setup.account || []).find((x) => x.type === "holding" && x.parent_account_id === account)
      || (this.ctx.setup.account || []).find((x) => x.type === "holding" && x.instrument_id === instrument);
    return a ? a.account_id : account;
  };
  P.cashHubOf = function (account) {
    const a = this.accounts.get(account);
    if (a && a.type === "brokerage") return account;
    if (a && a.parent_account_id) return a.parent_account_id;
    return account;
  };

  P.holdingsOfInstrument = function (instrument) {
    return [...new Set((this.tradeLog || []).filter((t) => t.instrument === instrument && t.holding).map((t) => t.holding))];
  };

  P.recogniseMarkets = function () {
    this.tradeLog = [];
    const log = (t) => this.tradeLog.push(t);
    const settleMatch = (cash, cents, date, description, key, role = "settle_cash") => {
      const hit = this.lines.filter((l) => !l.claimed && l.account === cash && l.cents === cents && Math.abs(daysBetween(date, l.date)) <= 7)
        .sort((a, b) => Math.abs(daysBetween(date, a.date)) - Math.abs(daysBetween(date, b.date)) || cmp(a.key, b.key))[0];
      if (!hit) return null;
      this.claim(hit, role);
      return hit;
    };

    for (const o of this.collapseDocs("contract_note")) {
      const p = o.payload;
      const instrument = this.instrumentOf(p.instrument_ref, p.trade_date);
      const account = this.accountOf(o, p.account_ref, p.trade_date);
      if (!instrument || !account) { this.fault("unresolved_trade", o, `Contract note ${p.reference || ""} names an unknown account or instrument.`); continue; }
      const holding = this.holdingOf(instrument, account);
      const cash = this.cashHubOf(account);
      const cents = p.consideration_cents;
      const key = `${account}|${instrument}|${p.side}|${p.trade_date}|${p.units}`;
      const person = this.personOfAccount(holding, p.trade_date);
      if (p.side === "buy") {
        this.event({ key: `trade_buy|${key}`, kind: "trade_buy", occurred_on: p.trade_date, settled_on: p.settlement_date, description: `Buy ${p.units} ${p.instrument_ref}`, person, amount_cents: cents, grade: "stated", rule: "contract_note", witnesses: this.docWitness(o),
          fields: { consideration: cents }, refs: { holding, cash_account: cash }, holding, units: String(p.units), instrument_id: instrument });
        log({ kind: "buy", date: p.trade_date, instrument, holding, person, units: parseUnits(p.units), cost: cents - nz(p.brokerage_cents), incidental: nz(p.brokerage_cents), ref: key, o });
      } else {
        this.event({ key: `trade_sell|${key}`, kind: "trade_sell", occurred_on: p.trade_date, settled_on: p.settlement_date, description: `Sell ${p.units} ${p.instrument_ref}`, person, amount_cents: cents, grade: "stated", rule: "contract_note", witnesses: this.docWitness(o),
          fields: { proceeds: cents }, refs: { holding, cash_account: cash }, holding, units: `-${p.units}`, instrument_id: instrument });
        log({ kind: "sell", date: p.trade_date, instrument, holding, person, units: parseUnits(p.units), proceeds: cents, ref: key, o });
      }
      const line = settleMatch(cash, p.side === "buy" ? -cents : cents, p.settlement_date || p.trade_date, "", key);
      if (line) this.event({ key: `settle_cash|${line.key}`, kind: "settle_cash", occurred_on: line.date, description: line.desc, category_id: "TRANSFER", amount_cents: line.cents, grade: "corroborated", rule: "note+cash", witnesses: this.lineWitness(line, "clears"), fields: { amount: line.cents }, refs: { account: cash }, line });
      else this.fault("trade_unsettled", o, `Trade on ${p.trade_date} has no cash line in ${cash}.`, "", cents);
    }

    for (const o of this.collapseDocs("dividend")) {
      const p = o.payload;
      const instrument = this.instrumentOf(p.instrument_ref, p.pay_date);
      const account = this.accountOf(o, p.account_ref, p.pay_date);
      if (!instrument || !account) { this.fault("unresolved_trade", o, `Dividend names an unknown account or instrument.`); continue; }
      const holding = this.holdingOf(instrument, account);
      const cash = this.cashHubOf(account);
      const person = this.personOfAccount(holding, p.pay_date) || this.personOfAccount(cash, p.pay_date);
      const key = `${account}|${instrument}|${p.pay_date}`;
      const gross = nz(p.franked_cents) + nz(p.unfranked_cents);
      if (p.drp_units) {
        this.event({ key: `drp|${key}`, kind: "drp", occurred_on: p.pay_date, description: `Reinvested dividend, ${p.instrument_ref}`, category_id: "DIVIDEND", person, amount_cents: gross, grade: "stated", rule: "dividend", witnesses: this.docWitness(o),
          fields: { amount: gross }, refs: { holding }, ownerAccount: holding, holding, units: String(p.drp_units), instrument_id: instrument, tax: p.attributed_later ? {} : { franked: nz(p.franked_cents), unfranked: nz(p.unfranked_cents), franking: nz(p.franking_credit_cents) } });
        log({ kind: "buy", date: p.pay_date, instrument, holding, person, units: parseUnits(p.drp_units), cost: gross, incidental: 0, ref: `drp|${key}`, o });
      } else {
        this.event({ key: `dividend|${key}`, kind: "dividend", occurred_on: p.pay_date, description: `Dividend, ${p.instrument_ref}`, category_id: "DIVIDEND", person, amount_cents: gross, grade: "stated", rule: "dividend", witnesses: this.docWitness(o),
          fields: { gross_cash: gross, withholding: nz(p.withholding_cents), net: p.net_cents }, refs: { person: person || "household", cash_account: cash }, ownerAccount: holding, tax: p.attributed_later ? {} : { franked: nz(p.franked_cents), unfranked: nz(p.unfranked_cents), franking: nz(p.franking_credit_cents) } });
        const line = settleMatch(cash, p.net_cents, p.pay_date, "", key, "dividend_receipt");
        if (line) this.event({ key: `dividend_receipt|${line.key}`, kind: "dividend_receipt", occurred_on: line.date, description: line.desc, category_id: "DIVIDEND", amount_cents: line.cents, grade: "corroborated", rule: "registry+cash", witnesses: this.lineWitness(line, "clears"), fields: { amount: line.cents }, refs: { account: cash }, line });
        else this.fault("dividend_unpaid", o, `Dividend of ${p.pay_date} has no cash line in ${cash}.`, "", p.net_cents);
      }
    }

    // Annual tax statements carry components, and adjust cost base. Their cash already arrived quarterly.
    this.distributions = [];
    for (const o of this.collapseDocs("distribution")) {
      const p = o.payload;
      const instrument = this.instrumentOf(p.instrument_ref, p.period_end);
      const account = this.accountOf(o, p.account_ref, p.period_end);
      if (!instrument || !account) { this.fault("unresolved_trade", o, `Distribution statement names an unknown account or instrument.`); continue; }
      const holding = this.holdingOf(instrument, account);
      this.distributions.push({ fy: p.fy, instrument, holding, account, person: this.personOfAccount(holding, p.period_end), p, o });
      log({ kind: "adjust", date: p.period_end, instrument, holding, cents: nz(p.amit_increase_cents) - nz(p.amit_decrease_cents) - nz(p.tax_deferred_cents), ref: `adjust|${account}|${instrument}|${p.fy}`, o });
    }

    for (const o of this.byKind.get("corporate_action") || []) {
      const p = o.payload;
      const instrument = this.instrumentOf(p.instrument_ref, p.effective_on);
      if (!instrument) continue;
      log({ kind: "action", date: p.effective_on, instrument, action: p.action, ratio: p.ratio, cashPerUnit: p.cash_per_unit_cents, ref: `action|${instrument}|${p.effective_on}`, o });
      if (p.action === "return_of_capital" && p.cash_per_unit_cents) {
        // Lot cost goes down and cash comes in: one cheque, not income.
        for (const h of this.holdingsOfInstrument(instrument)) {
          const units = this.unitsOn(instrument, p.effective_on);
          const amount = Math.round(Number(units) / 1e8 * p.cash_per_unit_cents);
          if (!amount) continue;
          const cash = this.cashHubOf(h);
          this.event({ key: `capital_return|${h}|${instrument}|${p.effective_on}`, kind: "capital_return", occurred_on: p.effective_on, description: `Return of capital, ${p.instrument_ref}`, amount_cents: amount, grade: "stated", rule: "corporate_action", witnesses: this.w(o, "recognises"), fields: { amount }, refs: { cash_account: cash, holding: h } });
          const line = settleMatch(cash, amount, p.effective_on, "", "", "dividend_receipt");
          if (line) this.event({ key: `dividend_receipt|${line.key}`, kind: "dividend_receipt", occurred_on: line.date, description: line.desc, category_id: "TRANSFER", amount_cents: line.cents, grade: "corroborated", rule: "action+cash", witnesses: this.lineWitness(line, "clears"), fields: { amount: line.cents }, refs: { account: cash }, line });
        }
      }
    }

    for (const o of this.collapseDocs("vest")) {
      const p = o.payload;
      if (p.status === "scheduled" || p.status === "cancelled") continue;           // a future tranche makes no income; it feeds the forecast only
      if (p.status === "provisional" || p.status === "unconfirmed") { this.fault("unconfirmed_vest", o, `Vest of ${p.vest_date} is not confirmed; an unconfirmed award is unknown, not zero.`); continue; }
      const instrument = this.instrumentOf(p.instrument_ref, p.vest_date);
      const account = p.account_ref ? this.accountOf(o, p.account_ref, p.vest_date) : null;
      const contract = this.alias("contract", p.plan_ref, p.vest_date) || (this.contracts.has(p.plan_ref) ? p.plan_ref : null);
      const holding = account || (contract && this.contracts.get(contract).account_id);
      if (!instrument || !holding) { this.fault("unresolved_trade", o, `Vest of ${p.vest_date} names no account or instrument.`); continue; }
      const person = this.partyOf(p.person_ref, p.vest_date);
      const released = p.released_units != null ? p.released_units : p.units;
      const key = `${p.plan_ref}|${instrument}|${p.vest_date}`;
      this.event({ key: `vest|${key}`, kind: "vest", occurred_on: p.vest_date, description: `Vest ${p.units} ${p.instrument_ref}`, category_id: "ESS-INCOME", person, amount_cents: p.taxable_value_cents, grade: "stated", rule: "vest", witnesses: this.docWitness(o),
        fields: { amount: p.taxable_value_cents, cost_paid: nz(p.cost_paid_cents) }, refs: { holding, plan: contract || "plan" }, holding, units: String(released), instrument_id: instrument });
      log({ kind: "buy", date: p.vest_date, instrument, holding, person, units: parseUnits(released), cost: p.cost_base_cents ?? p.taxable_value_cents + nz(p.cost_paid_cents), incidental: 0, ref: `vest|${key}`, o, ess: true });
    }

    const settleCrypto = (cash, cents, on, key) => {
      const line = settleMatch(cash, cents, on, "", key);
      if (line) this.event({ key: `settle_cash|${line.key}`, kind: "settle_cash", occurred_on: line.date, description: line.desc, category_id: "TRANSFER", amount_cents: line.cents, grade: "corroborated", rule: "exchange+bank", witnesses: this.lineWitness(line, "clears"), fields: { amount: line.cents }, refs: { account: cash }, line });
      else this.fault("trade_unsettled", key, `Crypto trade on ${on} has no line in ${cash}.`, "", cents);
    };
    for (const o of this.collapseDocs("crypto_txn")) {
      const p = o.payload;
      const on = String(p.time).slice(0, 10);
      const instrument = this.instrumentOf(p.asset, on);
      const wallet = this.accountOf(o, p.wallet_ref, on);
      if (!instrument || !wallet) { this.fault("unresolved_trade", o, `Crypto line ${p.txid || p.time} names an unknown wallet or asset.`); continue; }
      const person = this.personOfAccount(wallet, on);
      const key = `${wallet}|${p.txid || p.time}|${p.type}|${p.asset}|${p.units}`;
      const value = nz(p.aud_value_cents);
      const cash = this.cashHubOf(wallet);
      switch (p.type) {
        case "buy":
          this.event({ key: `crypto_buy|${key}`, kind: "crypto_buy", occurred_on: on, description: `Buy ${p.units} ${p.asset}`, person, amount_cents: value, grade: "stated", rule: "crypto", witnesses: this.docWitness(o), fields: { cost: value }, refs: { wallet, cash_account: cash }, holding: wallet, units: String(p.units), instrument_id: instrument });
          log({ kind: "buy", date: on, instrument, holding: wallet, person, units: parseUnits(p.units), cost: value, incidental: 0, ref: key, o });
          settleCrypto(cash, -value, on, key);
          break;
        case "sell":
          this.event({ key: `crypto_sell|${key}`, kind: "crypto_sell", occurred_on: on, description: `Sell ${p.units} ${p.asset}`, person, amount_cents: value, grade: "stated", rule: "crypto", witnesses: this.docWitness(o), fields: { proceeds: value }, refs: { wallet, cash_account: cash }, holding: wallet, units: `-${p.units}`, instrument_id: instrument });
          log({ kind: "sell", date: on, instrument, holding: wallet, person, units: parseUnits(p.units), proceeds: value, ref: key, o });
          settleCrypto(cash, value, on, key);
          break;
        case "swap": {
          const to = this.instrumentOf(p.quote_asset, on);
          this.event({ key: `crypto_swap|${key}`, kind: "crypto_swap", occurred_on: on, description: `Swap ${p.units} ${p.asset} to ${p.quote_units} ${p.quote_asset}`, person, amount_cents: value, grade: "stated", rule: "crypto", witnesses: this.docWitness(o), fields: {}, refs: {} });
          log({ kind: "sell", date: on, instrument, holding: wallet, person, units: parseUnits(p.units), proceeds: value, ref: key, o });
          log({ kind: "buy", date: on, instrument: to, holding: wallet, person, units: parseUnits(p.quote_units), cost: value, incidental: 0, ref: `${key}|to`, o });
          break;
        }
        case "stake_reward":
          this.event({ key: `crypto_income|${key}`, kind: "crypto_income", occurred_on: on, description: `Reward ${p.units} ${p.asset}`, category_id: "CRYPTO-INCOME", person, amount_cents: value, grade: "stated", rule: "crypto", witnesses: this.docWitness(o), fields: { amount: value }, refs: { wallet }, holding: wallet, units: String(p.units), instrument_id: instrument });
          log({ kind: "buy", date: on, instrument, holding: wallet, person, units: parseUnits(p.units), cost: value, incidental: 0, ref: key, o });
          break;
        case "transfer_in": case "transfer_out":
          (this.cryptoMoves = this.cryptoMoves || []).push({ p, o, wallet, instrument, on, key });
          break;
        default:
          this.fault("unknown_crypto_type", o, `Crypto type ${p.type} is not known.`);
      }
    }
    // Moving a coin between one's own wallets is nothing happening. Pair by transaction id; an unpaired move out needs a person.
    for (const [txid, group] of groupBy(this.cryptoMoves || [], (m) => m.p.txid || m.key)) {
      const out = group.find((m) => m.p.type === "transfer_out"), inn = group.find((m) => m.p.type === "transfer_in");
      if (out && inn) {
        const sent = parseUnits(out.p.units), landed = parseUnits(inn.p.units), stated = parseUnits(out.p.fee_units);
        const fee = sent > landed ? sent - landed : stated;
        // The network fee is a small disposal; the rest is nothing happening.
        if (fee > 0n) log({ kind: "sell", date: out.on, instrument: out.instrument, holding: out.wallet, person: this.personOfAccount(out.wallet, out.on), units: fee, proceeds: nz(out.p.fee_aud_cents), ref: `fee|${txid}`, o: out.o });
        log({ kind: "move", date: out.on, instrument: out.instrument, from: out.wallet, to: inn.wallet, units: landed, ref: txid, o: out.o });
        this.event({ key: `crypto_transfer|${txid}`, kind: "crypto_transfer", occurred_on: out.on, description: `Moved ${out.p.units} ${out.p.asset} between own wallets`, amount_cents: 0, grade: "corroborated", rule: "crypto", witnesses: [...this.docWitness(out.o), ...this.docWitness(inn.o, "clears")], fields: {}, refs: {} });
      }
      else this.fault("crypto_move_unpaired", (out || inn).o, `Crypto move ${txid} has one side only. Is it an external send?`);
    }
    // A snapshot holding with no trade history opens lots of unknown cost. Unknown is a value, not zero, so a later sale reports an unknown gain.
    for (const o of this.byKind.get("holding") || []) {
      const p = o.payload;
      const account = this.accountOf(o, p.account_ref, p.as_at);
      if (!account) continue;
      const instrument = this.instrumentOf(p.instrument_ref, p.as_at);
      if (!instrument) continue;
      const holding = this.holdingOf(instrument, account);
      if ((this.accounts.get(holding) || {}).fidelity !== "snapshot") continue;
      if (this.tradeLog.some((t) => t.instrument === instrument && t.holding === holding && t.kind === "buy" && t.date <= p.as_at)) continue;
      log({ kind: "buy", date: p.as_at, instrument, holding, person: this.personOfAccount(holding, p.as_at), units: parseUnits(p.units), cost: null, incidental: 0, ref: `snapshot|${holding}|${instrument}`, o });
    }
    this.lots = buildLots(this.tradeLog, this);
  };

  // Holdings value: units in open lots at each stated price give a dated market value per account.
  P.holdingValues = function () {
    const out = new Map();
    const prices = groupBy(this.byKind.get("holding") || [], (o) => o.payload.as_at);
    const perAccount = new Map();
    for (const [date, rows] of prices) {
      for (const o of rows) {
        const p = o.payload;
        const account = this.accountOf(o, p.account_ref, date);
        const instrument = this.instrumentOf(p.instrument_ref, date);
        if (!account || !instrument) continue;
        const holding = this.holdingOf(instrument, account);
        const k = `${holding}|${date}`;
        const value = p.value_cents != null ? p.value_cents : unitsValueCents(parseUnits(p.units), p.price);
        const row = perAccount.get(k) || { holding, date, cents: 0, o };
        row.cents += value;
        perAccount.set(k, row);
      }
    }
    for (const r of perAccount.values()) {
      if (!out.has(r.holding)) out.set(r.holding, new Map());
      out.get(r.holding).set(r.date, { cents: r.cents, o: r.o });
    }
    return out;
  };
};

function addMonths(d, n) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-${d.slice(8)}`;
}

function buildLots(log, R) {
  const order = { action: 0, buy: 1, adjust: 2, move: 3, sell: 4 };
  const rows = [...log].sort((a, b) => cmp(a.date, b.date) || order[a.kind] - order[b.kind] || cmp(a.ref, b.ref));
  const lots = [], matches = [], faults = [];
  let seq = 0;
  const open = (instrument, holding) => lots.filter((l) => l.instrument_id === instrument && (holding == null || l.account_id === holding) && l.units_open > 0n)
    .sort((a, b) => cmp(a.acquired_on, b.acquired_on) || a.seq - b.seq);
  for (const t of rows) {
    if (t.kind === "buy") {
      seq += 1;
      lots.push({ lot_id: `lot_${seq}`, seq, instrument_id: t.instrument, account_id: t.holding, party_id: t.person || null, acquired_on: t.date, units_bought: t.units, units_open: t.units, cost_known: t.cost != null, original_cost_cents: t.cost == null ? null : t.cost + (t.incidental || 0), cost_price_cents: t.cost ?? null, cost_incidental_cents: t.incidental || 0, cost_ownership_cents: 0, cost_capital_cents: 0, cost_adjustment_cents: 0, ess: !!t.ess, ref: t.ref });
    } else if (t.kind === "action") {
      if (t.action === "split" || t.action === "consolidation") {
        const [a, b] = String(t.ratio).split(":").map(Number);
        for (const l of open(t.instrument, null)) {
          l.units_open = (l.units_open * BigInt(a)) / BigInt(b);
          l.units_bought = (l.units_bought * BigInt(a)) / BigInt(b);
        }
      } else if (t.action === "return_of_capital") {
        for (const l of open(t.instrument, null)) l.cost_adjustment_cents -= Math.round(Number(l.units_open) / 1e8 * nz(t.cashPerUnit));
      }
    } else if (t.kind === "adjust") {
      const held = open(t.instrument, t.holding);
      const total = held.reduce((s, l) => s + Number(l.units_open), 0);
      let left = t.cents;
      held.forEach((l, i) => {
        const share = i === held.length - 1 ? left : Math.round((t.cents * Number(l.units_open)) / total);
        l.cost_adjustment_cents += share; left -= share;
      });
    } else if (t.kind === "move") {
      let left = t.units;
      for (const l of open(t.instrument, t.from)) {
        if (left <= 0n) break;
        const take = l.units_open < left ? l.units_open : left;
        if (take === l.units_open) l.account_id = t.to;
        else {
          seq += 1;
          const part = { ...l, seq, lot_id: `lot_${seq}`, account_id: t.to, units_bought: take, units_open: take, cost_price_cents: l.cost_price_cents == null ? null : Math.round(l.cost_price_cents * Number(take) / Number(l.units_open)), cost_incidental_cents: Math.round(l.cost_incidental_cents * Number(take) / Number(l.units_open)) };
          l.cost_price_cents = l.cost_price_cents == null ? null : l.cost_price_cents - part.cost_price_cents;
          l.cost_incidental_cents -= part.cost_incidental_cents;
          l.units_open -= take;
          lots.push(part);
        }
        left -= take;
      }
    } else if (t.kind === "sell") {
      let left = t.units, proceedsLeft = t.proceeds;
      const choice = (R.decisions || []).find((d) => d.verb === "choose_lot" && d.target_ref === t.ref);
      const method = choice ? choice.value.method : "fifo";
      const costOf = (l) => (l.cost_price_cents || 0) / Number(l.units_bought || 1n);
      const parcels = open(t.instrument, t.holding);
      if (method === "lifo") parcels.reverse();
      if (method === "hifo") parcels.sort((a, b) => costOf(b) - costOf(a));
      if (method === "specific") { const order = choice.value.lots || []; parcels.sort((a, b) => order.indexOf(a.acquired_on) - order.indexOf(b.acquired_on)); }
      const available = parcels.reduce((s, l) => s + l.units_open, 0n);
      if (available < t.units) faults.push({ kind: "oversold", ref: t.ref, what: `Sold ${fmtUnits(t.units)} of ${t.instrument} with ${fmtUnits(available)} held.` });
      for (const l of parcels) {
        if (left <= 0n) break;
        const take = l.units_open < left ? l.units_open : left;
        const costTotal = l.cost_known ? l.cost_price_cents + l.cost_incidental_cents + l.cost_ownership_cents + l.cost_capital_cents + l.cost_adjustment_cents : null;
        const cost = costTotal == null ? null : Math.round(costTotal * Number(take) / Number(l.units_open));
        const proceeds = take === left ? proceedsLeft : Math.round(t.proceeds * Number(take) / Number(t.units));
        proceedsLeft -= proceeds;
        const eligible = addMonths(l.acquired_on, CGT_MONTHS) < t.date;
        matches.push({ event_ref: t.ref, lot_id: l.lot_id, instrument_id: t.instrument, party_id: t.person || l.party_id, disposed_on: t.date, units: fmtUnits(take), proceeds_cents: proceeds, cost_base_cents: cost, gain_cents: cost == null ? null : proceeds - cost, discount_eligible: eligible, method, fy: fyOf(t.date) });
        if (l.cost_known) {
          const ratio = Number(take) / Number(l.units_open);
          for (const f of ["cost_price_cents", "cost_incidental_cents", "cost_ownership_cents", "cost_capital_cents", "cost_adjustment_cents"]) l[f] -= Math.round(l[f] * ratio);
        }
        l.units_open -= take; left -= take;
      }
    }
  }
  for (const f of faults) R.review.push({ kind: f.kind, ref: f.ref, amount_cents: null, what: f.what, do: "" });
  return { lots, matches };
}
module.exports.buildLots = buildLots;
