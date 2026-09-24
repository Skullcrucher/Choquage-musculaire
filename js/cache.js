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

export function invalidate(...keys) {
  keys.forEach(k => { store[k] = null; });
}
