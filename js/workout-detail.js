// ============================================================
// DÉTAIL D'UNE SÉANCE — modale partagée entre Historique et Feed
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, fmtDateTime, fmtDuration, estimate1RM, toast, esc } from "./utils.js";
import { getUser } from "./auth.js";
import { invalidate } from "./cache.js";
import { songBlockHtml, bindSongLinks, spotifyEmbed, parseSpotify } from "./music.js";

// Records, son du record, playlist (lecteur) et bande-son de la séance.
function musicSectionHtml(w) {
  const records = Array.isArray(w.records) ? w.records : [];
  const tracks = Array.isArray(w.soundtrack?.tracks) ? w.soundtrack.tracks : [];
  const playlist = w.soundtrack?.playlist_url;
  if (!records.length && !tracks.length && !playlist) return "";
  return `
    <div class="feed-music" style="margin-bottom:14px;">
      ${records.map(r => `<div>🏆 <b>${esc(r.exercise)}</b> — ${esc(r.kg)} kg × ${esc(r.reps)} <span class="muted">(1RM ${esc(r.one_rm)} kg, +${esc(Math.round((r.one_rm - r.prev_one_rm) * 10) / 10)} kg)</span></div>`).join("")}
      ${records.length && w.record_song ? `<div>🎵 Porté par :</div>${songBlockHtml(w.record_song)}` : ""}
      ${playlist ? spotifyEmbed(playlist, 152) : ""}
      ${tracks.length ? `<div class="muted" style="margin-top:8px;">🎶 Bande-son de la séance</div>
        ${tracks.map(t => parseSpotify(t.url) ? spotifyEmbed(t.url, 80) : "").join("")}` : ""}
    </div>`;
}

export async function openWorkoutDetail(workout, onDeleted) {
  const isOwner = !workout.owner_uid || workout.owner_uid === getUser()?.uid;
  // N'affiche que les séries du propriétaire de la séance (quelqu'un d'autre
  // pourrait en théorie en créer dans la sous-collection).
  const sets = (await db.listSets(workout.id)).filter(s => !workout.owner_uid || s.owner_uid === workout.owner_uid);
  const byExercise = {};
  sets.forEach(s => {
    byExercise[s.exercise_title] = byExercise[s.exercise_title] || [];
    byExercise[s.exercise_title].push(s);
  });
  openModal(`
    <h3>${esc(workout.title)}</h3>
    <p class="muted" style="margin-top:-8px;">
      ${workout.owner_name && !isOwner ? `${esc(workout.owner_name)} · ` : ""}${fmtDateTime(workout.start_time)} · ${fmtDuration(workout.start_time, workout.end_time)}
    </p>
    ${musicSectionHtml(workout)}
    ${Object.entries(byExercise).map(([name, exSets]) => `
      <div style="margin-bottom:12px;">
        <div style="font-family:'Barlow Condensed',sans-serif; font-size:17px; margin-bottom:4px;">${esc(name)}</div>
        ${exSets.sort((a, b) => a.set_index - b.set_index).map(s => `
          <div class="muted" style="display:flex; justify-content:space-between; padding:3px 0;">
            <span>Série ${esc(s.set_index)} ${s.set_type !== "normal" ? "· " + esc(s.set_type) : ""}</span>
            <span>${esc(s.weight_kg ?? "—")} kg × ${esc(s.reps ?? "—")}${s.weight_kg && s.reps ? ` (1RM ${estimate1RM(s.weight_kg, s.reps)} kg)` : ""}</span>
          </div>
        `).join("")}
      </div>
    `).join("") || `<p class="muted">Aucune série enregistrée.</p>`}
    ${isOwner ? `
      <p class="muted" id="share-status" style="margin:10px 0 6px;">${workout.shared ? "🌍 Partagée sur le feed" : "🔒 Privée — visible par toi seul"}</p>
      <button class="btn btn-secondary" id="toggle-share">${workout.shared ? "Retirer du feed" : "Partager sur le feed"}</button>
    ` : ""}
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-secondary" id="close-detail">Fermer</button>
      ${isOwner ? `<button class="btn btn-danger" id="del-workout">Supprimer</button>` : ""}
    </div>
  `, (modalEl) => {
    modalEl.querySelector("#close-detail").onclick = closeModal;
    bindSongLinks(modalEl);
    const shareBtn = modalEl.querySelector("#toggle-share");
    if (shareBtn) shareBtn.onclick = async () => {
      shareBtn.disabled = true;
      try {
        const next = !workout.shared;
        await db.setWorkoutShared(workout.id, next);
        workout.shared = next;
        invalidate("workouts");
        shareBtn.textContent = next ? "Retirer du feed" : "Partager sur le feed";
        modalEl.querySelector("#share-status").textContent = next ? "🌍 Partagée sur le feed" : "🔒 Privée — visible par toi seul";
        toast(next ? "Séance partagée sur le feed" : "Séance retirée du feed");
      } catch (err) {
        console.error("[Skullcrusher] Erreur partage séance", err);
        toast("Impossible de modifier le partage");
      }
      shareBtn.disabled = false;
    };
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
