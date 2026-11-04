// One page for every brand. The path says which brand; brands.json says how it looks; the API says what it holds.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const brandId = location.pathname.replace(/^\/|\/$/g, "").split("/")[0];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const aud = (n) => (n == null ? "" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`; };
  let brand, data, current;

  const applyBrand = (b) => {
    const r = document.documentElement.style;
    r.setProperty("--brand", b.colors.brand); r.setProperty("--brand-ink", b.colors.ink); r.setProperty("--soft", b.colors.soft); r.setProperty("--bg", b.colors.bg); r.setProperty("--accent", b.colors.accent);
    document.title = `${b.name} · demo portal`;
    $("#mark").innerHTML = `${KittyMark(b, 40)}<span><span class="n">${esc(b.name)}</span><span class="t">${esc(b.tagline)}</span></span>`;
    $("#mark").href = `/${b.id}`;
    $("#signintitle").textContent = { bank: "Welcome to online banking", card: "Your card, online", property: "Owner portal", payroll: "Employee self-service", policy: "My policies" }[b.kind] || "Sign in";
    $("#accountsLabel").textContent = { bank: "Accounts", card: "Cards", property: "Properties", payroll: "Employments", policy: "Policies" }[b.kind] || "Accounts";
    $("#foot").innerHTML = `${esc(b.name)} is a parody that stands in for ${esc(b.standsInFor)}. The column shapes are real; the name and the mark are original. Fictional household; nothing here is advice. <a href="https://github.com/EthDawg/the-kitty">Source</a>`;
  };

  const renderAccounts = () => {
    $("#accounts").innerHTML = data.accounts.map((a, i) => `<label class="acct"><input type="radio" name="acct" value="${esc(a.id)}" ${i === 0 ? "checked" : ""}>
      <span><span class="name">${esc(a.name)}${a.in_sheet === false ? '<span class="badge off">not on the sheet</span>' : ""}</span><br><span class="sub">${esc(a.number)} · ${esc(a.type)}${a.note ? `<br>${esc(a.note)}` : ""}</span></span>
      ${a.balance != null ? `<span class="bal num">${aud(a.balance)}<small>as at ${fmtDate(data.months.length ? monthEnd(data.months[data.months.length - 1]) : "")}</small></span>` : ""}</label>`).join("");
    $("#asof").textContent = `Files cover ${fmtDate(`${data.months[0]}-01`)} to ${fmtDate(monthEnd(data.months[data.months.length - 1]))}. The household's sheet is closed through ${fmtDate(monthEnd(data.sheet_through))}; ${data.simulated.map((m) => MONTHS[Number(m.slice(5)) - 1] + " " + m.slice(0, 4)).join(" and ")} are the months ahead, from the same simulator.`;
    $("#accounts").addEventListener("change", () => selectAccount($("input[name=acct]:checked").value));
    selectAccount(data.accounts[0].id);
  };
  const monthEnd = (m) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`; };

  const selectAccount = (id) => {
    current = data.accounts.find((a) => a.id === id);
    $("#exporttitle").textContent = current.name;
    $("#preset").innerHTML = current.presets.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join("") + `<option value="custom">Custom range</option>`;
    const isPolicy = current.kind === "policy";
    $("#from").disabled = $("#to").disabled = isPolicy;
    const first = current.presets[0];
    if (first) { $("#from").value = first.from; $("#to").value = first.to; }
    $("#formats").innerHTML = current.formats.map(([v, label], i) => `<label><input type="radio" name="format" value="${esc(v)}" ${i === 0 ? "checked" : ""}> ${esc(label)}</label>`).join("");
    $("#preview").innerHTML = ""; $("#exportstatus").textContent = "";
  };

  $("#preset").addEventListener("change", (e) => {
    if (e.target.value === "custom") return;
    const p = current.presets[Number(e.target.value)]; $("#from").value = p.from; $("#to").value = p.to;
  });
  for (const id of ["from", "to"]) $("#" + id).addEventListener("input", () => { $("#preset").value = "custom"; });

  const params = () => new URLSearchParams({ brand: brandId, account: current.id, from: $("#from").value, to: $("#to").value });

  $("#exportbtn").addEventListener("click", () => {
    const fmt = $("input[name=format]:checked").value;
    const url = `/api/export?${params()}&format=${encodeURIComponent(fmt)}`;
    $("#exportstatus").textContent = "Your download is on its way.";
    const a = document.createElement("a"); a.href = url; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { $("#exportstatus").textContent = "Downloaded. Save it, unchanged, under sources/<account>/<today>/ and run the importer."; }, 1200);
  });

  $("#previewbtn").addEventListener("click", async () => {
    $("#exportstatus").textContent = "Loading…";
    const r = await fetch(`/api/accounts?${params()}`, { headers: { Accept: "application/json" } });
    const j = await r.json();
    if (!r.ok) { $("#exportstatus").textContent = j.error || "Could not load."; return; }
    $("#exportstatus").textContent = `${j.rows.length} rows`;
    const numeric = (c) => /amount|balance|opening|closing|interest|repayments|gross|tax|super|net|premium/i.test(c);
    $("#preview").innerHTML = `<div class="summary">${j.summary.map(([k, v]) => `<span><b class="num">${esc(v)}</b>${esc(k)}</span>`).join("")}</div>
      <div class="tablewrap"><table><thead><tr>${j.columns.map((c) => `<th class="${numeric(c) ? "r" : ""}">${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${j.rows.map((row) => `<tr>${row.map((v, i) => `<td class="${numeric(j.columns[i]) ? "r" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${j.columns.length}" class="muted">Nothing in this period.</td></tr>`}</tbody></table></div>`;
  });

  $("#loginform").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#loginbtn").disabled = true; $("#loginerror").hidden = true;
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ brand: brandId, name: $("#name").value, password: $("#password").value }) });
    const j = await r.json().catch(() => ({}));
    $("#loginbtn").disabled = false;
    if (!r.ok) { $("#loginerror").textContent = j.error || "Could not sign in."; $("#loginerror").hidden = false; return; }
    load();
  });
  $("#signout").addEventListener("click", async () => { await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ brand: brandId }) }); load(); });

  const load = async () => {
    const r = await fetch(`/api/accounts?brand=${encodeURIComponent(brandId)}`, { headers: { Accept: "application/json" } });
    if (r.status === 401) { $("#signin").hidden = false; $("#dash").hidden = true; $("#who").hidden = true; $("#loginbrand").value = brandId; if (new URLSearchParams(location.search).get("error")) { $("#loginerror").textContent = "Any name will do, and the password is demo."; $("#loginerror").hidden = false; } $("#name").focus(); return; }
    data = await r.json();
    $("#signin").hidden = true; $("#dash").hidden = false; $("#who").hidden = false; $("#whoname").textContent = `Signed in as ${data.name}`;
    renderAccounts();
  };

  fetch("/brands.json").then((r) => r.json()).then((brands) => {
    brand = brands.find((b) => b.id === brandId);
    if (!brand) { location.replace("/"); return; }
    applyBrand(brand);
    $("#brandswitch").innerHTML = brands.map((b) => `<option value="${b.id}" ${b.id === brandId ? "selected" : ""}>${esc(b.name)}</option>`).join("");
    $("#brandswitch").addEventListener("change", (e) => { location.href = `/${e.target.value}`; });
    load();
  });
})();
