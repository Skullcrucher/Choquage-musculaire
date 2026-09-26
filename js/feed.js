// ============================================================
// ONGLET FEED — séances de tous les utilisateurs, en fun
// ============================================================
import * as db from "./db.js";
import { fmtDateTime, fmtDuration, esc, safeImageUrl } from "./utils.js";
import { getUser } from "./auth.js";
import { openWorkoutDetail, partnersHtml } from "./workout-detail.js";
import { renderFriends, countIncomingRequests } from "./friends.js";
import { openProfile } from "./profile.js";
import { songHtml, bindSongLinks, parseSpotify } from "./music.js";
import { t, tn } from "./i18n.js";

// Records, "son du record", playlist et bande-son d'une séance partagée.
export function workoutMusicHtml(w) {
  const records = Array.isArray(w.records) ? w.records : [];
  const playlist = parseSpotify(w.soundtrack?.playlist_url);
  const nbTracks = Array.isArray(w.soundtrack?.tracks) ? w.soundtrack.tracks.length : 0;
  if (!records.length && !playlist && !nbTracks) return "";
  const top = records[0];
  return `
    <div class="feed-music">
      ${top ? `<div>🏆 <b>${t("Record")}</b> : ${esc(top.exercise)} — ${esc(top.kg)} kg × ${esc(top.reps)}${records.length > 1 ? ` <span class="muted">(${tn(records.length - 1, "+{n} autre", "+{n} autres")})</span>` : ""}</div>` : ""}
      ${top && w.record_song ? `<div>🎵 ${t("Porté par")} ${songHtml(w.record_song)}</div>` : ""}
      ${playlist || nbTracks ? `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:4px;">
        ${playlist ? `<span class="song-link" data-playlist-url="${esc(playlist.url)}" data-playlist-title="${t("Playlist de la séance")}">🎧 ${t("Playlist de la séance")}</span>` : ""}
        ${nbTracks ? `<span class="muted">🎶 ${tn(nbTracks, "{n} morceau écouté", "{n} morceaux écoutés")}</span>` : ""}
      </div>` : ""}
    </div>`;
}

let feedMode = "workouts"; // "workouts" | "challenges" | "music" | "friends"

const MUSCLE_EMOJI = {
  "Pectoraux": "💥", "Dos": "🦍", "Épaules": "🏔️", "Biceps": "💪", "Triceps": "🔱",
  "Jambes": "🦵", "Fessiers": "🍑", "Abdominaux": "🎯", "Avant-bras": "✊",
  "Cardio": "🫀", "Autre": "⚡"
};

function vibeTag(totalSets) {
  if (!totalSets) return null;
  if (totalSets < 8) return { label: t("Mise en jambe"), emoji: "🙂" };
  if (totalSets < 16) return { label: t("Séance solide"), emoji: "💪" };
  if (totalSets < 26) return { label: t("Grosse séance"), emoji: "🔥" };
  return { label: t("Murder session"), emoji: "🤘🔥" };
}

const TONNAGE_REFS = [
  // i18n-keys: "un piano droit", "une moto", "une voiture citadine", "un éléphant d'Afrique", "un bus", "une baleine bleue"
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
  return `${mult}× ${ref.emoji} ${t(ref.label)}`;
}

export async function renderFeedTab(container) {
  container.innerHTML = `
    <h1 class="section-title">${t("Feed")} <img class="title-horns" src="icons/horns.png" alt=""></h1>
    <div class="chip-row" id="feed-mode-chips" style="margin-bottom:14px;">
      <div class="chip ${feedMode === "workouts" ? "active" : ""}" data-fmode="workouts">${t("Séances")}</div>
      <div class="chip ${feedMode === "challenges" ? "active" : ""}" data-fmode="challenges">🏆 ${t("Défis")}</div>
      <div class="chip ${feedMode === "music" ? "active" : ""}" data-fmode="music">🎧 ${t("Son")}</div>
      <div class="chip ${feedMode === "friends" ? "active" : ""}" data-fmode="friends">👥 ${t("Amis")}<span id="friend-req-count"></span></div>
    </div>
    <div id="feed-body"></div>
  `;
  container.querySelectorAll("[data-fmode]").forEach(chip => {
    chip.onclick = () => {
      feedMode = chip.dataset.fmode;
      container.querySelectorAll("[data-fmode]").forEach(c => c.classList.toggle("active", c === chip));
      drawFeedBody(container);
    };
  });
  countIncomingRequests().then(n => {
    const el = container.querySelector("#friend-req-count");
    if (el && n) el.innerHTML = ` <span class="req-dot">${n}</span>`;
  });
  await drawFeedBody(container);
}

async function drawFeedBody(container) {
  const body = container.querySelector("#feed-body");
  if (!body) return;
  if (feedMode === "friends") await renderFriends(body);
  else if (feedMode === "challenges") await (await import("./challenges.js")).renderChallenges(body);
  else if (feedMode === "music") await (await import("./music-wall.js")).renderMusicWall(body);
  else await renderFeedWorkouts(body);
}

async function renderFeedWorkouts(body) {
  body.innerHTML = `<div id="feed-list"><div class="empty-state"><span class="num">···</span>${t("Chargement")}</div></div>`;
  const wrap = body.querySelector("#feed-list");
  // Séances partagées + séances (même privées) où un ami m'a cité.
  const [feed, tagged] = await Promise.all([db.listFeedWorkouts(60), db.listPartnerWorkouts(30).catch(() => [])]);
  const byId = new Map([...feed, ...tagged].map(w => [w.id, w]));
  const workouts = [...byId.values()].sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)));
  const myUid = getUser()?.uid;
  const profiles = await db.getProfiles(workouts.flatMap(w => [w.owner_uid, ...(w.partners || [])]));

  wrap.innerHTML = workouts.length === 0
    ? `<div class="empty-state muted" style="padding:20px;">${t("Aucune séance partagée pour l'instant.")}</div>`
    : workouts.map(w => {
        const profile = profiles[w.owner_uid];
        const name = w.owner_uid === myUid ? t("Toi") : (profile?.display_name || w.owner_name || t("Utilisateur"));
        const photo = safeImageUrl(profile?.photo_data_url || w.owner_photo);
        const muscles = w.muscle_summary || [];
        const vibe = vibeTag(w.total_sets);
        const fun = tonnageFun(w.total_tonnage);
        const propsCount = w.props ? Object.keys(w.props).length : 0;
        const iReacted = !!(w.props && myUid && w.props[myUid]);
        return `
      <div class="card feed-card" data-w="${esc(w.id)}">
        <div style="display:flex; align-items:center; gap:10px;">
          ${photo ? `<div data-profile="${esc(w.owner_uid)}" style="width:38px; height:38px; border-radius:50%; background:center/cover no-repeat; background-image:url('${photo}'); flex-shrink:0; cursor:pointer;"></div>` : `<div data-profile="${esc(w.owner_uid)}" style="cursor:pointer; width:38px; height:38px; border-radius:50%; background:var(--surface-raised); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:var(--amber); flex-shrink:0;">${esc(name[0].toUpperCase())}</div>`}
          <div style="flex:1; min-width:0;">
            <div class="list-row-title"><span class="profile-link" data-profile="${esc(w.owner_uid)}">${esc(name)}</span> <span class="muted" style="font-weight:400;">· ${esc(w.title)}</span></div>
            <div class="list-row-sub">${fmtDateTime(w.start_time)}${vibe ? ` · ${vibe.emoji} ${vibe.label}` : ""}</div>
          </div>
          <div class="list-row-meta" style="text-align:right; flex-shrink:0;">
            ${fmtDuration(w.start_time, w.end_time)}
            ${w.total_sets ? `<div style="font-size:11px;">${tn(w.total_sets, "{n} série", "{n} séries")}</div>` : ""}
          </div>
        </div>
        ${(w.partners || []).length ? `<p class="muted" style="margin:8px 0 0; font-size:13px;">🤝 ${t("Avec")} ${partnersHtml(w.partners, profiles, myUid)}${w.shared ? "" : ` · 🔒 ${t("visible par les partenaires")}`}</p>` : ""}
        ${muscles.length ? `<div class="chip-row" style="margin-top:10px; margin-bottom:0;">${muscles.map(m => `<span class="feed-muscle-badge">${MUSCLE_EMOJI[m] || "⚡"} ${esc(t(m))}</span>`).join("")}</div>` : ""}
        ${fun ? `<p class="muted" style="margin:8px 0 0; font-size:13px;">🏋️ ${t("{kg} kg soulevés — ça pèse {comparison} !", { kg: w.total_tonnage, comparison: fun })}</p>` : ""}
        ${workoutMusicHtml(w)}
        <div style="display:flex; justify-content:flex-end; margin-top:8px;${w.shared ? "" : " display:none;"}">
          <button class="props-btn ${iReacted ? "reacted" : ""}" data-props="${esc(w.id)}">
            <img class="props-horns" src="icons/horns.png" alt="🤘">
            <span>${propsCount > 0 ? propsCount : ""}</span>
          </button>
        </div>
      </div>
    `;
      }).join("");

  bindSongLinks(wrap);
  wrap.querySelectorAll("[data-profile]").forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); openProfile(el.dataset.profile); };
  });
  wrap.querySelectorAll(".feed-card[data-w]").forEach(el => {
    el.onclick = () => openWorkoutDetail(
      workouts.find(w => w.id === el.dataset.w),
      () => renderFeedWorkouts(body)
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
