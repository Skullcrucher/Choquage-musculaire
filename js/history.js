// ============================================================
// ONGLET HISTORIQUE — calendrier + liste des séances passées
// (routines, plans et suivi du plan : onglet Séance)
// ============================================================
import { fmtDateTime, fmtDuration, esc, weekDows, weekStartsSunday, startOfWeek } from "./utils.js";
import { getBody, workoutCalories } from "./calories.js";
import { getWorkouts, getRoutines } from "./cache.js";
import { openWorkoutDetail } from "./workout-detail.js";
import { t, locale } from "./i18n.js";

let viewMonth = new Date();
let workoutsCache = [];
let selectedDay = null;

// Initiales des jours dans la langue de l'app, dans l'ordre de la semaine
// choisi (lundi ou dimanche en premier). 2024-01-01 était un lundi.
const dowInitials = () => weekDows().map(dow => new Date(2024, 0, dow).toLocaleDateString(locale(), { weekday: "narrow" }));

// Séances à venir du plan actif (jour "AAAA-MM-JJ" → nom de la routine),
// affichées d'une autre couleur dans le calendrier.
let planCtx = null; // { plan, routines, planWeek, dayStr }
async function loadPlanCtx() {
  try {
    const plansMod = await import("./plans.js");
    const { plans, active } = await plansMod.getPlans();
    const plan = plans.find(p => p.id === active);
    planCtx = plan ? { plan, routines: await getRoutines(), planWeek: plansMod.planWeek, dayStr: plansMod.dayStr } : null;
  } catch (e) { console.warn("[Skullcrusher] Plan (calendrier)", e); planCtx = null; }
}
function plannedDays(year, month) {
  const out = new Map();
  if (!planCtx) return out;
  const { plan, routines, planWeek, dayStr } = planCtx;
  const todayKey = dayStr(new Date());
  const last = new Date(year, month + 1, 0);
  for (let d = startOfWeek(new Date(year, month, 1)); d <= last; d.setDate(d.getDate() + 7)) {
    const lastDayOfWeek = new Date(d); lastDayOfWeek.setDate(d.getDate() + 6);
    if (dayStr(lastDayOfWeek) < todayKey) continue; // semaine passée
    planWeek(plan, new Date(d), routines, workoutsCache).cells.forEach(c => {
      if (c.routine && !c.done && dayStr(c.date) >= todayKey && c.date.getMonth() === month) out.set(c.date.getDate(), c.routine.name);
    });
  }
  return out;
}

// embedded : dans l'onglet Progrès (sans titre, sous les onglets du haut).
let histContainer = null, histEmbedded = false;
export async function renderHistorique(container, { embedded = false } = {}) {
  histContainer = container; histEmbedded = embedded;
  [workoutsCache] = await Promise.all([getWorkouts(), loadPlanCtx()]);
  container.innerHTML = `
    ${embedded ? "" : `<h1 class="section-title">${t("Historique")}</h1>`}
    <div id="hist-content"></div>
  `;
  renderMine(container.querySelector("#hist-content"));
}

function renderMine(content) {
  content.innerHTML = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <button class="btn btn-sm btn-secondary" id="prev-month">←</button>
        <h3 style="margin:0;" id="month-label"></h3>
        <button class="btn btn-sm btn-secondary" id="next-month">→</button>
      </div>
      <div class="cal-grid" id="cal-grid"></div>
      <div class="cal-legend" id="cal-legend" hidden><span><i class="cal-dot done"></i>${t("faite")}</span><span><i class="cal-dot planned"></i>${t("à venir (plan)")}</span></div>
    </div>
    <h3 class="muted" style="margin:18px 0 6px;" id="list-label">${t("Séances récentes")}</h3>
    <div id="workout-list"></div>
  `;
  content.querySelector("#prev-month").onclick = () => { viewMonth.setMonth(viewMonth.getMonth() - 1); selectedDay = null; renderCalendar(content); renderList(content); };
  content.querySelector("#next-month").onclick = () => { viewMonth.setMonth(viewMonth.getMonth() + 1); selectedDay = null; renderCalendar(content); renderList(content); };
  renderCalendar(content);
  renderList(content);
}

function renderCalendar(container) {
  const label = container.querySelector("#month-label");
  label.textContent = viewMonth.toLocaleDateString(locale(), { month: "long", year: "numeric" });

  const grid = container.querySelector("#cal-grid");
  const year = viewMonth.getFullYear(), month = viewMonth.getMonth();
  const first = new Date(year, month, 1).getDay();
  const firstDow = weekStartsSunday() ? first : (first + 6) % 7; // cases vides avant le 1er
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const workoutDays = new Set(
    workoutsCache
      .filter(w => {
        const d = new Date(w.start_time);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .map(w => new Date(w.start_time).getDate())
  );

  const planned = plannedDays(year, month);
  const now = new Date();
  const isToday = (day) => now.getFullYear() === year && now.getMonth() === month && now.getDate() === day;
  let html = dowInitials().map(d => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const has = workoutDays.has(day);
    const plan = !has && planned.get(day);
    html += `<div class="cal-day ${has ? "has-workout" : ""} ${plan ? "planned" : ""} ${isToday(day) ? "today" : ""}" data-day="${day}" ${plan ? `title="${esc(t("Prévue : {routine}", { routine: plan }))}"` : ""}>${day}</div>`;
  }
  grid.innerHTML = html;
  const legend = container.querySelector("#cal-legend");
  if (legend) legend.hidden = !planned.size;
  grid.querySelectorAll("[data-day]").forEach(el => {
    el.onclick = () => {
      const day = parseInt(el.dataset.day, 10);
      selectedDay = selectedDay === day ? null : day;
      renderList(container);
    };
  });
}

function renderList(container) {
  const year = viewMonth.getFullYear(), month = viewMonth.getMonth();
  const label = container.querySelector("#list-label");
  let list = workoutsCache.filter(w => {
    const d = new Date(w.start_time);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  if (selectedDay) {
    list = list.filter(w => new Date(w.start_time).getDate() === selectedDay);
    label.textContent = t("Séances du {date}", { date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), selectedDay).toLocaleDateString(locale(), { day: "numeric", month: "long" }) });
  } else {
    label.textContent = t("Séances du mois");
  }
  const wrap = container.querySelector("#workout-list");
  const plannedName = selectedDay ? plannedDays(year, month).get(selectedDay) : null;
  wrap.innerHTML = plannedName && !list.length
    ? `<div class="list-row cal-planned-row" style="cursor:default;"><div><div class="list-row-title">📅 ${esc(plannedName)}</div><div class="list-row-sub">${t("Séance prévue par ton plan")}</div></div></div>`
    : list.length === 0
    ? `<div class="empty-state muted" style="padding:20px;">${t("Aucune séance.")}</div>`
    : list.map(w => `
      <div class="list-row" data-w="${w.id}">
        <div>
          <div class="list-row-title">${esc(w.title)}</div>
          <div class="list-row-sub">${fmtDateTime(w.start_time)}${(w.partners || []).length ? " · 🤝" : ""}</div>
        </div>
        <div class="list-row-meta">${fmtDuration(w.start_time, w.end_time)}<div class="kcal-meta" data-kcal="${w.id}" style="font-size:11px;"></div></div>
      </div>
    `).join("");
  // Calories (estimation ou montre), une fois les données corporelles lues.
  getBody().then(body => wrap.querySelectorAll("[data-kcal]").forEach(el => {
    const c = workoutCalories(list.find(w => w.id === el.dataset.kcal) || {}, body);
    if (c) el.textContent = `🔥 ${c.source === "watch" ? "" : "≈"}${c.kcal} kcal`;
  }));
  wrap.querySelectorAll("[data-w]").forEach(el => {
    el.onclick = () => openWorkoutDetail(
      list.find(w => w.id === el.dataset.w),
      () => renderHistorique(histContainer?.isConnected ? histContainer : document.getElementById("view"), { embedded: histEmbedded && histContainer?.isConnected })
    );
  });
}

