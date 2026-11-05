/* Ask on iPhone: each answer is a read of the current view. Only the system share
   sheet can send the exact text the person previews. Nothing is saved to chat history. */
(function(root){
  "use strict";
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const btn=(label,attr)=>'<button type="button" class="chip" '+attr+'>'+esc(label)+'</button>';
  const nouns={spending:"Spending",subscriptions:"All subscriptions and bills",goal:"Goal progress",cash:"Cash and offset",netWorth:"Net worth",upcoming:"All upcoming scheduled items",review:"Entries needing review"};
  let memory=null;
  root.KittyAskPanel={
    reset(){memory=null;},
    open({E,model,mode,drawer,openDrawer,go,bridge,artifact,origin}){
      const m=model(),K=root.KittyAsk, native=bridge(), headline=mode()==="live"?"Selected Google Sheet":"Fictional demo";
      if(!memory||memory.m!==m||memory.origin!==origin())memory={m,origin:origin(),last:null,question:""};
      const state=memory, source=state.origin;
      const exampleGoal=m.goals.find(g=>g.name!=="")?.name, grocery=m.cats.find(c=>c.id==="GROCERY"||c.id==="GROCERIES"||c.name.toLowerCase()==="groceries");
      const openGoal=m.goals.find(g=>Number.isFinite(g.target)&&Number.isFinite(g.balance)&&g.balance<g.target);
      const examples=[...(openGoal&&m.subs.some(s=>s.flag==="Unused"&&s.decision==="Review")?[["Put unused subscriptions toward a goal","Could our unused subscriptions help fund "+openGoal.name+"?"]]:[]),["Spending changes","What changed in our spending this month?"],...(grocery?[["Groceries last month","How much did we spend on "+grocery.name+" last month?"]]:[]),["Unused subscriptions","Which subscriptions haven’t we used?"],...(exampleGoal?[["Goal progress","When will the "+exampleGoal+" be funded?"]]:[]),["Upcoming bills","What bills are due next?"]];
      const base='<div class="eyebrow">Ask the Kitty</div><h2 id="local-ask-title">What’s on your mind?</h2><p class="sub">'+esc(headline)+' · As of '+esc(E.fmtDay(m.asOf,{year:true}))+'</p>';
      openDrawer(base+'<section class="ask native-ask" data-native-ask><form class="askrow" data-ask-form><label class="searchbox"><input type="text" maxlength="800" autocomplete="off" enterkeyhint="go" aria-label="Your question" placeholder="Ask about your money…" data-ask-input></label><button class="btn" type="submit">Ask</button></form><section data-ask-output aria-live="polite" aria-atomic="true"></section><div data-ask-examples></div><div class="plan-foot" data-ask-footer>Kitty calculates on this device. Your questions stay here.</div></section>',false);
      const host=drawer().querySelector("[data-native-ask]"), input=host.querySelector("[data-ask-input]"), content=host.querySelector("[data-ask-output]"), choices=host.querySelector("[data-ask-examples]");
      const current=()=>state.m===model()&&source===origin()&&host.isConnected&&drawer().classList.contains("on");
      let serial=0, previous=state.last?.plan||null;
      const links=x=>x.map(l=>'<button type="button" class="pp" data-ask-go="'+esc(l.go)+'"><span class="txt">'+esc(l.label)+'</span><span aria-hidden="true">›</span></button>').join("");
      const deeper=artifact?'<p><a class="btn sm ghost" href="'+esc(artifact)+'" target="_blank" rel="noopener">Explore the Davies demo in Claude ↗</a></p>':'';
      const showChoices=(rows)=>{choices.innerHTML='<div class="sugg">'+rows.map(([name,q])=>btn(name,'data-ask-example="'+esc(q)+'"')).join("")+'</div>';};
      const scopeLabel=p=>[nouns[p.kind],p.category&&m.catById[p.category].name,p.person,p.goal,p.time&&K.context(m).times.find(t=>t.id===p.time)?.label].filter(Boolean).join(" · ");
      function answer(q,a){
        if(!current())return;
        if(!a.ok){clarify(a.reason);return;}
        previous=a.plan;state.last=a;state.question=q;drawer().querySelector("#local-ask-title").textContent="Your answer";
        const facts=a.facts.length&&a.plan.kind!=="spending"?'<dl class="ask-facts">'+a.facts.map(f=>'<div><dt>'+esc(f.label)+'</dt><dd>'+esc(f.value)+'</dd></div>').join("")+'</dl>':'';
        content.innerHTML='<p class="ask-prompt">'+esc(q)+'</p><article class="plan" data-ask-answer><div class="plan-top"><span class="eyebrow">'+esc(a.basis)+'</span><h3 class="ask-amount">'+esc(a.title)+'</h3><p class="sub">'+esc(a.detail)+'</p></div>'+facts+
          (a.links.length?'<details data-ask-evidence><summary>'+esc(a.plan.kind==="spending"?(a.rowCount>a.links.length?"See the latest "+a.links.length+" of "+a.rowCount+" entries":"See the entries"):"See the source")+'</summary><div class="plan-points">'+links(a.links)+'</div></details>':'')+
          (a.periods?'<div class="sugg">'+a.periods.map((p,i)=>btn("See "+p.label,'data-ask-period="'+i+'"')).join("")+'</div>':'')+
          '<div class="plan-foot">'+esc(a.source)+'</div></article><div class="dacts"><button type="button" class="btn sm ghost" data-ask-share>Share this answer…</button></div>';
        content.querySelectorAll("[data-ask-go]").forEach(b=>b.onclick=()=>{if(current())go(b.dataset.askGo);});
        content.querySelectorAll("[data-ask-period]").forEach(b=>b.onclick=()=>{const p=a.periods[Number(b.dataset.askPeriod)];if(current())answer("Spending in "+p.label,K.run(E,m,{...a.plan,kind:"spending",time:p.time}));});
        content.querySelector("[data-ask-share]").onclick=()=>sharePreview(q,a);
        showChoices(a.plan.kind==="spending"?[["Compare with the month before","Compare that with the previous month"],["The month before","What about the month before?"]]:a.plan.kind==="goalScenario"?[["See unused subscriptions","Which subscriptions haven’t we used?"],["See this goal","When will the "+a.plan.goal+" be funded?"],examples.find(x=>x[0]==="Spending changes")]:examples.filter(x=>x[1]!==q).slice(0,3));
      }
      function sharePreview(q,a){
        if(!current())return;
        const body=[q,headline+" · "+m.asOf,a.basis+": "+a.title,a.detail,...a.facts.map(f=>f.label+": "+f.value),a.source].join("\n");
        content.innerHTML='<div class="plan"><h3>Share this answer</h3><p class="sub">Only the text below will go to the app you choose. No Sheet access or transaction rows are included.</p><pre class="ask-preview"></pre><div class="dacts"><button class="btn sm" data-ask-system-share>Choose an app…</button><button class="btn sm ghost" data-ask-back>Back</button></div><span role="status"></span></div>';
        content.querySelector("pre").textContent=body;
        content.querySelector("[data-ask-back]").onclick=()=>answer(q,a);
        const button=content.querySelector("[data-ask-system-share]");
        button.onclick=async()=>{if(!current()||button.disabled)return;button.disabled=true;try{await native.share(body);if(current())answer(q,a);}catch(_){if(current()){button.disabled=false;content.querySelector("[role=status]").textContent="Sharing isn’t available right now. Your answer is still here.";}}};
      }
      function clarify(why,options){drawer().querySelector("#local-ask-title").textContent="Ask the Kitty";content.innerHTML='<div class="plan" data-ask-clarify><h3>Let’s narrow that down</h3><p>'+esc(why||"Try a category and a month, a savings goal, or an upcoming bill.")+'</p>'+deeper+'</div>';showChoices(options||examples);}
      async function ask(q){
        q=String(q).trim();if(!q||q.length>800||!current())return;
        const request=++serial;input.value="";input.blur();
        const p=K.plan(q,m,previous);
        if(p.kind!=="unsupported"){answer(q,K.run(E,m,p));return;}
        if(p.choices){clarify(p.reason,p.choices);return;}
        content.innerHTML='<p class="sub" role="status">Looking for a matching calculation…</p>';
        try{
          const status=await native.status();if(!current()||request!==serial)return;
          if(status.available){
            let timer;let result;
            try {result=await Promise.race([native.classify(q,K.context(m)),new Promise(resolve=>{timer=setTimeout(()=>resolve({status:"unavailable"}),5000);})]);}
            finally {clearTimeout(timer);}
            if(!current()||request!==serial)return;
            const {status:rstatus,reason,...picked}=result;
            const candidate=rstatus==="classified"&&K.scope(picked,m);
            if(candidate){content.innerHTML='<div class="plan" data-ask-confirm><h3>Is this what you meant?</h3><p>'+esc(scopeLabel(candidate))+'</p><button type="button" class="btn sm" data-ask-use>Show this calculation</button></div>';content.querySelector("[data-ask-use]").onclick=()=>{if(current()&&request===serial)answer(q,K.run(E,m,candidate));};showChoices(examples);return;}
          }
        }catch(_){/* Core questions work without Apple Intelligence. */}
        if(current()&&request===serial)clarify(p.reason);
      }
      host.querySelector("form").onsubmit=ev=>{ev.preventDefault();ask(input.value);};
      choices.onclick=ev=>{const b=ev.target.closest("[data-ask-example]");if(b)ask(b.dataset.askExample);};
      if(state.last)answer(state.question,state.last);else showChoices(examples);
    }
  };
})(window);
