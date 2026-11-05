/* Deterministic preflight only. Accepted evidence is supplied by the receipt-verifying writer. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./sheet-contract.js'),require('./records.js'));
  else root.Close=factory(root.SheetContract,root.Records);
})(typeof globalThis!=='undefined'?globalThis:this,function(C,R){
  'use strict';
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const addDay=value=>new Date(Date.parse(value+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const dayBefore=value=>new Date(Date.parse(value+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const monthEnd=value=>new Date(Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7)),0)).toISOString().slice(0,10);
  const sorted=values=>values.slice().sort();
  function prepare(input){
    input=input||{};const b=input.baseline||{},review=input.review||{},periodEnd=input.periodEnd;
    const out={version:2,periodEnd:typeof periodEnd==='string'?periodEnd:null,expectedAsOf:b.asOf||null,targetAsOf:typeof periodEnd==='string'?periodEnd:null,postCloseRequired:true,checks:[],issues:[],canClose:false};
    let serial=0;
    function check(code,ok,message,recordIds,details){
      const id=code+':'+(recordIds||[]).join(',')+':'+serial++;
      const result=Object.assign({id,code,status:ok?'pass':'unresolved',message,recordIds:recordIds||[]},details||{});out.checks.push(result);
      if(!ok)out.issues.push({id,code,severity:'error',message,recordIds:recordIds||[]});
      return ok;
    }
    function reviewed(code,id,message,recordIds,facts){
      const evidenceKey=C.canonical(facts),decision=plain(review.decisions)?review.decisions[id]:null;
      const accepted=plain(decision)&&decision.action==='acknowledge'&&typeof decision.reason==='string'&&decision.reason.trim().length>=8&&decision.reason.length<=2000&&decision.evidenceKey===evidenceKey&&Array.isArray(decision.recordIds)&&C.canonical(sorted(decision.recordIds))===C.canonical(sorted(recordIds));
      out.checks.push({id,code,status:accepted?'pass':'unresolved',message:accepted?'Reviewed: '+message:message,recordIds});
      if(!accepted)out.issues.push({id,code,severity:'review',message,recordIds,evidenceKey});
    }
    try{C.describe(b.schemaVersion);}catch(error){check(error.code,false,error.message);return out;}
    if(!check('close-period',C.validDate(periodEnd)&&periodEnd===monthEnd(periodEnd),'Close requires a valid calendar month end.'))return out;
    if(!check('close-as-of',C.validDate(b.asOf)&&b.asOf<periodEnd&&b.asOf===monthEnd(b.asOf),'The current As-of date must be a known earlier month end.'))return out;
    const periodStart=addDay(b.asOf);out.periodStart=periodStart;
    if(!check('close-sequence',periodEnd===monthEnd(periodStart),'Close the next month from the current As-of date; do not skip periods.'))return out;
    if(!check('close-currency',C.currencies.includes(b.currency),'The Sheet currency must be explicit and supported.'))return out;
    for(const name of ['accounts','items','people','transactions','payslips','valuations','projectedBalances','checks','unresolvedReviews']){
      if(!check('close-baseline-'+name,Array.isArray(b[name]),'The current '+name+' evidence is required.'))return out;
    }
    if(!check('close-account-scope',b.accounts.length>0&&b.accounts.length<=10000&&b.transactions.length<=100000,'The close must have a bounded, nonempty account scope.'))return out;
    check('close-check-scope',b.checks.some(item=>item&&String(item.type).toLowerCase()==='close'),'The recorded Sheet Close checks must be present; post-write verification is still required.');
    const accountMap=new Map(),txMap=new Map(),posted=[];
    for(const account of b.accounts){
      const valid=plain(account)&&typeof account.id==='string'&&account.id.length>0&&!accountMap.has(account.id)&&typeof account.ledger==='boolean'&&account.currency===b.currency;
      if(!check('account-definition',valid,'Account identity, currency and ledger method must be unambiguous.',[account&&account.id||'unknown']))continue;
      accountMap.set(account.id,account);
      if(account.ledger){
        try{C.minor(account.openingMinor);if(!C.validDate(account.openingDate))throw new Error('Opening date missing.');}
        catch(error){check('account-opening',false,'A ledger account needs its exact opening balance and date.',[account.id]);}
      }
    }
    for(const tx of b.transactions){
      try{
        if(!plain(tx)||typeof tx.id!=='string'||!tx.id||txMap.has(tx.id)||!C.validDate(tx.date)||!accountMap.has(tx.accountId)||!['posted','settled','pending','cancelled'].includes(tx.status))throw new Error('Invalid transaction identity, date, account or posting status.');
        C.minor(tx.amountMinor);txMap.set(tx.id,tx);
        if(tx.status==='posted'||tx.status==='settled')posted.push(tx);
      }catch(error){check('ledger-record',false,'A current ledger record is invalid or repeats an ID; repair it before close.',[tx&&tx.id||'unknown']);}
    }
    const inPeriod=tx=>tx.date>=periodStart&&tx.date<=periodEnd;
    const accepted=new Map(),acceptedAliases=new Map();
    const imports=input.evidence&&input.evidence.imports;
    if(!check('accepted-evidence',Array.isArray(imports)&&imports.length>0,'Accepted import receipts and their original-source evidence are required.'))return out;
    const importsSeen=new Set();
    for(const envelope of imports){
      if(!check('accepted-receipt',plain(envelope)&&typeof envelope.importId==='string'&&envelope.importId.length>0&&!importsSeen.has(envelope.importId)&&/^[a-f0-9]{64}$/.test(envelope.proposalDigest||'')&&envelope.receiptVerified===true&&Array.isArray(envelope.records),'Each evidence import must have a distinct verified receipt and immutable proposal digest.',[envelope&&envelope.importId||'unknown']))continue;
      importsSeen.add(envelope.importId);
      for(const raw of envelope.records){
        try{
          const record=R.validateRecord(raw,b),key=R.identity(record),previous=accepted.get(key);
          if(previous&&C.canonical(previous.record.fields)!==C.canonical(record.fields))throw new Error('Accepted sources disagree on the same record.');
          if(!previous)accepted.set(key,{record,importIds:[envelope.importId]});else previous.importIds.push(envelope.importId);
          if(acceptedAliases.has(record.recordId)&&acceptedAliases.get(record.recordId)!==key)throw new Error('A source record ID refers to different records.');
          acceptedAliases.set(record.recordId,key);
        }catch(error){check(error.code||'evidence-conflict',false,error.message,[raw&&raw.recordId||'unknown']);}
      }
    }
    function canonicalRecords(rows,kind){
      const records=new Map();
      for(const row of rows){
        try{
          const record=Object.assign({kind},row),key=R.identity(record),proof=accepted.get(key);
          // A:G deliberately cannot store net adjustments. Validate arithmetic using the
          // accepted source record when its seven raw facts still match exactly.
          const exactProof=proof&&C.canonical(R.sheetFields(proof.record))===C.canonical(R.sheetFields(record));
          R.validateFields(exactProof?proof.record:record,b);
          if(records.has(key))throw new Error('Repeated logical identity in the current Sheet.');
          records.set(key,record);
          if(typeof record.recordId==='string'&&record.recordId){
            if(acceptedAliases.has(record.recordId)&&acceptedAliases.get(record.recordId)!==key)throw new Error('A raw record ID refers to a different identity.');
            acceptedAliases.set(record.recordId,key);
          }
        }catch(error){check('current-'+kind,false,'A current '+kind+' record is invalid or duplicated: '+error.message,[row&&row.recordId||'legacy']);}
      }
      return records;
    }
    const payslips=canonicalRecords(b.payslips,'payslip'),valuations=canonicalRecords(b.valuations,'valuation');
    const evidencedPay=new Map(),evidencedValues=new Map(),statements=[];
    for(const [key,item] of accepted){
      const record=item.record;
      if(record.kind==='statement_balance'){statements.push(record);continue;}
      const current=(record.kind==='payslip'?payslips:valuations).get(key);
      const matches=current&&C.canonical(R.sheetFields(current))===C.canonical(R.sheetFields(record));
      if(!check('evidence-current',!!matches,'Accepted evidence must still match the exact current Sheet record.',[record.recordId]))continue;
      (record.kind==='payslip'?evidencedPay:evidencedValues).set(key,record);
    }
    function balanceAt(account,day){
      if(!C.validDate(account.openingDate)||account.openingDate>day)throw new Error('The account opening anchor does not precede the required date.');
      const entries=posted.filter(tx=>tx.accountId===account.id&&tx.date<=day);
      if(entries.some(tx=>tx.date<=account.openingDate))throw new Error('A posted movement overlaps or predates the opening anchor.');
      return C.sumMinor([account.openingMinor].concat(entries.map(tx=>tx.amountMinor)));
    }
    for(const account of accountMap.values()){
      if(!account.ledger||C.validDate(account.openingDate)&&account.openingDate>periodEnd)continue;
      if(account.status==='closed'&&C.validDate(account.closedAt)&&account.closedAt<periodStart)continue;
      const start=C.validDate(account.openingDate)&&account.openingDate>=periodStart?addDay(account.openingDate):periodStart;
      const evidence=statements.filter(row=>row.fields.accountId===account.id&&row.fields.periodStart===start&&row.fields.periodEnd===periodEnd);
      if(!check('account-statement',evidence.length===1,'Every relevant ledger account, including an inactive month, needs one statement covering the exact close period.',[account.id]))continue;
      const f=evidence[0].fields;
      try{
        const opening=balanceAt(account,dayBefore(start)),closing=balanceAt(account,periodEnd);
        const movement=C.sumMinor(posted.filter(tx=>tx.accountId===account.id&&tx.date>=start&&tx.date<=periodEnd).map(tx=>tx.amountMinor));
        check('statement-opening',opening===f.openingMinor,'The statement opening must match the canonical ledger opening for this period.',[account.id],{expectedMinor:opening,actualMinor:f.openingMinor});
        const fromStatement=C.sumMinor([f.openingMinor,movement]);
        check('statement-movement',fromStatement===f.closingMinor,'Statement opening plus all posted period movement must equal statement closing.',[account.id],{expectedMinor:fromStatement,actualMinor:f.closingMinor});
        check('statement-canonical',closing===f.closingMinor,'The canonical projected ledger balance must equal statement closing.',[account.id],{expectedMinor:closing,actualMinor:f.closingMinor});
        const projection=b.projectedBalances.filter(row=>row.accountId===account.id&&row.date===periodEnd);
        const projected=projection.length===1?C.minor(projection[0].amountMinor):null;
        check('balance-projection',projected!==null&&projected===closing,'The supplied canonical target-date projection must agree with the independent close arithmetic.',[account.id],{expectedMinor:closing,actualMinor:projected});
      }catch(error){check('account-reconciliation',false,'This account cannot be reconciled: '+error.message,[account.id]);}
    }
    const itemIds=new Set();
    for(const item of b.items){
      if(!check('item-definition',plain(item)&&typeof item.id==='string'&&!itemIds.has(item.id)&&item.currency===b.currency&&['asset','liability'].includes(item.kind),'Valuation item identity, currency and kind must be unambiguous.',[item&&item.id||'unknown']))continue;
      itemIds.add(item.id);if(item.valuationRequired===false)continue;
      const matches=[...evidencedValues.values()].filter(row=>row.fields.itemId===item.id&&row.fields.date===periodEnd);
      check('valuation-evidence',matches.length===1,'Every required item needs source-backed valuation evidence at this month end.',[item.id]);
    }
    for(const account of accountMap.values())if(!account.ledger)check('nonledger-item-scope',itemIds.has(account.id),'Every non-ledger account must be represented in the valuation item scope.',[account.id]);
    const salary=posted.filter(tx=>tx.categoryId==='SALARY'),requiredSalary=salary.filter(inPeriod);
    const requiredPays=[...payslips.entries()].filter(([,row])=>row.fields.payDate>=periodStart&&row.fields.payDate<=periodEnd).map(([key])=>key);
    for(const key of requiredPays)check('payslip-evidence',evidencedPay.has(key),'Each current-period payslip must have accepted original-source evidence.',[payslips.get(key).recordId||key]);
    const usedPays=new Set(),usedSalary=new Set();
    function salaryMatch(payKeys,ids,explicit){
      const payRows=payKeys.map(key=>evidencedPay.get(key)),txRows=ids.map(id=>txMap.get(id));
      let valid=payKeys.length>0&&new Set(payKeys).size===payKeys.length&&new Set(ids).size===ids.length&&payRows.every(Boolean)&&txRows.every(tx=>tx&&salary.includes(tx))&&!payKeys.some(key=>usedPays.has(key))&&!ids.some(id=>usedSalary.has(id));
      if(valid){
        const persons=new Set(payRows.map(row=>row.fields.person));
        valid=persons.size===1&&txRows.every(tx=>tx.person===[...persons][0]||(explicit&&['Joint','',undefined,null].includes(tx.person)));
      }
      if(valid){
        const payDates=new Set(payRows.map(row=>row.fields.payDate)),sameDay=payDates.size===1&&txRows.every(tx=>payDates.has(tx.date));
        valid=sameDay||explicit&&explicit.allowTiming===true;
        valid=valid&&C.sumMinor(payRows.map(row=>row.fields.netMinor))===C.sumMinor(txRows.map(tx=>tx.amountMinor));
      }
      if(explicit)valid=valid&&typeof explicit.reason==='string'&&explicit.reason.trim().length>=8&&explicit.reason.length<=2000;
      if(valid){payKeys.forEach(key=>usedPays.add(key));ids.forEach(id=>usedSalary.add(id));}
      check('salary-match',!!valid,explicit?'The explicit split/timing salary decision must match exact evidenced net pay without reusing records.':'A salary deposit must uniquely match the evidenced person, pay date and exact net pay.',ids.concat(payRows.filter(Boolean).map(row=>row.recordId)));
      return valid;
    }
    const salaryDecisions=review.salaryMatches===undefined?[]:review.salaryMatches;
    if(check('salary-decisions',Array.isArray(salaryDecisions)&&salaryDecisions.length<=1000,'Salary matching decisions must be an explicit list.')){
      for(const decision of salaryDecisions){
        if(!plain(decision)||!Array.isArray(decision.payslipRecordIds)||!Array.isArray(decision.transactionIds)){check('salary-match',false,'A salary match needs payslip and transaction IDs.');continue;}
        try{salaryMatch(decision.payslipRecordIds.map(id=>acceptedAliases.get(id)||id),decision.transactionIds,decision);}
        catch(error){check('salary-match',false,error.message,decision.transactionIds);}
      }
    }
    for(const key of requiredPays){
      if(usedPays.has(key)||!evidencedPay.has(key))continue;
      const pay=evidencedPay.get(key).fields;
      const candidates=salary.filter(tx=>!usedSalary.has(tx.id)&&tx.person===pay.person&&tx.date===pay.payDate&&tx.amountMinor===pay.netMinor);
      const rivals=[...evidencedPay.entries()].filter(([other,row])=>!usedPays.has(other)&&row.fields.person===pay.person&&row.fields.payDate===pay.payDate&&row.fields.netMinor===pay.netMinor);
      if(candidates.length===1&&rivals.length===1)salaryMatch([key],[candidates[0].id],null);
    }
    for(const key of requiredPays)check('payslip-salary-covered',usedPays.has(key),'A payslip needs matching salary deposits or an explicit split/timing decision.',[payslips.get(key).recordId||key]);
    for(const tx of requiredSalary)check('salary-payslip-covered',usedSalary.has(tx.id),'A salary deposit needs matching source-backed payslip evidence.',[tx.id]);
    const transfers=posted.filter(tx=>['TRANSFER','CC-PAY'].includes(tx.categoryId)||!!tx.transferGroup),usedTransfers=new Set();
    function transferPair(ids,decision){
      const rows=ids.map(id=>txMap.get(id));let valid=ids.length===2&&new Set(ids).size===2&&rows.every(row=>row&&transfers.includes(row))&&!ids.some(id=>usedTransfers.has(id));
      if(valid)valid=rows[0].accountId!==rows[1].accountId&&Number(rows[0].amountMinor)!==0&&C.sumMinor(rows.map(row=>row.amountMinor))==='0'&&accountMap.get(rows[0].accountId).currency===accountMap.get(rows[1].accountId).currency&&(!rows[0].transferGroup||!rows[1].transferGroup||rows[0].transferGroup===rows[1].transferGroup);
      if(decision)valid=valid&&typeof decision.reason==='string'&&decision.reason.trim().length>=8&&decision.reason.length<=2000;
      if(valid)ids.forEach(id=>usedTransfers.add(id));
      check('transfer-pair',!!valid,'Each transfer pair must contain two opposite exact amounts on distinct accounts, used only once.',ids);
    }
    const pairDecisions=review.transferPairs===undefined?[]:review.transferPairs;
    if(check('transfer-decisions',Array.isArray(pairDecisions)&&pairDecisions.length<=1000,'Transfer decisions must name the two actual ledger records.')){
      for(const decision of pairDecisions){
        if(!plain(decision)||!Array.isArray(decision.transactionIds)){check('transfer-pair',false,'A transfer decision must identify both ledger records.');continue;}
        try{transferPair(decision.transactionIds,decision);}catch(error){check('transfer-pair',false,error.message,decision.transactionIds);}
      }
    }
    const groups=new Map();for(const tx of transfers)if(tx.transferGroup){if(!groups.has(tx.transferGroup))groups.set(tx.transferGroup,[]);groups.get(tx.transferGroup).push(tx.id);}
    for(const ids of groups.values())if(ids.some(id=>inPeriod(txMap.get(id)))&&!ids.some(id=>usedTransfers.has(id))){
      try{transferPair(ids,null);}catch(error){check('transfer-pair',false,error.message,ids);}
    }
    for(const tx of transfers.filter(inPeriod))check('transfer-covered',usedTransfers.has(tx.id),'A transfer needs its actual paired record; a global zero total is insufficient.',[tx.id]);
    for(const tx of posted.filter(inPeriod)){
      if(tx.categoryId==='UNCAT'||!tx.categoryId)reviewed('uncategorised','uncategorised:'+tx.id,'Review this specific uncategorised transaction before close.',[tx.id],tx);
      if(Array.isArray(b.categories)&&!b.categories.some(row=>(typeof row==='string'?row:row.id)===tx.categoryId))check('unknown-category',false,'An existing transaction names an unknown category.',[tx.id]);
    }
    for(const item of b.unresolvedReviews){
      if(!plain(item)||typeof item.id!=='string'||!item.id||typeof item.message!=='string'){check('review-definition',false,'A recorded unresolved review lacks its identity or explanation.');continue;}
      reviewed(item.code||'recorded-review','review:'+item.id,item.message,Array.isArray(item.recordIds)?item.recordIds:[],item);
    }
    for(const item of b.checks){
      if(!plain(item)||typeof item.id!=='string'||typeof item.status!=='string'||typeof item.type!=='string'||(item.items!==undefined&&item.items!==null&&(!Number.isInteger(item.items)||item.items<0))){check('sheet-check-definition',false,'A recorded Sheet check is missing a valid identity, type, status or count.');continue;}
      const status=item.status.trim().toLowerCase(),bad=!['ok','pass','passed','clear','note'].includes(status)||(typeof item.items==='number'&&item.items>0&&status!=='note');
      if(item.type.toLowerCase()==='close'||/unknown categor|repeat.*id|duplicate.*id/i.test(item.id+' '+(item.message||''))){
        const countKnown=item.type.toLowerCase()!=='close'||Number.isInteger(item.items)&&item.items===0;
        check('sheet-check',!bad&&countKnown,'Recorded Sheet check: '+(item.message||item.id)+(countKnown?'':' — the Close count is missing or not zero.'),[item.id]);
      }else if(bad)reviewed('sheet-review','sheet-review:'+item.id,'Recorded Sheet review: '+(item.message||item.id),Array.isArray(item.recordIds)?item.recordIds:[],item);
    }
    out.canClose=out.issues.length===0;
    return out;
  }
  return {version:2,prepare:function(input){
    try{return prepare(input);}catch(error){return {version:2,periodEnd:input&&input.periodEnd||null,expectedAsOf:input&&input.baseline&&input.baseline.asOf||null,targetAsOf:input&&input.periodEnd||null,postCloseRequired:true,checks:[],issues:[{id:'close-invalid',code:error.code||'close-invalid',severity:'error',message:'The close inputs are incomplete or invalid: '+error.message,recordIds:[]}],canClose:false};}
  }};
});
