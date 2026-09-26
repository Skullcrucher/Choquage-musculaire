// ============================================================
// FIN DE SÉANCE — records, "son du record", playlist, bande-son, partage
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, esc, estimate1RM } from "./utils.js";
import { getSetsForExercise, getRoutines } from "./cache.js";
import { normalizePlaylistUrl, parseSongInput, songLabel, SPOTIFY_ICON } from "./music.js";
import { t, tn } from "./i18n.js";
import { getBody, bodyComplete, autoEffort, estimateKcal, EFFORTS } from "./calories.js";

// Bande-son jointe à une séance : liens des morceaux uniquement (voir music.js).
const MAX_SOUNDTRACK = 10;

// Meilleure 1RM estimée d'une liste de séries, en ne gardant que les séries
// de 15 reps ou moins (au-delà, la formule d'Epley s'emballe), sauf s'il
// n'y en a aucune.
function bestSet(sets) {
  const valid = sets.filter(s => s.weight_kg > 0 && s.reps > 0 && s.set_type !== "warmup");
  const pool = valid.filter(s => s.reps <= 15).length ? valid.filter(s => s.reps <= 15) : valid;
  let best = null;
  for (const s of pool) {
    const v = estimate1RM(s.weight_kg, s.reps);
    if (!best || v > best.one_rm) best = { kg: s.weight_kg, reps: s.reps, one_rm: v };
  }
  return best;
}

// Records battus pendant la séance : meilleure 1RM estimée de l'exercice
// supérieure à tout l'historique précédent (un premier essai n'est pas un record).
export async function computeRecords(workout) {
  const records = [];
  await Promise.all(workout.exercises.map(async (ex) => {
    const now = bestSet(ex.sets.filter(s => s.weight_kg != null && s.reps != null));
    if (!now) return;
    let history = [];
    try {
      history = (await getSetsForExercise(ex.exercise_title)).filter(s => s.workout_id !== workout.id && s.workout_start_time !== workout.start_time);
    } catch (_) { return; }
    const prev = bestSet(history);
    if (prev && now.one_rm > prev.one_rm + 0.05) {
      records.push({ exercise: ex.exercise_title, kg: now.kg, reps: now.reps, one_rm: now.one_rm, prev_one_rm: prev.one_rm });
    }
  }));
  return records.sort((a, b) => (b.one_rm - b.prev_one_rm) - (a.one_rm - a.prev_one_rm));
}

// Amis proposés comme partenaires : tous les amis, avec présélection de
// ceux qui nous ont cité dans une séance commencée à moins de 12 h de la nôtre.
async function partnerChoices(workout) {
  const friendUids = await db.listFriendUids().catch(() => []);
  if (!friendUids.length) return { friends: [], preselected: new Set() };
  const [profiles, tagged] = await Promise.all([
    db.getProfiles(friendUids).catch(() => ({})),
    db.listPartnerWorkouts(30).catch(() => [])
  ]);
  const start = Date.parse(workout.start_time);
  const preselected = new Set(tagged
    .filter(w => Math.abs(Date.parse(w.start_time) - start) < 12 * 3600 * 1000 && friendUids.includes(w.owner_uid))
    .map(w => w.owner_uid));
  const friends = friendUids.map(uid => ({ uid, name: profiles[uid]?.display_name || t("Un ami") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { friends, preselected };
}

const fmtRpe = (v) => String(v).replace(".", ",");
function progressionReason(p) {
  switch (p.reason) {
    case "easy": return t("{sets} séries à {reps}+ reps (objectif {hi}) avec de la marge (RPE {rpe}) : double saut.", { sets: p.sets, reps: p.reps, hi: p.hi, rpe: fmtRpe(p.rpe) });
    case "failure": return t("Objectif atteint, mais à l'échec (RPE 10) : à toi de voir si tu es prêt.", {});
    case "light": return t("Reps dans la fourchette avec beaucoup de marge (RPE {rpe}) : la charge est peut-être trop légère.", { rpe: fmtRpe(p.rpe) });
    case "low": return t("Moins de {lo} reps sur la plupart des séries : alléger un peu aide à progresser.", { lo: p.lo });
    default: return t("{sets} séries à {reps}+ reps (objectif {hi}) : tu peux charger plus.", { sets: p.sets, reps: p.reps, hi: p.hi }) + (p.rpe != null ? ` (RPE ${fmtRpe(p.rpe)})` : "");
  }
}

// Charges à adapter dans la routine d'origine (double progression).
async function progressionChoices(workout) {
  if (!workout.routine_id) return { routine: null, list: [] };
  const routine = (await getRoutines()).find(r => r.id === workout.routine_id);
  if (!routine) return { routine: null, list: [] };
  const { suggestProgressions } = await import("./progression.js");
  const exercises = workout.exercises.map(ex => {
    const def = (routine.exercises || []).find(e => e.exercise_name === ex.exercise_title);
    if (!def) return null;
    return { ...ex, reps_target: def.reps_target, target_sets: def.target_sets, target_kg: def.target_kg ?? null };
  }).filter(Boolean);
  return { routine, list: suggestProgressions(exercises) };
}

// Fenêtre de fin de séance. Résout avec les champs à enregistrer sur la
// séance, ou null si l'utilisateur revient à sa séance.
export async function openFinishDialog(workout, summary) {
  const [records, spotify, profile, partners, body, progress] = await Promise.all([
    computeRecords(workout).catch(() => []),
    import("./spotify-connect.js").then(async m => {
      if (!(await m.isSpotifyConnected())) return null;
      const [nowPlaying, tracks] = await Promise.all([m.getNowPlaying(), m.getTracksSince(new Date(workout.start_time).getTime())]);
      return { nowPlaying, tracks };
    }).catch(() => null),
    db.getProfile(db.getCurrentUser()?.uid).catch(() => null),
    partnerChoices(workout).catch(() => ({ friends: [], preselected: new Set() })),
    getBody(),
    progressionChoices(workout).catch(e => { console.warn("[Skullcrusher] Progression", e); return { routine: null, list: [] }; })
  ]);
  const minutes = Math.min(300, Math.round(((summary.lastSetAt ? Math.min(Date.now(), Date.parse(summary.lastSetAt) + 10 * 60000) : Date.now()) - Date.parse(workout.start_time)) / 60000));
  let effort = autoEffort(summary.sets, minutes);
  const hasBody = bodyComplete(body);
  const defaultPlaylist = workout.playlist_url || profile?.music?.playlist_url || "";
  const nowPlaying = spotify?.nowPlaying;
  const tracks = spotify?.tracks || [];

  return new Promise((resolve) => {
    openModal(`
      <h3 style="margin-bottom:4px;">${t("Séance terminée")} 🤘</h3>
      <p class="muted" style="margin-top:0;">${tn(summary.sets, "{n} série", "{n} séries")} · ${t("{kg} kg soulevés", { kg: summary.tonnage })}</p>

      ${records.length ? `
        <div class="finish-records">
          ${records.map(r => `<div>🏆 <b>${esc(r.exercise)}</b> — ${esc(r.kg)} kg × ${esc(r.reps)} <span class="muted">(1RM ${esc(r.one_rm)} kg, +${esc(Math.round((r.one_rm - r.prev_one_rm) * 10) / 10)} kg)</span></div>`).join("")}
        </div>
        <label>🎵 ${t("Le son qui t'a porté")}</label>
        <input id="fin-song" placeholder="${t("Titre - Artiste, ou lien du morceau (Spotify, Apple Music, Deezer)")}" value="${esc(nowPlaying ? `${nowPlaying.title} - ${nowPlaying.artist}` : "")}">
        ${nowPlaying ? `<p class="muted spotify-attrib" style="font-size:12px; margin:4px 0 0;">${SPOTIFY_ICON} ${t("Pré-rempli avec le morceau en cours sur Spotify.")}</p>` : ""}
      ` : ""}

      <label>🎧 ${t("Playlist de la séance (facultatif)")}</label>
      <input id="fin-playlist" placeholder="${t("Lien de playlist (Spotify, Apple Music, Deezer)")}" value="${esc(defaultPlaylist)}" inputmode="url">

      ${tracks.length ? `
        <label class="list-row" style="cursor:pointer; margin-top:10px;">
          <span>🎶 ${tn(Math.min(tracks.length, MAX_SOUNDTRACK), "Joindre la bande-son ({n} morceau écouté)", "Joindre la bande-son ({n} morceaux écoutés)")}</span>
          <input type="checkbox" id="fin-tracks" checked style="width:auto;">
        </label>
        <p class="muted spotify-attrib" style="font-size:12px; margin:0;">${SPOTIFY_ICON} ${tracks.slice(0, 4).map(tr => esc(songLabel(tr))).join(" · ")}${tracks.length > 4 ? " …" : ""}</p>
      ` : ""}

      ${progress.list.length ? `
        <label>📈 ${t("Progression — routine « {routine} »", { routine: esc(progress.routine.name) })}</label>
        <div id="fin-progress">
          ${progress.list.map((p, i) => `
            <label class="list-row" style="cursor:pointer; align-items:flex-start;">
              <span style="font-size:14px;">
                ${p.direction === "up" ? "⬆️" : "⬇️"} <b>${esc(p.exercise)}</b> : ${esc(p.from)} → <b>${esc(p.to)} kg</b>
                <br><span class="muted" style="font-size:12px;">${progressionReason(p)}</span>
              </span>
              <input type="checkbox" data-prog="${i}" ${p.checked ? "checked" : ""} style="width:auto; margin-top:4px;">
            </label>`).join("")}
        </div>
        <p class="muted" style="font-size:12px; margin:4px 0 0;">${t("Coché = la routine (et ton plan) utilisera cette charge à la prochaine séance. Décoche pour garder la charge actuelle.")}</p>
      ` : ""}

      ${partners.friends.length ? `
        <label>🤝 ${t("Entraîné avec")}</label>
        <div class="chip-row" id="fin-partners" style="margin-bottom:0;">
          ${partners.friends.map(f => `<div class="chip ${partners.preselected.has(f.uid) ? "active" : ""}" data-partner="${esc(f.uid)}">${esc(f.name)}</div>`).join("")}
        </div>
        ${partners.preselected.size ? `<p class="muted" style="font-size:12px; margin:4px 0 0;">${t("Présélectionnés : ils t'ont cité dans leur séance.")}</p>` : ""}
      ` : ""}

      <label>🔥 ${t("Calories")}</label>
      ${hasBody ? `
        <div class="chip-row" id="fin-effort" style="margin-bottom:4px;">
          ${Object.entries(EFFORTS).map(([k, e]) => `<div class="chip ${k === effort ? "active" : ""}" data-effort="${k}">${t(e.label)}</div>`).join("")}
        </div>
        <p class="muted" id="fin-kcal" style="margin:0 0 6px; font-size:13px;"></p>
      ` : `<p class="muted" style="margin:0 0 6px; font-size:13px;">${t("Renseigne sexe, âge, taille et poids dans Réglages → 🔥 Calories pour une estimation.")}</p>`}
      <input id="fin-watch" type="number" inputmode="numeric" min="0" max="5000" placeholder="${t("kcal de ta montre (facultatif)")}">

      <label class="list-row" style="cursor:pointer; margin-top:10px;">
        <span>${t("Partager sur le feed")}</span>
        <input type="checkbox" id="fin-share" style="width:auto;">
      </label>
      <p id="fin-error" style="color:var(--red); min-height:1em; margin:4px 0;"></p>
      <div class="btn-row">
        <button class="btn btn-secondary" id="fin-back">${t("Revenir")}</button>
        <button class="btn btn-primary" id="fin-save">${t("Enregistrer")}</button>
      </div>
    `, (m) => {
      m.querySelector("#fin-back").onclick = () => { closeModal(); resolve(null); };
      m.querySelectorAll("[data-partner]").forEach(c => c.onclick = () => c.classList.toggle("active"));
      const kcalEl = m.querySelector("#fin-kcal");
      const showKcal = () => {
        if (!kcalEl) return;
        const kcal = estimateKcal(body, effort, minutes);
        if (kcal == null) { kcalEl.textContent = t("Séance trop courte pour une estimation."); return; }
        kcalEl.textContent = t("≈ {kcal} kcal ({low}–{high}) pour {min} min d'effort {effort}", { kcal, low: Math.round(kcal * 0.75), high: Math.round(kcal * 1.25), min: minutes, effort: t(EFFORTS[effort].label).toLowerCase() });
      };
      showKcal();
      m.querySelectorAll("[data-effort]").forEach(c => c.onclick = () => {
        effort = c.dataset.effort;
        m.querySelectorAll("[data-effort]").forEach(x => x.classList.toggle("active", x === c));
        showKcal();
      });
      m.querySelector("#fin-save").onclick = () => {
        const err = m.querySelector("#fin-error");
        const rawPlaylist = m.querySelector("#fin-playlist").value.trim();
        const playlist = normalizePlaylistUrl(rawPlaylist);
        if (rawPlaylist && !playlist) { err.textContent = t("Lien de playlist invalide : colle un lien Spotify, Apple Music ou Deezer."); return; }
        const songInput = m.querySelector("#fin-song")?.value.trim() || "";
        let song = songInput ? parseSongInput(songInput) : null;
        if (songInput && !song) { err.textContent = t("Morceau : écris « Titre - Artiste » ou colle le lien d'un titre (Spotify, Apple Music, Deezer)."); return; }
        // Morceau en cours accepté tel quel : on ne garde que son lien Spotify.
        if (song && nowPlaying && songInput === `${nowPlaying.title} - ${nowPlaying.artist}`) song = { url: nowPlaying.url, source: "spotify" };
        if (song && /[<>]/.test((song.title || "") + (song.artist || ""))) { err.textContent = t("Les caractères < et > ne sont pas autorisés."); return; }
        const withTracks = !!m.querySelector("#fin-tracks")?.checked;
        const watch = parseInt(m.querySelector("#fin-watch").value, 10);
        closeModal();
        resolve({
          shared: m.querySelector("#fin-share").checked,
          routine: progress.routine,
          progressions: [...m.querySelectorAll("[data-prog]:checked")].map(c => progress.list[+c.dataset.prog]),
          partners: [...m.querySelectorAll("[data-partner].active")].map(c => c.dataset.partner).slice(0, db.MAX_PARTNERS),
          effort: hasBody ? effort : null,
          watch_kcal: watch > 0 && watch <= 5000 ? watch : null,
          records,
          record_song: records.length && song ? song : null,
          soundtrack: (playlist || withTracks) ? {
            playlist_url: playlist,
            tracks: withTracks ? tracks.slice(0, MAX_SOUNDTRACK).map(tr => ({ url: tr.url, source: "spotify" })) : []
          } : null
        });
      };
    }, { onDismiss: () => resolve(null) });
  });
}
