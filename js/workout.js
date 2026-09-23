// ============================================================
// ONGLET SÉANCE — démarrage, log de séries, minuteur de repos
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, fmtDateTime, debounce, attachAutocomplete } from "./utils.js";
import { getExercises, getRoutines, getWorkouts, invalidate } from "./cache.js";

let currentWorkout = null; // { id, title, start_time, exercises: [...] }
let restTimerInterval = null;
let restTimerEnd = null;

const LS_KEY = "fonte_active_workout_id";
const LS_STATE_KEY = "fonte_active_workout_state";

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
  const activeId = localStorage.getItem(LS_KEY);
  if (activeId) {
    if (!currentWorkout || currentWorkout.id !== activeId) {
      currentWorkout = loadLocalState() || { id: activeId, title: "Séance", start_time: new Date().toISOString(), exercises: [] };
    }
    renderActiveWorkout(container);
  } else {
    await renderStartScreen(container);
  }
}

async function renderStartScreen(container) {
  const [routines, workouts] = await Promise.all([getRoutines(), getWorkouts()]);
  const weekCount = countThisWeek(workouts);
  container.innerHTML = `
    <h1 class="section-title">Séance</h1>
    <div class="card-hero">
      <div class="muted" style="margin-bottom:2px;">Cette semaine</div>
      <span class="num" style="font-size:56px; color:var(--amber); display:block; line-height:1;">${weekCount}</span>
      <div class="muted">séance${weekCount > 1 ? "s" : ""} bouclée${weekCount > 1 ? "s" : ""}</div>
    </div>
    <button class="btn btn-primary" id="start-empty">+ Démarrer une séance vide</button>
    <div style="height:18px"></div>
    ${routines.length ? `<h3 class="muted" style="margin-bottom:8px; text-transform:none; font-family:'Inter',sans-serif; font-weight:600; font-size:14px;">Depuis une routine</h3>` : ""}
    ${routines.map(r => `
      <div class="card" style="cursor:pointer" data-start-routine="${r.id}">
        <div class="card-title">${r.name}</div>
        <div class="muted">${(r.exercises || []).length} exercice${(r.exercises || []).length > 1 ? "s" : ""}</div>
      </div>
    `).join("")}
    ${routines.length === 0 ? `<p class="muted">Pas encore de routine — crée-en une dans l'onglet Routines, ou démarre une séance vide.</p>` : ""}
  `;
  container.querySelector("#start-empty").onclick = (e) => startWorkout(null, null, e.currentTarget);
  container.querySelectorAll("[data-start-routine]").forEach(el => {
    el.onclick = (e) => startWorkout(el.dataset.startRoutine, routines.find(r => r.id === el.dataset.startRoutine), e.currentTarget);
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} n'a pas répondu (délai dépassé). Vérifie ta connexion ou désactive un éventuel bloqueur de contenu pour ce site.`)), ms))
  ]);
}

async function startWorkout(routineId, routine = null, triggerEl = null) {
  if (triggerEl) {
    if (triggerEl.dataset.busy) return; // évite le double-tap
    triggerEl.dataset.busy = "1";
    triggerEl.style.opacity = "0.6";
  }
  try {
    const now = new Date();
    const title = routine ? routine.name : `Séance du ${now.toLocaleDateString("fr-FR")}`;
    const id = await withTimeout(db.createWorkout({ title, start_time: now.toISOString() }), 15000, "Création de la séance");
    currentWorkout = {
      id, title, start_time: now.toISOString(),
      exercises: (routine?.exercises || []).map(ex => ({
        exercise_title: ex.exercise_name,
        muscle_group: ex.muscle_group || "Autre",
        rest_timer_seconds: ex.rest_seconds || 90,
        sets: Array.from({ length: ex.target_sets || 3 }, (_, i) => ({
          id: null, set_index: i + 1, set_type: "normal", weight_kg: null, reps: null,
          target_reps: ex.reps_target || "", done: false
        }))
      }))
    };
    localStorage.setItem(LS_KEY, id);
    saveLocalState();
    await renderSeance(document.getElementById("view"));
  } catch (err) {
    console.error("Erreur démarrage séance", err);
    toast(err.message || "Impossible de démarrer la séance");
    if (triggerEl) { delete triggerEl.dataset.busy; triggerEl.style.opacity = ""; }
  }
}

function renderActiveWorkout(container) {
  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
      <h1 class="section-title" style="margin-bottom:0;">${currentWorkout.title}</h1>
    </div>
    <p class="muted" style="margin-top:0;">Débutée à ${fmtDateTime(currentWorkout.start_time)}</p>
    <div id="exercise-list"></div>
    <button class="btn btn-secondary" id="add-exercise" style="margin-top:6px;">+ Ajouter un exercice</button>
    <div style="height:14px"></div>
    <button class="btn btn-primary" id="finish-workout">Terminer la séance</button>
    <button class="btn btn-danger" id="cancel-workout" style="margin-top:8px;">Annuler la séance</button>
  `;
  renderExerciseList(container.querySelector("#exercise-list"));
  container.querySelector("#add-exercise").onclick = () => openAddExerciseModal();
  container.querySelector("#finish-workout").onclick = finishWorkout;
  container.querySelector("#cancel-workout").onclick = cancelWorkout;
  renderRestTimerBar();
}

function renderExerciseList(el) {
  el.innerHTML = currentWorkout.exercises.map((ex, exIdx) => `
    <div class="exercise-block">
      <h3 class="exercise-name">${ex.exercise_title}</h3>
      <div class="set-header">
        <div>#</div><div>kg</div><div>reps</div><div>type</div><div></div>
      </div>
      ${ex.sets.map((s, sIdx) => setRowHtml(s, exIdx, sIdx)).join("")}
      <button class="add-set-link" data-add-set="${exIdx}">+ Ajouter une série</button>
    </div>
  `).join("") || `<div class="empty-state"><span class="num">＋</span>Ajoute un premier exercice pour commencer.</div>`;

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
    const set = currentWorkout.exercises[exIdx].sets[sIdx];

    const kgInput = row.querySelector(".input-kg");
    const repsInput = row.querySelector(".input-reps");
    const badge = row.querySelector(".set-type-badge");
    const check = row.querySelector(".set-done-check");

    const persist = debounce(async () => {
      if (set.weight_kg == null && set.reps == null) return;
      const ex = currentWorkout.exercises[exIdx];
      const payload = {
        exercise_title: ex.exercise_title, set_index: set.set_index, set_type: set.set_type,
        weight_kg: set.weight_kg, reps: set.reps, superset_id: null, exercise_notes: "",
        distance_km: null, duration_seconds: null, rpe: null,
        workout_start_time: currentWorkout.start_time
      };
      if (set.id) await db.updateSet(currentWorkout.id, set.id, payload);
      else set.id = await db.addSet(currentWorkout.id, payload);
      saveLocalState();
    }, 500);

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
      if (set.done && set.weight_kg != null && set.reps != null) {
        const ex = currentWorkout.exercises[exIdx];
        startRestTimer(ex.rest_timer_seconds || 90);
      }
      saveLocalState();
      check.classList.toggle("checked", set.done);
    };
  });
}

function setRowHtml(s, exIdx, sIdx) {
  const badgeLabel = { normal: "—", warmup: "échauf.", dropset: "drop", failure: "échec" }[s.set_type];
  return `
    <div class="set-row" data-ex="${exIdx}" data-set="${sIdx}">
      <div class="set-index">${s.set_index}</div>
      <input class="input-kg" type="number" inputmode="decimal" step="0.5" placeholder="${s.target_reps ? "" : "kg"}" value="${s.weight_kg ?? ""}">
      <input class="input-reps" type="number" inputmode="numeric" placeholder="${s.target_reps || "reps"}" value="${s.reps ?? ""}">
      <div class="set-type-badge ${s.set_type}">${badgeLabel}</div>
      <button class="set-done-check ${s.done ? "checked" : ""}">✓</button>
    </div>
  `;
}

async function openAddExerciseModal() {
  const exercises = await getExercises();
  const names = exercises.map(e => e.name);
  const modal = openModal(`
    <h3>Ajouter un exercice</h3>
    <label>Nom de l'exercice</label>
    <div style="position:relative;"><input id="ex-name" placeholder="ex: Développé Couché (Barre)"></div>
    <label>Groupe musculaire (si nouvel exercice)</label>
    <select id="ex-group">${db.EXO_GROUPS.map(g => `<option ${g === "Autre" ? "selected" : ""}>${g}</option>`).join("")}</select>
    <div style="height:16px"></div>
    <button class="btn btn-primary" id="confirm-add-ex">Ajouter</button>
  `);
  attachAutocomplete(modal.querySelector("#ex-name"), names, (picked) => {
    const ex = exercises.find(e => e.name === picked);
    if (ex) modal.querySelector("#ex-group").value = ex.muscle_group;
  });
  modal.querySelector("#confirm-add-ex").onclick = async () => {
    const name = modal.querySelector("#ex-name").value.trim();
    if (!name) return;
    const group = modal.querySelector("#ex-group").value;
    const existing = exercises.find(e => e.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      await db.upsertExercise(name, group);
      invalidate("exercises");
    }
    currentWorkout.exercises.push({
      exercise_title: existing ? existing.name : name,
      muscle_group: existing ? existing.muscle_group : group,
      rest_timer_seconds: existing?.rest_timer_seconds || 90,
      sets: [
        { id: null, set_index: 1, set_type: "normal", weight_kg: null, reps: null, done: false },
        { id: null, set_index: 2, set_type: "normal", weight_kg: null, reps: null, done: false },
        { id: null, set_index: 3, set_type: "normal", weight_kg: null, reps: null, done: false }
      ]
    });
    saveLocalState();
    closeModal();
    renderExerciseList(document.getElementById("exercise-list"));
  };
}

function startRestTimer(seconds) {
  clearInterval(restTimerInterval);
  restTimerEnd = Date.now() + seconds * 1000;
  renderRestTimerBar();
  restTimerInterval = setInterval(renderRestTimerBar, 1000);
}

function renderRestTimerBar() {
  document.querySelectorAll(".rest-timer").forEach(el => el.remove());
  if (!restTimerEnd) return;
  const remaining = Math.round((restTimerEnd - Date.now()) / 1000);
  if (remaining <= 0) {
    clearInterval(restTimerInterval);
    restTimerEnd = null;
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    toast("Repos terminé");
    return;
  }
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  const bar = document.createElement("div");
  bar.className = "rest-timer";
  bar.innerHTML = `<span>Repos · ${mm}:${ss}</span><span><button id="rt-add">+15s</button> <button id="rt-skip">passer</button></span>`;
  document.body.appendChild(bar);
  bar.querySelector("#rt-add").onclick = () => { restTimerEnd += 15000; renderRestTimerBar(); };
  bar.querySelector("#rt-skip").onclick = () => { clearInterval(restTimerInterval); restTimerEnd = null; renderRestTimerBar(); };
}

async function finishWorkout() {
  await db.updateWorkout(currentWorkout.id, { end_time: new Date().toISOString() });
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_STATE_KEY);
  invalidate("workouts");
  clearInterval(restTimerInterval);
  restTimerEnd = null;
  document.querySelectorAll(".rest-timer").forEach(el => el.remove());
  const finished = currentWorkout;
  currentWorkout = null;
  toast("Séance enregistrée", 2200, { horns: true });
  await renderSeance(document.getElementById("view"));
  return finished;
}

async function cancelWorkout() {
  if (!confirm("Supprimer cette séance et toutes ses séries ?")) return;
  await db.deleteWorkout(currentWorkout.id);
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_STATE_KEY);
  invalidate("workouts");
  clearInterval(restTimerInterval);
  restTimerEnd = null;
  document.querySelectorAll(".rest-timer").forEach(el => el.remove());
  currentWorkout = null;
  await renderSeance(document.getElementById("view"));
}
