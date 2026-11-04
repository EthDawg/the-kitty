import {createRequire} from 'node:module';
import {ImportError,digest,sheetID,validateGate,gateVerified,validDate,dateSerial,cellsForRow,cleanRows,validateState,assertPublicFeedDisabled,assertOpeningContract,assertRowsAfterOpening} from './core.mjs';
import {typedDigest,RECORD_HEADER} from './typed-google.mjs';
import {auditSources} from './source-audit.mjs';
import {verifyBasicCloseChecks} from './basic-close.mjs';
import {validateGoalManifest} from './goals.mjs';
const require=createRequire(import.meta.url);
const cores=()=>({Records:require('../native-core/records.js'),Close:require('../native-core/close.js')});
const clone=x=>structuredClone(x);
const must=(condition,code,message,status=409)=>{if(!condition)throw new ImportError(code,message,status);};
const present=v=>v!==undefined&&v!==null&&v!=='';
const issueError=(code,message,issues)=>{const error=new ImportError(code,message,409);error.issues=issues;return error;};

export function typedFiles(input){
  must(Array.isArray(input)&&input.length>0&&input.length<=20,'file_limit','Choose between one and twenty original files.',400);
  const seen=new Set();
  return input.map(file=>{
    must(file&&typeof file.name==='string'&&file.name.length>0&&file.name.length<=255,'file_metadata','The original filename is missing.',400);
    must((typeof file.text==='string')!==(typeof file.bytesBase64==='string'),'file_encoding','Supply exactly one original text or binary file.',400);
    let bytes;
    if(typeof file.text==='string')bytes=Buffer.from(file.text,'utf8');
    else{must(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.bytesBase64),'file_encoding','The original binary encoding is invalid.',400);bytes=Buffer.from(file.bytesBase64,'base64');must(bytes.toString('base64')===file.bytesBase64,'file_encoding','The original binary encoding is not canonical.',400);}
    must(bytes.length>0&&bytes.length<=5*1024*1024,'file_size','Each original must be nonempty and at most 5 MB.',400);
    const hash=digest(bytes);must(file.id===hash&&(!file.sha256||file.sha256===hash)&&!seen.has(hash),'source_hash_mismatch','Original file identity must match its unique SHA-256.',400);seen.add(hash);
    must(file.byteLength===undefined&&typeof file.text==='string'||file.byteLength===bytes.length,'file_length','The original byte length changed.',400);
    const mime=file.mimeType??(typeof file.text==='string'?'text/csv':'');
    const signatures={'application/pdf':b=>b.subarray(0,5).toString()==='%PDF-','image/png':b=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/jpeg':b=>b[0]===255&&b[1]===216&&b[2]===255};
    if(signatures[mime])must(signatures[mime](bytes),'source_mime','The original file does not match its declared document type.',400);
    else must(['text/csv','text/plain'].includes(mime)&&typeof file.text==='string'&&Buffer.from(bytes.toString('utf8')).equals(bytes),'source_mime','Use a supported original PDF, image or UTF-8 CSV.',400);
    return {id:hash,sha256:hash,name:file.name,mimeType:mime,byteLength:bytes.length,bytes,...(file.text!==undefined?{text:file.text}:{}),...(file.accountId?{accountId:file.accountId,mapping:file.mapping??null}:{}),...(file.openingMinor!==undefined?{openingMinor:file.openingMinor}:{}),...(file.closingMinor!==undefined?{closingMinor:file.closingMinor}:{})};
  });
}
const metadata=file=>{const {bytes,text,...rest}=file;return rest;};
function snapshot(state){const {legacy,baseline,receipts,...rest}=state;return {...clone(rest),baseline:{currency:baseline.currency,people:baseline.people,asOf:baseline.asOf}};}
function result(manifest,importId,status,issues=[]){return {protocolVersion:2,importId,proposalDigest:manifest.proposalDigest,operation:manifest.operation,status,counts:manifest.counts,issues,verificationScope:status==='verified'?(manifest.operation==='close'?'verified_close':'verified_intake'):'unverified'};}
function addSets(records,transactions,state,Records){
  const sets=new Map(),bindings=[];const csvTargets=[];
  const put=(table,row,dateColumns)=>{if(!sets.has(table))sets.set(table,{kind:'append',table,rows:[],dateColumns});sets.get(table).rows.push(row);};
  const ledger=state.tables.ledger.rows.map(r=>r.values);
  let t=Math.max(0,...ledger.map(row=>/^T\d+$/.test(String(row[0]))?Number(String(row[0]).slice(1)):0));
  let v=Math.max(0,...ledger.map(row=>/^V\d+$/.test(String(row[0]))?Number(String(row[0]).slice(1)):0));
  must(Number.isSafeInteger(t+transactions.length)&&Number.isSafeInteger(v+records.length),'id_overflow','Existing record IDs exceed the supported range.');
  for(const row of transactions){const id=`T${String(++t).padStart(4,'0')}`,values=cellsForRow(row,id,state.version);put('ledger',{id,values},state.version===1?[1]:[2,12]);csvTargets.push(values);}
  for(const record of records){
    const f=record.fields;
    if(record.disposition==='already-present'||record.kind==='statement_balance'){bindings.push({recordId:record.recordId,kind:record.kind,identity:Records.identity(record),disposition:record.disposition});continue;}
    let table,id,values,dateColumns;
    if(record.kind==='payslip'){table='payslips';id=`P_${digest([Records.identity(record),Records.sheetFields(record)])}`;dateColumns=[0];values=[dateSerial(f.payDate),f.person,f.employer,Number(f.grossMinor)/100,Number(f.taxMinor)/100,Number(f.superMinor)/100,Number(f.netMinor)/100];}
    else if(state.version===1){table='valuations';id=`V_${digest([Records.identity(record),Records.sheetFields(record)])}`;dateColumns=[0];values=[dateSerial(f.date),f.itemId,Number(f.valueMinor)/100];}
    else{table='ledger';id=`V${String(++v).padStart(4,'0')}`;dateColumns=[2,12];values=[id,'valuation',dateSerial(f.date),f.itemId,'','',Number(f.valueMinor)/100,'','','','','settled',dateSerial(f.date),'','','','','','',f.sourceMethod??''];}
    must(!state.tables[table].rows.some(r=>r.id===id),'record_id_collision','The reserved record identity is already used by another row. Nothing was changed.');
    put(table,{id,values},dateColumns);bindings.push({recordId:record.recordId,kind:record.kind,identity:Records.identity(record),disposition:'append',table,sheetRecordId:id});
  }
  return {writeSets:[...sets.values()],bindings,targetRows:csvTargets};
}
export function expectedTypedState(state,manifest){
  const after=clone(state);
  for(const set of manifest.writeSets){
    if(set.kind==='asof'){after.settingsInputs=after.settingsInputs.map(row=>row[0]==='As-of date'?[row[0],dateSerial(set.date)]:row);after.asOfCell.value=dateSerial(set.date);after.baseline.asOf=set.date;continue;}
    const table=after.tables[set.table];table.rows.push(...set.rows.map(r=>({id:r.id,values:r.values,rowIndex:null})));if(table.metadataColumn!==undefined && set.rows.length)table.metadataHeader=RECORD_HEADER;
  }
  return after;
}
function preserved(before,after){
  // Legacy ID-less rows are a multiset, never a Map keyed by pay/valuation date.
  const counts=new Map();for(const row of after){const key=digest({id:row.id,values:row.values});counts.set(key,(counts.get(key)??0)+1);}
  for(const row of before){const key=digest({id:row.id,values:row.values}),n=counts.get(key)??0;if(n<1)return false;counts.set(key,n-1);}return true;
}
export function verifyTyped(manifest,state,importId,{historical=false}={}){
  const issues=[];const receipt=state.receipts.filter(r=>r.importId===importId);
  if(receipt.length!==1||receipt[0].digest!==manifest.proposalDigest||receipt[0].manifestFile!==importId||receipt[0].ids!==JSON.stringify(manifest.recordRefs))issues.push({code:'receipt_mismatch',message:'The Sheet receipt differs from this approved intake.'});
  if(state.receiptValid===false)issues.push({code:'receipt_schema',message:'The receipt columns changed.'});
  for(const [key,table]of Object.entries(state.tables)){
    const ids=table.rows.map(r=>r.id).filter(Boolean);if(new Set(ids).size!==ids.length)issues.push({code:'duplicate_existing_id',message:`${table.title} contains repeated record IDs.`});
    if(!historical && !preserved(manifest.before.tables[key]?.rows??[],table.rows))issues.push({code:'concurrent_change',message:`Existing ${table.title} input rows changed or disappeared.`});
  }
  for(const set of manifest.writeSets){
    if(set.kind==='asof'){if(state.baseline.asOf!==set.date)issues.push({code:'asof_mismatch',message:'The As-of date does not match the reviewed close.'});continue;}
    for(const expected of set.rows){const found=state.tables[set.table].rows.filter(row=>row.id===expected.id);if(found.length!==1||digest(found[0].values)!==digest(expected.values))issues.push({code:'readback_mismatch',recordId:expected.id,message:'A saved record differs from its approved fields.'});}
  }
  if(!historical){
    const expected=expectedTypedState(manifest.before,manifest);
    for(const [key,table]of Object.entries(state.tables))if(digest([table.header,table.metadataHeader])!==digest([expected.tables[key]?.header,expected.tables[key]?.metadataHeader]))issues.push({code:'sheet_headers_changed',message:'The raw or record-ID headers changed during this operation.'});
    if(state.version!==expected.version||digest(state.configuration)!==digest(expected.configuration)||digest(state.settingsInputs)!==digest(expected.settingsInputs)||state.formulaFingerprint!==expected.formulaFingerprint||state.baseline.currency!==expected.baseline.currency||digest(state.baseline.people)!==digest(expected.baseline.people))issues.push({code:'sheet_invariants_changed',message:'A Sheet input, currency, person, schema or formula changed during this operation.'});
  }
  return result(manifest,importId,issues.length?'conflict':'verified',issues);
}
function unknown(manifest,id,message='The outcome is not confirmed. Check this receipt; this operation will not be repeated automatically.'){return result(manifest,id,'unknown',[{code:'write_outcome_unknown',message}]);}
async function evidence(service,token,sheetId,state,ids){
  const {Records}=cores(),imports=[],issues=[];
  const wanted=ids??state.receipts.map(r=>r.importId);
  for(const id of [...new Set(wanted)]){
    try{
      const manifest=await service.driver.loadManifest(token,id,sheetId);
      if(manifest.contract===3){validateGoalManifest(manifest,state.receipts.find(r=>r.importId===id),state.version);if(ids)throw new Error('not typed intake');continue;}
      if(manifest.contract!==2||manifest.operation!=='ingest'){if(ids)throw new Error('not typed intake');continue;}
      must(verifyTyped(manifest,state,id,{historical:true}).status==='verified','evidence_changed','An evidence receipt or accepted record changed.');
      await service.driver.verifySources(token,manifest);
      for(const record of manifest.records.filter(r=>r.kind!=='statement_balance')){
        const candidates=(record.kind==='payslip'?state.baseline.payslips:state.baseline.valuations).filter(r=>Records.identity(r)===Records.identity(record));
        must(candidates.length===1&&digest(Records.sheetFields(candidates[0]))===digest(Records.sheetFields(record)),'evidence_changed','A financial record differs from its evidence.');
      }
      imports.push({importId:id,proposalDigest:manifest.proposalDigest,receiptVerified:true,records:manifest.records});
    }catch(error){issues.push({code:'evidence_unavailable',importId:id,message:'Some accepted evidence is unavailable or no longer matches the Sheet.'});}
  }
  return {imports,issues};
}
async function checkGate(service,token,sheetId,state,allowed){
  const gate=validateGate(await service.driver.readSheetGate(token,sheetId));if(!gate)return null;
  if(state.legacy&&gateVerified(gate,state.legacy)){must(await service.driver.clearSheetGate(token,sheetId,gate),'sheet_import_gate_unconfirmed','The completed hold could not be cleared.',503);return null;}
  if(gate.importId===allowed)return gate;
  try{const m=await service.driver.loadManifest(token,gate.importId,sheetId);if(m.contract===2){const answer=await finishTyped(service,token,m,state,gate.importId);if(answer.status==='verified')return null;}}catch{}
  throw new ImportError('sheet_import_pending','Another operation for this Sheet needs verification before continuing.',409,await service.recoveryDescriptor(token,sheetId,gate));
}
export async function prepareTyped(service,token,request){
  sheetID(request.sheetId);must(['ingest','close'].includes(request.operation),'operation_invalid','Choose intake or close.',400);
  must(request.proposal&&typeof request.proposal==='object'&&!Array.isArray(request.proposal),'proposal_invalid','The reviewed proposal is missing.',400);
  return service.queue.run(request.sheetId,async()=>{
    const {Records,Close}=cores();await service.driver.authorize(token,request.sheetId);
    const state=await service.driver.readTypedState(token,request.sheetId,request.operation==='close'?request.proposal?.periodEnd:undefined);
    validateState(state.legacy,request.schemaVersion);must(state.version===request.schemaVersion,'schema_changed','The Sheet version changed. Refresh this review.');await checkGate(service,token,request.sheetId,state);assertPublicFeedDisabled(state.legacy);assertOpeningContract(state.legacy);
    let files=[],records=[],rows=[],targetRows=[],writeSets=[],bindings=[],closeReview=null,acceptedEvidence=null;
    if(request.operation==='ingest'){
      files=typedFiles(request.files);const plainFiles=files.map(({bytes,...f})=>f);
      if(request.proposal?.records?.length){const checked=Records.prepare({files:plainFiles,records:request.proposal.records,baseline:state.baseline,review:request.proposal.review});if(!checked.canCommit)throw issueError('source_review_required','The document records need review against the current Sheet.',checked.issues);records=checked.records;}
      const csv=files.filter(f=>typeof f.text==='string'&&f.accountId);
      if(csv.length||request.proposal?.rows?.length){
        state.legacy.provenance=(await service.hydrate(token,request.sheetId,state.legacy)).records;
        rows=request.proposal.rows?.length?cleanRows(request.proposal.rows,csv,state.legacy):[];
        const checked=await auditSources({files:csv,rows,state:state.legacy,proposal:{...request.proposal,review:request.proposal.csvReview??request.proposal.review},allowEmpty:true});
        for(const file of checked.files.filter(f=>f.empty))must(records.some(r=>r.kind==='statement_balance'&&r.fields.accountId===file.accountId),'empty_statement_required','A no-activity export needs reviewed statement opening and closing evidence for its account.');
      }
      must(records.length+rows.length>0,'records_missing','There are no reviewed records to save.',400);
      must(records.length+rows.length<=1000,'record_limit','Review at most 1,000 transaction and document records in one intake.',400);
      ({writeSets,bindings,targetRows}=addSets(records,rows,state,Records));
    }else{
      must(validDate(request.proposal?.periodEnd),'period_invalid','Choose a valid period end.',400);
      must(Array.isArray(request.proposal.evidenceImportIds)&&request.proposal.evidenceImportIds.length<=200,'evidence_invalid','Choose the accepted evidence for this close.',400);
      acceptedEvidence=await evidence(service,token,request.sheetId,state,request.proposal.evidenceImportIds);
      must(!acceptedEvidence.issues.length,'evidence_unavailable','Resolve unavailable evidence before closing this period.');
      closeReview=Close.prepare({periodEnd:request.proposal.periodEnd,baseline:state.baseline,evidence:{imports:acceptedEvidence.imports},review:request.proposal.review});
      if(!closeReview.canClose)throw issueError('close_review_required','This period has unresolved reconciliation checks.',closeReview.issues);
      writeSets=[{kind:'asof',date:request.proposal.periodEnd}];
    }
    const counts={new:writeSets.reduce((n,s)=>n+(s.rows?.length??0),0),evidence:records.filter(r=>r.kind==='statement_balance').length,transaction:rows.length,payslip:records.filter(r=>r.kind==='payslip').length,valuation:records.filter(r=>r.kind==='valuation').length};
    const recordRefs=[...targetRows.map(r=>({kind:'transaction',recordId:r[0]})),...bindings.map(({identity,...r})=>r),...(request.operation==='close'?[{kind:'close',periodEnd:request.proposal.periodEnd}]:[])];
    const manifest={contract:2,sheetId:request.sheetId,schemaVersion:state.version,operation:request.operation,createdAt:service.now(),intentFileId:await service.driver.reserveID(token),baseline:typedDigest(state),before:snapshot(state),records,rows,targetRows,writeSets,bindings,recordRefs,counts,
      sources:files.map(metadata),sourceFiles:[],review:request.proposal.review??{},csvReview:request.proposal.csvReview??{},reviewDecisions:request.proposal.decisions??{},close:request.operation==='close'?{periodEnd:request.proposal.periodEnd,evidenceImportIds:request.proposal.evidenceImportIds,evidenceDigests:acceptedEvidence.imports.map(x=>[x.importId,x.proposalDigest]),checks:closeReview.checks}:null};
    for(const file of files)manifest.sourceFiles.push(await service.driver.storeSource(token,request.sheetId,file));
    manifest.proposalDigest=digest(manifest);const importId=await service.driver.storeManifest(token,manifest);
    return result(manifest,importId,'proposed');
  });
}
async function postClose(service,token,manifest,state){
  const accepted=await evidence(service,token,manifest.sheetId,state,manifest.close.evidenceImportIds);
  if(accepted.issues.length)return accepted.issues;
  // Reconcile the same immutable period with fresh raw rows. Actual As-of is
  // independently checked by verifyTyped; substituting the original boundary
  // here is necessary because this is postflight, not a second month close.
  const checked=cores().Close.prepare({periodEnd:manifest.close.periodEnd,baseline:{...state.baseline,asOf:manifest.before.baseline.asOf},evidence:{imports:accepted.imports},review:manifest.review});
  const issues=[...(checked.canClose?[]:checked.issues),...verifyBasicCloseChecks(state)];
  const checks=(state.actualChecks??state.baseline.checks).filter(c=>c.type==='Close');
  if(!checks.length||checks.some(c=>c.status!=='OK'||c.items===null)||state.closeMissing!==0)issues.push({code:'close_sheet_check_failed',message:'The actual Sheet close checks have not confirmed this period.'});
  for(const expected of state.baseline.projectedBalances.filter(x=>x.date===manifest.close.periodEnd)){const account=state.baseline.accounts.find(a=>a.id===expected.accountId);if(account?.balanceMinor!==expected.amountMinor)issues.push({code:'close_balance_readback',recordId:expected.accountId,message:'The calculated Sheet balance differs from the verified period projection.'});}
  return issues;
}
export async function finishTyped(service,token,manifest,state,importId){
  if(!state.receipts.some(r=>r.importId===importId))return unknown(manifest,importId);
  const verified=verifyTyped(manifest,state,importId);if(verified.status!=='verified')return verified;
  try{
    if(manifest.operation==='close'){const issues=await postClose(service,token,manifest,state);if(issues.length)return result(manifest,importId,'conflict',issues);}
    const gate=validateGate(await service.driver.readSheetGate(token,manifest.sheetId));
    if(gate?.importId===importId){must(gate.proposalDigest===manifest.proposalDigest&&gate.rowsHash===digest(manifest.recordRefs)&&gate.stateHash===typedDigest(expectedTypedState(manifest.before,manifest))&&gate.version===manifest.schemaVersion,'sheet_import_gate_invalid','The shared hold changed.');if(!await service.driver.clearSheetGate(token,manifest.sheetId,gate))return unknown(manifest,importId,'The records are verified, but their shared hold is not cleared. Check again.');}
    return verified;
  }catch{return unknown(manifest,importId);}
}
export async function lifecycleTyped(service,token,manifest,importId,request,action){
  let state=await service.driver.readTypedState(token,request.sheetId,manifest.close?.periodEnd);
  if(state.receipts.some(r=>r.importId===importId))return finishTyped(service,token,manifest,state,importId);
  const intent=await service.driver.findIntent(token,manifest.intentFileId,request.sheetId);
  const cancelled=async()=>{try{const gate=await service.driver.readSheetGate(token,request.sheetId);if(gate?.importId===importId){if(gate.proposalDigest!==manifest.proposalDigest||!await service.driver.clearSheetGate(token,request.sheetId,gate))return unknown(manifest,importId);}return result(manifest,importId,'cancelled');}catch{return unknown(manifest,importId);}};
  if(intent?.status==='cancelled')return cancelled();if(intent)return unknown(manifest,importId);
  if(action==='status')return result(manifest,importId,typedDigest(state)===manifest.baseline?'proposed':'stale');
  if(action==='cancel'){
    try{await service.driver.storeIntent(token,manifest.intentFileId,importId,request.sheetId,{status:'cancelled',proposalDigest:manifest.proposalDigest,startedAt:service.now()});return cancelled();}
    catch{const observed=await service.driver.findIntent(token,manifest.intentFileId,request.sheetId);return observed?.status==='cancelled'?cancelled():unknown(manifest,importId);}
  }
  await checkGate(service,token,request.sheetId,state,importId);
  assertPublicFeedDisabled(state.legacy);
  assertRowsAfterOpening(manifest.rows??[],state.legacy);
  must(typedDigest(state)===manifest.baseline,'stale_proposal','The Sheet changed since this review. Cancel and refresh it.');
  await service.driver.verifySources(token,manifest);
  if(manifest.operation==='close'){
    const accepted=await evidence(service,token,request.sheetId,state,manifest.close.evidenceImportIds);
    must(!accepted.issues.length&&digest(accepted.imports.map(x=>[x.importId,x.proposalDigest]))===digest(manifest.close.evidenceDigests),'evidence_changed','Close evidence changed since review.');
    const checked=cores().Close.prepare({periodEnd:manifest.close.periodEnd,baseline:state.baseline,evidence:{imports:accepted.imports},review:manifest.review});if(!checked.canClose)throw issueError('close_review_required','Reconciliation changed since review.',checked.issues);
  }
  const gate={importId,proposalDigest:manifest.proposalDigest,rowsHash:digest(manifest.recordRefs),stateHash:typedDigest(expectedTypedState(state,manifest)),version:state.version};
  try{await service.driver.writeSheetGate(token,request.sheetId,gate);must(digest(await service.driver.readSheetGate(token,request.sheetId))===digest(gate),'sheet_import_gate_unconfirmed','The shared hold is not confirmed.');await service.driver.storeIntent(token,manifest.intentFileId,importId,request.sheetId,{status:'writing',proposalDigest:manifest.proposalDigest,startedAt:service.now()});}
  catch{return unknown(manifest,importId);}
  try{await service.driver.atomicTypedInsert(token,request.sheetId,state,manifest,importId,service.now());}catch{}
  // A durable intent exists. There is deliberately no second financial attempt.
  try{state=await service.driver.readTypedState(token,request.sheetId,manifest.close?.periodEnd);return finishTyped(service,token,manifest,state,importId);}catch{return unknown(manifest,importId);}
}
export async function provenanceTyped(service,token,request){
  sheetID(request.sheetId);if(request.periodEnd!==undefined)must(validDate(request.periodEnd),'period_invalid','Choose a valid period end.',400);
  return service.queue.run(request.sheetId,async()=>{
    await service.driver.authorize(token,request.sheetId);const state=await service.driver.readTypedState(token,request.sheetId,request.periodEnd);await checkGate(service,token,request.sheetId,state);
    const accepted=await evidence(service,token,request.sheetId,state);
    return {sheetId:request.sheetId,schemaVersion:state.version,protocolVersion:2,publicFeedEnabled:state.legacy.publicFeedEnabled===true,baseline:state.baseline,records:accepted.imports.flatMap(x=>x.records),evidence:{imports:accepted.imports},evidenceImportIds:accepted.imports.map(x=>x.importId),issues:accepted.issues,revisionDigest:typedDigest(state)};
  });
}
