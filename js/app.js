// ============================================================
// POINT D'ENTRÉE — authentification puis routage entre onglets
// ============================================================
import { renderSeance } from "./workout.js";
import { renderFeedTab } from "./feed.js";
import { renderStats } from "./stats.js";
import { renderBiblio } from "./library.js";
import { renderReglages } from "./settings.js";
import { initAuth, renderLoginGate, renderUnauthorizedGate, isAuthorized } from "./auth.js";
import { t, translateStatic } from "./i18n.js";
import { esc } from "./utils.js";

// Chaque écran affiche son propre gros titre : la barre du haut garde
// toujours le nom de l'app.
const TABS = {
  seance: { render: renderSeance },
  progres: { render: renderStats },
  feed: { render: renderFeedTab },
  biblio: { render: renderBiblio },
  reglages: { render: renderReglages }
};

const view = document.getElementById("view");
const tabbar = document.getElementById("tabbar");
let activeTab = localStorage.getItem("skullcrusher_last_tab") || "seance";
// Anciens onglets Historique et Stats : réunis dans Progrès.
if (activeTab === "historique" || activeTab === "stats") activeTab = "progres";
if (!TABS[activeTab]) activeTab = "seance";
let renderToken = 0;

// ---------- Bouton « retour » (Android) ----------
// Le retour ferme d'abord la fenêtre ouverte (ou réduit le lecteur agrandi),
// sinon ramène sur l'onglet Feed ; depuis le Feed, il quitte l'application.
//
// Chrome sur Android ignore les entrées d'historique ajoutées sans action de
// l'utilisateur : on utilise donc CloseWatcher, l'API prévue pour le bouton
// retour (Chrome 120+). Une seule « veille » active à la fois, recréée après
// chaque retour tant qu'il reste quelque chose à fermer. Sans CloseWatcher
// (Firefox, Safari…), repli sur une entrée d'historique « garde ».
const dockExpanded = () => { const d = document.getElementById("spotify-dock"); return !!d && !d.classList.contains("mini"); };
const needsBackIntercept = () => activeTab !== "feed" || !!document.querySelector(".modal-backdrop") || dockExpanded();

function handleBack() {
  const backdrop = [...document.querySelectorAll(".modal-backdrop")].pop();
  if (backdrop) {
    // Même effet qu'un appui à côté de la fenêtre (annule proprement).
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return;
  }
  if (dockExpanded()) { document.querySelector("#spotify-dock #sp-toggle")?.click(); return; }
  if (activeTab !== "feed") switchTab("feed");
}

const hasCloseWatcher = typeof window.CloseWatcher === "function";
let closeWatcher = null;
let backGuard = false;
let ignoreNextPop = false;

function syncBackHandling() {
  const need = needsBackIntercept();
  if (hasCloseWatcher) {
    if (need && !closeWatcher) {
      try {
        closeWatcher = new CloseWatcher();
        closeWatcher.onclose = () => { closeWatcher = null; handleBack(); setTimeout(syncBackHandling, 0); };
      } catch (_) { closeWatcher = null; }
    } else if (!need && closeWatcher) {
      const w = closeWatcher; closeWatcher = null; w.onclose = null; w.destroy();
    }
    return;
  }
  if (need && !backGuard) {
    backGuard = true;
    history.pushState({ skullcrusher: "guard" }, "");
  } else if (!need && backGuard) {
    // Sur le Feed sans fenêtre : la garde est retirée sans bruit pour que
    // le premier retour quitte l'app.
    backGuard = false;
    ignoreNextPop = true;
    history.back();
  }
}
if (!hasCloseWatcher) {
  window.addEventListener("popstate", () => {
    if (ignoreNextPop) { ignoreNextPop = false; return; }
    backGuard = false;
    handleBack();
    setTimeout(syncBackHandling, 0);
  });
}
window.addEventListener("sc:modal-open", () => setTimeout(syncBackHandling, 0));
window.addEventListener("sc:modal-close", () => setTimeout(syncBackHandling, 0));
window.addEventListener("sc:dock-change", () => setTimeout(syncBackHandling, 0));
// Chaque appui de l'utilisateur donne l'occasion de (re)poser la veille avec
// une « activation utilisateur », ce que Chrome exige pour la respecter.
document.addEventListener("pointerdown", () => setTimeout(syncBackHandling, 0), true);

async function switchTab(tab) {
  activeTab = tab;
  setTimeout(syncBackHandling, 0);
  const myToken = ++renderToken;
  localStorage.setItem("skullcrusher_last_tab", tab);
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  view.innerHTML = `<div class="empty-state"><span class="num">···</span>${t("Chargement")}</div>`;
  view.scrollTop = 0; // #view est le conteneur qui défile (voir style.css)
  try {
    await Promise.race([
      TABS[tab].render(view),
      new Promise((_, reject) => setTimeout(() => reject(new Error(t("Ça prend trop de temps à charger. Vérifie ta connexion, ou qu'aucun bloqueur de contenu ne bride ce site."))), 20000))
    ]);
    if (myToken === renderToken) checkForgottenWorkout();
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

// Adresse propre après une réparation automatique (?refresh=…).
if (/[?&]refresh=/.test(location.search)) {
  history.replaceState(history.state, "", location.pathname + location.search.replace(/[?&]refresh=\d+/, "").replace(/^&/, "?") + location.hash);
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
      // Administrateur : pastille des signalements en attente.
      import("./settings.js").then(m => m.checkReportsBadge()).catch(() => null);
      // Doublons fusionnés par d'autres (administrateur…) : appliqués à ses données.
      import("./cache.js").then(async c => {
        await c.getExercises();
        const n = await (await import("./db.js")).applyExerciseMerges();
        if (n) c.invalidate("sets", "routines");
      }).catch(e => console.warn("[Skullcrusher] Fusion des doublons :", e));
      // Conditions d'utilisation (avertissement santé) : accord une fois par compte.
      // Réglage « à la salle » du profil (peut venir d'un autre appareil).
      import("./presence.js").then(m => m.syncPresenceDefault()).catch(() => null);
      // Nouvelle version publiée ? Proposée d'abord, puis les conditions.
      import("./update-check.js").then(m => m.checkForUpdate({ force: true })).catch(() => null)
        .then(() => import("./terms.js")).then(m => m.ensureTermsAccepted(user)).catch(e => console.warn("[Skullcrusher] Conditions :", e));
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


// Retour dans l'app (ouverte en arrière-plan depuis longtemps) : nouvelle
// version publiée entre-temps ? (au plus une vérification toutes les 5 min)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && appStarted) {
    import("./update-check.js").then(m => m.checkForUpdate()).catch(() => null);
  }
});

// iPhone : à l'ouverture du clavier, Safari fait glisser toute la page
// (même non défilable) et ne la remet pas toujours en place à la
// fermeture — la barre d'onglets se retrouve alors au milieu de l'écran.
// On la recale dès qu'aucun champ n'est plus en saisie.
function resetPageScroll() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
    window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
  }
}
document.addEventListener("focusout", () => setTimeout(resetPageScroll, 60));
window.visualViewport?.addEventListener("resize", () => setTimeout(resetPageScroll, 60));

// Séance oubliée : bandeau discret après une longue inactivité (voir
// workout-reminder.js), vérifié à chaque onglet, au retour dans l'app et
// toutes les 5 minutes.
function checkForgottenWorkout() {
  if (!appStarted) return;
  import("./workout-reminder.js").then(m => m.updateForgottenBanner(async () => {
    if (activeTab !== "seance") await switchTab("seance");
    document.getElementById("finish-workout")?.click();
  })).catch(() => null);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForgottenWorkout(); });
setInterval(checkForgottenWorkout, 5 * 60 * 1000);
