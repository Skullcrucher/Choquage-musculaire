// ============================================================
// CACHE PARTAGÉ — évite de retélécharger les mêmes données à
// chaque changement d'onglet. Chaque entrée n'est rechargée que
// si elle est explicitement invalidée après une mutation.
// ============================================================
import * as db from "./db.js";

const store = { exercises: null, routines: null, workouts: null, sets: null };
const inflight = {}; // évite les doubles requêtes si deux onglets demandent en même temps

async function cached(key, fetcher) {
  if (store[key]) return store[key];
  if (!inflight[key]) {
    console.log(`[Skullcrusher] Firestore → requête "${key}" démarrée…`);
    inflight[key] = fetcher()
      .then((res) => { console.log(`[Skullcrusher] Firestore → "${key}" reçu (${res.length} élément(s))`); return res; })
      .catch((err) => { console.error(`[Skullcrusher] Firestore → "${key}" a échoué :`, err); throw err; })
      .finally(() => delete inflight[key]);
  }
  store[key] = await inflight[key];
  return store[key];
}

export const getExercises = () => cached("exercises", () => db.listExercises());
export const getRoutines = () => cached("routines", () => db.listRoutines());
export const getWorkouts = (max = 5000) => cached("workouts", () => db.listWorkouts(max));
// Historique complet : plafond large pour ne rien tronquer (≈ 11 000
// séries pour 2,5 ans). Lent au premier chargement : on ne l'appelle que
// si l'utilisateur demande "Tout" dans les Stats.
let allSetsProgress = () => {};
export function onAllSetsProgress(fn) { allSetsProgress = fn || (() => {}); }
export const getAllSets = (max = 50000) => cached("sets", () => db.listAllSets(max, (n) => allSetsProgress(n)));

// Séries par période (Stats) et par exercice (fiche, pré-remplissage),
// gardées en mémoire jusqu'à la prochaine invalidation de "sets". Si
// l'historique complet est déjà chargé, on en extrait directement.
const periodSets = new Map();   // semaines -> Promise<séries>
const exerciseSets = new Map(); // nom d'exercice -> Promise<séries>

function sinceIso(weeks) {
  // Même format que workout_start_time des séances importées (heure locale,
  // sans fuseau) : la comparaison de chaînes reste correcte à la journée près.
  const d = new Date(Date.now() - weeks * 7 * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function getSetsForPeriod(weeks) {
  if (!weeks) return getAllSets();
  const since = sinceIso(weeks);
  if (store.sets) return store.sets.filter(s => (s.workout_start_time || "") >= since);
  // Une période plus longue déjà chargée contient celle-ci.
  for (const [w, promise] of periodSets) {
    if (w >= weeks) return (await promise).filter(s => (s.workout_start_time || "") >= since);
  }
  if (!periodSets.has(weeks)) {
    const promise = db.listSetsSince(since).catch(err => { periodSets.delete(weeks); throw err; });
    periodSets.set(weeks, promise);
  }
  return periodSets.get(weeks);
}

// Séries d'un seul exercice : depuis l'historique complet s'il est déjà en
// mémoire, sinon en ne téléchargeant que cet exercice — charger tout
// l'historique (~10 000 séries) prend une quinzaine de secondes.
export async function getSetsForExercise(exerciseName) {
  if (store.sets) return store.sets.filter(s => s.exercise_title === exerciseName);
  if (!exerciseSets.has(exerciseName)) {
    const promise = db.listSetsForExercise(exerciseName).catch(async (e) => {
      console.warn("[Skullcrusher] Requête par exercice impossible, repli sur l'historique complet :", e);
      return (await getAllSets()).filter(s => s.exercise_title === exerciseName);
    });
    exerciseSets.set(exerciseName, promise);
  }
  return exerciseSets.get(exerciseName);
}

// Donnée déjà en mémoire, sans déclencher de chargement (null sinon).
export function peek(key) {
  return store[key];
}

export function invalidate(...keys) {
  keys.forEach(k => { store[k] = null; });
  if (keys.includes("sets")) { periodSets.clear(); exerciseSets.clear(); }
}
