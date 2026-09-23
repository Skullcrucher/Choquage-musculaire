// ============================================================
// ONGLET RÉGLAGES — import CSV, bibliothèque d'exercices, export
// ============================================================
import * as db from "./db.js";
import { importCsvFile } from "./import.js";
import { toast, openModal, closeModal } from "./utils.js";
import { firebaseConfig } from "./firebase-config.js";
import { invalidateStatsCache } from "./stats.js";
import { getExercises, invalidate } from "./cache.js";
import { EXERCISE_SEED } from "./exercises-seed.js";
import { openExerciseDetail } from "./exercise-detail.js";

export async function renderReglages(container) {
  container.innerHTML = `
    <h1 class="section-title">Réglages</h1>

    <div class="card">
      <div class="card-title">Importer un CSV</div>
      <p class="muted" style="margin-top:0;">Export Hevy (Profil → Réglages → Exporter les données). Les séries déjà importées sont détectées et ignorées automatiquement — aucun doublon possible, même en réimportant plusieurs fois le même fichier.</p>
      <input type="file" id="csv-file" accept=".csv,text/csv">
      <p class="muted" id="csv-filename" style="margin:8px 0 0;"></p>
      <div style="height:10px"></div>
      <button class="btn btn-primary" id="start-import" disabled>Importer</button>
      <div id="import-progress" style="display:none;">
        <div class="progress-bar"><div class="progress-bar-fill" id="progress-fill" style="width:0%"></div></div>
        <p class="muted" id="progress-text"></p>
      </div>
      <div id="import-result"></div>
    </div>

    <div class="card">
      <div class="card-title">Bibliothèque d'exercices</div>
      <p class="muted" style="margin-top:0;">Complète ta bibliothèque avec ${EXERCISE_SEED.length} exercices standards (barre, haltère, machine, poulie, poids du corps) — les exercices déjà présents ne sont pas dupliqués.</p>
      <button class="btn btn-secondary" id="load-seed">Charger la bibliothèque standard</button>
      <div style="height:12px"></div>
      <div id="exercise-lib"></div>
    </div>

    <div class="card">
      <div class="card-title">Export</div>
      <p class="muted" style="margin-top:0;">Télécharge toutes tes séries au format CSV.</p>
      <button class="btn btn-secondary" id="export-csv">Exporter en CSV</button>
    </div>

    <div class="card">
      <div class="card-title">À propos</div>
      <p class="muted" style="margin-top:0;">Projet Firebase : ${firebaseConfig.projectId}</p>
      <p class="muted">Ajoute cette page à ton écran d'accueil (icône Partager → "Sur l'écran d'accueil") pour l'utiliser comme une app.</p>
    </div>
  `;

  const fileInput = container.querySelector("#csv-file");
  const filenameEl = container.querySelector("#csv-filename");
  const importBtn = container.querySelector("#start-import");

  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (file) {
      filenameEl.textContent = `Fichier sélectionné : ${file.name}`;
      importBtn.disabled = false;
    } else {
      filenameEl.textContent = "";
      importBtn.disabled = true;
    }
  };

  importBtn.onclick = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const progressWrap = container.querySelector("#import-progress");
    const fill = container.querySelector("#progress-fill");
    const text = container.querySelector("#progress-text");
    const resultEl = container.querySelector("#import-result");
    importBtn.disabled = true;
    importBtn.textContent = "Import en cours…";
    progressWrap.style.display = "block";
    resultEl.innerHTML = "";
    try {
      const stats = await importCsvFile(file, (done, total, _stats, label) => {
        if (!fill.isConnected) return; // l'utilisateur a changé d'onglet, on n'écrit plus dans le DOM
        if (label) {
          text.textContent = label + "…";
        } else {
          const pct = Math.round((done / total) * 100);
          fill.style.width = pct + "%";
          text.textContent = `${done} / ${total} séries traitées…`;
        }
      });
      if (resultEl.isConnected) {
        progressWrap.style.display = "none";
        resultEl.innerHTML = `
          <p style="color:var(--green)">Import terminé.</p>
          <p class="muted">
            ${stats.workoutsCreated} séance(s) créée(s) ·
            ${stats.setsImported} série(s) importée(s) ·
            ${stats.setsSkippedDuplicate} doublon(s) ignoré(s)
            ${stats.errors ? ` · ${stats.errors} erreur(s)` : ""}
          </p>
        `;
      }
      invalidateStatsCache();
      invalidate("exercises", "workouts");
      toast("Import terminé");
      renderExerciseLib(container); // no-op silencieux si l'onglet a changé (voir garde ci-dessous)
    } catch (err) {
      if (progressWrap.isConnected) progressWrap.style.display = "none";
      if (resultEl.isConnected) resultEl.innerHTML = `<p style="color:var(--red)">${err.message}</p>`;
    }
    if (importBtn.isConnected) {
      importBtn.disabled = false;
      importBtn.textContent = "Importer";
    }
    fileInput.value = "";
    filenameEl.textContent = "";
  };

  container.querySelector("#export-csv").onclick = exportCsv;
  container.querySelector("#load-seed").onclick = () => loadSeedLibrary(container);

  await renderExerciseLib(container);
}

async function loadSeedLibrary(container) {
  const btn = container.querySelector("#load-seed");
  btn.disabled = true;
  btn.textContent = "Chargement…";
  let added = 0;
  const existing = await getExercises();
  const existingNames = new Set(existing.map(e => e.name.toLowerCase()));
  for (const [name, group] of EXERCISE_SEED) {
    if (!existingNames.has(name.toLowerCase())) {
      await db.upsertExercise(name, group, "", false);
      added++;
    }
  }
  invalidate("exercises");
  if (btn.isConnected) {
    btn.disabled = false;
    btn.textContent = "Charger la bibliothèque standard";
  }
  toast(added > 0 ? `${added} exercice(s) ajouté(s)` : "Bibliothèque déjà à jour");
  if (container.querySelector("#exercise-lib")) renderExerciseLib(container);
}

async function renderExerciseLib(container) {
  const exercises = await getExercises();
  const wrap = container.querySelector("#exercise-lib");
  if (!wrap) return; // l'utilisateur a changé d'onglet pendant le chargement
  wrap.innerHTML = exercises.length === 0
    ? `<p class="muted">Aucun exercice pour l'instant.</p>`
    : exercises.map(ex => `
      <div class="list-row" data-ex="${ex.id}" data-ex-name="${ex.name.replace(/"/g, "&quot;")}" data-ex-group="${ex.muscle_group}">
        <div>
          <div class="list-row-title">${ex.name}</div>
          <div class="list-row-sub">${ex.muscle_group}</div>
        </div>
        <button class="btn btn-sm btn-secondary" data-edit-ex="${ex.id}">Modifier</button>
      </div>
    `).join("");
  wrap.querySelectorAll("[data-edit-ex]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openExerciseEditModal(exercises.find(ex => ex.id === btn.dataset.editEx), container);
    };
  });
  wrap.querySelectorAll(".list-row[data-ex]").forEach(row => {
    row.onclick = () => openExerciseDetail(row.dataset.exName, row.dataset.exGroup);
  });
}

function openExerciseEditModal(ex, container) {
  const modal = openModal(`
    <h3>${ex.name}</h3>
    <label>Groupe musculaire</label>
    <select id="edit-group">${db.EXO_GROUPS.map(g => `<option ${g === ex.muscle_group ? "selected" : ""}>${g}</option>`).join("")}</select>
    <label>Minuteur de repos par défaut (secondes)</label>
    <input id="edit-rest" type="number" value="${ex.rest_timer_seconds || 90}">
    <div style="height:14px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="edit-cancel">Annuler</button>
      <button class="btn btn-primary" id="edit-save">Enregistrer</button>
    </div>
    ${ex.is_custom ? `<button class="btn btn-danger" id="edit-delete" style="margin-top:10px;">Supprimer cet exercice</button>` : ""}
  `, (modalEl) => {
    modalEl.querySelector("#edit-cancel").onclick = closeModal;
    modalEl.querySelector("#edit-save").onclick = async () => {
      await db.updateExercise(ex.id, {
        muscle_group: modalEl.querySelector("#edit-group").value,
        rest_timer_seconds: parseInt(modalEl.querySelector("#edit-rest").value, 10) || 90
      });
      invalidate("exercises");
      closeModal();
      toast("Exercice mis à jour");
      renderExerciseLib(container);
    };
    const delBtn = modalEl.querySelector("#edit-delete");
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm("Supprimer cet exercice de la bibliothèque ? (les séries déjà loggées sont conservées)")) return;
      await db.deleteExercise(ex.id);
      invalidate("exercises");
      closeModal();
      renderExerciseLib(container);
    };
  });
}

async function exportCsv() {
  const sets = await db.listAllSets(20000);
  const workouts = await db.listWorkouts(2000);
  const workoutMap = Object.fromEntries(workouts.map(w => [w.id, w]));
  const header = "title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps,rpe\n";
  const rows = sets.map(s => {
    const w = workoutMap[s.workout_id] || {};
    return [
      `"${(w.title || "").replace(/"/g, '""')}"`,
      w.start_time || "", w.end_time || "",
      `"${s.exercise_title.replace(/"/g, '""')}"`,
      s.set_index, s.set_type, s.weight_kg ?? "", s.reps ?? "", s.rpe ?? ""
    ].join(",");
  });
  const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fonte-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
