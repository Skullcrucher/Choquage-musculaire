// ============================================================
// CONNEXION SPOTIFY (facultative) — OAuth "PKCE", sans serveur
//
// Deux façons de se connecter :
//   - l'app Spotify partagée (SPOTIFY_CLIENT_ID, spotify-config.js) : en
//     mode développement, Spotify la limite à 5 comptes ajoutés à la main
//     par son propriétaire ;
//   - sa propre app Spotify : chacun crée la sienne sur le tableau de bord
//     développeurs de Spotify et saisit son Client ID dans Réglages. Il en
//     est propriétaire, donc aucune liste à tenir par l'administrateur.
//
// Sert à deux choses : proposer le morceau en cours comme "son du record",
// et enregistrer les morceaux écoutés pendant la séance (bande-son).
// Le jeton de rafraîchissement est rangé dans user_private/{uid} (lisible
// par son seul propriétaire) : connecté une fois, depuis Safari par
// exemple, Spotify marche aussi dans l'app installée et sur les autres
// appareils.
// ============================================================
import * as db from "./db.js";
import { SPOTIFY_CLIENT_ID } from "./spotify-config.js";
import { t } from "./i18n.js";

const SCOPES = "user-read-currently-playing user-read-recently-played";
const LS_VERIFIER = "skullcrusher_spotify_verifier";
const LS_STATE = "skullcrusher_spotify_state";
const LS_CLIENT = "skullcrusher_spotify_client";
let access = null; // { token, expiresAt }

export const SHARED_CLIENT_ID = SPOTIFY_CLIENT_ID;

export function isValidClientId(id) {
  return /^[0-9a-f]{32}$/i.test(String(id || "").trim());
}

// Client ID propre à l'utilisateur (s'il en a saisi un), sinon celui de l'app partagée.
export async function getClientSettings() {
  const priv = await db.getPrivateData().catch(() => null);
  const own = isValidClientId(priv?.spotify_client_id) ? priv.spotify_client_id : "";
  return { own, clientId: own || SHARED_CLIENT_ID || "" };
}

export async function setOwnClientId(id) {
  const value = String(id || "").trim();
  if (value && !isValidClientId(value)) throw new Error(t("Client ID invalide : 32 caractères (chiffres et lettres a à f)."));
  await db.setPrivateData({ spotify_client_id: value || null });
}

export function redirectUri() {
  return new URL("./", location.href).href;
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function connectSpotify() {
  const { clientId } = await getClientSettings();
  if (!clientId) throw new Error(t("Aucune app Spotify configurée : saisis le Client ID de ta propre app Spotify."));
  localStorage.setItem(LS_CLIENT, clientId);
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  localStorage.setItem(LS_VERIFIER, verifier);
  localStorage.setItem(LS_STATE, state);
  const params = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: redirectUri(),
    code_challenge_method: "S256", code_challenge: challenge, scope: SCOPES, state
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(clientId, body) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, ...body })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Spotify ${res.status}`);
  return data;
}

// Le jeton est lié à l'app Spotify qui l'a délivré : on garde son Client ID avec.
async function saveTokens(clientId, data, previousRefresh = null) {
  access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  const refresh = data.refresh_token || previousRefresh;
  if (refresh && refresh !== previousRefresh) {
    await db.setPrivateData({ spotify_refresh_token: refresh, spotify_token_client_id: clientId, spotify_connected_at: new Date().toISOString() });
  }
}

// Retour de Spotify (?code=...&state=...) : à appeler une fois connecté à
// l'app. Renvoie un message à afficher, ou null s'il n'y avait rien à faire.
export async function handleSpotifyRedirect() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (!code && !error) return null;
  url.searchParams.delete("code"); url.searchParams.delete("state"); url.searchParams.delete("error");
  history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  if (error) {
    return error === "access_denied"
      ? t("Connexion Spotify refusée. Si l'app Spotify partagée ne t'est pas ouverte, utilise ta propre app Spotify (Réglages → 🎧 Spotify).")
      : t("Connexion Spotify impossible ({error}).", { error });
  }
  const verifier = localStorage.getItem(LS_VERIFIER);
  if (!verifier || state !== localStorage.getItem(LS_STATE)) {
    return t("Connexion Spotify impossible ici : relance « Connecter Spotify » depuis cette même fenêtre (sur iPhone, depuis Safari).");
  }
  const clientId = localStorage.getItem(LS_CLIENT) || (await getClientSettings()).clientId;
  localStorage.removeItem(LS_VERIFIER); localStorage.removeItem(LS_STATE); localStorage.removeItem(LS_CLIENT);
  try {
    await saveTokens(clientId, await tokenRequest(clientId, { grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier }));
    return t("Spotify connecté") + " 🎧";
  } catch (e) {
    console.error("[Skullcrusher] Échange du code Spotify", e);
    return t("Connexion Spotify échouée : {error}", { error: e.message });
  }
}

export async function isSpotifyConnected() {
  try { return !!(await db.getPrivateData())?.spotify_refresh_token; } catch (_) { return false; }
}

// Changement d'app Spotify : l'ancien jeton ne vaut plus, on l'oublie
// (sans toucher aux séances).
export async function forgetToken() {
  access = null;
  await db.setPrivateData({ spotify_refresh_token: null, spotify_token_client_id: null });
}

// Déconnexion : jeton + données Spotify stockées dans les séances effacés.
export async function disconnectSpotify() {
  access = null;
  return db.purgeSpotifyData();
}

async function getAccessToken() {
  if (access && access.expiresAt > Date.now()) return access.token;
  const priv = await db.getPrivateData();
  const refresh = priv?.spotify_refresh_token;
  if (!refresh) return null;
  const clientId = priv.spotify_token_client_id || SHARED_CLIENT_ID;
  try {
    await saveTokens(clientId, await tokenRequest(clientId, { grant_type: "refresh_token", refresh_token: refresh }), refresh);
    return access.token;
  } catch (e) {
    console.warn("[Skullcrusher] Jeton Spotify expiré ou révoqué :", e);
    if (/invalid_grant|revoked/i.test(e.message)) await db.setPrivateData({ spotify_refresh_token: null });
    return null;
  }
}

async function api(path) {
  const token = await getAccessToken();
  if (!token) return null;
  const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify ${res.status}`);
  return res.json();
}

function toSong(track) {
  if (!track) return null;
  return {
    title: String(track.name || "").slice(0, 100),
    artist: (track.artists || []).map(a => a.name).join(", ").slice(0, 100),
    url: track.external_urls?.spotify || (track.id ? `https://open.spotify.com/track/${track.id}` : "")
  };
}

// Morceau en cours d'écoute, ou null.
export async function getNowPlaying() {
  try {
    const data = await api("/me/player/currently-playing");
    return data?.item && data.currently_playing_type === "track" ? toSong(data.item) : null;
  } catch (e) {
    console.warn("[Skullcrusher] Morceau en cours indisponible :", e);
    return null;
  }
}

// Morceaux écoutés depuis sinceMs (bande-son de la séance), sans doublons.
export async function getTracksSince(sinceMs) {
  try {
    const data = await api(`/me/player/recently-played?limit=50&after=${Math.floor(sinceMs)}`);
    const seen = new Set();
    return (data?.items || [])
      .sort((a, b) => a.played_at.localeCompare(b.played_at))
      .map(i => toSong(i.track))
      .filter(s => s && s.url && !seen.has(s.url) && seen.add(s.url))
      .slice(0, 40);
  } catch (e) {
    console.warn("[Skullcrusher] Morceaux écoutés indisponibles :", e);
    return [];
  }
}

// Recherche d'artistes (profil) : null si Spotify n'est pas connecté.
export async function searchArtists(query) {
  const data = await api(`/search?type=artist&limit=8&q=${encodeURIComponent(query)}`);
  if (!data) return null;
  return (data.artists?.items || []).map(a => ({
    name: String(a.name || "").slice(0, 60),
    url: a.external_urls?.spotify || `https://open.spotify.com/artist/${a.id}`,
    image: (a.images || []).slice(-1)[0]?.url || "",
    sub: (a.genres || []).slice(0, 2).join(", ")
  }));
}
