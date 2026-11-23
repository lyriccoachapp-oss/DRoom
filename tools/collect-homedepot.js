'use strict';
/* Builds a DRoom store feed of Home Depot finishing materials (tile, flooring, wallpaper, paint).

   Data comes from SerpApi's Home Depot engines, the same provider the CRM already uses, so a SERPAPI_KEY is
   needed and each request spends one search credit. Raw answers are cached on disk: a second run costs nothing
   for products already seen. This script does not open homedepot pages itself.

     SERPAPI_KEY=... node tools/collect-homedepot.js --kinds tile,floor --pages 2 --out catalog/homedepot.json

   Options: --kinds tile,walltile,floor,wallpaper,paint   which groups to collect (default: all)
            --pages N        result pages per search query (default 1)
            --limit N        stop after N products per kind (default 60)
            --country ca|us  (default ca; specifications are only available for us)
            --out FILE       feed to write (default catalog/homedepot.json)
            --images DIR     also download one photo per product into DIR
            --no-details     skip the per-product request; sizes then come from titles only
   Import the result in the planner: Stores, The Home Depot, Import feed. */
const fs = require('fs');
const path = require('path');
const { parseMaterial } = require('./specs');

const QUERIES = {
  tile: ['porcelain floor tile', 'ceramic floor tile', 'large format floor tile', 'wood look porcelain tile'],
  walltile: ['ceramic wall tile', 'subway tile', 'backsplash mosaic tile'],
  floor: ['vinyl plank flooring', 'laminate flooring', 'engineered hardwood flooring', 'solid hardwood flooring'],
  wallpaper: ['wallpaper', 'peel and stick wallpaper'],
  paint: ['interior paint gallon']
};
const CATEGORY = { tile: 'Floor tile', walltile: 'Wall tile', floor: 'Flooring', wallpaper: 'Wallpaper', paint: 'Paint' };

/* Every {name, value} pair anywhere in a product answer; providers nest specification groups differently. */
function findSpecs(json) {
  const out = [], seen = new Set();
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    const n = o.name != null ? o.name : o.key, v = o.value;
    if (typeof n === 'string' && (typeof v === 'string' || typeof v === 'number')) { const k = n + '=' + v; if (!seen.has(k)) { seen.add(k); out.push({ name: n, value: String(v) }); } }
    for (const k in o) walk(o[k]);
  })(json);
  return out;
}
function firstUrl(o) {
  if (typeof o === 'string') return /^https?:\/\//.test(o) ? o : null;
  if (Array.isArray(o)) { for (const x of o) { const u = firstUrl(x); if (u) return u; } }
  return null;
}
const price = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };

/* One search result plus its (optional) detail answer -> a feed row, or null when it is not a finishing material. */
function rowFrom(hit, detail, wantKind) {
  const pr = (detail && (detail.product_results || detail.product)) || {};
  const title = pr.title || hit.title || '', specs = detail ? findSpecs(pr.specifications || detail.specifications || []) : [];
  const m = parseMaterial(title, specs);
  if (!m || (wantKind && m.kind !== wantKind && !(wantKind === 'tile' && m.kind === 'walltile') && !(wantKind === 'walltile' && m.kind === 'tile'))) return null;
  const p = price(pr.price != null ? pr.price : hit.price), unitText = String(pr.unit || hit.unit || pr.price_unit || '').toLowerCase();
  if (!p) return null;
  const row = { sku: String(hit.product_id || pr.product_id || hit.model_number || title).slice(0, 60), name: title.slice(0, 140), brand: (pr.brand && pr.brand.name) || (typeof pr.brand === 'string' ? pr.brand : null) || hit.brand || undefined,
    model: pr.model_number || hit.model_number || undefined, category: CATEGORY[m.kind], droom_category: m.kind, price: p,
    url: firstUrl(pr.link || hit.link) || undefined, image: firstUrl(pr.images) || firstUrl(hit.thumbnails) || firstUrl(hit.thumbnail) || undefined };
  if (m.width_in) { row.tile_width_in = m.width_in; row.tile_length_in = m.length_in; }
  ['thickness_in', 'coverage_sqft', 'coverage_from_title', 'pieces_per_box', 'color', 'finish', 'material', 'look', 'use'].forEach(k => { if (m[k] != null) row[k] = m[k]; });
  /* Tile and flooring are sold by the square foot or by the box; say which, so the planner can price a square foot. */
  if (m.kind !== 'paint') {
    if (/sq\.? ?ft|sqft|square f/.test(unitText)) { row.price_unit = 'sqft'; row.price_per_sqft = p; }
    else if (m.coverage_sqft) { row.price_unit = 'box'; row.price_per_sqft = Math.round(p / m.coverage_sqft * 100) / 100; }
    /* A wallpaper roll with no stated coverage is taken as a standard single roll of 28 sq ft, and marked so. */
    else if (m.kind === 'wallpaper') { row.coverage_sqft = 28; row.coverage_assumed = true; row.price_unit = 'box'; row.price_per_sqft = Math.round(p / 28 * 100) / 100; }
  }
  return row;
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
  const key = process.env.SERPAPI_KEY;
  if (!key) { console.error('Set SERPAPI_KEY (the same key the CRM uses).'); process.exit(1); }
  const kinds = String(arg('kinds', Object.keys(QUERIES).join(','))).split(',').filter(k => QUERIES[k]);
  const pages = parseInt(arg('pages', '1'), 10), limit = parseInt(arg('limit', '60'), 10), country = arg('country', 'ca');
  const out = arg('out', 'catalog/homedepot.json'), imgDir = arg('images', null);
  /* SerpApi's product lookup covers The Home Depot US only; for Canada the facts come from search results and titles. */
  const details = !process.argv.includes('--no-details') && country === 'us';
  if (country !== 'us') console.log('Country ' + country + ': product specifications are not available from SerpApi, so sizes are read from titles only. Use --country us for full specifications.');
  const cache = path.join(path.dirname(out), '.cache-homedepot'); fs.mkdirSync(cache, { recursive: true });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let spent = 0;
  async function api(params) {
    const name = Object.keys(params).sort().map(k => k + '-' + String(params[k]).replace(/[^a-z0-9]+/gi, '_')).join('.') + '.json', file = path.join(cache, name);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const res = await fetch('https://serpapi.com/search.json?' + new URLSearchParams(Object.assign({ api_key: key, country }, params)), { signal: AbortSignal.timeout(60000) });
    spent++;
    if (!res.ok) throw new Error('SerpApi ' + res.status + ' for ' + JSON.stringify(params));
    const json = await res.json(); if (json.error) throw new Error('SerpApi: ' + json.error);
    fs.writeFileSync(file, JSON.stringify(json)); await sleep(350);
    return json;
  }
  const rows = [], seen = new Set(), stats = {};
  for (const kind of kinds) {
    let n = 0; stats[kind] = { kept: 0, noSize: 0, skipped: 0 };
    for (const q of QUERIES[kind]) for (let page = 1; page <= pages && n < limit; page++) {
      let list; try { list = (await api({ engine: 'home_depot', q, page })).products || []; } catch (e) { console.error(e.message); break; }
      if (!list.length) break;
      if (process.env.DEBUG_HITS && !main.dumped) { main.dumped = true; console.log('FIRST-HIT ' + JSON.stringify(list[0])); }
      for (const hit of list) {
        if (n >= limit) break;
        const id = String(hit.product_id || hit.title); if (seen.has(id)) continue; seen.add(id);
        let detail = null;
        if (details && hit.product_id) { try { detail = await api({ engine: 'home_depot_product', product_id: hit.product_id }); } catch (e) { console.error(e.message); } }
        const row = rowFrom(hit, detail, kind);
        if (!row) { stats[kind].skipped++; continue; }
        if (!row.tile_width_in && kind !== 'paint') stats[kind].noSize++;
        rows.push(row); n++; stats[kind].kept++;
      }
    }
  }
  const write = () => { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify({ store: 'homedepot', country, collected: new Date().toISOString().slice(0, 10), products: rows }, null, 1)); };
  /* The feed is written before the photos, so a photo problem never costs the product data. */
  write();
  if (imgDir) {
    fs.mkdirSync(imgDir, { recursive: true });
    let failed = 0;
    for (const row of rows) {
      if (failed >= 5) { console.error('Photos: 5 downloads in a row failed, skipping the rest. The feed keeps each photo link.'); break; }
      if (!row.image) continue;
      const file = path.join(imgDir, row.sku.replace(/[^a-z0-9_-]+/gi, '_') + '.jpg');
      try { if (!fs.existsSync(file)) { const r = await fetch(row.image, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(String(r.status)); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); await sleep(150); } row.image_file = path.relative(path.dirname(out), file); failed = 0; }
      catch (e) { failed++; console.error('photo ' + row.sku + ': ' + e.message); }
    }
  }
  write();
  console.log('Wrote ' + rows.length + ' products to ' + out + ' (' + spent + ' new SerpApi requests).');
  for (const k in stats) console.log('  ' + k + ': kept ' + stats[k].kept + ', without a size ' + stats[k].noSize + ', not a finishing material ' + stats[k].skipped);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { findSpecs, rowFrom, QUERIES };
