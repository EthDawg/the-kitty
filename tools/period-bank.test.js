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
  const r=plan(after(plan().plan),f,{...request,downloadDay:"2027-02-01"});
  assert.equal(r.summary.sourceRows,4);assert.equal(r.summary.duplicateCount,3);assert.equal(r.summary.outside[0].later,1);
  assert.equal(r.summary.allDuplicates,true);assert.equal(r.plan.writes.length,0);
});
test("wrong institution, unsafe source spelling and missing card amount cannot produce an append",()=>{
  assert.equal(plan(sheet,file,{...request,account:"ACC-EVD"}).summary.status,"stopped");
  function change(text){return {...file,text,byteLength:Buffer.byteLength(text),id:crypto.createHash("sha256").update(text).digest("hex")};}
  assert.throws(()=>plan(sheet,change(file.text.replace("17.45",""))),/missing/i);
  assert.throws(()=>plan(sheet,change(file.text.replace("KITTY PRACTICE PAPER BOAT","'=ATTACK"))),/apostrophe/i);
  assert.throws(()=>plan(sheet,{...file,name:"../bank.csv"}),/original UTF-8/i);
  assert.throws(()=>plan({...sheet,accounts:sheet.accounts.map(a=>a.account_id==="ACC-CC"?{...a,currency:"JPY"}:a)}),/Australian-dollar/);
});

function panelFixture(responseMode, remote=true, verifiedOnCancel=false) {
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
  const replay=["verified","recover","resume"].includes(responseMode), snapshot=replay?after(plan().plan):sheet;
  const summary=plan(snapshot).summary, digest="a".repeat(64);
  const receipt={status:"verified",digest,message:"Saved rows and receipt were checked."};
  window.KittyIntake.open({sheet:snapshot,asOf:"2027-01-31",title:"Private practice",sheetID:request.sheetID,current:()=>current,drawer:()=>{},pick:async()=>file,
    preview:remote?async request=>{calls.preview.push(request);return {mode:responseMode,summary,ticket:"one-use-ticket",...(responseMode==="verified"?{receipt}:{})};}:null,
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
