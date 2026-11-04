import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from './server.mjs';
import {createImportHandler} from '../import-service/server.mjs';
import {createAskHandler} from '../ai-service/server.mjs';

async function serverFor(t,options={}) {
 const server=createServer(options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return `http://127.0.0.1:${server.address().port}`;
}
const headers={authorization:'Bearer synthetic-token','content-type':'application/json'};

test('one gateway dispatches import and Ask bodies intact to only their own service',async t=>{
 const calls=[];const base=await serverFor(t,{
  importService:{prepare:async(token,body)=>{calls.push(['import',token,body]);return {status:'proposed',importId:'synthetic_123456'};}},
  askService:{preview:async(token,body)=>{calls.push(['preview',token,body]);return {factsHash:'synthetic-hash'};},ask:async(token,body)=>{calls.push(['ask',token,body]);return {answer:'Synthetic answer'};}}
 });
 const importBody={sheetId:'synthetic_sheet',files:[{text:'a'.repeat(18000)}],proposal:{rows:[]}};
 const previewBody={sheetId:'synthetic_sheet',provider:'openai',question:'Show cash',scope:'overview'};
 const askBody={...previewBody,consent:{approved:true},previewToken:'synthetic'};
 for(const[path,body]of [['/v1/imports/prepare',importBody],['/v1/ask/preview',previewBody],['/v1/ask',askBody]]){
  const response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);await response.json();
 }
 assert.deepEqual(calls,[['import','synthetic-token',importBody],['preview','synthetic-token',previewBody],['ask','synthetic-token',askBody]]);
});
test('gateway owns health and unknown routes without calling financial services',async t=>{
 const never=()=>{throw new Error('must not run');};const base=await serverFor(t,{importService:{prepare:never},askService:{capabilities:never}});
 assert.deepEqual(await(await fetch(base+'/health')).json(),{status:'ok'});
 for(const path of ['/missing','/v1/ask/unknown','/v1/imports/unknown'])assert.equal((await fetch(base+path)).status,404);
});
test('gateway preserves separate authentication and browser-origin guards',async t=>{
 let calls=0;const invoke=()=>{calls++;return {};};const base=await serverFor(t,{importService:{prepare:invoke},askService:{preview:invoke}});
 for(const path of ['/v1/imports/prepare','/v1/ask/preview']){
  assert.equal((await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(base+path,{method:'POST',headers:{...headers,origin:'https://untrusted.example'},body:'{}'})).status,403);
 }
 assert.equal(calls,0);
});
test('handlers decline other routes without reading or touching the request body',async()=>{
 const request=url=>({url,method:'POST',[Symbol.asyncIterator](){throw new Error('Body was consumed');}});
 assert.equal(await createImportHandler({service:{}})(request('/v1/ask/preview'),{}),false);
 assert.equal(await createAskHandler({service:{}})(request('/v1/imports/prepare'),{}),false);
});
test('gateway forwards provenance and cancellation with exact Sheet and import binding',async t=>{
 const calls=[];const base=await serverFor(t,{importService:{provenance:async(token,body)=>{calls.push(['provenance',token,body]);return {baseline:{existing:[]}};},cancel:async(token,id,body)=>{calls.push(['cancel',token,id,body]);return {status:'cancelled'};}},askService:{}});
 assert.equal((await fetch(base+'/v1/imports/provenance?sheetId=synthetic_sheet',{headers})).status,200);
 assert.equal((await fetch(base+'/v1/imports/manifest_123456/cancel',{method:'POST',headers,body:'{"sheetId":"synthetic_sheet"}'})).status,200);
 assert.deepEqual(calls,[['provenance','synthetic-token',{sheetId:'synthetic_sheet'}],['cancel','synthetic-token','manifest_123456',{sheetId:'synthetic_sheet'}]]);
});
