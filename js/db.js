// ============================================================
// COUCHE BASE DE DONNÉES — Firestore
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  initializeFirestore,
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  updateDoc, addDoc, query, orderBy, where, collectionGroup, limit,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithRedirect, signInWithPopup, getRedirectResult,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

// Version temporairement simplifiée (sans cache persistant IndexedDB) pour
// isoler un blocage au chargement. experimentalForceLongPolling est requis
// pour Safari : la détection automatique (experimentalAutoDetectLongPolling)
// échoue silencieusement dans certaines versions de Safari/WebKit, qui gère
// mal le streaming fetch utilisé par le mode de connexion par défaut de
// Firestore — d'où le blocage indéfini observé uniquement sur Safari.
export const dbase = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});

console.log("[Fonte] Firestore initialisé, projet :", firebaseConfig.projectId);

// ==================== AUTHENTIFICATION ====================
// Popup en onglet Safari normal (garde tout dans le même contexte, insensible
// à l'ITP de Safari qui casse la redirection quand authDomain est un domaine
// différent du site) ; redirection uniquement en repli pour l'app installée
// en PWA sur l'écran d'accueil, où les popups ne fonctionnent pas.
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

function isStandalonePwa() {
  return window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function requireUid() {
  const u = auth.currentUser;
  if (!u) throw new Error("Non connecté");
  return u.uid;
}

export async function signInWithGoogle() {
  if (isStandalonePwa()) {
    await signInWithRedirect(auth, googleProvider);
  } else {
    await signInWithPopup(auth, googleProvider);
  }
}

export async function consumeRedirectResult() {
  try {
    return await getRedirectResult(auth);
  } catch (e) {
    console.error("[Fonte] Erreur de connexion :", e);
    return null;
  }
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signOutUser() {
  await signOut(auth);
}

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
  const u = auth.currentUser;
  if (!u) throw new Error("Non connecté");
  const ref = await addDoc(collection(dbase, "workouts"), {
    title, start_time, end_time, notes, created_manually: true,
    owner_uid: u.uid, owner_name: u.displayName || u.email || "Utilisateur", owner_photo: u.photoURL || null
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
  console.log(`[Fonte] listWorkouts → requête démarrée (max ${max})…`);
  try {
    const snap = await getDocs(query(
      collection(dbase, "workouts"),
      where("owner_uid", "==", requireUid()),
      orderBy("start_time", "desc"),
      limit(max)
    ));
    const result = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`[Fonte] listWorkouts → ${result.length} séance(s) reçue(s). Exemple :`, result[0]);
    return result;
  } catch (err) {
    console.error("[Fonte] listWorkouts → erreur :", err);
    throw err;
  }
}

export async function getWorkout(id) {
  const snap = await getDoc(doc(dbase, "workouts", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ==================== SÉRIES (sets) ====================
export async function addSet(workoutId, setData) {
  const ref = await addDoc(collection(dbase, "workouts", workoutId, "sets"), {
    ...setData, owner_uid: requireUid()
  });
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
    query(collectionGroup(dbase, "sets"),
      where("owner_uid", "==", requireUid()),
      where("exercise_title", "==", exerciseName),
      limit(max))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data(), workout_id: d.ref.parent.parent.id }));
}

export async function listAllSets(max = 5000) {
  console.log(`[Fonte] listAllSets → requête démarrée (max ${max})…`);
  try {
    const snap = await getDocs(query(
      collectionGroup(dbase, "sets"),
      where("owner_uid", "==", requireUid()),
      orderBy("workout_start_time", "desc"),
      limit(max)
    ));
    const result = snap.docs.map(d => ({ id: d.id, ...d.data(), workout_id: d.ref.parent.parent.id }));
    console.log(`[Fonte] listAllSets → ${result.length} série(s) reçue(s). Exemple :`, result[0]);
    return result;
  } catch (err) {
    console.error("[Fonte] listAllSets → erreur :", err);
    throw err;
  }
}

// ==================== IMPORT CSV avec déduplication ====================
// Clé déterministe = hash(titre séance + date/heure début + exercice + n° série)
// -> un même fichier réimporté (ou un export qui chevauche l'historique)
// n'écrira jamais deux fois la même série : on vérifie l'existence du
// document avant d'écrire, et on ne le remplace pas s'il existe déjà.
//
// Étapes : 1) résoudre les séances uniques (peu nombreuses, en série),
// 2) créer les exercices manquants (peu nombreux, en série),
// 3) écrire les séries par lots concurrents (nombreuses, en parallèle)
// pour ne pas saturer la connexion pendant de longues minutes.
async function runPool(items, concurrency, worker) {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

export async function importRows(rows, onProgress = () => {}) {
  const stats = { workoutsCreated: 0, setsImported: 0, setsSkippedDuplicate: 0, errors: 0 };
  const u = auth.currentUser;
  if (!u) throw new Error("Non connecté");
  const uid = u.uid;
  const ownerName = u.displayName || u.email || "Utilisateur";
  const ownerPhoto = u.photoURL || null;

  // ---- 1) séances uniques ----
  const workoutKeys = [...new Set(rows.map(r => `${r.title}|${r.start_time_iso}`))];
  const workoutMeta = new Map(rows.map(r => [`${r.title}|${r.start_time_iso}`, r]));
  const workoutCache = new Map();
  let wDone = 0;
  for (const key of workoutKeys) {
    try {
      const r = workoutMeta.get(key);
      const workoutHash = "w_" + (await sha1(key));
      const wRef = doc(dbase, "workouts", workoutHash);
      const wSnap = await getDoc(wRef);
      if (!wSnap.exists()) {
        await setDoc(wRef, {
          title: r.title, start_time: r.start_time_iso, end_time: r.end_time_iso || null,
          notes: r.description || "", created_manually: false, imported_at: new Date().toISOString(),
          owner_uid: uid, owner_name: ownerName, owner_photo: ownerPhoto
        });
        stats.workoutsCreated++;
      }
      workoutCache.set(key, workoutHash);
    } catch (e) {
      console.error("[Fonte] Erreur création séance", key, e);
      stats.errors++;
    }
    wDone++;
    if (wDone % 10 === 0) onProgress(0, rows.length, stats, `Séances : ${wDone}/${workoutKeys.length}`);
  }

  // ---- 2) exercices uniques ----
  const exerciseNames = new Map(rows.map(r => [r.exercise_title, r.muscle_group_guess]));
  let exDone = 0;
  for (const [name, group] of exerciseNames) {
    try {
      await upsertExercise(name, group, "", false);
    } catch (e) {
      console.error("[Fonte] Erreur création exercice", name, e);
      stats.errors++;
    }
    exDone++;
    if (exDone % 10 === 0) onProgress(0, rows.length, stats, `Exercices : ${exDone}/${exerciseNames.size}`);
  }

  // ---- 3) séries, par lots concurrents ----
  let done = 0;
  await runPool(rows, 15, async (row) => {
    try {
      const workoutKey = `${row.title}|${row.start_time_iso}`;
      const workoutId = workoutCache.get(workoutKey);
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
          owner_uid: uid,
          workout_start_time: row.start_time_iso
        });
        stats.setsImported++;
      }
    } catch (e) {
      console.error("Erreur import série", e);
      stats.errors++;
    }
    done++;
    if (done % 25 === 0) onProgress(done, rows.length, stats);
  });

  onProgress(rows.length, rows.length, stats);
  return stats;
}

// ==================== FEED — séances de tous les utilisateurs ====================
// Lecture ouverte à tout utilisateur connecté (voir firestore.rules) ;
// l'écriture reste réservée au propriétaire de chaque séance.
export async function listFeedWorkouts(max = 60) {
  console.log(`[Fonte] listFeedWorkouts → requête démarrée (max ${max})…`);
  try {
    const snap = await getDocs(query(collection(dbase, "workouts"), orderBy("start_time", "desc"), limit(max)));
    const result = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`[Fonte] listFeedWorkouts → ${result.length} séance(s) reçue(s).`);
    return result;
  } catch (err) {
    console.error("[Fonte] listFeedWorkouts → erreur :", err);
    throw err;
  }
}

// ==================== RESET — vider ses séances avant un réimport propre ====================
// Supprime toutes les séances (et leurs séries) appartenant à l'utilisateur
// connecté, ou sans owner_uid du tout (données d'avant l'activation des
// comptes). Action destructrice, confirmée côté interface.
export async function deleteAllMyWorkouts(onProgress = () => {}) {
  const uid = requireUid();
  const snap = await getDocs(collection(dbase, "workouts"));
  const mine = snap.docs.filter(d => !d.data().owner_uid || d.data().owner_uid === uid);

  let done = 0;
  for (const wDoc of mine) {
    const setsSnap = await getDocs(collection(dbase, "workouts", wDoc.id, "sets"));
    const batch = writeBatch(dbase);
    setsSnap.docs.forEach(s => batch.delete(s.ref));
    batch.delete(wDoc.ref);
    await batch.commit();
    done++;
    onProgress(done, mine.length);
  }
  return done;
}
