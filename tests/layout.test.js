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
