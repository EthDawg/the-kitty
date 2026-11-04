import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {AskService,AskError} from './core.mjs';
import {GoogleFactsReader} from './google-facts.mjs';
import {providersFromEnvironment} from './providers.mjs';
import {createAskHandler,createServer} from './server.mjs';

const token='google-fixture-bearer-NOT-A-REAL-TOKEN';
const sheetId='synthetic_sheet_identity_123456';
const request={sheetId,provider:'openai',question:'Explain our cash.',scope:'overview'};
const snapshot=()=>({asOf:'2027-01-31',facts:[{id:'cash',label:'Cash and offset',value:'99388.43',kind:'money',currency:'AUD',period:'31 Jan 2027',range:'Metrics!A2:H2'}],limitations:['Source statements were not inspected.']});
function harness(options={}){
  let calls=0,reads=0,received;
  const reader={async read(given,id,scope){reads++;assert.equal(given,token);assert.equal(id,sheetId);return options.snapshot?.()??snapshot();}};
  const provider={async generate(input){calls++;received=input;return options.answer??{answer:'Recorded cash is 99388.43 AUD. This is not necessarily available to spend.',evidenceIds:['cash'],limitations:['Completeness is unknown.']};}};
  const service=new AskService({reader,providers:{openai:provider,claude:provider},previewSecret:'fixture-secret-at-least-thirty-two-bytes',now:options.now??(()=>100000)});
  return {service,get calls(){return calls;},get reads(){return reads;},get received(){return received;}};
}
const approved=(preview,changes={})=>({...request,previewToken:preview.previewToken,consent:{approved:true,provider:'openai',factsHash:preview.factsHash,summaryHash:preview.summaryHash},...changes});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

test('preview reads Google but makes no model call; answer reauthorises and exposes only approved facts',async()=>{
  const h=harness(),preview=await h.service.preview(token,request);
  assert.equal(h.reads,1);assert.equal(h.calls,0);
  assert.match(preview.providerSummary,/Shared with OpenAI/);
  assert.match(preview.providerSummary,/99388\.43 AUD/);
  const result=await h.service.ask(token,approved(preview));
  assert.equal(h.reads,2);assert.equal(h.calls,1);
  assert.equal(result.evidence[0].id,'cash');assert.match(result.evidence[0].url,/Metrics/);
  const sent=JSON.stringify(h.received);
  assert.ok(!sent.includes(token));assert.ok(!sent.includes(sheetId));assert.ok(!sent.includes('Metrics!'));
  assert.equal(Object.hasOwn(h.received,'tools'),false);
});
test('explicit consent binds approved provider, exact facts and sharing summary',async()=>{
  for(const consent of [null,{approved:false},{approved:true,provider:'claude'},{approved:true,provider:'openai',factsHash:'wrong',summaryHash:'wrong'}]){
    const h=harness(),preview=await h.service.preview(token,request);
    await assert.rejects(h.service.ask(token,approved(preview,{consent})),e=>e.code==='consent_required');assert.equal(h.calls,0);
  }
});
test('question, provider, scope and bearer changes invalidate the preview',async()=>{
  for(const changed of [{question:'Another question'},{provider:'claude'},{scope:'goals'}]){
    const h=harness(),preview=await h.service.preview(token,request);
    await assert.rejects(h.service.ask(token,approved(preview,changed)),e=>e.code==='preview_changed');assert.equal(h.calls,0);
  }
  const h=harness(),preview=await h.service.preview(token,request);
  await assert.rejects(h.service.ask('different-google-token',approved(preview)),e=>e.code==='preview_changed');assert.equal(h.calls,0);
});
test('tampered signatures and expired consent never call the provider',async()=>{
  let now=100000;const h=harness({now:()=>now}),preview=await h.service.preview(token,request);
  await assert.rejects(h.service.ask(token,approved(preview,{previewToken:preview.previewToken+'x'})),e=>e.code==='invalid_preview');
  now+=300001;await assert.rejects(h.service.ask(token,approved(preview)),e=>e.code==='preview_expired');assert.equal(h.calls,0);
});
test('changed Sheet facts require a new human preview',async()=>{
  let changed=false;const h=harness({snapshot:()=>{const s=snapshot();if(changed)s.facts[0].value='100000.00';return s;}});
  const preview=await h.service.preview(token,request);changed=true;
  await assert.rejects(h.service.ask(token,approved(preview)),e=>e.code==='facts_changed');assert.equal(h.calls,0);
});
test('client financial context and forged action grants never reach provider or write tools',async()=>{
  const h=harness();const injected={...request,context:'SECRET CLIENT RECORD',tools:[{name:'write_sheet'}],allowWrite:true};
  const preview=await h.service.preview(token,injected);
  await h.service.ask(token,{...approved(preview),context:injected.context,tools:injected.tools,allowWrite:true});
  const sent=JSON.stringify(h.received);
  assert.ok(!sent.includes('SECRET CLIENT RECORD'));assert.ok(!sent.includes('write_sheet'));
  assert.deepEqual(Object.keys(h.received).sort(),['input','schema','system']);
});
test('unapproved citations, invented numbers and false action claims fail verification',async()=>{
  for(const answer of [
    {answer:'Cash is 1.00 AUD.',evidenceIds:['cash'],limitations:[]},
    {answer:'Your cash is recorded.',evidenceIds:['secret_other_sheet'],limitations:[]},
    {answer:'I have deleted the duplicate.',evidenceIds:[],limitations:[]},
    {answer:'Visit https://unapproved.example',evidenceIds:[],limitations:[]},
    {answer:'Cash is 99388.43 AUD.',evidenceIds:[],limitations:[]},
    {answer:'Explanation.',evidenceIds:[],limitations:[],action:{write:true}}
  ]){
    const h=harness({answer}),preview=await h.service.preview(token,request);
    await assert.rejects(h.service.ask(token,approved(preview)),e=>e.code==='answer_unverified');
  }
});
test('missing provider configuration is explicit; nothing silently routes to another AI',async()=>{
  const h=harness();h.service.providers={};
  assert.deepEqual(h.service.capabilities().providers,[]);
  await assert.rejects(h.service.preview(token,request),e=>e.code==='provider_unavailable');assert.equal(h.reads,0);
});

const fixtureGrids=[
  [['Key','Value'],['sheet_version',1],['currency','AUD']],
  [['Setting','Value'],['As-of date','2027-01-31']],
  [['Metric ID','Metric','Value','Unit','Period','Comparison value','Compared with','Better when'],['networth.cash','Cash and offset',99388.43,'AUD','31 Jan 2027',80078.48,'12 months earlier','Higher']],
  [['Goal','Target amount','Target date','Linked account','Balance now'],['Holiday',12000,'2027-03-31','A',12090.25]]
];
test('Google fact reader uses only fixed authenticated GETs and validates ordered schema',async()=>{
  const calls=[];const reader=new GoogleFactsReader({fetchImpl:async(url,init)=>{calls.push({url,init});return json({valueRanges:fixtureGrids.map(values=>({values}))});}});
  const result=await reader.read(token,sheetId,{scope:'overview'});
  assert.equal(calls.length,1);assert.equal(calls[0].init.method,'GET');
  assert.equal(calls[0].init.headers.Authorization,`Bearer ${token}`);
  assert.ok(calls[0].url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/'));
  assert.equal(result.facts.find(f=>f.id==='cash')?.value,undefined);
  assert.equal(result.facts.find(f=>f.id==='networth.cash').value,'99388.43');
  const bad=structuredClone(fixtureGrids);[bad[2][0][1],bad[2][0][2]]=[bad[2][0][2],bad[2][0][1]];
  reader.fetch=async()=>json({valueRanges:bad.map(values=>({values}))});
  await assert.rejects(reader.read(token,sheetId,{scope:'overview'}),e=>e.code==='schema_mismatch');
});
test('Google denies access before provider use and does not leak upstream error body',async()=>{
  const reader=new GoogleFactsReader({fetchImpl:async()=>json({secret:'upstream diagnostic private information'},403)});
  await assert.rejects(reader.read(token,sheetId),e=>e.code==='sheet_permission'&&!e.message.includes('private'));
});
test('transaction consent and provider payload contain only the selected transaction, with no headline or goal reads',async()=>{
  const fetched=[];
  const grids={
    'Kitty!A1:C':fixtureGrids[0], 'Settings!A1:C':fixtureGrids[1],
    'Transactions!A1:J':[
      ['Txn ID','Date','Account ID','Bank description','Merchant','Amount','Category ID','Person','Receipt held','Note'],
      ['T1','2027-01-31','A','COFFEE ORIGINAL','Coffee',-4.5,'FOOD','Joint','',''],
      ['T2','2027-01-30','A','PRIVATE OTHER MERCHANT','Other',-999,'FOOD','Joint','','']
    ],
    'Categories!A1:D':[['Category ID','Category','Group','Flow'],['FOOD','Food','Essentials','Expense']]
  };
  const reader=new GoogleFactsReader({fetchImpl:async(url)=>{
    const ranges=new URL(url).searchParams.getAll('ranges');fetched.push(...ranges);
    assert.ok(ranges.every(r=>Object.hasOwn(grids,r)),'A transaction question must not request Metrics or Goals.');
    return json({valueRanges:ranges.map(r=>({values:grids[r]}))});
  }});
  let sent;
  const service=new AskService({reader,providers:{openai:{generate:async value=>{
    sent=value.input;return {answer:'The recorded transaction is -4.50 AUD.',evidenceIds:['transaction.amount'],limitations:[]};
  }}},previewSecret:'fixture-secret-at-least-thirty-two-bytes'});
  const selected={...request,question:'Explain this transaction.',scope:'transaction',transactionId:'T1'};
  const preview=await service.preview(token,selected);
  assert.ok(preview.facts.every(f=>f.id.startsWith('transaction.')));
  await service.ask(token,{...approved(preview),...selected});
  assert.deepEqual(sent.limitations,preview.limitations,'All source limitations sent to AI must be visible in the preview.');
  assert.ok(!JSON.stringify(sent).includes('PRIVATE OTHER MERCHANT'));
  assert.ok(!JSON.stringify(sent).includes('99388.43'));
  assert.ok(!JSON.stringify(sent).includes('12090.25'));
  assert.ok(!fetched.includes('Metrics!A1:H'));assert.ok(!fetched.includes('Goals!A1:J'));
});
test('goal scope reads and sends goals without household headline metrics',async()=>{
  const ranges=[];const grids={'Kitty!A1:C':fixtureGrids[0],'Settings!A1:C':fixtureGrids[1],'Goals!A1:J':fixtureGrids[3]};
  const reader=new GoogleFactsReader({fetchImpl:async(url)=>{
    const requested=new URL(url).searchParams.getAll('ranges');ranges.push(...requested);
    assert.ok(requested.every(r=>Object.hasOwn(grids,r)));
    return json({valueRanges:requested.map(r=>({values:grids[r]}))});
  }});
  const facts=await reader.read(token,sheetId,{scope:'goals'});
  assert.ok(facts.facts.every(f=>f.id.startsWith('goal.')));
  assert.ok(!ranges.includes('Metrics!A1:H'));
});

test('OpenAI and Claude adapters keep credentials in headers, use no tools, and validate provider envelopes',async()=>{
  const calls=[];
  const env={OPENAI_API_KEY:'synthetic-openai-key',ANTHROPIC_API_KEY:'synthetic-claude-key',KITTY_OPENAI_MODEL:'configured-openai-model',KITTY_CLAUDE_MODEL:'configured-claude-model'};
  const output={answer:'Recorded cash is 99388.43 AUD.',evidenceIds:['cash'],limitations:[]};
  const fetchImpl=async(url,init)=>{calls.push({url,init});return url.includes('openai')?json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]}):json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}]});};
  const providers=providersFromEnvironment({env,fetchImpl});
  for(const id of ['openai','claude'])assert.deepEqual(await providers[id].generate({system:'read only',input:{question:'Explain'},schema:{type:'object'}}),output);
  assert.equal(JSON.parse(calls[0].init.body).store,false);
  for(const {init}of calls){assert.ok(!init.body.includes('synthetic-openai-key'));assert.ok(!init.body.includes('synthetic-claude-key'));assert.ok(!Object.hasOwn(JSON.parse(init.body),'tools'));assert.equal(init.redirect,'error');}
  const missing=providersFromEnvironment({env:{OPENAI_API_KEY:'present-but-no-model'},fetchImpl});assert.deepEqual(Object.keys(missing),[]);
});
test('provider timeout and diagnostic messages never become an answer or leak a key',async()=>{
  const providers=providersFromEnvironment({env:{OPENAI_API_KEY:'never-echo-this-key',KITTY_OPENAI_MODEL:'configured'},fetchImpl:async()=>{throw new Error('never-echo-this-key');}});
  await assert.rejects(providers.openai.generate({system:'',input:{},schema:{}}),e=>e.code==='ai_unavailable'&&!e.message.includes('never-echo'));
});

async function invoke(handler,{path='/v1/ask/preview',body=request,tokenValue=token,origin,method='POST'}={}){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.url=path;req.method=method;
  req.headers={'content-type':'application/json',authorization:`Bearer ${tokenValue}`,...(origin?{origin}:{})};req.socket={remoteAddress:'fixture-address'};
  const headers={};let status,payload;
  const res={setHeader:(k,v)=>{headers[k]=v;},writeHead:s=>{status=s;},end:value=>{payload=JSON.parse(value);}};
  const handled=await handler(req,res);return {handled,status,payload,headers};
}
test('HTTP handler has no logging, refuses browser origins, bounds bodies and hides unexpected errors',async()=>{
  const log=[];const oldLog=console.log,oldError=console.error;console.log=(...args)=>log.push(args);console.error=(...args)=>log.push(args);
  try{
    const handler=createAskHandler({service:harness().service});
    const result=await invoke(handler);assert.equal(result.status,200);assert.equal(result.headers['Cache-Control'],'no-store');
    assert.equal((await invoke(handler,{origin:'https://arbitrary.example'})).status,403);
    assert.equal((await invoke(handler,{body:{...request,question:'x'.repeat(20000)}})).status,413);
    const failed=createAskHandler({service:{preview:async()=>{throw new Error('SECRET-google-token');}}});
    const response=await invoke(failed);assert.equal(response.status,500);assert.ok(!JSON.stringify(response).includes('SECRET'));
    assert.deepEqual(log,[]);
  }finally{console.log=oldLog;console.error=oldError;}
});
test('createServer is exportable without listening',()=>{const server=createServer({service:harness().service});assert.equal(server.listening,false);server.close();});
