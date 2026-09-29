// ============================================================
// BIBLIO — routines et plans du compte au même endroit : mes routines,
// mes plans (création, import, partage, envoi) et Découvrir.
// ============================================================
import { t } from "./i18n.js";

export async function renderBiblio(container) {
  container.innerHTML = `
    <h1 class="section-title">${t("Bibliothèque")}</h1>
    <div id="biblio-body"></div>`;
  const routines = await import("./routines.js");
  await routines.renderRoutines(container.querySelector("#biblio-body"));
}

// Ouvre l'onglet Biblio sur une section : "mine" (routines), "plans", "discover".
export async function openBiblio(mode = "mine") {
  (await import("./routines.js")).setRoutinesMode(mode);
  document.querySelector('.tab-btn[data-tab="biblio"]')?.click();
}
