// ============================================================
// UTILITAIRES PARTAGÉS
// ============================================================

const HORNS_SVG = `<svg class="toast-horns" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><rect x="30" y="50" width="38" height="38" rx="17"/><rect x="37" y="42" width="12" height="18" rx="6"/><rect x="50" y="42" width="12" height="18" rx="6"/><rect x="-6.5" y="-44" width="13" height="44" rx="6.5" transform="translate(36 52) rotate(-16)"/><rect x="-5.5" y="-40" width="11" height="40" rx="5.5" transform="translate(63 54) rotate(18)"/><rect x="-6.5" y="-32" width="13" height="32" rx="6.5" transform="translate(32 68) rotate(-82)"/></g></svg>`;

export function toast(msg, duration = 2200, options = {}) {
  const el = document.getElementById("toast");
  el.innerHTML = options.horns ? HORNS_SVG + `<span>${msg}</span>` : "";
  if (!options.horns) el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), duration);
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
