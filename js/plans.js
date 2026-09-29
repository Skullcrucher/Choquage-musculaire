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
import { toast, openModal, closeModal, esc, healthNoteHtml } from "./utils.js";
import { getRoutines, getWorkouts, invalidate } from "./cache.js";
import { t, locale } from "./i18n.js";

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
      .catch(() => ({ plans: [], active: null }));
  }
  return plansPromise;
}
export async function savePlans(plans, active) {
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
    <div class="plan-day ${c.today ? "today" : ""} ${c.done ? "done" : ""} ${c.routine && c.past && !c.done && !c.today ? "missed" : ""} ${c.inPlan ? "" : "off"}">
      <span class="plan-dow">${esc(dowLabel(c.dow, "narrow"))}</span>
      <span class="plan-mark">${!c.inPlan ? "" : c.done ? "✓" : c.routine ? (c.past && !c.today ? "✗" : "●") : "–"}</span>
      <span class="plan-rname">${c.routine ? esc(c.routine.name) : c.inPlan ? t("Repos") : ""}</span>
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
  else if (pos.status === "done") body = `<p class="muted" style="margin:0;">🎉 ${t("Plan terminé ! Crée le suivant dans Séance → Plan en cours → Mes plans.")}</p>`;
  else {
    routine = routines.find(r => r.id === pos.routineId) || null;
    const already = routine && doneOn(workouts, new Date(), routine);
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
                   : `<button class="btn btn-primary" id="plan-start" style="margin-top:10px;">▶ ${t("Démarrer : {routine}", { routine: esc(routine.name) })}</button>`)
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
  const done = new Map(weekSessions(plan, date, routines, workouts).map(s => [s.dow, s.done]));
  return weekCells(plan, date, routines, workouts).map(c => ({ ...c, done: c.routine ? !!done.get(c.dow) : false }));
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

const matchesRoutine = (w, routine) => !!routine && (w.routine_id ? w.routine_id === routine.id : w.title === routine.name);

// Séances prévues dans la semaine du plan qui contient `date`, avec celles
// déjà faites (une séance faite un autre jour de la semaine compte aussi).
export function weekSessions(plan, date, routines, workouts) {
  const cells = weekCells(plan, date, routines, workouts).filter(c => c.inPlan && c.routine);
  const monday = mondayOf(date), next = new Date(monday); next.setDate(monday.getDate() + 7);
  const inWeek = workouts.filter(w => w.end_time && w.start_time && new Date(w.start_time) >= monday && new Date(w.start_time) < next)
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  const used = new Set();
  const slots = cells.map(c => ({ ...c, workout: null }));
  // D'abord les séances faites le jour prévu, puis les autres jours.
  for (const pass of [true, false]) {
    slots.forEach(sl => {
      if (sl.workout) return;
      const w = inWeek.find(x => !used.has(x.id) && matchesRoutine(x, sl.routine) && (!pass || dayStr(new Date(x.start_time)) === dayStr(sl.date)));
      if (w) { sl.workout = w; used.add(w.id); }
    });
  }
  return slots.map(sl => ({ ...sl, done: !!sl.workout }));
}

// Liste des séances de la semaine pour « Depuis un plan » (écran Séance).
// Les séances pas encore faites d'abord (aujourd'hui en tête), celles
// déjà faites à la fin, en vert.
export async function planSessionsHtml() {
  const { plans, active } = await getPlans();
  const plan = plans.find(p => p.id === active);
  if (!plan) {
    return { html: plans.length
      ? `<div class="empty-state"><span class="num">📅</span>${t("Aucun plan actif.")}<br><span class="muted">${t("Active un plan dans Séance → Plan en cours → Mes plans.")}</span></div>`
      : `<div class="empty-state"><span class="num">📅</span>${t("Pas encore de plan.")}<br><span class="muted">${t("Crée ou importe un plan dans Séance → Plan en cours → Mes plans.")}</span></div>`, sessions: [] };
  }
  const [routines, workouts, card] = await Promise.all([getRoutines(), getWorkouts(), todayPlanCard({ compact: true })]);
  const pos = planPosition(plan);
  if (pos.status !== "running") return { html: card?.html || "", sessions: [], card };
  const slots = weekSessions(plan, new Date(), routines, workouts);
  const todo = slots.filter(s => !s.done).sort((a, b) => (b.today - a.today) || (a.dow - b.dow));
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
        <div class="plan-session-mark">${s.done ? "✓" : s.today ? "▶" : esc(dowLabel(s.dow, "short"))}</div>
        <div style="flex:1; min-width:0;">
          <div class="card-title" style="margin:0;">${esc(s.routine.name)}</div>
          <div class="muted plan-session-sub">${s.done ? t("Faite ({day})", { day: doneLabel(s) })
            : s.today ? t("Prévue aujourd'hui")
            : s.past ? t("Prévue {day} · en retard", { day: dowLabel(s.dow, "long") })
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

let trackedPlanId = null;
export async function renderPlanTracking(content, { onOpenWorkout } = {}) {
  const [{ plans, active }, routines, workouts] = await Promise.all([getPlans(), getRoutines(), getWorkouts()]);
  if (!content.isConnected) return;
  if (!plans.length) {
    content.innerHTML = `<div class="empty-state"><span class="num">📅</span>${t("Pas encore de plan.")}<br><span class="muted">${t("Crée ou importe un plan dans Séance → Plan en cours → Mes plans.")}</span></div>`;
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
    </div>
    <div class="card">
      <div class="card-title">${t("Semaine par semaine")}</div>
      <div class="plan-weeks">
        ${st.weeks.map(w => `
          <div class="plan-wrow ${w.state}">
            <div class="plan-wnum">S${w.n}<span>${esc(w.block?.name || "")}</span></div>
            <div class="plan-wdays">${w.slots.map(s => `<span class="plan-wdot ${s.done ? "done" : w.state === "future" || (!s.past && !s.done) ? "todo" : "missed"}" title="${esc(s.routine.name)} · ${esc(dowLabel(s.dow, "long"))}">${s.done ? "✓" : esc(dowLabel(s.dow, "narrow"))}</span>`).join("") || `<span class="muted" style="font-size:12px;">${t("Repos")}</span>`}</div>
            <div class="plan-wcount">${w.state === "future" ? "" : `${w.done}/${w.slots.length}`}</div>
          </div>`).join("")}
      </div>
      <p class="muted" style="font-size:12px; margin:8px 0 0;">✓ ${t("faite")} · <span style="color:var(--red);">■</span> ${t("manquée")} · <span style="opacity:.6;">■</span> ${t("à venir")}</p>
    </div>
    ${st.workouts.length ? `<h3 class="muted" style="margin:18px 0 6px;">${t("Séances du plan")}</h3>
      ${st.workouts.slice(0, 30).map(w => `
        <div class="list-row" data-plan-w="${esc(w.id)}" style="cursor:pointer;">
          <div><div class="list-row-title">${esc(w.title)}</div><div class="list-row-sub">${new Date(w.start_time).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" })}</div></div>
          <div class="list-row-meta">${w.total_sets || 0} ${t("séries")}${w.total_tonnage ? ` · ${nf(w.total_tonnage)} kg` : ""}</div>
        </div>`).join("")}` : ""}
  `;
  content.querySelectorAll("[data-track]").forEach(c => c.onclick = () => { trackedPlanId = c.dataset.track; renderPlanTracking(content, { onOpenWorkout }); });
  content.querySelectorAll("[data-plan-w]").forEach(r => r.onclick = () => onOpenWorkout?.(st.workouts.find(w => w.id === r.dataset.planW)));
}

export async function renderPlans(content) {
  const [{ plans, active }, routines, workouts] = await Promise.all([getPlans(), getRoutines(), getWorkouts()]);
  if (!content.isConnected) return;
  const refresh = () => renderPlans(content);
  content.innerHTML = `
    <button class="btn btn-primary" id="new-plan" ${routines.length ? "" : "disabled"}>+ ${t("Nouveau plan")}</button>
    <button class="btn btn-secondary" id="browse-programs" style="margin-top:8px;">⭐ ${t("Programmes prêts à l'emploi (PPL, split…)")}</button>
    ${routines.length ? "" : `<p class="muted">${t("Crée d'abord des routines : un plan les répartit sur les jours de la semaine.")}</p>`}
    <p class="muted" style="font-size:13px;">${t("Un plan enchaîne tes routines sur plusieurs semaines ou mois, en blocs (ex. 4 semaines hypertrophie, puis 3 semaines force, puis 1 semaine de décharge). Le plan actif s'affiche dans l'onglet Séance.")}</p>
    ${healthNoteHtml()}
    ${plans.map(p => {
      const pos = planPosition(p);
      const status = pos.status === "upcoming" ? t("Commence le {date}", { date: parseDay(p.start_date).toLocaleDateString(locale(), { day: "numeric", month: "long" }) })
        : pos.status === "done" ? t("Terminé") : t("Semaine {w}/{total}", { w: pos.week, total: pos.total });
      return `
      <div class="card ${p.id === active ? "plan-active" : ""}">
        <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
          <div class="card-title" style="margin-bottom:4px;">${esc(p.name)}</div>
          <span style="display:flex; gap:4px; flex-wrap:wrap; justify-content:flex-end;">
            ${p.shared_id ? `<span class="routine-badge">${p.shared_visibility === "friends" ? "👥" : "🌍"} ${t("Partagé")}</span>` : ""}
            ${p.id === active ? `<span class="routine-badge">✅ ${t("Actif")}</span>` : ""}
          </span>
        </div>
        ${p.source?.official ? `<div class="muted" style="font-size:12px; margin-bottom:4px;">⭐ ${t("Programme Skullcrusher")}</div>` : p.source?.owner_name ? `<div class="muted" style="font-size:12px; margin-bottom:4px;">${t("Ajouté depuis le plan de {name}", { name: esc(p.source.owner_name) })}</div>` : ""}
        <div class="muted" style="font-size:13px; margin-bottom:6px;">${status} · ${(p.blocks || []).map(b => `${esc(b.name || "")} ${b.weeks} ${t("sem.")}`).join(" → ")}</div>
        ${pos.status === "running" ? `<div class="progress-bar" style="margin-bottom:8px;"><div class="progress-bar-fill" style="width:${Math.round((pos.week - 1) / pos.total * 100)}%"></div></div>` : ""}
        ${p.id === active && pos.status === "running" ? weekStripHtml(stripCells(p, new Date(), routines, workouts)) : ""}
        ${(() => {
          const ids = [...new Set((p.blocks || []).flatMap(b => Object.values(b.days || {})).filter(Boolean))];
          const rs = ids.map(id => routines.find(r => r.id === id)).filter(Boolean);
          return rs.length ? `<div class="plan-routines"><span class="muted">${t("Séances du plan :")}</span> ${rs.map(r => `<button class="chip chip-sm" data-redit="${esc(r.id)}">✏️ ${esc(r.name)}</button>`).join("")}</div>` : "";
        })()}
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn btn-sm btn-secondary" data-activate="${esc(p.id)}">${p.id === active ? t("Désactiver") : t("Activer")}</button>
          <button class="btn btn-sm btn-secondary" data-pedit="${esc(p.id)}">${t("Modifier")}</button>
          <button class="btn btn-sm btn-secondary" data-pshare="${esc(p.id)}">${t("Partager")}</button>
          ${pos.status !== "done" ? `<button class="btn btn-sm btn-secondary" data-pshift="${esc(p.id)}" title="${t("Décaler d'une semaine")}">⏭ +1 ${t("sem.")}</button>` : ""}
          <button class="btn btn-sm btn-danger" data-pdel="${esc(p.id)}">${t("Supprimer")}</button>
        </div>
      </div>`;
    }).join("")}
  `;
  content.querySelector("#new-plan").onclick = () => openPlanEditor(null, routines, refresh);
  content.querySelector("#browse-programs").onclick = async () => {
    (await import("./routine-discover.js")).setDiscoverMode("plans");
    document.querySelector('[data-rmode="discover"]')?.click();
  };
  content.querySelectorAll("[data-pshare]").forEach(b => b.onclick = async () => {
    const { openPlanShare } = await import("./plan-share.js");
    openPlanShare(plans.find(p => p.id === b.dataset.pshare), routines, refresh);
  });
  content.querySelectorAll("[data-redit]").forEach(b => b.onclick = async () => {
    const { openRoutineEditor } = await import("./routines.js");
    openRoutineEditor(routines.find(r => r.id === b.dataset.redit), async () => { invalidate("routines"); refresh(); });
  });
  content.querySelectorAll("[data-pedit]").forEach(b => b.onclick = () => openPlanEditor(plans.find(p => p.id === b.dataset.pedit), routines, refresh));
  content.querySelectorAll("[data-activate]").forEach(b => b.onclick = async () => {
    const id = b.dataset.activate;
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
    if (!confirm(t("Supprimer ce plan ? Tes routines et tes séances sont conservées."))) return;
    const id = b.dataset.pdel;
    const gone = plans.find(p => p.id === id);
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
  const routineOptions = (selected) => `<option value="">${t("Repos")}</option>` +
    routines.map(r => `<option value="${esc(r.id)}" ${r.id === selected ? "selected" : ""}>${esc(r.name)}</option>`).join("");
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
        b.days = {};
        el.querySelectorAll("[data-dow]").forEach(s => { if (s.value) b.days[s.dataset.dow] = s.value; });
      });
    };
    const draw = () => {
      m.querySelector("#pl-blocks").innerHTML = state.blocks.map((b, i) => `
        <div class="card" data-block="${i}" style="padding:12px; margin-top:10px;">
          <div style="display:grid; grid-template-columns:1fr 90px auto; gap:8px; align-items:end;">
            <div><label>${t("Bloc")}</label><input class="pl-bname" value="${esc(b.name || "")}" placeholder="${t("ex : Hypertrophie")}"></div>
            <div><label>${t("Semaines")}</label><input class="pl-bweeks" type="number" min="1" max="52" value="${esc(b.weeks)}"></div>
            ${state.blocks.length > 1 ? `<button class="btn btn-sm btn-danger" data-bdel="${i}" style="width:auto;">✕</button>` : "<span></span>"}
          </div>
          <div class="plan-days-edit">
            ${DOWS.map(dow => `<label class="plan-day-edit"><span>${esc(dowLabel(dow, "short"))}</span><select data-dow="${dow}">${routineOptions(b.days?.[dow] || "")}</select></label>`).join("")}
          </div>
          ${i > 0 ? `<button class="btn btn-sm btn-secondary" data-bcopy="${i}" style="margin-top:6px; width:auto;">${t("Copier la semaine du bloc précédent")}</button>` : ""}
        </div>`).join("");
      const total = state.blocks.reduce((n, b) => n + (b.weeks || 0), 0);
      m.querySelector("#pl-total").textContent = t("Durée totale : {n} semaine(s) (≈ {months} mois)", { n: total, months: Math.round(total / 4.345 * 10) / 10 });
      m.querySelectorAll("[data-bdel]").forEach(b => b.onclick = () => { readBlocks(); state.blocks.splice(+b.dataset.bdel, 1); draw(); });
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
