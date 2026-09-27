// ============================================================
// PROGRAMMES SKULLCRUSHER — plans standards, libres d'accès, proposés à
// tout le monde dans Découvrir (routines et plans). Intégrés à l'app : rien
// à stocker dans Firestore. Structures classiques et largement publiées :
//   - PPL 6 jours : d'après le programme Push/Pull/Legs gratuit partagé
//     sur r/Fitness (Metallicadpa), charges en double progression ;
//   - PPL 3 jours : version débutant (une fois chaque séance par semaine) ;
//   - Split 5 jours : « un muscle principal par séance » (pecs, dos,
//     jambes, épaules, bras).
// Noms d'exercices = ceux de la bibliothèque standard (exercises-seed.js),
// pour que l'historique, les muscles et les fiches correspondent.
// ============================================================

export const OFFICIAL_AUTHOR = "Skullcrusher";
export const OFFICIAL_UID = "skullcrusher";

const ex = (exercise_name, target_sets, reps_target, rest_seconds, muscle_group) =>
  ({ exercise_name, target_sets, reps_target, rest_seconds, muscle_group });

// ---------- PPL 6 jours ----------
const PPL6_PULL_ACCESSORIES = [
  ex("Tractions", 3, "8-12", 120, "Dos"),
  ex("Rowing Poulie Basse", 3, "8-12", 90, "Dos"),
  ex("Face Pull (Poulie)", 5, "15-20", 60, "Épaules"),
  ex("Curl Marteau (Haltère)", 4, "8-12", 60, "Biceps"),
  ex("Curl Biceps (Haltère)", 4, "8-12", 60, "Biceps")
];
const PPL6_LEGS = [
  ex("Squat (Barre)", 3, "5", 180, "Jambes"),
  ex("Soulevé de Terre Roumain (Barre)", 3, "8-12", 120, "Jambes"),
  ex("Presse à Cuisses", 3, "8-12", 120, "Jambes"),
  ex("Leg Curl Allongé (Machine)", 3, "8-12", 90, "Jambes"),
  ex("Mollets Debout (Machine)", 5, "8-12", 60, "Jambes")
];

// i18n : contenus affichés tels quels (programmes rédigés en français).
export const PROGRAMS = [
  {
    id: "off-ppl6",
    name: "PPL 6 jours (Push / Pull / Legs)",
    description: "Le classique Push/Pull/Legs deux fois par semaine, inspiré du programme gratuit de r/Fitness. Un gros mouvement lourd en 5×5 par séance, puis des accessoires en 8-12 répétitions. Quand toutes les séries atteignent le haut de la fourchette, augmente la charge.",
    level: "intermediaire", goal: "hypertrophie",
    source: "Inspiré du PPL gratuit de r/Fitness (Metallicadpa)",
    routines: [
      { key: "pullA", name: "PPL · Pull A", description: "Tirage lourd (soulevé de terre) + dos et biceps.", exercises: [ex("Soulevé de Terre (Barre)", 1, "5", 180, "Dos"), ...PPL6_PULL_ACCESSORIES] },
      { key: "pushA", name: "PPL · Push A", description: "Développé couché lourd + épaules et triceps.", exercises: [
        ex("Développé Couché (Barre)", 5, "5", 180, "Pectoraux"),
        ex("Développé Militaire (Haltère)", 3, "8-12", 120, "Épaules"),
        ex("Développé Couché Incliné (Haltère)", 3, "8-12", 90, "Pectoraux"),
        ex("Extension Triceps Poulie Haute (Corde)", 3, "8-12", 60, "Triceps"),
        ex("Élévation Latérale (Haltère)", 3, "15-20", 60, "Épaules"),
        ex("Extension Triceps Nuque (Haltère)", 3, "8-12", 60, "Triceps")
      ] },
      { key: "legs", name: "PPL · Legs", description: "Squat lourd + ischios, quadriceps et mollets.", exercises: PPL6_LEGS },
      { key: "pullB", name: "PPL · Pull B", description: "Rowing lourd + dos et biceps.", exercises: [ex("Rowing Barre", 5, "5", 180, "Dos"), ...PPL6_PULL_ACCESSORIES] },
      { key: "pushB", name: "PPL · Push B", description: "Développé militaire lourd + pecs et triceps.", exercises: [
        ex("Développé Militaire (Barre)", 5, "5", 180, "Épaules"),
        ex("Développé Couché (Haltère)", 3, "8-12", 120, "Pectoraux"),
        ex("Développé Couché Incliné (Haltère)", 3, "8-12", 90, "Pectoraux"),
        ex("Extension Triceps Poulie Haute (Corde)", 3, "8-12", 60, "Triceps"),
        ex("Élévation Latérale (Haltère)", 3, "15-20", 60, "Épaules"),
        ex("Extension Triceps Nuque (Haltère)", 3, "8-12", 60, "Triceps")
      ] }
    ],
    // 1 = lundi … 7 = dimanche
    blocks: [{ name: "PPL", weeks: 12, days: { 1: "pullA", 2: "pushA", 3: "legs", 4: "pullB", 5: "pushB", 6: "legs" } }]
  },
  {
    id: "off-ppl3",
    name: "PPL 3 jours (débutant)",
    description: "Push, Pull et Legs une fois par semaine (lundi, mercredi, vendredi) : idéal pour débuter ou avec peu de temps. Mouvements de base, repos complets entre les séances.",
    level: "debutant", goal: "remise",
    source: "Structure Push/Pull/Legs classique",
    routines: [
      { key: "push", name: "PPL débutant · Push", description: "Pecs, épaules, triceps.", exercises: [
        ex("Développé Couché (Barre)", 3, "6-8", 150, "Pectoraux"),
        ex("Développé Militaire (Haltère)", 3, "8-10", 120, "Épaules"),
        ex("Développé Couché Incliné (Haltère)", 3, "10-12", 90, "Pectoraux"),
        ex("Élévation Latérale (Haltère)", 3, "12-15", 60, "Épaules"),
        ex("Extension Triceps Poulie Haute (Corde)", 3, "10-12", 60, "Triceps")
      ] },
      { key: "pull", name: "PPL débutant · Pull", description: "Dos, arrière d'épaules, biceps.", exercises: [
        ex("Tirage Poitrine (Poulie)", 3, "8-10", 120, "Dos"),
        ex("Rowing Haltère Un Bras", 3, "8-10", 90, "Dos"),
        ex("Face Pull (Poulie)", 3, "15", 60, "Épaules"),
        ex("Curl Biceps (Barre EZ)", 3, "10-12", 60, "Biceps"),
        ex("Curl Marteau (Haltère)", 2, "10-12", 60, "Biceps")
      ] },
      { key: "legs", name: "PPL débutant · Legs", description: "Jambes, fessiers, gainage.", exercises: [
        ex("Squat (Barre)", 3, "6-8", 150, "Jambes"),
        ex("Soulevé de Terre Roumain (Barre)", 3, "8-10", 120, "Jambes"),
        ex("Presse à Cuisses", 3, "10-12", 90, "Jambes"),
        ex("Leg Curl Assis (Machine)", 3, "10-12", 60, "Jambes"),
        ex("Mollets Debout (Machine)", 3, "12-15", 60, "Jambes"),
        ex("Gainage / Planche", 3, "45 s", 60, "Abdominaux")
      ] }
    ],
    blocks: [{ name: "PPL débutant", weeks: 8, days: { 1: "push", 3: "pull", 5: "legs" } }]
  },
  {
    id: "off-split5",
    name: "Split 5 jours (un muscle par séance)",
    description: "Le « bro split » : chaque séance cible un groupe musculaire principal (pecs, dos, jambes, épaules, bras), avec beaucoup de volume par muscle et une semaine de récupération avant de le retravailler.",
    level: "intermediaire", goal: "hypertrophie",
    source: "Structure split classique (bodybuilding)",
    routines: [
      { key: "chest", name: "Split · Pectoraux", description: "Séance pecs.", exercises: [
        ex("Développé Couché (Barre)", 4, "6-8", 150, "Pectoraux"),
        ex("Développé Couché Incliné (Haltère)", 4, "8-10", 120, "Pectoraux"),
        ex("Chest Press (Machine)", 3, "10-12", 90, "Pectoraux"),
        ex("Écarté (Poulie vis-à-vis)", 3, "12-15", 60, "Pectoraux"),
        ex("Dips (Pectoraux)", 3, "8-12", 90, "Pectoraux")
      ] },
      { key: "back", name: "Split · Dos", description: "Séance dos.", exercises: [
        ex("Tractions", 4, "6-10", 150, "Dos"),
        ex("Rowing Barre", 4, "8-10", 120, "Dos"),
        ex("Tirage Poitrine Prise Serrée (Poulie)", 3, "10-12", 90, "Dos"),
        ex("Rowing Assis Un Bras (Poulie)", 3, "10-12", 60, "Dos"),
        ex("Hyperextensions Lombaires", 3, "12-15", 60, "Dos")
      ] },
      { key: "legs", name: "Split · Jambes", description: "Séance jambes.", exercises: [
        ex("Squat (Barre)", 4, "6-8", 180, "Jambes"),
        ex("Presse à Cuisses", 4, "10-12", 120, "Jambes"),
        ex("Soulevé de Terre Roumain (Barre)", 3, "8-10", 120, "Jambes"),
        ex("Extension Jambes (Machine)", 3, "12-15", 60, "Jambes"),
        ex("Leg Curl Allongé (Machine)", 3, "10-12", 60, "Jambes"),
        ex("Mollets Debout (Machine)", 4, "12-15", 60, "Jambes")
      ] },
      { key: "shoulders", name: "Split · Épaules", description: "Séance épaules et trapèzes.", exercises: [
        ex("Développé Militaire (Haltère)", 4, "8-10", 120, "Épaules"),
        ex("Élévation Latérale (Haltère)", 4, "12-15", 60, "Épaules"),
        ex("Oiseau / Élévation Arrière (Haltère)", 3, "12-15", 60, "Épaules"),
        ex("Face Pull (Poulie)", 3, "15-20", 60, "Épaules"),
        ex("Shrug / Haussement d'Épaules (Haltère)", 3, "10-12", 60, "Épaules")
      ] },
      { key: "arms", name: "Split · Bras", description: "Séance biceps et triceps.", exercises: [
        ex("Curl Biceps (Barre EZ)", 4, "8-10", 90, "Biceps"),
        ex("Skullcrusher (Barre)", 4, "8-10", 90, "Triceps"),
        ex("Curl Incliné (Haltère)", 3, "10-12", 60, "Biceps"),
        ex("Extension Triceps Poulie Haute (Corde)", 3, "10-12", 60, "Triceps"),
        ex("Curl Marteau (Haltère)", 3, "10-12", 60, "Biceps"),
        ex("Dips (Triceps)", 3, "8-12", 90, "Triceps")
      ] }
    ],
    blocks: [{ name: "Split", weeks: 8, days: { 1: "chest", 2: "back", 3: "legs", 4: "shoulders", 5: "arms" } }]
  }
];

// Routines des programmes, au format des routines partagées (Découvrir).
export function officialRoutines() {
  return PROGRAMS.flatMap(p => p.routines.map(r => {
    const muscles = [...new Set(r.exercises.map(e => e.muscle_group))];
    return {
      id: `${p.id}-${r.key}`, official: true, program_id: p.id,
      name: r.name, description: r.description, level: p.level, goal: p.goal,
      exercises: r.exercises, exercise_count: r.exercises.length, muscle_groups: muscles,
      owner_uid: OFFICIAL_UID, owner_name: OFFICIAL_AUTHOR, visibility: "public", created_at: "2026-01-01"
    };
  }));
}

// Programmes au format des plans partagés (Découvrir → Plans).
export function officialPlans() {
  return PROGRAMS.map(p => ({
    id: p.id, official: true, name: p.name, description: p.description, level: p.level, goal: p.goal,
    source: p.source, routines: p.routines, blocks: p.blocks,
    owner_uid: OFFICIAL_UID, owner_name: OFFICIAL_AUTHOR, visibility: "public", created_at: "2026-01-01"
  }));
}
