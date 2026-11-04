import {randomUUID} from 'node:crypto';
import {SetupError,validID} from './core.mjs';
import {canonical} from './verify.mjs';

const DRIVE='https://www.googleapis.com/drive/v3';
const SHEETS='https://sheets.googleapis.com/v4/spreadsheets';
const MIME='application/vnd.google-apps.spreadsheet';
const META='id,mimeType,ownedByMe,trashed,driveId,capabilities(canEdit),appProperties';
const quote=value=>`'${value.replaceAll("'","''")}'`;
const property=(key,value)=>`appProperties has { key='${key}' and value='${value.replaceAll('\\','\\\\').replaceAll("'","\\'")}' }`;
const fail=(code,message,status=409)=>{throw new SetupError(code,message,status);};
const properties=spec=>({kittySetup:spec.setupId,kittySetupDigest:spec.digest,kittySetupKind:spec.kind,...(spec.stage?{kittySetupStage:spec.stage,kittySetupStatus:spec.status}:{})});
const column=number=>{let result='';for(;number;number=Math.floor((number-1)/26))result=String.fromCharCode(65+(number-1)%26)+result;return result;};

export class GoogleSetupDriver {
  constructor({fetchImpl=fetch}={}){this.fetch=fetchImpl;}
  async request(token,url,{method='GET',body,headers={},limit=16*1024*1024}={}){
    if(typeof token!=='string'||!token||token.length>8192)fail('unauthorized','Reconnect Google to check this saved setup.',401);
    const binary=Buffer.isBuffer(body);let response;
    try{response=await this.fetch(url,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,...(body&&!binary?{'Content-Type':'application/json'}:{}),...headers},body:body?binary?body:JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});}
    catch{fail('google_unavailable','Google did not confirm this request. Keep the saved setup and check its status.',503);}
    if(!response.ok){
      const status=response.status;
      fail(status===404?'not_found':status===409?'already_exists':status===401?'google_reconnect':status===403?'google_permission':'google_request_failed',status===404?'The saved Google file is not available. Keep its setup identity.':status===403?'This Google account cannot access the saved setup.':'Google did not confirm this request. Check the saved setup before continuing.',[401,403,404,409].includes(status)?status:502);
    }
    if(response.status===204)return null;
    try{
      if(Number(response.headers.get('content-length'))>limit)fail('provider_response_limit','Google returned more data than this setup can safely verify.',503);
      let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)fail('provider_response_limit','Google returned more data than this setup can safely verify.',503);chunks.push(chunk);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch(error){if(error instanceof SetupError)throw error;fail('provider_response_invalid','The complete Google response could not be verified. Check this saved setup.',503);}
  }
  async identity(token){const result=await this.request(token,`${DRIVE}/about?fields=user(permissionId)`);if(typeof result.user?.permissionId!=='string'||!result.user.permissionId||result.user.permissionId.length>100)fail('google_identity','The owning Google identity could not be confirmed.',401);return {permissionId:result.user.permissionId};}
  async reserveIDs(token,count){const result=await this.request(token,`${DRIVE}/files/generateIds?count=${count}&space=drive&type=files&fields=ids`);return result.ids??[];}
  async metadata(token,id,{optional=false}={}){try{return await this.request(token,`${DRIVE}/files/${encodeURIComponent(id)}?fields=${META}`);}catch(error){if(optional&&error.code==='not_found')return null;throw error;}}
  async assertOwnedPrivate(token,id,identity,spec,metadata){
    const meta=metadata??await this.metadata(token,id),props=meta.appProperties??{};
    if(meta.id!==id||meta.ownedByMe!==true||meta.capabilities?.canEdit!==true||meta.trashed===true||meta.driveId||meta.mimeType!==(spec.kind==='workbook'?MIME:'application/json'))fail('setup_owner_changed','The saved setup must remain an editable file owned by this Google account in My Drive.');
    if(Object.entries(properties(spec)).some(([key,value])=>props[key]!==value))fail('setup_marker_changed','The setup identity on the Google file changed. Nothing further will be written.');
    const permissions=[];let next='',seen=new Set();
    for(let page=0;page<100;page++){
      const query=new URL(`${DRIVE}/files/${encodeURIComponent(id)}/permissions`);query.searchParams.set('fields','nextPageToken,permissions(id,type,role,deleted)');query.searchParams.set('pageSize','100');if(next)query.searchParams.set('pageToken',next);
      const result=await this.request(token,query.toString());if(!Array.isArray(result.permissions))fail('setup_permissions_unknown','The new file permissions could not be read completely.');permissions.push(...result.permissions);
      if(!result.nextPageToken){next='';break;}if(seen.has(result.nextPageToken))fail('setup_permissions_unknown','The new file permissions could not be read completely.');seen.add(result.nextPageToken);next=result.nextPageToken;
    }
    if(next)fail('setup_permissions_unknown','The new file permissions could not be read completely.');
    // This is deliberately owner-only for NEW setup files; existing household
    // import permissions have a separate, less restrictive policy.
    if(permissions.length!==1||permissions[0].id!==identity.permissionId||permissions[0].type!=='user'||permissions[0].role!=='owner'||permissions[0].deleted===true)fail('setup_permissions_changed','The new setup file has unexpected sharing. Resolve its access before continuing.');
    return meta;
  }
  async loadJSON(token,id,spec,identity,{optional=false}={}){
    const meta=await this.metadata(token,id,{optional});if(!meta)return null;
    await this.assertOwnedPrivate(token,id,identity,spec,meta);
    const value=await this.request(token,`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`,{limit:4*1024*1024});
    if(!value||Array.isArray(value)||typeof value!=='object')fail('setup_record_invalid','The saved setup record is not a JSON object.');
    return {value,meta};
  }
  async loadManifest(token,id,digest,identity,{optional=false}={}){
    const result=await this.loadJSON(token,id,{kind:'manifest',setupId:id,digest},identity,{optional});
    if(!result)return null;
    if(result.value.setupId!==id||result.value.proposalDigest!==digest)fail('setup_manifest_changed','The saved setup does not match this receipt.');
    return result.value;
  }
  async loadIntent(token,id,m,stage,identity){
    const meta=await this.metadata(token,id,{optional:true});if(!meta)return null;
    const status=meta.appProperties?.kittySetupStatus;
    if(!['writing',...(stage==='create'?['cancelled']:[])].includes(status))fail('setup_intent_changed','The saved setup attempt has an invalid state.');
    const result=await this.loadJSON(token,id,{kind:'intent',setupId:m.setupId,digest:m.proposalDigest,stage,status},identity);
    const value=result.value;
    if(value.contract!=='kitty-setup-intent/1'||value.setupId!==m.setupId||value.proposalDigest!==m.proposalDigest||value.ownerPermissionId!==identity.permissionId||value.stage!==stage||value.status!==status||(stage==='initialize'&&(!validID(value.sheetId)||!Array.isArray(value.initialSheets))))fail('setup_intent_changed','The saved setup attempt does not match this household.');
    const knownSheetId=result.meta.appProperties?.kittySheet;
    if(knownSheetId!==undefined&&(!validID(knownSheetId)||stage!=='create'||status!=='writing'))fail('setup_intent_changed','The saved workbook recovery identity is invalid.');
    return {...value,...(knownSheetId?{knownSheetId}:{})};
  }
  async putKnownJSON(token,id,value,spec,identity){
    const boundary=`kitty_setup_${randomUUID()}`;
    const metadata={id,name:`The Kitty setup ${spec.kind}${spec.stage?' '+spec.stage:''}`,mimeType:'application/json',appProperties:properties(spec)};
    const body=Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}\r\n--${boundary}--`);
    let created=false;
    try{const result=await this.request(token,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ignoreDefaultVisibility=true&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});created=result?.id===id;}
    catch(error){if(!['already_exists','google_unavailable','provider_response_invalid','google_request_failed'].includes(error.code))throw error;}
    // A timeout/409 never means this request won the one-shot intent. Read the
    // known ID and validate its actual body before observing any saved outcome.
    let loaded;
    if(spec.kind==='manifest')loaded=await this.loadManifest(token,id,spec.digest,identity,{optional:true});
    else loaded=await this.loadIntent(token,id,{setupId:spec.setupId,proposalDigest:spec.digest},spec.stage,identity);
    if(loaded&&spec.kind==='manifest'&&canonical(loaded)!==canonical(value))fail('setup_manifest_changed','The reserved manifest already contains different setup data.');
    if(created&&loaded){const {knownSheetId,...bodyValue}=loaded;if(canonical(bodyValue)!==canonical(value))fail('setup_intent_changed','The saved setup attempt changed before it could be used.');}
    return {created:created&&!!loaded,observed:!!loaded};
  }
  async createWorkbook(token,m){
    // Generated IDs cannot be used for Workspace spreadsheets. The caller must
    // have freshly won its immutable create-intent ID before this single POST.
    const value=await this.request(token,`${DRIVE}/files?ignoreDefaultVisibility=true&fields=id`,{method:'POST',body:{name:m.plan.spreadsheetCreate.properties.title,mimeType:MIME,appProperties:properties({kind:'workbook',setupId:m.setupId,digest:m.proposalDigest})}});
    if(!validID(value?.id))fail('provider_response_invalid','Google did not return a usable workbook identity.',503);return value.id;
  }
  async rememberWorkbook(token,m,identity,sheetId){
    const intent=await this.loadIntent(token,m.createIntentId,m,'create',identity);
    if(!intent||intent.status!=='writing'||(intent.knownSheetId&&intent.knownSheetId!==sheetId))fail('setup_intent_changed','The creation record does not match this workbook.');
    await this.assertOwnedPrivate(token,sheetId,identity,{kind:'workbook',setupId:m.setupId,digest:m.proposalDigest});
    await this.request(token,`${DRIVE}/files/${encodeURIComponent(m.createIntentId)}?fields=id`,{method:'PATCH',body:{appProperties:{kittySheet:sheetId}}});
  }
  async findSheets(token,m){
    const found=[];let next='',seen=new Set();
    for(let page=0;page<100;page++){
      const query=new URL(`${DRIVE}/files`);query.searchParams.set('q',`trashed=false and mimeType='${MIME}' and ${property('kittySetup',m.setupId)}`);query.searchParams.set('spaces','drive');query.searchParams.set('fields','nextPageToken,incompleteSearch,files(id)');query.searchParams.set('pageSize','100');if(next)query.searchParams.set('pageToken',next);
      const result=await this.request(token,query.toString());
      if(result.incompleteSearch===true||!Array.isArray(result.files)||result.files.some(file=>!validID(file.id)))fail('setup_search_incomplete','The complete setup search could not be verified.',503);
      found.push(...result.files);if(!result.nextPageToken){next='';break;}if(seen.has(result.nextPageToken))fail('setup_search_incomplete','The setup search repeated a page.',503);seen.add(result.nextPageToken);next=result.nextPageToken;
    }
    if(next)fail('setup_search_incomplete','The setup search exceeded its verification limit.',503);
    if(new Set(found.map(file=>file.id)).size!==found.length)fail('setup_search_incomplete','The setup search returned repeated workbook identities.',503);
    return found;
  }
  async readWorkbook(token,id){
    const base=`${SHEETS}/${encodeURIComponent(id)}`;
    const fields='spreadsheetId,properties(title,locale,timeZone),namedRanges,developerMetadata,sheets(properties(sheetId,title,sheetType,gridProperties),merges,conditionalFormats,protectedRanges,charts,bandedRanges,tables)';
    const meta=await this.request(token,`${base}?fields=${fields}`);
    const tabs=meta.sheets===undefined?[]:meta.sheets;
    if(meta.spreadsheetId!==id||!meta.properties||!Array.isArray(tabs)||tabs.length>50)fail('setup_grid_invalid','The complete workbook structure could not be verified.',503);
    const sheets=tabs.map(sheet=>({sheetId:sheet.properties.sheetId,title:sheet.properties.title,rowCount:sheet.properties.gridProperties?.rowCount,columnCount:sheet.properties.gridProperties?.columnCount,hasStructuralFeatures:!!['merges','conditionalFormats','protectedRanges','charts','bandedRanges','tables'].find(key=>sheet[key]?.length),sheetType:sheet.properties.sheetType??'GRID'}));
    if(sheets.some(s=>!Number.isInteger(s.sheetId)||typeof s.title!=='string'||s.sheetType!=='GRID'||!Number.isSafeInteger(s.rowCount)||s.rowCount<1||!Number.isSafeInteger(s.columnCount)||s.columnCount<1)||new Set(sheets.map(s=>s.sheetId)).size!==sheets.length||sheets.reduce((sum,s)=>sum+s.rowCount*s.columnCount,0)>1_000_000)fail('setup_grid_limit','The workbook is outside the supported complete-read bounds.',503);
    const cells=[];
    for(let index=0;index<sheets.length;index+=3){
      const group=sheets.slice(index,index+3),query=new URL(base);
      for(const s of group)query.searchParams.append('ranges',`${quote(s.title)}!A1:${column(s.columnCount)}${s.rowCount}`);
      query.searchParams.set('fields','sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,userEnteredFormat(numberFormat),dataValidation))))');
      const grid=await this.request(token,query.toString());
      if(!Array.isArray(grid.sheets)||grid.sheets.length!==group.length||group.some(expected=>grid.sheets.filter(s=>s.properties?.sheetId===expected.sheetId&&s.properties.title===expected.title).length!==1))fail('setup_grid_incomplete','A requested workbook tab was missing from the complete read.',503);
      for(const tab of grid.sheets){const s=group.find(s=>s.sheetId===tab.properties.sheetId);
        for(const block of tab.data??[])for(const [rowIndex,row]of(block.rowData??[]).entries())for(const [columnIndex,cell]of(row.values??[]).entries()){
          const r=(block.startRow??0)+rowIndex,c=(block.startColumn??0)+columnIndex;if(r<0||c<0||r>=s.rowCount||c>=s.columnCount)fail('setup_grid_invalid','Google returned a cell outside the requested grid.',503);
          if(cell.userEnteredValue||cell.effectiveValue||cell.userEnteredFormat?.numberFormat||cell.dataValidation)cells.push({sheetId:s.sheetId,rowIndex:r,columnIndex:c,...(cell.userEnteredValue?{userEnteredValue:cell.userEnteredValue}:{}),...(cell.effectiveValue?{effectiveValue:cell.effectiveValue}:{}),...(cell.userEnteredFormat?.numberFormat?{numberFormat:cell.userEnteredFormat.numberFormat}:{}),...(cell.dataValidation?{dataValidation:cell.dataValidation}:{})});
        }
      }
    }
    // The full grid is bounded; a shape change during the multi-range read is
    // unresolved. This is not a compare-and-swap lock against manual edits.
    const after=await this.request(token,`${base}?fields=${fields}`);if(canonical(meta)!==canonical(after))fail('setup_grid_changed','The workbook changed while it was being verified.',503);
    return {spreadsheetId:id,properties:meta.properties,sheets,cells,hasWorkbookStructure:!!(meta.namedRanges?.length||meta.developerMetadata?.length)};
  }
  async initializeWorkbook(token,id,plan,initialSheets){
    const requests=[...plan.batchUpdate.requests,...initialSheets.map(sheet=>({deleteSheet:{sheetId:sheet.sheetId}}))];
    return this.request(token,`${SHEETS}/${encodeURIComponent(id)}:batchUpdate`,{method:'POST',body:{requests,includeSpreadsheetInResponse:false}});
  }
}
