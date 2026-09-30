// ============================================================
// SON DE FIN DE REPOS (sounds/rest-end.mp3), sans bips.
//  - Dès le début du repos, le son est programmé dans le moteur audio
//    (Web Audio) pour l'heure de fin : il se mélange à la musique d'une
//    autre app sans la couper ni la baisser (catégorie « ambient »).
//    Android : il continue de jouer écran verrouillé. iPhone : iOS coupe
//    ce type de son quand l'écran est verrouillé — la notification de fin
//    de repos (son du système, par-dessus la musique) prend le relais.
//  - Mode « garanti » (réglage) : au verrouillage, piste silence + son
//    lue comme un lecteur audio. Joue écran verrouillé partout, mais met
//    en pause la musique d'une autre app pendant le repos.
// Le navigateur n'autorise le son qu'après un geste : unlockAudio() est
// appelé au toucher d'une série validée.
// ============================================================
const LS_SOUND = "skullcrusher_rest_sound";
const LS_LOCK_SOUND = "skullcrusher_lock_sound"; // ancien réglage (0 = désactivé)
const LS_LOCK_MODE = "skullcrusher_lock_sound_mode"; // "mix" | "exclusive" | "off"
const SOUND_URL = "sounds/rest-end.mp3";
const RATE = 16000; // piste d'écran verrouillé : mono 16 kHz (léger)
let ctx = null, buffer = null, loading = null, lockEl = null, lockUrl = null;

const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
export const restSoundEnabled = () => get(LS_SOUND) !== "0";
export const setRestSoundEnabled = (on) => set(LS_SOUND, on ? "1" : "0");
export function lockSoundMode() {
  const m = get(LS_LOCK_MODE);
  if (m === "mix" || m === "exclusive" || m === "off") return m;
  return get(LS_LOCK_SOUND) === "0" ? "off" : "mix";
}
export const setLockSoundMode = (m) => set(LS_LOCK_MODE, m);
const lockSoundEnabled = () => lockSoundMode() === "exclusive";

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
    // Élément audio de l'écran verrouillé (mode garanti seulement : un
    // lecteur audio couperait la musique) : un play() pendant le geste
    // autorise les suivants (iOS).
    if (lockSoundMode() !== "exclusive") return;
    if (!lockEl) { lockEl = new Audio(); lockEl.preload = "auto"; lockEl.setAttribute("playsinline", ""); }
    if (lockEl.paused && !lockEl.src) {
      lockEl.src = silentWavUrl();
      lockEl.play().then(() => lockEl.pause()).catch(() => {});
    }
  } catch (_) {}
}

function ready(type = "ambient") {
  if (!restSoundEnabled()) return false;
  // « ambient » : se mélange à la musique d'une autre app sans la couper.
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (_) {}
  const c = audioCtx();
  if (c?.state === "suspended") c.resume();
  return !!c && c.state !== "closed";
}

// Joue le son tout de suite (test dans les réglages, reprise après
// rechargement de l'app).
export async function playRestEnd() {
  if (document.hidden || !ready()) return;
  const buf = await loadBuffer();
  if (!buf || !ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

// Programme le son pour endMs (remplace la programmation précédente).
let scheduled = null, scheduledEnd = 0;
export async function scheduleRestSound(endMs) {
  cancelRestSound();
  if (!ready()) return false;
  const buf = await loadBuffer();
  if (!buf || !ctx) return false;
  const delay = (endMs - Date.now()) / 1000;
  if (delay < 0) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(ctx.currentTime + delay);
  scheduled = src; scheduledEnd = endMs;
  src.onended = () => { if (scheduled === src) scheduled = null; };
  return true;
}
export function cancelRestSound() {
  try { scheduled?.stop(); } catch (_) {}
  scheduled = null; scheduledEnd = 0;
}
// Le son de cette fin de repos est-il programmé (donc déjà joué / en cours) ?
export const restSoundScheduledFor = (endMs) => !!endMs && Math.abs(scheduledEnd - endMs) < 1000;

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
  cancelRestSound();
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
