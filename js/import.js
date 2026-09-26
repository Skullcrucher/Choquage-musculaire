// ============================================================
// IMPORT CSV — format d'export Hevy
// Colonnes attendues : title,start_time,end_time,description,
// exercise_title,superset_id,exercise_notes,set_index,set_type,
// weight_kg (ou weight_lbs),reps,distance_km (ou distance_miles),
// duration_seconds,rpe
// ============================================================
import { importRows } from "./db.js";
import { t } from "./i18n.js";

const LBS_TO_KG = 0.45359237;
const MILES_TO_KM = 1.609344;

// Mois FR et EN, clé = début du nom sans accents ni point. "ju" est
// ambigu (juin/juillet, jun/jul) d'où les clés sur 4 lettres pour eux.
const MONTHS = {
  jan: 1, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, mai: 5, may: 5,
  juin: 6, jun: 6, juil: 7, jul: 7, aou: 8, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function monthNumber(txt) {
  const t = txt.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\./g, "");
  return MONTHS[t.slice(0, 4)] || MONTHS[t.slice(0, 3)] || null;
}

function toLocalIso(year, month, day, h, mi, ampm) {
  let hour = parseInt(h, 10);
  if (ampm) {
    const pm = ampm.toUpperCase() === "PM";
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  const p = (n) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${mi}:00`;
}

// Formats Hevy rencontrés selon la langue et la version de l'app :
//   "9 sept. 2026, 12:15"   "24 sept. 2026 à 12:27"   "24 Sep 2026, 12:27"
//   "Sep 24, 2026, 12:27 PM" — plus l'ISO standard en dernier recours.
// Hevy met parfois des espaces insécables autour de l'heure : on les
// normalise avant de tester les motifs.
function parseHevyDate(str) {
  if (!str) return null;
  const s = str.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;

  const dayFirst = s.match(/^(\d{1,2}) ([^\s\d,]+),? (\d{4})(?:,| à| at)? (\d{1,2}):(\d{2})(?::\d{2})?(?: ?([AP]M))?$/i);
  if (dayFirst) {
    const [, day, moisTxt, year, h, mi, ampm] = dayFirst;
    const mm = monthNumber(moisTxt);
    if (mm) return toLocalIso(year, mm, day, h, mi, ampm);
  }

  const monthFirst = s.match(/^([^\s\d,]+) (\d{1,2}),? (\d{4})(?:,| at)? (\d{1,2}):(\d{2})(?::\d{2})?(?: ?([AP]M))?$/i);
  if (monthFirst) {
    const [, moisTxt, day, year, h, mi, ampm] = monthFirst;
    const mm = monthNumber(moisTxt);
    if (mm) return toLocalIso(year, mm, day, h, mi, ampm);
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = new Date(s);
    if (!isNaN(iso.getTime())) return iso.toISOString();
  }

  return null;
}

// Groupe musculaire deviné d'après le nom : voir muscles.js.
export { guessMuscleGroup } from "./muscles.js";
import { guessMuscleGroup } from "./muscles.js";

function num(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
}

// Parse le texte CSV brut (déjà chargé en mémoire) et retourne les lignes
// normalisées, prêtes pour importRows(). Utilise PapaParse (chargé en global).
export function parseCsvText(csvText) {
  const parsed = Papa.parse(csvText.replace(/^﻿/, ""), {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim()
  });
  if (parsed.errors.length) {
    console.warn("Avertissements de parsing CSV :", parsed.errors.slice(0, 5));
  }
  const rows = [];
  const unparsedDates = new Set();
  // Hevy autorise le même exercice plusieurs fois dans une séance, avec
  // set_index qui repart de 0 : on numérote ces occurrences pour ne pas
  // confondre leurs séries avec des doublons.
  const occurrence = new Map();
  let lastExKey = null;
  let lastSetIndex = -1;
  for (const r of parsed.data) {
    if (!r.exercise_title || !r.start_time) continue;
    const startIso = parseHevyDate(r.start_time);
    if (!startIso) { unparsedDates.add(r.start_time); continue; }

    const title = (r.title || "Séance").trim();
    const exerciseTitle = r.exercise_title.trim();
    const workoutKey = `${title}|${startIso}`;
    const exKey = `${workoutKey}|${exerciseTitle}`;
    const setIndex = parseInt(r.set_index, 10) || 0;
    if (exKey !== lastExKey || setIndex <= lastSetIndex) {
      occurrence.set(exKey, (occurrence.get(exKey) || 0) + 1);
    }
    lastExKey = exKey;
    lastSetIndex = setIndex;

    const lbs = num(r.weight_lbs);
    const miles = num(r.distance_miles);
    const weightKg = num(r.weight_kg) ?? (lbs != null ? Math.round(lbs * LBS_TO_KG * 100) / 100 : null);
    const distanceKm = num(r.distance_km) ?? (miles != null ? Math.round(miles * MILES_TO_KM * 1000) / 1000 : null);
    const reps = num(r.reps);
    const duration = num(r.duration_seconds);

    rows.push({
      title,
      start_time_iso: startIso,
      end_time_iso: parseHevyDate(r.end_time),
      description: r.description || "",
      exercise_title: exerciseTitle,
      exercise_occurrence: occurrence.get(exKey),
      muscle_group_guess: guessMuscleGroup(exerciseTitle),
      superset_id: r.superset_id || null,
      exercise_notes: r.exercise_notes || "",
      set_index: setIndex,
      set_type: r.set_type || "normal",
      weight_kg: weightKg,
      reps: reps != null ? Math.round(reps) : null,
      distance_km: distanceKm,
      duration_seconds: duration != null ? Math.round(duration) : null,
      rpe: num(r.rpe)
    });
  }
  if (unparsedDates.size) {
    console.warn(`[Skullcrusher] ${unparsedDates.size} date(s) non reconnue(s), ex. :`, [...unparsedDates].slice(0, 3));
  }
  return { rows, unparsedDates: [...unparsedDates], headers: parsed.meta.fields || [] };
}

export async function importCsvFile(file, onProgress) {
  const text = await file.text();
  const { rows, unparsedDates, headers } = parseCsvText(text);
  if (rows.length === 0) {
    if (!headers.includes("exercise_title") || !headers.includes("start_time")) {
      throw new Error(t("Ce fichier ne ressemble pas à un export Hevy (colonnes exercise_title / start_time introuvables). Dans Hevy : Profil → Réglages → Exporter les données → Exporter les séances."));
    }
    if (unparsedDates.length) {
      throw new Error(t("Format de date non reconnu (ex. « {sample} »). Signale-le pour qu'on l'ajoute.", { sample: unparsedDates[0] }));
    }
    throw new Error(t("Aucune ligne exploitable trouvée dans ce fichier."));
  }
  return await importRows(rows, onProgress);
}
