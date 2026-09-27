// ============================================================
// NOTES ★ — routines et plans (Découvrir). Une note de 1 à 5 par
// personne ; la moyenne est affichée avec le nombre de votes.
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, toast, esc } from "./utils.js";
import { t } from "./i18n.js";

export const ratingKey = (kind, id) => `${kind}_${id}`;
export const average = (r) => (r && r.count ? r.sum / r.count : 0);
// Classement : moyenne « lissée » (2 votes fictifs à 3★) pour qu'une seule
// note de 5 ne passe pas devant 20 notes à 4,8.
export const score = (r) => (r ? (r.sum + 6) / (r.count + 2) : 3);

export function starsHtml(r, { compact = false } = {}) {
  const avg = average(r);
  if (!r || !r.count) return `<span class="stars-empty">☆ ${compact ? "" : t("Pas encore noté")}</span>`;
  const full = Math.round(avg);
  return `<span class="stars" title="${avg.toFixed(1)}/5">${"★".repeat(full)}<span class="stars-off">${"★".repeat(5 - full)}</span></span> <b>${avg.toFixed(1).replace(".", ",")}</b> <span class="muted">(${r.count})</span>`;
}

// Fenêtre de notation. onDone(stars) après enregistrement (0 = note retirée).
export function openRatingModal(target, title, current = 0, onDone = () => {}) {
  let stars = current;
  openModal(`
    <h3>${t("Noter « {name} »", { name: esc(title) })}</h3>
    <div class="star-picker" id="star-picker">${[1, 2, 3, 4, 5].map(n => `<button data-star="${n}" aria-label="${n}">★</button>`).join("")}</div>
    <p class="muted" id="star-label" style="text-align:center; min-height:1.2em;"></p>
    <div class="btn-row">
      ${current ? `<button class="btn btn-secondary" id="rate-clear">${t("Retirer ma note")}</button>` : `<button class="btn btn-secondary" id="rate-cancel">${t("Annuler")}</button>`}
      <button class="btn btn-primary" id="rate-ok" ${stars ? "" : "disabled"}>${t("Enregistrer")}</button>
    </div>
  `, (m) => {
    // i18n-keys: "Bof", "Moyen", "Bien", "Très bien", "Excellent"
    const labels = ["", "Bof", "Moyen", "Bien", "Très bien", "Excellent"];
    const draw = () => {
      m.querySelectorAll("[data-star]").forEach(b => b.classList.toggle("on", +b.dataset.star <= stars));
      m.querySelector("#star-label").textContent = stars ? t(labels[stars]) : "";
      m.querySelector("#rate-ok").disabled = !stars;
    };
    m.querySelectorAll("[data-star]").forEach(b => b.onclick = () => { stars = +b.dataset.star; draw(); });
    const save = async (value) => {
      try {
        await db.rateTarget(target, value);
        closeModal();
        toast(value ? t("Merci pour ta note !") : t("Note retirée"));
        onDone(value);
      } catch (e) {
        console.error("[Skullcrusher] Note", e);
        toast(t("Note impossible, réessaie"));
      }
    };
    m.querySelector("#rate-ok").onclick = () => save(stars);
    const clear = m.querySelector("#rate-clear");
    if (clear) clear.onclick = () => save(0);
    const cancel = m.querySelector("#rate-cancel");
    if (cancel) cancel.onclick = closeModal;
    draw();
  });
}
