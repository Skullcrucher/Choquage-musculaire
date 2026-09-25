// ============================================================
// FIN DE SÉANCE — records, "son du record", playlist, bande-son, partage
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, esc, estimate1RM } from "./utils.js";
import { getSetsForExercise } from "./cache.js";
import { normalizePlaylistUrl, parseSongInput, songLabel } from "./music.js";

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

// Fenêtre de fin de séance. Résout avec les champs à enregistrer sur la
// séance, ou null si l'utilisateur revient à sa séance.
export async function openFinishDialog(workout, summary) {
  const [records, spotify, profile] = await Promise.all([
    computeRecords(workout).catch(() => []),
    import("./spotify-connect.js").then(async m => {
      if (!(await m.isSpotifyConnected())) return null;
      const [nowPlaying, tracks] = await Promise.all([m.getNowPlaying(), m.getTracksSince(new Date(workout.start_time).getTime())]);
      return { nowPlaying, tracks };
    }).catch(() => null),
    db.getProfile(db.getCurrentUser()?.uid).catch(() => null)
  ]);
  const defaultPlaylist = workout.playlist_url || profile?.music?.playlist_url || "";
  const nowPlaying = spotify?.nowPlaying;
  const tracks = spotify?.tracks || [];

  return new Promise((resolve) => {
    openModal(`
      <h3 style="margin-bottom:4px;">Séance terminée 🤘</h3>
      <p class="muted" style="margin-top:0;">${summary.sets} série${summary.sets > 1 ? "s" : ""} · ${summary.tonnage} kg soulevés</p>

      ${records.length ? `
        <div class="finish-records">
          ${records.map(r => `<div>🏆 <b>${esc(r.exercise)}</b> — ${esc(r.kg)} kg × ${esc(r.reps)} <span class="muted">(1RM ${esc(r.one_rm)} kg, +${esc(Math.round((r.one_rm - r.prev_one_rm) * 10) / 10)} kg)</span></div>`).join("")}
        </div>
        <label>🎵 Le son qui t'a porté</label>
        <input id="fin-song" placeholder="Titre - Artiste, ou lien Spotify du morceau" value="${esc(nowPlaying ? `${nowPlaying.title} - ${nowPlaying.artist}` : "")}">
        ${nowPlaying ? `<p class="muted" style="font-size:12px; margin:4px 0 0;">Pré-rempli avec le morceau en cours sur Spotify.</p>` : ""}
      ` : ""}

      <label>🎧 Playlist de la séance (facultatif)</label>
      <input id="fin-playlist" placeholder="https://open.spotify.com/playlist/…" value="${esc(defaultPlaylist)}" inputmode="url">

      ${tracks.length ? `
        <label class="list-row" style="cursor:pointer; margin-top:10px;">
          <span>🎶 Joindre la bande-son (${tracks.length} morceau${tracks.length > 1 ? "x" : ""} écouté${tracks.length > 1 ? "s" : ""})</span>
          <input type="checkbox" id="fin-tracks" checked style="width:auto;">
        </label>
        <p class="muted" style="font-size:12px; margin:0;">${tracks.slice(0, 4).map(t => esc(songLabel(t))).join(" · ")}${tracks.length > 4 ? " …" : ""}</p>
      ` : ""}

      <label class="list-row" style="cursor:pointer; margin-top:10px;">
        <span>Partager sur le feed</span>
        <input type="checkbox" id="fin-share" style="width:auto;">
      </label>
      <p id="fin-error" style="color:var(--red); min-height:1em; margin:4px 0;"></p>
      <div class="btn-row">
        <button class="btn btn-secondary" id="fin-back">Revenir</button>
        <button class="btn btn-primary" id="fin-save">Enregistrer</button>
      </div>
    `, (m) => {
      m.querySelector("#fin-back").onclick = () => { closeModal(); resolve(null); };
      m.querySelector("#fin-save").onclick = () => {
        const err = m.querySelector("#fin-error");
        const rawPlaylist = m.querySelector("#fin-playlist").value.trim();
        const playlist = normalizePlaylistUrl(rawPlaylist);
        if (rawPlaylist && !playlist) { err.textContent = "Lien de playlist Spotify invalide (open.spotify.com/playlist/…)."; return; }
        const songInput = m.querySelector("#fin-song")?.value.trim() || "";
        let song = songInput ? parseSongInput(songInput) : null;
        if (songInput && !song) { err.textContent = "Morceau : écris « Titre - Artiste » ou colle un lien Spotify de titre."; return; }
        if (song && nowPlaying && songInput === `${nowPlaying.title} - ${nowPlaying.artist}`) song = nowPlaying;
        if (song && /[<>]/.test(song.title + song.artist)) { err.textContent = "Les caractères < et > ne sont pas autorisés."; return; }
        const withTracks = !!m.querySelector("#fin-tracks")?.checked;
        closeModal();
        resolve({
          shared: m.querySelector("#fin-share").checked,
          records,
          record_song: records.length && song ? song : null,
          soundtrack: (playlist || withTracks) ? { playlist_url: playlist, tracks: withTracks ? tracks : [] } : null
        });
      };
    }, { onDismiss: () => resolve(null) });
  });
}
