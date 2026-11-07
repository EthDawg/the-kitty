// node check.js  -> renders index.html at laptop and phone sizes, light and dark; screenshots in shots/
const pw = require('playwright');
const path = require('path'), fs = require('fs');
(async () => {
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  const b = await pw.chromium.launch();
  for (const [name, w, h, scheme] of [['laptop-light', 1280, 900, 'light'], ['laptop-dark', 1280, 900, 'dark'], ['phone-light', 390, 844, 'light'], ['phone-dark', 390, 844, 'dark']]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await p.goto('file://' + path.join(__dirname, 'index.html'), { waitUntil: 'load' }); await p.waitForTimeout(800);
    const m = await p.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: innerWidth, docH: document.documentElement.scrollHeight }));
    await p.screenshot({ path: path.join(__dirname, 'shots', name + '.png'), fullPage: true });
    console.log(name, JSON.stringify({ ...m, sidewaysScroll: m.docW > m.vw + 1, errors: errs }));
    await p.close();
  }
  await b.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
