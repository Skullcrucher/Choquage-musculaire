// ============================================================
// ONGLET FEED — séances de tous les utilisateurs, en fun
// ============================================================
import * as db from "./db.js";
import { fmtDateTime, fmtDuration, esc, safeImageUrl } from "./utils.js";
import { getUser } from "./auth.js";
import { openWorkoutDetail, partnersHtml } from "./workout-detail.js";
import { renderFriends, countIncomingRequests } from "./friends.js";
import { openProfile } from "./profile.js";
import { songHtml, bindSongLinks, parseMusicLink, providerIcon } from "./music.js";
import { icon, segHtml } from "./icons.js";
import { openComments } from "./comments.js";
import { gradeBadgeHtml } from "./xp.js";
import { t, tn } from "./i18n.js";

// Records, "son du record", playlist et bande-son d'une séance partagée.
export function workoutMusicHtml(w) {
  const records = Array.isArray(w.records) ? w.records : [];
  const playlist = parseMusicLink(w.soundtrack?.playlist_url);
  const nbTracks = Array.isArray(w.soundtrack?.tracks) ? w.soundtrack.tracks.length : 0;
  if (!records.length && !playlist && !nbTracks) return "";
  const top = records[0];
  return `
    <div class="feed-music">
      ${top ? `<div>🏆 <b>${t("Record")}</b> : ${esc(top.exercise)} — ${esc(top.kg)} kg × ${esc(top.reps)}${records.length > 1 ? ` <span class="muted">(${tn(records.length - 1, "+{n} autre", "+{n} autres")})</span>` : ""}</div>` : ""}
      ${top && w.record_song ? `<div>🎵 ${t("Porté par")} ${songHtml(w.record_song)}</div>` : ""}
      ${playlist || nbTracks ? `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:4px;">
        ${playlist ? `<span class="song-link" data-playlist-url="${esc(playlist.url)}" data-playlist-title="${t("Playlist de la séance")}">${providerIcon(playlist)} ${t("Playlist de la séance")}</span>` : ""}
        ${nbTracks ? `<span class="muted">🎶 ${tn(nbTracks, "{n} morceau écouté", "{n} morceaux écoutés")}</span>` : ""}
      </div>` : ""}
      ${nbTracks ? `<div class="feed-tracks">${w.soundtrack.tracks.filter(tr => parseMusicLink(tr.url)).slice(0, 3).map(tr => `<span>${songHtml({ url: tr.url, source: "spotify" })}</span>`).join("")}${nbTracks > 3 ? `<span class="muted">${tn(nbTracks - 3, "+{n} autre", "+{n} autres")}</span>` : ""}</div>` : ""}
    </div>`;
}

// Feed : "community" (séances partagées de tous les membres), "friends"
// (mes amis + moi), "challenges". La gestion des amis s'ouvre depuis le fil
// Amis (friendsManage). La musique a son onglet.
let feedMode = "community";
let friendsManage = false;
const LS_SORT = "skullcrusher_feed_sort";
let feedSort = (() => { try { return localStorage.getItem(LS_SORT) === "top" ? "top" : "recent"; } catch (_) { return "recent"; } })();

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
  if (!["community", "friends", "challenges"].includes(feedMode)) feedMode = "community";
  container.innerHTML = `
    <h1 class="section-title">${t("Feed")} <img class="title-horns" src="icons/horns.png" alt=""></h1>
    ${segHtml([["community", t("Communauté"), "globe"], ["friends", t("Amis"), "friends"], ["challenges", t("Défis"), "trophy"]], feedMode, "data-fmode", { extra: { friends: `<span id="friend-req-count"></span>` } })}
    <div id="feed-body"></div>
  `;
  container.querySelectorAll("[data-fmode]").forEach(chip => {
    chip.onclick = () => {
      feedMode = chip.dataset.fmode;
      friendsManage = false;
      container.querySelectorAll("[data-fmode]").forEach(c => c.classList.toggle("active", c === chip));
      drawFeedBody(container);
    };
  });
  refreshRequestBadge(container);
  await drawFeedBody(container);
}

function refreshRequestBadge(root) {
  countIncomingRequests().then(n => {
    root.querySelectorAll("#friend-req-count, #manage-req-count").forEach(el => {
      el.innerHTML = n ? ` <span class="req-dot">${n}</span>` : "";
    });
  }).catch(() => {});
}

async function drawFeedBody(container) {
  const body = container.querySelector("#feed-body");
  if (!body) return;
  if (feedMode === "challenges") await (await import("./challenges.js")).renderChallenges(body);
  else if (feedMode === "friends" && friendsManage) {
    body.innerHTML = `<button class="btn btn-secondary btn-sm" id="feed-back" style="margin-bottom:12px;">← ${t("Retour au fil des amis")}</button><div id="friends-manage"></div>`;
    body.querySelector("#feed-back").onclick = () => { friendsManage = false; drawFeedBody(container); refreshRequestBadge(container); };
    await renderFriends(body.querySelector("#friends-manage"));
  }
  else await renderFeedWorkouts(body, container);
}

// Fil de séances : même présentation pour la communauté et les amis.
async function renderFeedWorkouts(body, root) {
  const mode = feedMode;
  const myUid = getUser()?.uid;
  body.innerHTML = `
    ${mode === "friends" ? `
      <div class="feed-friends-bar">
        <div id="gym-now" style="flex:1; min-width:0;"></div>
        <button class="btn btn-secondary btn-sm" id="manage-friends">👥 ${t("Gérer mes amis")}<span id="manage-req-count"></span></button>
      </div>` : ""}
    ${mode === "community" ? `<div id="feed-podium"></div>` : ""}
    <div class="chip-row feed-sort">
      <div class="chip ${feedSort === "recent" ? "active" : ""}" data-sort="recent">🕒 ${t("Récentes")}</div>
      <div class="chip ${feedSort === "top" ? "active" : ""}" data-sort="top">🤘 ${t("Top de la semaine")}</div>
    </div>
    <div id="feed-list"><div class="empty-state"><span class="num">···</span>${t("Chargement")}</div></div>`;
  const wrap = body.querySelector("#feed-list");
  body.querySelectorAll("[data-sort]").forEach(c => c.onclick = () => {
    feedSort = c.dataset.sort;
    try { localStorage.setItem(LS_SORT, feedSort); } catch (_) {}
    renderFeedWorkouts(body, root);
  });
  if (mode === "community") {
    // Le dimanche (et le lundi : podium final), podium de la semaine.
    import("./challenges.js").then(m => m.podiumHtml()).then(html => {
      const el = body.querySelector("#feed-podium");
      if (!html || !el) return;
      el.innerHTML = html;
      el.querySelectorAll("[data-profile]").forEach(x => x.onclick = () => openProfile(x.dataset.profile));
      const go = el.querySelector("#podium-go");
      if (go) go.onclick = () => root.querySelector('[data-fmode="challenges"]')?.click();
    }).catch(e => console.warn("[Skullcrusher] Podium", e));
  }
  if (mode === "friends") {
    body.querySelector("#manage-friends").onclick = () => { friendsManage = true; drawFeedBody(root); };
    refreshRequestBadge(body);
    import("./presence.js").then(m => m.renderGymNow(body.querySelector("#gym-now"), { onOpenProfile: openProfile })).catch(() => {});
  }

  let workouts;
  try {
    if (mode === "friends") {
      // Mes amis + moi : séances communauté ET « amis seulement », plus
      // celles où un ami m'a cité.
      const friendUids = await db.listFriendUids().catch(() => []);
      const [circle, tagged] = await Promise.all([db.listCircleWorkouts([myUid, ...friendUids]), db.listPartnerWorkouts(30).catch(() => [])]);
      const allowed = new Set([myUid, ...friendUids]);
      workouts = [...new Map([...circle, ...tagged.filter(w => allowed.has(w.owner_uid))].map(w => [w.id, w])).values()];
    } else {
      // Toute la communauté : chaque séance partagée par n'importe quel membre.
      const [feed, tagged] = await Promise.all([db.listFeedWorkouts(80), db.listPartnerWorkouts(30).catch(() => [])]);
      workouts = [...new Map([...feed, ...tagged].map(w => [w.id, w])).values()];
    }
  } catch (err) {
    console.error("[Skullcrusher] Feed", err);
    wrap.innerHTML = `<div class="empty-state">${t("Chargement impossible.")}</div>`;
    return;
  }
  const votes = (w) => w.props ? Object.keys(w.props).length : 0;
  workouts.sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)));
  if (feedSort === "top") {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const week = workouts.filter(w => String(w.start_time) >= weekAgo);
    workouts = (week.length ? week : workouts).slice().sort((a, b) => votes(b) - votes(a) || (b.comment_count || 0) - (a.comment_count || 0));
  }
  workouts = workouts.slice(0, 80);
  const profiles = await db.getProfiles(workouts.flatMap(w => [w.owner_uid, ...(w.partners || [])]));
  if (!wrap.isConnected) return;

  wrap.innerHTML = workouts.length === 0
    ? `<div class="empty-state muted" style="padding:20px;">${mode === "friends" ? t("Aucune séance partagée par tes amis pour l'instant.") : t("Aucune séance partagée pour l'instant.")}</div>`
    : workouts.map(w => {
        const profile = profiles[w.owner_uid];
        const name = w.owner_uid === myUid ? t("Toi") : (profile?.display_name || w.owner_name || t("Utilisateur"));
        const photo = safeImageUrl(profile?.photo_data_url || w.owner_photo);
        const muscles = w.muscle_summary || [];
        const vibe = vibeTag(w.total_sets);
        const fun = tonnageFun(w.total_tonnage);
        const propsCount = votes(w);
        const iReacted = !!(w.props && myUid && w.props[myUid]);
        const comments = Math.max(0, w.comment_count || 0);
        const social = w.shared || w.friends_share;
        return `
      <div class="card feed-card" data-w="${esc(w.id)}">
        <div style="display:flex; align-items:center; gap:10px;">
          ${photo ? `<div data-profile="${esc(w.owner_uid)}" style="width:38px; height:38px; border-radius:50%; background:center/cover no-repeat; background-image:url('${photo}'); flex-shrink:0; cursor:pointer;"></div>` : `<div data-profile="${esc(w.owner_uid)}" style="cursor:pointer; width:38px; height:38px; border-radius:50%; background:var(--surface-raised); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:var(--amber); flex-shrink:0;">${esc(name[0].toUpperCase())}</div>`}
          <div style="flex:1; min-width:0;">
            <div class="list-row-title"><span class="profile-link" data-profile="${esc(w.owner_uid)}">${esc(name)}</span>${gradeBadgeHtml(profile?.xp)} <span class="muted" style="font-weight:400;">· ${esc(w.title)}</span></div>
            <div class="list-row-sub">${fmtDateTime(w.start_time)}${vibe ? ` · ${vibe.emoji} ${vibe.label}` : ""}${!w.shared && w.friends_share ? ` · <span class="feed-scope">👥 ${t("Amis")}</span>` : ""}</div>
          </div>
          <div class="list-row-meta" style="text-align:right; flex-shrink:0;">
            ${fmtDuration(w.start_time, w.end_time)}
            ${w.total_sets ? `<div style="font-size:11px;">${tn(w.total_sets, "{n} série", "{n} séries")}</div>` : ""}
          </div>
        </div>
        ${(w.partners || []).length ? `<p class="muted" style="margin:8px 0 0; font-size:13px;">🤝 ${t("Avec")} ${partnersHtml(w.partners, profiles, myUid)}${social ? "" : ` · 🔒 ${t("visible par les partenaires")}`}</p>` : ""}
        ${muscles.length ? `<div class="chip-row" style="margin-top:10px; margin-bottom:0;">${muscles.map(m => `<span class="feed-muscle-badge">${MUSCLE_EMOJI[m] || "⚡"} ${esc(t(m))}</span>`).join("")}</div>` : ""}
        ${fun ? `<p class="muted" style="margin:8px 0 0; font-size:13px;">🏋️ ${t("{kg} kg soulevés — ça pèse {comparison} !", { kg: w.total_tonnage, comparison: fun })}</p>` : ""}
        ${workoutMusicHtml(w)}
        <div class="feed-actions">
          ${social ? `<button class="props-btn ${iReacted ? "reacted" : ""}" data-props="${esc(w.id)}" aria-label="${t("Vote positif")}">
            <img class="props-horns" src="icons/horns.png" alt="🤘">
            <span>${propsCount > 0 ? propsCount : ""}</span>
          </button>` : ""}
          <button class="comment-btn" data-comments="${esc(w.id)}" aria-label="${t("Commentaires")}">💬 <span>${comments > 0 ? comments : t("Commenter")}</span></button>
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
      () => renderFeedWorkouts(body, root)
    );
  });
  wrap.querySelectorAll("[data-comments]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const w = workouts.find(x => x.id === btn.dataset.comments);
      openComments(w, (n) => { btn.querySelector("span").textContent = n > 0 ? n : t("Commenter"); });
    };
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
