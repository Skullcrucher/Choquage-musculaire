// ============================================================
// MES MAX — charges maximales déclarées à la main (test de 1RM ou d'un
// max sur quelques reps), exercice par exercice et quand on veut : à la fin
// d'un plan, on les met à jour sur plusieurs séances, pas forcément en une.
// Rangées dans user_private/{uid}.max_lifts (privé) :
//   { "nom en minuscules": { name, kg, reps, one_rm, date, history: [...] } }
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, toast, esc, estimate1RM, fmtDate } from "./utils.js";
import { getRoutines, getSetsForExercise } from "./cache.js";
import { isAbsurdKg } from "./sanity.js";
import { t, tn } from "./i18n.js";

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const keyOf = (name) => String(name || "").trim().toLowerCase();

export async function getMaxLifts() {
  return (await db.getPrivateData().catch(() => null))?.max_lifts || {};
}
export async function maxFor(name) {
  return (await getMaxLifts())[keyOf(name)] || null;
}

async function saveMax(name, kg, reps, date) {
  const all = await getMaxLifts();
  const prev = all[keyOf(name)];
  const entry = { name, kg, reps, one_rm: estimate1RM(kg, reps), date };
  const history = [...(prev?.history || []), ...(prev ? [{ kg: prev.kg, reps: prev.reps, one_rm: prev.one_rm, date: prev.date }] : [])].slice(-20);
  await db.setPrivateData({ max_lifts: { [keyOf(name)]: { ...entry, history } } });
  return entry;
}

// Exercices du plan (toutes ses routines), dans l'ordre des routines.
async function planExercises(plan) {
  if (!plan) return [];
  const routines = await getRoutines();
  const ids = [...new Set((plan.blocks || []).flatMap(b => Object.values(b.days || {})).filter(Boolean))];
  const names = [];
  ids.map(id => routines.find(r => r.id === id)).filter(Boolean)
    .forEach(r => (r.exercises || []).forEach(e => { if (e.exercise_name && !names.includes(e.exercise_name)) names.push(e.exercise_name); }));
  return names;
}

// Meilleure 1RM estimée d'après l'historique (pour aider à remplir).
async function historyBest(name) {
  const sets = (await getSetsForExercise(name).catch(() => [])).filter(s => s.weight_kg > 0 && s.reps > 0 && s.reps <= 12 && s.set_type !== "warmup");
  if (!sets.length) return null;
  return sets.reduce((b, s) => estimate1RM(s.weight_kg, s.reps) > estimate1RM(b.weight_kg, b.reps) ? s : b);
}

// plan : plan (fin de plan → ses exercices) ; sinon les exercices déjà renseignés.
// only : un seul exercice (depuis sa fiche).
export async function openMaxLifts({ plan = null, only = null, onClose = null } = {}) {
  const [maxes, fromPlan] = await Promise.all([getMaxLifts(), planExercises(plan)]);
  const names = only ? [only] : [...fromPlan];
  if (!only) Object.values(maxes).forEach(m => { if (m?.name && !names.includes(m.name)) names.push(m.name); });
  const bests = new Map(await Promise.all(names.map(async n => [n, await historyBest(n)])));
  const since = plan?.start_date || null;
  const fresh = (m) => m && (!since || m.date >= since);
  const draw = () => names.map((n, i) => {
    const m = maxes[keyOf(n)];
    const b = bests.get(n);
    return `<div class="max-row ${fresh(m) ? "done" : ""}" data-i="${i}">
      <div class="max-main">
        <div class="max-name">${fresh(m) ? "✅" : "▫️"} ${esc(n)}</div>
        <div class="max-sub">${m ? t("Max : {kg} kg × {reps} (1RM ≈ {rm} kg) · {date}", { kg: esc(m.kg), reps: esc(m.reps), rm: esc(m.one_rm), date: esc(fmtDate(m.date + "T12:00")) }) : t("Pas encore de max")}
          ${b ? `<br>${t("Meilleure série enregistrée : {kg} kg × {reps} (1RM ≈ {rm} kg)", { kg: esc(b.weight_kg), reps: esc(b.reps), rm: esc(estimate1RM(b.weight_kg, b.reps)) })}` : ""}</div>
      </div>
      <button class="btn btn-secondary btn-sm" data-edit="${i}">${m ? t("Mettre à jour") : t("Renseigner")}</button>
      <div class="max-form" data-form="${i}" hidden>
        <div class="field-row">
          <div><label>${t("Charge (kg)")}</label><input type="number" inputmode="decimal" step="0.5" data-kg value="${esc(b?.weight_kg && b.reps === 1 ? b.weight_kg : "")}"></div>
          <div><label>${t("Reps")}</label><input type="number" inputmode="numeric" min="1" max="12" data-reps value="1"></div>
          <div><label>${t("Date")}</label><input type="date" data-date value="${today()}"></div>
        </div>
        <p class="muted max-err" style="color:var(--red); min-height:1em; margin:4px 0;"></p>
        <button class="btn btn-primary btn-sm" data-save="${i}">${t("Enregistrer ce max")}</button>
      </div>
    </div>`;
  }).join("");
  const count = () => names.filter(n => fresh(maxes[keyOf(n)])).length;

  openModal(`
    <h3>📏 ${t("Mes max")}</h3>
    <p class="muted" style="margin-top:-6px;">${plan
      ? t("Fin de plan : teste tes max exercice par exercice, quand tu veux, sur une ou plusieurs séances. Chaque max est enregistré dès que tu le saisis.")
      : t("Tes charges maximales (1RM, ou ton max sur quelques reps), exercice par exercice.")}</p>
    ${plan ? `<div class="max-progress" id="max-progress"></div>` : ""}
    <div id="max-list">${names.length ? draw() : `<p class="muted">${t("Aucun exercice : renseigne un max depuis la fiche d'un exercice.")}</p>`}</div>
    <button class="btn btn-secondary" id="max-close" style="margin-top:12px;">${t("Fermer")}</button>
  `, (m) => {
    const progress = () => {
      const el = m.querySelector("#max-progress");
      if (el) el.innerHTML = `<b>${count()}/${names.length}</b> ${t("max à jour depuis le début du plan")}<div class="xp-bar"><div style="width:${names.length ? Math.round(count() / names.length * 100) : 0}%"></div></div>`;
    };
    const bind = () => {
      m.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
        const f = m.querySelector(`[data-form="${b.dataset.edit}"]`);
        f.hidden = !f.hidden;
        if (!f.hidden) f.querySelector("[data-kg]").focus();
      });
      m.querySelectorAll("[data-save]").forEach(b => b.onclick = async () => {
        const i = +b.dataset.save, n = names[i];
        const f = m.querySelector(`[data-form="${i}"]`);
        const kg = parseFloat(f.querySelector("[data-kg]").value);
        const reps = parseInt(f.querySelector("[data-reps]").value, 10);
        const date = f.querySelector("[data-date]").value;
        const err = f.querySelector(".max-err");
        if (!(kg > 0) || isAbsurdKg(n, kg)) { err.textContent = t("Charge invalide."); return; }
        if (!(reps >= 1 && reps <= 12)) { err.textContent = t("Reps : entre 1 et 12."); return; }
        if (!date || date > today()) { err.textContent = t("Date invalide."); return; }
        b.disabled = true;
        try {
          maxes[keyOf(n)] = { ...(await saveMax(n, kg, reps, date)) };
          toast(t("Max enregistré : {name}", { name: n }));
          m.querySelector("#max-list").innerHTML = draw();
          bind(); progress();
        } catch (e) {
          console.error("[Skullcrusher] Max", e);
          err.textContent = t("Enregistrement impossible, réessaie.");
          b.disabled = false;
        }
      });
    };
    m.querySelector("#max-close").onclick = () => { closeModal(); if (onClose) onClose(); };
    bind(); progress();
    if (only) m.querySelector("[data-edit]")?.click();
  });
}
