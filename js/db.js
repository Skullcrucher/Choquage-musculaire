// ============================================================
// COUCHE BASE DE DONNÉES — Firestore
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  updateDoc, addDoc, query, orderBy, where, collectionGroup, limit,
  enableIndexedDbPersistence, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const dbase = getFirestore(app);

// Persistance hors-ligne : les données restent utilisables sans réseau
// et se synchronisent automatiquement au retour de la connexion.
enableIndexedDbPersistence(dbase).catch((err) => {
  console.warn("Persistance hors-ligne non activée :", err.code);
});

// ---------- Utilitaire : clé déterministe pour la déduplication ----------
async function sha1(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function slugify(str) {
  return str
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

// ==================== EXERCICES ====================
const EXO_GROUPS = [
  "Pectoraux", "Dos", "Épaules", "Biceps", "Triceps",
  "Jambes", "Fessiers", "Abdominaux", "Avant-bras", "Cardio", "Autre"
];
export { EXO_GROUPS };

export async function upsertExercise(name, muscleGroup, equipment = "", isCustom = true) {
  const id = slugify(name);
  const ref = doc(dbase, "exercises", id);
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await setDoc(ref, {
      name, muscle_group: muscleGroup || "Autre", equipment: equipment || "",
      is_custom: isCustom, rest_timer_seconds: 90
    });
  }
  return id;
}

export async function listExercises() {
  const snap = await getDocs(query(collection(dbase, "exercises"), orderBy("name")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateExercise(id, patch) {
  await updateDoc(doc(dbase, "exercises", id), patch);
}

export async function deleteExercise(id) {
  await deleteDoc(doc(dbase, "exercises", id));
}

// ==================== ROUTINES ====================
export async function listRoutines() {
  const snap = await getDocs(query(collection(dbase, "routines"), orderBy("name")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveRoutine(routine, id = null) {
  if (id) {
    await setDoc(doc(dbase, "routines", id), routine);
    return id;
  }
  const ref = await addDoc(collection(dbase, "routines"), routine);
  return ref.id;
}

export async function deleteRoutine(id) {
  await deleteDoc(doc(dbase, "routines", id));
}

// ==================== SÉANCES (workouts) ====================
export async function createWorkout({ title, start_time, end_time = null, notes = "" }) {
  const ref = await addDoc(collection(dbase, "workouts"), {
    title, start_time, end_time, notes, created_manually: true
  });
  return ref.id;
}

export async function updateWorkout(id, patch) {
  await updateDoc(doc(dbase, "workouts", id), patch);
}

export async function deleteWorkout(id) {
  const setsSnap = await getDocs(collection(dbase, "workouts", id, "sets"));
  const batch = writeBatch(dbase);
  setsSnap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(doc(dbase, "workouts", id));
  await batch.commit();
}

export async function listWorkouts(max = 200) {
  const snap = await getDocs(query(collection(dbase, "workouts"), orderBy("start_time", "desc"), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getWorkout(id) {
  const snap = await getDoc(doc(dbase, "workouts", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ==================== SÉRIES (sets) ====================
export async function addSet(workoutId, setData) {
  const ref = await addDoc(collection(dbase, "workouts", workoutId, "sets"), setData);
  return ref.id;
}

export async function updateSet(workoutId, setId, patch) {
  await updateDoc(doc(dbase, "workouts", workoutId, "sets", setId), patch);
}

export async function deleteSet(workoutId, setId) {
  await deleteDoc(doc(dbase, "workouts", workoutId, "sets", setId));
}

export async function listSets(workoutId) {
  const snap = await getDocs(query(collection(dbase, "workouts", workoutId, "sets"), orderBy("set_index")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Requête transversale : toutes les séries d'un exercice donné, toutes séances confondues
export async function listSetsForExercise(exerciseName, max = 500) {
  const snap = await getDocs(
    query(collectionGroup(dbase, "sets"), where("exercise_title", "==", exerciseName), limit(max))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data(), workout_id: d.ref.parent.parent.id }));
}

export async function listAllSets(max = 5000) {
  const snap = await getDocs(query(collectionGroup(dbase, "sets"), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data(), workout_id: d.ref.parent.parent.id }));
}

// ==================== IMPORT CSV avec déduplication ====================
// Clé déterministe = hash(titre séance + date/heure début + exercice + n° série)
// -> un même fichier réimporté (ou un export qui chevauche l'historique)
// n'écrira jamais deux fois la même série : on vérifie l'existence du
// document avant d'écrire, et on ne le remplace pas s'il existe déjà.
export async function importRows(rows, onProgress = () => {}) {
  const stats = { workoutsCreated: 0, setsImported: 0, setsSkippedDuplicate: 0, errors: 0 };
  const workoutCache = new Map(); // clé titre|start_time -> workoutId
  const exerciseSeen = new Set(); // évite de revérifier le même exercice à chaque ligne

  let i = 0;
  for (const row of rows) {
    i++;
    try {
      const workoutKey = `${row.title}|${row.start_time_iso}`;
      let workoutId = workoutCache.get(workoutKey);

      if (!workoutId) {
        const workoutHash = "w_" + (await sha1(workoutKey));
        const wRef = doc(dbase, "workouts", workoutHash);
        const wSnap = await getDoc(wRef);
        if (!wSnap.exists()) {
          await setDoc(wRef, {
            title: row.title,
            start_time: row.start_time_iso,
            end_time: row.end_time_iso || null,
            notes: row.description || "",
            created_manually: false,
            imported_at: new Date().toISOString()
          });
          stats.workoutsCreated++;
        }
        workoutId = workoutHash;
        workoutCache.set(workoutKey, workoutId);
      }

      // s'assure que l'exercice existe dans la bibliothèque (une seule vérification par exercice)
      if (!exerciseSeen.has(row.exercise_title)) {
        exerciseSeen.add(row.exercise_title);
        await upsertExercise(row.exercise_title, row.muscle_group_guess, "", false);
      }

      const setKey = `${workoutKey}|${row.exercise_title}|${row.set_index}`;
      const setHash = "s_" + (await sha1(setKey));
      const sRef = doc(dbase, "workouts", workoutId, "sets", setHash);
      const sSnap = await getDoc(sRef);
      if (sSnap.exists()) {
        stats.setsSkippedDuplicate++;
      } else {
        await setDoc(sRef, {
          exercise_title: row.exercise_title,
          superset_id: row.superset_id || null,
          exercise_notes: row.exercise_notes || "",
          set_index: row.set_index,
          set_type: row.set_type || "normal",
          weight_kg: row.weight_kg,
          reps: row.reps,
          distance_km: row.distance_km || null,
          duration_seconds: row.duration_seconds || null,
          rpe: row.rpe || null,
          workout_start_time: row.start_time_iso
        });
        stats.setsImported++;
      }
    } catch (e) {
      console.error("Erreur import ligne", i, e);
      stats.errors++;
    }
    if (i % 25 === 0) onProgress(i, rows.length, stats);
  }
  onProgress(rows.length, rows.length, stats);
  return stats;
}
