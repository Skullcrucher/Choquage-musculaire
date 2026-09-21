// ============================================================
// ONGLET STATISTIQUES — filtres période / muscle / exercice,
// évolution dans le temps
// ============================================================
import * as db from "./db.js";
import { isoWeek, estimate1RM } from "./utils.js";
import { getExercises, getWorkouts } from "./cache.js";

let chartMuscle = null;
let chartExercise = null;
let allSetsCache = null;

const PERIODS = [
  { label: "4 sem.", weeks: 4 },
  { label: "8 sem.", weeks: 8 },
  { label: "12 sem.", weeks: 12 },
  { label: "26 sem.", weeks: 26 },
  { label: "Tout", weeks: null }
];

const state = { periodWeeks: 8, mode: "muscle", muscle: "all", exercise: null };

async function getAllSets(force = false) {
  if (allSetsCache && !force) return allSetsCache;
  allSetsCache = await db.listAllSets(8000);
  return allSetsCache;
}

function muscleGroupOf(exerciseName, exercises) {
  return exercises.find(e => e.name === exerciseName)?.muscle_group || "Autre";
}

function inPeriod(iso, weeks) {
  if (!weeks) return true;
  if (!iso) return false;
  return new Date(iso).getTime() >= Date.now() - weeks * 7 * 24 * 3600 * 1000;
}

export async function renderStats(container) {
  const [sets, exercises, workouts] = await Promise.all([getAllSets(), getExercises(), getWorkouts()]);
  const exerciseNames = [...new Set(sets.map(s => s.exercise_title))].sort();
  const muscleGroups = [...new Set(exercises.map(e => e.muscle_group))].sort();
  if (!state.exercise && exerciseNames.length) state.exercise = exerciseNames[0];

  const totalVolume = sets.reduce((acc, s) => acc + (s.weight_kg || 0) * (s.reps || 0), 0);

  container.innerHTML = `
    <h1 class="section-title">Statistiques</h1>
    <div class="stat-grid">
      <div class="stat-box"><span class="num">${workouts.length}</span><span class="lbl">séances</span></div>
      <div class="stat-box"><span class="num">${Math.round(totalVolume / 1000)}</span><span class="lbl">tonnes soulevées</span></div>
      <div class="stat-box"><span class="num">${sets.length}</span><span class="lbl">séries loggées</span></div>
    </div>

    <div class="card">
      <div class="muted" style="margin-bottom:4px;">Période</div>
      <div class="chip-row" id="period-chips">
        ${PERIODS.map(p => `<div class="chip ${state.periodWeeks === p.weeks ? "active" : ""}" data-weeks="${p.weeks ?? ""}">${p.label}</div>`).join("")}
      </div>
      <div class="muted" style="margin:12px 0 4px;">Vue</div>
      <div class="chip-row" id="mode-chips">
        <div class="chip ${state.mode === "muscle" ? "active" : ""}" data-mode="muscle">Par muscle</div>
        <div class="chip ${state.mode === "exercise" ? "active" : ""}" data-mode="exercise">Par exercice</div>
      </div>
    </div>

    <div id="stats-content"></div>
  `;

  container.querySelectorAll("#period-chips .chip").forEach(chip => {
    chip.onclick = () => {
      state.periodWeeks = chip.dataset.weeks ? parseInt(chip.dataset.weeks, 10) : null;
      container.querySelectorAll("#period-chips .chip").forEach(c => c.classList.toggle("active", c === chip));
      drawContent(container, sets, exercises, exerciseNames, muscleGroups);
    };
  });
  container.querySelectorAll("#mode-chips .chip").forEach(chip => {
    chip.onclick = () => {
      state.mode = chip.dataset.mode;
      container.querySelectorAll("#mode-chips .chip").forEach(c => c.classList.toggle("active", c === chip));
      drawContent(container, sets, exercises, exerciseNames, muscleGroups);
    };
  });

  drawContent(container, sets, exercises, exerciseNames, muscleGroups);
}

function drawContent(container, sets, exercises, exerciseNames, muscleGroups) {
  const content = container.querySelector("#stats-content");
  if (!content) return;
  if (state.mode === "muscle") {
    drawMuscleView(content, sets, exercises, muscleGroups);
  } else {
    drawExerciseView(content, sets, exerciseNames);
  }
}

// ==================== VUE PAR MUSCLE ====================
function drawMuscleView(content, sets, exercises, muscleGroups) {
  content.innerHTML = `
    <div class="card">
      <div class="chip-row" id="muscle-chips">
        <div class="chip ${state.muscle === "all" ? "active" : ""}" data-muscle="all">Tous</div>
        ${muscleGroups.map(g => `<div class="chip ${state.muscle === g ? "active" : ""}" data-muscle="${g}">${g}</div>`).join("")}
      </div>
      <div style="height:10px"></div>
      <canvas id="muscle-canvas" height="220"></canvas>
      <div id="muscle-exlist" style="margin-top:14px;"></div>
    </div>
  `;
  content.querySelectorAll("#muscle-chips .chip").forEach(chip => {
    chip.onclick = () => {
      state.muscle = chip.dataset.muscle;
      drawMuscleView(content, sets, exercises, muscleGroups);
    };
  });

  const filtered = sets.filter(s => inPeriod(s.workout_start_time, state.periodWeeks) && s.set_type !== "warmup");
  const canvasEl = content.querySelector("#muscle-canvas");
  const weeksSpan = state.periodWeeks || weeksBetweenAllData(sets) || 1;

  if (chartMuscle) { chartMuscle.destroy(); chartMuscle = null; }

  if (state.muscle === "all") {
    // comparaison séries/semaine par groupe, sur la période choisie
    const perGroup = {};
    filtered.forEach(s => {
      const g = muscleGroupOf(s.exercise_title, exercises);
      perGroup[g] = (perGroup[g] || 0) + 1;
    });
    const labels = Object.keys(perGroup).sort((a, b) => perGroup[b] - perGroup[a]);
    const values = labels.map(l => Math.round((perGroup[l] / weeksSpan) * 10) / 10);
    chartMuscle = new Chart(canvasEl, {
      type: "bar",
      data: { labels, datasets: [{ label: "Séries / semaine", data: values, backgroundColor: "#C4884A", borderRadius: 4 }] },
      options: chartOptions(false)
    });
    content.querySelector("#muscle-exlist").innerHTML = "";
  } else {
    // évolution hebdo du volume (nb de séries) pour ce groupe, sur la période
    const groupSets = filtered.filter(s => muscleGroupOf(s.exercise_title, exercises) === state.muscle);
    const perWeek = {};
    groupSets.forEach(s => {
      const wk = isoWeek(s.workout_start_time);
      perWeek[wk] = (perWeek[wk] || 0) + 1;
    });
    const weeks = Object.keys(perWeek).sort();
    chartMuscle = new Chart(canvasEl, {
      type: "line",
      data: { labels: weeks, datasets: [{ label: `Séries — ${state.muscle}`, data: weeks.map(w => perWeek[w]), borderColor: "#C4884A", backgroundColor: "transparent", tension: 0.25 }] },
      options: chartOptions(true)
    });

    // liste des exercices de ce groupe avec leur dernière série connue
    const exList = exercises.filter(e => e.muscle_group === state.muscle);
    const rows = exList.map(ex => {
      const exSets = sets.filter(s => s.exercise_title === ex.name && s.weight_kg && s.reps)
        .sort((a, b) => new Date(b.workout_start_time || 0) - new Date(a.workout_start_time || 0));
      const last = exSets[0];
      return `<div class="list-row"><div class="list-row-title">${ex.name}</div><div class="list-row-meta">${last ? `${last.weight_kg} kg × ${last.reps}` : "—"}</div></div>`;
    }).join("");
    content.querySelector("#muscle-exlist").innerHTML = rows
      ? `<div class="muted" style="margin-bottom:4px;">Exercices du groupe</div>${rows}`
      : "";
  }
}

function weeksBetweenAllData(sets) {
  const dates = sets.map(s => s.workout_start_time).filter(Boolean).sort();
  if (!dates.length) return 1;
  const span = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / (7 * 24 * 3600 * 1000);
  return Math.max(1, Math.round(span));
}

// ==================== VUE PAR EXERCICE ====================
function drawExerciseView(content, allSets, exerciseNames) {
  content.innerHTML = `
    <div class="card">
      <select id="exercise-picker">
        ${exerciseNames.map(n => `<option value="${n}" ${n === state.exercise ? "selected" : ""}>${n}</option>`).join("")}
      </select>
      <canvas id="exercise-canvas" height="220" style="margin-top:12px;"></canvas>
      <div id="exercise-1rm" class="muted" style="margin-top:10px;"></div>
    </div>
  `;
  const picker = content.querySelector("#exercise-picker");
  if (!exerciseNames.length) {
    content.querySelector("#exercise-canvas").replaceWith(
      Object.assign(document.createElement("p"), { className: "muted", textContent: "Pas encore de données." })
    );
    return;
  }
  picker.onchange = () => { state.exercise = picker.value; drawExerciseView(content, allSets, exerciseNames); };
  renderExerciseChart(content, allSets, state.exercise);
}

function renderExerciseChart(content, allSets, exerciseName) {
  const sets = allSets
    .filter(s => s.exercise_title === exerciseName && inPeriod(s.workout_start_time, state.periodWeeks) && s.weight_kg && s.reps)
    .sort((a, b) => new Date(a.workout_start_time) - new Date(b.workout_start_time));

  const perWeek = {};
  sets.forEach(s => {
    const wk = isoWeek(s.workout_start_time);
    const oneRM = estimate1RM(s.weight_kg, s.reps);
    if (!perWeek[wk] || oneRM > perWeek[wk].oneRM) perWeek[wk] = { oneRM, maxWeight: s.weight_kg };
  });
  const weeks = Object.keys(perWeek).sort();

  const canvasEl = content.querySelector("#exercise-canvas");
  if (chartExercise) { chartExercise.destroy(); chartExercise = null; }
  chartExercise = new Chart(canvasEl, {
    type: "line",
    data: {
      labels: weeks,
      datasets: [
        { label: "1RM estimée (kg)", data: weeks.map(w => perWeek[w].oneRM), borderColor: "#C4884A", backgroundColor: "transparent", tension: 0.25 },
        { label: "Charge max (kg)", data: weeks.map(w => perWeek[w].maxWeight), borderColor: "#5C8AA6", backgroundColor: "transparent", tension: 0.25 }
      ]
    },
    options: chartOptions(true, true)
  });

  const last = sets[sets.length - 1];
  content.querySelector("#exercise-1rm").textContent = last
    ? `Dernière série : ${last.weight_kg} kg × ${last.reps} — 1RM estimée ${estimate1RM(last.weight_kg, last.reps)} kg (formule d'Epley)`
    : "Pas de série sur cette période.";
}

function chartOptions(showLegend, legendLabels = false) {
  return {
    responsive: true,
    plugins: { legend: { display: showLegend, labels: { color: "#E8E6E0" } } },
    scales: {
      x: { ticks: { color: "#8B93A0" }, grid: { display: false } },
      y: { ticks: { color: "#8B93A0" }, grid: { color: "#2A313B" } }
    }
  };
}

export function invalidateStatsCache() {
  allSetsCache = null;
}
