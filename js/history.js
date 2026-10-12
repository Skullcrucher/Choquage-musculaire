// ============================================================
// ONGLET HISTORIQUE — calendrier + liste des séances passées
// (routines, plans et suivi du plan : onglet Séance)
// ============================================================
import { fmtDateTime, fmtDuration, esc, weekDows, weekStartsSunday, startOfWeek, confirmDanger, toast, openModal, closeModal } from "./utils.js";
import * as db from "./db.js";
import { sessionsBetween } from "./week-sessions.js";
import { getBody, workoutCalories } from "./calories.js";
import { getWorkouts, getRoutines, invalidate } from "./cache.js";
import { openWorkoutDetail } from "./workout-detail.js";
import { t, tn, locale } from "./i18n.js";

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

// ---------- Séances fantômes ----------
// Séances datées dans le futur (impossible : jamais faites), ou importées
// sans aucune charge (souvent un programme importé comme s'il avait été
// réalisé). Proposées au nettoyage, cochées par défaut.
function ghostReason(w, now = Date.now()) {
  if (Date.parse(w.start_time) > now + 3600e3) return "future";
  if (w.imported_at && !(w.total_tonnage > 0) && (w.total_sets || 0) > 0) return "noload";
  return null;
}
function renderGhosts(content) {
  const el = content.querySelector("#ghosts");
  if (!el) return;
  const ghosts = workoutsCache.map(w => ({ w, why: ghostReason(w) })).filter(x => x.why);
  if (!ghosts.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="hist-dups">👻 ${tn(ghosts.length, "{n} séance fantôme : datée dans le futur ou importée sans aucune charge.", "{n} séances fantômes : datées dans le futur ou importées sans aucune charge.")}
    <button class="btn btn-secondary btn-sm" id="ghost-clean">${t("Voir et nettoyer")}</button></div>`;
  el.querySelector("#ghost-clean").onclick = () => {
    const fmt = (w) => new Date(w.start_time).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    openModal(`
      <h3>👻 ${t("Séances fantômes")}</h3>
      <p class="muted" style="margin-top:-6px;">${t("Elles faussent ton calendrier, tes stats et ton plan. Décoche celles à garder (ex. une vraie séance au poids du corps importée).")}</p>
      <div class="ghost-list">${ghosts.sort((a, b) => String(a.w.start_time).localeCompare(String(b.w.start_time))).map((x, i) => `
        <label class="list-row" style="cursor:pointer;">
          <span><span class="list-row-title">${esc(x.w.title || t("Séance"))}</span>
            <span class="list-row-sub" style="display:block;">${esc(fmt(x.w))} · ${x.why === "future" ? `📅 ${t("datée dans le futur")}` : `📥 ${t("importée sans charges")}`}</span></span>
          <input type="checkbox" data-ghost="${i}" checked style="width:auto;">
        </label>`).join("")}</div>
      <div class="btn-row" style="margin-top:12px;">
        <button class="btn btn-secondary" id="gh-cancel">${t("Annuler")}</button>
        <button class="btn btn-danger" id="gh-go">${t("Supprimer la sélection")}</button>
      </div>
    `, (m) => {
      const sorted = ghosts;
      m.querySelector("#gh-cancel").onclick = closeModal;
      m.querySelector("#gh-go").onclick = async (e) => {
        const chosen = [...m.querySelectorAll("[data-ghost]:checked")].map(c => sorted[+c.dataset.ghost].w);
        if (!chosen.length) { closeModal(); return; }
        e.target.disabled = true;
        try {
          for (const w of chosen) await db.deleteWorkout(w.id);
          invalidate("workouts", "sets");
          closeModal();
          toast(tn(chosen.length, "{n} séance fantôme supprimée", "{n} séances fantômes supprimées"));
          renderHistorique(histContainer?.isConnected ? histContainer : document.getElementById("view"), { embedded: histEmbedded && histContainer?.isConnected });
        } catch (err) {
          console.error("[Skullcrusher] Nettoyage des séances fantômes", err);
          toast(t("Suppression impossible, réessaie"));
          e.target.disabled = false;
        }
      };
    });
  };
}

function renderMine(content) {
  content.innerHTML = `
    <div id="ghosts"></div>
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
  renderGhosts(content);
}

function renderCalendar(container) {
  const label = container.querySelector("#month-label");
  label.textContent = viewMonth.toLocaleDateString(locale(), { month: "long", year: "numeric" });

  const grid = container.querySelector("#cal-grid");
  const year = viewMonth.getFullYear(), month = viewMonth.getMonth();
  const first = new Date(year, month, 1).getDay();
  const firstDow = weekStartsSunday() ? first : (first + 6) % 7; // cases vides avant le 1er
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const now = new Date();
  const workoutDays = new Set(
    workoutsCache
      .filter(w => {
        const d = new Date(w.start_time);
        // Une date future n'est jamais « faite » (séance fantôme importée).
        return d.getFullYear() === year && d.getMonth() === month && d <= now;
      })
      .map(w => new Date(w.start_time).getDate())
  );

  const planned = plannedDays(year, month);
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
  // Doublons : même séance enregistrée deux fois au même moment (souvent
  // une copie importée d'une autre app, parfois sans charges). Une seule
  // compte dans les stats ; on les signale et on propose de supprimer les
  // copies importées.
  const from = new Date(year, month, 1), to = new Date(year, month + 1, 1);
  const dupOf = new Map(sessionsBetween(workoutsCache, from, to).duplicates.map(d => [d.w.id, d.twin]));
  const importedDups = list.filter(w => dupOf.has(w.id) && w.imported_at);
  wrap.innerHTML = plannedName && !list.length
    ? `<div class="list-row cal-planned-row" style="cursor:default;"><div><div class="list-row-title">📅 ${esc(plannedName)}</div><div class="list-row-sub">${t("Séance prévue par ton plan")}</div></div></div>`
    : list.length === 0
    ? `<div class="empty-state muted" style="padding:20px;">${t("Aucune séance.")}</div>`
    : (importedDups.length ? `<div class="hist-dups">⧉ ${tn(importedDups.length, "{n} séance importée en double d'une séance faite dans l'app.", "{n} séances importées en double de séances faites dans l'app.")}
        <button class="btn btn-secondary btn-sm" id="del-dups">${t("Supprimer les doublons importés")}</button></div>` : "") +
      list.map(w => `
      <div class="list-row ${dupOf.has(w.id) ? "hist-dup" : ""}" data-w="${w.id}">
        <div>
          <div class="list-row-title">${esc(w.title)}${w.imported_at ? ` <span class="hist-tag">📥 ${t("importée")}</span>` : ""}${dupOf.has(w.id) ? ` <span class="hist-tag dup">⧉ ${t("doublon")}</span>` : ""}</div>
          <div class="list-row-sub">${fmtDateTime(w.start_time)}${(w.partners || []).length ? " · 🤝" : ""}${w.total_sets ? ` · ${tn(w.total_sets, "{n} série", "{n} séries")}` : ""}${w.total_tonnage ? ` · ${Math.round(w.total_tonnage).toLocaleString(locale())} kg` : w.total_sets ? ` · ${t("sans charges")}` : ""}</div>
        </div>
        <div class="list-row-meta">${fmtDuration(w.start_time, w.end_time)}<div class="kcal-meta" data-kcal="${w.id}" style="font-size:11px;"></div></div>
      </div>
    `).join("");
  const delDups = wrap.querySelector("#del-dups");
  if (delDups) delDups.onclick = async () => {
    const ok = await confirmDanger({
      title: t("Supprimer les doublons importés ?"),
      message: t("Ces séances importées sont des copies de séances faites dans l'app au même moment : les originales sont conservées."),
      items: importedDups.map(w => `${esc(w.title)} · ${esc(fmtDateTime(w.start_time))}`),
      confirmLabel: t("Supprimer les doublons"), cancelLabel: t("Annuler")
    });
    if (!ok) return;
    delDups.disabled = true;
    try {
      for (const w of importedDups) await db.deleteWorkout(w.id);
      invalidate("workouts", "sets");
      toast(tn(importedDups.length, "{n} doublon supprimé", "{n} doublons supprimés"));
      renderHistorique(histContainer?.isConnected ? histContainer : document.getElementById("view"), { embedded: histEmbedded && histContainer?.isConnected });
    } catch (e) {
      console.error("[Skullcrusher] Suppression des doublons", e);
      toast(t("Suppression impossible, réessaie"));
      delDups.disabled = false;
    }
  };
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

