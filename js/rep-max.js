// ============================================================
// REP MAX — test de la charge maximale (RM) exercice par exercice, et
// charges proposées en séance d'après cette RM.
//   - méthode directe : on monte par paliers jusqu'à 1 répétition maximale ;
//   - méthode de Lombardi : une charge lourde soulevée le plus de fois
//     possible (10 reps au plus), × coefficient du tableau (utils.js).
// La séance de test (workout.rm_test) ne compte ni dans les stats, ni dans
// l'XP, la semaine, les défis ou les records. Les RM testées sont rangées
// dans user_private/{uid}.rep_max (privé) :
//   { "nom en minuscules": { name, rm, kg, reps, method, date, workout_id, history: [...] } }
// ============================================================
import * as db from "./db.js";
import { esc, rmBest, kgForReps, RM_MAX_REPS } from "./utils.js";
import { getRoutines } from "./cache.js";
import { t } from "./i18n.js";

const keyOf = (name) => String(name || "").trim().toLowerCase();
export const RM_METHODS = ["direct", "lombardi"];
export const methodName = (m) => m === "direct" ? t("Méthode directe") : t("Méthode de Lombardi");

// Lu une fois puis gardé en mémoire (rechargé après un test).
let cache = null;
export async function getRepMaxes(force = false) {
  if (!cache || force) cache = db.getPrivateData().then(d => d?.rep_max || {}).catch(() => { cache = null; return {}; });
  return cache;
}
export async function repMaxFor(name) {
  return (await getRepMaxes())[keyOf(name)] || null;
}

// RM de référence : la plus récente entre la dernière RM testée et celle
// de l'historique (série la plus lourde). sets : séries de l'exercice
// (fiables, hors tests). → { rm, source: "test" | "history", date } ou null.
export async function referenceRm(name, sets) {
  const test = await repMaxFor(name);
  const hist = rmBest(sets || []);
  const histDate = String(hist?.set?.workout_start_time || "").slice(0, 10);
  if (test && (!hist || (test.date || "") >= histDate)) return { rm: test.rm, source: "test", date: test.date, method: test.method };
  return hist ? { rm: hist.rm, source: "history", date: histDate } : null;
}

// Pas de charge : 1 kg pour les petites charges, 5 kg pour les gros
// mouvements de jambes lourds, 2,5 kg sinon (comme la progression).
const LOWER = /(squat|presse|leg press|soulevé|souleve|deadlift|hip thrust|rack pull|hack)/i;
export function stepFor(name, kg) {
  if (kg < 20) return 1;
  return LOWER.test(name) && kg >= 60 ? 5 : 2.5;
}
const roundTo = (kg, step) => Math.max(step, Math.round(kg / step) * step);

// Charge proposée pour `reps` d'après la RM (RM ÷ coefficient).
export function suggestKg(name, rm, reps) {
  if (!(rm > 0) || !(reps >= 1) || reps > RM_MAX_REPS) return null;
  return kgForReps(rm, reps, stepFor(name, rm));
}

// Séries proposées pour le test, d'après la RM connue (sinon à remplir).
// → [{ set_type, weight_kg, reps }]
export function testSets(method, name, rm) {
  const at = (pct) => rm ? roundTo(rm * pct, stepFor(name, rm)) : null;
  if (method === "direct") return [
    { set_type: "warmup", weight_kg: at(0.5), reps: rm ? 5 : null },
    { set_type: "warmup", weight_kg: at(0.7), reps: rm ? 3 : null },
    { set_type: "warmup", weight_kg: at(0.85), reps: rm ? 1 : null },
    { set_type: "normal", weight_kg: at(0.95), reps: rm ? 1 : null },
    { set_type: "normal", weight_kg: at(1.0), reps: rm ? 1 : null }
  ];
  return [
    { set_type: "warmup", weight_kg: at(0.5), reps: rm ? 8 : null },
    { set_type: "warmup", weight_kg: at(0.7), reps: rm ? 4 : null },
    // Charge pour ~6 reps : on en fait le plus possible (10 au plus).
    { set_type: "normal", weight_kg: rm ? suggestKg(name, rm, 6) : null, reps: null }
  ];
}

export const testCue = (method) => method === "direct"
  ? t("Monte par paliers jusqu'à 1 rép. max · repos 3 à 5 min")
  : t("Max de reps propres à cette charge (10 au plus)");

// Exercices proposés pour le test : ceux des routines (plan compris), puis
// ceux qui ont déjà une RM testée.
export async function candidateExercises() {
  const [routines, maxes] = await Promise.all([getRoutines().catch(() => []), getRepMaxes()]);
  const names = [];
  const add = (n, g) => { if (n && !names.some(x => keyOf(x.name) === keyOf(n))) names.push({ name: n, group: g || "" }); };
  routines.forEach(r => (r.exercises || []).forEach(e => add(e.exercise_name, e.muscle_group)));
  Object.values(maxes).forEach(m => add(m?.name));
  return names;
}

// Fin de la séance de test : RM de chaque exercice (série la plus lourde de
// 1 à 10 reps, × coefficient de Lombardi ; à 1 rép., la charge elle-même).
// doneSet : la série a-t-elle vraiment été faite. → [{ name, kg, reps, rm, prev, skipped }]
export async function saveTestResults(workout, doneSet) {
  const maxes = await getRepMaxes(true);
  const date = new Date().toISOString().slice(0, 10);
  const results = [], patch = {};
  for (const ex of workout.exercises || []) {
    const done = ex.sets.filter(doneSet);
    if (!done.length) continue;
    const best = rmBest(done);
    const prev = maxes[keyOf(ex.exercise_title)] || null;
    if (!best) { results.push({ name: ex.exercise_title, skipped: true }); continue; }
    const entry = { name: ex.exercise_title, rm: best.rm, kg: best.kg, reps: best.reps, method: workout.rm_method || "lombardi", date, workout_id: workout.id || null };
    const history = [...(prev?.history || []), ...(prev ? [{ rm: prev.rm, kg: prev.kg, reps: prev.reps, method: prev.method, date: prev.date }] : [])].slice(-10);
    patch[keyOf(ex.exercise_title)] = { ...entry, history };
    results.push({ ...entry, prev: prev?.rm ?? null });
  }
  if (Object.keys(patch).length) await db.setPrivateData({ rep_max: patch });
  cache = null;
  return results;
}

// Bilan affiché à la fin du test.
export function resultsHtml(results) {
  if (!results.length) return `<p class="muted">${t("Aucune série faite : pas de RM enregistrée.")}</p>`;
  return results.map(r => r.skipped
    ? `<div class="rm-res"><b>${esc(r.name)}</b><span class="muted">${t("Pas de RM : séries de plus de {n} reps ou sans charge.", { n: RM_MAX_REPS })}</span></div>`
    : `<div class="rm-res"><b>${esc(r.name)}</b><span><b class="rm-val">${esc(r.rm)} kg</b> <span class="muted">(${esc(r.kg)} kg × ${esc(r.reps)})</span>${r.prev ? ` <span class="muted">· ${t("avant : {kg} kg", { kg: esc(r.prev) })}</span>` : ""}</span></div>`).join("");
}

// ---------- Charges proposées en séance ----------
// Progression acceptée en fin de séance libre : charge à proposer la
// prochaine fois (user_private/{uid}.next_kg : { "nom": { name, kg, date } }).
let nextCache = null;
export async function getNextKg(force = false) {
  if (!nextCache || force) nextCache = db.getPrivateData().then(d => d?.next_kg || {}).catch(() => { nextCache = null; return {}; });
  return nextCache;
}
export async function saveNextKg(list) {
  if (!list?.length) return;
  const date = new Date().toISOString();
  const patch = {};
  list.forEach(p => { patch[keyOf(p.exercise)] = { name: p.exercise, kg: p.to, date }; });
  await db.setPrivateData({ next_kg: patch });
  nextCache = null;
}

// Charges proposées pour un exercice, série par série. Priorité :
//   1. charge visée de la routine / du plan (target_kg) ;
//   2. progression acceptée en fin de séance libre, plus récente que la
//      dernière séance de l'exercice ;
//   3. RM de référence ÷ coefficient de Lombardi des reps visées (ou des
//      reps de la dernière séance), si 10 reps ou moins ;
//   4. charges de la dernière séance.
// sets : séries fiables de l'exercice ; last : séries de la dernière séance.
// → { kgAt(j, reps), source: "plan" | "progression" | "rm" | "history" | null, ref }
export async function loadPlanner(name, { sets = [], last = [], targetKg = null } = {}) {
  const [ref, next] = await Promise.all([referenceRm(name, sets), getNextKg()]);
  const lastDay = String(last[0]?.workout_start_time || "");
  const nx = next[keyOf(name)];
  const nextOk = nx && nx.kg > 0 && String(nx.date) >= lastDay;
  const source = targetKg != null ? "plan" : nextOk ? "progression" : ref ? "rm" : last.length ? "history" : null;
  const kgAt = (j, reps) => {
    if (targetKg != null) return targetKg;
    if (nextOk) return nx.kg;
    const prev = last[j] || last[last.length - 1];
    if (prev?.set_type === "warmup") return prev.weight_kg ?? null;
    const r = Math.round(Number(reps) || Number(prev?.reps) || 0);
    const fromRm = ref ? suggestKg(name, ref.rm, r) : null;
    return fromRm ?? prev?.weight_kg ?? null;
  };
  return { kgAt, source, ref };
}
