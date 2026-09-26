// ============================================================
// PROGRESSION — adapter les charges du plan aux performances, avec
// l'accord de l'utilisateur (méthode de la double progression) :
//   - toutes les séries de travail atteignent le HAUT de la fourchette de
//     reps visée (ex. 10 sur « 8-10 ») → proposer d'augmenter la charge ;
//   - la majorité des séries reste SOUS le bas de la fourchette → proposer
//     de la baisser légèrement ;
//   - sinon, on garde la charge et on cherche à gagner des reps.
// Les propositions s'affichent en fin de séance ; celles que l'utilisateur
// coche mettent à jour la charge visée (target_kg) de l'exercice dans la
// routine, donc dans toutes les semaines du plan qui l'utilisent. La
// séance suivante est pré-remplie avec cette charge.
// ============================================================
import * as db from "./db.js";

// "8-10" -> [8, 10], "10" -> [10, 10], "8 à 12" -> [8, 12] ; null si illisible (AMRAP…).
export function parseRepRange(str) {
  const s = String(str || "").toLowerCase().replace(/\s+/g, "");
  let m = s.match(/^(\d{1,3})(?:-|–|à|a|to)(\d{1,3})$/);
  if (m && +m[1] <= +m[2]) return [+m[1], +m[2]];
  m = s.match(/^(\d{1,3})$/);
  return m ? [+m[1], +m[1]] : null;
}

const LOWER_BODY = /(squat|presse|leg press|soulevé|souleve|deadlift|hip thrust|fente|lunge|rack pull|hack)/i;

// Pas d'augmentation : 1 kg pour les petites charges, 5 kg pour les gros
// mouvements du bas du corps, 2,5 kg sinon.
export function loadStep(exerciseName, muscleGroup, kg) {
  if (kg < 20) return 1;
  if (["Jambes", "Fessiers"].includes(muscleGroup) || LOWER_BODY.test(exerciseName)) return kg >= 60 ? 5 : 2.5;
  return 2.5;
}
const round = (kg, step) => Math.max(0, Math.round(kg / step) * step);

// Propositions pour une séance démarrée depuis une routine.
// exercises : [{ exercise_title, muscle_group, reps_target, target_sets, target_kg, sets:[{weight_kg, reps, set_type}] }]
export function suggestProgressions(exercises) {
  const out = [];
  for (const ex of exercises || []) {
    const range = parseRepRange(ex.reps_target);
    if (!range) continue;
    const [lo, hi] = range;
    const work = (ex.sets || []).filter(s => s.weight_kg > 0 && s.reps > 0 && !["warmup", "dropset"].includes(s.set_type));
    if (!work.length) continue;
    const weight = Math.max(...work.map(s => s.weight_kg));
    const top = work.filter(s => s.weight_kg === weight);
    const targetSets = Math.max(1, ex.target_sets || 1);
    const current = ex.target_kg ?? weight;
    if (work.length >= targetSets && work.every(s => s.reps >= hi) && weight >= current) {
      const step = loadStep(ex.exercise_title, ex.muscle_group, weight);
      out.push({ exercise: ex.exercise_title, direction: "up", from: current, to: round(weight + step, step >= 2.5 ? 0.5 : 0.5), reps: Math.min(...work.map(s => s.reps)), hi, sets: work.length, checked: true });
    } else if (top.filter(s => s.reps < lo).length > top.length / 2 && weight >= current) {
      const to = Math.max(0, Math.round(weight * 0.95 * 2) / 2);
      if (to < weight) out.push({ exercise: ex.exercise_title, direction: "down", from: current, to, reps: Math.max(...top.map(s => s.reps)), lo, sets: top.length, checked: false });
    }
  }
  return out;
}

// Enregistre les charges acceptées dans la routine.
export async function applyProgressions(routine, accepted) {
  if (!routine?.id || !accepted?.length) return 0;
  const byName = new Map(accepted.map(p => [p.exercise, p.to]));
  let n = 0;
  const exercises = (routine.exercises || []).map(e => {
    if (!byName.has(e.exercise_name)) return e;
    n++;
    return { ...e, target_kg: byName.get(e.exercise_name) };
  });
  if (!n) return 0;
  await db.saveRoutine({ ...routine, exercises }, routine.id);
  return n;
}
