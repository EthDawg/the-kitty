// Offline acceptance helper. Reads a saved normalized Google grid, makes no
// network calls, and exercises the production import readers/projection.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {GoogleDriver} from './google-rest.mjs';
import {readTypedState} from './typed-google.mjs';
import {verifyBasicCloseChecks} from './basic-close.mjs';

const column=value=>[...value].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
export function savedGridDriver(snapshot){
  const value=cell=>cell.effectiveValue?.numberValue??cell.effectiveValue?.stringValue??cell.effectiveValue?.boolValue??'';
  const range=input=>{const match=input.match(/^'(.*)'!([A-Z]+)(\d+):([A-Z]+)(\d*)$/);if(!match)throw new Error('Unsupported saved-grid range.');return {title:match[1].replaceAll("''","'"),r0:Number(match[3])-1,r1:match[5]?Number(match[5])-1:Infinity,c0:column(match[2]),c1:column(match[4])};};
  const cellsFor=r=>{const sheet=snapshot.sheets.find(sheet=>sheet.title===r.title);return snapshot.cells.filter(cell=>cell.sheetId===sheet?.sheetId&&cell.rowIndex>=r.r0&&cell.rowIndex<=r.r1&&cell.columnIndex>=r.c0&&cell.columnIndex<=r.c1);};
  const grid=(r,entered)=>{
    const rows=[];
    for(const cell of cellsFor(r)){const actual=entered?cell.userEnteredValue:value(cell);if(actual===undefined||actual==='')continue;const row=rows[cell.rowIndex-r.r0]??=[];row[cell.columnIndex-r.c0]=entered?{userEnteredValue:actual}:actual;}
    return Array.from({length:rows.length},(_,i)=>{const row=rows[i]??[];return Array.from({length:row.length},(_,j)=>row[j]??(entered?{}:''));});
  };
  return new GoogleDriver({fetchImpl:async address=>{
    const url=new URL(address),ranges=url.searchParams.getAll('ranges').map(range);let answer;
    if(url.pathname.endsWith('/values:batchGet'))answer={valueRanges:ranges.map(r=>({values:grid(r,false)}))};
    else if(!ranges.length)answer={sheets:snapshot.sheets.map(sheet=>({properties:{sheetId:sheet.sheetId,title:sheet.title,gridProperties:{rowCount:sheet.rowCount,columnCount:sheet.columnCount}}}))};
    else answer={sheets:ranges.map(r=>({properties:{title:r.title},data:[{startRow:r.r0,startColumn:r.c0,rowData:grid(r,true).map(values=>({values}))}]}))};
    return new Response(JSON.stringify(answer));
  }});
}
export async function inspectBasicClose(snapshot,periodEnd){
  const state=await readTypedState(savedGridDriver(snapshot),'offline-fixture','fictional_saved_grid_123456',periodEnd);
  return {asOf:state.baseline.asOf,periodEnd,openingContract:state.legacy.openingContract,projectionIssues:state.closeProjection?.issues??[],projectedBalances:state.baseline.projectedBalances,checks:state.baseline.checks,readbackIssues:state.baseline.asOf===periodEnd?verifyBasicCloseChecks(state):null};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2]||!process.argv[3])throw new Error('Supply a saved normalized provider-state JSON file and YYYY-MM-DD target month end.');
  console.log(JSON.stringify(await inspectBasicClose(JSON.parse(readFileSync(process.argv[2],'utf8')),process.argv[3]),null,2));
}
