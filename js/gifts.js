// ============================================================
// ÉCHANGES ENTRE AMIS — envoyer une copie d'une routine ou d'un plan à un
// ou plusieurs amis ; le destinataire la retrouve dans « Reçus » (onglets
// Séance et Routines) et l'ajoute à sa bibliothèque ou la refuse.
// ============================================================
import * as db from "./db.js";
import { toast, openModal, closeModal, esc } from "./utils.js";
import { invalidate } from "./cache.js";
import { t, tn } from "./i18n.js";

// Routine -> copie envoyable (sans les charges visées, personnelles).
export function routineGiftData(r) {
  return {
    name: r.name, description: r.description || "", level: r.level || "", goal: r.goal || "",
    playlist_url: r.playlist_url || "",
    exercises: (r.exercises || []).map(({ target_kg, ...e }) => e)
  };
}

// ---------- Envoyer ----------
export async function openSendModal(kind, name, data) {
  const friendships = await db.listFriendships();
  const friends = friendships.filter(f => f.status === "accepted");
  const profiles = await db.getProfiles(friends.map(f => f.other_uid));
  const selected = new Set();
  openModal(`
    <h3>${kind === "plan" ? t("Envoyer le plan « {name} »", { name: esc(name) }) : t("Envoyer la routine « {name} »", { name: esc(name) })}</h3>
    <p class="muted" style="font-size:13px;">${t("Tes amis reçoivent une copie (sans tes charges) dans « Reçus » et choisissent de l'ajouter ou non.")}</p>
    <div id="gift-friends">
      ${friends.length ? friends.map(f => `
        <label class="list-row" style="cursor:pointer;">
          <span class="list-row-title">${esc(profiles[f.other_uid]?.display_name || t("Utilisateur"))}</span>
          <input type="checkbox" data-gf="${esc(f.other_uid)}" style="width:auto;">
        </label>`).join("") : `<p class="muted">${t("Tu n'as pas encore d'amis. Ajoute-en depuis l'onglet Feed → Amis.")}</p>`}
    </div>
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn btn-secondary" id="gift-cancel">${t("Annuler")}</button>
      <button class="btn btn-primary" id="gift-send" ${friends.length ? "" : "disabled"}>📤 ${t("Envoyer")}</button>
    </div>
  `, (m) => {
    m.querySelectorAll("[data-gf]").forEach(cb => cb.onchange = () => { if (cb.checked) selected.add(cb.dataset.gf); else selected.delete(cb.dataset.gf); });
    m.querySelector("#gift-cancel").onclick = closeModal;
    m.querySelector("#gift-send").onclick = async (e) => {
      if (!selected.size) { toast(t("Coche au moins un ami")); return; }
      e.target.disabled = true;
      try {
        for (const uid of selected) await db.sendGift(uid, kind, name, data);
        closeModal();
        toast(tn(selected.size, "Envoyé à {n} ami", "Envoyé à {n} amis"));
      } catch (err) {
        console.error("[Skullcrusher] Envoi à un ami", err);
        toast(t("Envoi impossible, réessaie"));
        e.target.disabled = false;
      }
    };
  });
}

// ---------- Recevoir ----------
function exercisesHtml(exs) {
  return (exs || []).map(e => `${esc(e.exercise_name)} <span class="muted">${esc(e.target_sets || "")}${e.reps_target ? `×${esc(e.reps_target)}` : ""}</span>`).join("<br>");
}

async function openGift(g, onChanged) {
  const isPlan = g.kind === "plan";
  const ps = isPlan ? await import("./plan-share.js") : null;
  const schedule = isPlan ? ps.planScheduleHtml(g.data || {}) : "";
  const routines = isPlan ? (g.data?.routines || []) : [g.data || {}];
  openModal(`
    <h3>${esc(g.name)}</h3>
    <p class="muted" style="margin-top:0;">${isPlan ? t("Plan envoyé par {name}", { name: esc(g.from_name || t("un ami")) }) : t("Routine envoyée par {name}", { name: esc(g.from_name || t("un ami")) })}</p>
    ${g.data?.description ? `<p style="font-size:14px;">${esc(g.data.description)}</p>` : ""}
    ${schedule}
    ${routines.map(r => `
      <div class="card" style="margin:10px 0 0; padding:12px;">
        ${isPlan ? `<div class="card-title" style="font-size:15px; margin-bottom:4px;">${esc(r.name)}</div>` : ""}
        <div style="font-size:13px; line-height:1.6;">${exercisesHtml(r.exercises)}</div>
      </div>`).join("")}
    ${isPlan ? ps.startFieldHtml() : ""}
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn btn-secondary" id="gift-refuse">${t("Refuser")}</button>
      <button class="btn btn-primary" id="gift-accept">＋ ${isPlan ? t("Ajouter à mes plans") : t("Ajouter à mes routines")}</button>
    </div>
  `, (m) => {
    m.querySelector("#gift-refuse").onclick = async () => {
      await db.deleteGift(g.id).catch(() => null);
      closeModal();
      onChanged();
    };
    m.querySelector("#gift-accept").onclick = async (e) => {
      e.target.disabled = true;
      try {
        if (isPlan) {
          await ps.addPlanFromTemplate({ ...g.data, id: null, official: false, owner_name: g.from_name || "" }, { start: ps.readStartField(m) });
        } else {
          await db.copyRoutine({ ...g.data, id: null, owner_uid: g.from_uid, owner_name: g.from_name || "" });
        }
        await db.deleteGift(g.id).catch(() => null);
        invalidate("routines");
        closeModal();
        toast(isPlan ? t("Plan ajouté à tes plans") : t("Routine ajoutée à ta bibliothèque"));
        onChanged();
      } catch (err) {
        console.error("[Skullcrusher] Ajout d'un envoi", err);
        toast(err.message || t("Ajout impossible, réessaie"));
        e.target.disabled = false;
      }
    };
  });
}

// Encadré « Reçus » (rien s'il est vide). onChanged : redessiner l'écran.
export async function renderGiftInbox(box, onChanged = null) {
  if (!box) return;
  let gifts = [];
  try { gifts = await db.listReceivedGifts(); } catch (err) { console.warn("[Skullcrusher] Reçus", err); }
  if (!box.isConnected) return;
  if (!gifts.length) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="card gift-inbox">
      <div class="card-title" style="margin-bottom:6px;">🎁 ${t("Reçus")}</div>
      ${gifts.map(g => `
        <div class="list-row" data-gift="${esc(g.id)}" style="cursor:pointer;">
          <span class="list-row-title">${g.kind === "plan" ? "📅" : "▤"} ${esc(g.name)}
            <small class="muted" style="display:block; font-weight:400;">${g.kind === "plan" ? t("Plan envoyé par {name}", { name: esc(g.from_name || t("un ami")) }) : t("Routine envoyée par {name}", { name: esc(g.from_name || t("un ami")) })}</small>
          </span>
          <span class="chip chip-sm">${t("Voir")}</span>
        </div>`).join("")}
    </div>`;
  const refresh = onChanged || (() => renderGiftInbox(box));
  box.querySelectorAll("[data-gift]").forEach(row => row.onclick = () => openGift(gifts.find(g => g.id === row.dataset.gift), refresh));
}
