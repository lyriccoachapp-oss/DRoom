'use strict';
/* Finishing-material facts from titles and specification tables, and the Home Depot feed rows built from them. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { inches, pairFromText, parseMaterial } = require('../tools/specs');
const { rowFrom, findSpecs } = require('../tools/collect-homedepot');

test('lengths are read with fractions and units', () => {
  assert.strictEqual(inches('7-1/8 in.'), 7.125);
  assert.strictEqual(inches('3/8 in'), 0.375);
  assert.strictEqual(inches('12'), 12);
  assert.ok(Math.abs(inches('300 mm') - 11.811) < 0.001);
  assert.strictEqual(inches('4', 'ft'), 48);
  assert.deepStrictEqual(pairFromText('Porcelain Tile 12 in. x 24 in. Matte'), [12, 24]);
  assert.deepStrictEqual(pairFromText('7-1/8 inch W x 48 inch L plank'), [7.125, 48]);
  assert.deepStrictEqual(pairFromText('600 x 600 mm tile').map(v => Math.round(v * 100) / 100), [23.62, 23.62]);
  assert.strictEqual(pairFromText('Model 4x'), null);
});

test('a tile specification table gives the piece size, box coverage, colour and use', () => {
  const m = parseMaterial('Example Grey Porcelain Tile', [
    { name: 'Product Width (in.)', value: '11.81' }, { name: 'Product Length (in.)', value: '23.62' }, { name: 'Product Thickness (mm)', value: '9' },
    { name: 'Package Width (in.)', value: '13' }, { name: 'Coverage Area (sq. ft.)', value: '15.5' }, { name: 'Pieces Per Case', value: '8' },
    { name: 'Colour Family', value: 'Grey' }, { name: 'Finish', value: 'Matte' }, { name: 'Tile Use', value: 'Floor and Wall' }]);
  assert.deepStrictEqual({ k: m.kind, w: m.width_in, l: m.length_in, c: m.coverage_sqft, p: m.pieces_per_box, col: m.color, f: m.finish },
    { k: 'tile', w: 11.81, l: 23.62, c: 15.5, p: 8, col: 'Grey', f: 'Matte' });
  assert.ok(Math.abs(m.thickness_in - 0.354) < 0.001);
});

test('kinds are told apart and accessories are left out', () => {
  const kind = (t, s) => (parseMaterial(t, s || []) || {}).kind || null;
  assert.strictEqual(kind('Oak Luxury Vinyl Plank Flooring 7 in. x 48 in.'), 'floor');
  assert.strictEqual(kind('White Subway Ceramic Wall Tile 3 in. x 6 in.'), 'walltile');
  assert.strictEqual(kind('Ceramic Tile 12x12', [{ name: 'Tile Use', value: 'Wall Only' }]), 'walltile');
  assert.strictEqual(kind('Peel and Stick Wallpaper Botanical'), 'wallpaper');
  assert.strictEqual(kind('Interior Paint Eggshell 3.7 L'), 'paint');
  assert.strictEqual(kind('Tile Grout Sanded 10 lb'), null);
  assert.strictEqual(kind('Vinyl Plank Transition Moulding'), null);
  assert.strictEqual(kind('Cordless Drill'), null);
  const m = parseMaterial('Oak Vinyl Plank 7 in. x 48 in.', [{ name: 'Pieces Per Case', value: '10' }]);
  assert.strictEqual(m.coverage_sqft, 23.33, 'coverage is worked out from the pieces when the table has none');
});

test('a search hit and its detail answer become a feed row the planner imports', () => {
  const hit = { product_id: '1001234567', title: 'Example Oak Vinyl Plank Flooring 7 in. x 48 in.', brand: 'Example', price: 54.9, thumbnails: [['https://example.com/a.jpg']], link: 'https://example.com/p/1001234567' };
  const detail = { product_results: { title: hit.title, price: 54.9, specifications: [{ key: 'Dimensions', value: [{ name: 'Product Width (in.)', value: '7.09' }, { name: 'Product Length (in.)', value: '48' }] }, { key: 'Details', value: [{ name: 'Coverage Area (sq. ft.)', value: '23.6' }, { name: 'Colour Family', value: 'Brown' }] }] } };
  assert.strictEqual(findSpecs(detail).length, 4);
  const row = rowFrom(hit, detail, 'floor');
  assert.deepStrictEqual({ c: row.droom_category, w: row.tile_width_in, l: row.tile_length_in, u: row.price_unit, s: row.price_per_sqft, i: row.image },
    { c: 'floor', w: 7.09, l: 48, u: 'box', s: 2.33, i: 'https://example.com/a.jpg' });
  assert.strictEqual(rowFrom({ title: 'Cordless Drill', price: 99 }, null, 'floor'), null);
  assert.strictEqual(rowFrom({ title: 'Wall tile 3 in. x 6 in.', price: 0 }, null, 'walltile'), null, 'no price, no row');

  const ctx = vm.createContext({ document: { querySelector() { return null; } }, console });
  for (const f of ['catalog.js', 'stores.js', 'layout.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'), ctx, { filename: f });
  ctx.__feed = JSON.stringify({ products: [row, rowFrom({ product_id: 'W1', title: 'Peel and Stick Wallpaper 20.5 in. x 18 ft.', price: 40 }, null, 'wallpaper')] });
  const r = vm.runInContext('Stores.importFeed("homedepot", __feed)', ctx);
  assert.strictEqual(r.added, 2, 'flooring and wallpaper both go in');
  const paper = vm.runInContext('BYID["s:homedepot:W1"]', ctx);
  assert.ok(paper.cat === 'wallpaper' && Math.abs(paper.price - 40 / 30.75 * 10.7639) < 0.02, 'a roll price becomes a price per square metre');
  const it = vm.runInContext('BYID["s:homedepot:1001234567"]', ctx);
  assert.ok(Math.abs(it.tw - 0.18) < 0.001 && Math.abs(it.tl - 1.2192) < 0.001 && Math.abs(it.cover - 2.193) < 0.001);
  assert.ok(Math.abs(it.price - 54.9 / 23.6 * 10.7639) < 0.02);
  ctx.__room = { id: 'x', name: 'Living', type: 'living', x: 0, y: 0, W: 5, D: 4, doorWall: 'S', doorPos: 0.8, winWall: 'N', winPos: 0.5, overrides: {}, removed: [] };
  const line = vm.runInContext('planRoom(__room, "scandi", 20000).lines.find(l => l.cat === "floor")', ctx);
  assert.strictEqual(line.item.id, it.id);
  ctx.__line = line;
  assert.strictEqual(vm.runInContext('boxesFor(__line)', ctx), Math.ceil(22 / it.cover));
  assert.match(vm.runInContext('fmtDims(__line.item)', ctx), /^7\.1 × 48 in · \$2\.3\d \/ ft²$/);
});

test('an IKEA product page becomes a feed row, and product addresses are sorted into groups', () => {
  const { rowFromHtml, kindOfUrl, KINDS } = require('../tools/collect-ikea');
  const ld = o => '<script type="application/ld+json">' + JSON.stringify(o) + '</script>';
  const product = { '@type': 'Product', name: 'EXAMPEL Sofa - Testby grey', sku: '123.456.78', category: 'Fabric sofas', width: '218 cm (85 7/8 ")', depth: '88 cm (34 5/8 ")', height: '85 cm (33 1/2 ")',
    image: [{ '@type': 'ImageObject', contentUrl: 'https://example.com/a.jpg' }], offers: { '@type': 'Offer', price: '699', priceCurrency: 'CAD', url: 'https://example.com/p/exampel-s12345678/' } };
  const html = '<html>' + ld({ '@type': 'BreadcrumbList' }) + ld(product) + ld({ '@type': '3DModel', encoding: [{ contentUrl: 'https://example.com/m.glb' }] }) + '<script type="application/ld+json">{broken</script></html>';
  const row = rowFromHtml(html, 'sofa');
  assert.deepStrictEqual({ s: row.sku, p: row.price, w: row.width_cm, d: row.depth_cm, h: row.height_cm, c: row.color, i: row.image, m: row.model_glb, k: row.droom_category },
    { s: '123.456.78', p: 699, w: 218, d: 88, h: 85, c: 'Testby grey', i: 'https://example.com/a.jpg', m: 'https://example.com/m.glb', k: 'sofa' });
  assert.strictEqual(rowFromHtml(ld(Object.assign({}, product, { width: undefined })), 'sofa'), null, 'no size, no row');
  assert.strictEqual(rowFromHtml(ld(Object.assign({}, product, { category: 'Outdoor lounge furniture' })), 'sofa'), null);
  assert.strictEqual(rowFromHtml('<html></html>', 'sofa'), null);
  const lamp = rowFromHtml(ld(Object.assign({}, product, { name: 'EXAMPEL Floor lamp - black', width: undefined, depth: undefined, height: '153 cm' })), 'lamp');
  assert.deepStrictEqual({ w: lamp.width_cm, d: lamp.depth_cm, h: lamp.height_cm, a: lamp.size_assumed }, { w: 40, d: 40, h: 153, a: true }, 'a floor lamp with no footprint gets a standard one');

  const all = Object.keys(KINDS), k = slug => kindOfUrl('https://www.ikea.com/ca/en/p/' + slug + '/', all);
  assert.strictEqual(k('exampel-sofa-testby-grey-s12345678'), 'sofa');
  assert.strictEqual(k('exampel-sofa-cover-testby-grey-12345678'), null);
  assert.strictEqual(k('exampel-swivel-chair-black-s12345678'), 'ochair');
  assert.strictEqual(k('exampel-chair-white-12345678'), 'dchair');
  assert.strictEqual(k('exampel-armchair-white-12345678'), 'armchair');
  assert.strictEqual(k('exampel-bunk-bed-frame-white-12345678'), null);
  assert.strictEqual(k('exampel-sofa-outdoor-grey-12345678'), null);
  assert.strictEqual(kindOfUrl('https://www.ikea.com/ca/en/p/exampel-sofa-grey-1/', ['bed']), null);

  const ctx = vm.createContext({ document: { querySelector() { return null; } }, console });
  for (const f of ['catalog.js', 'stores.js', 'layout.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'), ctx, { filename: f });
  ctx.__feed = JSON.stringify({ products: [row] });
  assert.strictEqual(vm.runInContext('Stores.importFeed("ikea", __feed)', ctx).added, 1);
  const it = vm.runInContext('BYID["s:ikea:123.456.78"]', ctx);
  assert.ok(it.cat === 'sofa' && it.si === 2 && Math.abs(it.w - 2.18) < 1e-9 && Math.abs(it.h - 0.85) < 1e-9);
});

test('Home Depot Canada titles give the box coverage and the face size, not the thickness', () => {
  const m = parseMaterial('Valley Wood 6.5mm x 7.5 in. W x 47.6 in. L 22MIL Click Lock Waterproof Luxury Vinyl Plank Flooring (19.8 sq.ft./case)', []);
  assert.deepStrictEqual({ k: m.kind, w: m.width_in, l: m.length_in, c: m.coverage_sqft }, { k: 'floor', w: 7.5, l: 47.6, c: 19.8 });
  const t = parseMaterial('Kingston Sand 3 in. x 8 in. Polished Ceramic Wall Tile (5.38 Sq. Ft. / Case)', []);
  assert.deepStrictEqual({ k: t.kind, w: t.width_in, l: t.length_in, c: t.coverage_sqft }, { k: 'walltile', w: 3, l: 8, c: 5.38 });
  const row = rowFrom({ product_id: 'C1', title: '12-inch x 24-inch Carrara Porcelain Floor & Wall Tile(15.5 sq.ft. / case)', price: 36.27 }, null, 'tile');
  assert.deepStrictEqual({ u: row.price_unit, s: row.price_per_sqft, w: row.tile_width_in, l: row.tile_length_in }, { u: 'box', s: 2.34, w: 12, l: 24 });
  const paper = rowFrom({ product_id: 'P1', title: 'Lykke Blue Wallpaper', price: 64.98 }, null, 'wallpaper');
  assert.deepStrictEqual({ c: paper.coverage_sqft, a: paper.coverage_assumed, s: paper.price_per_sqft }, { c: 28, a: true, s: 2.32 });
  const p56 = rowFrom({ product_id: 'P2', title: '56 sq. ft. Pre-Pasted Paintable Wallpaper in White', price: 39.98 }, null, 'wallpaper');
  assert.ok(p56.coverage_sqft === 56 && !p56.coverage_assumed);
});

test('a tile priced per piece gets a price per square foot from its face', () => {
  const row = rowFrom({ product_id: 'E1', title: '12-inch x 24-inch Vera Carrara Porcelain Floor and Wall Tile', price: 4.76, unit: 'each' }, null, 'tile');
  assert.deepStrictEqual({ u: row.price_unit, c: row.coverage_sqft, s: row.price_per_sqft, su: row.store_unit }, { u: 'piece', c: 2, s: 2.38, su: 'each' });
  const ctx = vm.createContext({ document: { querySelector() { return null; } }, console });
  for (const f of ['catalog.js', 'stores.js', 'layout.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'js', f), 'utf8'), ctx, { filename: f });
  ctx.__feed = JSON.stringify({ products: [row] });
  assert.strictEqual(vm.runInContext('Stores.importFeed("homedepot", __feed)', ctx).added, 1);
  ctx.__l = { area: true, qty: 2, item: vm.runInContext('BYID["s:homedepot:E1"]', ctx) };
  assert.ok(Math.abs(ctx.__l.item.price - 4.76 / 2 * 10.7639) < 0.02);
  assert.strictEqual(vm.runInContext('boxesFor(__l) + boxWord(__l, boxesFor(__l))', ctx), '11 pieces');
});

test('a large tile with no stated unit and no box coverage is read as priced per piece, and marked', () => {
  const row = rowFrom({ product_id: 'V1', title: '24-inch x 48-inch Vermont Oasis Matte Rectified Porcelain Tile', price: 22.32 }, null, 'tile');
  assert.deepStrictEqual({ u: row.price_unit, a: row.price_unit_assumed, s: row.price_per_sqft }, { u: 'piece', a: true, s: 2.79 });
  assert.strictEqual(rowFrom({ product_id: 'V2', title: 'Porcelain Tile Sample', price: 2 }, null, 'tile'), null, 'accessories and samples stay out');
});

test('a US result quoting "sq. ft." with a case price is priced per case when the case coverage is known', () => {
  const row = rowFrom({ product_id: 'U1', title: 'Dusk Cherry 22 MIL x 8.7 in. W x 48 in. L Click Lock Waterproof Luxury Vinyl Plank Flooring (20.1 sq. ft./case)', price: 59.97, unit: 'sq. ft.' }, null, 'floor');
  assert.deepStrictEqual({ u: row.price_unit, s: row.price_per_sqft, w: row.tile_width_in, l: row.tile_length_in }, { u: 'box', s: 2.98, w: 8.7, l: 48 });
  const bare = rowFrom({ product_id: 'U2', title: 'Oak Vinyl Plank Flooring', price: 2.49, unit: 'sq. ft.' }, null, 'floor');
  assert.deepStrictEqual({ u: bare.price_unit, s: bare.price_per_sqft }, { u: 'sqft', s: 2.49 }, 'with no coverage the unit is taken at its word');
});

test('Canadian rows take missing specifications from the same model on the US site', () => {
  const { merge } = require('../tools/merge-homedepot');
  const ca = [{ sku: 'C1', model: 'BK-106 24', name: 'Tile', price: 50, coverage_sqft: 10, price_per_sqft: 5 },
    { sku: 'C2', model: 'W1', name: 'Paper', price: 56, coverage_sqft: 28, coverage_assumed: true, price_per_sqft: 2 },
    { sku: 'C3', model: 'NOPE', name: 'Other', price: 9 }];
  const us = [{ sku: 'U1', model: 'bk10624', price: 30, url: 'https://example.com/u1', thickness_in: 0.315, finish: 'Matte', color: 'Brown' },
    { sku: 'U2', model: 'w1', price: 40, coverage_sqft: 56 }];
  const r = merge(ca, us);
  assert.deepStrictEqual({ m: r.matched, c: r.coverage }, { m: 2, c: 1 });
  assert.deepStrictEqual({ t: r.rows[0].thickness_in, f: r.rows[0].finish, p: r.rows[0].price, u: r.rows[0].price_usd }, { t: 0.315, f: 'Matte', p: 50, u: 30 });
  assert.deepStrictEqual({ c: r.rows[1].coverage_sqft, a: r.rows[1].coverage_assumed, s: r.rows[1].price_per_sqft }, { c: 56, a: undefined, s: 1 });
  assert.strictEqual(r.rows[2], ca[2]);
});
