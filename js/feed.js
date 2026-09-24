// ============================================================
// ONGLET FEED — séances de tous les utilisateurs, en fun
// ============================================================
import * as db from "./db.js";
import { fmtDateTime, fmtDuration } from "./utils.js";
import { getUser } from "./auth.js";
import { openWorkoutDetail } from "./workout-detail.js";

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

export async function renderFeedTab(container) {
  container.innerHTML = `
    <h1 class="section-title">Feed 🤘</h1>
    <div id="feed-list"><div class="empty-state"><span class="num">···</span>Chargement</div></div>
  `;
  const wrap = container.querySelector("#feed-list");
  const workouts = await db.listFeedWorkouts(60);
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
    el.onclick = () => openWorkoutDetail(
      workouts.find(w => w.id === el.dataset.w),
      () => renderFeedTab(container)
    );
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
        console.error("[Skullcrusher] Erreur réaction", err);
      }
      btn.disabled = false;
    };
  });
}
