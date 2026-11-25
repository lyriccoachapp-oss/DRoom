'use strict';
/* Construction takeoff: turns the plan into wall runs and a bill of materials for framing, concrete, drains and wiring.
   Every quantity is an estimate for budgeting from stated rules of thumb (see RULES); it is not an engineered design.
   Rules are kept in one object so a different code profile can replace them. */
const BUILD_DEFAULTS = { height: 8, spacing: 16, foundation: 'frost', slab: 4 };
const RULES = {
  name: 'Light wood framing, North American practice (rules of thumb)',
  waste: { lumber: 1.10, sheet: 1.10, concrete: 1.08, pipe: 1.10, wire: 1.15 },
  plateStock: 16,                   // ft, length plates and headers are bought in
  footing: { w: 20, d: 8 },         // in, strip footing under a frost wall
  frostWall: { t: 8, h: 4 },        // in thick, ft high
  thickEdge: { w: 12, d: 16 },      // in, thickened edge of a slab on grade
  stoneBase: 4,                     // in of crushed stone under the slab
  receptacleEvery: 12,              // ft of wall per general receptacle
  counterEvery: 4,                  // ft of counter per receptacle
  perCircuit: 12,                   // devices on a general 15 A circuit
  lightPer: 120,                    // ft2 of floor per ceiling light
  drain: { toilet: 3, tub: 2, shower: 2, vanity: 1.5, cabrun: 2 }   // in, drain size by fixture
};
const FT = 0.3048, IN = 0.0254;
const FIXTURE_NAMES = { toilet: 'Toilet', tub: 'Bathtub', shower: 'Shower', vanity: 'Lavatory', cabrun: 'Kitchen sink' };

function buildOpts(o) {
  o = o || {};
  const pick = (v, list, d) => list.indexOf(Number(v)) >= 0 ? Number(v) : d;
  return { height: pick(o.height, [8, 9, 10], 8), spacing: pick(o.spacing, [16, 24], 16), foundation: o.foundation === 'slab' ? 'slab' : 'frost', slab: pick(o.slab, [4, 5, 6], 4) };
}

/* Walls of the whole home, each counted once: room outlines are merged along shared lines.
   Returns [{o: 'h'|'v', c, a, b, ext}] in metres; a wall two rooms share is interior (ext false). */
function wallRuns(plans) {
  const lines = {}, r2 = v => Math.round(v * 100) / 100;
  plans.forEach(pl => {
    const o = pl.room, pts = roomPolygon(o);
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length], x1 = o.x + p[0], z1 = o.y + p[1], x2 = o.x + q[0], z2 = o.y + q[1];
      const h = Math.abs(z1 - z2) < 1e-6, c = r2(h ? z1 : x1), a = Math.min(h ? x1 : z1, h ? x2 : z2), b = Math.max(h ? x1 : z1, h ? x2 : z2);
      if (b - a < 0.01) return;
      const k = (h ? 'h' : 'v') + c; (lines[k] = lines[k] || { o: h ? 'h' : 'v', c, iv: [] }).iv.push([r2(a), r2(b)]);
    });
  });
  const runs = [];
  for (const k in lines) {
    const L = lines[k], pts = Array.from(new Set([].concat.apply([], L.iv))).sort((x, y) => x - y); let cur = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const m = (pts[i] + pts[i + 1]) / 2, n = L.iv.filter(v => v[0] < m && v[1] > m).length;
      if (!n) { cur = null; continue; }
      const ext = n < 2;
      if (cur && cur.ext === ext && Math.abs(cur.b - pts[i]) < 1e-6) cur.b = pts[i + 1];
      else { cur = { o: L.o, c: L.c, a: pts[i], b: pts[i + 1], ext }; runs.push(cur); }
    }
  }
  return runs;
}
function homeBox(plans) {
  const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  plans.forEach(pl => roomRects(pl.room).forEach(q => { b.x0 = Math.min(b.x0, q.x0); b.z0 = Math.min(b.z0, q.z0); b.x1 = Math.max(b.x1, q.x1); b.z1 = Math.max(b.z1, q.z1); }));
  return b;
}
/* Nearest point on the home's bounding box to p: where a drain leaves or a service enters. */
function nearestEdge(bb, p) {
  const c = [[bb.x0, p[1]], [bb.x1, p[1]], [p[0], bb.z0], [p[0], bb.z1]];
  return c.sort((a, b) => Math.hypot(a[0] - p[0], a[1] - p[1]) - Math.hypot(b[0] - p[0], b[1] - p[1]))[0];
}
const perimeterOf = room => { const p = roomPolygon(room); return p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + Math.hypot(b[0] - a[0], b[1] - a[1]); }, 0); };
const centreOf = pl => { const q = maxRects(pl.r)[0]; return [pl.room.x + (q.x0 + q.x1) / 2, pl.room.y + (q.z0 + q.z1) / 2]; };

/* Drain, waste and vent estimate: every fixture runs at right angles to one stack, and the building drain leaves through the nearest outside wall. */
function plumbingPlan(plans, H) {
  const fx = [];
  plans.forEach(pl => pl.placed.forEach(q => { if (RULES.drain[q.cat]) fx.push({ cat: q.cat, x: pl.room.x + q.cx, z: pl.room.y + q.cz, room: pl.room.name, size: RULES.drain[q.cat] }); }));
  if (!fx.length) return { fixtures: [], routes: [], pipe: {}, stack: null, exit: null };
  const st = fx.find(f => f.cat === 'toilet') || fx[0], stack = [st.x, st.z], bb = homeBox(plans), exit = nearestEdge(bb, stack);
  const main = fx.some(f => f.cat === 'toilet') ? 3 : 2, pipe = {}, add = (size, m) => { pipe[size] = (pipe[size] || 0) + m; }, routes = [];
  add(main, Math.hypot(exit[0] - stack[0], exit[1] - stack[1]) + 1.5);
  routes.push({ size: main, pts: [stack, exit], main: true });
  add(main, H + 1.0);                                                   // vent stack through the roof
  fx.forEach(f => {
    if (f !== st) { add(f.size, Math.abs(f.x - st.x) + Math.abs(f.z - st.z) + 0.6); routes.push({ size: f.size, pts: [[f.x, f.z], [st.x, f.z], stack] }); add(1.5, H + 0.5); }
    else add(f.size, 0.6);
  });
  return { fixtures: fx, routes, pipe, stack, exit, main };
}

/* Wiring estimate: a panel on the outside wall nearest the kitchen, home runs measured at right angles plus the climb up and down the wall. */
function electricalPlan(plans, H) {
  if (!plans.length) return { panel: null, rec: 0, gfci: 0, counter: 0, switches: 0, lights: 0, smoke: 0, w142: 0, w122: 0, w143: 0, w83: 0, c15: 0, c20: 0, range: 0, rooms: [] };
  const bb = homeBox(plans), kit = plans.find(p => p.room.type === 'kitchen') || plans[0], panel = nearestEdge(bb, centreOf(kit));
  const run = pl => { const c = centreOf(pl); return Math.abs(c[0] - panel[0]) + Math.abs(c[1] - panel[1]) + 3; };
  const e = { panel, rec: 0, gfci: 0, counter: 0, switches: 0, lights: 0, smoke: 0, w142: 0, w122: 0, w143: 0, w83: 0, c15: 0, c20: 0, range: 0, rooms: [] };
  let general = 0, runs = 0;
  plans.forEach(pl => {
    const o = pl.room, per = perimeterOf(o), area = pl.r.area, t = o.type;
    const lights = Math.max(1, Math.ceil(area / (RULES.lightPer * FT * FT))), sw = area > 20 ? 2 : 1;
    let rec = t === 'bathroom' ? 0 : t === 'hall' ? Math.max(1, Math.ceil(per / (RULES.receptacleEvery * FT) / 2)) : t === 'kitchen' ? 2 : Math.max(2, Math.ceil(per / (RULES.receptacleEvery * FT)));
    e.rec += rec; e.lights += lights; e.switches += sw; general += rec + lights; runs += run(pl);
    e.w142 += per + 1.5 * lights + 2.5 * sw;
    if (t === 'bathroom') { e.gfci++; e.c20++; e.w122 += run(pl) + 2; }
    if (t === 'kitchen') {
      const cab = pl.placed.find(q => q.cat === 'cabrun'), len = cab ? cab.w : 1.8, n = Math.max(2, Math.ceil(len / (RULES.counterEvery * FT)));
      e.counter += n; e.c20 += 2; e.w122 += 2 * (run(pl) + len + 1);
      if (pl.placed.some(q => q.cat === 'fridge')) { e.c15++; e.w142 += run(pl); }
      if (pl.placed.some(q => q.cat === 'range')) { e.range++; e.w83 += run(pl); }
    }
    if (t === 'bedroom' || t === 'hall') e.smoke++;
    e.rooms.push({ name: o.name, rec, lights });
  });
  if (!e.smoke && plans.length) e.smoke = 1;
  /* Where the code check is loaded, smoke alarms follow its placement (NBC 9.10.19.3.). */
  if (typeof smokeAlarms === 'function') e.smoke = smokeAlarms(plans).length;
  const circuits = Math.max(1, Math.ceil(general / RULES.perCircuit));
  e.c15 += circuits + 1;                                                // general circuits plus one for the smoke alarms
  e.w142 += circuits * (plans.length ? runs / plans.length : 0);
  e.w143 += e.smoke * 4 + (plans.length ? runs / plans.length : 0);
  return e;
}

function takeoff(plans, o) {
  const opt = buildOpts(o), W = RULES.waste, H = opt.height * FT, sp = opt.spacing * IN;
  const runs = wallRuns(plans), len = f => runs.filter(f).reduce((s, r) => s + (r.b - r.a), 0);
  const Le = len(r => r.ext), Li = len(r => !r.ext), area = plans.reduce((s, p) => s + p.r.area, 0);
  const ft = m => m / FT, up = Math.ceil, groups = [], line = (name, qty, unit, detail) => ({ name, qty, unit, detail: detail || '' });
  const doors = plans.length, windows = plans.length;
  /* Studs: one per spacing along each run plus one, two more at each end for corners and tees, four per opening (kings and jacks). */
  const studs = f => runs.filter(f).reduce((s, r) => s + up((r.b - r.a) / sp) + 1 + 4, 0);
  const sExt = up((studs(r => r.ext) + windows * 4) * W.lumber), sInt = up((studs(r => !r.ext) + doors * 4) * W.lumber);
  const stock = m => up(ft(m) * 1.05 / RULES.plateStock), precut = { 8: '92-5/8', 9: '104-5/8', 10: '116-5/8' }[opt.height];
  const headerM = plans.reduce((s, p) => s + p.r.door.width + 0.3, 0) + windows * 1.7, sheet = 32 * FT * FT;
  groups.push({ title: 'Framing', lines: [
    line('2x6 studs, ' + precut + ' in', sExt, 'pcs', 'outside walls at ' + opt.spacing + ' in on centre'),
    line('2x4 studs, ' + precut + ' in', sInt, 'pcs', 'inside walls at ' + opt.spacing + ' in on centre'),
    line('2x6 pressure-treated plate, 16 ft', stock(Le), 'pcs', 'bottom plate on concrete, ' + Math.round(ft(Le)) + ' lin ft'),
    line('2x6 plate, 16 ft', stock(2 * Le), 'pcs', 'double top plate, outside walls'),
    line('2x4 plate, 16 ft', stock(3 * Li), 'pcs', 'bottom and double top plate, inside walls'),
    line('2x10 header stock, 16 ft', stock(2 * headerM), 'pcs', 'two plies over ' + (doors + windows) + ' openings'),
    line('7/16 OSB wall sheathing, 4x8', up(Le * H / sheet * W.sheet), 'sheets', 'outside walls, ' + Math.round(Le * H / (FT * FT)) + ' ft²')
  ] });
  const wallFaces = (Le + 2 * Li) * H;
  groups.push({ title: 'Insulation and drywall', lines: [
    line('1/2 in drywall, 4x8', up((wallFaces + area) / sheet * W.sheet), 'sheets', 'walls ' + Math.round(wallFaces / (FT * FT)) + ' ft² and ceilings ' + Math.round(area / (FT * FT)) + ' ft²'),
    line('R-20 batt insulation', up(Le * H / (FT * FT) * 1.05), 'ft²', 'outside walls')
  ] });
  /* Concrete, in cubic metres then cubic yards. */
  const yd = m3 => Math.ceil(m3 / 0.7646 * 10) / 10, slab = area * opt.slab * IN, conc = [];
  let total = slab;
  if (opt.foundation === 'frost') {
    const foot = Le * RULES.footing.w * IN * RULES.footing.d * IN, wall = Le * RULES.frostWall.t * IN * RULES.frostWall.h * FT; total += foot + wall;
    conc.push(line('Strip footing ' + RULES.footing.w + ' x ' + RULES.footing.d + ' in', yd(foot), 'yd³', Math.round(ft(Le)) + ' lin ft of outside wall'));
    conc.push(line('Frost wall ' + RULES.frostWall.t + ' in x ' + RULES.frostWall.h + ' ft', yd(wall), 'yd³', 'under the outside walls'));
  } else {
    const edge = Le * RULES.thickEdge.w * IN * (RULES.thickEdge.d - opt.slab) * IN; total += edge;
    conc.push(line('Thickened slab edge ' + RULES.thickEdge.w + ' x ' + RULES.thickEdge.d + ' in', yd(edge), 'yd³', Math.round(ft(Le)) + ' lin ft of perimeter'));
  }
  conc.push(line(opt.slab + ' in slab', yd(slab), 'yd³', Math.round(area / (FT * FT)) + ' ft² of floor'));
  conc.push(line('Concrete to order, with ' + Math.round((W.concrete - 1) * 100) + '% waste', yd(total * W.concrete), 'yd³', (Math.ceil(total * W.concrete * 10) / 10) + ' m³'));
  conc.push(line('Crushed stone base, ' + RULES.stoneBase + ' in', yd(area * RULES.stoneBase * IN * 1.1), 'yd³', 'under the slab'));
  groups.push({ title: 'Concrete', lines: conc });
  /* Drains and vents. */
  const pl = plumbingPlan(plans, H), pls = [], count = c => pl.fixtures.filter(f => f.cat === c).length;
  if (pl.fixtures.length) {
    [3, 2, 1.5].forEach(sz => { if (pl.pipe[sz]) { const m = pl.pipe[sz] * W.pipe; pls.push(line((sz === 1.5 ? '1-1/2' : sz) + ' in drain and vent pipe', up(ft(m)), 'lin ft', up(ft(m) / 10) + ' lengths of 10 ft, ' + Math.ceil(m) + ' m')); } });
    const traps2 = count('tub') + count('shower') + count('cabrun');
    if (count('toilet')) pls.push(line('Closet flange with 3 in bend', count('toilet'), 'pcs', 'one per toilet'));
    if (traps2) pls.push(line('2 in P-trap', traps2, 'pcs', 'tubs, showers and the kitchen sink'));
    if (count('vanity')) pls.push(line('1-1/2 in P-trap', count('vanity'), 'pcs', 'lavatories'));
    pls.push(line('Wyes and sanitary tees', pl.fixtures.length, 'pcs', 'one per fixture'));
    pls.push(line('1/4 and 1/8 bends', pl.fixtures.length * 2, 'pcs', 'two per fixture'));
    pls.push(line('Cleanouts', 2, 'pcs', 'base of the stack and where the drain leaves'));
    pls.push(line('Roof vent flashing', 1, 'pcs', ''));
  }
  groups.push({ title: 'Drain, waste and vent', lines: pls, empty: 'No plumbing fixtures in this plan.' });
  /* Wiring. */
  const el = electricalPlan(plans, H), wire = (name, m, roll) => { const t = m * W.wire; return line(name, Math.ceil(t), 'm', Math.ceil(ft(t)) + ' ft' + (roll ? ', ' + up(t / 75) + ' rolls of 75 m' : '')); };
  const els = [wire('14/2 cable (15 A lighting and receptacles)', el.w142, true)];
  if (el.w122) els.push(wire('12/2 cable (20 A kitchen and bathroom)', el.w122, true));
  els.push(wire('14/3 cable (linked smoke alarms)', el.w143, false));
  if (el.w83) els.push(wire('8/3 cable (range)', el.w83, false));
  els.push(line('Receptacles, 15 A', el.rec, 'pcs', 'one per ' + RULES.receptacleEvery + ' ft of wall'));
  if (el.counter) els.push(line('Counter receptacles, 20 A', el.counter, 'pcs', 'one per ' + RULES.counterEvery + ' ft of counter'));
  if (el.gfci) els.push(line('GFCI receptacles', el.gfci, 'pcs', 'one per bathroom'));
  els.push(line('Switches', el.switches, 'pcs', ''));
  els.push(line('Ceiling light boxes', el.lights, 'pcs', 'one per ' + RULES.lightPer + ' ft²'));
  els.push(line('Smoke and CO alarms, linked', el.smoke, 'pcs', 'bedrooms and hallways'));
  els.push(line('Breakers, 15 A', el.c15, 'pcs', ''));
  if (el.c20) els.push(line('Breakers, 20 A', el.c20, 'pcs', ''));
  if (el.range) els.push(line('Breaker, 40 A two-pole', el.range, 'pcs', 'range'));
  groups.push({ title: 'Electrical rough-in', lines: plans.length ? els : [] });
  return { opt, runs, ext: Le, int: Li, area, groups, plumbing: pl, electrical: el };
}
/* The takeoff as CSV text. */
function takeoffCsv(t) {
  const q = s => '"' + String(s).replace(/"/g, '""') + '"', rows = [['Group', 'Item', 'Quantity', 'Unit', 'Basis'].map(q).join(',')];
  t.groups.forEach(g => g.lines.forEach(l => rows.push([g.title, l.name, l.qty, l.unit, l.detail].map(q).join(','))));
  return rows.join('\r\n') + '\r\n';
}
