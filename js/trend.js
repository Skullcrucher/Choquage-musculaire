// ============================================================
// TENDANCE D'UN EXERCICE SUR UN MOIS — progression, stagnation ou
// régression. Utilisée pendant la séance (à côté du nom de l'exercice),
// dans la fiche exercice et dans le profil (plus fortes évolutions).
//
// Mesure par séance : meilleure 1RM estimée (séries de travail de 15 reps
// ou moins) ; pour un exercice sans charge (tractions, pompes…), le
// meilleur nombre de reps. On compare la forme récente (meilleure des
// 2 dernières séances du mois, pour qu'une séance légère ne fasse pas
// croire à une régression) au point de départ : la dernière séance AVANT
// le mois (jusqu'à 3 mois en arrière), sinon la première du mois.
// ============================================================
import { estimate1RM } from "./utils.js";
import { t } from "./i18n.js";

export const TREND_DAYS = 30;
const ANCHOR_DAYS = 90;
const THRESHOLD_PCT = 2;
const DAY_MS = 24 * 3600 * 1000;

const dayOf = (s) => String(s.workout_start_time || "").slice(0, 10);

// sets : séries de l'exercice (toutes séances). excludeWorkoutId : séance
// en cours, à ne pas compter. Renvoie null si pas assez de données.
export function exerciseTrend(sets, { now = Date.now(), excludeWorkoutId = null, days = TREND_DAYS } = {}) {
  const work = (sets || []).filter(s => s.reps > 0 && s.set_type !== "warmup" && s.workout_start_time
    && (!excludeWorkoutId || s.workout_id !== excludeWorkoutId));
  if (!work.length) return null;
  const weighted = work.filter(s => s.weight_kg > 0);
  const metric = weighted.length >= work.length / 2 ? "1rm" : "reps";
  const pool = metric === "1rm" ? weighted : work;
  // Une séance = une date de début (séances importées : pas de workout_id).
  const bySession = new Map();
  pool.forEach(s => {
    const key = s.workout_id || s.workout_start_time;
    if (!bySession.has(key)) bySession.set(key, { day: dayOf(s), sets: [] });
    bySession.get(key).sets.push(s);
  });
  bySession.forEach(x => {
    if (metric === "1rm") {
      // Séries de 15 reps ou moins en priorité (Epley peu fiable au-delà).
      const low = x.sets.filter(s => s.reps <= 15);
      x.v = Math.max(...(low.length ? low : x.sets).map(s => estimate1RM(s.weight_kg, s.reps)));
    } else x.v = Math.max(...x.sets.map(s => s.reps));
  });
  const sessions = [...bySession.values()].filter(x => x.v > 0).sort((a, b) => a.day.localeCompare(b.day));
  const since = new Date(now - days * DAY_MS).toISOString().slice(0, 10);
  const anchorSince = new Date(now - ANCHOR_DAYS * DAY_MS).toISOString().slice(0, 10);
  const inWindow = sessions.filter(x => x.day >= since);
  if (!inWindow.length) return null;
  const before = sessions.filter(x => x.day < since && x.day >= anchorSince).pop();
  const base = before || inWindow[0];
  const recentList = before ? inWindow : inWindow.slice(1);
  if (!recentList.length || !(base.v > 0)) return null;
  const recent = Math.max(...recentList.slice(-2).map(x => x.v));
  const pct = Math.round(((recent - base.v) / base.v) * 1000) / 10;
  const status = pct >= THRESHOLD_PCT ? "up" : pct <= -THRESHOLD_PCT ? "down" : "flat";
  return { status, pct, metric, from: Math.round(base.v * 10) / 10, to: Math.round(recent * 10) / 10, sessions: inWindow.length, since: base.day };
}

const ARROWS = { up: "▲", flat: "▬", down: "▼" };
// i18n-keys: "Progression", "Stagnation", "Régression"
export const TREND_LABELS = { up: "Progression", flat: "Stagnation", down: "Régression" };

export function fmtPct(pct) {
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${String(Math.abs(Math.round(pct))).replace(".", ",")} %`;
}

// Petit indicateur : ▲ +4 % (vert), ▬ (orange), ▼ −3 % (rouge).
export function trendBadgeHtml(tr, { label = false } = {}) {
  if (!tr) return "";
  const title = trendSentence(tr);
  return `<span class="trend trend-${tr.status}" title="${title.replace(/"/g, "&quot;")}">${ARROWS[tr.status]}${tr.status === "flat" && !label ? "" : " " + (label ? t(TREND_LABELS[tr.status]) + " " : "") + (tr.status === "flat" ? "" : fmtPct(tr.pct))}</span>`;
}

// « 1RM estimée 80 kg → 83 kg (+4 %) »
export function trendDetail(tr) {
  if (!tr) return "";
  const unit = tr.metric === "1rm" ? " kg" : " reps";
  const what = tr.metric === "1rm" ? t("1RM estimée") : t("meilleure série");
  const n = (v) => String(v).replace(".", ",") + unit;
  return `${what} ${n(tr.from)} → ${n(tr.to)} (${fmtPct(tr.pct)})`;
}

export function trendSentence(tr) {
  if (!tr) return "";
  return t("{status} sur 30 jours", { status: t(TREND_LABELS[tr.status]) }) + " : " + trendDetail(tr);
}

// Tendances de tous les exercices (profil) : sets = séries des ~3 derniers mois.
export function allTrends(sets, opts = {}) {
  const byEx = new Map();
  (sets || []).forEach(s => {
    if (!s.exercise_title) return;
    if (!byEx.has(s.exercise_title)) byEx.set(s.exercise_title, []);
    byEx.get(s.exercise_title).push(s);
  });
  const out = [];
  byEx.forEach((list, name) => { const tr = exerciseTrend(list, opts); if (tr) out.push({ exercise: name, ...tr }); });
  return out;
}
