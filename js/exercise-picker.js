// ============================================================
// CHOIX D'UN EXERCICE — pour débutants comme confirmés :
//   - recherche par nom, en français ou en anglais (exercise-search.js) ;
//   - filtres par muscle et par matériel, exercices récents ;
//   - aperçu avant d'ajouter : muscles sollicités, niveau, conseils,
//     ton historique (meilleure 1RM, dernière série), vidéos ;
//   - ajout de plusieurs exercices d'affilée, ou création d'un nouveau.
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, toast, esc, estimate1RM, fmtDate } from "./utils.js";
import { getExercises, getSetsForExercise } from "./cache.js";
import { EXERCISE_GUIDES } from "./exercise-guides.js";
import { GUIDE_TO_GROUP, guessMuscleGroup } from "./muscles.js";
import { t, getLang } from "./i18n.js";

const LS_RECENT = "skullcrusher_recent_exercises";
const RECENT_MAX = 15;
const MAX_ROWS = 80;
// i18n-keys: "Barre", "Haltère", "Machine", "Poulie", "Poids du corps"
const EQUIPMENTS = ["Barre", "Haltère", "Machine", "Poulie", "Poids du corps"];

function readRecent() {
  try { return JSON.parse(localStorage.getItem(LS_RECENT) || "[]").filter(n => typeof n === "string"); } catch (_) { return []; }
}
export function rememberExercise(name) {
  try { localStorage.setItem(LS_RECENT, JSON.stringify([name, ...readRecent().filter(n => n !== name)].slice(0, RECENT_MAX))); } catch (_) {}
}

// Matériel : celui de la fiche, sinon d'après le nom (« (Barre) », « Dumbbell »…).
function equipmentOf(ex) {
  const guide = EXERCISE_GUIDES[ex.name];
  if (guide?.equipment) return guide.equipment === "Barre EZ" ? "Barre" : guide.equipment;
  const n = ex.name.toLowerCase();
  if (/(haltère|haltere|dumbbell)/.test(n)) return "Haltère";
  if (/(poulie|cable)/.test(n)) return "Poulie";
  if (/(machine|smith|presse|leg press)/.test(n)) return "Machine";
  if (/(barre|barbell|ez bar)/.test(n)) return "Barre";
  if (/(poids du corps|bodyweight|pompes|tractions|dips|push up|pull up|gainage|planche|crunch)/.test(n)) return "Poids du corps";
  return "";
}

// Groupes travaillés : celui de la bibliothèque + muscles principaux de la fiche.
function groupsOf(ex) {
  const g = new Set([ex.muscle_group || "Autre"]);
  (EXERCISE_GUIDES[ex.name]?.primaryMuscles || []).forEach(m => { if (GUIDE_TO_GROUP[m]) g.add(GUIDE_TO_GROUP[m]); });
  return g;
}

function previewHtml(ex) {
  const guide = EXERCISE_GUIDES[ex.name];
  const videoName = getLang() !== "fr" && guide?.en ? guide.en : ex.name;
  const videoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${videoName} ${t("exercice musculation technique")}`)}`;
  return `
    <div class="pk-preview">
      ${guide ? `
        <div class="chip-row" style="margin:0 0 6px;">
          ${guide.primaryMuscles.map(m => `<span class="chip active" style="pointer-events:none;">${esc(t(m))}</span>`).join("")}
          ${guide.secondaryMuscles.map(m => `<span class="chip" style="pointer-events:none;">${esc(t(m))}</span>`).join("")}
        </div>
        <div class="muted" style="font-size:12px; margin-bottom:6px;">${[guide.level, guide.mechanic, guide.equipment].filter(Boolean).map(x => esc(t(x))).join(" · ")}</div>
        ${guide.tips.slice(0, 2).map(tip => `<p style="margin:3px 0; font-size:13px;">• ${esc(t(tip))}</p>`).join("")}
      ` : `<p class="muted" style="margin:0 0 6px; font-size:13px;">${t("Groupe musculaire : {g}.", { g: esc(t(ex.muscle_group || "Autre")) })} ${t("Pas de fiche détaillée disponible pour cet exercice.")}</p>`}
      <p class="muted pk-history" style="font-size:13px; margin:6px 0;">${t("Chargement…")}</p>
      <div class="btn-row">
        <a class="btn btn-secondary btn-sm" href="${videoUrl}" target="_blank" rel="noopener">▶ ${t("Vidéos")}</a>
        <button class="btn btn-primary btn-sm" data-add="${esc(ex.name)}">＋ ${t("Ajouter à la séance")}</button>
      </div>
    </div>`;
}

async function fillHistory(el, name) {
  try {
    const sets = (await getSetsForExercise(name)).filter(s => s.weight_kg > 0 && s.reps > 0);
    if (!el.isConnected) return;
    if (!sets.length) { el.textContent = t("Tu n'as encore jamais fait cet exercice."); return; }
    const last = sets.slice().sort((a, b) => String(b.workout_start_time).localeCompare(String(a.workout_start_time)))[0];
    const best = Math.max(...sets.filter(s => s.reps <= 15).map(s => estimate1RM(s.weight_kg, s.reps)), 0);
    el.textContent = t("Dernière fois : {kg} kg × {reps} ({date}) · meilleure 1RM estimée : {rm} kg", { kg: last.weight_kg, reps: last.reps, date: fmtDate(last.workout_start_time, { year: undefined }), rm: best || "—" });
  } catch (_) {
    if (el.isConnected) el.textContent = "";
  }
}

// onAdd(nom, groupe, exerciceExistantOuNull) est appelé pour chaque ajout ;
// la fenêtre reste ouverte pour en ajouter plusieurs (« Terminé » la ferme).
export async function openExercisePicker({ onAdd, title = t("Ajouter un exercice") }) {
  const library = (await getExercises()).slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const byName = new Map(library.map(e => [e.name, e]));
  let search = null;
  try { search = await import("./exercise-search.js"); await search.loadAliases(); } catch (_) {}
  const recent = readRecent().filter(n => byName.has(n));
  const state = { query: "", group: recent.length ? "__recent" : "", equipment: "", open: "" };
  const added = [];

  const groupCounts = {};
  library.forEach(ex => groupsOf(ex).forEach(g => { groupCounts[g] = (groupCounts[g] || 0) + 1; }));
  const groups = db.EXO_GROUPS.filter(g => groupCounts[g]);

  openModal(`
    <h3 style="margin-bottom:8px;">${esc(title)}</h3>
    <div style="position:relative;"><input id="ex-name" placeholder="${t("Rechercher (français ou anglais)…")}" autocomplete="off"></div>
    <div class="chip-row pk-scroll" id="pk-groups">
      ${recent.length ? `<div class="chip" data-group="__recent">🕘 ${t("Récents")}</div>` : ""}
      <div class="chip" data-group="">${t("Tous")}</div>
      ${groups.map(g => `<div class="chip" data-group="${esc(g)}">${esc(t(g))}</div>`).join("")}
    </div>
    <div class="chip-row pk-scroll" id="pk-equip" style="margin-top:0;">
      ${EQUIPMENTS.map(e => `<div class="chip chip-sm" data-equip="${esc(e)}">${esc(t(e))}</div>`).join("")}
    </div>
    <div id="pk-list" class="pk-list"></div>
    <div id="pk-create"></div>
    <button class="btn btn-secondary" id="pk-done" style="margin-top:10px;">${t("Terminé")}</button>
  `, (m) => {
    const list = m.querySelector("#pk-list");
    const input = m.querySelector("#ex-name");

    const doAdd = (name, group, existing) => {
      onAdd(name, group, existing);
      rememberExercise(name);
      added.push(name);
      toast(t("Ajouté : {name}", { name }));
      m.querySelector("#pk-done").textContent = `${t("Terminé")} (${added.length})`;
      draw();
    };

    const draw = () => {
      m.querySelectorAll("[data-group]").forEach(c => c.classList.toggle("active", c.dataset.group === state.group && !state.query));
      m.querySelectorAll("[data-equip]").forEach(c => c.classList.toggle("active", c.dataset.equip === state.equipment));
      let rows;
      if (state.query && search) rows = search.searchExercises(state.query, library.map(e => e.name), 400).map(r => ({ ex: byName.get(r.name), via: r.via }));
      else if (state.query) rows = library.filter(e => e.name.toLowerCase().includes(state.query.toLowerCase())).map(ex => ({ ex }));
      else if (state.group === "__recent") rows = recent.map(n => ({ ex: byName.get(n) }));
      else rows = library.map(ex => ({ ex }));
      if (!state.query && state.group && state.group !== "__recent") rows = rows.filter(r => groupsOf(r.ex).has(state.group));
      // Recherche par nom : dans toute la bibliothèque (le filtre muscle s'efface).
      if (state.equipment) rows = rows.filter(r => equipmentOf(r.ex) === state.equipment);
      const total = rows.length;
      rows = rows.slice(0, MAX_ROWS);
      list.innerHTML = rows.length ? rows.map(({ ex, via }) => {
        const guide = EXERCISE_GUIDES[ex.name];
        const sub = [t(ex.muscle_group || "Autre"), equipmentOf(ex) && t(equipmentOf(ex)), guide?.level && t(guide.level)].filter(Boolean).join(" · ");
        const isOpen = state.open === ex.name;
        const done = added.includes(ex.name);
        return `
          <div class="pk-row ${isOpen ? "open" : ""}">
            <div class="pk-main" data-toggle="${esc(ex.name)}">
              <div class="pk-name">${esc(ex.name)}${via ? ` <span class="autocomplete-via">EN</span>` : ""}</div>
              <div class="pk-sub">${esc(sub)}</div>
            </div>
            <button class="pk-info" data-toggle="${esc(ex.name)}" title="${t("Aperçu")}">${isOpen ? "▴" : "ⓘ"}</button>
            <button class="pk-add ${done ? "done" : ""}" data-add="${esc(ex.name)}" title="${t("Ajouter à la séance")}">${done ? "✓" : "＋"}</button>
          </div>
          ${isOpen ? previewHtml(ex) : ""}`;
      }).join("") + (total > MAX_ROWS ? `<p class="muted" style="font-size:12px; text-align:center;">${t("{n} autres : affine la recherche.", { n: total - MAX_ROWS })}</p>` : "")
        : `<p class="muted" style="text-align:center; margin:14px 0;">${t("Aucun exercice trouvé.")}</p>`;

      // Création d'un nouvel exercice quand le nom tapé n'existe pas.
      const q = state.query.trim();
      const exact = q && library.find(e => e.name.toLowerCase() === q.toLowerCase());
      const create = m.querySelector("#pk-create");
      create.innerHTML = q && !exact && !/[<>]/.test(q) ? `
        <div class="card" style="padding:10px; margin-top:8px;">
          <div class="muted" style="font-size:13px; margin-bottom:6px;">${t("Pas dans la liste ? Crée-le :")}</div>
          <div style="display:grid; grid-template-columns:1fr auto; gap:8px;">
            <select id="ex-group">${db.EXO_GROUPS.map(g => `<option value="${esc(g)}" ${g === guessMuscleGroup(q) ? "selected" : ""}>${esc(t(g))}</option>`).join("")}</select>
            <button class="btn btn-primary btn-sm" id="confirm-add-ex" style="width:auto;">＋ ${t("Créer « {name} »", { name: esc(q.slice(0, 40)) })}</button>
          </div>
        </div>` : exact ? `<button class="btn btn-primary" id="confirm-add-ex" style="margin-top:8px;">＋ ${t("Ajouter « {name} »", { name: esc(exact.name) })}</button>` : "";

      list.querySelectorAll("[data-toggle]").forEach(el => el.onclick = () => {
        state.open = state.open === el.dataset.toggle ? "" : el.dataset.toggle;
        draw();
        const h = list.querySelector(".pk-history");
        if (h) fillHistory(h, state.open);
        list.querySelector(".pk-row.open")?.scrollIntoView({ block: "nearest" });
      });
      list.querySelectorAll("[data-add]").forEach(el => el.onclick = (e) => {
        e.stopPropagation();
        const ex = byName.get(el.dataset.add);
        if (ex) doAdd(ex.name, ex.muscle_group, ex);
      });
      const confirmBtn = create.querySelector("#confirm-add-ex");
      if (confirmBtn) confirmBtn.onclick = () => {
        if (exact) doAdd(exact.name, exact.muscle_group, exact);
        else doAdd(q.slice(0, 80), create.querySelector("#ex-group").value, null);
        input.value = ""; state.query = "";
        draw();
      };
    };

    input.addEventListener("input", () => { state.query = input.value.trim(); state.open = ""; draw(); });
    m.querySelectorAll("[data-group]").forEach(c => c.onclick = () => {
      state.group = c.dataset.group; state.open = "";
      if (state.query) { input.value = ""; state.query = ""; }
      draw();
    });
    m.querySelectorAll("[data-equip]").forEach(c => c.onclick = () => { state.equipment = state.equipment === c.dataset.equip ? "" : c.dataset.equip; state.open = ""; draw(); });
    m.querySelector("#pk-done").onclick = closeModal;
    draw();
    // Clavier ouvert d'office seulement avec une souris (sur téléphone il
    // cacherait la liste à parcourir par muscle).
    if (window.matchMedia?.("(pointer: fine)").matches) setTimeout(() => input.focus(), 50);
  });
}
