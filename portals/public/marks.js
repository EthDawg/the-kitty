// Original wordmarks: two ears over a round head, drawn here and nowhere else. No bank's mark appears anywhere in this project.
window.KittyMark = (brand, size = 40) => {
  const c = brand.colors;
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <path d="M8 18 L12 4 L20 13 Z" fill="${c.ink}"/><path d="M32 18 L28 4 L20 13 Z" fill="${c.ink}"/>
    <circle cx="20" cy="24" r="13" fill="${c.ink}"/>
    <circle cx="15" cy="23" r="1.8" fill="${c.brand}"/><circle cx="25" cy="23" r="1.8" fill="${c.brand}"/>
    <path d="M18 28 Q20 30 22 28" stroke="${c.brand}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <circle cx="20" cy="26.5" r="1.1" fill="${c.accent}"/>
  </svg>`;
};
