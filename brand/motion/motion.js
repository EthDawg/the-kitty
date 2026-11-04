// The Kitty motion helpers. Dependency-free. Each one is finite, fires on an event, and is a no-op under reduced motion
// except the fortune slip, which still shows its text. Usage: KittyMotion.beckon(el); KittyMotion.rain(); KittyMotion.fortune(btn, text).
(function (root) {
  const reduced = () => root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const once = (el, cls, ms) => { if (!el || reduced()) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
  const COIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#C98A14"/><circle cx="12" cy="11" r="10" fill="#F2B134"/><rect x="8.5" y="7.5" width="7" height="7" rx="1.2" fill="#C98A14"/></svg>';
  const NOTE = '<svg viewBox="0 0 36 20" aria-hidden="true"><rect width="36" height="20" rx="3" fill="#8DE3C8"/><rect x="2" y="2" width="32" height="16" rx="2" fill="none" stroke="#0E8F8E" stroke-width="1.5"/><circle cx="18" cy="10" r="4.5" fill="none" stroke="#0E8F8E" stroke-width="1.5"/></svg>';
  const K = {
    // The lucky cat beckons once: good news only (goal reached, month closed, import done). Never on load.
    beckon(el) { once(el, "beckon", 1700); },
    // The dog wags twice: the dog brand's equivalent.
    wag(el) { once(el, "wag", 1900); },
    // Coins and notes fall for about two seconds: money milestones only. Returns a promise that resolves when done.
    rain(opts = {}) {
      if (reduced()) return Promise.resolve();
      const n = opts.count || 18, notes = opts.notes !== false, host = opts.host || document.body;
      const box = document.createElement("div"); box.className = "k-rain"; box.setAttribute("aria-hidden", "true");
      for (let i = 0; i < n; i++) {
        const s = document.createElement("span"); const isNote = notes && i % 3 === 0;
        s.innerHTML = isNote ? NOTE : COIN;
        s.style.setProperty("--x", (4 + Math.random() * 92) + "%");
        s.style.setProperty("--w", (isNote ? 30 + Math.random() * 14 : 16 + Math.random() * 14) + "px");
        s.style.setProperty("--t", (1.4 + Math.random() * 1.1) + "s");
        s.style.setProperty("--d", (Math.random() * .6) + "s");
        s.style.setProperty("--spin", (Math.random() < .5 ? "-" : "") + (180 + Math.random() * 540) + "deg");
        box.appendChild(s);
      }
      host.appendChild(box);
      return new Promise((res) => setTimeout(() => { box.remove(); res(); }, 3400));
    },
    // A fortune cookie (or the dog's biscuit) that cracks to reveal one line: the Kitty's proposal or insight.
    // `btn` is a button.k-fortune holding the cookie svg; `text` is the line. The cookie opens on click; `onOpen` fires once.
    fortune(btn, text, onOpen) {
      if (!btn) return; let slip = btn.querySelector(".k-slip");
      if (!slip) { slip = document.createElement("span"); slip.className = "k-slip"; btn.appendChild(slip); }
      slip.textContent = text; btn.classList.remove("open"); const svg = btn.querySelector("svg"); if (svg) svg.classList.remove("open");
      btn.setAttribute("aria-label", "Crack the cookie to read the Kitty's suggestion");
      const open = () => { if (btn.classList.contains("open")) return; btn.classList.add("open"); if (svg) svg.classList.add("open"); btn.setAttribute("aria-label", text); if (onOpen) onOpen(); };
      btn.onclick = open; if (reduced()) open();
      return open;
    },
  };
  root.KittyMotion = K;
})(window);
