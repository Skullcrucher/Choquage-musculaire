// ============================================================
// SONS — bips de fin de repos quand l'app est à l'écran (Web Audio, rien
// à télécharger). Le navigateur n'autorise le son qu'après un geste :
// unlockAudio() est appelé au toucher d'une série validée.
// Le son des notifications (app en arrière-plan, écran verrouillé) est
// celui du système : il se règle dans les réglages du téléphone.
// ============================================================
const LS_SOUND = "skullcrusher_rest_sound";
let ctx = null;

export function restSoundEnabled() {
  try { return localStorage.getItem(LS_SOUND) !== "0"; } catch (_) { return true; }
}
export function setRestSoundEnabled(on) {
  try { localStorage.setItem(LS_SOUND, on ? "1" : "0"); } catch (_) {}
}

export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === "suspended") ctx.resume();
  } catch (_) {}
}

// Un bip : fréquence (Hz), durée (s), départ décalé (s).
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
  unlockAudio();
  return !!ctx && ctx.state !== "closed";
}

// Petit « tic » des 3 dernières secondes.
export function playCountdownTick() {
  if (!ready()) return;
  beep(660, 0.08, 0, 0.18);
}

// Fin du repos : deux bips courts puis un long, plus aigu.
export function playRestEnd() {
  if (!ready()) return;
  beep(880, 0.12, 0);
  beep(880, 0.12, 0.2);
  beep(1320, 0.45, 0.4);
}
