const pw = require('playwright');
const fs = require('fs');
(async () => { const b = await pw.chromium.launch();
 for (const run of process.argv.slice(2)) { const f = __dirname + '/runs/' + run + '/index.html'; const html = fs.readFileSync(f, 'utf8');
  const p = await b.newPage({ viewport: { width: 390, height: 844 } }); await p.goto('file://' + f); await p.waitForTimeout(700);
  const r = await p.evaluate(() => { let min = 99, minTxt = ''; const big = [];
    for (const el of document.querySelectorAll('body *')) { if (!el.childNodes.length) continue; const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1); if (!own) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const fs = parseFloat(cs.fontSize); if (fs < min) { min = fs; minTxt = el.textContent.trim().slice(0, 30); } }
    const tiles = [...document.querySelectorAll('body *')].filter(e => /^\$[\d,]{8,}$/.test(e.textContent.trim())).length;
    return { minFont: min, minTxt, longDollarTiles: tiles }; });
  const anim = /@keyframes|animation:|transition:/.test(html);
  const nativeDialog = /<dialog|showModal\(/.test(html);
  console.log(run, JSON.stringify({ ...r, anim, nativeDialog })); await p.close(); }
 await b.close(); })();
