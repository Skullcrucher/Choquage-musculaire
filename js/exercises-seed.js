// ============================================================
// BIBLIOTHÈQUE D'EXERCICES STANDARDS — liste curatée indépendante,
// pour démarrer avec un catalogue complet plutôt que seulement les
// exercices déjà présents dans ton historique.
// ============================================================
// Exercices faisables à la maison (filtre « 🏠 Maison » du sélecteur).
// Déclarés en fonction pour être utilisables dans EXERCISE_SEED ci-dessous.
function HOME_SEED() {
  return [
    ["Pompes Inclinées (Mains surélevées)", "Pectoraux"], ["Pompes Déclinées (Pieds surélevés)", "Pectoraux"],
    ["Pompes Diamant", "Triceps"], ["Pompes Larges", "Pectoraux"], ["Pompes sur les Genoux", "Pectoraux"],
    ["Écarté (Élastique)", "Pectoraux"], ["Dips sur Chaise", "Triceps"],
    ["Rowing Inversé (Table)", "Dos"], ["Rowing (Élastique)", "Dos"], ["Tirage Vertical (Élastique)", "Dos"],
    ["Rowing (Kettlebell)", "Dos"], ["Superman", "Dos"],
    ["Pompes Pike", "Épaules"], ["Pompes en Équilibre (Mur)", "Épaules"],
    ["Élévation Latérale (Élastique)", "Épaules"], ["Développé Épaules (Élastique)", "Épaules"], ["Face Pull (Élastique)", "Épaules"],
    ["Curl Biceps (Élastique)", "Biceps"], ["Extension Triceps (Élastique)", "Triceps"],
    ["Squat (Poids du Corps)", "Jambes"], ["Squat Sauté", "Jambes"], ["Fentes (Poids du Corps)", "Jambes"],
    ["Fentes Bulgares (Poids du Corps)", "Jambes"], ["Chaise Murale", "Jambes"], ["Pistol Squat", "Jambes"],
    ["Step-Up (Chaise)", "Jambes"], ["Mollets (Poids du Corps)", "Jambes"], ["Nordic Curl", "Jambes"],
    ["Squat Gobelet (Kettlebell)", "Jambes"], ["Swing (Kettlebell)", "Fessiers"],
    ["Pont Fessier Une Jambe", "Fessiers"], ["Donkey Kick", "Fessiers"], ["Fire Hydrant", "Fessiers"], ["Abduction (Élastique)", "Fessiers"],
    ["Mountain Climbers", "Abdominaux"], ["Relevé de Jambes au Sol", "Abdominaux"], ["Crunch Vélo", "Abdominaux"],
    ["Hollow Hold", "Abdominaux"], ["Dead Bug", "Abdominaux"], ["Sit-Up", "Abdominaux"],
    ["Burpees", "Cardio"], ["Jumping Jacks", "Cardio"], ["Montées de Genoux", "Cardio"]
  ];
}
export const HOME_NAMES = new Set(HOME_SEED().map(([n]) => n));

export const EXERCISE_SEED = [
  ["Développé Couché (Barre)", "Pectoraux"], ["Développé Couché (Haltère)", "Pectoraux"],
  ["Développé Couché Incliné (Barre)", "Pectoraux"], ["Développé Couché Incliné (Haltère)", "Pectoraux"],
  ["Développé Couché Décliné (Barre)", "Pectoraux"], ["Développé Couché Décliné (Haltère)", "Pectoraux"],
  ["Chest Press (Machine)", "Pectoraux"], ["Écarté Couché (Haltère)", "Pectoraux"],
  ["Écarté Incliné (Haltère)", "Pectoraux"], ["Écarté (Poulie vis-à-vis)", "Pectoraux"],
  ["Pec Deck (Machine)", "Pectoraux"], ["Dips (Pectoraux)", "Pectoraux"],
  ["Pompes", "Pectoraux"], ["Pull-Over (Haltère)", "Pectoraux"],

  ["Rowing Barre", "Dos"], ["Rowing Barre T", "Dos"], ["Rowing Haltère Un Bras", "Dos"],
  ["Rowing Assis Un Bras (Poulie)", "Dos"], ["Rowing Assis (Poulie, prise large)", "Dos"],
  ["Rowing Poulie Basse", "Dos"], ["Tirage Poitrine (Poulie)", "Dos"],
  ["Tirage Poitrine Prise Serrée (Poulie)", "Dos"], ["Tirage Poitrine Prise Inversée (Poulie)", "Dos"],
  ["Tirage Nuque (Poulie)", "Dos"], ["Tractions", "Dos"], ["Tractions Prise Serrée", "Dos"],
  ["Tractions Assistées (Machine)", "Dos"], ["Rack Pull", "Dos"], ["Soulevé de Terre (Barre)", "Dos"],
  ["Hyperextensions Lombaires", "Dos"], ["Good Morning (Barre)", "Dos"],

  ["Développé Militaire (Barre)", "Épaules"], ["Développé Militaire (Haltère)", "Épaules"],
  ["Développé Épaules Assis (Machine)", "Épaules"], ["Élévation Latérale (Haltère)", "Épaules"],
  ["Élévation Latérale (Poulie)", "Épaules"], ["Élévation Frontale (Haltère)", "Épaules"],
  ["Oiseau / Élévation Arrière (Haltère)", "Épaules"], ["Oiseau (Poulie vis-à-vis)", "Épaules"],
  ["Face Pull (Poulie)", "Épaules"], ["Arnold Press (Haltère)", "Épaules"],
  ["Shrug / Haussement d'Épaules (Barre)", "Épaules"], ["Shrug / Haussement d'Épaules (Haltère)", "Épaules"],
  ["Rowing Menton (Barre)", "Épaules"],

  ["Curl Biceps (Barre)", "Biceps"], ["Curl Biceps (Barre EZ)", "Biceps"],
  ["Curl Biceps (Haltère)", "Biceps"], ["Curl Incliné (Haltère)", "Biceps"],
  ["Curl Marteau (Haltère)", "Biceps"], ["Curl Pupitre (Barre)", "Biceps"],
  ["Curl Pupitre (Haltère)", "Biceps"], ["Curl Poulie Basse", "Biceps"],
  ["Curl Concentré (Haltère)", "Biceps"], ["Curl 21 (Barre)", "Biceps"],

  ["Extension Triceps Poulie Haute (Corde)", "Triceps"], ["Extension Triceps Poulie Haute (Barre)", "Triceps"],
  ["Extension Triceps Un Bras (Poulie)", "Triceps"], ["Extension Triceps Nuque (Haltère)", "Triceps"],
  ["Skullcrusher (Barre)", "Triceps"], ["Skullcrusher (Haltère)", "Triceps"],
  ["Dips (Triceps)", "Triceps"], ["Développé Couché Prise Serrée (Barre)", "Triceps"],
  ["Kickback Triceps (Haltère)", "Triceps"], ["Extension Triceps (Machine)", "Triceps"],

  ["Squat (Barre)", "Jambes"], ["Front Squat (Barre)", "Jambes"], ["Squat Gobelet (Haltère)", "Jambes"],
  ["Presse à Cuisses", "Jambes"], ["Fentes (Haltère)", "Jambes"], ["Fentes Bulgares (Haltère)", "Jambes"],
  ["Extension Jambes (Machine)", "Jambes"], ["Leg Curl Assis (Machine)", "Jambes"],
  ["Leg Curl Allongé (Machine)", "Jambes"], ["Soulevé de Terre Roumain (Barre)", "Jambes"],
  ["Soulevé de Terre Roumain (Haltère)", "Jambes"], ["Mollets Debout (Machine)", "Jambes"],
  ["Mollets Assis (Machine)", "Jambes"], ["Hack Squat (Machine)", "Jambes"],
  ["Step-Up (Haltère)", "Jambes"], ["Adducteurs (Machine)", "Jambes"],

  ["Hip Thrust (Barre)", "Fessiers"], ["Hip Thrust (Machine)", "Fessiers"],
  ["Abduction Hanche (Machine)", "Fessiers"], ["Kickback Fessiers (Poulie)", "Fessiers"],
  ["Pont Fessier (Poids du Corps)", "Fessiers"], ["Good Morning (Haltère)", "Fessiers"],

  ["Crunch (Poids du Corps)", "Abdominaux"], ["Crunch (Poulie Haute)", "Abdominaux"],
  ["Relevé de Jambes Suspendu", "Abdominaux"], ["Gainage / Planche", "Abdominaux"],
  ["Gainage Latéral", "Abdominaux"], ["Rotation Russe (Haltère)", "Abdominaux"],
  ["Ab Wheel / Roulette Abdominale", "Abdominaux"], ["Crunch Machine", "Abdominaux"],

  ["Curl Poignet (Barre)", "Avant-bras"], ["Extension Poignet (Barre)", "Avant-bras"],
  ["Farmer's Walk (Haltère)", "Avant-bras"], ["Préhension (Grip Trainer)", "Avant-bras"],

  // À la maison : poids du corps, élastiques, kettlebell, chaise.
  ...HOME_SEED(),

  ["Course à Pied", "Cardio"], ["Tapis de Course", "Cardio"], ["Vélo Elliptique", "Cardio"],
  ["Rameur", "Cardio"], ["Vélo Stationnaire", "Cardio"], ["Corde à Sauter", "Cardio"],
  ["Stairmaster / Escalier", "Cardio"], ["Assault Bike", "Cardio"]
];

// Origine d'un exercice de la bibliothèque : « app » (liste standard
// ci-dessus), « import » (créé par un import depuis une autre app : Hevy…),
// « perso » (créé à la main par un utilisateur).
const SEED_NAMES = new Set(EXERCISE_SEED.map(([n]) => n));
export function exerciseOrigin(ex) {
  if (SEED_NAMES.has(ex.name)) return "app";
  if (ex.source === "import" || ex.is_custom === false) return "import";
  return "perso";
}
