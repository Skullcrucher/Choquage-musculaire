// ============================================================
// CALORIES — estimation de la dépense d'une séance de musculation
//
// Méthode (recommandée par le Compendium of Physical Activities) :
//   dépense = MET × métabolisme de repos de la personne × durée
// - Métabolisme de repos : formule de Harris-Benedict révisée
//   (Roza & Shizgal, 1984), à partir du sexe, de l'âge, de la taille et
//   du poids. Plus juste que le "1 MET = 1 kcal/kg/h" standard, qui
//   surestime la dépense des personnes plus âgées ou plus grasses.
// - MET de la musculation (Compendium) : 3,5 effort léger (circuit,
//   8-15 reps, charges modérées), 5,0 effort modéré, 6,0 effort intense
//   (powerlifting, bodybuilding lourd). Ces valeurs sont des moyennes
//   sur la séance entière, repos compris : on multiplie donc par la durée
//   totale, pas seulement le temps sous charge.
// - Durée : début → fin de séance, plafonnée à 10 min après la dernière
//   série (séance oubliée ouverte).
// L'estimation reste à ±25 % environ ; les calories d'une montre
// cardio, si on les saisit, la remplacent.
//
// Les données corporelles restent privées (user_private/{uid}.body) :
// seul l'effort choisi et, si saisies, les kcal de la montre sont
// enregistrés sur la séance.
// ============================================================
import * as db from "./db.js";

// i18n-keys: "Léger", "Modéré", "Intense"
export const EFFORTS = {
  light: { met: 3.5, label: "Léger" },
  moderate: { met: 5.0, label: "Modéré" },
  vigorous: { met: 6.0, label: "Intense" }
};
const IDLE_AFTER_LAST_SET_MS = 10 * 60 * 1000;
const MAX_MINUTES = 300;

// Mémorisées par compte (changement de compte sans rechargement).
let bodyPromise = null, bodyUid = null;
export function getBody() {
  const uid = db.getCurrentUser()?.uid || null;
  if (!uid) return Promise.resolve(null);
  if (!bodyPromise || bodyUid !== uid) {
    bodyUid = uid;
    bodyPromise = db.getPrivateData().then(d => d?.body || null).catch(() => null);
  }
  return bodyPromise;
}
export async function saveBody(body) {
  await db.setPrivateData({ body });
  bodyUid = db.getCurrentUser()?.uid || null;
  bodyPromise = Promise.resolve(body);
}

export function bodyComplete(b) {
  return !!(b && (b.sex === "m" || b.sex === "f") && b.birth_year > 1900 && b.height_cm > 100 && b.weight_kg > 25);
}

// Métabolisme de repos, kcal par jour (Harris-Benedict révisée).
export function restingKcalPerDay(b, now = new Date()) {
  const age = Math.max(14, now.getFullYear() - b.birth_year);
  return b.sex === "m"
    ? 88.362 + 13.397 * b.weight_kg + 4.799 * b.height_cm - 5.677 * age
    : 447.593 + 9.247 * b.weight_kg + 3.098 * b.height_cm - 4.330 * age;
}

// Durée prise en compte, en minutes (null si la séance n'est pas terminée).
export function workoutMinutes(w) {
  const start = Date.parse(w.start_time);
  let end = Date.parse(w.end_time);
  if (!start || !end || end <= start) return null;
  const lastSet = Date.parse(w.last_set_at);
  if (lastSet && lastSet > start) end = Math.min(end, lastSet + IDLE_AFTER_LAST_SET_MS);
  return Math.min(MAX_MINUTES, Math.round((end - start) / 60000));
}

// Effort proposé d'après la densité de la séance (séries par heure).
export function autoEffort(totalSets, minutes) {
  if (!minutes || !totalSets) return "moderate";
  const perHour = totalSets / (minutes / 60);
  if (perHour >= 24) return "vigorous";
  if (perHour >= 14) return "moderate";
  return "light";
}

export function estimateKcal(body, effort, minutes) {
  if (!bodyComplete(body) || !minutes) return null;
  const met = (EFFORTS[effort] || EFFORTS.moderate).met;
  return Math.round(met * restingKcalPerDay(body) / 1440 * minutes);
}

// Calories d'une séance enregistrée : montre si saisie, sinon estimation.
export function workoutCalories(w, body) {
  if (w.watch_kcal > 0) return { kcal: Math.round(w.watch_kcal), source: "watch" };
  const minutes = workoutMinutes(w);
  const effort = EFFORTS[w.effort] ? w.effort : autoEffort(w.total_sets, minutes);
  const kcal = estimateKcal(body, effort, minutes);
  if (kcal == null) return null;
  return { kcal, low: Math.round(kcal * 0.75), high: Math.round(kcal * 1.25), effort, minutes, source: "estimate" };
}
