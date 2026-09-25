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
export const getWorkouts = (max = 500) => cached("workouts", () => db.listWorkouts(max));
export const getAllSets = (max = 8000) => cached("sets", () => db.listAllSets(max));

// Séries d'un seul exercice : depuis l'historique complet s'il est déjà en
// mémoire (onglet Stats ouvert), sinon en ne téléchargeant que cet exercice
// — charger tout l'historique (~10 000 séries) prend une quinzaine de secondes.
export async function getSetsForExercise(exerciseName) {
  if (store.sets) return store.sets.filter(s => s.exercise_title === exerciseName);
  try {
    return await db.listSetsForExercise(exerciseName);
  } catch (e) {
    console.warn("[Skullcrusher] Requête par exercice impossible, repli sur l'historique complet :", e);
    return (await getAllSets()).filter(s => s.exercise_title === exerciseName);
  }
}

// Donnée déjà en mémoire, sans déclencher de chargement (null sinon).
export function peek(key) {
  return store[key];
}

export function invalidate(...keys) {
  keys.forEach(k => { store[k] = null; });
}
