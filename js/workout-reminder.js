// ============================================================
// RAPPEL DE SÉANCE OUVERTE — une séance oubliée (pas terminée) reste
// ouverte des heures. Sans gêner pendant l'entraînement, on ne rappelle
// qu'après une longue période sans activité (1 h par défaut, réglable) :
//   - app ouverte : un bandeau « séance toujours ouverte » (Terminer /
//     Je continue), jamais une fenêtre bloquante ;
//   - app fermée : une notification push (si les notifications du
//     minuteur sont activées), reprogrammée à chaque série.
// ============================================================
import { t } from "./i18n.js";
import { esc } from "./utils.js";

const LS_MIN = "skullcrusher_reminder_min";
const LS_ID = "skullcrusher_active_workout_id";
const LS_STATE = "skullcrusher_active_workout_state";
export const REMINDER_CHOICES = [0, 45, 60, 90, 120];

export function reminderMinutes() {
  try {
    const v = parseInt(localStorage.getItem(LS_MIN) ?? "60", 10);
    return REMINDER_CHOICES.includes(v) ? v : 60;
  } catch (_) { return 60; }
}
export function setReminderMinutes(min) {
  try { localStorage.setItem(LS_MIN, String(min)); } catch (_) {}
}

// Dernière activité : dernière action enregistrée, sinon dernière série,
// sinon début de séance.
export function lastActivityMs(w) {
  const times = [w?.last_activity, w?.start_time, ...(w?.exercises || []).flatMap(ex => (ex.sets || []).map(s => s.logged_at))]
    .map(x => Date.parse(x || "")).filter(Number.isFinite);
  return times.length ? Math.max(...times) : Date.now();
}

function readActive() {
  try {
    if (!localStorage.getItem(LS_ID)) return null;
    return JSON.parse(localStorage.getItem(LS_STATE) || "null");
  } catch (_) { return null; }
}

const loadSync = () => import("./timer-sync.js").catch(() => null);
let armedFor = 0;

// Programme (ou décale) la notification de rappel. Appelé à chaque action.
export function armReminder(w) {
  const min = reminderMinutes();
  if (!w || !min) { clearReminder(); return; }
  const at = lastActivityMs(w) + min * 60000;
  if (Math.abs(at - armedFor) < 2 * 60000) return; // pas une requête par frappe
  armedFor = at;
  loadSync().then(m => m?.scheduleReminderPush(at,
    "⏰ " + t("Séance toujours ouverte"),
    t("« {title} » est ouverte sans nouvelle série depuis {min} min. Pense à la terminer (ou à l'annuler).", { title: w.title || t("Séance"), min })));
}

export function clearReminder() {
  armedFor = 0;
  loadSync().then(m => m?.cancelReminderPush());
}

function fmtIdle(ms) {
  const min = Math.round(ms / 60000);
  return min < 60 ? t("{n} min", { n: min }) : t("{h} h {m}", { h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") });
}

// Bandeau discret en haut de l'écran si la séance est ouverte et inactive
// depuis trop longtemps. onFinish() mène à l'écran de fin de séance.
export function updateForgottenBanner(onFinish) {
  document.getElementById("forgot-banner")?.remove();
  const min = reminderMinutes();
  const w = readActive();
  if (!min || !w) return;
  const idle = Date.now() - lastActivityMs(w);
  if (idle < min * 60000) return;
  const view = document.getElementById("view");
  if (!view) return;
  const el = document.createElement("div");
  el.id = "forgot-banner";
  el.className = "forgot-banner";
  el.innerHTML = `
    <div class="forgot-text">⏰ ${t("« {title} » est toujours ouverte — aucune série depuis {idle}.", { title: esc(w.title || t("Séance")), idle: fmtIdle(idle) })}</div>
    <div class="forgot-actions">
      <button class="btn btn-sm btn-primary" id="forgot-finish">${t("Terminer")}</button>
      <button class="btn btn-sm btn-secondary" id="forgot-keep">${t("Je continue")}</button>
    </div>`;
  view.prepend(el);
  el.querySelector("#forgot-finish").onclick = () => { el.remove(); onFinish(); };
  el.querySelector("#forgot-keep").onclick = () => {
    // Repousse le rappel d'une période complète.
    try {
      const st = JSON.parse(localStorage.getItem(LS_STATE) || "null");
      if (st) { st.last_activity = new Date().toISOString(); localStorage.setItem(LS_STATE, JSON.stringify(st)); armReminder(st); }
    } catch (_) {}
    window.dispatchEvent(new Event("sc:workout-activity"));
    el.remove();
  };
}
