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

// Module des notifications en arrière-plan, chargé à la demande : si un
// bloqueur de contenu le refuse, les Réglages s'affichent quand même.
const TIMER_SYNC_FALLBACK = {
  unavailable: true,
  pushConfigured: () => false,
  pushActive: () => false,
  enablePush: async () => { throw new Error("module de notifications bloqué (bloqueur de contenu ?)"); },
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
  const displayName = profile?.display_name || user?.displayName || "Utilisateur";
  const photoSrc = safeImageUrl(profile?.photo_data_url || user?.photoURL || "");

  container.innerHTML = `
    <h1 class="section-title">Réglages</h1>

    <div class="card">
      <div class="card-title">Compte</div>
      <div style="display:flex; align-items:center; gap:14px; margin:10px 0 14px;">
        <div style="position:relative; flex-shrink:0;">
          <div id="profile-photo-preview" style="width:64px; height:64px; border-radius:50%; background:var(--surface-raised) center/cover no-repeat; ${photoSrc ? `background-image:url('${photoSrc}');` : ""} display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:700; color:var(--amber);">${photoSrc ? "" : esc(displayName[0].toUpperCase())}</div>
          <label for="profile-photo-input" style="position:absolute; bottom:-2px; right:-2px; width:24px; height:24px; border-radius:50%; background:var(--amber); display:flex; align-items:center; justify-content:center; font-size:12px; cursor:pointer; border:2px solid var(--bg-elevated);">✎</label>
          <input type="file" id="profile-photo-input" accept="image/*" style="display:none;">
        </div>
        <div style="flex:1;">
          <label style="margin-top:0;">Pseudo</label>
          <input id="profile-name-input" value="${esc(displayName)}" maxlength="30">
        </div>
      </div>
      <p class="muted" style="margin:0 0 10px;">${user?.email || ""}</p>
      <button class="btn btn-primary btn-sm" id="save-profile-btn">Enregistrer le profil</button>
      <p class="muted" id="profile-save-status" style="margin-top:6px;"></p>
      <div class="btn-row" style="margin-top:6px;">
        <button class="btn btn-secondary btn-sm" id="view-public-profile">Voir mon profil</button>
        <button class="btn btn-secondary btn-sm" id="edit-public-profile">🏆 Exercices phares & 🎧 musique</button>
      </div>
      <button class="btn btn-secondary" id="signout-btn" style="margin-top:10px;">Se déconnecter</button>
    </div>

    <div class="card" id="spotify-card" style="display:none;">
      <div class="card-title">🎧 Spotify</div>
      <p class="muted" style="margin-top:0;">Connecte ton compte pour proposer automatiquement le morceau en cours comme « son du record » et joindre la bande-son de tes séances (morceaux écoutés pendant l'entraînement). <a href="privacy.html" style="color:var(--text);">Données utilisées</a></p>
      <p class="muted" id="spotify-status" style="font-size:13px;"></p>
      <button class="btn btn-secondary btn-sm" id="spotify-btn"></button>
    </div>

    <div class="card">
      <div class="card-title">Minuteur de repos</div>
      <p class="muted" style="margin-top:0;">Reçois une notification à la fin du repos, même si tu es passé sur une autre app (Spotify...) ou que l'écran est verrouillé. Sur iPhone, il faut utiliser l'app ajoutée à l'écran d'accueil. La durée par défaut se règle par exercice, dans la bibliothèque ci-dessous.</p>
      <div class="list-row" style="cursor:default;">
        <div class="list-row-title">Notifications de fin de repos</div>
        <label class="switch">
          <input type="checkbox" id="notify-toggle" ${restNotificationsEnabled() ? "checked" : ""}>
          <span class="switch-track"></span>
        </label>
      </div>
      <p class="muted" id="notify-status" style="margin-top:6px;"></p>
      <button class="btn btn-secondary btn-sm" id="notify-test" style="display:none;">Tester : notification dans 10 s</button>
    </div>

    <div class="card">
      <div class="card-title">Réinitialiser</div>
      <p class="muted" style="margin-top:0;">Supprime toutes tes séances et leurs séries (les exercices et routines partagés ne sont pas touchés) — utile pour repartir propre avant un réimport.</p>
      <button class="btn btn-danger" id="wipe-btn">Supprimer toutes mes séances</button>
      <div id="wipe-result"></div>
    </div>

    <div class="card">
      <div class="card-title">Importer un CSV</div>
      <p class="muted" style="margin-top:0;">Export Hevy (Profil → Réglages → Exporter les données). Les séries déjà importées sont détectées et ignorées automatiquement — aucun doublon possible, même en réimportant plusieurs fois le même fichier.</p>
      <input type="file" id="csv-file" accept=".csv,text/csv">
      <p class="muted" id="csv-filename" style="margin:8px 0 0;"></p>
      <div style="height:10px"></div>
      <button class="btn btn-primary" id="start-import" disabled>Importer</button>
      <div id="import-progress" style="display:none;">
        <div class="progress-bar"><div class="progress-bar-fill" id="progress-fill" style="width:0%"></div></div>
        <p class="muted" id="progress-text"></p>
      </div>
      <div id="import-result"></div>
    </div>

    <div class="card">
      <div class="card-title">Export</div>
      <p class="muted" style="margin-top:0;">Télécharge toutes tes séries au format CSV.</p>
      <button class="btn btn-secondary" id="export-csv">Exporter en CSV</button>
    </div>

    <div class="card">
      <div class="card-title">À propos</div>
      <p class="muted" style="margin-top:0;">Version de l'app : <b>${APP_VERSION}</b> · Projet Firebase : ${esc(firebaseConfig.projectId)}</p>
      <button class="btn btn-secondary btn-sm" id="force-update">Forcer la mise à jour</button>
      <p style="margin:10px 0 0;"><a href="privacy.html" style="color:var(--text); text-decoration-color:var(--amber);">Politique de confidentialité</a></p>
      <p class="muted">Ajoute cette page à ton écran d'accueil (icône Partager → "Sur l'écran d'accueil") pour l'utiliser comme une app.</p>
    </div>

    <div class="card">
      <div class="card-title">Bibliothèque d'exercices</div>
      <p class="muted" style="margin-top:0;">Complète ta bibliothèque avec ${EXERCISE_SEED.length} exercices standards (barre, haltère, machine, poulie, poids du corps) — les exercices déjà présents ne sont pas dupliqués.</p>
      <button class="btn btn-secondary" id="load-seed">Charger la bibliothèque standard</button>
      <p class="muted" style="margin:10px 0 0; font-size:13px;">Bibliothèque commune à tous les utilisateurs : tu peux modifier les exercices que tu as ajoutés, pas ceux des autres.</p>
      <div style="height:12px"></div>
      <div id="exercise-lib"></div>
    </div>
  `;

  setupSpotifyCard(container);
  container.querySelector("#view-public-profile").onclick = () => openProfile(getUser()?.uid);
  container.querySelector("#edit-public-profile").onclick = () => openProfileEditor(() => openProfile(getUser()?.uid));

  container.querySelector("#signout-btn").onclick = async () => {
    if (!confirm("Se déconnecter de Skullcrusher ?")) return;
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
      toast("Impossible de lire cette image");
    }
  };

  container.querySelector("#save-profile-btn").onclick = async () => {
    const btn = container.querySelector("#save-profile-btn");
    const statusEl = container.querySelector("#profile-save-status");
    const name = container.querySelector("#profile-name-input").value.trim();
    btn.disabled = true;
    btn.textContent = "Enregistrement…";
    try {
      const patch = {};
      if (name) patch.display_name = name;
      if (pendingPhotoDataUrl !== undefined) patch.photo_data_url = pendingPhotoDataUrl;
      await db.updateMyProfile(patch);
      if (statusEl.isConnected) statusEl.textContent = "Profil enregistré.";
      toast("Profil mis à jour");
    } catch (e) {
      if (statusEl.isConnected) statusEl.textContent = e.message;
    }
    if (btn.isConnected) { btn.disabled = false; btn.textContent = "Enregistrer le profil"; }
  };

  container.querySelector("#wipe-btn").onclick = async () => {
    if (!confirm("Supprimer TOUTES tes séances et leurs séries ? Cette action est irréversible.")) return;
    if (!confirm("Vraiment sûr ? Il n'y a pas d'annulation possible.")) return;
    const btn = container.querySelector("#wipe-btn");
    const resultEl = container.querySelector("#wipe-result");
    btn.disabled = true;
    btn.textContent = "Suppression…";
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
    if (btn.isConnected) { btn.disabled = false; btn.textContent = "Supprimer toutes mes séances"; }
  };

  const notifyToggle = container.querySelector("#notify-toggle");
  const notifyStatus = container.querySelector("#notify-status");
  const notifyTest = container.querySelector("#notify-test");
  const iosNotInstalled = isIos() && !isStandalone();
  function showNotifyState() {
    notifyTest.style.display = notifyToggle.checked && pushActive() ? "" : "none";
    if (!notifyToggle.checked) { notifyStatus.textContent = ""; return; }
    if (pushActive()) notifyStatus.textContent = "✅ Activées — elles arrivent même si tu es sur une autre app ou écran verrouillé.";
    else if (timerSync.unavailable) notifyStatus.textContent = "Activées seulement app ouverte : un bloqueur de contenu empêche le module de notifications de se charger.";
    else if (!pushConfigured()) notifyStatus.textContent = "Activées, mais seulement quand l'app est à l'écran : le serveur de notifications n'est pas encore configuré.";
    else notifyStatus.textContent = "Activées seulement app ouverte — désactive puis réactive pour les recevoir aussi sur une autre app.";
  }
  if (!("Notification" in window)) {
    notifyToggle.disabled = !iosNotInstalled;
    notifyStatus.textContent = iosNotInstalled
      ? "Sur iPhone, ajoute l'app à ton écran d'accueil (Partager → Sur l'écran d'accueil), puis active les notifications depuis l'app installée."
      : "Les notifications ne sont pas prises en charge par ce navigateur.";
  } else if (Notification.permission === "denied") {
    notifyToggle.checked = false;
    notifyStatus.textContent = "Notifications bloquées — autorise-les pour cette app dans les réglages de l'iPhone (Réglages → Notifications), puis reviens ici.";
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
    notifyStatus.textContent = "Activation…";
    if (iosNotInstalled || !("Notification" in window)) {
      notifyToggle.checked = false;
      notifyStatus.textContent = "Sur iPhone, ajoute l'app à ton écran d'accueil (Partager → Sur l'écran d'accueil), puis active les notifications depuis l'app installée.";
      notifyToggle.disabled = false;
      return;
    }
    const ok = await setRestNotificationsEnabled(true);
    if (!ok) {
      notifyToggle.checked = false;
      notifyStatus.textContent = "Autorisation refusée — autorise les notifications pour cette app dans les réglages de l'iPhone.";
      notifyToggle.disabled = false;
      return;
    }
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
    const ok = await scheduleRestPush(Date.now() + 10000, "Test réussi : le minuteur te préviendra même depuis une autre app.");
    toast(ok ? "Passe sur une autre app : la notification arrive dans 10 s" : "Échec de l'envoi au serveur de notifications", 3500);
    setTimeout(() => { notifyTest.disabled = false; }, 10000);
  };

  const fileInput = container.querySelector("#csv-file");
  const filenameEl = container.querySelector("#csv-filename");
  const importBtn = container.querySelector("#start-import");

  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (file) {
      filenameEl.textContent = `Fichier sélectionné : ${file.name}`;
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
    importBtn.textContent = "Import en cours…";
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
          text.textContent = `${done} / ${total} séries traitées…`;
        }
      });
      if (resultEl.isConnected) {
        progressWrap.style.display = "none";
        resultEl.innerHTML = `
          <p style="color:var(--green)">Import terminé.</p>
          <p class="muted">
            ${stats.workoutsCreated} séance(s) créée(s) ·
            ${stats.setsImported} série(s) importée(s) ·
            ${stats.setsSkippedDuplicate} doublon(s) ignoré(s)
            ${stats.errors ? ` · ${stats.errors} erreur(s)` : ""}
          </p>
          ${stats.errors ? `<p style="color:var(--red)">Une partie de l'import a échoué${stats.lastError ? ` (${stats.lastError})` : ""}. Relance l'import : ce qui est déjà enregistré sera ignoré.</p>` : ""}
          <p class="muted">Tes séances importées sont privées. Ouvre une séance dans l'Historique pour la partager sur le feed.</p>
        `;
      }
      invalidateStatsCache();
      invalidate("exercises", "workouts");
      toast("Import terminé");
      renderExerciseLib(container); // no-op silencieux si l'onglet a changé (voir garde ci-dessous)
    } catch (err) {
      if (progressWrap.isConnected) progressWrap.style.display = "none";
      if (resultEl.isConnected) resultEl.innerHTML = `<p style="color:var(--red)">${err.message}</p>`;
    }
    if (importBtn.isConnected) {
      importBtn.disabled = false;
      importBtn.textContent = "Importer";
    }
    fileInput.value = "";
    filenameEl.textContent = "";
  };

  container.querySelector("#export-csv").onclick = exportCsv;
  container.querySelector("#force-update").onclick = forceUpdate;
  container.querySelector("#load-seed").onclick = () => loadSeedLibrary(container);

  await renderExerciseLib(container);
}

async function loadSeedLibrary(container) {
  const btn = container.querySelector("#load-seed");
  btn.disabled = true;
  btn.textContent = "Chargement…";
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
    btn.textContent = "Charger la bibliothèque standard";
  }
  toast(added > 0 ? `${added} exercice(s) ajouté(s)` : "Bibliothèque déjà à jour");
  if (container.querySelector("#exercise-lib")) renderExerciseLib(container);
}

async function renderExerciseLib(container) {
  const exercises = await getExercises();
  const wrap = container.querySelector("#exercise-lib");
  if (!wrap) return; // l'utilisateur a changé d'onglet pendant le chargement
  wrap.innerHTML = exercises.length === 0
    ? `<p class="muted">Aucun exercice pour l'instant.</p>`
    : exercises.map(ex => `
      <div class="list-row" data-ex="${ex.id}" data-ex-name="${esc(ex.name)}" data-ex-group="${esc(ex.muscle_group)}">
        <div>
          <div class="list-row-title">${esc(ex.name)}</div>
          <div class="list-row-sub">${ex.muscle_group}</div>
        </div>
        ${db.canEditExercise(ex) ? `<button class="btn btn-sm btn-secondary" data-edit-ex="${ex.id}">Modifier</button>` : ""}
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
    <label>Groupe musculaire</label>
    <select id="edit-group">${db.EXO_GROUPS.map(g => `<option ${g === ex.muscle_group ? "selected" : ""}>${g}</option>`).join("")}</select>
    <label>Minuteur de repos par défaut (secondes)</label>
    <input id="edit-rest" type="number" value="${ex.rest_timer_seconds || 90}">
    <div style="height:14px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="edit-cancel">Annuler</button>
      <button class="btn btn-primary" id="edit-save">Enregistrer</button>
    </div>
    ${ex.is_custom ? `<button class="btn btn-danger" id="edit-delete" style="margin-top:10px;">Supprimer cet exercice</button>` : ""}
  `, (modalEl) => {
    modalEl.querySelector("#edit-cancel").onclick = closeModal;
    modalEl.querySelector("#edit-save").onclick = async () => {
      await db.updateExercise(ex.id, {
        muscle_group: modalEl.querySelector("#edit-group").value,
        rest_timer_seconds: parseInt(modalEl.querySelector("#edit-rest").value, 10) || 90
      });
      invalidate("exercises");
      closeModal();
      toast("Exercice mis à jour");
      renderExerciseLib(container);
    };
    const delBtn = modalEl.querySelector("#edit-delete");
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm("Supprimer cet exercice de la bibliothèque ? (les séries déjà loggées sont conservées)")) return;
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
    <h3>Connecter Spotify</h3>
    <p class="muted" style="margin-top:0;">Skullcrusher demandera à Spotify l'accès à :</p>
    <ul style="padding-left:20px; line-height:1.5;">
      <li><b>Morceau en cours d'écoute</b> — pour te proposer le « son du record » en fin de séance.</li>
      <li><b>Morceaux écoutés récemment</b> — pour te proposer de joindre la bande-son à ta séance.</li>
    </ul>
    <p class="muted">Rien n'est enregistré sans ton accord, seuls les liens des morceaux sont conservés, et tes écoutes ne sont jamais analysées ni transmises à des tiers.
    La déconnexion efface le jeton et toutes les données venues de Spotify.</p>
    <p><a href="privacy.html" style="color:var(--text); text-decoration-color:var(--amber);">Politique de confidentialité</a></p>
    <div class="btn-row">
      <button class="btn btn-secondary" id="sc-cancel">Annuler</button>
      <button class="btn btn-primary" id="sc-ok">Continuer vers Spotify</button>
    </div>
  `, (m) => {
    m.querySelector("#sc-cancel").onclick = closeModal;
    m.querySelector("#sc-ok").onclick = () => { closeModal(); onAccept(); };
  });
}

// Connexion Spotify (facultative, visible seulement si configurée).
async function setupSpotifyCard(container) {
  let sp;
  try { sp = await import("./spotify-connect.js"); } catch (_) { return; }
  if (!sp.spotifyConfigured()) return;
  const card = container.querySelector("#spotify-card");
  const status = container.querySelector("#spotify-status");
  const btn = container.querySelector("#spotify-btn");
  if (!card) return;
  card.style.display = "";
  const connected = await sp.isSpotifyConnected();
  if (!btn.isConnected) return;
  status.textContent = connected ? "✅ Compte Spotify connecté." : "Non connecté. Sur iPhone, lance la connexion depuis Safari (pas depuis l'icône) : elle marchera ensuite aussi dans l'app installée.";
  btn.textContent = connected ? "Déconnecter Spotify" : "Connecter Spotify";
  btn.onclick = async () => {
    if (connected) {
      if (!confirm("Déconnecter Spotify ? Les bandes-son et les sons de record venus de Spotify seront effacés de tes séances.")) return;
      btn.disabled = true;
      try {
        const n = await sp.disconnectSpotify();
        toast(`Spotify déconnecté${n ? ` — données effacées de ${n} séance(s)` : ""}`, 3500);
      } catch (e) {
        console.error("[Skullcrusher] Déconnexion Spotify", e);
        toast("Déconnexion impossible, réessaie");
      }
      btn.disabled = false;
      setupSpotifyCard(container);
    } else {
      openSpotifyConsent(() => sp.connectSpotify());
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
