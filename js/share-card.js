// ============================================================
// IMAGES À PARTAGER (Instagram, TikTok, WhatsApp…) — dessinées dans le
// style de l'app, au format vertical Story / Reel (9:16), post (4:5) ou
// carré. Quatre contenus : une séance, les stats d'une période, un exercice,
// l'état des lieux du plan en cours. En-tête « profil » (avatar, pseudo,
// niveau · objectif · salle), photo facultative (profil, appareil photo ou
// galerie) et signature « App Skullcrusher » avec l'icône de l'app.
// « Partager » ouvre le menu de partage du téléphone (Instagram y apparaît
// directement) ; « Enregistrer » télécharge l'image pour la galerie.
// Aucun envoi à un serveur : l'image est fabriquée sur l'appareil.
// ============================================================
import * as db from "./db.js";
import { openModal, closeModal, toast, esc, estimate1RM, isoWeek, safeImageUrl } from "./utils.js";
import { getWorkouts, getSetsForPeriod, getSetsForExercise, getExercises } from "./cache.js";
import { t, locale } from "./i18n.js";

// ---------- Palette et polices de l'app ----------
const C = {
  bg: "#0B0B0C", surface: "#161617", raised: "#202022", line: "#2A2A2E",
  red: "#E02424", redSoft: "rgba(224,36,36,0.16)", text: "#EEEDEB", dim: "#8D8D92", green: "#5FBE72"
};
// i18n-keys: "Story / Reel", "Post", "Carré"
const FORMATS = {
  story: { w: 1080, h: 1920, label: "Story / Reel", ratio: "9:16" },
  post: { w: 1080, h: 1350, label: "Post", ratio: "4:5" },
  square: { w: 1080, h: 1080, label: "Carré", ratio: "1:1" }
};
const ANTON = "Anton, 'Barlow Condensed', Impact, sans-serif";
const INTER = "Inter, system-ui, sans-serif";

let assetsPromise = null;
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      document.fonts?.load(`100px ${ANTON}`).catch(() => null),
      document.fonts?.load(`700 40px ${INTER}`).catch(() => null),
      document.fonts?.load(`500 40px ${INTER}`).catch(() => null),
      loadImage("icons/logo.png"),
      loadImage("icons/horns.png"),
      loadImage("icons/icon-192.png")
    ]).then(([, , , logo, horns, appIcon]) => ({ logo, horns, appIcon }));
  }
  return assetsPromise;
}

// ---------- Aides de dessin ----------
const nf = (n, d = 0) => Number(n || 0).toLocaleString(locale(), { maximumFractionDigits: d });
function font(ctx, size, family = INTER, weight = 600) { ctx.font = `${family === ANTON ? "" : weight + " "}${Math.round(size)}px ${family}`; }
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// Texte réduit jusqu'à tenir dans maxW (renvoie la taille utilisée).
function fitText(ctx, text, x, y, maxW, size, family, weight, color, align = "left", min = 22) {
  let s = size;
  font(ctx, s, family, weight);
  while (ctx.measureText(text).width > maxW && s > min) { s -= 2; font(ctx, s, family, weight); }
  let out = text;
  if (ctx.measureText(out).width > maxW) {
    while (out.length > 1 && ctx.measureText(out + "…").width > maxW) out = out.slice(0, -1);
    out += "…";
  }
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
  ctx.fillText(out, x, y);
  ctx.textAlign = "left";
  return s;
}
// Texte sur plusieurs lignes (renvoie la hauteur utilisée).
function wrapText(ctx, text, x, y, maxW, size, family, weight, color, maxLines = 2, lineH = 1.08) {
  font(ctx, size, family, weight);
  ctx.fillStyle = color; ctx.textBaseline = "alphabetic";
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = shown[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    shown[maxLines - 1] = last + "…";
  }
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * size * lineH));
  return shown.length * size * lineH;
}

function background(ctx, W, H, assets) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  // Halo rouge en haut à droite
  let g = ctx.createRadialGradient(W * 0.95, -H * 0.02, 20, W * 0.95, -H * 0.02, W * 1.05);
  g.addColorStop(0, "rgba(224,36,36,0.55)"); g.addColorStop(0.45, "rgba(224,36,36,0.12)"); g.addColorStop(1, "rgba(224,36,36,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Lueur basse
  g = ctx.createRadialGradient(0, H, 10, 0, H, W * 0.9);
  g.addColorStop(0, "rgba(224,36,36,0.22)"); g.addColorStop(1, "rgba(224,36,36,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Bande diagonale
  ctx.save();
  ctx.globalAlpha = 0.07; ctx.fillStyle = C.red;
  ctx.beginPath(); ctx.moveTo(W * 0.55, 0); ctx.lineTo(W * 0.72, 0); ctx.lineTo(W * 0.1, H); ctx.lineTo(-W * 0.07, H); ctx.closePath(); ctx.fill();
  ctx.restore();
  // Cornes en filigrane
  if (assets.horns) {
    ctx.save(); ctx.globalAlpha = 0.06;
    const hh = H * 0.42, hw = hh * assets.horns.width / assets.horns.height;
    ctx.drawImage(assets.horns, W - hw * 0.8, H - hh * 0.95, hw, hh);
    ctx.restore();
  }
}

// Image dessinée en « cover » (recadrée pour remplir le cadre).
function drawCover(ctx, img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// En-tête « profil » : avatar cerclé de rouge, pseudo, niveau · objectif ·
// salle, pastille (date ou période). Sans pseudo : logo Skullcrusher.
function header(ctx, W, pad, assets, rightText, opts = {}, fmt = "story") {
  const size = fmt === "square" ? 118 : 138;
  const top = pad - 6;
  const cx = pad + size / 2, cy = top + size / 2;
  // anneau lumineux
  ctx.save();
  ctx.shadowColor = "rgba(224,36,36,0.85)"; ctx.shadowBlur = 34;
  ctx.beginPath(); ctx.arc(cx, cy, size / 2 + 6, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, size / 2 + 1, 0, Math.PI * 2); ctx.fillStyle = C.bg; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, size / 2 - 5, 0, Math.PI * 2); ctx.clip();
  if (opts.name && opts.avatar) drawCover(ctx, opts.avatar, cx - size / 2, cy - size / 2, size, size);
  else if (opts.name) {
    const g = ctx.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
    g.addColorStop(0, "#2A2A2E"); g.addColorStop(1, "#161617");
    ctx.fillStyle = g; ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    font(ctx, size * 0.55, ANTON); ctx.fillStyle = C.red; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(opts.name.slice(0, 1).toUpperCase(), cx, cy + 4); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  } else {
    ctx.fillStyle = "#161617"; ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    if (assets.logo) { const h = size * 0.78, w = h * assets.logo.width / assets.logo.height; ctx.drawImage(assets.logo, cx - w / 2, cy - h / 2, w, h); }
  }
  ctx.restore();
  // pseudo + sous-titre
  const tx = pad + size + 34, tw = W - pad - tx;
  const nameText = (opts.name || "Skullcrusher").toUpperCase();
  fitText(ctx, nameText, tx, top + size * 0.5, tw, fmt === "square" ? 60 : 70, ANTON, 400, C.text, "left", 34);
  const sub = opts.name ? opts.subtitle : "";
  if (sub) fitText(ctx, sub, tx, top + size * 0.5 + 44, tw, 28, INTER, 600, C.dim, "left", 18);
  let bottom = top + size + 10;
  if (rightText) {
    font(ctx, 24, INTER, 800);
    const label = rightText.toUpperCase();
    const lw = Math.min(ctx.measureText(label).width + 36, tw);
    const ly = top + size * 0.5 + (sub ? 64 : 22);
    rr(ctx, tx, ly, lw, 42, 21); ctx.fillStyle = C.redSoft; ctx.fill(); ctx.strokeStyle = "rgba(224,36,36,0.6)"; ctx.lineWidth = 2; ctx.stroke();
    fitText(ctx, label, tx + 18, ly + 29, lw - 36, 24, INTER, 800, C.text, "left", 14);
    bottom = Math.max(bottom, ly + 42 + 12); // la pastille ne doit pas mordre sur la suite
  }
  return bottom;
}

// Photo (prise sur le moment, galerie ou profil) : grand cadre recadré,
// bordure rouge, dégradé vers le fond. Une petite photo (profil) est
// affichée en portrait rond plutôt qu'agrandie et floue.
function photoBlock(ctx, x, y, w, h, img) {
  if (Math.max(img.width, img.height) < 500) {
    const d = Math.min(h, w) * 0.92, cx = x + w / 2, cy = y + h / 2;
    ctx.save(); ctx.shadowColor = "rgba(224,36,36,0.8)"; ctx.shadowBlur = 50;
    ctx.beginPath(); ctx.arc(cx, cy, d / 2 + 8, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.clip(); drawCover(ctx, img, cx - d / 2, cy - d / 2, d, d); ctx.restore();
    return y + h;
  }
  ctx.save();
  ctx.shadowColor = "rgba(224,36,36,0.55)"; ctx.shadowBlur = 40;
  rr(ctx, x, y, w, h, 34); ctx.fillStyle = C.surface; ctx.fill();
  ctx.restore();
  ctx.save(); rr(ctx, x, y, w, h, 34); ctx.clip();
  drawCover(ctx, img, x, y, w, h);
  const g = ctx.createLinearGradient(0, y + h * 0.55, 0, y + h);
  g.addColorStop(0, "rgba(11,11,12,0)"); g.addColorStop(1, "rgba(11,11,12,0.75)");
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.restore();
  rr(ctx, x, y, w, h, 34); ctx.lineWidth = 4; ctx.strokeStyle = C.red; ctx.stroke();
  return y + h;
}
// Photo sous l'en-tête (si choisie) ; renvoie le nouveau y.
function withPhoto(ctx, y, W, pad, d, fmt) {
  if (!d.opts.photo) return y;
  return photoBlock(ctx, pad, y + 26, W - pad * 2, photoH(fmt), d.opts.photo) + 6;
}
// Hauteur du cadre photo selon le format.
const photoH = (fmt) => fmt === "story" ? 600 : fmt === "post" ? 290 : 195;

// Signature : icône de l'app + « App Skullcrusher ».
function footer(ctx, W, H, pad, assets, note) {
  const y = H - pad;
  ctx.fillStyle = C.line; ctx.fillRect(pad, y - 86, W - pad * 2, 2);
  const s = 60, iy = y - 66;
  if (assets.appIcon) {
    ctx.save(); rr(ctx, pad, iy, s, s, 15); ctx.clip(); ctx.drawImage(assets.appIcon, pad, iy, s, s); ctx.restore();
    rr(ctx, pad, iy, s, s, 15); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.stroke();
  }
  font(ctx, 20, INTER, 700); ctx.fillStyle = C.dim; ctx.fillText("APP", pad + s + 18, iy + 24);
  font(ctx, 34, ANTON); ctx.fillStyle = C.text; ctx.fillText("SKULLCRUSHER", pad + s + 18, iy + 58);
  if (note) fitText(ctx, note, W - pad, y - 24, W * 0.45, 22, INTER, 500, C.dim, "right", 16);
}

function tile(ctx, x, y, w, h, value, label, accent = false) {
  rr(ctx, x, y, w, h, 26);
  ctx.fillStyle = accent ? C.redSoft : "rgba(32,32,34,0.88)"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = accent ? C.red : C.line; ctx.stroke();
  fitText(ctx, value, x + w / 2, y + h * 0.62, w - 30, Math.min(h * 0.5, 104), ANTON, 400, accent ? C.red : C.text, "center", 30);
  fitText(ctx, label.toUpperCase(), x + w / 2, y + h - 26, w - 24, 26, INTER, 700, C.dim, "center", 16);
}
function tiles(ctx, x, y, W, h, items) {
  const gap = 20, w = (W - gap * (items.length - 1)) / items.length;
  items.forEach((it, i) => tile(ctx, x + i * (w + gap), y, w, h, it.value, it.label, it.accent));
  return y + h;
}
function sectionTitle(ctx, text, x, y) {
  ctx.fillStyle = C.red; ctx.fillRect(x, y - 30, 8, 36);
  font(ctx, 40, ANTON); ctx.fillStyle = C.text; ctx.fillText(text.toUpperCase(), x + 24, y);
  return y + 26;
}
function chips(ctx, x, y, maxW, labels) {
  font(ctx, 30, INTER, 700);
  let cx = x, cy = y;
  for (const l of labels) {
    const w = ctx.measureText(l).width + 44;
    if (cx + w > x + maxW) { cx = x; cy += 64; }
    rr(ctx, cx, cy, w, 52, 26); ctx.fillStyle = C.redSoft; ctx.fill(); ctx.strokeStyle = "rgba(224,36,36,0.55)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = C.text; ctx.fillText(l, cx + 22, cy + 36);
    cx += w + 14;
  }
  return cy + 52;
}
// Liste « nom … valeur » avec barre de proportion.
function rows(ctx, x, y, W, items, rowH = 78) {
  const max = Math.max(...items.map(i => i.ratio ?? 0), 1);
  items.forEach((it, i) => {
    const ry = y + i * rowH;
    rr(ctx, x, ry, W, rowH - 12, 18); ctx.fillStyle = "rgba(22,22,23,0.9)"; ctx.fill();
    if (it.ratio != null) {
      rr(ctx, x, ry, Math.max(40, W * (it.ratio / max)), rowH - 12, 18); ctx.fillStyle = "rgba(224,36,36,0.18)"; ctx.fill();
    }
    fitText(ctx, it.label, x + 24, ry + rowH / 2 + 6, W * 0.6, 32, INTER, 700, C.text);
    fitText(ctx, it.value, x + W - 24, ry + rowH / 2 + 6, W * 0.36, 32, ANTON, 400, it.accent ? C.red : C.text, "right");
  });
  return y + items.length * rowH;
}
function fmtMinutes(min) {
  if (!min) return "—";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}
function fmtLoad(kg) {
  return kg >= 10000 ? `${nf(kg / 1000, 1)} t` : `${nf(kg)} kg`;
}

// ---------- Données ----------
function workoutMinutes(w) {
  const s = Date.parse(w.start_time), e = Date.parse(w.end_time);
  return s && e && e > s ? Math.round((e - s) / 60000) : 0;
}
function bestOf(sets) {
  return sets.filter(s => s.weight_kg > 0 && s.reps > 0 && s.set_type !== "warmup")
    .sort((a, b) => b.weight_kg - a.weight_kg || b.reps - a.reps)[0] || null;
}

async function workoutData(w, opts) {
  const sets = (await db.listSets(w.id)).filter(s => !w.owner_uid || s.owner_uid === w.owner_uid)
    .sort((a, b) => (a.exercise_index ?? 999) - (b.exercise_index ?? 999) || a.set_index - b.set_index);
  const byEx = new Map();
  sets.forEach(s => { if (!byEx.has(s.exercise_title)) byEx.set(s.exercise_title, []); byEx.get(s.exercise_title).push(s); });
  const exercises = [...byEx].map(([name, list]) => {
    const logged = list.filter(s => s.weight_kg != null || s.reps != null);
    const b = bestOf(logged);
    return { name, sets: logged.length, best: b, volume: logged.reduce((a, s) => a + (s.weight_kg || 0) * (s.reps || 0), 0) };
  }).filter(e => e.sets);
  const tonnage = w.total_tonnage ?? exercises.reduce((a, e) => a + e.volume, 0);
  const totalSets = w.total_sets ?? exercises.reduce((a, e) => a + e.sets, 0);
  return { w, exercises, tonnage, totalSets, minutes: workoutMinutes(w), records: Array.isArray(w.records) ? w.records : [], muscles: w.muscle_summary || [], opts };
}

const PERIOD_CHOICES = [
  // i18n-keys: "7 jours", "30 jours", "3 mois", "6 mois", "12 mois", "Tout"
  { key: "7", days: 7, label: "7 jours" }, { key: "30", days: 30, label: "30 jours" },
  { key: "90", days: 91, label: "3 mois" }, { key: "180", days: 182, label: "6 mois" },
  { key: "365", days: 365, label: "12 mois" }, { key: "all", days: null, label: "Tout" }
];

async function periodData(days) {
  const since = days ? Date.now() - days * 86400000 : 0;
  const workouts = (await getWorkouts()).filter(w => w.end_time && Date.parse(w.start_time) >= since);
  const sets = (await getSetsForPeriod(days ? Math.ceil(days / 7) + 1 : null))
    .filter(s => Date.parse(s.workout_start_time || 0) >= since && (s.weight_kg != null || s.reps != null));
  const library = await getExercises();
  const groupOf = new Map(library.map(e => [e.name, e.muscle_group]));
  const perMuscle = {}, perEx = new Map();
  sets.forEach(s => {
    const g = groupOf.get(s.exercise_title) || "Autre";
    perMuscle[g] = (perMuscle[g] || 0) + 1;
    if (!perEx.has(s.exercise_title)) perEx.set(s.exercise_title, []);
    perEx.get(s.exercise_title).push(s);
  });
  const records = workouts.flatMap(w => (w.records || []).map(r => ({ ...r, date: w.start_time })))
    .sort((a, b) => (b.one_rm - b.prev_one_rm) - (a.one_rm - a.prev_one_rm));
  const dayKeys = new Set(workouts.map(w => new Date(w.start_time).toDateString()));
  return {
    days, since, workouts,
    count: workouts.length,
    tonnage: workouts.reduce((a, w) => a + (w.total_tonnage || 0), 0),
    sets: workouts.reduce((a, w) => a + (w.total_sets || 0), 0),
    minutes: workouts.reduce((a, w) => a + workoutMinutes(w), 0),
    activeDays: dayKeys,
    muscles: Object.entries(perMuscle).sort((a, b) => b[1] - a[1]).slice(0, 5),
    topExercises: [...perEx].map(([name, list]) => ({ name, sets: list.length, best: bestOf(list) })).sort((a, b) => b.sets - a.sets).slice(0, 4),
    records
  };
}

async function exerciseData(name, days) {
  const since = days ? Date.now() - days * 86400000 : 0;
  const all = (await getSetsForExercise(name)).filter(s => s.weight_kg > 0 && s.reps > 0 && s.set_type !== "warmup");
  const sets = all.filter(s => Date.parse(s.workout_start_time || 0) >= since);
  const valid = sets.filter(s => s.reps <= 15);
  // Meilleure 1RM estimée par semaine, ou par mois sur une longue période
  // (courbe plus lisible).
  const spanDays = valid.length ? (Date.now() - Math.min(...valid.map(s => Date.parse(s.workout_start_time)))) / 86400000 : 0;
  const byMonth = spanDays > 200;
  const perKey = {};
  valid.forEach(s => {
    const key = byMonth ? String(s.workout_start_time).slice(0, 7) : isoWeek(s.workout_start_time);
    const rm = estimate1RM(s.weight_kg, s.reps);
    if (!perKey[key] || rm > perKey[key]) perKey[key] = rm;
  });
  const weeks = Object.keys(perKey).sort();
  const series = weeks.map(k => perKey[k]);
  const best1rm = valid.length ? Math.max(...valid.map(s => estimate1RM(s.weight_kg, s.reps))) : null;
  const first = series[0], last = series[series.length - 1];
  return {
    name, days, sets, best1rm, best: bestOf(sets),
    progress: series.length >= 2 && first ? Math.round((last - first) / first * 100) : null,
    sessions: new Set(sets.map(s => s.workout_id || s.workout_start_time)).size,
    volume: sets.reduce((a, s) => a + s.weight_kg * s.reps, 0),
    series, weeks, byMonth
  };
}

// ---------- Rendu ----------
function renderWorkout(ctx, W, H, d, assets, fmt) {
  const pad = 70, inner = W - pad * 2;
  const compact = fmt !== "story";
  let y = header(ctx, W, pad, assets, new Date(d.w.start_time).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" }), d.opts, fmt);
  y = withPhoto(ctx, y, W, pad, d, fmt);
  const tight = compact && d.opts.photo;
  y += tight ? 64 : compact ? 70 : 100;
  font(ctx, 30, INTER, 700); ctx.fillStyle = C.red; ctx.fillText(t("SÉANCE TERMINÉE").toUpperCase(), pad, y); y += 20;
  const ts = tight ? 72 : compact ? 92 : 118;
  y += wrapText(ctx, String(d.w.title || "").toUpperCase(), pad, y + ts, inner, ts, ANTON, 400, C.text, tight ? 1 : 2) + 8;
  const sub = d.opts.partners?.length ? t("avec {names}", { names: d.opts.partners.join(", ") }) : "";
  if (sub) { fitText(ctx, sub, pad, y + 30, inner, 34, INTER, 600, C.dim); y += 50; }
  y += compact ? 24 : 44;
  const hero = [
    ...(d.opts.showWeights ? [{ value: fmtLoad(d.tonnage), label: t("soulevés"), accent: true }] : []),
    { value: String(d.totalSets), label: t("séries") },
    { value: fmtMinutes(d.minutes), label: t("durée") }
  ];
  if (d.opts.kcal) hero.push({ value: `${nf(d.opts.kcal)}`, label: "kcal" });
  y = tiles(ctx, pad, y, inner, tight ? 160 : compact ? 190 : 230, hero) + (compact ? 40 : 64);

  const footerTop = H - pad - 100;
  const room = () => footerTop - y;
  if (d.records.length && room() > 200) {
    y = sectionTitle(ctx, `🏆 ${t("Records")}`, pad, y + 30) + 16;
    const n = Math.max(1, Math.min(d.records.length, fmt === "story" ? 3 : fmt === "post" ? 2 : 1, Math.floor((room() - 40) / 78)));
    y = rows(ctx, pad, y, inner, d.records.slice(0, n).map(r => ({ label: r.exercise, value: d.opts.showWeights ? `${nf(r.kg, 1)} kg × ${r.reps}` : `+${nf(r.one_rm - r.prev_one_rm, 1)} kg`, accent: true }))) + (compact ? 26 : 44);
  }
  if (d.exercises.length && room() > 200) {
    y = sectionTitle(ctx, t("Exercices"), pad, y + 30) + 16;
    const n = Math.max(1, Math.min(d.exercises.length, fmt === "story" ? 6 : 3, Math.floor((room() - 30) / 78)));
    const maxVol = Math.max(...d.exercises.map(e => e.sets));
    y = rows(ctx, pad, y, inner, d.exercises.slice(0, n).map(e => ({
      label: e.name,
      value: d.opts.showWeights && e.best ? `${nf(e.best.weight_kg, 1)} × ${e.best.reps}` : tn2(e.sets),
      ratio: e.sets / maxVol
    }))) + 20;
    if (d.exercises.length > n) { font(ctx, 26, INTER, 600); ctx.fillStyle = C.dim; ctx.fillText(t("+ {n} autre(s) exercice(s)", { n: d.exercises.length - n }), pad, y + 12); y += 30; }
  }
  if (d.muscles.length && room() > 90) chips(ctx, pad, y + 20, inner, d.muscles.slice(0, 6).map(m => t(m)));
  footer(ctx, W, H, pad, assets, "");
}
const tn2 = (n) => n > 1 ? t("{n} séries", { n }) : t("{n} série", { n });

function heatmap(ctx, x, y, W, d) {
  // Jours d'activité : grille 7 lignes (lun → dim) sur les dernières semaines.
  const weeks = Math.min(13, Math.max(1, Math.ceil((d.days || 91) / 7)));
  const gap = 8, cell = Math.min(56, (W - gap * (weeks - 1)) / weeks);
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const endDow = (end.getDay() + 6) % 7;
  const start = new Date(end); start.setDate(end.getDate() - endDow - (weeks - 1) * 7);
  for (let c = 0; c < weeks; c++) for (let r = 0; r < 7; r++) {
    const day = new Date(start); day.setDate(start.getDate() + c * 7 + r);
    if (day > end) continue;
    const on = d.activeDays.has(day.toDateString());
    rr(ctx, x + c * (cell + gap), y + r * (cell + gap), cell, cell, 10);
    ctx.fillStyle = on ? C.red : "rgba(255,255,255,0.06)"; ctx.fill();
  }
  return y + 7 * (cell + gap);
}

function renderPeriod(ctx, W, H, d, assets, fmt, label) {
  const pad = 70, inner = W - pad * 2;
  const compact = fmt !== "story";
  let y = header(ctx, W, pad, assets, new Date().toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" }), d.opts, fmt);
  y = withPhoto(ctx, y, W, pad, d, fmt);
  const tight = compact && d.opts.photo;
  y += tight ? 64 : compact ? 70 : 100;
  font(ctx, 30, INTER, 700); ctx.fillStyle = C.red; ctx.fillText(t("MON BILAN").toUpperCase(), pad, y); y += 20;
  const ts = tight ? 76 : compact ? 96 : 124;
  y += wrapText(ctx, label.toUpperCase(), pad, y + ts, inner, ts, ANTON, 400, C.text, tight ? 1 : 2) + (compact ? 30 : 56);
  const h = tight ? 160 : compact ? 180 : 220;
  y = tiles(ctx, pad, y, inner, h, [
    { value: String(d.count), label: t("séances"), accent: true },
    ...(d.opts.showWeights ? [{ value: fmtLoad(d.tonnage), label: t("soulevés") }] : [{ value: String(d.sets), label: t("séries") }]),
    { value: fmtMinutes(d.minutes), label: t("d'entraînement") }
  ]) + (compact ? 34 : 56);
  const footerTop = H - pad - 100;
  const room = () => footerTop - y;
  if (fmt === "story" && d.days && d.days <= 91 && room() > 520) {
    y = sectionTitle(ctx, t("Régularité"), pad, y + 30) + 24;
    y = heatmap(ctx, pad, y, inner, d) + 40;
  }
  if (d.muscles.length && room() > 220) {
    y = sectionTitle(ctx, t("Muscles travaillés"), pad, y + 30) + 16;
    const n = Math.max(1, Math.min(d.muscles.length, fmt === "square" ? 3 : 5, Math.floor((room() - 30) / 78)));
    y = rows(ctx, pad, y, inner, d.muscles.slice(0, n).map(([m, c]) => ({ label: t(m), value: tn2(c), ratio: c }))) + 20;
  }
  if (d.records.length && room() > 200) {
    y = sectionTitle(ctx, `🏆 ${t("Records")}`, pad, y + 30) + 16;
    const n = Math.max(1, Math.min(d.records.length, fmt === "story" ? 3 : 1, Math.floor((room() - 30) / 78)));
    rows(ctx, pad, y, inner, d.records.slice(0, n).map(r => ({ label: r.exercise, value: d.opts.showWeights ? `${nf(r.kg, 1)} kg × ${r.reps}` : `+${nf(r.one_rm - r.prev_one_rm, 1)} kg`, accent: true })));
  }
  footer(ctx, W, H, pad, assets, "");
}

function lineChart(ctx, x, y, w, h, series) {
  rr(ctx, x, y, w, h, 26); ctx.fillStyle = "rgba(22,22,23,0.9)"; ctx.fill();
  if (series.length < 2) return y + h;
  const px = 36, py = 40;
  const min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => [x + px + (w - px * 2) * (i / (series.length - 1)), y + h - py - (h - py * 2) * ((v - min) / span)]);
  // aire
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "rgba(224,36,36,0.45)"); g.addColorStop(1, "rgba(224,36,36,0)");
  ctx.beginPath(); ctx.moveTo(pts[0][0], y + h - py);
  pts.forEach(p => ctx.lineTo(p[0], p[1]));
  ctx.lineTo(pts[pts.length - 1][0], y + h - py); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  // ligne
  ctx.save(); ctx.shadowColor = "rgba(224,36,36,0.8)"; ctx.shadowBlur = 24;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.strokeStyle = C.red; ctx.lineWidth = 8; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(); ctx.restore();
  const last = pts[pts.length - 1];
  ctx.beginPath(); ctx.arc(last[0], last[1], 14, 0, Math.PI * 2); ctx.fillStyle = C.text; ctx.fill();
  ctx.beginPath(); ctx.arc(last[0], last[1], 8, 0, Math.PI * 2); ctx.fillStyle = C.red; ctx.fill();
  return y + h;
}

function renderExercise(ctx, W, H, d, assets, fmt, periodLabel) {
  const pad = 70, inner = W - pad * 2;
  const compact = fmt !== "story";
  let y = header(ctx, W, pad, assets, periodLabel, d.opts, fmt);
  y = withPhoto(ctx, y, W, pad, d, fmt);
  const tight = compact && d.opts.photo;
  y += tight ? 64 : compact ? 70 : 100;
  font(ctx, 30, INTER, 700); ctx.fillStyle = C.red; ctx.fillText(t("MA PROGRESSION").toUpperCase(), pad, y); y += 20;
  const ts = tight ? 70 : compact ? 88 : 112;
  y += wrapText(ctx, d.name.toUpperCase(), pad, y + ts, inner, ts, ANTON, 400, C.text, tight ? 1 : 2) + (compact ? 30 : 56);
  const hero = d.opts.showWeights
    ? [{ value: d.best1rm ? `${nf(d.best1rm)} kg` : "—", label: t("1RM estimée"), accent: true },
       { value: d.best ? `${nf(d.best.weight_kg, 1)}×${d.best.reps}` : "—", label: t("meilleure série") },
       { value: d.progress != null ? `${d.progress > 0 ? "+" : ""}${d.progress}%` : "—", label: t("progression") }]
    : [{ value: d.progress != null ? `${d.progress > 0 ? "+" : ""}${d.progress}%` : "—", label: t("progression"), accent: true },
       { value: String(d.sessions), label: t("séances") },
       { value: String(d.sets.length), label: t("séries") }];
  y = tiles(ctx, pad, y, inner, tight ? 160 : compact ? 180 : 220, hero) + (compact ? 30 : 50);
  const footerTop = H - pad - 100;
  const chartH = Math.min(fmt === "story" ? 560 : fmt === "post" ? 330 : 200, footerTop - y - (fmt === "story" ? 220 : 60));
  if (chartH > 120 && d.series.length >= 2) {
    y = sectionTitle(ctx, d.byMonth ? t("1RM estimée par mois") : t("1RM estimée par semaine"), pad, y + 30) + 20;
    y = lineChart(ctx, pad, y, inner, chartH, d.series) + 36;
  }
  if (fmt === "story" && footerTop - y > 200) {
    y = rows(ctx, pad, y, inner, [
      { label: t("Séances"), value: String(d.sessions) },
      { label: t("Séries"), value: String(d.sets.length) },
      ...(d.opts.showWeights ? [{ label: t("Volume total"), value: fmtLoad(d.volume) }] : [])
    ].slice(0, Math.max(1, Math.floor((footerTop - y) / 78))));
  }
  footer(ctx, W, H, pad, assets, d.opts.showWeights ? t("1RM estimée (formule d'Epley) : valeur indicative") : "");
}

// ---------- État des lieux du plan en cours ----------
function renderPlan(ctx, W, H, d, assets, fmt) {
  const pad = 70, inner = W - pad * 2;
  const compact = fmt !== "story";
  const { plan, pos, st } = d;
  const status = pos.status === "upcoming" ? t("À venir") : pos.status === "done" ? t("Terminé") : t("Semaine {w}/{total}", { w: pos.week, total: pos.total });
  let y = header(ctx, W, pad, assets, status, d.opts, fmt);
  y = withPhoto(ctx, y, W, pad, d, fmt);
  const tight = compact && d.opts.photo;
  y += tight ? 64 : compact ? 70 : 100;
  font(ctx, 30, INTER, 700); ctx.fillStyle = C.red; ctx.fillText(t("MON PLAN").toUpperCase(), pad, y); y += 20;
  const ts = tight ? 70 : compact ? 86 : 108;
  y += wrapText(ctx, String(plan.name || "").toUpperCase(), pad, y + ts, inner, ts, ANTON, 400, C.text, tight ? 1 : 2) + (compact ? 22 : 34);
  // Barre d'avancement
  const pct = pos.status === "done" ? 100 : pos.status === "upcoming" ? 0 : Math.round((pos.week - 1) / pos.total * 100);
  const bh = compact ? 30 : 38;
  rr(ctx, pad, y, inner, bh, bh / 2); ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
  if (pct > 0) {
    const g = ctx.createLinearGradient(pad, 0, pad + inner, 0);
    g.addColorStop(0, C.red); g.addColorStop(1, C.green);
    ctx.save(); ctx.shadowColor = "rgba(224,36,36,0.6)"; ctx.shadowBlur = 18;
    rr(ctx, pad, y, Math.max(bh, inner * pct / 100), bh, bh / 2); ctx.fillStyle = g; ctx.fill(); ctx.restore();
  }
  y += bh + 40;
  const block = pos.block?.name ? `${pos.block.name} · ` : "";
  fitText(ctx, `${block}${t("Avancement du plan")}`, pad, y, inner * 0.7, 28, INTER, 600, C.dim);
  fitText(ctx, `${pct} %`, pad + inner, y, inner * 0.3, 40, ANTON, 400, C.text, "right");
  y += compact ? 36 : 50;
  y = tiles(ctx, pad, y, inner, tight ? 160 : compact ? 180 : 220, [
    { value: `${st.done}/${st.planned}`, label: t("séances faites"), accent: true },
    { value: st.adherence == null ? "—" : `${st.adherence}%`, label: t("assiduité") },
    { value: String(st.streak), label: t("sem. complètes") }
  ]) + (compact ? 30 : 50);
  const footerTop = H - pad - 100;
  const room = () => footerTop - y;
  // Semaine par semaine : une ligne par semaine (faites, manquées, à venir).
  const weeks = st.weeks;
  const rowH = compact ? 50 : 62;
  if (room() > rowH * 2 + 80) {
    y = sectionTitle(ctx, t("Semaine par semaine"), pad, y + 30) + 22;
    const maxRows = Math.floor((room() - (fmt === "story" && d.opts.showWeights ? 240 : 10)) / rowH);
    // Semaines autour de la semaine en cours si tout ne tient pas.
    const cur = Math.max(0, weeks.findIndex(w => w.state === "current"));
    const start = Math.max(0, Math.min(cur - Math.floor(maxRows / 2), weeks.length - maxRows));
    const shown = weeks.slice(start, start + Math.max(1, maxRows));
    const cell = rowH - 14;
    shown.forEach((w, i) => {
      const ry = y + i * rowH;
      if (w.state === "current") { rr(ctx, pad - 10, ry - 7, inner + 20, rowH, 14); ctx.fillStyle = "rgba(224,36,36,0.12)"; ctx.fill(); }
      fitText(ctx, `S${w.n}`, pad, ry + cell * 0.72, 90, 32, ANTON, 400, w.state === "future" ? C.dim : C.text);
      w.slots.forEach((sl, j) => {
        const cx = pad + 110 + j * (cell + 12);
        rr(ctx, cx, ry, cell, cell, 10);
        ctx.fillStyle = sl.done ? C.green : w.state === "future" || (!sl.past && !sl.done) ? "rgba(255,255,255,0.07)" : "rgba(224,36,36,0.45)";
        ctx.fill();
        if (sl.done) { font(ctx, cell * 0.6, INTER, 800); ctx.fillStyle = C.bg; ctx.textAlign = "center"; ctx.fillText("✓", cx + cell / 2, ry + cell * 0.72); ctx.textAlign = "left"; }
      });
      if (w.state !== "future") fitText(ctx, `${w.done}/${w.slots.length}`, pad + inner, ry + cell * 0.72, 120, 28, INTER, 700, C.dim, "right");
    });
    y += shown.length * rowH + 20;
  }
  if (fmt === "story" && d.opts.showWeights && room() > 220) {
    tiles(ctx, pad, y + 20, inner, 180, [
      { value: fmtLoad(st.tonnage), label: t("soulevés") },
      { value: nf(st.sets), label: t("séries") },
      { value: st.minutes >= 60 ? `${Math.floor(st.minutes / 60)} h` : `${nf(st.minutes)} min`, label: t("d'entraînement") }
    ]);
  }
  footer(ctx, W, H, pad, assets, "");
}

// ---------- Fenêtre de partage ----------
// kind : "workout" (séance), "period" (bilan d'une période), "exercise",
// "plan" (état des lieux du plan en cours).
export async function openShareCard({ kind, workout = null, exercise = null, partners = [], periodDays = 30, planId = null }) {
  const me = db.getCurrentUser()?.uid;
  const [profile, assets] = await Promise.all([db.getProfile(me).catch(() => null), loadAssets()]);
  const name = profile?.display_name || "";
  const avatarSrc = safeImageUrl(profile?.photo_data_url || "");
  const avatar = avatarSrc ? await loadImage(avatarSrc) : null;
  // i18n-keys: "Débutant", "Intermédiaire", "Avancé", "Force", "Hypertrophie", "Endurance", "Sèche / perte de poids", "Remise en forme"
  const subtitle = [db.ROUTINE_LEVELS[profile?.level], db.ROUTINE_GOALS[profile?.goal], profile?.gym].filter(Boolean).join(" · ");
  const state = { fmt: "story", showWeights: true, showName: true, showKcal: false, photoMode: "none", photoImg: null, period: kind === "exercise" ? "all" : (PERIOD_CHOICES.find(p => p.days === periodDays)?.key || "30") };
  let kcal = null;
  if (kind === "workout") {
    try { const { getBody, workoutCalories } = await import("./calories.js"); kcal = workoutCalories(workout, await getBody())?.kcal || null; } catch (_) {}
  }
  const periodChoice = () => PERIOD_CHOICES.find(p => p.key === state.period);
  const title = kind === "workout" ? t("Partager ma séance") : kind === "period" ? t("Partager mon bilan") : kind === "plan" ? t("Partager l'état de mon plan") : t("Partager ma progression");
  let blob = null, dataCache = {};

  openModal(`
    <h3 style="margin-bottom:6px;">📸 ${esc(title)}</h3>
    <div class="chip-row" id="sc-formats" style="margin:0 0 6px;">
      ${Object.entries(FORMATS).map(([k, f]) => `<div class="chip" data-fmt="${k}">${esc(t(f.label))} <span class="muted" style="font-size:11px;">${f.ratio}</span></div>`).join("")}
    </div>
    ${kind !== "workout" && kind !== "plan" ? `<div class="chip-row pk-scroll" id="sc-periods" style="margin:0 0 6px;">
      ${PERIOD_CHOICES.map(p => `<div class="chip chip-sm" data-period="${p.key}">${esc(t(p.label))}</div>`).join("")}
    </div>` : ""}
    <div class="chip-row pk-scroll" id="sc-photo" style="margin:0 0 6px;">
      <div class="chip chip-sm" data-photo="none">${t("Sans photo")}</div>
      ${avatar ? `<div class="chip chip-sm" data-photo="profile">👤 ${t("Photo de profil")}</div>` : ""}
      <div class="chip chip-sm" data-photo="camera">📷 ${t("Prendre une photo")}</div>
      <div class="chip chip-sm" data-photo="gallery">🖼️ ${t("Galerie")}</div>
    </div>
    <input type="file" id="sc-cam" accept="image/*" capture="environment" hidden>
    <input type="file" id="sc-gal" accept="image/*" hidden>
    <div class="share-preview"><canvas id="sc-canvas"></canvas><div class="share-loading" id="sc-loading">${t("Préparation…")}</div></div>
    <div class="share-options">
      <label><input type="checkbox" id="sc-weights" checked> ${t("Afficher les charges")}</label>
      <label><input type="checkbox" id="sc-name" checked> ${t("Afficher mon pseudo")}</label>
      ${kind === "workout" && kcal ? `<label><input type="checkbox" id="sc-kcal"> ${t("Afficher les calories")}</label>` : ""}
    </div>
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn btn-secondary" id="sc-save">⬇️ ${t("Enregistrer")}</button>
      <button class="btn btn-primary" id="sc-share">📤 ${t("Partager")}</button>
    </div>
    <p class="muted" style="font-size:12px; margin:8px 0 0;">${t("« Partager » ouvre le menu de ton téléphone : choisis Instagram (Story ou publication), TikTok, WhatsApp… L'image est créée sur ton appareil, rien n'est envoyé ailleurs.")}</p>
    <button class="btn btn-secondary btn-sm" id="sc-close" style="margin-top:10px;">${t("Fermer")}</button>
  `, (m) => {
    const canvas = m.querySelector("#sc-canvas");
    const loading = m.querySelector("#sc-loading");
    const draw = async () => {
      loading.style.display = "";
      const f = FORMATS[state.fmt];
      canvas.width = f.w; canvas.height = f.h;
      const ctx = canvas.getContext("2d");
      const photo = state.photoMode === "profile" ? avatar : (state.photoMode === "camera" || state.photoMode === "gallery") ? state.photoImg : null;
      const opts = { name: state.showName ? name : "", avatar, subtitle, photo, showWeights: state.showWeights, kcal: state.showKcal ? kcal : null, partners: state.showName ? partners : [] };
      try {
        background(ctx, f.w, f.h, assets);
        if (kind === "workout") {
          dataCache.w = dataCache.w || await workoutData(workout, opts);
          renderWorkout(ctx, f.w, f.h, { ...dataCache.w, opts }, assets, state.fmt);
        } else if (kind === "plan") {
          if (!dataCache.plan) {
            const { planShareData } = await import("./plans.js");
            dataCache.plan = await planShareData(planId);
          }
          if (dataCache.plan) renderPlan(ctx, f.w, f.h, { ...dataCache.plan, opts }, assets, state.fmt);
        } else if (kind === "period") {
          const p = periodChoice();
          dataCache[p.key] = dataCache[p.key] || await periodData(p.days);
          const label = p.days ? t("Mes {period}", { period: t(p.label) }) : t("Depuis le début");
          renderPeriod(ctx, f.w, f.h, { ...dataCache[p.key], opts }, assets, state.fmt, label);
        } else {
          const p = periodChoice();
          const key = "ex" + p.key;
          dataCache[key] = dataCache[key] || await exerciseData(exercise, p.days);
          renderExercise(ctx, f.w, f.h, { ...dataCache[key], opts }, assets, state.fmt, p.days ? t(p.label) : t("Depuis le début"));
        }
      } catch (e) {
        console.error("[Skullcrusher] Image de partage", e);
        toast(t("Impossible de créer l'image"));
      }
      m.querySelectorAll("[data-fmt]").forEach(c => c.classList.toggle("active", c.dataset.fmt === state.fmt));
      m.querySelectorAll("[data-period]").forEach(c => c.classList.toggle("active", c.dataset.period === state.period));
      m.querySelectorAll("[data-photo]").forEach(c => c.classList.toggle("active", c.dataset.photo === state.photoMode));
      canvas.style.aspectRatio = `${f.w} / ${f.h}`;
      blob = await new Promise(res => canvas.toBlob(res, "image/png"));
      loading.style.display = "none";
    };
    m.querySelectorAll("[data-fmt]").forEach(c => c.onclick = () => { state.fmt = c.dataset.fmt; draw(); });
    m.querySelectorAll("[data-period]").forEach(c => c.onclick = () => { state.period = c.dataset.period; draw(); });
    // Photo : aucune, profil, prise sur le moment ou galerie (reste sur l'appareil).
    const pickPhoto = (input, mode) => {
      input.value = "";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const img = await loadImage(url);
        if (!img) { toast(t("Photo illisible, essaie une autre image")); return; }
        state.photoImg = img; state.photoMode = mode;
        draw();
      };
      input.click();
    };
    m.querySelectorAll("[data-photo]").forEach(c => c.onclick = () => {
      const mode = c.dataset.photo;
      if (mode === "camera") return pickPhoto(m.querySelector("#sc-cam"), "camera");
      if (mode === "gallery") return pickPhoto(m.querySelector("#sc-gal"), "gallery");
      state.photoMode = mode; draw();
    });
    m.querySelector("#sc-weights").onchange = (e) => { state.showWeights = e.target.checked; draw(); };
    m.querySelector("#sc-name").onchange = (e) => { state.showName = e.target.checked; draw(); };
    const kc = m.querySelector("#sc-kcal"); if (kc) kc.onchange = (e) => { state.showKcal = e.target.checked; draw(); };
    const fileName = () => `skullcrusher-${kind === "workout" ? "seance" : kind === "period" ? "bilan" : kind === "plan" ? "plan" : "progression"}-${state.fmt}.png`;
    m.querySelector("#sc-save").onclick = () => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(t("Image enregistrée"));
    };
    m.querySelector("#sc-share").onclick = async () => {
      if (!blob) return;
      const file = new File([blob], fileName(), { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "Skullcrusher", text: "#skullcrusher" }); }
        catch (e) { if (e?.name !== "AbortError") toast(t("Partage impossible : enregistre l'image puis publie-la depuis Instagram.")); }
      } else {
        m.querySelector("#sc-save").click();
        toast(t("Ton navigateur ne peut pas partager directement : l'image est enregistrée, publie-la depuis Instagram."), 4500);
      }
    };
    m.querySelector("#sc-close").onclick = closeModal;
    draw();
  });
}
