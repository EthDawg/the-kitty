import test from 'node:test';
import assert from 'node:assert/strict';
import {GoogleSetupDriver} from './google-rest.mjs';
import {smallPlan,input} from './test-support.mjs';
const identity={permissionId:'fictional-owner'},id='reserved_0000000001',digest='a'.repeat(64),sheetId='workbook_0000000001';
const spec={kind:'manifest',setupId:id,digest};
const props=s=>({kittySetup:s.setupId,kittySetupDigest:s.digest,kittySetupKind:s.kind,...(s.stage?{kittySetupStage:s.stage,kittySetupStatus:s.status}:{})});
const metadata=(s=spec,fileId=id)=>({id:fileId,mimeType:s.kind==='workbook'?'application/vnd.google-apps.spreadsheet':'application/json',ownedByMe:true,trashed:false,capabilities:{canEdit:true},appProperties:props(s)});
const permission={id:identity.permissionId,type:'user',role:'owner'};
const result=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const manifest={contract:'kitty-setup/1',setupId:id,proposalDigest:digest,ownerPermissionId:identity.permissionId};
function recorder(respond){const calls=[];return {calls,driver:new GoogleSetupDriver({fetchImpl:async(url,options)=>{calls.push({url:String(url),options});return respond(new URL(url),options,calls.length);}})};}

test('Drive identity uses permission ID, IDs are reserved for binary files, and creation omits parents and generated IDs',async()=>{
  const {driver,calls}=recorder((url)=>url.pathname.endsWith('/about')?result({user:{permissionId:identity.permissionId}}):url.pathname.endsWith('/generateIds')?result({ids:[id,'reserved_0000000002','reserved_0000000003']}):result({id:sheetId}));
  assert.deepEqual(await driver.identity('synthetic-token'),identity);await driver.reserveIDs('synthetic-token',3);await driver.createWorkbook('synthetic-token',{...manifest,plan:smallPlan(input)});
  assert.equal(new URL(calls[0].url).searchParams.get('fields'),'user(permissionId)');assert.equal(new URL(calls[1].url).searchParams.get('type'),'files');assert.equal(new URL(calls[1].url).searchParams.get('space'),'drive');
  const call=calls[2],body=JSON.parse(call.options.body);assert.equal(call.options.method,'POST');assert.equal(new URL(call.url).searchParams.get('ignoreDefaultVisibility'),'true');assert.equal(body.mimeType,'application/vnd.google-apps.spreadsheet');assert.equal(body.id,undefined);assert.equal(body.parents,undefined);assert.deepEqual(body.appProperties,props({kind:'workbook',setupId:id,digest}));assert.equal(call.options.redirect,'error');
});
test('known-ID JSON creation validates bytes after success, conflict and lost response, granting a win only for success',async()=>{
  for(const mode of ['success','conflict','lost']){
    const {driver,calls}=recorder((url,options)=>{
      if(options.method==='POST'){if(mode==='lost')throw new Error('transport');return result({id},mode==='conflict'?409:200);}
      if(url.pathname.endsWith('/permissions'))return result({permissions:[permission]});if(url.searchParams.get('alt')==='media')return result(manifest);return result(metadata());
    });
    assert.deepEqual(await driver.putKnownJSON('token',id,manifest,spec,identity),{created:mode==='success',observed:true});
    assert.equal(calls.filter(call=>call.options.method==='POST').length,1);const upload=calls[0],bytes=upload.options.body.toString('utf8');assert.match(bytes,/"id":"reserved_0000000001"/);assert.match(bytes,/"mimeType":"application\/json"/);assert.equal(new URL(upload.url).searchParams.get('ignoreDefaultVisibility'),'true');assert.ok(!bytes.includes('"parents"'));
  }
});
test('a known-ID conflict does not establish manifest equivalence or owner authority',async()=>{
  for(const changed of ['body','owner','mime','digest','sharing']){
    const meta=metadata();if(changed==='owner')meta.ownedByMe=false;if(changed==='mime')meta.mimeType='text/plain';if(changed==='digest')meta.appProperties.kittySetupDigest='b'.repeat(64);
    const {driver}=recorder((url,options)=>options.method==='POST'?result({},409):url.pathname.endsWith('/permissions')?result({permissions:changed==='sharing'?[permission,{type:'anyone',role:'reader',id:'anyone'}]:[permission]}):url.searchParams.get('alt')==='media'?result(changed==='body'?{...manifest,ownerPermissionId:'changed-owner'}:manifest):result(meta));
    await assert.rejects(()=>driver.putKnownJSON('token',id,manifest,spec,identity));
  }
});
test('owner-only permission read must paginate completely and reject shared-drive or repeated/incomplete pages',async()=>{
  const {driver,calls}=recorder((url)=>url.searchParams.has('pageToken')?result({permissions:[{id:'another',type:'user',role:'reader'}]}):result({permissions:[permission],nextPageToken:'second'}));
  await assert.rejects(()=>driver.assertOwnedPrivate('token',id,identity,spec,metadata()),{code:'setup_permissions_changed'});assert.equal(calls.length,2);
  await assert.rejects(()=>driver.assertOwnedPrivate('token',id,identity,spec,{...metadata(),driveId:'team-drive'}),{code:'setup_owner_changed'});
  const repeating=recorder(()=>result({permissions:[permission],nextPageToken:'loop'}));await assert.rejects(()=>repeating.driver.assertOwnedPrivate('token',id,identity,spec,metadata()),{code:'setup_permissions_unknown'});assert.equal(repeating.calls.length,2);
});
test('marker search includes every page and refuses incomplete, repeating or duplicate result sets',async()=>{
  const {driver,calls}=recorder(url=>url.searchParams.has('pageToken')?result({files:[{id:'workbook_0000000002'}]}):result({files:[{id:sheetId}],nextPageToken:'next',incompleteSearch:false}));
  assert.equal((await driver.findSheets('token',manifest)).length,2);assert.match(new URL(calls[0].url).searchParams.get('q'),/kittySetup/);assert.ok(!new URL(calls[0].url).searchParams.get('q').includes('kittySetupDigest'));assert.equal(new URL(calls[1].url).searchParams.get('pageToken'),'next');
  for(const body of [{files:[],incompleteSearch:true},{files:[],nextPageToken:'loop'},{files:[{id:sheetId},{id:sheetId}]}]){const f=recorder(()=>result(body));await assert.rejects(()=>f.driver.findSheets('token',manifest),{code:'setup_search_incomplete'});}
});
test('cancellation tombstone can be observed but never won by a delayed writing-intent POST',async()=>{
  const m={...manifest,createIntentId:id},intent={contract:'kitty-setup-intent/1',setupId:id,proposalDigest:digest,ownerPermissionId:identity.permissionId,stage:'create',status:'cancelled'};
  const cancelled={kind:'intent',setupId:id,digest,stage:'create',status:'cancelled'};
  const {driver}=recorder((url,options)=>options.method==='POST'?result({},409):url.pathname.endsWith('/permissions')?result({permissions:[permission]}):url.searchParams.get('alt')==='media'?result(intent):result(metadata(cancelled)));
  assert.deepEqual(await driver.putKnownJSON('token',id,{...intent,status:'writing'},{...cancelled,status:'writing'},identity),{created:false,observed:true});assert.equal((await driver.loadIntent('token',id,m,'create',identity)).status,'cancelled');
});
test('malformed intent state and mismatched Sheet recovery metadata are rejected',async()=>{
  for(const changed of ['unknown-status','bad-id','wrong-owner']){
    const intent={contract:'kitty-setup-intent/1',setupId:id,proposalDigest:digest,ownerPermissionId:changed==='wrong-owner'?'other':identity.permissionId,stage:'create',status:'writing'};const meta=metadata({kind:'intent',setupId:id,digest,stage:'create',status:changed==='unknown-status'?'done':'writing'});if(changed==='bad-id')meta.appProperties.kittySheet='bad';
    const {driver}=recorder(url=>url.pathname.endsWith('/permissions')?result({permissions:[permission]}):url.searchParams.get('alt')==='media'?result(intent):result(meta));await assert.rejects(()=>driver.loadIntent('token',id,manifest,'create',identity),{code:'setup_intent_changed'});
  }
});
test('workbook initialization adds generated tabs before deleting only observed empty defaults, once',async()=>{
  const {driver,calls}=recorder(()=>result({replies:[]}));const plan=smallPlan(input);await driver.initializeWorkbook('token',sheetId,plan,[{sheetId:0,title:'Sheet1'}]);assert.equal(calls.length,1);assert.equal(new URL(calls[0].url).pathname,`/v4/spreadsheets/${sheetId}:batchUpdate`);const body=JSON.parse(calls[0].options.body);assert.deepEqual(body.requests.at(-1),{deleteSheet:{sheetId:0}});assert.deepEqual(body.requests.slice(0,-1),plan.batchUpdate.requests);
});
test('full-grid read includes formulas/effective values and rejects omitted tabs or changed structure',async()=>{
  const meta={spreadsheetId:sheetId,properties:{title:'Test',locale:'en_AU',timeZone:'Australia/Sydney'},sheets:[{properties:{sheetId:0,title:'Sheet1',sheetType:'GRID',gridProperties:{rowCount:2,columnCount:2}}}]};
  const grid={sheets:[{properties:{sheetId:0,title:'Sheet1'},data:[{startRow:0,startColumn:0,rowData:[{values:[{userEnteredValue:{formulaValue:'=1'},effectiveValue:{numberValue:1},userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'}}}]}]}]}]};
  const f=recorder(url=>result(url.searchParams.has('ranges')?grid:meta)),state=await f.driver.readWorkbook('token',sheetId);assert.equal(state.cells[0].userEnteredValue.formulaValue,'=1');assert.equal(state.cells[0].effectiveValue.numberValue,1);assert.equal(new URL(f.calls[1].url).searchParams.get('ranges'),"'Sheet1'!A1:B2");
  const missing=recorder(url=>result(url.searchParams.has('ranges')?{sheets:[]}:meta));await assert.rejects(()=>missing.driver.readWorkbook('token',sheetId),{code:'setup_grid_incomplete'});
  const changing=recorder((url,options,n)=>result(url.searchParams.has('ranges')?grid:n===3?{...meta,properties:{...meta.properties,title:'Changed'}}:meta));await assert.rejects(()=>changing.driver.readWorkbook('token',sheetId),{code:'setup_grid_changed'});
});
test('provider bodies are bounded and errors exclude provider diagnostics or bearer tokens',async()=>{
  const f=recorder(()=>result({privateDiagnostic:'do-not-return'},403));await assert.rejects(()=>f.driver.identity('secret-token'),error=>error.code==='google_permission'&&!error.message.includes('do-not-return')&&!error.message.includes('secret-token'));
  const g=recorder(()=>result({large:'x'.repeat(100)}));await assert.rejects(()=>g.driver.request('token','https://www.googleapis.com/test',{limit:20}),{code:'provider_response_limit'});
});
test('an explicitly empty new workbook is supported without assuming any default tab identity',async()=>{
  const meta={spreadsheetId:sheetId,properties:{title:'Empty',locale:'en_US',timeZone:'Etc/GMT'}};const f=recorder(()=>result(meta));const state=await f.driver.readWorkbook('token',sheetId);assert.deepEqual(state.sheets,[]);assert.deepEqual(state.cells,[]);assert.equal(f.calls.length,2);
});
