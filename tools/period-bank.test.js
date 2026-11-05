const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const B = require("../src/core/period-bank"), P = require("../src/core/period-core"), C = require("../src/core/sheet-contract");
const sheet = require("../data/snapshot-v2.json");
const original = fs.readFileSync(path.join(__dirname,"../fixtures/Kitty-2027-01-card-proof.csv"));
const file = {id:crypto.createHash("sha256").update(original).digest("hex"),name:"Kitty-2027-01-card-proof.csv",mimeType:"text/csv",byteLength:original.length,text:original.toString("utf8")};
const request = {sheetID:"fixture-private",account:"ACC-CC",month:"2027-01",downloadDay:"2027-01-31"};
const plan = (snapshot=sheet,f=file,r=request)=>B.prepare(snapshot,f,r);
const headers={
  decisions:["Decision ID","Ref kind","Ref ID","Decision","Value","By","At","Note"],
  kitty:["Key","Value"],accounts:["Account ID","Account","Institution","Type","Owner","Opening balance ($)","Opening date","Balance at as-of date ($)","Liquid","Class","Valuation method","Currency","Status","Purpose","Linked account","Note"],
  entries:["Entry ID","Kind","Settled at","Account ID","Raw text","Description","Amount","Category ID","Person","Receipt held","Note","Status","Created at","Transfer ID","Transfer account","Foreign amount","Foreign currency","Units","Unit price","Source"],
  category_list:["Category ID","Category","Group","Flow","Monthly budget ($)","Essential","Tax treatment","ATO label"],rules:["Rule ID","Pattern","Match","Merchant","Category ID","Person","Tax label","Property","Source","Note"],
  contracts:["Contract ID","Kind","Name","Provider","Owner","Account ID","Category ID","Cadence","Amount ($)","Rate","Start date","End date","Next date","Last used","Cover","Status","Note"],
  payslips:["Pay date","Person","Employer","Gross pay","Tax withheld","Super (employer)","Net pay"],assets:["Item ID"],loans:["Loan ID"]
};
const key = h=>h.toLowerCase().replace(/\(.*?\)/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
const serial = d=>Math.floor(Date.parse(d+"T00:00:00Z")/86400000)+25569;
function asGrids(snapshot=sheet){
  const grids=Object.fromEntries(Object.entries(headers).map(([tab,cols])=>[tab,[cols,...snapshot[tab].map(r=>cols.map(h=>{
    const value=r[key(h)];return !value&&value!==0?"": typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)?serial(value):value;
  }))]]));
  grids.kitty.unshift(["Kitty settings"],["Fictional settings preface"],[]);
  return grids;
}
function after(originalPlan){
  const entries = originalPlan.writes.flatMap(w=>w.values).map(row=>Object.fromEntries(headers.entries.map((h,i)=>[key(h),row[i]])));
  return {...sheet,entries:sheet.entries.concat(entries)};
}
test("one preview reproduces the canonical plan, every signed row and the existing debit",()=>{
  const {plan:actual,summary:s}=plan();
  const oracle=P.plan({months:request.month,sheet,files:[{name:file.name,account:request.account,download_day:request.downloadDay,text:file.text}],inputs:[],options:{sheet_id:request.sheetID,as_of:request.downloadDay}});
  assert.deepEqual(actual,oracle.plan);
  assert.equal(s.status,"ready");assert.equal(s.sourceRows,3);assert.equal(s.duplicateCount,1);
  assert.deepEqual(s.rows.map(r=>[r.raw,r.signedAmount,r.line]),[["KITTY PRACTICE PAPER BOAT","-17.45",3],["KITTY PRACTICE KITE REFUND","+6.25",4]]);
  assert.deepEqual(s.duplicates.map(d=>[d.raw,d.signedAmount,d.line]),[["MYKI TOP UP","-60.00",2]]);
  assert.equal(s.sourceID,file.id);assert.equal(s.byteLength,original.length);
});
test("a partially deleted import leaves its Decisions attached only to their original IDs",()=>{
  const original=plan().plan, old=original.writes[0].values, landed=after(original);
  const removedID=old[1][0], number=Number(removedID.slice(1)), physical=old[0][0];
  const tx=n=>"T"+String(n).padStart(4,"0");
  const decisions=[
    {decision_id:"DZ1",ref_kind:"entry",ref_id:removedID,decision:"categorise",value:"GROCERIES"},
    {decision_id:"DZ2",ref_kind:"entry",ref_id:physical,decision:"categorise",value:"T9999"},
    {decision_id:"DZ3",ref_kind:"contract",ref_id:"T9998",decision:"planned_refresh",value:"T9997"}];
  const partial={...landed,entries:landed.entries.filter(e=>e.entry_id!==removedID),decisions};
  const check=(floor,expected)=>{
    const out=B.fromFreshGrids(asGrids(partial),file,{...request,transactionIDFloor:floor});
    assert.equal(out.summary.duplicateCount,2);assert.deepEqual(out.summary.rows.map(r=>r.id),[tx(expected)]);
    assert.equal(out.plan.assumes.last_ids.T,physical);assert.equal(out.plan.assumes.transaction_id_floor,expected-1);
    const added=Object.fromEntries(headers.entries.map((h,i)=>[key(h),out.plan.writes[0].values[0][i]]));
    const model=require("../src/engine").model({...partial,entries:[...partial.entries,added]});
    const next=model.entries.find(e=>e.id===tx(expected));
    assert.equal(next.cat,"UNCAT");assert.equal(next.matchedWith,undefined);assert.equal(next.dupOf,undefined);
  };
  check(0,number+1);
  decisions.push({decision_id:"DZ4",ref_kind:"entry",ref_id:physical,decision:"match_transfer",value:tx(number+2)});
  check(0,number+3);
  decisions.push({decision_id:"DZ5",ref_kind:"entry",ref_id:physical,decision:"merge_duplicate",value:tx(number+4)});
  check(0,number+5);check(number+8,number+9);
  const grids=asGrids(partial);delete grids.decisions;
  assert.throws(()=>B.fromFreshGrids(grids,file,request),/complete Decisions/);
  for(const bad of [-1,1.4,"12",null,100000000])assert.throws(()=>plan(partial,file,{...request,transactionIDFloor:bad}),/transaction_id_floor/);
});
test("fresh raw Sheets serials map to the same reviewed bank append, while damaged or sparse grids stop",()=>{
  const g=asGrids(), before=plan({...sheet,fetchedAt:null}), fresh=B.fromFreshGrids(g,file,request);
  assert.deepEqual(fresh.plan,before.plan);assert.deepEqual(fresh.summary,before.summary);
  for(const change of [x=>x.entries.splice(2,0,[]),x=>x.entries[2][0]=x.entries[1][0],x=>x.entries[1][6]="",x=>x.entries[1][2]=12.5,
    x=>x.entries[1][6]=0.123,x=>x.entries[0].splice(7,1),x=>x.accounts[1][5]="unknown",x=>x.kitty.push(["sheet_version","1"])]) {
    const changed=structuredClone(g);change(changed);assert.throws(()=>B.fromFreshGrids(changed,file,request));
  }
});
test("reselecting the identical source after a committed write gives three matches and zero writes",()=>{
  const applied=after(plan().plan), result=plan(applied);
  assert.equal(result.summary.allDuplicates,true);assert.equal(result.summary.duplicateCount,3);assert.deepEqual(result.plan.writes,[]);
  const utf8=Buffer.from("\uFEFF"+file.text.replace(/\r?\n/g,"\r\n"),"utf8");
  const bom={...file,text:utf8.toString("utf8"),byteLength:utf8.length,id:crypto.createHash("sha256").update(utf8).digest("hex")};
  assert.equal(plan(applied,bom).summary.duplicateCount,3);
  assert.throws(()=>plan(sheet,{...file,byteLength:original.length-1}),/original UTF-8/);
});
test("outside-month rows stay visible and do not hide an all-matched selected month",()=>{
  const text=file.text.trimEnd()+"\n01/02/2027,LATER DAY,JORDAN DAVIES,-41007,3.00\n";
  const f={...file,text,byteLength:Buffer.byteLength(text),id:crypto.createHash("sha256").update(text).digest("hex")};
  const landed=after(plan().plan), downloadDay="2027-02-01";
  const r=plan(landed,f,{...request,downloadDay});
  assert.equal(r.summary.sourceRows,4);assert.equal(r.summary.duplicateCount,3);assert.equal(r.summary.outside[0].later,1);
  assert.deepEqual(r.summary.outside[0].rows,[{line:5,date:"2027-02-01",raw:"LATER DAY",amountCents:-300,signedAmount:"-3.00"}]);
  assert.equal(r.summary.allDuplicates,true);assert.equal(r.plan.writes.length,0);
  const input={months:request.month,sheet:landed,files:[{name:f.name,account:request.account,download_day:downloadDay,text}],
    inputs:[],options:{as_of:downloadDay,sheet_id:request.sheetID}};
  const normal=P.plan(input), detailed=P.plan({...input,options:{...input.options,review_outside_rows:true}});
  assert.equal(normal.outcomes.outside_window[0].rows,undefined);
  assert.equal(detailed.review_md,normal.review_md);assert.deepEqual(detailed.plan,normal.plan);
  assert.deepEqual(r.plan,normal.plan);
});
test("wrong institution, unsafe source spelling and missing card amount cannot produce an append",()=>{
  assert.equal(plan(sheet,file,{...request,account:"ACC-EVD"}).summary.status,"stopped");
  function change(text){return {...file,text,byteLength:Buffer.byteLength(text),id:crypto.createHash("sha256").update(text).digest("hex")};}
  assert.throws(()=>plan(sheet,change(file.text.replace("17.45",""))),/missing/i);
  assert.throws(()=>plan(sheet,change(file.text.replace("KITTY PRACTICE PAPER BOAT","'=ATTACK"))),/apostrophe/i);
  assert.throws(()=>plan(sheet,{...file,name:"../bank.csv"}),/original UTF-8/i);
  assert.throws(()=>plan({...sheet,accounts:sheet.accounts.map(a=>a.account_id==="ACC-CC"?{...a,currency:"JPY"}:a)}),/Australian-dollar/);
});

function panelFixture(responseMode, remote=true, verifiedOnCancel=false, reserved=false) {
  class Element {
    constructor(){this.events={};this.children=[];this.isConnected=true;this.value="";this.textContent="";this.innerHTML="";}
    addEventListener(type,fn){this.events[type]=fn;}
    replaceChildren(){this.children=[];this.textContent="";this.innerHTML="";}
    append(el){this.children.push(el);}
  }
  const ids=Object.fromEntries(["ifpick","ifaccount","ifmonth","ifdate","ifname","ifprepare","ifresult"].map(id=>[id,new Element()]));
  const drawer={querySelector(id){return ids[id.slice(1)]||null;}};
  const doc={querySelector:()=>drawer,createElement:()=>new Element()};
  const window={KittyBank:B,SheetContract:C}, calls={preview:[],commit:[],cancel:[]};
  let current=true;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/kit/import-panel.js"),"utf8"),{window,document:doc,console});
  const hasPriorImport=["verified","recover","resume","pending"].includes(responseMode);
  const snapshot=hasPriorImport?after(plan().plan):sheet;
  if(responseMode==="pending"){
    const posted=snapshot.entries.find(entry=>entry.raw_text==="KITTY PRACTICE PAPER BOAT");
    assert.ok(posted);
    posted.amount=-18.45;
  }
  const digest="a".repeat(64);
  const receipt={status:"verified",digest,message:"Saved rows and receipt were checked."};
  window.KittyIntake.open({sheet:snapshot,asOf:"2027-01-31",title:"Private practice",sheetID:request.sheetID,current:()=>current,drawer:()=>{},pick:async()=>file,
    preview:remote?async input=>{
      calls.preview.push(input);
      if(responseMode==="unfinished-date")return {mode:"pending",message:"Set Date of the download to 2027-01-31 to reopen that review."};
      const summary=plan(snapshot,file,{...request,...input}).summary;
      return {mode:responseMode,summary,ticket:"one-use-ticket",...(reserved?{discardTicket:"bound-discard"}:{}),
        ...(responseMode==="pending"?{message:"Compare the amounts in Entries with the original file."}:{}),...(responseMode==="verified"?{receipt}:{})};
    }:null,
    commit:remote?async token=>{calls.commit.push(token);return receipt;}:null,cancel:remote?async token=>{calls.cancel.push(token);return verifiedOnCancel?receipt:{status:"cancelled"};}:null});
  ids.ifaccount.value="ACC-CC";
  return {ids,calls,switchSheet:()=>{current=false;},async preview(){await ids.ifpick.events.click();await ids.ifprepare.events.click();return ids.ifresult;}};
}
test("normal file review sends metadata only and confirms with only the opaque native ticket",async()=>{
  const ui=panelFixture("confirm"), box=await ui.preview();
  assert.match(box.innerHTML,/1 already in this Sheet/);assert.match(box.innerHTML,/-17\.45 AUD/);assert.match(box.innerHTML,/\+6\.25 AUD/);
  assert.deepEqual(Object.keys(ui.calls.preview[0]).sort(),["account","byteLength","downloadDay","mimeType","month","name","sourceID"]);
  const action=box.children.at(-1);assert.equal(action.textContent,"Confirm import to Private practice");
  assert.match(box.children.at(-2).textContent,/private Google Drive.*full original CSV.*duplicates.*outside this month.*import record.*Private practice.*access to that Sheet/);
  await action.onclick();assert.deepEqual(ui.calls.commit,["one-use-ticket"]);assert.match(box.innerHTML,/Verified import/);
});
test("duplicates after a lost response can verify or recover the matching receipt, but ordinary previews cannot write",async()=>{
  const verified=panelFixture("verified"), history=await verified.preview();
  assert.match(history.innerHTML,/Verified import/);assert.match(history.innerHTML,/3 already in this Sheet/);assert.equal(verified.calls.commit.length,0);
  for(const [mode,label] of [["recover","Check previous import receipt"],["resume","Resume verified import"],["stale","Discard outdated review"]]){
    const ui=panelFixture(mode), box=await ui.preview(), action=box.children.at(-1);assert.equal(action.textContent,label);assert.equal(ui.calls.commit.length,0);
    await action.onclick();if(mode==="stale"){assert.deepEqual(ui.calls.cancel,["one-use-ticket"]);assert.match(box.textContent,/discarded/);}
    else assert.deepEqual(ui.calls.commit,["one-use-ticket"]);
  }
  const local=panelFixture("confirm",false), localBox=await local.preview();assert.match(localBox.innerHTML,/1 already in this Sheet/);assert.ok(localBox.children.every(c=>!c.onclick));
  const stale=panelFixture("confirm"), staleBox=await stale.preview(), old=staleBox.children.at(-1);
  stale.ids.ifmonth.value="2027-02";stale.ids.ifmonth.events.input();await old.onclick();assert.equal(stale.calls.commit.length,0);
  const completed=panelFixture("stale",true,true), completeBox=await completed.preview();await completeBox.children.at(-1).onclick();
  assert.match(completeBox.innerHTML,/Verified import/);assert.deepEqual(completed.calls.cancel,["one-use-ticket"]);
});
test("an unchanged reserved review can be discarded without confirming any rows",async()=>{
  const ui=panelFixture("confirm",true,false,true), box=await ui.preview();
  assert.ok(box.children.some(e=>e.textContent==="Confirm import to Private practice"));
  const discard=box.children.find(e=>e.textContent==="Discard unfinished import");
  await discard.onclick();
  assert.deepEqual(ui.calls.cancel,["bound-discard"]); assert.deepEqual(ui.calls.commit,[]);
  assert.match(box.textContent,/discarded/);
});
test("restoring a deleted import requires a new explicit confirmation",async()=>{
  const ui=panelFixture("reimport"), box=await ui.preview();
  const restore=box.children.find(e=>e.textContent==="Reimport removed entries to Private practice");
  assert.ok(restore);assert.deepEqual(ui.calls.commit,[]);
  await restore.onclick();assert.deepEqual(ui.calls.commit,["one-use-ticket"]);
});
test("a previous receipt holds the review before the amounts even when the user changes the download date",async()=>{
  const ui=panelFixture("pending");
  await ui.ids.ifpick.events.click();
  ui.ids.ifdate.value="2027-02-01";
  ui.ids.ifdate.events.change();
  await ui.ids.ifprepare.events.click();
  const box=ui.ids.ifresult;
  assert.equal(ui.calls.preview[0].downloadDay,"2027-02-01");
  assert.match(box.innerHTML,/^<h3>Import on hold<\/h3><p>Compare the amounts in Entries/);
  assert.match(box.innerHTML,/1 proposed · 2 already in this Sheet/);
  assert.match(box.innerHTML,/-17\.45 AUD/);
  assert.ok(box.children.every(element=>!element.onclick));
  assert.deepEqual(ui.calls.commit,[]);
});
test("an unfinished import can point back to the approved date before calculating a new preview",async()=>{
  const ui=panelFixture("unfinished-date");
  ui.ids.ifdate.value="2027-02-01";
  const box=await ui.preview();
  assert.match(box.innerHTML,/^<h3>Import on hold<\/h3><p>Set Date of the download to 2027-01-31/);
  assert.ok(box.children.every(element=>!element.onclick));
  assert.deepEqual(ui.calls.commit,[]);
});
