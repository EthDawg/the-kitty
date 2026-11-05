/* Read-only Kitty skills. Numbers and source links come from the existing engine.
   A language model, when present, may select a skill; it never supplies an answer value. */
(function(root,make){ if(typeof module==="object" && module.exports) module.exports=make(); else root.KittyAsk=make(); })(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const fold=s=>String(s??"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[’']/g,"").replace(/[^a-z0-9+]+/g," ").trim();
  const months="january february march april may june july august september october november december".split(" ");
  const kinds=new Set(["spending","comparison","receipts","subscriptions","goalScenario","goal","cash","netWorth","upcoming","review"]);
  const item=(id,label,aliases=[])=>({id,label,aliases:[...new Set([label,...aliases].map(fold).filter(Boolean))]});
  const shift=(ym,n)=>{const [y,m]=ym.split("-").map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);};
  function context(m){
    const ym=m.asOf.slice(0,7);
    const times=[item("current-month","This month",["this month","current month"]),item("last-month","Last month",["last month","previous month"])];
    for(let n=0;n<12;n++){const id=shift(ym,-n),[year,mm]=id.split("-"),month=months[+mm-1]; times.push(item(id,month+" "+year,[month,month.slice(0,3),id]));}
    return {times,people:m.people.map(n=>item(n,n)),categories:m.cats.filter(c=>c.flow==="Expense").map(c=>item(c.id,c.name,[c.id,c.name.split(/ and | & /i)[0],...(fold(c.name)==="groceries"?["grocery"]:[])])),
      goals:m.goals.map(g=>item(g.name,g.name,[g.name.split(",")[0]]))};
  }
  const same=(a,b)=>fold(a)===fold(b);
  const matches=(opts,s)=>opts.filter(o=>o.aliases.some(a=>same(a,s)));
  const unsupported=(why="I can’t answer that accurately from a single Kitty calculation.")=>({kind:"unsupported",reason:why});
  function period(s,c){
    let candidates=[];
    for(const t of c.times) for(const a of t.aliases) if(s===a || s.endsWith(" "+a)) candidates.push([a,t.id]);
    if(!candidates.length)return {s,time:"current-month"};
    candidates.sort((a,b)=>b[0].length-a[0].length);const [alias,time]=candidates[0];
    return {s:s.slice(0,-alias.length).trim().replace(/\b(in|for|during)\s*$/,"").trim(),time};
  }
  function plan(question,m,prior){
    const s=fold(question), c=context(m);
    if(!s || s.length>800)return unsupported();
    if(["spending","comparison"].includes(prior?.kind) && /^(and |what about |how about )?(the )?(month before( that)?|previous month)$/.test(s)){
      const ym=monthID(prior.time,m);return {...prior,time:shift(ym,-1)};
    }
    if(prior?.kind==="spending" && /^(compare (it|that) (with|to) (the )?(previous month|month before)|how did that change)$/.test(s))return {...prior,kind:"comparison"};
    if(/^(how much (cash|cash and offset) (do we have|is there)|what is our cash( balance)?|whats our cash( balance)?|cash( and offset)?)$/.test(s))return {kind:"cash"};
    if(/^(whats |what is |show (me )?)?(our )?net worth( today| now)?$/.test(s))return {kind:"netWorth"};
    if(/^(which |what |show (me )?)?(unused subscriptions|subscriptions (we (dont|havent) use(d)?|havent we used|are unused|we arent using))$/.test(s))return {kind:"subscriptions",filter:"unused"};
    if(/^(what needs (a look|review)|whats (left )?to review|show (my |our )?review queue)$/.test(s))return {kind:"review"};
    if(/^(whats coming up|what is coming up|show (me )?(our )?schedule)$/.test(s))return {kind:"upcoming"};
    if(/^(what bills are (coming up|due)( next)?|upcoming bills)$/.test(s))return {kind:"upcoming",filter:"bills"};
    // Interpret receipt questions as a question about recorded evidence, never as generic spending.
    if(/\breceipts?\b/.test(s)){
      let phrase=s.replace(/^(?:please )?(?:show|list|find)(?: me)? (?:the |our )?/,"");
      const t=period(phrase,c);phrase=t.s;let time=t.time;
      if(time==="current-month"&&t.s===s.replace(/^(?:please )?(?:show|list|find)(?: me)? (?:the |our )?/,"")){
        const prefixes=c.times.flatMap(t=>t.aliases.map(a=>[a,t.id])).filter(([a])=>phrase.startsWith(a+" ")).sort((a,b)=>b[0].length-a[0].length);
        if(prefixes.length){time=prefixes[0][1];phrase=phrase.slice(prefixes[0][0].length+1);}
      }
      const hit=/^(?:(.+?) )?receipts?$/.exec(phrase);
      if(hit){const category=hit[1]?matches(c.categories,hit[1]):[];if(!hit[1]||category.length===1)return {kind:"receipts",time,...(category.length?{category:category[0].id}:{})};}
      return unsupported("I can check which entries have a receipt marked held. Try a category and month, such as “December grocery receipts”.");
    }
    if(/\b(cancel(?:led|ed|ling|ing)?|cut|drop|pause)\b/.test(s)&&/\bunused (?:subscriptions?|subs)\b/.test(s)){
      // A hypothetical can include a Keep decision. Require a single known goal and no other condition.
      const terms=c.goals.flatMap(g=>g.aliases.map(a=>({id:g.id,words:a}))).filter(v=>(" "+s+" ").includes(" "+v.words+" ")).sort((a,b)=>b.words.length-a.words.length);
      const ids=new Set(terms.map(t=>t.id)), words=new Set("if what how do did does would will could can i we our the all every those three marked for review only by cancel cancelled canceled cancelling canceling cut drop pause unused subscription subscriptions subs put putting savings money them it that toward towards into on use redirect redirecting from these reach hit meet meet the goal target fund funded make faster sooner earlier many much more months month help bring forward happen happens to and be were are a an get long take until when fully full fill filled up change changes date estimated redirected cutting saved of as well".split(" "));
      if(ids.size===1 && /^(?:what if|if |how |could |would |when )/.test(s)&&s.replace(terms[0].words,"").trim().split(/ +/).every(w=>words.has(w)))return {kind:"goalScenario",goal:terms[0].id,...(!/marked (for )?review|review only/.test(s)?{filter:"allUnused"}:{})};
      return unsupported("I can model the change without cancelling anything. Try “If we cancelled all unused subscriptions, how much sooner could we reach our Emergency fund?”");
    }
    const scenario=/^(?:what if (?:i|we) (?:put|redirect) unused subscriptions? (?:toward|towards|into)|could (?:our )?unused subscriptions? help (?:fund|with)) (?:the |our )?(.+)$/.exec(s);
    if(scenario){const gs=matches(c.goals,scenario[1]);if(gs.length===1)return {kind:"goalScenario",goal:gs[0].id};return unsupported("Which goal in your Sheet should I model?");}
    let gmatch=/^(?:when (?:will|is)|how (?:is|close is)|show(?: me)?) (?:the |our )?(.+?)(?: be funded| funded| going| goal)?$/.exec(s);
    if(gmatch){const g=matches(c.goals,gmatch[1]);if(g.length===1)return {kind:"goal",goal:g[0].id};}
    const p=period(s,c);
    if(prior?.kind==="spending" && /^(what about|how about|and) /.test(s)){
      const name=s.replace(/^(what about|how about|and) /,""),person=matches(c.people,name),time=matches(c.times,name);
      if(person.length===1)return {...prior,person:person[0].id};
      if(time.length===1)return {...prior,time:time[0].id};
    }
    const short=p.s.replace(/^(?:how much (?:was|on)|what (?:was|about)|show (?:me )?)(?: our)? /,"").replace(/ spending$/,""),shortCat=matches(c.categories,short);
    if(shortCat.length===1)return {kind:"spending",time:p.time,category:shortCat[0].id};
    if(/^(what changed (in|with) (our )?spending|how (did|has) (our )?spending change(d)?|compare (our )?spending)$/.test(p.s))return {kind:"comparison",time:p.time};
    // Match complete supported questions. Never answer a restaurant/date/person query with a household total.
    const form=/^(?:how much (?:did|do|have) (.+?) (?:spend|spent)|what did (.+?) spend|show (?:me )?(?:our )?spending|(?:our )?spending)(?: (on|at) (.+))?$/.exec(p.s);
    if(form){
      const who=form[1]||form[2]||"we", target=form[4]||"", people=matches(c.people,who);
      if(who==="i"||who==="me")return {...unsupported("Whose spending should I use for this question?"), choices:[...c.people.map(o=>[o.label,question.replace(/\b(i|me)\b/i,()=>o.label)]),["Household",question.replace(/\b(i|me)\b/i,"we")]]};
      if(who!=="we" && people.length!==1)return unsupported("Whose spending should I use? Choose a named person or ask about the household.");
      const q={kind:"spending",time:p.time};if(who!=="we")q.person=people[0].id;
      if(target){
        if(form[3]==="at"){const merchant=[...new Set(m.tx.map(t=>t.mer?.name||t.merchant).filter(Boolean))].filter(v=>same(v,target));if(merchant.length!==1)return unsupported("I couldn’t match that merchant to a unique name in Activity.");q.merchant=merchant[0];}
        else{const cats=matches(c.categories,target);if(cats.length!==1)return unsupported("I couldn’t match that category. Use its name from Activity.");q.category=cats[0].id;}
      }
      return q;
    }
    return unsupported();
  }
  function monthID(time,m){return !time||time==="current-month"?m.asOf.slice(0,7):time==="last-month"?shift(m.asOf.slice(0,7),-1):time;}
  function scope(plan,m){
    if(!plan||!kinds.has(plan.kind))return null;
    const c=context(m), allowed={spending:["time","category","person","merchant"],comparison:["time","category","person","merchant"],receipts:["time","category","person"],subscriptions:["filter"],goalScenario:["goal","filter"],goal:["goal"],cash:[],netWorth:[],upcoming:["filter"],review:[]}[plan.kind];
    if(Object.entries(plan).some(([k,v])=>typeof v!=="string"||!v.trim()||(k!=="kind"&&!allowed.includes(k))))return null;
    for(const [field,opts] of [["person",c.people],["category",c.categories],["goal",c.goals]]) if(plan[field]&&opts.filter(x=>x.id===plan[field]).length!==1)return null;
    if(["goal","goalScenario"].includes(plan.kind)&&!plan.goal)return null;
    if(plan.merchant&&!m.tx.some(t=>(t.mer?.name||t.merchant)===plan.merchant))return null;
    if(plan.filter&&plan.filter!==(plan.kind==="subscriptions"?"unused":plan.kind==="goalScenario"?"allUnused":"bills"))return null;
    const ym=monthID(plan.time,m);
    if(plan.time&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)||ym>m.asOf.slice(0,7)))return null;
    return {...plan};
  }
  function run(E,m,input){
    const p=scope(input,m);if(!p)return {ok:false,reason:input?.reason||"I couldn’t verify that interpretation against this household."};
    const money=v=>E.fmt(v,{cents:true}), facts=[], links=[];
    let title="",source="",basis="",detail="";
    if(["spending","comparison","receipts"].includes(p.kind)){
      const ym=monthID(p.time,m),w=E.window("month",ym+"-01");if(w.to>m.asOf)w.to=m.asOf;
      const oldest=m.tx.reduce((a,t)=>!a||t.date<a?t.date:a,"");
      if(!oldest||w.to<oldest)return {ok:false,reason:"That month is outside the transaction history available to Kitty."};
      const predicate=t=>(!p.person||t.person===p.person)&&(!p.category||t.cat===p.category)&&(!p.merchant||(t.mer?.name||t.merchant)===p.merchant);
      const sp=E.spend(m.tx,w,predicate),rows=m.tx.filter(t=>E.inWin(t,w)&&predicate(t)&&t.flow!=="Transfer"&&t.flow!=="Income");
      const subject=p.category?m.catById[p.category].name:p.merchant||"All categories";
      if(p.kind==="receipts"){
        const held=rows.filter(r=>/^y(es)?$/i.test(String(r.receipt||""))),missing=rows.filter(r=>/^n(o)?$/i.test(String(r.receipt||"")));
        title=held.length?held.length+" "+(held.length===1?"receipt":"receipts")+" marked held":"No receipts marked held";
        basis=[E.fmtMonth(w.from),subject,p.person||"Household"].join(" · ");source="Entries · receipt held · "+w.from+" to "+w.to;
        detail=rows.length+" expense "+(rows.length===1?"entry":"entries")+" total "+money(sp.out)+". "+(rows.length-held.length-missing.length)+" without a recorded receipt status. The Sheet flag is not a copy of the receipt.";
        facts.push({label:"Net spending",value:money(sp.out)},{label:"Marked held",value:String(held.length)},{label:"Marked missing",value:String(missing.length)});
        for(const r of [...rows].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4))links.push({go:"entry:"+r.id,label:E.fmtDay(r.date)+" · "+(r.mer?.name||r.merchant||r.desc)+" · "+money(r.amount)});
        return {ok:true,plan:p,title,basis,detail,source,facts,links,rowCount:rows.length};
      }
      if(p.kind==="comparison"){
        const prev=E.window("month",shift(ym,-1)+"-01"),partial=w.to!==E.monthEnd(w.from);
        if(partial)prev.to=[prev.to,prev.from.slice(0,8)+w.to.slice(8)].sort()[0];
        if(prev.to<oldest)return {ok:false,reason:"There isn’t an earlier month of ledger history to compare."};
        const previous=E.spend(m.tx,prev,predicate),cents=Math.round(sp.out*100)-Math.round(previous.out*100);
        title=cents===0?"Spending stayed the same":money(Math.abs(cents)/100)+(cents>0?" more":" less")+" spent";
        basis=[E.fmtMonth(w.from)+" vs "+E.fmtMonth(prev.from),subject,p.person||"Household"].join(" · ");
        source="Entries · "+w.from+" to "+w.to+" vs "+prev.from+" to "+prev.to;
        detail=(partial?"Compared through the same day of each month. ":"Compared two calendar months. ")+"Refunds reduce spending; transfers are excluded.";
        facts.push({label:E.fmtMonth(w.from),value:money(sp.out)},{label:E.fmtMonth(prev.from),value:money(previous.out)});
        const cur=new Map(sp.byCat),old=new Map(previous.byCat);
        const drivers=[...new Set([...cur.keys(),...old.keys()])].map(cat=>[cat,Math.round(100*(cur.get(cat)||0))-Math.round(100*(old.get(cat)||0))]).filter(([,v])=>v).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
        if(drivers.length&&!p.category){const [k,v]=drivers[0];detail+=" Biggest change: "+(m.catById[k]?.name||k)+", "+money(Math.abs(v)/100)+(v>0?" more.":" less.");}
        return {ok:true,plan:p,title,basis,detail,source,facts,links,periods:[{label:E.fmtMonth(w.from),time:ym},{label:E.fmtMonth(prev.from),time:prev.from.slice(0,7)}]};
      }
      title=money(sp.out)+" spent";basis=[E.fmtMonth(w.from),subject,p.person||"Household"].join(" · ");
      detail=sp.count+" expense "+(sp.count===1?"entry":"entries")+". Refunds reduce spending; transfers are excluded.";
      source="Entries · "+w.from+" to "+w.to;
      for(const r of [...rows].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4))links.push({go:"entry:"+r.id,label:E.fmtDay(r.date)+" · "+(r.mer?.name||r.merchant||r.desc)+" · "+money(r.amount)});
      if(!rows.length)detail="No matching expense entries in the available ledger for this period.";
      facts.push({label:"Net spending",value:money(sp.out)},{label:"Entries",value:String(sp.count)});
    }else if(p.kind==="cash"||p.kind==="netWorth"){
      const key=p.kind==="cash"?"networth.cash":"networth.total",record=m.metrics[key];if(!Number.isFinite(record?.num))return {ok:false,reason:"The Sheet has no verified value for this metric."};
      title=money(record.num);basis=p.kind==="cash"?"Cash and offset":"Net worth";source="Metrics · "+key+" · "+m.asOf;
      detail="This is the Sheet’s reported figure as of "+E.fmtDay(m.asOf,{year:true})+".";
      links.push({go:p.kind==="cash"?"home":"networth",label:p.kind==="cash"?"See Home":"See net worth"});facts.push({label:basis,value:title});
    }else if(p.kind==="subscriptions"){
      const all=p.filter==="unused"?m.subs.filter(s=>String(s.flag).toLowerCase()==="unused"):m.subs;
      title=all.length+" "+(p.filter==="unused"?"marked unused":"recorded subscriptions and bills");basis="Subscription review";source="Subscriptions · "+m.asOf;
      for(const s of all.slice(0,8)) facts.push({label:s.service,value:Number.isFinite(s.annual)?money(s.annual)+" / year":s.flag||"No annual figure"});
      detail=p.filter==="unused"?"The household marked these unused. Recorded annual costs aren’t guaranteed savings.":"These are the statuses in your Sheet.";
      links.push({go:"subs",label:"See subscriptions and bills"});
    }else if(p.kind==="goalScenario"){
      const goal=m.goals.find(g=>g.name===p.goal);
      if(!Number.isFinite(goal.balance)||!Number.isFinite(goal.target)||goal.target<=0)return {ok:false,reason:"I need a recorded balance and target for this goal."};
      const allUnused=m.subs.filter(s=>String(s.flag).toLowerCase()==="unused"&&!/cancel/i.test(s.decision)),kept=allUnused.filter(s=>String(s.decision).toLowerCase()==="keep").map(s=>s.service);
      const all=p.filter==="allUnused",unused=all?allUnused:allUnused.filter(s=>String(s.decision).toLowerCase()==="review");
      const costed=unused.filter(s=>Number.isFinite(s.annual)&&s.annual>0),monthly=Math.round(costed.reduce((sum,s)=>sum+Math.round(s.annual*100),0)/12)/100;
      const left=Math.max(0,Math.round((goal.target-goal.balance)*100)/100);
      const baseline=E.goalEta(goal,0,m.asOf),possible=E.goalEta(goal,monthly,m.asOf);
      title=left===0?"This goal is already funded":monthly?money(monthly)+" a month":"No confirmed amount to redirect";
      basis=goal.name+" · What if";source=(all?"Subscriptions (all marked Unused)":"Subscriptions (Unused + Review)")+" and Goals · "+m.asOf;
      detail=all?"This models every recorded unused subscription. Nothing is cancelled.":"This averages unused subscriptions marked Review over 12 months.";
      if(kept.length)detail+=" "+(all?"This includes ":"Left out: ")+kept.join(", ")+(all?", currently marked Keep.":" (marked Keep).");
      if(costed.length<unused.length)detail+=" An item without a confirmed annual cost was left out.";
      if(left>0){
        let change="";
        if(!baseline.date)change="At the recorded saving pace, this goal won’t be reached."+(!possible.date?" The extra savings would still leave no positive pace.":possible.months>120?" Even with this change it would take over "+Math.floor(possible.months/12)+" years.":" With this change, the estimated funding month is "+E.fmtMonth(possible.date)+".");
        else if(monthly&&possible.date){const gain=baseline.months-possible.months;change=gain===0?"Even with the extra savings, the estimated funding month stays "+E.fmtMonth(possible.date)+".":E.fmtMonth(possible.date)+" instead of "+E.fmtMonth(baseline.date)+" — "+gain+" "+(gain===1?"month":"months")+" sooner.";}
        if(change)detail=change+" "+detail;
      }
      if(left>0&&goal.date&&goal.date<m.asOf)detail+=" Its target date was "+E.fmtDay(goal.date,{year:true})+".";
      facts.push({label:"Still to save",value:money(left)},...costed.slice(0,6).map(s=>({label:s.service,value:money(s.annual)+" / year"})));
      links.push({go:"goal:"+goal.name,label:"See goal and saving pace"},{go:"subs",label:"See subscription decisions"});
    }else if(p.kind==="goal"){
      const g=m.goals.find(g=>g.name===p.goal);if(!Number.isFinite(g.balance)||!Number.isFinite(g.target)||g.target<=0)return {ok:false,reason:"This goal needs a recorded balance and a positive target."};
      const eta=E.goalEta(g,0,m.asOf);
      title=eta.reached?"Already funded":eta.date?"At this pace: "+E.fmtMonth(eta.date):"No reliable date yet";basis=g.name;source="Goals · "+m.asOf;
      detail="Current savings "+money(g.balance)+" of "+money(g.target)+". "+(eta.reached?"The balance has reached the target.":eta.date?"The estimate assumes the recorded saving pace continues.":"Kitty needs a positive saving pace to estimate a date.");
      if(!eta.reached&&g.date&&g.date<m.asOf)detail+=" Its target date was "+E.fmtDay(g.date,{year:true})+".";
      facts.push({label:"Balance",value:money(g.balance)},{label:"Target",value:money(g.target)});links.push({go:"goals",label:"See goal and assumptions"});
    }else if(p.kind==="upcoming"){
      const events=E.upcoming(m,35).filter(e=>!p.filter||e.kind==="bill");title=events.length+(p.filter?" upcoming bills":" upcoming items");basis="Next 35 days";source=(p.filter?"Scheduled bills":"Scheduled bills, repayments, pay and goals")+" · as of "+m.asOf;
      for(const e of events.slice(0,5))facts.push({label:E.fmtDay(e.date)+" · "+e.title,value:e.kind==="bill"&&!(e.amount<0)?"Charge not confirmed":Number.isFinite(e.amount)?money(e.amount):"Scheduled"});
      detail="Scheduled items are forecasts, not settled entries.";
      if(!p.filter && m.sheetVersion>=2){const undated=m.loans.filter(l=>l.repayment&&m.contracts.filter(c=>c.kind==="loan"&&c.status==="active"&&c.acct===l.id&&c.next>m.asOf).length!==1).length;if(undated)detail+=" "+undated+" loan schedule"+(undated===1?" has":"s have")+" no confirmed future date and "+(undated===1?"is":"are")+" not included.";}
      links.push({go:"upcoming",label:"See the schedule"});
    }else{
      const items=E.review(m).items;title=items.length+" "+(items.length===1?"entry needs":"entries need")+" a look";basis="Review queue";source="Entries, Rules and Decisions · "+m.asOf;
      for(const i of items.slice(0,3))links.push({go:"entry:"+i.id,label:i.id+" · "+i.why});
      detail="Nothing changes until you choose a review action.";links.push({go:"review",label:"Open Review"});
    }
    return {ok:true,plan:p,title,basis,detail,source,facts,links,...(p.kind==="spending"?{rowCount:Number(facts[1].value)}:{})};
  }
  function merchantEvidence(E,m,id){
    const entry=m.entryById[id];if(!entry||entry.kind!=="transaction")return null;
    const name=E.normalise(entry.raw);
    if(!name||/^(SQ|SQUARE|PAYPAL|STRIPE|TRANSFER|PAYMENT|DIRECT DEBIT|EFTPOS|CARD PURCHASE|SP|TST|PP)$/.test(name))return {matches:[],category:null};
    const rows=m.entries.filter(e=>e.id!==id&&e.kind==="transaction"&&e.date<entry.date&&!e.dupOf&&e.acct===entry.acct&&e.raw&&E.normalise(e.raw)===name&&e.cat!=="UNCAT"&&m.catById[e.cat]?.flow==="Expense");
    const cats=new Set(rows.map(e=>e.cat));return {matches:rows.sort((a,b)=>b.date.localeCompare(a.date)).map(e=>e.id),category:cats.size===1?[...cats][0]:null};
  }
  return {context,plan,scope,run,merchantEvidence};
});
