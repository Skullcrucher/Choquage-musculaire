// ============================================================
// ONGLET ROUTINES — modèles de séances réutilisables
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal } from "./utils.js";

let exerciseCache = null;

async function getExercises(force = false) {
  if (exerciseCache && !force) return exerciseCache;
  exerciseCache = await db.listExercises();
  return exerciseCache;
}

export async function renderRoutines(container) {
  const routines = await db.listRoutines();
  container.innerHTML = `
    <h1 class="section-title">Routines</h1>
    <button class="btn btn-primary" id="new-routine">+ Nouvelle routine</button>
    <div style="height:14px"></div>
    ${routines.length === 0 ? `<div class="empty-state"><span class="num">▤</span>Pas encore de routine.</div>` : ""}
    ${routines.map(r => `
      <div class="card" data-routine="${r.id}">
        <div class="card-title">${r.name}</div>
        <div class="muted" style="margin-bottom:10px;">${(r.exercises || []).map(e => e.exercise_name).join(" · ")}</div>
        <div class="btn-row">
          <button class="btn btn-sm btn-secondary" data-edit="${r.id}">Modifier</button>
          <button class="btn btn-sm btn-danger" data-del="${r.id}">Supprimer</button>
        </div>
      </div>
    `).join("")}
  `;
  container.querySelector("#new-routine").onclick = () => openRoutineEditor(null);
  container.querySelectorAll("[data-edit]").forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openRoutineEditor(routines.find(r => r.id === b.dataset.edit)); };
  });
  container.querySelectorAll("[data-del]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Supprimer cette routine ?")) return;
      await db.deleteRoutine(b.dataset.del);
      await renderRoutines(container);
    };
  });
}

async function openRoutineEditor(routine) {
  const exercises = await getExercises();
  const state = {
    name: routine?.name || "",
    exercises: routine ? JSON.parse(JSON.stringify(routine.exercises || [])) : []
  };

  const modal = openModal(`
    <h3>${routine ? "Modifier" : "Nouvelle"} routine</h3>
    <label>Nom</label>
    <input id="r-name" value="${state.name}" placeholder="ex: Push A">
    <div id="r-exercises" style="margin-top:14px;"></div>
    <button class="btn btn-secondary btn-sm" id="r-add-ex" style="margin-top:6px;">+ Ajouter un exercice</button>
    <div style="height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="r-cancel">Annuler</button>
      <button class="btn btn-primary" id="r-save">Enregistrer</button>
    </div>
  `, (modalEl) => {
    renderExerciseRows(modalEl, state, exercises);
    modalEl.querySelector("#r-add-ex").onclick = () => {
      state.exercises.push({ exercise_name: "", target_sets: 3, reps_target: "8-10", rest_seconds: 90, muscle_group: "Autre" });
      renderExerciseRows(modalEl, state, exercises);
    };
    modalEl.querySelector("#r-cancel").onclick = closeModal;
    modalEl.querySelector("#r-save").onclick = async () => {
      state.name = modalEl.querySelector("#r-name").value.trim();
      if (!state.name) { toast("Donne un nom à la routine"); return; }
      state.exercises = state.exercises.filter(e => e.exercise_name.trim());
      await db.saveRoutine(state, routine?.id || null);
      closeModal();
      toast("Routine enregistrée");
      await renderRoutines(document.getElementById("view"));
    };
  });
}

function renderExerciseRows(modalEl, state, exercises) {
  const wrap = modalEl.querySelector("#r-exercises");
  wrap.innerHTML = state.exercises.map((ex, i) => `
    <div class="card" style="padding:12px; margin-bottom:8px;">
      <input class="r-ex-name" data-i="${i}" list="r-ex-list" value="${ex.exercise_name}" placeholder="Nom de l'exercice">
      <div class="field-row" style="margin-top:8px;">
        <div><label>Séries</label><input class="r-ex-sets" data-i="${i}" type="number" value="${ex.target_sets}"></div>
        <div><label>Reps cible</label><input class="r-ex-reps" data-i="${i}" value="${ex.reps_target}" placeholder="8-10"></div>
        <div><label>Repos (s)</label><input class="r-ex-rest" data-i="${i}" type="number" value="${ex.rest_seconds}"></div>
      </div>
      <button class="btn btn-sm btn-danger" data-remove="${i}" style="margin-top:8px;">Retirer</button>
    </div>
  `).join("");
  if (!modalEl.querySelector("#r-ex-list")) {
    const dl = document.createElement("datalist");
    dl.id = "r-ex-list";
    dl.innerHTML = exercises.map(e => `<option value="${e.name}">`).join("");
    modalEl.appendChild(dl);
  }
  wrap.querySelectorAll(".r-ex-name").forEach(inp => inp.oninput = () => {
    const ex = exercises.find(e => e.name.toLowerCase() === inp.value.trim().toLowerCase());
    state.exercises[inp.dataset.i].exercise_name = inp.value;
    state.exercises[inp.dataset.i].muscle_group = ex?.muscle_group || "Autre";
  });
  wrap.querySelectorAll(".r-ex-sets").forEach(inp => inp.oninput = () => state.exercises[inp.dataset.i].target_sets = parseInt(inp.value, 10) || 3);
  wrap.querySelectorAll(".r-ex-reps").forEach(inp => inp.oninput = () => state.exercises[inp.dataset.i].reps_target = inp.value);
  wrap.querySelectorAll(".r-ex-rest").forEach(inp => inp.oninput = () => state.exercises[inp.dataset.i].rest_seconds = parseInt(inp.value, 10) || 90);
  wrap.querySelectorAll("[data-remove]").forEach(btn => btn.onclick = () => {
    state.exercises.splice(parseInt(btn.dataset.remove, 10), 1);
    renderExerciseRows(modalEl, state, exercises);
  });
}
