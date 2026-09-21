// ============================================================
// ONGLET STATISTIQUES — progression par exercice, volume par groupe
// ============================================================
import * as db from "./db.js";
import { isoWeek, estimate1RM } from "./utils.js";

let chartInstance = null;
let allSetsCache = null;

async function getAllSets(force = false) {
  if (allSetsCache && !force) return allSetsCache;
  allSetsCache = await db.listAllSets(8000);
  return allSetsCache;
}

export async function renderStats(container) {
  const sets = await getAllSets();
  const exercises = await db.listExercises();
  const exerciseNames = [...new Set(sets.map(s => s.exercise_title))].sort();

  const workouts = await db.listWorkouts(500);
  const totalVolume = sets.reduce((acc, s) => acc + (s.weight_kg || 0) * (s.reps || 0), 0);

  container.innerHTML = `
    <h1 class="section-title">Statistiques</h1>
    <div class="stat-grid">
      <div class="stat-box"><span class="num">${workouts.length}</span><span class="lbl">séances</span></div>
      <div class="stat-box"><span class="num">${Math.round(totalVolume / 1000)}</span><span class="lbl">tonnes soulevées</span></div>
      <div class="stat-box"><span class="num">${sets.length}</span><span class="lbl">séries loggées</span></div>
    </div>

    <div class="card">
      <div class="card-title">Volume hebdo par groupe musculaire</div>
      <p class="muted" style="margin-top:0;">8 dernières semaines</p>
      <canvas id="muscle-chart" height="200"></canvas>
    </div>

    <div class="card">
      <div class="card-title">Progression par exercice</div>
      <select id="exercise-picker" style="margin:8px 0;">
        ${exerciseNames.map(n => `<option value="${n}">${n}</option>`).join("")}
      </select>
      <canvas id="exercise-chart" height="220"></canvas>
      <div id="exercise-1rm" class="muted" style="margin-top:10px;"></div>
    </div>
  `;

  renderMuscleChart(container, sets, exercises);

  const picker = container.querySelector("#exercise-picker");
  if (exerciseNames.length) {
    renderExerciseChart(container, sets, exerciseNames[0]);
    picker.onchange = () => renderExerciseChart(container, sets, picker.value);
  } else {
    container.querySelector("#exercise-chart").replaceWith(
      Object.assign(document.createElement("p"), { className: "muted", textContent: "Pas encore de données." })
    );
  }
}

function muscleGroupOf(exerciseName, exercises) {
  const found = exercises.find(e => e.name === exerciseName);
  return found?.muscle_group || "Autre";
}

function renderMuscleChart(container, sets, exercises) {
  const since = Date.now() - 56 * 24 * 3600 * 1000; // 8 semaines
  const recent = sets.filter(s => s.workout_start_time && new Date(s.workout_start_time).getTime() >= since && s.set_type !== "warmup");
  const perGroup = {};
  recent.forEach(s => {
    const g = muscleGroupOf(s.exercise_title, exercises);
    perGroup[g] = (perGroup[g] || 0) + 1;
  });
  const labels = Object.keys(perGroup).sort((a, b) => perGroup[b] - perGroup[a]);
  const values = labels.map(l => Math.round((perGroup[l] / 8) * 10) / 10);

  const ctx = container.querySelector("#muscle-chart");
  new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Séries / semaine", data: values, backgroundColor: "#C4884A", borderRadius: 4 }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8B93A0" }, grid: { display: false } },
        y: { ticks: { color: "#8B93A0" }, grid: { color: "#2A313B" } }
      }
    }
  });
}

function renderExerciseChart(container, allSets, exerciseName) {
  const sets = allSets
    .filter(s => s.exercise_title === exerciseName && s.workout_start_time && s.weight_kg && s.reps)
    .sort((a, b) => new Date(a.workout_start_time) - new Date(b.workout_start_time));

  const perWeek = {};
  sets.forEach(s => {
    const wk = isoWeek(s.workout_start_time);
    const oneRM = estimate1RM(s.weight_kg, s.reps);
    if (!perWeek[wk] || oneRM > perWeek[wk].oneRM) {
      perWeek[wk] = { oneRM, maxWeight: s.weight_kg };
    }
  });
  const weeks = Object.keys(perWeek).sort();
  const data1RM = weeks.map(w => perWeek[w].oneRM);
  const dataMax = weeks.map(w => perWeek[w].maxWeight);

  const canvasEl = container.querySelector("#exercise-chart");
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(canvasEl, {
    type: "line",
    data: {
      labels: weeks,
      datasets: [
        { label: "1RM estimée (kg)", data: data1RM, borderColor: "#C4884A", backgroundColor: "transparent", tension: 0.25 },
        { label: "Charge max (kg)", data: dataMax, borderColor: "#5C8AA6", backgroundColor: "transparent", tension: 0.25 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#E8E6E0" } } },
      scales: {
        x: { ticks: { color: "#8B93A0" }, grid: { display: false } },
        y: { ticks: { color: "#8B93A0" }, grid: { color: "#2A313B" } }
      }
    }
  });

  const last = sets[sets.length - 1];
  const el = container.querySelector("#exercise-1rm");
  el.textContent = last
    ? `Dernière série : ${last.weight_kg} kg × ${last.reps} — 1RM estimée ${estimate1RM(last.weight_kg, last.reps)} kg (formule d'Epley)`
    : "";
}

export function invalidateStatsCache() {
  allSetsCache = null;
}
