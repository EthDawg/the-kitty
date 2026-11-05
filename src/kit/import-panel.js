/* A single intake UI. File access and confirmed writes are supplied by the host. */
(function (root) {
  "use strict";
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]);
  const fileMax = 5 * 1024 * 1024;
  async function browserFile(file) {
    if (!file || !/\.(csv|pdf)$/i.test(file.name) || !file.size || file.size > fileMax) throw Error("Choose a CSV or PDF under 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), v => v.toString(16).padStart(2,"0")).join("");
    if (/\.pdf$/i.test(file.name)) throw Error("The artifact cannot read PDF pages. Open the original on your iPhone, or choose the bank’s CSV.");
    try { return { id, name:file.name, byteLength:bytes.length, text:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes), mimeType:"text/csv" }; }
    catch (_) { throw Error("Choose a UTF-8 CSV export. The original has not been changed."); }
  }
  const firstOf = (ym, fallback) => /^\d{4}-\d{2}$/.test(ym || "") ? ym : fallback;
  function open(host) {
    const starting = host.sheet;
    const accounts = (starting.accounts || []).filter(a => a.account_id
      && String(a.valuation_method || "").trim().toLowerCase() === "ledger" && String(a.status || "").trim().toLowerCase() === "active");
    const periodPlanner = typeof root.KittyPeriod?.plan === "function" ? root.KittyPeriod : null;
    if (!accounts.length) { host.drawer("<h2>Import a bank file</h2><p>This Sheet needs an active ledger account for a bank export.</p>"); return; }
    const day = (starting.settings || []).find(s=>s.setting==="As-of date")?.value || "";
    let file, approvedPlan, busy = false;
    host.drawer('<h2>Import a bank file</h2><p>Choose the original export, tell Kitty which account it belongs to, then check the proposed rows.</p>'
      + (host.pick ? '<button class="btn" id="ifpick">Choose from Files</button>' : '<label>Bank file <input id="iffile" type="file" accept=".csv,.pdf"></label>')
      + '<p id="ifname" role="status"></p><label>Sheet account <select id="ifaccount"><option value="">Choose an account</option>'
      + accounts.map(a=>'<option value="'+esc(a.account_id)+'">'+esc(a.account || a.account_id)+'</option>').join("") + '</select></label>'
      + (periodPlanner ? '<p><label>Month to import <input type="month" id="ifmonth"></label></p><label>Date of the download <input type="date" id="ifdate"></label>'
        + '<p class="sub">Use the date of the bank export. Kitty checks the source dates, including overlaps with rows already in the Sheet.</p>'
        : '<p class="sub">The preview checks all dates in this export against the selected account.</p>')
      + '<button class="btn" id="ifprepare">Preview import</button><section id="ifresult" aria-live="polite"></section>');
    const box = document.querySelector("#drawer"), q = id => box.querySelector("#"+id);
    const account=q("ifaccount"), month=q("ifmonth"), date=q("ifdate"), name=q("ifname"), result=q("ifresult");
    if (periodPlanner && /^\d{4}-\d{2}-\d{2}$/.test(day)) { month.value=day.slice(0,7); date.value=day; }
    const mounted = () => name.isConnected && host.current();
    function stale() { approvedPlan=null; result.replaceChildren(); }
    for (const f of [account,month,date]) f?.addEventListener("change",stale);
    async function receive(reader) {
      if (busy) return;
      stale(); file=null; busy=true; name.textContent="Opening the selected file…";
      try {
        const value=await reader();
        if (!mounted()) return;
        if (!value || !/^[a-f0-9]{64}$/.test(value.id) || !value.byteLength || value.byteLength>fileMax) throw Error("Kitty could not verify the original.");
        file=value;
        const hint=(value.name.match(/(20\d\d-\d\d)(?:[.\-_]|$)/)||[])[1];
        if (hint && month) month.value=firstOf(hint,month.value);
        name.textContent=value.name+" · "+value.byteLength.toLocaleString()+" bytes"+(value.ocr?" · text recognised on iPhone; check every figure.":"");
      } catch(e) { if (mounted()) name.textContent=e?.code==="cancelled"?"No file selected.":String(e?.message || "Could not read the selected file."); }
      finally { busy=false; }
    }
    q("ifpick")?.addEventListener("click",()=>receive(host.pick));
    q("iffile")?.addEventListener("change",e=>{ const f=e.target.files[0]; if(f) receive(()=>browserFile(f)); });
    function previewFallback() {
      if (file.mimeType!=="text/csv") { result.textContent="Extracted document text is ready to review; this file needs a supported statement adapter before it can write."; return; }
      const existing = (starting.entries||[]).filter(e=>e.kind==="transaction").map(e=>({
        id:e.entry_id,date:e.settled_at,accountId:e.account_id,description:e.raw_text||e.description||"",categoryId:e.category_id,
        amountMinor:root.KittyImport.money(String(e.amount))}));
      const currency=(starting.kitty||[]).find(r=>r.key==="currency")?.value;
      const options = {files:[{...file,accountId:account.value}],existing,currency,accounts:accounts.map(a=>({id:a.account_id,name:a.account,owner:a.owner,currency:a.currency||currency})),
        categories:(starting.category_list||[]).map(c=>({id:c.category_id,name:c.category})),decisions:{}};
      const preview=root.KittyImport.prepare(options);
      result.innerHTML="<h3>File preview</h3><p>"+preview.counts.source+" source rows · "+preview.rows.length+" proposed · "+(preview.counts.existing||0)+" already matched.</p>"
        + listRows(preview.rows.slice(0,20).map(r=>[r.date,r.description,r.decimalAmount || root.KittyImport.decimalAmount(r.amountMinor)]))
        + "<p>"+esc(preview.issues[0]?.message || "Preview only. No rows were written.")+"</p>";
    }
    function listRows(rows) { return '<ul>'+rows.map(r=>'<li>'+r.map(esc).join(" · ")+'</li>').join("")+'</ul>'; }
    q("ifprepare").addEventListener("click",async()=>{
      if (busy || !mounted()) return;
      stale();
      if(!file || !accounts.some(a=>a.account_id===account.value)) { result.textContent="Choose a file and an active ledger account."; return; }
      if(periodPlanner && (!/^\d{4}-\d{2}$/.test(month.value) || !root.SheetContract.validDate(date.value))) { result.textContent="Choose the month and date of the download."; return; }
      if(file.state==="failed" || file.state==="partial" || file.state==="cancelled") { result.textContent=file.messages?.length ? file.messages.join(" ") : "This source needs review. Try a shorter export."; return; }
      try {
        if (!periodPlanner) { previewFallback(); return; }
        if (file.mimeType==="text/csv") root.KittyImport.validateBankOriginal(file.text);
        const f={name:file.name,account:account.value,download_day:date.value,...(file.mimeType==="text/csv"?{text:file.text}:{pdf_text:file.pdf_text})};
        const input={months:month.value,sheet:starting,files:[f],inputs:[],options:{as_of:date.value,...(host.sheetID?{sheet_id:host.sheetID}:{})}};
        const prepared=periodPlanner.plan(input), writes=prepared.plan?.writes || [], tx=prepared.proposed?.transactions || [];
        const faults=(prepared.faults||[]).concat(prepared.holds||[]).map(h=>String(h.message||h.reason||h.code||h));
        const counts=prepared.outcomes||[];
        result.innerHTML="<h3>"+(prepared.status==="ready"?(writes.length?"Review proposed changes":"Nothing new to write"):"Check the source before importing")+"</h3><p>"+esc(file.name)+" → "+esc(account.options[account.selectedIndex].text)+"</p>"
          + listRows(tx.slice(0,25).map(r=>[r.date,r.raw_text,root.SheetContract.decimalAmount(String(r.amount_cents))]))
          + (tx.length>25?"<p>"+(tx.length-25)+" more transactions.</p>":"")
          + faults.map(s=>'<p>'+esc(s)+'</p>').join("")
          + (writes.length? "<details><summary>Every proposed Sheet change ("+writes.length+")</summary><pre style='white-space:pre-wrap;overflow-wrap:anywhere'>"+esc(JSON.stringify(writes,null,2))+"</pre></details>":"")
          + "<p>"+(writes.length && !host.commit?"This host can preview the import. No rows were written.":!writes.length?"No rows were written.":"Only confirm after checking the whole preview.")+"</p>";
        if(prepared.status==="ready" && writes.length && host.commit){
          approvedPlan={file,account:account.value,downloadDay:date.value,month:month.value,plan:prepared.plan};
          const b=document.createElement("button");b.type="button";b.className="btn";b.textContent="Confirm import to "+host.title;result.append(b);
          b.onclick=async()=>{
            if(!mounted() || !approvedPlan || busy) return;
            const proposal=approvedPlan;approvedPlan=null;busy=true;b.disabled=true;
            try{const receipt=await host.commit(proposal); if(mounted())result.textContent=receipt.message;}
            catch(e){if(mounted())result.textContent=e.message||"No verified receipt yet. Recheck the import before trying again.";}
            finally{busy=false;}
          };
        }
      } catch(e) { result.textContent=e.message || "The import could not be prepared. No rows were written."; }
    });
  }
  root.KittyIntake={open};
})(window);
