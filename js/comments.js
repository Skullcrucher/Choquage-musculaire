// ============================================================
// COMMENTAIRES des séances partagées (Feed + détail d'une séance).
// ============================================================
import * as db from "./db.js";
import { esc, safeImageUrl, toast, openModal } from "./utils.js";
import { getUser } from "./auth.js";
import { openProfile } from "./profile.js";
import { t, tn } from "./i18n.js";

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("à l'instant");
  if (s < 3600) return t("il y a {n} min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("il y a {n} h", { n: Math.floor(s / 3600) });
  return t("il y a {n} j", { n: Math.floor(s / 86400) });
}

// Affiche la discussion d'une séance dans `container`. onCount(n) est
// appelé à chaque ajout ou suppression.
export async function renderComments(container, workout, { onCount = () => {}, autofocus = false } = {}) {
  const myUid = getUser()?.uid;
  container.innerHTML = `
    <div class="cm-list"><div class="muted" style="padding:8px 0;">${t("Chargement")}</div></div>
    <form class="cm-form">
      <textarea class="cm-input" rows="1" maxlength="${db.COMMENT_MAX}" placeholder="${t("Ajouter un commentaire…")}"></textarea>
      <button type="submit" class="btn btn-primary btn-sm cm-send">${t("Envoyer")}</button>
    </form>`;
  const list = container.querySelector(".cm-list");
  const form = container.querySelector(".cm-form");
  const input = container.querySelector(".cm-input");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
  if (autofocus) setTimeout(() => input.focus(), 50);

  let comments = [];
  const draw = async () => {
    const profiles = await db.getProfiles([...new Set(comments.map(c => c.author_uid))]).catch(() => ({}));
    if (!list.isConnected) return;
    list.innerHTML = comments.length ? comments.map(c => {
      const p = profiles[c.author_uid] || {};
      const name = c.author_uid === myUid ? t("Toi") : (p.display_name || t("Utilisateur"));
      const photo = safeImageUrl(p.photo_data_url);
      const canDelete = c.author_uid === myUid || workout.owner_uid === myUid || db.isAdmin();
      return `<div class="cm-item">
        <span class="cm-ava" data-profile="${esc(c.author_uid)}" ${photo ? `style="background-image:url('${photo}')"` : ""}>${photo ? "" : esc(name[0].toUpperCase())}</span>
        <div class="cm-body">
          <div class="cm-head"><b class="profile-link" data-profile="${esc(c.author_uid)}">${esc(name)}</b> <span class="muted">${ago(c.created_at)}</span>
            ${canDelete ? `<button type="button" class="cm-del" data-del="${esc(c.id)}" aria-label="${t("Supprimer")}">✕</button>` : ""}</div>
          <div class="cm-text">${esc(c.text)}</div>
        </div>
      </div>`;
    }).join("") : `<p class="muted cm-empty">${t("Pas encore de commentaire. Lance la discussion !")}</p>`;
    list.querySelectorAll("[data-profile]").forEach(el => el.onclick = (e) => { e.stopPropagation(); openProfile(el.dataset.profile); });
    list.querySelectorAll("[data-del]").forEach(btn => btn.onclick = async () => {
      btn.disabled = true;
      try {
        await db.deleteComment(workout.id, btn.dataset.del);
        comments = comments.filter(c => c.id !== btn.dataset.del);
        workout.comment_count = comments.length;
        onCount(comments.length);
        draw();
      } catch (err) {
        console.error("[Skullcrusher] Suppression commentaire", err);
        toast(t("Suppression impossible"));
        btn.disabled = false;
      }
    });
  };

  try {
    comments = await db.listComments(workout.id);
  } catch (err) {
    console.error("[Skullcrusher] Commentaires", err);
    list.innerHTML = `<p class="muted">${t("Chargement impossible.")}</p>`;
  }
  await draw();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const btn = form.querySelector(".cm-send");
    btn.disabled = true;
    try {
      const id = await db.addComment(workout.id, text);
      comments.push({ id, author_uid: myUid, text: text.slice(0, db.COMMENT_MAX), created_at: new Date().toISOString() });
      workout.comment_count = comments.length;
      input.value = "";
      input.style.height = "auto";
      onCount(comments.length);
      await draw();
      list.lastElementChild?.scrollIntoView({ block: "nearest" });
    } catch (err) {
      console.error("[Skullcrusher] Envoi commentaire", err);
      toast(t("Commentaire non envoyé"));
    }
    btn.disabled = false;
  };
}

// Fenêtre de discussion ouverte depuis une carte du Feed.
export function openComments(workout, onCount) {
  const n = workout.comment_count || 0;
  openModal(`
    <h3>💬 ${t("Commentaires")}</h3>
    <p class="muted" style="margin-top:-8px;">${esc(workout.title || t("Séance"))}${n ? ` · ${tn(n, "{n} commentaire", "{n} commentaires")}` : ""}</p>
    <div id="cm-root"></div>
  `, (modal) => renderComments(modal.querySelector("#cm-root"), workout, { onCount, autofocus: true }));
}
