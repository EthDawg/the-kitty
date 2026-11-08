/* Ask without a model: a drawer over the read-only skills (ask-skills.js) and the paraphrase router
   (ask-routing.js). Each answer is a read of the current view, computed in the page; nothing is saved
   to chat history. The artifact page's own Ask button asks Claude, so app.js does not open this panel. */
(function(root){
  "use strict";
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const btn=(label,attr)=>'<button type="button" class="chip" '+attr+'>'+esc(label)+'</button>';
  let memory=null;
  root.KittyAskPanel={
    reset(){memory=null;},
    open({E,model,mode,drawer,openDrawer,go,artifact,origin}){
      const m=model(),K=root.KittyAsk, headline=mode()==="live"?"Selected Google Sheet":"Fictional demo";
      if(!memory||memory.m!==m||memory.origin!==origin())memory={m,origin:origin(),last:null,question:""};
      const state=memory, source=state.origin;
      const exampleGoal=m.goals.find(g=>g.name!=="")?.name, grocery=m.cats.find(c=>c.id==="GROCERY"||c.id==="GROCERIES"||c.name.toLowerCase()==="groceries");
      const openGoal=m.goals.find(g=>Number.isFinite(g.target)&&Number.isFinite(g.balance)&&g.balance<g.target);
      const examples=[...(openGoal&&m.subs.some(s=>s.flag==="Unused"&&s.decision==="Review")?[["Put unused subscriptions toward a goal","Could our unused subscriptions help fund "+openGoal.name+"?"]]:[]),["Spending changes","What changed in our spending this month?"],...(grocery?[["Groceries last month","How much did we spend on "+grocery.name+" last month?"]]:[]),["Unused subscriptions","Which subscriptions haven’t we used?"],...(exampleGoal?[["Goal progress","When will the "+exampleGoal+" be funded?"]]:[]),["Upcoming bills","What bills are due next?"]];
      const base='<div class="eyebrow">Ask the Kitty</div><h2 id="local-ask-title">What’s on your mind?</h2><p class="sub">'+esc(headline)+' · As of '+esc(E.fmtDay(m.asOf,{year:true}))+'</p>';
      openDrawer(base+'<section class="ask local-ask" data-local-ask><form class="askrow" data-ask-form><label class="searchbox"><input type="text" maxlength="800" autocomplete="off" enterkeyhint="go" aria-label="Your question" placeholder="Ask about your money…" data-ask-input></label><button class="btn" type="submit">Ask</button></form><section data-ask-output aria-live="polite" aria-atomic="true"></section><div data-ask-examples></div><div class="plan-foot" data-ask-footer>Kitty calculates on this device. Your questions stay here.</div></section>',false);
      const host=drawer().querySelector("[data-local-ask]"), input=host.querySelector("[data-ask-input]"), content=host.querySelector("[data-ask-output]"), choices=host.querySelector("[data-ask-examples]");
      const current=()=>state.m===model()&&source===origin()&&host.isConnected&&drawer().classList.contains("on");
      let previous=state.last?.plan||null;
      const links=x=>x.map(l=>'<button type="button" class="pp" data-ask-go="'+esc(l.go)+'"><span class="txt">'+esc(l.label)+'</span><span aria-hidden="true">›</span></button>').join("");
      const deeper=artifact?'<p><a class="btn sm ghost" href="'+esc(artifact)+'" target="_blank" rel="noopener">Explore the Davies demo in Claude ↗</a></p>':'';
      const showChoices=(rows)=>{choices.innerHTML='<div class="sugg">'+rows.map(([name,q])=>btn(name,'data-ask-example="'+esc(q)+'"')).join("")+'</div>';};
      function answer(q,a){
        if(!current())return;
        if(!a.ok){clarify(a.reason);return;}
        previous=a.plan;state.last=a;state.question=q;drawer().querySelector("#local-ask-title").textContent="Your answer";
        const facts=a.facts.length&&a.plan.kind!=="spending"?'<dl class="ask-facts">'+a.facts.map(f=>'<div><dt>'+esc(f.label)+'</dt><dd>'+esc(f.value)+'</dd></div>').join("")+'</dl>':'';
        content.innerHTML='<p class="ask-prompt">'+esc(q)+'</p><article class="plan" data-ask-answer><div class="plan-top"><span class="eyebrow">'+esc(a.basis)+'</span><h3 class="ask-amount">'+esc(a.title)+'</h3><p class="sub">'+esc(a.detail)+'</p></div>'+facts+
          (a.links.length?'<details data-ask-evidence><summary>'+esc(["spending","receipts"].includes(a.plan.kind)?(a.rowCount>a.links.length?"See the latest "+a.links.length+" of "+a.rowCount+" entries":"See the entries"):"See the source")+'</summary><div class="plan-points">'+links(a.links)+'</div></details>':'')+
          (a.periods?'<div class="sugg">'+a.periods.map((p,i)=>btn("See "+p.label,'data-ask-period="'+i+'"')).join("")+'</div>':'')+
          '<div class="plan-foot">'+esc(a.source)+'</div></article>';
        content.querySelectorAll("[data-ask-go]").forEach(b=>b.onclick=()=>{if(current())go(b.dataset.askGo);});
        content.querySelectorAll("[data-ask-period]").forEach(b=>b.onclick=()=>{const p=a.periods[Number(b.dataset.askPeriod)];if(current())answer("Spending in "+p.label,K.run(E,m,{...a.plan,kind:"spending",time:p.time}));});
        showChoices(a.plan.kind==="spending"?[["Compare with the month before","Compare that with the previous month"],["The month before","What about the month before?"]]:a.plan.kind==="goalScenario"?[...(!a.plan.filter?[["What if we cut all unused?","If we cancelled all unused subscriptions, how much sooner could we reach our "+a.plan.goal+"?"]]:[]),["See unused subscriptions","Which subscriptions haven’t we used?"],["See this goal","When will the "+a.plan.goal+" be funded?"],examples.find(x=>x[0]==="Spending changes")]:examples.filter(x=>x[1]!==q).slice(0,3));
      }
      function clarify(why,options){drawer().querySelector("#local-ask-title").textContent="Ask the Kitty";content.innerHTML='<div class="plan" data-ask-clarify><h3>Let’s narrow that down</h3><p>'+esc(why||"Try a category and a month, a savings goal, or an upcoming bill.")+'</p>'+(options?'':deeper)+'</div>';showChoices(options||examples);}
      function ask(q){
        q=String(q).trim();if(!q||q.length>800||!current())return;
        input.value="";input.blur();
        const primary=K.plan(q,m,previous);
        if(primary.kind!=="unsupported"){answer(q,K.run(E,m,primary));return;}
        if(primary.choices){clarify(primary.reason,primary.choices);return;}
        const routing=root.KittyAskRouting, prepared=routing.prepare(q,K.context(m)),local=routing.local(prepared);
        if(local){const {status,...fields}=local;answer(q,K.run(E,m,fields));return;}
        const options=routing.alternatives(prepared).map(p=>K.run(E,m,p)).filter(a=>a.ok);
        if(!options.length){clarify(primary.reason);return;}
        content.innerHTML='<div class="plan" data-ask-scope><h3>Which figure do you mean?</h3><p class="sub">Cash is the Sheet’s cash and offset. Net worth also includes other assets and debts.</p><div class="plan-facts">'+options.map((a,i)=>'<button type="button" class="pf" data-ask-option="'+i+'"><b>'+esc(a.title)+'</b><span>'+esc(a.basis)+'</span></button>').join("")+'</div></div>';
        content.querySelectorAll("[data-ask-option]").forEach(b=>b.onclick=()=>{if(current())answer(q,options[Number(b.dataset.askOption)]);});
        showChoices(examples.slice(0,2));
      }
      host.querySelector("form").onsubmit=ev=>{ev.preventDefault();ask(input.value);};
      choices.onclick=ev=>{const b=ev.target.closest("[data-ask-example]");if(b)ask(b.dataset.askExample);};
      if(state.last)answer(state.question,state.last);else showChoices(examples);
    }
  };
})(window);
