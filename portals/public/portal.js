// One page for every brand. The path says which brand; brands.json and vault-brands.json say how it looks; the API says what it holds.
// Views: #/ (overview), #/account/<id> (activity with filters and export), #/documents/<id> (statements by year), #/files/<stream> (files as delivered).
// A brand with `vault` holds only files as delivered, so its #/ is the files view.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const brandId = location.pathname.replace(/^\/|\/$/g, "").split("/")[0];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const aud = (n) => (n == null ? "" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (iso) => { if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return esc(iso); const [y, m, d] = iso.split("-"); return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`; };
  const WORDS = {
    bank: { title: "Welcome to online banking", sub: "Online banking for people whose cats open the mail.", list: "Accounts", nav: ["Accounts", "Statements & documents", "Files as delivered", "Pay & transfer|off", "Cards|off", "Settings|off"] },
    card: { title: "Your card, online", sub: "Statements, activity and downloads for your card.", list: "Cards", nav: ["Account home", "Statements & activity", "Files as delivered", "Rewards|off", "Payments|off", "Settings|off"] },
    property: { title: "Owner portal", sub: "Statements and documents for the properties we manage for you.", list: "Properties", nav: ["Properties", "Statements & documents", "Files as delivered", "Maintenance|off", "Inspections|off"] },
    payroll: { title: "Employee self-service", sub: "Payslips and income statements, whenever you need them.", list: "Employments", nav: ["My pay", "Payslips & income statements", "Files as delivered", "Leave|off", "Details|off"] },
    policy: { title: "My policies", sub: "Renewals, certificates and cover, all in one place.", list: "Policies", nav: ["Policies", "Documents", "Files as delivered", "Claims|off", "Payments|off"] },
    super: { title: "Member online", sub: "Activity and statements for your super, filed under long naps.", nav: ["Documents", "Contributions|off", "Insurance|off", "Beneficiaries|off"] },
    broker: { title: "Your trading account", sub: "Cash, holdings and contract notes. No hot tips.", nav: ["Documents", "Trade|off", "Watchlist|off"] },
    registry: { title: "Investor centre", sub: "Statements for the securities you hold, from the people who keep the list.", nav: ["Documents", "Holdings|off", "Reinvestment plans|off"] },
    plan: { title: "Your stock plan", sub: "Vests, sales and the statements your tax agent will ask for.", nav: ["Documents", "Vesting|off", "Sell|off"] },
    crypto: { title: "Your exchange account", sub: "Activity and statements. The cat is not a financial adviser.", nav: ["Documents", "Buy|off", "Wallets|off"] },
    gov: { title: "Sign in to your linked services", sub: "Tax, HELP and parental leave, all behind one door.", nav: ["Documents", "Lodge|off", "Payments|off", "Messages|off"] },
    health: { title: "My cover", sub: "Statements for your tax return, for the whole litter.", nav: ["Documents", "Claims|off", "Find a vet|off"] },
    childcare: { title: "Family portal", sub: "Statements of account for the smallest member of the household.", nav: ["Documents", "Bookings|off", "Daily photos|off"] },
    rego: { title: "My registrations", sub: "Renewal notices for the vehicles in your name.", nav: ["Documents", "Renew|off", "Licence|off"] },
    agency: { title: "Owner portal", sub: "Statements for the properties we manage for you.", nav: ["Documents", "Maintenance|off", "Inspections|off"] },
    rates: { title: "Ratepayer portal", sub: "Quarterly notices for every property you own.", nav: ["Documents", "Pay rates|off", "Bins|off"] },
    water: { title: "Your water accounts", sub: "Quarterly bills, one bowl per property.", nav: ["Documents", "Usage|off", "Payments|off"] },
    valuation: { title: "Your estimates", sub: "A month-end figure for everything you watch.", nav: ["Documents", "Suburb report|off", "Alerts|off"] },
    energy: { title: "Your energy accounts", sub: "Electricity and gas bills for the home.", nav: ["Documents", "Usage|off", "Plans|off"] },
    inbox: { title: "Sign in to your mail", sub: "Everything that turned up, attachments and all.", nav: [] },
    folder: { title: "Sign in to your Drive", sub: "Folders, search and everything the household kept, in the state it kept it.", nav: [] },
    agent: { title: "Client sign-in", sub: "Send us your papers by email. We'll tell you what's missing.", nav: [] },
  };
  let brand, data, state = { page: 1, q: "" };

  const applyBrand = (b) => {
    const r = document.documentElement.style;
    r.setProperty("--brand", b.colors.brand); r.setProperty("--brand-ink", b.colors.ink); r.setProperty("--soft", b.colors.soft); r.setProperty("--accent", b.colors.accent);
    document.title = `${b.name} · demo portal`;
    $("#mark").innerHTML = `${KittyMark(b, 36)}<span><span class="n">${esc(b.name)}</span><span class="t">${esc(b.tagline)}</span></span>`;
    const w = WORDS[b.kind];
    $("#signintitle").textContent = w.title; $("#signinsub").textContent = w.sub;
    $("#foot").innerHTML = `${esc(b.name)} is a parody that stands in for ${esc(b.standsInFor)}. ${b.vault ? "The files are fictional; the name and the mark are original." : "The column shapes are real; the name and the mark are original."} Fictional household; nothing here is advice. <a href="https://github.com/EthDawg/the-kitty">Source</a>`;
  };
  const acct = (id) => data.accounts.find((a) => a.id === id);
  const nav = (active) => {
    const w = WORDS[brand.kind];
    $("#navlinks").innerHTML = w.nav.map((n, i) => { const [label, off] = n.split("|"); const firstAccount = state.account || data.accounts[0]; const href = off ? "#" : i === 0 ? "#/" : i === 1 ? (firstAccount ? `#/documents/${encodeURIComponent(firstAccount.id)}` : "#/") : "#/files"; return `<a href="${href}" ${off ? 'class="off" aria-disabled="true" tabindex="-1"' : ""} ${active === i ? 'aria-current="page"' : ""}>${esc(label)}</a>`; }).join("");
    $("#nav").hidden = false;
  };
  const balanceCell = (a) => a.balance == null ? "" : `<span class="bal num ${a.balance < 0 ? "neg" : ""}">${aud(a.balance)}<small>as at ${fmtDate(a.as_at)}</small></span>`;
  const accountRow = (a, current) => `<a class="acct" href="#/account/${encodeURIComponent(a.id)}" data-account="${esc(a.id)}" ${current === a.id ? 'aria-current="true"' : ""}>
    <span><span class="name">${esc(a.name)}${a.in_sheet === false ? '<span class="badge off">not on the sheet</span>' : ""}</span><br><span class="sub">${esc(a.number)} · ${esc(a.type)}</span></span>${balanceCell(a)}</a>`;

  const firstName = () => (data.person ? data.person.first_name : data.name);
  const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; };

  // ---- overview
  const overview = () => {
    state.account = null; nav(0);
    const w = WORDS[brand.kind];
    if (!data.accounts.length) { $("#view").innerHTML = `<div class="greet">${greeting()}, ${esc(firstName())}.</div><div class="card"><div class="eyebrow">${esc(w.list)}</div><p class="small" style="margin-top:6px">${data.person ? `Nothing at ${esc(brand.name)} is in ${esc(data.person.first_name)}'s name${data.as_of ? ` on ${fmtDate(data.as_of)}` : ""}.` : `${esc(brand.name)} holds nothing yet${data.as_of ? ` on ${fmtDate(data.as_of)}` : ""}.`}</p></div>`; return; }
    const liquid = data.accounts.filter((a) => a.kind === "bank" && a.balance != null).reduce((s, a) => s + a.balance, 0);
    const owing = data.accounts.filter((a) => a.kind === "loan").reduce((s, a) => s + a.balance, 0);
    $("#view").innerHTML = `<div class="greet">${greeting()}, ${esc(firstName())}.</div>
      <p class="muted small" style="margin-bottom:14px">${esc(w.list)} held since ${fmtDate(data.accounts.reduce((m, a) => (a.from < m ? a.from : m), data.accounts[0].from))}. Records run to ${fmtDate(data.today)}.${rulesLine()}</p>
      <div class="grid side">
        <div><div class="card"><div class="eyebrow" style="margin-bottom:10px">${esc(w.list)}</div><div class="acctlist">${data.accounts.map((a) => accountRow(a)).join("")}</div>
          ${brand.kind === "bank" || brand.kind === "card" ? `<div class="totals">${liquid ? `<span><b class="num">${aud(liquid)}</b>in accounts</span>` : ""}${owing ? `<span><b class="num">${aud(-owing)}</b>owing on loans</span>` : ""}</div>` : ""}</div></div>
        <div><div class="card" id="recent"><div class="eyebrow">Recent activity</div><p class="muted small">Loading…</p></div>
          <div class="card"><div class="eyebrow">About these records</div><p class="small" style="margin-top:6px">${esc(brand.name)} holds the Davies household's ${brand.kind === "payroll" ? "payslips" : brand.kind === "policy" ? "policies" : brand.kind === "property" ? "owner statements" : "accounts"} from ${fmtDate(data.history.from)}. The household's sheet is closed through ${fmtDate(monthEnd(data.sheet_through))}; the months after that come from the same simulator that will close them. Every download is generated on the server from one dataset of ${data.rows.toLocaleString("en-AU")} transactions, so a month exported here is the month the sheet will hold.</p></div></div>
      </div>`;
    const first = data.accounts[0];
    loadRows(first, { from: first.presets[0].from, to: first.presets[0].to, page: 1, size: 10 }).then((j) => {
      $("#recent").innerHTML = `<div class="eyebrow">Recent activity · ${esc(first.name)}</div>${table(j, first)}<p class="small" style="margin-top:10px"><a href="#/account/${encodeURIComponent(first.id)}">All activity and exports →</a></p>`;
    });
  };

  // ---- account view: activity, filters, export panel
  const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`; };
  const params = (a, extra = {}) => new URLSearchParams({ brand: brandId, account: a.id, from: $("#from") ? $("#from").value : "", to: $("#to") ? $("#to").value : "", ...extra });
  const loadRows = async (a, o) => {
    const qs = new URLSearchParams({ brand: brandId, account: a.id, from: o.from, to: o.to, q: o.q || "", page: String(o.page || 1), size: String(o.size || 50) });
    const r = await fetch(`/api/accounts?${qs}`, { headers: { Accept: "application/json" } });
    return r.json();
  };
  const numeric = (c) => /amount|balance|opening|closing|interest|repayments|gross|tax|super|net|premium|debit|credit|charges|payments|money/i.test(c);
  const table = (j, a) => {
    if (j.error) return `<p class="error">${esc(j.error)}</p>`;
    const cell = (v, i) => { const c = j.columns[i]; if (String(v).startsWith("pdf:")) { const d = v.slice(4); return `<td><a class="btn secondary small" href="/api/export?${params(a, { from: d, to: d, format: "pdf" })}">PDF</a></td>`; } if (i === 0 && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `<td>${fmtDate(v)}</td>`; const cls = numeric(c) ? "r" + (/credit|payments|money in/i.test(c) && v ? " cr" : "") : i === 1 ? "desc" : ""; return `<td class="${cls}">${esc(v)}</td>`; };
    return `<div class="tablewrap"><table><thead><tr>${j.columns.map((c) => `<th class="${numeric(c) ? "r" : ""}">${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${j.rows.map((row) => `<tr>${row.map(cell).join("")}</tr>`).join("") || `<tr><td colspan="${j.columns.length}" class="muted">Nothing in this period.</td></tr>`}</tbody></table></div>`;
  };
  const account = (id) => {
    const a = acct(decodeURIComponent(id)); if (!a) { location.hash = "#/"; return; }
    state.account = a; state.page = 1; nav(0);
    const isPolicy = a.kind === "policy";
    const first = a.presets[0];
    $("#view").innerHTML = `<div class="crumbs"><a href="#/">${esc(WORDS[brand.kind].list)}</a> › ${esc(a.name)}</div>
      <div class="pagehead"><div><h1>${esc(a.name)}${a.in_sheet === false ? '<span class="badge off">not on the sheet</span>' : ""}</h1><p class="muted small">${esc(a.number)} · ${esc(a.type)} · since ${fmtDate(a.opened)}${a.note ? ` · ${esc(a.note)}` : ""}</p></div>
        ${a.balance != null ? `<div class="bal"><span class="eyebrow">${a.kind === "loan" ? "Balance owing" : brand.kind === "card" ? "Balance owing" : "Current balance"}</span><b class="num">${aud(a.kind === "loan" || brand.kind === "card" ? -a.balance : a.balance)}</b><span class="small muted">as at ${fmtDate(a.as_at)}</span></div>` : ""}</div>
      <div class="grid side">
        <div><div class="card"><div class="eyebrow" style="margin-bottom:10px">${esc(WORDS[brand.kind].list)}</div><div class="acctlist">${data.accounts.map((x) => accountRow(x, a.id)).join("")}</div></div>
          <div class="card"><div class="eyebrow">Documents</div><p class="small" style="margin-top:6px"><a href="#/documents/${encodeURIComponent(a.id)}">Statements and documents for ${esc(a.name)} →</a></p></div></div>
        <div><div class="card">
          <div class="toolbar">
            <div class="field"><label for="preset">Period</label><select id="preset">${a.presets.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join("")}<option value="custom">Custom range</option></select></div>
            <div class="field"><label for="from">From</label><input type="date" id="from" value="${first ? first.from : ""}" ${isPolicy ? "disabled" : ""}></div>
            <div class="field"><label for="to">To</label><input type="date" id="to" value="${first ? first.to : ""}" ${isPolicy ? "disabled" : ""}></div>
            <div class="field grow"><label for="q">Search</label><input class="search" id="q" type="search" placeholder="Description, amount…"></div>
            <div class="act"><button class="btn secondary" id="apply" type="button">Show</button><button class="btn" id="export-open" type="button" aria-expanded="false">Export ▾</button></div>
          </div>
          <div class="panel" id="exportpanel" hidden>
            <h3>Export ${esc(a.name)}</h3>
            <p class="small muted" style="margin-bottom:10px">The file covers the period above${isPolicy ? "" : ` (${fmtDate(first.from)} to ${fmtDate(first.to)})`} and is generated when you click Export. Save it unchanged.</p>
            <div class="formats" role="radiogroup" aria-label="Export format">${a.formats.map(([v, label], i) => `<label><input type="radio" name="format" value="${esc(v)}" ${i === 0 ? "checked" : ""}> ${esc(label)}</label>`).join("")}</div>
            <div class="actions"><button class="btn" id="exportbtn" type="button">Export</button><span class="status" id="exportstatus"></span></div>
          </div>
          <div class="summary" id="summary"></div>
          <div id="rows"><p class="muted small">Loading…</p></div>
          <div class="pager" id="pager"></div>
        </div></div>
      </div>`;
    $("#preset").addEventListener("change", (e) => { if (e.target.value === "custom") return; const p = a.presets[Number(e.target.value)]; $("#from").value = p.from; $("#to").value = p.to; refresh(); });
    for (const id of ["from", "to"]) $("#" + id).addEventListener("change", () => { $("#preset").value = "custom"; refresh(); });
    $("#apply").addEventListener("click", refresh);
    $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") refresh(); });
    $("#export-open").addEventListener("click", () => { const p = $("#exportpanel"); p.hidden = !p.hidden; $("#export-open").setAttribute("aria-expanded", String(!p.hidden)); });
    $("#exportbtn").addEventListener("click", () => {
      const fmt = $("input[name=format]:checked").value;
      const url = `/api/export?${params(a, { format: fmt })}`;
      $("#exportstatus").textContent = "Your download is on its way.";
      const link = document.createElement("a"); link.href = url; link.rel = "noopener"; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => { $("#exportstatus").textContent = "Downloaded. Save it, unchanged, under sources/<account>/<today>/ and run the importer."; }, 1200);
    });
    refresh();
  };
  const refresh = async (page = 1) => {
    const a = state.account; if (!a) return;
    state.page = page; state.q = $("#q").value;
    $("#rows").innerHTML = `<p class="muted small">Loading…</p>`;
    const j = await loadRows(a, { from: $("#from").value, to: $("#to").value, q: state.q, page, size: 50 });
    if (j.error) { $("#summary").innerHTML = ""; $("#rows").innerHTML = `<p class="error">${esc(j.error)}</p>`; $("#pager").innerHTML = ""; return; }
    $("#summary").innerHTML = j.summary.map(([k, v]) => `<span><b class="num">${esc(v)}</b>${esc(k)}</span>`).join("");
    $("#rows").innerHTML = table(j, a);
    const from = (j.page - 1) * j.size + 1, to = Math.min(j.total, j.page * j.size), pages = Math.max(1, Math.ceil(j.total / j.size));
    $("#pager").innerHTML = `<span>${j.total ? `Showing ${from.toLocaleString("en-AU")}–${to.toLocaleString("en-AU")} of ${j.total.toLocaleString("en-AU")}` : "No rows"}${state.q ? ` matching “${esc(state.q)}”` : ""}</span>
      <span class="btns"><button class="btn secondary small" id="prev" ${j.page <= 1 ? "disabled" : ""}>‹ Newer</button><span class="small" style="padding:6px 4px">Page ${j.page} of ${pages}</span><button class="btn secondary small" id="next" ${j.page >= pages ? "disabled" : ""}>Older ›</button></span>`;
    $("#prev").addEventListener("click", () => refresh(j.page - 1)); $("#next").addEventListener("click", () => refresh(j.page + 1));
  };

  // ---- documents view
  const documents = async (id) => {
    const a = acct(decodeURIComponent(id)); if (!a) { location.hash = "#/"; return; }
    state.account = a; nav(1);
    $("#view").innerHTML = `<div class="crumbs"><a href="#/">${esc(WORDS[brand.kind].list)}</a> › <a href="#/account/${encodeURIComponent(a.id)}">${esc(a.name)}</a> › Documents</div>
      <div class="pagehead"><div><h1>Statements & documents</h1><p class="muted small">${esc(a.name)} · ${esc(a.number)}</p></div></div>
      <div class="grid side"><div><div class="card"><div class="eyebrow" style="margin-bottom:10px">${esc(WORDS[brand.kind].list)}</div><div class="acctlist">${data.accounts.map((x) => `<a class="acct" href="#/documents/${encodeURIComponent(x.id)}" ${x.id === a.id ? 'aria-current="true"' : ""}><span><span class="name">${esc(x.name)}</span><br><span class="sub">${esc(x.number)}</span></span></a>`).join("")}</div></div></div>
      <div><div class="card" id="docs"><p class="muted small">Loading…</p></div></div></div>`;
    const r = await fetch(`/api/accounts?${new URLSearchParams({ brand: brandId, account: a.id, docs: "1" })}`, { headers: { Accept: "application/json" } });
    const j = await r.json();
    const n = j.groups.reduce((s, g) => s + g.docs.length, 0);
    $("#docs").innerHTML = `<div class="eyebrow">${n.toLocaleString("en-AU")} documents by financial year</div>` + j.groups.map((g, i) => `<details class="fy" ${i === 0 ? "open" : ""}><summary><span>${esc(g.group)}</span><span class="count">${g.docs.length} documents</span></summary><ul>${g.docs.map((d) => `<li><span>${esc(d.label)}<br><span class="small muted">${fmtDate(d.from)}${d.from !== d.to ? ` to ${fmtDate(d.to)}` : ""}</span></span><span class="links">${d.formats.map(([f, label]) => `<a href="/api/export?${new URLSearchParams({ brand: brandId, account: a.id, from: d.from, to: d.to, format: f })}" data-doc="${esc(d.kind)}">${esc(label)}</a>`).join("")}</span></li>`).join("")}</ul></details>`).join("");
  };

  // ---- files as delivered: by stream and year, as the clock and the person may see them. Nothing here is generated on the way out.
  let vault;
  const loadVault = async () => { const r = await fetch(`/api/files?brand=${encodeURIComponent(brandId)}`, { headers: { Accept: "application/json" } }).catch(() => null); vault = r && r.ok ? await r.json() : { error: r ? (await r.json().catch(() => ({}))).error : "Could not reach the portal." }; return vault; };
  const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const fileRow = (f) => `<li><span class="file">${esc(f.name)}<br><span class="small muted">Delivered ${fmtDate(f.date)} · ${size(f.size)}</span></span><span class="links"><a href="/${encodeURI(f.path)}" download="${esc(f.name)}" data-file="${esc(f.name)}" data-sha256="${esc(f.sha256)}">${esc(f.name.split(".").pop().toUpperCase())}</a></span></li>`;
  const files = async (streamId) => {
    state.account = null; nav(brand.vault ? 0 : 2);
    const v = await loadVault();
    const streams = v.streams || [];
    if (!streams.length) { $("#view").innerHTML = `<div class="card"><div class="eyebrow">Nothing filed yet</div><p class="small" style="margin-top:6px">${v.error ? esc(v.error) : data.person ? `${esc(brand.name)} holds nothing in ${esc(data.person.first_name)}'s name${data.as_of ? ` on ${fmtDate(data.as_of)}` : ""}.` : `${esc(brand.name)} holds nothing yet${data.as_of ? ` on ${fmtDate(data.as_of)}` : ""}.`}</p></div>`; return; }
    const s = streams.find((x) => x.id === streamId) || streams[0];
    const list = v.files.filter((f) => f.brand === brandId && f.stream === s.id).sort((a, b) => (a.date === b.date ? (a.name < b.name ? 1 : -1) : a.date < b.date ? 1 : -1));
    const years = [...new Set(list.map((f) => f.year))];
    const total = streams.reduce((n, x) => n + x.files, 0);
    const first = streams.map((x) => x.first).sort()[0], last = streams.map((x) => x.last).sort().pop();
    const words = `${total.toLocaleString("en-AU")} files delivered from ${fmtDate(first)} to ${fmtDate(last)}, each one exactly as it arrived.`;
    $("#view").innerHTML = `${brand.vault ? `<div class="greet">${greeting()}, ${esc(firstName())}.</div><p class="muted small" style="margin-bottom:14px">${words}</p>` : `<div class="pagehead"><div><h1>Files as delivered</h1><p class="muted small">${words}</p></div></div>`}
      <div class="grid side">
        <div><div class="card"><div class="eyebrow" style="margin-bottom:10px">Documents</div><div class="acctlist">${streams.map((x) => `<a class="acct" href="#/files/${encodeURIComponent(x.id)}" data-stream="${esc(x.id)}" ${x.id === s.id ? 'aria-current="true"' : ""}><span><span class="name">${esc(x.name)}</span><br><span class="sub">${x.files.toLocaleString("en-AU")} ${x.files === 1 ? "file" : "files"} · ${x.first.slice(0, 4)}${x.first.slice(0, 4) === x.last.slice(0, 4) ? "" : ` to ${x.last.slice(0, 4)}`}</span></span></a>`).join("")}</div></div></div>
        <div><div class="card" id="docs"><div class="eyebrow">${esc(s.name)} · by year delivered</div>${years.map((y, i) => { const mine = list.filter((f) => f.year === y); return `<details class="fy" data-year="${esc(y)}" ${i === 0 ? "open" : ""}><summary><span>${esc(y)}</span><span class="count">${mine.length} ${mine.length === 1 ? "file" : "files"}</span></summary><ul>${mine.map(fileRow).join("")}</ul></details>`; }).join("")}</div>
          <div class="card"><div class="eyebrow">About these records</div><p class="small" style="margin-top:6px">${brand.serves ? `${esc(brand.serves)} ` : ""}Nothing here is generated when you click: each file is the one the Davies household received, byte for byte. Save it, unchanged, under <code>sources/&lt;stream&gt;/&lt;delivered date&gt;/</code>.${rulesLine()}</p></div></div>
      </div>`;
    if (streamId && window.innerWidth < 900) $("#docs").scrollIntoView(); // the rail stacks above the list on a phone
  };

  // what this portal limits, in its own words, for a named person
  const rulesLine = () => { const r = data.rules || {}, bits = []; if (r.back_years) bits.push(`keeps ${r.back_years} years online`); if (r.window_days) bits.push(`exports at most ${r.window_days} days at a time`); if (r.gap_seconds) bits.push("hands over one document at a time"); return bits.length ? ` ${esc(brand.name)} ${bits.join(", ")}.` : ""; };

  // ---- routing, sign-in, boot
  const route = () => {
    if (!data) return;
    const h = location.hash || "#/";
    const m = h.match(/^#\/(account|documents|files)(?:\/(.+))?$/);
    window.scrollTo(0, 0);
    if (window.KittyEstate && KittyEstate[brand.kind]) { $("#nav").hidden = true; return KittyEstate[brand.kind]({ $, esc, fmtDate, brand, brandId, data, firstName, greeting, hash: h }); }
    if (brand.vault || (m && m[1] === "files")) files(m && m[1] === "files" && m[2] ? decodeURIComponent(m[2]) : ""); else if (m && m[2] && m[1] === "account") account(m[2]); else if (m && m[2]) documents(m[2]); else overview();
  };
  window.addEventListener("hashchange", route);
  const askForCode = (j) => { $("#codebox").hidden = false; $("#codeshown").textContent = j.code; $("#codehow").textContent = j.how; $("#code").required = true; $("#code").focus(); };
  $("#loginform").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#loginbtn").disabled = true; $("#loginerror").hidden = true;
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ brand: brandId, name: $("#name").value, password: $("#password").value, code: $("#code").value }) });
    const j = await r.json().catch(() => ({}));
    $("#loginbtn").disabled = false;
    if (j.needs_code) askForCode(j);
    if (!r.ok) { $("#loginerror").textContent = j.error || "Could not sign in."; $("#loginerror").hidden = false; return; }
    if (j.needs_code) return;
    $("#codebox").hidden = true; $("#code").value = ""; $("#code").required = false;
    load();
  });
  $("#signout").addEventListener("click", async () => { await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ brand: brandId }) }); data = null; location.hash = ""; load(); });
  const showClock = () => { const c = $("#clockline"); c.hidden = !data.as_of; if (data.as_of) c.textContent = `The clock says ${fmtDate(data.as_of)}. Nothing later exists yet.`; };
  // ?as_of=2027-01-31 or ?chapter=1 on any portal sets the clock for the whole run
  const setClockFromUrl = async () => { const q = new URLSearchParams(location.search), as_of = q.get("as_of"), chapter = q.get("chapter"); if (as_of == null && chapter == null) return; await fetch("/api/clock", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ as_of, chapter }) }); };
  const load = async () => {
    const r = await fetch(`/api/accounts?brand=${encodeURIComponent(brandId)}`, { headers: { Accept: "application/json" } });
    if (r.status === 401) { $("#signin").hidden = false; $("#view").hidden = true; $("#nav").hidden = true; $("#who").hidden = true; $("#loginbrand").value = brandId; if (new URLSearchParams(location.search).get("error")) { $("#loginerror").textContent = "Any name will do, and the password is demo."; $("#loginerror").hidden = false; } $("#name").focus(); return; }
    data = await r.json();
    $("#signin").hidden = true; $("#view").hidden = false; $("#who").hidden = false; $("#whoname").textContent = `Signed in as ${data.person ? data.person.full_name : data.name}`;
    showClock();
    route();
  };
  Promise.all(["/brands.json", "/vault-brands.json"].map((u) => fetch(u).then((r) => r.json()))).then(([originals, more]) => {
    const brands = [...originals, ...more];
    brand = brands.find((b) => b.id === brandId);
    if (!brand) { location.replace("/"); return; }
    applyBrand(brand);
    $("#brandswitch").innerHTML = brands.map((b) => `<option value="${b.id}" ${b.id === brandId ? "selected" : ""}>${esc(b.name)}</option>`).join("");
    $("#brandswitch").addEventListener("change", (e) => { location.href = `/${e.target.value}`; });
    setClockFromUrl().then(load);
  });
})();
