/* Start yours: the household path on the page. The two doors, a blank Kitty, a dropped file, and everything a page shows for a household of any size. It owns the
   household's store and the runtime (src/household, loaded only when someone starts) and hands app.js a model in the shape it already reads. Every number comes from
   the runtime. What the page has not been told stays "not asked yet" and is never drawn as a zero. Not in the native host. */
(function () {
  "use strict";
  const REPO = "https://github.com/EthDawg/the-kitty";
  const day = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const today = () => day(new Date());
  const sheetIdOf = (raw) => { const s = String(raw || "").trim(), m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/); return m ? m[1] : s; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

  // ---------- this device: a household that has not moved to a Sheet, and the bytes of files no store holds. Money data, so it stays out of the prefs. ----------
  const device = (() => {
    let open = null;
    const db = () => open || (open = new Promise((ok, no) => { const r = indexedDB.open("kitty-household", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
    const run = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction("kv", mode), q = fn(t.objectStore("kv")); t.oncomplete = () => ok(q.result); t.onerror = t.onabort = () => no(t.error); }); };
    return { get: (k) => run("readonly", (s) => s.get(k)), set: (k, v) => run("readwrite", (s) => s.put(v, k)), clear: () => run("readwrite", (s) => s.clear()) };
  })();

  window.KittyStart = function (app) {
    const { S, E, Kit, ART, $, $$, esc, ico, toast, savePrefs, setModel, renderAll, go, switchTab, openDrawer, closeDrawer, setPill, errText, celebrate, barsHTML, monthBarsSVG, bindMonthBars } = app;
    const fmt = (n, o) => E.fmt(n, o), fmt0 = (n) => E.fmt0(n);
    const H = { K: null, store: null, kind: null, sheet: null, conn: null, built: null, status: null, step: null, last: null, durable: true, hasDrive: false, busy: false };
    const F = { step: "who", name: "", others: [], where: "", sheet: "", error: "", account: "", from: null };

    const available = () => !!(window.KittyHousehold || document.getElementById("kitty-household"));
    const started = () => !!(S.prefs.household && S.prefs.household.kind);
    const on = () => S.mode === "household";

    // The runtime stays out of the way until someone starts: a gzip in the page, inert, inflated here and run as one script.
    async function runtime() {
      if (H.K) return H.K;
      if (!window.KittyHousehold) {
        const tag = document.getElementById("kitty-household");
        if (!tag) throw { code: "no_runtime", message: "This copy of the page has no household engine in it." };
        const raw = atob(tag.textContent.trim()), bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
        const s = document.createElement("script"); s.textContent = text; document.head.append(s);
        if (!window.KittyHousehold) throw { code: "no_runtime", message: "This browser or host would not run the household engine." };
      }
      return (H.K = window.KittyHousehold);
    }
    async function driveAvailable() {
      if (!S.mcp) return false;
      try { await S.mcp.callTool("Google Drive", "search_files", { query: "title = 'kitty-probe' and trashed = false", excludeContentSnippets: true }, {}); return true; } catch (e) { return false; }
    }
    function plain(e) {
      const code = e && e.code;
      if (code === "missing_grant") return `This page needs your OK for ${esc(e.tool)}. Allow it when Claude asks, or add the connector in Settings → Connectors, then try again.`;
      if (code === "not_empty" || code === "header_changed" || code === "newer_standard" || code === "half_made" || code === "no_kitty") return esc(e.message);
      if (code === "no_runtime") return esc(e.message);
      if (code && /^(needs_reauth|server_not_connected|selection_required|not_in_manifest|approval_required|consent_required|blocked_by_policy|rate_limited|tool_error|server_unavailable|upstream_error|invalid_response)$/.test(code)) return errText(e, "the sheet");
      return esc((e && e.message) || "Something went wrong, and nothing was changed.");
    }
    async function guarded(fn, where) {
      if (H.busy) return;
      H.busy = true;
      try { return await fn(); }
      catch (e) { console.error(e); if (where) where(plain(e)); else toast(plain(e).replace(/<[^>]+>/g, ""), 6000); }
      finally { H.busy = false; }
    }

    // ---------- the store ----------
    async function openDevice() {
      const K = await runtime(), sheet = new K.FakeSheet();
      try { const saved = await device.get("sheet"); if (saved) sheet.sheets = JSON.parse(saved); H.durable = true; } catch (e) { H.durable = false; }
      H.conn = K.fakeConnector({ sheet });
      H.store = K.googleStore({ mcp: H.conn, spreadsheetId: "this-device", hasDrive: false, deviceFiles: true, retries: 0, sleep: async () => {} });
      H.kind = "device"; H.sheet = null; H.hasDrive = false;
    }
    async function openSheet(id) {
      const K = await runtime();
      H.hasDrive = await driveAvailable();
      H.store = K.googleStore({ mcp: S.mcp, spreadsheetId: id, hasDrive: H.hasDrive, deviceFiles: !H.hasDrive });
      H.kind = "google"; H.sheet = id; H.conn = null;
    }
    async function saveDevice() {
      if (H.kind !== "device") return;
      try { await device.set("sheet", JSON.stringify(H.conn.sheet.sheets)); H.durable = true; } catch (e) { H.durable = false; }
    }
    const keepBytes = async (files) => { if (H.store && H.store.blobs) return; for (const f of files) { try { await device.set(`file:${H.K.sha256(f.bytes)}`, { name: f.name, bytes: f.bytes }); } catch (e) { H.durable = false; } } };
    async function refresh(quiet) {
      const K = H.K, t = today(), built = await K.rebuildAt(H.store, { today: t });
      H.built = built; H.status = await K.status(H.store, { today: t, built }); H.step = await K.next(H.store, { today: t, built });
      await saveDevice();
      setModel(K.modelFromStandard(built.L, built.view, { E, asOf: built.L.asOf || t }));
      S.mode = "household";
      if (!quiet) renderAll();
    }
    // A viewer who has started goes straight to their own. Called at boot, before anything of the demo's is drawn.
    async function resume() {
      const h = S.prefs.household;
      try {
        if (h.kind === "google") { if (!S.mcp) throw { code: "server_not_connected" }; await openSheet(h.sheet); } else await openDevice();
        if (!(await H.store.probe()).recognised) throw { code: "no_kitty", message: "That Kitty isn't where we left it." };
        await refresh();
        return true;
      } catch (e) { H.resumeError = plain(e); return false; }
    }

    // ---------- the two doors ----------
    function show(html) { const el = $("#onb"); el.hidden = false; document.body.style.overflow = "hidden"; el.innerHTML = html; return el; }
    function hide() { $("#onb").hidden = true; document.body.style.overflow = ""; }
    const head = (n, of) => `<div class="blob"></div><div class="blob2"></div><div class="onbhead"><span style="font-family:var(--display);font-weight:800">${ico("i-paw", "ic")} The Kitty</span>${of ? `<div class="dots" aria-hidden="true">${Array.from({ length: of }, (_, i) => `<i class="${i === n ? "on" : ""}"></i>`).join("")}</div>` : ""}<span class="tag kh-exp">Experimental</span></div>`;
    function door(choseDemo) {
      const el = show(`${head()}<div class="onbbody"><div class="step"><div class="kh-doorart" aria-hidden="true">${ART.connectSheet || ""}</div><h1>Where your money went, on your own spreadsheet.</h1><p class="lede">One page over one Google Sheet that you own. No server and no account with us. Look at a made-up family, or start yours with one bank file.</p>
        <div class="opts kh-doors">
          ${window.KITTY_SNAPSHOT ? `<button class="opt" data-door="demo"><span class="mid"><span class="t">See the Davies</span><span class="s">A made-up family, already full of numbers. Look around. Nothing you do is saved.</span></span>${ico("i-chev", "chev")}</button>` : ""}
          <button class="opt" data-door="yours"><span class="mid"><span class="t">Start yours</span><span class="s">Starts empty. One bank file is enough, and it takes a few minutes. You can try it on this device before you connect anything.</span></span>${ico("i-chev", "chev")}</button>
        </div></div></div><div class="onbfoot"></div>`);
      $$("[data-door]", el).forEach((b) => b.addEventListener("click", () => { if (b.dataset.door === "demo") { savePrefs({ door: "demo", onboarded: true }); hide(); choseDemo(); } else begin(); }));
    }

    // ---------- Start yours ----------
    function begin() { Object.assign(F, { step: H.store ? "file" : "who", error: "" }); flow(); }
    const STEPS = ["who", "where", "file", "found"];
    function flow() {
      const n = STEPS.indexOf(F.step), people = F.others.map((p, i) => `<div class="kh-person"><div class="field"><label for="hp${i}">Name</label><input id="hp${i}" data-pi="${i}" value="${esc(p.name)}" autocomplete="off"></div><div class="field"><label for="hr${i}">Who</label><select id="hr${i}" data-pr="${i}"><option value="adult" ${p.role !== "dependant" ? "selected" : ""}>Grown-up</option><option value="dependant" ${p.role === "dependant" ? "selected" : ""}>Child</option></select></div><button class="linkbtn kh-rm" data-px="${i}" aria-label="Remove ${esc(p.name) || "this person"}">Remove</button></div>`).join("");
      const body = {
        who: () => `<div class="eyebrow">Start yours · step 1 of 3</div><h1>Who's this Kitty for?</h1><p class="lede">Only names, so the page can talk to you. Nothing else is needed yet, and you can change them later.</p>
          <div class="field"><label for="hname">Your first name</label><input id="hname" value="${esc(F.name)}" autocomplete="given-name" placeholder="Your name"></div>
          ${people}<div><button class="linkbtn kh-add" id="haddp">${ico("i-plus")} Add someone else in your household</button></div>`,
        where: () => `<div class="eyebrow">Start yours · step 2 of 3</div><h1>Where should it live?</h1><p class="lede">It is yours either way. We have no server, so nothing comes to us.</p>
          <div class="opts">
            <button class="opt" data-where="sheet" aria-pressed="${F.where === "sheet"}"><span class="mid"><span class="t">Your own Google Sheet</span><span class="s">Kept for good, on every device, and you can open it yourself.</span></span></button>
            <button class="opt" data-where="device" aria-pressed="${F.where === "device"}"><span class="mid"><span class="t">Just try it on this device</span><span class="s">Nothing to connect. It stays on this device and is not saved to your Sheet yet. You can move it across later.</span></span></button>
          </div>${F.where === "sheet" ? sheetForm() : ""}`,
        file: () => `<div class="eyebrow">Start yours · step 3 of 3</div><h1>Add your first bank file.</h1><p class="lede">In your bank's app or website, find your everyday account, choose the last three months and download it as a CSV. Then drop it here.</p>${dropHTML("hfile", "Drop your bank file here")}${H.kind === "device" ? `<p class="kh-place">On this device, not saved to your Sheet yet.</p>` : ""}`,
        found: () => foundHTML(H.last),
      }[F.step]();
      const foot = { who: `<span></span><button class="btn lime" id="hnext">Next ${ico("i-chev")}</button>`, where: `<button class="back" id="hback">${ico("i-back")} Back</button><button class="btn lime" id="hnext" ${F.where ? "" : "disabled"}>${F.where === "device" ? "Start on this device" : "Set up my Sheet"} ${ico("i-chev")}</button>`, file: `<span></span><button class="back" id="hlater">I'll do this later</button>`, found: H.last && H.last.lines ? `<span></span><button class="btn lime" id="hdone">See your Kitty ${ico("i-chev")}</button>` : `<span></span><button class="back" id="hdone">Not now</button>` }[F.step];
      const el = show(`${head(n, 4)}<div class="onbbody"><div class="step">${body}${F.error ? `<p class="kh-error" role="alert">${F.error}</p>` : ""}</div></div><div class="onbfoot">${foot}</div>`);
      bindFlow(el);
    }
    function sheetForm() {
      if (!S.mcp) return `<div class="kh-help"><b>This view has no Google connector yet.</b> In Claude, open Settings, then Connectors, and add Google Sheets. Come back to this page and it will be here. Until then you can try it on this device and move it across later.</div>`;
      return `<div class="kh-help"><p>Make an empty sheet at <b>sheets.new</b>, then paste its link here. The page adds its own tabs. It won't touch a sheet that already has something in it.</p><div class="field"><label for="hsheet">Your sheet's link or ID</label><input id="hsheet" value="${esc(F.sheet)}" autocomplete="off" placeholder="https://docs.google.com/spreadsheets/d/…"></div>${H.driveChecked && H.hasDrive ? `<button class="linkbtn" id="hmake">Or make one for me</button>` : ""}</div>`;
    }
    function bindFlow(el) {
      const name = $("#hname", el); if (name) { name.addEventListener("input", () => (F.name = name.value.trim())); setTimeout(() => { if (window.innerWidth >= 820) name.focus(); }, 200); name.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#hnext", el).click(); }); }
      $$("[data-pi]", el).forEach((i) => i.addEventListener("input", () => (F.others[+i.dataset.pi].name = i.value.trim())));
      $$("[data-pr]", el).forEach((i) => i.addEventListener("change", () => (F.others[+i.dataset.pr].role = i.value)));
      $$("[data-px]", el).forEach((b) => b.addEventListener("click", () => { F.others.splice(+b.dataset.px, 1); flow(); }));
      const addp = $("#haddp", el); if (addp) addp.addEventListener("click", () => { F.others.push({ name: "", role: "adult" }); flow(); });
      $$("[data-where]", el).forEach((b) => b.addEventListener("click", async () => { F.where = b.dataset.where; F.error = ""; if (F.where === "sheet" && !H.driveChecked) { await runtime(); H.hasDrive = await driveAvailable(); H.driveChecked = true; } flow(); }));
      const sheet = $("#hsheet", el); if (sheet) sheet.addEventListener("input", () => (F.sheet = sheet.value.trim()));
      const back = $("#hback", el); if (back) back.addEventListener("click", () => { F.step = "who"; F.error = ""; flow(); });
      const make = $("#hmake", el); if (make) make.addEventListener("click", () => guarded(async () => { const K = await runtime(); F.sheet = await K.createSpreadsheet({ mcp: S.mcp, title: `${F.name || "My"} Kitty` }); await startIn("sheet"); }, fail));
      const later = $("#hlater", el); if (later) later.addEventListener("click", finish);
      const done = $("#hdone", el); if (done) done.addEventListener("click", finish);
      const next = $("#hnext", el);
      if (next) next.addEventListener("click", () => {
        if (F.step === "who") { if (!F.name) { F.error = "What should we call you?"; return flow(); } F.error = ""; F.step = "where"; return flow(); }
        if (F.step === "where") guarded(() => startIn(F.where), fail);
      });
      bindDrop(el);
      bindRecipe(el);
    }
    const fail = (msg) => { F.error = msg; flow(); };
    async function startIn(where) {
      await runtime();
      const people = [{ name: F.name, role: "adult" }, ...F.others.filter((p) => p.name)], household = `${F.name}'s household`;
      if (where === "sheet") {
        if (!S.mcp) throw { message: "Add the Google Sheets connector first, or try it on this device." };
        const id = sheetIdOf(F.sheet);
        if (!id) throw { message: "Paste your sheet's link first." };
        await openSheet(id);
      } else await openDevice();
      const made = await H.K.init(H.store, { name: household, people, today: today() });
      savePrefs({ household: { kind: H.kind, sheet: H.sheet }, door: "yours", onboarded: true });
      await saveDevice();
      if (made.already && H.kind === "google") { await refresh(); hide(); toast("Found your Kitty in that sheet"); return; }
      await refresh(true);
      F.step = "file"; F.error = ""; flow();
    }
    function finish() { hide(); renderAll(); switchTab("home"); if (H.last && H.last.lines) { const c = $("#v-home .card.hero"); if (c && window.KittyMotion) window.KittyMotion.beckon?.(c); } }

    // ---------- a file ----------
    function dropHTML(id, label, small) {
      return `<label class="kh-drop${small ? " small" : ""}" for="${id}" data-drop><input type="file" id="${id}" multiple>${ico("i-dl")}<span class="t">${esc(label)}</span><span class="s">or choose a file</span></label>`;
    }
    function bindDrop(root) {
      $$("[data-drop]", root).forEach((z) => {
        const input = $("input[type=file]", z);
        input.addEventListener("change", () => { if (input.files.length) take(input.files); input.value = ""; });
        ["dragenter", "dragover"].forEach((t) => z.addEventListener(t, (e) => { e.preventDefault(); z.classList.add("over"); }));
        ["dragleave", "dragend"].forEach((t) => z.addEventListener(t, () => z.classList.remove("over")));
        z.addEventListener("drop", (e) => { e.preventDefault(); z.classList.remove("over"); if (e.dataTransfer.files.length) take(e.dataTransfer.files); });
      });
    }
    const whereKept = () => (H.store.blobs ? "in your Google Drive" : "on this device");
    async function take(list) {
      await guarded(async () => {
        const K = H.K || (await runtime()), files = await Promise.all([...list].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
        setPill("warn", "Reading your file…");
        await keepBytes(files);
        const res = await K.add(H.store, files, { today: today(), on_device: !H.store.blobs });
        await refresh(true);
        H.lastFiles = files; H.last = reading(res, files);
        F.step = "found"; F.error = "";
        if ($("#onb").hidden) { renderAll(); openFound(); } else flow();
      }, (msg) => { if ($("#onb").hidden) toast(msg.replace(/<[^>]+>/g, ""), 6000); else fail(msg); });
    }
    // What came of a drop, in plain words. Every file is accounted for: nothing unread is dropped.
    function reading(res, files) {
      const out = { read: [], already: res.already.map((a) => a.name), unknown: res.needs_recipe.map((u) => ({ ...u, bytes: (files.find((f) => f.name === u.name) || {}).bytes })), scans: res.needs_agent, noAccount: res.needs_account, refused: res.refused, unresolved: res.unresolved, warnings: res.warnings, lines: 0 };
      for (const a of res.added) { const w = H.K.fileWords(H.built, a.source_id); out.read.push({ name: a.name, ...w }); out.lines += w.lines; }
      out.created = res.accounts_created;
      // A file with no recipe, or one a public recipe claimed and could not read, gets a first reading of its columns. Nothing is saved until a person says yes.
      for (const u of out.unknown) u.proposal = H.K.proposeRecipe({ name: u.name, bytes: u.bytes, stream: F.account || "Everyday" });
      for (const x of out.refused.slice()) {
        const bytes = (files.find((f) => f.name === x.name) || {}).bytes, p = bytes && H.K.proposeRecipe({ name: x.name, bytes, stream: F.account || "Everyday" });
        if (p && p.recipe) { out.refused.splice(out.refused.indexOf(x), 1); out.unknown.push({ name: x.name, bytes, fingerprint: p.fingerprint, container: p.container, sample: p.sample, proposal: p }); }
      }
      return out;
    }
    function foundHTML(r) {
      if (!r) return `<h1>Nothing to show yet.</h1>`;
      const parts = [];
      if (r.unknown.length) parts.push(recipeHTML(r.unknown[0]));
      if (r.noAccount.length) parts.push(`<div class="kh-found warn"><b>${esc(r.noAccount[0].name)} doesn't say which account it's for.</b>${accountForm()}</div>`);
      for (const f of r.read) parts.push(`<div class="kh-found"><p class="kh-big">${esc(f.say)}</p><p class="s">${esc(f.name)}. ${esc(f.bytes)}</p></div>`);
      for (const n of r.already) parts.push(`<div class="kh-found"><b>${esc(n)} is already in your Kitty.</b><p class="s">Nothing was added twice.</p></div>`);
      for (const s of r.scans) parts.push(`<div class="kh-found warn"><b>${esc(s.name)} is a picture, so no recipe can read it.</b><p class="s">It is kept ${whereKept()}, and nothing from it is in your numbers. Your agent can read it for you.</p></div>`);
      for (const x of r.refused) parts.push(`<div class="kh-found warn"><b>${esc(x.name)} failed its checks, so none of it is in your numbers.</b><p class="s">${esc(x.why)}</p></div>`);
      for (const x of r.unresolved || []) parts.push(`<div class="kh-found warn"><b>We read a file for ${esc(x.ref)}, and we don't know that account yet.</b><p class="s">Its lines are kept and aren't in your numbers. Home will ask about it.</p></div>`);
      for (const w of r.warnings) parts.push(`<p class="s">${esc(w)}</p>`);
      const title = r.unknown.length ? "" : r.lines ? `<h1>Got it.</h1>` : r.already.length ? `<h1>Already here.</h1>` : `<h1>That file needs a look.</h1>`;
      return `${title}${parts.join("")}`;
    }
    function openFound() {
      const r = H.last; if (!r) return;
      openDrawer(`<div class="kh-sheet">${foundHTML(r)}</div>`);
      bindRecipe($("#drawer"));
    }

    // ---------- a file nobody has met. First the page's own reading of its columns, then Claude if this host has it, then any agent. The gate decides each one, and a
    // person sees three rows before anything is saved. ----------
    function promptFor(u) {
      const rows = ((u.sample && u.sample.rows) || []).map((r) => (Array.isArray(r) ? r.join(",") : JSON.stringify(r))).join("\n") || ((u.sample && u.sample.lines) || []).join("\n");
      return `I'm using The Kitty, a money page on my own spreadsheet. It can't read my bank's file yet, and it needs a recipe: JSON that says how to read the columns. Please write one.

File: ${u.name}. Type: ${u.container}. Fingerprint: ${u.fingerprint}
First rows, as the page decoded them:
${rows}

How to write a recipe, with examples: ${REPO}/blob/main/standard/RECIPES.md
Put "${u.fingerprint}" in "fingerprints". If the file has no account number in it, use {"stream": true} for account_ref.
Reply with the JSON only. The page checks it before it reads anything: every row has to be used and the balances have to add up.`;
    }
    // A name a person already uses is that account, not a new one.
    const accountRef = (typed) => { const a = ((S.m && S.m.accounts) || []).find((x) => x.name.toLowerCase() === typed.toLowerCase()); return a ? a.id : typed; };
    const accountField = () => { const have = ((S.m && S.m.accounts) || []).filter((a) => a.liquid); return `<div class="field"><label for="hacct">${have.length ? "Which account is this?" : "What do you call this account?"}</label><input id="hacct" list="hacctlist" value="${esc(F.account || (have[0] && have[0].name) || "Everyday")}" autocomplete="off"><datalist id="hacctlist">${have.map((a) => `<option value="${esc(a.name)}"></option>`).join("")}</datalist></div>`; };
    function proposalHTML(u, p) {
      const by = p.author === "sample" ? "Claude wrote a reading of this file, and it passed our checks." : p.author === "agent" ? "Your agent's recipe passed our checks." : "We haven't met this bank's file before, so we read it by its columns.";
      return `<h1>Here's how we read ${esc(u.name)}.</h1><p class="lede">${esc(by)} ${esc((p.says && p.says.columns) || "")} ${esc((p.says && p.says.proof) || "")}</p>
        <div class="kh-found"><p class="s">The first three lines, as we'd keep them:</p><ul class="kh-rows">${p.rows.map((r) => `<li>${esc(H.K.rowWords(r))}</li>`).join("")}</ul>${p.status === "unproved" ? `<p class="s"><b>Nothing in this file can prove these. Is money out shown as money out?</b></p>` : ""}${p.says && p.says.dates ? `<p class="s">${esc(p.says.dates)}</p>` : ""}</div>
        ${accountField()}<p class="kh-error" id="hrecipeerr" role="alert"></p>
        <div class="kh-copy"><button class="btn lime" id="hyes">Yes, that's right</button>${p.also ? `<button class="btn ghost" id="hflip">Read the dates the other way</button>` : ""}<button class="btn ghost" id="hno">No, that's wrong</button></div>`;
    }
    function askHTML(u, p) {
      return `<h1>We can't read ${esc(u.name)} yet.</h1><p class="lede">It is kept ${whereKept()}, and nothing from it is in your numbers. Nothing is lost.${p && p.status === "refused" ? " We tried reading it by its columns, and the numbers didn't add up, so we stopped there." : ""}</p>
        <div class="kh-help">${accountField()}
          ${S.sample ? `<h3>Ask Claude to read it</h3><p>Claude looks at the first rows of your file and writes a recipe: a few lines that say how to read this bank's files. We check it before anything is kept.</p><div class="kh-copy"><button class="btn lime sm" id="hclaude">Ask Claude to read it</button></div>` : ""}
          <h3>${S.sample ? "Or ask" : "Ask"} your agent</h3><p>A recipe is a few lines of text, and you need one once for each bank. Copy this to any agent, then paste back what it writes. The rows in it come from your file, so paste it only where you trust.</p>
          <div class="kh-copy"><button class="btn sm ghost" id="hcopy">Copy for your agent</button></div>
          <textarea id="hprompt" class="kh-text" readonly rows="4" aria-label="The message for your agent">${esc(promptFor(u))}</textarea>
          <div class="field"><label for="hrecipe">Paste the recipe here</label><textarea id="hrecipe" class="kh-text" rows="4" placeholder="{ &quot;id&quot;: …"></textarea></div><div><button class="btn sm" id="hcheck">Check it</button></div><p class="kh-error" id="hrecipeerr" role="alert"></p>
        </div>`;
    }
    const recipeHTML = (u) => (u.proposal && u.proposal.rows && !u.rejected ? proposalHTML(u, u.proposal) : askHTML(u, u.proposal));
    const accountForm = () => `${accountField()}<button class="btn sm" id="hacctgo">Read it into this account</button>`;
    function bindAccount(root) {
      const go2 = $("#hacctgo", root);
      if (go2) go2.addEventListener("click", () => guarded(async () => {
        if (!(H.lastFiles || []).length) throw { message: "Add the file again and it will ask." };
        const typed = F.account || "Everyday", files = H.lastFiles.filter((f) => H.last.noAccount.some((n) => n.name === f.name));
        const res = await H.K.add(H.store, files, { today: today(), account: accountRef(typed), name: typed, on_device: !H.store.blobs });
        await refresh(true); H.last = reading(res, files); afterRead();
      }, recipeError));
    }
    const recipeError = (msg) => { const box = $("#hrecipeerr"); if (box) box.innerHTML = msg; else if ($("#onb").hidden) toast(msg.replace(/<[^>]+>/g, ""), 6000); else fail(msg); };
    const redraw = () => { if ($("#onb").hidden) openFound(); else flow(); };
    function afterRead() { F.error = ""; if ($("#onb").hidden) { closeDrawer(); renderAll(); openFound(); } else { F.step = "found"; flow(); } }
    // A recipe from Claude or an agent gets the same look: the gate first, then three rows for a person.
    function propose(u, recipe, author) {
      const t = H.K.tryRecipe(recipe, { name: u.name, bytes: u.bytes, stream: F.account || "Everyday" });
      if (t.status !== "pass") throw { message: `That recipe didn't pass, so nothing was read. ${t.why || ""}` };
      u.proposal = { ...t, author, status: t.proved ? "proposed" : "unproved", says: { columns: "", proof: t.proved ? `The balances add up on every one of the ${t.lines} lines.` : "This file has no running balance, so nothing proves which way the money runs. Check these rows." } };
      u.rejected = false; redraw();
    }
    function bindRecipe(root) {
      const acct = $("#hacct", root); if (acct) acct.addEventListener("input", () => (F.account = acct.value.trim()));
      bindAccount(root);
      const u = H.last && H.last.unknown[0]; if (!u) return;
      const yes = $("#hyes", root);
      if (yes) yes.addEventListener("click", () => guarded(async () => {
        const name = F.account || ((S.m.accounts.find((a) => a.liquid) || {}).name) || "Everyday", p = u.proposal;
        const v = await H.K.addRecipe(H.store, p.recipe, { today: today(), files: [{ name: u.name, bytes: u.bytes }], account: accountRef(name), name, on_device: !H.store.blobs, author: p.author || "page" });
        if (v.status !== "passed") throw { message: "The final check refused it, so nothing was kept." };
        await refresh(true); H.last = reading(v.read, []); afterRead();
      }, recipeError));
      const no = $("#hno", root); if (no) no.addEventListener("click", () => { u.rejected = true; redraw(); });
      const flip = $("#hflip", root); if (flip) flip.addEventListener("click", () => guarded(async () => { const was = u.proposal; const t = H.K.tryRecipe(was.also, { name: u.name, bytes: u.bytes, stream: F.account || "Everyday" }); u.proposal = { ...was, ...t, also: was.recipe, status: was.status }; redraw(); }, recipeError));
      const copy = $("#hcopy", root);
      if (copy) copy.addEventListener("click", async () => { const box = $("#hprompt", root); try { await navigator.clipboard.writeText(box.value); toast("Copied. Paste it to your agent."); } catch (e) { box.focus(); box.select(); toast("Select the text and copy it from here."); } });
      const check = $("#hcheck", root);
      if (check) check.addEventListener("click", () => guarded(async () => {
        let recipe; try { recipe = JSON.parse($("#hrecipe", root).value.replace(/^[^{]*/, "").replace(/[^}]*$/, "")); } catch (e) { throw { message: "That isn't JSON yet. Paste only what your agent wrote." }; }
        propose(u, recipe, "agent");
      }, recipeError));
      const claude = $("#hclaude", root);
      if (claude) claude.addEventListener("click", () => guarded(async () => {
        const res = await S.sample.json(`${promptFor(u)}\nReturn a JSON object with one key, "recipe", holding the recipe.`, { modelTier: "default" });
        propose(u, (res && (res.recipe || res)) || {}, "sample");
      }, recipeError));
    }

    // ---------- Home ----------
    const hello = () => { const h = new Date().getHours(); return h < 5 ? "Still up" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"; };
    const place = () => (H.kind === "google" ? `Saved in <a href="https://docs.google.com/spreadsheets/d/${esc(H.sheet)}/edit" target="_blank" rel="noopener">your Google Sheet</a>.` : H.durable ? "On this device, not saved to your Sheet yet." : "On this device for now. This browser won't keep it after you close the page.");
    const known = (n) => `${n === 1 ? "the 1 account" : `the ${n} accounts`} we know about`;
    function actionHTML(step) {
      const a = step.action || {}, needs = a.needs || [];
      if (a.verb === "add") return dropHTML("hnextfile", a.label, true);
      if (a.verb === "recipe") return `<button class="btn lime" data-kh="recipe">${esc("Read this file")}</button>`;
      if (a.verb === "agent") return `<button class="btn lime" data-kh="agent">${esc(a.label)}</button>`;
      if (a.verb === "close") return `<button class="btn lime" data-kh="close">${esc(a.label)}</button>`;
      if (a.verb === "review") return `<button class="btn lime" data-kh="review">Look at it</button>`;
      if (a.verb === "decide" && needs.includes("category_id")) return `<div class="field kh-pick"><label for="hcat">${esc(a.label)}</label><select id="hcat"><option value="">Choose…</option>${(a.choices || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div><label class="kh-always"><input type="checkbox" id="halways" checked> Remember this for next time</label><button class="btn lime" data-kh="categorise">Save</button>`;
      if (a.verb === "decide" && needs.includes("state")) return `<div class="chips kh-choices">${(a.choices || []).map((c) => `<button class="btn sm${c.id === "has" ? " lime" : " ghost"}" data-kh="scope" data-v="${esc(c.id)}">${esc(c.name)}</button>`).join("")}</div>`;
      if (a.verb === "decide" && needs.includes("cents")) return `<div class="field kh-pick"><label for="hcents">${esc(a.label)}</label><input id="hcents" inputmode="decimal" placeholder="1,234.56"></div><button class="btn lime" data-kh="balance">Save</button>`;
      if (a.verb === "decide" && needs.includes("reason")) return `<div class="field kh-pick"><label for="hreason">Why?</label><input id="hreason"></div><button class="btn lime" data-kh="reopen">${esc(a.label)}</button>`;
      if (a.verb === "decide") return `<button class="btn lime" data-kh="edit">${esc(a.label)}</button>`;
      if (a.verb === "record") return `<button class="btn lime" data-go="setup">${esc(a.label)}</button>`;
      return "";
    }
    function bindNext(v) {
      bindDrop(v);
      const say = (ok) => async () => { await refresh(); if (ok) toast(ok); };
      const act = (fn) => guarded(fn);
      const step = H.step, a = (step && step.action) || {};
      $$("[data-kh]", v).forEach((b) => b.addEventListener("click", () => act(async () => {
        const k = b.dataset.kh, t = today();
        if (k === "close") { const r = await H.K.close(H.store, a.args.month, { today: t }); await refresh(); toast(r.say, 5000); if (r.status === "locked" || r.status === "closed") celebrate(); return; }
        if (k === "scope") { await H.K.decide(H.store, { scope: { ...a.args.scope, state: b.dataset.v } }, { today: t }); return say()(); }
        if (k === "categorise") { const cat = $("#hcat", v).value; if (!cat) return toast("Pick what it was first"); await H.K.decide(H.store, { item: a.args.item, category_id: cat, always: $("#halways", v).checked }, { today: t }); return say()(); }
        if (k === "balance") { const c = Math.round(parseFloat($("#hcents", v).value.replace(/[$,\s]/g, "")) * 100); if (!Number.isFinite(c)) return toast("Type the balance as a number"); await H.K.decide(H.store, { balance: { ...a.args.balance, cents: c } }, { today: t }); return say()(); }
        if (k === "reopen") { const reason = $("#hreason", v).value.trim(); if (!reason) return toast("Say why first"); await H.K.decide(H.store, { ...a.args, reason }, { today: t }); return say()(); }
        if (k === "edit") { await H.K.decide(H.store, { ...a.args }, { today: t }); return say()(); }
        if (k === "review") return openReview(step);
        if (k === "recipe" || k === "agent") return openUnread(step);
      })));
    }
    async function openUnread(step) {
      const id = step.action.args.source_id, s = H.built.view.sources.find((x) => x.source_id === id);
      let bytes = H.store.blobs ? await H.store.blobs.get(s.sha256) : null;
      if (!bytes) { try { const d = await device.get(`file:${s.sha256}`); bytes = d && d.bytes; } catch (e) { bytes = null; } }
      if (!bytes) return toast("Add the file again and we'll pick it up from there.", 5000);
      const fp = step.action.args.fingerprint, sample = H.K.sampleOf(bytes);
      const proposal = H.K.proposeRecipe({ name: s.name, bytes, stream: F.account || "Everyday" });
      H.lastFiles = [{ name: s.name, bytes }];
      H.last = { read: [], already: [], unknown: [{ name: s.name, sha256: s.sha256, fingerprint: fp, container: String(s.name).split(".").pop(), sample, bytes, proposal }], scans: [], noAccount: [], refused: [], unresolved: [], warnings: [], lines: 0 };
      openFound();
    }
    function openReview(step) {
      const a = step.action.args || {};
      openDrawer(`<h2>${esc(step.say)}</h2><p class="sub">${esc(step.why)}</p>${a.check ? `<div class="field plain"><label for="hreason2">If you've looked and it's fine, say why</label><input id="hreason2" class="plain"></div><button class="btn sm" id="haccept" style="margin-top:10px">Accept it with that reason</button>` : ""}`);
      const b = $("#haccept"); if (b) b.addEventListener("click", () => guarded(async () => { const reason = $("#hreason2").value.trim(); if (!reason) return toast("Say why first"); await H.K.decide(H.store, { check: a.check, reason }, { today: today() }); closeDrawer(); await refresh(); }));
    }
    /* Home's parts. A part with nothing true to say is null and is left off. No part draws a zero for something nobody has told us. */
    function home(m) {
      const r = H.status.readiness, step = H.step, cash = r.cash, net = r.net_worth, people = m.people.length ? m.people.join(" and ") : m.householdName;
      const headline = net && r.accounts_known ? `<div class="heronum"><button class="big num" data-open="trust" aria-label="Where the numbers come from"><span>${E.fmt(net.cents / 100, { cents: true })}</span><small>across ${known(r.accounts_known)}</small></button></div>` : "";
      const takes = (step.action || {}).verb === "add" ? "" : `<div class="kh-homedrop">${dropHTML("hhomefile", "Add a file", true)}</div>`;
      const hero = `<div class="card hero kh-next" data-step="${esc(step.id)}"><div class="blob"></div><div class="blob2"></div><div class="hi"><span>${hello()}, ${esc(people)}</span></div><h1 class="vh">${esc(step.say)}</h1><p class="vs">${esc(step.why)}</p><div class="kh-act">${actionHTML(step)}</div>${headline}${takes}</div>`;
      const rv = m.reviewQueue.items.length;
      const review = rv ? `<button class="card rtile" data-go="review"><span class="ric">${ico("i-review")}</span><span class="mid"><span class="t">${rv === 1 ? "One line needs a look" : `${rv} lines need a look`}</span><span class="s">${plural(rv, "line")} we can't place yet · one tap each</span></span>${ico("i-chev", "chev")}</button>` : null;
      const months = m.cashflow.length, last = cash && E.fmtMonth(`${cash.month}-01`);
      const spent = cash ? E.spend(m.tx, E.window("month", `${cash.month}-01`)) : null;
      const top = spent ? spent.byCat.filter(([, v]) => v > 0).slice(0, 5).map(([c, v]) => ({ k: (m.catById[c] || {}).name || c, v })) : [];
      const knownCard = months ? `<div class="card"><div class="cardhead"><span class="q">What we know so far</span><button class="linkbtn" data-go="records">Records →</button></div>
        ${cash ? `<div class="statline"><div class="stat"><div class="k">In · ${esc(last)}</div><div class="v num" style="color:var(--c-in)">${fmt0(cash.income_cents / 100)}</div></div><div class="stat"><div class="k">Out</div><div class="v num" style="color:var(--c-out)">${fmt0(cash.spending_cents / 100)}</div></div></div>` : ""}
        <ul class="kh-facts">${cash && cash.unplaced_cents ? `<li>${fmt0(cash.unplaced_cents / 100)} of what went out isn't placed yet.</li>` : ""}${cash && cash.unexplained_cents ? `<li>${fmt0(cash.unexplained_cents / 100)} came in that we can't explain yet, so it isn't counted as income.</li>` : ""}<li>${plural(months, "month")} of lines, from ${E.fmtMonth(m.cashflow[0].month, true)}. ${r.months_closed ? `${r.months_closed} closed.` : "None closed yet."}</li><li>${plural(r.sources.read, "file")} read${r.sources.unread ? `, ${r.sources.unread} waiting to be read` : ""}${r.sources.refused ? `, ${r.sources.refused} refused` : ""}.</li></ul>
        ${r.scope.not_asked.length ? `<p class="sub">${esc(r.unknown[0])}</p>` : ""}</div>` : null;
      const empty = !months && !H.built.view.sources.length ? blank(ART.connectSheet, "This Kitty is all yours.", "It starts empty, with nobody else's numbers in it. Add one file and it starts to fill in.") : null;
      const where = top.length ? `<div class="card"><div class="cardhead"><span class="q">Where it went</span><button class="linkbtn" data-go="insights">Insights →</button></div><p class="sub" style="margin:-6px 0 10px">${esc(last)}</p>${barsHTML(top)}</div>` : null;
      const series = months >= 2 ? m.cashflow.slice(-12).map((c) => ({ month: c.month, in: c.income, out: c.spending })) : null;
      const bars = series ? `<div class="card"><div class="cardhead"><span class="q">The last ${plural(series.length, "month")}</span><button class="linkbtn" data-go="insights">Insights →</button></div><div id="homebars">${monthBarsSVG(series)}</div></div>` : null;
      const goals = m.goals.length ? `<div class="card"><div class="cardhead"><span class="q">Saving for</span><button class="linkbtn" data-go="goals">Goals →</button></div><div class="gtiles">${m.goals.map(goalTile).join("")}</div></div>` : null;
      Kit.widget("needs").title = "What we know so far"; Kit.widget("months").title = series ? `The last ${plural(series.length, "month")}` : "Where it went";
      return { parts: { hero, review, needs: knownCard || empty, upcoming: where, months: bars, goals, ideas: null }, series,
        footer: `<p class="sub kh-foot" style="padding:0 6px">${place()} <span class="tag kh-exp2">Experimental</span> ${H.kind === "device" ? `<button class="linkbtn" data-kh2="connect">Move it to a Sheet</button> · ` : ""}<button class="linkbtn" data-open="trust">Where the numbers come from</button></p>`,
        bind: (v) => { bindNext(v); if (series) bindMonthBars($("#homebars", v), series); $$("[data-kh2=connect]", v).forEach((b) => b.addEventListener("click", openConnect)); } };
    }
    const goalTile = (g) => `<button class="gtile" data-open="goal:${esc(g.name)}"><div class="gtop"><span class="gem" aria-hidden="true">${E.goalIcon(g.name)}</span><span class="gt">${esc(g.name)}</span><span class="gof num">${g.balance != null ? `<b>${fmt0(g.balance)}</b> of ` : ""}${fmt0(g.target)}</span></div><div class="gline">${g.date ? `By ${E.fmtMonth(g.date, true)}. ` : ""}Pace isn't worked out yet.</div></button>`;

    // ---------- moving from this device to a Sheet ----------
    function openConnect() {
      openDrawer(`<h2>Move it to your Google Sheet</h2><p class="sub">Everything on this device goes into your own Sheet, and the page reads it from there on every device.</p>${S.mcp ? `<div class="field plain" style="margin-top:12px"><label for="hsheet2">An empty sheet's link or ID. Make one at sheets.new.</label><input id="hsheet2" class="plain" placeholder="https://docs.google.com/spreadsheets/d/…"></div><button class="btn sm" id="hmove" style="margin-top:10px">Move it there</button><p class="kh-error" id="hmoveerr" role="alert"></p>` : `<div class="note" style="margin-top:12px"><b>This view has no Google connector yet.</b> In Claude, open Settings, then Connectors, and add Google Sheets. Come back to this page and your Kitty will still be here, on this device.</div>`}`);
      const b = $("#hmove"); if (b) b.addEventListener("click", () => guarded(async () => {
        const id = sheetIdOf($("#hsheet2").value); if (!id) throw { message: "Paste your sheet's link first." };
        const from = H.store;
        await openSheet(id);
        try { await H.K.moveStore(from, H.store, { today: today() }); }
        catch (e) { H.store = from; H.kind = "device"; H.sheet = null; throw e; }
        savePrefs({ household: { kind: "google", sheet: id } });
        closeDrawer(); await refresh(); toast("Your Kitty is in your Sheet now");
      }, (msg) => { const box = $("#hmoveerr"); if (box) box.innerHTML = msg; }));
    }

    // ---------- the other tabs, for a household ----------
    const blank = (art, title, sub, more) => `<div class="card kh-blank"><div class="kh-art" aria-hidden="true">${art || ""}</div><h2>${esc(title)}</h2><p class="sub">${esc(sub)}</p>${more || ""}</div>`;
    function renderGoals(v) {
      const m = S.m, tiles = m.goals.map(goalTile).join("");
      v.innerHTML = `${m.goals.length ? `<div class="card" style="--i:0"><div class="cardhead"><span class="q">Saving for</span><span class="cardtools"><button class="btn sm" id="haddgoal">${ico("i-plus")} Add a goal</button></span></div><div class="gtiles" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))">${tiles}</div><p class="sub" style="margin-top:10px">A goal's balance is the account it sits in. How fast you're getting there isn't worked out yet.</p></div>` : blank(ART.emptyGoals, "Nothing to save for yet.", "A goal is a name, an amount and the account the money sits in. Add one when you have one in mind.", `<button class="btn sm" id="haddgoal">${ico("i-plus")} Add a goal</button>`)}`;
      const add = $("#haddgoal", v); if (add) add.addEventListener("click", openGoalAdd);
      $$("[data-open]", v).forEach((b) => b.addEventListener("click", () => go(b.dataset.open)));
    }
    function openGoalAdd() {
      const m = S.m, accounts = m.accounts.filter((a) => a.liquid && a.type !== "Credit card");
      openDrawer(`<h2>A new goal</h2><p class="sub">One row in your Kitty.</p><div class="field plain" style="margin-top:12px"><label for="gn">Name</label><input id="gn" class="plain" placeholder="A holiday"></div><div class="field plain"><label for="gt">How much</label><input id="gt" class="plain" inputmode="decimal" placeholder="2,000"></div><div class="field plain"><label for="gd">By when (you can leave this)</label><input id="gd" class="plain" type="date"></div>${accounts.length ? `<div class="field plain"><label for="ga">Which account is it in</label><select id="ga" class="plain"><option value="">Not yet</option>${accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}</select></div>` : ""}<button class="btn sm" id="gsave" style="margin-top:12px">Save the goal</button>`);
      $("#gsave").addEventListener("click", () => guarded(async () => {
        const name = $("#gn").value.trim(), cents = Math.round(parseFloat($("#gt").value.replace(/[$,\s]/g, "")) * 100), when = $("#gd").value, acct = $("#ga") ? $("#ga").value : "";
        if (!name || !Number.isFinite(cents)) return toast("A goal needs a name and an amount");
        await H.K.record(H.store, "goal", [{ goal_id: `G-${Date.now().toString(36)}`, name, target_cents: cents, ...(when ? { target_on: when } : {}), ...(acct ? { account_id: acct } : {}), status: "active" }], { today: today() });
        closeDrawer(); await refresh(); toast("Saved");
      }));
    }
    function renderRecords(v) {
      const r = H.status.readiness, srcs = H.built.view.sources, sum = r.laws;
      if (!srcs.length) { v.innerHTML = blank(ART.emptyActivity, "No records yet.", "Every file you add is listed here, with what was read from it and where it is kept."); return; }
      const state = { held: "In your Drive", on_device: "On this device", not_held: "Not kept", unknown: "" }, read = { read: "Read", unread: "Not read yet", refused: "Refused" };
      v.innerHTML = `<div class="card" style="--i:0"><div class="cardhead"><span class="q">Your files</span><span class="sub">${plural(srcs.length, "file")}</span></div><div class="tablewrap"><table class="t"><thead><tr><th>File</th><th>Read</th><th>Kept</th></tr></thead><tbody>${srcs.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(read[H.K.readState(s)])}</td><td class="muted">${esc(state[H.K.bytesState(s)])}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="card" style="--i:1"><div class="cardhead"><span class="q">How far your files reach</span></div>${r.coverage.streams.length ? `<div class="kh-lines">${r.coverage.streams.map((c) => `<div class="row" style="cursor:default"><span class="mid"><span class="t">${esc(c.name)}</span><span class="s">${c.held} of ${plural(c.expected, "period")} we expected${c.missing.length ? `. Missing ${esc(c.missing.map((x) => (/^\d{4}-\d{2}$/.test(x) ? E.fmtMonth(`${x}-01`, true) : x)).join(", "))}` : ""}</span></span></div>`).join("")}</div>` : `<p class="sub">Nothing is expected yet.</p>`}</div>
        <div class="card" style="--i:2"><div class="cardhead"><span class="q">Months</span><span class="sub">${r.months_closed} of ${r.months.length} closed</span></div><div class="kh-lines">${r.months.map((x) => `<div class="row" style="cursor:default"><span class="mid"><span class="t">${esc(E.fmtMonth(`${x.month}-01`))}</span><span class="s">${esc({ closed: "Closed", locked: "Locked", ready: "Ready to close", open: x.ended ? "Open" : "Still running" }[x.state])}</span></span></div>`).join("")}</div></div>
        <div class="card" style="--i:3"><div class="cardhead"><span class="q">The checks</span></div><p class="sub">${sum.pass} of the ${sum.ran} checks that could run pass. ${sum.fail ? `${plural(sum.fail, "check")} failed, and Home says which.` : ""}</p>${r.unknown.length ? `<ul class="kh-facts">${r.unknown.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}<p class="sub" style="margin-top:10px">The Kitty's engine is experimental. It can be wrong without knowing it, so check anything that matters against your bank. Not tax advice.</p></div>`;
    }
    function setupCard() {
      const m = S.m, r = H.status.readiness;
      return `<div class="card" style="--i:0" id="yourkitty"><div class="cardhead"><span class="q">Your Kitty</span><span class="sub">${esc(m.householdName)}</span></div>
        <div class="prose"><p>${place()}</p><p class="sub">${m.people.length ? `${esc(m.people.join(", "))}. ` : ""}${r.accounts_known ? `${plural(r.accounts_known, "account")} we know about.` : "No accounts yet."} Started with no other family's numbers in it.</p></div>
        ${dropHTML("hsetupfile", "Add a file", true)}
        <div class="chips" style="margin-top:12px">${H.kind === "device" ? `<button class="btn sm" data-kh2="connect">Move it to a Sheet</button>` : ""}<button class="btn sm ghost" data-kh2="demo">See the Davies</button><button class="btn sm ghost" data-kh2="forget">Forget this Kitty on this device</button></div><p class="sub" id="hforget" hidden></p></div>`;
    }
    function bindSetup(v) {
      bindDrop(v);
      $$("[data-kh2=connect]", v).forEach((b) => b.addEventListener("click", openConnect));
      $$("[data-kh2=demo]", v).forEach((b) => b.addEventListener("click", () => app.showDemo()));
      $$("[data-kh2=forget]", v).forEach((b) => b.addEventListener("click", () => {
        const box = $("#hforget", v); box.hidden = false;
        box.innerHTML = `${H.kind === "device" ? "This removes your Kitty from this device for good." : "Your Sheet stays as it is. This page just forgets it."} <button class="linkbtn" id="hforgetyes">Yes, forget it</button>`;
        $("#hforgetyes", v).addEventListener("click", async () => { try { await device.clear(); } catch (e) { /* nothing was kept */ } savePrefs({ household: null, door: "" }); location.reload(); });
      }));
    }
    function openTrust() {
      const m = S.m, r = H.status.readiness;
      openDrawer(`<h2>Where the numbers come from</h2><p class="sub">${place()} Every number here is worked out from your files, and from nothing else.</p>
        <h3>Your accounts</h3>${m.accounts.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Account</th><th class="n">Balance</th></tr></thead><tbody>${m.accounts.map((a) => `<tr><td>${esc(a.name)}</td><td class="n">${fmt(a.balance, { cents: true })}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No accounts yet.</div>`}
        <h3>What we don't know yet</h3>${r.unknown.length ? `<ul class="kh-facts">${r.unknown.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : `<p class="sub">Nothing we can name.</p>`}
        <p class="sub" style="margin-top:12px">${r.laws.pass} of the ${r.laws.ran} checks that could run pass. The engine is experimental: check anything that matters against your bank.</p>`);
    }
    return { available, started, on, door, begin, resume, home, renderGoals, renderRecords, setupCard, bindSetup, openTrust, refresh, blank, place, H,
      get today() { return today(); },
      where: () => (H.kind === "google" ? "kept in your Sheet" : "kept on this device"),
      async categorise(id, cat) { await H.K.decide(H.store, { item: id, category_id: cat, always: true }, { today: today() }); },
      async judge(verb, id, value) { await H.K.decide(H.store, { verb, target_ref: id, target_type: "line", value }, { today: today() }); },
      async rule(id, cat, merchant) { await H.K.decide(H.store, { item: id, category_id: cat, merchant, always: true }, { today: today() }); },
      resumeError: () => H.resumeError };
  };
})();
