import {AskError,assert} from './core.mjs';
const SHEETS='https://sheets.googleapis.com/v4/spreadsheets/';
const clean=(value,max=200)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,max);
const isoDate=value=>typeof value==='number'?new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000).toISOString().slice(0,10):String(value??'');
function rowsAfter(rows,header,columns=[]){
  const start=rows.findIndex(row=>row[0]===header);
  assert(start>=0,'schema_mismatch','A required Sheet header changed. Restore it before asking.',409);
  const normalize=value=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  assert(columns.every((name,i)=>normalize(rows[start][i])===normalize(name)),'schema_mismatch','Required Sheet columns have moved or changed. Restore them before asking.',409);
  return rows.slice(start+1).map((row,index)=>({row,index:start+index+2})).filter(({row})=>row[0]!==''&&row[0]!==null&&row[0]!==undefined);
}
function money(value,currency){
  assert(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e12,'invalid_fact','A money figure is missing or outside the supported range.',409);
  const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  return value.toFixed(digits);
}
function fact(id,label,value,kind,range,more={}){return {id,label:clean(label),value:clean(value,2000),kind,range,...more};}

/// Fixed GET-only Google reads. There is no caller-controlled URL, method or write API.
export class GoogleFactsReader {
  constructor({fetchImpl=fetch,timeoutMS=15000}={}){this.fetch=fetchImpl;this.timeoutMS=timeoutMS;}
  async get(token,url){
    let response;
    try{response=await this.fetch(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(this.timeoutMS)});}
    catch{throw new AskError('google_unavailable','Your Sheet could not be read. Nothing has been sent to AI.',503);}
    if(response.status===401)throw new AskError('google_reconnect','Reconnect Google before asking.',401);
    if(response.status===403||response.status===404)throw new AskError('sheet_permission','This account cannot read the selected Sheet. Nothing has been sent to AI.',403);
    assert(response.ok,'google_unavailable','Google could not complete the read. Nothing has been sent to AI.',502);
    const declared=Number(response.headers?.get('content-length')??0);
    assert(declared<=2*1024*1024,'sheet_too_large','Choose a narrower question scope.',413);
    let text='';
    if(response.body){const reader=response.body.getReader();let bytes=0;const decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2*1024*1024){await reader.cancel();throw new AskError('sheet_too_large','Choose a narrower question scope.',413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    else {text=await response.text();assert(Buffer.byteLength(text)<=2*1024*1024,'sheet_too_large','Choose a narrower question scope.',413);}
    try{return JSON.parse(text);}catch{throw new AskError('google_invalid','Google returned an unreadable Sheet.',502);}
  }
  async batch(token,sheetId,ranges){
    const url=new URL(`${SHEETS}${encodeURIComponent(sheetId)}/values:batchGet`);
    ranges.forEach(r=>url.searchParams.append('ranges',r));
    url.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');url.searchParams.set('dateTimeRenderOption','SERIAL_NUMBER');
    const data=await this.get(token,url.toString());
    assert(Array.isArray(data.valueRanges)&&data.valueRanges.length===ranges.length,'google_invalid','A Sheet range is missing.',502);
    return data.valueRanges.map(r=>r.values??[]);
  }
  async read(token,sheetId,{scope='overview',transactionId=null}={}){
    assert(typeof sheetId==='string'&&/^[A-Za-z0-9_-]{12,200}$/.test(sheetId),'invalid_sheet','Choose an authorised Kitty Sheet.');
    // A successful Google Sheets read is the authority check, including for read-only household members.
    const names=['Kitty!A1:C','Settings!A1:C'];
    if(scope==='overview'||scope==='spending')names.push('Metrics!A1:H');
    if(scope==='goals'||scope==='overview')names.push('Goals!A1:J');
    if(scope==='spending'||scope==='transaction')names.push('Transactions!A1:J','Categories!A1:D');
    const values=await this.batch(token,sheetId,names);
    const grids=Object.fromEntries(names.map((name,index)=>[name,values[index]]));
    const kitty=rowsAfter(grids['Kitty!A1:C'],'Key',['Key','Value']);
    const versions=kitty.filter(({row})=>row[0]==='sheet_version');
    assert(versions.length===1&&[1,2,'1','2'].includes(versions[0].row[1]),'unsupported_schema','This Sheet has an unknown or missing version.',409);
    const currency=kitty.find(({row})=>row[0]==='currency')?.row[1];
    assert(typeof currency==='string'&&/^[A-Z]{3}$/.test(currency),'invalid_currency','The Sheet needs a currency code.',409);
    try{new Intl.NumberFormat('en',{style:'currency',currency});}catch{throw new AskError('invalid_currency','The Sheet currency is not supported.',409);}
    const settings=rowsAfter(grids['Settings!A1:C'],'Setting',['Setting','Value']);
    const asOf=isoDate(settings.find(({row})=>row[0]==='As-of date')?.row[1]);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(asOf)&&new Date(asOf+'T00:00:00Z').toISOString().slice(0,10)===asOf,'invalid_asof','The Sheet needs a valid as-of date.',409);
    const metrics=grids['Metrics!A1:H']?rowsAfter(grids['Metrics!A1:H'],'Metric ID',['Metric ID','Metric','Value','Unit','Period','Comparison value','Compared with']):[];
    const facts=[];
    const wanted=scope==='spending'?['cashflow.spending.month','cashflow.income.month','cashflow.net.month']:scope==='overview'?['networth.cash','cashflow.income.month','cashflow.spending.month','cashflow.net.month']:[];
    const limitations=['Figures describe the Sheet as recorded; source statements and completeness were not independently verified.'];
    for(const id of wanted){
      const matches=metrics.filter(({row})=>row[0]===id);
      assert(matches.length<=1,'duplicate_metric','A headline metric is repeated in the Sheet.',409);
      if(matches.length===0||matches[0].row[2]===''||matches[0].row[2]===null||matches[0].row[2]===undefined){limitations.push(`The ${id} metric is unavailable.`);continue;}
      const {row,index}=matches[0];
      facts.push(fact(id,row[1],money(row[2],currency),'money',`Metrics!A${index}:H${index}`,{currency,period:clean(row[4],100)}));
      if(typeof row[5]==='number'&&Number.isFinite(row[5]))facts.push(fact(id+'.comparison',clean(row[1])+' — '+clean(row[6],100),money(row[5],currency),'money',`Metrics!F${index}:G${index}`,{currency,period:clean(row[6],100)}));
    }
    if(scope==='overview'||scope==='goals'){
      const goals=rowsAfter(grids['Goals!A1:J'],'Goal',['Goal','Target amount','Target date','Linked account','Balance now']);
      if(goals.length>8)limitations.push('Only the first eight recorded goals are included.');
      for(const {row,index} of goals.slice(0,8)){
        const label=clean(row[0],120),prefix='goal.'+index;
        if(typeof row[1]==='number')facts.push(fact(prefix+'.target',label+' target',money(row[1],currency),'money',`Goals!B${index}`,{currency}));
        if(typeof row[4]==='number')facts.push(fact(prefix+'.balance',label+' linked balance',money(row[4],currency),'money',`Goals!E${index}`,{currency}));
        if(row[2])facts.push(fact(prefix+'.date',label+' target date',isoDate(row[2]),'date',`Goals!C${index}`));
      }
      limitations.push('Goal balances may overlap cash accounts; they are not extra assets.');
    }
    if(scope==='spending'||scope==='transaction'){
      const transactions=rowsAfter(grids['Transactions!A1:J'],'Txn ID',['Txn ID','Date','Account ID','Bank description','Merchant','Amount','Category ID','Person','Receipt held','Note']);
      const categories=rowsAfter(grids['Categories!A1:D'],'Category ID',['Category ID','Category','Group','Flow']);
      const cats=new Map(categories.map(({row})=>[String(row[0]),{name:clean(row[1]),flow:row[3]}]));
      const ids=new Set();
      for(const {row} of transactions){assert(!ids.has(String(row[0])),'duplicate_transaction','The Sheet has repeated transaction IDs.',409);ids.add(String(row[0]));}
      if(scope==='transaction'){
        const found=transactions.find(({row})=>row[0]===transactionId);
        assert(found,'transaction_missing','That transaction is no longer in this Sheet.',404);
        const {row,index}=found,range=`Transactions!A${index}:J${index}`;
        facts.push(fact('transaction.date','Transaction date',isoDate(row[1]),'date',range));
        facts.push(fact('transaction.description','Original bank description',row[3],'text',range));
        facts.push(fact('transaction.merchant','Recorded merchant',row[4],'text',range));
        facts.push(fact('transaction.amount','Signed transaction amount',money(row[5],currency),'money',range,{currency}));
        facts.push(fact('transaction.category','Recorded category',cats.get(String(row[6]))?.name??'Unknown','text',range));
        limitations.push('Only this selected transaction is included; a refund or transfer counterpart was not checked.');
      }else{
        const scale=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
        const factor=10**scale,month=asOf.slice(0,7);const totals=new Map();let included=0;
        for(const {row} of transactions){
          const date=isoDate(row[1]);if(!date.startsWith(month)||date>asOf)continue;
          const category=cats.get(String(row[6]));
          assert(category,'unknown_category','A transaction has an unknown category. Resolve it before asking for spending totals.',409);
          if(category.flow!=='Expense')continue;
          assert(typeof row[5]==='number'&&Number.isFinite(row[5]),'invalid_amount','A transaction amount is missing.',409);
          const minor=Math.round(row[5]*factor);
          assert(Number.isSafeInteger(minor),'invalid_amount','A transaction amount exceeds supported precision.',409);
          totals.set(String(row[6]),(totals.get(String(row[6]))??0)-minor);included++;
        }
        for(const [id,minor]of[...totals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)){
          assert(Number.isSafeInteger(minor),'invalid_amount','The spending total exceeds supported precision.',409);
          facts.push(fact('spending.'+id,cats.get(id).name+' spending',money(minor/factor,currency),'money','Transactions!A:J',{currency,period:month}));
        }
        facts.push(fact('spending.count','Expense records included',String(included),'count','Transactions!A:J',{period:month}));
        limitations.push('Spending groups are derived from recorded expense categories for the as-of month; transfers and income are excluded.');
      }
    }
    assert(facts.length,'facts_missing','No facts are available for this question. Update the Sheet first.',409);
    return {asOf,facts,limitations};
  }
}
