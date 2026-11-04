import {ImportError,HEADERS,digest,pad,isoDate,dateSerial,validDate,validateState,RECEIPT_HEADERS,RECEIPT_TAB} from './core.mjs';

export const TYPED_HEADERS={payslips:['Pay date','Person','Employer','Gross pay','Tax withheld','Super (employer)','Net pay'],valuations:['Month end','Item ID','Value']};
export const RECORD_HEADER='Kitty record ID';
const SHEETS='https://sheets.googleapis.com/v4/spreadsheets';
const quote=s=>`'${s.replace(/'/g,"''")}'`;
const h=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const nonempty=v=>v!=='' && v!==null && v!==undefined;
const minor=(v,{calculated=false}={})=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v*100)>99999999999999||!calculated&&Math.abs(v-Math.round(v*100)/100)>Math.max(1,Math.abs(v))*Number.EPSILON*8)throw new ImportError('invalid_sheet_amount','A required Sheet amount is missing or cannot be represented in supported minor units.',409);return String(Math.round(v*100));};
const dateValue=v=>{let d;try{if(typeof v==='number'&&!Number.isInteger(v))throw new Error();d=isoDate(v);}catch{}if(!validDate(d))throw new ImportError('invalid_sheet_date','A required Sheet date is missing or invalid.',409);return d;};
const cell=v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}});
const valuesOf=entry=>entry?.values??[];
function table(title,grid,properties,width,headers,metadataColumn){
  if(!properties)throw new ImportError('missing_tab',`This Sheet needs its ${title} tab.`,409);
  const first=grid[0]??[];
  if(!headers.every((name,i)=>h(name)===h(first[i])))throw new ImportError('schema_mismatch',`The ${title} columns do not match the Kitty contract.`,409);
  if(metadataColumn!==undefined){
    const heading=first[metadataColumn]??'';
    if(heading!=='' && heading!==RECORD_HEADER)throw new ImportError('metadata_collision',`${title} has custom content in the reserved record-ID column. Nothing was changed.`,409);
    if(heading==='' && grid.slice(1).some(row=>nonempty(row[metadataColumn])))throw new ImportError('metadata_collision',`${title} has data in the reserved record-ID column. Nothing was changed.`,409);
  }
  const rows=[];const ids=new Set();
  for(let i=1;i<grid.length;i++){
    const raw=pad(grid[i],width),id=metadataColumn===undefined?String(raw[0]??''):String(grid[i][metadataColumn]??'');
    if(!raw.some(nonempty)){if(id)throw new ImportError('metadata_orphan','A record ID has no financial row. Repair the Sheet before importing.',409);continue;}
    if(id && ids.has(id))throw new ImportError('duplicate_existing_id',`The ${title} tab contains repeated record IDs.`,409);if(id)ids.add(id);
    rows.push({rowIndex:i,values:raw,id});
  }
  return {title,sheetTabId:properties.sheetId,width,header:pad(first,width),rows,nextRowIndex:rows.length?rows.at(-1).rowIndex+1:1,
    metadataColumn,metadataHeader:metadataColumn===undefined?null:(first[metadataColumn]??''),rowCount:properties.gridProperties.rowCount,columnCount:properties.gridProperties.columnCount};
}
export async function readTypedState(driver,token,sheetId,periodEnd){
  const legacy=await driver.readState(token,sheetId);
  validateState(legacy);
  if(!legacy.currencyPresent)throw new ImportError('sheet_currency','The Sheet currency is missing. Configure it before importing.',409);
  const base=`${SHEETS}/${encodeURIComponent(sheetId)}`;
  const meta=await driver.request(token,`${base}?fields=sheets(properties(sheetId,title,gridProperties))`);
  const tabs=Object.fromEntries(meta.sheets.map(s=>[s.properties.title,s.properties]));
  const payslipRange=`'Payslips'!A1:${tabs.Payslips?.gridProperties.columnCount>=9?'I':'H'}`;
  const valuationRange=`'Valuations'!A1:${tabs.Valuations?.gridProperties.columnCount>=6?'F':'E'}`;
  for(const name of ['Settings','Accounts','Categories','Payslips','Assets','Compliance Checks','Metrics','Valuations'])if(!tabs[name])throw new ImportError('missing_tab',`This Sheet needs its ${name} tab.`,409);
  const ranges=["'Settings'!A1:C",`'Accounts'!A1:${legacy.version===1?'I':'P'}`,"'Categories'!A1:H",payslipRange,"'Assets'!A1:D","'Compliance Checks'!A1:G","'Metrics'!A1:H"];
  if(legacy.version===1)ranges.push(valuationRange);
  const url=new URL(`${base}/values:batchGet`);for(const range of ranges)url.searchParams.append('ranges',range);url.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');
  const raw=await driver.request(token,url.toString());
  const [settings,accounts,categories,payslips,assets,checks,metrics,valuations]=raw.valueRanges.map(valuesOf);
  const requireHeader=(title,actual,expected)=>{if(!expected.every((name,i)=>h(name)===h(actual?.[i])))throw new ImportError('schema_mismatch',`The ${title} columns do not match the Kitty contract.`,409);};
  requireHeader('Accounts',accounts[0],['Account ID','Account','Institution','Type','Owner','Opening balance ($)','Opening date','Balance at as-of date ($)','Liquid',...(legacy.version===2?['Class','Valuation method','Currency','Status','Purpose','Linked account','Note']:[])]);
  requireHeader('Categories',categories[0],['Category ID','Category','Group','Flow']);
  requireHeader('Settings',settings.find(row=>h(row[0])==='setting'),['Setting','Value']);
  if(legacy.version===1)requireHeader('Assets',assets[0],['Item ID','Item','Class','Owner']);
  const inputRanges=["'Settings'!A1:C",payslipRange,...(legacy.version===1?[valuationRange]:["'Transactions'!A1:Q","'Valuations'!A1:E","'Assets'!A1:D","'Balances'!A1:F"])];
  const inputURL=new URL(base);for(const range of inputRanges)inputURL.searchParams.append('ranges',range);inputURL.searchParams.set('fields','sheets(properties(title),data(startRow,startColumn,rowData(values(userEnteredValue))))');
  const grid=await driver.request(token,inputURL.toString());const entered=new Map(),extraFormulas=[];
  for(const sh of grid.sheets??[])for(const block of sh.data??[])for(const [r,row] of(block.rowData??[]).entries())for(const [c,value]of(row.values??[]).entries()){
    const rr=(block.startRow??0)+r,cc=(block.startColumn??0)+c,entry=value.userEnteredValue;
    if(entry){entered.set(`${sh.properties.title}:${rr}:${cc}`,entry);if(entry.formulaValue)extraFormulas.push([sh.properties.title,rr,cc,entry.formulaValue]);}
    if(entry?.formulaValue && ((sh.properties.title==='Payslips' && (cc<7||cc===8)) || (legacy.version===1 && sh.properties.title==='Valuations' && (cc<3||cc===5))))throw new ImportError('formula_in_inputs','A writable source or record-ID column contains a formula. Nothing was changed.',409);
  }
  const tables={ledger:table(legacy.title,[legacy.header,...legacy.rows],tabs[legacy.title],HEADERS[legacy.version].length,HEADERS[legacy.version])};
  // Keep actual row positions, including blank input rows, from the canonical reader.
  tables.ledger.nextRowIndex=legacy.nextRowIndex;tables.ledger.rows=legacy.rows.map(values=>({values,id:String(values[0]),rowIndex:null}));
  tables.payslips=table('Payslips',payslips,tabs.Payslips,7,TYPED_HEADERS.payslips,8);
  if(legacy.version===1)tables.valuations=table('Valuations',valuations,tabs.Valuations,3,TYPED_HEADERS.valuations,5);
  const settingIndex=settings.findIndex(row=>row[0]==='As-of date');
  const asOfInput=entered.get(`Settings:${settingIndex}:1`);
  if(settings.filter(row=>row[0]==='As-of date').length!==1 || !asOfInput || asOfInput.formulaValue)throw new ImportError('asof_contract','The As-of date must be one existing input setting.',409);
  const asOf=dateValue(settings[settingIndex][1]);
  const settingsInputs=[];
  for(let i=0;i<settings.length;i++){
    const value=entered.get(`Settings:${i}:1`);
    if(settings[i]?.[0] && value && !value.formulaValue)settingsInputs.push([String(settings[i][0]),value.numberValue??value.stringValue??value.boolValue??'']);
  }
  const accountRows=accounts.slice(1).filter(row=>row[0]);
  const currency=legacy.currency;
  const normalizedAccounts=accountRows.map(row=>{
    const method=legacy.version===1?'ledger':String(row[10]??'').toLowerCase(),status=legacy.version===1?'active':String(row[12]??'').toLowerCase();
    if(!['ledger','statement','appraisal','market','estimate'].includes(method)||!['active','beta','closed'].includes(status))throw new ImportError('account_contract','An account has a missing or unsupported valuation method/status.',409);
    if(legacy.version===2 && !row[11])throw new ImportError('account_currency','A v2 account currency is missing.',409);
    return {id:String(row[0]),name:String(row[1]??''),type:String(row[3]??''),person:String(row[4]??''),owner:String(row[4]??''),
      openingMinor:minor(row[5]),openingDate:dateValue(row[6]),balanceMinor:minor(row[7],{calculated:true}),currency:legacy.version===1?currency:String(row[11]),ledger:method==='ledger',method,status,...(legacy.version===2?{class:String(row[9]??'')}:{})};
  });
  const itemKind=category=>{if(category==='Loans')return 'liability';if(['Cash','Property','Super','Shares','Vehicle','Crypto','Device'].includes(category))return 'asset';throw new ImportError('item_class','A valuation item has a missing or unsupported class. Resolve it before importing.',409);};
  const itemRows=legacy.version===1?assets.slice(1).filter(row=>row[0]).map(row=>({id:String(row[0]),name:String(row[1]??''),kind:itemKind(String(row[2]??'')),currency,status:'active',valuationRequired:true})):
    normalizedAccounts.filter(a=>!a.ledger).map(a=>({id:a.id,name:a.name,kind:itemKind(a.class),currency:a.currency,method:a.method,status:a.status,valuationRequired:a.status==='active'}));
  const categoriesById=new Map(categories.slice(1).map(row=>[String(row[0]),row]));
  const transactions=legacy.rows.filter(row=>legacy.version===1 || row[1]==='transaction').map(row=>({id:String(row[0]),date:dateValue(row[legacy.version===1?1:2]),accountId:String(row[legacy.version===1?2:3]),description:String(row[legacy.version===1?3:4]??''),bankDescription:String(row[legacy.version===1?3:4]??''),merchant:String(row[legacy.version===1?4:5]??''),amountMinor:minor(row[legacy.version===1?5:6]),categoryId:String(row[legacy.version===1?6:7]??''),person:String(row[legacy.version===1?7:8]??''),status:legacy.version===1?'posted':String(row[11]??''),transferGroup:legacy.version===1?'':String(row[13]??''),flow:String(categoriesById.get(String(row[legacy.version===1?6:7]))?.[3]??'')}));
  if(transactions.some(tx=>!['posted','settled','pending'].includes(tx.status)))throw new ImportError('transaction_status','An existing transaction has an unsupported status.',409);
  const payslipRecords=tables.payslips.rows.map((row,index)=>({kind:'payslip',recordId:row.id||'',sheetRecordId:row.id||'',legacyLocator:`Payslips:${index}`,fields:{payDate:dateValue(row.values[0]),person:String(row.values[1]),employer:String(row.values[2]),currency,valueBasis:'current-period',grossMinor:minor(row.values[3]),taxMinor:minor(row.values[4]),superMinor:minor(row.values[5]),netMinor:minor(row.values[6])}}));
  const valuationRows=legacy.version===1?tables.valuations.rows:tables.ledger.rows.filter(row=>row.values[1]==='valuation');
  const valuationRecords=valuationRows.map((row,index)=>{const amount=minor(row.values[legacy.version===1?2:6]),itemId=String(row.values[legacy.version===1?1:3]),items=itemRows.filter(x=>x.id===itemId);if(items.length!==1)throw new ImportError('valuation_item','An existing valuation does not identify exactly one non-ledger item.',409);return {kind:'valuation',recordId:row.id||'',sheetRecordId:row.id||'',legacyLocator:`Valuations:${index}`,fields:{date:dateValue(row.values[legacy.version===1?0:2]),itemId,currency:items[0].currency,valueMinor:amount,valueKind:items[0].kind},sourceLabel:legacy.version===1?'':String(row.values[19]??'')};});
  const checkRows=checks.filter(row=>['Close','Data','Tax','Cash'].includes(row[1])).map(row=>({id:String(row[0]),type:String(row[1]),items:typeof row[2]==='number'&&Number.isFinite(row[2])?row[2]:null,status:String(row[4]??''),message:String(row[5]??'')}));
  const baseline={schemaVersion:legacy.version,currency,asOf,people:legacy.people,accounts:normalizedAccounts,categories:legacy.categories,items:itemRows,transactions,payslips:payslipRecords,valuations:valuationRecords,checks:checkRows,unresolvedReviews:[]};
  const date=dateValue(periodEnd??asOf);
  baseline.projectedBalances=normalizedAccounts.map(a=>{
    if(a.openingDate>date)return {accountId:a.id,date,amountMinor:'0'};
    let amount=BigInt(a.openingMinor);
    if(a.ledger){for(const tx of transactions)if(tx.accountId===a.id && tx.date>a.openingDate && tx.date<=date && ['posted','settled'].includes(tx.status))amount+=BigInt(tx.amountMinor);}
    else{const vals=valuationRecords.filter(r=>r.fields.itemId===a.id&&r.fields.date<=date).sort((a,b)=>a.fields.date.localeCompare(b.fields.date));if(vals.length)amount=BigInt(vals.at(-1).fields.valueMinor);}
    return {accountId:a.id,date,amountMinor:amount.toString()};
  });
  const formulaFingerprint=digest({legacy:legacy.formulaFingerprint,extra:extraFormulas.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
  const closeMissingRow=metrics.find(row=>row[0]==='close.items_missing');
  return {version:legacy.version,baseline,tables,formulaFingerprint,settingsInputs,
    configuration:{accounts:accountRows.map(row=>row.filter((_,i)=>i!==7)),categories:categories.slice(1).filter(row=>row[0]),items:legacy.version===1?assets.slice(1).filter(row=>row[0]):[]},
    asOfCell:{sheetTabId:tabs.Settings.sheetId,rowIndex:settingIndex,columnIndex:1,value:settings[settingIndex][1]},
    receipts:legacy.receipts,receiptValid:legacy.receiptValid,receiptTabId:legacy.receiptTabId,receiptNextRow:legacy.receiptNextRow,allTabIds:legacy.allTabIds,
    closeMissing:closeMissingRow&&typeof closeMissingRow[2]==='number'&&Number.isFinite(closeMissingRow[2])?closeMissingRow[2]:null,legacy};
}
export const typedDigest=state=>digest({version:state.version,currency:state.baseline.currency,people:state.baseline.people,configuration:state.configuration,settingsInputs:state.settingsInputs,formulaFingerprint:state.formulaFingerprint,
  tables:Object.fromEntries(Object.entries(state.tables).map(([key,t])=>[key,{header:t.header,metadataHeader:t.metadataHeader,rows:t.rows.map(({values,id})=>({values,id}))}]))});

export function typedRequests(state,manifest,importId,writtenAt){
  const requests=[];
  for(const set of manifest.writeSets){
    if(set.kind==='asof'){
      requests.push({updateCells:{start:{sheetId:state.asOfCell.sheetTabId,rowIndex:state.asOfCell.rowIndex,columnIndex:1},rows:[{values:[cell(dateSerial(set.date))]}],fields:'userEnteredValue'}});continue;
    }
    const table=state.tables[set.table],n=set.rows.length;if(!n)continue;
    if(table.metadataColumn!==undefined && table.columnCount<=table.metadataColumn)requests.push({appendDimension:{sheetId:table.sheetTabId,dimension:'COLUMNS',length:table.metadataColumn+1-table.columnCount}});
    if(table.metadataColumn!==undefined && !table.metadataHeader){
      requests.push({updateCells:{start:{sheetId:table.sheetTabId,rowIndex:0,columnIndex:table.metadataColumn},rows:[{values:[cell(RECORD_HEADER)]}],fields:'userEnteredValue'}});
      requests.push({updateDimensionProperties:{range:{sheetId:table.sheetTabId,dimension:'COLUMNS',startIndex:table.metadataColumn,endIndex:table.metadataColumn+1},properties:{hiddenByUser:true},fields:'hiddenByUser'}});
    }
    requests.push({appendDimension:{sheetId:table.sheetTabId,dimension:'ROWS',length:n}});
    requests.push({insertRange:{range:{sheetId:table.sheetTabId,startRowIndex:table.nextRowIndex,endRowIndex:table.nextRowIndex+n,startColumnIndex:0,endColumnIndex:table.width},shiftDimension:'ROWS'}});
    requests.push({updateCells:{start:{sheetId:table.sheetTabId,rowIndex:table.nextRowIndex,columnIndex:0},rows:set.rows.map(row=>({values:row.values.map(cell)})),fields:'userEnteredValue'}});
    if(table.metadataColumn!==undefined){
      requests.push({insertRange:{range:{sheetId:table.sheetTabId,startRowIndex:table.nextRowIndex,endRowIndex:table.nextRowIndex+n,startColumnIndex:table.metadataColumn,endColumnIndex:table.metadataColumn+1},shiftDimension:'ROWS'}});
      requests.push({updateCells:{start:{sheetId:table.sheetTabId,rowIndex:table.nextRowIndex,columnIndex:table.metadataColumn},rows:set.rows.map(row=>({values:[cell(row.id)]})),fields:'userEnteredValue'}});
    }
    for(const columnIndex of set.dateColumns)requests.push({repeatCell:{range:{sheetId:table.sheetTabId,startRowIndex:table.nextRowIndex,endRowIndex:table.nextRowIndex+n,startColumnIndex:columnIndex,endColumnIndex:columnIndex+1},cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy-mm-dd'}}},fields:'userEnteredFormat.numberFormat'}});
  }
  let receiptId=state.receiptTabId,row=state.receiptNextRow;
  if(receiptId===undefined){receiptId=1900000000;while(state.allTabIds.includes(receiptId))receiptId--;requests.push({addSheet:{properties:{sheetId:receiptId,title:RECEIPT_TAB,hidden:true,gridProperties:{rowCount:1000,columnCount:5}}}});requests.push({updateCells:{start:{sheetId:receiptId,rowIndex:0,columnIndex:0},rows:[{values:RECEIPT_HEADERS.map(cell)}],fields:'userEnteredValue'}});row=1;}
  else{requests.push({appendDimension:{sheetId:receiptId,dimension:'ROWS',length:1}});requests.push({insertRange:{range:{sheetId:receiptId,startRowIndex:row,endRowIndex:row+1,startColumnIndex:0,endColumnIndex:5},shiftDimension:'ROWS'}});}
  const receipt=[importId,manifest.proposalDigest,writtenAt,JSON.stringify(manifest.recordRefs),importId];
  requests.push({updateCells:{start:{sheetId:receiptId,rowIndex:row,columnIndex:0},rows:[{values:receipt.map(cell)}],fields:'userEnteredValue'}});
  return requests;
}
