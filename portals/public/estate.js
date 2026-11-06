// Three of the portals are not filing cabinets. Litterbox is a Drive, Gmeow is an inbox and Tabby Tax is a practice. portal.js signs you in, then hands
// over here. Each page calls what an agent calls, /api/drive/<tool>, /api/mail/<tool> and /api/tabby/<tool>, so a person and an agent see the same thing.
// The Drive and the inbox are read-only views. The practice stores nothing, so this page holds the conversation and sends `state` back with each message.
(() => {
  "use strict";
  let run = (u) => u;
  const post = async (path, body) => { const r = await fetch(run(path), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That did not work."); return j; };
  const get = async (path, args = {}) => { const r = await fetch(run(`${path}?${new URLSearchParams(args)}`), { headers: { Accept: "application/json" } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That did not work."); return j; };
  const size = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const asBase64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = no; r.readAsDataURL(file); });
  const FOLDER = "application/vnd.google-apps.folder";
  const ext = (t) => (t.includes(".") ? t.split(".").pop().slice(0, 4) : "");
  const quoted = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  // ---- Litterbox
  const driveHead = (c, q) => `<div class="greet">${c.greeting()}, ${c.esc(c.firstName())}.</div>
    <p class="muted small" style="margin-bottom:14px">The family's Drive, as they left it.${c.data.today ? ` Nothing saved after ${c.fmtDate(c.data.today)} is here yet.` : ""}</p>
    <div class="estate-bar"><input class="search" id="dsearch" type="search" placeholder="Search names and what's inside" aria-label="Search the Drive" value="${c.esc(q || "")}">
    <button class="btn secondary" id="dgo" type="button">Search</button></div>`;
  const tree = async (c, current) => {
    const { files } = await post("/api/drive/search_files", { query: `mimeType = '${FOLDER}'`, pageSize: 100, excludeContentSnippets: true });
    const kids = (p) => files.filter((f) => f.parentId === p).sort((a, b) => a.title.localeCompare(b.title));
    const row = (f, deep) => `<a class="${deep ? "deep" : ""}" href="#/folder/${f.id}" data-folder="${c.esc(f.title)}" ${f.id === current ? 'aria-current="true"' : ""}>${c.esc(f.title)}</a>`;
    return `<a href="#/" ${!current ? 'aria-current="true"' : ""}>My Drive</a>${kids("root").map((f) => row(f) + kids(f.id).map((k) => row(k, true)).join("")).join("")}`;
  };
  const table = (c, files) => `<div class="tablewrap"><table class="files"><thead><tr><th>Name</th><th>Modified</th><th>Owner</th><th class="r">Size</th></tr></thead><tbody>${files.map((f) => {
    const dir = f.mimeType === FOLDER;
    return `<tr data-title="${c.esc(f.title)}"><td class="name"><span class="kind">${dir ? "Folder" : c.esc(ext(f.title))}</span> <a href="#/${dir ? "folder" : "file"}/${f.id}">${c.esc(f.title)}</a></td><td>${c.fmtDate(f.modifiedTime.slice(0, 10))}</td><td>${c.esc(f.owner)}</td><td class="r">${size(f.fileSize)}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="muted">Nothing here.</td></tr>`}</tbody></table></div>`;
  const wireDrive = (c) => {
    const go = () => { const q = c.$("#dsearch").value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/"; };
    c.$("#dgo").addEventListener("click", go);
    c.$("#dsearch").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  };
  const drivePage = async (c, { folder: at, q, crumbs }) => {
    const query = q ? `fullText contains '${quoted(q)}'` : `parentId = '${at || "root"}'`;
    c.$("#view").innerHTML = `${driveHead(c, q)}<div class="grid side"><div><div class="card"><div class="eyebrow" style="margin-bottom:8px">Folders</div><div class="tree" id="dtree"><p class="muted small">Loading…</p></div></div></div>
      <div><div class="card" id="dlist"><p class="muted small">Loading…</p></div></div></div>`;
    wireDrive(c);
    c.$("#dtree").innerHTML = await tree(c, at);
    try {
      const j = await post("/api/drive/search_files", { query, pageSize: 100, excludeContentSnippets: true });
      const rows = [...j.files].sort((a, b) => ((a.mimeType === FOLDER) === (b.mimeType === FOLDER) ? a.title.localeCompare(b.title) : a.mimeType === FOLDER ? -1 : 1));
      c.$("#dlist").innerHTML = `<div class="crumbs">${crumbs}</div>${table(c, rows)}`;
    } catch (e) { c.$("#dlist").innerHTML = `<p class="error">${c.esc(e.message)}</p>`; }
  };
  const fileView = async (c, id) => {
    c.$("#view").innerHTML = `<div class="card" id="dfileview"><p class="muted small">Loading…</p></div>`;
    try {
      const f = await post("/api/drive/get_file_metadata", { fileId: id });
      const open = run(`/api/drive/open?${new URLSearchParams({ fileId: id })}`);
      const isPdf = f.mimeType === "application/pdf", isImage = /^image\/(png|jpeg)/.test(f.mimeType);
      const body = isPdf ? `<iframe class="previewframe" title="${c.esc(f.title)}" src="${open}"></iframe>` : isImage ? `<img class="previewimg" alt="${c.esc(f.title)}" src="${open}">` : `<pre class="preview" id="dtext">Loading…</pre>`;
      c.$("#dfileview").innerHTML = `<div class="crumbs"><a href="${f.parentId === "root" ? "#/" : `#/folder/${f.parentId}`}">Back to the folder</a></div>
        <div class="pagehead"><div><h1 style="overflow-wrap:anywhere">${c.esc(f.title)}</h1><p class="muted small">${c.esc(f.owner)} · ${c.fmtDate(f.modifiedTime.slice(0, 10))} · ${size(f.fileSize)}</p></div><a class="btn" id="ddownload" href="${open}&download=1" download="${c.esc(f.title)}">Download</a></div>${body}`;
      if (!isPdf && !isImage) c.$("#dtext").textContent = (await post("/api/drive/read_file_content", { fileId: id })).content;
    } catch (e) { c.$("#dfileview").innerHTML = `<p class="error">${c.esc(e.message)}</p>`; }
  };
  const folder = (c) => {
    run = c.withRun;
    const m = c.hash.match(/^#\/(folder|file|search)\/(.+)$/);
    if (m && m[1] === "file") return fileView(c, m[2]);
    if (m && m[1] === "search") { const q = decodeURIComponent(m[2]); return drivePage(c, { q, crumbs: `<a href="#/">My Drive</a> › Search for “${c.esc(q)}”` }); }
    if (m) return drivePage(c, { folder: m[2], crumbs: `<a href="#/">My Drive</a>` });
    return drivePage(c, { crumbs: "My Drive" });
  };

  // ---- Gmeow
  const BOXES = [["Inbox", "in:inbox -category:promotions -category:updates"], ["Updates", "category:updates"], ["Purchases", "category:purchases"], ["Promotions", "category:promotions"], ["Spam", "in:spam"]];
  const whoOf = (s) => String(s).replace(/\s*<.*$/, "");
  const inboxHead = (c, q) => `<div class="greet">${c.greeting()}, ${c.esc(c.firstName())}.</div>
    <p class="muted small" style="margin-bottom:14px">${c.esc(c.data.today ? `The household's mail up to ${c.fmtDate(c.data.today)}.` : "The household's mail.")}</p>
    <div class="estate-bar"><input class="search" id="msearch" type="search" placeholder="Search mail: from:, subject:, has:attachment, after:2024/01/01" aria-label="Search mail" value="${c.esc(q || "")}"><button class="btn secondary" id="mgo" type="button">Search</button></div>`;
  const boxes = (c, active) => `<div class="tree">${BOXES.map(([label]) => `<a href="#/box/${label}" ${label === active ? 'aria-current="true"' : ""} data-box="${label}">${label}</a>`).join("")}</div>`;
  const inboxPage = async (c, { box, q, query, page }) => {
    c.$("#view").innerHTML = `${inboxHead(c, q)}<div class="grid side"><div><div class="card">${boxes(c, box)}</div></div><div><div class="card" id="mlist"><p class="muted small">Loading…</p></div></div></div>`;
    const go = () => { const v = c.$("#msearch").value.trim(); location.hash = v ? `#/search/${encodeURIComponent(v)}` : "#/"; };
    c.$("#mgo").addEventListener("click", go);
    c.$("#msearch").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    const start = (Number(page) || 0) * 50;
    try {
      const j = await get("/api/mail/search_threads", { query, pageSize: 50, pageToken: String(start) });
      const next = j.nextPageToken ? `<a class="btn secondary small" href="#/${q ? `search/${encodeURIComponent(q)}` : `box/${box}`}/${(Number(page) || 0) + 1}">Older ›</a>` : "";
      c.$("#mlist").innerHTML = `<div class="eyebrow" style="margin-bottom:6px">${j.total.toLocaleString("en-AU")} conversations</div>${j.threads.map((t) => `<a class="mailrow" href="#/thread/${t.id}" data-subject="${c.esc(t.subject)}"><span class="who">${c.esc(whoOf(t.sender))}</span><span class="what">${t.hasAttachment ? "📎 " : ""}${c.esc(t.subject)} <span>${c.esc(t.snippet)}</span></span><span class="when">${c.fmtDate(t.date)}</span></a>`).join("") || `<p class="muted small" style="margin-top:8px">Nothing here.</p>`}<div class="pager"><span></span>${next}</div>`;
    } catch (e) { c.$("#mlist").innerHTML = `<p class="error">${c.esc(e.message)}</p>`; }
  };
  const threadView = async (c, id) => {
    c.$("#view").innerHTML = `<div class="card" id="mthread"><p class="muted small">Loading…</p></div>`;
    try {
      const t = await get("/api/mail/get_thread", { threadId: id });
      c.$("#mthread").innerHTML = `<div class="crumbs"><a href="#/">Back to the inbox</a></div><h1 style="font-size:20px;margin-bottom:6px">${c.esc(t.messages[0].subject)}</h1>
        ${t.messages.map((m) => `<article class="message"><div class="head"><b>${c.esc(whoOf(m.sender))}</b> ${c.esc((m.sender.match(/<[^>]+>/) || [""])[0])}<br>to ${c.esc(m.toRecipients.join(", "))} · ${c.fmtDate(m.date)}</div><div class="body">${c.esc(m.plaintextBody)}</div>
          ${m.attachments.length ? `<div class="chips">${m.attachments.map((a) => { const u = run(`/api/mail/open?${new URLSearchParams({ messageId: m.id, attachmentId: a.id })}`); return `<span class="chip" data-attachment="${c.esc(a.filename)}">${c.esc(a.filename)} <span class="muted">${size(a.size)}</span> <a href="${u}" target="_blank" rel="noopener">Open</a> <a href="${u}&download=1" download="${c.esc(a.filename)}">Download</a></span>`; }).join("")}</div>` : ""}</article>`).join("")}`;
    } catch (e) { c.$("#mthread").innerHTML = `<p class="error">${c.esc(e.message)}</p>`; }
  };
  const inbox = (c) => {
    run = c.withRun;
    const m = c.hash.match(/^#\/(box|search|thread)(?:\/([^/?]+))?(?:\/(\d+))?/);
    if (m && m[1] === "thread") return threadView(c, m[2]);
    if (m && m[1] === "search") { const q = decodeURIComponent(m[2]); return inboxPage(c, { q, query: q, page: m[3] }); }
    const box = BOXES.find(([label]) => m && label === m[2]) || BOXES[0];
    return inboxPage(c, { box: box[0], query: box[1], page: m && m[3] });
  };

  // ---- Tabby Tax: a scripted page that remembers only what this page holds
  const STATE = { received: "Received", chasing: "We're chasing", needed: "Needed" };
  const agent = async (c) => {
    run = c.withRun;
    let state, picked = [], drive = [];
    c.$("#view").innerHTML = `<div class="greet">Hello, ${c.esc(c.firstName())}.</div><div class="grid two"><div><div class="card"><div class="eyebrow">How we work</div>
        <p class="small" style="margin-top:8px">Send us your papers here, or email <b id="taddress">hello@tabbytax.example</b>. PDFs attached, or one zip. We don't open cloud links, and we won't sign in to anything for you.</p>
        <p class="small" style="margin-top:8px">New clients send us the full prior-year return with its schedules, not just the notice of assessment. For a property: the purchase contract, the settlement statement and the legal invoices. If there's an amendment, tell us which year it covers.</p>
        <p class="small muted" style="margin-top:12px">A parody practice with a script, not a person. It keeps nothing: leave this page and the conversation is gone. Fictional, and nothing here is tax advice.</p></div>
      <div class="card"><div class="eyebrow">Write to us</div><form id="tform"><div class="field"><label for="tbody">Your message</label><textarea id="tbody"></textarea></div>
        <div class="chips" id="tchips"></div>
        <div class="actions"><label class="btn secondary" for="tfile">Attach from this device</label><input id="tfile" type="file" multiple hidden>
          <input class="search" id="tdrive" style="flex:1 1 200px;width:auto" placeholder="Attach from Litterbox: type a name" aria-label="Find a Drive file to attach"><button class="btn secondary" id="tfind" type="button">Find</button></div>
        <div class="chips" id="tfound"></div>
        <div class="actions"><button class="btn" id="tsend" type="submit">Send</button><span class="status" id="tstatus2"></span></div></form></div>
      <div id="treplies"></div></div>
      <div class="card" id="tstatus"><p class="muted small">Loading…</p></div></div>`;
    const showItems = (items) => { c.$("#tstatus").innerHTML = `<div class="eyebrow">Your file with us</div><ul class="checklist">${items.map((i) => `<li data-item="${c.esc(i.id)}"><span>${c.esc(i.label)}</span><span class="state ${i.state}">${STATE[i.state]}</span></li>`).join("")}</ul>`; };
    const redraw = () => { c.$("#tchips").innerHTML = [...picked.map((f) => f.filename), ...drive.map((f) => f.title)].map((n) => `<span class="chip" data-attached="${c.esc(n)}">${c.esc(n)}</span>`).join(""); };
    c.$("#tfile").addEventListener("change", async (e) => { for (const file of e.target.files) picked.push({ filename: file.name, mimeType: file.type || "application/octet-stream", content: await asBase64(file) }); redraw(); });
    c.$("#tfind").addEventListener("click", async () => {
      const q = quoted(c.$("#tdrive").value.trim()); if (!q) return;
      try {
        const j = await post("/api/drive/search_files", { query: `title contains '${q}' and mimeType != '${FOLDER}'`, pageSize: 10, excludeContentSnippets: true });
        c.$("#tfound").innerHTML = j.files.map((f) => `<span class="chip">${c.esc(f.title)} <button type="button" data-attach="${f.id}">Attach</button></span>`).join("") || `<span class="small muted">Nothing by that name.</span>`;
        for (const b of c.$("#tfound").querySelectorAll("[data-attach]")) b.addEventListener("click", () => { const f = j.files.find((x) => x.id === b.dataset.attach); if (!drive.some((x) => x.id === f.id)) drive.push(f); redraw(); });
      } catch (e) { c.$("#tfound").innerHTML = `<span class="small muted">Sign in to Litterbox first to attach from it.</span>`; }
    });
    c.$("#tform").addEventListener("submit", async (e) => {
      e.preventDefault(); c.$("#tsend").disabled = true; c.$("#tstatus2").textContent = "Sending…";
      try {
        const r = await post("/api/tabby/message", { body: c.$("#tbody").value, attachments: picked, driveAttachments: drive.map((f) => f.id), state });
        state = r.state; picked = []; drive = []; redraw(); c.$("#tbody").value = ""; c.$("#tfound").innerHTML = ""; c.$("#tstatus2").textContent = "";
        c.$("#treplies").insertAdjacentHTML("beforeend", `<div class="card message"><div class="head"><b>${c.esc(whoOf(r.from))}</b></div><div class="body">${c.esc(r.reply)}</div></div>`);
        showItems(r.items);
      } catch (err) { c.$("#tstatus2").textContent = err.message; }
      c.$("#tsend").disabled = false;
    });
    try { showItems((await get("/api/tabby/checklist")).items); } catch (e) { c.$("#tstatus").innerHTML = `<p class="error">${c.esc(e.message)}</p>`; }
  };

  window.KittyEstate = { folder, inbox, agent };
})();
