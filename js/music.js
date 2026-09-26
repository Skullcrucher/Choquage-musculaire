// ============================================================
// MUSIQUE — liens Spotify, lecteur intégré, morceaux
// Partagé par le profil, la fin de séance, le feed, les routines, le mur
// musical et les défis.
// ============================================================
import { closeModal, esc } from "./utils.js";
import { t } from "./i18n.js";

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

// Lecteur Spotify ancré au-dessus de la barre d'onglets (hors des
// fenêtres modales) : on peut le réduire, l'agrandir et changer d'onglet
// sans couper la musique. Réduire/agrandir ne fait que changer la hauteur
// de l'iframe, qui n'est jamais rechargée ; seul ✕ arrête la lecture.
const PLAYER_FULL = 352, PLAYER_MINI = 80;
export function openSpotifyPlayer(url, title = t("Écouter")) {
  const link = parseSpotify(url);
  if (!link || link.type === "user") return;
  closeModal();
  let dock = document.getElementById("spotify-dock");
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "spotify-dock";
    document.body.appendChild(dock);
  }
  dock.innerHTML = `
    <div class="spotify-dock-bar">
      <span class="spotify-dock-title">${SPOTIFY_ICON} ${esc(title)}</span>
      <span class="spotify-dock-actions">
        <a href="${esc(link.url)}" target="_blank" rel="noopener" title="${t("Ouvrir dans Spotify")}">↗</a>
        <button id="sp-toggle" title="${t("Réduire")}">▾</button>
        <button id="sp-close" title="${t("Fermer le lecteur")}">✕</button>
      </span>
    </div>
    ${spotifyEmbed(link, link.type === "track" ? 152 : PLAYER_FULL).replace('loading="lazy"', "")}`;
  const iframe = dock.querySelector("iframe");
  const fullHeight = link.type === "track" ? 152 : PLAYER_FULL;
  const toggle = dock.querySelector("#sp-toggle");
  const setMini = (mini) => {
    iframe.height = mini ? PLAYER_MINI : fullHeight;
    dock.classList.toggle("mini", mini);
    toggle.textContent = mini ? "▴" : "▾";
    toggle.title = mini ? t("Agrandir") : t("Réduire");
    // Le minuteur de repos et le bas de page se placent au-dessus du lecteur.
    document.body.style.setProperty("--dock-h", dock.offsetHeight + "px");
  };
  toggle.onclick = () => setMini(!dock.classList.contains("mini"));
  dock.querySelector("#sp-close").onclick = () => {
    dock.remove();
    document.body.classList.remove("has-spotify-dock");
    document.body.style.removeProperty("--dock-h");
  };
  document.body.classList.add("has-spotify-dock");
  setMini(false);
}

// Logo Spotify (icône officielle, vert Spotify) : les consignes de marque
// Spotify imposent de l'afficher à côté de tout contenu issu de Spotify.
export const SPOTIFY_ICON = `<svg class="spotify-icon" viewBox="0 0 24 24" aria-label="Spotify" role="img"><path fill="#1DB954" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`;

// Morceau saisi par l'utilisateur :
//   - un lien Spotify de titre -> on ne garde que le lien ;
//   - sinon "Titre - Artiste" en texte libre.
// Les morceaux venant de la connexion Spotify ne sont jamais recopiés
// (titre, artiste) : on ne garde que leur lien, et c'est le lecteur
// officiel de Spotify qui les affiche.
export function parseSongInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const link = parseSpotify(text);
  if (link) return link.type === "track" ? { url: link.url, source: "link" } : null;
  const [title, ...rest] = text.split(/\s+[-–—]\s+/);
  return { title: title.slice(0, 100), artist: rest.join(" - ").slice(0, 100), url: "" };
}

export function songLabel(song) {
  if (!song) return "";
  if (song.title) return song.artist ? `${song.title} — ${song.artist}` : song.title;
  return song.url ? t("Écouter sur Spotify") : "";
}

// Morceau en ligne (feed, listes) : texte saisi, ou lien Spotify avec le logo.
export function songHtml(song) {
  const link = parseSpotify(song?.url);
  if (song?.title) {
    return link ? `<span class="song-link" data-song-url="${esc(link.url)}">${esc(songLabel(song))}</span>` : esc(songLabel(song));
  }
  return link ? `<span class="song-link spotify-attrib" data-song-url="${esc(link.url)}">${SPOTIFY_ICON} ${t("Écouter le morceau")}</span>` : "";
}

// Morceau en grand (détail d'une séance) : lecteur Spotify compact pour un
// lien Spotify, sinon le texte saisi.
export function songBlockHtml(song) {
  const link = parseSpotify(song?.url);
  if (link && link.type === "track" && !song.title) return spotifyEmbed(link, 80);
  return songHtml(song);
}

export function bindSongLinks(root) {
  root.querySelectorAll("[data-song-url]").forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); openSpotifyPlayer(el.dataset.songUrl, t("Morceau")); };
  });
  root.querySelectorAll("[data-playlist-url]").forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); openSpotifyPlayer(el.dataset.playlistUrl, el.dataset.playlistTitle || t("Playlist")); };
  });
}
