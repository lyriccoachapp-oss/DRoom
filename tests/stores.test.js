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

test('L-shaped sofas take an L-shaped size, and colours of one model count as one product', () => {
  run('Stores.reset()');
  const feed = { products: [
    { sku: 'C1', name: 'EXAMPEL Sectional, 4-seat corner - grey', droom_category: 'sofa', price: 1299, width_cm: 252, depth_cm: 92, shape: 'corner', deep_side_cm: 252 },
    { sku: 'H1', name: 'EXAMPEL Sofa with chaise - beige', droom_category: 'sofa', price: 1499, width_cm: 252, depth_cm: 98, shape: 'chaise', deep_side_cm: 164 },
    { sku: 'W1', name: 'EXAMPEL Sofa - beige', droom_category: 'sofa', price: 1699, width_cm: 312, depth_cm: 98 },
    { sku: 'S1', name: 'TESTA Sofa - grey', droom_category: 'sofa', price: 700, width_cm: 224, depth_cm: 90 },
    { sku: 'S2', name: 'TESTA Sofa - green', droom_category: 'sofa', price: 720, width_cm: 224, depth_cm: 90 },
    { sku: 'S3', name: 'TESTA Sofa - brown', droom_category: 'sofa', price: 740, width_cm: 224, depth_cm: 90 },
    { sku: 'S4', name: 'ANNAN Sofa - blue', droom_category: 'sofa', price: 900, width_cm: 230, depth_cm: 92 }] };
  const r = call('Stores.importFeed("ikea", __a)', JSON.stringify(feed));
  assert.strictEqual(r.added, 7);
  const it = id => run('BYID["s:ikea:' + id + '"]');
  assert.deepStrictEqual([it('C1').si, it('H1').si, it('W1').si], [7, 5, 4]);
  assert.ok(Math.abs(it('C1').ext.cd - 2.52) < 1e-9 && Math.abs(it('H1').ext.cd - 1.64) < 1e-9 && !it('W1').ext);
  assert.strictEqual(it('S1').group, it('S2').group);
  assert.strictEqual(it('S2').variant, 'green');
  assert.notStrictEqual(it('S1').group, it('S4').group);
  /* with a big budget the dearest model wins, not the dearest colour of the cheapest model */
  assert.strictEqual(run('Stores.pick("sofa", "scandi", 2, 2).id'), 's:ikea:S4');
  assert.strictEqual(run('Stores.pick("sofa", "scandi", 0, 2).id'), 's:ikea:S1');
  const room2 = room('living'); room2.W = 6; room2.D = 5; room2.overrides.sofa = 's:ikea:C1';
  const p = call('planRoom(__a, "scandi", 1e6)', room2);
  assert.strictEqual(p.lines.find(l => l.cat === 'sofa').item.id, 's:ikea:C1');
  assert.strictEqual(p.placed.filter(q => q.part).length, 1);
  run('Stores.reset()');
});

test('a project file brings back the home and the store products it uses', () => {
  for (const f of ['report.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'), ctx, { filename: f });
  run('Stores.reset()');
  call('Stores.importFeed(Stores.add("Sample Store"), Stores.SAMPLE)');
  const living = room('living'); living.overrides.sofa = 's:samplestore:NF-1002';
  ctx.__state = { style: 'modern', budget: 9000, units: 'm', rooms: [living, room('bedroom')], view: 'walk', roomId: 'x' };
  const text = run('ProjectFile.toJSON(__state, __state.rooms.map(r => planRoom(r, __state.style, 4500, [], __state.rooms)))');
  const j = JSON.parse(text);
  assert.strictEqual(j.format, 'droom-project');
  assert.ok(!('view' in j.home) && !('roomId' in j.home), 'only the home is saved, not where the viewer was');
  assert.ok(j.products.some(p => p.id === 's:samplestore:NF-1002'), 'the hand-picked sofa travels with the project');
  /* another computer: no feeds at all */
  run('Stores.reset()');
  ctx.__text = text;
  const p = run('ProjectFile.parse(__text)');
  assert.strictEqual(p.home.style, 'modern'); assert.strictEqual(p.home.rooms.length, 2);
  assert.ok(run('Stores.ensure(ProjectFile.parse(__text).products)') >= 1);
  const plan = call('planRoom(__a, "modern", 4500)', p.home.rooms[0]);
  assert.strictEqual(plan.lines.find(l => l.cat === 'sofa').item.id, 's:samplestore:NF-1002', 'the plan comes back with the same sofa');
  assert.strictEqual(run('Stores.ensure(ProjectFile.parse(__text).products)'), 0, 'opening twice adds nothing');
  for (const bad of ['not json', '{"format":"other"}', JSON.stringify({ format: 'droom-project', version: 1, home: { rooms: [{ type: 'garage', W: 3, D: 3, x: 0, y: 0 }] } })])
    assert.throws(() => { ctx.__text = bad; run('ProjectFile.parse(__text)'); });
  run('Stores.reset()');
});

test('the estimate rows carry quantities, boxes and links, and PDF text stays in Latin-1', () => {
  run('Stores.reset()');
  call('Stores.importFeed("homedepot", __a)', JSON.stringify({ products: [{ sku: 'F1', name: 'Oak plank', droom_category: 'floor', price: 50, price_unit: 'box', coverage_sqft: 20, url: 'https://example.com/f1' }] }));
  const rows = call('Report.rows([planRoom(__a, "scandi", 20000)])', room('living'));
  const fl = rows.find(r => r.name === 'Oak plank');
  assert.ok(fl && fl.url === 'https://example.com/f1' && /\(\d+ boxes\)$/.test(fl.qty) && fl.store === 'The Home Depot', JSON.stringify(fl));
  assert.ok(rows.some(r => r.store === 'Sample catalog' && r.url === null));
  assert.strictEqual(run('Report.pdfText("Sofa “Linden”, 7′6″ × 3′ · 2 m² ✓")'), 'Sofa "Linden", 7\'6" × 3\' - 2 m² OK');
  run('Stores.reset()');
});

test('a feed row may carry a product 3D model: an https .glb or a .glb published beside the app', () => {
  run('Stores.reset()');
  const rows = [
    { sku: 'M1', name: 'Model sofa - grey', droom_category: 'sofa', price: 999, width_cm: 241, depth_cm: 98, model3d: 'models/vimle.glb', model3d_rot: 90 },
    { sku: 'M2', name: 'Remote sofa - grey', droom_category: 'sofa', price: 999, width_cm: 241, depth_cm: 98, glb: 'https://example.com/a/sofa.glb' },
    { sku: 'M3', name: 'Bad path sofa', droom_category: 'sofa', price: 999, width_cm: 241, depth_cm: 98, model3d: '../secret.glb' },
    { sku: 'M4', name: 'Plain http sofa', droom_category: 'sofa', price: 999, width_cm: 241, depth_cm: 98, model3d: 'http://example.com/a.glb' }];
  assert.strictEqual(call('Stores.importFeed("ikea", __a)', JSON.stringify({ products: rows })).added, 4);
  const m = id => run('BYID["s:ikea:' + id + '"].model3d') || null;
  assert.deepStrictEqual([m('M1'), m('M2'), m('M3'), m('M4')], ['models/vimle.glb', 'https://example.com/a/sofa.glb', null, null]);
  assert.ok(Math.abs(run('BYID["s:ikea:M1"].model3dRot') - Math.PI / 2) < 1e-9);
  run('Stores.reset()');
});
