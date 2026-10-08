// ============================================================
// RAPPEL DES DÉFIS à l'ouverture de l'app : au plus une fois par jour,
// jamais pendant une séance ni par-dessus une autre fenêtre. Rappelle le
// défi de la semaine et le classement ouvert à tous ; « Pas cette
// semaine » le met en veille jusqu'à la semaine suivante.
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, esc, isoWeek, toast } from "./utils.js";
import { t, locale } from "./i18n.js";

const LS_LAST = "skullcrusher_challenge_reminder_day";
const LS_SNOOZE = "skullcrusher_challenge_reminder_snooze";
const today = () => new Date().toDateString();
const thisWeek = () => isoWeek(new Date().toISOString());

function shouldShow() {
  try {
    if (localStorage.getItem(LS_LAST) === today()) return false;
    if (localStorage.getItem(LS_SNOOZE) === thisWeek()) return false;
    if (localStorage.getItem("skullcrusher_active_workout_id")) return false; // séance en cours
  } catch (_) { return false; }
  return true;
}

// Attend qu'aucune autre fenêtre ne soit ouverte (conditions, mise à jour…).
function whenNoModal(fn, tries = 40) {
  if (!document.querySelector(".modal-backdrop")) return fn();
  if (tries > 0) setTimeout(() => whenNoModal(fn, tries - 1), 1500);
}

export async function maybeShowChallengeReminder({ force = false } = {}) {
  if (!force && !shouldShow()) return;
  const uid = db.getCurrentUser()?.uid;
  if (!uid) return;
  const [wcMod, profile, participants] = await Promise.all([
    import("./weekly-challenge.js"),
    db.getProfile(uid).catch(() => null),
    db.listChallengeProfiles(200).catch(() => [])
  ]);
  const wc = await wcMod.weeklyChallengeHtml().then(r => r.challenge).catch(() => null);
  const joined = !!profile?.challenge?.opt_in;
  const others = participants.filter(p => p.uid !== uid).length;
  const sunday = new Date().getDay() === 0;
  whenNoModal(() => {
    try { localStorage.setItem(LS_LAST, today()); } catch (_) {}
    const pct = wc ? Math.min(100, Math.round((wc.value || 0) / Math.max(1, wc.target) * 100)) : 0;
    openModal(`
      <div class="ch-reminder">
        <div class="ch-reminder-icon">🏆</div>
        <div class="ch-reminder-title">${sunday ? t("C'est dimanche : dernier jour pour grimper au classement !") : t("Les défis de la semaine sont ouverts")}</div>
        <p class="muted" style="margin:4px 0 12px;">${t("Ouverts à tout le monde, quel que soit ton niveau : la régularité et ta progression comptent plus que les kilos.")}</p>
        ${wc ? `<div class="ch-reminder-box">
          <div class="ch-reminder-k">🎯 ${t("Défi de la semaine")}</div>
          <div class="ch-reminder-v">${esc(wc.title)}</div>
          <div class="wc-bar" style="margin-top:8px;"><div style="width:${pct}%"></div></div>
          <div class="muted" style="font-size:12px; margin-top:4px;">${wc.done ? `✅ ${t("Défi réussi !")}` : `${Number(wc.value || 0).toLocaleString(locale())} / ${Number(wc.target).toLocaleString(locale())}`}</div>
        </div>` : ""}
        <div class="ch-reminder-box">
          <div class="ch-reminder-k">📊 ${t("Classement de la semaine")}</div>
          <div class="ch-reminder-v">${joined ? t("Tu participes : chaque séance te fait grimper.") : others ? t("{n} sportifs participent déjà. Rejoins-les !", { n: others }) : t("Sois le premier à participer !")}</div>
          <div class="muted" style="font-size:12px; margin-top:4px;">${t("Podium dévoilé le dimanche sur le Feed · le vainqueur choisit la playlist de la semaine.")}</div>
        </div>
        ${joined ? "" : `<button class="btn btn-primary" id="chr-join" style="margin-top:12px;">🏆 ${t("Participer au classement")}</button>`}
        <button class="btn ${joined ? "btn-primary" : "btn-secondary"}" id="chr-see" style="margin-top:8px;">${t("Voir les défis")}</button>
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn btn-secondary btn-sm" id="chr-later">${t("Plus tard")}</button>
          <button class="btn btn-secondary btn-sm" id="chr-snooze">${t("Pas cette semaine")}</button>
        </div>
      </div>
    `, (m) => {
      const goChallenges = () => {
        closeModal();
        document.querySelector('.tab-btn[data-tab="feed"]')?.click();
        // L'onglet Feed s'affiche puis on passe sur « Défis ».
        let n = 0; const iv = setInterval(() => {
          const b = document.querySelector('[data-fmode="challenges"]');
          if (b) { b.click(); clearInterval(iv); } else if (++n > 20) clearInterval(iv);
        }, 150);
      };
      m.querySelector("#chr-see").onclick = goChallenges;
      m.querySelector("#chr-later").onclick = closeModal;
      m.querySelector("#chr-snooze").onclick = () => { try { localStorage.setItem(LS_SNOOZE, thisWeek()); } catch (_) {} closeModal(); };
      const join = m.querySelector("#chr-join");
      if (join) join.onclick = async () => {
        join.disabled = true;
        try {
          const { computeMyWeeks } = await import("./challenges.js");
          await db.updatePublicProfile({ challenge: await computeMyWeeks() });
          toast(t("Tu participes au classement de la semaine") + " 🏆");
          goChallenges();
        } catch (e) {
          console.error("[Skullcrusher] Inscription aux défis", e);
          toast(t("Inscription impossible, réessaie"));
          join.disabled = false;
        }
      };
    });
  });
}
