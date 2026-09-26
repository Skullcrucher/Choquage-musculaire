// ============================================================
// CORRESPONDANCE DES NOMS D'EXERCICES — pour qu'un plan importé réutilise
// les exercices de la bibliothèque (et donc l'historique, les stats, le
// pré-remplissage) au lieu de créer des doublons à cause d'un nom écrit
// différemment : accents, majuscules, ordre des mots, « barbell » au lieu
// de « barre », nom anglais d'une fiche, petite faute de frappe.
// ============================================================

// Équivalences de vocabulaire (matériel surtout), après suppression des accents.
const SYNONYMS = {
  barbell: "barre", bb: "barre", bar: "barre",
  dumbbell: "haltere", dumbbells: "haltere", db: "haltere", halteres: "haltere",
  cable: "poulie", cables: "poulie", pulley: "poulie",
  machines: "machine", smith: "smith",
  bodyweight: "poidsducorps", "poids du corps": "poidsducorps",
  ez: "ez", incline: "incline", inclinee: "incline", decline: "decline", declinee: "decline",
  squats: "squat", tractions: "traction", pompes: "pompe", fentes: "fente", dips: "dip",
  developpe: "developpe", couchee: "couche"
};
const STOP = new Set(["de", "du", "des", "la", "le", "les", "a", "au", "aux", "en", "et", "the", "with", "on"]);

export function normName(name) {
  let s = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  s = s.replace(/poids du corps/g, "poidsducorps").replace(/[()[\]/,.\-–—_+'"]/g, " ");
  const tokens = s.split(/\s+/).filter(Boolean).map(w => SYNONYMS[w] || w).filter(w => !STOP.has(w))
    .map(w => (w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)); // pluriels
  return [...new Set(tokens)].sort().join(" ");
}

function bigrams(s) {
  const out = new Map();
  const str = ` ${s} `;
  for (let i = 0; i < str.length - 1; i++) {
    const g = str.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}
// Similarité de Dice sur les bigrammes (0 à 1), sur les noms normalisés.
export function similarity(a, b) {
  const A = bigrams(normName(a)), B = bigrams(normName(b));
  let inter = 0, total = 0;
  A.forEach((n, g) => { inter += Math.min(n, B.get(g) || 0); total += n; });
  B.forEach(n => { total += n; });
  return total ? (2 * inter) / total : 0;
}

// Prépare la recherche pour une bibliothèque donnée. match(nom) renvoie :
//   { status: "exact" | "same" | "auto" | "suggest" | "new", name, candidates }
// - exact   : nom identique (majuscules près)
// - same    : même nom une fois normalisé (accents, ordre, synonymes) ou
//             nom anglais d'une fiche d'exercice
// - auto    : très proche (faute de frappe) → remplacé, affiché dans l'aperçu
// - suggest : ressemblant → proposé, à confirmer dans l'aperçu
// - new     : rien d'approchant → nouvel exercice
export async function buildMatcher(library) {
  const names = library.map(e => e.name);
  const byNorm = new Map();
  names.forEach(n => { const k = normName(n); if (!byNorm.has(k)) byNorm.set(k, n); });
  let guides = {};
  try { guides = (await import("./exercise-guides.js")).EXERCISE_GUIDES; } catch (_) {}
  const enToFr = new Map();
  Object.entries(guides).forEach(([fr, g]) => { if (g.en) enToFr.set(normName(g.en), fr); });
  const lowerMap = new Map(names.map(n => [n.toLowerCase(), n]));

  return function match(raw) {
    const name = String(raw || "").trim();
    if (lowerMap.has(name.toLowerCase())) return { status: "exact", name: lowerMap.get(name.toLowerCase()), candidates: [] };
    const k = normName(name);
    if (byNorm.has(k)) return { status: "same", name: byNorm.get(k), candidates: [] };
    const fr = enToFr.get(k);
    if (fr && lowerMap.has(fr.toLowerCase())) return { status: "same", name: lowerMap.get(fr.toLowerCase()), candidates: [] };
    const scored = names.map(n => ({ n, s: similarity(name, n) })).sort((a, b) => b.s - a.s).slice(0, 4);
    const best = scored[0];
    if (best && best.s >= 0.88) return { status: "auto", name: best.n, candidates: scored.filter(x => x.s >= 0.5).map(x => x.n) };
    // Ressemblance : sinon on garde le nom saisi et l'aperçu laisse choisir.
    if (best && best.s >= 0.6) {
      // Tous les mots saisis se retrouvent dans le nom de la bibliothèque
      // (seul le matériel manque, ex. « Front squat ») : proposé d'office.
      // Plusieurs noms possibles (ex. haltère ou poulie) : l'utilisateur choisit.
      const mine = k.split(" ");
      const fits = scored.filter(x => x.s >= 0.6 && mine.every(w => new Set(normName(x.n).split(" ")).has(w)));
      return { status: "suggest", name: best.n, preselect: fits.length === 1 && fits[0].n === best.n, candidates: scored.filter(x => x.s >= 0.5).map(x => x.n) };
    }
    return { status: "new", name, candidates: scored.filter(x => x.s >= 0.45).map(x => x.n) };
  };
}
