// ============================================================
// ONGLET HISTORIQUE — calendrier + liste des séances passées
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, fmtDateTime, fmtDuration, estimate1RM } from "./utils.js";
import { getWorkouts, invalidate } from "./cache.js";

let viewMonth = new Date();
let workoutsCache = [];
let selectedDay = null;

const DOW = ["L", "M", "M", "J", "V", "S", "D"];

export async function renderHistorique(container) {
  workoutsCache = await getWorkouts();
  container.innerHTML = `
    <h1 class="section-title">Historique</h1>
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <button class="btn btn-sm btn-secondary" id="prev-month">←</button>
        <h3 style="margin:0;" id="month-label"></h3>
        <button class="btn btn-sm btn-secondary" id="next-month">→</button>
      </div>
      <div class="cal-grid" id="cal-grid"></div>
    </div>
    <h3 class="muted" style="margin:18px 0 6px;" id="list-label">Séances récentes</h3>
    <div id="workout-list"></div>
  `;
  container.querySelector("#prev-month").onclick = () => { viewMonth.setMonth(viewMonth.getMonth() - 1); selectedDay = null; renderCalendar(container); renderList(container); };
  container.querySelector("#next-month").onclick = () => { viewMonth.setMonth(viewMonth.getMonth() + 1); selectedDay = null; renderCalendar(container); renderList(container); };
  renderCalendar(container);
  renderList(container);
}

function renderCalendar(container) {
  const label = container.querySelector("#month-label");
  label.textContent = viewMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const grid = container.querySelector("#cal-grid");
  const year = viewMonth.getFullYear(), month = viewMonth.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // lundi=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const workoutDays = new Set(
    workoutsCache
      .filter(w => {
        const d = new Date(w.start_time);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .map(w => new Date(w.start_time).getDate())
  );

  let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const has = workoutDays.has(day);
    html += `<div class="cal-day ${has ? "has-workout" : ""}" data-day="${day}">${day}</div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll("[data-day]").forEach(el => {
    el.onclick = () => {
      const day = parseInt(el.dataset.day, 10);
      selectedDay = selectedDay === day ? null : day;
      renderList(container);
    };
  });
}

function renderList(container) {
  const year = viewMonth.getFullYear(), month = viewMonth.getMonth();
  const label = container.querySelector("#list-label");
  let list = workoutsCache.filter(w => {
    const d = new Date(w.start_time);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  if (selectedDay) {
    list = list.filter(w => new Date(w.start_time).getDate() === selectedDay);
    label.textContent = `Séances du ${selectedDay} ${viewMonth.toLocaleDateString("fr-FR", { month: "long" })}`;
  } else {
    label.textContent = "Séances du mois";
  }
  const wrap = container.querySelector("#workout-list");
  wrap.innerHTML = list.length === 0
    ? `<div class="empty-state muted" style="padding:20px;">Aucune séance.</div>`
    : list.map(w => `
      <div class="list-row" data-w="${w.id}">
        <div>
          <div class="list-row-title">${w.title}</div>
          <div class="list-row-sub">${fmtDateTime(w.start_time)}</div>
        </div>
        <div class="list-row-meta">${fmtDuration(w.start_time, w.end_time)}</div>
      </div>
    `).join("");
  wrap.querySelectorAll("[data-w]").forEach(el => {
    el.onclick = () => openWorkoutDetail(list.find(w => w.id === el.dataset.w));
  });
}

async function openWorkoutDetail(workout) {
  const sets = await db.listSets(workout.id);
  const byExercise = {};
  sets.forEach(s => {
    byExercise[s.exercise_title] = byExercise[s.exercise_title] || [];
    byExercise[s.exercise_title].push(s);
  });
  openModal(`
    <h3>${workout.title}</h3>
    <p class="muted" style="margin-top:-8px;">${fmtDateTime(workout.start_time)} · ${fmtDuration(workout.start_time, workout.end_time)}</p>
    ${Object.entries(byExercise).map(([name, exSets]) => `
      <div style="margin-bottom:12px;">
        <div style="font-family:'Barlow Condensed',sans-serif; font-size:17px; margin-bottom:4px;">${name}</div>
        ${exSets.sort((a, b) => a.set_index - b.set_index).map(s => `
          <div class="muted" style="display:flex; justify-content:space-between; padding:3px 0;">
            <span>Série ${s.set_index} ${s.set_type !== "normal" ? "· " + s.set_type : ""}</span>
            <span>${s.weight_kg ?? "—"} kg × ${s.reps ?? "—"}${s.weight_kg && s.reps ? ` (1RM ${estimate1RM(s.weight_kg, s.reps)} kg)` : ""}</span>
          </div>
        `).join("")}
      </div>
    `).join("") || `<p class="muted">Aucune série enregistrée.</p>`}
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-secondary" id="close-detail">Fermer</button>
      <button class="btn btn-danger" id="del-workout">Supprimer</button>
    </div>
  `, (modalEl) => {
    modalEl.querySelector("#close-detail").onclick = closeModal;
    modalEl.querySelector("#del-workout").onclick = async () => {
      if (!confirm("Supprimer cette séance et toutes ses séries ?")) return;
      await db.deleteWorkout(workout.id);
      invalidate("workouts");
      closeModal();
      await renderHistorique(document.getElementById("view"));
    };
  });
}
