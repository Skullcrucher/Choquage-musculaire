// ============================================================
// NOUVELLE VERSION DISPONIBLE — à l'ouverture (et au retour dans l'app),
// compare APP_BUILD à version.json publié avec le site (écrit par
// tools/stamp-version.mjs) et propose de mettre à jour.
// ============================================================
import { APP_VERSION, APP_BUILD, openModal, closeModal, forceUpdate } from "./utils.js";
import { t } from "./i18n.js";

const LS_LATER = "skullcrusher_update_later"; // version reportée (« Plus tard »), pour cette session
let lastCheck = 0;
let open = false;

async function latestVersion() {
  // Adresse unique : ni le cache du navigateur, ni le service worker,
  // ni le CDN de GitHub Pages ne renvoient une ancienne copie.
  const resp = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!resp.ok) return null;
  const data = await resp.json();
  const build = parseInt(data.version, 10);
  return Number.isFinite(build) ? { build, label: data.label || String(build) } : null;
}

// Résout quand la fenêtre est fermée (ou tout de suite s'il n'y a rien).
export async function checkForUpdate({ force = false } = {}) {
  if (open || !navigator.onLine) return;
  if (!force && Date.now() - lastCheck < 5 * 60 * 1000) return;
  lastCheck = Date.now();
  let latest = null;
  try { latest = await latestVersion(); } catch (_) { return; }
  if (!latest || latest.build <= APP_BUILD) return;
  try { if (sessionStorage.getItem(LS_LATER) === String(latest.build)) return; } catch (_) {}
  open = true;
  await new Promise((resolve) => {
    const done = () => { open = false; resolve(); };
    openModal(`
      <div class="update-pop">
        <img src="icons/horns.png" alt="" class="update-horns">
        <h3>${t("Nouvelle mise à jour disponible")}</h3>
        <p class="muted" style="margin-top:0;">${t("La version {latest} de Skullcrusher est prête (tu as la {current}). Mets à jour pour profiter des nouveautés et des corrections.", { latest: latest.label, current: APP_VERSION })}</p>
        <button class="btn btn-primary" id="update-now" style="width:100%;">${t("Mettre à jour")}</button>
        <button class="btn btn-secondary" id="update-later" style="width:100%; margin-top:8px;">${t("Plus tard")}</button>
      </div>
    `, (m) => {
      m.querySelector("#update-now").onclick = (e) => {
        e.target.disabled = true;
        e.target.textContent = t("Mise à jour…");
        forceUpdate();
      };
      m.querySelector("#update-later").onclick = () => {
        try { sessionStorage.setItem(LS_LATER, String(latest.build)); } catch (_) {}
        closeModal();
        done();
      };
    }, { onDismiss: () => { try { sessionStorage.setItem(LS_LATER, String(latest.build)); } catch (_) {} done(); } });
  });
}
