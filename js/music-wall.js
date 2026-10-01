// ============================================================
// MUR MUSICAL — ce qui fait soulever la salle (onglet Musique)
// Agrège les profils (artiste mis en avant, playlist de salle) et les
// séances partagées (sons des records, playlists de séance), pour toute la
// communauté (par défaut) ou entre amis.
// Les écoutes récupérées via Spotify ne sont jamais agrégées en
// classement : la politique développeurs de Spotify l'interdit. Le
// classement des artistes repose sur ce que chacun déclare dans son profil.
// ============================================================
import * as db from "./db.js";
import { esc, safeImageUrl } from "./utils.js";
import { songHtml, bindSongLinks, parseMusicLink, providerIcon, providerName, openMusicPlayer } from "./music.js";
import { openProfile } from "./profile.js";
import { t, tn } from "./i18n.js";

const LS_SCOPE = "skullcrusher_music_scope";
let scope = (() => { try { return localStorage.getItem(LS_SCOPE) === "friends" ? "friends" : "community"; } catch (_) { return "community"; } })();

const normArtist = (name) => String(name || "").trim();

export async function renderMusicWall(container) {
  container.innerHTML = `
    <div class="chip-row" id="mw-scope" style="margin:0 0 14px;">
      <div class="chip ${scope === "community" ? "active" : ""}" data-scope="community">🌍 ${t("Communauté")}</div>
      <div class="chip ${scope === "friends" ? "active" : ""}" data-scope="friends">👥 ${t("Mes amis")}</div>
    </div>
    <div id="mw-body"><div class="empty-state"><span class="num">···</span>${t("Chargement")}</div></div>`;
  container.querySelectorAll("[data-scope]").forEach(c => c.onclick = () => {
    scope = c.dataset.scope;
    try { localStorage.setItem(LS_SCOPE, scope); } catch (_) {}
    renderMusicWall(container);
  });
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
    body.innerHTML = `<div class="empty-state">${t("Chargement impossible.")}</div>`;
    return;
  }
  if (!body.isConnected) return;
  const nameOf = (uid) => uid === myUid ? t("Toi") : (profiles.find(p => p.uid === uid)?.display_name || t("Quelqu'un"));

  // Artistes mis en avant dans les profils : nombre d'athlètes, et un lien
  // d'artiste (le premier trouvé) pour l'écouter.
  const artists = new Map();
  profiles.forEach(p => {
    const name = normArtist(p.music?.artist_name);
    if (!name) return;
    const k = name.toLowerCase();
    const cur = artists.get(k) || { name, count: 0, url: "", fans: [] };
    cur.count++;
    cur.fans.push(p);
    if (!cur.url && parseMusicLink(p.music?.artist_url)) cur.url = parseMusicLink(p.music.artist_url).url;
    artists.set(k, cur);
  });
  const top = [...artists.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr")).slice(0, 9);
  const [hero, ...others] = top;

  const recordSongs = workouts.filter(w => w.record_song && (w.records || []).length).slice(0, 12);
  const gymPlaylists = profiles.filter(p => parseMusicLink(p.music?.playlist_url));
  const sessionPlaylists = workouts.filter(w => parseMusicLink(w.soundtrack?.playlist_url)).slice(0, 8);

  const avatar = (p, size = 26) => {
    const photo = safeImageUrl(p?.photo_data_url);
    return photo ? `<span class="mw-ava" style="width:${size}px; height:${size}px; background-image:url('${photo}')"></span>`
      : `<span class="mw-ava" style="width:${size}px; height:${size}px;">${esc((p?.display_name || "?")[0].toUpperCase())}</span>`;
  };
  const playlistTile = (url, owner, sub) => {
    const link = parseMusicLink(url);
    return `<button type="button" class="mw-pl" data-playlist-url="${esc(link.url)}" data-playlist-title="${esc(t("Playlist de {name}", { name: owner }))}">
      <span class="mw-pl-icon">${providerIcon(link)}</span>
      <span class="mw-pl-text"><b data-title-of="${esc(link.url)}">${esc(t("Playlist de {name}", { name: owner }))}</b><small>${esc(sub)} · ${esc(providerName(link))}</small></span>
      <span class="mw-play">▶</span>
    </button>`;
  };

  body.innerHTML = `
    ${hero ? `
    <div class="mw-hero" ${hero.url ? `data-artist-url="${esc(hero.url)}" role="button"` : ""}>
      <div class="mw-kicker">🔥 ${t("L'artiste qui fait soulever")} ${scope === "friends" ? t("tes amis") : t("la salle")}</div>
      <div class="mw-hero-name">${esc(hero.name)}</div>
      <div class="mw-hero-sub">
        <span class="mw-fans">${hero.fans.slice(0, 5).map(p => avatar(p, 24)).join("")}</span>
        ${tn(hero.count, "mis en avant par {n} athlète", "mis en avant par {n} athlètes")}
      </div>
      ${hero.url ? `<span class="mw-hero-play">▶ ${t("Écouter")}</span>` : ""}
    </div>` : `
    <div class="mw-hero mw-hero-empty">
      <div class="mw-kicker">🔥 ${t("L'artiste qui fait soulever la salle")}</div>
      <p style="margin:6px 0 0;">${t("Personne n'a encore mis d'artiste en avant. Ajoute le tien depuis ta photo de profil → Réglages → 🎧 musique.")}</p>
    </div>`}

    ${others.length ? `<div class="mw-artists">${others.map((a, i) => `
      <div class="mw-artist" ${a.url ? `data-artist-url="${esc(a.url)}" role="button"` : ""}>
        <span class="mw-artist-rank">${i + 2}</span>
        <span class="mw-artist-name">${esc(a.name)}</span>
        <span class="mw-artist-count">${tn(a.count, "{n} athlète", "{n} athlètes")}</span>
      </div>`).join("")}</div>` : ""}

    <h2 class="mw-h2">🏆 ${t("Les sons des records")}</h2>
    ${recordSongs.length ? `<div class="mw-songs">${recordSongs.map(w => `
      <div class="mw-song">
        <div class="mw-song-title">${songHtml(w.record_song)}</div>
        <div class="mw-song-sub"><span class="profile-link" data-profile="${esc(w.owner_uid)}">${esc(nameOf(w.owner_uid))}</span> · ${esc(w.records[0].exercise)} <b>${esc(w.records[0].kg)} kg × ${esc(w.records[0].reps)}</b></div>
      </div>`).join("")}</div>` : `<p class="muted">${t("Bats un record et indique le son qui t'a porté à la fin de ta séance : il apparaîtra ici.")}</p>`}

    <h2 class="mw-h2">🎧 ${t("Playlists de salle")}</h2>
    ${gymPlaylists.length ? `<div class="mw-pls">${gymPlaylists.map(p => playlistTile(p.music.playlist_url, p.uid === myUid ? t("Toi") : (p.display_name || t("Utilisateur")), t("de {name}", { name: p.uid === myUid ? t("toi") : (p.display_name || t("Utilisateur")) }))).join("")}</div>`
      : `<p class="muted">${t("Aucune playlist de salle partagée pour l'instant.")}</p>`}

    ${sessionPlaylists.length ? `<h2 class="mw-h2">🎶 ${t("Playlists des dernières séances")}</h2>
      <div class="mw-pls">${sessionPlaylists.map(w => playlistTile(w.soundtrack.playlist_url, nameOf(w.owner_uid), `${nameOf(w.owner_uid)} · ${w.title || t("Séance")}`)).join("")}</div>` : ""}
  `;
  bindSongLinks(body);
  body.querySelectorAll("[data-artist-url]").forEach(el => el.onclick = () => openMusicPlayer(el.dataset.artistUrl, t("Artiste")));
  body.querySelectorAll("[data-profile]").forEach(el => el.onclick = (e) => { e.stopPropagation(); openProfile(el.dataset.profile); });
}
