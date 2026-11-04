import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ImportService,ImportError,HEADERS,digest,dateSerial,SerialQueue,importBaseline,gateFor,validateGate,GATE_PROPERTIES} from './core.mjs';
import {GoogleDriver,knownPublicFeedEnabled} from './google-rest.mjs';
import {auditSources} from './source-audit.mjs';
import {createServer} from './server.mjs';
const KittyImport=createRequire(import.meta.url)('../native-core/import.js');
const SHEET='synthetic_sheet_123456';
const clone=x=>structuredClone(x);
class MemoryDriver {
  constructor(version=1) {
    this.state={version,header:HEADERS[version],rows:[],accounts:[{id:'ACC-TEST',name:'Test',owner:'Joint'}],categories:[{id:'FOOD',name:'Food'},{id:'UNCAT',name:'Uncategorised'}],receipts:[],formulaFingerprint:'fixed-formulas',nextRowIndex:1,inputFormulas:[],receiptValid:true};
    this.manifests=new Map();this.intents=new Map();this.sources=new Map();this.writes=0;this.afterWrite=null;this.fail=null;this.gate=null;
  }
  async authorize(token,sheet){if(token!=='allowed'||sheet!==SHEET)throw new ImportError('sheet_permission','Not permitted.',403);}
  async readState(){return clone(this.state);}
  async readSheetGate(){return validateGate(clone(this.gate));}
  async writeSheetGate(token,sheet,gate){this.gate=clone(gate);}
  async clearSheetGate(token,sheet,expected){if(this.gate && digest(this.gate)!==digest(expected))return false;this.gate=null;return true;}
  async reserveID(){return `reserved_${this.manifests.size+1}`;}
  async storeSource(token,sheet,file){this.sources.set(file.sha256,file.text);return {sourceId:file.id,fileId:file.sha256,sha256:file.sha256};}
  async storeManifest(token,manifest){const id=`manifest_${String(this.manifests.size+1).padStart(6,'0')}`;this.manifests.set(id,clone(manifest));return id;}
  async loadManifest(token,id,sheet){const m=this.manifests.get(id);if(!m||m.sheetId!==sheet)throw new ImportError('import_permission','Wrong Sheet.',403);return clone(m);}
  async verifySources(token,m){for(const file of m.sourceFiles)if(digest(this.sources.get(file.fileId)??'')!==file.sha256)throw new ImportError('source_changed','Source changed.',409);}
  async findIntent(token,id){return this.intents.get(id);}
  async storeIntent(token,id,importId,sheet,intent){if(this.intents.has(id))throw new ImportError('intent_exists','Already started.',409);this.intents.set(id,intent);}
  async atomicInsert(token,sheet,state,manifest,importId,date){
    if(this.fail==='before')throw new Error('connection lost');
    this.writes++;this.state.rows.push(...clone(manifest.targetRows));this.state.receipts.push({importId,digest:manifest.proposalDigest,writtenAt:date,ids:JSON.stringify(manifest.targetRows.map(r=>r[0])),manifestFile:importId});
    if(this.afterWrite)this.afterWrite(this.state);
    if(this.fail==='after')throw new Error('response lost');
  }
}
function request(driver,{text='Date,Description,Amount\n2027-02-10,Corner Shop,-25.40\n',decisions={'Corner Shop':{categoryId:'FOOD'}}}={}) {
  const files=[{id:digest(text),name:'export.csv',text,accountId:'ACC-TEST',mapping:{confirmed:true,date:'Date',description:'Description',amount:'Amount',sign:'money-in-positive',dateOrder:'ymd'}}];
  const proposal=KittyImport.prepare({files,accounts:driver.state.accounts,categories:driver.state.categories,existing:[],decisions});
  proposal.decisions=decisions;
  assert.equal(proposal.canCommit,true,JSON.stringify(proposal.issues));
  return {sheetId:SHEET,schemaVersion:driver.state.version,files,proposal};
}
function setup(version=1){const driver=new MemoryDriver(version);const service=new ImportService({driver,auditSources});return {driver,service};}
async function prepared(options){const ctx=setup(options?.version??1);const req=request(ctx.driver,options);const result=await ctx.service.prepare('allowed',req);return {...ctx,req,result};}

test('v1 prepares privately, commits raw columns, verifies and repeat adds zero',async()=>{
  const {driver,service,result}=await prepared();assert.equal(driver.writes,0);
  const receipt=await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});assert.equal(receipt.status,'verified');
  assert.equal(driver.state.rows[0].length,10);assert.equal(driver.state.rows[0][5],-25.4);assert.equal(driver.state.rows[0][1],dateSerial('2027-02-10'));
  assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'verified');assert.equal(driver.writes,1);
});
test('v2 writes only Entries A:T with settled semantics',async()=>{
  const {driver,service,result}=await prepared({version:2});await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});
  assert.equal(driver.state.rows[0].length,20);assert.equal(driver.state.rows[0][1],'transaction');assert.equal(driver.state.rows[0][11],'settled');assert.equal(driver.state.rows[0][6],-25.4);
});
test('a lost response after atomic write verifies by readback without replay',async()=>{
  const {driver,service,result}=await prepared();driver.fail='after';assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'verified');
  const restarted=new ImportService({driver,auditSources});assert.equal((await restarted.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'verified');assert.equal(driver.writes,1);
});
test('an unknown write before response remains unknown across process restart; no blind retry',async()=>{
  const {driver,service,result}=await prepared();driver.fail='before';assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');driver.fail=null;
  const restarted=new ImportService({driver,auditSources});assert.equal((await restarted.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');assert.equal(driver.writes,0);
});
test('a changed Sheet invalidates approval before any write intent',async()=>{
  const {driver,service,result}=await prepared();driver.state.categories.push({id:'NEW',name:'New'});
  await assert.rejects(service.commit('allowed',result.importId,{sheetId:SHEET,approval:true}),e=>e.code==='stale_proposal');assert.equal(driver.writes,0);assert.equal(driver.intents.size,0);
});
test('a changed source original blocks commit',async()=>{
  const {driver,service,result}=await prepared();driver.sources.set([...driver.sources.keys()][0],'changed');
  await assert.rejects(service.commit('allowed',result.importId,{sheetId:SHEET,approval:true}),e=>e.code==='source_changed');assert.equal(driver.writes,0);
});
test('unauthorised tokens and wrong sheet never enter the writer',async()=>{
  const {driver,service,result}=await prepared();
  await assert.rejects(service.commit('denied',result.importId,{sheetId:SHEET,approval:true}),e=>e.status===403);
  await assert.rejects(service.commit('allowed',result.importId,{sheetId:'other_sheet_123456',approval:true}),e=>e.status===403);assert.equal(driver.writes,0);
});
test('commit requires explicit approval',async()=>{
  const {driver,service,result}=await prepared();await assert.rejects(service.commit('allowed',result.importId,{sheetId:SHEET}),e=>e.code==='approval_required');assert.equal(driver.writes,0);
});
test('parallel same-import commits serialize and write once',async()=>{
  const {driver,service,result}=await prepared();const answers=await Promise.all(Array.from({length:5},()=>service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})));assert.ok(answers.every(r=>r.status==='verified'));assert.equal(driver.writes,1);
});
test('separate imports reviewed at the same baseline cannot both commit stale IDs',async()=>{
  const {driver,service,result}=await prepared();const second=await service.prepare('allowed',request(driver,{text:'Date,Description,Amount\n2027-03-10,Corner Shop,-5.00\n'}));
  await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});await assert.rejects(service.commit('allowed',second.importId,{sheetId:SHEET,approval:true}),e=>e.code==='stale_proposal');assert.equal(driver.writes,1);
});
test('a readback amount mismatch is conflict, never success',async()=>{
  const {driver,service,result}=await prepared();driver.afterWrite=state=>state.rows[0][5]=1;
  const receipt=await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});assert.equal(receipt.status,'conflict');assert.ok(receipt.issues.some(x=>x.code==='readback_mismatch'));
});
test('duplicate IDs added externally are detected during verification',async()=>{
  const {driver,service,result}=await prepared();driver.afterWrite=state=>state.rows.push(clone(state.rows[0]));assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'conflict');
});
test('server rejects tampered cents even if client says canCommit',async()=>{
  const {driver,service}=setup();const req=request(driver);req.proposal.rows[0].amountMinor='1';req.proposal.canCommit=true;
  await assert.rejects(service.prepare('allowed',req),e=>e.code==='source_facts_mismatch');assert.equal(driver.manifests.size,0);
});
test('server rejects tampered source row references',async()=>{
  const {driver,service}=setup();const req=request(driver);req.proposal.rows[0].sourceRefs[0].row=9;
  await assert.rejects(service.prepare('allowed',req),e=>e.code==='source_reference_mismatch');
});
test('server cannot skip source validation',async()=>{
  const driver=new MemoryDriver();const service=new ImportService({driver});await assert.rejects(service.prepare('allowed',request(driver)),e=>e.code==='source_audit_unavailable');
});
test('invalid dates, unknown account/category, pending and precision overflow are blocked',async()=>{
  for(const [field,value,code]of [['date','2027-13-01','invalid_date'],['accountId','missing','unknown_account'],['categoryId','missing','unknown_category'],['status','pending','pending_row'],['amountMinor','100000000000000','amount_range']]){
    const {driver,service}=setup();const req=request(driver);req.proposal.rows[0][field]=value;await assert.rejects(service.prepare('allowed',req),e=>e.code===code,field);
  }
});
test('unsupported versions, moved columns and formulas in inputs block writes',async()=>{
  for(const mutation of [s=>s.version=3,s=>s.header=['Wrong'],s=>s.inputFormulas=[[2,4]],s=>s.receiptValid=false]){
    const {driver,service}=setup();const req=request(driver);mutation(driver.state);await assert.rejects(service.prepare('allowed',req),ImportError);assert.equal(driver.writes,0);
  }
});
test('source hash is computed, never accepted on faith',async()=>{
  const {driver,service}=setup();const req=request(driver);req.files[0].sha256='0'.repeat(64);await assert.rejects(service.prepare('allowed',req),e=>e.code==='source_hash_mismatch');
});
test('production Google batch shifts input cells, preserves helper anchors and stores literal narratives',async()=>{
  let captured;const driver=new GoogleDriver({fetchImpl:async(url,opts)=>{captured=JSON.parse(opts.body);return new Response('{}',{status:200});}});
  const state={version:1,sheetTabId:123,nextRowIndex:1,receiptNextRow:0,allTabIds:[123]};
  const manifest={targetRows:[['T0001',dateSerial('2027-02-10'),'ACC-TEST','=IMPORTXML("bad")','Test',-1,'FOOD','Joint','','']],proposalDigest:'digest'};
  await driver.atomicInsert('allowed',SHEET,state,manifest,'manifest_123456','2027-02-10');
  assert.ok(!captured.requests.some(r=>r.insertDimension||r.appendCells));
  assert.equal(captured.requests[1].insertRange.range.endColumnIndex,10);
  assert.equal(captured.requests[2].updateCells.rows[0].values[3].userEnteredValue.stringValue,'=IMPORTXML("bad")');
  assert.ok(captured.requests.every(r=>!JSON.stringify(r).includes('formulaValue')));
});
test('HTTP API denies missing auth and arbitrary browser origins',async()=>{
  const server=createServer({service:{}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const url=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(`${url}/v1/imports/prepare`,{method:'POST'})).status,401);assert.equal((await fetch(`${url}/v1/imports/prepare`,{method:'POST',headers:{Authorization:'Bearer allowed',Origin:'https://untrusted.test'}})).status,403);}finally{await new Promise(resolve=>server.close(resolve));}
});

test('formula reference changes cannot be reported verified',async()=>{
 const {driver,service,result}=await prepared();driver.afterWrite=state=>state.formulaFingerprint='shifted-formulas';
 const resultAfter=await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});
 assert.equal(resultAfter.status,'conflict');assert.ok(resultAfter.issues.some(i=>i.code==='formula_changed'));
});

test('source references cannot be swapped between otherwise valid facts',async()=>{
 const {driver,service}=setup();
 const req=request(driver,{text:'Date,Description,Amount\n2027-02-10,Corner Shop,-25.40\n2027-02-20,Corner Shop,-1.40\n'});
 const [a,b]=req.proposal.rows;[a.sourceRefs,b.sourceRefs]=[b.sourceRefs,a.sourceRefs];
 await assert.rejects(service.prepare('allowed',req),e=>e.code==='source_reference_mismatch');
});

test('provenance hydrates only exact verified ledger facts and makes identical-byte replay empty',async()=>{
  const {driver,service,result,req}=await prepared();await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});
  const hydrated=await service.provenance('allowed',{sheetId:SHEET});
  assert.equal(hydrated.records.length,1);assert.equal(hydrated.records[0].transactionId,'T0001');assert.equal(hydrated.records[0].sourceId,req.files[0].id);
  assert.equal(hydrated.baseline.existing[0].id,req.proposal.rows[0].id);assert.equal(hydrated.baseline.existing[0].transactionId,'T0001');
  const replay=KittyImport.prepare({...hydrated.baseline,files:req.files});assert.equal(replay.rows.length,0);assert.equal(replay.counts.existing,1);assert.equal(replay.issues.length,0);
});
test('a different file containing an identical tuple remains an overlap question, not proved replay',async()=>{
  const {service,result,req}=await prepared();await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});
  const hydrated=await service.provenance('allowed',{sheetId:SHEET});
  const other={...req.files[0],text:req.files[0].text+'\n'};other.id=digest(other.text);
  const proposal=KittyImport.prepare({...hydrated.baseline,files:[other]});assert.ok(proposal.issues.some(i=>i.code==='existing-overlap'));assert.equal(proposal.counts.existing,0);
});
test('edited canonical facts invalidate saved source identity instead of replacing the edit',async()=>{
  const {driver,service,result}=await prepared();await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});driver.state.rows[0][5]=-99;
  const hydrated=await service.provenance('allowed',{sheetId:SHEET});assert.equal(hydrated.records.length,0);assert.equal(hydrated.baseline.existing[0].amountMinor,'-9900');assert.equal(hydrated.baseline.existing[0].id,'T0001');assert.ok(hydrated.issues.some(i=>i.code==='provenance_row_changed'));
});
test('wrong receipt digest or unavailable manifest gives no source identity',async()=>{
  for(const alter of [d=>d.state.receipts[0].digest='wrong',d=>d.manifests.clear()]) {
    const {driver,service,result}=await prepared();await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});alter(driver);
    const hydrated=await service.provenance('allowed',{sheetId:SHEET});assert.equal(hydrated.records.length,0);assert.ok(hydrated.issues.some(i=>i.code==='provenance_unavailable'));
  }
});
test('duplicate receipt claims do not hydrate ambiguous identities',async()=>{
  const {driver,service,result}=await prepared();await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});driver.state.receipts.push(clone(driver.state.receipts[0]));
  const hydrated=await service.provenance('allowed',{sheetId:SHEET});assert.equal(hydrated.records.length,0);assert.ok(hydrated.issues.some(i=>i.code==='provenance_ambiguous'));
});
test('provenance requires exact authorised Sheet and never follows client record IDs',async()=>{
  const {service}=await prepared();await assert.rejects(service.provenance('denied',{sheetId:SHEET}),e=>e.status===403);await assert.rejects(service.provenance('allowed',{sheetId:'other_sheet_123456'}),e=>e.status===403);
});
test('server and native share identical import baseline including blank categories and v2 pending',async()=>{
  const {driver,service}=setup(2);driver.state.rows=[['T0001','transaction',dateSerial('2027-02-10'),'ACC-TEST','RAW','Merchant',-1,'','','','','pending',dateSerial('2027-02-10'),'','','','','','','bank export']];
  const p=await service.provenance('allowed',{sheetId:SHEET});assert.equal(p.baseline.existing[0].categoryId,'');assert.equal(p.baseline.existing[0].person,'');assert.equal(p.baseline.existing[0].status,'pending');assert.deepEqual(p.baseline,importBaseline(driver.state));assert.equal(p.revisionDigest,digest(p.baseline));
});
test('new source IDs must bind original bytes, not caller-selected labels',async()=>{
  const {driver,service}=setup();const req=request(driver);req.files[0].id='reused-arbitrary-id';await assert.rejects(service.prepare('allowed',req),e=>e.code==='source_identity_mismatch');
});
test('cancellation persists a tombstone and prevents late commit after process restart',async()=>{
  const {driver,service,result}=await prepared();const cancel=await service.cancel('allowed',result.importId,{sheetId:SHEET});assert.equal(cancel.status,'cancelled');assert.equal(cancel.proposalDigest,result.proposalDigest);
  const restarted=new ImportService({driver,auditSources});assert.equal((await restarted.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'cancelled');assert.equal((await restarted.status('allowed',result.importId,{sheetId:SHEET})).status,'cancelled');assert.equal(driver.writes,0);
});
test('cancel and commit serialize; either cancelled or verified, never both',async()=>{
  for(const cancelFirst of [true,false]) {
    const {driver,service,result}=await prepared();
    const cancel=()=>service.cancel('allowed',result.importId,{sheetId:SHEET});const commit=()=>service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});
    const responses=await Promise.all((cancelFirst?[cancel,commit]:[commit,cancel]).map(f=>f()));
    assert.ok(responses.every(r=>r.status===(cancelFirst?'cancelled':'verified')));assert.equal(driver.writes,cancelFirst?0:1);
  }
});
test('unknown write cannot be cancelled or reopened',async()=>{
  const {driver,service,result}=await prepared();driver.fail='before';await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});driver.fail=null;
  assert.equal((await service.cancel('allowed',result.importId,{sheetId:SHEET})).status,'unknown');assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');assert.equal(driver.writes,0);
});
test('every lifecycle response binds its original proposal digest',async()=>{
  const {service,result}=await prepared();assert.equal((await service.status('allowed',result.importId,{sheetId:SHEET})).proposalDigest,result.proposalDigest);assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).proposalDigest,result.proposalDigest);
});


test('annotation changes retain source identity while baseline uses current Sheet annotations',async()=>{
 const {driver,service,result,req}=await prepared();await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});
 driver.state.rows[0][4]='User corrected merchant';driver.state.rows[0][6]='UNCAT';driver.state.rows[0][9]='User note';
 const p=await service.provenance('allowed',{sheetId:SHEET});assert.equal(p.records.length,1);assert.equal(p.baseline.existing[0].merchant,'User corrected merchant');assert.equal(p.baseline.existing[0].categoryId,'UNCAT');
 const replay=KittyImport.prepare({...p.baseline,files:req.files});assert.equal(replay.counts.existing,1);assert.equal(replay.issues.length,0);
});
test('arbitrary client transfer links cannot bypass the pairing review',async()=>{
 const {driver,service}=setup();const req=request(driver);req.proposal.rows[0].transferId='made-up';
 await assert.rejects(service.prepare('allowed',req),e=>e.code==='transfer_link_unsupported');
});
test('accepted review decisions remain in the immutable manifest',async()=>{
 const {driver,result,req}=await prepared();const manifest=driver.manifests.get(result.importId);
 assert.deepEqual(manifest.rows[0].decision,req.proposal.rows[0].decision);assert.deepEqual(manifest.reviewDecisions,req.proposal.decisions);
});

test('a second device cannot replace an unresolved write even when the Sheet baseline is unchanged',async()=>{
 const {driver,service,result}=await prepared();
 const later=request(driver,{text:'Date,Description,Amount\n2027-03-10,Corner Shop,-5.00\n'});
 const second=await service.prepare('allowed',later);
 driver.fail='before';assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');
 assert.equal(driver.state.rows.length,0);assert.equal(driver.gate.importId,result.importId);
 const secondDevice=new ImportService({driver,auditSources});
 await assert.rejects(secondDevice.prepare('allowed',later),e=>e.code==='sheet_import_pending');
 await assert.rejects(secondDevice.provenance('allowed',{sheetId:SHEET}),e=>e.code==='sheet_import_pending');
 await assert.rejects(secondDevice.commit('allowed',second.importId,{sheetId:SHEET,approval:true}),e=>e.code==='sheet_import_pending');
 assert.equal(driver.intents.size,1);assert.equal(driver.writes,0);
});
test('completed receipt and exact current rows recover the shared hold without another users private manifest',async()=>{
 const {driver,service,result}=await prepared();const clear=driver.clearSheetGate.bind(driver);
 driver.clearSheetGate=async()=>false;
 assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');
 driver.clearSheetGate=clear;driver.loadManifest=async()=>{throw new ImportError('import_permission','Private evidence.',403);};
 const otherDevice=new ImportService({driver,auditSources});const baseline=await otherDevice.provenance('allowed',{sheetId:SHEET});
 assert.equal(driver.gate,null);assert.equal(baseline.baseline.existing.length,1);assert.equal(baseline.records.length,0);
 assert.ok(baseline.issues.some(i=>i.code==='provenance_unavailable'));assert.equal(driver.writes,1);
});
test('an older verified receipt cannot clear a newer unresolved import hold',async()=>{
 const {driver,service,result}=await prepared();await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});
 const second=await service.prepare('allowed',request(driver,{text:'Date,Description,Amount\n2027-03-10,Corner Shop,-5.00\n'}));
 driver.fail='before';await service.commit('allowed',second.importId,{sheetId:SHEET,approval:true});const held=clone(driver.gate);
 assert.equal((await service.status('allowed',result.importId,{sheetId:SHEET})).status,'verified');
 assert.equal((await service.cancel('allowed',result.importId,{sheetId:SHEET})).status,'verified');assert.deepEqual(driver.gate,held);
});
test('cancelling another unattempted proposal leaves the active import hold untouched',async()=>{
 const {driver,service,result}=await prepared();const second=await service.prepare('allowed',request(driver));
 driver.fail='before';await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});const held=clone(driver.gate);
 assert.equal((await service.cancel('allowed',second.importId,{sheetId:SHEET})).status,'cancelled');assert.deepEqual(driver.gate,held);
});
test('malformed shared holds fail closed without changing the financial Sheet',async()=>{
 for(const gate of [{importId:'manifest_123456'},{importId:'manifest_123456',version:1,proposalDigest:'x',rowsHash:'a'.repeat(64),stateHash:'b'.repeat(64)}]){
  const {driver,service,result}=await prepared();driver.gate=gate;
  await assert.rejects(service.prepare('allowed',request(driver)),e=>e.code==='sheet_import_gate_invalid');
  await assert.rejects(service.provenance('allowed',{sheetId:SHEET}),e=>e.code==='sheet_import_gate_invalid');
  await assert.rejects(service.commit('allowed',result.importId,{sheetId:SHEET,approval:true}),e=>e.code==='sheet_import_gate_invalid');
  assert.equal(driver.writes,0);assert.equal(driver.intents.size,0);
 }
});
test('external source, receipt, formula or account changes prevent hold recovery',async()=>{
 for(const mutate of [s=>s.rows[0][5]=-1,s=>s.receipts[0].ids='["OTHER"]',s=>s.formulaFingerprint='edited',s=>s.accounts.push({id:'ACC-OTHER',name:'Other'})]){
  const {driver,service,result}=await prepared();driver.afterWrite=mutate;
  assert.notEqual((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'verified');
  assert.equal(driver.gate.importId,result.importId);
  await assert.rejects(new ImportService({driver,auditSources}).provenance('allowed',{sheetId:SHEET}),e=>e.code==='sheet_import_pending');
  assert.equal(driver.writes,1);
 }
});
test('a timeout before the shared hold sends no write intent or financial request',async()=>{
 const {driver,service,result}=await prepared();const set=driver.writeSheetGate.bind(driver);
 driver.writeSheetGate=async()=>{throw new Error('timeout before metadata');};
 const response=await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});
 assert.equal(response.status,'unknown');assert.equal(driver.intents.size,0);assert.equal(driver.writes,0);assert.equal(driver.gate,null);
 driver.writeSheetGate=set;assert.equal((await service.status('allowed',result.importId,{sheetId:SHEET})).status,'proposed');
 assert.equal((await service.cancel('allowed',result.importId,{sheetId:SHEET})).status,'cancelled');
});
test('a timeout after shared hold creation blocks another device until safe cancellation',async()=>{
 const {driver,service,result}=await prepared();
 driver.writeSheetGate=async(token,sheet,gate)=>{driver.gate=clone(gate);throw new Error('metadata response lost');};
 assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');
 assert.equal(driver.intents.size,0);assert.equal(driver.writes,0);assert.ok(driver.gate);
 await assert.rejects(new ImportService({driver,auditSources}).prepare('allowed',request(driver)),e=>e.code==='sheet_import_pending');
 assert.equal((await service.cancel('allowed',result.importId,{sheetId:SHEET})).status,'cancelled');assert.equal(driver.gate,null);
 assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'cancelled');
});
test('a timeout before durable intent can be cancelled using the reserved ID',async()=>{
 const {driver,service,result}=await prepared();const create=driver.storeIntent.bind(driver);
 driver.storeIntent=async()=>{throw new Error('timeout before intent');};
 assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');assert.equal(driver.writes,0);assert.ok(driver.gate);
 driver.storeIntent=create;assert.equal((await service.cancel('allowed',result.importId,{sheetId:SHEET})).status,'cancelled');assert.equal(driver.gate,null);
});
test('a timeout after durable intent never resumes the financial write',async()=>{
 const {driver,service,result}=await prepared();const create=driver.storeIntent.bind(driver);
 driver.storeIntent=async(...args)=>{await create(...args);throw new Error('intent response lost');};
 assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');assert.equal(driver.writes,0);
 const restarted=new ImportService({driver,auditSources});
 assert.equal((await restarted.status('allowed',result.importId,{sheetId:SHEET})).status,'unknown');
 assert.equal((await restarted.cancel('allowed',result.importId,{sheetId:SHEET})).status,'unknown');
 assert.equal((await restarted.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');assert.ok(driver.gate);
});
test('readback failure after a completed write recovers the receipt and clears its hold once',async()=>{
 const {driver,service,result}=await prepared();const read=driver.readState.bind(driver);
 driver.afterWrite=()=>{driver.readState=async()=>{throw new Error('readback offline');};};
 assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');assert.ok(driver.gate);assert.equal(driver.writes,1);
 driver.readState=read;assert.equal((await new ImportService({driver,auditSources}).status('allowed',result.importId,{sheetId:SHEET})).status,'verified');
 assert.equal(driver.gate,null);assert.equal(driver.writes,1);
});
test('a lost response clearing a completed hold can be checked without replaying',async()=>{
 const {driver,service,result}=await prepared();driver.clearSheetGate=async()=>{driver.gate=null;throw new Error('metadata clear response lost');};
 assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');assert.equal(driver.gate,null);
 assert.equal((await service.status('allowed',result.importId,{sheetId:SHEET})).status,'verified');assert.equal(driver.writes,1);
});
test('Google holds use only bounded appProperties and clear only the exact matching hold',async()=>{
 const props={unrelated:'keep me'};const mutations=[];
 const driver=new GoogleDriver({fetchImpl:async(url,options)=>{
  assert.match(url,new RegExp(`/files/${SHEET}`));assert.equal(options.headers.Authorization,'Bearer allowed');
  if(options.method==='PATCH'){const body=JSON.parse(options.body);mutations.push(body);for(const[key,value]of Object.entries(body.appProperties)){if(value===null)delete props[key];else props[key]=value;}}
  return new Response(JSON.stringify({id:SHEET,appProperties:clone(props)}),{status:200});
 }});
 const ctx=await prepared();const manifest=ctx.driver.manifests.get(ctx.result.importId);const gate=gateFor(manifest,ctx.result.importId,ctx.driver.state);
 await driver.writeSheetGate('allowed',SHEET,gate);assert.deepEqual(await driver.readSheetGate('allowed',SHEET),gate);
 assert.ok(Object.entries(mutations[0].appProperties).every(([k,v])=>Buffer.byteLength(k+v,'utf8')<=124));
 assert.equal(await driver.clearSheetGate('allowed',SHEET,{...gate,importId:'different_123456'}),false);assert.equal(mutations.length,1);
 assert.equal(await driver.clearSheetGate('allowed',SHEET,gate),true);assert.deepEqual(props,{unrelated:'keep me'});
 assert.deepEqual(Object.keys(mutations[1].appProperties).sort(),Object.values(GATE_PROPERTIES).sort());
 props.kittyActiveImport='partial_123456';await assert.rejects(driver.readSheetGate('allowed',SHEET),e=>e.code==='sheet_import_gate_invalid');
});

test('the immutable proposal digest binds original file locations as well as their hashes',async()=>{
 const ctx=await prepared();const manifest=ctx.driver.manifests.get(ctx.result.importId);let current=clone(manifest);
 const driver=new GoogleDriver({fetchImpl:async(url)=>new Response(JSON.stringify(url.includes('alt=media')?current:{id:ctx.result.importId,appProperties:{kittyKind:'manifest',kittySheet:SHEET,kittyDigest:manifest.proposalDigest}}),{status:200})});
 assert.deepEqual(await driver.loadManifest('allowed',ctx.result.importId,SHEET),manifest);
 current.sourceFiles=[];
 await assert.rejects(driver.loadManifest('allowed',ctx.result.importId,SHEET),e=>e.code==='manifest_changed');
 current=clone(manifest);current.sourceFiles[0].fileId='a_different_drive_file';
 await assert.rejects(driver.loadManifest('allowed',ctx.result.importId,SHEET),e=>e.code==='manifest_changed');
});

test('Sheet currency and people changes invalidate prepared review before any intent',async()=>{
 for(const mutate of [s=>s.currency='JPY',s=>s.people=['Joint','Another person']]){
  const {driver,service,result}=await prepared();mutate(driver.state);
  await assert.rejects(service.commit('allowed',result.importId,{sheetId:SHEET,approval:true}),e=>e.code==='stale_proposal');
  assert.equal(driver.intents.size,0);assert.equal(driver.writes,0);
 }
});
test('the Google reader retains v2 account currency for independent import validation',async()=>{
 const driver=new GoogleDriver({fetchImpl:async(url)=>{
  const u=new URL(url);let body;
  if(u.searchParams.get('fields')==='sheets(properties(sheetId,title,gridProperties))')body={sheets:['Kitty','Accounts','Categories','Entries'].map((title,i)=>({properties:{title,sheetId:i,rowCount:100,gridProperties:{rowCount:100}}}))};
  else if(u.pathname.endsWith('/values:batchGet')){
   if(u.searchParams.getAll('ranges')[0].startsWith("'Kitty'"))body={valueRanges:[{values:[['sheet_version',2],['currency','AUD'],['people','Jordan, Mia']]},{values:[['Account ID','Account','Institution','Type','Owner','Opening','Date','Balance','Liquid','Class','Method','Currency'],['ACC-TEST','Test','Synthetic','Transaction','Joint',0,0,0,'Yes','Cash','ledger','USD']]},{values:[['Category ID','Category'],['FOOD','Food'],['UNCAT','Uncategorised']]}]};
   else body={valueRanges:[{values:[HEADERS[2]]}]};
  }else body={sheets:[]};
  return new Response(JSON.stringify(body),{status:200});
 }});
 const state=await driver.readState('allowed',SHEET);assert.equal(state.currency,'AUD');assert.equal(state.accounts[0].currency,'USD');
 const memory=new MemoryDriver(2);const req=request(memory);memory.state=state;
 await assert.rejects(new ImportService({driver:memory,auditSources}).prepare('allowed',req),e=>e.code==='source_review_required');
 assert.equal(memory.writes,0);assert.equal(memory.manifests.size,0);
});

test('pending-hold discovery returns a bound recovery descriptor only to an authorized Sheet editor',async t=>{
 const {driver,service,result}=await prepared();driver.fail='before';await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true});
 const server=createServer({service});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/v1/imports/provenance?sheetId=${SHEET}`;
 const response=await fetch(base,{headers:{authorization:'Bearer allowed'}});assert.equal(response.status,409);
 const {error}=await response.json();assert.equal(error.code,'sheet_import_pending');
 assert.deepEqual(error.recovery,{sheetId:SHEET,importId:result.importId,proposalDigest:result.proposalDigest});
 const denied=await fetch(base,{headers:{authorization:'Bearer denied'}});assert.equal(denied.status,403);assert.equal((await denied.json()).error.recovery,undefined);
 const status=await service.status('allowed',error.recovery.importId,{sheetId:error.recovery.sheetId});assert.equal(status.proposalDigest,error.recovery.proposalDigest);assert.equal(status.status,'unknown');
 assert.equal(driver.writes,0);
});

test('supplied opening and closing balances survive server normalization and must reconcile',async()=>{
 const {driver,service}=setup();const req=request(driver);req.files[0].openingMinor='10000';req.files[0].closingMinor='7460';
 req.proposal=KittyImport.prepare({...importBaseline(driver.state),files:req.files,decisions:{'Corner Shop':{categoryId:'FOOD'}}});
 assert.equal(req.proposal.canCommit,true);const prepared=await service.prepare('allowed',req);
 assert.equal(driver.manifests.get(prepared.importId).sources[0].closingMinor,'7460');
 req.files[0].closingMinor='9999';await assert.rejects(service.prepare('allowed',req),e=>e.code==='source_review_required');assert.equal(driver.writes,0);
});

async function heldCompletedImportWithExternalRow(){
 const {driver,service}=setup();
 driver.state.rows.push(['T0001',dateSerial('2027-01-01'),'ACC-TEST','Earlier expense','Earlier expense',-2,'FOOD','Joint','','']);
 const result=await service.prepare('allowed',request(driver));
 const clear=driver.clearSheetGate.bind(driver);driver.clearSheetGate=async()=>false;
 assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'unknown');
 driver.state.rows.push(['EXT-NEW',dateSerial('2027-03-10'),'ACC-TEST','External purchase','External purchase',-10,'FOOD','Joint','','']);
 let clears=0;driver.clearSheetGate=async(...args)=>{clears++;return clear(...args);};
 return {driver,result,service:new ImportService({driver,auditSources}),clears:()=>clears};
}
test('status and cancel release a completed matching hold despite an unrelated external append',async()=>{
 for(const method of ['status','cancel']){
  const {driver,service,result,clears}=await heldCompletedImportWithExternalRow();const rows=clone(driver.state.rows);
  const recovered=await service[method]('allowed',result.importId,{sheetId:SHEET});
  assert.equal(recovered.status,'verified');assert.equal(recovered.proposalDigest,result.proposalDigest);assert.equal(clears(),1);
  assert.equal(driver.gate,null);assert.deepEqual(driver.state.rows,rows);assert.equal(driver.writes,1);
 }
});
test('an unrelated append never excuses changed, missing, duplicate or unreceipted original/imported rows',async()=>{
 const mutations=[
  s=>s.rows[0][5]=-99,s=>s.rows.splice(0,1),s=>s.rows[1][3]='Changed source',s=>s.rows.splice(1,1),
  s=>s.rows.push(clone(s.rows[0])),s=>s.rows.push(clone(s.rows[1])),s=>s.rows.push(clone(s.rows[2])),
  s=>s.rows.push(['',0,'ACC-TEST','Missing ID']),s=>s.receipts[0].ids='["OTHER"]',s=>s.receipts=[]
 ];
 for(const mutate of mutations){
  const {driver,service,result,clears}=await heldCompletedImportWithExternalRow();mutate(driver.state);
  assert.notEqual((await service.status('allowed',result.importId,{sheetId:SHEET})).status,'verified');
  assert.equal(driver.gate.importId,result.importId);assert.equal(clears(),0);assert.equal(driver.writes,1);
 }
});
test('append-tolerant hold recovery still checks schema, currency, people, accounts, categories and formulas',async()=>{
 const mutations=[s=>s.version=2,s=>s.header=['Changed'],s=>s.currency='USD',s=>s.people=['Joint','Another person'],
  s=>s.accounts[0].owner='Other',s=>s.categories[0].name='Changed',s=>s.formulaFingerprint='Changed',s=>s.inputFormulas=[[2,4]]];
 for(const mutate of mutations){
  const {driver,service,result,clears}=await heldCompletedImportWithExternalRow();mutate(driver.state);
  assert.notEqual((await service.status('allowed',result.importId,{sheetId:SHEET})).status,'verified');
  assert.equal(driver.gate.importId,result.importId);assert.equal(clears(),0);assert.equal(driver.writes,1);
 }
});

test('Google reader matches the known public feed gate whitespace, case and first-key semantics',async()=>{
  let rows=[];
  const driver=new GoogleDriver({fetchImpl:async value=>{
    const url=new URL(value);let body;
    if(url.searchParams.get('fields')==='sheets(properties(sheetId,title,gridProperties))')body={sheets:['Kitty','Accounts','Categories','Transactions'].map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:100,columnCount:26}}}))};
    else if(url.pathname.endsWith('/values:batchGet'))body=url.searchParams.getAll('ranges')[0].startsWith("'Kitty'")
      ? {valueRanges:[{values:rows},{values:[['Account ID','Account'],['ACC-TEST','Test']]},{values:[['Category ID','Category'],['FOOD','Food']]}]}
      : {valueRanges:[{values:[HEADERS[1]]}]};
    else body={sheets:[]};return new Response(JSON.stringify(body));
  }});
  const prefix=[['Key','Value'],['sheet_version',1],['currency','AUD']];
  for(const [tail,expected]of [
    [[],false],[[[' public_feed ',' YeS \n']],true],[[['public_feed','no']],false],
    [[['PUBLIC_FEED','yes']],false],[[['public_feed','no'],['public_feed','yes']],false],
    [[['public_feed','yes'],['public_feed','no']],true],[[['public_feed',true]],false],
    [[['PUBLIC_FEED','yes'],[' public_feed ','yes']],true]
  ]){rows=prefix.concat(tail);assert.equal((await driver.readState('allowed',SHEET)).publicFeedEnabled,expected,JSON.stringify(tail));}
  assert.equal(knownPublicFeedEnabled([]),false);assert.equal(knownPublicFeedEnabled([['public_feed','yes']]),false);
});
test('known public feed blocks new legacy preparation before source storage while provenance remains readable',async()=>{
  for(const version of [1,2]){
    const {driver,service}=setup(version),req=request(driver);const before=await service.provenance('allowed',{sheetId:SHEET});driver.state.publicFeedEnabled=true;
    const after=await service.provenance('allowed',{sheetId:SHEET});assert.equal(after.publicFeedEnabled,true);assert.equal(after.revisionDigest,before.revisionDigest);
    await assert.rejects(service.prepare('allowed',req),e=>e.code==='public_feed_enabled'&&e.status===409&&/refresh/.test(e.message));
    assert.equal(driver.sources.size,0);assert.equal(driver.manifests.size,0);assert.equal(driver.intents.size,0);assert.equal(driver.writes,0);assert.equal(driver.gate,null);
  }
});
test('fresh legacy commit rejects a feed enabled after preparation without creating a hold or intent',async()=>{
  for(const version of [1,2]){
    const {driver,service,result}=await prepared({version});driver.state.publicFeedEnabled=true;
    assert.equal((await service.status('allowed',result.importId,{sheetId:SHEET})).status,'proposed');
    await assert.rejects(service.commit('allowed',result.importId,{sheetId:SHEET,approval:true}),e=>e.code==='public_feed_enabled');
    assert.equal(driver.sources.size,1);assert.equal(driver.manifests.size,1);assert.equal(driver.intents.size,0);assert.equal(driver.writes,0);assert.equal(driver.gate,null);
    driver.state.publicFeedEnabled=false;assert.equal((await service.commit('allowed',result.importId,{sheetId:SHEET,approval:true})).status,'verified');
  }
});
test('feed publishing never hides legacy hold recovery, cancellation or verification of an existing receipt',async()=>{
  const held=await prepared();held.driver.fail='before';await held.service.commit('allowed',held.result.importId,{sheetId:SHEET,approval:true});held.driver.state.publicFeedEnabled=true;
  await assert.rejects(held.service.prepare('allowed',held.req),e=>e.code==='sheet_import_pending'&&e.recovery.importId===held.result.importId);
  await assert.rejects(held.service.provenance('allowed',{sheetId:SHEET}),e=>e.code==='sheet_import_pending');
  for(const action of ['status','cancel','commit'])assert.equal((await held.service[action]('allowed',held.result.importId,{sheetId:SHEET,approval:true})).status,'unknown');assert.equal(held.driver.writes,0);
  const cancelled=await prepared();cancelled.driver.state.publicFeedEnabled=true;assert.equal((await cancelled.service.cancel('allowed',cancelled.result.importId,{sheetId:SHEET})).status,'cancelled');assert.equal((await cancelled.service.commit('allowed',cancelled.result.importId,{sheetId:SHEET,approval:true})).status,'cancelled');assert.equal(cancelled.driver.writes,0);
  const done=await prepared(),clear=done.driver.clearSheetGate.bind(done.driver);done.driver.clearSheetGate=async()=>false;assert.equal((await done.service.commit('allowed',done.result.importId,{sheetId:SHEET,approval:true})).status,'unknown');done.driver.clearSheetGate=clear;done.driver.state.publicFeedEnabled=true;
  for(const action of ['status','cancel','commit'])assert.equal((await done.service[action]('allowed',done.result.importId,{sheetId:SHEET,approval:true})).status,'verified');assert.equal(done.driver.gate,null);assert.equal(done.driver.writes,1);assert.equal((await done.service.provenance('allowed',{sheetId:SHEET})).records.length,1);
});
