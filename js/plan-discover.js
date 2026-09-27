// ============================================================
// DÉCOUVRIR → PLANS — programmes Skullcrusher (PPL, split…) et plans
// partagés par les amis ou la communauté : aperçu, note ★ et ajout à
// ses plans en un geste.
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, esc } from "./utils.js";
import { officialPlans } from "./programs.js";
import { ratingKey, score, starsHtml, openRatingModal } from "./ratings.js";
import { planScheduleHtml, addPlanFromTemplate } from "./plan-share.js";
import { getPlans } from "./plans.js";
import { t } from "./i18n.js";

const weeksOf = (p) => (p.blocks || []).reduce((n, b) => n + (b.weeks || 0), 0);
const daysOf = (p) => Math.max(0, ...(p.blocks || []).map(b => Object.keys(b.days || {}).length));

export async function renderDiscoverPlans(content) {
  const myUid = db.getCurrentUser()?.uid;
  const [shared, friendships, { plans }] = await Promise.all([
    db.listSharedPlans().catch(e => { console.warn("[Skullcrusher] Plans partagés", e); return []; }),
    db.listFriendships().catch(() => []),
    getPlans()
  ]);
  const friendUids = new Set(friendships.filter(f => f.status === "accepted").map(f => f.other_uid));
  const list = [...officialPlans(), ...shared.filter(p => p.owner_uid === myUid || p.visibility === "public" || friendUids.has(p.owner_uid))];
  const ratings = await db.getRatings(list.map(p => ratingKey("plan", p.id))).catch(() => ({}));
  if (!content.isConnected) return;
  const added = new Set(plans.map(p => p.source?.id).filter(Boolean));
  const ctx = { myUid, friendUids, ratings, added };
  // Programmes officiels d'abord, puis les mieux notés.
  list.sort((a, b) => (!!b.official - !!a.official) || score(ratings[ratingKey("plan", b.id)]) - score(ratings[ratingKey("plan", a.id)]) || String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));

  const draw = () => {
    content.innerHTML = `
      <p class="muted" style="font-size:13px; margin:0 0 10px;">${t("Programmes Skullcrusher et plans partagés : ajoute-les à tes plans, ils s'affichent ensuite dans Séance → Depuis un plan.")}</p>
      ${list.map(p => planCard(p, ctx)).join("")}
      ${list.some(p => !p.official) ? "" : `<p class="muted" style="font-size:13px;">${t("Partage tes propres plans depuis Routines → Plans.")}</p>`}`;
    content.querySelectorAll("[data-popen]").forEach(el => el.onclick = () => openPlanDetail(list.find(p => p.id === el.dataset.popen), ctx, draw));
    content.querySelectorAll("[data-prate]").forEach(b => b.onclick = (e) => { e.stopPropagation(); ratePlan(list.find(p => p.id === b.dataset.prate), ctx, draw); });
    content.querySelectorAll("[data-padd]").forEach(b => b.onclick = (e) => { e.stopPropagation(); addPlan(list.find(p => p.id === b.dataset.padd), ctx, b, draw); });
  };
  draw();
}

function planCard(p, ctx) {
  const mine = p.owner_uid === ctx.myUid;
  const rating = ctx.ratings[ratingKey("plan", p.id)];
  const done = ctx.added.has(p.id);
  const meta = [p.level && db.ROUTINE_LEVELS[p.level], p.goal && db.ROUTINE_GOALS[p.goal]].filter(Boolean);
  return `
    <div class="card feed-card" data-popen="${esc(p.id)}">
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
        <div style="min-width:0;">
          <div class="card-title" style="margin-bottom:2px;">${esc(p.name)}${p.official ? ` <span class="official-badge">⭐ ${t("Officiel")}</span>` : ""}</div>
          <div class="muted" style="font-size:13px;">${t("par {name}", { name: mine ? t("toi") : esc(p.owner_name || t("Anonyme")) })}${ctx.friendUids.has(p.owner_uid) ? ` · 👥 ${t("ami")}` : ""} · ${t("{w} sem. · {d} séances/sem.", { w: weeksOf(p), d: daysOf(p) })}</div>
        </div>
        <button class="rate-btn ${rating?.mine ? "rated" : ""}" data-prate="${esc(p.id)}" ${mine ? "disabled" : ""}>${starsHtml(rating, { compact: true })}</button>
      </div>
      ${planScheduleHtml(p)}
      ${meta.length ? `<div class="chip-row" style="margin:8px 0 0;">${meta.map(m => `<span class="routine-badge">${esc(m)}</span>`).join("")}</div>` : ""}
      ${mine ? "" : `<button class="btn btn-sm ${done ? "btn-secondary" : "btn-primary"}" data-padd="${esc(p.id)}" style="margin-top:10px;" ${done ? "disabled" : ""}>${done ? t("✓ Dans tes plans") : t("+ Ajouter à mes plans")}</button>`}
    </div>`;
}

function ratePlan(p, ctx, redraw) {
  if (!p || p.owner_uid === ctx.myUid) return;
  const key = ratingKey("plan", p.id);
  const cur = ctx.ratings[key] || { sum: 0, count: 0, mine: 0 };
  openRatingModal(key, p.name, cur.mine, (stars) => {
    if (cur.mine) { cur.sum -= cur.mine; cur.count--; }
    if (stars) { cur.sum += stars; cur.count++; }
    cur.mine = stars;
    ctx.ratings[key] = cur;
    redraw();
  });
}

async function addPlan(p, ctx, btn, redraw, activate = false) {
  if (!p) return;
  btn.disabled = true;
  try {
    await addPlanFromTemplate(p, { activate });
    ctx.added.add(p.id);
    toast(activate ? t("Plan ajouté et activé : il démarre lundi") : t("Plan ajouté à tes plans (Routines → Plans)"), 3000, { horns: true });
    redraw();
    return true;
  } catch (err) {
    console.error("[Skullcrusher] Ajout du plan", err);
    toast(err.message || t("Impossible d'ajouter ce plan"));
    btn.disabled = false;
    return false;
  }
}

function openPlanDetail(p, ctx, redraw) {
  if (!p) return;
  const mine = p.owner_uid === ctx.myUid;
  const rating = ctx.ratings[ratingKey("plan", p.id)];
  const done = ctx.added.has(p.id);
  openModal(`
    <h3 style="margin-bottom:4px;">${esc(p.name)}</h3>
    <p class="muted" style="margin-top:0;">${t("par {name}", { name: mine ? t("toi") : esc(p.owner_name || t("Anonyme")) })}${p.official ? ` <span class="official-badge">⭐ ${t("Officiel")}</span>` : ""}</p>
    <p style="margin:-4px 0 10px;">${starsHtml(rating)}</p>
    ${p.description ? `<p style="font-size:14px;">${esc(p.description)}</p>` : ""}
    ${p.source ? `<p class="muted" style="font-size:12px;">📚 ${esc(p.source)}</p>` : ""}
    ${planScheduleHtml(p)}
    ${(p.routines || []).map(r => `
      <div class="profile-section-title" style="margin-top:14px;">${esc(r.name)}</div>
      ${(r.exercises || []).map(e => `
        <div class="list-row" style="cursor:default; padding:6px 0;">
          <div class="list-row-title" style="font-size:14px;">${esc(e.exercise_name)}</div>
          <div class="list-row-meta">${esc(e.target_sets)} × ${esc(e.reps_target)}</div>
        </div>`).join("")}`).join("")}
    ${mine ? "" : `
      <label class="list-row" style="cursor:pointer; margin-top:12px;">
        <span>${t("Activer ce plan (il démarre lundi)")}</span>
        <input type="checkbox" id="pd-activate" style="width:auto;">
      </label>`}
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn btn-secondary" id="pd-close">${t("Fermer")}</button>
      ${mine ? "" : `<button class="btn btn-secondary" id="pd-rate">★ ${rating?.mine ? t("Modifier ma note") : t("Noter")}</button>`}
    </div>
    ${mine ? "" : `<button class="btn btn-primary" id="pd-add" style="margin-top:10px;" ${done ? "disabled" : ""}>${done ? t("✓ Dans tes plans") : t("+ Ajouter à mes plans")}</button>`}
    <p class="muted" style="font-size:11.5px; margin-top:10px;">⚠️ ${t("Programme indicatif : adapte les charges à ton niveau. Il ne remplace pas l'avis d'un coach diplômé ni d'un médecin.")}</p>
  `, (m) => {
    m.querySelector("#pd-close").onclick = closeModal;
    const rateBtn = m.querySelector("#pd-rate");
    if (rateBtn) rateBtn.onclick = () => { closeModal(); ratePlan(p, ctx, redraw); };
    const addBtn = m.querySelector("#pd-add");
    if (addBtn) addBtn.onclick = async () => {
      if (await addPlan(p, ctx, addBtn, redraw, m.querySelector("#pd-activate")?.checked)) closeModal();
    };
  });
}
