// ============================================================
// IMPORT / EXPORT DE PLAN D'ENTRAÎNEMENT — fichier CSV (Excel, Numbers,
// Google Sheets) : une ligne par exercice, regroupées en routines par la
// colonne « routine ». Les routines importées sont des routines normales,
// modifiables ensuite dans l'app. Le même format sert à l'export, pour
// modifier ses routines dans un tableur puis les réimporter.
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, esc } from "./utils.js";
import { getExercises, getRoutines, invalidate } from "./cache.js";
import { guessMuscleGroup } from "./muscles.js";
import { t } from "./i18n.js";

export const PLAN_TEMPLATE_URL = "modele-plan-entrainement.csv";
const COLUMNS = ["routine", "exercice", "series", "reps", "repos", "groupe", "description", "niveau", "objectif"];

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// En-têtes acceptés (français ou anglais, accents et majuscules ignorés).
const HEADER_ALIASES = {
  routine: ["routine", "seance", "jour", "day", "workout", "nom routine", "nom de la routine"],
  exercice: ["exercice", "exercise", "exercise name", "exercise_name", "mouvement", "nom exercice"],
  series: ["series", "sets", "nb series", "nombre de series", "target_sets"],
  reps: ["reps", "repetitions", "reps cible", "reps_target", "rep"],
  repos: ["repos", "repos (s)", "repos_s", "repos s", "rest", "rest_seconds", "rest (s)", "recuperation"],
  groupe: ["groupe", "groupe musculaire", "groupe_musculaire", "muscle", "muscles", "muscle_group", "muscle group"],
  description: ["description", "notes", "note"],
  niveau: ["niveau", "level"],
  objectif: ["objectif", "goal", "but"]
};
function columnOf(header) {
  const h = norm(header).replace(/[_]/g, " ").replace(/\s+/g, " ");
  for (const [col, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.some(a => norm(a).replace(/_/g, " ") === h)) return col;
  return null;
}

// "90", "90s", "1:30", "2 min", "1min30" -> secondes.
function parseRest(v) {
  const s = norm(v).replace(",", ".");
  if (!s) return null;
  let m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:min|mn|m)\s*(\d+)?\s*(?:s|sec)?$/);
  if (m) return Math.round(+m[1] * 60 + (+m[2] || 0));
  m = s.match(/^(\d+)\s*(?:s|sec|secondes?|seconds?)?$/);
  return m ? +m[1] : null;
}

function keyFromLabel(map, value) {
  const v = norm(value);
  if (!v) return "";
  if (map[v] !== undefined) return v;
  const hit = Object.entries(map).find(([k, label]) => norm(label) === v || norm(label).startsWith(v) || norm(k).startsWith(v) || v.startsWith(norm(k)));
  return hit ? hit[0] : "";
}

function groupFrom(value) {
  const v = norm(value);
  if (!v) return null;
  return db.EXO_GROUPS.find(g => norm(g) === v || norm(t(g)) === v) || null;
}

// Analyse le texte CSV. Renvoie { routines, warnings, error }.
export function parsePlanCsv(text, library = []) {
  const parsed = Papa.parse(String(text || "").replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: h => h.trim() });
  const colMap = {};
  (parsed.meta.fields || []).forEach(f => { const c = columnOf(f); if (c && !colMap[c]) colMap[c] = f; });
  if (!colMap.exercice) return { error: t("Colonne « exercice » introuvable. Pars du modèle à télécharger ci-dessus.") };
  const get = (row, col) => (colMap[col] ? String(row[colMap[col]] ?? "").trim() : "");
  const byName = new Map();
  const warnings = [];
  let current = "";
  parsed.data.forEach((row, i) => {
    const line = i + 2;
    const name = get(row, "exercice");
    current = get(row, "routine") || current; // routine vide = même routine que la ligne du dessus
    if (!name) return;
    if (!current) { warnings.push(t("Ligne {n} : pas de routine, ignorée.", { n: line })); return; }
    if (/[<>]/.test(name + current) || name.length > 80 || current.length > 80) { warnings.push(t("Ligne {n} : nom trop long ou caractères < > interdits, ignorée.", { n: line })); return; }
    if (!byName.has(current)) byName.set(current, { name: current, description: "", level: "", goal: "", exercises: [] });
    const r = byName.get(current);
    r.description = r.description || get(row, "description").slice(0, 500).replace(/[<>]/g, "");
    r.level = r.level || keyFromLabel(db.ROUTINE_LEVELS, get(row, "niveau"));
    r.goal = r.goal || keyFromLabel(db.ROUTINE_GOALS, get(row, "objectif"));
    const sets = parseInt(get(row, "series"), 10);
    const rest = parseRest(get(row, "repos"));
    const known = library.find(x => x.name.toLowerCase() === name.toLowerCase());
    r.exercises.push({
      exercise_name: known ? known.name : name,
      target_sets: sets >= 1 && sets <= 20 ? sets : 3,
      reps_target: (get(row, "reps") || "8-10").slice(0, 12).replace(/[<>]/g, ""),
      rest_seconds: rest != null && rest >= 0 && rest <= 900 ? rest : 90,
      muscle_group: groupFrom(get(row, "groupe")) || known?.muscle_group || guessMuscleGroup(name)
    });
    if (get(row, "series") && !(sets >= 1 && sets <= 20)) warnings.push(t("Ligne {n} : séries invalides, 3 par défaut.", { n: line }));
    if (get(row, "repos") && rest == null) warnings.push(t("Ligne {n} : repos illisible, 90 s par défaut.", { n: line }));
  });
  const routines = [...byName.values()].filter(r => r.exercises.length);
  if (!routines.length) return { error: t("Aucun exercice trouvé dans ce fichier.") };
  return { routines, warnings };
}

// Routines -> CSV (séparateur « ; » et BOM pour qu'Excel l'ouvre correctement).
export function planCsvFromRoutines(routines) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [COLUMNS.join(";")];
  routines.forEach(r => (r.exercises || []).forEach((e, i) => rows.push([
    r.name, e.exercise_name, e.target_sets, e.reps_target, e.rest_seconds, e.muscle_group || "",
    i === 0 ? r.description || "" : "", i === 0 ? db.ROUTINE_LEVELS[r.level] || "" : "", i === 0 ? db.ROUTINE_GOALS[r.goal] || "" : ""
  ].map(cell).join(";"))));
  return "﻿" + rows.join("\r\n") + "\r\n";
}

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportPlan() {
  const routines = await getRoutines();
  if (!routines.length) { toast(t("Pas encore de routine.")); return; }
  downloadText("mes-routines-skullcrusher.csv", planCsvFromRoutines(routines));
}

export function openPlanImport(onDone) {
  let plan = null;
  openModal(`
    <h3>📥 ${t("Importer un plan d'entraînement")}</h3>
    <p class="muted" style="margin-top:0;">${t("Remplis le modèle dans Excel, Numbers ou Google Sheets (une ligne par exercice), enregistre-le en CSV puis importe-le. Chaque routine devient une routine de l'app, modifiable ensuite.")}</p>
    <a class="btn btn-secondary btn-sm" href="${PLAN_TEMPLATE_URL}" download>⬇️ ${t("Télécharger le modèle")}</a>
    <details style="margin:10px 0;">
      <summary class="muted" style="cursor:pointer;">${t("Colonnes du fichier")}</summary>
      <ul class="muted" style="font-size:13px; padding-left:18px; line-height:1.5;">
        <li><b>routine</b> — ${t("nom de la routine (vide = même routine que la ligne du dessus)")}</li>
        <li><b>exercice</b> — ${t("nom de l'exercice (obligatoire) ; reprends si possible un nom de la bibliothèque")}</li>
        <li><b>series</b> — ${t("nombre de séries (3 par défaut)")}</li>
        <li><b>reps</b> — ${t("répétitions visées : 10, 8-12, AMRAP…")}</li>
        <li><b>repos</b> — ${t("repos : 90, 90s, 1:30 ou 2min")}</li>
        <li><b>groupe</b> — ${t("groupe musculaire (facultatif, deviné sinon)")}</li>
        <li><b>description, niveau, objectif</b> — ${t("facultatifs, sur la 1re ligne de la routine")}</li>
      </ul>
    </details>
    <input type="file" id="plan-file" accept=".csv,text/csv,text/plain">
    <div id="plan-preview" style="margin-top:10px;"></div>
    <label class="list-row" style="cursor:pointer; margin-top:6px;">
      <span>${t("Remplacer mes routines du même nom")}</span>
      <input type="checkbox" id="plan-replace" checked style="width:auto;">
    </label>
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-secondary" id="plan-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="plan-ok" disabled>${t("Importer")}</button>
    </div>
  `, (m) => {
    const preview = m.querySelector("#plan-preview");
    const ok = m.querySelector("#plan-ok");
    m.querySelector("#plan-cancel").onclick = closeModal;
    m.querySelector("#plan-file").onchange = async (e) => {
      const file = e.target.files[0];
      plan = null; ok.disabled = true; preview.innerHTML = "";
      if (!file) return;
      const res = parsePlanCsv(await file.text(), await getExercises());
      if (res.error) { preview.innerHTML = `<p style="color:var(--red);">${esc(res.error)}</p>`; return; }
      plan = res.routines;
      preview.innerHTML = `
        ${plan.map(r => `<div class="list-row" style="cursor:default; display:block;">
          <div class="list-row-title">${esc(r.name)}</div>
          <div class="list-row-sub">${r.exercises.map(x => `${esc(x.exercise_name)} ${esc(x.target_sets)}×${esc(x.reps_target)}`).join(" · ")}</div>
        </div>`).join("")}
        ${res.warnings.length ? `<p class="muted" style="font-size:12px;">⚠️ ${res.warnings.slice(0, 5).map(esc).join("<br>")}${res.warnings.length > 5 ? "<br>…" : ""}</p>` : ""}`;
      ok.disabled = false;
      ok.textContent = plan.length > 1 ? t("Importer {n} routines", { n: plan.length }) : t("Importer 1 routine");
    };
    ok.onclick = async () => {
      if (!plan) return;
      ok.disabled = true;
      const replace = m.querySelector("#plan-replace").checked;
      try {
        const mine = await getRoutines();
        for (const r of plan) {
          const existing = replace ? mine.find(x => x.name.toLowerCase() === r.name.toLowerCase() && !x.source) || mine.find(x => x.name.toLowerCase() === r.name.toLowerCase()) : null;
          await db.saveRoutine({
            ...r,
            description: r.description || existing?.description || "",
            level: r.level || existing?.level || "",
            goal: r.goal || existing?.goal || "",
            playlist_url: existing?.playlist_url || ""
          }, existing?.id || null);
        }
        invalidate("routines");
        closeModal();
        toast(t("{n} routine(s) importée(s) — modifiables dans Mes routines", { n: plan.length }), 3500);
        if (onDone) await onDone();
      } catch (err) {
        console.error("[Skullcrusher] Import de plan", err);
        toast(t("Impossible d'enregistrer la routine"));
        ok.disabled = false;
      }
    };
  });
}
