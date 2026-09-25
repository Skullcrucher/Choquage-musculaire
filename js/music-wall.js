// ============================================================
// MUR MUSICAL — ce qui fait soulever la salle
// Agrège les profils (artiste, playlist de salle) et les séances
// partagées (sons des records, bandes-son), entre amis ou pour toute la
// communauté.
// ============================================================
import * as db from "./db.js";
import { esc } from "./utils.js";
import { songHtml, bindSongLinks, parseSpotify } from "./music.js";
import { openProfile } from "./profile.js";

let scope = "friends"; // "friends" | "community"

function normArtist(name) {
  return String(name || "").trim();
}

function topCounts(map, n = 10) {
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr")).slice(0, n);
}

function bump(map, key, label, weight, extra = {}) {
  if (!key) return;
  const k = key.toLowerCase();
  const cur = map.get(k) || { label, count: 0, ...extra };
  cur.count += weight;
  map.set(k, cur);
}

export async function renderMusicWall(container) {
  container.innerHTML = `
    <div class="chip-row" id="mw-scope" style="margin-bottom:12px;">
      <div class="chip ${scope === "friends" ? "active" : ""}" data-scope="friends">👥 Mes amis</div>
      <div class="chip ${scope === "community" ? "active" : ""}" data-scope="community">🌍 Communauté</div>
    </div>
    <div id="mw-body"><div class="empty-state"><span class="num">···</span>Chargement</div></div>`;
  container.querySelectorAll("[data-scope]").forEach(c => c.onclick = () => { scope = c.dataset.scope; renderMusicWall(container); });
  const body = container.querySelector("#mw-body");

  const myUid = db.getCurrentUser()?.uid;
  let profiles, workouts;
  try {
    const feed = await db.listFeedWorkouts(150);
    if (scope === "friends") {
      const friendUids = (await db.listFriendships()).filter(f => f.status === "accepted").map(f => f.other_uid);
      const circle = new Set([myUid, ...friendUids]);
      const map = await db.getProfiles([...circle]);
      profiles = Object.entries(map).map(([uid, p]) => ({ uid, ...p }));
      workouts = feed.filter(w => circle.has(w.owner_uid));
    } else {
      profiles = await db.listMusicProfiles();
      workouts = feed;
    }
  } catch (err) {
    console.error("[Skullcrusher] Mur musical", err);
    body.innerHTML = `<div class="empty-state">Chargement impossible.</div>`;
    return;
  }
  if (!body.isConnected) return;
  const nameOf = (uid) => uid === myUid ? "Toi" : (profiles.find(p => p.uid === uid)?.display_name || "Quelqu'un");

  // Artistes : profil (x3), son d'un record (x2), bande-son (x1 par séance).
  const artists = new Map();
  const tracks = new Map();
  profiles.forEach(p => bump(artists, normArtist(p.music?.artist_name), normArtist(p.music?.artist_name), 3));
  workouts.forEach(w => {
    if (w.record_song?.artist) w.record_song.artist.split(/,\s*/).forEach(a => bump(artists, normArtist(a), normArtist(a), 2));
    const seenArtists = new Set();
    (w.soundtrack?.tracks || []).forEach(t => {
      (t.artist || "").split(/,\s*/).map(normArtist).filter(Boolean).forEach(a => seenArtists.add(a));
      bump(tracks, t.url || `${t.title}|${t.artist}`, `${t.title}`, 1, { song: t });
    });
    seenArtists.forEach(a => bump(artists, a, a, 1));
  });
  const topArtists = topCounts(artists);
  const topTracks = topCounts(tracks).filter(t => t.count > 0);
  const recordSongs = workouts.filter(w => w.record_song && (w.records || []).length).slice(0, 10);
  const playlists = profiles.filter(p => parseSpotify(p.music?.playlist_url));
  const max = topArtists[0]?.count || 1;

  body.innerHTML = `
    <div class="card">
      <div class="card-title">🔥 Artistes qui font soulever</div>
      ${topArtists.length ? topArtists.map((a, i) => `
        <div class="mw-bar-row">
          <span class="mw-rank">${i + 1}</span>
          <span class="mw-label">${esc(a.label)}</span>
          <span class="mw-bar"><span style="width:${Math.max(8, Math.round((a.count / max) * 100))}%"></span></span>
        </div>`).join("") : `<p class="muted" style="margin:0;">Personne n'a encore renseigné d'artiste. Ajoute le tien : Réglages → 🎧 musique.</p>`}
    </div>

    <div class="card">
      <div class="card-title">🏆 Les sons des records</div>
      ${recordSongs.length ? recordSongs.map(w => `
        <div class="list-row" style="cursor:default; display:block;">
          <div class="list-row-title"><span class="profile-link" data-profile="${esc(w.owner_uid)}">${esc(nameOf(w.owner_uid))}</span> — ${esc(w.records[0].exercise)} ${esc(w.records[0].kg)} kg × ${esc(w.records[0].reps)}</div>
          <div class="list-row-sub">🎵 ${songHtml(w.record_song)}</div>
        </div>`).join("") : `<p class="muted" style="margin:0;">Bats un record et indique le son qui t'a porté à la fin de ta séance : il apparaîtra ici.</p>`}
    </div>

    <div class="card">
      <div class="card-title">🎧 Playlists de salle</div>
      ${playlists.length ? playlists.map(p => `
        <div class="list-row" style="cursor:default;">
          <span class="list-row-title profile-link" data-profile="${esc(p.uid)}">${esc(p.uid === myUid ? "Toi" : p.display_name || "Utilisateur")}</span>
          <button class="btn btn-sm btn-secondary" style="width:auto;" data-playlist-url="${esc(parseSpotify(p.music.playlist_url).url)}" data-playlist-title="Playlist de ${esc(p.display_name || "salle")}">Écouter</button>
        </div>`).join("") : `<p class="muted" style="margin:0;">Aucune playlist de salle partagée pour l'instant.</p>`}
    </div>

    <div class="card">
      <div class="card-title">🎶 Les plus écoutés en séance</div>
      ${topTracks.length ? `<ol class="soundtrack-list">${topTracks.map(t => `<li>${songHtml(t.song)}${t.count > 1 ? ` <span class="muted">×${t.count}</span>` : ""}</li>`).join("")}</ol>`
        : `<p class="muted" style="margin:0;">Connecte Spotify (Réglages) et partage tes séances : les morceaux écoutés pendant l'entraînement apparaîtront ici.</p>`}
    </div>
  `;
  bindSongLinks(body);
  body.querySelectorAll("[data-profile]").forEach(el => el.onclick = () => openProfile(el.dataset.profile));
}
