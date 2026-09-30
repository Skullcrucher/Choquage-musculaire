// ============================================================
// ADMINISTRATEUR — contenus officiels Skullcrusher (compte dont l'email
// est ADMIN_EMAIL, voir db.js ; les règles Firestore vérifient le même
// email) :
//   - modifier une séance officielle en place ;
//   - modifier un programme officiel (copie dans Mes plans, puis
//     « Publier (officiel) » remplace la version publiée) ;
//   - publier une de ses routines ou un de ses plans comme officiel ;
//   - retirer un programme officiel.
// Les programmes officiels sont dans official_programs (voir programs.js).
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, esc, confirmDanger } from "./utils.js";
import { invalidate } from "./cache.js";
import { loadOfficialPrograms, isBuiltinProgram } from "./programs.js";
import { t } from "./i18n.js";

export const isAdmin = () => db.isAdmin();

// Programme prêt à écrire (sans les champs calculés à la lecture).
function clean(p) {
  const { builtin, edited, id, updated_at, updated_by, ...rest } = p;
  return JSON.parse(JSON.stringify(rest));
}
const stripKg = (exs) => (exs || []).map(({ target_kg, ...e }) => e);
// Ids sans « _ » (les notes utilisent routine_<id>).
const safeId = (s) => String(s).replace(/[^A-Za-z0-9-]/g, "-").slice(0, 60);

// ---------- Séance officielle : modification en place ----------
export async function editOfficialRoutine(r, onDone) {
  const programs = await loadOfficialPrograms(true);
  const prog = programs.find(p => p.id === r.program_id);
  const key = r.id.slice(r.program_id.length + 1);
  if (!prog) { toast(t("Programme introuvable")); return; }
  const { openRoutineEditor } = await import("./routines.js");
  openRoutineEditor(r, async () => { await loadOfficialPrograms(true); onDone?.(); }, {
    save: async (state) => {
      const routines = (prog.routines || []).map(x => x.key === key ? {
        ...x, name: state.name, description: state.description,
        exercises: stripKg(state.exercises).map(e => ({ exercise_name: e.exercise_name, target_sets: e.target_sets, reps_target: e.reps_target, rest_seconds: e.rest_seconds, muscle_group: e.muscle_group }))
      } : x);
      await db.saveOfficialProgram(prog.id, clean({ ...prog, routines }));
    }
  });
}

// ---------- Programme officiel : copie à modifier dans Mes plans ----------
export async function editOfficialPlanAsCopy(p, onDone) {
  const { addPlanFromTemplate } = await import("./plan-share.js");
  const { getPlans, savePlans } = await import("./plans.js");
  try {
    const plan = await addPlanFromTemplate({ ...p, id: p.id, official: true, owner_name: "Skullcrusher" });
    const { plans, active } = await getPlans();
    await savePlans(plans.map(x => x.id === plan.id ? { ...x, official_id: p.id, description: p.description || "", level: p.level || "", goal: p.goal || "" } : x), active);
    closeModal();
    toast(t("Copie ajoutée dans Biblio → Mes plans : modifie-la puis touche « Publier (officiel) »."), 5000);
    onDone?.();
  } catch (e) { toast(e.message || t("Impossible d'enregistrer")); }
}

// ---------- Retirer un programme officiel ----------
export async function removeOfficialProgram(programId, name, onDone) {
  if (!await confirmDanger({
    title: t("Retirer ce programme officiel ?"),
    message: t("« {name} » ne sera plus proposé dans Découvrir. Ceux qui l'ont déjà ajouté gardent leur copie.", { name: esc(name) }),
    cancelLabel: t("Garder"), confirmLabel: t("Retirer")
  })) return;
  try {
    // Programme intégré à l'app : on le masque ; sinon on supprime le document.
    if (isBuiltinProgram(programId)) await db.saveOfficialProgram(programId, { deleted: true });
    else await db.deleteOfficialProgram(programId);
    await loadOfficialPrograms(true);
    closeModal();
    toast(t("Programme retiré"));
    onDone?.();
  } catch (e) { console.error(e); toast(t("Impossible d'enregistrer")); }
}

// ---------- Publier une routine / un plan comme officiel ----------
function metaModal({ title, name, description, level, goal, extra = "" }, onOk) {
  const opt = (map, cur) => `<option value="">—</option>` + Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  openModal(`
    <h3>⭐ ${title}</h3>
    <p class="muted" style="margin-top:0; font-size:13px;">${t("Visible par tout le monde dans Découvrir, avec le badge « Officiel ». Les charges ne sont pas publiées.")}</p>
    <label>${t("Nom")}</label><input id="om-name" maxlength="80" value="${esc(name)}">
    <label>${t("Description")}</label><textarea id="om-desc" maxlength="500" rows="3">${esc(description || "")}</textarea>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
      <div><label>${t("Niveau")}</label><select id="om-level">${opt(db.ROUTINE_LEVELS, level)}</select></div>
      <div><label>${t("Objectif")}</label><select id="om-goal">${opt(db.ROUTINE_GOALS, goal)}</select></div>
    </div>
    ${extra}
    <p class="muted" id="om-err" style="color:var(--red); min-height:1em;"></p>
    <div class="btn-row">
      <button class="btn btn-secondary" id="om-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="om-ok">${t("Publier")}</button>
    </div>`, (m) => {
    m.querySelector("#om-cancel").onclick = closeModal;
    m.querySelector("#om-ok").onclick = async (e) => {
      const meta = { name: m.querySelector("#om-name").value.trim().slice(0, 80), description: m.querySelector("#om-desc").value.trim().slice(0, 500), level: m.querySelector("#om-level").value, goal: m.querySelector("#om-goal").value };
      const err = m.querySelector("#om-err");
      if (!meta.name) { err.textContent = t("Donne un nom."); return; }
      if (/[<>]/.test(meta.name + meta.description)) { err.textContent = t("Les caractères < et > ne sont pas autorisés."); return; }
      e.target.disabled = true;
      try { await onOk(meta); closeModal(); toast(t("Publié dans les contenus officiels") + " ⭐"); }
      catch (ex) { console.error("[Skullcrusher] Publication officielle", ex); err.textContent = t("Publication impossible (règles Firestore à jour ?)"); e.target.disabled = false; }
    };
  });
}

export function publishRoutineOfficial(r, onDone) {
  metaModal({ title: t("Publier comme routine officielle"), name: r.name, description: r.description, level: r.level, goal: r.goal }, async (meta) => {
    const id = safeId("off-r-" + r.id);
    await db.saveOfficialProgram(id, {
      kind: "routines", name: meta.name, description: meta.description, level: meta.level, goal: meta.goal,
      source: "Skullcrusher", order: 60, blocks: [],
      routines: [{ key: "r", name: meta.name, description: meta.description, exercises: stripKg(r.exercises) }]
    });
    await loadOfficialPrograms(true);
    onDone?.();
  });
}

export async function publishPlanOfficial(plan, routines, onDone) {
  const { planTemplateFrom } = await import("./plan-share.js");
  metaModal({
    title: plan.official_id ? t("Mettre à jour le programme officiel") : t("Publier comme programme officiel"),
    name: plan.name, description: plan.description, level: plan.level, goal: plan.goal
  }, async (meta) => {
    const tpl = planTemplateFrom(plan, routines);
    const id = plan.official_id || safeId("off-p-" + plan.id);
    await db.saveOfficialProgram(id, {
      kind: "plan", name: meta.name, description: meta.description, level: meta.level || tpl.level, goal: meta.goal || tpl.goal,
      source: "Skullcrusher", order: 40,
      routines: tpl.routines.map(r => ({ ...r, key: safeId(r.key) })),
      blocks: tpl.blocks.map(b => ({ ...b, days: Object.fromEntries(Object.entries(b.days).map(([d, k]) => [d, safeId(k)])) }))
    });
    // Le plan garde le lien : les prochaines publications mettent à jour le même programme.
    const { getPlans, savePlans } = await import("./plans.js");
    const { plans, active } = await getPlans();
    await savePlans(plans.map(x => x.id === plan.id ? { ...x, official_id: id } : x), active);
    await loadOfficialPrograms(true);
    invalidate("routines");
    onDone?.();
  });
}
