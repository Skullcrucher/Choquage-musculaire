// ============================================================
// ONGLET HISTORIQUE — calendrier + liste des séances passées + routines
// ============================================================
import { fmtDateTime, fmtDuration, esc } from "./utils.js";
import { getBody, workoutCalories } from "./calories.js";
import { getWorkouts } from "./cache.js";
import { openWorkoutDetail } from "./workout-detail.js";
import { renderRoutines } from "./routines.js";
import { t, locale } from "./i18n.js";

let viewMonth = new Date();
let workoutsCache = [];
let selectedDay = null;
let mode = "mine"; // "mine" | "routines"

// Initiales des jours (lundi → dimanche) dans la langue de l'app.
const DOW = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: "narrow" }));

export async function renderHistorique(container) {
  workoutsCache = await getWorkouts();
  container.innerHTML = `
    <h1 class="section-title">${t("Historique")}</h1>
    <div class="chip-row" id="mode-chips" style="margin-bottom:14px;">
      <div class="chip ${mode === "mine" ? "active" : ""}" data-mode="mine">${t("Mes séances")}</div>
      <div class="chip ${mode === "routines" ? "active" : ""}" data-mode="routines">${t("Routines")}</div>
    </div>
    <div id="hist-content"></div>
  `;
  container.querySelectorAll("#mode-chips .chip").forEach(chip => {
    chip.onclick = () => {
      mode = chip.dataset.mode;
      container.querySelectorAll("#mode-chips .chip").forEach(c => c.classList.toggle("active", c === chip));
      drawContent(container);
    };
  });
  await drawContent(container);
}

async function drawContent(container) {
  const content = container.querySelector("#hist-content");
  if (!content) return;
  if (mode === "routines") {
    await renderRoutines(content);
  } else {
    renderMine(content);
  }
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
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // lundi=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const workoutDays = new Set(
    workoutsCache
      .filter(w => {
        const d = new Date(w.start_time);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .map(w => new Date(w.start_time).getDate())
  );

  let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const has = workoutDays.has(day);
    html += `<div class="cal-day ${has ? "has-workout" : ""}" data-day="${day}">${day}</div>`;
  }
  grid.innerHTML = html;
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
  wrap.innerHTML = list.length === 0
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
      () => renderHistorique(document.getElementById("view"))
    );
  });
}

