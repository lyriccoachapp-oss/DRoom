'use strict';
/* Layout engine checks. The app scripts are classic browser scripts, so they are loaded into one shared context. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ document: { querySelector() { return null; } }, console });
for (const f of ['catalog.js', 'layout.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'), ctx, { filename: f });
const run = code => vm.runInContext(code, ctx);
const types = run('Object.keys(ROOMS)');
const styles = run('Object.keys(STYLES)');

function plan(type, W, D, doorWall, winWall, budget, style) {
  ctx.__room = { id: 'x', name: type, type, x: 0, y: 0, W, D, doorWall, doorPos: 0.3, winWall, winPos: 0.6, overrides: {}, removed: [] };
  ctx.__budget = budget; ctx.__style = style || 'scandi';
  return run('planRoom(__room, __style, __budget)');
}
const sizes = [1.6, 2.4, 3.2, 4.0, 5.5, 8];
const walls = ['N', 'S', 'W', 'E'];
const overlaps = (a, b) => Math.abs(a.cx - b.cx) < a.hx + b.hx - 1e-6 && Math.abs(a.cz - b.cz) < a.hz + b.hz - 1e-6;

test('every room type lays out at every size without overlaps or items outside the room', () => {
  let checked = 0;
  for (const type of types) for (const W of sizes) for (const D of sizes) for (const dw of walls) for (const ww of ['N', 'E']) {
    const p = plan(type, W, D, dw, ww, 20000);
    const solid = p.placed.filter(q => !q.flat);
    for (const q of p.placed) {
      assert.ok(q.cx - q.hx >= -1e-3 && q.cz - q.hz >= -1e-3 && q.cx + q.hx <= W + 1e-3 && q.cz + q.hz <= D + 1e-3, `${type} ${W}x${D}: ${q.cat} is outside the room`);
    }
    for (let i = 0; i < solid.length; i++) {
      assert.ok(!overlaps(solid[i], p.r.doorRect), `${type} ${W}x${D} door ${dw}: ${solid[i].cat} blocks the door`);
      for (let j = i + 1; j < solid.length; j++) assert.ok(!overlaps(solid[i], solid[j]), `${type} ${W}x${D}: ${solid[i].cat} overlaps ${solid[j].cat}`);
    }
    checked++;
  }
  assert.ok(checked > 1000);
});

test('the total stays within budget unless the required items alone exceed it', () => {
  for (const type of types) for (const style of styles) for (const budget of [500, 2000, 6000, 30000]) {
    const p = plan(type, 4.5, 4, 'S', 'N', budget, style);
    const required = run(`ROOMS.${type}.required`);
    const onlyRequired = p.lines.every(l => required.includes(l.cat));
    assert.ok(p.total <= budget || onlyRequired, `${type} ${style} budget ${budget}: total ${p.total} with optional items`);
    const sum = p.lines.reduce((s, l) => s + l.item.price * l.qty, 0);
    assert.ok(Math.abs(sum - p.total) < 1e-6);
  }
});

test('a bigger budget never buys a cheaper room', () => {
  for (const type of types) {
    let last = 0;
    for (const budget of [1000, 3000, 8000, 20000, 60000]) { const t = plan(type, 5, 4.2, 'S', 'N', budget).total; assert.ok(t >= last - 1e-6, `${type}: total fell from ${last} to ${t}`); last = t; }
  }
});

test('flooring quantity is the floor area plus ten percent', () => {
  const p = plan('living', 5, 4, 'S', 'N', 20000), f = p.lines.find(l => l.area);
  assert.ok(f, 'living room has a flooring line');
  assert.ok(Math.abs(f.qty - 22) < 0.11);
});

test('removed items stay out and are reported', () => {
  ctx.__room = { id: 'x', name: 'b', type: 'bedroom', x: 0, y: 0, W: 4.5, D: 4, doorWall: 'S', doorPos: 0.3, winWall: 'N', winPos: 0.5, overrides: {}, removed: ['rug', 'floor'] };
  const p = run("planRoom(__room, 'modern', 9000)");
  assert.ok(!p.lines.some(l => l.cat === 'rug' || l.cat === 'floor'));
  assert.strictEqual(p.excluded.filter(x => x.reason === 'removed').map(x => x.cat).sort().join(','), 'floor,rug');
});

test('the plan detector finds the rooms of a drawn plan and ignores the outside', () => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'recognize.js'), 'utf8'), ctx, { filename: 'recognize.js' });
  /* 300 x 200 sheet: a 240 x 160 building split into three rooms, with door gaps in the partitions. */
  const w = 300, h = 200, px = new Uint8ClampedArray(w * h * 4).fill(255);
  const ink = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; } };
  ink(30, 20, 270, 22); ink(30, 178, 270, 180); ink(30, 20, 32, 180); ink(268, 20, 270, 180);   // outer walls
  ink(160, 20, 162, 90); ink(160, 108, 162, 180);                                               // vertical partition, gap 90..108
  ink(162, 100, 200, 102); ink(218, 100, 270, 102);                                             // horizontal partition, gap 200..218
  ctx.__px = px;
  const boxes = run('PlanRecognizer.detectPixels(__px, 300, 200)');
  assert.strictEqual(boxes.length, 3);
  const big = boxes[0];
  assert.ok(Math.abs(big.x - 30 / 300) < 0.03 && Math.abs(big.w - 130 / 300) < 0.05 && Math.abs(big.h - 160 / 200) < 0.06, 'largest room matches the left room');
  assert.strictEqual(big.door && big.door.wall, 'E', 'the left room has its doorway in the east partition');
  assert.ok(Math.abs(big.door.pos - (99 - 20) / 160) < 0.08, 'doorway position along the wall');
  assert.ok(big.ext.W && big.ext.N && big.ext.S && !big.ext.E, 'outside walls of the left room');
  for (const b of boxes) assert.ok(b.x > 0.05 && b.y > 0.05 && b.x + b.w < 0.95 && b.y + b.h < 0.95, 'no box covers the margin');
});

test('printed drawing scales are read from sheet text', () => {
  ctx.__t = ['SCALE: 3/16" = 1\'-0"', 'Floor plan  1/4″ = 1′', 'Scale 1:50', 'GROUND FLOOR 1:100 A-101', 'Issued 1:30 pm', 'no scale here'];
  const r = run('__t.map(t => { const s = PlanRecognizer.scaleFromText(t); return s ? s.ratio : null; })');
  assert.strictEqual(Array.from(r).join(','), '64,48,50,100,,');
});

test('L-shaped rooms keep furniture out of the notch and count only the real floor area', () => {
  let checked = 0;
  for (const type of types) for (const corner of ['NE', 'NW', 'SE', 'SW']) for (const [W, D] of [[4, 4], [5.5, 4.2], [7, 5], [3, 6]]) for (const dw of walls) {
    ctx.__room = { id: 'x', name: type, type, x: 0, y: 0, W, D, doorWall: dw, doorPos: 0.3, winWall: 'N', winPos: 0.6, overrides: {}, removed: [], cut: { corner, w: W * 0.4, d: D * 0.45 } };
    const p = run('planRoom(__room, "scandi", 20000)'), c = p.r.cutBox;
    assert.ok(c, `${type} ${corner} ${W}x${D}: notch kept`);
    for (const q of p.placed) {
      const inNotch = q.cx + q.hx > c.x0 + 1e-3 && q.cx - q.hx < c.x1 - 1e-3 && q.cz + q.hz > c.z0 + 1e-3 && q.cz - q.hz < c.z1 - 1e-3;
      assert.ok(!inNotch, `${type} ${corner} ${W}x${D}: ${q.cat} is in the notch`);
    }
    assert.ok(Math.abs(p.r.area - (W * D - c.w * c.d)) < 1e-6);
    const f = p.lines.find(l => l.area);
    if (f) assert.ok(f.qty < W * D, `${type}: flooring excludes the notch`);
    /* door and window sit on wall that exists */
    for (const o of [p.r.door, p.r.win]) { const rg = run(`sideRange(__geo = roomGeom(__room), ${JSON.stringify(o.wall)})`); assert.ok(o.t >= rg[0] - 1e-6 && o.t <= rg[1] + 1e-6, `${type} ${corner}: opening off the wall`); }
    /* six wall segments enclose the outline: their total length equals the perimeter */
    const segs = run('wallSegments(__geo)'), per = segs.reduce((s, g) => s + Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), 0);
    assert.strictEqual(segs.length, 6);
    assert.ok(Math.abs(per - 2 * (W + D)) < 1e-6, 'an L has the same perimeter as its bounding box');
    if (W >= 5 && D >= 4.2 && type !== 'hall') for (const c2 of run(`ROOMS.${type}.required`)) assert.ok(p.placed.some(q => q.cat === c2) || run(`CATS.${c2}.area`), `${type} ${corner} ${W}x${D} door ${dw}: required ${c2} not placed`);
    checked++;
  }
  assert.ok(checked > 300);
});

test('the plan detector recognizes an L-shaped room', () => {
  const w = 300, h = 220, px = new Uint8ClampedArray(w * h * 4).fill(255);
  const ink = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; } };
  /* One L room: 240 x 180 box with the north-east 100 x 80 corner missing. */
  ink(30, 20, 170, 22); ink(170, 20, 172, 100); ink(170, 98, 270, 100); ink(268, 98, 270, 200);
  ink(30, 198, 270, 200); ink(30, 20, 32, 200);
  ctx.__px = px;
  const boxes = run('PlanRecognizer.detectPixels(__px, 300, 220)');
  assert.strictEqual(boxes.length, 1);
  const b = boxes[0];
  assert.ok(b.cut && b.cut.corner === 'NE', 'notch found in the north-east corner');
  assert.ok(Math.abs(b.cut.w - 98 / 240) < 0.08 && Math.abs(b.cut.h - 78 / 180) < 0.08, `notch size ${b.cut.w.toFixed(2)} x ${b.cut.h.toFixed(2)}`);
});

test('door types keep their own clear zones and change how close furniture may come', () => {
  const zoneArea = z => 4 * z.hx * z.hz;
  for (const type of types) for (const doorType of ['swing', 'pocket', 'barn', 'open']) for (const side of ['left', 'right']) for (const swing of ['in', 'out']) for (const dw of walls) {
    ctx.__room = { id: 'x', name: type, type, x: 0, y: 0, W: 4.6, D: 3.8, doorWall: dw, doorPos: 0.5, winWall: 'N', winPos: 0.6, overrides: {}, removed: [], doorType, doorSide: side, doorSwing: swing, doorWidth: 0.86 };
    const p = run('planRoom(__room, "modern", 20000)');
    assert.strictEqual(p.r.door.type, doorType);
    for (const q of p.placed) if (!q.flat) for (const z of p.r.keepClear) assert.ok(!overlaps(q, z), `${type} ${doorType} ${side} ${swing} ${dw}: ${q.cat} in the door's clear zone`);
    const rg = run(`sideRange(roomGeom(__room), ${JSON.stringify(p.r.door.wall)})`), w = p.r.door.width;
    const need = doorType === 'pocket' || doorType === 'barn' ? (side === 'left' ? [w * 1.5, w / 2] : [w / 2, w * 1.5]) : [w / 2, w / 2];
    assert.ok(p.r.door.t - need[0] >= rg[0] - 1e-6 && p.r.door.t + need[1] <= rg[1] + 1e-6, `${doorType} ${side}: no wall left for the leaf`);
    const big = doorType === 'swing' && swing === 'in';
    assert.ok(big ? zoneArea(p.r.doorRect) > 0.9 : zoneArea(p.r.doorRect) < 0.7, `${doorType} ${swing}: clear zone size`);
  }
});

test('walking: walls block, doors let you through, and paths stay inside', () => {
  /* Two rooms side by side sharing the wall at x = 4; the left room's door is on that wall. */
  ctx.__plans = run(`[
    {id:'a',name:'A',type:'living',x:0,y:0,W:4,D:4,doorWall:'E',doorPos:0.5,winWall:'N',winPos:0.5,overrides:{},removed:[]},
    {id:'b',name:'B',type:'bedroom',x:4,y:0,W:4,D:4,doorWall:'N',doorPos:0.5,winWall:'S',winPos:0.5,overrides:{},removed:[]}
  ].map(room => ({room, r: roomGeom(room)}))`);
  const test = run('__walk = walkArea(__plans)');
  assert.ok(run('__walk(2, 2)') && run('__walk(6, 2)'), 'room centres are walkable');
  assert.ok(!run('__walk(4, 0.6)'), 'the shared wall away from the door blocks');
  assert.ok(run('__walk(4, 2)'), 'the doorway is walkable');
  assert.ok(!run('__walk(0.1, 2)'), 'too close to an outside wall');
  const path = run('findPath(__walk, [1, 0.8], [7, 0.8])');
  assert.ok(path && path.length >= 2, 'a path exists through the door');
  const pts = [[1, 0.8]].concat(Array.from(path));
  for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 20; k++) {
    const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 20, z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 20;
    assert.ok(run(`__walk(${x}, ${z})`), `path leaves the walkable area at ${x.toFixed(2)}, ${z.toFixed(2)}`);
  }
  const last = pts[pts.length - 1];
  assert.ok(Math.hypot(last[0] - 7, last[1] - 0.8) < 1e-9, 'path ends at the target');
  /* No door between two rooms: no way across. */
  ctx.__plans[0].room.doorWall = 'W'; ctx.__plans[0].r = run('roomGeom(__plans[0].room)');
  assert.strictEqual(run('findPath(walkArea(__plans), [1, 2], [7, 2])'), null);
  /* L-shaped room: you can walk around the notch. */
  ctx.__l = run(`[{id:'l',name:'L',type:'living',x:0,y:0,W:6,D:5,doorWall:'S',doorPos:0.3,winWall:'W',winPos:0.5,overrides:{},removed:[],cut:{corner:'NE',w:3,d:2.5}}].map(room => ({room, r: roomGeom(room)}))`);
  const lp = run('findPath(walkArea(__l), [1, 1], [5, 4])');
  assert.ok(lp && lp.length >= 2, 'path bends round the notch');
  assert.ok(!run('walkArea(__l)(4.5, 1)'), 'the notch is not walkable');
});

test('a wall colour adds paint by the gallon to the room', () => {
  ctx.__room = { id: 'x', name: 'b', type: 'bedroom', x: 0, y: 0, W: 4, D: 3.5, doorWall: 'S', doorPos: 0.5, winWall: 'N', winPos: 0.5, overrides: {}, removed: [] };
  assert.ok(!run('planRoom(__room, "scandi", 9000)').lines.some(l => l.cat === 'paint'), 'no paint without a colour');
  ctx.__room.wallColor = '#B7C2AB';
  const p = run('planRoom(__room, "scandi", 9000)'), paint = p.lines.find(l => l.cat === 'paint');
  /* walls 2 x (4 + 3.5) x 2.7 = 40.5 m2, less door and window = about 37 m2; two coats at 37 m2 a gallon = 2 gallons */
  assert.ok(paint && paint.unit === 'gal' && paint.qty === 2, `gallons: ${paint && paint.qty}`);
  const tight = run('planRoom(__room, "scandi", 200)');
  assert.ok(tight.lines.some(l => l.cat === 'paint'), 'paint stays when the budget is short');
});
