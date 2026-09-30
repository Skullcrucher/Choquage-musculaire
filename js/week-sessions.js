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

export function weekSessions(workouts, date = new Date()) {
  const now = new Date();
  const monday = mondayOf(date);
  const nextMonday = new Date(monday); nextMonday.setDate(monday.getDate() + 7);
  const end = nextMonday < now ? nextMonday : now;
  const list = workouts.filter(w => {
    if (!w.end_time || !w.start_time) return false;
    const start = new Date(w.start_time);
    return !isNaN(start) && start >= monday && start <= end;
  }).sort((a, b) => keepScore(b) - keepScore(a) || new Date(a.start_time) - new Date(b.start_time));
  const counted = [], duplicates = [];
  for (const w of list) {
    const s0 = new Date(w.start_time), e0 = Math.max(+new Date(w.end_time), +s0 + 60e3);
    const twin = counted.find(c => s0 < Math.max(+new Date(c.end_time), +new Date(c.start_time) + 60e3) && e0 > new Date(c.start_time));
    if (twin) duplicates.push({ w, twin }); else counted.push(w);
  }
  counted.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  return { monday, now, counted, duplicates };
}
