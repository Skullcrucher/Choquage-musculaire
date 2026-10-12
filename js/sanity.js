// ============================================================
// CHARGES INCOHÉRENTES — garde-fou commun (saisie en séance, modification
// d'une séance, import, statistiques).
//  - « aberrante » : au-delà de ce qu'un humain soulève sur ce type
//    d'exercice (ex. 6659 kg en extension jambes) → jamais enregistrée,
//    écartée à l'import et exclue des statistiques ;
//  - « suspecte » : plus du double de ton record sur l'exercice → on
//    demande confirmation (faute de frappe probable), sans bloquer.
// ============================================================

// Plafond par type d'exercice (kg, par côté pour les unilatéraux).
export function absoluteMaxKg(name) {
  const n = String(name || "").toLowerCase();
  if (/(presse|leg press|hack|sled|traîneau|traineau)/.test(n)) return 1200;
  if (/(squat|soulevé|souleve|deadlift|rack pull|hip thrust|shrug|good morning|farmer)/.test(n)) return 600;
  return 400;
}

export function isAbsurdKg(name, kg) {
  return Number(kg) > absoluteMaxKg(name);
}

// "absurd" | "jump" | null — best : meilleure charge déjà soulevée.
export function kgWarning(name, kg, best = 0) {
  const v = Number(kg);
  if (!(v > 0)) return null;
  if (v > absoluteMaxKg(name)) return "absurd";
  if (best > 0 && v > Math.max(best * 2, best + 40)) return "jump";
  return null;
}

// Tonnage d'une séance, plafonné : au-delà de 60 t, c'est une charge
// aberrante saisie avant ce garde-fou (on ne compte pas la séance).
export const MAX_SESSION_TONNAGE = 60000;
export function sessionTonnage(w) {
  const v = Number(w?.total_tonnage) || 0;
  return v > MAX_SESSION_TONNAGE ? 0 : v;
}
