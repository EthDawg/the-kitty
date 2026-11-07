const pw = require('playwright');
(async () => { const b = await pw.chromium.launch();
 for (const f of process.argv.slice(2)) { const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('file://' + f); await p.waitForTimeout(700);
  const r = await p.evaluate(() => ({ t: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 700),
    clickable: [...document.querySelectorAll('[onclick],button,[role=button],a,[tabindex]')].length,
    dlg: document.querySelectorAll('dialog,[role=dialog]').length }));
  console.log('==', f.split('/runs/')[1], 'clickables', r.clickable, 'dialogs', r.dlg); console.log(r.t); await p.close(); }
 await b.close(); })();
