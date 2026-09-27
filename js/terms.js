// ============================================================
// CONDITIONS D'UTILISATION — acceptation au premier lancement
// ============================================================
// Skullcrusher affiche des estimations (1RM, calories, progression des
// charges, plans) : l'utilisateur doit accepter, une fois par compte, qu'elles
// ne remplacent pas un coach diplômé ni un médecin (voir conditions.html).
// L'acceptation est rangée dans user_private/{uid} (privé) et mémorisée sur
// l'appareil pour ne pas relire Firestore à chaque ouverture.
// Changer TERMS_VERSION redemande l'accord à tout le monde.
import { getPrivateData, setPrivateData } from "./db.js";
import { openModal, toast } from "./utils.js";
import { t } from "./i18n.js";

export const TERMS_VERSION = "1";
const cacheKey = (uid) => `skullcrusher_terms_${uid}`;

function readCache(uid) {
  try { return localStorage.getItem(cacheKey(uid)) === TERMS_VERSION; } catch (_) { return false; }
}
function writeCache(uid) {
  try { localStorage.setItem(cacheKey(uid), TERMS_VERSION); } catch (_) { /* navigation privée */ }
}

let pending = false;

export async function ensureTermsAccepted(user) {
  if (!user || pending || readCache(user.uid)) return;
  pending = true;
  try {
    const data = await getPrivateData().catch(() => null);
    if (data?.terms_version === TERMS_VERSION) { writeCache(user.uid); return; }
    await showTermsModal(user);
  } finally {
    pending = false;
  }
}

function showTermsModal(user) {
  return new Promise((resolve) => {
    openModal(`
      <h3>⚠️ ${t("Avant de commencer")}</h3>
      <div class="terms-box">
        <p style="margin-top:0;">${t("Skullcrusher t'aide à suivre tes entraînements. Les 1RM estimées, les charges proposées par la progression, les plans, les routines, les guides d'exercices et les calories sont des estimations calculées automatiquement.")}</p>
        <p><b>${t("Elles ne remplacent pas l'avis d'un coach diplômé, d'un kinésithérapeute ni d'un médecin.")}</b> ${t("Consulte un professionnel de santé avant de commencer ou de reprendre un programme, surtout en cas de douleur, de blessure ou de problème de santé.")}</p>
        <p>${t("Tu restes seul(e) responsable de l'usage que tu fais de ces données, des charges que tu soulèves et de ta sécurité (échauffement, technique, pareur pour les charges lourdes).")}</p>
        <p style="margin-bottom:0;"><a href="conditions.html" target="_blank" rel="noopener" style="color:var(--text); text-decoration-color:var(--amber);">${t("Lire les conditions d'utilisation complètes")}</a></p>
      </div>
      <label class="terms-check"><input type="checkbox" id="terms-check"> <span>${t("J'ai lu et j'accepte les conditions d'utilisation.")}</span></label>
      <button class="btn btn-primary" id="terms-accept" disabled style="width:100%;">${t("Accepter et continuer")}</button>
    `, (m) => {
      const check = m.querySelector("#terms-check");
      const btn = m.querySelector("#terms-accept");
      check.onchange = () => { btn.disabled = !check.checked; };
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await setPrivateData({ terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() });
        } catch (e) {
          // Hors ligne : on retient l'accord sur l'appareil, il sera
          // redemandé (et enregistré) sur un autre appareil.
          console.warn("[Skullcrusher] Conditions :", e);
          toast(t("Accord enregistré sur cet appareil."));
        }
        writeCache(user.uid);
        m.closest(".modal-backdrop").remove();
        document.body.style.overflow = "";
        window.dispatchEvent(new Event("sc:modal-close"));
        resolve();
      };
    }, { locked: true });
  });
}
