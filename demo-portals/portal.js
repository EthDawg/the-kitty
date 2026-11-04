/* Read-only fixture portal. No credentials, analytics, persistence or network calls. */
(() => {
  'use strict';
  const data=window.KITTY_DEMO_FIXTURES;
  const $=s=>document.querySelector(s);
  const colours={harbour:'#174e4a',southern:'#443a61',wattle:'#38543d'};
  const format=minor=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(minor/100);
  const text=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
  const row=(date,description,amount)=>{const tr=document.createElement('tr');tr.append(text('td',date),text('td',description),text('td',(amount>0?'+':'')+format(amount),'numeric'));return tr;};
  function select(id,announce=true){
    const bank=data.core.find(b=>b.id===id);if(!bank)return;
    document.documentElement.style.setProperty('--brand',colours[id]);
    for(const button of document.querySelectorAll('[data-bank]'))button.setAttribute('aria-pressed',String(button.dataset.bank===id));
    $('#bank-name').textContent=bank.display_brand;
    $('#bank-caption').textContent=bank.canonical_provider+' fixture · '+bank.account_id;
    $('#account-label').textContent=bank.id==='southern'?(bank.closing_minor>=0?'Card credit balance · overpayment':'Card amount owing'):bank.label+' · closing balance';
    $('#balance').textContent=format(bank.id==='southern'?Math.abs(bank.closing_minor):bank.closing_minor);
    $('#balance-note').textContent=bank.id==='southern'?'Signed ledger balance '+format(bank.closing_minor)+' · 28 Feb 2027':'Opening balance '+format(bank.opening_minor)+' · 28 Feb 2027';
    $('#download-csv').href='fixtures/'+bank.file;
    $('#download-csv').setAttribute('aria-label','Download '+bank.display_brand+' transactions CSV');
    $('#download-statement').href='fixtures/'+bank.statement_file;
    $('#download-statement').setAttribute('aria-label','Download '+bank.display_brand+' sample statement HTML');
    $('#filename').textContent=bank.file.split('/').pop()+' · '+bank.rows+' rows';
    $('#format-note').textContent=bank.format_note;
    $('#transactions').replaceChildren(...bank.preview.map(r=>row(r.date,r.description,r.amount_minor)));
    if(announce)$('#announcement').textContent=bank.display_brand+' selected. '+bank.rows+' statement transactions.';
  }
  for(const bank of data.core){
    const button=document.createElement('button');button.type='button';button.dataset.bank=bank.id;button.setAttribute('aria-pressed','false');
    const mark=text('span',{harbour:'H',southern:'SX',wattle:'W'}[bank.id],'bank-mark');mark.style.background=colours[bank.id];mark.setAttribute('aria-hidden','true');
    const label=text('span',bank.display_brand);label.append(text('small',bank.label));button.append(mark,label);button.addEventListener('click',()=>select(bank.id));$('#banks').append(button);
  }
  for(const source of data.evidence){
    const card=document.createElement('article');card.className='evidence-card';card.append(text('p',source.kind+' · experimental','eyebrow'),text('h3',source.display_brand),text('p',source.label),text('p',source.note));
    const a=text('a','Download '+source.label.toLowerCase()+' CSV ↓');a.href='fixtures/'+source.file;a.download='';card.append(a,text('small',source.file.split('/').pop()+' · '+source.rows+' example rows'));$('#evidence-grid').append(card);
  }
  $('#show-evidence').addEventListener('click',()=>{const show=$('#evidence-panel').hidden;$('#evidence-panel').hidden=!show;$('#show-evidence').setAttribute('aria-expanded',String(show));$('#show-evidence').textContent=show?'Hide optional fixtures':'Explore optional fixtures';});
  select('harbour',false);
})();
