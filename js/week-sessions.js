// ============================================================
// SÉANCES D'UNE SEMAINE — règle commune au compteur « Cette semaine »
// (onglet Séance) et au défi de la semaine (Feed → Défis) :
//   - séances terminées (end_time), commencées entre le lundi 0 h de la
//     semaine et maintenant (pas de date dans le futur) ;
//   - deux séances qui se chevauchent dans le temps (même séance importée
//     ou ajoutée deux fois) ne comptent qu'une fois : on garde celle faite
//     dans l'app depuis une routine ou un plan, puis celle faite dans
//     l'app, puis l'import.
// ============================================================

export function mondayOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return d;
}

const keepScore = (w) => (w.plan_id || w.routine_id ? 2 : 0) + (w.imported_at ? 0 : 1);

// Séances terminées commencées entre from et to (bornée à maintenant),
// doublons (séances qui se chevauchent) comptés une fois.
export function sessionsBetween(workouts, from, to) {
  const now = new Date();
  const end = to < now ? to : now;
  const list = workouts.filter(w => {
    if (!w.end_time || !w.start_time) return false;
    const start = new Date(w.start_time);
    return !isNaN(start) && start >= from && start <= end;
  }).sort((a, b) => keepScore(b) - keepScore(a) || new Date(a.start_time) - new Date(b.start_time));
  const counted = [], duplicates = [];
  // Fin retenue pour le chevauchement : durée réaliste (dernière série
  // + 10 min, sinon ~4 min par série + 10 min, 3 h au plus) — une séance
  // oubliée ouverte ne « recouvre » pas les suivantes.
  const span = (w) => {
    const s0 = +new Date(w.start_time);
    let e = Math.max(+new Date(w.end_time), s0 + 60e3);
    const last = Date.parse(w.last_set_at);
    if (last > s0) e = Math.min(e, last + 10 * 60e3);
    else if (w.total_sets > 0) e = Math.min(e, s0 + (w.total_sets * 4 + 10) * 60e3);
    return [s0, Math.min(e, s0 + 3 * 3600e3)];
  };
  for (const w of list) {
    const [s0, e0] = span(w);
    const twin = counted.find(c => { const [cs, ce] = span(c); return s0 < ce && e0 > cs; });
    if (twin) duplicates.push({ w, twin }); else counted.push(w);
  }
  counted.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  return { counted, duplicates };
}

export function weekSessions(workouts, date = new Date()) {
  const now = new Date();
  const monday = mondayOf(date);
  const nextMonday = new Date(monday); nextMonday.setDate(monday.getDate() + 7);
  return { monday, now, ...sessionsBetween(workouts, monday, nextMonday) };
}
