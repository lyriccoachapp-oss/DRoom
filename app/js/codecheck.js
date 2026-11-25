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
     9.8.      stairs: width 860 mm (9.8.2.1.), headroom 1950 mm (9.8.2.2.), rise 125-200 mm and run 255-355 mm for private
               stairs (Tables 9.8.4.1. and 9.8.4.2.), flight at most 3.7 m high (9.8.3.3.), landings top and bottom (9.8.6.2.),
               a handrail 865-1070 mm (9.8.7.), guards at least 900 mm in a dwelling (9.8.8.3.); doorway to stairs 810 mm
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

/* Smoke alarm positions by 9.10.19.3., floor by floor: each bedroom; between the bedrooms and the rest of the storey
   (in the hallway when a hallway serves them); at least one on every storey. */
function smokeAlarms(all) {
  const out = [];
  Array.from(new Set(all.map(p => floorOf(p.room)))).sort((a, b) => a - b).forEach(f => {
    const plans = all.filter(p => floorOf(p.room) === f), here = [], near = (p, d) => here.some(a => Math.hypot(a.p[0] - p[0], a.p[1] - p[1]) < d);
    plans.filter(pl => pl.room.type === 'bedroom').forEach(pl => here.push({ p: centre(pl), where: pl.room.name, why: 'in the bedroom', floor: f }));
    plans.filter(pl => pl.room.type === 'bedroom').forEach(pl => {
      const to = doorTarget(plans, pl);
      if (!to) return;
      if (to.room.type === 'hall') { if (!here.some(a => a.hall === to.room.id)) here.push({ p: centre(to), where: to.room.name, why: 'hallway serving bedrooms', hall: to.room.id, floor: f }); }
      else if (to.room.type !== 'bedroom') { const p = wallOut(pl, pl.r.door.wall, pl.r.door.t, 0.6); if (!near(p, 1.5)) here.push({ p, where: to.room.name, why: 'between the bedrooms and the rest of the storey', floor: f }); }
    });
    if (!here.length && plans.some(p => p.room.type !== 'stair')) { const pl = plans.find(p => p.room.type === 'living') || plans.find(p => p.room.type === 'hall') || plans.find(p => p.room.type !== 'stair'); here.push({ p: centre(pl), where: pl.room.name, why: 'one on each storey', floor: f }); }
    out.push(...here);
  });
  return out;
}

/* Runs the checks. opts.height is the wall height in feet. Returns [{status: 'fail'|'warn'|'pass'|'info', title, room, detail, ref}]. */
function codeCheck(all, opts) {
  const R = [], add = (status, ref, title, detail, room) => R.push({ status, ref, title, detail, room: room || null });
  if (!all.length) return R;
  const mm = m => Math.round(m * 1000) + ' mm', H = ((opts && opts.height) || 8) * 0.3048, storey = H + 0.3;
  const floors = Array.from(new Set(all.map(p => floorOf(p.room)))).sort((a, b) => a - b), multi = floors.length > 1 || floors[0] > 0;
  const nm = o => o.name + (multi ? ' (floor ' + (floorOf(o) + 1) + ')' : '');
  /* Ceiling height: walls are framed full height, so the ceiling is the wall height. */
  add(H >= CODE.CEILING_MIN ? 'pass' : 'fail', '9.5.3.1.', 'Ceiling height', 'Ceilings at ' + fmtLen(H) + '; rooms in a dwelling need at least ' + fmtLen(CODE.CEILING_MIN) + '.');
  const outsideGround = [];
  floors.forEach(f => {
    const plans = all.filter(p => floorOf(p.room) === f);
    /* Hallways */
    plans.filter(pl => pl.room.type === 'hall').forEach(pl => {
      const w = Math.min.apply(null, maxRects(pl.r).map(q => Math.min(q.x1 - q.x0, q.z1 - q.z0)));
      if (w >= CODE.HALL_MIN - 1e-6) add('pass', '9.5.4.1.', 'Hallway width', mm(w) + ' wide, at least 860 mm needed.', nm(pl.room));
      else if (w >= CODE.HALL_NARROW - 1e-6) add('warn', '9.5.4.1.', 'Hallway width', mm(w) + ' wide. Under 860 mm is allowed down to 710 mm only when the far end has just bedrooms and bathrooms and there is a second exit near that end or in each bedroom.', nm(pl.room));
      else add('fail', '9.5.4.1.', 'Hallway width', mm(w) + ' wide; a hallway in a dwelling must be at least 860 mm (710 mm in the narrow case).', nm(pl.room));
    });
    /* Doorways */
    plans.forEach(pl => {
      const o = pl.room, d = pl.r.door, to = doorTarget(plans, pl), w = d.width;
      if (!to) {
        /* on an upper floor a door may open onto the stairs coming up from below */
        const pt = wallOut(pl, d.wall, d.t, 0.2), well = all.find(p => p.room.type === 'stair' && floorOf(p.room) === f - 1 && roomRects(p.room).some(q => pt[0] > q.x0 && pt[0] < q.x1 && pt[1] > q.z0 && pt[1] < q.z1));
        if (well) return;
        if (f === 0) outsideGround.push({ pl, w });
        else add('fail', '9.8.8.1.', 'Door to nowhere', 'The door opens outside from an upper floor, where there is nothing to step onto. Move it to a wall shared with another room on this floor.', nm(o));
        return;
      }
      const stair = o.type === 'stair', bath = o.type === 'bathroom', need = stair ? CODE.DOOR_ENTRANCE : bath ? CODE.DOOR_BATH : CODE.DOOR_ROOM;
      if (w + 1e-6 < need) add('fail', 'Table 9.5.5.1.', 'Doorway width', 'The ' + (d.type === 'open' ? 'opening' : 'door') + ' is ' + mm(w) + '; a doorway ' + (stair ? 'to stairs leading to a finished floor' : bath ? 'to a bathroom' : 'to a room like this') + ' must take a door at least ' + mm(need) + ' wide.', nm(o));
    });
    const baths = plans.filter(pl => pl.room.type === 'bathroom');
    if (baths.length && !baths.some(pl => pl.r.door.width + 1e-6 >= CODE.BATH_ONE)) {
      const off = baths.filter(pl => { const to = doorTarget(plans, pl); return to && to.room.type === 'hall'; });
      if (off.length) add('fail', '9.5.5.3.', 'Bathroom door', 'Where a hallway serves bathrooms, at least one bathroom doorway must take a 760 mm door. Widest now: ' + mm(Math.max.apply(null, baths.map(pl => pl.r.door.width))) + '.', nm(off[0].room));
    }
    /* Bedroom egress: an outside window on any floor, or an exterior door on the ground floor */
    plans.filter(pl => pl.room.type === 'bedroom').forEach(pl => {
      const w = pl.r.win, p = wallOut(pl, w.wall, w.t, 0.2), inside = roomAt(plans, p[0], p[1]), door = f === 0 && !doorTarget(plans, pl);
      if (inside && !door) add('fail', '9.9.10.1.', 'Bedroom egress', 'The window opens into ' + inside.room.name + ', not outside. A bedroom needs an outside window or an exterior door.', nm(pl.room));
      else add('pass', '9.9.10.1.', 'Bedroom egress', door ? 'Exterior door.' : 'Outside window. Its opening part must give at least 0.35 m² with no side under 380 mm, without tools or keys.', nm(pl.room));
    });
    /* Every upper floor is reached by stairs from the floor below */
    if (f > 0 && plans.length && !all.some(p => p.room.type === 'stair' && floorOf(p.room) === f - 1)) add('fail', '9.8.2.1.', 'Stairs', 'Floor ' + (f + 1) + ' has no stairs up to it. Add Stairs on floor ' + f + '.');
  });
  /* Entrance */
  if (!outsideGround.length) add('warn', 'Table 9.5.5.1.', 'Entrance door', 'No door on the ground floor opens to the outside. The required entrance needs a door at least 810 mm wide.');
  else if (!outsideGround.some(x => x.w + 1e-6 >= CODE.DOOR_ENTRANCE)) add('fail', 'Table 9.5.5.1.', 'Entrance door', 'The door to the outside is ' + mm(Math.max.apply(null, outsideGround.map(x => x.w))) + '; the required entrance needs at least 810 mm.', nm(outsideGround[0].pl.room));
  else add('pass', 'Table 9.5.5.1.', 'Entrance door', 'At least 810 mm wide.', nm(outsideGround.find(x => x.w + 1e-6 >= CODE.DOOR_ENTRANCE).pl.room));
  /* Stairs */
  all.filter(p => p.room.type === 'stair').forEach(pl => {
    const o = pl.room, st = stairOf(o, storey), up = all.filter(p => floorOf(p.room) === floorOf(o) + 1), name = nm(o);
    add(st.width + 1e-6 >= STAIR.width ? 'pass' : 'fail', '9.8.2.1.', 'Stair width', mm(st.width) + ' wide; stairs between floors of a dwelling need at least 860 mm.', name);
    if (st.ok) add('pass', 'Tables 9.8.4.1. and 9.8.4.2.', 'Steps', st.n + ' risers of ' + mm(st.rise) + ' (125 to 200 mm) and treads of ' + mm(st.run) + ' (255 to 355 mm) for a ' + fmtLen(storey) + ' storey, with a ' + mm(st.landing) + ' landing at the bottom.', name);
    else add('fail', 'Tables 9.8.4.1. and 9.8.4.2.', 'Steps', 'The stair room is ' + fmtLen(st.length) + ' long; ' + st.n + ' risers of ' + mm(st.rise) + ' need treads of at least 255 mm and a bottom landing, ' + fmtLen(st.need) + ' in all.', name);
    add(storey <= 3.7 + 1e-6 ? 'pass' : 'fail', '9.8.3.3.', 'Flight height', 'One flight rises ' + fmtLen(storey) + '; a flight may rise at most 3.7 m.', name);
    const over = up.filter(p => roomRects(p.room).some(q => roomRects(o).some(s2 => Math.min(q.x1, s2.x1) - Math.max(q.x0, s2.x0) > 0.05 && Math.min(q.z1, s2.z1) - Math.max(q.z0, s2.z0) > 0.05)));
    if (over.length) add('fail', '9.8.2.2.', 'Headroom', over.map(p => p.room.name).join(', ') + ' on the floor above covers the stairwell; the stairs need 1950 mm clear above them, so the stairwell stays open.', name);
    if (!up.length) add('warn', '9.8.6.2.', 'Top of the stairs', 'Nothing is drawn on floor ' + (floorOf(o) + 2) + ' yet. The stairs need a landing at the top.', name);
    else {
      const e = st.dir > 0 ? st.length + 0.3 : -0.3, p = st.axis === 'x' ? [o.x + e, o.y + o.D / 2] : [o.x + o.W / 2, o.y + e];
      const land = roomAt(up, p[0], p[1]);
      add(land ? 'pass' : 'fail', '9.8.6.2.', 'Top of the stairs', land ? 'The flight arrives in ' + land.room.name + '.' : 'The flight arrives where floor ' + (floorOf(o) + 2) + ' has no room. Put a hallway or room at the top end of the stairs.', name);
    }
    add('info', '9.8.7. and 9.8.8.3.', 'Handrail and guard', 'A handrail on one side, 865 to 1070 mm above the nosings; a guard at least 900 mm high round the stairwell on the floor above.', name);
  });
  /* Plumbing fixtures */
  const has = c => all.some(pl => (pl.placed || []).some(q => q.cat === c));
  const missing = [['cabrun', 'a kitchen sink'], ['vanity', 'a lavatory'], [['tub', 'shower'], 'a bathtub or shower'], ['toilet', 'a water closet']]
    .filter(fx => !(Array.isArray(fx[0]) ? fx[0].some(has) : has(fx[0]))).map(fx => fx[1]);
  add(missing.length ? 'fail' : 'pass', '9.31.4.1. (N.S.)', 'Plumbing fixtures', missing.length ? 'Missing ' + missing.join(', ') + '. A dwelling needs a kitchen sink, a lavatory, a bathtub or shower, and a water closet (or a drainless composting toilet).' : 'Kitchen sink, lavatory, bathtub or shower, and water closet are all there.');
  /* Smoke alarms */
  const sa = smokeAlarms(all);
  add('info', '9.10.19.', 'Smoke alarms', sa.length + ' smoke alarm' + (sa.length === 1 ? '' : 's') + ': ' + sa.map(a => a.where + (multi ? ' (floor ' + (a.floor + 1) + ')' : '') + ' (' + a.why + ')').join('; ') + '. Interconnected, wired to a circuit with no switch, with battery back-up for 7 days.');
  add('info', '9.34.2.2.', 'Lighting', 'Each kitchen, bedroom, living and dining room, bathroom and hallway needs a light controlled by a wall switch (a switched receptacle is enough in bedrooms and living rooms).' + (all.some(p => p.room.type === 'stair') ? ' Stairs need light with 3-way switches at the top and bottom (9.34.2.3.).' : ''));
  return R;
}
/* What the check leaves to the designer and the inspector. */
const CODE_NOT_CHECKED = 'Not checked: structure and spans, energy efficiency (9.36), ventilation and carbon monoxide alarms, fire separations, spatial separation from property lines, window opening sizes (only the window position is checked), winders and curved stairs, basements.';
