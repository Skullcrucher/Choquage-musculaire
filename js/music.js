// ============================================================
// MUSIQUE — liens Spotify, lecteur intégré, morceaux
// Partagé par le profil, la fin de séance, le feed, les routines, le mur
// musical et les défis.
// ============================================================
import { openModal, closeModal, esc } from "./utils.js";

// N'accepte que des liens open.spotify.com et reconstruit l'URL à partir du
// type et de l'identifiant : rien de ce que l'utilisateur tape n'est
// injecté tel quel dans la page.
export function parseSpotify(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "https:" || u.hostname !== "open.spotify.com") return null;
    const m = u.pathname.match(/^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|artist|album|track|user|show|episode)\/([A-Za-z0-9._-]{1,80})\/?$/i);
    if (!m) return null;
    const type = m[1].toLowerCase();
    return { type, id: m[2], url: `https://open.spotify.com/${type}/${m[2]}` };
  } catch (_) {
    return null;
  }
}

// Lien de playlist (ou d'album) valide, normalisé, sinon "".
export function normalizePlaylistUrl(raw) {
  const p = parseSpotify(raw);
  return p && (p.type === "playlist" || p.type === "album") ? p.url : "";
}

export function spotifyEmbed(linkOrUrl, height = 152) {
  const link = typeof linkOrUrl === "string" ? parseSpotify(linkOrUrl) : linkOrUrl;
  if (!link || link.type === "user") return "";
  return `<iframe class="spotify-embed" src="https://open.spotify.com/embed/${link.type}/${encodeURIComponent(link.id)}?theme=0" height="${height}" frameborder="0" loading="lazy"
    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" title="Lecteur Spotify"></iframe>`;
}

// Ouvre le lecteur dans une fenêtre (ex. playlist d'une séance du feed).
export function openSpotifyPlayer(url, title = "Écouter") {
  const link = parseSpotify(url);
  if (!link) return;
  openModal(`
    <h3 style="margin-bottom:6px;">${esc(title)}</h3>
    ${spotifyEmbed(link, link.type === "track" ? 152 : 380)}
    <a class="btn btn-secondary btn-sm" style="margin-top:10px;" href="${link.url}" target="_blank" rel="noopener">Ouvrir dans Spotify</a>
    <button class="btn btn-secondary" id="sp-close" style="margin-top:10px;">Fermer</button>
  `, (m) => { m.querySelector("#sp-close").onclick = closeModal; });
}

// Morceau saisi à la main : "Titre - Artiste", ou un lien Spotify de titre.
export function parseSongInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const link = parseSpotify(text);
  if (link) return link.type === "track" ? { title: "", artist: "", url: link.url } : null;
  const [title, ...rest] = text.split(/\s+[-–—]\s+/);
  return { title: title.slice(0, 100), artist: rest.join(" - ").slice(0, 100), url: "" };
}

export function songLabel(song) {
  if (!song) return "";
  if (song.title) return song.artist ? `${song.title} — ${song.artist}` : song.title;
  return song.url ? "un morceau Spotify" : "";
}

// Texte d'un morceau (échappé), cliquable s'il a un lien Spotify.
export function songHtml(song) {
  const label = esc(songLabel(song));
  const link = parseSpotify(song?.url);
  return link ? `<span class="song-link" data-song-url="${esc(link.url)}">${label}</span>` : label;
}

export function bindSongLinks(root) {
  root.querySelectorAll("[data-song-url]").forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); openSpotifyPlayer(el.dataset.songUrl, songLabel({ title: el.textContent })); };
  });
  root.querySelectorAll("[data-playlist-url]").forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); openSpotifyPlayer(el.dataset.playlistUrl, el.dataset.playlistTitle || "Playlist"); };
  });
}
