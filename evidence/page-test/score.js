const pw = require('playwright');
const fs = require('fs'), path = require('path');
const runs = process.argv.slice(2);
function variant(html, mut) {
  const m = html.match(/(<script[^>]*id=["']kitty-data["'][^>]*>)([\s\S]*?)(<\/script>)/);
  if (!m) return null;
  const d = JSON.parse(m[2]); mut(d);
  return html.replace(m[0], m[1] + JSON.stringify(d) + m[3]);
}
(async () => {
  const b = await pw.chromium.launch();
  const out = {};
  for (const run of runs) {
    const dir = path.join(__dirname, 'runs', run), html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const R = out[run] = { bytes: html.length };
    const load = async (file, w, scheme, shot) => {
      const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
      await p.goto('file://' + file, { waitUntil: 'load' }); await p.waitForTimeout(900);
      const info = await p.evaluate(() => {
        const t = document.body.innerText, de = document.documentElement;
        const bg = getComputedStyle(document.body).backgroundColor;
        return { sideways: de.scrollWidth > innerWidth + 1, textLen: t.length, bg, text: t.slice(0, 20000) };
      });
      if (shot) await p.screenshot({ path: path.join(__dirname, 'shots', `${run}-${shot}.png`), fullPage: false });
      await p.close(); return { ...info, errs };
    };
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    const main = path.join(dir, 'index.html');
    const L = await load(main, 1280, 'light', 'laptop'), D = await load(main, 1280, 'dark', 'dark'), Ph = await load(main, 390, 'light', 'phone');
    R.errors = [...new Set([...L.errs, ...D.errs, ...Ph.errs])].slice(0, 3);
    R.phone_sideways = Ph.sideways; R.dark_bg_differs = L.bg !== D.bg;
    const t = L.text;
    R.ids_shown = (t.match(/\b(ACC-[A-Z]+|LN-[A-Z]+|T0\d{3}|cashflow\.[a-z_.]+|networth\.[a-z_.]+|SUBS|GROC[A-Z]*)\b/g) || []).slice(0, 6);
    R.money_progress = /\$[\d,.]+k? of \$[\d,.]+k?|\$[\d,.]+k? to go/i.test(t);
    R.verdict = /on track|worth a look|mostly on track|off track|behind|ahead/i.test(t.slice(0, 1500));
    R.estimate_label = /estimat/i.test(t);
    R.as_of = /as of|as at|updated|data to|latest month|January 2027/i.test(t.slice(0, 3000));
    R.reduced_motion = /prefers-reduced-motion/.test(html); R.color_scheme = /prefers-color-scheme/.test(html);
    R.dialog = /role=["']dialog|<dialog/.test(html); R.escape = /Escape/.test(html); R.tabular = /tabular-nums/.test(html);
    // empty transactions
    const v1 = variant(html, d => { d.transactions = []; });
    if (v1) { fs.writeFileSync(path.join(dir, '_empty.html'), v1); const E = await load(path.join(dir, '_empty.html'), 1280, 'light', 'empty');
      R.empty_errors = E.errs.slice(0, 2); R.empty_says_none = /no transactions|nothing (yet|to show)|no data yet|not yet/i.test(E.text); R.empty_textLen = E.textLen; }
    const v2 = variant(html, d => { delete d.goals; delete d.compliance; delete d.subscriptions; });
    if (v2) { fs.writeFileSync(path.join(dir, '_missing.html'), v2); const M = await load(path.join(dir, '_missing.html'), 1280, 'light', 'missing');
      R.missing_errors = M.errs.slice(0, 2); R.missing_textLen = M.textLen; R.normal_textLen = L.textLen; }
  }
  fs.writeFileSync(path.join(__dirname, 'scores.json'), JSON.stringify(out, null, 1));
  for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v));
  await b.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
