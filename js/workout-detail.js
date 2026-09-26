// ============================================================
// DÉTAIL D'UNE SÉANCE — modale partagée entre Historique et Feed
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, fmtDateTime, fmtDuration, estimate1RM, toast, esc } from "./utils.js";
import { getUser } from "./auth.js";
import { invalidate, getWorkouts } from "./cache.js";
import { songBlockHtml, bindSongLinks, spotifyEmbed, parseSpotify } from "./music.js";
import { t } from "./i18n.js";
import { getBody, workoutCalories, EFFORTS } from "./calories.js";

// Type de série affiché (la valeur stockée reste "warmup", "dropset"...).
// i18n-keys: "échauffement", "dégressive", "échec"
function setTypeLabel(type) {
  return t({ warmup: "échauffement", dropset: "dégressive", failure: "échec" }[type] || type);
}

// Records, son du record, playlist (lecteur) et bande-son de la séance.
function musicSectionHtml(w) {
  const records = Array.isArray(w.records) ? w.records : [];
  const tracks = Array.isArray(w.soundtrack?.tracks) ? w.soundtrack.tracks : [];
  const playlist = w.soundtrack?.playlist_url;
  if (!records.length && !tracks.length && !playlist) return "";
  return `
    <div class="feed-music" style="margin-bottom:14px;">
      ${records.map(r => `<div>🏆 <b>${esc(r.exercise)}</b> — ${esc(r.kg)} kg × ${esc(r.reps)} <span class="muted">(1RM ${esc(r.one_rm)} kg, +${esc(Math.round((r.one_rm - r.prev_one_rm) * 10) / 10)} kg)</span></div>`).join("")}
      ${records.length && w.record_song ? `<div>🎵 ${t("Porté par :")}</div>${songBlockHtml(w.record_song)}` : ""}
      ${playlist ? spotifyEmbed(playlist, 152) : ""}
      ${tracks.length ? `<div class="muted" style="margin-top:8px;">🎶 ${t("Bande-son de la séance")}</div>
        ${tracks.map(tr => parseSpotify(tr.url) ? spotifyEmbed(tr.url, 80) : "").join("")}` : ""}
    </div>`;
}

// Noms cliquables des amis cités dans la séance.
export function partnersHtml(uids, profiles, myUid) {
  if (!uids?.length) return "";
  return uids.map(uid => `<span class="profile-link" data-profile="${esc(uid)}">${esc(uid === myUid ? t("toi") : profiles[uid]?.display_name || t("Un ami"))}</span>`).join(", ");
}

function caloriesHtml(w, body) {
  const c = workoutCalories(w, body);
  if (!c) return "";
  return c.source === "watch"
    ? `🔥 ${t("{kcal} kcal (montre)", { kcal: c.kcal })}`
    : `🔥 ${t("≈ {kcal} kcal ({low}–{high}) · effort {effort}", { kcal: c.kcal, low: c.low, high: c.high, effort: t(EFFORTS[c.effort].label).toLowerCase() })}`;
}

// Ma séance du même jour, pour la lier à celle d'un ami qui m'a cité.
async function myWorkoutSameDay(workout) {
  const day = new Date(workout.start_time).toDateString();
  const mine = (await getWorkouts()).filter(w => w.start_time && new Date(w.start_time).toDateString() === day);
  const start = Date.parse(workout.start_time);
  return mine.sort((a, b) => Math.abs(Date.parse(a.start_time) - start) - Math.abs(Date.parse(b.start_time) - start))[0] || null;
}

export async function openWorkoutDetail(workout, onDeleted) {
  const myUid = getUser()?.uid;
  const isOwner = !workout.owner_uid || workout.owner_uid === myUid;
  const partners = Array.isArray(workout.partners) ? workout.partners : [];
  const isPartner = !isOwner && partners.includes(myUid);
  const [profiles, body, friendUids] = await Promise.all([
    partners.length || isOwner ? db.getProfiles([...partners, workout.owner_uid].filter(Boolean)).catch(() => ({})) : {},
    isOwner ? getBody() : null,
    isOwner ? db.listFriendUids().catch(() => []) : []
  ]);
  const friendProfiles = isOwner && friendUids.length ? await db.getProfiles(friendUids).catch(() => ({})) : {};
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
    <p class="muted" id="partners-line" style="margin-top:-6px;${partners.length ? "" : " display:none;"}">🤝 ${t("Avec")} ${partnersHtml(partners, profiles, myUid)}</p>
    ${isOwner && caloriesHtml(workout, body) ? `<p class="muted" style="margin-top:-6px;">${caloriesHtml(workout, body)}</p>` : ""}
    ${musicSectionHtml(workout)}
    ${Object.entries(byExercise).map(([name, exSets]) => `
      <div style="margin-bottom:12px;">
        <div style="font-family:'Barlow Condensed',sans-serif; font-size:17px; margin-bottom:4px;">${esc(name)}</div>
        ${exSets.sort((a, b) => a.set_index - b.set_index).map(s => `
          <div class="muted" style="display:flex; justify-content:space-between; padding:3px 0;">
            <span>${t("Série {n}", { n: esc(s.set_index) })} ${s.set_type !== "normal" ? "· " + esc(setTypeLabel(s.set_type)) : ""}</span>
            <span>${esc(s.weight_kg ?? "—")} kg × ${esc(s.reps ?? "—")}${s.weight_kg && s.reps ? ` (1RM ${estimate1RM(s.weight_kg, s.reps)} kg)` : ""}</span>
          </div>
        `).join("")}
      </div>
    `).join("") || `<p class="muted">${t("Aucune série enregistrée.")}</p>`}
    ${isOwner && friendUids.length ? `
      <button class="btn btn-secondary btn-sm" id="edit-partners" style="margin-top:6px;">🤝 ${t("Entraîné avec…")}</button>
      <div id="partners-picker" style="display:none; margin-top:8px;">
        <div class="chip-row" style="margin-bottom:6px;">
          ${friendUids.map(uid => `<div class="chip ${partners.includes(uid) ? "active" : ""}" data-partner="${esc(uid)}">${esc(friendProfiles[uid]?.display_name || t("Un ami"))}</div>`).join("")}
        </div>
        <button class="btn btn-primary btn-sm" id="save-partners">${t("Enregistrer")}</button>
      </div>
    ` : ""}
    ${isPartner ? `
      <p class="muted" style="margin:10px 0 6px;">${t("{name} t'a cité dans cette séance.", { name: esc(workout.owner_name || profiles[workout.owner_uid]?.display_name || t("Un ami")) })}</p>
      <div class="btn-row">
        <button class="btn btn-secondary btn-sm" id="link-mine">🤝 ${t("Lier ma séance")}</button>
        <button class="btn btn-secondary btn-sm" id="leave-workout">${t("Me retirer")}</button>
      </div>
    ` : ""}
    ${isOwner ? `
      <p class="muted" id="share-status" style="margin:10px 0 6px;">${workout.shared ? t("🌍 Partagée sur le feed") : t("🔒 Privée — visible par toi seul")}</p>
      <button class="btn btn-secondary" id="toggle-share">${workout.shared ? t("Retirer du feed") : t("Partager sur le feed")}</button>
    ` : ""}
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-secondary" id="close-detail">${t("Fermer")}</button>
      ${isOwner ? `<button class="btn btn-danger" id="del-workout">${t("Supprimer")}</button>` : ""}
    </div>
  `, (modalEl) => {
    modalEl.querySelector("#close-detail").onclick = closeModal;
    const bindProfiles = () => modalEl.querySelectorAll("[data-profile]").forEach(el => el.onclick = async () => {
      closeModal();
      (await import("./profile.js")).openProfile(el.dataset.profile);
    });
    bindProfiles();
    const editBtn = modalEl.querySelector("#edit-partners");
    if (editBtn) {
      const picker = modalEl.querySelector("#partners-picker");
      editBtn.onclick = () => { picker.style.display = picker.style.display === "none" ? "block" : "none"; };
      picker.querySelectorAll("[data-partner]").forEach(c => c.onclick = () => c.classList.toggle("active"));
      modalEl.querySelector("#save-partners").onclick = async (e) => {
        e.target.disabled = true;
        const uids = [...picker.querySelectorAll("[data-partner].active")].map(c => c.dataset.partner);
        try {
          await db.setWorkoutPartners(workout.id, uids);
          workout.partners = uids;
          invalidate("workouts");
          const line = modalEl.querySelector("#partners-line");
          line.innerHTML = `🤝 ${t("Avec")} ${partnersHtml(uids, { ...profiles, ...friendProfiles }, myUid)}`;
          line.style.display = uids.length ? "" : "none";
          bindProfiles();
          picker.style.display = "none";
          toast(t("Partenaires enregistrés"));
        } catch (err) {
          console.error("[Skullcrusher] Partenaires", err);
          toast(t("Action impossible, réessaie"));
        }
        e.target.disabled = false;
      };
    }
    const linkBtn = modalEl.querySelector("#link-mine");
    if (linkBtn) linkBtn.onclick = async () => {
      linkBtn.disabled = true;
      try {
        const mine = await myWorkoutSameDay(workout);
        if (!mine) { toast(t("Tu n'as pas de séance enregistrée ce jour-là."), 3000); linkBtn.disabled = false; return; }
        await db.addWorkoutPartner(mine.id, workout.owner_uid);
        invalidate("workouts");
        toast(t("Ta séance « {title} » est liée", { title: mine.title }), 3000);
      } catch (err) {
        console.error("[Skullcrusher] Lier ma séance", err);
        toast(t("Action impossible, réessaie"));
        linkBtn.disabled = false;
      }
    };
    const leaveBtn = modalEl.querySelector("#leave-workout");
    if (leaveBtn) leaveBtn.onclick = async () => {
      if (!confirm(t("Te retirer de cette séance ? Tu ne la verras plus, sauf si elle est partagée sur le feed."))) return;
      try {
        await db.leaveWorkout(workout.id);
        closeModal();
        if (onDeleted) await onDeleted();
      } catch (err) {
        console.error("[Skullcrusher] Se retirer", err);
        toast(t("Action impossible, réessaie"));
      }
    };
    bindSongLinks(modalEl);
    const shareBtn = modalEl.querySelector("#toggle-share");
    if (shareBtn) shareBtn.onclick = async () => {
      shareBtn.disabled = true;
      try {
        const next = !workout.shared;
        await db.setWorkoutShared(workout.id, next);
        workout.shared = next;
        invalidate("workouts");
        shareBtn.textContent = next ? t("Retirer du feed") : t("Partager sur le feed");
        modalEl.querySelector("#share-status").textContent = next ? t("🌍 Partagée sur le feed") : t("🔒 Privée — visible par toi seul");
        toast(next ? t("Séance partagée sur le feed") : t("Séance retirée du feed"));
      } catch (err) {
        console.error("[Skullcrusher] Erreur partage séance", err);
        toast(t("Impossible de modifier le partage"));
      }
      shareBtn.disabled = false;
    };
    const delBtn = modalEl.querySelector("#del-workout");
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm(t("Supprimer cette séance et toutes ses séries ?"))) return;
      await db.deleteWorkout(workout.id);
      invalidate("workouts");
      closeModal();
      if (onDeleted) await onDeleted();
    };
  });
}
