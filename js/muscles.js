// ============================================================
// GROUPES MUSCULAIRES — devine le groupe d'un exercice d'après son nom
// (français ou anglais), et propose le bon groupe pour corriger la
// bibliothèque : liste standard > fiche d'exercice > nom.
//
// L'ordre des tests compte : "Leg Curl" ou "Curl Ischio" sont des
// exercices de jambes, "Relevé de jambes" des abdos, "Rowing Machine"
// du cardio, "Kickback Fessiers" des fessiers, etc.
// ============================================================
const RULES = [
  ["Cardio", /(rowing machine|rameur|treadmill|tapis de course|vélo|velo\b|bike|elliptique|elliptical|stair|jump rope|corde à sauter|running|course à pied|cycling|assault)/],
  ["Abdominaux", /(abdo|crunch|gainage|planche|plank|sit.?up|leg raise|knee raise|relevé de (jambes|genoux)|russian twist|ab wheel|roue|heel tap|side bend|flexion latérale|scissors|ciseaux|hollow|mountain climber|dead bug|v.?up|rotation russe)/],
  ["Triceps", /(triceps|tricep|skull ?crusher|barre au front|pushdown|pressdown|french press|dips? (entre bancs|banc)|bench dip|prise serrée \(barre\)|close.?grip bench)/],
  ["Fessiers", /(hip thrust|fessier|glute|abduct|pont|bridge|donkey kick|kickback (fessier|hanche)|good morning)/],
  ["Jambes", /(squat|fente|lunge|leg press|presse (à|a) cuisse|presse horizontale|leg extension|extension (des )?jambe|leg curl|curl (ischio|jambe|allongé|couché|assis)|ischio|hamstring|nordic|nordique|mollet|calf|adduct|step.?up|cuisse|quadri|rdl|roumain|romanian|stiff.?leg|jambes? tendues|split|sissy|hack|jambe)/],
  ["Avant-bras", /(wrist|poignet|forearm|avant-bras|farmer|préhension|grip trainer)/],
  ["Épaules", /(épaule|epaule|militaire|latérale|laterale|frontale|oiseau|shoulder|overhead press|military|lateral raise|front raise|face pull|rear delt|arnold|y raise|upright row|rowing menton|tirage menton)/],
  ["Biceps", /(curl|biceps)/],
  ["Pectoraux", /(développé couché|developpe couche|chest press|chest fly|écarté|ecarte|écart|dips?\b|dip machine|bench press|cable fly|pec deck|hex press|push.?up|pompe|butterfly|crossover|incline press|pull.?over)/],
  ["Dos", /(rowing|tirage|rack pull|traction|\brow\b|pulldown|pull.?up|chin.?up|deadlift|soulevé de terre|souleve de terre|back extension|hyperextension|lombaire|shrug|haussement|t.?bar|landmine|\blat\b|clean pull)/]
];

export function guessMuscleGroup(exerciseTitle) {
  const e = String(exerciseTitle || "").toLowerCase();
  for (const [group, re] of RULES) if (re.test(e)) return group;
  return "Autre";
}

// Muscle principal d'une fiche (free-exercise-db) -> groupe de l'app.
export const GUIDE_TO_GROUP = {
  "Pectoraux": "Pectoraux", "Épaules": "Épaules", "Biceps": "Biceps", "Triceps": "Triceps",
  "Avant-bras": "Avant-bras", "Abdominaux": "Abdominaux", "Fessiers": "Fessiers",
  "Quadriceps": "Jambes", "Ischio-jambiers": "Jambes", "Mollets": "Jambes", "Adducteurs": "Jambes", "Abducteurs": "Fessiers",
  "Grand dorsal": "Dos", "Milieu du dos": "Dos", "Bas du dos": "Dos", "Trapèzes": "Dos"
};

// Groupe proposé pour corriger la bibliothèque (null si aucune idée).
export async function suggestMuscleGroup(name) {
  const [{ EXERCISE_SEED }, { EXERCISE_GUIDES }] = await Promise.all([import("./exercises-seed.js"), import("./exercise-guides.js")]);
  const low = name.toLowerCase();
  const seed = EXERCISE_SEED.find(([n]) => n.toLowerCase() === low);
  if (seed) return seed[1];
  const guideKey = Object.keys(EXERCISE_GUIDES).find(k => k.toLowerCase() === low || EXERCISE_GUIDES[k].en?.toLowerCase() === low);
  const primary = guideKey && EXERCISE_GUIDES[guideKey].primaryMuscles?.[0];
  if (primary && GUIDE_TO_GROUP[primary]) return GUIDE_TO_GROUP[primary];
  const guess = guessMuscleGroup(name);
  return guess === "Autre" ? null : guess;
}
