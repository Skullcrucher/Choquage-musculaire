// ============================================================
// FICHE D'EXERCICE — muscles, conseils, vidéo, historique
// ============================================================
import { openModal, closeModal, estimate1RM, isoWeek, fmtDateTime, esc } from "./utils.js";
import { getAllSets } from "./cache.js";
import { EXERCISE_GUIDES } from "./exercise-guides.js";

let detailChart = null;

export async function openExerciseDetail(exerciseName, muscleGroupFallback = "") {
  const guide = EXERCISE_GUIDES[exerciseName];
  const allSets = await getAllSets();
  const sets = allSets
    .filter(s => s.exercise_title === exerciseName && s.weight_kg != null && s.reps != null)
    .sort((a, b) => new Date(b.workout_start_time || 0) - new Date(a.workout_start_time || 0));

  const best1RM = sets.length ? Math.max(...sets.map(s => estimate1RM(s.weight_kg, s.reps))) : null;
  const videoQuery = encodeURIComponent(`${exerciseName} exercice musculation technique`);
  const videoUrl = `https://www.youtube.com/results?search_query=${videoQuery}`;

  const modal = openModal(`
    <h3 style="margin-bottom:2px;">${esc(exerciseName)}</h3>
    <div class="chip-row" style="margin-top:6px;">
      ${guide ? `<div class="chip" style="pointer-events:none;">${guide.equipment}</div>` : (muscleGroupFallback ? `<div class="chip" style="pointer-events:none;">${esc(muscleGroupFallback)}</div>` : "")}
      ${guide?.level ? `<div class="chip" style="pointer-events:none;">${guide.level}</div>` : ""}
      ${guide?.mechanic ? `<div class="chip" style="pointer-events:none;">${guide.mechanic}</div>` : ""}
    </div>

    ${guide ? `
      <div style="margin-top:14px;">
        <div class="muted" style="margin-bottom:5px;">Muscles sollicités</div>
        <div class="chip-row">
          ${guide.primaryMuscles.map(m => `<div class="chip active" style="pointer-events:none;">${m}</div>`).join("")}
          ${guide.secondaryMuscles.map(m => `<div class="chip" style="pointer-events:none;">${m}</div>`).join("")}
        </div>
      </div>
      ${guide.tips.length ? `
        <div style="margin-top:14px;">
          <div class="muted" style="margin-bottom:5px;">Conseils</div>
          ${guide.tips.map(t => `<p style="margin:4px 0; font-size:14px;">• ${t}</p>`).join("")}
        </div>
      ` : ""}
    ` : `
      <p class="muted" style="margin-top:14px;">${muscleGroupFallback ? `Groupe musculaire : ${esc(muscleGroupFallback)}.` : ""} Pas de fiche détaillée disponible pour cet exercice.</p>
    `}

    <a href="${videoUrl}" target="_blank" rel="noopener" class="btn btn-secondary" style="margin-top:14px; text-decoration:none;">▶ Voir des vidéos explicatives</a>

    <div style="margin-top:18px;">
      <div class="muted" style="margin-bottom:5px;">Historique</div>
      ${sets.length ? `
        <div class="stat-grid" style="grid-template-columns: repeat(2,1fr);">
          <div class="stat-box"><span class="num">${sets.length}</span><span class="lbl">séries loggées</span></div>
          <div class="stat-box"><span class="num">${best1RM}</span><span class="lbl">1RM estimée (kg)</span></div>
        </div>
        <canvas id="detail-chart" height="160"></canvas>
        <div style="margin-top:10px;">
          ${sets.slice(0, 6).map(s => `
            <div class="list-row" style="cursor:default;">
              <div class="list-row-sub">${fmtDateTime(s.workout_start_time)}</div>
              <div class="list-row-meta">${s.weight_kg} kg × ${s.reps}</div>
            </div>
          `).join("")}
        </div>
      ` : `<p class="muted">Pas encore de série enregistrée pour cet exercice.</p>`}
    </div>

    <button class="btn btn-secondary" id="detail-close" style="margin-top:16px;">Fermer</button>
  `, (modalEl) => {
    modalEl.querySelector("#detail-close").onclick = closeModal;
    if (sets.length) renderDetailChart(modalEl, sets);
  });
}

function renderDetailChart(modalEl, sets) {
  const perWeek = {};
  [...sets].reverse().forEach(s => {
    const wk = isoWeek(s.workout_start_time);
    const oneRM = estimate1RM(s.weight_kg, s.reps);
    if (!perWeek[wk] || oneRM > perWeek[wk]) perWeek[wk] = oneRM;
  });
  const weeks = Object.keys(perWeek).sort();
  const canvasEl = modalEl.querySelector("#detail-chart");
  if (!canvasEl || weeks.length < 2) return; // pas assez de points pour une courbe utile
  if (detailChart) { detailChart.destroy(); detailChart = null; }
  detailChart = new Chart(canvasEl, {
    type: "line",
    data: {
      labels: weeks,
      datasets: [{ label: "1RM estimée (kg)", data: weeks.map(w => perWeek[w]), borderColor: "#FFB020", backgroundColor: "transparent", tension: 0.25 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8B8D96" }, grid: { display: false } },
        y: { ticks: { color: "#8B8D96" }, grid: { color: "#2C2C36" } }
      }
    }
  });
}
