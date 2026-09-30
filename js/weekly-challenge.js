// ============================================================
// DÉFI DE LA SEMAINE — un défi commun à tous, choisi chaque semaine par
// l'administrateur (weekly_challenges/{semaine ISO}). La progression de
// chacun est calculée sur l'appareil à partir de ses séances de la
// semaine ; seuls les participants aux défis publient leur avancement.
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, esc, isoWeek, confirmDanger } from "./utils.js";
import { getWorkouts, getExercises, getSetsForPeriod } from "./cache.js";
import { guessMuscleGroup } from "./muscles.js";
import { t, locale } from "./i18n.js";

const DAY = 86400000;
export const weekKey = (date = new Date()) => isoWeek(date.toISOString());
const MIN_SETS = 3;

// Types de défi mesurables automatiquement.
// i18n-keys: "Séances (au moins 3 séries)", "Jours d'entraînement", "Tonnage total", "Séries", "Répétitions sur un exercice", "Tonnage sur un exercice", "Séries sur un groupe musculaire", "Records personnels"
export const TYPES = {
  workouts: { label: "Séances (au moins 3 séries)", unit: "séances" },
  days: { label: "Jours d'entraînement", unit: "jours" },
  tonnage: { label: "Tonnage total", unit: "kg" },
  sets: { label: "Séries", unit: "séries" },
  exercise_reps: { label: "Répétitions sur un exercice", unit: "reps", needs: "exercise" },
  exercise_tonnage: { label: "Tonnage sur un exercice", unit: "kg", needs: "exercise" },
  muscle_sets: { label: "Séries sur un groupe musculaire", unit: "séries", needs: "muscle" },
  records: { label: "Records personnels", unit: "records" }
};
// i18n-keys: "séances", "jours", "séries", "reps", "records"
export const MUSCLES = ["Pectoraux", "Dos", "Épaules", "Jambes", "Fessiers", "Biceps", "Triceps", "Abdominaux"];

// Idées de défis proposées à l'administrateur (il en choisit une et peut
// ajuster le titre, la cible ou l'exercice avant de publier).
const IDEAS = [
  { title: "Semaine de régularité", description: "Boucle 4 séances d'au moins 3 séries cette semaine.", type: "workouts", target: 4 },
  { title: "Le club des 3", description: "3 séances cette semaine, pas une de moins.", type: "workouts", target: 3 },
  { title: "5 jours actifs", description: "Entraîne-toi 5 jours différents cette semaine.", type: "days", target: 5 },
  { title: "Opération 10 tonnes", description: "Soulève 10 000 kg au total cette semaine.", type: "tonnage", target: 10000 },
  { title: "Opération 20 tonnes", description: "Soulève 20 000 kg au total cette semaine.", type: "tonnage", target: 20000 },
  { title: "Les 60 séries", description: "Aligne 60 séries de travail dans la semaine.", type: "sets", target: 60 },
  { title: "100 pompes", description: "Cumule 100 pompes sur la semaine, en autant de séries que tu veux.", type: "exercise_reps", exercise: "Pompes", target: 100 },
  { title: "50 tractions", description: "Cumule 50 tractions sur la semaine.", type: "exercise_reps", exercise: "Tractions", target: 50 },
  { title: "Semaine jambes", description: "Au moins 20 séries de jambes cette semaine. Pas d'excuse.", type: "muscle_sets", muscle: "Jambes", target: 20 },
  { title: "Dos en V", description: "18 séries de dos dans la semaine.", type: "muscle_sets", muscle: "Dos", target: 18 },
  { title: "Épaules de roc", description: "15 séries d'épaules dans la semaine.", type: "muscle_sets", muscle: "Épaules", target: 15 },
  { title: "Bras d'acier", description: "12 séries de biceps cette semaine.", type: "muscle_sets", muscle: "Biceps", target: 12 },
  { title: "Squat 3 tonnes", description: "3 000 kg cumulés au squat cette semaine.", type: "exercise_tonnage", exercise: "Squat (Barre)", target: 3000 },
  { title: "Développé couché 2 tonnes", description: "2 000 kg cumulés au développé couché cette semaine.", type: "exercise_tonnage", exercise: "Développé Couché (Barre)", target: 2000 },
  { title: "Soulevé de terre 3 tonnes", description: "3 000 kg cumulés au soulevé de terre cette semaine.", type: "exercise_tonnage", exercise: "Soulevé de Terre (Barre)", target: 3000 },
  { title: "Chasseur de records", description: "Bats au moins un record personnel cette semaine.", type: "records", target: 1 },
  { title: "Gainage de fer", description: "10 séries d'abdos cette semaine.", type: "muscle_sets", muscle: "Abdominaux", target: 10 },
  { title: "Dips en série", description: "Cumule 60 dips cette semaine.", type: "exercise_reps", exercise: "Dips (Pectoraux)", target: 60 }
];

export function proposals(count = 6, exclude = []) {
  const pool = IDEAS.filter(i => !exclude.includes(i.title));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, count);
}

export function describeTarget(c) {
  const ty = TYPES[c.type];
  if (!ty) return "";
  const n = Number(c.target || 0).toLocaleString(locale());
  const what = ty.needs === "exercise" ? ` · ${c.exercise}` : ty.needs === "muscle" ? ` · ${t(c.muscle)}` : "";
  return `${n} ${t(ty.unit)}${what}`;
}

// Progression de l'utilisateur connecté sur le défi (semaine du défi).
export async function myProgress(c) {
  if (!c || !TYPES[c.type]) return 0;
  const inWeek = (iso) => iso && weekKey(new Date(iso)) === c.week;
  const workouts = (await getWorkouts()).filter(w => w.end_time && inWeek(w.start_time));
  switch (c.type) {
    case "workouts": return workouts.filter(w => (w.total_sets ?? MIN_SETS) >= MIN_SETS).length;
    case "days": return new Set(workouts.map(w => new Date(w.start_time).toDateString())).size;
    case "tonnage": return Math.round(workouts.reduce((a, w) => a + (w.total_tonnage || 0), 0));
    case "sets": return workouts.reduce((a, w) => a + (w.total_sets || 0), 0);
    case "records": return workouts.reduce((a, w) => a + (w.records?.length || 0), 0);
  }
  // Séries de la semaine (les 2 dernières semaines suffisent).
  const ids = new Set(workouts.map(w => w.id));
  const sets = (await getSetsForPeriod(2)).filter(s => (s.workout_id ? ids.has(s.workout_id) : inWeek(s.workout_start_time)) && s.set_type !== "warmup");
  if (c.type === "exercise_reps" || c.type === "exercise_tonnage") {
    const name = String(c.exercise || "").toLowerCase();
    const mine = sets.filter(s => String(s.exercise_title || "").toLowerCase() === name);
    return c.type === "exercise_reps"
      ? mine.reduce((a, s) => a + (s.reps || 0), 0)
      : Math.round(mine.reduce((a, s) => a + (s.weight_kg || 0) * (s.reps || 0), 0));
  }
  if (c.type === "muscle_sets") {
    const lib = await getExercises().catch(() => []);
    const group = (n) => lib.find(e => e.name === n)?.muscle_group || guessMuscleGroup(n);
    return sets.filter(s => (s.reps || 0) > 0 && group(s.exercise_title) === c.muscle).length;
  }
  return 0;
}

// ---------- Affichage (onglet Feed → Défis) ----------
export async function weeklyChallengeHtml() {
  const wk = weekKey();
  const c = await db.getWeeklyChallenge(wk).catch(() => null);
  const admin = db.isAdmin();
  if (!c && !admin) return { html: "", challenge: null };
  if (!c) {
    return { challenge: null, html: `
      <div class="card wc-card">
        <div class="card-title">🎯 ${t("Défi de la semaine")}</div>
        <p class="muted" style="margin-top:0;">${t("Pas encore de défi cette semaine.")}</p>
        <button class="btn btn-primary btn-sm" data-wc-edit="${wk}">✏️ ${t("Choisir le défi de la semaine")}</button>
      </div>` };
  }
  const value = await myProgress(c).catch(() => 0);
  const pct = Math.min(100, Math.round(value / Math.max(1, c.target) * 100));
  const done = value >= c.target;
  const left = Math.max(0, Math.ceil((new Date(weekEnd(wk)) - Date.now()) / DAY));
  return { challenge: { ...c, value, done }, html: `
    <div class="card wc-card ${done ? "wc-done" : ""}">
      <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
        <div class="card-title" style="margin-bottom:2px;">🎯 ${esc(c.title)}</div>
        ${admin ? `<button class="btn btn-secondary btn-sm" data-wc-edit="${wk}" style="width:auto;">✏️</button>` : ""}
      </div>
      <div class="muted" style="font-size:12px; margin-bottom:8px;">${t("Défi de la semaine")} · ${esc(describeTarget(c))} · ${left > 1 ? t("encore {n} jours", { n: left }) : t("dernier jour")}</div>
      ${c.description ? `<p style="margin:0 0 10px; font-size:14px;">${esc(c.description)}</p>` : ""}
      <div class="wc-bar"><div style="width:${pct}%"></div></div>
      <div style="display:flex; justify-content:space-between; font-size:13px; margin-top:6px;">
        <span>${done ? `✅ ${t("Défi réussi !")}` : t("Ta progression")}</span>
        <b>${Number(value).toLocaleString(locale())} / ${Number(c.target).toLocaleString(locale())}</b>
      </div>
      ${admin ? `<button class="btn btn-secondary btn-sm" data-wc-edit="${weekKey(new Date(Date.now() + 7 * DAY))}" style="margin-top:10px;">📅 ${t("Préparer le défi de la semaine prochaine")}</button>` : ""}
    </div>` };
}

// Dimanche soir de la semaine ISO (pour « encore n jours »).
function weekEnd(wk) {
  const d = new Date();
  const sunday = new Date(d); sunday.setHours(23, 59, 59, 0); sunday.setDate(d.getDate() + (7 - ((d.getDay() + 6) % 7) - 1));
  return weekKey(d) === wk ? sunday : new Date(sunday.getTime() + 7 * DAY);
}

export function bindWeeklyChallenge(root, onChanged) {
  root.querySelectorAll("[data-wc-edit]").forEach(b => b.onclick = () => openChallengeEditor(b.dataset.wcEdit, onChanged));
}

// ---------- Édition (administrateur) ----------
async function openChallengeEditor(week, onChanged) {
  const [current, library] = await Promise.all([db.getWeeklyChallenge(week).catch(() => null), getExercises().catch(() => [])]);
  const names = [...new Set(library.map(e => e.name))].sort((a, b) => a.localeCompare(b, "fr"));
  const state = current ? { ...current } : { title: "", description: "", type: "workouts", target: 3, exercise: "", muscle: "Jambes" };
  let ideas = proposals(6);
  const isNext = week !== weekKey();
  openModal(`
    <h3>🎯 ${isNext ? t("Défi de la semaine prochaine") : t("Défi de cette semaine")}</h3>
    <p class="muted" style="margin-top:0; font-size:13px;">${t("Semaine {n}", { n: esc(week.split("-W")[1]) })} · ${t("Choisis une proposition ou écris le tien. Il s'affiche pour tout le monde dans Feed → Défis.")}</p>
    <div id="wc-ideas"></div>
    <button class="btn btn-secondary btn-sm" id="wc-more" style="margin:6px 0 12px;">↻ ${t("Autres propositions")}</button>
    <label>${t("Titre")}</label><input id="wc-title" maxlength="60">
    <label>${t("Description")}</label><textarea id="wc-desc" maxlength="200" rows="2"></textarea>
    <label>${t("Mesure")}</label>
    <select id="wc-type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${t(v.label)}</option>`).join("")}</select>
    <div id="wc-ex-row"><label>${t("Exercice")}</label><input id="wc-ex" list="wc-ex-list"><datalist id="wc-ex-list">${names.map(n => `<option value="${esc(n)}">`).join("")}</datalist></div>
    <div id="wc-mu-row"><label>${t("Groupe musculaire")}</label><select id="wc-mu">${MUSCLES.map(m => `<option value="${esc(m)}">${esc(t(m))}</option>`).join("")}</select></div>
    <label>${t("Objectif")} <span class="muted" id="wc-unit"></span></label><input id="wc-target" type="number" min="1" max="1000000" inputmode="numeric">
    <p class="muted" id="wc-err" style="color:var(--red); min-height:1em;"></p>
    <div class="btn-row">
      ${current ? `<button class="btn btn-danger" id="wc-del">${t("Supprimer")}</button>` : `<button class="btn btn-secondary" id="wc-cancel">${t("Annuler")}</button>`}
      <button class="btn btn-primary" id="wc-save">${t("Publier")}</button>
    </div>
  `, (m) => {
    const $ = (id) => m.querySelector(id);
    const fill = () => {
      $("#wc-title").value = state.title || ""; $("#wc-desc").value = state.description || "";
      $("#wc-type").value = state.type; $("#wc-ex").value = state.exercise || ""; $("#wc-mu").value = state.muscle || "Jambes";
      $("#wc-target").value = state.target || ""; sync();
    };
    const sync = () => {
      const ty = TYPES[$("#wc-type").value];
      $("#wc-ex-row").hidden = ty.needs !== "exercise";
      $("#wc-mu-row").hidden = ty.needs !== "muscle";
      $("#wc-unit").textContent = `(${t(ty.unit)})`;
    };
    const drawIdeas = () => {
      $("#wc-ideas").innerHTML = ideas.map((i, k) => `
        <button type="button" class="wc-idea" data-idea="${k}">
          <b>${esc(i.title)}</b><small>${esc(describeTarget(i))}</small>
        </button>`).join("");
      m.querySelectorAll("[data-idea]").forEach(b => b.onclick = () => {
        const i = ideas[+b.dataset.idea];
        Object.assign(state, { title: i.title, description: i.description, type: i.type, target: i.target, exercise: i.exercise || "", muscle: i.muscle || "Jambes" });
        m.querySelectorAll("[data-idea]").forEach(x => x.classList.toggle("sel", x === b));
        fill();
      });
    };
    drawIdeas(); fill();
    $("#wc-type").onchange = sync;
    $("#wc-more").onclick = () => { ideas = proposals(6, ideas.map(i => i.title)); drawIdeas(); };
    const cancel = $("#wc-cancel"); if (cancel) cancel.onclick = closeModal;
    const del = $("#wc-del");
    if (del) del.onclick = async () => {
      if (!await confirmDanger({ title: t("Supprimer le défi de la semaine ?"), message: t("Il disparaîtra pour tout le monde."), cancelLabel: t("Garder"), confirmLabel: t("Supprimer") })) return;
      await db.deleteWeeklyChallenge(week); closeModal(); toast(t("Défi supprimé")); onChanged();
    };
    $("#wc-save").onclick = async (e) => {
      const type = $("#wc-type").value, ty = TYPES[type];
      const data = {
        week, type,
        title: $("#wc-title").value.trim().slice(0, 60),
        description: $("#wc-desc").value.trim().slice(0, 200),
        target: Math.round(Number($("#wc-target").value)),
        exercise: ty.needs === "exercise" ? $("#wc-ex").value.trim().slice(0, 80) : "",
        muscle: ty.needs === "muscle" ? $("#wc-mu").value : ""
      };
      const err = $("#wc-err");
      if (!data.title) { err.textContent = t("Donne un titre au défi."); return; }
      if (/[<>]/.test(data.title + data.description + data.exercise)) { err.textContent = t("Les caractères < et > ne sont pas autorisés."); return; }
      if (!(data.target >= 1)) { err.textContent = t("Indique un objectif (nombre)."); return; }
      if (ty.needs === "exercise" && !data.exercise) { err.textContent = t("Choisis l'exercice."); return; }
      e.target.disabled = true;
      try {
        await db.saveWeeklyChallenge(week, data);
        closeModal();
        toast(t("Défi publié") + " 🎯");
        onChanged();
      } catch (ex) {
        console.error("[Skullcrusher] Défi de la semaine", ex);
        err.textContent = t("Publication impossible (règles Firestore à jour ?)");
        e.target.disabled = false;
      }
    };
  });
}
