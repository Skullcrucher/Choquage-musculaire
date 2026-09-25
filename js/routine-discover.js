// ============================================================
// DÉCOUVRIR — routines publiques et partagées par des amis :
// recherche, filtres, votes 👍 et ajout à sa bibliothèque
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, attachAutocomplete, esc, debounce } from "./utils.js";
import { getExercises, getRoutines, invalidate } from "./cache.js";
import { spotifyEmbed } from "./music.js";

const SIZES = {
  short: { label: "Courte (≤ 4 exos)", test: n => n <= 4 },
  medium: { label: "Moyenne (5-7)", test: n => n >= 5 && n <= 7 },
  long: { label: "Longue (8+)", test: n => n >= 8 }
};
const SORTS = {
  popular: "Les plus populaires",
  recent: "Les plus récentes",
  fewest: "Moins d'exercices",
  most: "Plus d'exercices"
};
const SOURCES = { all: "Tout", friends: "👥 Amis", community: "🌍 Communauté" };

// Filtres conservés entre deux ouvertures de l'onglet.
const filters = { text: "", source: "all", muscles: [], exercise: "", level: "", goal: "", size: "", sort: "popular" };
let filtersOpen = false;

function resetFilters() {
  Object.assign(filters, { text: "", source: "all", muscles: [], exercise: "", level: "", goal: "", size: "", sort: "popular" });
}

function activeFilterCount() {
  return (filters.source !== "all") + filters.muscles.length + !!filters.exercise + !!filters.level + !!filters.goal + !!filters.size;
}

export async function renderDiscover(content, onLibraryChanged) {
  content.innerHTML = `<div class="empty-state"><span class="num">···</span>Chargement</div>`;
  const myUid = db.getCurrentUser()?.uid;
  const [all, friendships, myVotes, myRoutines, exercises] = await Promise.all([
    db.listDiscoverRoutines(),
    db.listFriendships(),
    db.getMyVotes().catch(() => ({})),
    getRoutines(),
    getExercises()
  ]);
  if (!content.isConnected) return;
  const friendUids = new Set(friendships.filter(f => f.status === "accepted").map(f => f.other_uid));
  const copiedIds = new Set(myRoutines.map(r => r.source?.routine_id).filter(Boolean));
  // Une routine "amis" d'un ancien ami reste dans shared_with jusqu'à ce que
  // son propriétaire la modifie : on ne l'affiche plus.
  const routines = all.filter(r => r.owner_uid === myUid || r.visibility === "public" || friendUids.has(r.owner_uid));

  const ctx = { routines, myUid, friendUids, myVotes, copiedIds, onLibraryChanged };

  content.innerHTML = `
    <div style="position:relative;">
      <input id="d-text" type="search" placeholder="Rechercher une routine, un exercice, un auteur…" value="${esc(filters.text)}">
    </div>
    <div style="display:flex; gap:8px; margin:10px 0;">
      <select id="d-sort" style="flex:1;">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === filters.sort ? "selected" : ""}>${v}</option>`).join("")}</select>
      <button class="btn btn-secondary btn-sm" id="d-toggle-filters" style="width:auto; white-space:nowrap;">Filtres<span id="d-filter-count"></span></button>
    </div>
    <div id="d-filters" style="display:${filtersOpen ? "block" : "none"};" class="card">
      <label style="margin-top:0;">Source</label>
      <div class="chip-row" id="d-source">${Object.entries(SOURCES).map(([k, v]) => `<div class="chip ${filters.source === k ? "active" : ""}" data-source="${k}">${v}</div>`).join("")}</div>
      <label>Muscles travaillés</label>
      <div class="chip-row" id="d-muscles">${db.EXO_GROUPS.map(g => `<div class="chip ${filters.muscles.includes(g) ? "active" : ""}" data-muscle="${esc(g)}">${esc(g)}</div>`).join("")}</div>
      <label>Contient l'exercice</label>
      <div style="position:relative;"><input id="d-exercise" placeholder="ex: Squat" value="${esc(filters.exercise)}"></div>
      <div class="field-row">
        <div><label>Niveau</label><select id="d-level"><option value="">Tous</option>${Object.entries(db.ROUTINE_LEVELS).map(([k, v]) => `<option value="${k}" ${k === filters.level ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div><label>Objectif</label><select id="d-goal"><option value="">Tous</option>${Object.entries(db.ROUTINE_GOALS).map(([k, v]) => `<option value="${k}" ${k === filters.goal ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      </div>
      <label>Durée</label>
      <div class="chip-row" id="d-size">${Object.entries(SIZES).map(([k, v]) => `<div class="chip ${filters.size === k ? "active" : ""}" data-size="${k}">${v.label}</div>`).join("")}</div>
      <button class="btn btn-secondary btn-sm" id="d-reset" style="margin-top:8px;">Réinitialiser les filtres</button>
    </div>
    <p class="muted" id="d-count" style="font-size:13px; margin:6px 0 10px;"></p>
    <div id="d-results"></div>
  `;

  const draw = () => drawResults(content, ctx);
  const q = (sel) => content.querySelector(sel);
  q("#d-text").addEventListener("input", debounce(() => { filters.text = q("#d-text").value; draw(); }, 200));
  q("#d-sort").onchange = () => { filters.sort = q("#d-sort").value; draw(); };
  q("#d-toggle-filters").onclick = () => {
    filtersOpen = !filtersOpen;
    q("#d-filters").style.display = filtersOpen ? "block" : "none";
  };
  content.querySelectorAll("[data-source]").forEach(c => c.onclick = () => {
    filters.source = c.dataset.source;
    content.querySelectorAll("[data-source]").forEach(x => x.classList.toggle("active", x === c));
    draw();
  });
  content.querySelectorAll("[data-muscle]").forEach(c => c.onclick = () => {
    const m = c.dataset.muscle;
    filters.muscles = filters.muscles.includes(m) ? filters.muscles.filter(x => x !== m) : [...filters.muscles, m];
    c.classList.toggle("active", filters.muscles.includes(m));
    draw();
  });
  content.querySelectorAll("[data-size]").forEach(c => c.onclick = () => {
    filters.size = filters.size === c.dataset.size ? "" : c.dataset.size;
    content.querySelectorAll("[data-size]").forEach(x => x.classList.toggle("active", x.dataset.size === filters.size));
    draw();
  });
  const exInput = q("#d-exercise");
  const exerciseNames = [...new Set([...exercises.map(e => e.name), ...routines.flatMap(r => (r.exercises || []).map(e => e.exercise_name))])].filter(Boolean);
  attachAutocomplete(exInput, exerciseNames, (picked) => { filters.exercise = picked; draw(); });
  exInput.addEventListener("input", debounce(() => { filters.exercise = exInput.value; draw(); }, 200));
  q("#d-level").onchange = () => { filters.level = q("#d-level").value; draw(); };
  q("#d-goal").onchange = () => { filters.goal = q("#d-goal").value; draw(); };
  q("#d-reset").onclick = () => { resetFilters(); renderDiscover(content, onLibraryChanged); };

  draw();
}

function normalize(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function applyFilters(ctx) {
  const text = normalize(filters.text.trim());
  const exo = normalize(filters.exercise.trim());
  let list = ctx.routines.filter(r => {
    if (filters.source === "friends" && !ctx.friendUids.has(r.owner_uid)) return false;
    if (filters.source === "community" && (ctx.friendUids.has(r.owner_uid) || r.visibility !== "public")) return false;
    const muscles = r.muscle_groups || [];
    if (filters.muscles.length && !filters.muscles.every(m => muscles.includes(m))) return false;
    const exNames = (r.exercises || []).map(e => normalize(e.exercise_name));
    if (exo && !exNames.some(n => n.includes(exo))) return false;
    if (filters.level && r.level !== filters.level) return false;
    if (filters.goal && r.goal !== filters.goal) return false;
    const count = r.exercise_count ?? (r.exercises || []).length;
    if (filters.size && !SIZES[filters.size].test(count)) return false;
    if (text) {
      const hay = normalize([r.name, r.description, r.owner_name, ...exNames].join(" "));
      if (!text.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  });
  const votes = r => r.vote_count || 0;
  const count = r => r.exercise_count ?? (r.exercises || []).length;
  const date = r => r.created_at || r.updated_at || "";
  const sorters = {
    popular: (a, b) => votes(b) - votes(a) || date(b).localeCompare(date(a)),
    recent: (a, b) => date(b).localeCompare(date(a)),
    fewest: (a, b) => count(a) - count(b) || votes(b) - votes(a),
    most: (a, b) => count(b) - count(a) || votes(b) - votes(a)
  };
  return list.sort(sorters[filters.sort]);
}

function drawResults(content, ctx) {
  const results = content.querySelector("#d-results");
  if (!results) return;
  const n = activeFilterCount();
  content.querySelector("#d-filter-count").textContent = n ? ` (${n})` : "";
  const list = applyFilters(ctx);
  content.querySelector("#d-count").textContent = `${list.length} routine${list.length > 1 ? "s" : ""}`;

  if (ctx.routines.length === 0) {
    results.innerHTML = `<div class="empty-state muted" style="padding:20px;">Aucune routine partagée pour l'instant.<br>Partage les tiennes depuis « Mes routines » !</div>`;
    return;
  }
  if (list.length === 0) {
    results.innerHTML = `<div class="empty-state muted" style="padding:20px;">Aucune routine ne correspond à ces critères.</div>`;
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  const showMedals = filters.sort === "popular";
  results.innerHTML = list.map((r, i) => routineCard(r, ctx, showMedals && (r.vote_count || 0) > 0 ? medals[i] : "")).join("");
  bindCardActions(results, list, ctx, () => drawResults(content, ctx));
}

function routineCard(r, ctx, medal) {
  const mine = r.owner_uid === ctx.myUid;
  const voted = !!ctx.myVotes[r.id];
  const copied = ctx.copiedIds.has(r.id);
  const count = r.exercise_count ?? (r.exercises || []).length;
  const meta = [
    r.level && db.ROUTINE_LEVELS[r.level],
    r.goal && db.ROUTINE_GOALS[r.goal]
  ].filter(Boolean);
  return `
    <div class="card feed-card" data-open="${esc(r.id)}">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
        <div style="min-width:0;">
          <div class="card-title" style="margin-bottom:2px;">${medal ? `${medal} ` : ""}${esc(r.name)}</div>
          <div class="muted" style="font-size:13px;">par ${mine ? "toi" : esc(r.owner_name || "Anonyme")}${ctx.friendUids.has(r.owner_uid) ? " · 👥 ami" : ""} · ${count} exercice${count > 1 ? "s" : ""}</div>
        </div>
        <button class="vote-btn ${voted ? "voted" : ""}" data-vote="${esc(r.id)}" ${mine ? "disabled title=\"Tu ne peux pas voter pour ta routine\"" : ""}>👍 <span>${r.vote_count || 0}</span></button>
      </div>
      ${r.description ? `<p class="muted" style="margin:8px 0 0; font-size:13px;">${esc(r.description)}</p>` : ""}
      <div class="chip-row" style="margin:10px 0 0;">
        ${(r.muscle_groups || []).map(m => `<span class="feed-muscle-badge">${esc(m)}</span>`).join("")}
        ${meta.map(m => `<span class="routine-badge">${esc(m)}</span>`).join("")}
        ${r.playlist_url ? `<span class="routine-badge">🎧 playlist</span>` : ""}
      </div>
      ${mine ? "" : `<button class="btn btn-sm ${copied ? "btn-secondary" : "btn-primary"}" data-copy="${esc(r.id)}" style="margin-top:10px;" ${copied ? "disabled" : ""}>${copied ? "✓ Dans ta bibliothèque" : "+ Ajouter à ma bibliothèque"}</button>`}
    </div>
  `;
}

function bindCardActions(root, list, ctx, redraw) {
  const find = (id) => list.find(r => r.id === id) || ctx.routines.find(r => r.id === id);
  root.querySelectorAll("[data-open]").forEach(el => {
    el.onclick = () => openRoutineDetail(find(el.dataset.open), ctx, redraw);
  });
  root.querySelectorAll("[data-vote]").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); vote(find(btn.dataset.vote), ctx, btn, redraw); };
  });
  root.querySelectorAll("[data-copy]").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); addToLibrary(find(btn.dataset.copy), ctx, btn, redraw); };
  });
}

async function vote(r, ctx, btn, redraw) {
  if (!r || r.owner_uid === ctx.myUid) return;
  btn.disabled = true;
  const wasVoted = !!ctx.myVotes[r.id];
  try {
    await db.toggleRoutineVote(r.id, wasVoted);
    r.vote_count = Math.max(0, (r.vote_count || 0) + (wasVoted ? -1 : 1));
    if (wasVoted) delete ctx.myVotes[r.id]; else ctx.myVotes[r.id] = true;
    redraw();
  } catch (err) {
    console.error("[Skullcrusher] Erreur vote routine", err);
    toast("Vote impossible, réessaie");
    btn.disabled = false;
  }
}

async function addToLibrary(r, ctx, btn, redraw) {
  if (!r) return;
  btn.disabled = true;
  try {
    await db.copyRoutine(r);
    ctx.copiedIds.add(r.id);
    invalidate("routines");
    toast("Ajoutée à tes routines", 2200, { horns: true });
    redraw();
  } catch (err) {
    console.error("[Skullcrusher] Erreur ajout routine", err);
    toast("Impossible d'ajouter cette routine");
    btn.disabled = false;
  }
}

function openRoutineDetail(r, ctx, redraw) {
  if (!r) return;
  const mine = r.owner_uid === ctx.myUid;
  const refreshModal = () => { closeModal(); redraw(); openRoutineDetail(r, ctx, redraw); };
  openModal(`
    <h3 style="margin-bottom:4px;">${esc(r.name)}</h3>
    <p class="muted" style="margin-top:0;">par ${mine ? "toi" : esc(r.owner_name || "Anonyme")} · 👍 ${r.vote_count || 0}</p>
    ${r.description ? `<p>${esc(r.description)}</p>` : ""}
    ${r.playlist_url ? `<div class="muted" style="font-size:13px;">🎧 Playlist de la routine</div>${spotifyEmbed(r.playlist_url, 152)}` : ""}
    ${(r.exercises || []).map(e => `
      <div class="list-row" style="cursor:default;">
        <div>
          <div class="list-row-title">${esc(e.exercise_name)}</div>
          <div class="list-row-sub">${esc(e.muscle_group || "")}</div>
        </div>
        <div class="list-row-meta">${esc(e.target_sets)} × ${esc(e.reps_target)}<div style="font-size:11px;">repos ${esc(e.rest_seconds)} s</div></div>
      </div>`).join("") || `<p class="muted">Aucun exercice.</p>`}
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn btn-secondary" id="rd-close">Fermer</button>
      ${mine ? "" : `<button class="btn btn-secondary" id="rd-vote">${ctx.myVotes[r.id] ? "Retirer mon 👍" : "👍 Voter"}</button>`}
    </div>
    ${mine ? "" : `<button class="btn btn-primary" id="rd-copy" style="margin-top:10px;" ${ctx.copiedIds.has(r.id) ? "disabled" : ""}>${ctx.copiedIds.has(r.id) ? "✓ Dans ta bibliothèque" : "+ Ajouter à ma bibliothèque"}</button>`}
  `, (modalEl) => {
    modalEl.querySelector("#rd-close").onclick = closeModal;
    const voteBtn = modalEl.querySelector("#rd-vote");
    if (voteBtn) voteBtn.onclick = () => vote(r, ctx, voteBtn, refreshModal);
    const copyBtn = modalEl.querySelector("#rd-copy");
    if (copyBtn) copyBtn.onclick = () => addToLibrary(r, ctx, copyBtn, refreshModal);
  });
}
