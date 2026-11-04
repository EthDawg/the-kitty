import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input,smallPlan,initializedState} from './test-support.mjs';
import {SetupService} from './core.mjs';
import {sha256,verifyWorkbook,blankWorkbook} from './verify.mjs';
import {buildTemplate} from '../templates/build.mjs';
const count=(driver,name)=>driver.calls.filter(call=>call===name).length;

test('reservation allocates only JSON IDs and binds approved input to authenticated owner',async()=>{
  const f=await fixture();assert.deepEqual(f.driver.calls,['reserve']);assert.equal(f.driver.records.size,0);assert.equal(f.reservation.status,'reserved');assert.equal(f.reservation.ownerPermissionId,'fictional-owner');assert.equal(f.reservation.canContinue,false);assert.equal(f.reservation.canCancel,false);assert.equal(f.reservation.inputSha256,sha256(input));
  f.driver.permissionId='different-owner';await assert.rejects(f.begin,{code:'setup_review_changed'});assert.equal(f.driver.records.size,0);assert.equal(f.driver.workbooks.size,0);
});
test('new workbook is verified once, with exact receipt binding on repeated begin/status/continue',async()=>{
  const f=await fixture();for(const result of [await f.begin(),await f.begin(),await f.status(),await f.resume()]){assert.equal(result.status,'verified');assert.equal(result.phase,'complete');assert.equal(result.sheetId,'workbook_0000000001');assert.equal(result.setupId,f.reservation.setupId);assert.equal(result.proposalDigest,f.reservation.proposalDigest);assert.equal(result.ownerPermissionId,f.reservation.ownerPermissionId);assert.equal(result.canCancel,false);assert.equal(result.canContinue,false);}
  assert.equal(count(f.driver,'createWorkbook'),1);assert.equal(count(f.driver,'initializeWorkbook'),1);assert.equal(f.driver.records.size,3);
});
test('changed approval, digest or reservation cannot create or replace a workbook',async()=>{
  const f=await fixture(),base={...f.reservation,input,approval:true};
  await assert.rejects(()=>f.service.begin('token',f.reservation.setupId,{...base,approval:false}),{code:'setup_approval_required'});
  await assert.rejects(()=>f.service.begin('token',f.reservation.setupId,{...base,input:{...input,openingMinor:'999'}}),{code:'setup_review_changed'});
  await assert.rejects(()=>f.service.begin('token',f.reservation.setupId,{...base,createIntentId:f.reservation.setupId}),{code:'reservation_invalid'});
  assert.equal(f.driver.records.size,0);
});
test('lost manifest response can recover only its exact reserved ID',async()=>{
  const f=await fixture();f.driver.putMode.manifest='lost';assert.equal((await f.begin()).status,'verified');assert.equal(count(f.driver,'createWorkbook'),1);
  const g=await fixture();g.driver.putMode.manifest='absent';assert.equal((await g.begin()).status,'unknown');assert.equal(g.driver.workbooks.size,0);delete g.driver.putMode.manifest;assert.equal((await g.begin()).status,'verified');assert.equal(count(g.driver,'createWorkbook'),1);
});
test('uncertain create intent is never a fresh win, even when its exact record is visible',async()=>{
  const f=await fixture();f.driver.putMode.create='lost';for(const result of [await f.begin(),await f.status(),await f.resume(),await f.cancel()])assert.equal(result.status,'unknown');assert.equal(count(f.driver,'createWorkbook'),0);assert.equal(f.driver.records.size,2);
});
test('a zero-result search after an uncertain creation never permits another POST',async()=>{
  const f=await fixture();f.driver.createMode='before';assert.equal((await f.begin()).status,'unknown');f.driver.createMode='normal';for(const result of [await f.begin(),await f.resume(),await f.status(),await f.cancel()])assert.equal(result.status,'unknown');assert.equal(count(f.driver,'createWorkbook'),1);assert.equal(count(f.driver,'initializeWorkbook'),0);
});
test('lost creation response recovers a unique marked workbook without creating it again',async()=>{
  const f=await fixture();f.driver.createMode='after';assert.equal((await f.begin()).status,'verified');assert.equal((await f.resume()).status,'verified');assert.equal(count(f.driver,'createWorkbook'),1);assert.equal(count(f.driver,'initializeWorkbook'),1);
});
test('a definite Sheet ID survives delayed Drive search and uncertain recovery-metadata response',async()=>{
  for(const mode of [undefined,'after']){const f=await fixture();f.driver.hiddenSearch=true;f.driver.rememberMode=mode;assert.equal((await f.begin()).status,'verified');assert.equal((await f.status()).status,'verified');assert.equal(count(f.driver,'createWorkbook'),1);}
});
test('loss of both metadata update and search visibility preserves unknown until exact workbook is found',async()=>{
  const f=await fixture();f.driver.hiddenSearch=true;f.driver.rememberMode='before';assert.equal((await f.begin()).status,'unknown');assert.equal((await f.resume()).status,'unknown');f.driver.hiddenSearch=false;const result=await f.status();assert.equal(result.status,'created');assert.equal(result.canContinue,true);assert.equal(result.canCancel,false);assert.equal((await f.resume()).status,'verified');assert.equal(count(f.driver,'createWorkbook'),1);
});
test('incomplete search cannot mean prepared or authorize creation, including with a known ID',async()=>{
  const f=await fixture();f.driver.unavailableSearch=true;assert.equal((await f.begin()).status,'unknown');assert.equal(count(f.driver,'createWorkbook'),0);f.driver.unavailableSearch=false;assert.equal((await f.begin()).status,'verified');f.driver.unavailableSearch=true;assert.equal((await f.status()).status,'unknown');assert.equal(count(f.driver,'createWorkbook'),1);
});
test('multiple workbook matches and known-ID disagreement are conflicts without initialization',async()=>{
  const f=await fixture();f.driver.initMode='before';await f.begin();f.driver.workbooks.set('workbook_0000000002',structuredClone(f.driver.workbooks.get('workbook_0000000001')));assert.equal((await f.resume()).status,'conflict');assert.equal(count(f.driver,'createWorkbook'),1);assert.equal(count(f.driver,'initializeWorkbook'),1);
});
test('lost initialization intent response must not dispatch or replay the initialization batch',async()=>{
  const f=await fixture();f.driver.putMode.initialize='lost';for(const result of [await f.begin(),await f.resume(),await f.begin(),await f.cancel()]){assert.equal(result.status,'unknown');assert.equal(result.phase,'initialize');}assert.equal(count(f.driver,'initializeWorkbook'),0);
});
test('initialization timeout before/after application reconciles content, with no replay',async()=>{
  for(const mode of ['before','after']){const f=await fixture();f.driver.initMode=mode;const expected=mode==='before'?'unknown':'verified';assert.equal((await f.begin()).status,expected);f.driver.initMode='normal';assert.equal((await f.resume()).status,expected);assert.equal(count(f.driver,'initializeWorkbook'),1);assert.equal(count(f.driver,'createWorkbook'),1);}
});
test('calculation failure remains unknown and later readback can verify without another initialization',async()=>{
  const f=await fixture();f.driver.initMode='calculation';assert.equal((await f.begin()).status,'unknown');const workbook=f.driver.workbooks.get('workbook_0000000001');workbook.state.cells.at(-1).effectiveValue={numberValue:123.45};assert.equal((await f.status()).status,'verified');assert.equal(count(f.driver,'initializeWorkbook'),1);
});
test('recovery preserves modified content, formula changes, raw records and changed access',async()=>{
  for(const change of [s=>s.cells.at(-1).userEnteredValue.formulaValue='=999',s=>s.cells.push({sheetId:1002,rowIndex:1,columnIndex:0,userEnteredValue:{stringValue:'unapproved'}}),s=>s.cells[1].userEnteredValue.stringValue='yes']){const f=await fixture();await f.begin();change(f.driver.workbooks.get('workbook_0000000001').state);assert.equal((await f.resume()).status,'conflict');assert.equal(count(f.driver,'initializeWorkbook'),1);}
  const f=await fixture();await f.begin();f.driver.workbooks.get('workbook_0000000001').shared=true;assert.equal((await f.status()).status,'conflict');assert.equal(count(f.driver,'initializeWorkbook'),1);
});
test('tampered manifest and arbitrary replacement plan are refused despite a matching self-hash',async()=>{
  const f=await fixture();await f.begin();const m=f.driver.records.get(f.reservation.setupId);m.plan.batchUpdate.requests.push({deleteSheet:{sheetId:1001}});await assert.rejects(f.status,{code:'setup_manifest_changed'});
  const {proposalDigest,...body}=m;m.proposalDigest=sha256(body);await assert.rejects(()=>f.service.continue('token',m.setupId,{proposalDigest:m.proposalDigest,approval:true}),{code:'setup_template_changed'});assert.equal(count(f.driver,'initializeWorkbook'),1);
});
test('prepared setup can cancel with a durable tombstone that a late begin cannot override',async()=>{
  const f=await fixture();f.driver.putMode.create='absent';assert.equal((await f.begin()).status,'prepared');assert.equal((await f.status()).canCancel,true);delete f.driver.putMode.create;assert.equal((await f.cancel()).status,'cancelled');assert.equal((await f.begin()).status,'cancelled');assert.equal((await f.resume()).status,'cancelled');assert.equal(count(f.driver,'createWorkbook'),0);
});
test('crash before begin can cancel without uploading household inputs, and a late begin respects its tombstone',async()=>{
  const f=await fixture(),binding={proposalDigest:f.reservation.proposalDigest,createIntentId:f.reservation.createIntentId,initializeIntentId:f.reservation.initializeIntentId,ownerPermissionId:f.reservation.ownerPermissionId,input};
  await assert.rejects(()=>f.service.status('token',f.reservation.setupId,binding),{code:'not_found'});
  assert.equal((await f.service.cancel('token',f.reservation.setupId,binding)).status,'cancelled');assert.equal(f.driver.records.has(f.reservation.setupId),false);assert.equal(f.driver.records.size,1);
  await assert.rejects(()=>f.service.status('token',f.reservation.setupId,binding),{code:'not_found'});assert.equal((await f.service.cancel('token',f.reservation.setupId,binding)).status,'cancelled');assert.equal((await f.begin()).status,'cancelled');assert.equal(f.driver.records.has(f.reservation.setupId),false);assert.equal(count(f.driver,'createWorkbook'),0);
});
test('pre-begin cancellation stays unknown after lost writes and cannot mask a raced writing intent',async()=>{
  const f=await fixture(),binding={...f.reservation,input};f.driver.putMode.create='absent';assert.equal((await f.service.cancel('token',binding.setupId,binding)).status,'unknown');delete f.driver.putMode.create;assert.equal((await f.service.cancel('token',binding.setupId,binding)).status,'cancelled');
  const g=await fixture();g.driver.putMode.create='lost';await g.begin();g.driver.records.delete(g.reservation.setupId);const result=await g.service.cancel('token',g.reservation.setupId,{...g.reservation,input});assert.equal(result.status,'unknown');assert.equal(g.driver.records.get(g.reservation.createIntentId).status,'writing');assert.equal(count(g.driver,'createWorkbook'),0);
});
test('pre-begin cancellation requires original owner and reservation identities',async()=>{
  const f=await fixture();await assert.rejects(()=>f.service.cancel('token',f.reservation.setupId,{proposalDigest:f.reservation.proposalDigest}),{code:'setup_reservation_required'});await assert.rejects(()=>f.service.cancel('token',f.reservation.setupId,{...f.reservation,ownerPermissionId:'another-owner',input}),{code:'setup_reservation_required'});await assert.rejects(()=>f.service.cancel('token',f.reservation.setupId,{...f.reservation,createIntentId:'different_reserved_12345',input}),{code:'setup_review_changed'});await assert.rejects(()=>f.service.cancel('token',f.reservation.setupId,{...f.reservation,initializeIntentId:'different_reserved_12345',input}),{code:'setup_review_changed'});assert.equal(f.driver.records.size,0);
});
test('queued create versus cancellation cannot both win the immutable create-intent identity',async()=>{
  for(const cancelFirst of [true,false]){const f=await fixture();f.driver.putMode.create='absent';await f.begin();delete f.driver.putMode.create;const results=await Promise.all(cancelFirst?[f.cancel(),f.resume()]:[f.resume(),f.cancel()]);assert.ok(results.every(r=>r.status===(cancelFirst?'cancelled':'verified')));assert.equal(count(f.driver,'createWorkbook'),cancelFirst?0:1);}
});
test('default-tab collisions and unexpected initial values are never initialized',()=>{
  const plan=smallPlan(input);assert.equal(blankWorkbook({sheets:[],cells:[]},plan).ok,true);assert.equal(blankWorkbook({sheets:[{sheetId:1000,title:'Sheet1'}],cells:[]},plan).ok,false);assert.equal(blankWorkbook({sheets:[{sheetId:0,title:'Sheet1'}],cells:[{userEnteredValue:{numberValue:0}}]},plan).ok,false);assert.equal(blankWorkbook({sheets:[{sheetId:0,title:'Sheet1',hasStructuralFeatures:true}],cells:[]},plan).ok,false);
});
test('process restart recovers durable intent states without inheriting an in-memory queue or replaying writes',async()=>{
  for(const mode of ['before','after']){const f=await fixture();f.driver.initMode=mode;await f.begin();const restarted=new SetupService({driver:f.driver,builder:smallPlan});assert.equal((await restarted.status('new-ephemeral-token',f.reservation.setupId,{proposalDigest:f.reservation.proposalDigest})).status,mode==='before'?'unknown':'verified');assert.equal(count(f.driver,'createWorkbook'),1);assert.equal(count(f.driver,'initializeWorkbook'),1);assert.ok(!JSON.stringify([...f.driver.records]).includes('ephemeral-token'));}
});
test('required number formats/entry validation and unavailable blank checks cannot be skipped',()=>{
  const plan=smallPlan(input),state=initializedState(plan);plan.batchUpdate.requests.push({repeatCell:{range:{sheetId:1001,startRowIndex:0,endRowIndex:1,startColumnIndex:1,endColumnIndex:2},cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0.00'}}},fields:'userEnteredFormat.numberFormat'}},{repeatCell:{range:{sheetId:1002,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:1},cell:{dataValidation:{condition:{type:'NUMBER_GREATER',values:[{userEnteredValue:'0'}]},strict:true}},fields:'dataValidation'}});
  plan.verification.checks.push({id:'unavailable',range:"'Accounts'!A3",kind:'blank'});assert.equal(verifyWorkbook(state,plan).status,'conflict');state.cells[3].numberFormat={type:'NUMBER',pattern:'0.00'};state.cells.push({sheetId:1002,rowIndex:1,columnIndex:0,dataValidation:{condition:{type:'NUMBER_GREATER',values:[{userEnteredValue:'0'}]},strict:true,showCustomUi:false}});assert.equal(verifyWorkbook(state,plan).status,'verified');state.cells.push({sheetId:1001,rowIndex:2,columnIndex:0,effectiveValue:{numberValue:0}});assert.equal(verifyWorkbook(state,plan).status,'unknown');
});
test('exact grid verification separates altered inputs from unavailable/recalculated effective checks',()=>{
  const plan=smallPlan(input),state=initializedState(plan);assert.equal(verifyWorkbook(state,plan).status,'verified');state.cells.at(-1).effectiveValue={numberValue:123.45000000000002};assert.equal(verifyWorkbook(state,plan).status,'verified');delete state.cells.at(-1).effectiveValue;assert.equal(verifyWorkbook(state,plan).status,'unknown');state.cells.at(-1).userEnteredValue.formulaValue='=wrong';assert.equal(verifyWorkbook(state,plan).status,'conflict');
});
test('real pinned generator fits bounded setup and retains distinct IDs from a default workbook',async()=>{
  const service=new SetupService({driver:{identity:async()=>({permissionId:'test-owner'}),reserveIDs:async()=>['reservation_00001','reservation_00002','reservation_00003']}});
  const real={profile:'au-aud-basic',sheetVersion:1,householdName:'Fictional Test',people:['Avery'],openingDate:'2026-10-31',accounts:[{id:'ACC-CASH',name:'Cash',institution:'Example Bank',type:'Transaction',owner:'Avery',openingMinor:'0'}]};
  const result=await service.reserve('synthetic',{input:real}),plan=buildTemplate(real);assert.equal(result.inputSha256,sha256(result.normalizedInput));assert.ok(plan.verification.sheets.every(sheet=>sheet.sheetId>=1000));assert.equal(plan.verification.sheets.length,21);assert.ok(Buffer.byteLength(JSON.stringify(plan.batchUpdate))<1_900_000);
});
