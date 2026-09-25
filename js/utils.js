// ============================================================
// UTILITAIRES PARTAGÉS
// ============================================================

// Version affichée dans Réglages → À propos. À incrémenter avec
// CACHE_NAME dans service-worker.js à chaque mise en ligne, pour voir d'un
// coup d'œil si le téléphone utilise bien la dernière version.
export const APP_VERSION = "41";

const HORNS_SVG = `<svg class="toast-horns" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><rect x="30" y="50" width="38" height="38" rx="17"/><rect x="37" y="42" width="12" height="18" rx="6"/><rect x="50" y="42" width="12" height="18" rx="6"/><rect x="-6.5" y="-44" width="13" height="44" rx="6.5" transform="translate(36 52) rotate(-16)"/><rect x="-5.5" y="-40" width="11" height="40" rx="5.5" transform="translate(63 54) rotate(18)"/><rect x="-6.5" y="-32" width="13" height="32" rx="6.5" transform="translate(32 68) rotate(-82)"/></g></svg>`;

export function toast(msg, duration = 2200, options = {}) {
  const el = document.getElementById("toast");
  el.innerHTML = options.horns ? HORNS_SVG + `<span>${msg}</span>` : "";
  if (!options.horns) el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), duration);
}

// Échappe un texte avant de l'insérer dans du HTML (contenu ou attribut).
// Indispensable pour tout ce qui vient d'un autre utilisateur : pseudo,
// titre de séance, nom de routine ou d'exercice...
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// N'accepte comme image que les data URL d'image (photos de profil) ou les
// URL https — jamais du texte qui pourrait sortir du `url('...')`.
export function safeImageUrl(url) {
  if (typeof url !== "string") return "";
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  if (/^https:\/\/[^\s'"()<>\\]+$/.test(url)) return url;
  return "";
}

export function openModal(innerHtml, onMount) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal">${innerHtml}</div>`;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.body.appendChild(backdrop);
  document.body.style.overflow = "hidden";
  if (onMount) onMount(backdrop.querySelector(".modal"));
  return backdrop;
}

export function closeModal() {
  document.body.style.overflow = "";
  document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
}

export function fmtDate(iso, opts = {}) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", ...opts });
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return "";
  const mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

// Formule d'Epley : 1RM estimée = poids × (1 + reps/30)
export function estimate1RM(weight, reps) {
  if (!weight || !reps) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

export function isoWeek(dateIso) {
  const d = new Date(dateIso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return d.getFullYear() + "-W" + String(1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)).padStart(2, "0");
}

export function uniqueSorted(arr) {
  return [...new Set(arr)].sort();
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Redimensionne une image (fichier choisi par l'utilisateur) en petit carré
// compressé, encodé en data URL — assez léger pour tenir directement dans
// un document Firestore (pas besoin de Cloud Storage, donc pas de coût).
export function resizeImageFile(file, maxSize = 160, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image invalide"));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Notifications (fin de minuteur de repos) ----------
const LS_NOTIFY_KEY = "skullcrusher_notify_rest";

export function restNotificationsEnabled() {
  return localStorage.getItem(LS_NOTIFY_KEY) === "1";
}

export async function setRestNotificationsEnabled(enabled) {
  if (enabled) {
    if (!("Notification" in window)) return false;
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
  }
  localStorage.setItem(LS_NOTIFY_KEY, enabled ? "1" : "0");
  return true;
}

export async function fireRestEndNotification() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  if (!restNotificationsEnabled()) return;
  // Avec le push, c'est le serveur qui envoie la notification (même app
  // fermée) : on n'en affiche pas une deuxième ici.
  // (drapeau posé par timer-sync.js ; lu directement pour ne pas dépendre
  // de ce module, qu'un bloqueur de contenu pourrait empêcher de charger)
  try { if (localStorage.getItem("skullcrusher_push_enabled") === "1") return; } catch (_) {}
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("Repos terminé 🤘", {
        body: "C'est reparti pour la série suivante.",
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        tag: "skullcrusher-rest-timer",
        renotify: true
      });
    } else {
      new Notification("Repos terminé", { body: "C'est reparti pour la série suivante." });
    }
  } catch (e) {
    console.warn("[Skullcrusher] Notification impossible :", e);
  }
}

// ---------- Autocomplete léger ----------
// Remplace <datalist>, peu fiable sur Safari iOS. Affiche une liste
// filtrée (préfixe d'abord, puis sous-chaîne) sous le champ, au tap.
export function attachAutocomplete(inputEl, items, onSelect) {
  const wrap = document.createElement("div");
  wrap.className = "autocomplete-list";
  const parent = inputEl.parentElement;
  if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
  parent.appendChild(wrap);
  inputEl.setAttribute("autocomplete", "off");

  function render(filter) {
    const q = filter.trim().toLowerCase();
    if (!q) { wrap.innerHTML = ""; wrap.classList.remove("show"); return; }
    const starts = items.filter(i => i.toLowerCase().startsWith(q));
    const rest = items.filter(i => !i.toLowerCase().startsWith(q) && i.toLowerCase().includes(q));
    const matches = [...starts, ...rest].slice(0, 8);
    if (!matches.length) { wrap.innerHTML = ""; wrap.classList.remove("show"); return; }
    wrap.innerHTML = matches.map(m => `<div class="autocomplete-item">${esc(m)}</div>`).join("");
    wrap.classList.add("show");
    wrap.querySelectorAll(".autocomplete-item").forEach(el => {
      el.onmousedown = (e) => e.preventDefault(); // évite que le blur ferme avant le clic
      el.onclick = () => {
        inputEl.value = el.textContent;
        wrap.innerHTML = "";
        wrap.classList.remove("show");
        onSelect(el.textContent);
      };
    });
  }
  inputEl.addEventListener("input", () => render(inputEl.value));
  inputEl.addEventListener("focus", () => render(inputEl.value));
  inputEl.addEventListener("blur", () => setTimeout(() => { wrap.innerHTML = ""; wrap.classList.remove("show"); }, 120));
}
