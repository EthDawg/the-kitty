import { randomUUID } from 'node:crypto';
import { ImportError, HEADERS, RECEIPT_TAB, RECEIPT_HEADERS, GATE_PROPERTIES, digest, pad, validateGate, validDate, isoDate, dateSerial } from './core.mjs';
import {readTypedState,typedRequests} from './typed-google.mjs';
import {readGoalState,goalRequests} from './goals-google.mjs';
const DRIVE='https://www.googleapis.com/drive/v3';
const SHEETS='https://sheets.googleapis.com/v4/spreadsheets';
const quote = value => `'${String(value).replace(/'/g,"''")}'`;
const property = (key,value) => `appProperties has { key='${key}' and value='${String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' }`;
const plainCell = value => ({userEnteredValue:typeof value==='number'?{numberValue:value}:typeof value==='boolean'?{boolValue:value}:{stringValue:String(value??'')}});
// Match the known Apps Script feed gate: first exact trimmed key, then a
// trimmed/case-insensitive "yes" value. This says nothing about other sharing.
export function knownPublicFeedEnabled(rows) {
  if(rows.length<2)return false;
  const row=rows.find(r=>String(r[0]).trim()==='public_feed');
  return !!row && String(row[1]).trim().toLowerCase()==='yes';
}
const OPENING_MARKERS=new Set(['template_profile','template_version','template_source_sha256','setup_input_sha256']);
const OPENING_SOURCE_SHA256='41743ff2a6bcbc21fc112656a4a3af71d9d2d233aa23657e801b3112ad4268ab';
const openingProfileRequested = (rows,settings=[]) =>
  rows.some(row=>OPENING_MARKERS.has(String(row[0]).trim().toLowerCase())) ||
  settings.some(row=>['opening anchor date','history starts'].includes(String(row[0]).trim().toLowerCase()));
const openingDate = value => {
  if(typeof value!=='number' || !Number.isInteger(value))return '';
  try{const date=isoDate(value);return validDate(date) && date>='1900-01-01' && date<='2200-12-31'?date:'';}catch{return '';}
};
// This is a write precondition. Keep it as data so a damaged setting does not
// prevent discovery/cancellation/verification of an already-started import.
export function readOpeningContract({kitty,accounts,settings,version,grid}) {
  if(!openingProfileRequested(kitty,settings))return undefined;
  const named=(rows,key)=>rows.filter(row=>String(row[0]).trim()===key);
  const profiles=named(kitty,'template_profile'),versions=named(kitty,'template_version'),sources=named(kitty,'template_source_sha256'),inputs=named(kitty,'setup_input_sha256');
  const result={profile:'au-aud-basic',version:String(versions[0]?.[1]??'').trim()};
  const invalid=message=>({...result,error:message});
  const markerCount=kitty.filter(row=>OPENING_MARKERS.has(String(row[0]).trim().toLowerCase())).length;
  if(markerCount!==4 || profiles.length!==1 || String(profiles[0]?.[1]??'').trim()!=='au-aud-basic' || versions.length!==1 || result.version!=='1.0.0' || version!==1 ||
    sources.length!==1 || String(sources[0]?.[1]??'').trim()!==OPENING_SOURCE_SHA256 || inputs.length!==1 || !/^[a-f0-9]{64}$/.test(String(inputs[0]?.[1]??'').trim()))return invalid('The basic template metadata is missing or changed. Restore its au-aud-basic profile, version 1.0.0, pinned source hash and reviewed setup hash; this Sheet cannot be treated as an unmarked legacy workbook.');
  if(named(settings,'Opening anchor date').length!==1 || named(settings,'History starts').length!==1 || settings[34]?.[0]!=='Opening anchor date' || settings[35]?.[0]!=='History starts')return invalid('The Opening anchor date and History starts settings must remain in Settings A35:B36.');
  const anchor=openingDate(settings[34][1]),history=openingDate(settings[35][1]);
  if(!anchor || !history || dateSerial(history)!==dateSerial(anchor)+1 || !history.endsWith('-01'))return invalid('The opening anchor must be a month end, with history starting the following day.');
  const entered=new Map();
  for(const sh of grid?.sheets??[])for(const block of sh.data??[])for(const [r,row]of(block.rowData??[]).entries())for(const [c,cell]of(row.values??[]).entries())if(cell.userEnteredValue)entered.set(`${sh.properties?.title}:${(block.startRow??0)+r}:${(block.startColumn??0)+c}`,cell.userEnteredValue);
  if(entered.get('Settings:34:1')?.numberValue!==settings[34][1] || entered.get('Settings:35:1')?.formulaValue!=='=B35+1')return invalid('Keep the opening anchor as its original date input and History starts as =B35+1.');
  if(String(accounts[0]?.[0]??'').trim()!=='Account ID' || String(accounts[0]?.[6]??'').trim()!=='Opening date')return invalid('The Accounts ID and Opening date columns no longer match this template.');
  const rows=accounts.slice(1).map((row,index)=>({row,index:index+1})).filter(({row})=>row[0]);
  if(!rows.length || new Set(rows.map(({row})=>String(row[0]))).size!==rows.length)return invalid('This template needs uniquely identified accounts with a common opening date.');
  if(rows.some(({row,index})=>openingDate(row[6])!==anchor || entered.get(`Accounts:${index}:6`)?.numberValue!==row[6]))return invalid('Every Accounts opening date must be the same date input as Settings Opening anchor date.');
  return {...result,openingDate:anchor};
}
export class GoogleDriver {
  constructor({fetchImpl=fetch}={}) { this.fetch=fetchImpl; }
  async request(token,url,{method='GET',body,headers={}}={}) {
    if(typeof token!=='string' || !token || token.length>8192) throw new ImportError('unauthorized','Reconnect Google to continue.',401);
    let response;
    const binary=Buffer.isBuffer(body)||body instanceof Uint8Array;
    try { response=await this.fetch(url,{method,headers:{Authorization:`Bearer ${token}`,...headers,...(body && typeof body!=='string'&&!binary?{'Content-Type':'application/json'}:{})},body:body?typeof body==='string'||binary?body:JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)}); }
    catch { throw new ImportError('provider_unavailable','Google did not confirm this request. Check the import before retrying.',503); }
    if(!response.ok) {
      const code=response.status===401?'google_reconnect':response.status===403?'google_permission':response.status===404?'not_found':'google_request_failed';
      throw new ImportError(code,response.status===403?'This Google account cannot edit the selected file.':response.status===404?'The requested Google file is unavailable.':'Google could not complete this request.',response.status===401?401:response.status===403?403:response.status===404?404:502);
    }
    if(response.status===204) return null;
    return response.json();
  }
  async authorize(token,sheetId) {
    const meta=await this.request(token,`${DRIVE}/files/${encodeURIComponent(sheetId)}?fields=id,mimeType,trashed,capabilities(canEdit)`);
    if(meta.trashed || meta.mimeType!=='application/vnd.google-apps.spreadsheet' || meta.capabilities?.canEdit!==true) throw new ImportError('sheet_permission','Choose a Google Sheet you can edit.',403);
  }
  async readSheetGate(token,sheetId) {
    const meta=await this.request(token,`${DRIVE}/files/${encodeURIComponent(sheetId)}?fields=id,appProperties`);
    const props=meta.appProperties??{};
    if(!Object.values(GATE_PROPERTIES).some(key=>Object.hasOwn(props,key)))return null;
    const gate=Object.fromEntries(Object.entries(GATE_PROPERTIES).map(([key,property])=>[key,props[property]]));
    gate.version=Number(gate.version);
    return validateGate(gate);
  }
  async writeSheetGate(token,sheetId,gate) {
    validateGate(gate);
    const current=await this.readSheetGate(token,sheetId);
    if(current && digest(current)!==digest(gate))throw new ImportError('sheet_import_pending','Another import is awaiting verification.',409);
    const appProperties=Object.fromEntries(Object.entries(GATE_PROPERTIES).map(([key,property])=>[property,String(gate[key])]));
    // Drive properties are NOT compare-and-swap. This requires the single service queue.
    await this.request(token,`${DRIVE}/files/${encodeURIComponent(sheetId)}?fields=id`,{method:'PATCH',body:{appProperties}});
  }
  async clearSheetGate(token,sheetId,expected) {
    const current=await this.readSheetGate(token,sheetId);
    if(!current)return true;
    if(digest(current)!==digest(expected))return false;
    const appProperties=Object.fromEntries(Object.values(GATE_PROPERTIES).map(property=>[property,null]));
    await this.request(token,`${DRIVE}/files/${encodeURIComponent(sheetId)}?fields=id`,{method:'PATCH',body:{appProperties}});
    return await this.readSheetGate(token,sheetId)===null;
  }
  async readState(token,sheetId) {
    const base=`${SHEETS}/${encodeURIComponent(sheetId)}`;
    const meta=await this.request(token,`${base}?fields=sheets(properties(sheetId,title,gridProperties))`);
    const tabs=Object.fromEntries(meta.sheets.map(s=>[s.properties.title,s.properties]));
    for(const title of ['Kitty','Accounts','Categories']) if(!tabs[title]) throw new ImportError('missing_tab',`This Sheet needs its ${title} tab.`);
    const setupNames=['Kitty','Accounts','Categories',...(tabs.Settings?['Settings']:[])];
    const setupURL=new URL(`${base}/values:batchGet`);
    for(const title of setupNames) setupURL.searchParams.append('ranges',`${quote(title)}!A1:Z`);
    setupURL.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');
    const setup=await this.request(token,setupURL.toString());
    const [kitty,accounts,categories,openingSettings=[]]=setup.valueRanges.map(r=>r.values??[]);
    const hasOpeningProfile=openingProfileRequested(kitty,openingSettings);
    const accountCurrencyColumn=(accounts[0]??[]).findIndex(value=>String(value).trim().toLowerCase()==='currency');
    const version=Number(kitty.find(r=>r[0]==='sheet_version')?.[1]);
    if(!HEADERS[version]) throw new ImportError('unsupported_schema','This Sheet has no supported sheet_version.');
    const title=version===1?'Transactions':'Entries';
    if(!tabs[title]) throw new ImportError('missing_tab',`This Sheet needs its ${title} tab.`);
    const width=HEADERS[version].length;
    const lastColumn=version===1?'J':'T';
    const ranges=[`${quote(title)}!A1:${lastColumn}`];
    if(tabs[RECEIPT_TAB]) ranges.push(`${quote(RECEIPT_TAB)}!A1:E`);
    const query=new URL(`${base}/values:batchGet`);
    for(const r of ranges)query.searchParams.append('ranges',r);
    query.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');
    const values=await this.request(token,query.toString());
    const table=values.valueRanges[0].values??[];
    const receiptTable=values.valueRanges[1]?.values??[];
    // Inspect actual formulaValue fields, not strings beginning with "=" (which can be literal source text).
    const inputQuery=new URL(base);
    inputQuery.searchParams.append('ranges',`${quote(title)}!A1:${lastColumn}`);
    inputQuery.searchParams.set('fields','sheets(data(startRow,startColumn,rowData(values(userEnteredValue))))');
    const inputGrid=await this.request(token,inputQuery.toString());
    const inputFormulas=[];
    for(const sh of inputGrid.sheets??[])for(const block of sh.data??[])for(const [r,row]of(block.rowData??[]).entries())for(const [c,cell]of(row.values??[]).entries())if(cell.userEnteredValue?.formulaValue)inputFormulas.push([(block.startRow??0)+r+1,(block.startColumn??0)+c+1]);
    const formulaRanges={Transactions:'K2:Q2',Entries:'U2:U2',Payslips:'H2:H2',Valuations:'D2:E2',Accounts:'A1:P',Goals:'A1:J',Metrics:'A1:H','Compliance Checks':'A1:G','Cash Flow':'A1:T',Budget:'A1:I','Savings Finder':'A1:G','Mortgage Scenarios':'A1:H','Tax Forecast':'A1:F','Net Worth':'A1:I'};
    const formulaQuery=new URL(base);
    for(const [name,range] of Object.entries(formulaRanges))if(tabs[name])formulaQuery.searchParams.append('ranges',`${quote(name)}!${range}`);
    if(hasOpeningProfile && tabs.Settings)formulaQuery.searchParams.append('ranges',"'Settings'!A1:C");
    formulaQuery.searchParams.set('fields','sheets(properties(title),data(startRow,startColumn,rowData(values(userEnteredValue))))');
    const formulaGrid=await this.request(token,formulaQuery.toString());
    const formulas=[],openingCheckInputs=[];
    for(const sh of formulaGrid.sheets??[])for(const block of sh.data??[])for(const [r,row]of(block.rowData??[]).entries())for(const [c,cell]of(row.values??[]).entries()){
      const tab=sh.properties.title,rowIndex=(block.startRow??0)+r,columnIndex=(block.startColumn??0)+c;
      if(cell.userEnteredValue?.formulaValue)formulas.push([tab,rowIndex,columnIndex,cell.userEnteredValue.formulaValue]);
      if(hasOpeningProfile && cell.userEnteredValue && (
        tab==='Compliance Checks' && rowIndex>=4 && rowIndex<=27 && columnIndex<=6 ||
        tab==='Settings' && columnIndex===1 && (rowIndex>=6&&rowIndex<=9 || rowIndex>=33&&rowIndex<=35) ||
        tab==='Transactions' && rowIndex===1 && columnIndex>=10 && columnIndex<=16 ||
        tab==='Payslips' && rowIndex===1 && columnIndex===7
      ))openingCheckInputs.push({tab,rowIndex,columnIndex,userEnteredValue:cell.userEnteredValue});
    }
    // Settings was not historically part of this fingerprint. Its new-profile
    // guard must not change a pre-existing Sheet's receipt or provenance hashes.
    const formulaFingerprint=digest(formulas.filter(row=>row[0]!=='Settings').sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const openingContract=readOpeningContract({kitty,accounts,settings:openingSettings,version,grid:formulaGrid});
    const meaningful=table.map((r,i)=>({r:pad(r,width),i})).filter(({r,i})=>i>0 && r.some(v=>v!==''));
    const receiptValid=!tabs[RECEIPT_TAB] || JSON.stringify(receiptTable[0])===JSON.stringify(RECEIPT_HEADERS);
    return {version,publicFeedEnabled:knownPublicFeedEnabled(kitty),currencyPresent:kitty.some(r=>r[0]==='currency'&&typeof r[1]==='string'&&r[1].trim()),people:[...new Set(['Joint',...String(kitty.find(r=>r[0]==='people')?.[1]??'').split(',').map(v=>v.trim()).filter(Boolean)])],currency:String(kitty.find(r=>r[0]==='currency')?.[1]??'AUD'),title,sheetTabId:tabs[title].sheetId,rowCount:tabs[title].gridProperties.rowCount,header:table[0]??[],rows:meaningful.map(x=>x.r),nextRowIndex:meaningful.length?meaningful.at(-1).i+1:1,inputFormulas,
      ...(openingContract?{openingContract,openingCheckInputs}:{}),
      accounts:accounts.slice(1).filter(r=>r[0]).map(r=>({id:String(r[0]),name:String(r[1]??''),owner:String(r[4]??''),...(accountCurrencyColumn>=0?{currency:String(r[accountCurrencyColumn]??'')}:{}) ,...(openingContract?{openingDate:openingDate(r[6])}:{})})),
      categories:categories.slice(1).filter(r=>r[0]).map(r=>({id:String(r[0]),name:String(r[1]??'')})),
      formulaFingerprint,formulaCells:formulas.filter(row=>row[0]!=='Settings').sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),receiptValid,receiptTabId:tabs[RECEIPT_TAB]?.sheetId,receiptNextRow:receiptTable.length,allTabIds:Object.values(tabs).map(x=>x.sheetId),
      receipts:receiptTable.slice(1).filter(r=>r[0]).map(r=>({importId:r[0],digest:r[1],writtenAt:r[2],ids:r[3],manifestFile:r[4]}))};
  }
  async findFiles(token,props) {
    const query=new URL(`${DRIVE}/files`);
    query.searchParams.set('q',`trashed=false and ${Object.entries(props).map(([k,v])=>property(k,v)).join(' and ')}`);
    query.searchParams.set('fields','files(id,appProperties),nextPageToken'); query.searchParams.set('pageSize','100');
    const result=await this.request(token,query.toString());
    return result.files??[];
  }
  async upload(token,metadata,contents,mimeType) {
    const boundary=`kitty_${randomUUID()}`;
    const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),Buffer.isBuffer(contents)?contents:Buffer.from(contents,'utf8'),Buffer.from(`\r\n--${boundary}--`)]);
    return this.request(token,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
  }
  async folder(token,sheetId) {
    const props={kittyKind:'evidence-folder',kittySheet:sheetId};
    const found=(await this.findFiles(token,props))[0];
    if(found)return found.id;
    return (await this.request(token,`${DRIVE}/files?fields=id`,{method:'POST',body:{name:`The Kitty imports · ${sheetId.slice(0,8)}`,mimeType:'application/vnd.google-apps.folder',appProperties:props}})).id;
  }
  async storeSource(token,sheetId,file) {
    const props={kittyKind:'source',kittySheet:sheetId,kittyHash:file.sha256};
    const matches=await this.findFiles(token,props);
    if(matches[0]) return {sourceId:file.id,fileId:matches[0].id,sha256:file.sha256};
    const mime=file.mimeType??'text/csv';
    const result=await this.upload(token,{parents:[await this.folder(token,sheetId)],name:file.name.replace(/[\u0000-\u001f]/g,'_'),mimeType:mime,appProperties:props},file.bytes??file.text,mime);
    return {sourceId:file.id,fileId:result.id,sha256:file.sha256};
  }
  async reserveID(token) { return (await this.request(token,`${DRIVE}/files/generateIds?count=1&space=drive&type=files`)).ids[0]; }
  async storeManifest(token,manifest) {
    const result=await this.upload(token,{parents:[await this.folder(token,manifest.sheetId)],name:`Kitty import ${manifest.createdAt}.json`,mimeType:'application/json',appProperties:{kittyKind:'manifest',kittySheet:manifest.sheetId,kittyDigest:manifest.proposalDigest}},JSON.stringify(manifest),'application/json');
    return result.id;
  }
  async loadManifest(token,importId,sheetId) {
    if(typeof importId!=='string' || !/^[\w-]{10,200}$/.test(importId))throw new ImportError('invalid_import','This import ID is invalid.');
    const meta=await this.request(token,`${DRIVE}/files/${encodeURIComponent(importId)}?fields=id,appProperties,trashed`);
    if(meta.trashed || meta.appProperties?.kittyKind!=='manifest' || meta.appProperties.kittySheet!==sheetId)throw new ImportError('import_permission','This import does not belong to the selected Sheet.',403);
    const manifest=await this.request(token,`${DRIVE}/files/${encodeURIComponent(importId)}?alt=media`);
    const {proposalDigest,...original}=manifest;
    if(manifest.sheetId!==sheetId || ![1,2,3].includes(manifest.contract) || digest(original)!==proposalDigest || proposalDigest!==meta.appProperties.kittyDigest)throw new ImportError('manifest_changed','The prepared import changed. Prepare a new import.',409);
    return manifest;
  }
  async verifySources(token,manifest) {
    for (const source of manifest.sourceFiles) {
      const response=await this.fetch(`${DRIVE}/files/${encodeURIComponent(source.fileId)}?alt=media`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
      if(!response.ok || digest(Buffer.from(await response.arrayBuffer()))!==source.sha256) throw new ImportError('source_changed','An original source file is missing or changed. Nothing was written.',409);
    }
  }
  async findIntent(token,intentFileId,sheetId) {
    try {
      const item=await this.request(token,`${DRIVE}/files/${encodeURIComponent(intentFileId)}?fields=id,appProperties,trashed`);
      if(item.appProperties?.kittyKind!=='intent'||item.appProperties?.kittySheet!==sheetId)throw new ImportError('intent_changed','The import write record changed. Nothing was written.',409);
      return {...item,status:item.appProperties.kittyIntent??'writing'};
    } catch(error) { if(error.code==='not_found')return null;throw error; }
  }
  async storeIntent(token,intentFileId,importId,sheetId,intent) {
    return this.upload(token,{id:intentFileId,parents:[await this.folder(token,sheetId)],name:`Kitty import ${importId} write intent.json`,mimeType:'application/json',appProperties:{kittyKind:'intent',kittySheet:sheetId,kittyImport:importId,kittyIntent:intent.status??'writing'}},JSON.stringify(intent),'application/json');
  }
  async readTypedState(token,sheetId,periodEnd){return readTypedState(this,token,sheetId,periodEnd);}
  async readGoalState(token,sheetId){return readGoalState(this,token,sheetId);}
  async atomicGoalInsert(token,sheetId,state,manifest,importId,writtenAt){return this.request(token,`${SHEETS}/${encodeURIComponent(sheetId)}:batchUpdate`,{method:'POST',body:{requests:goalRequests(state,manifest,importId,writtenAt)}});}
  async atomicTypedInsert(token,sheetId,state,manifest,importId,writtenAt){return this.request(token,`${SHEETS}/${encodeURIComponent(sheetId)}:batchUpdate`,{method:'POST',body:{requests:typedRequests(state,manifest,importId,writtenAt)}});}
  async atomicInsert(token,sheetId,state,manifest,importId,writtenAt) {
    const width=HEADERS[state.version].length;
    const count=manifest.targetRows.length;
    const requests=[];
    // Grow at the bottom, then shift only raw input cells. Do not move ARRAYFORMULA anchors.
    requests.push({appendDimension:{sheetId:state.sheetTabId,dimension:'ROWS',length:count}});
    requests.push({insertRange:{range:{sheetId:state.sheetTabId,startRowIndex:state.nextRowIndex,endRowIndex:state.nextRowIndex+count,startColumnIndex:0,endColumnIndex:width},shiftDimension:'ROWS'}});
    requests.push({updateCells:{start:{sheetId:state.sheetTabId,rowIndex:state.nextRowIndex,columnIndex:0},rows:manifest.targetRows.map(row=>({values:row.map(plainCell)})),fields:'userEnteredValue'}});
    // Numeric date cells stay compatible with all existing formulas and display as dates.
    for(const columnIndex of state.version===1?[1]:[2,12])requests.push({repeatCell:{range:{sheetId:state.sheetTabId,startRowIndex:state.nextRowIndex,endRowIndex:state.nextRowIndex+count,startColumnIndex:columnIndex,endColumnIndex:columnIndex+1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy-mm-dd'}}},fields:'userEnteredFormat.numberFormat'}});
    let receiptId=state.receiptTabId;
    let receiptRow=state.receiptNextRow;
    if(receiptId===undefined) {
      receiptId=1900000000;
      while(state.allTabIds.includes(receiptId))receiptId--;
      requests.push({addSheet:{properties:{sheetId:receiptId,title:RECEIPT_TAB,hidden:true,gridProperties:{rowCount:1000,columnCount:5}}}});
      requests.push({updateCells:{start:{sheetId:receiptId,rowIndex:0,columnIndex:0},rows:[{values:RECEIPT_HEADERS.map(plainCell)}],fields:'userEnteredValue'}});
      receiptRow=1;
    } else {
      requests.push({appendDimension:{sheetId:receiptId,dimension:'ROWS',length:1}});
      requests.push({insertRange:{range:{sheetId:receiptId,startRowIndex:receiptRow,endRowIndex:receiptRow+1,startColumnIndex:0,endColumnIndex:5},shiftDimension:'ROWS'}});
    }
    const receipt=[importId,manifest.proposalDigest,writtenAt,JSON.stringify(manifest.targetRows.map(r=>r[0])),importId];
    requests.push({updateCells:{start:{sheetId:receiptId,rowIndex:receiptRow,columnIndex:0},rows:[{values:receipt.map(plainCell)}],fields:'userEnteredValue'}});
    return this.request(token,`${SHEETS}/${encodeURIComponent(sheetId)}:batchUpdate`,{method:'POST',body:{requests}});
  }
}
