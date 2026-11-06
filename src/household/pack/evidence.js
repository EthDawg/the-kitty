/* From a line to the exact file, page or row behind it. Reads what the engine recorded: event, witness, observation, source.
   Files keep their own bytes. Only the name changes, to something a person can read, and the original name stays in the manifest. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "evidence", [], function () {
  "use strict";
  /* How much a kind of document proves on its own. `strong` was issued by someone with no stake in the claim. `bank` shows a payment, not what it bought.
     `self` is the household's own worksheet. The tax office says a bank statement alone often falls short, so a deduction resting only on these is at risk. */
  const WEAK = { txn_line: "bank", statement: "bank", work_log: "self" };
  const strength = (kind) => WEAK[kind] || "strong";
  const plain = (s) => String(s || "").replace(/['’]s\b/g, "s").replace(/[^A-Za-z0-9 .,()-]+/g, " ").replace(/\s+/g, " ").trim();

  class Book {
    constructor(L) {
      this.L = L;
      this.obs = new Map(L.observations.map((o) => [o.obs_id, o]));
      this.src = new Map(L.sources.map((s) => [s.source_id, s]));
      this.streams = new Map(L.streams.map((s) => [s.stream_id, s]));
      this.wit = new Map();
      for (const w of L.witnesses) { if (!this.wit.has(w.event_id)) this.wit.set(w.event_id, []); this.wit.get(w.event_id).push(w); }
      this.entries = new Map();
      this.folders = [];
    }
    folder(name) { if (!this.folders.includes(name)) this.folders.push(name); return name; }
    add(sourceId, folder) {
      const s = this.src.get(sourceId);
      if (!s) return null;
      this.folder(folder);
      if (!this.entries.has(sourceId)) this.entries.set(sourceId, { source_id: sourceId, original_name: s.name, sha256: s.sha256, bytes: s.bytes, mime: s.mime, uri: s.uri, issued_on: s.issued_on || String(s.captured_at).slice(0, 10), captured_on: String(s.captured_at).slice(0, 10), stream_id: s.stream_id, folder, supports: new Set() });
      return this.entries.get(sourceId);
    }
    /* A citation: which file, where in it, and how much it says. */
    cite(o, folder, extra = {}) {
      const e = this.add(o.source_id, folder);
      if (!e) return null;
      return { ref: o.source_id, locator: o.locator || "file", doc: o.kind, strength: strength(o.kind), role: extra.role || "primary", amount_cents: extra.amount_cents ?? null };
    }
    ofEvent(eventId, folder) {
      const out = [];
      for (const w of this.wit.get(eventId) || []) {
        if (w.role === "control") continue;
        const o = this.obs.get(w.obs_id);
        if (o) { const c = this.cite(o, folder, { role: w.role === "recognises" ? "primary" : "corroborates" }); if (c) out.push(c); }
      }
      return out;
    }
    /* Numbers files in folder order and names them. Called once, when every line is written. */
    seal() {
      const order = this.folders.map((f, i) => [f, String(i + 1).padStart(2, "0")]), num = new Map(order);
      const list = [...this.entries.values()].sort((a, b) => this.folders.indexOf(a.folder) - this.folders.indexOf(b.folder) || (a.issued_on < b.issued_on ? -1 : a.issued_on > b.issued_on ? 1 : 0) || (a.original_name < b.original_name ? -1 : 1));
      const seen = new Set(), map = new Map();
      list.forEach((e, i) => {
        const st = this.streams.get(e.stream_id), acct = st && st.subject_type === "account" && this.L.index.accounts.get(st.subject_id), ext = (/\.([A-Za-z0-9]+)$/.exec(e.original_name) || [, "bin"])[1].toLowerCase();
        const stem = `${e.issued_on} ${plain(acct ? `${acct.name} statement` : st ? st.name : e.original_name.replace(/\.[^.]+$/, ""))}`.slice(0, 90).trim();
        let file = `${stem}.${ext}`, k = 2;
        const dir = `evidence/${num.get(e.folder)} ${plain(e.folder)}`;
        while (seen.has(`${dir}/${file}`)) file = `${stem} (${k++}).${ext}`;
        seen.add(`${dir}/${file}`);
        e.what = plain(acct ? `${acct.name} statement` : st ? st.name : e.original_name);
        e.ref = `E${String(i + 1).padStart(3, "0")}`;
        e.path = `${dir}/${file}`;
        map.set(e.source_id, e.ref);
      });
      return { list, map };
    }
  }

  return { Book, strength, plain };
});
