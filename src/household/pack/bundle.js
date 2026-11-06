/* A pack as a zip an accountant can file: the workbook, the actual evidence files, a one-page cover note and a manifest of hashes. No links to anywhere.
   Before anything is written, every file goes past the tax file number gate, and a file that cannot be cleared stays out and becomes an open item. */
(function (root, name, deps, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(...deps.map((d) => require(`./${{ workbookTax: "workbook-tax", workbookGeneric: "workbook-generic" }[d] || d}.js`)));
  else { const K = (root.KittyPack = root.KittyPack || {}); K[name] = factory(...deps.map((d) => K[d])); }
})(typeof self !== "undefined" ? self : this, "bundle", ["pack", "zip", "xlsx", "pdf", "tfn", "workbookTax", "workbookGeneric"], function (P, Z, X, Pdf, TFN, WT, WG) {
  "use strict";
  // A 15 MB file becomes about 20 MB once mail encodes it, and 20 to 25 MB is where common mail services stop. A default, written down, not a rule.
  const PART_LIMIT = 15 * 1000 * 1000;
  const csv = (rows) => rows.map((r) => r.map((v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n") + "\r\n";
  const size = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* Reads every file, checks it is the file the engine saw, and runs the gate. Returns a copy of the pack that knows what happened. */
  function gather(input, host, opts) {
    const pack = clone(input), bytes = new Map(), clear = new Set(opts.clear || []), warnings = [];
    const hold = (e, why) => {
      e.withheld = why;
      for (const l of pack.lines) if (l.evidence.some((c) => c.ref === e.ref)) { l.evidence_state = l.evidence_state === "missing" ? "missing" : "at_risk"; l.note = [l.note, `${e.ref} is held back.`].filter(Boolean).join(" "); }
    };
    const addGap = (o) => pack.gaps.push({ id: `G${pack.gaps.length + 1}`, status: "Open", amount_cents: null, lines: [], ...o });
    const owner = pack.kind === "tax" ? "taxpayer" : "household";
    for (const e of pack.evidence) {
      const b = host.readSource(e);
      if (!b) { hold(e, "The file itself is not held on this device."); addGap({ owner, item: `File not to hand: ${e.original_name}`, why: "The Kitty knows this file but its bytes are not on this device, so it is not in the zip.", where: "Wherever the original is kept" }); continue; }
      if (host.sha256(b) !== e.sha256) { hold(e, "The file has changed since it was read."); addGap({ owner, item: `File has changed: ${e.original_name}`, why: "Its hash no longer matches what was read, so it cannot stand behind a number.", where: "Replace it with the original" }); continue; }
      const scan = TFN.scanFile(e.original_name, b, host.inflate);
      if (scan.hits.length) { hold(e, "It may carry a tax file number."); addGap({ owner, item: `Held back, possible tax file number in ${e.path.split("/").pop()}`, why: "A pack never carries a tax file number. This file has a number with that shape, so it stayed out of the zip.", where: "Redact the number, add the file again, or tell the Kitty it is not one" }); warnings.push(`${e.original_name}: a number shaped like a tax file number. Held back.`); continue; }
      if (scan.opaque && !clear.has(e.sha256)) { hold(e, "It could not be read to check for a tax file number."); addGap({ owner, item: `Held back, not checked: ${e.path.split("/").pop()}`, why: "Part of this file is an image or cannot be read here, so it could not be cleared of a tax file number.", where: "Look at it yourself, then clear it" }); warnings.push(`${e.original_name}: could not be read. Held back.`); continue; }
      bytes.set(e.ref, b);
    }
    return { pack, bytes, warnings };
  }

  function coverNote(pack, info) {
    const page = new Pdf.Page(), ink = [0.14, 0.19, 0.29], muted = [0.42, 0.41, 0.46], { M, W, H } = Pdf;
    const who = pack.scope.people.map((p) => p.name).join(" and "), D = pack.scope.period;
    page.band(H - 92, 44, ink);
    page.text(M + 12, H - 66, pack.title ? `${pack.title} cover note` : pack.kind === "tax" ? "Tax pack cover note" : "Cover note", { size: 15, bold: true, color: [1, 1, 1] });
    page.y = H - 106;
    page.para(`${who}  |  ${D.label}  |  prepared from what was held on ${P.longDate(pack.as_of)}${pack.version > 1 ? `  |  version ${pack.version}` : ""}`, { bold: true, size: 10, after: 2 });
    page.para(`For: your ${pack.audience}. The question: ${pack.question}`, { size: 9.5, after: 8 });
    if (pack.headline.length) {
      for (const h of pack.headline) { page.need(14); page.text(M, page.y - 10, h.name, { size: 10 }); page.text(W - M, page.y - 10, P.money(h.cents), { size: 10, bold: true, align: "right" }); page.y -= 14; }
      page.rule(page.y - 1); page.y -= 8;
    }
    const n = P.counts(pack), lines = pack.lines.filter((l) => l.section.endsWith(".summary") || l.fields.counted);
    if (lines.length) page.para(`Evidence, line by line: ${n.held} held, ${n.at_risk} at risk, ${n.missing} missing. Everything else that is open is listed below and on Open Items.`, { size: 9.5, after: 7 });
    const list = (title, gaps, cap) => {
      if (!gaps.length) return;
      page.para(title, { bold: true, size: 10, color: ink, after: 2 });
      for (const g of gaps.slice(0, cap)) page.para(`-  ${g.item}${g.amount_cents !== null ? ` (${P.money(g.amount_cents)})` : ""}`, { size: 9, after: 1, x: M + 6 });
      if (gaps.length > cap) page.para(`and ${gaps.length - cap} more on Open Items.`, { size: 9, color: muted, x: M + 6, after: 1 });
      page.y -= 5;
    };
    const mine = pack.gaps.filter((g) => g.owner !== "accountant" && g.owner !== "lender"), yours = pack.gaps.filter((g) => g.owner === "accountant" || g.owner === "lender");
    list(pack.kind === "tax" ? `Still with ${pack.scope.people[0].name.split(" ")[0]}` : "Still with the household", mine, 7);
    list(pack.kind === "tax" ? "Left for you to decide. Not claimed anywhere" : "For you", yours, 8);
    page.para("What is in here", { bold: true, size: 10, color: ink, after: 2 });
    page.para(`The workbook, this note, manifest.csv with every file's hash and what it supports, and ${info.fileCount} evidence files in numbered folders. Unzip it, keep the folders together, and the file names in the workbook open the files. Nothing here links to anywhere else.`, { size: 9, after: 4 });
    page.para(info.parts > 1 ? `Size: ${info.size} in ${info.parts} parts. Unzip every part into one folder.` : `Size: ${info.size}, one zip. Under the ${size(info.limit)} this pack keeps to, so it fits an ordinary email.`, { size: 9, bold: true, after: 6 });
    page.rule(page.y); page.y -= 6;
    for (const b of pack.boundary) page.para(b, { size: 8.5, color: muted, after: 1 });
    return Pdf.finish(page);
  }

  function manifest(pack, parts, extra) {
    const rows = [["part", "path", "bytes", "sha256", "what", "dated", "supports", "state", "original_name"]];
    for (const f of extra) rows.push([f.part, f.path, f.bytes, f.sha256, f.what, "", f.supports, "included", ""]);
    for (const e of pack.evidence) rows.push([e.withheld ? "not in this zip" : parts.get(e.ref), e.path, e.bytes, e.sha256, e.what, e.issued_on, e.supports.join("; "), e.withheld ? `held back: ${e.withheld}` : "included", e.original_name]);
    return csv(rows);
  }

  function render(input, host, opts = {}) {
    const limit = opts.limit || PART_LIMIT, date = input.as_of;
    const { pack, bytes, warnings } = gather(input, host, opts);
    P.validate(pack);
    const drawn = pack.kind === "tax" ? WT.render(pack) : WG.render(pack);
    const workbook = X.write(drawn.book, { deflateRaw: host.deflateRaw, date });
    const stem = opts.stem || `${pack.scope.people.map((p) => p.name.replace(/\s+/g, "-")).join("-and-")}-${pack.scope.period.fy || pack.scope.period.label.replace(/\s+/g, "")}-${pack.kind}-pack${pack.version > 1 ? `-v${pack.version}` : ""}`;
    const wbName = `${pack.kind === "tax" ? "Tax pack" : "Pack"}.xlsx`;

    // Lay the evidence into parts by compressed size. Part 1 keeps room for the workbook, the note and the manifest.
    const zipped = new Map();
    for (const e of pack.evidence) if (bytes.has(e.ref)) { const b = bytes.get(e.ref), d = host.deflateRaw ? host.deflateRaw(b) : b; zipped.set(e.ref, Math.min(d.length, b.length) + 90 + e.path.length * 2); }
    // Every part carries the manifest, and part 1 carries the workbook and the note as well, so that room comes off the top.
    const roughManifest = manifest(pack, new Map(), []), shelf = (host.deflateRaw ? host.deflateRaw(Z.utf8(roughManifest)) : Z.utf8(roughManifest)).length + 2000;
    const front = workbook.length + 12 * 1000 + shelf;
    const plan = [[]]; let used = front;
    const warn = new Set();
    for (const e of pack.evidence) {
      if (!bytes.has(e.ref)) continue;
      const need = zipped.get(e.ref);
      if (need > limit) warn.add(`${e.path} is ${size(need)} by itself, over the ${size(limit)} limit. It goes in a part of its own.`);
      if (used + need > limit && plan[plan.length - 1].length) { plan.push([]); used = shelf; }
      plan[plan.length - 1].push(e); used += need;
    }
    const parts = new Map(); plan.forEach((list, i) => list.forEach((e) => parts.set(e.ref, i + 1)));
    const n = plan.length;
    const nameOf = (i) => (n > 1 ? `${stem}-part-${i + 1}-of-${n}.zip` : `${stem}.zip`);
    const fileCount = bytes.size;

    const assemble = (sizeText) => {
      const cover = coverNote(pack, { fileCount, size: sizeText, parts: n, limit });
      const extra = [{ part: 1, path: "Cover note.pdf", bytes: cover.length, sha256: host.sha256(cover), what: "Cover note", supports: "Start here" }, { part: 1, path: wbName, bytes: workbook.length, sha256: host.sha256(workbook), what: "Workbook", supports: "Every line" }];
      const man = manifest(pack, parts, extra), manBytes = Z.utf8(man);
      const out = plan.map((list, i) => {
        const files = [...(i === 0 ? [["Cover note.pdf", cover], [wbName, workbook]] : []), ["manifest.csv", manBytes], ...list.map((e) => [e.path, bytes.get(e.ref)])];
        return { name: nameOf(i), bytes: Z.write(files, { deflateRaw: host.deflateRaw, date }), files: files.map(([p, b]) => ({ path: p, bytes: b })) };
      });
      return { out, total: out.reduce((s, p) => s + p.bytes.length, 0) };
    };
    // The note says how big the zip is, and the note is in the zip. Two or three passes settle it; rounding does the rest.
    let text = "about 1 MB", built = assemble(text);
    for (let i = 0; i < 4 && size(built.total) !== text; i++) { text = size(built.total); built = assemble(text); }
    if (n > 1) warnings.push(`Too big for one email: ${size(built.total)} split into ${n} parts of up to ${size(limit)}.`);
    for (const w of warn) warnings.push(w);
    return { pack, parts: built.out.map((p) => ({ name: p.name, bytes: p.bytes, size: p.bytes.length, sha256: host.sha256(p.bytes), files: p.files })), total: built.total, sizeText: text, warnings, ties: drawn.ties, workbook, limit };
  }

  /* The gate again, over everything about to leave, the files this folder wrote included. It throws: a TFN in a generated file is a bug, not an open item. */
  function assertNoTfn(result, host) {
    for (const part of result.parts) for (const f of part.files) {
      const { hits } = TFN.scanFile(f.path, f.bytes, host.inflate);
      if (hits.length) throw new Error(`${f.path} in ${part.name} carries a number shaped like a tax file number`);
    }
    return true;
  }

  return { render, assertNoTfn, PART_LIMIT, size };
});
