'use strict';
/* Shared helpers and the demo catalog. Prices and products are sample data until store feeds are connected. */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const hex = c => '#' + c.toString(16).padStart(6, '0');
const UNITS = { v: 'ft' };
function fmtLen(m) {
  if (UNITS.v === 'm') return m.toFixed(1) + ' m';
  const inches = Math.round(m / 0.0254), ft = Math.floor(inches / 12), inch = inches % 12;
  return ft + '′' + (inch ? inch + '″' : '');
}
function fmtDims(it) {
  const f = UNITS.v === 'm' ? v => Math.round(v * 100) : v => Math.round(v / 0.0254), u = UNITS.v === 'm' ? ' cm' : ' in';
  return it.cat === 'rug' ? f(it.d) + ' × ' + f(it.w) + u : f(it.w) + ' × ' + f(it.d) + ' × ' + f(it.h) + u;
}
function fmtArea(m2) { return UNITS.v === 'm' ? m2.toFixed(1) + ' m²' : Math.round(m2 * 10.7639) + ' ft²'; }

const STYLES = {
  scandi: { name: 'Scandinavian', mult: 1.0, series: ['Linden', 'Fjord', 'Bergen'], supplier: 'Sample supplier A',
    wall: 0xf3f0ea, floor: ['#dcc29c', '#d2b68c', '#e3cba7', '#c9ad84'],
    fabric: [0xcfd4d6, 0xe4dccb, 0x9fb3a8], wood: [0xf0ece4, 0xdcc09a, 0xc9a574], metal: 0xe9e6df, rug: [0xe6dfd0, 0xb7c4bc, 0xd3c4ac] },
  modern: { name: 'Modern', mult: 1.15, series: ['Cubo', 'Linea', 'Monolith'], supplier: 'Sample supplier B',
    wall: 0xe8e9ec, floor: ['#b9b2a8', '#aea69b', '#c2bbb1', '#a59d92'],
    fabric: [0x6b7480, 0x454b54, 0x2e343c], wood: [0x8a8f96, 0x6b4a36, 0x2b2c30], metal: 0x1c1c1e, rug: [0xbfc3c7, 0x8b9198, 0x3f444b] },
  loft: { name: 'Industrial', mult: 1.1, series: ['Mill', 'Depot', 'Foundry'], supplier: 'Sample supplier C',
    wall: 0xddd5ca, floor: ['#7a5a40', '#6d4f37', '#84644a', '#634731'],
    fabric: [0x59605f, 0x7a4a2b, 0x5c3520], wood: [0x8a6746, 0x5f4129, 0x3d2a1b], metal: 0x141414, rug: [0x9a8a74, 0x6e3b2e, 0x4b4f52] }
};
const TIERS = [{ name: 'budget', mult: 1 }, { name: 'standard', mult: 1.8 }, { name: 'premium', mult: 3.2 }];
/* sizes: [width, depth, height (m), label, price multiplier] */
const CATS = {
  sofa: { name: 'Sofa', base: 520, sizes: [[1.6, 0.88, 0.82, '2-seat', 1], [2.0, 0.92, 0.82, '3-seat', 1.25], [2.4, 0.95, 0.82, '4-seat', 1.5]] },
  armchair: { name: 'Armchair', base: 260, sizes: [[0.8, 0.82, 0.8, '', 1]] },
  coffee: { name: 'Coffee table', base: 120, sizes: [[1.0, 0.55, 0.42, '', 1]] },
  tvstand: { name: 'TV stand', base: 210, sizes: [[1.5, 0.4, 0.5, 'medium', 1], [1.8, 0.42, 0.5, 'wide', 1.2]] },
  rug: { name: 'Area rug', base: 130, sizes: [[2.0, 1.4, 0.015, 'small', 1], [2.4, 1.7, 0.015, 'medium', 1.4], [3.0, 2.0, 0.015, 'large', 1.9]] },
  lamp: { name: 'Floor lamp', base: 70, sizes: [[0.4, 0.4, 1.6, '', 1]] },
  shelf: { name: 'Bookshelf', base: 160, sizes: [[0.8, 0.32, 1.9, 'narrow', 1], [1.2, 0.32, 1.9, 'wide', 1.35]] },
  plant: { name: 'Potted plant', base: 45, sizes: [[0.45, 0.45, 1.3, '', 1]] },
  bed: { name: 'Bed', base: 480, sizes: [[1.5, 2.1, 1.0, 'Full', 1], [1.7, 2.1, 1.0, 'Queen', 1.15], [1.9, 2.1, 1.0, 'King', 1.3]] },
  nightstand: { name: 'Nightstand', base: 85, sizes: [[0.45, 0.4, 0.5, '', 1]] },
  wardrobe: { name: 'Wardrobe', base: 390, sizes: [[1.2, 0.6, 2.1, '2-door', 1], [1.6, 0.6, 2.1, '3-door', 1.3], [2.0, 0.6, 2.1, '4-door', 1.6]] },
  dresser: { name: 'Dresser', base: 230, sizes: [[1.0, 0.45, 0.85, '', 1]] }
};
/* `all` is in priority order. Optional items are dropped from the end when the budget is short. `weight` splits the home budget. */
const ROOMS = {
  living: { name: 'Living room', weight: 1, all: ['sofa', 'tvstand', 'coffee', 'rug', 'armchair', 'shelf', 'lamp', 'plant'], required: ['sofa', 'tvstand', 'coffee'] },
  bedroom: { name: 'Bedroom', weight: 0.85, all: ['bed', 'wardrobe', 'nightstand', 'rug', 'dresser', 'lamp', 'plant'], required: ['bed', 'wardrobe'] }
};
const CATALOG = [], BYID = {};
const idOf = (cat, style, tier, si) => cat + '-' + style + '-' + tier + '-' + si;
for (const cat in CATS) {
  const C = CATS[cat];
  for (const style in STYLES) {
    const S = STYLES[style];
    for (let tier = 0; tier < 3; tier++) {
      C.sizes.forEach((sz, si) => {
        const price = Math.round(C.base * sz[4] * TIERS[tier].mult * S.mult / 10) * 10 - 1;
        const it = { id: idOf(cat, style, tier, si), cat, style, tier, si, w: sz[0], d: sz[1], h: sz[2],
          name: C.name + ' “' + S.series[tier] + '”' + (sz[3] ? ', ' + sz[3] : ''), price, supplier: S.supplier,
          c1: cat === 'rug' ? S.rug[tier] : S.fabric[tier], c2: S.wood[tier], c3: S.metal };
        it.swatch = (cat === 'sofa' || cat === 'armchair' || cat === 'rug' || cat === 'bed') ? it.c1 : (cat === 'plant' ? 0x4f7f4a : (cat === 'lamp' ? it.c3 : it.c2));
        CATALOG.push(it); BYID[it.id] = it;
      });
    }
  }
}
