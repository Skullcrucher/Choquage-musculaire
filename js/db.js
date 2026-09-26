// ============================================================
// COUCHE BASE DE DONNÉES — Firestore
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  initializeFirestore,
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  updateDoc, addDoc, query, orderBy, where, collectionGroup, limit,
  writeBatch, deleteField, increment, startAfter, arrayRemove, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut, setPersistence, indexedDBLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { t } from "./i18n.js";

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
  if (!u) throw new Error(t("Non connecté"));
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
  if (display_name !== undefined) {
    patch.display_name = display_name;
    patch.search_name = display_name.trim().toLowerCase();
  }
  if (photo_data_url !== undefined) patch.photo_data_url = photo_data_url;
  await setDoc(doc(dbase, "profiles", uid), patch, { merge: true });
}

// Données privées de l'utilisateur (ex. connexion Spotify) : user_private/{uid},
// lisible et modifiable par son seul propriétaire (voir firestore.rules).
export async function getPrivateData() {
  const snap = await getDoc(doc(dbase, "user_private", requireUid()));
  return snap.exists() ? snap.data() : null;
}

export async function setPrivateData(patch) {
  await setDoc(doc(dbase, "user_private", requireUid()), patch, { merge: true });
}

// Déconnexion de Spotify : efface le jeton et toutes les données venues de
// Spotify dans les séances de l'utilisateur (bandes-son, son du record issu
// du morceau en cours), comme l'exige la politique développeurs Spotify.
// Les playlists et morceaux collés à la main (liens) sont conservés.
export async function purgeSpotifyData() {
  const uid = requireUid();
  const snap = await getDocs(query(collection(dbase, "workouts"), where("owner_uid", "==", uid)));
  const touched = snap.docs.filter(d => {
    const w = d.data();
    return (w.soundtrack?.tracks || []).length || w.record_song?.source === "spotify";
  });
  for (let i = 0; i < touched.length; i += 400) {
    const batch = writeBatch(dbase);
    touched.slice(i, i + 400).forEach(d => {
      const w = d.data();
      const patch = {};
      if ((w.soundtrack?.tracks || []).length) patch["soundtrack.tracks"] = [];
      if (w.record_song?.source === "spotify") patch.record_song = null;
      batch.update(d.ref, patch);
    });
    await batch.commit();
  }
  await setDoc(doc(dbase, "user_private", uid), { spotify_refresh_token: deleteField(), spotify_token_client_id: deleteField(), spotify_connected_at: deleteField() }, { merge: true });
  return touched.length;
}

// Champs publics du profil (bio, exercices phares, musique...) : voir profile.js.
export async function updatePublicProfile(patch) {
  await setDoc(doc(dbase, "profiles", requireUid()), { ...patch, profile_updated_at: new Date().toISOString() }, { merge: true });
}

// Profils ayant renseigné de la musique (mur musical, portée "Communauté").
export async function listMusicProfiles(max = 300) {
  const snap = await getDocs(query(collection(dbase, "profiles"), where("has_music", "==", true), limit(max)));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// Recherche d'utilisateurs par début de pseudo (insensible à la casse).
// Seuls les profils enregistrés depuis l'ajout de search_name sont
// trouvables : ensureSearchableProfile() rattrape les anciens.
export async function searchProfiles(text, max = 15) {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  const snap = await getDocs(query(collection(dbase, "profiles"),
    where("search_name", ">=", q), where("search_name", "<=", q + "\uf8ff"), limit(max)));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function ensureSearchableProfile() {
  const uid = requireUid();
  const profile = await getProfile(uid);
  if (profile?.display_name && profile.search_name !== profile.display_name.trim().toLowerCase()) {
    await updateMyProfile({ display_name: profile.display_name });
  }
  return profile;
}

// Nom public d'un utilisateur : son pseudo, jamais son email.
async function myPublicName() {
  const profile = await getProfile(requireUid()).catch(() => null);
  return profile?.display_name || auth.currentUser?.displayName || "";
}

// ---------- Temps de repos mémorisés par exercice ----------
// Rangés dans le profil (écriture réservée à son propriétaire, voir
// firestore.rules) sous rest_prefs : { "nom d'exercice en minuscules": secondes }.
// Une copie locale permet un affichage immédiat, même hors connexion.
const LS_REST_PREFS = "skullcrusher_rest_prefs";
let restPrefs = null;

function readLocalRestPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_REST_PREFS) || "{}"); } catch (_) { return {}; }
}

export async function loadRestPrefs() {
  if (restPrefs) return restPrefs;
  restPrefs = readLocalRestPrefs();
  try {
    const profile = await getProfile(requireUid());
    restPrefs = { ...restPrefs, ...(profile?.rest_prefs || {}) };
    localStorage.setItem(LS_REST_PREFS, JSON.stringify(restPrefs));
  } catch (e) {
    console.warn("[Skullcrusher] Temps de repos mémorisés indisponibles (copie locale utilisée) :", e);
  }
  return restPrefs;
}

export function restPrefFor(exerciseName) {
  const prefs = restPrefs || readLocalRestPrefs();
  return prefs[String(exerciseName || "").trim().toLowerCase()] || null;
}

export async function saveRestPref(exerciseName, seconds) {
  const key = String(exerciseName || "").trim().toLowerCase();
  if (!key) return;
  restPrefs = { ...(restPrefs || readLocalRestPrefs()), [key]: seconds };
  try { localStorage.setItem(LS_REST_PREFS, JSON.stringify(restPrefs)); } catch (_) {}
  await setDoc(doc(dbase, "profiles", requireUid()), { rest_prefs: { [key]: seconds } }, { merge: true });
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

// ==================== ADMINISTRATEUR ====================
// Miroir de isAdmin() dans firestore.rules, uniquement pour adapter
// l'interface : la vraie protection reste dans les règles.
export const ADMIN_EMAIL = "bouvet.clement@gmail.com";
export function isAdmin() {
  return auth.currentUser?.email === ADMIN_EMAIL;
}

// ==================== EXERCICES ====================
// Bibliothèque commune : tout le monde la lit et peut y ajouter un
// exercice, mais seul son créateur (created_by) ou l'administrateur peut
// le modifier ou le supprimer. Les exercices d'avant ce verrouillage
// n'ont pas de created_by : seul l'administrateur peut les modifier.
// Groupes musculaires : valeurs stockées en français, traduites à l'affichage avec t().
// i18n-keys: "Pectoraux", "Dos", "Épaules", "Biceps", "Triceps", "Jambes", "Fessiers", "Abdominaux", "Avant-bras", "Cardio", "Autre"
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
      is_custom: isCustom, rest_timer_seconds: 90, created_by: requireUid()
    });
  }
  return id;
}

export async function listExercises() {
  const snap = await getDocs(query(collection(dbase, "exercises"), orderBy("name")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function canEditExercise(ex) {
  return isAdmin() || (!!ex?.created_by && ex.created_by === auth.currentUser?.uid);
}

export async function updateExercise(id, patch) {
  await updateDoc(doc(dbase, "exercises", id), patch);
}

export async function deleteExercise(id) {
  await deleteDoc(doc(dbase, "exercises", id));
}

// ==================== ROUTINES ====================
// Chaque routine appartient à un utilisateur (owner_uid) et a une visibilité :
//   "private" : lui seul ;  "friends" : les amis listés dans shared_with ;
//   "public"  : tout le monde, dans l'onglet Découvrir.
// Des champs dérivés (muscles, noms d'exercices, nombre d'exercices) sont
// stockés avec la routine pour que la recherche filtre sans relire chaque
// exercice. vote_count n'est modifié que par les votes (voir toggleRoutineVote).
// Libellés affichés, traduits une fois au chargement (changer de langue recharge l'app).
// i18n-keys: "Débutant", "Intermédiaire", "Avancé", "Force", "Hypertrophie", "Endurance", "Sèche / perte de poids", "Remise en forme", "🔒 Privée", "👥 Amis", "🌍 Publique"
const translated = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, t(v)]));
export const ROUTINE_LEVELS = translated({ debutant: "Débutant", intermediaire: "Intermédiaire", avance: "Avancé" });
export const ROUTINE_GOALS = translated({ force: "Force", hypertrophie: "Hypertrophie", endurance: "Endurance", seche: "Sèche / perte de poids", remise: "Remise en forme" });
export const ROUTINE_VISIBILITY = translated({ private: "🔒 Privée", friends: "👥 Amis", public: "🌍 Publique" });

const LS_ROUTINES_MIGRATED = "skullcrusher_routines_migrated";

// Les routines créées avant qu'elles deviennent personnelles n'ont pas
// d'owner_uid : l'administrateur (seul utilisateur à l'époque) se les
// attribue une fois, au premier chargement.
async function claimLegacyRoutines(uid) {
  try { if (localStorage.getItem(LS_ROUTINES_MIGRATED) === uid) return; } catch (_) {}
  try {
    const snap = await getDocs(collection(dbase, "routines"));
    const legacy = snap.docs.filter(d => !d.data().owner_uid);
    for (let i = 0; i < legacy.length; i += 450) {
      const batch = writeBatch(dbase);
      legacy.slice(i, i + 450).forEach(d => batch.update(d.ref, { owner_uid: uid }));
      await batch.commit();
    }
    if (legacy.length) console.log(`[Skullcrusher] ${legacy.length} routine(s) existante(s) rattachée(s) à ton compte.`);
    try { localStorage.setItem(LS_ROUTINES_MIGRATED, uid); } catch (_) {}
  } catch (e) {
    console.error("[Skullcrusher] Migration des routines existantes impossible :", e);
  }
}

function routineDerived(exercises) {
  const list = (exercises || []).filter(e => (e.exercise_name || "").trim());
  return {
    exercise_count: list.length,
    muscle_groups: [...new Set(list.map(e => e.muscle_group || "Autre"))],
    exercise_names_lower: [...new Set(list.map(e => e.exercise_name.trim().toLowerCase()))]
  };
}

function byName(a, b) {
  return (a.name || "").localeCompare(b.name || "", "fr");
}

export async function listRoutines() {
  const uid = requireUid();
  if (isAdmin()) await claimLegacyRoutines(uid);
  // Tri côté client : un orderBy("name") en plus du where exigerait un index composite.
  const snap = await getDocs(query(collection(dbase, "routines"), where("owner_uid", "==", uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(byName);
}

// Création ou modification du contenu d'une routine (nom, exercices...).
// Ne touche ni à la visibilité ni aux votes, gérés à part.
export async function saveRoutine(routine, id = null) {
  const now = new Date().toISOString();
  const data = {
    name: routine.name,
    description: routine.description || "",
    level: routine.level || "",
    goal: routine.goal || "",
    playlist_url: routine.playlist_url || "",
    exercises: routine.exercises || [],
    ...routineDerived(routine.exercises),
    owner_uid: requireUid(),
    owner_name: await myPublicName(),
    updated_at: now
  };
  if (id) {
    await setDoc(doc(dbase, "routines", id), data, { merge: true });
    return id;
  }
  const ref = await addDoc(collection(dbase, "routines"), {
    ...data, visibility: "private", shared_with: [], vote_count: 0, created_at: now, source: null
  });
  return ref.id;
}

export async function setRoutineSharing(id, visibility, sharedWith = []) {
  await updateDoc(doc(dbase, "routines", id), {
    visibility,
    shared_with: visibility === "friends" ? [...new Set(sharedWith)] : [],
    owner_name: await myPublicName(),
    updated_at: new Date().toISOString()
  });
}

export async function deleteRoutine(id) {
  await deleteDoc(doc(dbase, "routines", id));
}

// Routines visibles par l'utilisateur hors des siennes : toutes les
// publiques + celles que des amis ont partagées avec lui. Filtrage et tri
// se font côté client (Firestore n'a pas de recherche plein texte).
export async function listDiscoverRoutines() {
  const uid = requireUid();
  const [pub, shared] = await Promise.all([
    getDocs(query(collection(dbase, "routines"), where("visibility", "==", "public"), limit(500))),
    getDocs(query(collection(dbase, "routines"), where("shared_with", "array-contains", uid), limit(300)))
  ]);
  const byId = new Map();
  for (const d of [...pub.docs, ...shared.docs]) byId.set(d.id, { id: d.id, ...d.data() });
  return [...byId.values()];
}

// Ajoute une copie privée de la routine d'un autre dans sa bibliothèque.
export async function copyRoutine(routine) {
  const now = new Date().toISOString();
  const exercises = JSON.parse(JSON.stringify(routine.exercises || []));
  const ref = await addDoc(collection(dbase, "routines"), {
    name: routine.name,
    description: routine.description || "",
    level: routine.level || "",
    goal: routine.goal || "",
    playlist_url: routine.playlist_url || "",
    exercises,
    ...routineDerived(exercises),
    owner_uid: requireUid(),
    owner_name: await myPublicName(),
    visibility: "private", shared_with: [], vote_count: 0,
    created_at: now, updated_at: now,
    source: { routine_id: routine.id, owner_uid: routine.owner_uid || null, owner_name: routine.owner_name || "" }
  });
  return ref.id;
}

// ---------- Votes ----------
// Un vote = routines/{id}/votes/{uid} + vote_count incrémenté dans le même
// lot (les règles vérifient que les deux vont ensemble, donc un vote par
// personne). user_votes/{uid} garde la liste de ses votes pour l'affichage.
export async function getMyVotes() {
  const snap = await getDoc(doc(dbase, "user_votes", requireUid()));
  return snap.exists() ? (snap.data().votes || {}) : {};
}

export async function toggleRoutineVote(routineId, currentlyVoted) {
  const uid = requireUid();
  const batch = writeBatch(dbase);
  const voteRef = doc(dbase, "routines", routineId, "votes", uid);
  if (currentlyVoted) {
    batch.delete(voteRef);
    batch.update(doc(dbase, "routines", routineId), { vote_count: increment(-1) });
    batch.set(doc(dbase, "user_votes", uid), { votes: { [routineId]: deleteField() } }, { merge: true });
  } else {
    batch.set(voteRef, { voter_uid: uid, created_at: new Date().toISOString() });
    batch.update(doc(dbase, "routines", routineId), { vote_count: increment(1) });
    batch.set(doc(dbase, "user_votes", uid), { votes: { [routineId]: true } }, { merge: true });
  }
  await batch.commit();
  return !currentlyVoted;
}

// ==================== AMIS ====================
// Une amitié = un document friendships/{uidA_uidB} (uids triés), créé en
// "pending" par celui qui demande, passé en "accepted" par l'autre.
// Refuser, annuler ou retirer un ami = supprimer le document.
export function friendshipId(a, b) {
  return [a, b].sort().join("_");
}

export async function listFriendships() {
  const uid = requireUid();
  const snap = await getDocs(query(collection(dbase, "friendships"), where("users", "array-contains", uid)));
  return snap.docs.map(d => {
    const f = { id: d.id, ...d.data() };
    f.other_uid = f.users.find(u => u !== uid) || uid;
    f.incoming = f.to === uid;
    return f;
  });
}

export async function listFriendUids() {
  return (await listFriendships()).filter(f => f.status === "accepted").map(f => f.other_uid);
}

export async function sendFriendRequest(toUid) {
  const uid = requireUid();
  if (toUid === uid) throw new Error(t("Tu ne peux pas t'ajouter toi-même."));
  await setDoc(doc(dbase, "friendships", friendshipId(uid, toUid)), {
    users: [uid, toUid].sort(), from: uid, to: toUid, status: "pending",
    created_at: new Date().toISOString()
  });
}

export async function acceptFriendRequest(id) {
  await updateDoc(doc(dbase, "friendships", id), { status: "accepted", accepted_at: new Date().toISOString() });
}

// Supprime l'amitié (ou la demande) et retire l'ex-ami des routines qu'on
// lui avait partagées.
export async function removeFriendship(friendship) {
  const uid = requireUid();
  await deleteDoc(doc(dbase, "friendships", friendship.id));
  const mine = await getDocs(query(collection(dbase, "routines"), where("owner_uid", "==", uid)));
  const touched = mine.docs.filter(d => (d.data().shared_with || []).includes(friendship.other_uid));
  if (!touched.length) return;
  const batch = writeBatch(dbase);
  touched.forEach(d => batch.update(d.ref, { shared_with: d.data().shared_with.filter(u => u !== friendship.other_uid) }));
  await batch.commit();
}

// ==================== SÉANCES (workouts) ====================
export async function createWorkout({ title, start_time, end_time = null, notes = "" }) {
  const u = auth.currentUser;
  if (!u) throw new Error(t("Non connecté"));
  const ref = await addDoc(collection(dbase, "workouts"), {
    title, start_time, end_time, notes, created_manually: true, shared: false,
    owner_uid: u.uid, owner_name: u.displayName || "", owner_photo: u.photoURL || null
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

// ==================== ENTRAÎNÉS ENSEMBLE ====================
// Une séance peut citer des amis avec qui on s'est entraîné (champ
// `partners`, liste d'uids). Les amis cités peuvent lire la séance (même
// privée), la voir dans leur feed, et se retirer de la liste.
export const MAX_PARTNERS = 10;

export async function listPartnerWorkouts(max = 60) {
  const snap = await getDocs(query(collection(dbase, "workouts"), where("partners", "array-contains", requireUid()), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)));
}

export async function setWorkoutPartners(workoutId, uids) {
  const me = requireUid();
  await updateDoc(doc(dbase, "workouts", workoutId), { partners: [...new Set(uids)].filter(u => u && u !== me).slice(0, MAX_PARTNERS) });
}

export async function addWorkoutPartner(workoutId, uid) {
  await updateDoc(doc(dbase, "workouts", workoutId), { partners: arrayUnion(uid) });
}

export async function leaveWorkout(workoutId) {
  await updateDoc(doc(dbase, "workouts", workoutId), { partners: arrayRemove(requireUid()) });
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
export async function listSetsForExercise(exerciseName, max = 3000) {
  const snap = await getDocs(
    query(collectionGroup(dbase, "sets"),
      where("owner_uid", "==", requireUid()),
      where("exercise_title", "==", exerciseName),
      limit(max))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data(), workout_id: d.ref.parent.parent.id }));
}

// Séries de l'utilisateur, les plus récentes d'abord, téléchargées par
// tranches de 2 000 : Firestore refuse toute requête dont la limite
// dépasse 10 000, et une seule grosse réponse est lente et fragile sur une
// connexion moyenne. onProgress(nbChargées) permet d'afficher l'avancement.
const SETS_PAGE_SIZE = 2000;

async function listSetsPaged(extraConstraints, max, onProgress = () => {}) {
  const uid = requireUid();
  const result = [];
  let last = null;
  while (result.length < max) {
    const snap = await getDocs(query(collectionGroup(dbase, "sets"),
      where("owner_uid", "==", uid),
      ...extraConstraints,
      orderBy("workout_start_time", "desc"),
      ...(last ? [startAfter(last)] : []),
      limit(Math.min(SETS_PAGE_SIZE, max - result.length))
    ));
    snap.docs.forEach(d => result.push({ id: d.id, ...d.data(), workout_id: d.ref.parent.parent.id }));
    onProgress(result.length);
    if (snap.docs.length < SETS_PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return result;
}

// Historique complet.
export async function listAllSets(max = 50000, onProgress = () => {}) {
  console.log(`[Skullcrusher] listAllSets → requête démarrée (max ${max}, par tranches de ${SETS_PAGE_SIZE})…`);
  try {
    const result = await listSetsPaged([], max, onProgress);
    console.log(`[Skullcrusher] listAllSets → ${result.length} série(s) reçue(s).`);
    return result;
  } catch (err) {
    console.error("[Skullcrusher] listAllSets → erreur :", err);
    throw err;
  }
}

// Séries depuis une date (période des Stats) : même index que listAllSets
// (owner_uid + workout_start_time), mais seulement la période demandée.
export async function listSetsSince(sinceIso, max = 50000, onProgress = () => {}) {
  return listSetsPaged([where("workout_start_time", ">=", sinceIso)], max, onProgress);
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
  if (!u) throw new Error(t("Non connecté"));
  const uid = u.uid;
  const ownerName = await myPublicName();
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
  const exerciseOps = [];
  for (const [id, r] of newExercises) {
    exerciseOps.push({ ref: doc(dbase, "exercises", id), data: {
      name: r.exercise_title, muscle_group: r.muscle_group_guess || "Autre", equipment: "",
      is_custom: false, rest_timer_seconds: 90, created_by: uid
    } });
  }
  // Lots séparés des séances : un exercice créé entre-temps par quelqu'un
  // d'autre ferait refuser le lot (on ne peut pas écraser l'exercice d'un
  // autre), sans que ça bloque l'import des séries.
  for (let i = 0; i < exerciseOps.length; i += IMPORT_BATCH_SIZE) {
    const batch = writeBatch(dbase);
    exerciseOps.slice(i, i + IMPORT_BATCH_SIZE).forEach(op => batch.set(op.ref, op.data));
    try {
      await batch.commit();
    } catch (e) {
      console.error("[Skullcrusher] Erreur création des exercices importés", e);
    }
  }

  const ops = []; // { ref, data, kind, merge }
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

// Recalcule les muscles affichés (muscle_summary) de ses séances à partir
// de leurs séries et du groupe actuel de chaque exercice. Renvoie le nombre
// de séances modifiées.
export async function recomputeMuscleSummaries(groupOf, onProgress = () => {}) {
  const uid = requireUid();
  const sets = await listAllSets(50000, onProgress);
  const byWorkout = new Map();
  sets.slice().sort((a, b) => (a.set_index || 0) - (b.set_index || 0)).forEach(st => {
    if (st.weight_kg == null && st.reps == null) return;
    if (!byWorkout.has(st.workout_id)) byWorkout.set(st.workout_id, []);
    const list = byWorkout.get(st.workout_id);
    const g = groupOf.get(st.exercise_title) || "Autre";
    if (!list.includes(g)) list.push(g);
  });
  const snap = await getDocs(query(collection(dbase, "workouts"), where("owner_uid", "==", uid)));
  const changed = snap.docs.filter(d => {
    const next = byWorkout.get(d.id);
    return next && JSON.stringify([...(d.data().muscle_summary || [])].sort()) !== JSON.stringify([...next].sort());
  });
  for (let i = 0; i < changed.length; i += 400) {
    const batch = writeBatch(dbase);
    changed.slice(i, i + 400).forEach(d => batch.update(d.ref, { muscle_summary: byWorkout.get(d.id) }));
    await batch.commit();
  }
  return changed.length;
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
