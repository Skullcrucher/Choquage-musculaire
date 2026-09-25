// ============================================================
// NOTIFICATIONS PUSH DU MINUTEUR DE REPOS
// (fichier volontairement nommé sans "push" : les bloqueurs de contenu
// bloquent les scripts "push.js", ce qui empêchait toute l'app de démarrer)
// iOS gèle l'app dès qu'on passe à une autre (Spotify...) : c'est le
// serveur push (push-worker/) qui envoie la notification de fin de repos,
// à l'heure, même app fermée ou écran verrouillé.
// ============================================================
import { PUSH_SERVER_URL } from "./timer-sync-config.js";
import { t } from "./i18n.js";

const LS_PUSH_KEY = "skullcrusher_push_enabled";
const SERVER = PUSH_SERVER_URL.replace(/\/+$/, "");

export function pushConfigured() {
  return !!SERVER;
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// Sur iPhone, le push ne marche que dans l'app ajoutée à l'écran d'accueil.
export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
}

export function pushActive() {
  try { return pushConfigured() && localStorage.getItem(LS_PUSH_KEY) === "1"; } catch (_) { return false; }
}

function b64uToBytes(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

async function getSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// À appeler depuis un geste de l'utilisateur (demande d'autorisation).
export async function enablePush() {
  if (!pushConfigured()) throw new Error(t("Serveur de notifications non configuré (js/timer-sync-config.js)."));
  if (!pushSupported()) {
    throw new Error(isIos() && !isStandalone()
      ? t("Sur iPhone, ajoute d'abord l'app à ton écran d'accueil (Partager → Sur l'écran d'accueil), puis active les notifications depuis l'app installée.")
      : t("Les notifications push ne sont pas prises en charge par ce navigateur."));
  }
  const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (perm !== "granted") throw new Error(t("Autorisation refusée — active les notifications pour cette app dans les réglages de l'iPhone."));

  const reg = await navigator.serviceWorker.ready;
  const res = await fetch(`${SERVER}/vapid-public-key`);
  if (!res.ok) throw new Error(t("Serveur de notifications injoignable."));
  const { publicKey } = await res.json();
  let sub = await reg.pushManager.getSubscription();
  // Un abonnement créé avec une autre clé serveur ne peut pas être réutilisé.
  const current = sub?.options?.applicationServerKey;
  if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))) !== btoa(String.fromCharCode(...b64uToBytes(publicKey)))) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  }
  localStorage.setItem(LS_PUSH_KEY, "1");
  return sub;
}

export async function disablePush() {
  localStorage.setItem(LS_PUSH_KEY, "0");
  try {
    const sub = await getSubscription();
    if (sub) {
      await cancelRestPush();
      await sub.unsubscribe();
    }
  } catch (e) {
    console.warn("[Skullcrusher] Désabonnement push :", e);
  }
}

async function post(path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method: "POST",
    // text/plain = requête "simple" sans pré-vérification CORS, ce qui
    // garantit que keepalive fonctionne aussi sur Safari.
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(body),
    keepalive: true // l'envoi part même si l'app passe en arrière-plan juste après
  });
  if (!res.ok) throw new Error(`Serveur push : ${res.status}`);
  return res.json();
}

// Programme la notification de fin de repos pour l'instant endMs.
export async function scheduleRestPush(endMs, body) {
  if (!pushActive()) return false;
  try {
    const sub = await getSubscription();
    if (!sub) return false;
    await post("/schedule", {
      subscription: sub.toJSON(),
      delayMs: Math.max(0, Math.round(endMs - Date.now())),
      title: t("Repos terminé") + " 🤘",
      body: body || t("C'est reparti pour la série suivante.")
    });
    return true;
  } catch (e) {
    console.warn("[Skullcrusher] Programmation push impossible :", e);
    return false;
  }
}

export async function cancelRestPush() {
  if (!pushConfigured()) return;
  try {
    const sub = await getSubscription();
    if (sub) await post("/cancel", { endpoint: sub.endpoint });
  } catch (e) {
    console.warn("[Skullcrusher] Annulation push impossible :", e);
  }
}
