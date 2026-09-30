// ============================================================
// PLANS D'ENTRAÎNEMENT — enchaîner ses routines sur plusieurs semaines
// ou mois. Un plan = une date de début + des blocs (phases) ; chaque bloc
// dure N semaines et répète une semaine type (une routine ou repos par
// jour). Exemple : 4 semaines « Hypertrophie » puis 3 semaines « Force »
// puis 1 semaine de décharge.
//
// Stocké dans user_private/{uid}.plans (privé, pas de règle à ajouter).
// Suivi : une séance compte pour un jour du plan si elle a été démarrée
// depuis la routine prévue (routine_id), ou porte son nom, ce jour-là.
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, esc, healthNoteHtml, confirmDanger, bindFolds } from "./utils.js";
import { getRoutines, getWorkouts, invalidate } from "./cache.js";
import { t, tn, locale } from "./i18n.js";
import { sessionsBetween } from "./week-sessions.js";
import { guessMuscleGroup } from "./muscles.js";

export const MAX_PLANS = 20;
const DAY_MS = 86400000;
// 1 = lundi … 7 = dimanche
const DOWS = [1, 2, 3, 4, 5, 6, 7];

let plansPromise = null, plansUid = null;
export function getPlans() {
  const uid = db.getCurrentUser()?.uid || null;
  if (!uid) return Promise.resolve({ plans: [], active: null });
  if (!plansPromise || plansUid !== uid) {
    plansUid = uid;
    plansPromise = db.getPrivateData()
      .then(d => ({ plans: Array.isArray(d?.plans) ? d.plans : [], active: d?.active_plan_id || null }))
      .catch((e) => { console.warn("[Skullcrusher] Lecture des plans", e); return { plans: [], active: null, failed: true }; });
  }
  return plansPromise;
}
export async function savePlans(plans, active) {
  // Plans pas lus (hors ligne…) : la liste reçue est vide ou incomplète,
  // l'enregistrer effacerait les plans existants.
  if ((await plansPromise)?.failed) {
    plansPromise = null;
    throw new Error(t("Plans indisponibles pour le moment, réessaie"));
  }
  await db.setPrivateData({ plans, active_plan_id: active || null });
  plansUid = db.getCurrentUser()?.uid || null;
  plansPromise = Promise.resolve({ plans, active: active || null });
}

// Date locale "AAAA-MM-JJ" -> minuit local.
function parseDay(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function dayStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const dowOf = (date) => ((date.getDay() + 6) % 7) + 1;
export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - (dowOf(d) - 1));
  return d;
}
function dowLabel(dow, style = "short") {
  // 2024-01-01 était un lundi.
  return new Date(2024, 0, dow).toLocaleDateString(locale(), { weekday: style });
}

export const totalWeeks = (plan) => (plan.blocks || []).reduce((n, b) => n + (b.weeks || 0), 0);

// Où en est le plan à une date : semaine (1…), bloc, routine du jour.
export function planPosition(plan, date = new Date()) {
  const start = mondayOf(parseDay(plan.start_date));
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today - start) / DAY_MS);
  const total = totalWeeks(plan);
  if (days < 0) return { status: "upcoming", week: 0, total, startsIn: Math.ceil(-days) };
  const weekIdx = Math.floor(days / 7);
  if (weekIdx >= total) return { status: "done", week: total, total };
  let acc = 0;
  for (const [i, b] of plan.blocks.entries()) {
    if (weekIdx < acc + b.weeks) {
      return { status: "running", week: weekIdx + 1, total, blockIndex: i, block: b, blockWeek: weekIdx - acc + 1, routineId: b.days?.[dowOf(today)] || "" };
    }
    acc += b.weeks;
  }
  return { status: "done", week: total, total };
}

// Séance faite ce jour-là pour cette routine ?
function doneOn(workouts, date, routine) {
  const key = dayStr(date);
  return workouts.some(w => w.end_time && w.start_time && dayStr(new Date(w.start_time)) === key &&
    (w.routine_id ? w.routine_id === routine?.id : routine && w.title === routine.name));
}

// Semaine du plan contenant `date` : 7 cases (routine, fait, passé…).
function weekCells(plan, date, routines, workouts) {
  const pos = planPosition(plan, date);
  const monday = mondayOf(date);
  const todayKey = dayStr(new Date());
  return DOWS.map(dow => {
    const d = new Date(monday); d.setDate(monday.getDate() + dow - 1);
    const p = planPosition(plan, d);
    const routine = p.status === "running" ? routines.find(r => r.id === p.routineId) : null;
    const key = dayStr(d);
    return { dow, date: d, routine, done: routine && doneOn(workouts, d, routine), today: key === todayKey, past: key < todayKey, inPlan: p.status === "running", pos };
  });
}

function weekStripHtml(cells) {
  return `<div class="plan-week">${cells.map(c => `
    <div class="plan-day ${c.today ? "today" : ""} ${c.done ? "done" : ""} ${c.missed ? "missed" : ""} ${c.moved ? "moved" : ""} ${c.inPlan ? "" : "off"}">
      <span class="plan-dow">${esc(dowLabel(c.dow, "narrow"))}</span>
      <span class="plan-mark">${!c.inPlan ? "" : c.done ? "✓" : c.missed ? "✗" : c.moved ? "↷" : c.routine ? "●" : "–"}</span>
      <span class="plan-rname">${c.routine ? esc(c.routine.name) : c.missed ? t("Manquée") : c.moved ? t("Décalée") : c.inPlan ? t("Repos") : ""}</span>
    </div>`).join("")}</div>`;
}

// Carte « aujourd'hui » de l'écran Séance (null si pas de plan actif).
// Semaine précédente du plan en grande partie manquée (moins de la moitié
// des séances prévues) ? Renvoie { done, planned } ou null.
function missedLastWeek(plan, pos, routines, workouts) {
  if (pos.status !== "running" || pos.week < 2) return null;
  if (plan.shift_declined_week === pos.week) return null;
  const lastWeek = new Date(); lastWeek.setDate(lastWeek.getDate() - 7);
  const cells = weekSessions(plan, lastWeek, routines, workouts);
  const done = cells.filter(c => c.done).length;
  return cells.length && done < cells.length / 2 ? { done, planned: cells.length } : null;
}

// Décale le plan de `weeks` semaines (date de début repoussée).
export async function shiftPlan(planId, weeks = 1) {
  const { plans, active } = await getPlans();
  const list = plans.map(p => {
    if (p.id !== planId) return p;
    const d = parseDay(p.start_date); d.setDate(d.getDate() + 7 * weeks);
    return { ...p, start_date: dayStr(d), shift_declined_week: null, shifted_weeks: (p.shifted_weeks || 0) + weeks };
  });
  await savePlans(list, active);
}

async function declineShift(planId, week) {
  const { plans, active } = await getPlans();
  await savePlans(plans.map(p => p.id === planId ? { ...p, shift_declined_week: week } : p), active);
}

export async function todayPlanCard({ compact = false } = {}) {
  const { plans, active } = await getPlans();
  const plan = plans.find(p => p.id === active);
  if (!plan) return null;
  const [routines, workouts] = await Promise.all([getRoutines(), getWorkouts()]);
  const pos = planPosition(plan);
  let body;
  let routine = null;
  if (pos.status === "upcoming") body = `<p class="muted" style="margin:0;">${t("Le plan commence dans {n} jour(s).", { n: pos.startsIn })}</p>`;
  else if (pos.status === "done") body = `<p class="muted" style="margin:0;">🎉 ${t("Plan terminé ! Crée le suivant dans Biblio → Mes plans.")}</p>`;
  else {
    // Séance du jour : la prochaine de la file (ordre du plan, en tenant
    // compte de celles déjà faites), ou une séance en retard à rattraper.
    const wk = planWeek(plan, new Date(), routines, workouts);
    const todayCell = wk.cells.find(c => c.today);
    const already = !!todayCell?.done;
    const catchUp = !todayCell?.routine && wk.slots.find(x => x.overdue)?.routine;
    routine = todayCell?.routine || catchUp || null;
    const missed = missedLastWeek(plan, pos, routines, workouts);
    body = `
      ${missed ? `<div class="plan-shift">
        <div>⏸️ ${t("Semaine {w} : {done}/{planned} séance(s) faite(s). Décaler le plan d'une semaine pour refaire cette semaine ?", { w: pos.week - 1, done: missed.done, planned: missed.planned })}</div>
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn btn-sm btn-secondary" id="plan-shift-no">${t("Non, continuer")}</button>
          <button class="btn btn-sm btn-primary" id="plan-shift-yes">${t("Décaler d'une semaine")}</button>
        </div>
      </div>` : ""}
      <div class="muted" style="font-size:13px; margin-bottom:6px;">${t("Semaine {w}/{total} · {block} (semaine {bw}/{bweeks})", { w: pos.week, total: pos.total, block: esc(pos.block.name || t("Bloc {n}", { n: pos.blockIndex + 1 })), bw: pos.blockWeek, bweeks: pos.block.weeks })}</div>
      ${weekStripHtml(stripCells(plan, new Date(), routines, workouts))}
      ${compact ? "" : routine
        ? (already ? `<p class="muted" style="margin:8px 0 0;">✓ ${t("{routine} faite aujourd'hui. Bien joué !", { routine: esc(routine.name) })}</p>`
                   : `<button class="btn btn-primary" id="plan-start" style="margin-top:10px;">▶ ${catchUp ? t("Rattraper : {routine}", { routine: esc(routine.name) }) : t("Démarrer : {routine}", { routine: esc(routine.name) })}</button>`)
        : `<p class="muted" style="margin:8px 0 0;">😴 ${t("Repos aujourd'hui.")}</p>`}`;
  }
  return {
    html: `<div class="card plan-card"><div class="card-title">📅 ${esc(plan.name)}</div>${body}</div>`,
    routine, plan, week: pos.week,
    // Boutons « décaler » de la carte ; refresh() redessine l'écran.
    bind(container, refresh) {
      const yes = container.querySelector("#plan-shift-yes");
      const no = container.querySelector("#plan-shift-no");
      if (yes) yes.onclick = async () => { yes.disabled = true; await shiftPlan(plan.id, 1); toast(t("Plan décalé d'une semaine")); refresh(); };
      if (no) no.onclick = async () => { no.disabled = true; await declineShift(plan.id, pos.week); refresh(); };
    }
  };
}

// Frise de la semaine : même décompte que la liste des séances (une
// séance faite un autre jour de la semaine coche le jour prévu).
function stripCells(plan, date, routines, workouts) {
  return planWeek(plan, date, routines, workouts).cells;
}

// ==================== ROUTINES DE PLAN ====================
// Routines utilisées par au moins un plan : affichées avec leur plan
// (onglet Plans, « Depuis un plan »), pas dans la liste des routines.
export async function planRoutineIds() {
  const { plans } = await getPlans();
  const ids = new Set();
  plans.forEach(p => (p.blocks || []).forEach(b => Object.values(b.days || {}).forEach(id => { if (id) ids.add(id); })));
  return ids;
}

// Une séance associée à la main (plan.links) ne compte que pour la routine
// choisie ; sinon, même routine (ou même titre pour une séance libre).
const matchesRoutine = (w, routine, plan) => {
  if (!routine) return false;
  const linked = plan?.links?.[w.id];
  if (linked) return linked === routine.id;
  return w.routine_id ? w.routine_id === routine.id : w.title === routine.name;
};

// ---------- Récupération musculaire ----------
// Muscles d'une routine, pondérés par le nombre de séries prévues.
function muscleLoad(r) {
  const m = new Map();
  (r?.exercises || []).forEach(e => {
    const g = e.muscle_group && e.muscle_group !== "Autre" ? e.muscle_group : guessMuscleGroup(e.exercise_name);
    m.set(g, (m.get(g) || 0) + (Number(e.target_sets) || 3));
  });
  return m;
}
// Part des séries de `cand` sur les muscles PRINCIPAUX de `prev` (ceux qui
// font au moins 30 % de ses séries ; un exercice d'appoint, comme un face
// pull dans une séance Pull, ne bloque pas les épaules) — de 0 à 1.
function muscleOverlap(cand, prev) {
  const a = muscleLoad(cand), b = muscleLoad(prev);
  const bTotal = [...b.values()].reduce((x, y) => x + y, 0);
  const main = new Set([...b].filter(([, v]) => bTotal && v / bTotal >= 0.3).map(([g]) => g));
  let total = 0, hit = 0;
  a.forEach((v, g) => { total += v; if (main.has(g)) hit += v; });
  return total ? hit / total : 0;
}
// Minuit du jour de `d` (écarts en jours entiers).
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// ---------- Semaine du plan, dans l'ordre ----------
// Les séances de la semaine se font dans l'ordre du plan, mais on peut les
// intervertir : une séance faite (n'importe quel jour) retire SA routine de
// la file ; les routines restantes, dans l'ordre du plan, sont proposées
// aux prochains jours d'entraînement. Une séance manquée n'est pas perdue :
// elle glisse sur les jours suivants (ou « à rattraper » s'il n'en reste pas).
export function planWeek(plan, date, routines, workouts) {
  const cells = weekCells(plan, date, routines, workouts);
  const sched = cells.filter(c => c.inPlan && c.routine);
  const queue = sched.map(c => c.routine);
  const byId = new Map(queue.map(r => [r.id, r]));
  // Routine d'une séance faite : association manuelle, sinon même routine
  // (ou même titre pour une séance libre) parmi celles de la semaine.
  const routineOf = (w) => {
    if (plan.links?.[w.id]) return routines.find(r => r.id === plan.links[w.id]) || null;
    if (w.routine_id && byId.has(w.routine_id)) return byId.get(w.routine_id);
    return queue.find(r => !w.routine_id && w.title === r.name) || null;
  };
  const monday = mondayOf(date), next = new Date(monday); next.setDate(monday.getDate() + 7);
  const done = sessionsBetween(workouts, monday, next).counted
    .map(w => ({ w, routine: routineOf(w) })).filter(x => x.routine)
    .slice(0, sched.length);
  // File des séances restantes (ordre du plan) : chaque séance faite retire
  // sa routine, ou à défaut la prochaine de la file.
  const remaining = [...queue];
  for (const d of done) {
    const i = remaining.findIndex(r => r.id === d.routine.id);
    remaining.splice(i >= 0 ? i : 0, 1);
  }
  const todayKey = dayStr(new Date());
  const doneByDay = new Map();
  done.forEach(d => { const k = dayStr(new Date(d.w.start_time)); if (!doneByDay.has(k)) doneByDay.set(k, d); });
  // Prochains jours d'entraînement (aujourd'hui compris) sans séance faite.
  const upcoming = sched.filter(c => dayStr(c.date) >= todayKey && !doneByDay.has(dayStr(c.date)));
  // Répartition intelligente : dans l'ordre du plan, sauf si la séance
  // suivante sollicite surtout des muscles travaillés les 2 jours d'avant
  // (moins de 48 h de récupération) : on prend alors la suivante qui les
  // laisse reposer. Séances des 3 jours précédant la semaine comprises.
  const history = [];
  const before = new Date(monday); before.setDate(monday.getDate() - 3);
  sessionsBetween(workouts, before, monday).counted.forEach(w => {
    const r = routines.find(x => x.id === (plan.links?.[w.id] || w.routine_id)) || routines.find(x => x.name === w.title);
    if (r) history.push({ date: new Date(w.start_time), routine: r });
  });
  done.forEach(d => history.push({ date: new Date(d.w.start_time), routine: d.routine }));
  const dayGap = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY_MS);
  const planned = [];
  for (const cell of upcoming) {
    if (!remaining.length) break;
    const recent = history.filter(h => { const g = dayGap(h.date, cell.date); return g >= 1 && g <= 2; });
    const tired = (r) => recent.reduce((acc, h) => acc + muscleOverlap(r, h.routine) * (dayGap(h.date, cell.date) === 1 ? 1 : 0.6), 0);
    let pick = remaining.find(r => recent.every(h => muscleOverlap(r, h.routine) < 0.4));
    if (!pick) pick = [...remaining].sort((a, b) => tired(a) - tired(b))[0];
    remaining.splice(remaining.indexOf(pick), 1);
    planned.push({ cell, routine: pick });
    history.push({ date: cell.date, routine: pick });
  }
  const overdue = remaining; // pas de jour libre restant
  // Jours passés sans séance : les premiers portent les séances en retard.
  const pastEmpty = sched.filter(c => dayStr(c.date) < todayKey && !doneByDay.has(dayStr(c.date)));
  const view = cells.map(c => {
    const key = dayStr(c.date);
    const d = doneByDay.get(key);
    if (d) return { ...c, routine: d.routine, done: true, workout: d.w };
    const pl = planned.find(x => x.cell === c);
    if (pl) return { ...c, routine: pl.routine, done: false };
    const pi = pastEmpty.indexOf(c);
    if (pi >= 0) return pi < overdue.length ? { ...c, routine: null, done: false, missed: true } : { ...c, routine: null, moved: true, done: false };
    // Jour de repos, ou jour prévu alors que toutes les séances sont faites.
    return { ...c, routine: null, done: false };
  });
  // Séances de la semaine (liste, stats) : faites, prévues, en retard.
  const slots = [
    ...done.map(d => { const dt = new Date(d.w.start_time); return { routine: d.routine, workout: d.w, done: true, linked: !!plan.links?.[d.w.id], date: dt, dow: dowOf(dt), today: dayStr(dt) === todayKey, past: dayStr(dt) < todayKey }; }),
    ...planned.map(x => ({ routine: x.routine, workout: null, done: false, date: x.cell.date, dow: x.cell.dow, today: x.cell.today, past: false })),
    ...overdue.map(r => ({ routine: r, workout: null, done: false, overdue: true, past: true, date: null, dow: null, today: false }))
  ];
  return { cells: view, slots };
}

// Compatibilité : séances de la semaine (voir planWeek).
export function weekSessions(plan, date, routines, workouts) {
  return planWeek(plan, date, routines, workouts).slots;
}

// Liste des séances de la semaine pour « Depuis un plan » (écran Séance).
// Les séances pas encore faites d'abord (aujourd'hui en tête), celles
// déjà faites à la fin, en vert.
export async function planSessionsHtml() {
  const { plans, active } = await getPlans();
  const plan = plans.find(p => p.id === active);
  if (!plan) {
    return { html: plans.length
      ? `<div class="empty-state"><span class="num">📅</span>${t("Aucun plan actif.")}<br><span class="muted">${t("Active un plan dans Biblio → Mes plans.")}</span></div>`
      : `<div class="empty-state"><span class="num">📅</span>${t("Pas encore de plan.")}<br><span class="muted">${t("Crée ou importe un plan dans Biblio → Mes plans.")}</span></div>`, sessions: [] };
  }
  const [routines, workouts, card] = await Promise.all([getRoutines(), getWorkouts(), todayPlanCard({ compact: true })]);
  const pos = planPosition(plan);
  if (pos.status !== "running") return { html: card?.html || "", sessions: [], card };
  const slots = weekSessions(plan, new Date(), routines, workouts);
  // À faire : aujourd'hui, puis les jours suivants (ordre du plan), puis
  // les séances en retard ; les séances faites à la fin.
  const todo = slots.filter(s => !s.done).sort((a, b) => (b.today - a.today) || (!!a.overdue - !!b.overdue) || ((a.dow || 0) - (b.dow || 0)));
  const done = slots.filter(s => s.done);
  const ordered = [...todo, ...done];
  const doneLabel = (s) => new Date(s.workout.start_time).toLocaleDateString(locale(), { weekday: "long" });
  const html = `
    ${card?.html || ""}
    <div class="plan-sessions-head">
      <span>${t("Séances de la semaine")}</span>
      <span class="muted">${t("{done}/{total} faite(s)", { done: done.length, total: slots.length })}</span>
    </div>
    ${ordered.length ? ordered.map((s, i) => `
      <div class="card plan-session ${s.done ? "done" : ""} ${s.today && !s.done ? "today" : ""}" data-plan-session="${i}" role="button" tabindex="0">
        <div class="plan-session-mark">${s.done ? "✓" : s.today ? "▶" : s.overdue ? "↺" : esc(dowLabel(s.dow, "short"))}</div>
        <div style="flex:1; min-width:0;">
          <div class="card-title" style="margin:0;">${esc(s.routine.name)}</div>
          <div class="muted plan-session-sub">${s.done ? t("Faite ({day})", { day: doneLabel(s) })
            : s.today ? t("Prévue aujourd'hui")
            : s.overdue ? t("À rattraper cette semaine")
            : t("Prévue {day}", { day: dowLabel(s.dow, "long") })} · ${(s.routine.exercises || []).length} ${t("exercice(s)")}</div>
        </div>
      </div>`).join("") : `<p class="muted">😴 ${t("Pas de séance prévue cette semaine.")}</p>`}
  `;
  return { html, sessions: ordered, plan, week: pos.week, card };
}

// ==================== SUIVI DE PLAN (Historique) ====================
function planStats(plan, routines, workouts) {
  const total = totalWeeks(plan);
  const start = mondayOf(parseDay(plan.start_date));
  const today = new Date();
  const weeks = [];
  const matched = new Map();
  for (let i = 0; i < total; i++) {
    const monday = new Date(start); monday.setDate(start.getDate() + 7 * i);
    const pos = planPosition(plan, monday);
    const slots = weekSessions(plan, monday, routines, workouts);
    slots.forEach(s => { if (s.workout) matched.set(s.workout.id, s.workout); });
    const endOfWeek = new Date(monday); endOfWeek.setDate(monday.getDate() + 7);
    weeks.push({
      n: i + 1, monday, block: pos.block, blockIndex: pos.blockIndex, slots,
      state: monday > today ? "future" : endOfWeek <= today ? "past" : "current",
      due: slots.filter(s => s.past || s.done).length, done: slots.filter(s => s.done).length
    });
  }
  const list = [...matched.values()];
  const due = weeks.reduce((n, w) => n + (w.state === "future" ? 0 : w.due), 0);
  const done = weeks.reduce((n, w) => n + w.done, 0);
  const planned = weeks.reduce((n, w) => n + w.slots.length, 0);
  let streak = 0;
  for (const w of weeks.filter(w => w.state === "past").reverse()) { if (w.slots.length && w.done >= w.slots.length) streak++; else break; }
  return {
    weeks, due, done, planned, streak,
    adherence: due ? Math.round(done / due * 100) : null,
    tonnage: list.reduce((n, w) => n + (w.total_tonnage || 0), 0),
    sets: list.reduce((n, w) => n + (w.total_sets || 0), 0),
    minutes: list.reduce((n, w) => n + (w.end_time && w.start_time ? Math.max(0, (new Date(w.end_time) - new Date(w.start_time)) / 60000) : 0), 0),
    workouts: list.sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)))
  };
}

// « Semaine 3/8 · 7 séances faites » (avertissements avant suppression).
function planProgressLine(plan, routines, workouts) {
  const pos = planPosition(plan);
  const st = planStats(plan, routines, workouts);
  const where = pos.status === "running" ? t("Semaine {w}/{total}", { w: pos.week, total: pos.total })
    : pos.status === "upcoming" ? t("Pas encore commencé") : t("Terminé");
  return `${where} · ${t("{n} séance(s) faite(s)", { n: st.done })}`;
}

// Où une routine est utilisée : plan en cours (jours), autres plans.
export async function routineUsage(routineId) {
  const { plans, active } = await getPlans();
  const usedIn = plans.filter(p => (p.blocks || []).some(b => Object.values(b.days || {}).includes(routineId)));
  const act = usedIn.find(p => p.id === active) || null;
  const days = act ? [...new Set(act.blocks.flatMap(b => Object.entries(b.days || {}).filter(([, id]) => id === routineId).map(([d]) => +d)))].sort() : [];
  return { active: act, days: days.map(d => dowLabel(d, "long")), others: usedIn.filter(p => p.id !== active).map(p => p.name) };
}

// Données de l'image « état des lieux du plan » (share-card.js).
export async function planShareData(planId = null) {
  const [{ plans, active }, routines, workouts] = await Promise.all([getPlans(), getRoutines(), getWorkouts()]);
  const plan = plans.find(p => p.id === (planId || active)) || plans.find(p => p.id === active) || plans[plans.length - 1];
  if (!plan) return null;
  return { plan, pos: planPosition(plan), st: planStats(plan, routines, workouts) };
}

let trackedPlanId = null;
export async function renderPlanTracking(content, { onOpenWorkout } = {}) {
  const [{ plans, active }, routines, workouts] = await Promise.all([getPlans(), getRoutines(), getWorkouts()]);
  if (!content.isConnected) return;
  if (!plans.length) {
    content.innerHTML = `<div class="empty-state"><span class="num">📅</span>${t("Pas encore de plan.")}<br><span class="muted">${t("Crée ou importe un plan dans Biblio → Mes plans.")}</span></div>`;
    return;
  }
  const plan = plans.find(p => p.id === trackedPlanId) || plans.find(p => p.id === active) || plans[plans.length - 1];
  trackedPlanId = plan.id;
  const pos = planPosition(plan);
  const st = planStats(plan, routines, workouts);
  const weekPct = pos.status === "done" ? 100 : pos.status === "upcoming" ? 0 : Math.round((pos.week - 1) / pos.total * 100);
  const nf = (n) => Math.round(n).toLocaleString(locale());
  const status = pos.status === "upcoming" ? t("Commence le {date}", { date: parseDay(plan.start_date).toLocaleDateString(locale(), { day: "numeric", month: "long" }) })
    : pos.status === "done" ? t("Terminé") : t("Semaine {w}/{total} · {block}", { w: pos.week, total: pos.total, block: esc(pos.block.name || t("Bloc {n}", { n: pos.blockIndex + 1 })) });
  content.innerHTML = `
    ${plans.length > 1 ? `<div class="chip-row" style="margin-bottom:12px;">${plans.map(p => `<div class="chip ${p.id === plan.id ? "active" : ""}" data-track="${esc(p.id)}">${p.id === active ? "✅ " : ""}${esc(p.name)}</div>`).join("")}</div>` : ""}
    <div class="card plan-track">
      <div class="card-title" style="margin-bottom:2px;">📅 ${esc(plan.name)}</div>
      <div class="muted" style="font-size:13px;">${status}</div>
      <div class="plan-track-bar"><div style="width:${weekPct}%"></div></div>
      <div class="muted" style="font-size:12px; display:flex; justify-content:space-between;"><span>${t("Avancement du plan")}</span><span>${weekPct} %</span></div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr); margin-top:12px;">
        <div class="stat-box"><span class="num">${st.done}<small>/${st.planned}</small></span><span class="lbl">${t("séances faites")}</span></div>
        <div class="stat-box"><span class="num">${st.adherence == null ? "—" : st.adherence + "%"}</span><span class="lbl">${t("assiduité")}</span></div>
        <div class="stat-box"><span class="num">${st.streak}</span><span class="lbl">${t("semaine(s) complète(s) d'affilée")}</span></div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr); margin-top:8px;">
        <div class="stat-box"><span class="num">${st.tonnage >= 10000 ? nf(st.tonnage / 1000) + " t" : nf(st.tonnage) + " kg"}</span><span class="lbl">${t("soulevés")}</span></div>
        <div class="stat-box"><span class="num">${nf(st.sets)}</span><span class="lbl">${t("séries")}</span></div>
        <div class="stat-box"><span class="num">${st.minutes >= 60 ? Math.floor(st.minutes / 60) + " h" : nf(st.minutes) + " min"}</span><span class="lbl">${t("d'entraînement")}</span></div>
      </div>
      <p class="muted" style="font-size:12px; margin:8px 0 0;">${t("Assiduité = séances faites / séances prévues jusqu'à aujourd'hui.")}</p>
      <button class="btn btn-primary share-btn" id="share-plan" style="margin-top:12px;">📸 ${t("Partager l'état de mon plan")}</button>
    </div>
    <div class="card">
      <div class="card-title">${t("Semaine par semaine")}</div>
      <div class="plan-weeks">
        ${st.weeks.map(w => `
          <div class="plan-wrow ${w.state}">
            <div class="plan-wnum">S${w.n}<span>${esc(w.block?.name || "")}</span></div>
            <div class="plan-wdays">${w.slots.map((s, si) => `<span class="plan-wdot ${s.done ? "done" : w.state === "future" || (!s.past && !s.done) ? "todo" : "missed"} ${w.state !== "future" ? "tap" : ""}" ${w.state !== "future" ? `data-slot="${w.n - 1}:${si}" role="button"` : ""} title="${esc(s.routine.name)}${s.dow ? ` · ${esc(dowLabel(s.dow, "long"))}` : ""}">${s.done ? (s.linked ? "🔗" : "✓") : s.dow ? esc(dowLabel(s.dow, "narrow")) : "↺"}</span>`).join("") || `<span class="muted" style="font-size:12px;">${t("Repos")}</span>`}</div>
            <div class="plan-wcount">${w.state === "future" ? "" : `${w.done}/${w.slots.length}`}</div>
          </div>`).join("")}
      </div>
      <p class="muted" style="font-size:12px; margin:8px 0 0;">✓ ${t("faite")} · 🔗 ${t("associée")} · <span style="color:var(--red);">■</span> ${t("manquée")} · <span style="opacity:.6;">■</span> ${t("à venir")}</p>
      <p class="muted" style="font-size:12px; margin:4px 0 0;">${t("Touche une séance manquée pour y associer une séance déjà faite cette semaine-là.")}</p>
    </div>
    ${st.workouts.length ? `<h3 class="muted" style="margin:18px 0 6px;">${t("Séances du plan")}</h3>
      ${st.workouts.slice(0, 30).map(w => `
        <div class="list-row" data-plan-w="${esc(w.id)}" style="cursor:pointer;">
          <div><div class="list-row-title">${esc(w.title)}</div><div class="list-row-sub">${new Date(w.start_time).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" })}</div></div>
          <div class="list-row-meta">${w.total_sets || 0} ${t("séries")}${w.total_tonnage ? ` · ${nf(w.total_tonnage)} kg` : ""}</div>
        </div>`).join("")}` : ""}
  `;
  content.querySelectorAll("[data-track]").forEach(c => c.onclick = () => { trackedPlanId = c.dataset.track; renderPlanTracking(content, { onOpenWorkout }); });
  content.querySelector("#share-plan").onclick = async () => (await import("./share-card.js")).openShareCard({ kind: "plan", planId: plan.id });
  content.querySelectorAll("[data-plan-w]").forEach(r => r.onclick = () => onOpenWorkout?.(st.workouts.find(w => w.id === r.dataset.planW)));
  content.querySelectorAll("[data-slot]").forEach(d => d.onclick = () => {
    const [wi, si] = d.dataset.slot.split(":").map(Number);
    openSlotLink(plan, st.weeks[wi], st.weeks[wi].slots[si], workouts, {
      onOpenWorkout,
      onChanged: () => renderPlanTracking(content, { onOpenWorkout })
    });
  });
}

// Case d'une semaine du plan : associer une séance déjà faite cette
// semaine-là (séance libre, autre routine, faite avant d'ajouter le plan…)
// ou retirer l'association.
function openSlotLink(plan, week, slot, workouts, { onOpenWorkout, onChanged }) {
  const fmt = (w) => new Date(w.start_time).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "short" });
  const next = new Date(week.monday); next.setDate(week.monday.getDate() + 7);
  const taken = new Set(week.slots.map(s => s.workout?.id).filter(Boolean));
  const candidates = workouts.filter(w => w.end_time && w.start_time && !taken.has(w.id)
    && new Date(w.start_time) >= week.monday && new Date(w.start_time) < next)
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  const save = async (mutate) => {
    const { plans, active } = await getPlans();
    const cur = plans.find(p => p.id === plan.id);
    if (!cur) return;
    const links = { ...(cur.links || {}) }, days = { ...(cur.link_days || {}) };
    mutate(links, days);
    await savePlans(plans.map(p => p.id === cur.id ? { ...p, links, link_days: days } : p), active);
  };
  const head = `<h3>${esc(slot.routine.name)}</h3>
    <p class="muted" style="margin-top:0;">${t("Semaine {n}", { n: week.n })} · ${slot.date ? `${esc(dowLabel(slot.dow, "long"))} ${slot.date.toLocaleDateString(locale(), { day: "numeric", month: "short" })}` : t("À rattraper cette semaine")}</p>`;
  if (slot.done) {
    openModal(`${head}
      <div class="list-row"><div><div class="list-row-title">${slot.linked ? "🔗" : "✓"} ${esc(slot.workout.title)}</div><div class="list-row-sub">${esc(fmt(slot.workout))}</div></div></div>
      <div class="btn-row" style="margin-top:12px;">
        ${slot.linked ? `<button class="btn btn-secondary" id="sl-unlink">${t("Retirer l'association")}</button>` : ""}
        <button class="btn btn-primary" id="sl-open">${t("Voir la séance")}</button>
      </div>`, (m) => {
      m.querySelector("#sl-open").onclick = () => { closeModal(); onOpenWorkout?.(slot.workout); };
      const un = m.querySelector("#sl-unlink");
      if (un) un.onclick = async () => {
        un.disabled = true;
        try { await save((links, days) => { delete links[slot.workout.id]; delete days[slot.workout.id]; }); closeModal(); toast(t("Association retirée")); onChanged(); }
        catch (err) { toast(err.message || t("Impossible d'enregistrer")); un.disabled = false; }
      };
    });
    return;
  }
  openModal(`${head}
    <p style="font-size:14px;">${t("Associer une séance déjà faite cette semaine-là :")}</p>
    ${candidates.length ? candidates.map(w => `
      <div class="list-row" data-link="${esc(w.id)}" style="cursor:pointer;">
        <div><div class="list-row-title">${esc(w.title)}</div><div class="list-row-sub">${esc(fmt(w))}${w.plan_id && w.plan_id !== plan.id ? " · " + t("autre plan") : ""}</div></div>
        <span class="chip chip-sm">${t("Associer")}</span>
      </div>`).join("") : `<p class="muted">${t("Aucune séance terminée libre cette semaine-là.")}</p>`}
    <button class="btn btn-secondary" id="sl-close" style="margin-top:12px;">${t("Fermer")}</button>`, (m) => {
    m.querySelector("#sl-close").onclick = closeModal;
    m.querySelectorAll("[data-link]").forEach(r => r.onclick = async () => {
      r.style.pointerEvents = "none";
      try {
        await save((links, days) => { links[r.dataset.link] = slot.routine.id; if (slot.date) days[r.dataset.link] = dayStr(slot.date); });
        closeModal();
        toast(t("Séance associée au plan"));
        onChanged();
      } catch (err) { toast(err.message || t("Impossible d'enregistrer")); r.style.pointerEvents = ""; }
    });
  });
}

const openPlanCards = new Set(); // cartes dépliées
export async function renderPlans(content) {
  const [{ plans, active }, routines, workouts] = await Promise.all([getPlans(), getRoutines(), getWorkouts()]);
  if (!content.isConnected) return;
  const refresh = () => renderPlans(content);
  content.innerHTML = `
    <div id="gift-inbox"></div>
    <button class="btn btn-primary" id="new-plan" ${routines.length ? "" : "disabled"}>+ ${t("Nouveau plan")}</button>
    <button class="btn btn-secondary" id="browse-programs" style="margin-top:8px;">⭐ ${t("Programmes prêts à l'emploi (PPL, split…)")}</button>
    ${routines.length ? "" : `<p class="muted">${t("Crée d'abord des routines : un plan les répartit sur les jours de la semaine.")}</p>`}
    <details class="muted" style="font-size:13px; margin:10px 0 12px;">
      <summary style="cursor:pointer;">ℹ️ ${t("Comment fonctionne un plan ?")}</summary>
      <p style="margin:8px 0;">${t("Un plan enchaîne tes routines sur plusieurs semaines ou mois, en blocs (ex. 4 semaines hypertrophie, puis 3 semaines force, puis 1 semaine de décharge). Le plan actif s'affiche dans l'onglet Séance.")}</p>
    </details>
    ${healthNoteHtml()}
    ${plans.map(p => {
      const pos = planPosition(p);
      const status = pos.status === "upcoming" ? t("Commence le {date}", { date: parseDay(p.start_date).toLocaleDateString(locale(), { day: "numeric", month: "long" }) })
        : pos.status === "done" ? t("Terminé") : t("Semaine {w}/{total}", { w: pos.week, total: pos.total });
      const ids = [...new Set((p.blocks || []).flatMap(b => Object.values(b.days || {})).filter(Boolean))];
      const rs = ids.map(id => routines.find(r => r.id === id)).filter(Boolean);
      const perWeek = Math.max(0, ...(p.blocks || []).map(b => Object.keys(b.days || {}).length));
      return `
      <div class="card fold ${p.id === active ? "plan-active" : ""}" data-fold="${esc(p.id)}">
        <div class="fold-head">
          <div class="fold-main">
            <div class="card-title">${esc(p.name)}</div>
            <div class="muted fold-sub">${status} · ${tn(perWeek, "{n} séance/sem.", "{n} séances/sem.")}</div>
          </div>
          <span class="fold-badges">
            ${p.shared_id ? `<span class="routine-badge">${p.shared_visibility === "friends" ? "👥" : "🌍"}</span>` : ""}
            ${p.id === active ? `<span class="routine-badge">✅ ${t("Actif")}</span>` : ""}
          </span>
          <span class="fold-chev">›</span>
        </div>
        ${pos.status === "running" ? `<div class="fold-bar"><div style="width:${Math.round((pos.week - 1) / pos.total * 100)}%"></div></div>` : ""}
        <div class="fold-body">
          ${p.source?.official ? `<div class="muted" style="font-size:12px; margin-bottom:4px;">⭐ ${t("Programme Skullcrusher")}</div>` : p.source?.owner_name ? `<div class="muted" style="font-size:12px; margin-bottom:4px;">${t("Ajouté depuis le plan de {name}", { name: esc(p.source.owner_name) })}</div>` : ""}
          <div class="muted" style="font-size:13px; margin-bottom:8px;">${(p.blocks || []).map(b => `${esc(b.name || "")} ${b.weeks} ${t("sem.")}`).join(" → ")}</div>
          ${p.id === active && pos.status === "running" ? weekStripHtml(stripCells(p, new Date(), routines, workouts)) : ""}
          ${rs.length ? `<div class="plan-routines"><span class="muted">${t("Séances du plan :")}</span> ${rs.map(r => `<button class="chip chip-sm" data-redit="${esc(r.id)}">✏️ ${esc(r.name)}</button>`).join("")}</div>` : ""}
          <div class="btn-row btn-row-wrap" style="margin-top:8px;">
            <button class="btn btn-sm btn-secondary" data-activate="${esc(p.id)}">${p.id === active ? t("Désactiver") : t("Activer")}</button>
            <button class="btn btn-sm btn-secondary" data-pedit="${esc(p.id)}">${t("Modifier")}</button>
            <button class="btn btn-sm btn-secondary" data-pshare="${esc(p.id)}">${t("Partager")}</button>
            <button class="btn btn-sm btn-secondary" data-psend="${esc(p.id)}">${t("Envoyer")}</button>
            ${pos.status !== "done" ? `<button class="btn btn-sm btn-secondary" data-pshift="${esc(p.id)}" title="${t("Décaler d'une semaine")}">⏭ +1 ${t("sem.")}</button>` : ""}
            <button class="btn btn-sm btn-danger" data-pdel="${esc(p.id)}">${t("Supprimer")}</button>
          </div>
          ${db.isAdmin() ? `<button class="btn btn-sm btn-secondary admin-btn" data-pofficial="${esc(p.id)}" style="margin-top:8px;">⭐ ${p.official_id ? t("Mettre à jour l'officiel") : t("Publier (officiel)")}</button>` : ""}
        </div>
      </div>`;
    }).join("")}
  `;
  bindFolds(content, openPlanCards);
  content.querySelector("#new-plan").onclick = () => openPlanEditor(null, routines, refresh);
  content.querySelector("#browse-programs").onclick = async () => {
    (await import("./routine-discover.js")).setDiscoverMode("plans");
    document.querySelector('[data-rmode="discover"]')?.click();
  };
  content.querySelectorAll("[data-pshare]").forEach(b => b.onclick = async () => {
    const { openPlanShare } = await import("./plan-share.js");
    openPlanShare(plans.find(p => p.id === b.dataset.pshare), routines, refresh);
  });
  content.querySelectorAll("[data-pofficial]").forEach(b => b.onclick = async () =>
    (await import("./admin.js")).publishPlanOfficial(plans.find(x => x.id === b.dataset.pofficial), routines, refresh));
  content.querySelectorAll("[data-psend]").forEach(b => b.onclick = async () => {
    const p = plans.find(x => x.id === b.dataset.psend);
    const [{ planTemplateFrom }, { openSendModal }] = await Promise.all([import("./plan-share.js"), import("./gifts.js")]);
    openSendModal("plan", p.name, planTemplateFrom(p, routines));
  });
  import("./gifts.js").then(m => m.renderGiftInbox(content.querySelector("#gift-inbox"), refresh));
  content.querySelectorAll("[data-redit]").forEach(b => b.onclick = async () => {
    const { openRoutineEditor } = await import("./routines.js");
    openRoutineEditor(routines.find(r => r.id === b.dataset.redit), async () => { invalidate("routines"); refresh(); });
  });
  content.querySelectorAll("[data-pedit]").forEach(b => b.onclick = () => openPlanEditor(plans.find(p => p.id === b.dataset.pedit), routines, refresh));
  content.querySelectorAll("[data-activate]").forEach(b => b.onclick = async () => {
    const id = b.dataset.activate;
    const cur = plans.find(p => p.id === active);
    if (active === id && !await confirmDanger({
      title: t("Désactiver ton plan en cours ?"),
      message: t("« {plan} » ne s'affichera plus dans l'onglet Séance. Il reste dans tes plans avec son avancement : tu pourras le réactiver.", { plan: esc(cur?.name || "") }),
      cancelLabel: t("Garder mon plan en cours"), confirmLabel: t("Désactiver")
    })) return;
    if (cur && active !== id && !await confirmDanger({
      title: t("Remplacer ton plan en cours ?"),
      message: t("« {plan} » ne sera plus ton plan en cours. Il reste dans tes plans avec son avancement : tu pourras le réactiver.", { plan: esc(cur.name) }),
      items: [planProgressLine(cur, routines, workouts)],
      cancelLabel: t("Garder mon plan en cours"), confirmLabel: t("Activer « {plan} »", { plan: esc(plans.find(p => p.id === id)?.name || "") })
    })) return;
    await savePlans(plans, active === id ? null : id);
    toast(active === id ? t("Plan désactivé") : t("Plan activé : il s'affiche dans l'onglet Séance"));
    refresh();
  });
  content.querySelectorAll("[data-pshift]").forEach(b => b.onclick = async () => {
    if (!confirm(t("Décaler ce plan d'une semaine ? Toutes les semaines suivantes sont repoussées de 7 jours."))) return;
    await shiftPlan(b.dataset.pshift, 1);
    toast(t("Plan décalé d'une semaine"));
    refresh();
  });
  content.querySelectorAll("[data-pdel]").forEach(b => b.onclick = async () => {
    const id = b.dataset.pdel;
    const gone = plans.find(p => p.id === id);
    if (!await confirmDanger({
      title: id === active ? t("Supprimer ton plan en cours ?") : t("Supprimer ce plan ?"),
      message: t("Le plan et son suivi (semaines, séances associées) seront effacés définitivement. Tes routines et tes séances sont conservées."),
      items: [esc(gone?.name || ""), ...(id === active ? [planProgressLine(gone, routines, workouts)] : [])],
      cancelLabel: t("Garder le plan"), confirmLabel: t("Supprimer définitivement")
    })) return;
    if (gone?.shared_id) await db.deleteSharedPlan(gone.shared_id).catch(() => null);
    await savePlans(plans.filter(p => p.id !== id), active === id ? null : active);
    refresh();
  });
}

function openPlanEditor(plan, routines, onSaved) {
  const nextMonday = (() => { const d = mondayOf(new Date()); if (dowOf(new Date()) > 1) d.setDate(d.getDate() + 7); return d; })();
  const state = plan ? JSON.parse(JSON.stringify(plan)) : {
    id: "", name: "", start_date: dayStr(nextMonday),
    blocks: [{ name: t("Bloc 1"), weeks: 4, days: {} }]
  };
  openModal(`
    <h3>📅 ${plan ? t("Modifier le plan") : t("Nouveau plan")}</h3>
    <label>${t("Nom")}</label>
    <input id="pl-name" maxlength="60" value="${esc(state.name)}" placeholder="${t("ex : Prise de force 12 semaines")}">
    <label>${t("Début (lundi de la semaine 1)")}</label>
    <input id="pl-start" type="date" value="${esc(state.start_date)}">
    <div id="pl-blocks"></div>
    <button class="btn btn-secondary btn-sm" id="pl-add-block" style="margin-top:6px;">+ ${t("Ajouter un bloc")}</button>
    <p class="muted" id="pl-total" style="font-size:13px;"></p>
    <div class="btn-row">
      <button class="btn btn-secondary" id="pl-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="pl-save">${t("Enregistrer")}</button>
    </div>
  `, (m) => {
    const readBlocks = () => {
      m.querySelectorAll("[data-block]").forEach(el => {
        const b = state.blocks[+el.dataset.block];
        b.name = el.querySelector(".pl-bname").value.trim().slice(0, 40);
        b.weeks = Math.max(1, Math.min(52, parseInt(el.querySelector(".pl-bweeks").value, 10) || 1));
      });
    };
    // Jour sélectionné (bloc, jour) : la liste des séances s'ouvre dessous.
    let pick = null;
    const shortName = (id) => routines.find(r => r.id === id)?.name || "";
    const draw = () => {
      m.querySelector("#pl-blocks").innerHTML = state.blocks.map((b, i) => `
        <div class="card" data-block="${i}" style="padding:12px; margin-top:10px;">
          <div style="display:grid; grid-template-columns:1fr 90px auto; gap:8px; align-items:end;">
            <div><label>${t("Bloc")}</label><input class="pl-bname" value="${esc(b.name || "")}" placeholder="${t("ex : Hypertrophie")}"></div>
            <div><label>${t("Semaines")}</label><input class="pl-bweeks" type="number" min="1" max="52" value="${esc(b.weeks)}"></div>
            ${state.blocks.length > 1 ? `<button class="btn btn-sm btn-danger" data-bdel="${i}" style="width:auto;">✕</button>` : "<span></span>"}
          </div>
          <div class="pl-week">
            ${DOWS.map(dow => { const id = b.days?.[dow] || ""; return `<button type="button" class="pl-day ${id ? "on" : ""} ${pick && pick[0] === i && pick[1] === dow ? "sel" : ""}" data-pday="${i}:${dow}">
              <b>${esc(dowLabel(dow, "short"))}</b><small>${id ? esc(shortName(id)) : t("Repos")}</small></button>`; }).join("")}
          </div>
          ${pick && pick[0] === i ? `<div class="pl-pick">
            <div class="pl-pick-title">${t("Séance du {day}", { day: esc(dowLabel(pick[1], "long")) })}</div>
            <button type="button" data-pset="" class="${!b.days?.[pick[1]] ? "cur" : ""}"><span>😴 ${t("Repos")}</span></button>
            ${routines.map(r => `<button type="button" data-pset="${esc(r.id)}" class="${b.days?.[pick[1]] === r.id ? "cur" : ""}"><span>${esc(r.name)}</span><small>${tn((r.exercises || []).length, "{n} exercice", "{n} exercices")}</small></button>`).join("")}
          </div>` : ""}
          <p class="muted" style="font-size:12px; margin:6px 0 0;">${tn(Object.keys(b.days || {}).length, "{n} séance par semaine", "{n} séances par semaine")} · ${t("Touche un jour pour choisir sa séance.")}</p>
          ${i > 0 ? `<button class="btn btn-sm btn-secondary" data-bcopy="${i}" style="margin-top:6px; width:auto;">${t("Copier la semaine du bloc précédent")}</button>` : ""}
        </div>`).join("");
      const total = state.blocks.reduce((n, b) => n + (b.weeks || 0), 0);
      m.querySelector("#pl-total").textContent = t("Durée totale : {n} semaine(s) (≈ {months} mois)", { n: total, months: Math.round(total / 4.345 * 10) / 10 });
      m.querySelectorAll("[data-pday]").forEach(b => b.onclick = () => {
        readBlocks();
        const [bi, dow] = b.dataset.pday.split(":").map(Number);
        pick = pick && pick[0] === bi && pick[1] === dow ? null : [bi, dow];
        draw();
      });
      m.querySelectorAll("[data-pset]").forEach(b => b.onclick = () => {
        readBlocks();
        const days = state.blocks[pick[0]].days || (state.blocks[pick[0]].days = {});
        if (b.dataset.pset) days[pick[1]] = b.dataset.pset; else delete days[pick[1]];
        // Jour suivant pour enchaîner la saisie de la semaine.
        pick = pick[1] < 7 ? [pick[0], pick[1] + 1] : null;
        draw();
      });
      m.querySelectorAll("[data-bdel]").forEach(b => b.onclick = () => { readBlocks(); pick = null; state.blocks.splice(+b.dataset.bdel, 1); draw(); });
      m.querySelectorAll("[data-bcopy]").forEach(b => b.onclick = () => { readBlocks(); const i = +b.dataset.bcopy; state.blocks[i].days = { ...state.blocks[i - 1].days }; draw(); });
      m.querySelectorAll(".pl-bweeks").forEach(inp => inp.oninput = () => { readBlocks(); m.querySelector("#pl-total").textContent = t("Durée totale : {n} semaine(s) (≈ {months} mois)", { n: totalWeeks(state), months: Math.round(totalWeeks(state) / 4.345 * 10) / 10 }); });
    };
    draw();
    m.querySelector("#pl-add-block").onclick = () => {
      readBlocks();
      const prev = state.blocks[state.blocks.length - 1];
      state.blocks.push({ name: t("Bloc {n}", { n: state.blocks.length + 1 }), weeks: 4, days: { ...(prev?.days || {}) } });
      draw();
    };
    m.querySelector("#pl-cancel").onclick = closeModal;
    m.querySelector("#pl-save").onclick = async (e) => {
      readBlocks();
      state.name = m.querySelector("#pl-name").value.trim().slice(0, 60);
      state.start_date = m.querySelector("#pl-start").value || state.start_date;
      if (!state.name) { toast(t("Donne un nom au plan")); return; }
      if (!state.blocks.some(b => Object.keys(b.days).length)) { toast(t("Place au moins une routine dans la semaine")); return; }
      if (totalWeeks(state) > 104) { toast(t("104 semaines maximum")); return; }
      // Plan en cours modifié : prévenir si des séances en disparaissent
      // ou si la date de début change (le suivi est recalculé).
      if (state.id) {
        const { plans: before, active: act } = await getPlans();
        const old = before.find(p => p.id === state.id);
        if (old && state.id === act) {
          const ids = (pl) => new Set((pl.blocks || []).flatMap(b => Object.values(b.days || {})).filter(Boolean));
          const now = ids(state);
          const removed = [...ids(old)].filter(id => !now.has(id)).map(id => routines.find(r => r.id === id)?.name).filter(Boolean);
          const items = [
            ...removed.map(n => t("« {routine} » n'est plus dans le plan", { routine: esc(n) })),
            ...(old.start_date !== state.start_date ? [t("Nouvelle date de début : le suivi des semaines est recalculé")] : [])
          ];
          if (items.length && !await confirmDanger({
            title: t("Modifier ton plan en cours ?"),
            message: t("Ces changements touchent ton plan en cours :"),
            items, cancelLabel: t("Revenir à l'édition"), confirmLabel: t("Enregistrer quand même")
          })) return;
        }
      }
      e.target.disabled = true;
      try {
        const { plans, active } = await getPlans();
        let list = plans.slice();
        let newActive = active;
        if (state.id) list = list.map(p => p.id === state.id ? state : p);
        else {
          if (list.length >= MAX_PLANS) { toast(t("{n} plans maximum", { n: MAX_PLANS })); e.target.disabled = false; return; }
          state.id = "p" + Date.now().toString(36);
          state.created_at = new Date().toISOString();
          list.push(state);
          if (!active) newActive = state.id; // premier plan : actif d'office
        }
        await savePlans(list, newActive);
        closeModal();
        toast(t("Plan enregistré"));
        await onSaved();
      } catch (err) {
        console.error("[Skullcrusher] Plan", err);
        toast(t("Enregistrement impossible, réessaie."));
        e.target.disabled = false;
      }
    };
  });
}
