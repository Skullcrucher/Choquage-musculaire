// ============================================================
// MUSIQUE — liens Spotify, Apple Music et Deezer, lecteurs intégrés
// officiels, morceaux, service préféré de chacun.
// Partagé par le profil, la fin de séance, le feed, les routines, le mur
// musical et les défis. La connexion de compte (morceau en cours, bande-son)
// reste propre à Spotify : voir spotify-connect.js.
// ============================================================
import { closeModal, esc, toast } from "./utils.js";
import { t } from "./i18n.js";

// ---------- Logos (à afficher à côté de tout contenu venu d'un service) ----------
// Logo Spotify (icône officielle, vert Spotify) : les consignes de marque
// Spotify imposent de l'afficher à côté de tout contenu issu de Spotify.
export const SPOTIFY_ICON = `<svg class="spotify-icon" viewBox="0 0 24 24" aria-label="Spotify" role="img"><path fill="#1DB954" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`;
export const APPLE_MUSIC_ICON = `<svg class="spotify-icon" viewBox="0 0 24 24" aria-label="Apple Music" role="img"><defs><linearGradient id="amg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FA5C74"/><stop offset="1" stop-color="#FA233B"/></linearGradient></defs><rect width="24" height="24" rx="5.5" fill="url(#amg)"/><path fill="#fff" d="M16.6 5.2v9.6a2.4 2.4 0 1 1-1.4-2.2V8.3l-5.2 1.1v6.7a2.4 2.4 0 1 1-1.4-2.2V7.2z"/></svg>`;
export const DEEZER_ICON = `<svg class="spotify-icon" viewBox="0 0 24 24" aria-label="Deezer" role="img"><rect width="24" height="24" rx="5.5" fill="#A238FF"/><g fill="#fff"><rect x="3.5" y="15.5" width="3" height="3" rx=".6"/><rect x="7.6" y="12.5" width="3" height="6" rx=".6"/><rect x="11.7" y="9" width="3" height="9.5" rx=".6"/><rect x="15.8" y="5.5" width="3" height="13" rx=".6"/></g></svg>`;

export const PROVIDERS = {
  spotify: { name: "Spotify", icon: SPOTIFY_ICON, search: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}` },
  apple: { name: "Apple Music", icon: APPLE_MUSIC_ICON, search: (q) => `https://music.apple.com/search?term=${encodeURIComponent(q)}` },
  deezer: { name: "Deezer", icon: DEEZER_ICON, search: (q) => `https://www.deezer.com/search/${encodeURIComponent(q)}` }
};

// ---------- Lecture des liens ----------
// Chaque analyseur n'accepte que les adresses officielles du service et
// reconstruit l'URL à partir du type et de l'identifiant : rien de ce que
// l'utilisateur tape n'est injecté tel quel dans la page.

// Spotify : open.spotify.com/{type}/{id}
export function parseSpotify(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "https:" || u.hostname !== "open.spotify.com") return null;
    const m = u.pathname.match(/^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|artist|album|track|user|show|episode)\/([A-Za-z0-9._-]{1,80})\/?$/i);
    if (!m) return null;
    const type = m[1].toLowerCase();
    return { provider: "spotify", type, id: m[2], url: `https://open.spotify.com/${type}/${m[2]}` };
  } catch (_) {
    return null;
  }
}

// Deezer : www.deezer.com/{langue}/{track|album|playlist|artist|profile}/{id}
export function parseDeezer(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "https:" || !["www.deezer.com", "deezer.com"].includes(u.hostname)) return null;
    const m = u.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|artist|profile)\/(\d{1,20})\/?$/i);
    if (!m) return null;
    const kind = m[1].toLowerCase();
    return { provider: "deezer", type: kind === "profile" ? "user" : kind, id: m[2], url: `https://www.deezer.com/${kind}/${m[2]}` };
  } catch (_) {
    return null;
  }
}

// Apple Music : music.apple.com/{pays}/{album|playlist|song|artist}/{nom}/{id}
// (un titre dans un album : …/album/{nom}/{id}?i={idTitre}) ; profils :
// music.apple.com/profile/{pseudo}.
export function parseApple(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "https:" || u.hostname !== "music.apple.com") return null;
    const prof = u.pathname.match(/^\/profile\/([A-Za-z0-9._-]{1,60})\/?$/);
    if (prof) return { provider: "apple", type: "user", id: prof[1], url: `https://music.apple.com/profile/${prof[1]}` };
    const m = u.pathname.match(/^\/([a-z]{2})\/(album|playlist|song|artist)\/(?:([A-Za-z0-9%._~-]{1,200})\/)?((?:pl\.(?:u-)?)?[A-Za-z0-9-]{1,80})\/?$/);
    if (!m) return null;
    const [, cc, kind, slug = "_", id] = m;
    if (kind === "playlist" ? !/^pl\./.test(id) : !/^\d+$/.test(id)) return null;
    const trackInAlbum = kind === "album" && /^\d{1,20}$/.test(u.searchParams.get("i") || "") ? u.searchParams.get("i") : null;
    const path = `/${cc}/${kind}/${slug}/${id}${trackInAlbum ? `?i=${trackInAlbum}` : ""}`;
    return {
      provider: "apple", country: cc,
      type: trackInAlbum || kind === "song" ? "track" : kind,
      id: trackInAlbum || id,
      url: `https://music.apple.com${path}`,
      embedPath: path
    };
  } catch (_) {
    return null;
  }
}

export function parseMusicLink(raw) {
  return parseSpotify(raw) || parseApple(raw) || parseDeezer(raw);
}

// Liens courts (spotify.link, link.deezer.com…) : illisibles sans les ouvrir.
export function shortLinkHint(raw) {
  return /(spotify\.link|link\.deezer\.com|deezer\.page\.link|apple\.co\/)/i.test(String(raw || ""))
    ? t("Les liens courts ne marchent pas : ouvre-le, puis copie l'adresse complète (open.spotify.com, music.apple.com ou deezer.com).")
    : "";
}

// Lien de playlist (ou d'album) valide, normalisé, sinon "".
export function normalizePlaylistUrl(raw) {
  const p = parseMusicLink(raw);
  return p && (p.type === "playlist" || p.type === "album") ? p.url : "";
}

// ---------- Lecteurs officiels intégrés ----------
const MINI = { spotify: 80, deezer: 92, apple: 175 };
function embedFullHeight(link) {
  if (link.type === "track") return link.provider === "apple" ? 175 : link.provider === "deezer" ? 150 : 152;
  return 352;
}

export function musicEmbed(linkOrUrl, height = null) {
  const link = typeof linkOrUrl === "string" ? parseMusicLink(linkOrUrl) : linkOrUrl;
  if (!link || link.type === "user") return "";
  const provider = PROVIDERS[link.provider];
  let h = height ?? embedFullHeight(link);
  if (link.provider === "spotify") {
    return `<iframe class="spotify-embed" src="https://open.spotify.com/embed/${link.type}/${encodeURIComponent(link.id)}?theme=0" height="${h}" frameborder="0" loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" title="${t("Lecteur {service}", { service: provider.name })}"></iframe>`;
  }
  if (link.provider === "deezer") {
    h = Math.max(h, MINI.deezer);
    return `<iframe class="spotify-embed" src="https://widget.deezer.com/widget/dark/${link.type}/${encodeURIComponent(link.id)}" height="${h}" frameborder="0" loading="lazy"
      allow="encrypted-media; clipboard-write" title="${t("Lecteur {service}", { service: provider.name })}"></iframe>`;
  }
  h = Math.max(h, MINI.apple);
  return `<iframe class="spotify-embed" src="https://embed.music.apple.com${link.embedPath}" height="${h}" frameborder="0" loading="lazy"
    allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write"
    sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
    title="${t("Lecteur {service}", { service: provider.name })}"></iframe>`;
}
// Ancien nom, conservé : accepte désormais les trois services.
export const spotifyEmbed = musicEmbed;

export const providerIcon = (linkOrProvider) => PROVIDERS[typeof linkOrProvider === "string" ? linkOrProvider : linkOrProvider?.provider]?.icon || "";
export const providerName = (linkOrProvider) => PROVIDERS[typeof linkOrProvider === "string" ? linkOrProvider : linkOrProvider?.provider]?.name || "";

// ---------- Service de musique préféré (profil) ----------
// Mémorisé par compte (changement de compte sans rechargement).
let myProvider, myProviderUid = null;
export function setMyProvider(p) { myProvider = PROVIDERS[p] ? p : ""; }
export async function getMyProvider() {
  const db = await import("./db.js");
  const uid = db.getCurrentUser()?.uid || null;
  if (myProvider !== undefined && myProviderUid === uid) return myProvider;
  myProviderUid = uid;
  try {
    const prof = uid ? await db.getProfile(uid) : null;
    myProvider = PROVIDERS[prof?.music?.provider] ? prof.music.provider : "";
  } catch (_) { myProvider = ""; }
  return myProvider;
}

// ---------- Retrouver un titre sur un autre service ----------
// Recherches publiques et gratuites d'Apple (iTunes Search API) et de
// Deezer (API publique), sans compte. Les playlists ne se convertissent
// pas (propres à chaque service). Rien n'est enregistré.
function jsonp(url, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const cb = `__sc_jsonp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const script = document.createElement("script");
    const done = (fn, v) => { clearTimeout(timer); delete window[cb]; script.remove(); fn(v); };
    const timer = setTimeout(() => done(reject, new Error("timeout")), timeoutMs);
    window[cb] = (data) => done(resolve, data);
    script.onerror = () => done(reject, new Error("network"));
    script.src = url + (url.includes("?") ? "&" : "?") + `callback=${cb}`;
    document.head.appendChild(script);
  });
}

// Titre et artiste d'un lien (null si inconnu).
export async function describeLink(link) {
  try {
    if (link.provider === "deezer") {
      const d = await jsonp(`https://api.deezer.com/${link.type}/${link.id}?output=jsonp`);
      if (d?.error) return null;
      return { kind: link.type, title: d.title || d.name || "", artist: d.artist?.name || (link.type === "artist" ? d.name : "") };
    }
    if (link.provider === "apple") {
      const d = await jsonp(`https://itunes.apple.com/lookup?id=${encodeURIComponent(link.id)}&country=${link.country || "fr"}`);
      const r = d?.results?.[0];
      if (!r) return null;
      return { kind: link.type, title: r.trackName || r.collectionName || r.artistName || "", artist: link.type === "artist" ? "" : r.artistName || "" };
    }
    if (link.provider === "spotify") {
      const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(link.url)}`);
      if (!res.ok) return null;
      const d = await res.json();
      return { kind: link.type, title: d.title || "", artist: "" };
    }
  } catch (_) { /* service injoignable */ }
  return null;
}

// Meilleure correspondance sur le service `target` pour { kind, title, artist }.
export async function findOn(target, info) {
  const q = [info.title, info.artist].filter(Boolean).join(" ").trim();
  if (!q) return null;
  try {
    if (target === "deezer") {
      const kind = info.kind === "artist" ? "artist" : info.kind === "album" ? "album" : "track";
      const d = await jsonp(`https://api.deezer.com/search/${kind}?q=${encodeURIComponent(q)}&limit=1&output=jsonp`);
      return d?.data?.[0]?.link || null;
    }
    if (target === "apple") {
      const entity = info.kind === "artist" ? "musicArtist" : info.kind === "album" ? "album" : "song";
      const country = (navigator.language || "fr").split("-")[1]?.toLowerCase() || "fr";
      const d = await jsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=${entity}&limit=1&country=${country}`);
      const r = d?.results?.[0];
      return r?.trackViewUrl || r?.collectionViewUrl || r?.artistLinkUrl || null;
    }
  } catch (_) { /* recherche indisponible */ }
  return null;
}

// Ouvre le titre sur le service préféré (fenêtre ouverte tout de suite pour
// ne pas être bloquée, puis redirigée quand la recherche répond).
export async function openOnMyService(target, { link = null, text = "", kind = "track" } = {}) {
  const provider = PROVIDERS[target];
  if (!provider) return;
  const win = window.open("", "_blank");
  let url = null;
  let info = link ? await describeLink(link) : null;
  if (!info && text) {
    const [title, ...rest] = kind === "artist" ? [text] : text.split(/\s+[-–—]\s+/);
    info = { kind, title, artist: rest.join(" ") };
  }
  if (info) url = await findOn(target, info);
  if (!url) url = info ? provider.search([info.title, info.artist].filter(Boolean).join(" ")) : null;
  if (!url) { win?.close(); toast(t("Impossible de retrouver ce titre sur {service}.", { service: provider.name })); return; }
  if (win) win.location.href = url; else window.open(url, "_blank");
}

// ---------- Lecteur ancré ----------
// Lecteur ancré au-dessus de la barre d'onglets (hors des fenêtres
// modales) : on peut le réduire, l'agrandir et changer d'onglet sans couper
// la musique. Réduire/agrandir ne fait que changer la hauteur de l'iframe,
// qui n'est jamais rechargée ; seul ✕ arrête la lecture.
export async function openMusicPlayer(url, title = t("Écouter")) {
  const link = parseMusicLink(url);
  if (!link || link.type === "user") return;
  closeModal();
  let dock = document.getElementById("spotify-dock");
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "spotify-dock";
    document.body.appendChild(dock);
  }
  const provider = PROVIDERS[link.provider];
  const mine = await getMyProvider();
  const canConvert = mine && mine !== link.provider && link.type !== "playlist";
  dock.innerHTML = `
    <div class="spotify-dock-bar">
      <span class="spotify-dock-title">${provider.icon} ${esc(title)}</span>
      <span class="spotify-dock-actions">
        ${canConvert ? `<button id="sp-convert" title="${t("Chercher sur {service}", { service: PROVIDERS[mine].name })}">${PROVIDERS[mine].icon}</button>` : ""}
        <a href="${esc(link.url)}" target="_blank" rel="noopener" title="${t("Ouvrir dans {service}", { service: provider.name })}">↗</a>
        <button id="sp-toggle" title="${t("Réduire")}">▾</button>
        <button id="sp-close" title="${t("Fermer le lecteur")}">✕</button>
      </span>
    </div>
    ${musicEmbed(link, embedFullHeight(link)).replace('loading="lazy"', "")}`;
  const iframe = dock.querySelector("iframe");
  const fullHeight = embedFullHeight(link);
  const miniHeight = Math.min(fullHeight, MINI[link.provider]);
  const toggle = dock.querySelector("#sp-toggle");
  const setMini = (mini) => {
    iframe.height = mini ? miniHeight : fullHeight;
    dock.classList.toggle("mini", mini);
    toggle.textContent = mini ? "▴" : "▾";
    toggle.title = mini ? t("Agrandir") : t("Réduire");
    // Le minuteur de repos et le bas de page se placent au-dessus du lecteur.
    document.body.style.setProperty("--dock-h", dock.offsetHeight + "px");
  };
  toggle.onclick = () => setMini(!dock.classList.contains("mini"));
  const convert = dock.querySelector("#sp-convert");
  if (convert) convert.onclick = () => openOnMyService(mine, { link });
  dock.querySelector("#sp-close").onclick = () => {
    dock.remove();
    document.body.classList.remove("has-spotify-dock");
    document.body.style.removeProperty("--dock-h");
  };
  document.body.classList.add("has-spotify-dock");
  setMini(false);
}
// Ancien nom, conservé.
export const openSpotifyPlayer = openMusicPlayer;

// ---------- Morceaux ----------
// Morceau saisi par l'utilisateur :
//   - un lien de titre (Spotify, Apple Music, Deezer) -> on ne garde que le lien ;
//   - sinon "Titre - Artiste" en texte libre.
// Les morceaux venant de la connexion Spotify ne sont jamais recopiés
// (titre, artiste) : on ne garde que leur lien, et c'est le lecteur
// officiel du service qui les affiche.
export function parseSongInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const link = parseMusicLink(text);
  if (link) return link.type === "track" ? { url: link.url, source: "link" } : null;
  if (/^https?:\/\//i.test(text)) return null;
  const [title, ...rest] = text.split(/\s+[-–—]\s+/);
  return { title: title.slice(0, 100), artist: rest.join(" - ").slice(0, 100), url: "" };
}

export function songLabel(song) {
  if (!song) return "";
  if (song.title) return song.artist ? `${song.title} — ${song.artist}` : song.title;
  const link = parseMusicLink(song.url);
  return link ? t("Écouter sur {service}", { service: providerName(link) }) : "";
}

// Morceau en ligne (feed, listes) : texte saisi (cliquable : recherche sur
// son service), ou lien avec le logo du service.
export function songHtml(song) {
  const link = parseMusicLink(song?.url);
  if (song?.title) {
    return link ? `<span class="song-link" data-song-url="${esc(link.url)}">${esc(songLabel(song))}</span>`
      : `<span class="song-link" data-song-query="${esc(songLabel(song).replace(" — ", " - "))}">${esc(songLabel(song))}</span>`;
  }
  return link ? `<span class="song-link spotify-attrib" data-song-url="${esc(link.url)}">${providerIcon(link)} ${t("Écouter le morceau")}</span>` : "";
}

// Morceau en grand (détail d'une séance) : lecteur compact pour un lien,
// sinon le texte saisi.
export function songBlockHtml(song) {
  const link = parseMusicLink(song?.url);
  if (link && link.type === "track" && !song.title) return musicEmbed(link, MINI[link.provider]);
  return songHtml(song);
}

export function bindSongLinks(root) {
  root.querySelectorAll("[data-song-url]").forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); openMusicPlayer(el.dataset.songUrl, t("Morceau")); };
  });
  root.querySelectorAll("[data-playlist-url]").forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); openMusicPlayer(el.dataset.playlistUrl, el.dataset.playlistTitle || t("Playlist")); };
  });
  // Morceau saisi en texte : le chercher sur son service (Spotify par défaut).
  root.querySelectorAll("[data-song-query]").forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const target = (await getMyProvider()) || "spotify";
      if (target === "spotify") window.open(PROVIDERS.spotify.search(el.dataset.songQuery), "_blank");
      else openOnMyService(target, { text: el.dataset.songQuery });
    };
  });
}
