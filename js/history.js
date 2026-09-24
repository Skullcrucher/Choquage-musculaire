// ============================================================
// ONGLET HISTORIQUE — calendrier + liste des séances passées, + feed
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, fmtDateTime, fmtDuration, estimate1RM } from "./utils.js";
import { getWorkouts, invalidate } from "./cache.js";
import { getUser } from "./auth.js";

let viewMonth = new Date();
let workoutsCache = [];
let selectedDay = null;
let mode = "mine"; // "mine" | "feed"
let feedCache = null;

const DOW = ["L", "M", "M", "J", "V", "S", "D"];

// ---------- Fun feed helpers ----------
const MUSCLE_EMOJI = {
  "Pectoraux": "💥", "Dos": "🦍", "Épaules": "🏔️", "Biceps": "💪", "Triceps": "🔱",
  "Jambes": "🦵", "Fessiers": "🍑", "Abdominaux": "🎯", "Avant-bras": "✊",
  "Cardio": "🫀", "Autre": "⚡"
};

function vibeTag(totalSets) {
  if (!totalSets) return null;
  if (totalSets < 8) return { label: "Mise en jambe", emoji: "🙂" };
  if (totalSets < 16) return { label: "Séance solide", emoji: "💪" };
  if (totalSets < 26) return { label: "Grosse séance", emoji: "🔥" };
  return { label: "Murder session", emoji: "🤘🔥" };
}

const TONNAGE_REFS = [
  { kg: 90, label: "un piano droit", emoji: "🎹" },
  { kg: 200, label: "une moto", emoji: "🏍️" },
  { kg: 1200, label: "une voiture citadine", emoji: "🚗" },
  { kg: 5000, label: "un éléphant d'Afrique", emoji: "🐘" },
  { kg: 12000, label: "un bus", emoji: "🚌" },
  { kg: 90000, label: "une baleine bleue", emoji: "🐋" }
];

function tonnageFun(kg) {
  if (!kg || kg < 40) return null;
  let ref = TONNAGE_REFS[0];
  for (const r of TONNAGE_REFS) { if (kg >= r.kg * 0.6) ref = r; }
  const mult = Math.max(1, Math.round((kg / ref.kg) * 10) / 10);
  return `${mult}× ${ref.emoji} ${ref.label}`;
}

export async function renderHistorique(container) {
  workoutsCache = await getWorkouts();
  container.innerHTML = `
    <h1 class="section-title">Historique</h1>
    <div class="chip-row" id="mode-chips" style="margin-bottom:14px;">
      <div class="chip ${mode === "mine" ? "active" : ""}" data-mode="mine">Mes séances</div>
      <div class="chip ${mode === "feed" ? "active" : ""}" data-mode="feed">Feed</div>
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
  if (mode === "feed") {
    await renderFeed(content);
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
    <h3 class="muted" style="margin:18px 0 6px;" id="list-label">Séances récentes</h3>
    <div id="workout-list"></div>
  `;
  content.querySelector("#prev-month").onclick = () => { viewMonth.setMonth(viewMonth.getMonth() - 1); selectedDay = null; renderCalendar(content); renderList(content); };
  content.querySelector("#next-month").onclick = () => { viewMonth.setMonth(viewMonth.getMonth() + 1); selectedDay = null; renderCalendar(content); renderList(content); };
  renderCalendar(content);
  renderList(content);
}

async function renderFeed(content) {
  content.innerHTML = `<div id="feed-list"><div class="empty-state"><span class="num">···</span>Chargement</div></div>`;
  const wrap = content.querySelector("#feed-list");
  const workouts = await db.listFeedWorkouts(60);
  feedCache = workouts;
  const myUid = getUser()?.uid;

  const profiles = await db.getProfiles(workouts.map(w => w.owner_uid));

  wrap.innerHTML = workouts.length === 0
    ? `<div class="empty-state muted" style="padding:20px;">Aucune séance pour l'instant.</div>`
    : workouts.map(w => {
        const profile = profiles[w.owner_uid];
        const name = w.owner_uid === myUid ? "Toi" : (profile?.display_name || w.owner_name || "Utilisateur");
        const photo = profile?.photo_data_url || w.owner_photo;
        const muscles = w.muscle_summary || [];
        const vibe = vibeTag(w.total_sets);
        const fun = tonnageFun(w.total_tonnage);
        const propsCount = w.props ? Object.keys(w.props).length : 0;
        const iReacted = !!(w.props && myUid && w.props[myUid]);
        return `
      <div class="card feed-card" data-w="${w.id}">
        <div style="display:flex; align-items:center; gap:10px;">
          ${photo ? `<div style="width:38px; height:38px; border-radius:50%; background:center/cover no-repeat; background-image:url('${photo}'); flex-shrink:0;"></div>` : `<div style="width:38px; height:38px; border-radius:50%; background:var(--surface-raised); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:var(--amber); flex-shrink:0;">${name[0].toUpperCase()}</div>`}
          <div style="flex:1; min-width:0;">
            <div class="list-row-title">${name} <span class="muted" style="font-weight:400;">· ${w.title}</span></div>
            <div class="list-row-sub">${fmtDateTime(w.start_time)}${vibe ? ` · ${vibe.emoji} ${vibe.label}` : ""}</div>
          </div>
          <div class="list-row-meta" style="text-align:right; flex-shrink:0;">
            ${fmtDuration(w.start_time, w.end_time)}
            ${w.total_sets ? `<div style="font-size:11px;">${w.total_sets} série${w.total_sets > 1 ? "s" : ""}</div>` : ""}
          </div>
        </div>
        ${muscles.length ? `<div class="chip-row" style="margin-top:10px; margin-bottom:0;">${muscles.map(m => `<span class="feed-muscle-badge">${MUSCLE_EMOJI[m] || "⚡"} ${m}</span>`).join("")}</div>` : ""}
        ${fun ? `<p class="muted" style="margin:8px 0 0; font-size:13px;">🏋️ ${w.total_tonnage} kg soulevés — ça pèse ${fun} !</p>` : ""}
        <div style="display:flex; justify-content:flex-end; margin-top:8px;">
          <button class="props-btn ${iReacted ? "reacted" : ""}" data-props="${w.id}">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><rect x="30" y="50" width="38" height="38" rx="17"/><rect x="37" y="42" width="12" height="18" rx="6"/><rect x="50" y="42" width="12" height="18" rx="6"/><rect x="-6.5" y="-44" width="13" height="44" rx="6.5" transform="translate(36 52) rotate(-16)"/><rect x="-5.5" y="-40" width="11" height="40" rx="5.5" transform="translate(63 54) rotate(18)"/><rect x="-6.5" y="-32" width="13" height="32" rx="6.5" transform="translate(32 68) rotate(-82)"/></g></svg>
            <span>${propsCount > 0 ? propsCount : ""}</span>
          </button>
        </div>
      </div>
    `;
      }).join("");

  wrap.querySelectorAll(".feed-card[data-w]").forEach(el => {
    el.onclick = () => openWorkoutDetail(workouts.find(w => w.id === el.dataset.w));
  });
  wrap.querySelectorAll(".props-btn").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const workoutId = btn.dataset.props;
      btn.disabled = true;
      try {
        const nowReacted = await db.toggleProps(workoutId);
        const w = workouts.find(x => x.id === workoutId);
        w.props = w.props || {};
        if (nowReacted) w.props[myUid] = true; else delete w.props[myUid];
        btn.classList.toggle("reacted", nowReacted);
        const count = Object.keys(w.props).length;
        btn.querySelector("span").textContent = count > 0 ? count : "";
      } catch (err) {
        console.error("[Fonte] Erreur réaction", err);
      }
      btn.disabled = false;
    };
  });
}

function renderCalendar(container) {
  const label = container.querySelector("#month-label");
  label.textContent = viewMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

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
    label.textContent = `Séances du ${selectedDay} ${viewMonth.toLocaleDateString("fr-FR", { month: "long" })}`;
  } else {
    label.textContent = "Séances du mois";
  }
  const wrap = container.querySelector("#workout-list");
  wrap.innerHTML = list.length === 0
    ? `<div class="empty-state muted" style="padding:20px;">Aucune séance.</div>`
    : list.map(w => `
      <div class="list-row" data-w="${w.id}">
        <div>
          <div class="list-row-title">${w.title}</div>
          <div class="list-row-sub">${fmtDateTime(w.start_time)}</div>
        </div>
        <div class="list-row-meta">${fmtDuration(w.start_time, w.end_time)}</div>
      </div>
    `).join("");
  wrap.querySelectorAll("[data-w]").forEach(el => {
    el.onclick = () => openWorkoutDetail(list.find(w => w.id === el.dataset.w));
  });
}

async function openWorkoutDetail(workout) {
  const sets = await db.listSets(workout.id);
  const isOwner = !workout.owner_uid || workout.owner_uid === getUser()?.uid;
  const byExercise = {};
  sets.forEach(s => {
    byExercise[s.exercise_title] = byExercise[s.exercise_title] || [];
    byExercise[s.exercise_title].push(s);
  });
  openModal(`
    <h3>${workout.title}</h3>
    <p class="muted" style="margin-top:-8px;">
      ${workout.owner_name && !isOwner ? `${workout.owner_name} · ` : ""}${fmtDateTime(workout.start_time)} · ${fmtDuration(workout.start_time, workout.end_time)}
    </p>
    ${Object.entries(byExercise).map(([name, exSets]) => `
      <div style="margin-bottom:12px;">
        <div style="font-family:'Barlow Condensed',sans-serif; font-size:17px; margin-bottom:4px;">${name}</div>
        ${exSets.sort((a, b) => a.set_index - b.set_index).map(s => `
          <div class="muted" style="display:flex; justify-content:space-between; padding:3px 0;">
            <span>Série ${s.set_index} ${s.set_type !== "normal" ? "· " + s.set_type : ""}</span>
            <span>${s.weight_kg ?? "—"} kg × ${s.reps ?? "—"}${s.weight_kg && s.reps ? ` (1RM ${estimate1RM(s.weight_kg, s.reps)} kg)` : ""}</span>
          </div>
        `).join("")}
      </div>
    `).join("") || `<p class="muted">Aucune série enregistrée.</p>`}
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-secondary" id="close-detail">Fermer</button>
      ${isOwner ? `<button class="btn btn-danger" id="del-workout">Supprimer</button>` : ""}
    </div>
  `, (modalEl) => {
    modalEl.querySelector("#close-detail").onclick = closeModal;
    const delBtn = modalEl.querySelector("#del-workout");
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm("Supprimer cette séance et toutes ses séries ?")) return;
      await db.deleteWorkout(workout.id);
      invalidate("workouts");
      closeModal();
      await renderHistorique(document.getElementById("view"));
    };
  });
}
