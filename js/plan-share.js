// ============================================================
// PARTAGE DE PLANS — publier un plan (et ses routines) pour ses amis ou
// pour tous, et ajouter à ses plans un plan partagé ou un programme
// Skullcrusher (routines créées + plan prêt à activer).
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, esc } from "./utils.js";
import { invalidate } from "./cache.js";
import { getPlans, savePlans, dayStr, mondayOf, dowOf, MAX_PLANS, totalWeeks } from "./plans.js";
import { t, locale } from "./i18n.js";

const dowLabel = (dow, style = "short") => new Date(2024, 0, dow).toLocaleDateString(locale(), { weekday: style });

// Plan + routines -> modèle partageable. Les charges visées (personnelles)
// ne sont pas partagées.
export function planTemplateFrom(plan, routines) {
  const ids = [...new Set((plan.blocks || []).flatMap(b => Object.values(b.days || {})).filter(Boolean))];
  const used = ids.map(id => routines.find(r => r.id === id)).filter(Boolean);
  return {
    name: plan.name, description: plan.description || "",
    level: used.find(r => r.level)?.level || "", goal: used.find(r => r.goal)?.goal || "",
    routines: used.map(r => ({
      key: r.id, name: r.name, description: r.description || "",
      exercises: (r.exercises || []).map(({ target_kg, ...e }) => e)
    })),
    blocks: (plan.blocks || []).map(b => ({
      name: b.name || "", weeks: b.weeks,
      days: Object.fromEntries(Object.entries(b.days || {}).filter(([, id]) => used.some(r => r.id === id)))
    })),
    total_weeks: totalWeeks(plan),
    days_per_week: Math.max(0, ...(plan.blocks || []).map(b => Object.keys(b.days || {}).length))
  };
}

// Aperçu : semaine type du 1er bloc + enchaînement des blocs.
export function planScheduleHtml(tpl) {
  const name = (key) => tpl.routines.find(r => r.key === key)?.name || "";
  const first = tpl.blocks?.[0];
  return `
    ${first ? `<div class="plan-sched">${[1, 2, 3, 4, 5, 6, 7].map(d => `<div class="${first.days?.[d] ? "on" : ""}"><b>${esc(dowLabel(d, "narrow"))}</b>${first.days?.[d] ? esc(name(first.days[d]).replace(/^.*·\s*/, "")) : "–"}</div>`).join("")}</div>` : ""}
    <div class="muted" style="font-size:13px;">${(tpl.blocks || []).map(b => `${esc(b.name || "")} ${b.weeks} ${t("sem.")}`).join(" → ")}</div>`;
}

// ---------- Publier / retirer le partage ----------
export async function openPlanShare(plan, routines, onDone = () => {}) {
  const friendships = await db.listFriendships();
  const friends = friendships.filter(f => f.status === "accepted");
  const profiles = await db.getProfiles(friends.map(f => f.other_uid));
  let visibility = plan.shared_id ? (plan.shared_visibility || "public") : "private";
  const selected = new Set(plan.shared_with?.length ? plan.shared_with : friends.map(f => f.other_uid));
  openModal(`
    <h3>${t("Partager « {name} »", { name: esc(plan.name) })}</h3>
    <div class="chip-row" id="pvis">
      ${Object.entries(db.ROUTINE_VISIBILITY).map(([k, label]) => `<div class="chip" data-pvis="${k}">${label}</div>`).join("")}
    </div>
    <p class="muted" id="pvis-help" style="font-size:13px;"></p>
    <div id="pfriends"></div>
    <p class="muted" style="font-size:12px;">${t("Le plan et ses routines sont copiés tels qu'ils sont maintenant (sans tes charges). Après une modification, reviens ici et enregistre pour mettre le partage à jour.")}</p>
    <div class="btn-row">
      <button class="btn btn-secondary" id="ps-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="ps-save">${t("Enregistrer")}</button>
    </div>
  `, (m) => {
    const help = {
      private: t("Visible par toi seul."),
      friends: t("Visible par les amis cochés, dans Découvrir → Plans. Ils peuvent le noter et l'ajouter à leurs plans."),
      public: t("Visible par tous dans Découvrir → Plans : chacun peut le noter et l'ajouter à ses plans.")
    };
    const draw = () => {
      m.querySelectorAll("[data-pvis]").forEach(c => c.classList.toggle("active", c.dataset.pvis === visibility));
      m.querySelector("#pvis-help").textContent = help[visibility];
      const box = m.querySelector("#pfriends");
      if (visibility !== "friends") { box.innerHTML = ""; return; }
      box.innerHTML = friends.length ? friends.map(f => `
        <label class="list-row" style="cursor:pointer;">
          <span class="list-row-title">${esc(profiles[f.other_uid]?.display_name || t("Utilisateur"))}</span>
          <input type="checkbox" data-pf="${esc(f.other_uid)}" ${selected.has(f.other_uid) ? "checked" : ""} style="width:auto;">
        </label>`).join("") : `<p class="muted">${t("Tu n'as pas encore d'amis. Ajoute-en depuis l'onglet Feed → Amis.")}</p>`;
      box.querySelectorAll("[data-pf]").forEach(cb => cb.onchange = () => { if (cb.checked) selected.add(cb.dataset.pf); else selected.delete(cb.dataset.pf); });
    };
    m.querySelectorAll("[data-pvis]").forEach(c => c.onclick = () => { visibility = c.dataset.pvis; draw(); });
    m.querySelector("#ps-cancel").onclick = closeModal;
    m.querySelector("#ps-save").onclick = async (e) => {
      if (visibility === "friends" && !selected.size) { toast(t("Coche au moins un ami")); return; }
      e.target.disabled = true;
      try {
        const { plans, active } = await getPlans();
        const cur = plans.find(p => p.id === plan.id) || plan;
        let patch;
        if (visibility === "private") {
          if (cur.shared_id) await db.deleteSharedPlan(cur.shared_id).catch(() => null);
          patch = { shared_id: null, shared_visibility: null, shared_with: [] };
        } else {
          const friendUids = new Set(friends.map(f => f.other_uid));
          const shared_with = visibility === "friends" ? [...selected].filter(u => friendUids.has(u)) : [];
          const id = await db.saveSharedPlan(cur.shared_id || null, { ...planTemplateFrom(cur, routines), visibility, shared_with, source_plan_id: cur.id });
          patch = { shared_id: id, shared_visibility: visibility, shared_with };
        }
        await savePlans(plans.map(p => p.id === cur.id ? { ...p, ...patch } : p), active);
        closeModal();
        toast(visibility === "private" ? t("Plan privé") : t("Plan partagé"));
        onDone();
      } catch (err) {
        console.error("[Skullcrusher] Partage du plan", err);
        toast(t("Impossible de modifier le partage"));
        e.target.disabled = false;
      }
    };
    draw();
  });
}

// ---------- Ajouter un plan partagé / un programme à ses plans ----------
// Date de début au choix à l'ajout d'un plan : lundi prochain par défaut,
// ou une date passée si on l'avait déjà commencé.
export function nextMondayStr() {
  const start = mondayOf(new Date());
  if (dowOf(new Date()) > 1) start.setDate(start.getDate() + 7);
  return dayStr(start);
}
export function startFieldHtml() {
  return `
    <label style="display:block; margin-top:12px;">${t("Début du plan")}
      <input type="date" id="plan-start-add" value="${nextMondayStr()}">
    </label>
    <p class="muted" style="font-size:12px; margin:4px 0 0;">${t("Déjà commencé ? Mets une date passée, puis associe tes séances déjà faites dans Progrès → Plan en cours.")}</p>`;
}
export const readStartField = (m) => /^\d{4}-\d{2}-\d{2}$/.test(m.querySelector("#plan-start-add")?.value || "") ? m.querySelector("#plan-start-add").value : null;

export async function addPlanFromTemplate(tpl, { activate = false, start: startDate = null } = {}) {
  const { plans, active } = await getPlans();
  if (plans.length >= MAX_PLANS) throw new Error(t("{n} plans maximum", { n: MAX_PLANS }));
  const ids = {};
  for (const r of tpl.routines || []) {
    ids[r.key] = await db.saveRoutine({
      name: r.name, description: r.description || "", level: tpl.level || "", goal: tpl.goal || "",
      exercises: (r.exercises || []).map(e => ({ ...e }))
    });
  }
  // Début : date choisie, sinon lundi prochain (ou aujourd'hui si on est lundi).
  const plan = {
    id: "p" + Date.now().toString(36), name: String(tpl.name || "").slice(0, 60), start_date: startDate || nextMondayStr(),
    created_at: new Date().toISOString(),
    source: { id: tpl.id, owner_name: tpl.owner_name || "", official: !!tpl.official },
    blocks: (tpl.blocks || []).map(b => ({
      name: b.name || "", weeks: b.weeks,
      days: Object.fromEntries(Object.entries(b.days || {}).filter(([, k]) => ids[k]).map(([d, k]) => [d, ids[k]]))
    }))
  };
  await savePlans([...plans, plan], activate || !active ? plan.id : active);
  invalidate("routines");
  return plan;
}
