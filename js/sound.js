// ============================================================
// SONS DE FIN DE REPOS
//  - App à l'écran : tic des 3 dernières secondes (Web Audio) puis le son
//    de fin de repos (sounds/rest-end.mp3).
//  - Écran verrouillé : le téléphone suspend l'app, aucun minuteur ne
//    tourne. Au verrouillage pendant un repos, on lance donc une piste
//    audio préparée à l'avance : silence jusqu'à la fin du repos, puis le
//    son. Elle continue de jouer écran verrouillé et s'affiche comme un
//    lecteur (exercice, série, barre de progression du repos). Revers :
//    comme tout lecteur audio, elle met en pause la musique d'une autre
//    app (Spotify…) pendant le repos. Réglage « Son écran verrouillé ».
// Le navigateur n'autorise le son qu'après un geste : unlockAudio() est
// appelé au toucher d'une série validée.
// ============================================================
const LS_SOUND = "skullcrusher_rest_sound";
const LS_LOCK_SOUND = "skullcrusher_lock_sound";
const SOUND_URL = "sounds/rest-end.mp3";
const RATE = 16000; // piste d'écran verrouillé : mono 16 kHz (léger)
let ctx = null, buffer = null, loading = null, lockEl = null, lockUrl = null;

const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
export const restSoundEnabled = () => get(LS_SOUND) !== "0";
export const setRestSoundEnabled = (on) => set(LS_SOUND, on ? "1" : "0");
export const lockSoundEnabled = () => get(LS_LOCK_SOUND) !== "0";
export const setLockSoundEnabled = (on) => set(LS_LOCK_SOUND, on ? "1" : "0");

function audioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = ctx || new AC();
  return ctx;
}

async function loadBuffer() {
  if (buffer) return buffer;
  if (!loading) {
    loading = (async () => {
      const c = audioCtx();
      if (!c) return null;
      const data = await (await fetch(SOUND_URL)).arrayBuffer();
      buffer = await new Promise((ok, ko) => c.decodeAudioData(data, ok, ko));
      return buffer;
    })().catch(e => { console.warn("[Skullcrusher] Son de fin de repos", e); loading = null; return null; });
  }
  return loading;
}

// À appeler pendant un geste (toucher) : débloque le son pour la suite.
export function unlockAudio() {
  try {
    const c = audioCtx();
    if (c && c.state === "suspended") c.resume();
    loadBuffer();
    // Élément audio de l'écran verrouillé : un play() pendant le geste
    // autorise les suivants (iOS).
    if (!lockEl) { lockEl = new Audio(); lockEl.preload = "auto"; lockEl.setAttribute("playsinline", ""); }
    if (lockEl.paused && !lockEl.src) {
      lockEl.src = silentWavUrl();
      lockEl.play().then(() => lockEl.pause()).catch(() => {});
    }
  } catch (_) {}
}

function beep(freq, dur, at = 0, vol = 0.35) {
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function ready() {
  if (!restSoundEnabled() || document.hidden) return false;
  // Safari : son bref qui baisse la musique en cours au lieu de l'arrêter.
  try { if (navigator.audioSession) navigator.audioSession.type = "transient"; } catch (_) {}
  const c = audioCtx();
  if (c?.state === "suspended") c.resume();
  return !!c && c.state !== "closed";
}

// Petit « tic » des 3 dernières secondes.
export function playCountdownTick() {
  if (!ready()) return;
  beep(660, 0.08, 0, 0.18);
}

// Fin du repos (app à l'écran) : le son choisi, ou des bips en secours.
export async function playRestEnd() {
  if (!ready()) return;
  const buf = await loadBuffer();
  if (buf && ctx) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  } else {
    beep(880, 0.12, 0); beep(880, 0.12, 0.2); beep(1320, 0.45, 0.4);
  }
}

// ---------- Piste d'écran verrouillé ----------
function wavUrl(samples) {
  const n = samples.length, bytes = new ArrayBuffer(44 + n * 2), v = new DataView(bytes);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}
function silentWavUrl() { return wavUrl(new Float32Array(RATE / 10)); }

// Son rééchantillonné en mono 16 kHz.
function soundSamples(buf) {
  const ratio = buf.sampleRate / RATE, len = Math.floor(buf.length / ratio);
  const chans = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    let s = 0;
    for (const ch of chans) s += (ch[i0] || 0) * (1 - f) + (ch[i0 + 1] || 0) * f;
    out[i] = s / chans.length;
  }
  return out;
}

// Écran verrouillé pendant un repos : silence jusqu'à endMs, puis le son.
// info : { title, artist } affichés sur l'écran verrouillé.
export async function armLockSound(endMs, totalSec, info = {}) {
  if (!lockSoundEnabled() || !restSoundEnabled() || !lockEl) return false;
  const buf = await loadBuffer();
  const remaining = (endMs - Date.now()) / 1000;
  if (!buf || remaining <= 0.5) return false;
  const snd = soundSamples(buf);
  const silence = Math.floor(remaining * RATE);
  const all = new Float32Array(silence + snd.length);
  all.set(snd, silence);
  disarmLockSound();
  lockUrl = wavUrl(all);
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (_) {}
  lockEl.src = lockUrl;
  lockEl.currentTime = 0;
  try {
    await lockEl.play();
  } catch (e) { console.warn("[Skullcrusher] Son écran verrouillé refusé", e); return false; }
  // Lecteur sur l'écran verrouillé : exercice / série et progression du repos.
  try {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: info.title || "Repos", artist: info.artist || "", album: "Skullcrusher",
        artwork: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }]
      });
      const total = Math.max(remaining, totalSec || remaining);
      navigator.mediaSession.setPositionState?.({ duration: total + snd.length / RATE, position: Math.max(0, total - remaining), playbackRate: 1 });
    }
  } catch (_) {}
  return true;
}

export function disarmLockSound() {
  try {
    if (lockEl && !lockEl.paused) lockEl.pause();
    if (lockUrl) { URL.revokeObjectURL(lockUrl); lockUrl = null; }
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    if (navigator.audioSession) navigator.audioSession.type = "auto";
  } catch (_) {}
}
export const _lockElForTests = () => lockEl;
