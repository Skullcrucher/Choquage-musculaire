// ============================================================
// DÉFIS ENTRE AMIS — classement de la semaine, et le gagnant de la
// semaine passée choisit la playlist de la semaine.
//
// Les séances restent privées : chaque participant publie seulement ses
// totaux de la semaine en cours et de la précédente dans son profil
// (profiles/{uid}.challenge), et uniquement s'il a choisi de participer.
// ============================================================
import * as db from "./db.js";
import { toast, esc, isoWeek, safeImageUrl } from "./utils.js";
import { getWorkouts } from "./cache.js";
import { normalizePlaylistUrl, spotifyEmbed } from "./music.js";
import { openProfile } from "./profile.js";
import { t, locale } from "./i18n.js";

const METRICS = {
  // i18n-keys: "Score", "Tonnage", "Séances", "Séries"
  score: { label: "Score", unit: "pts" },
  workouts: { label: "Séances", unit: "" },
  sets: { label: "Séries", unit: "" },
  tonnage: { label: "Tonnage", unit: "kg" }
};
// Le score (équilibré) est la mesure par défaut et désigne le vainqueur.
let metric = "score";

const DAY = 24 * 3600 * 1000;
const weekOf = (date) => isoWeek(date.toISOString());
const currentWeek = () => weekOf(new Date());
const lastWeek = () => weekOf(new Date(Date.now() - 7 * DAY));

// ---- Score équilibré ----
// Le tonnage brut avantage toujours les plus forts : un débutant n'avait
// aucune chance. Le score ne dépend que de ce que chacun maîtrise :
//  - la régularité : 20 pts par séance (au moins 3 séries), 4 séances max ;
//  - la progression par rapport à SA propre moyenne des 4 semaines
//    précédentes : +1 pt par tranche de 5 % de tonnage en plus, 20 pts max.
// Total sur 100, atteignable quel que soit le niveau.
const PTS_PER_WORKOUT = 20, MAX_WORKOUTS = 4, MAX_PROGRESS_PTS = 20, MIN_SETS = 3;

function computeScore(t) {
  const regularity = Math.min(t.valid_workouts ?? t.workouts ?? 0, MAX_WORKOUTS) * PTS_PER_WORKOUT;
  let progress = 0;
  if (t.baseline > 0 && t.tonnage > 0) {
    const pct = (t.tonnage - t.baseline) / t.baseline * 100;
    progress = Math.max(0, Math.min(MAX_PROGRESS_PTS, Math.floor(pct / 5)));
  }
  return regularity + progress;
}

function totalsFor(workouts, refDate) {
  const week = weekOf(refDate);
  const inWeek = (w, wk) => w.start_time && isoWeek(w.start_time) === wk;
  const ws = workouts.filter(w => inWeek(w, week));
  // Moyenne de tonnage des 4 semaines précédentes où il y a eu entraînement.
  const past = [1, 2, 3, 4]
    .map(k => weekOf(new Date(refDate.getTime() - k * 7 * DAY)))
    .map(wk => workouts.filter(w => inWeek(w, wk)).reduce((a, w) => a + (w.total_tonnage || 0), 0))
    .filter(v => v > 0);
  const totals = {
    week,
    tonnage: ws.reduce((a, w) => a + (w.total_tonnage || 0), 0),
    sets: ws.reduce((a, w) => a + (w.total_sets || 0), 0),
    workouts: ws.length,
    valid_workouts: ws.filter(w => (w.total_sets ?? MIN_SETS) >= MIN_SETS).length,
    baseline: past.length ? Math.round(past.reduce((a, v) => a + v, 0) / past.length) : 0
  };
  totals.score = computeScore(totals);
  return totals;
}

// Totaux publiés : semaine en cours + semaine précédente.
export async function computeMyWeeks() {
  const workouts = await getWorkouts();
  return { opt_in: true, weekly: totalsFor(workouts, new Date()), prev: totalsFor(workouts, new Date(Date.now() - 7 * DAY)) };
}

function statsFor(profile, week) {
  const c = profile?.challenge;
  if (!c?.opt_in) return null;
  for (const s of [c.weekly, c.prev]) {
    // Totaux publiés par une ancienne version de l'app : score recalculé.
    if (s?.week === week) return { ...s, score: s.score ?? computeScore(s) };
  }
  return { week, tonnage: 0, sets: 0, workouts: 0, score: 0 };
}

// Tri : mesure choisie, puis nombre de séances pour départager.
const byMetric = (m) => (a, b) => (b.s[m] - a.s[m]) || (b.s.workouts - a.s.workouts);

// Progression affichée à côté du score (ex. « +12 % »).
function progressLabel(s) {
  if (!(s.baseline > 0) || !s.tonnage) return "";
  const pct = Math.round((s.tonnage - s.baseline) / s.baseline * 100);
  return `${pct >= 0 ? "+" : ""}${pct} %`;
}

function avatar(p, size = 32) {
  const photo = safeImageUrl(p?.photo_data_url);
  return photo
    ? `<div class="profile-avatar" style="width:${size}px; height:${size}px; background-image:url('${photo}');"></div>`
    : `<div class="profile-avatar" style="width:${size}px; height:${size}px; font-size:${Math.round(size * 0.4)}px;">${esc((p?.display_name || "?")[0].toUpperCase())}</div>`;
}

function fmt(v, m) {
  if (m === "tonnage") return `${Math.round(v).toLocaleString(locale())} kg`;
  if (m === "score") return `${v} pts`;
  return String(v);
}

export async function renderChallenges(container) {
  container.innerHTML = `<div class="empty-state"><span class="num">···</span>${t("Chargement")}</div>`;
  const myUid = db.getCurrentUser()?.uid;
  const [myProfile, friendships] = await Promise.all([db.getProfile(myUid).catch(() => null), db.listFriendships()]);
  const friendUids = friendships.filter(f => f.status === "accepted").map(f => f.other_uid);
  const participating = !!myProfile?.challenge?.opt_in;

  if (!participating) {
    container.innerHTML = `
      <div class="card">
        <div class="card-title">🏆 ${t("Défis entre amis")}</div>
        <p class="muted" style="margin-top:0;">${t("Chaque semaine, un classement entre toi et tes amis. Le score récompense la régularité et ta progression par rapport à toi-même : débutant ou confirmé, tout le monde peut gagner. Le vainqueur de la semaine choisit la <b>playlist de la semaine</b> pour tout le monde.")}</p>
        <p class="muted" style="font-size:13px;">${t("En participant, seuls tes totaux de la semaine sont visibles par tes amis — tes séances restent privées.")}</p>
        <button class="btn btn-primary" id="ch-join">${t("Participer aux défis")}</button>
      </div>`;
    container.querySelector("#ch-join").onclick = async (e) => {
      e.target.disabled = true;
      try {
        await db.updatePublicProfile({ challenge: await computeMyWeeks() });
        await renderChallenges(container);
      } catch (err) {
        console.error("[Skullcrusher] Inscription aux défis", err);
        toast(t("Inscription impossible, réessaie"));
        e.target.disabled = false;
      }
    };
    return;
  }

  // Mes totaux, recalculés à l'ouverture pour être à jour.
  const mine = await computeMyWeeks();
  db.updatePublicProfile({ challenge: mine }).catch(() => null);
  const profiles = await db.getProfiles(friendUids);
  const me = { ...(myProfile || {}), uid: myUid, challenge: { ...(myProfile?.challenge || {}), ...mine } };
  const people = [me, ...friendUids.map(uid => ({ uid, ...(profiles[uid] || {}) }))].filter(p => p.challenge?.opt_in);

  const cw = currentWeek(), lw = lastWeek();
  const board = people.map(p => ({ p, s: statsFor(p, cw) })).sort(byMetric(metric));
  const lastBoard = people.map(p => ({ p, s: statsFor(p, lw) })).filter(x => x.s.score > 0).sort(byMetric("score"));
  const winner = lastBoard[0]?.p || null;
  const iAmWinner = winner?.uid === myUid;
  const weekPlaylist = winner?.challenge?.playlist?.week === cw ? winner.challenge.playlist.url : "";

  container.innerHTML = `
    <div class="card">
      <div class="card-title">👑 ${t("Playlist de la semaine")}</div>
      ${winner ? `<p class="muted" style="margin-top:0;">${winner.uid === myUid
          ? t("<b>Tu</b> as gagné la semaine dernière avec {total}.", { total: fmt(lastBoard[0].s.score, "score") })
          : t("{name} a gagné la semaine dernière avec {total}.", { name: `<b class="profile-link" data-profile="${esc(winner.uid)}">${esc(winner.display_name || t("Un ami"))}</b>`, total: fmt(lastBoard[0].s.score, "score") })}</p>`
        : `<p class="muted" style="margin-top:0;">${t("Pas encore de vainqueur : le premier du classement de cette semaine choisira la playlist de la semaine prochaine.")}</p>`}
      ${weekPlaylist ? spotifyEmbed(weekPlaylist, 152) : winner ? `<p class="muted">${iAmWinner ? t("À toi de choisir la playlist de la semaine :") : t("Le vainqueur n'a pas encore choisi de playlist.")}</p>` : ""}
      ${iAmWinner ? `
        <div style="display:flex; gap:8px; margin-top:8px;">
          <input id="ch-playlist" placeholder="${t("Lien de playlist (Spotify, Apple Music, Deezer)")}" value="${esc(weekPlaylist || myProfile?.music?.playlist_url || "")}" inputmode="url">
          <button class="btn btn-primary btn-sm" id="ch-set-playlist" style="width:auto;">OK</button>
        </div>` : ""}
    </div>

    <div class="card">
      <div class="card-title">${t("Classement de la semaine")}</div>
      <div class="chip-row" id="ch-metrics">
        ${Object.entries(METRICS).map(([k, m]) => `<div class="chip ${k === metric ? "active" : ""}" data-metric="${k}">${t(m.label)}</div>`).join("")}
      </div>
      ${metric === "score" ? `<p class="muted" style="font-size:12px; margin:0 0 8px;">${t("20 pts par séance (4 max) + jusqu'à 20 pts si tu dépasses ta moyenne de tonnage des 4 dernières semaines (+1 pt par 5 %). Le score désigne le vainqueur.")}</p>` : ""}
      ${board.map((x, i) => `
        <div class="list-row" style="cursor:default; gap:10px;">
          <div style="display:flex; align-items:center; gap:10px; min-width:0; cursor:pointer;" data-profile="${esc(x.p.uid)}">
            <span class="num" style="width:22px; color:${i === 0 && x.s[metric] > 0 ? "var(--amber)" : "var(--text-dim)"};">${i + 1}</span>
            ${avatar(x.p)}
            <span class="list-row-title" style="overflow:hidden; text-overflow:ellipsis;">${esc(x.p.uid === myUid ? t("Toi") : x.p.display_name || t("Utilisateur"))}${i === 0 && x.s[metric] > 0 ? " 🔥" : ""}</span>
          </div>
          <span class="list-row-meta" style="font-weight:700; color:var(--text); white-space:nowrap;">${metric === "score" && progressLabel(x.s) ? `<span class="muted" style="font-size:11px; font-weight:600;">${esc(progressLabel(x.s))}</span> ` : ""}${fmt(x.s[metric], metric)}</span>
        </div>`).join("")}
      ${people.length < 2 ? `<p class="muted" style="margin-bottom:0;">${friendUids.length ? t("Aucun de tes amis ne participe encore : invite-les à rejoindre les défis !") : t("Ajoute des amis (onglet 👥 Amis) pour vous défier.")}</p>` : ""}
      <p class="muted" style="font-size:12px; margin-bottom:0;">${t("Semaine {n} · les totaux des amis se mettent à jour après chacune de leurs séances.", { n: esc(cw.split("-W")[1]) })}</p>
    </div>

    <button class="btn btn-secondary btn-sm" id="ch-leave">${t("Ne plus participer")}</button>
  `;

  container.querySelectorAll("[data-metric]").forEach(c => c.onclick = () => { metric = c.dataset.metric; renderChallenges(container); });
  container.querySelectorAll("[data-profile]").forEach(el => el.onclick = () => openProfile(el.dataset.profile));
  const setBtn = container.querySelector("#ch-set-playlist");
  if (setBtn) setBtn.onclick = async () => {
    const url = normalizePlaylistUrl(container.querySelector("#ch-playlist").value);
    if (!url) { toast(t("Lien de playlist invalide : colle un lien Spotify, Apple Music ou Deezer.")); return; }
    await db.updatePublicProfile({ challenge: { playlist: { week: cw, url } } });
    toast(t("Playlist de la semaine choisie") + " 👑");
    renderChallenges(container);
  };
  container.querySelector("#ch-leave").onclick = async () => {
    if (!confirm(t("Ne plus participer aux défis ? Tes totaux ne seront plus visibles."))) return;
    await db.updatePublicProfile({ challenge: { opt_in: false, weekly: null, prev: null } });
    renderChallenges(container);
  };
}
