// ============================================================
// ROUTINES — mes routines (création, partage) + Découvrir
// ============================================================
import * as db from "./db.js";
import { icon, segHtml } from "./icons.js";
import { toast, openModal, closeModal, attachAutocomplete, esc, confirmDanger, bindFolds } from "./utils.js";
import { getExercises, getRoutines, invalidate } from "./cache.js";
import { renderDiscover } from "./routine-discover.js";
import { guessMuscleGroup } from "./muscles.js";
import { normalizePlaylistUrl } from "./music.js";
import { t, tn } from "./i18n.js";

let routinesMode = "mine"; // "mine" | "discover" | "plans"
export function setRoutinesMode(mode) { routinesMode = mode; }

export async function renderRoutines(container) {
  container.innerHTML = `
    ${segHtml([["mine", t("Mes routines"), "routines"], ["plans", t("Mes plans"), "plan"], ["discover", t("Découvrir"), "discover"]], routinesMode, "data-rmode")}
    <div id="routines-content"><div class="empty-state"><span class="num">···</span>${t("Chargement")}</div></div>
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
  else if (routinesMode === "plans") await (await import("./plans.js")).renderPlans(content);
  else await renderMyRoutines(content);
}

export function routineMetaChips(r) {
  const chips = [];
  if (r.level && db.ROUTINE_LEVELS[r.level]) chips.push(db.ROUTINE_LEVELS[r.level]);
  if (r.goal && db.ROUTINE_GOALS[r.goal]) chips.push(db.ROUTINE_GOALS[r.goal]);
  return chips;
}

const openRoutines = new Set(); // cartes dépliées
async function renderMyRoutines(content) {
  const [all, planIds] = await Promise.all([getRoutines(), import("./plans.js").then(m => m.planRoutineIds()).catch(() => new Set())]);
  if (!content.isConnected) return;
  // Les séances des plans sont rangées avec leur plan (onglet Plans).
  const routines = all.filter(r => !planIds.has(r.id));
  const hidden = all.length - routines.length;
  content.innerHTML = `
    <div id="gift-inbox"></div>
    <button class="btn btn-primary" id="new-routine">+ ${t("Nouvelle routine")}</button>
    <div class="btn-row" style="margin-top:8px;">
      <button class="btn btn-secondary btn-sm" id="import-plan">📥 ${t("Importer un plan")}</button>
      ${all.length ? `<button class="btn btn-secondary btn-sm" id="export-plan">📤 ${t("Exporter en CSV")}</button>` : ""}
    </div>
    <div style="height:14px"></div>
    ${hidden ? `<p class="muted" style="font-size:13px; margin:-4px 0 12px;">📅 ${t("{n} séance(s) de plan rangée(s) dans « Mes plans ».", { n: hidden })}</p>` : ""}
    ${routines.length === 0 ? `<div class="empty-state"><span class="num">▤</span>${t("Pas encore de routine.")}<br><span class="muted">${t("Crée la tienne ou pioche dans l'onglet Découvrir.")}</span></div>` : ""}
    ${routines.map(r => {
      const exs = r.exercises || [];
      const sub = [tn(exs.length, "{n} exercice", "{n} exercices"), ...routineMetaChips(r)].join(" · ");
      return `
      <div class="card fold" data-fold="${esc(r.id)}" data-routine="${esc(r.id)}">
        <div class="fold-head">
          <div class="fold-main">
            <div class="card-title">${esc(r.name)}</div>
            <div class="muted fold-sub">${esc(sub)}</div>
          </div>
          <span class="fold-badges"><span class="routine-badge">${db.ROUTINE_VISIBILITY[r.visibility || "private"]}</span></span>
          <span class="fold-chev">›</span>
        </div>
        <div class="fold-body">
          ${r.source?.owner_name ? `<div class="muted" style="font-size:12px; margin-bottom:6px;">${t("Ajoutée depuis la routine de {name}", { name: esc(r.source.owner_name) })}</div>` : ""}
          ${r.description ? `<div class="muted" style="font-size:13px; margin-bottom:8px;">${esc(r.description)}</div>` : ""}
          ${exs.map(e => `<div class="fold-ex"><span>${esc(e.exercise_name)}</span><span>${esc(e.target_sets || "")}${e.reps_target ? ` × ${esc(e.reps_target)}` : ""}${e.target_kg != null ? ` · ${esc(e.target_kg)} kg` : ""}</span></div>`).join("")}
          ${r.vote_count || r.playlist_url ? `<div class="chip-row" style="margin:10px 0 0;">
            ${r.vote_count ? `<span class="feed-muscle-badge">👍 ${r.vote_count}</span>` : ""}
            ${r.playlist_url ? `<span class="routine-badge">🎧 ${t("playlist")}</span>` : ""}
          </div>` : ""}
          <div class="btn-row btn-row-wrap" style="margin-top:12px;">
            <button class="btn btn-sm btn-secondary" data-edit="${esc(r.id)}">${t("Modifier")}</button>
            <button class="btn btn-sm btn-secondary" data-share="${esc(r.id)}">${t("Partager")}</button>
            <button class="btn btn-sm btn-secondary" data-send="${esc(r.id)}">${t("Envoyer")}</button>
            <button class="btn btn-sm btn-danger" data-del="${esc(r.id)}">${t("Supprimer")}</button>
          </div>
          ${db.isAdmin() ? `<button class="btn btn-sm btn-secondary admin-btn" data-official="${esc(r.id)}" style="margin-top:8px;">⭐ ${t("Publier (officielle)")}</button>` : ""}
        </div>
      </div>`;
    }).join("")}
  `;
  const refresh = () => renderMyRoutines(content);
  bindFolds(content, openRoutines);
  content.querySelector("#new-routine").onclick = () => openRoutineEditor(null, refresh);
  content.querySelector("#import-plan").onclick = async () => (await import("./plan-import.js")).openPlanImport(refresh);
  const exportBtn = content.querySelector("#export-plan");
  if (exportBtn) exportBtn.onclick = async () => (await import("./plan-import.js")).exportPlan();
  content.querySelectorAll("[data-edit]").forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openRoutineEditor(routines.find(r => r.id === b.dataset.edit), refresh); };
  });
  content.querySelectorAll("[data-share]").forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); openShareModal(routines.find(r => r.id === b.dataset.share), refresh); };
  });
  content.querySelectorAll("[data-official]").forEach(b => {
    b.onclick = async () => (await import("./admin.js")).publishRoutineOfficial(routines.find(r => r.id === b.dataset.official), refresh);
  });
  content.querySelectorAll("[data-send]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const r = routines.find(x => x.id === b.dataset.send);
      const { openSendModal, routineGiftData } = await import("./gifts.js");
      openSendModal("routine", r.name, routineGiftData(r));
    };
  });
  import("./gifts.js").then(m => m.renderGiftInbox(content.querySelector("#gift-inbox"), refresh));
  content.querySelectorAll("[data-del]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const r = routines.find(x => x.id === b.dataset.del);
      if (!await confirmRoutineDelete(r)) return;
      await db.deleteRoutine(b.dataset.del);
      invalidate("routines");
      await refresh();
    };
  });
}

// Suppression d'une routine : dit ce qu'elle arrête (plan en cours, séance
// en cours, autres plans) et rappelle qu'il n'y a pas de corbeille.
async function confirmRoutineDelete(r) {
  if (!r) return false;
  const usage = await (await import("./plans.js")).routineUsage(r.id).catch(() => ({ active: null, days: [], others: [] }));
  let inWorkout = false;
  try { inWorkout = JSON.parse(localStorage.getItem("skullcrusher_active_workout_state") || "null")?.routine_id === r.id; } catch (_) {}
  const items = [
    ...(inWorkout ? [t("Une séance est en cours avec cette routine")] : []),
    ...(usage.active ? [t("Elle fait partie de ton plan en cours « {plan} » ({days}) : ces séances disparaîtront du plan", { plan: esc(usage.active.name), days: esc(usage.days.join(", ")) })] : []),
    ...usage.others.map(n => t("Utilisée dans le plan « {plan} »", { plan: esc(n) }))
  ];
  return confirmDanger({
    title: items.length ? t("Supprimer une routine en cours d'utilisation ?") : t("Supprimer « {name} » ?", { name: esc(r.name) }),
    message: (items.length ? `<b>${esc(r.name)}</b> — ` : "") + t("Elle sera effacée définitivement (pas de corbeille). Tes séances passées restent dans l'historique."),
    items, cancelLabel: t("Garder la routine"), confirmLabel: t("Supprimer définitivement")
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
    <h3>${t("Partager « {name} »", { name: esc(routine.name) })}</h3>
    <div class="chip-row" id="vis-chips">
      ${Object.entries(db.ROUTINE_VISIBILITY).map(([k, label]) => `<div class="chip ${k === visibility ? "active" : ""}" data-vis="${k}">${label}</div>`).join("")}
    </div>
    <p class="muted" id="vis-help" style="font-size:13px;"></p>
    <div id="friend-picks"></div>
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn btn-secondary" id="share-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="share-save">${t("Enregistrer")}</button>
    </div>
  `, (modalEl) => {
    const help = {
      private: t("Visible par toi seul."),
      friends: t("Visible par les amis cochés ci-dessous, dans leur onglet Découvrir. Ils peuvent la voter et l'ajouter à leur bibliothèque."),
      public: t("Visible par tous les utilisateurs dans Découvrir : ils peuvent la voter et l'ajouter à leur bibliothèque.")
    };
    function draw() {
      modalEl.querySelectorAll("[data-vis]").forEach(c => c.classList.toggle("active", c.dataset.vis === visibility));
      modalEl.querySelector("#vis-help").textContent = help[visibility];
      const picks = modalEl.querySelector("#friend-picks");
      if (visibility !== "friends") { picks.innerHTML = ""; return; }
      picks.innerHTML = friends.length === 0
        ? `<p class="muted">${t("Tu n'as pas encore d'amis. Ajoute-en depuis l'onglet Feed → Amis.")}</p>`
        : friends.map(f => `
          <label class="list-row" style="cursor:pointer;">
            <span class="list-row-title">${esc(profiles[f.other_uid]?.display_name || t("Utilisateur"))}</span>
            <input type="checkbox" data-friend="${esc(f.other_uid)}" ${selected.has(f.other_uid) ? "checked" : ""} style="width:auto;">
          </label>`).join("");
      picks.querySelectorAll("[data-friend]").forEach(cb => {
        cb.onchange = () => { if (cb.checked) selected.add(cb.dataset.friend); else selected.delete(cb.dataset.friend); };
      });
    }
    modalEl.querySelectorAll("[data-vis]").forEach(c => c.onclick = () => { visibility = c.dataset.vis; draw(); });
    modalEl.querySelector("#share-cancel").onclick = closeModal;
    modalEl.querySelector("#share-save").onclick = async () => {
      if (visibility === "friends" && selected.size === 0) { toast(t("Coche au moins un ami")); return; }
      const btn = modalEl.querySelector("#share-save");
      btn.disabled = true;
      try {
        const friendUids = new Set(friends.map(f => f.other_uid));
        await db.setRoutineSharing(routine.id, visibility, [...selected].filter(u => friendUids.has(u)));
        invalidate("routines");
        closeModal();
        toast(visibility === "private" ? t("Routine privée") : t("Routine partagée"));
        await onDone();
      } catch (err) {
        console.error("[Skullcrusher] Erreur partage routine", err);
        toast(t("Impossible de modifier le partage"));
        btn.disabled = false;
      }
    };
    draw();
  });
}

// ---------- Éditeur ----------
// opts.save(state) : enregistrement à la place de « mes routines » (ex.
// séance officielle modifiée par l'administrateur).
export async function openRoutineEditor(routine, onSaved, opts = {}) {
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
    <h3>${routine?.id ? t("Modifier la routine") : t("Nouvelle routine")}</h3>
    <label>${t("Nom")}</label>
    <input id="r-name" value="${esc(state.name)}" placeholder="${t("ex: Push A")}" maxlength="80">
    <label>${t("Description (facultatif)")}</label>
    <textarea id="r-desc" rows="2" maxlength="500" placeholder="${t("ex: Séance pecs/épaules/triceps, 1h")}">${esc(state.description)}</textarea>
    <div class="field-row">
      <div><label>${t("Niveau")}</label><select id="r-level">${options(db.ROUTINE_LEVELS, state.level)}</select></div>
      <div><label>${t("Objectif")}</label><select id="r-goal">${options(db.ROUTINE_GOALS, state.goal)}</select></div>
    </div>
    <label>🎧 ${t("Playlist Spotify de la routine (facultatif)")}</label>
    <input id="r-playlist" value="${esc(state.playlist_url)}" placeholder="${t("Lien de playlist (Spotify, Apple Music, Deezer)")}" inputmode="url">
    <div id="r-exercises" style="margin-top:14px;"></div>
    <button class="btn btn-secondary btn-sm" id="r-add-ex" style="margin-top:6px;">+ ${t("Ajouter un exercice")}</button>
    <div style="height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="r-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="r-save">${t("Enregistrer")}</button>
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
      if (rawPlaylist && !state.playlist_url) { toast(t("Lien de playlist invalide : colle un lien Spotify, Apple Music ou Deezer.")); return; }
      if (!state.name) { toast(t("Donne un nom à la routine")); return; }
      if (/[<>]/.test(state.name + state.description)) { toast(t("Les caractères < et > ne sont pas autorisés.")); return; }
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
        if (opts.save) await opts.save(state);
        else await db.saveRoutine(state, routine?.id || null);
      } catch (err) {
        console.error("[Skullcrusher] Erreur enregistrement routine", err);
        toast(t("Impossible d'enregistrer la routine"));
        return;
      }
      invalidate("routines");
      closeModal();
      toast(t("Routine enregistrée"));
      await onSaved();
    };
  });
}

function renderExerciseRows(modalEl, state, exercises) {
  const wrap = modalEl.querySelector("#r-exercises");
  wrap.innerHTML = state.exercises.map((ex, i) => `
    <div class="card" style="padding:12px; margin-bottom:8px;">
      <div style="position:relative;"><input class="r-ex-name" data-i="${i}" value="${esc(ex.exercise_name)}" placeholder="${t("Nom de l'exercice")}"></div>
      <div class="field-row" style="margin-top:8px;">
        <div><label>${t("Séries")}</label><input class="r-ex-sets" data-i="${i}" type="number" value="${esc(ex.target_sets)}"></div>
        <div><label>${t("Reps cible")}</label><input class="r-ex-reps" data-i="${i}" value="${esc(ex.reps_target)}" placeholder="8-10"></div>
        <div><label>${t("Repos (s)")}</label><input class="r-ex-rest" data-i="${i}" type="number" value="${esc(ex.rest_seconds)}"></div>
        <div><label>${t("Charge (kg)")}</label><input class="r-ex-kg" data-i="${i}" type="number" inputmode="decimal" step="0.5" min="0" value="${esc(ex.target_kg ?? "")}" placeholder="—"></div>
      </div>
      <button class="btn btn-sm btn-danger" data-remove="${i}" style="margin-top:8px;">${t("Retirer")}</button>
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
  wrap.querySelectorAll(".r-ex-kg").forEach(inp => inp.oninput = () => {
    const kg = parseFloat(inp.value.replace(",", "."));
    state.exercises[inp.dataset.i].target_kg = kg >= 0 && kg <= 1000 ? kg : null;
  });
  wrap.querySelectorAll("[data-remove]").forEach(btn => btn.onclick = () => {
    state.exercises.splice(parseInt(btn.dataset.remove, 10), 1);
    renderExerciseRows(modalEl, state, exercises);
  });
}
