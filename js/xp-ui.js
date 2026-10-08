// ============================================================
// EXPÉRIENCE — affichage : carte de niveau (écran Séance), détail des
// grades et des règles, gain d'XP et passage de niveau en fin de séance.
// ============================================================
import { openModal, closeModal, esc } from "./utils.js";
import { computeXp, gradeFor, GRADES, xpForLevel } from "./xp.js";
import { getWorkouts } from "./cache.js";
import { t, locale } from "./i18n.js";

const nf = (n) => Math.round(n).toLocaleString(locale());

export function xpCardHtml(x) {
  const g = x.grade;
  return `
    <div class="xp-card tier-${g.tier}" id="xp-card" role="button" tabindex="0">
      <div class="xp-emblem">${g.icon}</div>
      <div class="xp-main">
        <div class="xp-grade">${esc(t(g.name))} <span class="xp-tier">${esc(t(g.tierName))}</span></div>
        <div class="xp-level">${t("Niveau {n}", { n: x.level })}</div>
        <div class="xp-bar"><div style="width:${x.progress.pct}%"></div></div>
        <div class="xp-sub"><span>${nf(x.progress.into)} / ${nf(x.progress.needed)} XP</span><span>${x.week.xp ? `+${nf(x.week.xp)} XP ${t("cette semaine")}` : t("Pas encore d'XP cette semaine")}</span></div>
      </div>
    </div>`;
}

// Détail : prochain grade, règles de gain, échelle des grades.
export function openXpDetail(x) {
  const g = x.grade;
  const last = x.sessions.slice(-5).reverse();
  openModal(`
    <div class="xp-hero tier-${g.tier}">
      <div class="xp-hero-icon">${g.icon}</div>
      <div class="xp-hero-name">${esc(t(g.name))}</div>
      <div class="xp-hero-sub">${t("Niveau {n}", { n: x.level })} · ${nf(x.total)} XP${x.streak >= 1 ? ` · 🔥 ${t("{n} semaine(s) régulière(s) d'affilée", { n: x.streak })}` : ""}</div>
      <div class="xp-bar xp-bar-lg"><div style="width:${x.progress.pct}%"></div></div>
      <div class="xp-hero-sub">${t("Encore {n} XP pour le niveau {l}", { n: nf(x.progress.needed - x.progress.into), l: x.level + 1 })}${g.next ? ` · ${t("prochain grade : {icon} {name} (niv. {l})", { icon: g.next.icon, name: esc(t(g.next.name)), l: g.next.level })}` : ""}</div>
    </div>
    <div class="profile-section-title">⚡ ${t("Comment gagner de l'XP")}</div>
    <ul class="xp-rules">
      <li><b>${t("Chaque séance")}</b> — ${t("40 XP + 3 XP par série (25 max). Au-delà de 4 séances dans la semaine, un peu moins : la récupération compte aussi.")}</li>
      <li><b>${t("Paliers de la semaine")}</b> — ${t("de 20 XP (1 séance) à 300 XP (6 séances), multipliés jusqu'à ×2 par ta série de semaines régulières (2 séances ou plus).")}</li>
      <li><b>${t("Alternance")}</b> — ${t("+8 XP par muscle reposé depuis 3 jours (32 max).")}</li>
      <li><b>${t("Full body")}</b> — ${t("+30 XP si une séance travaille haut (pousser + tirer) et jambes.")}</li>
      <li><b>${t("Corps complet")}</b> — ${t("+80 XP quand la semaine couvre pousser, tirer, jambes et gainage ; +40 XP pour 6 muscles différents.")}</li>
      <li><b>${t("Records")}</b> — ${t("+25 XP par record battu (3 max par séance).")}</li>
      <li><b>${t("Premiers pas")}</b> — ${t("tes 10 premières séances rapportent ×1,5.")}</li>
      <li><b>${t("Retour en force")}</b> — ${t("+50 XP pour la séance qui suit une pause de 2 semaines.")}</li>
    </ul>
    ${last.length ? `<div class="profile-section-title">🧾 ${t("Dernières séances")}</div>
      ${last.map(s => `<div class="list-row" style="cursor:default;"><div><div class="list-row-title">+${nf(s.xp)} XP</div><div class="list-row-sub">${esc(s.parts.filter(p => p.xp > 0).map(p => p.label).join(" · "))}</div></div><div class="list-row-meta">${new Date(s.at).toLocaleDateString(locale(), { day: "numeric", month: "short" })}</div></div>`).join("")}` : ""}
    <div class="profile-section-title">🏛️ ${t("Les grades")}</div>
    <div class="xp-ladder">
      ${GRADES.map(gr => {
        const gg = gradeFor(gr.level);
        const reached = x.level >= gr.level;
        return `<div class="xp-rung tier-${gg.tier} ${reached ? "reached" : ""} ${gr.level === g.level ? "current" : ""}">
          <span class="xp-rung-icon">${reached ? gr.icon : "🔒"}</span>
          <span class="xp-rung-name">${esc(t(gr.name))}</span>
          <span class="xp-rung-lvl">${t("niv. {n}", { n: gr.level })} · ${nf(xpForLevel(gr.level))} XP</span>
        </div>`;
      }).join("")}
    </div>
    <button class="btn btn-secondary" id="xp-close" style="margin-top:14px;">${t("Fermer")}</button>
  `, (m) => { m.querySelector("#xp-close").onclick = closeModal; });
}

export async function renderXpCard(el) {
  if (!el) return null;
  const x = computeXp(await getWorkouts());
  if (!el.isConnected) return x;
  el.innerHTML = xpCardHtml(x);
  const card = el.querySelector("#xp-card");
  card.onclick = () => openXpDetail(x);
  return x;
}

// Après une séance : XP gagnée (détail) et, s'il y a lieu, nouveau niveau
// ou nouveau grade, avec une animation à la hauteur.
export function showXpGain(before, after, sessionId) {
  const s = after.sessions.find(x => x.id === sessionId) || after.sessions[after.sessions.length - 1];
  if (!s) return;
  const gained = after.total - before.total;
  const levelUp = after.level > before.level;
  const newGrade = after.grade.name !== before.grade.name;
  const g = after.grade;
  openModal(`
    <div class="xp-gain ${levelUp ? "levelup" : ""} tier-${g.tier}">
      ${newGrade ? `<div class="xp-burst">${g.icon}</div><div class="xp-gain-kicker">${t("Nouveau grade !")}</div><div class="xp-gain-title">${esc(t(g.name))}</div>`
        : levelUp ? `<div class="xp-burst">⬆️</div><div class="xp-gain-kicker">${t("Niveau supérieur !")}</div><div class="xp-gain-title">${t("Niveau {n}", { n: after.level })}</div>`
        : `<div class="xp-gain-kicker">${t("Expérience gagnée")}</div>`}
      <div class="xp-gain-num">+${nf(gained)} XP</div>
      <div class="xp-gain-parts">${s.parts.map(p => `<div class="xp-part"><span>${esc(p.label)}</span><b>${p.xp ? "+" + nf(p.xp) : "✓"}</b></div>`).join("")}</div>
      <div class="xp-bar xp-bar-lg"><div style="width:${after.progress.pct}%"></div></div>
      <div class="xp-hero-sub">${g.icon} ${esc(t(g.name))} · ${t("Niveau {n}", { n: after.level })} · ${t("encore {n} XP", { n: nf(after.progress.needed - after.progress.into) })}</div>
      <button class="btn btn-primary" id="xp-ok" style="margin-top:14px;">${levelUp ? t("Trop fort 🤘") : t("Continuer")}</button>
    </div>
  `, (m) => {
    m.querySelector("#xp-ok").onclick = closeModal;
    if (levelUp) navigator.vibrate?.([60, 40, 120]);
  });
}
