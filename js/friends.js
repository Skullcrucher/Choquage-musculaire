// ============================================================
// AMIS — recherche par pseudo, demandes, liste d'amis
// ============================================================
import * as db from "./db.js";
import { toast, esc, safeImageUrl, debounce } from "./utils.js";
import { invalidate } from "./cache.js";
import { openProfile } from "./profile.js";

function avatar(profile, size = 36) {
  const photo = safeImageUrl(profile?.photo_data_url);
  const name = profile?.display_name || "?";
  return photo
    ? `<div style="width:${size}px; height:${size}px; border-radius:50%; background:center/cover no-repeat; background-image:url('${photo}'); flex-shrink:0;"></div>`
    : `<div style="width:${size}px; height:${size}px; border-radius:50%; background:var(--surface-raised); display:flex; align-items:center; justify-content:center; font-weight:700; color:var(--amber); flex-shrink:0;">${esc(name[0].toUpperCase())}</div>`;
}

function personRow(profile, actionsHtml, uid = profile?.uid) {
  return `
    <div class="list-row" style="cursor:default; gap:10px;">
      <div style="display:flex; align-items:center; gap:10px; min-width:0; cursor:pointer;" ${uid ? `data-profile="${esc(uid)}"` : ""}>
        ${avatar(profile)}
        <div class="list-row-title" style="overflow:hidden; text-overflow:ellipsis;">${esc(profile?.display_name || "Utilisateur")}</div>
      </div>
      <div style="display:flex; gap:6px; flex-shrink:0;">${actionsHtml}</div>
    </div>`;
}

export async function countIncomingRequests() {
  try {
    return (await db.listFriendships()).filter(f => f.status === "pending" && f.incoming).length;
  } catch (_) {
    return 0;
  }
}

export async function renderFriends(container) {
  container.innerHTML = `<div class="empty-state"><span class="num">···</span>Chargement</div>`;
  const myProfile = await db.ensureSearchableProfile().catch(() => null);
  const friendships = await db.listFriendships();
  const profiles = await db.getProfiles(friendships.map(f => f.other_uid));
  if (!container.isConnected) return;

  const incoming = friendships.filter(f => f.status === "pending" && f.incoming);
  const badge = document.getElementById("friend-req-count");
  if (badge) badge.innerHTML = incoming.length ? ` <span class="req-dot">${incoming.length}</span>` : "";
  const outgoing = friendships.filter(f => f.status === "pending" && !f.incoming);
  const friends = friendships.filter(f => f.status === "accepted")
    .sort((a, b) => (profiles[a.other_uid]?.display_name || "").localeCompare(profiles[b.other_uid]?.display_name || "", "fr"));
  const knownUids = new Map(friendships.map(f => [f.other_uid, f]));

  container.innerHTML = `
    ${myProfile?.display_name ? "" : `<div class="card" style="border-color:var(--amber);"><p style="margin:0;">Choisis d'abord un <b>pseudo</b> dans Réglages → Compte : c'est grâce à lui que tes amis pourront te trouver.</p></div>`}
    <div class="card">
      <div class="card-title">Ajouter un ami</div>
      <input id="friend-search" type="search" placeholder="Rechercher un pseudo (2 lettres min.)">
      <div id="friend-results"></div>
    </div>
    ${incoming.length ? `<div class="card">
      <div class="card-title">Demandes reçues</div>
      ${incoming.map(f => personRow({ uid: f.other_uid, ...profiles[f.other_uid] }, `
        <button class="btn btn-sm btn-primary" data-accept="${esc(f.id)}">Accepter</button>
        <button class="btn btn-sm btn-secondary" data-remove="${esc(f.id)}">Refuser</button>`)).join("")}
    </div>` : ""}
    <div class="card">
      <div class="card-title">Mes amis (${friends.length})</div>
      ${friends.length ? friends.map(f => personRow({ uid: f.other_uid, ...profiles[f.other_uid] }, `<button class="btn btn-sm btn-secondary" data-remove="${esc(f.id)}" data-confirm="1">Retirer</button>`)).join("")
        : `<p class="muted" style="margin:0;">Pas encore d'amis. Cherche leur pseudo ci-dessus.</p>`}
    </div>
    ${outgoing.length ? `<div class="card">
      <div class="card-title">Demandes envoyées</div>
      ${outgoing.map(f => personRow({ uid: f.other_uid, ...profiles[f.other_uid] }, `<button class="btn btn-sm btn-secondary" data-remove="${esc(f.id)}">Annuler</button>`)).join("")}
    </div>` : ""}
  `;

  const refresh = () => renderFriends(container);
  const bindProfiles = (root) => root.querySelectorAll("[data-profile]").forEach(el => {
    el.onclick = () => openProfile(el.dataset.profile);
  });
  bindProfiles(container);

  container.querySelectorAll("[data-accept]").forEach(btn => btn.onclick = async () => {
    btn.disabled = true;
    try {
      await db.acceptFriendRequest(btn.dataset.accept);
      toast("Ami ajouté", 2200, { horns: true });
    } catch (err) {
      console.error("[Skullcrusher] Erreur acceptation ami", err);
      toast("Impossible d'accepter la demande");
    }
    await refresh();
  });
  container.querySelectorAll("[data-remove]").forEach(btn => btn.onclick = async () => {
    const f = friendships.find(x => x.id === btn.dataset.remove);
    if (!f) return;
    if (btn.dataset.confirm && !confirm(`Retirer ${profiles[f.other_uid]?.display_name || "cet ami"} de tes amis ? Tes routines partagées avec lui ne lui seront plus visibles.`)) return;
    btn.disabled = true;
    try {
      await db.removeFriendship(f);
      invalidate("routines");
    } catch (err) {
      console.error("[Skullcrusher] Erreur suppression ami", err);
      toast("Action impossible, réessaie");
    }
    await refresh();
  });

  const searchInput = container.querySelector("#friend-search");
  const resultsEl = container.querySelector("#friend-results");
  const myUid = db.getCurrentUser()?.uid;
  searchInput.addEventListener("input", debounce(async () => {
    const text = searchInput.value;
    if (text.trim().length < 2) { resultsEl.innerHTML = ""; return; }
    let found = [];
    try {
      found = (await db.searchProfiles(text)).filter(p => p.uid !== myUid);
    } catch (err) {
      console.error("[Skullcrusher] Erreur recherche profils", err);
    }
    if (searchInput.value !== text || !resultsEl.isConnected) return;
    resultsEl.innerHTML = found.length === 0
      ? `<p class="muted" style="margin:10px 0 0;">Personne avec ce pseudo.</p>`
      : found.map(p => {
          const f = knownUids.get(p.uid);
          const action = !f ? `<button class="btn btn-sm btn-primary" data-request="${esc(p.uid)}">Ajouter</button>`
            : f.status === "accepted" ? `<span class="muted">Ami ✓</span>`
            : f.incoming ? `<button class="btn btn-sm btn-primary" data-accept-search="${esc(f.id)}">Accepter</button>`
            : `<span class="muted">Demande envoyée</span>`;
          return personRow(p, action);
        }).join("");
    bindProfiles(resultsEl);
    resultsEl.querySelectorAll("[data-request]").forEach(btn => btn.onclick = async () => {
      btn.disabled = true;
      try {
        await db.sendFriendRequest(btn.dataset.request);
        toast("Demande envoyée");
        await refresh();
      } catch (err) {
        console.error("[Skullcrusher] Erreur demande d'ami", err);
        toast("Demande impossible (déjà envoyée ?)");
        btn.disabled = false;
      }
    });
    resultsEl.querySelectorAll("[data-accept-search]").forEach(btn => btn.onclick = async () => {
      btn.disabled = true;
      await db.acceptFriendRequest(btn.dataset.acceptSearch).catch(err => console.error(err));
      await refresh();
    });
  }, 300));
}
