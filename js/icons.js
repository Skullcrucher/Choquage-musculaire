// ============================================================
// ICÔNES — style « Acier » (contours épais, angles vifs), le même que la
// barre d'onglets. Utilisées dans les onglets et pastilles du haut des
// écrans à la place des emojis. icon(nom) renvoie un <svg> qui prend la
// couleur du texte.
// ============================================================
const PATHS = {
 "routines": "<rect x=\"5\" y=\"4\" width=\"14\" height=\"18\"/><path d=\"M9 2.5h6v3H9zM8.5 10.5h7M8.5 14.5h7M8.5 18.5h4\"/>",
 "plan": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\"/><path d=\"M3 10h18M8 2.5v5M16 2.5v5M8 15.5l3 3 5-6\"/>",
 "general": "<path d=\"M5 21v-6M10 21v-10M15 21v-7M20 21v-14M2.5 21h19\"/>",
 "discover": "<circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/><path d=\"M15.5 15.5l6 6\"/>",
 "trophy": "<path d=\"M7 3h10v6a5 5 0 0 1-10 0zM7 5H3.5v2a4 4 0 0 0 4 4M17 5h3.5v2a4 4 0 0 1-4 4M12 14v4.5M8 21h8\"/>",
 "music": "<path d=\"M4 17v-5a8 8 0 0 1 16 0v5\"/><rect x=\"3\" y=\"14\" width=\"4\" height=\"7\"/><rect x=\"17\" y=\"14\" width=\"4\" height=\"7\"/>",
 "friends": "<circle cx=\"9\" cy=\"8\" r=\"3.5\"/><path d=\"M2.5 21v-2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v2M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.3a5 5 0 0 1 3 4.5V21\"/>",
 "workouts": "<path d=\"M1.5 12h21\" /><rect x=\"4\" y=\"5.5\" width=\"3\" height=\"13\" /><rect x=\"17\" y=\"5.5\" width=\"3\" height=\"13\" /><rect x=\"7.6\" y=\"8.5\" width=\"1.8\" height=\"7\" /><rect x=\"14.6\" y=\"8.5\" width=\"1.8\" height=\"7\" />",
 "gear": "<path d=\"M12.00 1.40 L14.85 4.95 L18.81 3.88 L18.71 8.43 L22.44 10.16 L19.43 13.58 L21.18 17.30 L16.68 17.99 L15.63 21.96 L11.73 19.60 L8.37 21.96 L6.91 17.65 L2.82 17.30 L4.47 13.06 L1.56 10.16 L5.55 7.97 L5.19 3.88 L9.65 4.77Z\" /><circle cx=\"12\" cy=\"12\" r=\"3.2\" />",
 "globe": "<circle cx=\"12\" cy=\"12\" r=\"9.5\"/><path d=\"M2.5 12h19M12 2.5c3 3 3 16 0 19M12 2.5c-3 3-3 16 0 19\"/>",
 "user": "<circle cx=\"12\" cy=\"8\" r=\"4.5\"/><path d=\"M3.5 21.5v-1.5a6 6 0 0 1 6-6h5a6 6 0 0 1 6 6v1.5\"/>",
 "flame": "<path d=\"M12 2.5c1 4 5.5 6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.3-4.2 2.6-5.5.2 2 1 3.2 2.4 3.7-.6-3.4-.4-6.4.5-9.2z\"/>",
 "timer": "<circle cx=\"12\" cy=\"13.5\" r=\"8\"/><path d=\"M12 13.5V9M9 2.5h6M19.5 6l-1.8 1.8\"/>",
 "reset": "<path d=\"M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 3v5h5\"/><path d=\"M9.5 9.5l5 5M14.5 9.5l-5 5\"/>",
 "import": "<path d=\"M12 3v11M7.5 9.5L12 14l4.5-4.5M3.5 15v5.5h17V15\"/>",
 "export": "<path d=\"M12 14V3M7.5 7.5L12 3l4.5 4.5M3.5 15v5.5h17V15\"/>",
 "info": "<circle cx=\"12\" cy=\"12\" r=\"9.5\"/><path d=\"M12 11v6M12 7v.5\"/>",
 "flag": "<path d=\"M5 21.5V3M5 4h12l-2.5 4.5L17 13H5\"/>",
 "book": "<path d=\"M4 4h6a2 2 0 0 1 2 2v15a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v15a2 2 0 0 1 2-2h6z\"/>",
 "history": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\"/><path d=\"M3 10h18M8 2.5v5M16 2.5v5M8.5 13l-2 5.5M12.5 13l-2 5.5M16.5 13l-2 5.5\"/>",
 "chevron": "<path d=\"M9 5l7 7-7 7\"/>"
};

export function icon(name) {
  const p = PATHS[name];
  return p ? `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${p}</svg>` : "";
}

// Sélecteur d'onglets (un seul composant pour tous les onglets du haut).
// items : [[valeur, libellé, icône]] ; attr : attribut data-* porté par
// chaque bouton (ex. "data-smode") ; sub : second niveau, style souligné.
export function segHtml(items, active, attr, { sub = false, extra = {} } = {}) {
  return `<div class="seg ${sub ? "seg-sub" : ""}" data-n="${items.length}" role="tablist">${items.map(([v, label, ic]) =>
    `<button class="seg-btn ${v === active ? "active" : ""}" ${attr}="${v}" role="tab" aria-selected="${v === active}">${ic ? icon(ic) : ""}<span>${label}</span>${extra[v] || ""}</button>`).join("")}</div>`;
}
