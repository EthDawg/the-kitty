const pw = require('playwright');
(async () => {
  const b = await pw.chromium.launch();
  for (const run of process.argv.slice(2)) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.goto('file://' + __dirname + '/runs/' + run + '/index.html');
    await p.waitForTimeout(600);
    const cands = await p.$$('button');
    let clicked = null;
    for (const c of cands) {
      const t = (await c.innerText()).trim();
      if (/check|look|what makes|net worth|\$/i.test(t) && !/dark|light|theme/i.test(t)) { await c.focus(); await c.click(); clicked = t.slice(0, 40); break; }
    }
    await p.waitForTimeout(500);
    const st = await p.evaluate(() => {
      const d = document.querySelector('dialog[open],[role=dialog]:not([hidden])');
      return { open: !!d, focusInside: d ? d.contains(document.activeElement) : false, text: d ? d.innerText.slice(0, 160).replace(/\n+/g, ' | ') : '' };
    });
    await p.screenshot({ path: __dirname + '/shots/' + run + '-drawer.png' });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    const after = await p.evaluate(() => ({ closed: !document.querySelector('dialog[open]'), focusOn: document.activeElement && document.activeElement.textContent.trim().slice(0, 30) }));
    console.log(run, 'clicked:', clicked, JSON.stringify(st), JSON.stringify(after));
    await p.close();
  }
  await b.close();
})();
