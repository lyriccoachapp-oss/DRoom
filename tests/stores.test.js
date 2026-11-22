'use strict';
/* Store feed import: reading, mapping onto planner categories and sizes, and use in a room plan. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ document: { querySelector() { return null; } }, console });
for (const f of ['catalog.js', 'stores.js', 'layout.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'), ctx, { filename: f });
const run = code => vm.runInContext(code, ctx);
const call = (code, args) => { ctx.__a = args; return run(code); };
const room = type => ({ id: 'x', name: type, type, x: 0, y: 0, W: 4.8, D: 4.0, doorWall: 'S', doorPos: 0.8, winWall: 'N', winPos: 0.5, overrides: {}, removed: [] });
const plan = (type, budget) => call('planRoom(__a[0], "scandi", __a[1])', [room(type), budget]);

test('store categories map onto planner categories', () => {
  const map = { 'Sofas & sectionals': 'sofa', 'Living Room > TV Stands': 'tvstand', 'Bed frames': 'bed', 'Bedding': null, 'Nightstands': 'nightstand', 'Vinyl Plank Flooring': 'floor',
    'Porcelain Tile': 'tile', 'Range Hoods': null, 'Ranges': 'range', 'Toilet Seats': null, 'Toilets': 'toilet', 'Bathroom Vanities': 'vanity', 'Office chairs': 'ochair', 'Garden hoses': null, 'sofa': 'sofa' };
  for (const k in map) assert.strictEqual(call('Stores.mapCategory(__a)', k), map[k], k);
});

test('a CSV feed with quotes, centimetres and semicolons is read', () => {
  run('Stores.reset()');
  const csv = 'Article;Product name;Type;Price;Width (cm);Depth (cm);Height (cm);Link\n' +
    '123.456.78;"SOFA; 3-seat, ""grey""";Sofas;699,00;218;88;85;https://example.com/a\n' +
    '223.456.78;Queen bed frame;Beds;349;160;209;100;javascript:alert(1)\n';
  const r = call('Stores.importFeed("ikea", __a)', csv);
  assert.strictEqual(r.added, 2);
  const sofa = run('BYID["s:ikea:123.456.78"]'), bed = run('BYID["s:ikea:223.456.78"]');
  assert.strictEqual(sofa.name, 'SOFA; 3-seat, "grey"');
  assert.ok(Math.abs(sofa.w - 2.18) < 1e-9 && sofa.si === 2 && sofa.price === 699 && sofa.url === 'https://example.com/a');
  assert.ok(bed.si === 1 && bed.url === null, 'a link that is not http(s) is dropped');
});

test('inches, a dimensions string, JSON and per-box flooring prices are understood', () => {
  run('Stores.reset()');
  const feed = JSON.stringify({ products: [
    { id: 'A1', title: 'Accent chair', category: 'Chairs', price: '$329.00', dimensions: '30 x 32 x 31 in' },
    { id: 'F1', title: 'Oak vinyl plank flooring', price: 54.9, coverage_sqft: 23.6 },
    { id: 'F2', title: 'Porcelain floor tile 12x24', price_per_sqft: 3.2 },
    { id: 'X1', title: 'Garden hose', price: 20 },
    { id: 'B1', title: 'Huge sectional sofa', price: 2000, width: 150, depth: 90 },
    { id: 'N1', title: 'Nightstand', price: 0, width: 18, depth: 16 }
  ] });
  const r = call('Stores.importFeed("homedepot", __a)', feed);
  assert.strictEqual(r.added, 3);
  assert.deepStrictEqual(Object.assign({}, r.skipped), { 'category not used by the planner': 1, 'larger than the sizes the planner lays out': 1, 'no price': 1 });
  assert.ok(Math.abs(run('BYID["s:homedepot:A1"].w') - 0.762) < 1e-6);
  assert.ok(Math.abs(run('BYID["s:homedepot:F1"].price') - 54.9 / 23.6 * 10.7639) < 0.01);
  assert.ok(Math.abs(run('BYID["s:homedepot:F2"].price') - 3.2 * 10.7639) < 0.01);
});

test('a room plan uses store products when a store is on, and the sample catalog when it is off', () => {
  run('Stores.reset()');
  call('Stores.importFeed(Stores.add("Sample Store"), Stores.SAMPLE)');
  let p = plan('living', 6000);
  const sofa = p.lines.find(l => l.cat === 'sofa').item;
  assert.strictEqual(sofa.supplier, 'Sample Store');
  assert.ok(sofa.w <= p.placed.find(q => q.cat === 'sofa').hx * 2 * 1.03 + 0.021 || sofa.w <= p.placed.find(q => q.cat === 'sofa').hz * 2 * 1.03 + 0.021, 'the product fits its slot');
  assert.ok(p.lines.some(l => !l.item.store), 'categories the feed lacks stay on the sample catalog');
  assert.ok(Math.abs(p.total - p.lines.reduce((s, l) => s + l.item.price * l.qty, 0)) < 1e-6);
  run('Stores.setEnabled("samplestore", false)');
  p = plan('living', 6000);
  assert.ok(p.lines.every(l => !l.item.store));
  assert.strictEqual(run('CATALOG.filter(i => i.store).length'), 0);
});

test('a bigger budget never picks a cheaper store product, and an override on a store product holds', () => {
  run('Stores.reset()');
  call('Stores.importFeed(Stores.add("Sample Store"), Stores.SAMPLE)');
  const tv = b => plan('living', b).lines.find(l => l.cat === 'tvstand').item.price;
  assert.ok(tv(30000) >= tv(2500));
  const r = room('bedroom'); r.overrides.bed = 's:samplestore:NF-1050';
  const p = call('planRoom(__a, "loft", 9000)', r);
  const bed = p.lines.find(l => l.cat === 'bed').item;
  assert.strictEqual(bed.id, 's:samplestore:NF-1050');
  assert.strictEqual(bed.style, 'loft', 'a product with no style of its own is drawn in the style of the home');
});

test('feeds survive a save and load, and a link falls back to a store search', () => {
  run('Stores.reset()');
  call('Stores.importFeed("ikea", __a)', 'sku,name,category,price,width,depth\nS1,Desk white,Desks,129,140,60\n');
  const mem = {}; ctx.__store = { setItem(k, v) { mem[k] = v; }, getItem(k) { return mem[k] || null; } };
  assert.ok(run('Stores.save(__store)'));
  run('Stores.reset()'); assert.strictEqual(run('BYID["s:ikea:S1"]'), undefined);
  run('Stores.load(__store)');
  assert.strictEqual(run('BYID["s:ikea:S1"].name'), 'Desk white');
  assert.strictEqual(run('Stores.linkOf(BYID["s:ikea:S1"])'), 'https://www.ikea.com/ca/en/search/?q=Desk%20white');
  assert.strictEqual(run('Stores.linkOf(CATALOG[0])'), null);
  run('Stores.reset()');
});
