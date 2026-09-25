// ============================================================
// ROUTINES — mes routines (création, partage) + Découvrir
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, attachAutocomplete, esc } from "./utils.js";
import { getExercises, getRoutines, invalidate } from "./cache.js";
import { renderDiscover } from "./routine-discover.js";
import { guessMuscleGroup } from "./import.js";
import { normalizePlaylistUrl } from "./music.js";

let routinesMode = "mine"; // "mine" | "discover"

export async function renderRoutines(container) {
  container.innerHTML = `
    <div class="chip-row" id="routine-mode-chips" style="margin-bottom:14px;">
      <div class="chip ${routinesMode === "mine" ? "active" : ""}" data-rmode="mine">Mes routines</div>
      <div class="chip ${routinesMode === "discover" ? "active" : ""}" data-rmode="discover">🔎 Découvrir</div>
    </div>
    <div id="routines-content"><div class="empty-state"><span class="num">···</span>Chargement</div></div>
  `;
  container.querySelectorAll("[data-rmode]").forEach(chip => {
    chip.onclick = () => {
      routinesMode = chip.dataset.rmode;
      container.querySelectorAll("[data-rmode]").forEach(c => c.classList.toggle("active", c === chip));
      drawRoutines(container);
    };
  });
  await drawRoutines(container);
}

async function drawRoutines(container) {
  const content = container.querySelector("#routines-content");
  if (!content) return;
  if (routinesMode === "discover") await renderDiscover(content, () => renderMyRoutines(content));
  else await renderMyRoutines(content);
}

export function routineMetaChips(r) {
  const chips = [];
  if (r.level && db.ROUTINE_LEVELS[r.level]) chips.push(db.ROUTINE_LEVELS[r.level]);
  if (r.goal && db.ROUTINE_GOALS[r.goal]) chips.push(db.ROUTINE_GOALS[r.goal]);
  return chips;
}

async function renderMyRoutines(content) {
  const routines = await getRoutines();
  if (!content.isConnected) return;
  content.innerHTML = `
    <button class="btn btn-primary" id="new-routine">+ Nouvelle routine</button>
    <div style="height:14px"></div>
    ${routines.length === 0 ? `<div class="empty-state"><span class="num">▤</span>Pas encore de routine.<br><span class="muted">Crée la tienne ou pioche dans l'onglet Découvrir.</span></div>` : ""}
    ${routines.map(r => `
      <div class="card" data-routine="${esc(r.id)}">
        <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
          <div class="card-title" style="margin-bottom:4px;">${esc(r.name)}</div>
          <span class="routine-badge">${db.ROUTINE_VISIBILITY[r.visibility || "private"]}</span>
        </div>
        ${r.source?.owner_name ? `<div class="muted" style="font-size:12px; margin-bottom:4px;">Ajoutée depuis la routine de ${esc(r.source.owner_name)}</div>` : ""}
        ${r.description ? `<div class="muted" style="font-size:13px; margin-bottom:6px;">${esc(r.description)}</div>` : ""}
        <div class="muted" style="margin-bottom:10px;">${(r.exercises || []).map(e => esc(e.exercise_name)).join(" · ")}</div>
        ${routineMetaChips(r).length || r.vote_count || r.playlist_url ? `<div class="chip-row" style="margin:0 0 10px;">
          ${routineMetaChips(r).map(c => `<span class="feed-muscle-badge">${esc(c)}</span>`).join("")}
          ${r.vote_count ? `<span class="feed-muscle-badge">👍 ${r.vote_count}</span>` : ""}
          ${r.playlist_url ? `<span class="routine-badge">🎧 playlist</span>` : ""}
        </div>` : ""}
        <div class="btn-row">
          <button class="btn btn-sm btn-secondary" data-edit="${esc(r.id)}">Modifier</button>
          <button class="btn btn-sm btn-secondary" data-share="${esc(r.id)}">Partager</button>
          <button class="btn btn-sm btn-danger" data-del="${esc(r.id)}">Supprimer</button>
        </div>
      </div>
    `).join("")}
  `;
  const refresh = () => renderMyRoutines(content);
  content.querySelector("#new-routine").onclick = () => openRoutineEditor(null, refresh);
  content.querySelectorAll("[data-edit]").forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openRoutineEditor(routines.find(r => r.id === b.dataset.edit), refresh); };
  });
  content.querySelectorAll("[data-share]").forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openShareModal(routines.find(r => r.id === b.dataset.share), refresh); };
  });
  content.querySelectorAll("[data-del]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Supprimer cette routine ?")) return;
      await db.deleteRoutine(b.dataset.del);
      invalidate("routines");
      await refresh();
    };
  });
}

// ---------- Partage : privée / amis choisis / publique ----------
async function openShareModal(routine, onDone) {
  const friendships = await db.listFriendships();
  const friends = friendships.filter(f => f.status === "accepted");
  const profiles = await db.getProfiles(friends.map(f => f.other_uid));
  let visibility = routine.visibility || "private";
  // Par défaut, "Amis" coche tous les amis si la routine n'était encore partagée avec personne.
  const selected = new Set((routine.shared_with || []).length ? routine.shared_with : friends.map(f => f.other_uid));

  openModal(`
    <h3>Partager « ${esc(routine.name)} »</h3>
    <div class="chip-row" id="vis-chips">
      ${Object.entries(db.ROUTINE_VISIBILITY).map(([k, label]) => `<div class="chip ${k === visibility ? "active" : ""}" data-vis="${k}">${label}</div>`).join("")}
    </div>
    <p class="muted" id="vis-help" style="font-size:13px;"></p>
    <div id="friend-picks"></div>
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn btn-secondary" id="share-cancel">Annuler</button>
      <button class="btn btn-primary" id="share-save">Enregistrer</button>
    </div>
  `, (modalEl) => {
    const help = {
      private: "Visible par toi seul.",
      friends: "Visible par les amis cochés ci-dessous, dans leur onglet Découvrir. Ils peuvent la voter et l'ajouter à leur bibliothèque.",
      public: "Visible par tous les utilisateurs dans Découvrir : ils peuvent la voter et l'ajouter à leur bibliothèque."
    };
    function draw() {
      modalEl.querySelectorAll("[data-vis]").forEach(c => c.classList.toggle("active", c.dataset.vis === visibility));
      modalEl.querySelector("#vis-help").textContent = help[visibility];
      const picks = modalEl.querySelector("#friend-picks");
      if (visibility !== "friends") { picks.innerHTML = ""; return; }
      picks.innerHTML = friends.length === 0
        ? `<p class="muted">Tu n'as pas encore d'amis. Ajoute-en depuis l'onglet Feed → Amis.</p>`
        : friends.map(f => `
          <label class="list-row" style="cursor:pointer;">
            <span class="list-row-title">${esc(profiles[f.other_uid]?.display_name || "Utilisateur")}</span>
            <input type="checkbox" data-friend="${esc(f.other_uid)}" ${selected.has(f.other_uid) ? "checked" : ""} style="width:auto;">
          </label>`).join("");
      picks.querySelectorAll("[data-friend]").forEach(cb => {
        cb.onchange = () => { if (cb.checked) selected.add(cb.dataset.friend); else selected.delete(cb.dataset.friend); };
      });
    }
    modalEl.querySelectorAll("[data-vis]").forEach(c => c.onclick = () => { visibility = c.dataset.vis; draw(); });
    modalEl.querySelector("#share-cancel").onclick = closeModal;
    modalEl.querySelector("#share-save").onclick = async () => {
      if (visibility === "friends" && selected.size === 0) { toast("Coche au moins un ami"); return; }
      const btn = modalEl.querySelector("#share-save");
      btn.disabled = true;
      try {
        const friendUids = new Set(friends.map(f => f.other_uid));
        await db.setRoutineSharing(routine.id, visibility, [...selected].filter(u => friendUids.has(u)));
        invalidate("routines");
        closeModal();
        toast(visibility === "private" ? "Routine privée" : "Routine partagée");
        await onDone();
      } catch (err) {
        console.error("[Skullcrusher] Erreur partage routine", err);
        toast("Impossible de modifier le partage");
        btn.disabled = false;
      }
    };
    draw();
  });
}

// ---------- Éditeur ----------
async function openRoutineEditor(routine, onSaved) {
  const exercises = await getExercises();
  const state = {
    name: routine?.name || "",
    description: routine?.description || "",
    level: routine?.level || "",
    goal: routine?.goal || "",
    playlist_url: routine?.playlist_url || "",
    exercises: routine ? JSON.parse(JSON.stringify(routine.exercises || [])) : []
  };
  const options = (map, current) => `<option value="">—</option>` +
    Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === current ? "selected" : ""}>${esc(v)}</option>`).join("");

  openModal(`
    <h3>${routine ? "Modifier" : "Nouvelle"} routine</h3>
    <label>Nom</label>
    <input id="r-name" value="${esc(state.name)}" placeholder="ex: Push A" maxlength="80">
    <label>Description (facultatif)</label>
    <textarea id="r-desc" rows="2" maxlength="500" placeholder="ex: Séance pecs/épaules/triceps, 1h">${esc(state.description)}</textarea>
    <div class="field-row">
      <div><label>Niveau</label><select id="r-level">${options(db.ROUTINE_LEVELS, state.level)}</select></div>
      <div><label>Objectif</label><select id="r-goal">${options(db.ROUTINE_GOALS, state.goal)}</select></div>
    </div>
    <label>🎧 Playlist Spotify de la routine (facultatif)</label>
    <input id="r-playlist" value="${esc(state.playlist_url)}" placeholder="https://open.spotify.com/playlist/…" inputmode="url">
    <div id="r-exercises" style="margin-top:14px;"></div>
    <button class="btn btn-secondary btn-sm" id="r-add-ex" style="margin-top:6px;">+ Ajouter un exercice</button>
    <div style="height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="r-cancel">Annuler</button>
      <button class="btn btn-primary" id="r-save">Enregistrer</button>
    </div>
  `, (modalEl) => {
    renderExerciseRows(modalEl, state, exercises);
    modalEl.querySelector("#r-add-ex").onclick = () => {
      state.exercises.push({ exercise_name: "", target_sets: 3, reps_target: "8-10", rest_seconds: 90, muscle_group: "Autre" });
      renderExerciseRows(modalEl, state, exercises);
    };
    modalEl.querySelector("#r-cancel").onclick = closeModal;
    modalEl.querySelector("#r-save").onclick = async () => {
      state.name = modalEl.querySelector("#r-name").value.trim();
      state.description = modalEl.querySelector("#r-desc").value.trim();
      state.level = modalEl.querySelector("#r-level").value;
      state.goal = modalEl.querySelector("#r-goal").value;
      const rawPlaylist = modalEl.querySelector("#r-playlist").value.trim();
      state.playlist_url = normalizePlaylistUrl(rawPlaylist);
      if (rawPlaylist && !state.playlist_url) { toast("Lien de playlist Spotify invalide"); return; }
      if (!state.name) { toast("Donne un nom à la routine"); return; }
      if (/[<>]/.test(state.name + state.description)) { toast("Les caractères < et > ne sont pas autorisés"); return; }
      state.exercises = state.exercises.filter(e => e.exercise_name.trim());
      // Groupe musculaire de chaque exercice (sert aux filtres de Découvrir) :
      // celui de la bibliothèque si le nom y figure, sinon deviné d'après le nom.
      const library = await getExercises();
      state.exercises.forEach(e => {
        e.exercise_name = e.exercise_name.trim();
        const known = library.find(x => x.name.toLowerCase() === e.exercise_name.toLowerCase());
        e.muscle_group = known?.muscle_group || guessMuscleGroup(e.exercise_name);
      });
      try {
        await db.saveRoutine(state, routine?.id || null);
      } catch (err) {
        console.error("[Skullcrusher] Erreur enregistrement routine", err);
        toast("Impossible d'enregistrer la routine");
        return;
      }
      invalidate("routines");
      closeModal();
      toast("Routine enregistrée");
      await onSaved();
    };
  });
}

function renderExerciseRows(modalEl, state, exercises) {
  const wrap = modalEl.querySelector("#r-exercises");
  wrap.innerHTML = state.exercises.map((ex, i) => `
    <div class="card" style="padding:12px; margin-bottom:8px;">
      <div style="position:relative;"><input class="r-ex-name" data-i="${i}" value="${esc(ex.exercise_name)}" placeholder="Nom de l'exercice"></div>
      <div class="field-row" style="margin-top:8px;">
        <div><label>Séries</label><input class="r-ex-sets" data-i="${i}" type="number" value="${esc(ex.target_sets)}"></div>
        <div><label>Reps cible</label><input class="r-ex-reps" data-i="${i}" value="${esc(ex.reps_target)}" placeholder="8-10"></div>
        <div><label>Repos (s)</label><input class="r-ex-rest" data-i="${i}" type="number" value="${esc(ex.rest_seconds)}"></div>
      </div>
      <button class="btn btn-sm btn-danger" data-remove="${i}" style="margin-top:8px;">Retirer</button>
    </div>
  `).join("");
  const names = exercises.map(e => e.name);
  wrap.querySelectorAll(".r-ex-name").forEach(inp => {
    attachAutocomplete(inp, names, (picked) => {
      const ex = exercises.find(e => e.name === picked);
      state.exercises[inp.dataset.i].exercise_name = picked;
      state.exercises[inp.dataset.i].muscle_group = ex?.muscle_group || "Autre";
    });
    inp.oninput = () => {
      const ex = exercises.find(e => e.name.toLowerCase() === inp.value.trim().toLowerCase());
      state.exercises[inp.dataset.i].exercise_name = inp.value;
      state.exercises[inp.dataset.i].muscle_group = ex?.muscle_group || "Autre";
    };
  });
  wrap.querySelectorAll(".r-ex-sets").forEach(inp => inp.oninput = () => state.exercises[inp.dataset.i].target_sets = parseInt(inp.value, 10) || 3);
  wrap.querySelectorAll(".r-ex-reps").forEach(inp => inp.oninput = () => state.exercises[inp.dataset.i].reps_target = inp.value);
  wrap.querySelectorAll(".r-ex-rest").forEach(inp => inp.oninput = () => state.exercises[inp.dataset.i].rest_seconds = parseInt(inp.value, 10) || 90);
  wrap.querySelectorAll("[data-remove]").forEach(btn => btn.onclick = () => {
    state.exercises.splice(parseInt(btn.dataset.remove, 10), 1);
    renderExerciseRows(modalEl, state, exercises);
  });
}
