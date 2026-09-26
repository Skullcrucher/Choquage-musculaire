// ============================================================
// IMPORT / EXPORT DE PLAN D'ENTRAÎNEMENT — fichier CSV (Excel, Numbers,
// Google Sheets), une ligne par exercice :
//   - les routines (colonne « routine ») avec leurs exercices, séries,
//     reps, charge visée, repos ;
//   - facultatif, le calendrier : plan, début, blocs de N semaines et
//     jours de la semaine de chaque routine dans chaque bloc.
// Tout devient des routines et un plan normaux, modifiables dans l'app.
// L'export produit le même format (routines + plan actif) pour faire des
// allers-retours avec un tableur.
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, esc } from "./utils.js";
import { getExercises, getRoutines, invalidate } from "./cache.js";
import { guessMuscleGroup } from "./muscles.js";
import { t, locale } from "./i18n.js";
import { getPlans, savePlans, dayStr, mondayOf, MAX_PLANS } from "./plans.js";

export const PLAN_TEMPLATE_URL = "modele-plan-entrainement.csv";
const COLUMNS = ["plan", "debut", "bloc", "semaines", "jours", "routine", "exercice", "series", "reps", "charge", "repos", "groupe", "description", "niveau", "objectif"];

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// En-têtes acceptés (français ou anglais, accents et majuscules ignorés).
const HEADER_ALIASES = {
  plan: ["plan", "programme", "program", "nom du plan"],
  debut: ["debut", "date de debut", "start", "start date", "start_date"],
  bloc: ["bloc", "block", "phase", "cycle"],
  semaines: ["semaines", "nb semaines", "weeks", "duree (semaines)", "duree"],
  jours: ["jours", "jour", "days", "day", "jours de la semaine"],
  routine: ["routine", "seance", "workout", "nom routine", "nom de la routine"],
  exercice: ["exercice", "exercise", "exercise name", "exercise_name", "mouvement", "nom exercice"],
  series: ["series", "sets", "nb series", "nombre de series", "target_sets"],
  reps: ["reps", "repetitions", "reps cible", "reps_target", "rep"],
  charge: ["charge", "poids", "kg", "charge (kg)", "poids (kg)", "weight", "load", "target_kg"],
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

// "80", "80 kg", "82,5" -> 82.5 (null si vide ou illisible).
function parseKg(v) {
  const s = norm(v).replace(",", ".").replace(/\s*kg$/, "");
  if (!s) return null;
  const n = parseFloat(s);
  return /^\d+(\.\d+)?$/.test(s) && n >= 0 && n <= 1000 ? n : NaN;
}

// "lundi, jeudi", "lun+jeu", "1,4", "mon/thu" -> [1, 4] (1 = lundi … 7 = dimanche).
const DAY_NAMES = {
  1: ["lundi", "lun", "lu", "monday", "mon", "mo", "poniedzialek", "pon", "lindi"],
  2: ["mardi", "mar", "ma", "tuesday", "tue", "tu", "wtorek", "wt", "mardi"],
  3: ["mercredi", "mer", "me", "wednesday", "wed", "we", "sroda", "sr", "merkredi"],
  4: ["jeudi", "jeu", "je", "thursday", "thu", "th", "czwartek", "czw", "zedi"],
  5: ["vendredi", "ven", "ve", "friday", "fri", "fr", "piatek", "pt", "vandredi"],
  6: ["samedi", "sam", "sa", "saturday", "sat", "sobota", "sob", "samdi"],
  7: ["dimanche", "dim", "di", "sunday", "sun", "su", "niedziela", "nd", "dimans"]
};
function parseDays(v) {
  const tokens = norm(v).split(/[\s,;+/&]+|\bet\b|\band\b/).filter(Boolean);
  const out = [];
  for (const tok of tokens) {
    const n = /^[1-7]$/.test(tok) ? +tok : +(Object.entries(DAY_NAMES).find(([, names]) => names.includes(tok))?.[0] || 0);
    if (!n) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// "2026-10-05", "05/10/2026", "5/10/26" -> "2026-10-05".
function parseStart(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
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

// Analyse le texte CSV. Renvoie { routines, plan, warnings } ou { error }.
// plan = null si le fichier ne contient pas de calendrier (colonne jours).
export function parsePlanCsv(text, library = []) {
  const parsed = Papa.parse(String(text || "").replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: h => h.trim() });
  const colMap = {};
  (parsed.meta.fields || []).forEach(f => { const c = columnOf(f); if (c && !colMap[c]) colMap[c] = f; });
  if (!colMap.exercice) return { error: t("Colonne « exercice » introuvable. Pars du modèle à télécharger ci-dessus.") };
  const get = (row, col) => (colMap[col] ? String(row[colMap[col]] ?? "").trim() : "");
  const byName = new Map();
  const blocks = [];          // [{ name, weeks, days: { dow: routineName } }]
  const warnings = [];
  let current = "", currentBlock = null, planName = "", start = null;
  parsed.data.forEach((row, i) => {
    const line = i + 2;
    planName = planName || get(row, "plan").slice(0, 60).replace(/[<>]/g, "");
    if (!start && get(row, "debut")) {
      start = parseStart(get(row, "debut"));
      if (!start) warnings.push(t("Ligne {n} : date de début illisible (ex. 2026-10-05 ou 05/10/2026).", { n: line }));
    }
    // Bloc : vide = même bloc que la ligne du dessus.
    const blockName = get(row, "bloc").slice(0, 40).replace(/[<>]/g, "");
    if (blockName && blockName !== currentBlock?.name) {
      currentBlock = blocks.find(b => b.name === blockName) || null;
      if (!currentBlock) { currentBlock = { name: blockName, weeks: 0, days: {} }; blocks.push(currentBlock); }
    }
    const weeks = parseInt(get(row, "semaines"), 10);
    if (get(row, "semaines")) {
      if (!currentBlock) { currentBlock = { name: t("Bloc 1"), weeks: 0, days: {} }; blocks.push(currentBlock); }
      if (weeks >= 1 && weeks <= 52) currentBlock.weeks = weeks;
      else warnings.push(t("Ligne {n} : nombre de semaines invalide (1 à 52).", { n: line }));
    }

    const name = get(row, "exercice");
    const routineCell = get(row, "routine");
    current = routineCell || current; // routine vide = même routine que la ligne du dessus
    if (!current && (name || get(row, "jours"))) { warnings.push(t("Ligne {n} : pas de routine, ignorée.", { n: line })); return; }
    if (/[<>]/.test(name + current) || name.length > 80 || current.length > 80) { warnings.push(t("Ligne {n} : nom trop long ou caractères < > interdits, ignorée.", { n: line })); return; }

    // Jours de la routine dans le bloc courant.
    if (get(row, "jours")) {
      const days = parseDays(get(row, "jours"));
      if (!days) warnings.push(t("Ligne {n} : jours illisibles (ex. « lundi, jeudi » ou « 1,4 »).", { n: line }));
      else {
        if (!currentBlock) { currentBlock = { name: t("Bloc 1"), weeks: 0, days: {} }; blocks.push(currentBlock); }
        days.forEach(d => {
          if (currentBlock.days[d] && currentBlock.days[d] !== current) warnings.push(t("Ligne {n} : deux routines le même jour dans « {block} », la dernière est gardée.", { n: line, block: currentBlock.name }));
          currentBlock.days[d] = current;
        });
      }
    }

    if (!name) return;
    if (!byName.has(current)) byName.set(current, { name: current, description: "", level: "", goal: "", exercises: [], block: currentBlock?.name || "" });
    const r = byName.get(current);
    // Une routine déjà décrite dans un bloc précédent est réutilisée telle quelle.
    if (r.block && currentBlock && r.block !== currentBlock.name && r.exercises.length && routineCell) {
      warnings.push(t("Ligne {n} : « {routine} » est déjà décrite plus haut, exercice ignoré (donne-lui un autre nom pour une variante).", { n: line, routine: current }));
      return;
    }
    r.description = r.description || get(row, "description").slice(0, 500).replace(/[<>]/g, "");
    r.level = r.level || keyFromLabel(db.ROUTINE_LEVELS, get(row, "niveau"));
    r.goal = r.goal || keyFromLabel(db.ROUTINE_GOALS, get(row, "objectif"));
    const sets = parseInt(get(row, "series"), 10);
    const rest = parseRest(get(row, "repos"));
    const kg = parseKg(get(row, "charge"));
    const known = library.find(x => x.name.toLowerCase() === name.toLowerCase());
    r.exercises.push({
      exercise_name: known ? known.name : name,
      target_sets: sets >= 1 && sets <= 20 ? sets : 3,
      reps_target: (get(row, "reps") || "8-10").slice(0, 12).replace(/[<>]/g, ""),
      rest_seconds: rest != null && rest >= 0 && rest <= 900 ? rest : 90,
      target_kg: Number.isFinite(kg) ? kg : null,
      muscle_group: groupFrom(get(row, "groupe")) || known?.muscle_group || guessMuscleGroup(name)
    });
    if (get(row, "series") && !(sets >= 1 && sets <= 20)) warnings.push(t("Ligne {n} : séries invalides, 3 par défaut.", { n: line }));
    if (get(row, "repos") && rest == null) warnings.push(t("Ligne {n} : repos illisible, 90 s par défaut.", { n: line }));
    if (Number.isNaN(kg)) warnings.push(t("Ligne {n} : charge illisible, ignorée.", { n: line }));
  });
  const routines = [...byName.values()].filter(r => r.exercises.length);
  if (!routines.length) return { error: t("Aucun exercice trouvé dans ce fichier.") };

  let plan = null;
  const scheduled = blocks.filter(b => Object.keys(b.days).length);
  if (scheduled.length) {
    const names = new Set(routines.map(r => r.name));
    scheduled.forEach(b => Object.entries(b.days).forEach(([d, rn]) => {
      if (!names.has(rn)) { warnings.push(t("« {routine} » est prévue dans le plan mais n'a aucun exercice : jour ignoré.", { routine: rn })); delete b.days[d]; }
    }));
    blocks.forEach(b => { if (!b.weeks) { b.weeks = 4; warnings.push(t("Bloc « {block} » : durée absente, 4 semaines par défaut.", { block: b.name })); } });
    const next = mondayOf(new Date()); if (next < new Date(new Date().toDateString())) next.setDate(next.getDate() + 7);
    plan = { name: planName || t("Plan importé"), start_date: start || dayStr(next), blocks: blocks.filter(b => b.weeks) };
  }
  routines.forEach(r => delete r.block);
  return { routines, plan, warnings };
}

// Routines (+ plan actif) -> CSV (séparateur « ; » et BOM pour qu'Excel
// l'ouvre correctement).
export function planCsvFromRoutines(routines, plan = null) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dayName = (d) => DAY_NAMES[d][0];
  const rows = [COLUMNS.join(";")];
  const push = (o) => rows.push(COLUMNS.map(c => cell(o[c] ?? "")).join(";"));
  const routineRows = (r, sched) => (r.exercises || []).forEach((e, i) => push({
    ...(i === 0 ? sched : {}),
    routine: r.name, exercice: e.exercise_name, series: e.target_sets, reps: e.reps_target,
    charge: e.target_kg ?? "", repos: e.rest_seconds, groupe: e.muscle_group || "",
    description: i === 0 ? r.description || "" : "", niveau: i === 0 ? db.ROUTINE_LEVELS[r.level] || "" : "", objectif: i === 0 ? db.ROUTINE_GOALS[r.goal] || "" : ""
  }));
  const written = new Set();
  if (plan) {
    (plan.blocks || []).forEach((b, bi) => {
      const byRoutine = {};
      Object.entries(b.days || {}).forEach(([d, id]) => (byRoutine[id] = byRoutine[id] || []).push(+d));
      let first = true;
      Object.entries(byRoutine).forEach(([id, days]) => {
        const r = routines.find(x => x.id === id);
        if (!r) return;
        const sched = { plan: bi === 0 && first ? plan.name : "", debut: bi === 0 && first ? plan.start_date : "", bloc: b.name || t("Bloc {n}", { n: bi + 1 }), semaines: first ? b.weeks : "", jours: days.sort().map(dayName).join(", ") };
        first = false;
        if (written.has(id)) push({ ...sched, routine: r.name });
        else { routineRows(r, sched); written.add(id); }
      });
    });
  }
  routines.filter(r => !written.has(r.id)).forEach(r => routineRows(r, {}));
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
  const [routines, { plans, active }] = await Promise.all([getRoutines(), getPlans()]);
  if (!routines.length) { toast(t("Pas encore de routine.")); return; }
  downloadText("mon-plan-skullcrusher.csv", planCsvFromRoutines(routines, plans.find(p => p.id === active) || null));
}

const DOW_SHORT = (d) => new Date(2024, 0, d).toLocaleDateString(locale(), { weekday: "short" });

export function openPlanImport(onDone) {
  let parsed = null;
  openModal(`
    <h3>📥 ${t("Importer un plan d'entraînement")}</h3>
    <p class="muted" style="margin-top:0;">${t("Remplis le modèle dans Excel, Numbers ou Google Sheets (une ligne par exercice), enregistre-le en CSV puis importe-le. Routines, exercices, charges et calendrier sur plusieurs semaines : tout est créé et reste modifiable dans l'app.")}</p>
    <a class="btn btn-secondary btn-sm" href="${PLAN_TEMPLATE_URL}" download>⬇️ ${t("Télécharger le modèle")}</a>
    <details style="margin:10px 0;">
      <summary class="muted" style="cursor:pointer;">${t("Colonnes du fichier")}</summary>
      <ul class="muted" style="font-size:13px; padding-left:18px; line-height:1.5;">
        <li><b>plan, debut</b> — ${t("nom du plan et date de début (facultatifs, 1re ligne)")}</li>
        <li><b>bloc, semaines</b> — ${t("phase du plan et sa durée en semaines (vide = même bloc que la ligne du dessus)")}</li>
        <li><b>jours</b> — ${t("jours de la routine dans ce bloc : « lundi, jeudi » ou « 1,4 »")}</li>
        <li><b>routine</b> — ${t("nom de la routine (vide = même routine que la ligne du dessus)")}</li>
        <li><b>exercice</b> — ${t("nom de l'exercice (obligatoire) ; reprends si possible un nom de la bibliothèque")}</li>
        <li><b>series</b> — ${t("nombre de séries (3 par défaut)")}</li>
        <li><b>reps</b> — ${t("répétitions visées : 10, 8-12, AMRAP…")}</li>
        <li><b>charge</b> — ${t("charge de départ en kg (facultatif, ajustée ensuite par la progression)")}</li>
        <li><b>repos</b> — ${t("repos : 90, 90s, 1:30 ou 2min")}</li>
        <li><b>groupe</b> — ${t("groupe musculaire (facultatif, deviné sinon)")}</li>
        <li><b>description, niveau, objectif</b> — ${t("facultatifs, sur la 1re ligne de la routine")}</li>
      </ul>
      <p class="muted" style="font-size:12px;">${t("Pour réutiliser une routine dans un autre bloc, ajoute une ligne avec seulement bloc, jours et routine.")}</p>
    </details>
    <input type="file" id="plan-file" accept=".csv,text/csv,text/plain">
    <div id="plan-preview" style="margin-top:10px;"></div>
    <label class="list-row" style="cursor:pointer; margin-top:6px;">
      <span>${t("Remplacer mes routines et plans du même nom")}</span>
      <input type="checkbox" id="plan-replace" checked style="width:auto;">
    </label>
    <label class="list-row" id="plan-activate-row" style="cursor:pointer; display:none;">
      <span>${t("Activer ce plan")}</span>
      <input type="checkbox" id="plan-activate" checked style="width:auto;">
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
      parsed = null; ok.disabled = true; preview.innerHTML = "";
      if (!file) return;
      const res = parsePlanCsv(await file.text(), await getExercises());
      if (res.error) { preview.innerHTML = `<p style="color:var(--red);">${esc(res.error)}</p>`; return; }
      parsed = res;
      const pl = res.plan;
      const weeks = pl ? pl.blocks.reduce((n, b) => n + b.weeks, 0) : 0;
      preview.innerHTML = `
        ${pl ? `<div class="card" style="padding:10px; margin-bottom:8px;">
          <div class="list-row-title">📅 ${esc(pl.name)}</div>
          <div class="list-row-sub">${t("Début le {date} · {n} semaine(s)", { date: esc(pl.start_date), n: weeks })}</div>
          ${pl.blocks.map(b => `<div class="list-row-sub">• <b>${esc(b.name)}</b> (${b.weeks} ${t("sem.")}) : ${Object.entries(b.days).sort().map(([d, rn]) => `${esc(DOW_SHORT(+d))} ${esc(rn)}`).join(" · ") || t("Repos")}</div>`).join("")}
        </div>` : ""}
        ${res.routines.map(r => `<div class="list-row" style="cursor:default; display:block;">
          <div class="list-row-title">${esc(r.name)}</div>
          <div class="list-row-sub">${r.exercises.map(x => `${esc(x.exercise_name)} ${esc(x.target_sets)}×${esc(x.reps_target)}${x.target_kg != null ? ` @ ${esc(x.target_kg)} kg` : ""}`).join(" · ")}</div>
        </div>`).join("")}
        ${res.warnings.length ? `<p class="muted" style="font-size:12px;">⚠️ ${res.warnings.slice(0, 6).map(esc).join("<br>")}${res.warnings.length > 6 ? "<br>…" : ""}</p>` : ""}`;
      m.querySelector("#plan-activate-row").style.display = pl ? "" : "none";
      ok.disabled = false;
      ok.textContent = pl ? t("Importer le plan et {n} routine(s)", { n: res.routines.length })
        : res.routines.length > 1 ? t("Importer {n} routines", { n: res.routines.length }) : t("Importer 1 routine");
    };
    ok.onclick = async () => {
      if (!parsed) return;
      ok.disabled = true;
      const replace = m.querySelector("#plan-replace").checked;
      try {
        const mine = await getRoutines();
        const idByName = {};
        for (const r of parsed.routines) {
          const existing = replace ? mine.find(x => x.name.toLowerCase() === r.name.toLowerCase() && !x.source) || mine.find(x => x.name.toLowerCase() === r.name.toLowerCase()) : null;
          idByName[r.name] = await db.saveRoutine({
            ...r,
            description: r.description || existing?.description || "",
            level: r.level || existing?.level || "",
            goal: r.goal || existing?.goal || "",
            playlist_url: existing?.playlist_url || ""
          }, existing?.id || null);
        }
        invalidate("routines");
        if (parsed.plan) {
          const { plans, active } = await getPlans();
          const blocks = parsed.plan.blocks.map(b => ({ name: b.name, weeks: b.weeks, days: Object.fromEntries(Object.entries(b.days).map(([d, rn]) => [d, idByName[rn]]).filter(([, id]) => id)) }));
          const existing = replace ? plans.find(p => p.name.toLowerCase() === parsed.plan.name.toLowerCase()) : null;
          if (!existing && plans.length >= MAX_PLANS) throw new Error(t("{n} plans maximum", { n: MAX_PLANS }));
          const plan = { ...(existing || {}), id: existing?.id || "p" + Date.now().toString(36), name: parsed.plan.name, start_date: parsed.plan.start_date, blocks, created_at: existing?.created_at || new Date().toISOString() };
          const list = existing ? plans.map(p => p.id === existing.id ? plan : p) : [...plans, plan];
          await savePlans(list, m.querySelector("#plan-activate").checked ? plan.id : active);
        }
        closeModal();
        toast(parsed.plan
          ? t("Plan « {plan} » importé avec {n} routine(s) — tout est modifiable dans Routines", { plan: parsed.plan.name, n: parsed.routines.length })
          : t("{n} routine(s) importée(s) — modifiables dans Mes routines", { n: parsed.routines.length }), 4000);
        if (onDone) await onDone();
      } catch (err) {
        console.error("[Skullcrusher] Import de plan", err);
        toast(err.message || t("Impossible d'enregistrer la routine"));
        ok.disabled = false;
      }
    };
  });
}
