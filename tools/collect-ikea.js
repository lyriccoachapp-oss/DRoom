'use strict';
/* Builds a DRoom store feed of IKEA furniture from IKEA's public product pages.

   IKEA has no product API. This reads only what its robots.txt leaves open to every crawler: the product sitemaps and
   the product pages themselves, taking the facts each page publishes as structured data (name, article number, price,
   width, depth, height, category, photos). It goes slowly (one page every 1.5 s by default), says who it is, keeps what
   it has read on disk, and stops if the site answers 403 or 429 instead of trying to get round it. Search pages, which
   robots.txt closes, are not used.

     node tools/collect-ikea.js --kinds sofa,bed,wardrobe --limit 40 --out catalog/ikea.json

   Options: --kinds a,b,c   groups to collect (default: all of KINDS below)
            --limit N       products per group (default 40)
            --locale ca/en  site section (default ca/en)
            --delay MS      pause between pages (default 1500, minimum 1000)
            --out FILE      feed to write (default catalog/ikea.json)
            --images DIR    also download one photo per product into DIR
   Import the result in the planner: Stores, IKEA, Import feed. */
const fs = require('fs');
const path = require('path');

const UA = 'DRoomCatalogBot/0.1 (furniture planner; product facts for linking back to the product page)';
/* Words in a product page address that put it in a group, and words that rule it out (covers, spare parts, outdoor). */
const KINDS = {
  sofa: ['-sofa-', '-loveseat-', '-sectional-'], armchair: ['-armchair-'], coffee: ['-coffee-table-'], tvstand: ['-tv-unit-', '-tv-bench-'],
  shelf: ['-bookcase-', '-shelf-unit-'], rug: ['-rug-'], lamp: ['-floor-lamp-'], bed: ['-bed-frame-'], nightstand: ['-nightstand-', '-bedside-table-'],
  wardrobe: ['-wardrobe-'], dresser: ['-chest-of-', '-dresser-'], dtable: ['-dining-table-', '-extendable-table-'], dchair: ['-chair-'], sideboard: ['-sideboard-'],
  desk: ['-desk-'], ochair: ['-office-chair-', '-swivel-chair-', '-desk-chair-']
};
const NOT = /cover|outdoor|bunk|loft-bed|combination|-legs?-|cushion|-pad-|armrest|headboard|slatted|mattress|-section-|children|junior|-baby-|underframe|-top-|add-on|storage-box|-shelf-for|-door-|-frame-with|protector|gaming|-bar-|step-stool|highchair|folding|-pillow-/;
const CATEGORY = { sofa: 'Sofas', armchair: 'Armchairs', coffee: 'Coffee tables', tvstand: 'TV stands', shelf: 'Bookcases', rug: 'Rugs', lamp: 'Floor lamps', bed: 'Bed frames',
  nightstand: 'Nightstands', wardrobe: 'Wardrobes', dresser: 'Dressers', dtable: 'Dining tables', dchair: 'Dining chairs', sideboard: 'Sideboards', desk: 'Desks', ochair: 'Office chairs' };

function kindOfUrl(url, kinds) {
  const slug = '-' + String(url).split('/p/')[1];
  if (!slug || NOT.test(slug)) return null;
  /* 'office chair' before 'chair', 'dining table' before anything looser */
  for (const k of ['ochair', 'coffee', 'dtable', 'tvstand', 'nightstand'].concat(Object.keys(KINDS))) if (kinds.includes(k) && KINDS[k].some(w => slug.includes(w))) return k === 'dchair' && /arm|office|swivel|desk|rocking|easy/.test(slug) ? null : k;
  return null;
}
/* "240 cm (94 1/2 \")" -> 240 */
const cm = s => { const m = String(s == null ? '' : s).match(/(\d+(?:\.\d+)?)\s*cm/i); return m ? parseFloat(m[1]) : null; };

/* A product page -> a feed row, or null when the page has no usable product facts. */
function rowFromHtml(html, kind) {
  let p = null, model = null;
  for (const m of String(html).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
    if (j && j['@type'] === 'Product') p = j;
    if (j && j['@type'] === '3DModel' && Array.isArray(j.encoding) && j.encoding[0]) model = j.encoding[0].contentUrl;
  }
  if (!p || !p.name || !p.offers) return null;
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers, price = parseFloat(offer && (offer.price != null ? offer.price : offer.lowPrice));
  let w = cm(p.width), d = cm(p.depth), h = cm(p.height);
  if (kind === 'rug' && !d) d = cm(p.length) || cm(p.depth);
  if (kind === 'bed' && !d) d = cm(p.length);
  /* A floor lamp page often gives only a height. Its footprint hardly varies, so a standard one is assumed and the row says so. */
  let assumed = false;
  if (kind === 'lamp' && !(w > 0 && d > 0)) { w = w > 0 ? w : d > 0 ? d : 40; d = d > 0 ? d : w; assumed = true; }
  if (!(price > 0) || !(w > 0) || !(d > 0)) return null;
  if (/outdoor/i.test(String(p.category))) return null;
  const img = Array.isArray(p.image) ? p.image[0] : p.image, parts = String(p.name).split(' - ');
  const row = { sku: String(p.sku || p.mpn), name: String(p.name).slice(0, 140), category: CATEGORY[kind] || String(p.category || ''), droom_category: kind, store_category: p.category || undefined,
    price, currency: offer.priceCurrency || undefined, width_cm: w, depth_cm: d, height_cm: h || undefined, color: parts[1] ? parts.slice(1).join(' ').slice(0, 60) : undefined,
    url: p.url || offer.url, image: img && (img.contentUrl || img.url || (typeof img === 'string' ? img : undefined)) };
  if (assumed) row.size_assumed = true;
  if (model) row.model_glb = model;
  return row;
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
  const kinds = String(arg('kinds', Object.keys(KINDS).join(','))).split(',').filter(k => KINDS[k]);
  const limit = parseInt(arg('limit', '40'), 10), locale = arg('locale', 'ca/en'), delay = Math.max(1000, parseInt(arg('delay', '1500'), 10));
  const out = arg('out', 'catalog/ikea.json'), imgDir = arg('images', null);
  const cache = path.join(path.dirname(out), '.cache-ikea'); fs.mkdirSync(cache, { recursive: true });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let fetched = 0;
  async function get(url, binary) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-CA' } });
    fetched++;
    if (res.status === 403 || res.status === 429) throw Object.assign(new Error('The site answered ' + res.status + '. Stopping; try again later with a longer --delay.'), { stop: true });
    if (!res.ok) throw new Error(res.status + ' for ' + url);
    const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    await sleep(delay);
    return body;
  }
  /* Product addresses come from the sitemaps the site publishes for crawlers. */
  const tag = locale.split('/')[1] + '-' + locale.split('/')[0].toUpperCase(), urls = [];
  const index = await get('https://www.ikea.com/sitemaps/sitemap.xml');
  for (const m of index.matchAll(/<loc>([^<]+)<\/loc>/g)) if (m[1].includes('/prod-' + tag + '_')) {
    const file = path.join(cache, path.basename(m[1])), fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 864e5;
    const xml = fresh ? fs.readFileSync(file, 'utf8') : await get(m[1]); if (!fresh) fs.writeFileSync(file, xml);
    for (const u of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) if (u[1].includes('/' + locale + '/p/')) urls.push(u[1]);
  }
  const rows = [], stats = {}, count = {}, seen = new Set();
  kinds.forEach(k => { count[k] = 0; stats[k] = { kept: 0, skipped: 0 }; });
  try {
    for (const url of urls) {
      const kind = kindOfUrl(url, kinds);
      if (!kind || count[kind] >= limit) continue;
      const file = path.join(cache, url.split('/p/')[1].replace(/[^a-z0-9-]+/gi, '') + '.json');
      let row;
      if (fs.existsSync(file)) row = JSON.parse(fs.readFileSync(file, 'utf8')).row;
      else { try { row = rowFromHtml(await get(url), kind); } catch (e) { if (e.stop) throw e; console.error(e.message); continue; } fs.writeFileSync(file, JSON.stringify({ url, row })); }
      if (!row || seen.has(row.sku)) { stats[kind].skipped++; continue; }
      seen.add(row.sku); rows.push(row); count[kind]++; stats[kind].kept++;
      if (kinds.every(k => count[k] >= limit)) break;
    }
    if (imgDir) {
      fs.mkdirSync(imgDir, { recursive: true });
      for (const row of rows) {
        if (!row.image) continue;
        const file = path.join(imgDir, row.sku.replace(/[^0-9a-z]+/gi, '') + '.jpg');
        try { if (!fs.existsSync(file)) fs.writeFileSync(file, await get(row.image + '?f=s', true)); row.image_file = path.relative(path.dirname(out), file); } catch (e) { if (e.stop) throw e; console.error('photo ' + row.sku + ': ' + e.message); }
      }
    }
  } catch (e) { if (!e.stop) throw e; console.error(e.message); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ store: 'ikea', locale, collected: new Date().toISOString().slice(0, 10), products: rows }, null, 1));
  console.log('Wrote ' + rows.length + ' products to ' + out + ' (' + fetched + ' pages read, ' + urls.length + ' product addresses in the sitemaps).');
  for (const k in stats) console.log('  ' + k + ': kept ' + stats[k].kept + ', left out ' + stats[k].skipped);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { rowFromHtml, kindOfUrl, KINDS };
