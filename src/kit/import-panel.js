/* Bank source review shared by the artifact and iOS. Original selection and remote authority belong to the host. */
(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const maxBytes = 5 * 1024 * 1024;
  async function browserFile(file) {
    if (!file || !/\.csv$/i.test(file.name) || !file.size || file.size > maxBytes) throw Error("Choose an original bank CSV up to 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)), n=>n.toString(16).padStart(2,"0")).join("");
    try { return {id,name:file.name,byteLength:bytes.length,text:new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes),mimeType:"text/csv"}; }
    catch (_) { throw Error("Choose a UTF-8 bank export. This file could not be decoded without changing its bytes."); }
  }

  function holdHTML(message) { return '<h3>Import on hold</h3><p>'+esc(message)+'</p>'; }

  function summaryHTML(s, holdMessage) {
    const rows = (list, pending) => list.map(r=>'<li><b>'+esc(r.signedAmount)+' '+esc(s.currency)+'</b> · '+esc(r.date)+' · '+esc(r.raw)+
      (pending ? ' · '+esc(r.id)+' · '+esc(r.merchant)+' · '+esc(r.category)+' · '+esc(r.person) : '')+' · source row '+esc(r.line)+'</li>').join("");
    const outside=s.outside.reduce((a,x)=>a+(x.earlier||0)+(x.later||0),0);
    const outsideRows=s.outside.flatMap(window=>window.rows||[]);
    const detail=(title,content)=>content?'<details><summary>'+esc(title)+'</summary>'+content+'</details>':'';
    const list = a => a.length ? '<ul>'+a.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>' : '';
    const heading=s.status==="ready" ? (s.proposedCount?"Review proposed changes":"No new bank entries"):"Check this source before importing";
    return (holdMessage?holdHTML(holdMessage):'<h3>'+heading+'</h3>')+
      '<p><b>'+esc(s.name)+'</b> → '+esc(s.accountName)+' ('+esc(s.account)+') · '+esc(s.month)+' · downloaded '+esc(s.downloadDay)+'</p>'+
      '<p>'+(Number.isInteger(s.sourceRows)?esc(s.sourceRows)+' source rows · ':'')+esc(s.proposedCount)+' proposed · '+esc(s.duplicateCount)+' already in this Sheet'+(outside?' · '+esc(outside)+' outside the selected month':'')+'.</p>'+
      (s.rows.length?'<ol>'+rows(s.rows,true)+'</ol>':'')+
      detail('Already in this Sheet ('+s.duplicates.length+')',s.duplicates.length?'<ul>'+rows(s.duplicates,false)+'</ul>':'')+
      (outsideRows.length?'<details'+(outsideRows.length<=3?' open':'')+'><summary>Outside the selected month ('+esc(outsideRows.length)+')</summary><ul aria-label="Outside the selected month">'+rows(outsideRows,false)+'</ul></details>':'')+
      list(s.faults.concat(s.holds)) + (s.restriction?'<p>'+esc(s.restriction)+'</p>':'')+
      detail('Review notes',list(s.review))+
      (s.checks.length?'<p>'+s.checks.map(c=>esc(c.unchecked?'Balance check: '+c.unchecked:'Closing balance '+c.day+': '+c.printed+' printed, '+c.ledger+' in the ledger')).join('<br>')+'</p>':'')+
      detail('Original and exact Sheet plan','<p>'+esc(s.byteLength)+' bytes · SHA-256 <code style="overflow-wrap:anywhere">'+esc(s.sourceID)+'</code></p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify({writes:s.writes,deferred:s.deferred},null,2))+'</pre>');
  }

  function open(host) {
    const core=root.KittyBank, accounts=(host.sheet.accounts || []).filter(a=>a.account_id && String(a.valuation_method).toLowerCase()==="ledger" && String(a.status).toLowerCase()==="active");
    if (!core || !accounts.length) { host.drawer("<h2>Bank imports</h2><p>"+(core?"This Sheet needs an active ledger account for a bank export.":"The period planner could not be loaded. Reopen the app.")+"</p>"); return; }
    const day=host.asOf || (host.sheet.settings||[]).find(s=>s.setting==="As-of date")?.value || "";
    host.drawer('<h2>Import a bank file</h2><p>Choose the original bank CSV and its Sheet account. Review the signed amounts and existing matches before saving.</p>'+
      (host.pick?'<button class="btn" id="ifpick">Choose from Files</button>':'<label>Bank file <input id="iffile" type="file" accept=".csv,text/csv"></label>')+
      '<p id="ifname" role="status"></p><label>Sheet account <select id="ifaccount"><option value="">Choose an account</option>'+
      accounts.map(a=>'<option value="'+esc(a.account_id)+'">'+esc(a.account||a.account_id)+'</option>').join("")+'</select></label>'+
      '<p><label>Month to import <input type="month" id="ifmonth"></label></p><label>Date of the download <input type="date" id="ifdate"></label>'+
      '<p class="sub">Kitty checks all the dates in the export. Only rows in the selected month can be added.</p>'+
      '<button class="btn" id="ifprepare">Preview import</button><section id="ifresult" aria-live="polite"></section>');
    const box=document.querySelector("#drawer"), q=id=>box.querySelector("#"+id);
    const account=q("ifaccount"), month=q("ifmonth"), date=q("ifdate"), name=q("ifname"), result=q("ifresult"), preview=q("ifprepare");
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) { month.value=day.slice(0,7); date.value=day; }
    let file=null, busy=false, revision=0;
    const mounted=()=>name.isConnected && host.current();
    function stale(){ revision++; result.replaceChildren(); }
    function lock(value){busy=value; for(const control of [q("ifpick"),q("iffile"),account,month,date,preview])if(control)control.disabled=value;}
    for(const input of [account,month,date]) { input.addEventListener("input",stale); input.addEventListener("change",stale); }
    async function receive(reader) {
      if(busy) return;
      stale(); file=null; lock(true); name.textContent="Opening the selected file…";
      try{
        const selected=await reader(); if(!mounted())return;
        if(!selected || !/^[a-f0-9]{64}$/.test(selected.id) || !Number.isInteger(selected.byteLength) || selected.byteLength<1 || selected.byteLength>maxBytes) throw Error("Kitty could not verify the selected original.");
        if(selected.mimeType!=="text/csv")throw Error("This bank account needs the bank’s CSV export. A PDF cannot establish its transaction rows.");
        if(["failed","partial","cancelled"].includes(selected.state))throw Error(selected.messages?.join(" ")||"The original could not be read completely.");
        file=selected;
        const hint=file.name.match(/(20\d\d-(?:0[1-9]|1[0-2]))(?:[.\-_]|$)/); if(hint)month.value=hint[1];
        name.textContent=file.name+" · "+file.byteLength.toLocaleString()+" bytes";
      }catch(e){if(mounted())name.textContent=e?.code==="cancelled"?"No file selected.":e.message||"Could not read this original.";}
      finally{lock(false);}
    }
    q("ifpick")?.addEventListener("click",()=>receive(host.pick));
    q("iffile")?.addEventListener("change",e=>{const picked=e.target.files[0];if(picked)receive(()=>browserFile(picked));});
    function details(){return {sourceID:file.id,name:file.name,byteLength:file.byteLength,mimeType:file.mimeType,account:account.value,month:month.value,downloadDay:date.value};}
    function verified(r){return r?.status==="verified" && /^[a-f0-9]{64}$/.test(r.digest);}
    function revealReview(){
      const heading=result.querySelector?.("h3");
      if(!heading)return;
      heading.tabIndex=-1;heading.style.scrollMarginBlockStart="1rem";
      heading.focus({preventScroll:true});heading.scrollIntoView({block:"start",behavior:"instant"});
    }
    function showReceipt(r,s){ if(!verified(r))throw Error("The Sheet receipt has not been verified. Preview the same original to check again.");
      result.innerHTML='<h3>Verified import</h3><p>'+esc(r.message||"The saved receipt and the exact Sheet rows were checked.")+'</p><p>'+esc(s.duplicateCount)+' already in this Sheet at preview.</p><details><summary>Verification receipt</summary><code style="overflow-wrap:anywhere">'+esc(r.digest)+'</code></details>';
      revealReview(); }
    preview.addEventListener("click",async()=>{
      if(busy||!mounted())return;
      stale();const turn=revision;
      if(!file || !accounts.some(a=>a.account_id===account.value)){result.textContent="Choose a bank CSV and an active ledger account.";return;}
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)||!root.SheetContract.validDate(date.value)){result.textContent="Choose the month and the bank download date.";return;}
      const request=details();lock(true);result.textContent=host.preview?"Checking the retained original and the current Sheet…":"Checking the bank export…";
      try{
        let response;
        if(host.preview)response=await host.preview(request);
        else {
          const sheet=host.grids?core.fromGrids(host.grids,true):host.sheet;
          response={mode:"preview",summary:core.prepare(sheet,file,{...request,sheetID:host.sheetID}).summary};
        }
        if(!mounted()||turn!==revision)return;
        if(response?.mode==="pending"&&!response.summary){
          result.innerHTML=holdHTML(response.message||"A previous import needs its receipt checked.");
          revealReview();return;
        }
        const s=response?.summary;
        if(!s||Object.entries(request).some(([k,v])=>s[k]!==v)||!Array.isArray(s.rows)||s.rows.length!==s.proposedCount||!Array.isArray(s.duplicates)||s.duplicates.length!==s.duplicateCount)throw Error("The preview does not match this original, account and period. Choose Preview import again.");
        if(response.mode==="verified"){showReceipt(response.receipt,s);return;}
        const holdMessage=response.mode==="pending"?(response.message||"A previous import is still being checked."):null;
        result.innerHTML=summaryHTML(s,holdMessage);
        revealReview();
        if(holdMessage)return;
        const explain=document.createElement("p");
        explain.textContent=response.message||(!host.commit?"This is a preview. No Sheet rows were written.":s.proposedCount===0?"No Sheet rows were written.":"Check the complete preview before saving.");
        result.append(explain);
        const label={confirm:"Confirm import to "+host.title,reimport:"Reimport removed entries to "+host.title,recover:"Check previous import receipt",resume:"Resume verified import",stale:"Discard outdated review"}[response.mode];
        if(!label || !host.preview || !host.commit || typeof response.ticket!=="string" || !response.ticket ||
            (["confirm","reimport"].includes(response.mode) && (s.status!=="ready" || !s.proposedCount || !s.writes.length || s.deferred.length)) ||
            (response.mode==="stale" && !host.cancel))return;
        if(["confirm","reimport","resume"].includes(response.mode)){
          const destination=document.createElement("p");
          destination.textContent="Your private Google Drive will keep the full original CSV, including duplicates, other columns and rows outside this month, and its import record. The reviewed entries will go into “"+host.title+"”, where anyone with access to that Sheet can read them.";
          result.append(destination);
        }
        function addAction(label, ticket, discard){
          const button=document.createElement("button");button.type="button";button.className=discard?"btn ghost":"btn";button.textContent=label;result.append(button);
          button.onclick=async()=>{
          if(busy||!mounted()||revision!==turn||JSON.stringify(details())!==JSON.stringify(request))return;
          lock(true);button.disabled=true;
          try{
            const reply=await (discard?host.cancel(ticket):host.commit(ticket));
            if(!mounted()||revision!==turn)return;
            if(discard){
              if(verified(reply)){showReceipt(reply,s);return;}
              if(reply?.status==="needsReview"){result.textContent=reply.message;return;}
              if(reply?.status!=="cancelled")throw Error("Cancellation was not confirmed. Preview the original to check the receipt.");
              result.textContent=reply.message||"Unfinished import discarded. Choose Preview import to check current rows.";
            }else showReceipt(reply,s);
          }catch(e){if(mounted()&&revision===turn)result.textContent=e.message||"No verified receipt yet. Preview this same file to check its status.";}
          finally{lock(false);}
          };
        }
        addAction(label,response.ticket,response.mode==="stale");
        if(response.mode!=="stale" && host.cancel && typeof response.discardTicket==="string")
          addAction("Discard unfinished import",response.discardTicket,true);
      }catch(e){if(mounted()&&turn===revision)result.textContent=e.message||"The import could not be prepared. No new write was requested.";}
      finally{lock(false);}
    });
  }
  root.KittyIntake=Object.freeze({open});
})(window);
