// ============================================================
// RECHERCHE D'EXERCICES BILINGUE — taper le nom anglais (« bench press »,
// « barbell squat », « lat pulldown »…) trouve l'exercice français de la
// bibliothèque (« Développé Couché (Barre) »…).
// Deux sources :
//   - un lexique anglais → français des termes de musculation ;
//   - le nom anglais des fiches d'exercices (exercise-guides.js), chargé
//     en arrière-plan.
// ============================================================

export const normalize = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[()[\]/,.\-–—_+'"]/g, " ").replace(/\s+/g, " ").trim();

// Expressions anglaises (sans accents, minuscules) → équivalent français.
// Les plus longues sont appliquées en premier.
const EN_FR = {
  "romanian deadlift": "souleve de terre roumain", "stiff leg deadlift": "souleve de terre jambes tendues",
  "sumo deadlift": "souleve de terre sumo", "deadlift": "souleve de terre", "rdl": "souleve de terre roumain",
  "incline bench press": "developpe couche incline", "decline bench press": "developpe couche decline",
  "close grip bench press": "developpe couche prise serree", "bench press": "developpe couche",
  "chest press": "chest press", "overhead press": "developpe militaire", "military press": "developpe militaire",
  "shoulder press": "developpe epaules", "arnold press": "arnold press", "floor press": "developpe au sol",
  "lat pulldown": "tirage poitrine", "pulldown": "tirage", "pull down": "tirage",
  "straight arm pulldown": "pullover poulie", "pull up": "traction", "pullup": "traction", "chin up": "traction prise inversee", "chinup": "traction prise inversee",
  "bent over row": "rowing barre", "seated cable row": "rowing assis poulie", "cable row": "rowing poulie", "upright row": "rowing menton", "t bar row": "rowing barre t", "row": "rowing",
  "hammer curl": "curl marteau", "preacher curl": "curl pupitre", "incline curl": "curl incline", "concentration curl": "curl concentration", "reverse curl": "curl inverse",
  "leg curl": "leg curl", "nordic curl": "nordic curl", "bicep curl": "curl biceps", "biceps curl": "curl biceps",
  "lateral raise": "elevation laterale", "side raise": "elevation laterale", "front raise": "elevation frontale",
  "rear delt fly": "oiseau", "rear delt": "oiseau", "reverse fly": "oiseau", "face pull": "face pull",
  "chest fly": "ecarte", "cable fly": "ecarte poulie", "cable crossover": "ecarte poulie vis a vis", "crossover": "vis a vis", "pec deck": "pec deck", "butterfly": "pec deck", "fly": "ecarte", "flye": "ecarte",
  "triceps extension": "extension triceps", "tricep extension": "extension triceps", "overhead triceps extension": "extension triceps nuque",
  "triceps pushdown": "extension triceps poulie haute", "tricep pushdown": "extension triceps poulie haute", "pushdown": "extension triceps poulie haute", "pressdown": "extension triceps poulie haute",
  "rope": "corde", "skull crusher": "skullcrusher", "kickback": "kickback",
  "leg press": "presse a cuisses", "leg extension": "extension jambes", "hack squat": "hack squat", "front squat": "front squat",
  "goblet squat": "squat gobelet", "bulgarian split squat": "fentes bulgares", "split squat": "fentes", "lunge": "fente", "lunges": "fentes", "step up": "step up",
  "calf raise": "mollets", "calves": "mollets", "hip thrust": "hip thrust", "glute bridge": "pont fessier", "glute kickback": "kickback fessiers",
  "hip abduction": "abduction hanche", "hip adduction": "adducteurs", "abduction": "abduction", "adduction": "adducteurs", "good morning": "good morning",
  "shrug": "shrug haussement", "back extension": "extension lombaire", "hyperextension": "extension lombaire",
  "push up": "pompes", "pushup": "pompes", "dip": "dips", "dips": "dips", "plank": "planche gainage", "side plank": "gainage lateral",
  "crunch": "crunch", "sit up": "abdos", "leg raise": "releve de jambes", "hanging leg raise": "releve de jambes suspendu", "russian twist": "rotation russe", "ab wheel": "roue abdominale",
  "wrist curl": "flexion poignet", "farmer walk": "marche du fermier", "farmers walk": "marche du fermier",
  "barbell": "barre", "dumbbell": "haltere", "dumbbells": "haltere", "cable": "poulie", "machine": "machine", "smith machine": "smith",
  "ez bar": "barre ez", "bodyweight": "poids du corps", "band": "elastique", "kettlebell": "kettlebell",
  "seated": "assis", "standing": "debout", "lying": "allonge", "incline": "incline", "decline": "decline",
  "one arm": "un bras", "single arm": "un bras", "single leg": "une jambe", "close grip": "prise serree", "wide grip": "prise large", "reverse grip": "prise inversee",
  "squat": "squat", "curl": "curl", "press": "developpe", "raise": "elevation", "extension": "extension"
};
const PHRASES = Object.keys(EN_FR).sort((a, b) => b.length - a.length);

// Traduit une recherche anglaise en termes français (chaîne normalisée).
export function translateQuery(q) {
  let s = ` ${normalize(q)} `;
  for (const en of PHRASES) {
    const re = new RegExp(`(^|\\s)${en.replace(/ /g, "\\s")}(?=\\s|$)`, "g");
    s = s.replace(re, (m, pre) => `${pre}\u0001${EN_FR[en].replace(/ /g, "\u0002")}`);
  }
  return s.replace(/\u0001/g, "").replace(/\u0002/g, " ").replace(/\s+/g, " ").trim();
}

// Noms anglais des fiches (français -> anglais normalisé), chargés à la demande.
let aliases = null;
let aliasesPromise = null;
export function loadAliases() {
  if (!aliasesPromise) {
    aliasesPromise = import("./exercise-guides.js")
      .then(m => { aliases = new Map(Object.entries(m.EXERCISE_GUIDES).filter(([, g]) => g.en).map(([fr, g]) => [fr.toLowerCase(), normalize(g.en)])); })
      .catch(() => { aliases = new Map(); });
  }
  return aliasesPromise;
}

// Tous les mots de la recherche retrouvés au début d'un mot du nom.
function allWordsIn(queryNorm, nameNorm) {
  const words = nameNorm.split(" ");
  const qs = queryNorm.split(" ").filter(Boolean);
  return qs.length > 0 && qs.every(q => words.some(w => w.startsWith(q) || (q.length > 3 && w.startsWith(q.replace(/s$/, "")))));
}

// Score de pertinence d'un nom pour une recherche (0 = ne correspond pas).
// Renvoie aussi, le cas échéant, le nom anglais qui a permis de trouver.
export function exerciseMatch(query, name) {
  const q = normalize(query);
  if (!q) return { score: 0 };
  const n = normalize(name);
  if (n.startsWith(q)) return { score: 100 };
  if (n.includes(q)) return { score: 80 };
  if (allWordsIn(q, n)) return { score: 70 };
  // Recherche en anglais : nom anglais de la fiche et/ou traduction des termes.
  const en = aliases?.get(String(name).toLowerCase());
  const aliasHit = !!en && (en.startsWith(q) || en.includes(q) || allWordsIn(q, en));
  const fr = translateQuery(q);
  const transHit = !!fr && fr !== q && (n.includes(fr) || allWordsIn(fr, n));
  if (!aliasHit && !transHit) return { score: 0 };
  // Les deux sources d'accord : plus sûr. Puis, à score égal, le nom le
  // plus proche (le moins de mots en plus) passe devant.
  const extra = Math.max(0, n.split(" ").length - (transHit ? fr : q).split(" ").length);
  return { score: (aliasHit && transHit ? 65 : aliasHit ? 60 : 55) - Math.min(extra, 9) * 0.5, via: en || q };
}

// Recherche dans une liste de noms : meilleurs résultats d'abord.
export function searchExercises(query, names, max = 8) {
  return names.map(name => ({ name, ...exerciseMatch(query, name) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"))
    .slice(0, max);
}
