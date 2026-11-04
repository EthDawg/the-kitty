/* Human-reviewed typed records. Pure JSON in/out; never writes a Sheet or authenticates a file. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./sheet-contract.js'));
  else root.Records=factory(root.SheetContract);
})(typeof globalThis!=='undefined'?globalThis:this,function(C){
  'use strict';
  const specs={
    payslip:{required:['payDate','person','employer','currency','valueBasis','grossMinor','taxMinor','superMinor','netMinor'],optional:['periodStart','periodEnd','deductions','reimbursements','ytd']},
    valuation:{required:['date','itemId','currency','valueMinor','valueKind'],optional:['sourceMethod']},
    statement_balance:{required:['accountId','periodStart','periodEnd','currency','balanceKind','openingMinor','closingMinor','balanceConvention'],optional:[]}
  };
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>JSON.parse(JSON.stringify(value));
  function fail(code,message){const error=new Error(message);error.code=code;throw error;}
  function requireThat(test,code,message){if(!test)fail(code,message);}
  function text(value,name){requireThat(typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=500&&!/[\u0000-\u001f]/.test(value),'field-invalid',name+' must be nonempty plain text.');return value;}
  function date(value,name){requireThat(C.validDate(value),'date-invalid',name+' must be a valid YYYY-MM-DD date.');}
  function known(list,id,label){requireThat(Array.isArray(list),'baseline-missing','The current '+label+' list is unavailable.');const found=list.filter(row=>(typeof row==='string'?row:row.id)===id);requireThat(found.length===1,'unknown-'+label,'Choose exactly one known '+label+' from the current Sheet.');return found[0];}
  function currency(value,baseline,target){requireThat(C.currencies.includes(value),'currency-unsupported','Use a supported two-decimal currency.');requireThat(value===baseline.currency&&(!target||target.currency===value),'currency-mismatch','The record, Sheet and target currency must agree; conversion is not supported.');}
  function identity(record){
    const f=record.fields||record;
    if(record.kind==='payslip')return C.canonical(['payslip',f.payDate,f.person,f.employer]);
    if(record.kind==='valuation')return C.canonical(['valuation',f.date,f.itemId]);
    if(record.kind==='statement_balance')return C.canonical(['statement_balance',f.accountId,f.periodStart,f.periodEnd]);
    fail('record-kind','Unsupported record kind.');
  }
  function sheetFields(record){
    const f=record.fields;
    if(record.kind==='payslip')return {payDate:f.payDate,person:f.person,employer:f.employer,grossMinor:f.grossMinor,taxMinor:f.taxMinor,superMinor:f.superMinor,netMinor:f.netMinor,currency:f.currency,valueBasis:f.valueBasis};
    if(record.kind==='valuation')return {date:f.date,itemId:f.itemId,valueMinor:f.valueMinor,currency:f.currency,valueKind:f.valueKind};
    return clone(f);
  }
  function fields(record,baseline){
    requireThat(plain(record)&&specs[record.kind],'record-kind','Choose payslip, valuation or statement_balance.');
    const f=record.fields,spec=specs[record.kind];
    requireThat(plain(f),'fields-missing','The record fields are missing.');
    requireThat(Object.keys(f).every(key=>spec.required.concat(spec.optional).includes(key)),'field-unknown','The record contains an unsupported field.');
    for(const key of spec.required)requireThat(Object.prototype.hasOwnProperty.call(f,key),'field-missing','Confirm '+key+' from the original source.');
    for(const key of Object.keys(f))if(/Minor$/.test(key))C.minor(f[key]);
    if(record.kind==='payslip'){
      date(f.payDate,'Pay date');text(f.person,'Person');text(f.employer,'Employer');known(baseline.people,f.person,'person');currency(f.currency,baseline);
      requireThat(f.valueBasis==='current-period','payslip-basis','Payslip amounts must be current-period amounts. YTD is context only.');
      if(f.periodStart!==undefined)date(f.periodStart,'Period start');if(f.periodEnd!==undefined)date(f.periodEnd,'Period end');
      requireThat((f.periodStart===undefined)===(f.periodEnd===undefined),'period-incomplete','Provide both payslip period dates or neither.');
      if(f.periodStart!==undefined)requireThat(f.periodStart<=f.periodEnd,'period-invalid','Payslip period start follows its end.');
      const adjustments={};
      for(const key of ['deductions','reimbursements']){
        const rows=f[key]===undefined?[]:f[key];requireThat(Array.isArray(rows)&&rows.length<=100,'payslip-adjustments','Use an evidenced list of deductions and reimbursements.');
        for(const row of rows){requireThat(plain(row)&&Object.keys(row).sort().join(',')==='amountMinor,label','payslip-adjustments','Each adjustment requires only label and amountMinor.');text(row.label,'Adjustment label');C.minor(row.amountMinor);requireThat(Number(row.amountMinor)>=0,'payslip-adjustments','Deduction and reimbursement amounts must be non-negative.');}
        adjustments[key]=C.sumMinor(rows.map(row=>row.amountMinor));
      }
      const expected=C.sumMinor([f.grossMinor,String(-Number(f.taxMinor)),String(-Number(adjustments.deductions)),adjustments.reimbursements]);
      requireThat(expected===f.netMinor,'payslip-net-mismatch','Gross minus tax and evidenced deductions plus reimbursements must equal net. Employer super is separate.');
      if(f.ytd!==undefined){requireThat(plain(f.ytd)&&Object.keys(f.ytd).length>0&&Object.keys(f.ytd).every(key=>['grossMinor','taxMinor','superMinor','netMinor'].includes(key)),'payslip-ytd','YTD context must use explicitly named YTD money fields.');Object.values(f.ytd).forEach(C.minor);}
    }else if(record.kind==='valuation'){
      date(f.date,'Valuation date');text(f.itemId,'Item');const item=known(baseline.items,f.itemId,'item');currency(f.currency,baseline,item);
      requireThat(['asset','liability'].includes(item.kind)&&f.valueKind===item.kind,'valuation-kind','Confirm whether the known item is an asset or liability.');
      requireThat(f.valueKind==='liability'?Number(f.valueMinor)<=0:Number(f.valueMinor)>=0,'valuation-sign','Asset values are non-negative; amounts owed are negative.');
      requireThat(item.method!=='ledger','valuation-ledger','A ledger account needs statement reconciliation, not a replacement valuation.');
      if(f.sourceMethod!==undefined)requireThat(['statement','appraisal','market','estimate'].includes(f.sourceMethod),'valuation-method','Choose a supported valuation source method.');
    }else{
      text(f.accountId,'Account');const account=known(baseline.accounts,f.accountId,'account');currency(f.currency,baseline,account);
      requireThat(account.ledger===true,'statement-nonledger','Statement balance reconciliation requires a ledger account.');
      date(f.periodStart,'Period start');date(f.periodEnd,'Period end');requireThat(f.periodStart<=f.periodEnd,'period-invalid','Statement start follows its end.');
      requireThat(f.balanceKind==='statement-close','balance-kind','Use the official statement closing balance, not available balance, minimum due or a current balance.');
      requireThat(f.balanceConvention==='money-in-positive','balance-convention','Confirm signed balances: money held positive, money owed negative.');
    }
    return clone(f);
  }
  function sourceRefs(record,fileMap){
    requireThat(Array.isArray(record.sourceRefs)&&record.sourceRefs.length>0&&record.sourceRefs.length<=100,'source-missing','Attach the original source and its page, line or verbatim excerpt.');
    const refs=new Map();
    for(const ref of record.sourceRefs){
      requireThat(plain(ref)&&typeof ref.id==='string'&&/^[A-Za-z0-9_.:-]{1,150}$/.test(ref.id)&&!refs.has(ref.id),'source-reference','Source reference IDs must be unique and valid.');
      requireThat(typeof ref.fileId==='string'&&/^[a-f0-9]{64}$/.test(ref.fileId)&&(!fileMap||fileMap.has(ref.fileId)),'source-reference','A source reference must identify an attached original by its SHA-256.');
      requireThat(Object.keys(ref).every(key=>['id','fileId','page','line','quote','basis','bbox'].includes(key)),'source-reference','A source reference contains an unsupported field.');
      if(ref.page!==undefined)requireThat(Number.isInteger(ref.page)&&ref.page>0&&ref.page<=100000,'source-location','Page numbers are one-based.');
      if(ref.line!==undefined)requireThat(Number.isInteger(ref.line)&&ref.line>0&&ref.line<=1000000,'source-location','Line numbers are one-based.');
      if(ref.quote!==undefined)requireThat(typeof ref.quote==='string'&&ref.quote.trim().length>0&&ref.quote.length<=10000,'source-quote','A quote must be a bounded verbatim excerpt.');
      requireThat(ref.page!==undefined||ref.line!==undefined||ref.quote!==undefined,'source-location','Identify a page, line or verbatim excerpt in the original.');
      if(ref.bbox!==undefined)requireThat(Array.isArray(ref.bbox)&&ref.bbox.length===4&&ref.bbox.every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)&&ref.bbox[2]>0&&ref.bbox[3]>0&&ref.bbox[0]+ref.bbox[2]<=1.000001&&ref.bbox[1]+ref.bbox[3]<=1.000001&&ref.page!==undefined,'source-location','Bounding boxes use normalized page coordinates.');
      if(ref.basis!==undefined)requireThat(['current-period','ytd','statement-close','valuation'].includes(ref.basis),'source-basis','The source basis is unsupported.');
      const file=fileMap&&fileMap.get(ref.fileId);
      if(file&&typeof file.text==='string'){
        if(ref.quote!==undefined)requireThat(file.text.includes(ref.quote),'source-quote','The quoted text is not present verbatim in the attached original.');
        if(ref.line!==undefined)requireThat(ref.line<=file.text.split(/\r\n|\n|\r/).length,'source-location','The source line is outside the attached text.');
      }
      refs.set(ref.id,ref);
    }
    const confirms=record.confirmedFields;
    requireThat(plain(confirms),'confirmation-missing','Review every imported field against its source.');
    requireThat(Object.keys(confirms).every(key=>Object.prototype.hasOwnProperty.call(record.fields,key)),'confirmation-stale','A confirmation refers to a removed field.');
    for(const [key,value] of Object.entries(record.fields)){
      const confirmation=confirms[key];
      requireThat(plain(confirmation)&&C.canonical(confirmation.value)===C.canonical(value)&&Array.isArray(confirmation.sourceRefIds)&&confirmation.sourceRefIds.length>0&&new Set(confirmation.sourceRefIds).size===confirmation.sourceRefIds.length&&confirmation.sourceRefIds.every(id=>refs.has(id)),'confirmation-stale','Reconfirm '+key+' and its source after any edit.');
      if(record.kind==='payslip'&&(['grossMinor','taxMinor','superMinor','netMinor','deductions','reimbursements','valueBasis'].includes(key)))
        requireThat(confirmation.sourceRefIds.every(id=>refs.get(id).basis==='current-period'),'payslip-basis','Current-period payslip amounts must point to source references explicitly marked current-period.');
      if(key==='ytd')requireThat(confirmation.sourceRefIds.every(id=>refs.get(id).basis==='ytd'),'payslip-basis','YTD context must point to source references explicitly marked ytd.');
    }
    requireThat(plain(record.extraction)&&typeof record.extraction.method==='string'&&record.extraction.method.length>0&&record.extraction.method.length<=100&&typeof record.extraction.version==='string'&&record.extraction.version.length>0&&record.extraction.version.length<=100,'extraction-missing','Retain the extraction method and version as provenance.');
  }
  function validateRecord(record,baseline,fileMap){
    C.describe(baseline.schemaVersion);
    requireThat(plain(record),'record-invalid','A typed record must be an object with reviewed fields.');
    requireThat(typeof record.recordId==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(record.recordId),'record-id','Use a stable proposal record identifier.');
    const normalized=fields(record,baseline);sourceRefs(record,fileMap);
    return {kind:record.kind,recordId:record.recordId,fields:normalized,sourceRefs:clone(record.sourceRefs),extraction:clone(record.extraction),confirmedFields:clone(record.confirmedFields)};
  }
  function prepare(input){
    input=input||{};const baseline=input.baseline||{},result={version:2,records:[],issues:[],canCommit:false,counts:{new:0,evidence:0,alreadyPresent:0,payslip:0,valuation:0,statement_balance:0,errors:0,review:0}};
    const issue=(error,ids)=>result.issues.push({id:error.code+':'+ids.join(','),code:error.code||'record-invalid',severity:'error',message:error.message,recordIds:ids});
    const files=new Map();
    try{
      C.describe(baseline.schemaVersion);requireThat(C.currencies.includes(baseline.currency),'currency-unsupported','The Sheet currency is missing or unsupported.');
      requireThat(Array.isArray(input.files)&&input.files.length>0&&input.files.length<=20,'files-missing','Attach between one and twenty original files.');
      for(const file of input.files){
        requireThat(plain(file)&&typeof file.id==='string'&&/^[a-f0-9]{64}$/.test(file.id)&&(!file.sha256||file.sha256===file.id),'file-identity','Original files require a matching SHA-256 identity.');
        requireThat(!files.has(file.id),'file-duplicate','Attach each original file only once.');
        requireThat(typeof file.name==='string'&&file.name.length>0&&file.name.length<=500&&typeof file.mimeType==='string'&&file.mimeType.length>0&&Number.isInteger(file.byteLength)&&file.byteLength>0&&file.byteLength<=5*1024*1024,'file-metadata','Original file metadata is missing or outside the supported limit.');
        files.set(file.id,file);
      }
      requireThat(Array.isArray(input.records)&&input.records.length>0&&input.records.length<=1000,'records-missing','Review between one and one thousand typed records.');
    }catch(error){issue(error,[]);result.counts.errors=result.issues.length;return result;}
    const ids=new Set(),seen=new Map();
    for(const proposal of input.records){
      const id=proposal&&typeof proposal.recordId==='string'?proposal.recordId:'';
      try{
        requireThat(!ids.has(id),'record-id-duplicate','Proposal record IDs must be unique.');ids.add(id);
        const record=validateRecord(proposal,baseline,files),key=identity(record);
        requireThat(!seen.has(key),'proposal-duplicate','This proposal repeats a logical record. Keep one source-bound record.');seen.set(key,record);
        const existing=record.kind==='payslip'?baseline.payslips:record.kind==='valuation'?baseline.valuations:(baseline.statementBalances||[]);
        requireThat(Array.isArray(existing),'baseline-missing','The current '+record.kind+' records are unavailable.');
        const matches=existing.filter(row=>identity(Object.assign({kind:record.kind},row))===key);
        requireThat(matches.length<=1,'existing-duplicate','The Sheet contains repeated records with this identity. Resolve them before importing.');
        if(matches.length){
          const match=Object.assign({kind:record.kind},matches[0]);
          requireThat(C.canonical(sheetFields(match))===C.canonical(sheetFields(record)),record.kind==='valuation'?'valuation-conflict':'record-conflict','An existing record with the same date and identity has different values. Review the original; this importer does not overwrite it.');
          record.disposition='already-present';result.counts.alreadyPresent++;
        }else if(record.kind==='statement_balance'){record.disposition='evidence-only';result.counts.evidence++;}
        else{record.disposition='append';result.counts.new++;}
        result.records.push(record);result.counts[record.kind]++;
      }catch(error){issue(error,[id].filter(Boolean));}
    }
    result.counts.errors=result.issues.length;result.canCommit=result.counts.errors===0&&result.records.length>0;
    return result;
  }
  return {version:2,prepare,identity,sheetFields,validateRecord,validateFields:fields,fieldSpecs:clone(specs)};
});
