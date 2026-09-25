// ============================================================
// POINT D'ENTRÉE — authentification puis routage entre onglets
// ============================================================
import { renderSeance } from "./workout.js";
import { renderHistorique } from "./history.js";
import { renderFeedTab } from "./feed.js";
import { renderStats } from "./stats.js";
import { renderReglages } from "./settings.js";
import { initAuth, renderLoginGate, renderUnauthorizedGate, isAuthorized } from "./auth.js";
import { t, translateStatic } from "./i18n.js";
import { esc } from "./utils.js";

const TABS = {
  seance: { label: () => "Skullcrusher", render: renderSeance },
  historique: { label: () => t("Historique"), render: renderHistorique },
  feed: { label: () => t("Feed"), render: renderFeedTab },
  stats: { label: () => t("Statistiques"), render: renderStats },
  reglages: { label: () => t("Réglages"), render: renderReglages }
};

const view = document.getElementById("view");
const topbarTitle = document.getElementById("topbar-title");
const tabbar = document.getElementById("tabbar");
let activeTab = localStorage.getItem("skullcrusher_last_tab") || "seance";
if (!TABS[activeTab]) activeTab = "seance";
let renderToken = 0;

async function switchTab(tab) {
  activeTab = tab;
  const myToken = ++renderToken;
  localStorage.setItem("skullcrusher_last_tab", tab);
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  topbarTitle.textContent = TABS[tab].label();
  view.innerHTML = `<div class="empty-state"><span class="num">···</span>${t("Chargement")}</div>`;
  try {
    await Promise.race([
      TABS[tab].render(view),
      new Promise((_, reject) => setTimeout(() => reject(new Error(t("Ça prend trop de temps à charger. Vérifie ta connexion, ou qu'aucun bloqueur de contenu ne bride ce site."))), 20000))
    ]);
  } catch (e) {
    console.error(e);
    if (myToken === renderToken) {
      view.innerHTML = `<div class="empty-state">${t("Erreur de chargement.")}<br><span class="muted">${esc(e.message)}</span><br><br><button class="btn btn-secondary" id="retry-tab" style="width:auto; display:inline-flex;">${t("Réessayer")}</button></div>`;
      const retryBtn = document.getElementById("retry-tab");
      if (retryBtn) retryBtn.onclick = () => switchTab(tab);
    }
  }
}

translateStatic();

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

let appStarted = false;

initAuth((user) => {
  if (user) {
    // Diagnostic temporaire : compare l'email du token réel à la liste
    // blanche des règles Firestore, pour repérer un éventuel décalage
    // (email non vérifié, compte différent, jeton périmé...).
    user.getIdTokenResult().then((token) => {
      console.log("[Skullcrusher] Diagnostic connexion → email:", JSON.stringify(user.email), "| email_verified:", token.claims.email_verified, "| uid:", user.uid, "| token émis:", token.issuedAtTime, "| token expire:", token.expirationTime);
    }).catch((e) => console.error("[Skullcrusher] Diagnostic connexion → erreur lecture token:", e));
  }
  if (user && isAuthorized(user)) {
    tabbar.style.display = "flex";
    if (!appStarted) {
      appStarted = true;
      switchTab(activeTab);
      // Retour de la page de connexion Spotify (?code=...), s'il y en a un.
      if (/[?&](code|error)=/.test(location.search)) {
        import("./spotify-connect.js")
          .then(m => m.handleSpotifyRedirect())
          .then(msg => { if (msg) import("./utils.js").then(u => u.toast(msg, 4000)); })
          .catch(e => console.warn("[Skullcrusher] Retour Spotify :", e));
      }
    }
    // si on revient d'une déconnexion suivie d'une reconnexion, on est déjà sur un onglet valide
  } else {
    appStarted = false;
    tabbar.style.display = "none";
    renderToken++; // invalide tout rendu en cours
    if (user) renderUnauthorizedGate(view, user);
    else renderLoginGate(view);
  }
});

