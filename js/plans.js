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
import { toast, openModal, closeModal, esc } from "./utils.js";
import { getRoutines, getWorkouts } from "./cache.js";
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
export async function todayPlanCard() {
  const { plans, active } = await getPlans();
  const plan = plans.find(p => p.id === active);
  if (!plan) return null;
  const [routines, workouts] = await Promise.all([getRoutines(), getWorkouts()]);
  const pos = planPosition(plan);
  let body;
  let routine = null;
  if (pos.status === "upcoming") body = `<p class="muted" style="margin:0;">${t("Le plan commence dans {n} jour(s).", { n: pos.startsIn })}</p>`;
  else if (pos.status === "done") body = `<p class="muted" style="margin:0;">🎉 ${t("Plan terminé ! Crée le suivant dans Routines → Plans.")}</p>`;
  else {
    routine = routines.find(r => r.id === pos.routineId) || null;
    const already = routine && doneOn(workouts, new Date(), routine);
    body = `
      <div class="muted" style="font-size:13px; margin-bottom:6px;">${t("Semaine {w}/{total} · {block} (semaine {bw}/{bweeks})", { w: pos.week, total: pos.total, block: esc(pos.block.name || t("Bloc {n}", { n: pos.blockIndex + 1 })), bw: pos.blockWeek, bweeks: pos.block.weeks })}</div>
      ${weekStripHtml(weekCells(plan, new Date(), routines, workouts))}
      ${routine
        ? (already ? `<p class="muted" style="margin:8px 0 0;">✓ ${t("{routine} faite aujourd'hui. Bien joué !", { routine: esc(routine.name) })}</p>`
                   : `<button class="btn btn-primary" id="plan-start" style="margin-top:10px;">▶ ${t("Démarrer : {routine}", { routine: esc(routine.name) })}</button>`)
        : `<p class="muted" style="margin:8px 0 0;">😴 ${t("Repos aujourd'hui.")}</p>`}`;
  }
  return {
    html: `<div class="card plan-card"><div class="card-title">📅 ${esc(plan.name)}</div>${body}</div>`,
    routine, plan, week: pos.week
  };
}

export async function renderPlans(content) {
  const [{ plans, active }, routines, workouts] = await Promise.all([getPlans(), getRoutines(), getWorkouts()]);
  if (!content.isConnected) return;
  const refresh = () => renderPlans(content);
  content.innerHTML = `
    <button class="btn btn-primary" id="new-plan" ${routines.length ? "" : "disabled"}>+ ${t("Nouveau plan")}</button>
    ${routines.length ? "" : `<p class="muted">${t("Crée d'abord des routines : un plan les répartit sur les jours de la semaine.")}</p>`}
    <p class="muted" style="font-size:13px;">${t("Un plan enchaîne tes routines sur plusieurs semaines ou mois, en blocs (ex. 4 semaines hypertrophie, puis 3 semaines force, puis 1 semaine de décharge). Le plan actif s'affiche dans l'onglet Séance.")}</p>
    ${plans.map(p => {
      const pos = planPosition(p);
      const status = pos.status === "upcoming" ? t("Commence le {date}", { date: parseDay(p.start_date).toLocaleDateString(locale(), { day: "numeric", month: "long" }) })
        : pos.status === "done" ? t("Terminé") : t("Semaine {w}/{total}", { w: pos.week, total: pos.total });
      return `
      <div class="card ${p.id === active ? "plan-active" : ""}">
        <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
          <div class="card-title" style="margin-bottom:4px;">${esc(p.name)}</div>
          ${p.id === active ? `<span class="routine-badge">✅ ${t("Actif")}</span>` : ""}
        </div>
        <div class="muted" style="font-size:13px; margin-bottom:6px;">${status} · ${(p.blocks || []).map(b => `${esc(b.name || "")} ${b.weeks} ${t("sem.")}`).join(" → ")}</div>
        ${pos.status === "running" ? `<div class="progress-bar" style="margin-bottom:8px;"><div class="progress-bar-fill" style="width:${Math.round((pos.week - 1) / pos.total * 100)}%"></div></div>` : ""}
        ${p.id === active && pos.status === "running" ? weekStripHtml(weekCells(p, new Date(), routines, workouts)) : ""}
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn btn-sm btn-secondary" data-activate="${esc(p.id)}">${p.id === active ? t("Désactiver") : t("Activer")}</button>
          <button class="btn btn-sm btn-secondary" data-pedit="${esc(p.id)}">${t("Modifier")}</button>
          <button class="btn btn-sm btn-danger" data-pdel="${esc(p.id)}">${t("Supprimer")}</button>
        </div>
      </div>`;
    }).join("")}
  `;
  content.querySelector("#new-plan").onclick = () => openPlanEditor(null, routines, refresh);
  content.querySelectorAll("[data-pedit]").forEach(b => b.onclick = () => openPlanEditor(plans.find(p => p.id === b.dataset.pedit), routines, refresh));
  content.querySelectorAll("[data-activate]").forEach(b => b.onclick = async () => {
    const id = b.dataset.activate;
    await savePlans(plans, active === id ? null : id);
    toast(active === id ? t("Plan désactivé") : t("Plan activé : il s'affiche dans l'onglet Séance"));
    refresh();
  });
  content.querySelectorAll("[data-pdel]").forEach(b => b.onclick = async () => {
    if (!confirm(t("Supprimer ce plan ? Tes routines et tes séances sont conservées."))) return;
    const id = b.dataset.pdel;
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
