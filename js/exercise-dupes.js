// ============================================================
// DOUBLONS D'EXERCICES — repérer et fusionner les fiches qui désignent
// le même mouvement (« Bench Press (Barbell) » importé de Hevy et
// « Développé Couché (Barre) » de la bibliothèque standard, « Crunch
// Machine » et « Crunch (Machine) »…). Fusionner réunit l'historique,
// les stats et les records sous un seul nom.
// ============================================================
import * as db from "./db.js";
import { getExercises, getAllSets, onAllSetsProgress, invalidate } from "./cache.js";
import { normName } from "./exercise-match.js";
import { translateQuery } from "./exercise-search.js";
import { EXERCISE_SEED } from "./exercises-seed.js";
import { openModal, closeModal, toast, esc } from "./utils.js";
import { t } from "./i18n.js";

// Clé commune : termes anglais traduits, puis accents, ordre des mots,
// pluriels et synonymes de matériel neutralisés. Les noms anglais des
// fiches ne sont pas utilisés ici : trop approximatifs pour fusionner.
export const dupKey = (name) => normName(translateQuery(name));

export function findDuplicateGroups(library) {
  const byKey = new Map();
  library.forEach(ex => {
    const k = dupKey(ex.name);
    if (!k) return;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(ex);
  });
  return [...byKey.values()].filter(g => g.length > 1);
}

// Nom gardé par défaut : celui de la bibliothèque standard (français,
// avec fiche et vidéos), sinon celui qui a le plus de séries.
function defaultKeep(group, counts) {
  const seed = new Set(EXERCISE_SEED.map(([n]) => n));
  const std = group.find(ex => seed.has(ex.name));
  if (std) return std.name;
  return group.slice().sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0))[0].name;
}

export async function openDuplicatesTool(onDone = () => {}) {
  openModal(`
    <h3>🧩 ${t("Doublons d'exercices")}</h3>
    <p class="muted" id="dup-loading" style="margin-top:0;">${t("Recherche des doublons…")}</p>
  `);
  let library, counts;
  try {
    invalidate("exercises"); // bibliothèque à jour
    onAllSetsProgress((n) => { const el = document.getElementById("dup-loading"); if (el) el.textContent = t("Lecture de tes séries… {n}", { n }); });
    const [lib, sets] = await Promise.all([getExercises(), getAllSets()]);
    library = lib;
    counts = new Map();
    sets.forEach(s => counts.set(s.exercise_title, (counts.get(s.exercise_title) || 0) + 1));
  } catch (err) {
    console.error("[Skullcrusher] Doublons", err);
    closeModal();
    toast(t("Action impossible, réessaie"));
    return;
  } finally {
    onAllSetsProgress(null);
  }
  if (!document.getElementById("dup-loading")) return; // fenêtre fermée entre-temps
  closeModal();

  const groups = findDuplicateGroups(library);
  const names = library.map(ex => ex.name).sort((a, b) => a.localeCompare(b, "fr"));
  const count = (n) => counts.get(n) || 0;
  const options = (selected) => `<option value="">—</option>` + names.map(n => `<option value="${esc(n)}" ${n === selected ? "selected" : ""}>${esc(n)} (${count(n)})</option>`).join("");

  openModal(`
    <h3>🧩 ${t("Doublons d'exercices")}</h3>
    <p class="muted" style="margin-top:0; font-size:13px;">${t("Choisis le nom à garder pour chaque groupe. Tes séries, tes routines et tes temps de repos passent sous ce nom : historique, stats et records sont réunis.")}</p>
    <div style="max-height:46vh; overflow:auto;">
      ${groups.length ? groups.map((g, gi) => {
        const keep = defaultKeep(g, counts);
        return `
        <div class="dup-group">
          <label class="dup-head"><input type="checkbox" data-dup-on="${gi}" checked> ${t("Fusionner")}</label>
          ${g.map(ex => `
            <label class="dup-row">
              <input type="radio" name="dup-${gi}" value="${esc(ex.name)}" ${ex.name === keep ? "checked" : ""}>
              <span>${esc(ex.name)}<br><span class="muted" style="font-size:12px;">${t("{n} série(s)", { n: count(ex.name) })} · ${esc(t(ex.muscle_group || "Autre"))}</span></span>
            </label>`).join("")}
        </div>`;
      }).join("") : `<p class="muted">${t("Aucun doublon évident trouvé.")}</p>`}
      <details class="dup-manual">
        <summary>${t("Fusionner deux exercices à la main")}</summary>
        <label>${t("Exercice en double")}</label>
        <select id="dup-from">${options("")}</select>
        <label>${t("Nom à garder")}</label>
        <select id="dup-to">${options("")}</select>
      </details>
    </div>
    <p class="muted" style="font-size:12px;">${t("Les fiches que tu as créées sont redirigées vers le nom gardé pour tout le monde. Pour celles des autres, seules tes données sont regroupées.")}</p>
    <p class="muted" id="dup-progress" style="font-size:13px; min-height:1em;"></p>
    <div class="btn-row">
      <button class="btn btn-secondary" id="dup-cancel">${t("Fermer")}</button>
      <button class="btn btn-primary" id="dup-ok">${t("Fusionner")}</button>
    </div>
  `, (m) => {
    m.querySelector("#dup-cancel").onclick = closeModal;
    m.querySelector("#dup-ok").onclick = async (e) => {
      const pairs = []; // [fiche en double, nom gardé]
      groups.forEach((g, gi) => {
        if (!m.querySelector(`[data-dup-on="${gi}"]`).checked) return;
        const keep = m.querySelector(`input[name="dup-${gi}"]:checked`)?.value;
        if (keep) g.filter(ex => ex.name !== keep).forEach(ex => pairs.push([ex, keep]));
      });
      const from = m.querySelector("#dup-from").value, to = m.querySelector("#dup-to").value;
      if (from && to && from !== to && !pairs.some(([ex]) => ex.name === from)) {
        pairs.push([library.find(ex => ex.name === from), to]);
      }
      if (!pairs.length) { toast(t("Rien à fusionner")); return; }
      if (!confirm(t("Fusionner {n} exercice(s) ? Cette action ne peut pas être annulée.", { n: pairs.length }))) return;
      e.target.disabled = true;
      const progress = m.querySelector("#dup-progress");
      let sets = 0;
      try {
        for (const [i, [ex, keep]] of pairs.entries()) {
          progress.textContent = t("Fusion {i}/{n} : {name}", { i: i + 1, n: pairs.length, name: ex.name });
          sets += (await db.mergeExercise(ex, keep)).sets;
        }
        invalidate("exercises"); invalidate("sets"); invalidate("routines");
        // Muscles des séances passées : le nom gardé peut avoir un autre groupe.
        const groupOf = new Map((await getExercises()).map(ex => [ex.name, ex.muscle_group]));
        await db.recomputeMuscleSummaries(groupOf, (n) => { progress.textContent = t("Lecture de tes séries… {n}", { n }); });
        invalidate("workouts"); invalidate("sets");
        closeModal();
        toast(t("{n} exercice(s) fusionné(s), {sets} série(s) renommée(s)", { n: pairs.length, sets }), 3500);
        onDone();
      } catch (err) {
        console.error("[Skullcrusher] Fusion des doublons", err);
        progress.textContent = t("Action impossible, réessaie");
        e.target.disabled = false;
      }
    };
  });
}
