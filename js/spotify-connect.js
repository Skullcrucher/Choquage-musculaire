// ============================================================
// CONNEXION SPOTIFY (facultative) — OAuth "PKCE", sans serveur
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

const SCOPES = "user-read-currently-playing user-read-recently-played";
const LS_VERIFIER = "skullcrusher_spotify_verifier";
const LS_STATE = "skullcrusher_spotify_state";
let access = null; // { token, expiresAt }

export function spotifyConfigured() {
  return !!SPOTIFY_CLIENT_ID;
}

function redirectUri() {
  return new URL("./", location.href).href;
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function connectSpotify() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  localStorage.setItem(LS_VERIFIER, verifier);
  localStorage.setItem(LS_STATE, state);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: redirectUri(),
    code_challenge_method: "S256", code_challenge: challenge, scope: SCOPES, state
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...body })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Spotify ${res.status}`);
  return data;
}

async function saveTokens(data, previousRefresh = null) {
  access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  const refresh = data.refresh_token || previousRefresh;
  if (refresh && refresh !== previousRefresh) await db.setPrivateData({ spotify_refresh_token: refresh, spotify_connected_at: new Date().toISOString() });
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
  if (error) return "Connexion Spotify annulée.";
  const verifier = localStorage.getItem(LS_VERIFIER);
  if (!verifier || state !== localStorage.getItem(LS_STATE)) {
    return "Connexion Spotify impossible ici : relance « Connecter Spotify » depuis cette même fenêtre (sur iPhone, depuis Safari).";
  }
  localStorage.removeItem(LS_VERIFIER); localStorage.removeItem(LS_STATE);
  try {
    await saveTokens(await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier }));
    return "Spotify connecté 🎧";
  } catch (e) {
    console.error("[Skullcrusher] Échange du code Spotify", e);
    return `Connexion Spotify échouée : ${e.message}`;
  }
}

export async function isSpotifyConnected() {
  if (!spotifyConfigured()) return false;
  try { return !!(await db.getPrivateData())?.spotify_refresh_token; } catch (_) { return false; }
}

// Déconnexion : jeton + données Spotify stockées dans les séances effacés.
export async function disconnectSpotify() {
  access = null;
  return db.purgeSpotifyData();
}

async function getAccessToken() {
  if (access && access.expiresAt > Date.now()) return access.token;
  const refresh = (await db.getPrivateData())?.spotify_refresh_token;
  if (!refresh) return null;
  try {
    await saveTokens(await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh }), refresh);
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
  if (!spotifyConfigured()) return null;
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
  if (!spotifyConfigured()) return [];
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
