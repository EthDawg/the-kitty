import test from 'node:test';
import assert from 'node:assert/strict';
import {ImportService,ImportError,HEADERS,digest,dateSerial} from './core.mjs';
import {GOAL_HEADERS,goalFormulas,goalCells,goalRequests,goalAccountHeaders,readGoalState} from './goals-google.mjs';
import {goalDigest} from './goals.mjs';
const SHEET='fictional_goal_sheet_123',clone=structuredClone;
const cell=x=>typeof x==='number'?{numberValue:x}:{stringValue:x};
const goal={name:'A quieter summer',targetMinor:'123456',targetDate:'2027-06-30',accountId:'ACC-SAVER',currency:'AUD'};
function state(version=1,profile='legacy'){
  const account=['ACC-SAVER','Saver','Fictional','Savings','Alex',500,dateSerial('2026-06-30'),500,'Yes',...(version===2?['Cash','ledger','AUD','active','Savings','','']:[])];
  const settings=[['Household','Fictional'],[],[],[],[],['As-of date',dateSerial('2026-06-30')]];
  return {version,goalTabId:77,header:clone(GOAL_HEADERS),rows:[],layoutIssues:[],accountHeader:goalAccountHeaders(version),accounts:[account],accountInputs:[goalAccountHeaders(version).map(cell),account.map(cell)],settings,settingsInputs:settings.map(row=>row.map(cell)),otherFormulaFingerprint:digest('unchanged'),
    legacy:{version,header:HEADERS[version],rows:[],accounts:[{id:'ACC-SAVER',name:'Saver'}],categories:[],currency:'AUD',people:['Alex'],receiptValid:true,receipts:[],allTabIds:[77],formulaFingerprint:'before',...(profile==='au-aud-basic'?{openingContract:{profile,version:'1.0.0',openingDate:'2026-06-30'}}:{})}};
}
class MemoryDriver{
  constructor(version=1,profile='legacy'){this.state=state(version,profile);this.manifests=new Map();this.intents=new Map();this.next=0;this.writes=0;this.gate=null;this.fail=null;this.after=null;}
  async authorize(token,id){if(token!=='allowed'||id!==SHEET)throw new ImportError('forbidden','Wrong Sheet.',403);}
  async readGoalState(){if(this.readFails)throw new Error('offline');return clone(this.state);}
  async readState(){return clone(this.state.legacy);}
  async reserveID(){return `intent_goal_${++this.next}`;}
  async storeManifest(token,m){const id=`manifest_goal_${++this.next}`;this.manifests.set(id,clone(m));return id;}
  async loadManifest(token,id,sheet){const m=this.manifests.get(id);if(m?.sheetId!==sheet)throw new ImportError('forbidden','Wrong receipt.',403);return clone(m);}
  async readSheetGate(){return clone(this.gate);}
  async writeSheetGate(token,sheet,gate){if(this.gate&&digest(this.gate)!==digest(gate))throw new Error('held');this.gate=clone(gate);if(this.fail==='hold')throw new Error('timeout');}
  async clearSheetGate(token,sheet,expected){if(digest(this.gate)!==digest(expected))return false;if(this.fail==='clear')return false;this.gate=null;return true;}
  async findIntent(token,id){return clone(this.intents.get(id)??null);}
  async storeIntent(token,id,importId,sheet,intent){if(this.intents.has(id))throw new Error('409');if(this.fail==='intent-before')throw new Error('timeout');this.intents.set(id,clone(intent));if(this.fail==='intent-after')throw new Error('timeout');}
  async atomicGoalInsert(token,sheet,before,m,id,time){
    if(this.fail==='before')throw new Error('timeout');this.writes++;
    const row={row:this.state.rows.length+2,entered:goalCells(m.goal,m.profile).map(c=>c.userEnteredValue),effective:[m.goal.name,Number(m.goal.targetMinor)/100,dateSerial(m.goal.targetDate),m.goal.accountId,500,0.4,12,61.22,0,'Behind'],errors:[]};
    this.state.rows.push(row);this.state.legacy.receipts.push({importId:id,digest:m.proposalDigest,writtenAt:time,ids:JSON.stringify(m.recordRefs),manifestFile:id});
    if(this.after)this.after(this.state);
    if(this.fail==='after')throw new Error('timeout');
  }
}
function setup(version=1,profile='legacy'){const driver=new MemoryDriver(version,profile);return {driver,service:new ImportService({driver}),request:{sheetId:SHEET,schemaVersion:version,protocolVersion:3,operation:'goal-create',goal:clone(goal)}};}
const commit=(service,r)=>service.commit('allowed',r.importId,{sheetId:SHEET,approval:true,proposalDigest:r.proposalDigest});
for(const version of [1,2])test(`v${version} goal append verifies and repeated commit adds zero`,async()=>{
  const {driver,service,request}=setup(version),r=await service.prepare('allowed',request);assert.equal(driver.writes,0);
  const answer=await commit(service,r);assert.equal(answer.status,'verified',JSON.stringify(answer.issues));assert.equal(answer.goalRow,2);assert.equal(answer.protocolVersion,3);assert.equal(driver.gate,null);
  assert.equal((await commit(service,r)).status,'verified');assert.equal(driver.writes,1);
});
test('clean basic setup without a goal appends the guarded pinned formulas',async()=>{
  const {driver,service,request}=setup(1,'au-aud-basic'),r=await service.prepare('allowed',request);assert.equal((await commit(service,r)).status,'verified');
  assert.match(driver.state.rows[0].entered[8].formulaValue,/Settings!\$B\$36/);assert.match(driver.state.rows[0].entered[9].formulaValue,/Awaiting three months of history/);
});
test('new formula references depend on actual row, not prepared row guesses',()=>{
  for(const profile of ['legacy','au-aud-basic']){
    const dynamic=goalFormulas(profile,2,{dynamic:true});
    for(const row of [2,3,999])assert.deepEqual(dynamic.map(f=>f.replace(/INDEX\(\$([B-I]):\$\1,ROW\(\)\)/g,(_,c)=>`${c}${row}`)),goalFormulas(profile,row));
  }
});
test('production batch only appends new typed cells and receipt, never writes a guessed index',()=>{
  const s=state(2),m={goal,profile:'legacy',proposalDigest:'a'.repeat(64),recordRefs:['goal:'+goal.name]},requests=goalRequests(s,m,'manifest_123456','2026-11-05');
  assert.ok(requests.every(r=>r.appendCells||r.addSheet));const values=requests[0].appendCells.rows[0].values;
  assert.equal(values.length,10);assert.equal(values[1].userEnteredValue.numberValue,1234.56);assert.equal(values[2].userEnteredFormat.numberFormat.type,'DATE');assert.equal(values[4].userEnteredValue.formulaValue,goalFormulas('legacy',2,{dynamic:true})[0]);
  assert.ok(!JSON.stringify(requests).includes('rowIndex'));assert.ok(!JSON.stringify(requests).includes('Entries'));
});
test('an existing goal and all its formulas are preserved when another is appended',async()=>{
  const {driver,service,request}=setup();const initial=await service.prepare('allowed',request);await commit(service,initial);const first=clone(driver.state.rows[0]);request.goal.name='Another summer';
  const answer=await commit(service,await service.prepare('allowed',request));assert.equal(answer.status,'verified');assert.deepEqual(driver.state.rows[0],first);assert.equal(answer.goalRow,3);
  assert.equal((await service.status('allowed',initial.importId,{sheetId:SHEET})).status,'verified');
  driver.state.legacy.rows.push(['T9999',dateSerial('2026-07-01'),'ACC-SAVER','Later input','',1,'','','','']);
  driver.state.accounts[0][7]=501;driver.state.rows[0].effective[4]=501;
  assert.equal((await service.status('allowed',initial.importId,{sheetId:SHEET})).status,'verified');
  const other={importId:'different_import_123',proposalDigest:'a'.repeat(64),rowsHash:'b'.repeat(64),stateHash:'c'.repeat(64),version:1};driver.gate=other;
  assert.equal((await service.status('allowed',initial.importId,{sheetId:SHEET})).status,'verified');assert.deepEqual(driver.gate,other);
});
test('duplicate goal names, missing names, gaps and custom formulas are rejected before storing evidence',async()=>{
  for(const change of [s=>s.rows.push({...clone(s.rows[0]),row:3}),s=>s.rows[0].entered[0]=null,s=>s.rows[0].row=4,s=>s.rows[0].entered[4]={formulaValue:'=42'},s=>s.layoutIssues=[{row:50,column:15}]]){
    const {driver,service,request}=setup();await commit(service,await service.prepare('allowed',request));change(driver.state);request.goal.name='Another goal';const n=driver.manifests.size;
    await assert.rejects(service.prepare('allowed',request),ImportError);assert.equal(driver.manifests.size,n);
  }
  const {driver,service,request}=setup();await commit(service,await service.prepare('allowed',request));request.goal.name='A QUIETER SUMMER';await assert.rejects(service.prepare('allowed',request),e=>e.code==='goal_exists');assert.equal(driver.writes,1);
});
test('strict cents, dates, account and schema checks reject invalid proposals',async()=>{
  for(const change of [r=>r.goal.targetMinor='1.00',r=>r.goal.targetMinor='0',r=>r.goal.targetMinor='100000000000000',r=>r.goal.targetDate='2027-02-30',r=>r.goal.targetDate='2026-06-30',r=>r.goal.currency='JPY',r=>r.goal.accountId='MISSING',r=>r.goal.name=' =bad\n']){
    const {driver,service,request}=setup();change(request);await assert.rejects(service.prepare('allowed',request),ImportError);assert.equal(driver.manifests.size,0);
  }
  for(const change of [s=>s.header[0]='Changed',s=>s.accounts[0][3]='Credit card',s=>s.accounts[0][7]='',s=>s.accounts.push(clone(s.accounts[0])),s=>s.accounts[0][12]='closed',s=>s.settings[5][0]='Moved']){
    const {driver,service,request}=setup(2);change(driver.state);await assert.rejects(service.prepare('allowed',request),ImportError);assert.equal(driver.writes,0);
  }
});
test('fresh public-feed or opening-contract changes block prepare/commit, not cancellation or receipt recovery',async()=>{
  for(const protocol of ['feed','opening']){
    const {driver,service,request}=setup();const r=await service.prepare('allowed',request);
    if(protocol==='feed')driver.state.legacy.publicFeedEnabled=true;else driver.state.legacy.openingContract={error:'Changed'};
    await assert.rejects(service.prepare('allowed',request),ImportError);await assert.rejects(commit(service,r),ImportError);assert.equal(driver.intents.size,0);
    assert.equal((await service.cancel('allowed',r.importId,{sheetId:SHEET})).status,'cancelled');
  }
  const {driver,service,request}=setup();const r=await service.prepare('allowed',request);driver.fail='clear';assert.equal((await commit(service,r)).status,'unknown');driver.state.legacy.publicFeedEnabled=true;driver.fail=null;
  assert.equal((await service.status('allowed',r.importId,{sheetId:SHEET})).status,'verified');assert.equal(driver.writes,1);
});
for(const failure of ['before','intent-after'])test(`uncertainty at ${failure} never dispatches a second append across restart`,async()=>{
  const {driver,service,request}=setup(),r=await service.prepare('allowed',request);driver.fail=failure;assert.equal((await commit(service,r)).status,'unknown');driver.fail=null;
  assert.equal((await commit(new ImportService({driver}),r)).status,'unknown');assert.equal(driver.writes,0);
  assert.equal((await service.cancel('allowed',r.importId,{sheetId:SHEET})).status,'unknown');
});
test('lost append response is recovered by the receipt without retry',async()=>{
  const {driver,service,request}=setup(),r=await service.prepare('allowed',request);driver.fail='after';assert.equal((await commit(service,r)).status,'verified');assert.equal((await commit(new ImportService({driver}),r)).status,'verified');assert.equal(driver.writes,1);
});
test('cancellation wins a reserved intent and a late commit cannot append',async()=>{
  const {driver,service,request}=setup(),r=await service.prepare('allowed',request);assert.equal((await service.cancel('allowed',r.importId,{sheetId:SHEET})).status,'cancelled');assert.equal((await commit(service,r)).status,'cancelled');assert.equal(driver.writes,0);
});
test('hold before missing intent can still be cancelled safely',async()=>{
  const {driver,service,request}=setup(),r=await service.prepare('allowed',request);driver.fail='intent-before';assert.equal((await commit(service,r)).status,'unknown');driver.fail=null;assert.equal((await service.cancel('allowed',r.importId,{sheetId:SHEET})).status,'cancelled');assert.equal(driver.gate,null);
});
test('safe cancellation remains possible if the Goals tab cannot be read, but a written receipt stays unknown',async()=>{
  const {driver,service,request}=setup(),r=await service.prepare('allowed',request);driver.readFails=true;
  assert.equal((await service.cancel('allowed',r.importId,{sheetId:SHEET})).status,'cancelled');assert.equal(driver.writes,0);
  const c=setup(),written=await c.service.prepare('allowed',c.request);await commit(c.service,written);c.driver.readFails=true;
  assert.equal((await c.service.cancel('allowed',written.importId,{sheetId:SHEET})).status,'unknown');assert.equal(c.driver.intents.get(c.driver.manifests.get(written.importId).intentFileId).status,'writing');
});
test('same Sheet queue serializes creates and refuses a stale second review',async()=>{
  const {driver,service,request}=setup(),a=await service.prepare('allowed',request);request.goal.name='Second';const b=await service.prepare('allowed',request);
  const answers=await Promise.allSettled([commit(service,a),commit(service,b)]);assert.equal(answers[0].value.status,'verified');assert.equal(answers[1].reason.code,'stale_proposal');assert.equal(driver.writes,1);
});
test('an unresolved goal hold routes ordinary imports to goal recovery; an import hold blocks goals',async()=>{
  const {driver,service,request}=setup(),r=await service.prepare('allowed',request);driver.fail='before';await commit(service,r);
  await assert.rejects(service.prepare('allowed',request),e=>e.code==='sheet_import_pending');await assert.rejects(service.prepare('allowed',{sheetId:SHEET,schemaVersion:1}),e=>e.code==='sheet_import_pending'&&e.recovery.protocolVersion===3&&e.recovery.operation==='goal-create'&&e.recovery.goal.name===goal.name);
  driver.gate={...driver.gate,importId:'different_import_123'};assert.equal((await service.status('allowed',r.importId,{sheetId:SHEET})).status,'unknown');await assert.rejects(service.prepare('allowed',request),e=>e.code==='sheet_import_pending'&&e.recovery.importId==='different_import_123');assert.equal(driver.writes,0);
});
test('altered formula, wrong calculated balance, formula error and concurrent edits are never verified',async()=>{
  for(const change of [s=>s.rows[0].entered[4]={formulaValue:'=0'},s=>s.rows[0].effective[4]=999,s=>s.rows[0].effective[1]=99,s=>s.rows[0].errors=[{column:4,error:'REF'}],s=>s.settingsInputs[0][1]={stringValue:'Changed'},s=>s.rows.push({...clone(s.rows[0]),row:3})]){
    const {driver,service,request}=setup(),r=await service.prepare('allowed',request);driver.after=change;const answer=await commit(service,r);assert.equal(answer.status,'conflict');assert.ok(driver.gate);assert.equal(driver.writes,1);
  }
});
test('ordinary import provenance ignores only correctly bound goal receipts',async()=>{
  const {driver,service,request}=setup(),r=await service.prepare('allowed',request);await commit(service,r);
  assert.deepEqual((await service.provenance('allowed',{sheetId:SHEET})).issues,[]);
  driver.state.legacy.receipts[0].ids='[]';const answer=await service.provenance('allowed',{sheetId:SHEET});assert.equal(answer.issues[0].code,'provenance_unavailable');
});
test('typed source evidence skips a valid goal receipt and reports tampered goal evidence',async()=>{
  const {driver,service,request}=setup(),r=await service.prepare('allowed',request);await commit(service,r);
  driver.readTypedState=async()=>({version:1,legacy:clone(driver.state.legacy),receipts:clone(driver.state.legacy.receipts),baseline:{},tables:{},configuration:{},settingsInputs:[],formulaFingerprint:'x'});
  assert.deepEqual((await service.provenance('allowed',{sheetId:SHEET,protocolVersion:2})).evidence.imports,[]);
  assert.deepEqual((await service.provenance('allowed',{sheetId:SHEET,protocolVersion:2})).issues,[]);
  driver.manifests.get(r.importId).rows=[{description:'not a goal'}];assert.equal((await service.provenance('allowed',{sheetId:SHEET,protocolVersion:2})).issues[0].code,'evidence_unavailable');
});
test('reader identifies data outside A:J and trailing notes but ignores blank formatting',async()=>{
  const s=state(),gridRows=[{values:GOAL_HEADERS.map(x=>({userEnteredValue:cell(x)}))},{values:[]},{values:Array.from({length:12},(_,i)=>i===11?{userEnteredValue:{stringValue:'extra'}}:{})},{values:[{note:'trailing note'}]}];
  const driver={readState:async()=>s.legacy,request:async(token,url)=>url.includes('gridProperties')?{sheets:[{properties:{title:'Goals',sheetId:77,gridProperties:{rowCount:1000,columnCount:26}}}]}:{sheets:[{properties:{title:'Goals'},data:[{rowData:gridRows}]},{properties:{title:'Accounts'},data:[{rowData:[]}]},{properties:{title:'Settings'},data:[{rowData:[]}]}]}};
  const read=await readGoalState(driver,'allowed',SHEET);assert.equal(read.layoutIssues.length,2);
  gridRows.splice(2);gridRows[1]={values:[{userEnteredFormat:{numberFormat:{type:'NUMBER'}}}]};assert.equal((await readGoalState(driver,'allowed',SHEET)).layoutIssues.length,0);
});
