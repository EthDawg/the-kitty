#!/usr/bin/env node
// Demo harness for one shared view module: node tools/kit-demo/build.js <module>  ->  tools/kit-demo/out/<module>.html
// Inlines the page tokens, a base card style, the module's CSS and JS, and the Davies input from <module>.data.js.
// Open ?theme=dark or ?theme=light; ?w=home renders the module's home card instead of its full view.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const mod = process.argv[2];
if (!mod) { console.error("usage: build.js <module>"); process.exit(2); }
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const input = require(path.join(__dirname, `${mod}.data.js`))();
const css = fs.existsSync(path.join(ROOT, `src/kit/${mod}.css`)) ? rd(`src/kit/${mod}.css`) : "";
const base = `
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--body);-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
main{max-width:1180px;margin:0 auto;padding:24px max(16px,env(safe-area-inset-left,0px)) 80px}
.num{font-variant-numeric:tabular-nums}
.card{background:var(--surface);border-radius:var(--r);box-shadow:var(--shadow);padding:20px;min-width:0;position:relative}
.card .sub,.sub{color:var(--muted);font-size:13.5px}
.cardhead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.cardhead .q{font-family:var(--display);font-size:19px;font-weight:700}
.say{font-size:16px;margin:0 0 12px}
.linkbtn{color:var(--accent);font-weight:600;font-size:13.5px;padding:6px 0;min-height:32px}
.empty{color:var(--muted);padding:24px 0;text-align:center}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
#drawer{position:fixed;inset:auto 0 0 auto;top:0;width:min(560px,100%);background:var(--surface);box-shadow:var(--shadow-lg,0 24px 60px rgba(0,0,0,.25));padding:24px;overflow:auto;transform:translateX(105%);transition:transform .25s var(--ease)}
#drawer.on{transform:none}#drawer .close{position:absolute;right:14px;top:12px;font-size:22px}
@media (max-width:600px){#drawer{width:100%;top:12vh;border-radius:var(--r) var(--r) 0 0}}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>kit demo: ${mod}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap">
<style>${rd("src/tokens.css")}${base}${css}</style></head><body>
<main id="app"></main><aside id="drawer" role="dialog" aria-modal="true" aria-label="Details"><button class="close" aria-label="Close">×</button><div id="dbody"></div></aside>
<script>window.Kit={};</script><script>${rd(`src/kit/${mod}.js`)}</script>
<script>
(function(){
  var q=new URLSearchParams(location.search); var t=q.get("theme"); if(t) document.documentElement.setAttribute("data-theme",t);
  var input=${JSON.stringify(input)};
  var M=Object.values(window.Kit).find(function(x){return x&&x.model&&x.render;});
  var model=M.model(input); var app=document.getElementById("app"), dr=document.getElementById("drawer");
  var opts={ onOpen:function(h){ document.getElementById("dbody").innerHTML=h; dr.classList.add("on"); if(M.bindDrawer) M.bindDrawer(document.getElementById("dbody"), model, opts); },
    onWrite:function(){ return Promise.resolve({ok:true}); }, onGo:function(t){ console.log("go",t); } };
  dr.querySelector(".close").onclick=function(){ dr.classList.remove("on"); };
  app.innerHTML = q.get("w")==="home" && M.renderHome ? '<div style="max-width:560px">'+M.renderHome(model,opts)+'</div>' : M.render(model,opts);
  if(M.bind) M.bind(app, model, opts);
  window.__ready=true;
})();
</script></body></html>`;
fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "out", `${mod}.html`), html);
console.log(`tools/kit-demo/out/${mod}.html`, Math.round(html.length / 1024) + " KB");
