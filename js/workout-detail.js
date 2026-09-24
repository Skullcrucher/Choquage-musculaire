// ============================================================
// DÉTAIL D'UNE SÉANCE — modale partagée entre Historique et Feed
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, fmtDateTime, fmtDuration, estimate1RM } from "./utils.js";
import { getUser } from "./auth.js";
import { invalidate } from "./cache.js";

export async function openWorkoutDetail(workout, onDeleted) {
  const sets = await db.listSets(workout.id);
  const isOwner = !workout.owner_uid || workout.owner_uid === getUser()?.uid;
  const byExercise = {};
  sets.forEach(s => {
    byExercise[s.exercise_title] = byExercise[s.exercise_title] || [];
    byExercise[s.exercise_title].push(s);
  });
  openModal(`
    <h3>${workout.title}</h3>
    <p class="muted" style="margin-top:-8px;">
      ${workout.owner_name && !isOwner ? `${workout.owner_name} · ` : ""}${fmtDateTime(workout.start_time)} · ${fmtDuration(workout.start_time, workout.end_time)}
    </p>
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
      ${isOwner ? `<button class="btn btn-danger" id="del-workout">Supprimer</button>` : ""}
    </div>
  `, (modalEl) => {
    modalEl.querySelector("#close-detail").onclick = closeModal;
    const delBtn = modalEl.querySelector("#del-workout");
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm("Supprimer cette séance et toutes ses séries ?")) return;
      await db.deleteWorkout(workout.id);
      invalidate("workouts");
      closeModal();
      if (onDeleted) await onDeleted();
    };
  });
}
