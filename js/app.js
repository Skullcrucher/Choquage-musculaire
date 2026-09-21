// ============================================================
// POINT D'ENTRÉE — routage entre onglets
// ============================================================
import { renderSeance } from "./workout.js";
import { renderRoutines } from "./routines.js";
import { renderHistorique } from "./history.js";
import { renderStats } from "./stats.js";
import { renderReglages } from "./settings.js";

const TABS = {
  seance: { label: "Fonte", render: renderSeance },
  routines: { label: "Routines", render: renderRoutines },
  historique: { label: "Historique", render: renderHistorique },
  stats: { label: "Statistiques", render: renderStats },
  reglages: { label: "Réglages", render: renderReglages }
};

const view = document.getElementById("view");
const topbarTitle = document.getElementById("topbar-title");
let activeTab = localStorage.getItem("fonte_last_tab") || "seance";
let renderToken = 0;

async function switchTab(tab) {
  activeTab = tab;
  const myToken = ++renderToken;
  localStorage.setItem("fonte_last_tab", tab);
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  topbarTitle.textContent = TABS[tab].label;
  view.innerHTML = `<div class="empty-state"><span class="num">···</span>Chargement</div>`;
  try {
    await Promise.race([
      TABS[tab].render(view),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Ça prend trop de temps à charger. Vérifie ta connexion, ou qu'aucun bloqueur de contenu ne bride ce site.")), 20000))
    ]);
  } catch (e) {
    console.error(e);
    if (myToken === renderToken) {
      view.innerHTML = `<div class="empty-state">Erreur de chargement.<br><span class="muted">${e.message}</span><br><br><button class="btn btn-secondary" id="retry-tab" style="width:auto; display:inline-flex;">Réessayer</button></div>`;
      const retryBtn = document.getElementById("retry-tab");
      if (retryBtn) retryBtn.onclick = () => switchTab(tab);
    }
  }
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function updateSyncStatus() {
  const el = document.getElementById("sync-status");
  el.classList.toggle("offline", !navigator.onLine);
  el.textContent = navigator.onLine ? "" : "";
}
window.addEventListener("online", updateSyncStatus);
window.addEventListener("offline", updateSyncStatus);
updateSyncStatus();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(err => console.warn("SW registration failed", err));
  });
}

switchTab(activeTab);
