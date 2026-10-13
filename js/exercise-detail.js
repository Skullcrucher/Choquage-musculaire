// ============================================================
// FICHE D'EXERCICE — muscles, conseils, vidéo, historique
// ============================================================
import { openModal, closeModal, estimate1RM, rmBest, rmOf, rmByKey, isoWeek, fmtDateTime, fmtDate, esc, healthNoteHtml, statsAppOnly, toast } from "./utils.js";
import { getSetsForExercise, getWorkouts } from "./cache.js";
import { EXERCISE_GUIDES } from "./exercise-guides.js";
import { t, tn, getLang } from "./i18n.js";
import { exerciseTrend, trendBadgeHtml, trendDetail } from "./trend.js";

let detailChart = null;

// Vocabulaire des fiches (exercise-guides.js), traduit à l'affichage.
// i18n-keys: "Abdominaux", "Avant-bras", "Bas du dos", "Biceps", "Fessiers", "Grand dorsal", "Ischio-jambiers", "Milieu du dos", "Mollets", "Pectoraux", "Quadriceps", "Trapèzes", "Triceps", "Épaules"
// i18n-keys: "Autre", "Barre EZ", "Barre", "Haltère", "Machine", "Poids du corps", "Poulie", "Avancé", "Débutant", "Intermédiaire", "Isolation", "Polyarticulaire"
// i18n-keys: "Aux haltères : contrôle la phase excentrique, ne laisse pas les charges tomber.", "Mouvement d'isolation : concentre-toi sur la connexion muscle-esprit et un tempo contrôlé."
// i18n-keys: "Mouvement polyarticulaire : privilégie une technique stricte et une surcharge progressive plutôt que le poids maximal.", "À la barre : verrouille le gainage avant chaque répétition."
// i18n-keys: "À la poulie : garde une tension constante sur le muscle, évite de relâcher en fin de mouvement."

// onClose : appelé à la fermeture (ex. rouvrir la séance d'où l'on vient).
// Séries regroupées par séance (la plus récente d'abord), avec la
// meilleure série (la plus lourde, RM de Lombardi) de chacune.
function sessionsOf(sets) {
  const by = new Map();
  sets.forEach(s => {
    const id = s.workout_id || s.workout_start_time;
    if (!by.has(id)) by.set(id, { id, start: s.workout_start_time, sets: [] });
    by.get(id).sets.push(s);
  });
  return [...by.values()].map(x => ({ ...x, best: rmBest(x.sets)?.set || x.sets.reduce((b, s) => (s.weight_kg || 0) > (b.weight_kg || 0) ? s : b) }))
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

export async function openExerciseDetail(exerciseName, muscleGroupFallback = "", { onClose = null } = {}) {
  const guide = EXERCISE_GUIDES[exerciseName];
  const [rawSets, allSets] = await Promise.all([getSetsForExercise(exerciseName), getSetsForExercise(exerciseName, { raw: true })]);
  // Exercice unilatéral : séries importées hors statistiques (saisie inconnue).
  // Charges aberrantes (faute de frappe) : hors stats, signalées pour correction.
  const { isAbsurdKg } = await import("./sanity.js");
  const absurdSets = allSets.filter(s => isAbsurdKg(exerciseName, s.weight_kg));
  // (les séries des tests REP MAX sont hors stats par principe, pas « exclues »)
  const excluded = allSets.filter(s => !s.rm_test).length - rawSets.length - absurdSets.filter(s => !s.rm_test).length;
  const trend = exerciseTrend(rawSets);
  const sets = rawSets
    .filter(s => s.weight_kg != null && s.reps != null)
    .sort((a, b) => new Date(b.workout_start_time || 0) - new Date(a.workout_start_time || 0));

  const best1RM = rmOf(sets) || null;
  // Recherche de vidéos dans la langue de l'app (nom anglais de la fiche si dispo).
  const videoName = getLang() !== "fr" && guide?.en ? guide.en : exerciseName;
  const videoQuery = encodeURIComponent(`${videoName} ${t("exercice musculation technique")}`);
  const videoUrl = `https://www.youtube.com/results?search_query=${videoQuery}`;

  const modal = openModal(`
    ${onClose ? `<button class="btn btn-secondary btn-sm" id="detail-back" style="margin-bottom:8px; width:auto;">← ${t("Retour à la séance")}</button>` : ""}
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
      <div class="rm-line" id="detail-rm"></div>
      ${absurdSets.length ? `<div class="kg-absurd">⚠️ ${tn(absurdSets.length, "{n} série avec une charge incohérente est ignorée :", "{n} séries avec une charge incohérente sont ignorées :", {})}
        ${absurdSets.slice(0, 5).map(s => `<button type="button" class="chip chip-sm" data-ex-w="${esc(s.workout_id)}">${esc(String(s.weight_kg).replace(".", ","))} kg × ${esc(s.reps ?? "—")} · ${esc(fmtDateTime(s.workout_start_time))} ✏️</button>`).join("")}
        <span class="muted" style="font-size:12px;">${t("Touche pour ouvrir la séance, puis « Modifier la séance » pour corriger.")}</span></div>` : ""}
      ${excluded > 0 && statsAppOnly() ? `<p class="muted" style="font-size:12px; margin:0 0 8px;">📥 ${tn(excluded, "{n} série importée n'est pas comptée (Réglages : statistiques sur les séances Skullcrusher uniquement).", "{n} séries importées ne sont pas comptées (Réglages : statistiques sur les séances Skullcrusher uniquement).")}</p>` : ""}
      ${excluded > 0 && !statsAppOnly() ? `<p class="muted" style="font-size:12px; margin:0 0 8px;">↔ ${tn(excluded, "{n} série importée n'est pas comptée : exercice unilatéral, on ne sait pas si elle était notée par côté ou au total.", "{n} séries importées ne sont pas comptées : exercice unilatéral, on ne sait pas si elles étaient notées par côté ou au total.")} ${t("Pour les inclure, active G|D en séance et indique comment elles étaient notées.")}</p>` : ""}
      ${trend ? `<div class="trend-line trend-line-${trend.status}">${trendBadgeHtml(trend, { label: true })}<span>${esc(trendDetail(trend))} · ${tn(trend.sessions, "{n} séance ce mois-ci", "{n} séances ce mois-ci")}</span></div>`
        : sets.length ? `<p class="muted" style="font-size:13px; margin:0 0 8px;">${t("Tendance sur 30 jours : pas assez de séances récentes.")}</p>` : ""}
      ${sets.length ? `
        <div class="stat-grid" style="grid-template-columns: repeat(2,1fr);">
          <div class="stat-box"><span class="num">${sets.length}</span><span class="lbl">${t("séries loggées")}</span></div>
          <div class="stat-box"><span class="num">${best1RM ?? "—"}</span><span class="lbl">${t("RM Lombardi (kg)")}</span></div>
        </div>
        <canvas id="detail-chart" height="160"></canvas>
        ${healthNoteHtml()}
        <div class="muted" style="margin:14px 0 4px;">${t("Séances avec cet exercice")}</div>
        <div id="ex-sessions">
          ${sessionsOf(sets).slice(0, 12).map(x => `
            <div class="list-row" data-ex-w="${esc(x.id)}" role="button" style="cursor:pointer;">
              <div><div class="list-row-title" data-ex-wtitle="${esc(x.id)}">${fmtDateTime(x.start)}</div>
                <div class="list-row-sub">${tn(x.sets.length, "{n} série", "{n} séries")} · ${t("meilleure : {kg} kg × {reps}", { kg: esc(x.best.weight_kg), reps: esc(x.best.reps) })}${x.best.unilateral ? ` ${t("/côté")}` : ""}</div></div>
              <div class="list-row-meta">${estimate1RM(x.best.weight_kg, x.best.reps) ? `${estimate1RM(x.best.weight_kg, x.best.reps)} kg ` : ""}›</div>
            </div>
          `).join("")}
        </div>
      ` : `<p class="muted">${t("Pas encore de série enregistrée pour cet exercice.")}</p>`}
    </div>

    ${sets.length ? `<button class="btn btn-primary share-btn" id="detail-share" style="margin-top:16px;">📸 ${t("Partager ma progression")}</button>` : ""}
    <button class="btn btn-secondary" id="detail-close" style="margin-top:10px;">${t("Fermer")}</button>
  `, (modalEl) => {
    modalEl.querySelector("#detail-close").onclick = () => { closeModal(); if (onClose) onClose(); };
    const back = modalEl.querySelector("#detail-back");
    if (back) back.onclick = () => { closeModal(); onClose(); };
    const shareBtn = modalEl.querySelector("#detail-share");
    if (shareBtn) shareBtn.onclick = async () => { closeModal(); (await import("./share-card.js")).openShareCard({ kind: "exercise", exercise: exerciseName }); };
    if (sets.length) renderDetailChart(modalEl, sets);
    // RM : testée (séance REP MAX) ou d'après l'historique, et charges proposées.
    import("./rep-max.js").then(async rmMod => {
      const [test, ref] = await Promise.all([rmMod.repMaxFor(exerciseName), rmMod.referenceRm(exerciseName, sets)]);
      const el = modalEl.querySelector("#detail-rm");
      if (!el || !ref) return;
      const hist = rmBest(sets);
      const day = (d) => fmtDate(d + "T12:00", { year: undefined });
      el.innerHTML = `
        <div class="rm-main"><span class="rm-big">${esc(ref.rm)} kg</span><span class="muted">${t("RM de référence")} · ${ref.source === "test" ? t("test du {date}", { date: esc(day(ref.date)) }) : t("historique")}</span></div>
        <div class="muted rm-sub">
          ${test ? `🏆 ${t("Test REP MAX ({method}) : {rm} kg — {kg} kg × {reps}, le {date}", { method: esc(rmMod.methodName(test.method)), rm: esc(test.rm), kg: esc(test.kg), reps: esc(test.reps), date: esc(day(test.date)) })}<br>` : ""}
          ${hist ? `📈 ${t("Historique : {rm} kg — série la plus lourde {kg} kg × {reps}", { rm: esc(hist.rm), kg: esc(hist.kg), reps: esc(hist.reps) })}<br>` : ""}
          ${t("Charges proposées")} : ${[3, 5, 8, 10].map(r => `${r} ${t("reps")} → <b>${esc(rmMod.suggestKg(exerciseName, ref.rm, r))} kg</b>`).join(" · ")}
        </div>`;
    }).catch(e => console.warn("[Skullcrusher] RM", e));
    // Séances : titre, puis ouverture du détail au toucher.
    getWorkouts().then(ws => {
      const byId = new Map(ws.map(w => [w.id, w]));
      modalEl.querySelectorAll("[data-ex-wtitle]").forEach(el => {
        const w = byId.get(el.dataset.exWtitle);
        if (w) el.textContent = `${w.title || t("Séance")} · ${fmtDateTime(w.start_time)}`;
      });
      modalEl.querySelectorAll("[data-ex-w]").forEach(row => row.onclick = async () => {
        const w = byId.get(row.dataset.exW);
        if (!w) { toast(t("Séance introuvable")); return; }
        closeModal();
        (await import("./workout-detail.js")).openWorkoutDetail(w, () => {});
      });
    }).catch(() => null);
  });
}

function renderDetailChart(modalEl, sets) {
  // RM de Lombardi par semaine : série la plus lourde de la semaine.
  const perWeek = rmByKey(sets, s => isoWeek(s.workout_start_time));
  const weeks = Object.keys(perWeek).sort();
  const canvasEl = modalEl.querySelector("#detail-chart");
  if (!canvasEl || weeks.length < 2) return; // pas assez de points pour une courbe utile
  if (detailChart) { detailChart.destroy(); detailChart = null; }
  detailChart = new Chart(canvasEl, {
    type: "line",
    data: {
      labels: weeks,
      datasets: [{ label: t("RM Lombardi (kg)"), data: weeks.map(w => perWeek[w]), borderColor: "#E02424", backgroundColor: "transparent", tension: 0.25 }]
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
