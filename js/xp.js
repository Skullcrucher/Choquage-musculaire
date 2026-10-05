// ============================================================
// EXPÉRIENCE (XP), NIVEAUX ET GRADES
//
// L'XP est recalculée à partir de tout l'historique de séances (mêmes
// règles que les bilans : séances terminées, sans doublon ni date future),
// donc identique sur tous les appareils et rétroactive.
//
// Pensée pour motiver à tous les niveaux :
//  - débutant : bonus « premiers pas » (10 premières séances ×1,5), niveaux
//    rapides au début, bonus « retour en force » après une pause ;
//  - régulier : paliers de la semaine (2, 3, 4… séances) multipliés par la
//    série de semaines régulières (jusqu'à ×2) ;
//  - gros volume (5 à 7 séances / semaine) : chaque séance rapporte encore
//    (dégressif au-delà de 4, pour respecter la récupération), paliers
//    jusqu'à 6 séances, bonus corps complet et variété ;
//  - qualité : alternance des muscles (muscles reposés depuis 3 jours),
//    séance full body, semaine « corps complet », records battus.
// ============================================================
import { allSessions } from "./week-sessions.js";
import { startOfWeek } from "./utils.js";
import { t } from "./i18n.js";

const DAY = 24 * 3600 * 1000;

// Familles de muscles : pousser, tirer, jambes, gainage.
const FAMILY = {
  "Pectoraux": "push", "Épaules": "push", "Triceps": "push",
  "Dos": "pull", "Biceps": "pull", "Avant-bras": "pull",
  "Jambes": "legs", "Fessiers": "legs",
  "Abdominaux": "core"
};
const MAIN_GROUPS = Object.keys(FAMILY);

// Paliers de la semaine (cumulés) : 1 → 20 XP … 6 séances → 300 XP.
const WEEK_STEPS = [0, 20, 70, 140, 200, 260, 300];
const weekStep = (n) => WEEK_STEPS[Math.min(n, WEEK_STEPS.length - 1)];
// Rendement de la k-ième séance de la semaine (récupération respectée).
const RANK_FACTOR = (k) => k <= 4 ? 1 : k === 5 ? 0.9 : k === 6 ? 0.8 : 0.7;

// XP cumulée pour atteindre le niveau L (niveau 1 = 0 XP).
export const xpForLevel = (L) => Math.round(100 * Math.pow(Math.max(0, L - 1), 1.8));
export function levelFromXp(xp) {
  let L = 1;
  while (xpForLevel(L + 1) <= xp) L++;
  return L;
}

// Grades : de plus en plus épiques, un nouveau tous les 5 niveaux.
// i18n-keys: "Recrue", "Pousse-fonte", "Habitué de la fonte", "Bûcheron", "Forgeron d'acier", "Gladiateur", "Spartiate", "Viking", "Centurion", "Berserker", "Champion de fer", "Titan", "Colosse", "Minotaure", "Seigneur de la fonte", "Demi-dieu", "Hercule", "Atlas", "Olympien", "Légende immortelle", "Skullcrusher suprême"
export const GRADES = [
  { level: 1, name: "Recrue", icon: "🎽" },
  { level: 5, name: "Pousse-fonte", icon: "🏋️" },
  { level: 10, name: "Habitué de la fonte", icon: "💪" },
  { level: 15, name: "Bûcheron", icon: "🪓" },
  { level: 20, name: "Forgeron d'acier", icon: "⚒️" },
  { level: 25, name: "Gladiateur", icon: "🗡️" },
  { level: 30, name: "Spartiate", icon: "🛡️" },
  { level: 35, name: "Viking", icon: "⚔️" },
  { level: 40, name: "Centurion", icon: "🦅" },
  { level: 45, name: "Berserker", icon: "🐻" },
  { level: 50, name: "Champion de fer", icon: "🏆" },
  { level: 55, name: "Titan", icon: "🌋" },
  { level: 60, name: "Colosse", icon: "🗿" },
  { level: 65, name: "Minotaure", icon: "🐂" },
  { level: 70, name: "Seigneur de la fonte", icon: "👑" },
  { level: 75, name: "Demi-dieu", icon: "⚡" },
  { level: 80, name: "Hercule", icon: "🦁" },
  { level: 85, name: "Atlas", icon: "🌍" },
  { level: 90, name: "Olympien", icon: "🏛️" },
  { level: 95, name: "Légende immortelle", icon: "🔥" },
  { level: 100, name: "Skullcrusher suprême", icon: "💀" }
];
// Rang visuel (couleur du badge) : bronze → légendaire.
// i18n-keys: "Bronze", "Argent", "Or", "Platine", "Diamant", "Mythique", "Légendaire"
const TIERS = [
  { from: 1, key: "bronze", name: "Bronze" }, { from: 15, key: "silver", name: "Argent" },
  { from: 30, key: "gold", name: "Or" }, { from: 45, key: "platinum", name: "Platine" },
  { from: 60, key: "diamond", name: "Diamant" }, { from: 75, key: "mythic", name: "Mythique" },
  { from: 90, key: "legend", name: "Légendaire" }
];
export function gradeFor(level) {
  let g = GRADES[0];
  for (const x of GRADES) if (level >= x.level) g = x;
  let tier = TIERS[0];
  for (const x of TIERS) if (level >= x.from) tier = x;
  const next = GRADES.find(x => x.level > level) || null;
  return { ...g, tier: tier.key, tierName: tier.name, next };
}

// Calcul complet : { total, level, grade, progress, sessions:[{id, xp, parts}], week }.
// parts : [{ key, label, xp }] — détail affiché à la fin de séance.
export function computeXp(workouts, now = new Date()) {
  const list = allSessions(workouts || []).slice().sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const perSession = [];
  const weeks = new Map(); // début de semaine → { n, groups:Set, families:Set, covered, balanced, bonus }
  let streak = 0, lastWeekKey = null, prevStart = null;
  const recent = []; // { at, groups }
  let total = 0;

  list.forEach((w, idx) => {
    const at = new Date(w.start_time);
    const wkStart = startOfWeek(at, { iso: true });
    const wkKey = wkStart.getTime();
    // Série de semaines régulières (au moins 2 séances), calculée au
    // changement de semaine.
    if (lastWeekKey !== wkKey) {
      if (lastWeekKey != null) {
        const prev = weeks.get(lastWeekKey);
        const gapWeeks = Math.round((wkKey - lastWeekKey) / (7 * DAY));
        streak = gapWeeks === 1 && prev.n >= 2 ? streak + 1 : 0;
      }
      lastWeekKey = wkKey;
    }
    if (!weeks.has(wkKey)) weeks.set(wkKey, { n: 0, groups: new Set(), families: new Set(), covered: false, balanced: false, xp: 0 });
    const wk = weeks.get(wkKey);
    wk.n++;
    const parts = [];
    const add = (key, label, xp) => { if (xp > 0) parts.push({ key, label, xp: Math.round(xp) }); };

    const sets = Math.max(0, Number(w.total_sets) || 0);
    const groups = (w.muscle_summary || []).filter(g => MAIN_GROUPS.includes(g));
    const families = new Set(groups.map(g => FAMILY[g]));
    const factor = RANK_FACTOR(wk.n);
    const rookie = idx < 10 ? 1.5 : 1;

    // Séance : base + volume (dégressif au-delà de la 4e séance de la semaine).
    const base = sets >= 3 ? 40 + 3 * Math.min(sets, 25) : 15;
    add("session", t("Séance"), base * factor * rookie);
    if (rookie > 1) parts.push({ key: "rookie", label: t("Premiers pas ×1,5"), xp: 0 });
    // Alternance : muscles reposés (pas travaillés depuis 3 jours).
    const recentGroups = new Set(recent.filter(r => at - r.at < 3 * DAY).flatMap(r => r.groups));
    const fresh = groups.filter(g => !recentGroups.has(g)).length;
    if (recent.length) add("variety", t("Alternance des muscles"), Math.min(32, fresh * 8));
    // Full body : pousser + tirer + jambes dans la même séance.
    if (["push", "pull", "legs"].every(f => families.has(f))) add("fullbody", t("Full body"), 30);
    // Records battus.
    const recs = Math.min(3, (w.records || []).length);
    add("records", t("Records battus"), recs * 25);
    // Retour après une pause de 2 semaines ou plus.
    if (prevStart && at - prevStart >= 14 * DAY) add("comeback", t("Retour en force"), 50);
    // Paliers de la semaine, multipliés par la série de semaines régulières.
    const mult = 1 + Math.min(10, streak) * 0.1;
    const step = (weekStep(wk.n) - weekStep(wk.n - 1)) * mult;
    add("week", wk.n === 1 ? t("Première séance de la semaine") : t("Palier : {n} séances cette semaine", { n: wk.n }), step);
    if (streak >= 1 && step > 0) parts.push({ key: "streak", label: t("Série de {n} semaines régulières ×{m}", { n: streak, m: String(mult.toFixed(1)).replace(".", ",") }), xp: 0 });
    // Semaine « corps complet » (les 4 familles) et équilibrée (6 groupes).
    groups.forEach(g => wk.groups.add(g));
    families.forEach(f => wk.families.add(f));
    if (!wk.covered && wk.families.size >= 4) { wk.covered = true; add("fullweek", t("Semaine corps complet"), 80); }
    if (!wk.balanced && wk.groups.size >= 6) { wk.balanced = true; add("balanced", t("Semaine équilibrée (6 muscles)"), 40); }

    const xp = parts.reduce((a, p) => a + p.xp, 0);
    wk.xp += xp;
    total += xp;
    perSession.push({ id: w.id, at: w.start_time, xp, parts });
    recent.push({ at, groups });
    prevStart = at;
  });

  const level = levelFromXp(total);
  const cur = xpForLevel(level), nxt = xpForLevel(level + 1);
  const thisWeek = weeks.get(startOfWeek(now, { iso: true }).getTime());
  return {
    total, level, grade: gradeFor(level),
    progress: { into: total - cur, needed: nxt - cur, pct: Math.max(0, Math.min(100, Math.round((total - cur) / (nxt - cur) * 100))) },
    sessions: perSession,
    week: { xp: thisWeek?.xp || 0, n: thisWeek?.n || 0 },
    streak
  };
}

// Petit badge de grade (à côté d'un pseudo).
export function gradeBadgeHtml(xp, { withName = false } = {}) {
  if (!xp?.level) return "";
  const g = gradeFor(xp.level);
  return `<span class="xp-badge tier-${g.tier}" title="${t(g.name)} · ${t("niveau {n}", { n: xp.level })}">${g.icon}<b>${xp.level}</b>${withName ? ` ${t(g.name)}` : ""}</span>`;
}
