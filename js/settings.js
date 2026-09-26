// ============================================================
// ONGLET RÉGLAGES — import CSV, bibliothèque d'exercices, export
// ============================================================
import * as db from "./db.js";
import { importCsvFile } from "./import.js";
import { toast, openModal, closeModal, restNotificationsEnabled, setRestNotificationsEnabled, resizeImageFile, esc, safeImageUrl, APP_VERSION } from "./utils.js";
import { firebaseConfig } from "./firebase-config.js";
import { invalidateStatsCache } from "./stats.js";
import { getExercises, invalidate } from "./cache.js";
import { EXERCISE_SEED } from "./exercises-seed.js";
import { openExerciseDetail } from "./exercise-detail.js";
import { getUser, signOutUser } from "./auth.js";
import { openProfile, openProfileEditor } from "./profile.js";
import { t, tn, getLang } from "./i18n.js";
import { langPickerHtml, bindLangPicker } from "./auth.js";
import { getBody, saveBody, bodyComplete, restingKcalPerDay } from "./calories.js";

// Module des notifications en arrière-plan, chargé à la demande : si un
// bloqueur de contenu le refuse, les Réglages s'affichent quand même.
const TIMER_SYNC_FALLBACK = {
  unavailable: true,
  pushConfigured: () => false,
  pushActive: () => false,
  enablePush: async () => { throw new Error(t("module de notifications bloqué (bloqueur de contenu ?)")); },
  disablePush: async () => {},
  scheduleRestPush: async () => false,
  isIos: () => /iPad|iPhone|iPod/.test(navigator.userAgent),
  isStandalone: () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true
};
async function loadTimerSync() {
  try { return await import("./timer-sync.js"); } catch (e) {
    console.warn("[Skullcrusher] Module de notifications indisponible :", e);
    return TIMER_SYNC_FALLBACK;
  }
}

export async function renderReglages(container) {
  const timerSync = await loadTimerSync();
  const { pushConfigured, pushActive, enablePush, disablePush, scheduleRestPush, isIos, isStandalone } = timerSync;
  const user = getUser();
  const profile = user ? await db.getProfile(user.uid) : null;
  const displayName = profile?.display_name || user?.displayName || t("Utilisateur");
  const photoSrc = safeImageUrl(profile?.photo_data_url || user?.photoURL || "");

  container.innerHTML = `
    <h1 class="section-title">${t("Réglages")}</h1>

    <div class="card">
      <div class="card-title">🌐 ${t("Langue")}</div>
      ${langPickerHtml("settings-lang")}
      ${getLang() === "mfe" ? `<p class="muted" style="font-size:12px; margin:6px 0 0;">${t("Traduction en cours de relecture : signale-nous les erreurs !")}</p>` : ""}
    </div>

    <div class="card">
      <div class="card-title">${t("Compte")}</div>
      <div style="display:flex; align-items:center; gap:14px; margin:10px 0 14px;">
        <div style="position:relative; flex-shrink:0;">
          <div id="profile-photo-preview" style="width:64px; height:64px; border-radius:50%; background:var(--surface-raised) center/cover no-repeat; ${photoSrc ? `background-image:url('${photoSrc}');` : ""} display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:700; color:var(--amber);">${photoSrc ? "" : esc(displayName[0].toUpperCase())}</div>
          <label for="profile-photo-input" style="position:absolute; bottom:-2px; right:-2px; width:24px; height:24px; border-radius:50%; background:var(--amber); display:flex; align-items:center; justify-content:center; font-size:12px; cursor:pointer; border:2px solid var(--bg-elevated);">✎</label>
          <input type="file" id="profile-photo-input" accept="image/*" style="display:none;">
        </div>
        <div style="flex:1;">
          <label style="margin-top:0;">${t("Pseudo")}</label>
          <input id="profile-name-input" value="${esc(displayName)}" maxlength="30">
        </div>
      </div>
      <p class="muted" style="margin:0 0 10px;">${esc(user?.email || "")}</p>
      <button class="btn btn-primary btn-sm" id="save-profile-btn">${t("Enregistrer le profil")}</button>
      <p class="muted" id="profile-save-status" style="margin-top:6px;"></p>
      <div class="btn-row" style="margin-top:6px;">
        <button class="btn btn-secondary btn-sm" id="view-public-profile">${t("Voir mon profil")}</button>
        <button class="btn btn-secondary btn-sm" id="edit-public-profile">${t("🏆 Exercices phares & 🎧 musique")}</button>
      </div>
      <button class="btn btn-secondary" id="signout-btn" style="margin-top:10px;">${t("Se déconnecter")}</button>
    </div>

    ${db.isAdmin() ? `<div class="card" id="reports-card">
      <div class="card-title">🚩 ${t("Signalements")}</div>
      <div id="reports-list"><p class="muted">${t("Chargement…")}</p></div>
    </div>` : ""}

    <div class="card" id="spotify-card">
      <div class="card-title">🎧 Spotify</div>
      <p class="muted" style="margin-top:0;">${t("Connecte ton compte pour proposer automatiquement le morceau en cours comme « son du record » et joindre la bande-son de tes séances (morceaux écoutés pendant l'entraînement).")} <a href="privacy.html" style="color:var(--text);">${t("Données utilisées")}</a></p>
      <p class="muted" style="font-size:12px;">${t("Sur Apple Music ou Deezer ? Choisis ton service dans ton profil (🏆 Exercices phares & 🎧 musique) : liens, lecteurs et recherche des sons partagés s'adaptent. La connexion automatique ci-dessous n'existe que pour Spotify.")}</p>
      <p class="muted" id="spotify-status" style="font-size:13px;"></p>
      <button class="btn btn-secondary btn-sm" id="spotify-btn"></button>
      <details id="spotify-own" style="margin-top:12px;">
        <summary style="cursor:pointer; font-weight:600;">${t("Utiliser ma propre app Spotify")}</summary>
        <p class="muted" style="font-size:13px;">${t("L'app Spotify partagée est limitée par Spotify à quelques comptes. Avec ta propre app (gratuite, 5 minutes, <b>compte Spotify Premium requis</b>), tu te connectes sans attendre personne :")}</p>
        <ol class="muted" style="font-size:13px; padding-left:20px; line-height:1.5;">
          <li>${t("Ouvre {link}, connecte-toi, puis <b>Create app</b>.", { link: `<a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener" style="color:var(--text);">developer.spotify.com/dashboard</a>` })}</li>
          <li>${t("Nom et description au choix. Dans <b>Redirect URIs</b>, colle exactement :")}
            <div style="display:flex; gap:6px; margin:6px 0;"><input id="spotify-redirect" readonly style="font-size:12px;"><button class="btn btn-secondary btn-sm" id="spotify-copy" style="width:auto;">${t("Copier")}</button></div></li>
          <li>${t("Coche <b>Web API</b>, accepte les conditions, <b>Save</b>.")}</li>
          <li>${t("Dans <b>Settings</b>, copie le <b>Client ID</b> et colle-le ici :")}</li>
        </ol>
        <div style="display:flex; gap:6px;">
          <input id="spotify-client-id" placeholder="${t("Client ID (32 caractères)")}" autocomplete="off" autocapitalize="off" spellcheck="false">
          <button class="btn btn-primary btn-sm" id="spotify-client-save" style="width:auto;">OK</button>
        </div>
        <p class="muted" id="spotify-client-info" style="font-size:12px; margin:6px 0 0;"></p>
      </details>
    </div>

    <div class="card" id="body-card">
      <div class="card-title">🔥 ${t("Calories")}</div>
      <p class="muted" style="margin-top:0;">${t("Pour estimer les calories de tes séances. Ces données restent privées : personne d'autre ne les voit.")}</p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <div><label>${t("Sexe")}</label><select id="body-sex"><option value="">—</option><option value="m">${t("Homme")}</option><option value="f">${t("Femme")}</option></select></div>
        <div><label>${t("Année de naissance")}</label><input id="body-year" type="number" inputmode="numeric" min="1920" max="2020" placeholder="1990"></div>
        <div><label>${t("Taille (cm)")}</label><input id="body-height" type="number" inputmode="numeric" min="120" max="230" placeholder="178"></div>
        <div><label>${t("Poids (kg)")}</label><input id="body-weight" type="number" inputmode="decimal" min="30" max="250" step="0.1" placeholder="80"></div>
      </div>
      <p class="muted" id="body-info" style="font-size:12px; margin:8px 0;"></p>
      <button class="btn btn-secondary" id="body-save">${t("Enregistrer")}</button>
      <details style="margin-top:10px;">
        <summary class="muted" style="cursor:pointer;">${t("Comment c'est calculé ?")}</summary>
        <p class="muted" style="font-size:13px;">${t("Calories = MET × métabolisme de repos × durée. Le métabolisme de repos vient de ton sexe, âge, taille et poids (formule de Harris-Benedict révisée). Le MET de la musculation vient du Compendium of Physical Activities : 3,5 (effort léger), 5 (modéré), 6 (intense) ; il couvre toute la séance, repos compris.")}</p>
        <p class="muted" style="font-size:13px;">${t("La durée va du début à la fin de la séance, en s'arrêtant 10 min après ta dernière série. L'effort est proposé d'après le rythme de la séance (séries par heure) et se corrige en fin de séance. Précision : ±25 % environ. Si tu as une montre cardio, saisis ses calories en fin de séance : elles remplacent l'estimation.")}</p>
      </details>
    </div>

    <div class="card">
      <div class="card-title">${t("Minuteur de repos")}</div>
      <p class="muted" style="margin-top:0;">${t("Reçois une notification à la fin du repos, même si tu es passé sur une autre app (Spotify...) ou que l'écran est verrouillé. Sur iPhone, il faut utiliser l'app ajoutée à l'écran d'accueil. La durée par défaut se règle par exercice, dans la bibliothèque ci-dessous.")}</p>
      <div class="list-row" style="cursor:default;">
        <div class="list-row-title">${t("Notifications de fin de repos")}</div>
        <label class="switch">
          <input type="checkbox" id="notify-toggle" ${restNotificationsEnabled() ? "checked" : ""}>
          <span class="switch-track"></span>
        </label>
      </div>
      <p class="muted" id="notify-status" style="margin-top:6px;"></p>
      <div id="notify-denied" style="display:none;">
        <p class="muted" id="notify-help" style="font-size:13px; margin:0 0 8px;"></p>
        <button class="btn btn-secondary btn-sm" id="notify-retry">🔄 ${t("Redemander l'autorisation")}</button>
      </div>
      <button class="btn btn-secondary btn-sm" id="notify-test" style="display:none;">${t("Tester : notification dans 10 s")}</button>
      <div class="list-row" style="cursor:default; margin-top:6px;">
        <div>
          <div class="list-row-title">${t("Demander le RPE après chaque série")}</div>
          <div class="list-row-sub">${t("Effort ressenti de 6 à 10 (10 = échec) : affine les propositions de progression.")}</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="rpe-toggle" ${(() => { try { return localStorage.getItem("skullcrusher_ask_rpe") !== "0"; } catch (_) { return true; } })() ? "checked" : ""}>
          <span class="switch-track"></span>
        </label>
      </div>
    </div>

    <div class="card">
      <div class="card-title">${t("Réinitialiser")}</div>
      <p class="muted" style="margin-top:0;">${t("Supprime toutes tes séances et leurs séries (les exercices et routines partagés ne sont pas touchés) — utile pour repartir propre avant un réimport.")}</p>
      <button class="btn btn-danger" id="wipe-btn">${t("Supprimer toutes mes séances")}</button>
      <div id="wipe-result"></div>
    </div>

    <div class="card">
      <div class="card-title">${t("Importer un CSV")}</div>
      <p class="muted" style="margin-top:0;">${t("Export Hevy (Profil → Réglages → Exporter les données). Les séries déjà importées sont détectées et ignorées automatiquement — aucun doublon possible, même en réimportant plusieurs fois le même fichier.")}</p>
      <input type="file" id="csv-file" accept=".csv,text/csv">
      <p class="muted" id="csv-filename" style="margin:8px 0 0;"></p>
      <div style="height:10px"></div>
      <button class="btn btn-primary" id="start-import" disabled>${t("Importer")}</button>
      <div id="import-progress" style="display:none;">
        <div class="progress-bar"><div class="progress-bar-fill" id="progress-fill" style="width:0%"></div></div>
        <p class="muted" id="progress-text"></p>
      </div>
      <div id="import-result"></div>
    </div>

    <div class="card">
      <div class="card-title">${t("Export")}</div>
      <p class="muted" style="margin-top:0;">${t("Télécharge toutes tes séries au format CSV.")}</p>
      <button class="btn btn-secondary" id="export-csv">${t("Exporter en CSV")}</button>
    </div>

    <div class="card">
      <div class="card-title">${t("À propos")}</div>
      <p class="muted" style="margin-top:0;">${t("Version de l'app : {version} · Projet Firebase : {project}", { version: `<b>${APP_VERSION}</b>`, project: esc(firebaseConfig.projectId) })}</p>
      <button class="btn btn-secondary btn-sm" id="force-update">${t("Forcer la mise à jour")}</button>
      <p style="margin:10px 0 0;"><a href="privacy.html" style="color:var(--text); text-decoration-color:var(--amber);">${t("Politique de confidentialité")}</a></p>
      <p class="muted">${t("Ajoute cette page à ton écran d'accueil (icône Partager → \"Sur l'écran d'accueil\") pour l'utiliser comme une app.")}</p>
    </div>

    <div class="card">
      <div class="card-title">${t("Bibliothèque d'exercices")}</div>
      <p class="muted" style="margin-top:0;">${t("Complète ta bibliothèque avec {n} exercices standards (barre, haltère, machine, poulie, poids du corps) — les exercices déjà présents ne sont pas dupliqués.", { n: EXERCISE_SEED.length })}</p>
      <button class="btn btn-secondary" id="load-seed">${t("Charger la bibliothèque standard")}</button>
      <button class="btn btn-secondary" id="check-muscles" style="margin-top:8px;">🔎 ${t("Vérifier les groupes musculaires")}</button>
      <p class="muted" style="margin:10px 0 0; font-size:13px;">${t("Bibliothèque commune à tous les utilisateurs : tu peux modifier les exercices que tu as ajoutés, pas ceux des autres.")}</p>
      <div style="height:12px"></div>
      <div id="exercise-lib"></div>
    </div>
  `;
  bindLangPicker(container, "settings-lang");

  setupSpotifyCard(container);
  if (db.isAdmin()) renderReports(container);
  setupBodyCard(container);
  container.querySelector("#view-public-profile").onclick = () => openProfile(getUser()?.uid);
  container.querySelector("#edit-public-profile").onclick = () => openProfileEditor(() => openProfile(getUser()?.uid));

  container.querySelector("#signout-btn").onclick = async () => {
    if (!confirm(t("Se déconnecter de Skullcrusher ?"))) return;
    await signOutUser();
  };

  let pendingPhotoDataUrl = undefined;
  const photoInput = container.querySelector("#profile-photo-input");
  const photoPreview = container.querySelector("#profile-photo-preview");
  photoInput.onchange = async () => {
    const file = photoInput.files[0];
    if (!file) return;
    try {
      pendingPhotoDataUrl = await resizeImageFile(file, 160, 0.75);
      photoPreview.style.backgroundImage = `url('${pendingPhotoDataUrl}')`;
      photoPreview.textContent = "";
    } catch (e) {
      toast(t("Impossible de lire cette image"));
    }
  };

  container.querySelector("#save-profile-btn").onclick = async () => {
    const btn = container.querySelector("#save-profile-btn");
    const statusEl = container.querySelector("#profile-save-status");
    const name = container.querySelector("#profile-name-input").value.trim();
    btn.disabled = true;
    btn.textContent = t("Enregistrement…");
    try {
      const patch = {};
      if (name) patch.display_name = name;
      if (pendingPhotoDataUrl !== undefined) patch.photo_data_url = pendingPhotoDataUrl;
      await db.updateMyProfile(patch);
      if (statusEl.isConnected) statusEl.textContent = t("Profil enregistré.");
      toast(t("Profil mis à jour"));
    } catch (e) {
      if (statusEl.isConnected) statusEl.textContent = e.message;
    }
    if (btn.isConnected) { btn.disabled = false; btn.textContent = t("Enregistrer le profil"); }
  };

  container.querySelector("#wipe-btn").onclick = async () => {
    if (!confirm(t("Supprimer TOUTES tes séances et leurs séries ? Cette action est irréversible."))) return;
    if (!confirm(t("Vraiment sûr ? Il n'y a pas d'annulation possible."))) return;
    const btn = container.querySelector("#wipe-btn");
    const resultEl = container.querySelector("#wipe-result");
    btn.disabled = true;
    btn.textContent = t("Suppression…");
    try {
      const count = await db.deleteAllMyWorkouts((done, total) => {
        if (resultEl.isConnected) resultEl.innerHTML = `<p class="muted">${done} / ${total} séance(s) supprimée(s)…</p>`;
      });
      invalidate("workouts");
      invalidateStatsCache();
      if (resultEl.isConnected) resultEl.innerHTML = `<p style="color:var(--green)">${count} séance(s) supprimée(s). Tu peux réimporter ton CSV ci-dessous.</p>`;
      toast(`${count} séance(s) supprimée(s)`);
    } catch (err) {
      if (resultEl.isConnected) resultEl.innerHTML = `<p style="color:var(--red)">${err.message}</p>`;
    }
    if (btn.isConnected) { btn.disabled = false; btn.textContent = t("Supprimer toutes mes séances"); }
  };

  container.querySelector("#rpe-toggle").onchange = (e) => {
    try { localStorage.setItem("skullcrusher_ask_rpe", e.target.checked ? "1" : "0"); } catch (_) {}
  };
  const notifyToggle = container.querySelector("#notify-toggle");
  const notifyStatus = container.querySelector("#notify-status");
  const notifyTest = container.querySelector("#notify-test");
  const iosNotInstalled = isIos() && !isStandalone();
  const deniedBox = container.querySelector("#notify-denied");
  // Autorisation refusée : aucun navigateur ne laisse un site réafficher la
  // demande système. On la retente (elle réapparaît si elle n'était que
  // fermée), on explique où la rétablir, puis on détecte son retour.
  function deniedHelp() {
    if (/Android/i.test(navigator.userAgent)) return isStandalone()
      ? t("Android : appui long sur l'icône Skullcrusher → Infos sur l'appli → Notifications → Autoriser. Puis reviens ici.")
      : t("Android (Chrome) : touche l'icône à gauche de l'adresse → Autorisations → Notifications → Autoriser. Puis reviens ici.");
    if (isIos()) return t("iPhone : Réglages → Notifications → Skullcrusher → Autoriser les notifications. Puis reviens ici.");
    return t("Ordinateur : clique sur l'icône à gauche de l'adresse → Notifications → Autoriser, puis reviens ici.");
  }
  function showDenied() {
    notifyToggle.checked = false;
    notifyStatus.textContent = t("Notifications bloquées sur cet appareil.");
    container.querySelector("#notify-help").textContent = deniedHelp();
    deniedBox.style.display = "";
  }
  const permissionNow = () => ("Notification" in window ? Notification.permission : "unsupported");
  // Retour dans l'app après être allé dans les réglages : autorisation rétablie ?
  const recheck = () => {
    if (!deniedBox.isConnected) { document.removeEventListener("visibilitychange", recheck); return; }
    if (document.visibilityState === "visible" && deniedBox.style.display !== "none" && permissionNow() === "granted") {
      deniedBox.style.display = "none";
      toast(t("Notifications autorisées ✅"));
      notifyToggle.checked = true;
      notifyToggle.onchange();
    }
  };
  document.addEventListener("visibilitychange", recheck);
  navigator.permissions?.query({ name: "notifications" }).then(st => { st.onchange = recheck; }).catch(() => null);
  container.querySelector("#notify-retry").onclick = async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission().catch(() => Notification.permission);
    if (perm === "granted") { deniedBox.style.display = "none"; notifyToggle.checked = true; notifyToggle.onchange(); }
    else if (perm === "default") toast(t("Demande fermée sans réponse : réessaie et choisis « Autoriser »."), 3500);
    else toast(t("Ton appareil bloque encore la demande : suis les étapes ci-dessus."), 4000);
  };
  function showNotifyState() {
    notifyTest.style.display = notifyToggle.checked && pushActive() ? "" : "none";
    if (!notifyToggle.checked) { notifyStatus.textContent = ""; return; }
    if (pushActive()) notifyStatus.textContent = t("✅ Activées — elles arrivent même si tu es sur une autre app ou écran verrouillé.");
    else if (timerSync.unavailable) notifyStatus.textContent = t("Activées seulement app ouverte : un bloqueur de contenu empêche le module de notifications de se charger.");
    else if (!pushConfigured()) notifyStatus.textContent = t("Activées, mais seulement quand l'app est à l'écran : le serveur de notifications n'est pas encore configuré.");
    else notifyStatus.textContent = t("Activées seulement app ouverte — désactive puis réactive pour les recevoir aussi sur une autre app.");
  }
  if (!("Notification" in window)) {
    notifyToggle.disabled = !iosNotInstalled;
    notifyStatus.textContent = iosNotInstalled
      ? t("Sur iPhone, ajoute l'app à ton écran d'accueil (Partager → Sur l'écran d'accueil), puis active les notifications depuis l'app installée.")
      : t("Les notifications ne sont pas prises en charge par ce navigateur.");
  } else if (Notification.permission === "denied") {
    showDenied();
  } else {
    showNotifyState();
  }
  notifyToggle.onchange = async () => {
    notifyToggle.disabled = true;
    if (!notifyToggle.checked) {
      await setRestNotificationsEnabled(false);
      await disablePush();
      showNotifyState();
      notifyToggle.disabled = false;
      return;
    }
    notifyStatus.textContent = t("Activation…");
    if (iosNotInstalled || !("Notification" in window)) {
      notifyToggle.checked = false;
      notifyStatus.textContent = t("Sur iPhone, ajoute l'app à ton écran d'accueil (Partager → Sur l'écran d'accueil), puis active les notifications depuis l'app installée.");
      notifyToggle.disabled = false;
      return;
    }
    const ok = await setRestNotificationsEnabled(true);
    if (!ok) {
      if (permissionNow() === "denied") showDenied();
      else { notifyToggle.checked = false; notifyStatus.textContent = t("Demande fermée sans réponse : réessaie et choisis « Autoriser »."); }
      notifyToggle.disabled = false;
      return;
    }
    deniedBox.style.display = "none";
    if (pushConfigured()) {
      try {
        await enablePush();
      } catch (err) {
        console.error("[Skullcrusher] Activation push", err);
        showNotifyState();
        notifyStatus.textContent += ` (${err.message})`;
        notifyToggle.disabled = false;
        return;
      }
    }
    showNotifyState();
    notifyToggle.disabled = false;
  };
  notifyTest.onclick = async () => {
    notifyTest.disabled = true;
    const ok = await scheduleRestPush(Date.now() + 10000, t("Test réussi : le minuteur te préviendra même depuis une autre app."));
    toast(ok ? t("Passe sur une autre app : la notification arrive dans 10 s") : t("Échec de l'envoi au serveur de notifications"), 3500);
    setTimeout(() => { notifyTest.disabled = false; }, 10000);
  };

  const fileInput = container.querySelector("#csv-file");
  const filenameEl = container.querySelector("#csv-filename");
  const importBtn = container.querySelector("#start-import");

  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (file) {
      filenameEl.textContent = t("Fichier sélectionné : {name}", { name: file.name });
      importBtn.disabled = false;
    } else {
      filenameEl.textContent = "";
      importBtn.disabled = true;
    }
  };

  importBtn.onclick = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const progressWrap = container.querySelector("#import-progress");
    const fill = container.querySelector("#progress-fill");
    const text = container.querySelector("#progress-text");
    const resultEl = container.querySelector("#import-result");
    importBtn.disabled = true;
    importBtn.textContent = t("Import en cours…");
    progressWrap.style.display = "block";
    resultEl.innerHTML = "";
    try {
      const stats = await importCsvFile(file, (done, total, _stats, label) => {
        if (!fill.isConnected) return; // l'utilisateur a changé d'onglet, on n'écrit plus dans le DOM
        if (label) {
          text.textContent = label + "…";
        } else {
          const pct = Math.round((done / total) * 100);
          fill.style.width = pct + "%";
          text.textContent = t("{done} / {total} séries traitées…", { done, total });
        }
      });
      if (resultEl.isConnected) {
        progressWrap.style.display = "none";
        resultEl.innerHTML = `
          <p style="color:var(--green)">${t("Import terminé.")}</p>
          <p class="muted">
            ${t("{n} séance(s) créée(s)", { n: stats.workoutsCreated })} ·
            ${t("{n} série(s) importée(s)", { n: stats.setsImported })} ·
            ${t("{n} doublon(s) ignoré(s)", { n: stats.setsSkippedDuplicate })}
            ${stats.errors ? ` · ${t("{n} erreur(s)", { n: stats.errors })}` : ""}
          </p>
          ${stats.errors ? `<p style="color:var(--red)">${t("Une partie de l'import a échoué{detail}. Relance l'import : ce qui est déjà enregistré sera ignoré.", { detail: stats.lastError ? ` (${esc(stats.lastError)})` : "" })}</p>` : ""}
          <p class="muted">${t("Tes séances importées sont privées. Ouvre une séance dans l'Historique pour la partager sur le feed.")}</p>
        `;
      }
      invalidateStatsCache();
      invalidate("exercises", "workouts");
      toast(t("Import terminé"));
      renderExerciseLib(container); // no-op silencieux si l'onglet a changé (voir garde ci-dessous)
    } catch (err) {
      if (progressWrap.isConnected) progressWrap.style.display = "none";
      if (resultEl.isConnected) resultEl.innerHTML = `<p style="color:var(--red)">${err.message}</p>`;
    }
    if (importBtn.isConnected) {
      importBtn.disabled = false;
      importBtn.textContent = t("Importer");
    }
    fileInput.value = "";
    filenameEl.textContent = "";
  };

  container.querySelector("#export-csv").onclick = exportCsv;
  container.querySelector("#force-update").onclick = forceUpdate;
  container.querySelector("#load-seed").onclick = () => loadSeedLibrary(container);
  container.querySelector("#check-muscles").onclick = () => checkMuscleGroups(container);

  await renderExerciseLib(container);
}

// Compare le groupe de chaque exercice à celui proposé (liste standard,
// fiche d'exercice, nom), corrige ceux qu'on peut modifier, puis recalcule
// les muscles affichés sur ses séances passées.
async function checkMuscleGroups(container) {
  const btn = container.querySelector("#check-muscles");
  btn.disabled = true;
  btn.textContent = t("Vérification…");
  let exercises, suggestions;
  try {
    const { suggestMuscleGroup } = await import("./muscles.js");
    invalidate("exercises"); // bibliothèque à jour (d'autres ont pu ajouter des exercices)
    exercises = await getExercises();
    suggestions = await Promise.all(exercises.map(ex => suggestMuscleGroup(ex.name)));
  } catch (err) {
    console.error("[Skullcrusher] Vérification des groupes", err);
    toast(t("Action impossible, réessaie"));
    btn.disabled = false; btn.textContent = "🔎 " + t("Vérifier les groupes musculaires");
    return;
  }
  btn.disabled = false; btn.textContent = "🔎 " + t("Vérifier les groupes musculaires");
  const wrong = exercises.map((ex, i) => ({ ex, to: suggestions[i] })).filter(x => x.to && x.to !== x.ex.muscle_group);
  const fixable = wrong.filter(x => db.canEditExercise(x.ex));
  const locked = wrong.length - fixable.length;
  openModal(`
    <h3>🔎 ${t("Groupes musculaires")}</h3>
    ${fixable.length ? `
      <p class="muted" style="margin-top:0;">${t("Groupes qui semblent faux (décoche ceux à garder) :")}</p>
      <div style="max-height:45vh; overflow:auto;">
        ${fixable.map((x, i) => `
          <label class="list-row" style="cursor:pointer;">
            <span><b>${esc(x.ex.name)}</b><br><span class="muted">${esc(t(x.ex.muscle_group || "Autre"))} → <b style="color:var(--text);">${esc(t(x.to))}</b></span></span>
            <input type="checkbox" data-fix="${i}" checked style="width:auto;">
          </label>`).join("")}
      </div>` : `<p class="muted" style="margin-top:0;">${t("Aucun groupe à corriger parmi les exercices que tu peux modifier.")}</p>`}
    ${locked ? `<p class="muted" style="font-size:12px;">${t("{n} autre(s) exercice(s) semble(nt) mal classé(s) mais appartien(nen)t à d'autres utilisateurs : seul l'administrateur peut les corriger.", { n: locked })}</p>` : ""}
    <p class="muted" style="font-size:13px;">${t("Les muscles affichés sur tes séances passées (feed, historique) seront recalculés.")}</p>
    <p class="muted" id="fix-progress" style="font-size:13px; min-height:1em;"></p>
    <div class="btn-row">
      <button class="btn btn-secondary" id="fix-cancel">${t("Fermer")}</button>
      <button class="btn btn-primary" id="fix-ok">${fixable.length ? t("Corriger") : t("Recalculer mes séances")}</button>
    </div>
  `, (m) => {
    m.querySelector("#fix-cancel").onclick = closeModal;
    m.querySelector("#fix-ok").onclick = async (e) => {
      e.target.disabled = true;
      const progress = m.querySelector("#fix-progress");
      try {
        const chosen = [...m.querySelectorAll("[data-fix]:checked")].map(c => fixable[+c.dataset.fix]);
        for (const x of chosen) await db.updateExercise(x.ex.id, { muscle_group: x.to });
        invalidate("exercises");
        const groupOf = new Map((await getExercises()).map(ex => [ex.name, ex.muscle_group]));
        const updated = await db.recomputeMuscleSummaries(groupOf, (n) => { progress.textContent = t("Lecture de tes séries… {n}", { n }); });
        invalidate("workouts");
        invalidateStatsCache();
        closeModal();
        toast(t("{fixed} exercice(s) corrigé(s), {updated} séance(s) mise(s) à jour", { fixed: chosen.length, updated }), 3500);
        renderExerciseLib(container);
      } catch (err) {
        console.error("[Skullcrusher] Correction des groupes", err);
        progress.textContent = t("Action impossible, réessaie");
        e.target.disabled = false;
      }
    };
  });
}

async function loadSeedLibrary(container) {
  const btn = container.querySelector("#load-seed");
  btn.disabled = true;
  btn.textContent = t("Chargement…");
  let added = 0;
  const existing = await getExercises();
  const existingNames = new Set(existing.map(e => e.name.toLowerCase()));
  for (const [name, group] of EXERCISE_SEED) {
    if (!existingNames.has(name.toLowerCase())) {
      await db.upsertExercise(name, group, "", false);
      added++;
    }
  }
  invalidate("exercises");
  if (btn.isConnected) {
    btn.disabled = false;
    btn.textContent = t("Charger la bibliothèque standard");
  }
  toast(added > 0 ? t("{n} exercice(s) ajouté(s)", { n: added }) : t("Bibliothèque déjà à jour"));
  if (container.querySelector("#exercise-lib")) renderExerciseLib(container);
}

async function renderExerciseLib(container) {
  const exercises = await getExercises();
  const wrap = container.querySelector("#exercise-lib");
  if (!wrap) return; // l'utilisateur a changé d'onglet pendant le chargement
  wrap.innerHTML = exercises.length === 0
    ? `<p class="muted">${t("Aucun exercice pour l'instant.")}</p>`
    : exercises.map(ex => `
      <div class="list-row" data-ex="${ex.id}" data-ex-name="${esc(ex.name)}" data-ex-group="${esc(ex.muscle_group)}">
        <div>
          <div class="list-row-title">${esc(ex.name)}</div>
          <div class="list-row-sub">${esc(t(ex.muscle_group))}</div>
        </div>
        ${db.canEditExercise(ex) ? `<button class="btn btn-sm btn-secondary" data-edit-ex="${ex.id}">${t("Modifier")}</button>` : ""}
      </div>
    `).join("");
  wrap.querySelectorAll("[data-edit-ex]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openExerciseEditModal(exercises.find(ex => ex.id === btn.dataset.editEx), container);
    };
  });
  wrap.querySelectorAll(".list-row[data-ex]").forEach(row => {
    row.onclick = () => openExerciseDetail(row.dataset.exName, row.dataset.exGroup);
  });
}

function openExerciseEditModal(ex, container) {
  const modal = openModal(`
    <h3>${esc(ex.name)}</h3>
    <label>${t("Groupe musculaire")}</label>
    <select id="edit-group">${db.EXO_GROUPS.map(g => `<option value="${esc(g)}" ${g === ex.muscle_group ? "selected" : ""}>${esc(t(g))}</option>`).join("")}</select>
    <label>${t("Minuteur de repos par défaut (secondes)")}</label>
    <input id="edit-rest" type="number" value="${ex.rest_timer_seconds || 90}">
    <div style="height:14px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="edit-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="edit-save">${t("Enregistrer")}</button>
    </div>
    ${ex.is_custom ? `<button class="btn btn-danger" id="edit-delete" style="margin-top:10px;">${t("Supprimer cet exercice")}</button>` : ""}
  `, (modalEl) => {
    modalEl.querySelector("#edit-cancel").onclick = closeModal;
    modalEl.querySelector("#edit-save").onclick = async () => {
      await db.updateExercise(ex.id, {
        muscle_group: modalEl.querySelector("#edit-group").value,
        rest_timer_seconds: parseInt(modalEl.querySelector("#edit-rest").value, 10) || 90
      });
      invalidate("exercises");
      closeModal();
      toast(t("Exercice mis à jour"));
      renderExerciseLib(container);
    };
    const delBtn = modalEl.querySelector("#edit-delete");
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm(t("Supprimer cet exercice de la bibliothèque ? (les séries déjà loggées sont conservées)"))) return;
      await db.deleteExercise(ex.id);
      invalidate("exercises");
      closeModal();
      renderExerciseLib(container);
    };
  });
}

// Information obligatoire avant la connexion Spotify : quelles données,
// pourquoi, et comment les supprimer.
function openSpotifyConsent(onAccept) {
  openModal(`
    <h3>${t("Connecter Spotify")}</h3>
    <p class="muted" style="margin-top:0;">${t("Skullcrusher demandera à Spotify l'accès à :")}</p>
    <ul style="padding-left:20px; line-height:1.5;">
      <li><b>${t("Morceau en cours d'écoute")}</b> — ${t("pour te proposer le « son du record » en fin de séance.")}</li>
      <li><b>${t("Morceaux écoutés récemment")}</b> — ${t("pour te proposer de joindre la bande-son à ta séance.")}</li>
    </ul>
    <p class="muted">${t("Rien n'est enregistré sans ton accord, seuls les liens des morceaux sont conservés, et tes écoutes ne sont jamais analysées ni transmises à des tiers. La déconnexion efface le jeton et toutes les données venues de Spotify.")}</p>
    <p><a href="privacy.html" style="color:var(--text); text-decoration-color:var(--amber);">${t("Politique de confidentialité")}</a></p>
    <div class="btn-row">
      <button class="btn btn-secondary" id="sc-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="sc-ok">${t("Continuer vers Spotify")}</button>
    </div>
  `, (m) => {
    m.querySelector("#sc-cancel").onclick = closeModal;
    m.querySelector("#sc-ok").onclick = () => { closeModal(); onAccept(); };
  });
}

// Connexion Spotify (facultative) : app partagée, ou sa propre app Spotify.
async function setupBodyCard(container) {
  const $ = (id) => container.querySelector(id);
  const info = $("#body-info");
  const showInfo = (b) => {
    info.textContent = bodyComplete(b)
      ? t("Métabolisme de repos : ≈ {kcal} kcal/jour.", { kcal: Math.round(restingKcalPerDay(b)) })
      : t("Remplis les 4 champs pour activer l'estimation.");
  };
  const body = await getBody();
  if (!$("#body-sex")?.isConnected) return;
  if (body) {
    $("#body-sex").value = body.sex || "";
    $("#body-year").value = body.birth_year || "";
    $("#body-height").value = body.height_cm || "";
    $("#body-weight").value = body.weight_kg || "";
  }
  showInfo(body);
  $("#body-save").onclick = async (e) => {
    const b = {
      sex: $("#body-sex").value || null,
      birth_year: parseInt($("#body-year").value, 10) || null,
      height_cm: parseInt($("#body-height").value, 10) || null,
      weight_kg: parseFloat($("#body-weight").value) || null
    };
    const year = new Date().getFullYear();
    if ((b.birth_year && (b.birth_year < 1920 || b.birth_year > year - 10)) || (b.height_cm && (b.height_cm < 120 || b.height_cm > 230)) || (b.weight_kg && (b.weight_kg < 30 || b.weight_kg > 250))) {
      info.textContent = t("Valeur hors limites : vérifie l'année, la taille et le poids.");
      return;
    }
    e.target.disabled = true;
    try {
      await saveBody(b);
      showInfo(b);
      toast(t("Données enregistrées"));
    } catch (err) {
      console.error("[Skullcrusher] Données corporelles", err);
      toast(t("Enregistrement impossible, réessaie."));
    }
    e.target.disabled = false;
  };
}

// Administrateur : signalements de profils à traiter.
async function renderReports(container) {
  const wrap = container.querySelector("#reports-list");
  if (!wrap) return;
  const [{ reportReasonLabel, openProfile }] = await Promise.all([import("./profile.js")]);
  let reports = [];
  try { reports = await db.listReports("open"); } catch (e) {
    wrap.innerHTML = `<p class="muted">${t("Signalements indisponibles (règles Firebase à mettre à jour ?).")}</p>`;
    return;
  }
  if (!wrap.isConnected) return;
  updateReportsBadge(reports.length);
  wrap.innerHTML = reports.length ? reports.map(r => `
    <div class="report-row" data-report="${esc(r.id)}">
      <div><b class="profile-link" data-profile="${esc(r.target_uid)}">${esc(r.target_name || t("Utilisateur"))}</b> · ${esc(reportReasonLabel(r.reason))}</div>
      ${r.comment ? `<div style="font-size:14px; margin:4px 0;">« ${esc(r.comment)} »</div>` : ""}
      <div class="muted" style="font-size:12px;">${t("par {name}", { name: esc(r.reporter_name || t("Utilisateur")) })} · ${esc(new Date(r.created_at).toLocaleDateString())}</div>
      <div class="btn-row" style="margin-top:6px;">
        <button class="btn btn-sm btn-danger" data-clear="${esc(r.id)}">${t("Vider le profil")}</button>
        <button class="btn btn-sm btn-secondary" data-done="${esc(r.id)}">${t("Classer")}</button>
      </div>
    </div>`).join("") : `<p class="muted" style="margin:0;">${t("Aucun signalement en attente.")}</p>`;
  wrap.querySelectorAll("[data-profile]").forEach(el => el.onclick = () => openProfile(el.dataset.profile));
  wrap.querySelectorAll("[data-done]").forEach(b => b.onclick = async () => {
    await db.closeReport(b.dataset.done, "dismissed");
    toast(t("Signalement classé"));
    renderReports(container);
  });
  wrap.querySelectorAll("[data-clear]").forEach(b => b.onclick = async () => {
    const r = reports.find(x => x.id === b.dataset.clear);
    if (!confirm(t("Vider le profil public de {name} (bio, photo, salle, exercices phares, musique) ? Son pseudo et ses séances ne sont pas touchés.", { name: r.target_name || t("Utilisateur") }))) return;
    try {
      await db.clearPublicProfile(r.target_uid);
      await db.closeReport(r.id, "cleared");
      toast(t("Profil vidé"));
    } catch (e) {
      console.error("[Skullcrusher] Modération", e);
      toast(t("Action impossible, réessaie"));
    }
    renderReports(container);
  });
}

// Pastille sur l'onglet Réglages quand des signalements attendent (admin).
export function updateReportsBadge(n) {
  const btn = document.querySelector(".tab-btn[data-tab=reglages]");
  if (!btn) return;
  btn.querySelector(".tab-badge")?.remove();
  if (n > 0) btn.insertAdjacentHTML("beforeend", `<span class="tab-badge">${n > 9 ? "9+" : n}</span>`);
}
export async function checkReportsBadge() {
  if (!db.isAdmin()) return;
  try { updateReportsBadge((await db.listReports("open")).length); } catch (_) {}
}

async function setupSpotifyCard(container) {
  let sp;
  try { sp = await import("./spotify-connect.js"); } catch (_) { return; }
  const card = container.querySelector("#spotify-card");
  if (!card) return;
  const status = container.querySelector("#spotify-status");
  const btn = container.querySelector("#spotify-btn");
  const own = container.querySelector("#spotify-own");
  const idInput = container.querySelector("#spotify-client-id");
  const idInfo = container.querySelector("#spotify-client-info");
  container.querySelector("#spotify-redirect").value = sp.redirectUri();
  container.querySelector("#spotify-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(sp.redirectUri()); toast(t("Adresse copiée")); }
    catch (_) { container.querySelector("#spotify-redirect").select(); }
  };

  const [connected, settings] = await Promise.all([sp.isSpotifyConnected(), sp.getClientSettings()]);
  if (!btn.isConnected) return;
  idInput.value = settings.own;
  idInfo.textContent = settings.own
    ? t("✅ Ta propre app Spotify est utilisée. Vide le champ puis OK pour revenir à l'app partagée.")
    : settings.clientId ? t("Pour l'instant, l'app Spotify partagée est utilisée.") : "";
  if (!settings.clientId) own.open = true;

  status.textContent = connected
    ? "✅ " + (settings.own ? t("Compte Spotify connecté (ta propre app).") : t("Compte Spotify connecté (app partagée)."))
    : !settings.clientId
      ? t("Pour connecter Spotify, crée ta propre app Spotify ci-dessous.")
      : t("Non connecté. Sur iPhone, lance la connexion depuis Safari (pas depuis l'icône) : elle marchera ensuite aussi dans l'app installée.");
  btn.textContent = connected ? t("Déconnecter Spotify") : t("Connecter Spotify");
  btn.disabled = !connected && !settings.clientId;
  btn.onclick = async () => {
    if (connected) {
      if (!confirm(t("Déconnecter Spotify ? Les bandes-son et les sons de record venus de Spotify seront effacés de tes séances."))) return;
      btn.disabled = true;
      try {
        const n = await sp.disconnectSpotify();
        toast(n ? t("Spotify déconnecté — données effacées de {n} séance(s)", { n }) : t("Spotify déconnecté"), 3500);
      } catch (e) {
        console.error("[Skullcrusher] Déconnexion Spotify", e);
        toast(t("Déconnexion impossible, réessaie"));
      }
      setupSpotifyCard(container);
    } else {
      openSpotifyConsent(() => sp.connectSpotify().catch(e => toast(e.message, 4000)));
    }
  };

  container.querySelector("#spotify-client-save").onclick = async () => {
    const value = idInput.value.trim();
    try {
      await sp.setOwnClientId(value);
      // Le jeton actuel appartient à l'ancienne app : il faut se reconnecter.
      if (connected && value !== settings.own) await sp.forgetToken();
      toast(value ? t("Client ID enregistré — tu peux connecter Spotify") : t("Retour à l'app Spotify partagée"), 3500);
      setupSpotifyCard(container);
    } catch (e) {
      idInfo.textContent = e.message;
    }
  };
}

// Vide le cache hors ligne et recharge : utile si le téléphone garde une
// ancienne version de l'app (surtout en mode "écran d'accueil" sur iOS).
async function forceUpdate() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) || [];
    await Promise.all(regs.map(r => r.unregister()));
    const keys = (await window.caches?.keys()) || [];
    await Promise.all(keys.map(k => caches.delete(k)));
  } catch (e) {
    console.warn("[Skullcrusher] Mise à jour forcée incomplète :", e);
  }
  location.reload();
}

async function exportCsv() {
  const sets = await db.listAllSets(20000);
  const workouts = await db.listWorkouts(2000);
  const workoutMap = Object.fromEntries(workouts.map(w => [w.id, w]));
  const header = "title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps,rpe\n";
  const rows = sets.map(s => {
    const w = workoutMap[s.workout_id] || {};
    return [
      `"${(w.title || "").replace(/"/g, '""')}"`,
      w.start_time || "", w.end_time || "",
      `"${s.exercise_title.replace(/"/g, '""')}"`,
      s.set_index, s.set_type, s.weight_kg ?? "", s.reps ?? "", s.rpe ?? ""
    ].join(",");
  });
  const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `skullcrusher-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
