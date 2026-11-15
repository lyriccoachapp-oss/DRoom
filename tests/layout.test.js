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
