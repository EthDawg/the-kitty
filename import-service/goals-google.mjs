import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildTemplate} from '../templates/build.mjs';
import {ImportError,digest,RECEIPT_TAB,RECEIPT_HEADERS} from './core.mjs';
const require=createRequire(import.meta.url),Contract=require('../native-core/sheet-contract.js');
const sourceBytes=readFileSync(new URL('../templates/source/davies-v1.json',import.meta.url));
if(createHash('sha256').update(sourceBytes).digest('hex')!=='41743ff2a6bcbc21fc112656a4a3af71d9d2d233aa23657e801b3112ad4268ab')throw new Error('The pinned goal template changed.');
const source=JSON.parse(sourceBytes).sheets.find(s=>s.properties.title==='Goals');
export const GOAL_HEADERS=source.cells.filter(c=>c.row===1&&c.column<=10).map(c=>c.value.stringValue);
const original=source.cells.filter(c=>c.row===2&&c.column>=5&&c.column<=10).map(c=>c.value.formulaValue);
let basic;
export function goalFormulas(profile='legacy',row=2,{dynamic=false}={}){
  if(profile==='au-aud-basic'&&!basic){
    const plan=buildTemplate({profile:'au-aud-basic',sheetVersion:1,country:'AU',currency:'AUD',householdName:'Goal formula fixture',people:['Alex'],openingDate:'2026-06-30',accounts:[{id:'ACC-SAVER',name:'Saver',institution:'Fictional',type:'Savings',owner:'Alex',openingMinor:'10000'}],budgets:[],emergencyAccountId:'ACC-SAVER',goal:{name:'A goal',targetMinor:'20000',targetDate:'2027-06-30',accountId:'ACC-SAVER'}});
    const tab=plan.verification.sheets.find(s=>s.title==='Goals');
    basic=plan.verification.cells.filter(c=>c.sheetId===tab.sheetId&&c.rowIndex===1&&c.columnIndex>=4&&c.columnIndex<=9).sort((a,b)=>a.columnIndex-b.columnIndex).map(c=>c.userEnteredValue.formulaValue);
  }
  return (profile==='au-aud-basic'?basic:original).map(formula=>formula.replace(/\b([B-I])2\b/g,(_,column)=>dynamic?`INDEX($${column}:$${column},ROW())`:`${column}${row}`));
}
const text=value=>value?.stringValue??'';
const value=cell=>cell?.effectiveValue?.numberValue??cell?.effectiveValue?.stringValue??cell?.effectiveValue?.boolValue??cell?.userEnteredValue?.numberValue??cell?.userEnteredValue?.stringValue??cell?.userEnteredValue?.boolValue??'';
const cells=sheet=>{
  const rows=[];
  for(const block of sheet?.data??[])for(const [r,row]of(block.rowData??[]).entries())for(const [c,cell]of(row.values??[]).entries()){
    const ri=(block.startRow??0)+r,ci=(block.startColumn??0)+c;
    rows[ri]??=[];rows[ri][ci]=cell;
  }
  return Array.from({length:rows.length},(_,r)=>rows[r]??[]);
};
export async function readGoalState(driver,token,sheetId){
  const legacy=await driver.readState(token,sheetId);
  const base=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  const meta=await driver.request(token,`${base}?fields=sheets(properties(sheetId,title,gridProperties))`);
  const tabs=Object.fromEntries(meta.sheets.map(s=>[s.properties.title,s.properties]));
  if(!tabs.Goals)throw new ImportError('goal_schema','This Sheet needs its Goals tab. Open the Sheet to restore the Kitty goal table.',409);
  if(tabs.Goals.gridProperties.rowCount>10000||tabs.Goals.gridProperties.columnCount>100)throw new ImportError('goal_limit','The Goals tab is too large to check safely.',409);
  const query=new URL(base);
  for(const range of ["'Goals'","'Accounts'!A1:P","'Settings'!A1:C"])query.searchParams.append('ranges',range);
  query.searchParams.set('fields','sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,note))))');
  const grid=await driver.request(token,query.toString()),byName=Object.fromEntries(grid.sheets.map(s=>[s.properties.title,cells(s)]));
  const goals=byName.Goals??[],accountGrid=byName.Accounts??[],settings=byName.Settings??[];
  const goalRows=goals.slice(1).map((row,i)=>({row:i+2,entered:Array.from({length:10},(_,c)=>row[c]?.userEnteredValue??null),effective:Array.from({length:10},(_,c)=>value(row[c])),errors:row.flatMap((cell,c)=>cell?.effectiveValue?.errorValue?[{column:c,error:cell.effectiveValue.errorValue.type}]:[])})).filter(r=>r.entered.some(Boolean));
  const lastRow=goalRows.at(-1)?.row??1;
  const layoutIssues=goals.flatMap((row,r)=>row.flatMap((cell,c)=>((c>=10&&cell?.userEnteredValue)||(r+1>lastRow&&(cell?.note||cell?.effectiveValue)))?[{row:r+1,column:c+1}]:[]));
  const accountWidth=legacy.version===2?16:9;
  const entered=rows=>rows.map(row=>row.map(cell=>cell?.userEnteredValue??null));
  return {legacy,version:legacy.version,goalTabId:tabs.Goals.sheetId,header:(goals[0]??[]).slice(0,10).map(c=>text(c.userEnteredValue)),rows:goalRows,layoutIssues,
    accountHeader:(accountGrid[0]??[]).map(value),accounts:accountGrid.slice(1).map(row=>Array.from({length:accountWidth},(_,i)=>value(row[i]))).filter(row=>row.some(v=>v!=='')),
    accountInputs:entered(accountGrid),settingsInputs:entered(settings),settings:settings.map(row=>row.map(value)),
    // Adding one goal necessarily adds six formulas. Keep other formulas separate.
    otherFormulaFingerprint:digest((legacy.formulaCells??[]).filter(row=>row[0]!=='Goals'))};
}
export function goalCells(goal,profile){
  const serial=(Date.parse(`${goal.targetDate}T00:00:00Z`)-Date.UTC(1899,11,30))/86400000;
  const values=[{stringValue:goal.name},{numberValue:Number(goal.targetMinor)/100},{numberValue:serial},{stringValue:goal.accountId},...goalFormulas(profile,2,{dynamic:true}).map(formulaValue=>({formulaValue}))];
  return values.map((userEnteredValue,column)=>({userEnteredValue,...(column===2?{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'yyyy-mm-dd'}}}:column===5?{userEnteredFormat:{numberFormat:{type:'PERCENT',pattern:'0.0%'}}}:[1,4,7,8].includes(column)?{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'#,##0.00;(#,##0.00)'}}}:{})}));
}
export function goalRequests(state,manifest,importId,writtenAt){
  // appendCells is a typed batchUpdate operation: Google chooses the row after
  // the final data row. No guessed index, raw values append, copy or overwrite.
  const requests=[{appendCells:{sheetId:state.goalTabId,rows:[{values:goalCells(manifest.goal,manifest.profile)}],fields:'userEnteredValue,userEnteredFormat.numberFormat'}}];
  let receiptId=state.legacy.receiptTabId;
  if(receiptId===undefined){
    receiptId=1900000000;while(state.legacy.allTabIds.includes(receiptId))receiptId--;
    requests.push({addSheet:{properties:{sheetId:receiptId,title:RECEIPT_TAB,hidden:true,gridProperties:{rowCount:1000,columnCount:5}}}});
    requests.push({appendCells:{sheetId:receiptId,rows:[{values:RECEIPT_HEADERS.map(stringValue=>({userEnteredValue:{stringValue}}))}],fields:'userEnteredValue'}});
  }
  const receipt=[importId,manifest.proposalDigest,writtenAt,JSON.stringify(manifest.recordRefs),importId];
  requests.push({appendCells:{sheetId:receiptId,rows:[{values:receipt.map(stringValue=>({userEnteredValue:{stringValue}}))}],fields:'userEnteredValue'}});
  return requests;
}
export const goalAccountHeaders=version=>Contract.describe(version).inputs.Accounts.headers;
