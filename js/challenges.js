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

const METRICS = {
  tonnage: { label: "Tonnage", unit: "kg" },
  workouts: { label: "Séances", unit: "" },
  sets: { label: "Séries", unit: "" }
};
let metric = "tonnage";

const weekOf = (date) => isoWeek(date.toISOString());
const currentWeek = () => weekOf(new Date());
const lastWeek = () => weekOf(new Date(Date.now() - 7 * 24 * 3600 * 1000));

function totalsFor(workouts, week) {
  const ws = workouts.filter(w => w.start_time && isoWeek(w.start_time) === week);
  return {
    week,
    tonnage: ws.reduce((a, w) => a + (w.total_tonnage || 0), 0),
    sets: ws.reduce((a, w) => a + (w.total_sets || 0), 0),
    workouts: ws.length
  };
}

// Totaux publiés : semaine en cours + semaine précédente.
export async function computeMyWeeks() {
  const workouts = await getWorkouts();
  return { opt_in: true, weekly: totalsFor(workouts, currentWeek()), prev: totalsFor(workouts, lastWeek()) };
}

function statsFor(profile, week) {
  const c = profile?.challenge;
  if (!c?.opt_in) return null;
  for (const s of [c.weekly, c.prev]) if (s?.week === week) return s;
  return { week, tonnage: 0, sets: 0, workouts: 0 };
}

function avatar(p, size = 32) {
  const photo = safeImageUrl(p?.photo_data_url);
  return photo
    ? `<div class="profile-avatar" style="width:${size}px; height:${size}px; background-image:url('${photo}');"></div>`
    : `<div class="profile-avatar" style="width:${size}px; height:${size}px; font-size:${Math.round(size * 0.4)}px;">${esc((p?.display_name || "?")[0].toUpperCase())}</div>`;
}

function fmt(v, m) {
  return m === "tonnage" ? `${Math.round(v).toLocaleString("fr-FR")} kg` : String(v);
}

export async function renderChallenges(container) {
  container.innerHTML = `<div class="empty-state"><span class="num">···</span>Chargement</div>`;
  const myUid = db.getCurrentUser()?.uid;
  const [myProfile, friendships] = await Promise.all([db.getProfile(myUid).catch(() => null), db.listFriendships()]);
  const friendUids = friendships.filter(f => f.status === "accepted").map(f => f.other_uid);
  const participating = !!myProfile?.challenge?.opt_in;

  if (!participating) {
    container.innerHTML = `
      <div class="card">
        <div class="card-title">🏆 Défis entre amis</div>
        <p class="muted" style="margin-top:0;">Chaque semaine, un classement entre toi et tes amis : tonnage, nombre de séances ou de séries.
        Le vainqueur de la semaine choisit la <b>playlist de la semaine</b> pour tout le monde.</p>
        <p class="muted" style="font-size:13px;">En participant, seuls tes totaux de la semaine sont visibles par tes amis — tes séances restent privées.</p>
        <button class="btn btn-primary" id="ch-join">Participer aux défis</button>
      </div>`;
    container.querySelector("#ch-join").onclick = async (e) => {
      e.target.disabled = true;
      try {
        await db.updatePublicProfile({ challenge: await computeMyWeeks() });
        await renderChallenges(container);
      } catch (err) {
        console.error("[Skullcrusher] Inscription aux défis", err);
        toast("Inscription impossible, réessaie");
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
  const board = people.map(p => ({ p, s: statsFor(p, cw) })).sort((a, b) => b.s[metric] - a.s[metric]);
  const lastBoard = people.map(p => ({ p, s: statsFor(p, lw) })).filter(x => x.s.tonnage > 0).sort((a, b) => b.s.tonnage - a.s.tonnage);
  const winner = lastBoard[0]?.p || null;
  const iAmWinner = winner?.uid === myUid;
  const weekPlaylist = winner?.challenge?.playlist?.week === cw ? winner.challenge.playlist.url : "";

  container.innerHTML = `
    <div class="card">
      <div class="card-title">👑 Playlist de la semaine</div>
      ${winner ? `<p class="muted" style="margin-top:0;"><b class="profile-link" data-profile="${esc(winner.uid)}">${esc(winner.uid === myUid ? "Tu" : winner.display_name || "Un ami")}</b> ${winner.uid === myUid ? "as" : "a"} gagné la semaine dernière avec ${fmt(lastBoard[0].s.tonnage, "tonnage")}.</p>`
        : `<p class="muted" style="margin-top:0;">Pas encore de vainqueur : le premier du classement de cette semaine choisira la playlist de la semaine prochaine.</p>`}
      ${weekPlaylist ? spotifyEmbed(weekPlaylist, 152) : winner ? `<p class="muted">${iAmWinner ? "À toi de choisir la playlist de la semaine :" : "Le vainqueur n'a pas encore choisi de playlist."}</p>` : ""}
      ${iAmWinner ? `
        <div style="display:flex; gap:8px; margin-top:8px;">
          <input id="ch-playlist" placeholder="https://open.spotify.com/playlist/…" value="${esc(weekPlaylist || myProfile?.music?.playlist_url || "")}" inputmode="url">
          <button class="btn btn-primary btn-sm" id="ch-set-playlist" style="width:auto;">OK</button>
        </div>` : ""}
    </div>

    <div class="card">
      <div class="card-title">Classement de la semaine</div>
      <div class="chip-row" id="ch-metrics">
        ${Object.entries(METRICS).map(([k, m]) => `<div class="chip ${k === metric ? "active" : ""}" data-metric="${k}">${m.label}</div>`).join("")}
      </div>
      ${board.map((x, i) => `
        <div class="list-row" style="cursor:default; gap:10px;">
          <div style="display:flex; align-items:center; gap:10px; min-width:0; cursor:pointer;" data-profile="${esc(x.p.uid)}">
            <span class="num" style="width:22px; color:${i === 0 && x.s[metric] > 0 ? "var(--amber)" : "var(--text-dim)"};">${i + 1}</span>
            ${avatar(x.p)}
            <span class="list-row-title" style="overflow:hidden; text-overflow:ellipsis;">${esc(x.p.uid === myUid ? "Toi" : x.p.display_name || "Utilisateur")}${i === 0 && x.s[metric] > 0 ? " 🔥" : ""}</span>
          </div>
          <span class="list-row-meta" style="font-weight:700; color:var(--text);">${fmt(x.s[metric], metric)}</span>
        </div>`).join("")}
      ${people.length < 2 ? `<p class="muted" style="margin-bottom:0;">${friendUids.length ? "Aucun de tes amis ne participe encore : invite-les à rejoindre les défis !" : "Ajoute des amis (onglet 👥 Amis) pour vous défier."}</p>` : ""}
      <p class="muted" style="font-size:12px; margin-bottom:0;">Semaine ${esc(cw.split("-W")[1])} · les totaux des amis se mettent à jour après chacune de leurs séances.</p>
    </div>

    <button class="btn btn-secondary btn-sm" id="ch-leave">Ne plus participer</button>
  `;

  container.querySelectorAll("[data-metric]").forEach(c => c.onclick = () => { metric = c.dataset.metric; renderChallenges(container); });
  container.querySelectorAll("[data-profile]").forEach(el => el.onclick = () => openProfile(el.dataset.profile));
  const setBtn = container.querySelector("#ch-set-playlist");
  if (setBtn) setBtn.onclick = async () => {
    const url = normalizePlaylistUrl(container.querySelector("#ch-playlist").value);
    if (!url) { toast("Lien de playlist Spotify invalide"); return; }
    await db.updatePublicProfile({ challenge: { playlist: { week: cw, url } } });
    toast("Playlist de la semaine choisie 👑");
    renderChallenges(container);
  };
  container.querySelector("#ch-leave").onclick = async () => {
    if (!confirm("Ne plus participer aux défis ? Tes totaux ne seront plus visibles.")) return;
    await db.updatePublicProfile({ challenge: { opt_in: false, weekly: null, prev: null } });
    renderChallenges(container);
  };
}
