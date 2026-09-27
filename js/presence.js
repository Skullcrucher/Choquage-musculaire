// ============================================================
// STATUT « À LA SALLE » — pendant une séance en cours, tes amis voient
// dans le feed que tu t'entraînes (depuis quand, quelle séance).
// Réglage général dans le profil (Montrer quand je suis à la salle),
// modifiable pour chaque séance depuis l'écran de séance.
// Le statut s'efface à la fin (ou à l'annulation) de la séance ; sans
// signe de vie depuis 25 min (séance oubliée, app fermée), il n'est plus
// affiché.
// ============================================================
import * as db from "./db.js";
import { t } from "./i18n.js";
import { esc, safeImageUrl } from "./utils.js";

const LS_DEFAULT = "skullcrusher_presence_default";
const STALE_MS = 25 * 60 * 1000;
const MAX_SESSION_MS = 5 * 3600 * 1000;
const HEARTBEAT_MS = 2 * 60 * 1000;

let heartbeat = null;
let active = null; // { since, title }
let lastWrite = 0;

// Réglage général (profil public : show_presence, activé par défaut).
export function presenceDefault() {
  try { return localStorage.getItem(LS_DEFAULT) !== "0"; } catch (_) { return true; }
}
export function rememberPresenceDefault(on) {
  try { localStorage.setItem(LS_DEFAULT, on ? "1" : "0"); } catch (_) {}
}
// Resynchronise le réglage depuis le profil (autre appareil).
export async function syncPresenceDefault() {
  const p = await db.getProfile(db.getCurrentUser()?.uid).catch(() => null);
  if (p) rememberPresenceDefault(p.show_presence !== false);
  return presenceDefault();
}

async function myName() {
  const p = await db.getProfile(db.getCurrentUser()?.uid).catch(() => null);
  return String(p?.display_name || "").replace(/[<>]/g, "").slice(0, 30);
}

async function write() {
  if (!active) return;
  lastWrite = Date.now();
  await db.setPresence({
    since: active.since, last_seen: new Date().toISOString(),
    title: String(active.title || "").replace(/[<>]/g, "").slice(0, 80), name: await myName()
  });
}

// Séance en cours visible : écrit le statut et le rafraîchit régulièrement.
export function startPresence(workout) {
  if (!workout) return;
  // Déjà actif pour cette séance (simple réaffichage de l'écran) : signe de vie seulement.
  if (active && heartbeat && active.since === workout.start_time && active.title === workout.title) { touchPresence(); return; }
  active = { since: workout.start_time, title: workout.title };
  write().catch(e => console.warn("[Skullcrusher] Statut à la salle :", e));
  clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    if (document.visibilityState === "visible") write().catch(() => null);
  }, HEARTBEAT_MS);
}

// Signe de vie (série enregistrée, retour dans l'app), au plus 1 par minute.
export function touchPresence() {
  if (active && Date.now() - lastWrite > 60 * 1000) write().catch(() => null);
}

export function stopPresence() {
  const wasActive = !!active || !!heartbeat;
  active = null;
  clearInterval(heartbeat);
  heartbeat = null;
  // Supprimé même si rien n'était actif ici : séance lancée sur un autre appareil.
  db.clearPresence().catch(e => { if (wasActive) console.warn("[Skullcrusher] Statut à la salle :", e); });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") touchPresence();
});

export function isFresh(p, now = Date.now()) {
  const seen = Date.parse(p.last_seen), since = Date.parse(p.since);
  return seen && now - seen < STALE_MS && (!since || now - since < MAX_SESSION_MS);
}

function sinceLabel(iso) {
  const min = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 60 ? t("depuis {n} min", { n: min }) : t("depuis {h} h {m}", { h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") });
}

// Bandeau du feed : amis en pleine séance.
export async function renderGymNow(el, { onOpenProfile } = {}) {
  if (!el) return;
  const friends = await db.listFriendUids().catch(() => []);
  const list = friends.length ? (await db.getPresences(friends)).filter(p => isFresh(p)) : [];
  if (!el.isConnected) return;
  if (!list.length) { el.innerHTML = ""; return; }
  const profiles = await db.getProfiles(list.map(p => p.uid)).catch(() => ({}));
  list.sort((a, b) => String(b.since).localeCompare(String(a.since)));
  el.innerHTML = `
    <div class="gym-now">
      <div class="gym-now-title"><span class="live-dot"></span>${t("À la salle en ce moment")}</div>
      ${list.map(p => {
        const pr = profiles[p.uid] || {};
        const name = pr.display_name || p.name || t("Un ami");
        const photo = safeImageUrl(pr.photo_data_url);
        return `
        <div class="gym-now-row" data-gym-uid="${esc(p.uid)}" role="button" tabindex="0">
          <div class="avatar-sm gym-now-avatar" ${photo ? `style="background-image:url('${photo}')"` : ""}>${photo ? "" : esc(name.slice(0, 1).toUpperCase())}<span class="live-dot live-dot-badge"></span></div>
          <div style="min-width:0;">
            <div class="gym-now-name">${esc(name)} <span class="gym-badge">🏋️ ${t("À la salle")}</span></div>
            <div class="muted gym-now-sub">${esc(p.title || "")}${p.title ? " · " : ""}${sinceLabel(p.since)}</div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  el.querySelectorAll("[data-gym-uid]").forEach(row => {
    row.onclick = () => onOpenProfile?.(row.dataset.gymUid);
  });
}
