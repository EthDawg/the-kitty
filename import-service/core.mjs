import { createHash } from 'node:crypto';
import {prepareTyped,lifecycleTyped,provenanceTyped} from './typed.mjs';
import {prepareGoal,lifecycleGoal,validateGoalManifest} from './goals.mjs';

export class ImportError extends Error {
  constructor(code, message, status = 400, recovery) { super(message); this.code = code; this.status = status; if(recovery)this.recovery=recovery; }
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const RECEIPT_TAB = '_KittyImports';
export const RECEIPT_HEADERS = ['Import ID', 'Proposal SHA256', 'Written at', 'Row IDs', 'Manifest file'];
export const HEADERS = {
  1: ['Txn ID','Date','Account ID','Bank description','Merchant','Amount','Category ID','Person','Receipt held','Note'],
  2: ['Entry ID','Kind','Settled at','Account ID','Raw text','Description','Amount','Category ID','Person','Receipt held','Note','Status','Created at','Transfer ID','Transfer account','Foreign amount','Foreign currency','Units','Unit price','Source']
};
const normalHeader = x => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const assert = (test, code, message, status) => { if (!test) throw new ImportError(code, message, status); };
export const sheetID = id => { assert(typeof id === 'string' && /^[a-zA-Z0-9_-]{12,200}$/.test(id), 'invalid_sheet', 'Choose a valid Kitty spreadsheet.'); return id; };
export const validDate = date => { const time=Date.parse(`${date}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === date; };
export const dateSerial = date => (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899,11,30))/86400000;
export const isoDate = date => typeof date === 'number' ? new Date(Date.UTC(1899,11,30) + Math.round(date)*86400000).toISOString().slice(0,10) : String(date ?? '');
export function validateState(state, requestedVersion) {
  assert([1,2].includes(state.version), 'unsupported_schema', 'This Sheet version is not supported.');
  if (requestedVersion !== undefined) assert(requestedVersion === state.version, 'schema_changed', 'The Sheet version changed. Refresh it before importing.',409);
  const width = HEADERS[state.version].length;
  assert(state.header?.length >= width && HEADERS[state.version].every((h,i) => normalHeader(h) === normalHeader(state.header[i])), 'schema_mismatch', `The ${state.version === 1 ? 'Transactions' : 'Entries'} columns do not match the Kitty contract.`);
  assert(Array.isArray(state.rows) && Array.isArray(state.accounts) && Array.isArray(state.categories), 'invalid_sheet', 'Required Sheet tables are missing.');
  const ids = new Set();
  for (const row of state.rows) {
    assert(row[0], 'blank_id', 'An existing row has data without an ID. Resolve it in the Sheet before importing.');
    assert(!ids.has(String(row[0])), 'duplicate_existing_id', 'The Sheet contains repeated record IDs. Resolve them before importing.');
    ids.add(String(row[0]));
  }
  assert(!state.inputFormulas?.length, 'formula_in_inputs', 'A writable input column contains a formula. Nothing was changed.');
  assert(state.receiptValid !== false, 'receipt_schema', 'The import receipt tab has been changed. Nothing was written.');
}
// This is a current write precondition, not a historical receipt invariant.
// Keep recovery available even if publishing was enabled after an earlier write.
export function assertPublicFeedDisabled(state) {
  assert(state.publicFeedEnabled!==true,'public_feed_enabled','The Kitty public_feed setting enables this Sheet\'s known public JSON feed. Turn that setting off on the Kitty tab, then refresh before importing or closing a month.',409);
}
export function assertOpeningContract(state) {
  assert(!state.openingContract?.error,'opening_anchor_invalid',`${state.openingContract?.error??''} Restore the reviewed opening settings before importing; existing import status and cancellation remain available.`,409);
}
export function assertRowsAfterOpening(rows,state) {
  assertOpeningContract(state);
  const accounts=new Map(state.accounts.map(account=>[account.id,account]));
  for(const row of rows){
    assert(row && typeof row==='object','invalid_row','An import row is missing.');
    const account=accounts.get(row.accountId);
    if(!account || !Object.hasOwn(account,'openingDate'))continue;
    assert(validDate(account.openingDate),'opening_anchor_invalid','The selected account has no valid opening anchor. Restore its reviewed opening settings before importing.',409);
    assert(typeof row.date==='string' && validDate(row.date),'invalid_date','An import row needs a valid YYYY-MM-DD date.');
    assert(row.date>account.openingDate,'transaction_before_opening',`${account.name||account.id}: the transaction dated ${row.date} is on or before the opening balance date ${account.openingDate}. Export transactions from the following day; this activity is already represented by the opening balance.`,409);
  }
}
export const stateDigest = state => digest({version:state.version,header:state.header,rows:state.rows,accounts:state.accounts,categories:state.categories,currency:state.currency??'AUD',people:state.people??null,formulaFingerprint:state.formulaFingerprint??null});
export const GATE_PROPERTIES = {importId:'kittyActiveImport',proposalDigest:'kittyActiveDigest',rowsHash:'kittyActiveRowsHash',stateHash:'kittyActiveStateHash',version:'kittyActiveVersion'};
export function validateGate(gate) {
  if(gate===null)return null;
  assert(gate && /^[A-Za-z0-9_-]{10,100}$/.test(gate.importId??'') && [1,2].includes(gate.version) && ['proposalDigest','rowsHash','stateHash'].every(k=>/^[a-f0-9]{64}$/.test(gate[k]??'')),'sheet_import_gate_invalid','The Sheet has an incomplete or changed import hold. Check the original import before importing again.',409);
  return gate;
}
export const gateFor=(manifest,importId,state)=>({importId,proposalDigest:manifest.proposalDigest,rowsHash:digest(manifest.targetRows),stateHash:stateDigest({...state,rows:[...manifest.baselineRows,...manifest.targetRows]}),version:manifest.schemaVersion});
export function gateVerified(gate,state,manifest) {
  try{validateState(state,gate.version);}catch{return false;}
  let checkedState=state;
  if(manifest) {
    if(manifest.schemaVersion!==gate.version || manifest.proposalDigest!==gate.proposalDigest || digest(manifest.targetRows)!==gate.rowsHash)return false;
    // The immutable manifest names the original/approved rows. Later unique rows do
    // not invalidate those facts; all non-row invariants remain in the state hash.
    const expectedIds=new Set([...manifest.baselineRows,...manifest.targetRows].map(row=>row[0]));
    checkedState={...state,rows:state.rows.filter(row=>expectedIds.has(row[0]))};
  }
  if(stateDigest(checkedState)!==gate.stateHash)return false;
  const receipts=state.receipts.filter(r=>r.importId===gate.importId);
  if(receipts.length!==1 || receipts[0].digest!==gate.proposalDigest || receipts[0].manifestFile!==gate.importId)return false;
  let ids;try{ids=JSON.parse(receipts[0].ids);}catch{return false;}
  if(!Array.isArray(ids) || !ids.length || ids.length>1000 || new Set(ids).size!==ids.length || !ids.every(id=>typeof id==='string'))return false;
  const rows=[];
  for(const id of ids){const found=state.rows.filter(r=>r[0]===id);if(found.length!==1)return false;rows.push(pad(found[0],HEADERS[gate.version].length));}
  return digest(rows)===gate.rowsHash;
}
export const rowFingerprint = (date,account,description,amountMinor) => JSON.stringify([date,account,description,amountMinor]);
function text(value, name, max = 2000) {
  assert(typeof value === 'string' && value.length <= max, 'invalid_row', `Invalid ${name}.`);
  return value;
}
export function cleanRows(rows, files, state) {
  assert(Array.isArray(rows) && rows.length > 0 && rows.length <= 1000, 'row_limit', 'An import must contain between 1 and 1,000 new rows.');
  const accounts = new Set(state.accounts.map(x=>x.id));
  const categories = new Set(state.categories.map(x=>x.id));
  const fileIds = new Set(files.map(x=>x.id));
  const sourceRows = new Set();
  assertRowsAfterOpening(rows,state);
  return rows.map((row,index)=> {
    assert(row && typeof row === 'object', 'invalid_row', 'An import row is missing.');
    assert(typeof row.date === 'string' && validDate(row.date), 'invalid_date', `Row ${index+1} needs a valid YYYY-MM-DD date.`);
    assert(accounts.has(row.accountId), 'unknown_account', `Row ${index+1} refers to an account not in this Sheet.`);
    assert(categories.has(row.categoryId), 'unknown_category', `Row ${index+1} needs an existing Sheet category.`);
    assert(typeof row.amountMinor === 'string' && /^-?(?:0|[1-9]\d*)$/.test(row.amountMinor) && row.amountMinor !== '-0', 'invalid_amount', `Row ${index+1} has an invalid amount.`);
    // Legacy Sheets stores doubles. This limit keeps every cent exactly recoverable.
    assert(BigInt(row.amountMinor) <= 99999999999999n && BigInt(row.amountMinor) >= -99999999999999n, 'amount_range', 'This amount exceeds the supported Sheet precision.');
    assert(!row.status || ['posted','settled'].includes(row.status), 'pending_row', 'Pending transactions cannot be committed.');
    assert(!row.reviewState || ['ready','resolved','approved','confirmed'].includes(row.reviewState), 'needs_review', 'Resolve the highlighted rows before saving.');
    assert(!row.transferId && !row.transferAccountId,'transfer_link_unsupported','Transfer pairing must be reviewed separately; arbitrary transfer links cannot be imported.');
    const rawRefs = row.sourceRefs?.length ? row.sourceRefs : [{sourceId:row.sourceId,sourceRow:row.sourceRow}];
    const refs = rawRefs.map(ref=>({sourceId:ref.sourceId ?? ref.fileId,sourceRow:ref.sourceRow ?? ref.row}));
    assert(refs.length <= 50, 'invalid_source', 'Too many source references on a row.');
    for (const ref of refs) {
      assert(fileIds.has(ref.sourceId) && Number.isInteger(ref.sourceRow) && ref.sourceRow >= 2, 'invalid_source', 'Each transaction must point to an original file row.');
      const key = `${ref.sourceId}:${ref.sourceRow}`;
      assert(!sourceRows.has(key), 'repeated_source_row', 'A source row was proposed more than once.');
      sourceRows.add(key);
    }
    return {proposalId:text(row.id??'','proposal id',200),originalProposalId:text(row.originalProposalID??'','original proposal id',200),identity:text(row.identity??'','source identity',10000),providerId:text(row.providerId??'','provider id',500),distinctSource:row.distinctSource===true,decision:row.decision??{},date:row.date,accountId:row.accountId,description:text(row.description,'bank description'),merchant:text(row.merchant ?? row.description,'merchant',500),amountMinor:row.amountMinor,categoryId:row.categoryId,person:text(row.person ?? 'Joint','person',200),receiptHeld:text(row.receiptHeld ?? '','receipt',30),note:text(row.note ?? '','note'),sourceRefs:refs,transferId:text(row.transferId ?? '','transfer id',200),transferAccountId:text(row.transferAccountId ?? '','transfer account',200)};
  });
}
function cleanFiles(files) {
  assert(Array.isArray(files) && files.length > 0 && files.length <= 20, 'file_limit', 'Choose between 1 and 20 source files.');
  const ids = new Set();
  return files.map(file=> {
    assert(file && typeof file.id === 'string' && /^[\w-]{1,200}$/.test(file.id) && !ids.has(file.id), 'invalid_source', 'Each source file needs a unique ID.'); ids.add(file.id);
    text(file.name,'file name',255);
    assert(typeof file.text === 'string' && Buffer.byteLength(file.text,'utf8') <= 5*1024*1024, 'file_size', 'Each source file must be UTF-8 text under 5 MB.');
    const hash = digest(Buffer.from(file.text,'utf8'));
    assert(!file.sha256 || file.sha256 === hash, 'source_hash_mismatch', 'A source file changed during upload. Select it again.');
    assert(file.id===hash,'source_identity_mismatch','Source IDs must be the SHA-256 of the original bytes. Select the file again.');
    const balances={};
    for(const key of ['openingMinor','closingMinor'])if(file[key]!==undefined && file[key]!==null){
      const amount=file[key];
      assert(typeof amount==='string' && /^-?(?:0|[1-9]\d*)$/.test(amount) && amount!=='-0' && BigInt(amount)<=99999999999999n && BigInt(amount)>=-99999999999999n,'invalid_balance','Statement balances must be supported integer minor units.');
      balances[key]=amount;
    }
    return {id:file.id,name:file.name,text:file.text,sha256:hash,mapping:file.mapping ?? null,accountId:file.accountId ?? null,...balances};
  });
}
export function cellsForRow(row,id,version) {
  const day = dateSerial(row.date);
  const amount = Number(row.amountMinor)/100;
  const legacy = [id,day,row.accountId,row.description,row.merchant,amount,row.categoryId,row.person,row.receiptHeld,row.note];
  if (version===1) return legacy;
  return [id,'transaction',day,row.accountId,row.description,row.merchant,amount,row.categoryId,row.person,row.receiptHeld,row.note,'settled',day,row.transferId,row.transferAccountId,'','','','','bank export'];
}
function numberedRows(rows,state) {
  let sequence = 0;
  for (const row of state.rows) if (/^T\d+$/.test(String(row[0]))) sequence = Math.max(sequence,Number(String(row[0]).slice(1)));
  assert(Number.isSafeInteger(sequence + rows.length), 'id_overflow', 'The existing transaction IDs are outside the supported range.');
  return rows.map((r,i)=>cellsForRow(r,`T${String(sequence+i+1).padStart(4,'0')}`,state.version));
}
export class SerialQueue {
  #tails = new Map();
  async run(key,fn) {
    const previous=this.#tails.get(key) ?? Promise.resolve();
    let release;
    const mine=new Promise(r=>release=r);
    this.#tails.set(key,mine);
    await previous.catch(()=>{});
    try { return await fn(); } finally { release(); if (this.#tails.get(key)===mine) this.#tails.delete(key); }
  }
}
export class ImportService {
  constructor({driver,queue = new SerialQueue(),auditSources,now = ()=>new Date().toISOString()}) { this.driver=driver;this.queue=queue;this.auditSources=auditSources;this.now=now; }
  async prepare(token,request) {
    if(request.protocolVersion===3)return prepareGoal(this,token,request);
    assert(request.protocolVersion===undefined || [1,2].includes(request.protocolVersion),'unsupported_protocol','This import protocol is not supported.');
    if(request.protocolVersion===2)return prepareTyped(this,token,request);
    sheetID(request.sheetId);
    return this.queue.run(request.sheetId,async()=> {
      await this.driver.authorize(token,request.sheetId);
      const state=await this.driver.readState(token,request.sheetId);
      validateState(state,request.schemaVersion);
      await this.checkSheetGate(token,request.sheetId,state);
      assertPublicFeedDisabled(state);
      assertOpeningContract(state);
      state.provenance=(await this.hydrate(token,request.sheetId,state)).records;
      const files=cleanFiles(request.files);
      const rows=cleanRows(request.proposal?.rows,files,state);
      assert(typeof this.auditSources === 'function','source_audit_unavailable','The source validator is unavailable. Nothing was imported.',503);
      // Source validator must independently parse originals; client `canCommit` is never authority.
      await this.auditSources({files,rows,state,proposal:request.proposal});
      const targetRows=numberedRows(rows,state);
      const manifest={contract:1,intentFileId:await this.driver.reserveID(token),sheetId:request.sheetId,schemaVersion:state.version,createdAt:this.now(),baseline:stateDigest(state),baselineRows:state.rows,formulaFingerprint:state.formulaFingerprint??null,reviewDecisions:request.proposal.decisions??{},review:request.proposal.review??{},rows,targetRows,sources:files.map(({text,...f})=>f)};
      manifest.sourceFiles=[];
      for (const file of files) manifest.sourceFiles.push(await this.driver.storeSource(token,request.sheetId,file));
      manifest.proposalDigest=digest(manifest);
      const importId=await this.driver.storeManifest(token,manifest);
      return {importId,status:'proposed',counts:{new:rows.length},issues:[],proposalDigest:manifest.proposalDigest};
    });
  }
  async commit(token,importId,request) {
    sheetID(request.sheetId);
    assert(request.approval===true,'approval_required','Review and confirm this import before saving.');
    return this.queue.run(request.sheetId,async()=> {
      await this.driver.authorize(token,request.sheetId);
      const manifest=await this.driver.loadManifest(token,importId,request.sheetId);
      if(manifest.contract===3)return lifecycleGoal(this,token,manifest,importId,request,'commit');
      if(manifest.contract===2)return lifecycleTyped(this,token,manifest,importId,request,'commit');
      const state=await this.driver.readState(token,request.sheetId);
      validateState(state,manifest.schemaVersion);
      const receipt=state.receipts.find(r=>r.importId===importId);
      if (receipt) return this.finish(token,manifest,state,importId,receipt);
      const intent=await this.driver.findIntent(token,manifest.intentFileId,request.sheetId);
      if (intent?.status==='cancelled') return this.finishCancellation(token,manifest,importId);
      if (intent) return this.reconcile(manifest,state,importId);
      const gate=await this.checkSheetGate(token,request.sheetId,state,importId);
      assertPublicFeedDisabled(state);
      assertRowsAfterOpening(manifest.rows,state);
      await this.driver.verifySources(token,manifest);
      assert(stateDigest(state)===manifest.baseline,'stale_proposal','The Sheet changed since you reviewed this import. Refresh and review the new proposal.',409);
      const expectedGate=gateFor(manifest,importId,state);
      if(gate)assert(digest(gate)===digest(expectedGate),'sheet_import_gate_invalid','The shared import hold changed. Nothing was written.',409);
      try {
        if(!gate)await this.driver.writeSheetGate(token,request.sheetId,expectedGate);
        const observed=await this.driver.readSheetGate(token,request.sheetId);
        assert(digest(observed)===digest(expectedGate),'sheet_import_gate_unconfirmed','Google did not confirm the shared import hold. Check this import before continuing.',503);
      } catch {
        // No financial request is sent unless the shared hold was read back first.
        return this.unknown(manifest,importId,'sheet_import_gate_unconfirmed','The shared import hold is not confirmed. Check this import before continuing.');
      }
      try { await this.driver.storeIntent(token,manifest.intentFileId,importId,request.sheetId,{status:'writing',proposalDigest:manifest.proposalDigest,startedAt:this.now()}); }
      catch {
        // A timed-out create may still arrive. The reserved ID prevents a second winner.
        try {
          const observed=await this.driver.findIntent(token,manifest.intentFileId,request.sheetId);
          if(observed?.status==='cancelled')return this.finishCancellation(token,manifest,importId);
          const after=await this.driver.readState(token,request.sheetId);
          return this.finish(token,manifest,after,importId,after.receipts.find(r=>r.importId===importId));
        }catch{return this.unknown(manifest,importId,'write_outcome_unknown','The write record is not confirmed. Check this import before continuing.');}
      }
      try {
        // One atomic provider request inserts rows, fills only input columns and adds a receipt.
        await this.driver.atomicInsert(token,request.sheetId,state,manifest,importId,this.now());
      } catch (error) {
        // No write retry. A durable intent survives process/network failures.
        try { const after=await this.driver.readState(token,request.sheetId);return this.finish(token,manifest,after,importId,after.receipts.find(r=>r.importId===importId)); }
        catch { return {importId,proposalDigest:manifest.proposalDigest,status:'unknown',counts:{new:manifest.rows.length},issues:[{code:'write_outcome_unknown',message:'The connection was interrupted. Check this import before trying again.'}]}; }
      }
      try {
        const after=await this.driver.readState(token,request.sheetId);
        return this.finish(token,manifest,after,importId,after.receipts.find(r=>r.importId===importId));
      }catch{return this.unknown(manifest,importId,'write_outcome_unknown','The saved rows could not be read back. Check this import before continuing.');}
    });
  }
  async status(token,importId,request) {
    sheetID(request.sheetId);
    return this.queue.run(request.sheetId,async()=>{
    await this.driver.authorize(token,request.sheetId);
    const manifest=await this.driver.loadManifest(token,importId,request.sheetId);
    if(manifest.contract===3)return lifecycleGoal(this,token,manifest,importId,request,'status');
    if(manifest.contract===2)return lifecycleTyped(this,token,manifest,importId,request,'status');
    const state=await this.driver.readState(token,request.sheetId);
    const receipt=state.receipts.find(r=>r.importId===importId);
    if(receipt) return this.finish(token,manifest,state,importId,receipt);
    const intent=await this.driver.findIntent(token,manifest.intentFileId,request.sheetId);
    if(intent?.status==='cancelled')return this.finishCancellation(token,manifest,importId);
    if(intent)return this.reconcile(manifest,state,importId);
    return {importId,proposalDigest:manifest.proposalDigest,status:stateDigest(state)===manifest.baseline?'proposed':'stale',counts:{new:manifest.rows.length},issues:[]};
    });
  }
  async cancel(token,importId,request) {
    sheetID(request.sheetId);
    return this.queue.run(request.sheetId,async()=>{
      await this.driver.authorize(token,request.sheetId);
      const manifest=await this.driver.loadManifest(token,importId,request.sheetId);
      if(manifest.contract===3)return lifecycleGoal(this,token,manifest,importId,request,'cancel');
      if(manifest.contract===2)return lifecycleTyped(this,token,manifest,importId,request,'cancel');
      const state=await this.driver.readState(token,request.sheetId);
      const receipt=state.receipts.find(r=>r.importId===importId);
      if(receipt)return this.finish(token,manifest,state,importId,receipt);
      const intent=await this.driver.findIntent(token,manifest.intentFileId,request.sheetId);
      if(intent?.status==='cancelled')return this.finishCancellation(token,manifest,importId);
      if(intent)return this.reconcile(manifest,state,importId);
      try {
        // The same pre-reserved Drive ID is the atomic gate for BOTH write and cancel.
        await this.driver.storeIntent(token,manifest.intentFileId,importId,request.sheetId,{status:'cancelled',proposalDigest:manifest.proposalDigest,startedAt:this.now()});
        return this.finishCancellation(token,manifest,importId);
      } catch {
        const observed=await this.driver.findIntent(token,manifest.intentFileId,request.sheetId);
        if(observed?.status==='cancelled')return this.finishCancellation(token,manifest,importId);
        return this.reconcile(manifest,await this.driver.readState(token,request.sheetId),importId);
      }
    });
  }
  cancelled(manifest,importId) { return {importId,proposalDigest:manifest.proposalDigest,status:'cancelled',counts:{new:manifest.rows.length},issues:[]}; }
  async provenance(token,request) {
    assert(request.protocolVersion===undefined || [1,2].includes(request.protocolVersion),'unsupported_protocol','This import protocol is not supported.');
    if(request.protocolVersion===2)return provenanceTyped(this,token,request);
    sheetID(request.sheetId);
    return this.queue.run(request.sheetId,async()=>{
    await this.driver.authorize(token,request.sheetId);
    const state=await this.driver.readState(token,request.sheetId);
    validateState(state);
    await this.checkSheetGate(token,request.sheetId,state);
    const result=await this.hydrate(token,request.sheetId,state);
    state.provenance=result.records;
    const baseline=importBaseline(state);
    return {sheetId:request.sheetId,schemaVersion:state.version,publicFeedEnabled:state.publicFeedEnabled===true,records:result.records,issues:result.issues,baseline,revisionDigest:digest(baseline)};
    });
  }
  async checkSheetGate(token,sheetId,state,allowedImportId) {
    const gate=validateGate(await this.driver.readSheetGate(token,sheetId));
    if(!gate)return null;
    if(gateVerified(gate,state)) {
      assert(await this.driver.clearSheetGate(token,sheetId,gate),'sheet_import_gate_unconfirmed','The completed import is verified, but its shared hold could not be cleared. Check again.',503);
      return null;
    }
    if(gate.importId===allowedImportId)return gate;
    throw new ImportError('sheet_import_pending','Another operation for this Sheet is still awaiting verification. Check its saved receipt before continuing. Its original Google account may be needed to access the evidence.',409,await this.recoveryDescriptor(token,sheetId,gate));
  }
  async recoveryDescriptor(token,sheetId,gate) {
    const recovery={sheetId,importId:gate.importId,proposalDigest:gate.proposalDigest};
    let manifest;try{manifest=await this.driver.loadManifest(token,gate.importId,sheetId);}catch{return recovery;}
    if(manifest.contract===3){
      validateGoalManifest(manifest);assert(manifest.proposalDigest===gate.proposalDigest&&gate.rowsHash===digest(manifest.recordRefs)&&gate.stateHash===manifest.baseline,'sheet_import_gate_invalid','The goal hold no longer matches its reviewed manifest.',409);
      Object.assign(recovery,{protocolVersion:3,operation:'goal-create',schemaVersion:manifest.schemaVersion,goal:manifest.goal});
    }
    return recovery;
  }
  async finish(token,manifest,state,importId,receipt) {
    if(!receipt)return this.reconcile(manifest,state,importId);
    const result=this.verify(manifest,state,importId,receipt);
    if(result.status!=='verified')return result;
    try {
      const gate=await this.driver.readSheetGate(token,manifest.sheetId);
      // An old receipt must never clear a newer import's hold.
      if(gate?.importId===importId) {
        if(!gateVerified(gate,state,manifest) || !await this.driver.clearSheetGate(token,manifest.sheetId,gate))return this.unknown(manifest,importId,'sheet_import_gate_unconfirmed','The imported rows are verified, but their shared hold is not cleared. Check again before importing more.');
      }
      return result;
    }catch{return this.unknown(manifest,importId,'sheet_import_gate_unconfirmed','The imported rows are verified, but their shared hold is not cleared. Check again before importing more.');}
  }
  async finishCancellation(token,manifest,importId) {
    try {
      const gate=await this.driver.readSheetGate(token,manifest.sheetId);
      if(gate?.importId===importId) {
        assert(gate.proposalDigest===manifest.proposalDigest,'sheet_import_gate_invalid','The import hold changed.',409);
        if(!await this.driver.clearSheetGate(token,manifest.sheetId,gate))return this.unknown(manifest,importId,'sheet_import_gate_unconfirmed','Cancellation is recorded, but the shared hold is not cleared. Check again.');
      }
      return this.cancelled(manifest,importId);
    }catch{return this.unknown(manifest,importId,'sheet_import_gate_unconfirmed','Cancellation is recorded, but the shared hold is not cleared. Check again.');}
  }
  unknown(manifest,importId,code,message) { return {importId,proposalDigest:manifest.proposalDigest,status:'unknown',counts:{new:manifest.rows.length},issues:[{code,message}]}; }
  async hydrate(token,sheetId,state) {
    const records=[],issues=[],seen=new Set(),ambiguous=new Set();
    const current=new Map();
    for(const row of state.rows){if(!current.has(row[0]))current.set(row[0],[]);current.get(row[0]).push(row);}
    const manifests=new Array(state.receipts.length);let cursor=0;
    await Promise.all(Array.from({length:Math.min(4,state.receipts.length)},async()=>{
      while(cursor<state.receipts.length){const i=cursor++;try{manifests[i]={value:await this.driver.loadManifest(token,state.receipts[i].importId,sheetId)};}catch(error){manifests[i]={error};}}
    }));
    for(const [receiptIndex,receipt] of state.receipts.entries()) {
      try {
        if(manifests[receiptIndex].error)throw manifests[receiptIndex].error;
        const manifest=manifests[receiptIndex].value;
        if(manifest.contract===3){validateGoalManifest(manifest,receipt,state.version);continue;} // A validated goal receipt has no transaction provenance.
        assert(manifest.schemaVersion===state.version && manifest.proposalDigest===receipt.digest,'provenance_receipt_mismatch','The evidence receipt does not match this import.',409);
        const expectedIds=manifest.targetRows.map(r=>r[0]);
        assert(receipt.manifestFile===receipt.importId && JSON.stringify(JSON.parse(receipt.ids))===JSON.stringify(manifest.contract===2?manifest.recordRefs:expectedIds),'provenance_receipt_mismatch','The evidence receipt refers to different records.',409);
        const sourceHashes=new Map(manifest.sources.map(f=>[f.id,f.sha256]));
        for(let i=0;i<manifest.targetRows.length;i++) {
          const target=manifest.targetRows[i],source=manifest.rows[i];
          const found=current.get(target[0])??[];
          if(found.length!==1 || digest(sourceFacts(found[0],state.version))!==digest(sourceFacts(target,state.version))) {issues.push({code:'provenance_row_changed',transactionId:target[0],message:'This row differs from its import evidence; its previous source identity was not reused.'});continue;}
          if(!source.proposalId || !source.identity) {issues.push({code:'provenance_legacy',transactionId:target[0],message:'This older import has no saved source identity.'});continue;}
          if(seen.has(target[0])) {ambiguous.add(target[0]);issues.push({code:'provenance_ambiguous',transactionId:target[0],message:'More than one receipt claims this record; its source identity was not reused.'});continue;}
          const refs=source.sourceRefs.map(ref=>({fileId:sourceHashes.get(ref.sourceId),row:ref.sourceRow}));
          assert(refs.length && refs.every(ref=>/^[a-f0-9]{64}$/.test(ref.fileId??'') && Number.isInteger(ref.row) && ref.row>=2),'provenance_invalid','This import has an invalid source locator.',409);
          seen.add(target[0]);
          records.push({transactionId:target[0],proposalId:source.proposalId,sourceRefs:refs,sourceId:refs[0].fileId,sourceRow:refs[0].row,providerId:source.providerId??'',identity:source.identity,distinctSource:source.distinctSource===true});
        }
      }catch(error){
        // An inaccessible/missing/edited manifest does not grant identity to a raw tuple.
        // Continue with legacy rows, which require explicit overlap review.
        issues.push({code:'provenance_unavailable',importId:receipt.importId,message:'Some original import evidence is unavailable; matching rows may need review.'});
      }
    }
    return {records:records.filter(r=>!ambiguous.has(r.transactionId)),issues};
  }
  reconcile(manifest,state,importId) {
    const receipt=state.receipts.find(r=>r.importId===importId);
    if(receipt) return this.verify(manifest,state,importId,receipt);
    const any=state.rows.some(row=>manifest.targetRows.some(expected=>expected[0]===row[0]));
    return {importId,proposalDigest:manifest.proposalDigest,status:any?'conflict':'unknown',counts:{new:manifest.rows.length},issues:[{code:any?'partial_or_unreceipted_write':'write_outcome_unknown',message:any?'Some expected IDs exist without a matching receipt. Review the Sheet; this import will not be repeated.':'The write outcome is not confirmed. Check again; this import will not be repeated automatically.'}]};
  }
  verify(manifest,state,importId,receipt) {
    const issues=[];
    try{validateState(state,manifest.schemaVersion);}catch(error){issues.push({code:error.code??'invalid_sheet',message:error.message});}
    if((state.formulaFingerprint??null)!==manifest.formulaFingerprint)issues.push({code:'formula_changed',message:'A Sheet formula changed during the import. Review its calculations before continuing.'});
    if(!receipt || receipt.digest!==manifest.proposalDigest || receipt.manifestFile!==importId || receipt.ids!==JSON.stringify(manifest.targetRows.map(r=>r[0])) || state.receipts.filter(r=>r.importId===importId).length!==1) issues.push({code:'receipt_mismatch',message:'The Sheet receipt does not match this import.'});
    const width=HEADERS[manifest.schemaVersion].length;
    for(const expected of manifest.targetRows) {
      const matches=state.rows.filter(row=>row[0]===expected[0]);
      if(matches.length!==1 || digest(pad(matches[0],width))!==digest(pad(expected,width))) issues.push({code:'readback_mismatch',recordId:expected[0],message:'A saved row does not match its approved values.'});
    }
    for(const expected of manifest.baselineRows) {
      const matches=state.rows.filter(row=>row[0]===expected[0]);
      if(matches.length!==1 || digest(pad(matches[0],width))!==digest(pad(expected,width))) issues.push({code:'concurrent_change',recordId:expected[0],message:'An existing row changed during the import.'});
    }
    return {importId,proposalDigest:manifest.proposalDigest,status:issues.length?'conflict':'verified',counts:{new:manifest.rows.length},rowIds:manifest.targetRows.map(r=>r[0]),issues,verificationScope:'Imported input rows and unchanged pre-existing input rows; not a complete month-end close.'};
  }
}
export const pad=(row,width)=>Array.from({length:width},(_,i)=>row?.[i]??'');

// One import-only baseline for both native review and the server's independent source audit.
// No default UNCAT conversion: blanks and pending state retain their original meaning.
export function importBaseline(state) {
  const provenance=new Map((state.provenance??[]).map(r=>[r.transactionId,r]));
  const existing=state.rows.filter(r=>state.version===1 || r[1]==='transaction').map(r=>{
    const row=state.version===1?{id:r[0],date:isoDate(r[1]),accountId:r[2],description:r[3],merchant:r[4],amountMinor:String(Math.round(Number(r[5])*100)),categoryId:r[6]??'',person:r[7]??'',status:'posted'}:{id:r[0],date:isoDate(r[2]),accountId:r[3],description:r[4],merchant:r[5],amountMinor:String(Math.round(Number(r[6])*100)),categoryId:r[7]??'',person:r[8]??'',status:r[11]==='pending'?'pending':'posted'};
    const evidence=provenance.get(row.id);
    if(evidence) Object.assign(row,{transactionId:row.id,id:evidence.proposalId,sourceRefs:evidence.sourceRefs,sourceId:evidence.sourceId,sourceRow:evidence.sourceRow,providerId:evidence.providerId});
    return row;
  });
  const accounts=state.openingContract?.error?state.accounts.map(account=>({...account,openingDate:''})):state.accounts;
  return {existing,accounts,categories:state.categories,currency:state.currency??'AUD',...(state.people?{people:state.people}:{})};
}

export const sourceFacts=(row,version)=>(version===1?[0,1,2,3,5]:[0,1,2,3,4,6,11,12]).map(i=>row?.[i]??'');
