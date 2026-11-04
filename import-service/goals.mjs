import {ImportError,digest,sheetID,validDate,dateSerial,isoDate,validateState,validateGate,assertPublicFeedDisabled,assertOpeningContract} from './core.mjs';
import {GOAL_HEADERS,goalFormulas,goalCells,goalAccountHeaders} from './goals-google.mjs';
const must=(condition,code,message,status=409)=>{if(!condition)throw new ImportError(code,message,status);};
const nameKey=name=>name.normalize('NFC').trim().toLowerCase();
const normal=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const profileFor=state=>state.legacy.openingContract?.profile??'legacy';
const enteredValue=v=>v?.numberValue??v?.stringValue??v?.boolValue??'';
const exactMinor=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=999999999999.99&&Math.abs(value*100-Math.round(value*100))<0.01?String(Math.round(value*100)):null;
export function validateGoalState(state){
  validateState(state.legacy,state.version);
  must(state.legacy.currencyPresent!==false,'goal_currency','The Kitty tab needs its explicit currency before adding a goal.');
  must(digest(state.header)===digest(GOAL_HEADERS),'goal_schema','The Goals A:J columns do not match the Kitty template. Restore them in the Sheet before adding a goal.');
  must(!state.layoutIssues?.length&&state.rows.every((row,i)=>row.row===i+2),'goal_layout','The Goals tab contains gaps or extra data outside its table. Restore a continuous Goals A:J table before adding a goal.');
  const headers=goalAccountHeaders(state.version);
  must(headers.every((h,i)=>normal(h)===normal(state.accountHeader[i])),'goal_account_schema','The account columns no longer match this Sheet version.');
  const ids=state.accounts.map(row=>row[0]);
  must(ids.every(id=>typeof id==='string'&&id.trim())&&new Set(ids).size===ids.length,'goal_account_identity','Accounts must have unique nonempty IDs.');
  const asOf=state.settings.filter(row=>row[0]==='As-of date');
  must(asOf.length===1&&state.settings[5]?.[0]==='As-of date'&&Number.isInteger(asOf[0][1])&&state.settingsInputs[5]?.[1]?.numberValue===asOf[0][1]&&validDate(isoDate(asOf[0][1])),'goal_asof','Restore the As-of date input in Settings A6:B6 before adding a goal.');
  const names=new Set(),profile=profileFor(state);
  for(const row of state.rows){
    const name=row.entered[0]?.stringValue;
    must(typeof name==='string'&&name.trim()&&!names.has(nameKey(name)),'goal_identity','Every existing goal needs a unique nonempty name. Resolve duplicate or unnamed goal rows in the Sheet.');names.add(nameKey(name));
    must(row.entered.slice(0,4).every(v=>v&&!v.formulaValue),'goal_input_formula','An existing goal input is blank or contains a formula. Restore its four raw fields first.');
    must(exactMinor(row.entered[1]?.numberValue)!==null&&row.entered[1].numberValue>0&&Number.isInteger(row.entered[2]?.numberValue)&&validDate(isoDate(row.entered[2].numberValue))&&state.accounts.some(account=>account[0]===row.entered[3]?.stringValue),'goal_existing_inputs','An existing goal has an invalid target, date or account. Correct it in the Sheet before adding another goal.');
    const actual=row.entered.slice(4).map(v=>v?.formulaValue),fixed=goalFormulas(profile,row.row),dynamic=goalFormulas(profile,2,{dynamic:true});
    must(actual.every((formula,i)=>formula===fixed[i]||formula===dynamic[i]),'goal_formula_contract','An existing goal uses different formulas. Keep its custom calculation in the Sheet; the app cannot safely extend this table.');
  }
}
export function cleanGoal(input,state){
  must(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['name','targetMinor','targetDate','accountId','currency'].includes(k)),'goal_invalid','The goal review is incomplete.',400);
  must(typeof input.name==='string'&&input.name===input.name.trim().normalize('NFC')&&input.name.length>=1&&input.name.length<=100&&!/[\u0000-\u001f\u007f]/.test(input.name),'goal_name','Give the goal a name of up to 100 characters without line breaks.',400);
  must(typeof input.targetMinor==='string'&&/^[1-9]\d*$/.test(input.targetMinor)&&BigInt(input.targetMinor)<=99999999999999n,'goal_amount','Enter a positive goal amount with no more than two decimal places.',400);
  must(validDate(input.targetDate)&&input.targetDate>isoDate(state.settings[5][1])&&input.targetDate>='1900-01-01'&&input.targetDate<='2200-12-31','goal_date','Choose a target date after the Sheet As-of date.',400);
  must(['AUD','USD','NZD','GBP','EUR','CAD','CHF','SGD','HKD'].includes(input.currency)&&input.currency===state.legacy.currency,'goal_currency','The goal currency must match the Sheet.',400);
  const account=state.accounts.find(row=>row[0]===input.accountId);
  must(account&&['Transaction','Savings','Offset'].includes(account[3])&&String(account[8]).trim().toLowerCase()==='yes'&&exactMinor(account[7])!==null,'goal_account','Choose a liquid transaction, savings or offset account with a confirmed balance.',400);
  if(state.version===2)must(account[9]==='Cash'&&account[10]==='ledger'&&account[11]===input.currency&&account[12]==='active','goal_account','Choose an active cash ledger account in the Sheet currency.',400);
  must(!state.rows.some(row=>nameKey(row.entered[0]?.stringValue??'')===nameKey(input.name)),'goal_exists','A goal with this name already exists. Refresh and open that goal instead.',409);
  return {name:input.name,targetMinor:input.targetMinor,targetDate:input.targetDate,accountId:input.accountId,currency:input.currency};
}
// Effective values change when formulas recalculate. Bind raw inputs and the
// exact formula strings, leaving current publication permission outside history.
export const goalDigest=state=>digest({version:state.version,header:state.header,rows:state.rows.map(r=>({row:r.row,entered:r.entered})),accountInputs:state.accountInputs,settingsInputs:state.settingsInputs,ledger:state.legacy.rows,currency:state.legacy.currency,people:state.legacy.people,otherFormulaFingerprint:state.otherFormulaFingerprint});
export function validateGoalManifest(m,receipt,version=m.schemaVersion){
  const g=m.goal;
  must(m.contract===3&&m.operation==='goal-create'&&m.schemaVersion===version&&[1,2].includes(version)&&['legacy','au-aud-basic'].includes(m.profile)&&/^[a-f0-9]{64}$/.test(m.baseline??'')&&/^[A-Za-z0-9_-]{10,200}$/.test(m.intentFileId??''),'goal_manifest','The goal manifest has an unsupported contract.');
  must(g&&typeof g.name==='string'&&g.name===g.name.trim().normalize('NFC')&&g.name.length>0&&g.name.length<=100&&!/[\u0000-\u001f\u007f]/.test(g.name)&&typeof g.targetMinor==='string'&&/^[1-9]\d*$/.test(g.targetMinor)&&BigInt(g.targetMinor)<=99999999999999n&&validDate(g.targetDate)&&typeof g.accountId==='string'&&g.accountId.length>0&&g.accountId.length<=200&&['AUD','USD','NZD','GBP','EUR','CAD','CHF','SGD','HKD'].includes(g.currency),'goal_manifest','The goal manifest has invalid approved fields.');
  must(digest(m.recordRefs)===digest([`goal:${g.name}`])&&['rows','targetRows','sources','sourceFiles'].every(key=>Array.isArray(m[key])&&m[key].length===0),'goal_manifest','The goal manifest contains unexpected source or ledger writes.');
  if(receipt)must(receipt.digest===m.proposalDigest&&receipt.manifestFile===receipt.importId&&receipt.ids===JSON.stringify(m.recordRefs),'goal_receipt','The goal receipt does not match its immutable manifest.');
}
const result=(m,id,status,issues=[],extra={})=>({importId:id,proposalDigest:m.proposalDigest,sheetId:m.sheetId,protocolVersion:3,operation:'goal-create',status,goal:m.goal,counts:{new:1},issues,...extra});
const unknown=(m,id,message='The saved goal is not confirmed. Check this receipt; the create request will not be repeated.')=>result(m,id,'unknown',[{code:'goal_write_unknown',message}]);
const gateFor=(m,id)=>({importId:id,proposalDigest:m.proposalDigest,rowsHash:digest(m.recordRefs),stateHash:m.baseline,version:m.schemaVersion});
export function verifyGoal(m,state,id,{historical=false}={}){
  const issues=[],add=(code,message)=>issues.push({code,message});
  try{validateGoalManifest(m);}catch(e){return result(m,id,'conflict',[{code:e.code,message:e.message}]);}
  try{
    if(historical){must(state.version===m.schemaVersion&&digest(state.header)===digest(GOAL_HEADERS)&&state.legacy.receiptValid!==false,'goal_schema','The goal or receipt columns no longer match this contract.');}
    else validateGoalState(state);
  }catch(e){add(e.code,e.message);}
  const receipts=state.legacy.receipts.filter(r=>r.importId===id);
  if(receipts.length!==1||receipts[0].digest!==m.proposalDigest||receipts[0].manifestFile!==id||receipts[0].ids!==JSON.stringify(m.recordRefs))add('receipt_mismatch','The Sheet receipt does not match the approved goal.');
  const matches=state.rows.filter(row=>nameKey(row.entered[0]?.stringValue??'')===nameKey(m.goal.name));
  const expected=goalCells(m.goal,m.profile).map(c=>c.userEnteredValue);
  if(matches.length!==1||digest(matches[0].entered)!==digest(expected))add('goal_readback_mismatch','The saved goal fields or formulas differ from the approved goal.');
  if(matches.length===1){
    if(exactMinor(matches[0].effective[1])!==m.goal.targetMinor||matches[0].effective[2]!==dateSerial(m.goal.targetDate)||matches[0].effective[3]!==m.goal.accountId||matches[0].effective[0]!==m.goal.name)add('goal_effective_mismatch','The goal target, date or account has not read back as approved.');
    if(matches[0].errors.length)add('goal_formula_error','The saved goal has a formula error. Open the Sheet before continuing.');
    const account=state.accounts.find(row=>row[0]===m.goal.accountId),balance=exactMinor(matches[0].effective[4]);
    if(balance===null||balance!==exactMinor(account?.[7]))add('goal_balance_unverified','The goal has not yet recalculated to its linked account balance. Check again.');
  }
  const without={...state,rows:state.rows.filter(row=>!matches.includes(row))};
  if(!historical&&goalDigest(without)!==m.baseline)add('goal_concurrent_change','An existing Sheet input or formula changed during goal creation. Review the Sheet before continuing.');
  return result(m,id,issues.length?'conflict':'verified',issues,{...(matches.length===1?{goalRow:matches[0].row}:{}),verificationScope:historical?'The existing receipt and its current goal inputs, formulas and linked balance. Later unrelated changes are not part of this check.':'The new goal inputs, its formulas and linked balance, with unchanged existing inputs and formulas.'});
}
export async function finishGoal(service,token,m,state,id){
  try{
    const gate=validateGate(await service.driver.readSheetGate(token,m.sheetId));
    const answer=verifyGoal(m,state,id,{historical:gate?.importId!==id});if(answer.status!=='verified')return answer;
    if(gate?.importId===id){if(digest(gate)!==digest(gateFor(m,id))||!await service.driver.clearSheetGate(token,m.sheetId,gate))return unknown(m,id,'The goal is verified, but its shared hold has not cleared. Check again.');}return answer;
  }catch{return unknown(m,id);}
}
export async function prepareGoal(service,token,request){
  sheetID(request.sheetId);must(request.operation==='goal-create','operation_invalid','Choose goal creation.',400);
  return service.queue.run(request.sheetId,async()=>{
    await service.driver.authorize(token,request.sheetId);const state=await service.driver.readGoalState(token,request.sheetId);
    await service.checkSheetGate(token,request.sheetId,state.legacy);
    assertPublicFeedDisabled(state.legacy);assertOpeningContract(state.legacy);validateGoalState(state);
    must(request.schemaVersion===state.version,'schema_changed','The Sheet version changed. Refresh before reviewing this goal.');
    const goal=cleanGoal(request.goal,state),manifest={contract:3,operation:'goal-create',schemaVersion:state.version,sheetId:request.sheetId,createdAt:service.now(),intentFileId:await service.driver.reserveID(token),profile:profileFor(state),goal,baseline:goalDigest(state),recordRefs:[`goal:${goal.name}`],rows:[],targetRows:[],sources:[],sourceFiles:[]};
    manifest.proposalDigest=digest(manifest);const id=await service.driver.storeManifest(token,manifest);
    return result(manifest,id,'proposed');
  });
}
export async function lifecycleGoal(service,token,m,id,request,action){
  validateGoalManifest(m);
  if(action==='commit')must(request.proposalDigest===m.proposalDigest,'goal_receipt_binding','The reviewed goal digest is required before creating it.');
  must(request.proposalDigest===undefined||request.proposalDigest===m.proposalDigest,'goal_receipt_binding','The saved goal digest does not match this receipt.');
  // Cancellation depends on the receipt/one-shot intent, not on a still-valid
  // Goals layout. A removed/customised goal tab must not strand an unstarted review.
  const legacy=await service.driver.readState(token,request.sheetId);
  if(legacy.receipts.some(r=>r.importId===id)){
    try{return await finishGoal(service,token,m,await service.driver.readGoalState(token,request.sheetId),id);}catch{return unknown(m,id);}
  }
  const intent=await service.driver.findIntent(token,m.intentFileId,request.sheetId);
  const cancelled=async()=>{try{const gate=await service.driver.readSheetGate(token,m.sheetId);if(gate?.importId===id&&(digest(gate)!==digest(gateFor(m,id))||!await service.driver.clearSheetGate(token,m.sheetId,gate)))return unknown(m,id);return result(m,id,'cancelled');}catch{return unknown(m,id);}};
  if(intent?.status==='cancelled')return cancelled();if(intent)return unknown(m,id);
  if(action==='cancel'){
    try{await service.driver.storeIntent(token,m.intentFileId,id,m.sheetId,{status:'cancelled',proposalDigest:m.proposalDigest,startedAt:service.now()});return cancelled();}
    catch{const observed=await service.driver.findIntent(token,m.intentFileId,m.sheetId);return observed?.status==='cancelled'?cancelled():unknown(m,id);}
  }
  let state=await service.driver.readGoalState(token,request.sheetId);
  if(action==='status')return result(m,id,goalDigest(state)===m.baseline?'proposed':'stale');
  await service.checkSheetGate(token,m.sheetId,state.legacy,id);
  assertPublicFeedDisabled(state.legacy);assertOpeningContract(state.legacy);validateGoalState(state);cleanGoal(m.goal,state);
  must(goalDigest(state)===m.baseline,'stale_proposal','The Sheet changed since this goal review. Cancel this receipt and review again.');
  const gate=gateFor(m,id);
  try{await service.driver.writeSheetGate(token,m.sheetId,gate);must(digest(await service.driver.readSheetGate(token,m.sheetId))===digest(gate),'goal_hold_unconfirmed','The Sheet hold is not confirmed.');await service.driver.storeIntent(token,m.intentFileId,id,m.sheetId,{status:'writing',proposalDigest:m.proposalDigest,startedAt:service.now()});}catch{return unknown(m,id);}
  try{await service.driver.atomicGoalInsert(token,m.sheetId,state,m,id,service.now());}catch{}
  // Only the freshly confirmed intent owner may dispatch, once. Recovery reads.
  try{state=await service.driver.readGoalState(token,m.sheetId);return state.legacy.receipts.some(r=>r.importId===id)?finishGoal(service,token,m,state,id):unknown(m,id);}catch{return unknown(m,id);}
}
