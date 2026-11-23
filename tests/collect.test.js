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
