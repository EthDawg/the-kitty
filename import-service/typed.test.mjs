import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {ImportService,ImportError,HEADERS,dateSerial,isoDate,digest,validateGate,importBaseline} from './core.mjs';
import {GoogleDriver} from './google-rest.mjs';
import {typedFiles,expectedTypedState,verifyTyped} from './typed.mjs';
import {typedRequests,typedDigest,readTypedState,RECORD_HEADER,TYPED_HEADERS} from './typed-google.mjs';
import {auditSources} from './source-audit.mjs';
import {createServer} from './server.mjs';
const require=createRequire(import.meta.url),KittyImport=require('../native-core/import.js');
const SHEET='fictional_typed_sheet_123456',copy=x=>structuredClone(x);
const sourceBytes=Buffer.from('%PDF-1.4\nFictional source: current-period values.\n%%EOF\n');
const source={id:digest(sourceBytes),name:'fictional-source.pdf',mimeType:'application/pdf',byteLength:sourceBytes.length,bytesBase64:sourceBytes.toString('base64')};
function record(kind,fields,id='record-one'){
  return {kind,recordId:id,fields,sourceRefs:[{id:'s1',fileId:source.id,page:1,basis:kind==='payslip'?'current-period':kind==='valuation'?'valuation':'statement-close'}],extraction:{method:'human-confirmed-document',version:'1'},confirmedFields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{value:copy(value),sourceRefIds:['s1']}]))};
}
const pay=(person='Alex',employer='Fictional employer')=>record('payslip',{payDate:'2027-02-10',person,employer,currency:'AUD',valueBasis:'current-period',grossMinor:'100000',taxMinor:'20000',superMinor:'12000',netMinor:'80000'},'pay-'+person);
const valuation=(amount='20000000',item='HOME')=>record('valuation',{date:'2027-02-28',itemId:item,currency:'AUD',valueMinor:amount,valueKind:item==='LOAN'?'liability':'asset'},'value-'+item);
const statement=(closing='100000')=>record('statement_balance',{accountId:'A',periodStart:'2027-02-01',periodEnd:'2027-02-28',currency:'AUD',balanceKind:'statement-close',openingMinor:'100000',closingMinor:closing,balanceConvention:'money-in-positive'},'statement-A');
function table(title,sheetTabId,width,header,metadataColumn){return {title,sheetTabId,width,header:copy(header),rows:[],nextRowIndex:1,rowCount:1000,columnCount:metadataColumn??width,metadataColumn,metadataHeader:metadataColumn===undefined?null:''};}
function initial(version=1){
  const state={version,baseline:{schemaVersion:version,currency:'AUD',people:['Alex','Sam','Joint'],asOf:'2027-01-31',accounts:[{id:'A',name:'Fictional account',currency:'AUD',person:'Joint',ledger:true,method:'ledger',status:'active',openingMinor:'100000',openingDate:'2027-01-31',balanceMinor:'100000'}],categories:[{id:'FOOD',name:'Food'},{id:'SALARY',name:'Salary'},{id:'UNCAT',name:'Uncategorised'}],items:[{id:'HOME',name:'Fictional home',currency:'AUD',kind:'asset',method:'estimate',valuationRequired:true},{id:'LOAN',name:'Fictional loan',currency:'AUD',kind:'liability',method:'statement',valuationRequired:true}],transactions:[],payslips:[],valuations:[],checks:[{id:'Inputs present',type:'Close',status:'OK',items:0}],unresolvedReviews:[],projectedBalances:[]},
    tables:{ledger:table(version===1?'Transactions':'Entries',10,HEADERS[version].length,HEADERS[version]),payslips:table('Payslips',11,7,TYPED_HEADERS.payslips,8)},configuration:{accounts:[['A','fictional','100000','2027-01-31']],categories:[['FOOD'],['SALARY'],['UNCAT']],items:[['HOME'],['LOAN']]},
    settingsInputs:[['As-of date',dateSerial('2027-01-31')],['Human reviewed fact','Keep this']],asOfCell:{sheetTabId:12,rowIndex:5,columnIndex:1,value:dateSerial('2027-01-31')},formulaFingerprint:'unchanged-formulas',receipts:[],receiptValid:true,receiptNextRow:0,allTabIds:[10,11,12,13],closeMissing:0};
  if(version===1)state.tables.valuations=table('Valuations',13,3,TYPED_HEADERS.valuations,5);
  return state;
}
class MemoryTypedDriver {
  constructor(version=1){this.state=initial(version);this.manifests=new Map();this.sources=new Map();this.intents=new Map();this.gate=null;this.writes=0;this.fail=null;this.afterWrite=null;this.clearFails=false;}
  async authorize(token,sheet){if(token!=='allowed'||sheet!==SHEET)throw new ImportError('sheet_permission','Wrong exact Sheet.',403);}
  current(periodEnd){
    const s=copy(this.state),v=s.version,day=periodEnd??s.baseline.asOf,money=x=>String(Math.round(x*100));
    s.baseline.transactions=s.tables.ledger.rows.filter(r=>v===1||r.values[1]==='transaction').map(({values:r})=>({id:r[0],date:isoDate(r[v===1?1:2]),accountId:r[v===1?2:3],amountMinor:money(r[v===1?5:6]),categoryId:r[v===1?6:7],person:r[v===1?7:8],status:v===1?'posted':r[11],transferGroup:v===1?'':r[13]}));
    s.baseline.payslips=s.tables.payslips.rows.map(({id,values:r})=>({kind:'payslip',recordId:id,fields:{payDate:isoDate(r[0]),person:r[1],employer:r[2],currency:'AUD',valueBasis:'current-period',grossMinor:money(r[3]),taxMinor:money(r[4]),superMinor:money(r[5]),netMinor:money(r[6])}}));
    const vals=v===1?s.tables.valuations.rows:s.tables.ledger.rows.filter(r=>r.values[1]==='valuation');
    s.baseline.valuations=vals.map(({id,values:r})=>{const item=r[v===1?1:3];return {kind:'valuation',recordId:id,fields:{date:isoDate(r[v===1?0:2]),itemId:item,currency:'AUD',valueMinor:money(r[v===1?2:6]),valueKind:s.baseline.items.find(x=>x.id===item)?.kind}};});
    s.baseline.projectedBalances=s.baseline.accounts.map(a=>({accountId:a.id,date:day,amountMinor:s.baseline.transactions.filter(t=>t.accountId===a.id&&t.date>a.openingDate&&t.date<=day&&['posted','settled'].includes(t.status)).reduce((n,t)=>n+BigInt(t.amountMinor),BigInt(a.openingMinor)).toString()}));
    s.legacy={version:v,title:v===1?'Transactions':'Entries',currency:'AUD',currencyPresent:true,people:s.baseline.people,header:HEADERS[v],rows:s.tables.ledger.rows.map(r=>r.values),nextRowIndex:s.tables.ledger.nextRowIndex,accounts:s.baseline.accounts.map(a=>({id:a.id,name:a.name,owner:a.person})),categories:s.baseline.categories,formulaFingerprint:'legacy-formulas',inputFormulas:[],receipts:s.receipts,receiptValid:true};
    return s;
  }
  async readTypedState(token,sheet,date){if(this.readFails)throw new Error('read timeout');return this.current(date);}
  async readState(){return this.current().legacy;}
  async readSheetGate(){return validateGate(copy(this.gate));}
  async writeSheetGate(token,sheet,gate){this.gate=copy(gate);if(this.gateTimeout)throw new Error('gate response lost');}
  async clearSheetGate(token,sheet,expected){if(this.clearFails)return false;if(this.gate&&digest(this.gate)!==digest(expected))return false;this.gate=null;return true;}
  async reserveID(){return 'reserved_'+String(this.manifests.size+1).padStart(6,'0');}
  async storeSource(token,sheet,f){this.sources.set(f.sha256,Buffer.from(f.bytes??f.text));return {sourceId:f.id,fileId:f.sha256,sha256:f.sha256};}
  async storeManifest(token,m){const id='manifest_'+String(this.manifests.size+1).padStart(6,'0');this.manifests.set(id,copy(m));return id;}
  async loadManifest(token,id,sheet){const m=this.manifests.get(id);if(!m||m.sheetId!==sheet)throw new ImportError('import_permission','Wrong exact Sheet.',403);return copy(m);}
  async verifySources(token,m){for(const s of m.sourceFiles)if(digest(this.sources.get(s.fileId)??'')!==s.sha256)throw new ImportError('source_changed','Original changed.',409);}
  async findIntent(token,id){return this.intents.get(id);}
  async storeIntent(token,id,importId,sheet,intent){if(this.intents.has(id))throw new ImportError('intent_exists','Already reserved.',409);this.intents.set(id,copy(intent));if(this.intentTimeout)throw new Error('intent response lost');}
  async atomicTypedInsert(token,sheet,before,m,id,date){
    if(this.fail==='before')throw new Error('no write response');this.writes++;
    for(const set of m.writeSets){
      if(set.kind==='asof'){this.state.baseline.asOf=set.date;this.state.asOfCell.value=dateSerial(set.date);this.state.settingsInputs[0][1]=dateSerial(set.date);continue;}
      const t=this.state.tables[set.table];for(const row of set.rows)t.rows.push({id:row.id,values:copy(row.values),rowIndex:t.nextRowIndex++});
      if(t.metadataColumn!==undefined)t.metadataHeader=RECORD_HEADER;
    }
    this.state.receipts.push({importId:id,digest:m.proposalDigest,writtenAt:date,ids:JSON.stringify(m.recordRefs),manifestFile:id});this.state.receiptNextRow=this.state.receipts.length+1;
    if(this.afterWrite)this.afterWrite(this.state,m);
    if(this.fail==='after')throw new Error('write response lost');
  }
}
function setup(version=1){const driver=new MemoryTypedDriver(version),service=new ImportService({driver,auditSources});return {driver,service};}
const request=(records,extra={})=>({protocolVersion:2,operation:'ingest',sheetId:SHEET,schemaVersion:1,files:[source],proposal:{records},...extra});
const commit=(service,id)=>service.commit('allowed',id,{sheetId:SHEET,approval:true});
async function prepared(records=[pay()],version=1){const ctx=setup(version),req=request(records,{schemaVersion:version}),proposed=await ctx.service.prepare('allowed',req);return {...ctx,req,proposed};}

test('typed binary originals are hashed as decoded bytes and reject bad envelopes',()=>{
  const [f]=typedFiles([source]);assert.ok(f.bytes.equals(sourceBytes));assert.equal(f.sha256,source.id);
  for(const change of [{id:'0'.repeat(64)},{byteLength:1},{bytesBase64:source.bytesBase64+'\n'},{mimeType:'image/png'},{text:'duplicate encoding'},{bytesBase64:Buffer.from('not a pdf').toString('base64')}])assert.throws(()=>typedFiles([{...source,...change}]),ImportError);
});
test('Google multipart upload preserves binary source bytes without JSON/string conversion',async()=>{
  const original=Buffer.from([0,255,254,13,10,127,128]),captured=[];
  const driver=new GoogleDriver({fetchImpl:async(url,opts)=>{captured.push(opts);return new Response('{"id":"file"}');}});
  await driver.upload('allowed',{name:'binary.pdf'},original,'application/pdf');
  assert.ok(Buffer.isBuffer(captured[0].body));assert.ok(captured[0].body.includes(original));assert.match(captured[0].headers['Content-Type'],/^multipart\/related/);
  driver.fetch=async()=>new Response(original);await driver.verifySources('allowed',{sourceFiles:[{fileId:'original',sha256:digest(original)}]});
  await assert.rejects(driver.verifySources('allowed',{sourceFiles:[{fileId:'original',sha256:'0'.repeat(64)}]}),e=>e.code==='source_changed');
});
test('v1 same-day payslips and signed valuations preserve multiplicity, formulas and unrelated settings',async()=>{
  const {driver,service,proposed}=await prepared([pay('Alex'),pay('Sam'),valuation(),valuation('-5000000','LOAN')]);
  assert.equal(proposed.counts.new,4);const result=await commit(service,proposed.importId);assert.equal(result.status,'verified');assert.equal(result.verificationScope,'verified_intake');
  assert.equal(driver.state.tables.payslips.rows.length,2);assert.equal(driver.state.tables.valuations.rows[1].values[2],-50000);
  assert.equal(driver.state.tables.payslips.metadataHeader,RECORD_HEADER);assert.equal(driver.state.baseline.asOf,'2027-01-31');assert.equal(driver.state.settingsInputs[1][1],'Keep this');assert.equal(driver.state.formulaFingerprint,'unchanged-formulas');
  assert.equal((await commit(service,proposed.importId)).status,'verified');assert.equal(driver.writes,1);
});
test('v2 valuation uses a V entry in raw Entries A:T and never writes a Valuations view',async()=>{
  const {driver,service,proposed}=await prepared([valuation('-5000000','LOAN')],2);assert.equal((await commit(service,proposed.importId)).status,'verified');
  const row=driver.state.tables.ledger.rows[0].values;assert.equal(row.length,20);assert.equal(row[0],'V0001');assert.equal(row[1],'valuation');assert.equal(row[6],-50000);assert.equal(row[11],'settled');assert.equal(driver.state.tables.valuations,undefined);
});
test('statement-only intake writes a durable receipt with zero ledger rows and cannot claim close',async()=>{
  const {driver,service,proposed}=await prepared([statement()]);const result=await commit(service,proposed.importId);
  assert.equal(result.status,'verified');assert.equal(result.counts.new,0);assert.equal(result.counts.evidence,1);assert.equal(result.verificationScope,'verified_intake');assert.equal(driver.state.tables.ledger.rows.length,0);assert.equal(driver.state.baseline.accounts[0].balanceMinor,'100000');assert.equal(driver.gate,null);
});
test('exact typed replay attaches evidence without appending; conflicting valuation is blocked',async()=>{
  const {driver,service,proposed,req}=await prepared([valuation()]);await commit(service,proposed.importId);
  const again=await service.prepare('allowed',req);assert.equal(again.counts.new,0);assert.equal((await commit(service,again.importId)).status,'verified');assert.equal(driver.state.tables.valuations.rows.length,1);
  await assert.rejects(service.prepare('allowed',request([valuation('20000001')])),e=>e.code==='source_review_required'&&e.issues.some(i=>i.code==='valuation-conflict'));
});
test('typed source facts and field confirmation cannot be changed after approval',async()=>{
  const {driver,service}=setup(),p=pay();p.fields.netMinor='1';await assert.rejects(service.prepare('allowed',request([p])),e=>e.code==='source_review_required');assert.equal(driver.manifests.size,0);
  const proposed=await service.prepare('allowed',request([pay()]));driver.sources.set(source.id,Buffer.from('changed'));await assert.rejects(commit(service,proposed.importId),e=>e.code==='source_changed');assert.equal(driver.writes,0);
});
test('unchanged documents plus CSV are re-parsed and saved under one receipt',async()=>{
  const {driver,service}=setup(),text='Date,Description,Amount\n2027-02-10,Corner Shop,-25.40\n';
  const csv={id:digest(text),name:'bank.csv',text,accountId:'A',mapping:{confirmed:true,date:'Date',description:'Description',amount:'Amount',sign:'money-in-positive',dateOrder:'ymd'}};
  const decisions={'Corner Shop':{categoryId:'FOOD'}},proposal=KittyImport.prepare({...importBaseline(driver.current().legacy),files:[csv],decisions});assert.equal(proposal.canCommit,true,JSON.stringify(proposal.issues));
  const req=request([pay()],{files:[source,csv],proposal:{records:[pay()],rows:proposal.rows,decisions,csvReview:proposal.review}});
  const proposed=await service.prepare('allowed',req);assert.equal(proposed.counts.new,2);assert.equal((await commit(service,proposed.importId)).status,'verified');assert.equal(driver.state.receipts.length,1);
  const provenance=await service.provenance('allowed',{sheetId:SHEET}),replay=KittyImport.prepare({...provenance.baseline,files:[csv]});assert.equal(replay.rows.length,0);assert.equal(replay.issues.length,0);
  const again=await service.prepare('allowed',{...req,proposal:{records:[pay()],rows:[],csvReview:replay.review}});assert.equal(again.counts.new,0);
});
test('zero-activity CSV is accepted with statement evidence but omitted or malformed CSV facts are refused',async()=>{
  const {service}=setup(),text='Date,Description,Amount\n';const csv={id:digest(text),name:'empty.csv',text,accountId:'A',mapping:{confirmed:true,date:'Date',description:'Description',amount:'Amount',sign:'money-in-positive',dateOrder:'ymd'}};
  const proposed=await service.prepare('allowed',request([statement()],{files:[source,csv],proposal:{records:[statement()],rows:[]}}));assert.equal(proposed.counts.new,0);
  const full={...csv,text:'Date,Description,Amount\n2027-02-10,Corner Shop,-25.40\n'};full.id=digest(full.text);
  await assert.rejects(service.prepare('allowed',request([statement()],{files:[source,full],proposal:{records:[statement()],rows:[],decisions:{'Corner Shop':{categoryId:'FOOD'}}}})),e=>['source_facts_mismatch','source_review_required'].includes(e.code));
  await assert.rejects(service.prepare('allowed',request([pay()],{files:[source,csv],proposal:{records:[pay()],rows:[]}})),e=>e.code==='empty_statement_required');
});
test('production multi-tab request shifts only raw cells and metadata, including an empty row 2',()=>{
  const state=initial(),m={writeSets:[{kind:'append',table:'payslips',rows:[{id:'P_abc',values:[dateSerial('2027-02-10'),'Alex','=literal',1000,200,120,800]}],dateColumns:[0]},{kind:'append',table:'valuations',rows:[{id:'V_abc',values:[dateSerial('2027-02-28'),'HOME',200000]}],dateColumns:[0]}],proposalDigest:'a'.repeat(64),recordRefs:[]};
  const req=typedRequests(state,m,'manifest_123456','now'),shifts=req.filter(x=>x.insertRange).map(x=>x.insertRange.range);
  assert.deepEqual(shifts.map(r=>[r.sheetId,r.startRowIndex,r.startColumnIndex,r.endColumnIndex]),[[11,1,0,7],[11,1,8,9],[13,1,0,3],[13,1,5,6]]);
  assert.ok(!req.some(x=>x.insertDimension||x.appendCells));assert.ok(req.every(x=>!JSON.stringify(x).includes('formulaValue')));
  assert.ok(req.some(x=>x.updateCells?.rows[0]?.values.some(c=>c.userEnteredValue.stringValue==='=literal')));
  assert.deepEqual(req.filter(x=>x.appendDimension?.dimension==='COLUMNS').map(x=>x.appendDimension.length),[1,1]);
});
test('changed baseline, raw duplicate IDs, formula changes and removed original rows never verify',async()=>{
  const {driver,service,proposed}=await prepared();driver.state.settingsInputs[1][1]='edited';await assert.rejects(commit(service,proposed.importId),e=>e.code==='stale_proposal');assert.equal(driver.intents.size,0);
  for(const mutate of [s=>s.formulaFingerprint='changed',s=>s.tables.payslips.rows.push(copy(s.tables.payslips.rows[0])),s=>s.tables.payslips.rows[0].values[6]=1,s=>s.tables.payslips.header[0]='Moved']){
    const c=await prepared();c.driver.afterWrite=mutate;assert.equal((await commit(c.service,c.proposed.importId)).status,'conflict');assert.ok(c.driver.gate);
  }
});
test('a manually reused target metadata ID is refused before any write',async()=>{
  const c=await prepared(),m=c.driver.manifests.get(c.proposed.importId),target=m.writeSets[0].rows[0];await c.service.cancel('allowed',c.proposed.importId,{sheetId:SHEET});
  c.driver.state.tables.payslips.metadataHeader=RECORD_HEADER;c.driver.state.tables.payslips.rows.push({id:target.id,values:[dateSerial('2027-02-11'),'Sam','Other',100,20,12,80],rowIndex:1});
  await assert.rejects(c.service.prepare('allowed',c.req),e=>e.code==='record_id_collision');assert.equal(c.driver.writes,0);
});
test('lost write response reconciles and unknown-before-write remains held without another attempt',async()=>{
  for(const fail of ['after','before']){const {driver,service,proposed}=await prepared();driver.fail=fail;const first=await commit(service,proposed.importId);assert.equal(first.status,fail==='after'?'verified':'unknown');driver.fail=null;const restarted=new ImportService({driver,auditSources});assert.equal((await commit(restarted,proposed.importId)).status,first.status);assert.equal(driver.writes,fail==='after'?1:0);}
});
test('cancel reserves the original intent ID; late commit cannot write and a writing intent cannot cancel',async()=>{
  const c=await prepared();assert.equal((await c.service.cancel('allowed',c.proposed.importId,{sheetId:SHEET})).status,'cancelled');assert.equal((await commit(c.service,c.proposed.importId)).status,'cancelled');assert.equal(c.driver.writes,0);
  const writing=await prepared();writing.driver.fail='before';await commit(writing.service,writing.proposed.importId);assert.equal((await writing.service.cancel('allowed',writing.proposed.importId,{sheetId:SHEET})).status,'unknown');
});
test('shared hold survives gate/intent timeout, blocks another device and only matching verified hold clears',async()=>{
  for(const field of ['gateTimeout','intentTimeout']){const c=await prepared();c.driver[field]=true;assert.equal((await commit(c.service,c.proposed.importId)).status,'unknown');const other=new ImportService({driver:c.driver,auditSources});await assert.rejects(other.prepare('allowed',request([valuation()])),e=>e.code==='sheet_import_pending'&&e.recovery.importId===c.proposed.importId);assert.equal(c.driver.writes,0);}
  const c=await prepared();c.driver.clearFails=true;assert.equal((await commit(c.service,c.proposed.importId)).status,'unknown');c.driver.clearFails=false;c.driver.state.tables.payslips.rows.push({id:'external_unique',values:[dateSerial('2027-02-11'),'Sam','Other',100,20,12,80],rowIndex:2});assert.equal((await c.service.status('allowed',c.proposed.importId,{sheetId:SHEET})).status,'verified');assert.equal(c.driver.gate,null);
});
test('a malformed or changed shared hold cannot be cleared by a typed receipt',async()=>{
  const c=await prepared();c.driver.clearFails=true;await commit(c.service,c.proposed.importId);c.driver.clearFails=false;c.driver.gate.stateHash='f'.repeat(64);assert.equal((await c.service.status('allowed',c.proposed.importId,{sheetId:SHEET})).status,'unknown');assert.ok(c.driver.gate);
});
test('typed provenance is authenticated to exact Sheet and only exposes source records matching current raw facts',async()=>{
  const c=await prepared();await commit(c.service,c.proposed.importId);const get=()=>c.service.provenance('allowed',{sheetId:SHEET,protocolVersion:2,periodEnd:'2027-02-28'});const answer=await get();assert.equal(answer.evidenceImportIds[0],c.proposed.importId);assert.equal(answer.baseline.projectedBalances[0].date,'2027-02-28');
  await assert.rejects(c.service.provenance('denied',{sheetId:SHEET,protocolVersion:2}),e=>e.status===403);
  c.driver.state.tables.payslips.rows[0].values[6]=1;const changed=await get();assert.equal(changed.records.length,0);assert.equal(changed.issues[0].code,'evidence_unavailable');
});
async function closeReady(){const c=await prepared([statement()]);c.driver.state.baseline.items=[];c.driver.state.configuration.items=[];await c.service.cancel('allowed',c.proposed.importId,{sheetId:SHEET});c.proposed=await c.service.prepare('allowed',c.req);await commit(c.service,c.proposed.importId);c.closeRequest={protocolVersion:2,operation:'close',sheetId:SHEET,schemaVersion:1,files:[],proposal:{periodEnd:'2027-02-28',evidenceImportIds:[c.proposed.importId],review:{}}};return c;}
test('close preflight requires accepted source evidence and writes only As-of plus receipt',async()=>{
  const c=await closeReady();const p=await c.service.prepare('allowed',c.closeRequest);assert.equal(c.driver.state.baseline.asOf,'2027-01-31');const m=c.driver.manifests.get(p.importId);assert.deepEqual(m.writeSets,[{kind:'asof',date:'2027-02-28'}]);
  const before=c.driver.current('2027-02-28'),requests=typedRequests(before,m,p.importId,'now');const writes=requests.filter(x=>x.updateCells).map(x=>x.updateCells);assert.ok(writes.some(x=>x.start.sheetId===12&&x.start.rowIndex===5&&x.start.columnIndex===1));assert.ok(!writes.some(x=>[10,11,13].includes(x.start.sheetId)));
  const result=await commit(c.service,p.importId);assert.equal(result.status,'verified',JSON.stringify(result.issues));assert.equal(result.verificationScope,'verified_close');assert.equal(c.driver.state.baseline.asOf,'2027-02-28');assert.equal(c.driver.state.settingsInputs[1][1],'Keep this');
});
test('close failure before write leaves As-of unchanged; postflight failure remains distinct and never rolls back/replays',async()=>{
  const c=await closeReady(),bad=copy(c.closeRequest);bad.proposal.evidenceImportIds=[];await assert.rejects(c.service.prepare('allowed',bad),e=>e.code==='close_review_required');assert.equal(c.driver.state.baseline.asOf,'2027-01-31');
  const p=await c.service.prepare('allowed',c.closeRequest);c.driver.afterWrite=(s,m)=>{if(m.operation==='close'){s.baseline.checks[0].status='Review';s.closeMissing=1;}};
  const result=await commit(c.service,p.importId);assert.equal(result.status,'conflict');assert.equal(result.verificationScope,'unverified');assert.equal(c.driver.state.baseline.asOf,'2027-02-28');const writes=c.driver.writes;assert.equal((await commit(c.service,p.importId)).status,'conflict');assert.equal(c.driver.writes,writes);assert.ok(c.driver.gate);
  c.driver.state.baseline.checks[0].status='OK';c.driver.state.closeMissing=0;assert.equal((await c.service.status('allowed',p.importId,{sheetId:SHEET})).verificationScope,'verified_close');
});
test('close requires actual zero missing count and reconciled formula balances, never absent/blank evidence',async()=>{
  for(const mutate of [s=>s.closeMissing=null,s=>s.baseline.checks[0].items=null,s=>s.baseline.accounts[0].balanceMinor='99999']){
    const c=await closeReady(),p=await c.service.prepare('allowed',c.closeRequest);c.driver.afterWrite=mutate;const result=await commit(c.service,p.importId);assert.equal(result.status,'conflict');assert.equal(result.verificationScope,'unverified');
  }
});
test('close lost response after atomic As-of update verifies; missing response before intent execution remains unknown',async()=>{
  for(const failure of ['after','before']){const c=await closeReady(),p=await c.service.prepare('allowed',c.closeRequest);c.driver.fail=failure;const r=await commit(c.service,p.importId);assert.equal(r.status,failure==='after'?'verified':'unknown');assert.equal(r.verificationScope,failure==='after'?'verified_close':'unverified');const count=c.driver.writes;c.driver.fail=null;await commit(c.service,p.importId);assert.equal(c.driver.writes,count);}
});
test('fictional period fixtures save all nine payslips and sixteen signed valuations on both raw Sheet models',async()=>{
  const snapshot=JSON.parse(readFileSync(new URL('../fixtures/snapshot-2026-11.json',import.meta.url))),files=[],records=[];
  for(const period of ['2026-12','2027-01'])for(const kind of ['payslips','valuations']){
    const text=readFileSync(new URL(`../period-close/${period}/${kind}.csv`,import.meta.url),'utf8'),id=digest(text);files.push({id,name:`${period}-${kind}.csv`,mimeType:'text/csv',byteLength:Buffer.byteLength(text),text});
    for(const [index,row]of KittyImport.parseCSV(text).records.entries()){
      const r=row.values,fields=kind==='payslips'?{payDate:r[0],person:r[1],employer:r[2],grossMinor:KittyImport.money(r[3]),taxMinor:KittyImport.money(r[4]),superMinor:KittyImport.money(r[5]),netMinor:KittyImport.money(r[6]),currency:'AUD',valueBasis:'current-period'}:{date:r[0],itemId:r[1],valueMinor:KittyImport.money(r[2]),valueKind:r[1].startsWith('LN-')?'liability':'asset',currency:'AUD'};
      const doc=record(kind==='payslips'?'payslip':'valuation',fields,`${period}-${kind}-${index}`);doc.sourceRefs=[{id:'s1',fileId:id,line:row.line,basis:kind==='payslips'?'current-period':'valuation'}];records.push(doc);
    }
  }
  for(const version of [1,2]){
    const c=setup(version);c.driver.state.baseline.people=['Jordan','Mia','Joint'];c.driver.state.baseline.items=snapshot.assets.map(a=>({id:a.item_id,name:a.item,currency:'AUD',kind:a.class==='Loans'?'liability':'asset',valuationRequired:true}));
    const proposed=await c.service.prepare('allowed',request(records,{schemaVersion:version,files}));assert.equal(proposed.counts.payslip,9);assert.equal(proposed.counts.valuation,16);assert.equal(proposed.counts.new,25);
    assert.equal((await commit(c.service,proposed.importId)).status,'verified');const current=c.driver.current();assert.equal(current.baseline.payslips.length,9);assert.equal(current.baseline.valuations.length,16);assert.ok(current.baseline.valuations.filter(r=>r.fields.valueKind==='liability').every(r=>r.fields.valueMinor.startsWith('-')));
    const repeated=await c.service.prepare('allowed',request(records,{schemaVersion:version,files}));assert.equal(repeated.counts.new,0);assert.equal(current.baseline.asOf,'2027-01-31');
  }
});
test('HTTP protocol2 preserves verification scope, target-date provenance and structured review errors',async()=>{
  const c=setup(),server=createServer({service:c.service});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`,headers={Authorization:'Bearer allowed','Content-Type':'application/json'},post=(path,body)=>fetch(url+path,{method:'POST',headers,body:JSON.stringify(body)});
  try{
    const response=await post('/v1/imports/prepare',request([pay()]));assert.equal(response.status,200);const p=await response.json();assert.equal(p.protocolVersion,2);
    const saved=await(await post(`/v1/imports/${p.importId}/commit`,{sheetId:SHEET,approval:true})).json();assert.equal(saved.verificationScope,'verified_intake');assert.equal(saved.proposalDigest,p.proposalDigest);
    const provenance=await(await fetch(`${url}/v1/imports/provenance?sheetId=${SHEET}&protocolVersion=2&periodEnd=2027-02-28`,{headers})).json();assert.equal(provenance.evidenceImportIds[0],p.importId);assert.equal(provenance.baseline.projectedBalances[0].date,'2027-02-28');
    const bad=pay();bad.fields.netMinor='1';const failed=await post('/v1/imports/prepare',request([bad]));assert.equal(failed.status,409);const error=await failed.json();assert.ok(error.error.issues.length);assert.equal(error.error.code,'source_review_required');
    const unsupported=await post('/v1/imports/prepare',{...request([pay()]),protocolVersion:3});assert.equal(unsupported.status,400);assert.equal((await unsupported.json()).error.code,'unsupported_protocol');
  }finally{await new Promise(resolve=>server.close(resolve));}
});
