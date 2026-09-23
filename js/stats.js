// ============================================================
// ONGLET STATISTIQUES — filtres période / muscle / exercice,
// évolution dans le temps
// ============================================================
import { isoWeek, estimate1RM } from "./utils.js";
import { getExercises, getWorkouts, getAllSets, invalidate } from "./cache.js";
import { openExerciseDetail } from "./exercise-detail.js";

let chartMuscle = null;
let chartExercise = null;

const PERIODS = [
  { label: "4 sem.", weeks: 4 },
  { label: "8 sem.", weeks: 8 },
  { label: "12 sem.", weeks: 12 },
  { label: "26 sem.", weeks: 26 },
  { label: "Tout", weeks: null }
];

const state = {
  periodWeeks: 8, mode: "muscle", muscle: "all", exercise: null,
  customY: "1rm", customX: "week", customScope: "all", customScopeValue: null
};

const Y_METRICS = [
  { key: "1rm", label: "1RM estimée (kg)" },
  { key: "maxweight", label: "Charge max (kg)" },
  { key: "volume", label: "Volume (séries)" },
  { key: "tonnage", label: "Tonnage (kg)" },
  { key: "reps", label: "Répétitions" }
];
const X_DIMENSIONS = [
  { key: "week", label: "Semaine" },
  { key: "exercise", label: "Exercice" },
  { key: "muscle", label: "Groupe musculaire" }
];

function aggregate(setsArr, metricKey) {
  const withWeight = setsArr.filter(s => s.weight_kg != null && s.reps != null);
  switch (metricKey) {
    case "1rm": {
      const vals = withWeight.map(s => estimate1RM(s.weight_kg, s.reps));
      return vals.length ? Math.max(...vals) : null;
    }
    case "maxweight": {
      const vals = withWeight.map(s => s.weight_kg);
      return vals.length ? Math.max(...vals) : null;
    }
    case "volume":
      return setsArr.length;
    case "tonnage":
      return Math.round(setsArr.reduce((a, s) => a + (s.weight_kg || 0) * (s.reps || 0), 0));
    case "reps":
      return setsArr.reduce((a, s) => a + (s.reps || 0), 0);
    default:
      return null;
  }
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
        <div class="chip ${state.mode === "custom" ? "active" : ""}" data-mode="custom">Personnalisé</div>
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
  } else if (state.mode === "exercise") {
    drawExerciseView(content, sets, exerciseNames);
  } else {
    drawCustomView(content, sets, exercises, exerciseNames, muscleGroups);
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
      data: { labels, datasets: [{ label: "Séries / semaine", data: values, backgroundColor: "#FFB020", borderRadius: 4 }] },
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
      data: { labels: weeks, datasets: [{ label: `Séries — ${state.muscle}`, data: weeks.map(w => perWeek[w]), borderColor: "#FFB020", backgroundColor: "transparent", tension: 0.25 }] },
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
      <button class="btn btn-secondary btn-sm" id="exercise-sheet-btn" style="margin-top:10px;">Voir la fiche de l'exercice</button>
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
  content.querySelector("#exercise-sheet-btn").onclick = () => openExerciseDetail(state.exercise);
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
        { label: "1RM estimée (kg)", data: weeks.map(w => perWeek[w].oneRM), borderColor: "#FFB020", backgroundColor: "transparent", tension: 0.25 },
        { label: "Charge max (kg)", data: weeks.map(w => perWeek[w].maxWeight), borderColor: "#4C8DFF", backgroundColor: "transparent", tension: 0.25 }
      ]
    },
    options: chartOptions(true, true)
  });

  const last = sets[sets.length - 1];
  content.querySelector("#exercise-1rm").textContent = last
    ? `Dernière série : ${last.weight_kg} kg × ${last.reps} — 1RM estimée ${estimate1RM(last.weight_kg, last.reps)} kg (formule d'Epley)`
    : "Pas de série sur cette période.";
}

// ==================== VUE PERSONNALISÉE ====================
let chartCustom = null;

function drawCustomView(content, allSets, exercises, exerciseNames, muscleGroups) {
  content.innerHTML = `
    <div class="card">
      <div class="muted" style="margin-bottom:4px;">Axe Y — mesure</div>
      <select id="custom-y">
        ${Y_METRICS.map(m => `<option value="${m.key}" ${state.customY === m.key ? "selected" : ""}>${m.label}</option>`).join("")}
      </select>
      <div class="muted" style="margin:12px 0 4px;">Axe X — regroupement</div>
      <select id="custom-x">
        ${X_DIMENSIONS.map(d => `<option value="${d.key}" ${state.customX === d.key ? "selected" : ""}>${d.label}</option>`).join("")}
      </select>
      <div id="custom-scope-wrap"></div>
      <canvas id="custom-canvas" height="240" style="margin-top:14px;"></canvas>
      <p class="muted" id="custom-note" style="margin-top:8px;"></p>
    </div>
  `;

  content.querySelector("#custom-y").onchange = (e) => { state.customY = e.target.value; drawCustomView(content, allSets, exercises, exerciseNames, muscleGroups); };
  content.querySelector("#custom-x").onchange = (e) => { state.customX = e.target.value; drawCustomView(content, allSets, exercises, exerciseNames, muscleGroups); };

  const scopeWrap = content.querySelector("#custom-scope-wrap");
  if (state.customX === "week") {
    scopeWrap.innerHTML = `
      <div class="muted" style="margin:12px 0 4px;">Portée</div>
      <div class="chip-row" id="custom-scope-chips">
        <div class="chip ${state.customScope === "all" ? "active" : ""}" data-scope="all">Tout confondu</div>
        <div class="chip ${state.customScope === "exercise" ? "active" : ""}" data-scope="exercise">Un exercice</div>
        <div class="chip ${state.customScope === "muscle" ? "active" : ""}" data-scope="muscle">Un groupe</div>
      </div>
      <div id="custom-scope-picker" style="margin-top:8px;"></div>
    `;
    scopeWrap.querySelectorAll("#custom-scope-chips .chip").forEach(chip => {
      chip.onclick = () => {
        state.customScope = chip.dataset.scope;
        state.customScopeValue = null;
        drawCustomView(content, allSets, exercises, exerciseNames, muscleGroups);
      };
    });
    const pickerWrap = scopeWrap.querySelector("#custom-scope-picker");
    if (state.customScope === "exercise") {
      if (!state.customScopeValue) state.customScopeValue = exerciseNames[0] || null;
      pickerWrap.innerHTML = `<select id="custom-scope-value">${exerciseNames.map(n => `<option value="${n}" ${n === state.customScopeValue ? "selected" : ""}>${n}</option>`).join("")}</select>`;
      pickerWrap.querySelector("#custom-scope-value")?.addEventListener("change", (e) => {
        state.customScopeValue = e.target.value;
        renderCustomChart(content, allSets, exercises);
      });
    } else if (state.customScope === "muscle") {
      if (!state.customScopeValue) state.customScopeValue = muscleGroups[0] || null;
      pickerWrap.innerHTML = `<select id="custom-scope-value">${muscleGroups.map(g => `<option value="${g}" ${g === state.customScopeValue ? "selected" : ""}>${g}</option>`).join("")}</select>`;
      pickerWrap.querySelector("#custom-scope-value")?.addEventListener("change", (e) => {
        state.customScopeValue = e.target.value;
        renderCustomChart(content, allSets, exercises);
      });
    } else {
      pickerWrap.innerHTML = "";
    }
  } else {
    scopeWrap.innerHTML = "";
  }

  renderCustomChart(content, allSets, exercises);
}

function renderCustomChart(content, allSets, exercises) {
  const canvasEl = content.querySelector("#custom-canvas");
  const noteEl = content.querySelector("#custom-note");
  if (chartCustom) { chartCustom.destroy(); chartCustom = null; }

  let filtered = allSets.filter(s => inPeriod(s.workout_start_time, state.periodWeeks) && s.set_type !== "warmup");

  const yMetric = Y_METRICS.find(m => m.key === state.customY);
  let labels = [];
  let values = [];
  let chartType = "bar";
  let note = "";

  if (state.customX === "week") {
    if (state.customScope === "exercise" && state.customScopeValue) {
      filtered = filtered.filter(s => s.exercise_title === state.customScopeValue);
      note = `Portée : ${state.customScopeValue}`;
    } else if (state.customScope === "muscle" && state.customScopeValue) {
      filtered = filtered.filter(s => muscleGroupOf(s.exercise_title, exercises) === state.customScopeValue);
      note = `Portée : ${state.customScopeValue}`;
    } else {
      note = "Portée : tous les exercices confondus";
    }
    const byWeek = {};
    filtered.forEach(s => {
      const wk = isoWeek(s.workout_start_time);
      (byWeek[wk] = byWeek[wk] || []).push(s);
    });
    labels = Object.keys(byWeek).sort();
    values = labels.map(w => aggregate(byWeek[w], state.customY));
    chartType = "line";
  } else if (state.customX === "exercise") {
    const byExercise = {};
    filtered.forEach(s => { (byExercise[s.exercise_title] = byExercise[s.exercise_title] || []).push(s); });
    let entries = Object.entries(byExercise).map(([name, arr]) => [name, aggregate(arr, state.customY)]);
    entries = entries.filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
    if (entries.length > 20) { note = `${entries.length} exercices — 20 premiers affichés`; entries = entries.slice(0, 20); }
    labels = entries.map(e => e[0]);
    values = entries.map(e => e[1]);
    chartType = "bar";
  } else {
    const byMuscle = {};
    filtered.forEach(s => {
      const g = muscleGroupOf(s.exercise_title, exercises);
      (byMuscle[g] = byMuscle[g] || []).push(s);
    });
    let entries = Object.entries(byMuscle).map(([name, arr]) => [name, aggregate(arr, state.customY)]);
    entries = entries.filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
    labels = entries.map(e => e[0]);
    values = entries.map(e => e[1]);
    chartType = "bar";
  }

  noteEl.textContent = note;

  if (!labels.length) {
    canvasEl.replaceWith(Object.assign(document.createElement("p"), { className: "muted", textContent: "Pas de donnée pour cette combinaison." }));
    return;
  }

  chartCustom = new Chart(canvasEl, {
    type: chartType,
    data: {
      labels,
      datasets: [{
        label: yMetric.label,
        data: values,
        borderColor: "#FFB020",
        backgroundColor: chartType === "bar" ? "#FFB020" : "transparent",
        borderRadius: chartType === "bar" ? 4 : 0,
        tension: 0.25
      }]
    },
    options: chartOptions(false)
  });
}

function chartOptions(showLegend, legendLabels = false) {
  return {
    responsive: true,
    plugins: { legend: { display: showLegend, labels: { color: "#F1EFEA" } } },
    scales: {
      x: { ticks: { color: "#8B8D96" }, grid: { display: false } },
      y: { ticks: { color: "#8B8D96" }, grid: { color: "#2C2C36" } }
    }
  };
}

export function invalidateStatsCache() {
  invalidate("sets");
}
