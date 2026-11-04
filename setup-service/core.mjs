import {buildTemplate} from '../templates/build.mjs';
import {SerialQueue} from '../import-service/core.mjs';
import {sha256,canonical,blankWorkbook,verifyWorkbook} from './verify.mjs';

export class SetupError extends Error {constructor(code,message,status=409){super(message);this.code=code;this.status=status;}}
const must=(condition,code,message,status)=>{if(!condition)throw new SetupError(code,message,status);};
export const validID=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,100}$/.test(value);
const validDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function validatePlan(plan){
  must(plan?.schema==='kitty-template-plan/1'&&validDigest(plan.sourceSha256)&&validDigest(plan.inputSha256),'template_invalid','The template is unavailable.',503);
  const v=plan.verification;must(v&&Array.isArray(v.sheets)&&v.sheets.length>0&&v.sheets.length<=50&&Array.isArray(v.cells)&&Array.isArray(v.checks)&&v.checks.length>0&&Array.isArray(v.rawRecordRanges)&&Array.isArray(v.allowErrors)&&v.allowErrors.length===0,'template_invalid','The template verification contract is incomplete.',503);
  must(v.sheets.reduce((n,s)=>n+s.rowCount*s.columnCount,0)<=1_000_000,'setup_capacity','This initial setup exceeds the supported verification capacity. Use the default table capacities.',400);
  must(Array.isArray(plan.batchUpdate?.requests)&&Buffer.byteLength(JSON.stringify(plan.batchUpdate))<=1_900_000,'template_invalid','The template is outside the supported request limit.',503);
  return plan;
}
function manifestFor(identity,ids,plan){
  const value={contract:'kitty-setup/1',setupId:ids.setupId,createIntentId:ids.createIntentId,initializeIntentId:ids.initializeIntentId,ownerPermissionId:identity.permissionId,sourceSha256:plan.sourceSha256,inputSha256:plan.inputSha256,normalizedInput:plan.normalizedInput,plan};
  return {...value,proposalDigest:sha256(value)};
}
const response=(m,status,phase,issues=[],sheetId)=>({setupId:m.setupId,proposalDigest:m.proposalDigest,ownerPermissionId:m.ownerPermissionId,status,phase,canContinue:['prepared','created'].includes(status),canCancel:status==='prepared',...(sheetId?{sheetId}:{}),issues});
const unknown=(m,phase,message,sheetId)=>response(m,'unknown',phase,[{code:'setup_outcome_unknown',message}],sheetId);
export class SetupService {
  constructor({driver,queue=new SerialQueue(),builder=buildTemplate}={}){this.driver=driver;this.queue=queue;this.builder=builder;}
  build(input){try{return validatePlan(this.builder(input));}catch(error){if(error instanceof SetupError)throw error;throw new SetupError('setup_input_invalid',error.message||'Review the household setup fields.',400);}}
  async reserve(token,{input}){
    const identity=await this.driver.identity(token),plan=this.build(input),ids=await this.driver.reserveIDs(token,3);
    must(ids.length===3&&ids.every(validID)&&new Set(ids).size===3,'reservation_invalid','Google did not return a complete setup reservation.',503);
    const manifest=manifestFor(identity,{setupId:ids[0],createIntentId:ids[1],initializeIntentId:ids[2]},plan);
    return {...response(manifest,'reserved','manifest'),createIntentId:manifest.createIntentId,initializeIntentId:manifest.initializeIntentId,sourceSha256:plan.sourceSha256,inputSha256:plan.inputSha256,normalizedInput:plan.normalizedInput,reviewSummary:plan.reviewSummary};
  }
  async begin(token,setupId,request){
    this.binding(setupId,request.proposalDigest);must(request.approval===true,'setup_approval_required','Review and confirm the household setup before creation.',400);
    must(validID(request.createIntentId)&&validID(request.initializeIntentId)&&new Set([setupId,request.createIntentId,request.initializeIntentId]).size===3,'reservation_invalid','The saved setup reservation is incomplete.',400);
    return this.queue.run(setupId,async()=>{
      const identity=await this.driver.identity(token);
      let manifest=await this.driver.loadManifest(token,setupId,request.proposalDigest,identity,{optional:true});
      if(!manifest){
        const plan=this.build(request.input),expected=manifestFor(identity,{setupId,createIntentId:request.createIntentId,initializeIntentId:request.initializeIntentId},plan);
        must(expected.proposalDigest===request.proposalDigest,'setup_review_changed','The approved setup, template or Google account changed. No workbook was created.',409);
        // A cancelled reservation can predate the full household manifest.
        // Check its immutable create-intent identity before storing any inputs.
        const prior=await this.observe(token,expected,identity);if(prior.issue)return prior.issue;
        if(prior.createIntent?.status==='cancelled'&&!prior.sheet)return response(expected,'cancelled','complete');
        if(prior.createIntent||prior.sheet)return unknown(expected,'manifest','A creation record exists but its household manifest is unavailable. Preserve this reservation; no creation request will be repeated.',prior.sheet?.id);
        const stored=await this.driver.putKnownJSON(token,setupId,expected,{kind:'manifest',setupId,digest:expected.proposalDigest},identity);
        if(!stored.observed)return unknown(expected,'manifest','The setup manifest is not yet observable. Preserve this reservation; never start a new one to resolve this outcome.');
        manifest=await this.driver.loadManifest(token,setupId,request.proposalDigest,identity);
      }
      this.validateManifest(manifest,identity);
      must(manifest.createIntentId===request.createIntentId&&manifest.initializeIntentId===request.initializeIntentId&&canonical(manifest.normalizedInput)===canonical(this.build(request.input).normalizedInput),'setup_review_changed','This saved setup differs from the approved input. Preserve its existing receipt.',409);
      return this.progress(token,manifest,identity,true);
    });
  }
  binding(id,digest){must(validID(id)&&validDigest(digest),'setup_binding_invalid','Use the saved setup identity and digest.',400);}
  validateManifest(m,identity){
    const {proposalDigest,...content}=m;
    must(m.contract==='kitty-setup/1'&&sha256(content)===proposalDigest&&m.ownerPermissionId===identity.permissionId&&validID(m.setupId)&&validID(m.createIntentId)&&validID(m.initializeIntentId)&&new Set([m.setupId,m.createIntentId,m.initializeIntentId]).size===3,'setup_manifest_changed','The saved setup or owning Google identity changed. Nothing further will be written.');
    validatePlan(m.plan);must(m.sourceSha256===m.plan.sourceSha256&&m.inputSha256===m.plan.inputSha256&&sha256(m.normalizedInput)===m.inputSha256&&canonical(m.normalizedInput)===canonical(m.plan.normalizedInput),'setup_manifest_changed','The saved template plan changed.');
    // A user-owned JSON file is evidence, not authority to supply arbitrary
    // Sheets requests. Only the pinned supported generator may define a plan.
    must(canonical(this.build(m.normalizedInput))===canonical(m.plan),'setup_template_changed','This saved setup requires its original supported template version. Preserve its identity; do not create another workbook.');
  }
  async withManifest(token,id,request,fn){this.binding(id,request.proposalDigest);return this.queue.run(id,async()=>{const identity=await this.driver.identity(token),m=await this.driver.loadManifest(token,id,request.proposalDigest,identity);this.validateManifest(m,identity);return fn(m,identity);});}
  reservationBinding(id,request,identity){
    must(validID(request.createIntentId)&&validID(request.initializeIntentId)&&new Set([id,request.createIntentId,request.initializeIntentId]).size===3&&request.ownerPermissionId===identity.permissionId,'setup_reservation_required','Use the saved reservation and its original Google account to cancel or check setup before its manifest exists.',409);
    // The existing digest commits to the full approved plan. Rebuild it to prove
    // these IDs belong to that digest; ID/owner assertions alone are not proof.
    const expected=manifestFor(identity,{setupId:id,createIntentId:request.createIntentId,initializeIntentId:request.initializeIntentId},this.build(request.input));
    must(expected.proposalDigest===request.proposalDigest,'setup_review_changed','The saved cancellation reservation does not match the approved setup. Nothing has been cancelled.');
    return expected;
  }
  status(token,id,request){this.binding(id,request.proposalDigest);return this.queue.run(id,async()=>{
    const identity=await this.driver.identity(token),m=await this.driver.loadManifest(token,id,request.proposalDigest,identity,{optional:true});
    if(m){this.validateManifest(m,identity);return this.progress(token,m,identity,false);}
    // A read-only GET cannot authenticate guessed intent IDs against a digest
    // of the full plan. Repeating cancel with the saved approved input provides
    // that proof without storing it, including after a lost cancellation reply.
    throw new SetupError('not_found','No setup manifest is confirmed. Keep the saved reservation; retry its original begin or cancel request to reconcile it.',404);
  });}
  continue(token,id,request){must(request.approval===true,'setup_approval_required','Confirm continuation of this same saved setup.',400);return this.withManifest(token,id,request,(m,identity)=>this.progress(token,m,identity,true));}
  cancel(token,id,request){this.binding(id,request.proposalDigest);return this.queue.run(id,async()=>{
    const identity=await this.driver.identity(token),manifest=await this.driver.loadManifest(token,id,request.proposalDigest,identity,{optional:true});
    if(manifest)this.validateManifest(manifest,identity);
    const m=manifest??this.reservationBinding(id,request,identity);
    const existing=await this.observe(token,m,identity);if(existing.issue)return existing.issue;
    if(existing.sheet)return manifest?this.progress(token,m,identity,false):unknown(m,'create','A workbook exists but its household manifest is unavailable. Preserve this setup identity.',existing.sheet.id);
    if(existing.createIntent){if(existing.createIntent.status==='cancelled')return response(m,'cancelled','complete');return unknown(m,'create','Creation has a durable attempt record. Its outcome must be checked; cancellation cannot assume that no workbook exists.');}
    const body=this.intent(m,'create','cancelled'),result=await this.driver.putKnownJSON(token,m.createIntentId,body,{kind:'intent',setupId:m.setupId,digest:m.proposalDigest,stage:'create',status:'cancelled'},identity);
    if(!result.observed)return unknown(m,'create','Cancellation is not confirmed. Preserve the original setup identity.');
    if(manifest)return this.progress(token,m,identity,false);
    const checked=await this.observe(token,m,identity);if(checked.issue)return checked.issue;
    return checked.createIntent?.status==='cancelled'&&!checked.sheet?response(m,'cancelled','complete'):unknown(m,'create','Cancellation was not confirmed. Preserve the original setup reservation.',checked.sheet?.id);
  });}
  intent(m,stage,status='writing',extra={}){return {contract:'kitty-setup-intent/1',setupId:m.setupId,proposalDigest:m.proposalDigest,ownerPermissionId:m.ownerPermissionId,stage,status,...extra};}
  async observe(token,m,identity){
    const createIntent=await this.driver.loadIntent(token,m.createIntentId,m,'create',identity);
    let matches;try{matches=await this.driver.findSheets(token,m);}catch{return {issue:unknown(m,'create','The complete workbook search could not be verified. No creation request will be repeated.')};}
    if(createIntent?.knownSheetId){
      if(matches.some(sheet=>sheet.id!==createIntent.knownSheetId))return {issue:response(m,'conflict','create',[{code:'multiple_setup_workbooks',message:'The known workbook and the marker search disagree. No further workbook will be created.'}])};
      if(matches.length===0)matches=[{id:createIntent.knownSheetId}];
    }
    if(matches.length>1)return {issue:response(m,'conflict','create',[{code:'multiple_setup_workbooks',message:'More than one workbook matches this setup. Resolve these records without creating another.'}])};
    if(matches.length===1){
      const sheet=matches[0];
      try{await this.driver.assertOwnedPrivate(token,sheet.id,identity,{kind:'workbook',setupId:m.setupId,digest:m.proposalDigest});}
      catch(error){return {issue:response(m,'conflict','verify',[{code:error.code??'setup_access_changed',message:error.message??'Workbook ownership or access changed.'}],sheet.id)};}
      if(createIntent?.status==='cancelled')return {issue:response(m,'conflict','create',[{code:'cancelled_setup_has_workbook',message:'A workbook exists for a cancelled setup. No initialization will be attempted.'}],sheet.id)};
      if(!createIntent)return {issue:response(m,'conflict','create',[{code:'missing_create_intent',message:'The marked workbook has no matching creation intent. Preserve this setup for review.'}],sheet.id)};
      return {sheet,createIntent};
    }
    return {sheet:null,createIntent};
  }
  async progress(token,m,identity,mayWrite){
    let observed=await this.observe(token,m,identity);if(observed.issue)return observed.issue;
    if(!observed.sheet){
      if(observed.createIntent?.status==='cancelled')return response(m,'cancelled','complete');
      if(observed.createIntent)return unknown(m,'create','Creation was attempted but a single matching workbook is not yet observable. A zero-result search does not authorize a second creation.');
      if(!mayWrite)return response(m,'prepared','create');
      const body=this.intent(m,'create'),won=await this.driver.putKnownJSON(token,m.createIntentId,body,{kind:'intent',setupId:m.setupId,digest:m.proposalDigest,stage:'create',status:'writing'},identity);
      if(!won.created)return this.progress(token,m,identity,false);
      // Only this request's successful known-ID intent creation authorizes POST.
      try{
        const sheetId=await this.driver.createWorkbook(token,m);
        // This is recovery metadata only. An existing intent always prevents
        // another creation, even if this update or the search response is lost.
        await this.driver.rememberWorkbook(token,m,identity,sheetId);
      }catch{}
      observed=await this.observe(token,m,identity);if(observed.issue)return observed.issue;
      if(!observed.sheet)return unknown(m,'create','Google did not confirm a single matching workbook. Check this saved setup; creation will not be repeated.');
    }
    const sheetId=observed.sheet.id;
    let state;try{state=await this.driver.readWorkbook(token,sheetId);}catch{return unknown(m,'verify','The workbook could not be read completely. Check this same setup again.',sheetId);}
    const initIntent=await this.driver.loadIntent(token,m.initializeIntentId,m,'initialize',identity);
    const checked=verifyWorkbook(state,m.plan);
    if(checked.status==='verified'){
      if(!initIntent||initIntent.sheetId!==sheetId)return response(m,'conflict','verify',[{code:'missing_initialize_intent',message:'Template content is present without the matching initialization intent.'}],sheetId);
      return response(m,'verified','complete',[],sheetId);
    }
    if(initIntent){
      if(initIntent.sheetId!==sheetId)return response(m,'conflict','verify',[{code:'initialize_identity_changed',message:'The initialization receipt names a different workbook.'}],sheetId);
      const empty=blankWorkbook(state,m.plan);
      return empty.ok?unknown(m,'initialize','Initialization was attempted and remains unconfirmed. The initialization batch will not be replayed.',sheetId):response(m,checked.status,'verify',checked.issues,sheetId);
    }
    const initial=blankWorkbook(state,m.plan);if(!initial.ok)return response(m,'conflict','initialize',initial.issues,sheetId);
    if(!mayWrite)return response(m,'created','initialize',[],sheetId);
    const body=this.intent(m,'initialize','writing',{sheetId,initialSheets:state.sheets.map(s=>({sheetId:s.sheetId,title:s.title}))});
    const won=await this.driver.putKnownJSON(token,m.initializeIntentId,body,{kind:'intent',setupId:m.setupId,digest:m.proposalDigest,stage:'initialize',status:'writing'},identity);
    if(!won.created)return this.progress(token,m,identity,false);
    try{await this.driver.initializeWorkbook(token,sheetId,m.plan,state.sheets);}catch{}
    return this.progress(token,m,identity,false);
  }
}
