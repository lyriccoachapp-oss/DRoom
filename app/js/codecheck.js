'use strict';
/* Plan check against the National Building Code of Canada 2020, Part 9 (Housing and Small Buildings), as adopted in
   Nova Scotia by N.S. Reg. 198/2024. Only requirements that a floor plan can show are checked; each result names the
   article it comes from. Values are taken from the code text:
     9.5.3.1.  Table 9.5.3.1.: ceiling height of rooms in dwellings not less than 2.1 m
     9.5.4.1.  hallway in a dwelling unit at least 860 mm wide (710 mm only with bedrooms and bathrooms beyond and a second exit)
     9.5.5.1.  Table 9.5.5.1.: doorways at least 810 mm at the required entrance, 610 mm to bathrooms and walk-in closets,
               760 mm to other rooms
     9.5.5.3.  where an 860 mm hallway serves bathrooms, at least one such doorway takes a 760 mm door
     9.9.10.1. each bedroom has an outside window or exterior door; the window gives an unobstructed opening of 0.35 m2,
               no side under 380 mm
     9.10.19.  smoke alarms: one in each bedroom, one between the bedrooms and the rest of the storey (in the hallway
               if a hallway serves them), at least one per storey, all interconnected, wired with battery back-up
               (Nova Scotia replaces 9.10.19.4. and also permits a listed household fire warning system)
     9.31.4.1. a kitchen sink, lavatory, bathtub or shower, and water closet (Nova Scotia: or a drainless composting toilet)
     9.34.2.2. a wall-switched light in kitchens, bedrooms, living and dining rooms, bathrooms and hallways
   It is a design aid, not a permit review. */
const CODE = {
  name: 'National Building Code of Canada 2020, Part 9, as adopted in Nova Scotia (N.S. Reg. 198/2024)',
  short: 'NBC 2020 + Nova Scotia',
  CEILING_MIN: 2.1, HALL_MIN: 0.86, HALL_NARROW: 0.71,
  DOOR_ENTRANCE: 0.81, DOOR_BATH: 0.61, DOOR_ROOM: 0.76, BATH_ONE: 0.76,
  EGRESS_AREA: 0.35, EGRESS_SIDE: 0.38
};

/* Which room a point (home coordinates) falls in, or null when it is outside every room. */
function roomAt(plans, x, z) {
  for (const pl of plans) { const o = pl.room; if (roomRects(o).some(q => x > q.x0 + 1e-6 && x < q.x1 - 1e-6 && z > q.z0 + 1e-6 && z < q.z1 - 1e-6)) return pl; }
  return null;
}
/* Home coordinates of a point on a room's wall, pushed `off` metres away from the room (negative: into it). */
function wallOut(pl, wall, t, off) {
  const p = wallPoint(pl.r, wall, t), n = WALLS[wall].n;
  return [pl.room.x + p[0] - n[0] * off, pl.room.y + p[1] - n[1] * off];
}
/* The room each door opens onto, or null for a door to the outside. */
function doorTarget(plans, pl) { const p = wallOut(pl, pl.r.door.wall, pl.r.door.t, 0.2); return roomAt(plans, p[0], p[1]); }
const centre = pl => { const q = maxRects(pl.r)[0]; return [pl.room.x + (q.x0 + q.x1) / 2, pl.room.y + (q.z0 + q.z1) / 2]; };

/* Smoke alarm positions by 9.10.19.3.: each bedroom; between the bedrooms and the rest of the storey (in the hallway
   when a hallway serves them); at least one on the storey. */
function smokeAlarms(plans) {
  const out = [], near = (p, d) => out.some(a => Math.hypot(a.p[0] - p[0], a.p[1] - p[1]) < d);
  plans.filter(pl => pl.room.type === 'bedroom').forEach(pl => out.push({ p: centre(pl), where: pl.room.name, why: 'in the bedroom' }));
  plans.filter(pl => pl.room.type === 'bedroom').forEach(pl => {
    const to = doorTarget(plans, pl);
    if (!to) return;
    if (to.room.type === 'hall') { if (!out.some(a => a.hall === to.room.id)) out.push({ p: centre(to), where: to.room.name, why: 'hallway serving bedrooms', hall: to.room.id }); }
    else if (to.room.type !== 'bedroom') { const p = wallOut(pl, pl.r.door.wall, pl.r.door.t, 0.6); if (!near(p, 1.5)) out.push({ p, where: to.room.name, why: 'between the bedrooms and the rest of the storey' }); }
  });
  if (!out.length && plans.length) { const pl = plans.find(p => p.room.type === 'living') || plans[0]; out.push({ p: centre(pl), where: pl.room.name, why: 'one on each storey' }); }
  return out;
}

/* Runs the checks. opts.height is the wall height in feet. Returns [{status: 'fail'|'warn'|'pass'|'info', title, room, detail, ref}]. */
function codeCheck(plans, opts) {
  const R = [], add = (status, ref, title, detail, room) => R.push({ status, ref, title, detail, room: room || null });
  if (!plans.length) return R;
  const mm = m => Math.round(m * 1000) + ' mm', H = ((opts && opts.height) || 8) * 0.3048;
  /* Ceiling height: walls are framed full height, so the ceiling is the wall height. */
  add(H >= CODE.CEILING_MIN ? 'pass' : 'fail', '9.5.3.1.', 'Ceiling height', 'Ceilings at ' + fmtLen(H) + '; rooms in a dwelling need at least ' + fmtLen(CODE.CEILING_MIN) + '.');
  /* Hallways */
  plans.filter(pl => pl.room.type === 'hall').forEach(pl => {
    const w = Math.min.apply(null, maxRects(pl.r).map(q => Math.min(q.x1 - q.x0, q.z1 - q.z0)));
    if (w >= CODE.HALL_MIN - 1e-6) add('pass', '9.5.4.1.', 'Hallway width', mm(w) + ' wide, at least 860 mm needed.', pl.room.name);
    else if (w >= CODE.HALL_NARROW - 1e-6) add('warn', '9.5.4.1.', 'Hallway width', mm(w) + ' wide. Under 860 mm is allowed down to 710 mm only when the far end has just bedrooms and bathrooms and there is a second exit near that end or in each bedroom.', pl.room.name);
    else add('fail', '9.5.4.1.', 'Hallway width', mm(w) + ' wide; a hallway in a dwelling must be at least 860 mm (710 mm in the narrow case).', pl.room.name);
  });
  /* Doorways */
  const outside = [];
  plans.forEach(pl => {
    const o = pl.room, d = pl.r.door, to = doorTarget(plans, pl), w = d.width;
    if (!to) { outside.push({ pl, w }); return; }
    const bath = o.type === 'bathroom', need = bath ? CODE.DOOR_BATH : CODE.DOOR_ROOM;
    if (w + 1e-6 < need) add('fail', 'Table 9.5.5.1.', 'Doorway width', 'The ' + (d.type === 'open' ? 'opening' : 'door') + ' is ' + mm(w) + '; a doorway to a ' + (bath ? 'bathroom' : 'room like this') + ' must take a door at least ' + mm(need) + ' wide.', o.name);
  });
  const baths = plans.filter(pl => pl.room.type === 'bathroom');
  if (baths.length && !baths.some(pl => pl.r.door.width + 1e-6 >= CODE.BATH_ONE)) {
    const off = baths.filter(pl => { const to = doorTarget(plans, pl); return to && to.room.type === 'hall'; });
    if (off.length) add('fail', '9.5.5.3.', 'Bathroom door', 'Where a hallway serves bathrooms, at least one bathroom doorway must take a 760 mm door. Widest now: ' + mm(Math.max.apply(null, baths.map(pl => pl.r.door.width))) + '.', off[0].room.name);
  }
  if (!outside.length) add('warn', 'Table 9.5.5.1.', 'Entrance door', 'No door on the plan opens to the outside. The required entrance needs a door at least 810 mm wide.');
  else if (!outside.some(x => x.w + 1e-6 >= CODE.DOOR_ENTRANCE)) add('fail', 'Table 9.5.5.1.', 'Entrance door', 'The door to the outside is ' + mm(Math.max.apply(null, outside.map(x => x.w))) + '; the required entrance needs at least 810 mm.', outside[0].pl.room.name);
  else add('pass', 'Table 9.5.5.1.', 'Entrance door', 'At least 810 mm wide.', outside.find(x => x.w + 1e-6 >= CODE.DOOR_ENTRANCE).pl.room.name);
  /* Bedroom egress */
  plans.filter(pl => pl.room.type === 'bedroom').forEach(pl => {
    const w = pl.r.win, p = wallOut(pl, w.wall, w.t, 0.2), inside = roomAt(plans, p[0], p[1]), door = !doorTarget(plans, pl);
    if (inside && !door) add('fail', '9.9.10.1.', 'Bedroom egress', 'The window opens into ' + inside.room.name + ', not outside. A bedroom needs an outside window or an exterior door.', pl.room.name);
    else add('pass', '9.9.10.1.', 'Bedroom egress', door ? 'Exterior door.' : 'Outside window. Its opening part must give at least 0.35 m² with no side under 380 mm, without tools or keys.', pl.room.name);
  });
  /* Plumbing fixtures */
  const has = c => plans.some(pl => (pl.placed || []).some(q => q.cat === c));
  const missing = [['cabrun', 'a kitchen sink'], ['vanity', 'a lavatory'], [['tub', 'shower'], 'a bathtub or shower'], ['toilet', 'a water closet']]
    .filter(f => !(Array.isArray(f[0]) ? f[0].some(has) : has(f[0]))).map(f => f[1]);
  add(missing.length ? 'fail' : 'pass', '9.31.4.1. (N.S.)', 'Plumbing fixtures', missing.length ? 'Missing ' + missing.join(', ') + '. A dwelling needs a kitchen sink, a lavatory, a bathtub or shower, and a water closet (or a drainless composting toilet).' : 'Kitchen sink, lavatory, bathtub or shower, and water closet are all there.');
  /* Smoke alarms */
  const sa = smokeAlarms(plans);
  add('info', '9.10.19.', 'Smoke alarms', sa.length + ' smoke alarm' + (sa.length === 1 ? '' : 's') + ': ' + sa.map(a => a.where + ' (' + a.why + ')').join('; ') + '. Interconnected, wired to a circuit with no switch, with battery back-up for 7 days.');
  add('info', '9.34.2.2.', 'Lighting', 'Each kitchen, bedroom, living and dining room, bathroom and hallway needs a light controlled by a wall switch (a switched receptacle is enough in bedrooms and living rooms).');
  return R;
}
/* What the check leaves to the designer and the inspector. */
const CODE_NOT_CHECKED = 'Not checked: structure and spans, stairs and guards, energy efficiency (9.36), ventilation and carbon monoxide alarms, fire separations, spatial separation from property lines, window opening sizes (only the window position is checked), and anything outside one storey.';
