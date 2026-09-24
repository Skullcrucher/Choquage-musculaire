// ============================================================
// COUCHE BASE DE DONNÉES — Firestore
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  initializeFirestore,
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  updateDoc, addDoc, query, orderBy, where, collectionGroup, limit,
  writeBatch, deleteField
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut, setPersistence, indexedDBLocalPersistence
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

console.log("[Skullcrusher] Firestore initialisé, projet :", firebaseConfig.projectId);

// ==================== AUTHENTIFICATION ====================
// Email/mot de passe plutôt que Google Sign-In : Google bloque par
// politique anti-phishing les connexions OAuth lancées depuis une
// WebView embarquée (ce que devient une PWA installée en mode
// standalone sur iOS) — indépendamment de tout ce qu'on peut coder ici.
// Email/mot de passe n'a pas ce problème, ça marche identiquement
// partout (Safari, app installée, n'importe quel navigateur).
export const auth = getAuth(app);

setPersistence(auth, indexedDBLocalPersistence).catch((e) =>
  console.error("[Skullcrusher] Échec réglage persistance Auth :", e)
);

export function getCurrentUser() {
  return auth.currentUser;
}

export function requireUid() {
  const u = auth.currentUser;
  if (!u) throw new Error("Non connecté");
  return u.uid;
}

export async function signInWithPassword(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function createAccountWithPassword(email, password) {
  await createUserWithEmailAndPassword(auth, email, password);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signOutUser() {
  await signOut(auth);
}

// ==================== PROFIL (pseudo + photo) ====================
// Stocké dans Firestore (pas Firebase Auth ni Cloud Storage) : la photo est
// une miniature compressée en data URL, assez légère pour un document.
export async function getProfile(uid) {
  const snap = await getDoc(doc(dbase, "profiles", uid));
  return snap.exists() ? snap.data() : null;
}

export async function getProfiles(uids) {
  const uniq = [...new Set(uids)];
  const results = await Promise.all(uniq.map(async (uid) => [uid, await getProfile(uid)]));
  return Object.fromEntries(results.filter(([, p]) => p));
}

export async function updateMyProfile({ display_name, photo_data_url }) {
  const uid = requireUid();
  const patch = { updated_at: new Date().toISOString() };
  if (display_name !== undefined) patch.display_name = display_name;
  if (photo_data_url !== undefined) patch.photo_data_url = photo_data_url;
  await setDoc(doc(dbase, "profiles", uid), patch, { merge: true });
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
    title, start_time, end_time, notes, created_manually: true, shared: false,
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
  console.log(`[Skullcrusher] listWorkouts → requête démarrée (max ${max})…`);
  try {
    const snap = await getDocs(query(
      collection(dbase, "workouts"),
      where("owner_uid", "==", requireUid()),
      orderBy("start_time", "desc"),
      limit(max)
    ));
    const result = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`[Skullcrusher] listWorkouts → ${result.length} séance(s) reçue(s). Exemple :`, result[0]);
    return result;
  } catch (err) {
    console.error("[Skullcrusher] listWorkouts → erreur :", err);
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
  console.log(`[Skullcrusher] listAllSets → requête démarrée (max ${max})…`);
  try {
    const snap = await getDocs(query(
      collectionGroup(dbase, "sets"),
      where("owner_uid", "==", requireUid()),
      orderBy("workout_start_time", "desc"),
      limit(max)
    ));
    const result = snap.docs.map(d => ({ id: d.id, ...d.data(), workout_id: d.ref.parent.parent.id }));
    console.log(`[Skullcrusher] listAllSets → ${result.length} série(s) reçue(s). Exemple :`, result[0]);
    return result;
  } catch (err) {
    console.error("[Skullcrusher] listAllSets → erreur :", err);
    throw err;
  }
}

// ==================== IMPORT CSV avec déduplication ====================
// Identifiants déterministes -> un même fichier réimporté (ou un export qui
// chevauche l'historique) n'écrit jamais deux fois la même série :
//   séance = hash(uid + titre + date/heure début)
//   série  = hash(titre + date/heure début + exercice + n° série [+ #occurrence])
// L'uid dans l'id de séance évite que deux utilisateurs se partagent une
// séance au même titre et à la même minute. Les séances importées avant
// ce changement (id sans uid) sont retrouvées et réutilisées telles quelles.
//
// Les séries existantes sont lues une fois par séance déjà présente (pas
// une lecture par série), et tout est écrit par lots (writeBatch) : ~500
// écritures par aller-retour au lieu d'une, ce qui ramène un historique de
// ~10 000 séries à quelques dizaines de requêtes.
const IMPORT_BATCH_SIZE = 450;

function importSetKey(row) {
  const base = `${row.title}|${row.start_time_iso}|${row.exercise_title}|${row.set_index}`;
  return row.exercise_occurrence > 1 ? `${base}|#${row.exercise_occurrence}` : base;
}

export async function importRows(rows, onProgress = () => {}) {
  const stats = { workoutsCreated: 0, setsImported: 0, setsSkippedDuplicate: 0, errors: 0 };
  const u = auth.currentUser;
  if (!u) throw new Error("Non connecté");
  const uid = u.uid;
  const ownerName = u.displayName || u.email || "Utilisateur";
  const ownerPhoto = u.photoURL || null;

  // ---- 1) regroupement par séance ----
  const byWorkout = new Map();
  for (const r of rows) {
    const key = `${r.title}|${r.start_time_iso}`;
    if (!byWorkout.has(key)) byWorkout.set(key, []);
    byWorkout.get(key).push(r);
  }

  onProgress(0, rows.length, stats, "Lecture de tes séances existantes");
  const mySnap = await getDocs(query(collection(dbase, "workouts"), where("owner_uid", "==", uid)));
  const myWorkoutIds = new Set(mySnap.docs.map(d => d.id));

  // ---- 2) exercices manquants dans la bibliothèque partagée ----
  onProgress(0, rows.length, stats, "Exercices");
  const exSnap = await getDocs(collection(dbase, "exercises"));
  const existingExIds = new Set(exSnap.docs.map(d => d.id));
  const newExercises = new Map();
  for (const r of rows) {
    const id = slugify(r.exercise_title);
    if (id && !existingExIds.has(id) && !newExercises.has(id)) newExercises.set(id, r);
  }

  // ---- 3) préparation des écritures ----
  const ops = []; // { ref, data, kind, merge }
  for (const [id, r] of newExercises) {
    ops.push({ ref: doc(dbase, "exercises", id), kind: "exercise", data: {
      name: r.exercise_title, muscle_group: r.muscle_group_guess || "Autre", equipment: "",
      is_custom: false, rest_timer_seconds: 90
    } });
  }

  let wDone = 0;
  for (const [key, groupRows] of byWorkout) {
    const r = groupRows[0];
    const legacyId = "w_" + (await sha1(key));
    const workoutId = myWorkoutIds.has(legacyId) ? legacyId : "w_" + (await sha1(`${uid}|${key}`));
    const exists = myWorkoutIds.has(workoutId);

    let existingSetIds = new Set();
    if (exists) {
      try {
        const setsSnap = await getDocs(collection(dbase, "workouts", workoutId, "sets"));
        existingSetIds = new Set(setsSnap.docs.map(d => d.id));
      } catch (e) {
        console.error("[Skullcrusher] Erreur lecture séries existantes", key, e);
        stats.errors += groupRows.length;
        continue;
      }
    }

    const newSets = [];
    const seen = new Set();
    for (const row of groupRows) {
      const setId = "s_" + (await sha1(importSetKey(row)));
      if (existingSetIds.has(setId) || seen.has(setId)) { stats.setsSkippedDuplicate++; continue; }
      seen.add(setId);
      newSets.push({ setId, row });
    }

    const summary = {
      muscle_summary: [...new Set(groupRows.map(x => x.muscle_group_guess || "Autre"))],
      total_sets: groupRows.length,
      total_tonnage: Math.round(groupRows.reduce((s, x) => s + (x.weight_kg || 0) * (x.reps || 0), 0))
    };
    const wRef = doc(dbase, "workouts", workoutId);
    if (!exists) {
      ops.push({ ref: wRef, kind: "workout", data: {
        title: r.title, start_time: r.start_time_iso, end_time: r.end_time_iso || null,
        notes: r.description || "", created_manually: false, imported_at: new Date().toISOString(),
        owner_uid: uid, owner_name: ownerName, owner_photo: ownerPhoto, shared: false,
        ...summary
      } });
    } else if (newSets.length) {
      ops.push({ ref: wRef, kind: "summary", merge: true, data: summary });
    }
    for (const { setId, row } of newSets) {
      ops.push({ ref: doc(dbase, "workouts", workoutId, "sets", setId), kind: "set", data: {
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
      } });
    }
    wDone++;
    if (wDone % 25 === 0) onProgress(0, rows.length, stats, `Analyse des séances : ${wDone}/${byWorkout.size}`);
  }

  // ---- 4) écriture par lots ----
  const totalSets = ops.filter(o => o.kind === "set").length;
  let setsWritten = 0;
  onProgress(stats.setsSkippedDuplicate, rows.length, stats);
  for (let i = 0; i < ops.length; i += IMPORT_BATCH_SIZE) {
    const chunk = ops.slice(i, i + IMPORT_BATCH_SIZE);
    const batch = writeBatch(dbase);
    for (const op of chunk) {
      if (op.merge) batch.set(op.ref, op.data, { merge: true });
      else batch.set(op.ref, op.data);
    }
    const chunkSets = chunk.filter(o => o.kind === "set").length;
    try {
      await batch.commit();
      stats.workoutsCreated += chunk.filter(o => o.kind === "workout").length;
      stats.setsImported += chunkSets;
    } catch (e) {
      console.error("[Skullcrusher] Erreur écriture lot d'import", e);
      stats.errors += chunkSets;
      stats.lastError = e.code || e.message;
    }
    setsWritten += chunkSets;
    onProgress(stats.setsSkippedDuplicate + setsWritten, rows.length, stats);
  }
  if (totalSets === 0) onProgress(rows.length, rows.length, stats);

  return stats;
}

// ==================== FEED — séances partagées par les utilisateurs ====================
// Une séance est privée par défaut ; elle n'apparaît dans le feed (et n'est
// lisible par les autres, voir firestore.rules) que si son propriétaire
// l'a partagée (champ `shared`).
export async function listFeedWorkouts(max = 60) {
  console.log(`[Skullcrusher] listFeedWorkouts → requête démarrée (max ${max})…`);
  try {
    const snap = await getDocs(query(collection(dbase, "workouts"), where("shared", "==", true), orderBy("start_time", "desc"), limit(max)));
    const result = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`[Skullcrusher] listFeedWorkouts → ${result.length} séance(s) reçue(s).`);
    return result;
  } catch (err) {
    console.error("[Skullcrusher] listFeedWorkouts → erreur :", err);
    throw err;
  }
}

// Réaction "corne du diable" 🤘 sur une séance du feed — n'importe quel
// utilisateur autorisé peut réagir, pas seulement le propriétaire (les
// règles Firestore limitent cette écriture au seul champ `props`).
export async function setWorkoutShared(workoutId, shared) {
  await updateDoc(doc(dbase, "workouts", workoutId), { shared: !!shared });
}

export async function toggleProps(workoutId) {
  const uid = requireUid();
  const wRef = doc(dbase, "workouts", workoutId);
  const snap = await getDoc(wRef);
  const already = !!snap.data()?.props?.[uid];
  await updateDoc(wRef, { [`props.${uid}`]: already ? deleteField() : true });
  return !already;
}

// ==================== RESET — vider ses séances avant un réimport propre ====================
// Supprime toutes les séances (et leurs séries) appartenant à l'utilisateur
// connecté. Action destructrice, confirmée côté interface.
export async function deleteAllMyWorkouts(onProgress = () => {}) {
  const uid = requireUid();
  const snap = await getDocs(query(collection(dbase, "workouts"), where("owner_uid", "==", uid)));
  const mine = snap.docs;

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
