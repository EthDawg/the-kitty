// Three of the portals are not filing cabinets. Litterbox is a Drive, Gmeow is an inbox and Tabby Tax is a practice. portal.js signs you in, then
// hands over here. Each page calls the same connector an agent calls, /api/drive/<tool> and /api/mail/<tool>, so a person and an agent see the same thing.
(() => {
  "use strict";
  const post = async (path, body) => { const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That did not work."); return j; };
  const get = async (path, args = {}) => { const r = await fetch(`${path}?${new URLSearchParams(args)}`, { headers: { Accept: "application/json" } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That did not work."); return j; };
  const size = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const asBase64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = no; r.readAsDataURL(file); });
  const REAL = "Fictional household. Please don't upload anything real.";
  const FOLDER = "application/vnd.google-apps.folder";
  const ext = (t) => (t.includes(".") ? t.split(".").pop().slice(0, 4) : "");

  // ---- Litterbox
  const driveHead = (c, q) => `<div class="greet">${c.greeting()}, ${c.esc(c.firstName())}.</div>
    <p class="muted small" style="margin-bottom:14px">The family's Drive, as they left it.${c.data.as_of ? ` Nothing after ${c.fmtDate(c.data.as_of)} is here yet.` : ""}</p>
    <div class="estate-bar"><input class="search" id="dsearch" type="search" placeholder="Search names and what's inside" aria-label="Search the Drive" value="${c.esc(q || "")}">
    <button class="btn secondary" id="dgo" type="button">Search</button>
    <label class="btn secondary" for="dfile">Upload</label><input id="dfile" type="file" multiple hidden>
    <button class="btn secondary" id="dnew" type="button">New folder</button><span class="status" id="dstatus"></span></div>`;
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
  const wireDrive = (c, folder) => {
    const go = () => { const q = c.$("#dsearch").value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/"; };
    c.$("#dgo").addEventListener("click", go);
    c.$("#dsearch").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    c.$("#dfile").addEventListener("change", async (e) => {
      const list = [...e.target.files], s = c.$("#dstatus");
      try {
        for (const file of list) { s.textContent = `Uploading ${file.name}…`; await post("/api/drive/create_file", { title: file.name, parentId: folder || "root", base64Content: await asBase64(file), contentMimeType: file.type || "application/octet-stream" }); }
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } catch (err) { s.textContent = err.message; }
    });
    c.$("#dnew").addEventListener("click", async () => {
      const name = prompt("Name of the new folder"); if (!name) return;
      try { await post("/api/drive/create_file", { title: name, parentId: folder || "root", contentMimeType: FOLDER }); window.dispatchEvent(new HashChangeEvent("hashchange")); } catch (err) { c.$("#dstatus").textContent = err.message; }
    });
  };
  const drivePage = async (c, { folder, q, crumbs }) => {
    const query = q ? `fullText contains '${q.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'` : `parentId = '${folder || "root"}'`;
    c.$("#view").innerHTML = `${driveHead(c, q)}<div class="grid side"><div><div class="card"><div class="eyebrow" style="margin-bottom:8px">Folders</div><div class="tree" id="dtree"><p class="muted small">Loading…</p></div></div></div>
      <div><div class="card" id="dlist"><p class="muted small">Loading…</p></div></div></div>`;
    wireDrive(c, folder);
    c.$("#dtree").innerHTML = await tree(c, folder);
    try {
      const j = await post("/api/drive/search_files", { query, pageSize: 100, excludeContentSnippets: true });
      const rows = [...j.files].sort((a, b) => (a.mimeType === FOLDER) === (b.mimeType === FOLDER) ? a.title.localeCompare(b.title) : a.mimeType === FOLDER ? -1 : 1);
      c.$("#dlist").innerHTML = `<div class="crumbs">${crumbs}</div>${table(c, rows)}<p class="small muted" style="margin-top:10px">${REAL} Uploads belong to this run and no one else's.</p>`;
    } catch (e) { c.$("#dlist").innerHTML = `<p class="error">${c.esc(e.message)}</p>`; }
  };
  const fileView = async (c, id) => {
    c.$("#view").innerHTML = `<div class="card" id="dfileview"><p class="muted small">Loading…</p></div>`;
    try {
      const f = await post("/api/drive/get_file_metadata", { fileId: id, excludeContentSnippets: true });
      const open = `/api/drive/open?${new URLSearchParams({ fileId: id })}`;
      const isPdf = f.mimeType === "application/pdf", isImage = /^image\/(png|jpeg)/.test(f.mimeType);
      const body = isPdf ? `<iframe class="previewframe" title="${c.esc(f.title)}" src="${open}"></iframe>` : isImage ? `<img class="previewimg" alt="${c.esc(f.title)}" src="${open}">` : `<pre class="preview" id="dtext">Loading…</pre>`;
      c.$("#dfileview").innerHTML = `<div class="crumbs"><a href="${f.parentId === "root" ? "#/" : `#/folder/${f.parentId}`}">Back to the folder</a></div>
        <div class="pagehead"><div><h1 style="overflow-wrap:anywhere">${c.esc(f.title)}</h1><p class="muted small">${c.esc(f.owner)} · ${c.fmtDate(f.modifiedTime.slice(0, 10))} · ${size(f.fileSize)}</p></div><a class="btn" id="ddownload" href="${open}&download=1" download="${c.esc(f.title)}">Download</a></div>${body}`;
      if (!isPdf && !isImage) c.$("#dtext").textContent = (await post("/api/drive/read_file_content", { fileId: id })).content;
    } catch (e) { c.$("#dfileview").innerHTML = `<p class="error">${c.esc(e.message)}</p>`; }
  };
  const folder = (c) => {
    const m = c.hash.match(/^#\/(folder|file|search)\/(.+)$/);
    if (m && m[1] === "file") return fileView(c, m[2]);
    if (m && m[1] === "search") { const q = decodeURIComponent(m[2]); return drivePage(c, { q, crumbs: `<a href="#/">My Drive</a> › Search for “${c.esc(q)}”` }); }
    if (m) return drivePage(c, { folder: m[2], crumbs: `<a href="#/">My Drive</a>` });
    return drivePage(c, { crumbs: "My Drive" });
  };

  // ---- Gmeow
  const BOXES = [["Inbox", "in:inbox -category:promotions -category:updates"], ["Updates", "category:updates"], ["Purchases", "category:purchases"], ["Promotions", "category:promotions"], ["Sent", "in:sent"], ["Spam", "in:spam"]];
  const whoOf = (s) => String(s).replace(/\s*<.*$/, "");
  const inboxHead = (c, q) => `<div class="greet">${c.greeting()}, ${c.esc(c.firstName())}.</div>
    <p class="muted small" style="margin-bottom:14px">${c.esc(c.data.as_of ? `The household's mail up to ${c.fmtDate(c.data.as_of)}.` : "The household's mail.")}</p>
    <div class="estate-bar"><input class="search" id="msearch" type="search" placeholder="Search mail: from:, subject:, has:attachment, after:2024/01/01" aria-label="Search mail" value="${c.esc(q || "")}"><button class="btn secondary" id="mgo" type="button">Search</button><a class="btn" id="mcompose" href="#/compose">Compose</a></div>`;
  const boxes = (c, active) => `<div class="tree">${BOXES.map(([label]) => `<a href="#/box/${label}" ${label === active ? 'aria-current="true"' : ""} data-box="${label}">${label}</a>`).join("")}</div>`;
  const wireInbox = (c) => {
    const go = () => { const q = c.$("#msearch").value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/"; };
    c.$("#mgo").addEventListener("click", go);
    c.$("#msearch").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  };
  const inboxPage = async (c, { box, q, query, page }) => {
    c.$("#view").innerHTML = `${inboxHead(c, q)}<div class="grid side"><div><div class="card">${boxes(c, box)}</div></div><div><div class="card" id="mlist"><p class="muted small">Loading…</p></div></div></div>`;
    wireInbox(c);
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
          ${m.attachments.length ? `<div class="chips">${m.attachments.map((a) => { const u = `/api/mail/open?${new URLSearchParams({ messageId: m.id, attachmentId: a.id })}`; return `<span class="chip" data-attachment="${c.esc(a.filename)}">${c.esc(a.filename)} <span class="muted">${size(a.size)}</span> <a href="${u}" target="_blank" rel="noopener">Open</a> <a href="${u}&download=1" download="${c.esc(a.filename)}">Download</a> <button type="button" data-keep="${c.esc(m.id)}|${c.esc(a.id)}">Save to Litterbox</button></span>`; }).join("")}</div>` : ""}</article>`).join("")}
        <div class="actions"><a class="btn secondary" id="mreply" href="#/compose/${id}">Reply</a><span class="status" id="mstatus"></span></div>`;
      for (const b of c.$("#mthread").querySelectorAll("[data-keep]")) b.addEventListener("click", async () => {
        const [messageId, attachmentId] = b.dataset.keep.split("|");
        try { const a = await get("/api/mail/get_attachment", { messageId, attachmentId }); await post("/api/drive/create_file", { title: a.filename, base64Content: a.content, contentMimeType: a.mimeType }); c.$("#mstatus").textContent = `Saved ${a.filename} to Litterbox.`; } catch (e) { c.$("#mstatus").textContent = e.message; }
      });
    } catch (e) { c.$("#mthread").innerHTML = `<p class="error">${c.esc(e.message)}</p>`; }
  };
  const compose = async (c, replyTo) => {
    const earlier = replyTo ? await get("/api/mail/get_thread", { threadId: replyTo }).catch(() => null) : null;
    const last = earlier && earlier.messages[earlier.messages.length - 1];
    const picked = [], drive = [];
    const prefill = location.hash.includes("?to=") ? decodeURIComponent(location.hash.split("?to=")[1]) : "";
    c.$("#view").innerHTML = `<div class="card"><div class="crumbs"><a href="#/">Back to the inbox</a></div><h1 style="font-size:20px">${replyTo ? "Reply" : "New message"}</h1>
      <form id="mform"><div class="field"><label for="mto">To</label><input id="mto" required value="${c.esc(last ? (last.sender.match(/<([^>]+)>/) || [])[1] || last.sender : prefill)}"></div>
      <div class="field"><label for="msubject">Subject</label><input id="msubject" value="${c.esc(last ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : "")}"></div>
      <div class="field"><label for="mbody">Message</label><textarea id="mbody"></textarea></div>
      <div class="chips" id="mchips"></div>
      <div class="actions"><label class="btn secondary" for="mfile">Attach from this device</label><input id="mfile" type="file" multiple hidden>
        <input class="search" id="mdrive" style="flex:1 1 200px;width:auto" placeholder="Attach from Litterbox: type a name" aria-label="Find a Drive file to attach"><button class="btn secondary" id="mdrivego" type="button">Find</button></div>
      <div class="chips" id="mfound"></div>
      <div class="actions"><button class="btn" id="msend" type="submit">Send</button><span class="status" id="mstatus">Mail stays inside this fictional world. ${REAL}</span></div></form></div>`;
    const redraw = () => { c.$("#mchips").innerHTML = [...picked.map((f) => f.filename), ...drive.map((f) => f.title)].map((n) => `<span class="chip" data-attached="${c.esc(n)}">${c.esc(n)}</span>`).join(""); };
    c.$("#mfile").addEventListener("change", async (e) => { for (const file of e.target.files) picked.push({ filename: file.name, mimeType: file.type || "application/octet-stream", content: await asBase64(file) }); redraw(); });
    c.$("#mdrivego").addEventListener("click", async () => {
      const q = c.$("#mdrive").value.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'"); if (!q) return;
      const j = await post("/api/drive/search_files", { query: `title contains '${q}' and mimeType != '${FOLDER}'`, pageSize: 10, excludeContentSnippets: true });
      c.$("#mfound").innerHTML = j.files.map((f) => `<span class="chip">${c.esc(f.title)} <button type="button" data-attach="${f.id}">Attach</button></span>`).join("") || `<span class="small muted">Nothing by that name.</span>`;
      for (const b of c.$("#mfound").querySelectorAll("[data-attach]")) b.addEventListener("click", () => { const f = j.files.find((x) => x.id === b.dataset.attach); if (!drive.some((x) => x.id === f.id)) drive.push(f); redraw(); });
    });
    c.$("#mform").addEventListener("submit", async (e) => {
      e.preventDefault(); c.$("#msend").disabled = true; c.$("#mstatus").textContent = "Sending…";
      try {
        const r = await post("/api/mail/send_message", { to: c.$("#mto").value.split(",").map((s) => s.trim()).filter(Boolean), subject: c.$("#msubject").value, body: c.$("#mbody").value, attachments: picked, driveAttachments: drive.map((f) => f.id), replyThreadId: replyTo || undefined });
        location.hash = `#/thread/${r.threadId}`;
      } catch (err) { c.$("#msend").disabled = false; c.$("#mstatus").textContent = err.message; }
    });
  };
  const inbox = (c) => {
    const m = c.hash.match(/^#\/(box|search|thread|compose)(?:\/([^/?]+))?(?:\/(\d+))?/);
    if (m && m[1] === "compose") return compose(c, m[2] && !m[2].startsWith("?") ? m[2] : null);
    if (m && m[1] === "thread") return threadView(c, m[2]);
    if (m && m[1] === "search") { const q = decodeURIComponent(m[2]); return inboxPage(c, { q, query: q, page: m[3] }); }
    const box = BOXES.find(([label]) => m && label === m[2]) || BOXES[0];
    return inboxPage(c, { box: box[0], query: box[1], page: m && m[3] });
  };

  // ---- Tabby Tax
  const agent = async (c) => {
    c.$("#view").innerHTML = `<div class="greet">Hello, ${c.esc(c.firstName())}.</div><div class="grid two"><div class="card"><div class="eyebrow">How we work</div>
        <p class="small" style="margin-top:8px">Email your papers to <b id="taddress">hello@tabbytax.example</b>. PDFs attached, or one zip. We don't open cloud links, and we won't sign in to anything for you.</p>
        <p class="small" style="margin-top:8px">New clients send us the full prior-year return with its schedules, not just the notice of assessment. For a property: the purchase contract, the settlement statement and the legal invoices. If there's an amendment, tell us which year it covers.</p>
        <div class="actions"><a class="btn" href="/gmeow#/compose?to=hello%40tabbytax.example">Write to us from Gmeow</a></div>
        <p class="small muted" style="margin-top:12px">A parody practice with a script, not a person. Fictional, and nothing here is tax advice.</p></div>
      <div class="card" id="tstatus"><p class="muted small">Loading…</p></div></div>`;
    try {
      const s = await get("/api/mail/practice_status");
      c.$("#tstatus").innerHTML = `<div class="eyebrow">Your file with us</div><ul class="checklist">${s.items.map((i) => `<li data-item="${c.esc(i.id)}"><span>${c.esc(i.label)}</span><span class="state ${i.state}">${{ received: "Received", chasing: "We're chasing", needed: "Needed" }[i.state]}</span></li>`).join("")}</ul>`;
    } catch (e) { c.$("#tstatus").innerHTML = `<div class="eyebrow">Your file with us</div><p class="small" style="margin-top:6px">Sign in to Gmeow first, so we can see what you've sent. <a href="/gmeow">Open Gmeow</a></p>`; }
  };

  window.KittyEstate = { folder, inbox, agent };
})();
