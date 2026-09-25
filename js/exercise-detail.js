// ============================================================
// FICHE D'EXERCICE — muscles, conseils, vidéo, historique
// ============================================================
import { openModal, closeModal, estimate1RM, isoWeek, fmtDateTime, esc } from "./utils.js";
import { getSetsForExercise } from "./cache.js";
import { EXERCISE_GUIDES } from "./exercise-guides.js";
import { t, getLang } from "./i18n.js";

let detailChart = null;

// Vocabulaire des fiches (exercise-guides.js), traduit à l'affichage.
// i18n-keys: "Abdominaux", "Avant-bras", "Bas du dos", "Biceps", "Fessiers", "Grand dorsal", "Ischio-jambiers", "Milieu du dos", "Mollets", "Pectoraux", "Quadriceps", "Trapèzes", "Triceps", "Épaules"
// i18n-keys: "Autre", "Barre EZ", "Barre", "Haltère", "Machine", "Poids du corps", "Poulie", "Avancé", "Débutant", "Intermédiaire", "Isolation", "Polyarticulaire"
// i18n-keys: "Aux haltères : contrôle la phase excentrique, ne laisse pas les charges tomber.", "Mouvement d'isolation : concentre-toi sur la connexion muscle-esprit et un tempo contrôlé."
// i18n-keys: "Mouvement polyarticulaire : privilégie une technique stricte et une surcharge progressive plutôt que le poids maximal.", "À la barre : verrouille le gainage avant chaque répétition."
// i18n-keys: "À la poulie : garde une tension constante sur le muscle, évite de relâcher en fin de mouvement."

export async function openExerciseDetail(exerciseName, muscleGroupFallback = "") {
  const guide = EXERCISE_GUIDES[exerciseName];
  const sets = (await getSetsForExercise(exerciseName))
    .filter(s => s.weight_kg != null && s.reps != null)
    .sort((a, b) => new Date(b.workout_start_time || 0) - new Date(a.workout_start_time || 0));

  const best1RM = sets.length ? Math.max(...sets.map(s => estimate1RM(s.weight_kg, s.reps))) : null;
  // Recherche de vidéos dans la langue de l'app (nom anglais de la fiche si dispo).
  const videoName = getLang() !== "fr" && guide?.en ? guide.en : exerciseName;
  const videoQuery = encodeURIComponent(`${videoName} ${t("exercice musculation technique")}`);
  const videoUrl = `https://www.youtube.com/results?search_query=${videoQuery}`;

  const modal = openModal(`
    <h3 style="margin-bottom:2px;">${esc(exerciseName)}</h3>
    <div class="chip-row" style="margin-top:6px;">
      ${guide ? `<div class="chip" style="pointer-events:none;">${t(guide.equipment)}</div>` : (muscleGroupFallback ? `<div class="chip" style="pointer-events:none;">${esc(t(muscleGroupFallback))}</div>` : "")}
      ${guide?.level ? `<div class="chip" style="pointer-events:none;">${t(guide.level)}</div>` : ""}
      ${guide?.mechanic ? `<div class="chip" style="pointer-events:none;">${t(guide.mechanic)}</div>` : ""}
    </div>

    ${guide ? `
      <div style="margin-top:14px;">
        <div class="muted" style="margin-bottom:5px;">${t("Muscles sollicités")}</div>
        <div class="chip-row">
          ${guide.primaryMuscles.map(m => `<div class="chip active" style="pointer-events:none;">${t(m)}</div>`).join("")}
          ${guide.secondaryMuscles.map(m => `<div class="chip" style="pointer-events:none;">${t(m)}</div>`).join("")}
        </div>
      </div>
      ${guide.tips.length ? `
        <div style="margin-top:14px;">
          <div class="muted" style="margin-bottom:5px;">${t("Conseils")}</div>
          ${guide.tips.map(tip => `<p style="margin:4px 0; font-size:14px;">• ${t(tip)}</p>`).join("")}
        </div>
      ` : ""}
    ` : `
      <p class="muted" style="margin-top:14px;">${muscleGroupFallback ? t("Groupe musculaire : {g}.", { g: esc(t(muscleGroupFallback)) }) : ""} ${t("Pas de fiche détaillée disponible pour cet exercice.")}</p>
    `}

    <a href="${videoUrl}" target="_blank" rel="noopener" class="btn btn-secondary" style="margin-top:14px; text-decoration:none;">▶ ${t("Voir des vidéos explicatives")}</a>

    <div style="margin-top:18px;">
      <div class="muted" style="margin-bottom:5px;">${t("Historique")}</div>
      ${sets.length ? `
        <div class="stat-grid" style="grid-template-columns: repeat(2,1fr);">
          <div class="stat-box"><span class="num">${sets.length}</span><span class="lbl">${t("séries loggées")}</span></div>
          <div class="stat-box"><span class="num">${best1RM}</span><span class="lbl">${t("1RM estimée (kg)")}</span></div>
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
      ` : `<p class="muted">${t("Pas encore de série enregistrée pour cet exercice.")}</p>`}
    </div>

    <button class="btn btn-secondary" id="detail-close" style="margin-top:16px;">${t("Fermer")}</button>
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
      datasets: [{ label: t("1RM estimée (kg)"), data: weeks.map(w => perWeek[w]), borderColor: "#E02424", backgroundColor: "transparent", tension: 0.25 }]
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
