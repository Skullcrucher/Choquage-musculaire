// ============================================================
// PROFIL PUBLIC — mises en avant muscu + musique de salle
//
// Les séances et séries restent privées : ce que le profil montre est
// calculé sur l'appareil du propriétaire puis enregistré dans son
// document profiles/{uid} (lisible par les utilisateurs connectés).
// Rien n'est publié sans qu'il l'ait choisi : exercices phares cochés un
// par un, chiffres globaux derrière une case à cocher.
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, toast, esc, safeImageUrl, attachAutocomplete, estimate1RM } from "./utils.js";
import { getExercises, getWorkouts, getSetsForExercise } from "./cache.js";
import { parseMusicLink, musicEmbed, PROVIDERS, providerIcon, providerName, shortLinkHint, getMyProvider, setMyProvider, openOnMyService } from "./music.js";
import { t } from "./i18n.js";

const MAX_HIGHLIGHTS = 3;
const WEEK_MS = 7 * 24 * 3600 * 1000;

// ---------- Calculs (sur l'appareil du propriétaire) ----------
function monthKey(iso) {
  return String(iso || "").slice(0, 7);
}

function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

async function computeHighlight(exerciseName) {
  const allSets = (await getSetsForExercise(exerciseName))
    .filter(s => s.weight_kg != null && s.reps != null && s.weight_kg > 0 && s.reps > 0 && s.set_type !== "warmup");
  // La 1RM estimée (Epley) n'est fiable qu'à peu de répétitions : une série
  // à 40 kg × 123 (faute de frappe) donnerait 204 kg. On ne garde que les
  // séries de 15 reps ou moins, sauf s'il n'y en a aucune.
  const lowRep = allSets.filter(s => s.reps <= 15);
  const sets = lowRep.length ? lowRep : allSets;
  if (!sets.length) return { exercise: exerciseName, best_1rm: null, best_set: null, progress_pct: null, progress_months: null, monthly: [] };

  let best = sets[0];
  for (const s of sets) if (estimate1RM(s.weight_kg, s.reps) > estimate1RM(best.weight_kg, best.reps)) best = s;

  const months = lastMonths(12);
  const byMonth = {};
  sets.forEach(s => {
    const k = monthKey(s.workout_start_time);
    const v = estimate1RM(s.weight_kg, s.reps);
    if (months.includes(k) && (!byMonth[k] || v > byMonth[k])) byMonth[k] = v;
  });
  const monthly = months.map(m => ({ m, v: byMonth[m] ?? null }));

  // Progression : meilleure 1RM récente (8 dernières semaines) comparée au
  // plus ancien mois renseigné des 12 derniers mois.
  const recentSince = new Date(Date.now() - 8 * WEEK_MS).toISOString().slice(0, 10);
  const recent = sets.filter(s => (s.workout_start_time || "") >= recentSince);
  const firstMonth = monthly.find(x => x.v != null);
  let progress_pct = null, progress_months = null;
  if (recent.length && firstMonth) {
    const recentBest = Math.max(...recent.map(s => estimate1RM(s.weight_kg, s.reps)));
    const monthsAgo = months.length - 1 - months.indexOf(firstMonth.m);
    if (monthsAgo >= 2 && firstMonth.v > 0) {
      progress_pct = Math.round(((recentBest - firstMonth.v) / firstMonth.v) * 100);
      progress_months = monthsAgo;
    }
  }

  return {
    exercise: exerciseName,
    best_1rm: estimate1RM(best.weight_kg, best.reps),
    best_set: { kg: best.weight_kg, reps: best.reps, date: String(best.workout_start_time || "").slice(0, 10) },
    progress_pct,
    progress_months,
    monthly
  };
}

async function computePublicStats() {
  const workouts = await getWorkouts();
  const since = new Date(Date.now() - 12 * WEEK_MS).toISOString().slice(0, 10);
  const recent = workouts.filter(w => (w.start_time || "") >= since).length;
  return {
    workouts: workouts.length,
    tonnes: Math.round(workouts.reduce((a, w) => a + (w.total_tonnage || 0), 0) / 1000),
    per_week: Math.round((recent / 12) * 10) / 10
  };
}

// Recalcule les mises en avant (après une séance, à l'enregistrement du profil).
export async function refreshMyProfileHighlights(profile = null) {
  const uid = db.getCurrentUser()?.uid;
  if (!uid) return;
  const p = profile || await db.getProfile(uid);
  const names = (p?.highlights || []).map(h => h.exercise).filter(Boolean);
  const patch = {};
  if (names.length) patch.highlights = await Promise.all(names.map(computeHighlight));
  if (p?.show_stats) patch.public_stats = await computePublicStats();
  if (p?.challenge?.opt_in) {
    const { computeMyWeeks } = await import("./challenges.js");
    patch.challenge = await computeMyWeeks();
  }
  if (Object.keys(patch).length) await db.updatePublicProfile(patch);
}

// ---------- Affichage ----------
function avatarHtml(profile, size) {
  const photo = safeImageUrl(profile?.photo_data_url);
  const name = profile?.display_name || "?";
  return photo
    ? `<div class="profile-avatar" style="width:${size}px; height:${size}px; background-image:url('${photo}');"></div>`
    : `<div class="profile-avatar" style="width:${size}px; height:${size}px; font-size:${Math.round(size * 0.4)}px;">${esc(name[0].toUpperCase())}</div>`;
}

function sparkline(monthly) {
  const vals = monthly.map(x => x.v);
  const present = vals.filter(v => v != null);
  if (present.length < 2) return "";
  const max = Math.max(...present), min = Math.min(...present);
  const span = Math.max(1, max - min);
  const w = 12, gap = 4, h = 36;
  const bars = vals.map((v, i) => {
    if (v == null) return `<rect x="${i * (w + gap)}" y="${h - 2}" width="${w}" height="2" rx="1" fill="var(--border)"/>`;
    const bh = 6 + Math.round(((v - min) / span) * (h - 6));
    return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="2" fill="var(--amber)"/>`;
  }).join("");
  const width = vals.length * (w + gap) - gap;
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-label="Meilleure 1RM par mois, 12 derniers mois">${bars}</svg>`;
}

function highlightCard(h) {
  const progress = h.progress_pct == null ? "" :
    `<span class="profile-progress ${h.progress_pct >= 0 ? "up" : "down"}">${h.progress_pct >= 0 ? "▲ +" : "▼ "}${t("{pct} % en {n} mois", { pct: h.progress_pct, n: h.progress_months })}</span>`;
  return `
    <div class="profile-highlight">
      <div class="list-row-title" style="margin-bottom:6px;">${esc(h.exercise)}</div>
      ${h.best_1rm == null ? `<p class="muted" style="margin:0;">${t("Pas encore de série enregistrée.")}</p>` : `
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <span class="num" style="font-size:30px; color:var(--amber);">${esc(h.best_1rm)} kg</span>
          <span class="muted" style="font-size:12px;">${t("1RM estimée")}</span>
        </div>
        <div class="muted" style="font-size:13px; margin:2px 0 8px;">${t("Meilleure série : {kg} kg × {reps}", { kg: esc(h.best_set.kg), reps: esc(h.best_set.reps) })}${progress ? " · " + progress : ""}</div>
        ${sparkline(h.monthly || [])}
      `}
    </div>`;
}

export async function openProfile(uid) {
  const myUid = db.getCurrentUser()?.uid;
  let profile;
  try {
    profile = await db.getProfile(uid);
  } catch (err) {
    console.error("[Skullcrusher] Profil introuvable", err);
    toast(t("Impossible d'ouvrir ce profil"));
    return;
  }
  profile = profile || {};
  const isMe = uid === myUid;
  const chips = [
    profile.level && db.ROUTINE_LEVELS[profile.level],
    profile.goal && db.ROUTINE_GOALS[profile.goal],
    profile.gym && `📍 ${profile.gym}`,
    profile.since_year && t("Muscu depuis {year}", { year: profile.since_year })
  ].filter(Boolean);
  const st = profile.show_stats ? profile.public_stats : null;
  const music = profile.music || {};
  const playlist = parseMusicLink(music.playlist_url);
  const artist = parseMusicLink(music.artist_url);
  const spotifyProfile = parseMusicLink(music.spotify_profile_url);
  const service = PROVIDERS[music.provider] ? music.provider : "";
  const mine = await getMyProvider();
  const highlights = (profile.highlights || []).filter(h => h?.exercise);
  const hasMusic = playlist || music.artist_name || artist || spotifyProfile || service;

  openModal(`
    <div style="display:flex; align-items:center; gap:14px;">
      ${avatarHtml(profile, 64)}
      <div style="min-width:0;">
        <h3 style="margin:0;">${esc(profile.display_name || t("Utilisateur"))}${isMe ? ` <span class="muted" style="font-size:14px; font-family:Inter,sans-serif; text-transform:none;">(${t("toi")})</span>` : ""}</h3>
        ${profile.bio ? `<p class="muted" style="margin:4px 0 0;">${esc(profile.bio)}</p>` : ""}
      </div>
    </div>
    ${chips.length ? `<div class="chip-row" style="margin-top:12px;">${chips.map(c => `<span class="routine-badge">${esc(c)}</span>`).join("")}</div>` : ""}

    ${st ? `<div class="stat-grid" style="margin-top:14px;">
      <div class="stat-box"><span class="num">${esc(st.workouts)}</span><span class="lbl">${t("séances")}</span></div>
      <div class="stat-box"><span class="num">${esc(st.tonnes)}</span><span class="lbl">${t("tonnes")}</span></div>
      <div class="stat-box"><span class="num">${esc(st.per_week)}</span><span class="lbl">${t("séances / sem.")}</span></div>
    </div>` : ""}

    ${highlights.length ? `<div class="profile-section-title">🏆 ${t("Exercices phares")}</div>${highlights.map(highlightCard).join("")}` : ""}

    ${hasMusic ? `<div class="profile-section-title">🎧 ${t("Musique de salle")}</div>
      ${service ? `<p class="muted spotify-attrib" style="margin:0 0 8px;">${providerIcon(service)} ${t("Écoute sur {service}", { service: providerName(service) })}</p>` : ""}
      ${music.artist_name || artist ? `<div class="list-row" style="cursor:default;">
        <div><div class="list-row-sub">${t("Artiste pour se chauffer")}</div><div class="list-row-title">${esc(music.artist_name || t("Voir l'artiste"))}</div></div>
        <span style="display:flex; gap:6px;">
          ${artist ? `<a class="btn btn-sm btn-secondary" style="width:auto;" href="${artist.url}" target="_blank" rel="noopener">${providerIcon(artist)} ${t("Écouter")}</a>` : ""}
          ${mine && (!artist || artist.provider !== mine) && (music.artist_name || artist) ? `<button class="btn btn-sm btn-secondary" style="width:auto;" id="pf-artist-mine" title="${t("Chercher sur {service}", { service: providerName(mine) })}">${providerIcon(mine)} 🔎</button>` : ""}
        </span>
      </div>` : ""}
      ${playlist ? musicEmbed(playlist) : ""}
      ${spotifyProfile ? `<a class="btn btn-secondary btn-sm" style="margin-top:10px;" href="${spotifyProfile.url}" target="_blank" rel="noopener">${providerIcon(spotifyProfile)} ${t("Profil {service}", { service: providerName(spotifyProfile) })}</a>` : ""}` : ""}

    ${!highlights.length && !hasMusic && !st && !profile.bio && !chips.length
      ? `<p class="muted" style="margin-top:14px;">${isMe ? t("Ton profil est encore vide : ajoute tes exercices phares et ta musique de salle.") : t("Ce profil n'a encore rien mis en avant.")}</p>` : ""}

    <div class="btn-row" style="margin-top:16px;">
      <button class="btn btn-secondary" id="pf-close">${t("Fermer")}</button>
      ${isMe ? `<button class="btn btn-primary" id="pf-edit">${t("Modifier")}</button>` : ""}
    </div>
  `, (modalEl) => {
    modalEl.querySelector("#pf-close").onclick = closeModal;
    const artistMine = modalEl.querySelector("#pf-artist-mine");
    if (artistMine) artistMine.onclick = () => openOnMyService(mine, artist && !music.artist_name ? { link: artist } : { text: music.artist_name, kind: "artist" });
    const edit = modalEl.querySelector("#pf-edit");
    if (edit) edit.onclick = () => { closeModal(); openProfileEditor(() => openProfile(uid)); };
  });
}

// ---------- Édition ----------
export async function openProfileEditor(onSaved = () => {}) {
  const uid = db.getCurrentUser()?.uid;
  const [profile, exercises] = await Promise.all([db.getProfile(uid).catch(() => null), getExercises()]);
  const p = profile || {};
  const music = p.music || {};
  const names = exercises.map(e => e.name);
  const hl = (p.highlights || []).map(h => h.exercise);
  const opt = (map, cur) => `<option value="">—</option>` + Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  const year = new Date().getFullYear();

  openModal(`
    <h3>${t("Mon profil public")}</h3>
    <p class="muted" style="margin-top:-6px;">${t("Visible par les utilisateurs de l'app. Tes séances restent privées.")}</p>

    <label>${t("Bio")}</label>
    <textarea id="pf-bio" rows="2" maxlength="160" placeholder="${t("ex : Powerlifter du dimanche, fan de squat")}">${esc(p.bio || "")}</textarea>
    <div class="field-row">
      <div><label>${t("Niveau")}</label><select id="pf-level">${opt(db.ROUTINE_LEVELS, p.level)}</select></div>
      <div><label>${t("Objectif")}</label><select id="pf-goal">${opt(db.ROUTINE_GOALS, p.goal)}</select></div>
    </div>
    <div class="field-row">
      <div><label>${t("Salle")}</label><input id="pf-gym" maxlength="60" value="${esc(p.gym || "")}" placeholder="${t("ex : Basic-Fit Lyon 7")}"></div>
      <div><label>${t("Muscu depuis")}</label><input id="pf-since" type="number" min="1950" max="${year}" value="${esc(p.since_year || "")}" placeholder="${year - 3}"></div>
    </div>
    <label class="list-row" style="cursor:pointer; margin-top:10px;">
      <span>${t("Afficher mes chiffres (séances, tonnes, rythme)")}</span>
      <input type="checkbox" id="pf-stats" ${p.show_stats ? "checked" : ""} style="width:auto;">
    </label>

    <div class="profile-section-title">🏆 ${t("Exercices phares ({n} max)", { n: MAX_HIGHLIGHTS })}</div>
    <p class="muted" style="margin-top:0; font-size:13px;">${t("Pour chacun : ta meilleure 1RM estimée, ta meilleure série et ta progression sur 12 mois, mises à jour après chaque séance.")}</p>
    ${Array.from({ length: MAX_HIGHLIGHTS }, (_, i) => `<div style="position:relative; margin-bottom:8px;"><input class="pf-hl" data-i="${i}" value="${esc(hl[i] || "")}" placeholder="${t("Exercice {n}", { n: i + 1 })}"></div>`).join("")}

    <div class="profile-section-title">🎧 ${t("Musique de salle")}</div>
    <label style="margin-top:0;">${t("Mon service de musique")}</label>
    <select id="pf-provider">
      <option value="">—</option>
      ${Object.entries(PROVIDERS).map(([k, pr]) => `<option value="${k}" ${music.provider === k ? "selected" : ""}>${esc(pr.name)}</option>`).join("")}
    </select>
    <p class="muted" style="margin:4px 0 0; font-size:13px;">${t("L'app s'adapte : les sons partagés par les autres peuvent être retrouvés sur ton service. Colle des liens Spotify, Apple Music ou Deezer (Partager → Copier le lien).")}</p>
    <label>${t("Playlist de salle")}</label>
    <input id="pf-playlist" value="${esc(music.playlist_url || "")}" placeholder="${t("Lien de playlist (Spotify, Apple Music, Deezer)")}" inputmode="url">
    <label>${t("Artiste pour se chauffer")}</label>
    <input id="pf-artist-name" maxlength="60" value="${esc(music.artist_name || "")}" placeholder="${t("ex : Metallica")}">
    <input id="pf-artist-url" value="${esc(music.artist_url || "")}" placeholder="${t("Lien de l'artiste (facultatif)")}" inputmode="url" style="margin-top:6px;">
    <label>${t("Ton profil musical (facultatif)")}</label>
    <input id="pf-spotify" value="${esc(music.spotify_profile_url || "")}" placeholder="${t("Lien de ton profil Spotify, Apple Music ou Deezer")}" inputmode="url">
    <p id="pf-error" style="color:var(--red); min-height:1em;"></p>

    <div class="btn-row">
      <button class="btn btn-secondary" id="pf-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="pf-save">${t("Enregistrer")}</button>
    </div>
  `, (modalEl) => {
    modalEl.querySelectorAll(".pf-hl").forEach(inp => attachAutocomplete(inp, names, () => {}));
    modalEl.querySelector("#pf-cancel").onclick = closeModal;
    modalEl.querySelector("#pf-save").onclick = async () => {
      const val = (id) => modalEl.querySelector(id).value.trim();
      const err = modalEl.querySelector("#pf-error");
      const links = { playlist_url: val("#pf-playlist"), artist_url: val("#pf-artist-url"), spotify_profile_url: val("#pf-spotify") };
      const expected = { playlist_url: ["playlist", "album"], artist_url: ["artist"], spotify_profile_url: ["user"] };
      for (const [k, v] of Object.entries(links)) {
        if (!v) continue;
        const parsed = parseMusicLink(v);
        if (!parsed || !expected[k].includes(parsed.type)) {
          err.textContent = k === "playlist_url" ? t("Lien de playlist invalide : colle un lien Spotify, Apple Music ou Deezer.")
            : k === "artist_url" ? t("Lien d'artiste invalide : colle un lien d'artiste Spotify, Apple Music ou Deezer.")
            : t("Lien de profil invalide : colle le lien de ton profil Spotify, Apple Music ou Deezer.");
          const hint = shortLinkHint(v);
          if (hint) err.textContent += " " + hint;
          return;
        }
        links[k] = parsed.url;
      }
      const texts = [val("#pf-bio"), val("#pf-gym"), val("#pf-artist-name")];
      if (texts.some(x => /[<>]/.test(x))) { err.textContent = t("Les caractères < et > ne sont pas autorisés."); return; }
      const since = parseInt(val("#pf-since"), 10);
      const highlightNames = [...new Set([...modalEl.querySelectorAll(".pf-hl")].map(i => i.value.trim()).filter(Boolean))].slice(0, MAX_HIGHLIGHTS);

      const btn = modalEl.querySelector("#pf-save");
      btn.disabled = true;
      btn.textContent = t("Calcul des stats…");
      err.textContent = "";
      try {
        const showStats = modalEl.querySelector("#pf-stats").checked;
        const [highlights, publicStats] = await Promise.all([
          Promise.all(highlightNames.map(computeHighlight)),
          showStats ? computePublicStats() : Promise.resolve(null)
        ]);
        await db.updatePublicProfile({
          bio: val("#pf-bio"),
          level: val("#pf-level"),
          goal: val("#pf-goal"),
          gym: val("#pf-gym"),
          since_year: since >= 1950 && since <= year ? since : null,
          show_stats: showStats,
          public_stats: publicStats,
          highlights,
          music: { ...links, artist_name: val("#pf-artist-name"), provider: val("#pf-provider") },
          has_music: !!(links.playlist_url || links.artist_url || links.spotify_profile_url || val("#pf-artist-name"))
        });
        setMyProvider(val("#pf-provider"));
        closeModal();
        toast(t("Profil mis à jour"));
        onSaved();
      } catch (e) {
        console.error("[Skullcrusher] Enregistrement du profil public", e);
        err.textContent = t("Enregistrement impossible, réessaie.");
        btn.disabled = false;
        btn.textContent = t("Enregistrer");
      }
    };
  });
}
