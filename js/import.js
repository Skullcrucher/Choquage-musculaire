// ============================================================
// IMPORT CSV — format d'export Hevy
// Colonnes attendues : title,start_time,end_time,description,
// exercise_title,superset_id,exercise_notes,set_index,set_type,
// weight_kg,reps,distance_km,duration_seconds,rpe
// ============================================================
import { importRows } from "./db.js";

const MOIS_FR = {
  "janv.": "01", "févr.": "02", "mars": "03", "avr.": "04", "mai": "05", "juin": "06",
  "juil.": "07", "août": "08", "sept.": "09", "oct.": "10", "nov.": "11", "déc.": "12"
};

// Gère le format Hevy "9 sept. 2026, 12:15" ET le format ISO standard,
// pour rester compatible si Hevy change son format d'export.
function parseHevyDate(str) {
  if (!str) return null;
  const s = str.trim();

  const fr = s.match(/^(\d{1,2}) (\S+) (\d{4}),\s*(\d{2}):(\d{2})$/);
  if (fr) {
    const [, day, moisTxt, year, h, mi] = fr;
    const mm = MOIS_FR[moisTxt.toLowerCase()];
    if (mm) return `${year}-${mm}-${day.padStart(2, "0")}T${h}:${mi}:00`;
  }

  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso.toISOString();

  return null;
}

function guessMuscleGroup(exerciseTitle) {
  const e = exerciseTitle.toLowerCase();
  if (/(développé couché|chest press|écarté|écart|dips|hexagonal)/.test(e) && !/épaule/.test(e)) return "Pectoraux";
  if (/(rowing|tirage|rack pull|traction)/.test(e)) return "Dos";
  if (/(épaule|militaire|latérale|frontale|oiseau)/.test(e)) return "Épaules";
  if (/curl/.test(e)) return "Biceps";
  if (/(triceps|skullcrusher)/.test(e)) return "Triceps";
  if (/(hip thrust|fessier|glute)/.test(e)) return "Fessiers";
  if (/(jambe|cuisse|squat|fente|ischio|roumain|rdl)/.test(e)) return "Jambes";
  if (/(abdo|crunch|gainage|planche)/.test(e)) return "Abdominaux";
  if (/(course|vélo|rameur|elliptique|tapis)/.test(e)) return "Cardio";
  return "Autre";
}

// Parse le texte CSV brut (déjà chargé en mémoire) et retourne les lignes
// normalisées, prêtes pour importRows(). Utilise PapaParse (chargé en global).
export function parseCsvText(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    console.warn("Avertissements de parsing CSV :", parsed.errors.slice(0, 5));
  }
  const rows = [];
  for (const r of parsed.data) {
    if (!r.exercise_title || !r.start_time) continue;
    const startIso = parseHevyDate(r.start_time);
    if (!startIso) continue;
    rows.push({
      title: (r.title || "Séance").trim(),
      start_time_iso: startIso,
      end_time_iso: parseHevyDate(r.end_time),
      description: r.description || "",
      exercise_title: r.exercise_title.trim(),
      muscle_group_guess: guessMuscleGroup(r.exercise_title),
      superset_id: r.superset_id || null,
      exercise_notes: r.exercise_notes || "",
      set_index: parseInt(r.set_index, 10) || 0,
      set_type: r.set_type || "normal",
      weight_kg: r.weight_kg ? parseFloat(r.weight_kg) : null,
      reps: r.reps ? parseInt(r.reps, 10) : null,
      distance_km: r.distance_km ? parseFloat(r.distance_km) : null,
      duration_seconds: r.duration_seconds ? parseInt(r.duration_seconds, 10) : null,
      rpe: r.rpe ? parseFloat(r.rpe) : null
    });
  }
  return rows;
}

export async function importCsvFile(file, onProgress) {
  const text = await file.text();
  const rows = parseCsvText(text);
  if (rows.length === 0) {
    throw new Error("Aucune ligne exploitable trouvée dans ce fichier. Vérifie qu'il s'agit bien d'un export Hevy (CSV).");
  }
  return await importRows(rows, onProgress);
}
