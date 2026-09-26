// ============================================================
// DÉTAIL D'UNE SÉANCE — modale partagée entre Historique et Feed
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, fmtDateTime, fmtDuration, estimate1RM, toast, esc, attachAutocomplete } from "./utils.js";
import { getUser } from "./auth.js";
import { invalidate, getWorkouts, getExercises } from "./cache.js";
import { songBlockHtml, bindSongLinks, spotifyEmbed, parseSpotify, normalizePlaylistUrl, parseSongInput, SPOTIFY_ICON } from "./music.js";
import { t } from "./i18n.js";
import { getBody, workoutCalories, EFFORTS } from "./calories.js";
import { guessMuscleGroup } from "./muscles.js";

// Type de série affiché (la valeur stockée reste "warmup", "dropset"...).
// i18n-keys: "échauffement", "dégressive", "échec"
function setTypeLabel(type) {
  return t({ warmup: "échauffement", dropset: "dégressive", failure: "échec" }[type] || type);
}

// Records battus pendant la séance (onglet Gym).
function recordsHtml(w) {
  const records = Array.isArray(w.records) ? w.records : [];
  if (!records.length) return "";
  return `<div class="finish-records" style="margin:0 0 12px;">${records.map(r => `<div>🏆 <b>${esc(r.exercise)}</b> — ${esc(r.kg)} kg × ${esc(r.reps)} <span class="muted">(1RM ${esc(r.one_rm)} kg, +${esc(Math.round((r.one_rm - r.prev_one_rm) * 10) / 10)} kg)</span></div>`).join("")}</div>`;
}

const hasMusic = (w) => !!(w.record_song || w.soundtrack?.playlist_url || (w.soundtrack?.tracks || []).length);

// Onglet Musique : son du record, playlist (lecteur) et bande-son.
function musicPaneHtml(w) {
  const tracks = Array.isArray(w.soundtrack?.tracks) ? w.soundtrack.tracks : [];
  const playlist = w.soundtrack?.playlist_url;
  if (!hasMusic(w)) return `<p class="muted">${t("Pas de musique pour cette séance.")}</p>`;
  return `
    ${w.record_song ? `<div class="muted">🎵 ${t("Le son qui t'a porté")}${(w.records || []).length ? ` (${esc(w.records[0].exercise)})` : ""}</div>${songBlockHtml(w.record_song)}` : ""}
    ${playlist ? `<div class="muted" style="margin-top:10px;">🎧 ${t("Playlist de la séance")}</div>${spotifyEmbed(playlist, 152)}` : ""}
    ${tracks.length ? `<div class="muted" style="margin-top:10px;">🎶 ${t("Bande-son de la séance")}</div>
      ${tracks.map(tr => parseSpotify(tr.url) ? spotifyEmbed(tr.url, 80) : "").join("")}` : ""}`;
}

// Texte du champ « son » pour un morceau enregistré.
function songInputValue(song) {
  if (!song) return "";
  if (song.title) return song.artist ? `${song.title} - ${song.artist}` : song.title;
  return song.url || "";
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

// Ordre des exercices dans la séance (exercise_index, absent sur les
// anciennes séances), puis numéro de série.
const bySetOrder = (a, b) => (a.exercise_index ?? 999) - (b.exercise_index ?? 999) || a.set_index - b.set_index;

export async function openWorkoutDetail(workout, onDeleted, initialTab = "gym") {
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
  const sets = (await db.listSets(workout.id)).filter(s => !workout.owner_uid || s.owner_uid === workout.owner_uid)
    .sort(bySetOrder);
  const byExercise = {};
  sets.forEach(s => {
    byExercise[s.exercise_title] = byExercise[s.exercise_title] || [];
    byExercise[s.exercise_title].push(s);
  });
  const reopen = async (tab) => {
    const fresh = await db.getWorkout(workout.id).catch(() => null);
    closeModal();
    if (fresh) openWorkoutDetail(fresh, onDeleted, tab);
  };
  openModal(`
    <h3>${esc(workout.title)}</h3>
    <p class="muted" style="margin-top:-8px;">
      ${workout.owner_name && !isOwner ? `${esc(workout.owner_name)} · ` : ""}${fmtDateTime(workout.start_time)} · ${fmtDuration(workout.start_time, workout.end_time)}
    </p>
    <p class="muted" id="partners-line" style="margin-top:-6px;${partners.length ? "" : " display:none;"}">🤝 ${t("Avec")} ${partnersHtml(partners, profiles, myUid)}</p>
    ${isOwner && caloriesHtml(workout, body) ? `<p class="muted" style="margin-top:-6px;">${caloriesHtml(workout, body)}</p>` : ""}

    <div class="chip-row detail-tabs">
      <div class="chip ${initialTab === "gym" ? "active" : ""}" data-dtab="gym">🏋️ ${t("Gym")}</div>
      <div class="chip ${initialTab === "music" ? "active" : ""}" data-dtab="music">🎧 ${t("Musique")}${hasMusic(workout) ? " •" : ""}</div>
    </div>

    <div id="pane-gym" style="${initialTab === "gym" ? "" : "display:none;"}">
      ${recordsHtml(workout)}
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
      ${isOwner ? `<button class="btn btn-secondary" id="edit-workout">✏️ ${t("Modifier la séance")}</button>` : ""}
      ${isOwner && friendUids.length ? `
        <button class="btn btn-secondary btn-sm" id="edit-partners" style="margin-top:8px;">🤝 ${t("Entraîné avec…")}</button>
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
    </div>

    <div id="pane-music" style="${initialTab === "music" ? "" : "display:none;"}">
      ${musicPaneHtml(workout)}
      ${isOwner ? `
        <div class="card" style="padding:12px; margin-top:12px;">
          <label style="margin-top:0;">🎧 ${t("Playlist de la séance (facultatif)")}</label>
          <input id="mu-playlist" value="${esc(workout.soundtrack?.playlist_url || "")}" placeholder="https://open.spotify.com/playlist/…" inputmode="url">
          <label>🎵 ${t("Le son qui t'a porté")}</label>
          <input id="mu-song" value="${esc(songInputValue(workout.record_song))}" placeholder="${t("Titre - Artiste, ou lien Spotify du morceau")}">
          ${(workout.soundtrack?.tracks || []).length ? `<p class="muted spotify-attrib" style="font-size:12px; margin:6px 0 0;">${SPOTIFY_ICON} ${t("La bande-son Spotify ({n} morceaux) est conservée.", { n: workout.soundtrack.tracks.length })}</p>` : ""}
          <p id="mu-error" style="color:var(--red); min-height:1em; margin:4px 0;"></p>
          <button class="btn btn-primary btn-sm" id="mu-save">${t("Enregistrer la musique")}</button>
        </div>` : ""}
    </div>

    <div class="btn-row" style="margin-top:12px;">
      <button class="btn btn-secondary" id="close-detail">${t("Fermer")}</button>
      ${isOwner ? `<button class="btn btn-danger" id="del-workout">${t("Supprimer")}</button>` : ""}
    </div>
  `, (modalEl) => {
    modalEl.querySelector("#close-detail").onclick = closeModal;
    modalEl.querySelectorAll("[data-dtab]").forEach(chip => chip.onclick = () => {
      modalEl.querySelectorAll("[data-dtab]").forEach(c => c.classList.toggle("active", c === chip));
      modalEl.querySelector("#pane-gym").style.display = chip.dataset.dtab === "gym" ? "" : "none";
      modalEl.querySelector("#pane-music").style.display = chip.dataset.dtab === "music" ? "" : "none";
    });
    const bindProfiles = () => modalEl.querySelectorAll("[data-profile]").forEach(el => el.onclick = async () => {
      closeModal();
      (await import("./profile.js")).openProfile(el.dataset.profile);
    });
    bindProfiles();
    bindSongLinks(modalEl);

    const editWorkoutBtn = modalEl.querySelector("#edit-workout");
    if (editWorkoutBtn) editWorkoutBtn.onclick = () => openWorkoutEditor(workout, sets, body, () => reopen("gym"), () => reopen("gym"));

    const muSave = modalEl.querySelector("#mu-save");
    if (muSave) muSave.onclick = async () => {
      const err = modalEl.querySelector("#mu-error");
      const rawPlaylist = modalEl.querySelector("#mu-playlist").value.trim();
      const playlist = normalizePlaylistUrl(rawPlaylist);
      if (rawPlaylist && !playlist) { err.textContent = t("Lien de playlist Spotify invalide (open.spotify.com/playlist/…)."); return; }
      const songInput = modalEl.querySelector("#mu-song").value.trim();
      let song = workout.record_song || null;
      if (songInput !== songInputValue(workout.record_song)) {
        song = songInput ? parseSongInput(songInput) : null;
        if (songInput && !song) { err.textContent = t("Morceau : écris « Titre - Artiste » ou colle un lien Spotify de titre."); return; }
        if (song && /[<>]/.test((song.title || "") + (song.artist || ""))) { err.textContent = t("Les caractères < et > ne sont pas autorisés."); return; }
      }
      const tracks = workout.soundtrack?.tracks || [];
      muSave.disabled = true;
      try {
        await db.updateWorkout(workout.id, {
          record_song: song,
          soundtrack: playlist || tracks.length ? { playlist_url: playlist || "", tracks } : null
        });
        invalidate("workouts");
        toast(t("Musique enregistrée"));
        reopen("music");
      } catch (e) {
        console.error("[Skullcrusher] Musique de la séance", e);
        err.textContent = t("Enregistrement impossible, réessaie.");
        muSave.disabled = false;
      }
    };

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

// ---------- Modification d'une séance terminée ----------
const SET_TYPES = ["normal", "warmup", "dropset", "failure"];
// i18n-keys: "normale"
const setTypeShort = (type) => type === "normal" ? t("normale") : setTypeLabel(type);

function toLocalInput(iso) {
  const d = new Date(iso || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function openWorkoutEditor(workout, sets, body, onSaved, onCancel) {
  const library = await getExercises().catch(() => []);
  const names = library.map(e => e.name);
  const order = [];
  const groups = new Map();
  [...sets].sort(bySetOrder).forEach(s => {
    if (!groups.has(s.exercise_title)) { groups.set(s.exercise_title, []); order.push(s.exercise_title); }
    groups.get(s.exercise_title).push({ id: s.id, set_type: s.set_type || "normal", weight_kg: s.weight_kg, reps: s.reps });
  });
  const state = {
    title: workout.title || "",
    start: toLocalInput(workout.start_time),
    minutes: workout.end_time ? Math.max(1, Math.round((Date.parse(workout.end_time) - Date.parse(workout.start_time)) / 60000)) : 60,
    effort: workout.effort || "",
    watch: workout.watch_kcal || "",
    exercises: order.map(name => ({ name, sets: groups.get(name) }))
  };
  const originalIds = new Set(sets.map(s => s.id));
  const original = new Map(sets.map(s => [s.id, s]));

  closeModal();
  openModal(`
    <h3>✏️ ${t("Modifier la séance")}</h3>
    <label>${t("Titre")}</label>
    <input id="ed-title" maxlength="80">
    <div style="display:grid; grid-template-columns:1.4fr 1fr; gap:8px;">
      <div><label>${t("Début")}</label><input id="ed-start" type="datetime-local"></div>
      <div><label>${t("Durée (min)")}</label><input id="ed-minutes" type="number" min="1" max="600" inputmode="numeric"></div>
    </div>
    <div id="ed-exercises" style="margin-top:12px;"></div>
    <div class="card" style="padding:10px; margin-top:6px;">
      <div style="position:relative;"><input id="ed-new-ex" placeholder="${t("Nom de l'exercice")}"></div>
      <button class="btn btn-secondary btn-sm" id="ed-add-ex" style="margin-top:6px;">+ ${t("Ajouter un exercice")}</button>
    </div>
    ${body ? `
      <label>🔥 ${t("Calories")}</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <select id="ed-effort"><option value="">${t("Automatique")}</option>${Object.entries(EFFORTS).map(([k, e]) => `<option value="${k}">${t(e.label)}</option>`).join("")}</select>
        <input id="ed-watch" type="number" min="0" max="5000" inputmode="numeric" placeholder="${t("kcal de ta montre (facultatif)")}">
      </div>` : ""}
    <p id="ed-error" style="color:var(--red); min-height:1em; margin:6px 0;"></p>
    <div class="btn-row">
      <button class="btn btn-secondary" id="ed-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="ed-save">${t("Enregistrer")}</button>
    </div>
  `, (m) => {
    m.querySelector("#ed-title").value = state.title;
    m.querySelector("#ed-start").value = state.start;
    m.querySelector("#ed-minutes").value = state.minutes;
    if (body) { m.querySelector("#ed-effort").value = state.effort; m.querySelector("#ed-watch").value = state.watch; }
    const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? null : n; };
    const read = () => {
      m.querySelectorAll("[data-ex]").forEach(block => {
        const ex = state.exercises[+block.dataset.ex];
        block.querySelectorAll("[data-set]").forEach(row => {
          const st = ex.sets[+row.dataset.set];
          st.set_type = row.querySelector(".ed-type").value;
          st.weight_kg = num(row.querySelector(".ed-kg").value);
          st.reps = num(row.querySelector(".ed-reps").value);
        });
      });
    };
    const draw = () => {
      m.querySelector("#ed-exercises").innerHTML = state.exercises.map((ex, i) => `
        <div class="card" data-ex="${i}" style="padding:10px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
            <b style="min-width:0; overflow:hidden; text-overflow:ellipsis;">${esc(ex.name)}</b>
            <button class="icon-btn" data-del-ex="${i}" title="${t("Retirer l'exercice")}">✕</button>
          </div>
          <div class="edit-set-row muted" style="margin-bottom:2px;"><span>#</span><span>${t("type")}</span><span>kg</span><span>${t("reps")}</span><span></span></div>
          ${ex.sets.map((st, j) => `
            <div class="edit-set-row" data-set="${j}">
              <span class="muted">${j + 1}</span>
              <select class="ed-type">${SET_TYPES.map(ty => `<option value="${ty}" ${ty === st.set_type ? "selected" : ""}>${esc(setTypeShort(ty))}</option>`).join("")}</select>
              <input class="ed-kg" type="number" inputmode="decimal" step="0.5" min="0" value="${esc(st.weight_kg ?? "")}">
              <input class="ed-reps" type="number" inputmode="numeric" min="0" value="${esc(st.reps ?? "")}">
              <button class="icon-btn" data-del-set="${i}:${j}" title="${t("Supprimer la série")}">✕</button>
            </div>`).join("")}
          <button class="btn btn-secondary btn-sm" data-add-set="${i}" style="width:auto;">+ ${t("Série")}</button>
        </div>`).join("") || `<p class="muted">${t("Aucune série enregistrée.")}</p>`;
      m.querySelectorAll("[data-del-ex]").forEach(b => b.onclick = () => { read(); state.exercises.splice(+b.dataset.delEx, 1); draw(); });
      m.querySelectorAll("[data-del-set]").forEach(b => b.onclick = () => {
        read(); const [i, j] = b.dataset.delSet.split(":").map(Number);
        state.exercises[i].sets.splice(j, 1);
        if (!state.exercises[i].sets.length) state.exercises.splice(i, 1);
        draw();
      });
      m.querySelectorAll("[data-add-set]").forEach(b => b.onclick = () => {
        read(); const ex = state.exercises[+b.dataset.addSet];
        const last = ex.sets[ex.sets.length - 1];
        ex.sets.push({ id: null, set_type: "normal", weight_kg: last?.weight_kg ?? null, reps: last?.reps ?? null });
        draw();
      });
    };
    draw();
    const newEx = m.querySelector("#ed-new-ex");
    attachAutocomplete(newEx, names, () => null);
    m.querySelector("#ed-add-ex").onclick = () => {
      const name = newEx.value.trim();
      if (!name) return;
      if (/[<>]/.test(name) || name.length > 80) { m.querySelector("#ed-error").textContent = t("Les caractères < et > ne sont pas autorisés."); return; }
      read();
      const known = library.find(e => e.name.toLowerCase() === name.toLowerCase());
      state.exercises.push({ name: known ? known.name : name, isNew: !known, sets: [{ id: null, set_type: "normal", weight_kg: null, reps: null }] });
      newEx.value = "";
      draw();
    };
    m.querySelector("#ed-cancel").onclick = () => { closeModal(); onCancel(); };
    m.querySelector("#ed-save").onclick = async (e) => {
      read();
      const err = m.querySelector("#ed-error");
      const title = m.querySelector("#ed-title").value.trim();
      const startLocal = m.querySelector("#ed-start").value;
      const minutes = parseInt(m.querySelector("#ed-minutes").value, 10);
      if (!title || /[<>]/.test(title)) { err.textContent = t("Donne un titre à la séance (sans < ni >)."); return; }
      const startDate = new Date(startLocal);
      if (!startLocal || isNaN(startDate)) { err.textContent = t("Date de début invalide."); return; }
      if (!(minutes >= 1 && minutes <= 600)) { err.textContent = t("Durée : entre 1 et 600 minutes."); return; }
      const bad = state.exercises.some(ex => ex.sets.some(st => (st.weight_kg != null && (st.weight_kg < 0 || st.weight_kg > 1000)) || (st.reps != null && (st.reps < 0 || st.reps > 1000))));
      if (bad) { err.textContent = t("Poids ou répétitions hors limites."); return; }

      const start_time = startDate.toISOString();
      const end_time = new Date(startDate.getTime() + minutes * 60000).toISOString();
      const groupOf = (name) => library.find(x => x.name === name)?.muscle_group || guessMuscleGroup(name);
      const updates = [], creates = [], kept = new Set();
      let totalSets = 0, tonnage = 0;
      const muscles = [];
      state.exercises.forEach(ex => ex.sets.forEach((st, j) => {
        const logged = st.weight_kg != null || st.reps != null;
        if (logged) {
          totalSets++; tonnage += (st.weight_kg || 0) * (st.reps || 0);
          const g = groupOf(ex.name);
          if (!muscles.includes(g)) muscles.push(g);
        }
        const data = { exercise_title: ex.name, exercise_index: state.exercises.indexOf(ex), set_index: j + 1, set_type: st.set_type, weight_kg: st.weight_kg, reps: st.reps, workout_start_time: start_time };
        if (st.id) {
          kept.add(st.id);
          const o = original.get(st.id);
          if (Object.keys(data).some(k => (o[k] ?? null) !== (data[k] ?? null))) updates.push({ id: st.id, data });
        } else if (logged) {
          creates.push({ ...data, superset_id: null, exercise_notes: "", distance_km: null, duration_seconds: null, rpe: null });
        }
      }));
      const deletes = [...originalIds].filter(id => !kept.has(id));
      const patch = {
        title, start_time, end_time,
        total_sets: totalSets, total_tonnage: Math.round(tonnage), muscle_summary: muscles,
        last_set_at: null, edited_at: new Date().toISOString()
      };
      if (body) {
        const effort = m.querySelector("#ed-effort").value;
        const watch = parseInt(m.querySelector("#ed-watch").value, 10);
        patch.effort = EFFORTS[effort] ? effort : null;
        patch.watch_kcal = watch > 0 && watch <= 5000 ? watch : null;
      }
      e.target.disabled = true;
      try {
        await Promise.all(state.exercises.filter(ex => ex.isNew).map(ex => db.upsertExercise(ex.name, guessMuscleGroup(ex.name)).catch(() => null)));
        await db.saveWorkoutEdit(workout.id, { patch, updates, creates, deletes });
        invalidate("workouts", "sets", "exercises");
        (await import("./stats.js")).invalidateStatsCache();
        closeModal();
        toast(t("Séance modifiée"));
        onSaved();
      } catch (ex) {
        console.error("[Skullcrusher] Modification de séance", ex);
        err.textContent = t("Enregistrement impossible, réessaie.");
        e.target.disabled = false;
      }
    };
  });
}
