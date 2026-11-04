import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {GoogleDriver} from './google-rest.mjs';
import {dateSerial,digest,HEADERS,importBaseline,stateDigest,assertOpeningContract,ImportService} from './core.mjs';
import {auditSources} from './source-audit.mjs';
import {SOURCE_SHA256} from '../templates/build.mjs';

const sheetId='fictional_opening_sheet_123456';
const copy=value=>structuredClone(value);
const KittyImport=createRequire(import.meta.url)('../native-core/import.js');
const markerNames=['template_profile','template_version','template_source_sha256','setup_input_sha256'];
function fixture(profile=true){
  const raw={Kitty:[['Key','Value'],['sheet_version',1],['currency','AUD'],['people','Alex'],...(profile?[['template_profile','au-aud-basic'],['template_version','1.0.0'],['template_source_sha256',SOURCE_SHA256],['setup_input_sha256','a'.repeat(64)]]:[])],
    Accounts:[['Account ID','Account','Institution','Type','Owner','Opening balance ($)','Opening date','Balance at as-of date ($)','Liquid'],['A','Fictional cash','Example Bank','Transaction','Alex',1000,dateSerial('2027-01-31'),1000,'Yes']],
    Categories:[['Category ID','Category'],['FOOD','Food']],Settings:Array.from({length:36},()=>[]),Transactions:[HEADERS[1]]};
  if(profile){raw.Settings[34]=['Opening anchor date',dateSerial('2027-01-31')];raw.Settings[35]=['History starts',dateSerial('2027-02-01')];}
  const entered=new Map([['Settings:35:1',{formulaValue:'=B35+1'}]]),requests=[],gridExtras=[];
  const titles=['Kitty','Accounts','Categories','Settings','Transactions'];
  const driver=new GoogleDriver({fetchImpl:async value=>{
    const url=new URL(value),ranges=url.searchParams.getAll('ranges');requests.push(ranges);
    let result;
    if(url.searchParams.get('fields')==='sheets(properties(sheetId,title,gridProperties))')result={sheets:titles.map((title,index)=>({properties:{sheetId:1000+index,title,gridProperties:{rowCount:100,columnCount:26}}}))};
    else if(url.pathname.endsWith('/values:batchGet'))result={valueRanges:ranges.map(range=>({values:raw[range.split('!')[0].replaceAll("'",'')]??[]}))};
    else if(url.searchParams.get('fields').includes('properties(title)'))result={sheets:[...['Accounts',...(ranges.some(r=>r.startsWith("'Settings'"))?['Settings']:[])].map(title=>({properties:{title},data:[{startRow:0,startColumn:0,rowData:raw[title].map((row,r)=>({values:row.map((value,c)=>({userEnteredValue:entered.get(`${title}:${r}:${c}`)??(typeof value==='number'?{numberValue:value}:{stringValue:value})}))}))}]})),...gridExtras]};
    else result={sheets:[]};
    return new Response(JSON.stringify(result));
  }});
  return {raw,entered,titles,requests,gridExtras,read:()=>driver.readState('allowed',sheetId)};
}
test('only recognized basic profile hydrates trusted ISO account anchors from actual Sheet dates',async()=>{
  const f=fixture(),state=await f.read();assert.deepEqual(state.openingContract,{profile:'au-aud-basic',version:'1.0.0',openingDate:'2027-01-31'});
  assert.equal(state.accounts[0].openingDate,'2027-01-31');assert.equal(importBaseline(state).accounts[0].openingDate,'2027-01-31');assertOpeningContract(state);
  // The settings query does not get folded into the historical formula hash.
  assert.equal(state.formulaFingerprint,digest([]));
});
test('new-profile reader flags missing, duplicate, moved, ambiguous or formula-based opening anchors without throwing',async()=>{
  const changes=[
    f=>f.titles.splice(f.titles.indexOf('Settings'),1),
    f=>f.raw.Kitty.push(['template_profile','au-aud-basic']),
    f=>f.raw.Kitty.push(['template_version','1.0.0']),
    f=>f.raw.Kitty.find(r=>r[0]==='template_version')[1]='2.0.0',
    f=>f.raw.Settings.push(['Opening anchor date',dateSerial('2027-01-31')]),
    f=>f.raw.Settings[34][0]='Renamed opening',
    f=>f.raw.Settings[34][1]=dateSerial('2027-01-30'),
    f=>f.raw.Settings[35][1]=dateSerial('2027-02-02'),
    f=>f.raw.Settings[34][1]='2027-01-31',
    f=>f.entered.set('Settings:34:1',{formulaValue:'=DATE(2027,1,31)'}),
    f=>f.entered.set('Settings:35:1',{numberValue:dateSerial('2027-02-01')}),
    f=>f.raw.Accounts[0][6]='Wrong column',
    f=>f.raw.Accounts[1][6]=dateSerial('2026-12-31'),
    f=>f.raw.Accounts[1][6]=dateSerial('2027-01-31')+0.5,
    f=>f.raw.Accounts[1][6]='',
    f=>f.entered.set('Accounts:1:6',{formulaValue:'=Settings!B35'}),
    f=>f.raw.Accounts.push(copy(f.raw.Accounts[1])),
    f=>f.raw.Accounts.splice(1)
  ];
  for(const change of changes){const f=fixture();change(f);const state=await f.read();assert.ok(state.openingContract.error,String(change));assert.throws(()=>assertOpeningContract(state),e=>e.code==='opening_anchor_invalid');assert.ok(importBaseline(state).accounts.every(a=>a.openingDate===''));}
});
test('genuinely unmarked legacy readers retain exact account, baseline and state digest inputs',async()=>{
  for(const unrelated of [undefined,'template_notes']){
    const f=fixture(false);if(unrelated)f.raw.Kitty.push([unrelated,'Personal household notes']);
    // Legacy historical data intentionally remains unaffected by the new policy.
    f.raw.Accounts[1][6]='uninterpreted historical cell';
    const state=await f.read();assert.equal(Object.hasOwn(state,'openingContract'),false);assert.deepEqual(state.accounts,[{id:'A',name:'Fictional cash',owner:'Alex'}]);
    assert.equal(Object.hasOwn(state,'openingCheckInputs'),false);
    const original={version:state.version,header:state.header,rows:state.rows,accounts:state.accounts,categories:state.categories,currency:state.currency,people:state.people,formulaFingerprint:state.formulaFingerprint};
    assert.equal(stateDigest(state),digest(original));assert.deepEqual(importBaseline(state),{existing:[],accounts:state.accounts,categories:state.categories,currency:'AUD',people:['Joint','Alex']});
  }
});
test('removing or renaming any setup marker cannot downgrade a basic workbook to legacy',async()=>{
  for(const marker of markerNames)for(const action of ['remove','rename','blank']){
    const f=fixture(),before=await f.read(),index=f.raw.Kitty.findIndex(row=>row[0]===marker);
    if(action==='remove')f.raw.Kitty.splice(index,1);else if(action==='rename')f.raw.Kitty[index][0]='renamed_'+marker;else f.raw.Kitty[index][1]='';
    const after=await f.read();assert.ok(after.openingContract.error,marker+' '+action);assert.throws(()=>assertOpeningContract(after),e=>e.code==='opening_anchor_invalid');
    assert.equal(importBaseline(after).accounts[0].openingDate,'');assert.equal(stateDigest(after),stateDigest(before),'metadata errors do not hide an earlier receipt');
  }
  for(const alter of [
    f=>f.raw.Kitty.find(row=>row[0]==='template_profile')[1]='another-template',
    f=>f.raw.Kitty.find(row=>row[0]==='template_source_sha256')[1]='b'.repeat(64),
    f=>f.raw.Kitty.push(['TEMPLATE_PROFILE','au-aud-basic']),
    f=>f.raw.Kitty=f.raw.Kitty.filter(row=>!markerNames.includes(row[0]))
  ]){const f=fixture();alter(f);assert.ok((await f.read()).openingContract.error);}
});
test('every residual recognized marker independently signals a damaged setup contract',async()=>{
  for(const marker of markerNames){
    const f=fixture();f.raw.Kitty=f.raw.Kitty.filter(row=>!markerNames.includes(row[0])||row[0]===marker);f.raw.Settings=[];
    const state=await f.read();assert.ok(state.openingContract.error);assert.equal(importBaseline(state).accounts[0].openingDate,'');
  }
  for(const setting of ['Opening anchor date','History starts']){
    const f=fixture(false);f.raw.Settings[34]=[setting,dateSerial('2027-01-31')];const state=await f.read();assert.ok(state.openingContract.error);
  }
});
function serviceFixture(f){
  const manifests=new Map(),intents=new Map(),receipts=[],sources=new Map();let gate=null,reservations=0,writes=0;
  const driver={authorize:async()=>{},readState:async()=>({...await f.read(),receipts:copy(receipts)}),readSheetGate:async()=>copy(gate),writeSheetGate:async(token,id,value)=>{gate=copy(value);},clearSheetGate:async()=>{gate=null;return true;},
    reserveID:async()=>{reservations++;return 'reserved_000001';},storeSource:async(token,id,file)=>{sources.set(file.id,file.text);return {sourceId:file.id,fileId:file.id,sha256:file.id};},
    storeManifest:async(token,manifest)=>{manifests.set('manifest_000001',copy(manifest));return 'manifest_000001';},loadManifest:async(token,id)=>copy(manifests.get(id)),
    verifySources:async()=>{},findIntent:async(token,id)=>copy(intents.get(id)),storeIntent:async(token,id,importId,sheetId,value)=>{intents.set(id,copy(value));},
    atomicInsert:async(token,id,state,manifest,importId,date)=>{writes++;f.raw.Transactions.push(...copy(manifest.targetRows));receipts.push({importId,digest:manifest.proposalDigest,writtenAt:date,ids:JSON.stringify(manifest.targetRows.map(row=>row[0])),manifestFile:importId});}};
  return {service:new ImportService({driver,auditSources}),sources,manifests,intents,counts:()=>({reservations,writes}),setIntent:value=>intents.set('reserved_000001',value)};
}
async function transactionRequest(f,date='2027-02-01'){
  const text=`Date,Description,Amount\n${date},Corner Shop,-25.40\n`,files=[{id:digest(text),name:'fictional-bank.csv',text,accountId:'A',mapping:{confirmed:true,date:'Date',description:'Description',amount:'Amount',sign:'money-in-positive',dateOrder:'ymd'}}];
  const baseline=importBaseline(await f.read()),decisions={'Corner Shop':{categoryId:'FOOD'}};
  const proposal=KittyImport.prepare({...baseline,files,decisions});proposal.decisions=decisions;
  return {sheetId,schemaVersion:1,files,proposal};
}
test('deleted profile blocks pre-anchor prepare before uploading sources or reserving any write state',async()=>{
  const f=fixture(),ctx=serviceFixture(f),request=await transactionRequest(f,'2027-01-31');f.raw.Kitty=f.raw.Kitty.filter(row=>row[0]!=='template_profile');
  await assert.rejects(ctx.service.prepare('allowed',request),e=>e.code==='opening_anchor_invalid');
  assert.deepEqual(ctx.counts(),{reservations:0,writes:0});assert.equal(ctx.sources.size,0);assert.equal(ctx.manifests.size,0);assert.equal(ctx.intents.size,0);
  const p=await ctx.service.provenance('allowed',{sheetId});assert.ok(KittyImport.prepare({...p.baseline,files:request.files}).issues.some(issue=>issue.code==='opening-anchor-invalid'));
});
test('marker damage leaves proposed/cancelled/unknown/completed import recovery available',async()=>{
  for(const phase of ['proposed','writing','completed']){
    const f=fixture(),ctx=serviceFixture(f),request=await transactionRequest(f),p=await ctx.service.prepare('allowed',request);
    if(phase==='writing')ctx.setIntent({status:'writing',proposalDigest:p.proposalDigest});
    if(phase==='completed')assert.equal((await ctx.service.commit('allowed',p.importId,{sheetId,approval:true})).status,'verified');
    f.raw.Kitty=f.raw.Kitty.filter(row=>!markerNames.includes(row[0]));
    const expected=phase==='proposed'?'proposed':phase==='writing'?'unknown':'verified';
    assert.equal((await ctx.service.status('allowed',p.importId,{sheetId})).status,expected);
    if(phase==='proposed')await assert.rejects(ctx.service.commit('allowed',p.importId,{sheetId,approval:true}),e=>e.code==='opening_anchor_invalid');
    assert.equal((await ctx.service.cancel('allowed',p.importId,{sheetId})).status,phase==='proposed'?'cancelled':expected);
    assert.equal(ctx.counts().writes,phase==='completed'?1:0);
  }
});
test('claimed setup exposes only bounded diagnostic/helper entered cells without adding digest fields',async()=>{
  const f=fixture();f.titles.push('Compliance Checks','Payslips');
  const cells=[
    ['Compliance Checks',3,0,{stringValue:'outside'}],['Compliance Checks',4,0,{stringValue:'Diagnostic'}],['Compliance Checks',27,6,{boolValue:true}],['Compliance Checks',28,0,{stringValue:'outside'}],['Compliance Checks',4,7,{numberValue:900}],
    ['Settings',6,1,{formulaValue:'=1'}],['Settings',9,1,{formulaValue:'=2'}],['Settings',10,1,{numberValue:900}],['Settings',33,1,{formulaValue:'=3'}],
    ['Transactions',1,0,{stringValue:'private raw input'}],['Transactions',1,10,{formulaValue:'=4'}],['Transactions',1,16,{formulaValue:'=5'}],['Transactions',1,17,{formulaValue:'=6'}],['Transactions',2,10,{formulaValue:'=7'}],
    ['Payslips',1,7,{formulaValue:'=8'}],['Payslips',2,7,{formulaValue:'=9'}]
  ];
  for(const [tab,rowIndex,columnIndex,userEnteredValue]of cells)f.gridExtras.push({properties:{title:tab},data:[{startRow:rowIndex,startColumn:columnIndex,rowData:[{values:[{userEnteredValue}]}]}]});
  const state=await f.read(),expected=new Set(['Compliance Checks:4:0','Compliance Checks:27:6','Settings:6:1','Settings:9:1','Settings:33:1','Settings:34:1','Settings:35:1','Transactions:1:10','Transactions:1:16','Payslips:1:7']);
  assert.deepEqual(new Set(state.openingCheckInputs.map(cell=>`${cell.tab}:${cell.rowIndex}:${cell.columnIndex}`)),expected);
  assert.deepEqual(state.openingCheckInputs.find(cell=>cell.tab==='Compliance Checks'&&cell.rowIndex===27).userEnteredValue,{boolValue:true});
  assert.deepEqual(state.openingCheckInputs.find(cell=>cell.tab==='Settings'&&cell.rowIndex===34).userEnteredValue,{numberValue:dateSerial('2027-01-31')});
  assert.ok(!JSON.stringify(state.openingCheckInputs).includes('private raw input'));
  const before=stateDigest(state);state.openingCheckInputs=[];assert.equal(stateDigest(state),before);
});
