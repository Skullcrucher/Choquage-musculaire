// ============================================================
// ONGLET SÉANCE — démarrage, log de séries, minuteur de repos
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, fmtDateTime, debounce, fireRestEndNotification, esc } from "./utils.js";
import { getExercises, getRoutines, getWorkouts, getSetsForExercise, invalidate } from "./cache.js";
import { openExerciseDetail } from "./exercise-detail.js";
import { parseMusicLink, openSpotifyPlayer, providerName, providerIcon } from "./music.js";
import { t, tn, locale } from "./i18n.js";

let currentWorkout = null; // { id, title, start_time, exercises: [...] }
let restTimerInterval = null;
let restTimerEnd = null;

const LS_KEY = "skullcrusher_active_workout_id";
const LS_STATE_KEY = "skullcrusher_active_workout_state";
const LS_REST_KEY = "skullcrusher_rest_timer_end";

function countThisWeek(workouts) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // lundi = 0
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - day);
  return workouts.filter(w => w.start_time && new Date(w.start_time) >= monday).length;
}

function saveLocalState() {
  if (currentWorkout) localStorage.setItem(LS_STATE_KEY, JSON.stringify(currentWorkout));
}

function loadLocalState() {
  const raw = localStorage.getItem(LS_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function renderSeance(container) {
  db.loadRestPrefs().catch(() => null); // temps de repos mémorisés, en arrière-plan
  const activeId = localStorage.getItem(LS_KEY);
  if (activeId) {
    if (!currentWorkout || currentWorkout.id !== activeId) {
      currentWorkout = loadLocalState() || { id: activeId, title: t("Séance"), start_time: new Date().toISOString(), exercises: [] };
    }
    renderActiveWorkout(container);
  } else {
    await renderStartScreen(container);
  }
}

async function renderStartScreen(container) {
  const [routines, workouts, planCard] = await Promise.all([
    getRoutines(), getWorkouts(),
    import("./plans.js").then(m => m.todayPlanCard()).catch(e => { console.warn("[Skullcrusher] Plan indisponible", e); return null; })
  ]);
  const weekCount = countThisWeek(workouts);
  container.innerHTML = `
    <h1 class="section-title">${t("Séance")}</h1>
    <div class="card-hero">
      <div class="muted" style="margin-bottom:2px;">${t("Cette semaine")}</div>
      <span class="num" style="font-size:56px; color:var(--amber); display:block; line-height:1;">${weekCount}</span>
      <div class="muted">${weekCount > 1 ? t("séances bouclées") : t("séance bouclée")}</div>
    </div>
    ${planCard ? planCard.html : ""}
    <button class="btn btn-primary" id="start-empty">+ ${t("Démarrer une séance vide")}</button>
    <div style="height:18px"></div>
    ${routines.length ? `<h3 class="muted" style="margin-bottom:8px; text-transform:none; font-family:'Inter',sans-serif; font-weight:600; font-size:14px;">${t("Depuis une routine")}</h3>` : ""}
    ${routines.map(r => `
      <div class="card" style="cursor:pointer" data-start-routine="${r.id}">
        <div class="card-title">${esc(r.name)}</div>
        <div class="muted">${tn((r.exercises || []).length, "{n} exercice", "{n} exercices")}</div>
      </div>
    `).join("")}
    ${routines.length === 0 ? `<p class="muted">${t("Pas encore de routine — crée-en une dans l'onglet Routines, ou démarre une séance vide.")}</p>` : ""}
  `;
  container.querySelector("#start-empty").onclick = (e) => startWorkout(null, null, e.currentTarget);
  const planBtn = container.querySelector("#plan-start");
  if (planCard?.bind) planCard.bind(container, () => renderStartScreen(container));
  if (planBtn && planCard?.routine) planBtn.onclick = (e) => startWorkout(planCard.routine.id, planCard.routine, e.currentTarget, { plan_id: planCard.plan.id, plan_week: planCard.week });
  container.querySelectorAll("[data-start-routine]").forEach(el => {
    el.onclick = (e) => startWorkout(el.dataset.startRoutine, routines.find(r => r.id === el.dataset.startRoutine), e.currentTarget);
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(t("{label} n'a pas répondu (délai dépassé). Vérifie ta connexion ou désactive un éventuel bloqueur de contenu pour ce site.", { label }))), ms))
  ]);
}

async function startWorkout(routineId, routine = null, triggerEl = null, planInfo = null) {
  if (triggerEl) {
    if (triggerEl.dataset.busy) return; // évite le double-tap
    triggerEl.dataset.busy = "1";
    triggerEl.style.opacity = "0.6";
  }
  try {
    const now = new Date();
    const title = routine ? routine.name : t("Séance du {date}", { date: now.toLocaleDateString(locale()) });
    // Routine et plan d'origine : suivi du plan d'entraînement.
    const extra = { routine_id: routine?.id || null, ...(planInfo || {}) };
    const id = await withTimeout(db.createWorkout({ title, start_time: now.toISOString(), extra }), 15000, t("Création de la séance"));

    const routineExercises = routine?.exercises || [];
    await db.loadRestPrefs().catch(() => null);
    const lastSetsByExercise = await Promise.all(routineExercises.map(ex => getLastSetsForExercise(ex.exercise_name)));

    currentWorkout = {
      id, title, start_time: now.toISOString(), routine_id: routine?.id || null,
      playlist_url: routine?.playlist_url || "",
      exercises: routineExercises.map((ex, i) => {
        const lastSets = lastSetsByExercise[i];
        const targetCount = ex.target_sets || 3;
        const sets = lastSets.length
          ? Array.from({ length: targetCount }, (_, j) => ({
              id: null, set_index: j + 1, set_type: "normal",
              // Charge visée de la routine (progression acceptée) en priorité.
              weight_kg: ex.target_kg ?? lastSets[j]?.weight_kg ?? null, reps: lastSets[j]?.reps ?? null,
              target_reps: ex.reps_target || "", done: false
            }))
          : Array.from({ length: targetCount }, (_, j) => ({
              id: null, set_index: j + 1, set_type: "normal", weight_kg: ex.target_kg ?? null, reps: null,
              target_reps: ex.reps_target || "", done: false
            }));
        return {
          exercise_title: ex.exercise_name,
          muscle_group: ex.muscle_group || "Autre",
          reps_target: ex.reps_target || "", target_sets: ex.target_sets || 0, target_kg: ex.target_kg ?? null,
          rest_timer_seconds: restSecondsFor(ex.exercise_name, ex.rest_seconds),
          sets
        };
      })
    };
    localStorage.setItem(LS_KEY, id);
    saveLocalState();
    await renderSeance(document.getElementById("view"));
  } catch (err) {
    console.error("Erreur démarrage séance", err);
    toast(err.message || t("Impossible de démarrer la séance"));
    if (triggerEl) { delete triggerEl.dataset.busy; triggerEl.style.opacity = ""; }
  }
}

function renderActiveWorkout(container) {
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
      <h1 class="section-title" style="margin-bottom:0;">${esc(currentWorkout.title)}</h1>
    </div>
    <p class="muted" style="margin-top:0;">${t("Débutée à {time}", { time: fmtDateTime(currentWorkout.start_time) })}</p>
    <div id="workout-music"></div>
    <div id="exercise-list"></div>
    <button class="btn btn-secondary btn-compact" id="add-exercise" style="margin-top:6px;">+ ${t("Ajouter un exercice")}</button>
    <div style="height:12px"></div>
    <button class="btn btn-primary" id="finish-workout">${t("Terminer la séance")}</button>
    <div style="text-align:center; margin-top:10px;">
      <button class="btn btn-danger btn-sm" id="cancel-workout">${t("Annuler la séance")}</button>
    </div>
  `;
  renderExerciseList(container.querySelector("#exercise-list"));
  renderWorkoutMusic(container.querySelector("#workout-music"));
  container.querySelector("#add-exercise").onclick = () => openAddExerciseModal();
  container.querySelector("#finish-workout").onclick = finishWorkout;
  container.querySelector("#cancel-workout").onclick = cancelWorkout;
  resumeRestTimerIfAny();
}

// Playlist de la routine (ou, à défaut, playlist de salle du profil) :
// un bouton pour la lancer dans Spotify pendant la séance.
async function renderWorkoutMusic(el) {
  if (!el || !currentWorkout) return;
  let url = currentWorkout.playlist_url;
  let label = t("Playlist de la routine");
  if (!url) {
    const profile = await db.getProfile(db.getCurrentUser()?.uid).catch(() => null);
    url = profile?.music?.playlist_url || "";
    label = t("Ma playlist de salle");
  }
  const link = parseMusicLink(url);
  if (!link || !el.isConnected) return;
  el.innerHTML = `
    <div class="workout-music">
      <span>🎧 ${esc(label)}</span>
      <span style="display:flex; gap:6px;">
        <button class="btn btn-sm btn-secondary" id="wm-listen" style="width:auto;">${t("Écouter ici")}</button>
        <a class="btn btn-sm btn-primary" style="width:auto;" href="${link.url}" target="_blank" rel="noopener">${providerIcon(link)} ${t("Ouvrir {service}", { service: providerName(link) })}</a>
      </span>
    </div>`;
  el.querySelector("#wm-listen").onclick = () => openSpotifyPlayer(link.url, label);
}

// Une série a-t-elle été saisie ou enregistrée (à confirmer avant suppression) ?
const setHasData = (s) => !!s.id || s.weight_kg != null || s.reps != null;

// Sauvegardes en cours par série (pas stockées dans l'état local sérialisé).
const pendingSaves = new WeakMap();

function renderExerciseList(el) {
  const count = currentWorkout.exercises.length;
  el.innerHTML = currentWorkout.exercises.map((ex, exIdx) => `
    <div class="exercise-block">
      <div class="exercise-head">
        <h3 class="exercise-name exercise-name-link" data-ex-detail="${exIdx}" role="button" tabindex="0">${esc(ex.exercise_title)}</h3>
        <div class="exercise-tools">
          <button class="rest-chip" data-rest="${exIdx}" title="${t("Temps de repos")}">⏱ ${fmtRest(ex.rest_timer_seconds || 90)}</button>
          <button class="ex-tool" data-move-up="${exIdx}" title="${t("Monter")}" ${exIdx === 0 ? "disabled" : ""}>↑</button>
          <button class="ex-tool" data-move-down="${exIdx}" title="${t("Descendre")}" ${exIdx === count - 1 ? "disabled" : ""}>↓</button>
          <button class="ex-tool ex-tool-danger" data-remove-ex="${exIdx}" title="${t("Retirer l'exercice")}">✕</button>
        </div>
      </div>
      <div class="set-header">
        <div>#</div><div>kg</div><div>${t("reps")}</div><div>${t("type")}</div><div></div><div></div>
      </div>
      ${ex.sets.map((s, sIdx) => setRowHtml(s, exIdx, sIdx)).join("")}
      <button class="add-set-btn" data-add-set="${exIdx}">＋ ${t("Ajouter une série")}</button>
    </div>
  `).join("") || `<div class="empty-state"><span class="num">＋</span>${t("Ajoute un premier exercice pour commencer.")}</div>`;

  el.querySelectorAll("[data-ex-detail]").forEach(h => {
    h.onclick = () => {
      const ex = currentWorkout.exercises[parseInt(h.dataset.exDetail, 10)];
      openExerciseDetail(ex.exercise_title, ex.muscle_group);
    };
  });

  el.querySelectorAll("[data-rest]").forEach(btn => {
    btn.onclick = () => openRestPicker(parseInt(btn.dataset.rest, 10));
  });

  const moveExercise = (from, to) => {
    const list = currentWorkout.exercises;
    if (to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    saveLocalState();
    renderExerciseList(el);
  };
  el.querySelectorAll("[data-move-up]").forEach(btn => {
    btn.onclick = () => { const i = parseInt(btn.dataset.moveUp, 10); moveExercise(i, i - 1); };
  });
  el.querySelectorAll("[data-move-down]").forEach(btn => {
    btn.onclick = () => { const i = parseInt(btn.dataset.moveDown, 10); moveExercise(i, i + 1); };
  });
  el.querySelectorAll("[data-remove-ex]").forEach(btn => {
    btn.onclick = () => removeExercise(parseInt(btn.dataset.removeEx, 10), el);
  });
  el.querySelectorAll("[data-del-set]").forEach(btn => {
    const [exIdx, sIdx] = btn.dataset.delSet.split(":").map(n => parseInt(n, 10));
    btn.onclick = () => deleteSetAt(exIdx, sIdx, el);
  });

  el.querySelectorAll("[data-add-set]").forEach(btn => {
    btn.onclick = () => {
      const exIdx = parseInt(btn.dataset.addSet, 10);
      const ex = currentWorkout.exercises[exIdx];
      ex.sets.push({ id: null, set_index: ex.sets.length + 1, set_type: "normal", weight_kg: null, reps: null, done: false });
      saveLocalState();
      renderExerciseList(el);
    };
  });

  el.querySelectorAll(".set-row").forEach(row => {
    const exIdx = parseInt(row.dataset.ex, 10);
    const sIdx = parseInt(row.dataset.set, 10);
    // On garde l'objet exercice (pas son index) : l'ordre peut changer
    // pendant qu'une sauvegarde différée est en attente.
    const ex = currentWorkout.exercises[exIdx];
    const set = ex.sets[sIdx];

    const kgInput = row.querySelector(".input-kg");
    const repsInput = row.querySelector(".input-reps");
    const badge = row.querySelector(".set-type-badge");
    const check = row.querySelector(".set-done-check");

    const doSave = async () => {
      // Série ou exercice supprimé entre-temps : rien à écrire.
      if (!currentWorkout || !currentWorkout.exercises.includes(ex) || !ex.sets.includes(set)) return;
      if (set.weight_kg == null && set.reps == null) return;
      set.logged_at = set.logged_at || new Date().toISOString(); // durée réelle de séance (calories)
      const payload = {
        exercise_title: ex.exercise_title, set_index: set.set_index, set_type: set.set_type,
        weight_kg: set.weight_kg, reps: set.reps, superset_id: null, exercise_notes: "",
        distance_km: null, duration_seconds: null, rpe: set.rpe ?? null,
        workout_start_time: currentWorkout.start_time, logged_at: set.logged_at,
        exercise_index: Math.max(0, currentWorkout.exercises.indexOf(ex))
      };
      if (set.id) await db.updateSet(currentWorkout.id, set.id, payload);
      else {
        const workoutId = currentWorkout.id;
        const newId = await db.addSet(workoutId, payload);
        // Supprimée pendant l'écriture : on retire le document tout juste créé.
        if (!currentWorkout || !ex.sets.includes(set)) { db.deleteSet(workoutId, newId).catch(() => null); return; }
        set.id = newId;
      }
      saveLocalState();
    };
    // Une seule écriture à la fois par série : évite de créer deux fois la
    // même série si deux sauvegardes partent avant que la première ait un id.
    const savePersist = () => {
      const next = (pendingSaves.get(set) || Promise.resolve()).catch(() => null).then(doSave);
      pendingSaves.set(set, next);
      return next;
    };
    const persist = debounce(savePersist, 500);

    kgInput.oninput = () => { set.weight_kg = kgInput.value ? parseFloat(kgInput.value) : null; persist(); };
    repsInput.oninput = () => { set.reps = repsInput.value ? parseInt(repsInput.value, 10) : null; persist(); };

    badge.onclick = () => {
      const types = ["normal", "warmup", "dropset", "failure"];
      set.set_type = types[(types.indexOf(set.set_type) + 1) % types.length];
      persist();
      renderExerciseList(el);
    };

    check.onclick = async () => {
      set.done = !set.done;
      // Valeurs pré-remplies (depuis l'historique) jamais encore sauvegardées
      // (aucune saisie n'a déclenché persist) : on force l'écriture ici.
      if (set.done && !set.id && (set.weight_kg != null || set.reps != null)) {
        await savePersist();
      }
      if (set.done && set.weight_kg != null && set.reps != null) {
        startRestTimer(ex.rest_timer_seconds || 90, t("Prochaine série : {exercise}", { exercise: ex.exercise_title }));
        if (askRpe() && set.set_type !== "warmup") showRpePicker(row, set, savePersist);
      }
      if (!set.done) row.nextElementSibling?.classList.contains("rpe-picker") && row.nextElementSibling.remove();
      saveLocalState();
      check.classList.toggle("checked", set.done);
    };
    // Toucher le numéro de la série : (re)donner son RPE.
    row.querySelector(".set-index").onclick = () => showRpePicker(row, set, savePersist);
  });
}

// ---------- RPE (effort ressenti, échelle de Borg modifiée) ----------
// 10 = échec, 9 = encore 1 rep possible, 8 = encore 2, 7 = encore 3…
const LS_ASK_RPE = "skullcrusher_ask_rpe";
export function askRpe() {
  try { return localStorage.getItem(LS_ASK_RPE) !== "0"; } catch (_) { return true; }
}
export function setAskRpe(on) {
  try { localStorage.setItem(LS_ASK_RPE, on ? "1" : "0"); } catch (_) {}
}
const RPE_VALUES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];

function showRpePicker(row, set, savePersist) {
  document.querySelectorAll(".rpe-picker").forEach(p => p.remove());
  const picker = document.createElement("div");
  picker.className = "rpe-picker";
  picker.innerHTML = `
    <span class="muted" title="${t("10 = échec, 9 = encore 1 rep possible, 8 = encore 2…")}">${t("RPE ?")}</span>
    ${RPE_VALUES.map(v => `<button data-rpe="${v}" class="${set.rpe === v ? "active" : ""}">${String(v).replace(".", ",")}</button>`).join("")}
    <button data-rpe="" class="rpe-skip" title="${t("Passer")}">✕</button>`;
  row.after(picker);
  picker.querySelectorAll("[data-rpe]").forEach(b => b.onclick = () => {
    if (b.dataset.rpe) {
      set.rpe = parseFloat(b.dataset.rpe);
      row.querySelector(".set-index").innerHTML = `${set.set_index}<small class="rpe-tag">@${String(set.rpe).replace(".", ",")}</small>`;
      savePersist();
      saveLocalState();
    }
    picker.remove();
  });
}

function setRowHtml(s, exIdx, sIdx) {
  // i18n-keys: "échauf.", "drop", "échec"
  const badgeLabel = t({ normal: "—", warmup: "échauf.", dropset: "drop", failure: "échec" }[s.set_type]);
  return `
    <div class="set-row" data-ex="${exIdx}" data-set="${sIdx}">
      <div class="set-index" title="${t("RPE ?")}">${s.set_index}${s.rpe ? `<small class="rpe-tag">@${String(s.rpe).replace(".", ",")}</small>` : ""}</div>
      <input class="input-kg" type="number" inputmode="decimal" step="0.5" placeholder="${s.target_reps ? "" : "kg"}" value="${s.weight_kg ?? ""}">
      <input class="input-reps" type="number" inputmode="numeric" placeholder="${s.target_reps || "reps"}" value="${s.reps ?? ""}">
      <div class="set-type-badge ${s.set_type}">${badgeLabel}</div>
      <button class="set-done-check ${s.done ? "checked" : ""}">✓</button>
      <button class="set-del" data-del-set="${exIdx}:${sIdx}" title="${t("Supprimer la série")}">✕</button>
    </div>
  `;
}

// Supprime une série de la séance (et de Firestore si elle y est déjà),
// puis renumérote les suivantes.
async function deleteSetAt(exIdx, sIdx, el) {
  const ex = currentWorkout.exercises[exIdx];
  const set = ex?.sets[sIdx];
  if (!set) return;
  if (setHasData(set) && !confirm(t("Supprimer la série {n} ?", { n: set.set_index }))) return;
  await (pendingSaves.get(set) || Promise.resolve()).catch(() => null);
  if (set.id) {
    try { await db.deleteSet(currentWorkout.id, set.id); }
    catch (e) { console.error("[Skullcrusher] Suppression série", e); toast(t("Suppression impossible, réessaie")); return; }
  }
  ex.sets.splice(ex.sets.indexOf(set), 1);
  ex.sets.forEach((s, i) => {
    if (s.set_index === i + 1) return;
    s.set_index = i + 1;
    if (s.id) db.updateSet(currentWorkout.id, s.id, { set_index: s.set_index }).catch(e => console.warn("[Skullcrusher] Renumérotation série", e));
  });
  saveLocalState();
  renderExerciseList(el);
}

// Retire un exercice entier de la séance en cours, séries comprises.
async function removeExercise(exIdx, el) {
  const ex = currentWorkout.exercises[exIdx];
  if (!ex) return;
  if (ex.sets.some(setHasData) && !confirm(t("Retirer {exercise} et ses séries de la séance ?", { exercise: ex.exercise_title }))) return;
  await Promise.all(ex.sets.map(s => (pendingSaves.get(s) || Promise.resolve()).catch(() => null)));
  try {
    await Promise.all(ex.sets.filter(s => s.id).map(s => db.deleteSet(currentWorkout.id, s.id)));
  } catch (e) {
    console.error("[Skullcrusher] Suppression exercice", e);
    toast(t("Suppression impossible, réessaie"));
    return;
  }
  currentWorkout.exercises.splice(currentWorkout.exercises.indexOf(ex), 1);
  saveLocalState();
  renderExerciseList(el);
}

// Dernières séries loggées pour un exercice (la séance la plus récente où
// il a été fait), pour pré-remplir poids/reps plutôt que partir de zéro.
async function getLastSetsForExercise(exerciseName) {
  let relevant = await getSetsForExercise(exerciseName);
  relevant = relevant.filter(s => s.workout_start_time);
  if (!relevant.length) return [];
  const latestTime = relevant.reduce((max, s) => (s.workout_start_time > max ? s.workout_start_time : max), relevant[0].workout_start_time);
  return relevant
    .filter(s => s.workout_start_time === latestTime)
    .sort((a, b) => a.set_index - b.set_index);
}

// Temps de repos d'un exercice : celui que l'utilisateur a choisi la
// dernière fois (mémorisé), sinon celui de la routine ou de la bibliothèque.
function restSecondsFor(exerciseName, fallback) {
  return db.restPrefFor(exerciseName) || fallback || 90;
}

function fmtRest(seconds) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s} s`;
}

function openRestPicker(exIdx) {
  const ex = currentWorkout.exercises[exIdx];
  let value = ex.rest_timer_seconds || 90;
  const presets = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
  openModal(`
    <h3 style="margin-bottom:4px;">${t("Repos")} · ${esc(ex.exercise_title)}</h3>
    <p class="muted" style="margin-top:0;">${t("Mémorisé pour les prochaines séances.")}</p>
    <div style="display:flex; align-items:center; justify-content:center; gap:14px; margin:14px 0;">
      <button class="btn btn-secondary btn-sm" id="rp-minus" style="width:auto;">−15 s</button>
      <div id="rp-value" style="font-family:'Anton',sans-serif; font-size:40px; color:var(--amber); min-width:110px; text-align:center;"></div>
      <button class="btn btn-secondary btn-sm" id="rp-plus" style="width:auto;">+15 s</button>
    </div>
    <div class="chip-row" style="justify-content:center;">
      ${presets.map(p => `<div class="chip" data-rp="${p}">${fmtRest(p)}</div>`).join("")}
    </div>
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn btn-secondary" id="rp-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="rp-save">${t("Enregistrer")}</button>
    </div>
  `, (modalEl) => {
    const draw = () => {
      modalEl.querySelector("#rp-value").textContent = fmtRest(value);
      modalEl.querySelectorAll("[data-rp]").forEach(c => c.classList.toggle("active", parseInt(c.dataset.rp, 10) === value));
    };
    modalEl.querySelector("#rp-minus").onclick = () => { value = Math.max(15, value - 15); draw(); };
    modalEl.querySelector("#rp-plus").onclick = () => { value = Math.min(900, value + 15); draw(); };
    modalEl.querySelectorAll("[data-rp]").forEach(c => c.onclick = () => { value = parseInt(c.dataset.rp, 10); draw(); });
    modalEl.querySelector("#rp-cancel").onclick = closeModal;
    modalEl.querySelector("#rp-save").onclick = () => {
      ex.rest_timer_seconds = value;
      saveLocalState();
      closeModal();
      renderExerciseList(document.getElementById("exercise-list"));
      db.saveRestPref(ex.exercise_title, value).catch(e => console.warn("[Skullcrusher] Mémorisation du repos impossible :", e));
      toast(t("Repos {time} pour {exercise}", { time: fmtRest(value), exercise: ex.exercise_title }));
    };
    draw();
  });
}

async function openAddExerciseModal() {
  const { openExercisePicker } = await import("./exercise-picker.js");
  await openExercisePicker({ onAdd: (name, group, existing) => addExerciseToWorkout(name, group, existing) });
}

// Ajoute un exercice (de la bibliothèque, ou nouveau) à la séance en cours.
function addExerciseToWorkout(name, group, existing) {
  if (!currentWorkout) return;
  const finalName = existing ? existing.name : name;
  // Ajout immédiat avec 3 séries vides ; l'historique (pré-remplissage) et
  // la création d'un nouvel exercice dans la bibliothèque se font en
  // arrière-plan, sans faire attendre.
  const ex = {
    exercise_title: finalName,
    muscle_group: existing ? existing.muscle_group : group,
    rest_timer_seconds: restSecondsFor(finalName, existing?.rest_timer_seconds),
    sets: [1, 2, 3].map(i => ({ id: null, set_index: i, set_type: "normal", weight_kg: null, reps: null, done: false }))
  };
  currentWorkout.exercises.push(ex);
  saveLocalState();
  renderExerciseList(document.getElementById("exercise-list"));

  if (!existing) {
    db.upsertExercise(name, group)
      .then(() => invalidate("exercises"))
      .catch(err => console.error("[Skullcrusher] Erreur création exercice dans la bibliothèque", err));
  }
  getLastSetsForExercise(finalName).then(lastSets => {
    const untouched = ex.sets.every(s => !s.id && !s.done && s.weight_kg == null && s.reps == null);
    if (!lastSets.length || !untouched || !currentWorkout || !currentWorkout.exercises.includes(ex)) return;
    ex.sets = lastSets.map((s, i) => ({ id: null, set_index: i + 1, set_type: "normal", weight_kg: s.weight_kg ?? null, reps: s.reps ?? null, done: false }));
    saveLocalState();
    const list = document.getElementById("exercise-list");
    if (list) renderExerciseList(list);
    toast(t("Séries pré-remplies depuis ta dernière séance de {exercise}", { exercise: finalName }));
  }).catch(histErr => console.error("[Skullcrusher] Erreur récupération historique exercice (pas de pré-remplissage)", histErr));
}

let restPushBody = "";

// Module des notifications en arrière-plan, chargé à la demande : si un
// bloqueur de contenu le refuse, le minuteur fonctionne quand même (seule
// la notification hors de l'app manque).
const loadTimerSync = () => import("./timer-sync.js").catch((e) => {
  console.warn("[Skullcrusher] Module de notifications indisponible :", e);
  return null;
});
function scheduleRestPush(endMs, body) {
  loadTimerSync().then(m => m?.scheduleRestPush(endMs, body));
}
function cancelRestPush() {
  loadTimerSync().then(m => m?.cancelRestPush());
}

// Le compte à rebours affiché tourne dans l'app ; la notification de fin,
// elle, est confiée au serveur push pour arriver même si on est passé sur
// une autre app (voir timer-sync.js).
function startRestTimer(seconds, pushBody = "") {
  clearInterval(restTimerInterval);
  restTimerEnd = Date.now() + seconds * 1000;
  restPushBody = pushBody;
  localStorage.setItem(LS_REST_KEY, String(restTimerEnd));
  scheduleRestPush(restTimerEnd, restPushBody);
  renderRestTimerBar();
  restTimerInterval = setInterval(renderRestTimerBar, 1000);
}

// Reprend un minuteur en cours après une fermeture/rechargement de l'app
// (tant que l'échéance stockée n'est pas déjà dans le passé).
function resumeRestTimerIfAny() {
  const stored = localStorage.getItem(LS_REST_KEY);
  if (!stored) return;
  const end = parseInt(stored, 10);
  if (!end || end <= Date.now()) { localStorage.removeItem(LS_REST_KEY); return; }
  restTimerEnd = end;
  renderRestTimerBar();
  clearInterval(restTimerInterval);
  restTimerInterval = setInterval(renderRestTimerBar, 1000);
}

function renderRestTimerBar() {
  document.querySelectorAll(".rest-timer").forEach(el => el.remove());
  if (!restTimerEnd) return;
  const remaining = Math.round((restTimerEnd - Date.now()) / 1000);
  if (remaining <= 0) {
    clearInterval(restTimerInterval);
    restTimerEnd = null;
    localStorage.removeItem(LS_REST_KEY);
    fireRestEndNotification();
    toast(t("Repos terminé"), 2200, { horns: true });
    return;
  }
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  const bar = document.createElement("div");
  bar.className = "rest-timer";
  bar.innerHTML = `<span>${t("Repos")} · ${mm}:${ss}</span><span><button id="rt-add">+15s</button> <button id="rt-skip">${t("passer")}</button></span>`;
  document.body.appendChild(bar);
  bar.querySelector("#rt-add").onclick = () => {
    restTimerEnd += 15000;
    localStorage.setItem(LS_REST_KEY, String(restTimerEnd));
    scheduleRestPush(restTimerEnd, restPushBody);
    renderRestTimerBar();
  };
  bar.querySelector("#rt-skip").onclick = () => {
    clearInterval(restTimerInterval);
    restTimerEnd = null;
    cancelRestPush();
    localStorage.removeItem(LS_REST_KEY);
    renderRestTimerBar();
  };
}

async function finishWorkout() {
  const loggedSets = currentWorkout.exercises.reduce((n, ex) => n + ex.sets.filter(s => s.weight_kg != null || s.reps != null).length, 0);
  const totalTonnage = Math.round(currentWorkout.exercises.reduce((sum, ex) =>
    sum + ex.sets.reduce((s, set) => s + (set.weight_kg || 0) * (set.reps || 0), 0), 0));
  const muscleSummary = [...new Set(
    currentWorkout.exercises
      .filter(ex => ex.sets.some(s => s.weight_kg != null || s.reps != null))
      .map(ex => ex.muscle_group || "Autre")
  )];
  const lastSetAt = currentWorkout.exercises.flatMap(ex => ex.sets.map(st => st.logged_at || "")).sort().pop() || null;
  // Écran de fin : records, son du record, playlist, bande-son Spotify,
  // amis présents, calories, partage.
  const finishBtn = document.getElementById("finish-workout");
  if (finishBtn) { finishBtn.disabled = true; finishBtn.textContent = t("Calcul des records…"); }
  let extra;
  try {
    const { openFinishDialog } = await import("./finish.js");
    extra = await openFinishDialog(currentWorkout, { sets: loggedSets, tonnage: totalTonnage, lastSetAt });
  } catch (e) {
    console.error("[Skullcrusher] Écran de fin de séance indisponible", e);
    extra = { shared: loggedSets > 0 && confirm(t("Partager cette séance sur le feed ?")), records: [], record_song: null, soundtrack: null };
  }
  if (finishBtn) { finishBtn.disabled = false; finishBtn.textContent = t("Terminer la séance"); }
  if (!extra) return null; // retour à la séance
  await db.updateWorkout(currentWorkout.id, {
    end_time: new Date().toISOString(),
    muscle_summary: muscleSummary,
    total_sets: loggedSets,
    total_tonnage: totalTonnage,
    shared: loggedSets > 0 && extra.shared,
    records: extra.records || [],
    record_song: extra.record_song || null,
    soundtrack: extra.soundtrack || null,
    partners: extra.partners || [],
    effort: extra.effort || null,
    watch_kcal: extra.watch_kcal || null,
    last_set_at: lastSetAt
  });
  // Progression acceptée : nouvelles charges visées dans la routine.
  if (extra.progressions?.length && extra.routine) {
    try {
      const { applyProgressions } = await import("./progression.js");
      await applyProgressions(extra.routine, extra.progressions);
      invalidate("routines");
    } catch (e) { console.warn("[Skullcrusher] Progression non enregistrée :", e); }
  }
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_STATE_KEY);
  localStorage.removeItem(LS_REST_KEY);
  invalidate("workouts", "sets");
  clearInterval(restTimerInterval);
  if (restTimerEnd) cancelRestPush();
  restTimerEnd = null;
  document.querySelectorAll(".rest-timer").forEach(el => el.remove());
  const finished = currentWorkout;
  currentWorkout = null;
  toast(t("Séance enregistrée"), 2200, { horns: true });
  // Met à jour les exercices phares / chiffres du profil public, en arrière-plan.
  import("./profile.js").then(m => m.refreshMyProfileHighlights()).catch(e => console.warn("[Skullcrusher] Profil public non mis à jour :", e));
  await renderSeance(document.getElementById("view"));
  return finished;
}

async function cancelWorkout() {
  if (!confirm(t("Supprimer cette séance et toutes ses séries ?"))) return;
  await db.deleteWorkout(currentWorkout.id);
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_STATE_KEY);
  localStorage.removeItem(LS_REST_KEY);
  invalidate("workouts", "sets");
  clearInterval(restTimerInterval);
  if (restTimerEnd) cancelRestPush();
  restTimerEnd = null;
  document.querySelectorAll(".rest-timer").forEach(el => el.remove());
  currentWorkout = null;
  await renderSeance(document.getElementById("view"));
}
