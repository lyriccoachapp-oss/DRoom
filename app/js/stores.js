'use strict';
/* Store connectors: product feeds from real stores are mapped onto the planner's categories and size slots.
   Nothing here fetches a store's site. A feed is a CSV or JSON file the store, its affiliate network or the
   user supplies; products from stores that are switched on replace the sample catalog wherever they fit. */
const Stores = (function () {
  const KEY = 'droom.stores.v1', MAX = 4000;
  const BUILTIN = {
    ikea: { name: 'IKEA', search: 'https://www.ikea.com/ca/en/search/?q=', dimUnit: 'cm' },
    homedepot: { name: 'The Home Depot', search: 'https://www.homedepot.ca/search?q=', dimUnit: 'in' },
    homedepotus: { name: 'The Home Depot US', search: 'https://www.homedepot.com/s/', dimUnit: 'in', currency: 'USD', enabled: false }
  };
  let stores = {}, products = [];
  function reset() {
    stores = {}; products = [];
    for (const id in BUILTIN) stores[id] = Object.assign({ id, enabled: true }, BUILTIN[id]);
    sync();
  }

  /* ---------- reading a feed ---------- */
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0], delim = ['\t', ';', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim())) rows.push(row); row = []; }
      else cell += ch;
    }
    row.push(cell); if (row.some(c => c.trim())) rows.push(row);
    if (rows.length < 2) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = (r[i] || '').trim(); }); return o; });
  }
  function parseFeed(text) {
    const t = String(text || '').trim();
    if (t[0] === '[' || t[0] === '{') {
      const j = JSON.parse(t), list = Array.isArray(j) ? j : j.products || j.items || j.data || [];
      if (!Array.isArray(list)) throw new Error('No product list in this JSON file.');
      return list.filter(x => x && typeof x === 'object');
    }
    return parseCsv(t);
  }
  /* Column names differ between feeds, so each field accepts the usual spellings. A unit in the name counts: "width_cm", "Depth (in)". */
  const ALIAS = {
    sku: ['sku', 'id', 'article', 'articlenumber', 'itemnumber', 'model', 'modelnumber', 'productid', 'partnumber'],
    name: ['name', 'title', 'productname', 'producttitle', 'description'],
    category: ['droomcategory', 'category', 'producttype', 'type', 'categoryname', 'breadcrumb', 'department', 'googleproductcategory'],
    price: ['saleprice', 'currentprice', 'price', 'regularprice', 'retailprice'],
    w: ['width', 'w', 'productwidth', 'assembledwidth'], d: ['depth', 'd', 'productdepth', 'assembleddepth', 'length', 'productlength'], h: ['height', 'h', 'productheight', 'assembledheight'],
    tw: ['tilewidth', 'plankwidth', 'piecewidth'], tl: ['tilelength', 'planklength', 'piecelength'],
    dims: ['dimensions', 'size', 'productdimensions'], unit: ['unit', 'dimunit', 'dimensionunit', 'units', 'sizeunit'],
    url: ['url', 'link', 'producturl', 'productlink', 'buyurl', 'deeplink'], image: ['image', 'imageurl', 'imagelink', 'thumbnail'], model3d: ['model3d', 'glb', 'modelglb3d', 'droommodel'],
    shape: ['shape'], deep: ['deepside', 'chaisedepth', 'deepsidedepth'],
    color: ['color', 'colour', 'finish'], style: ['style'], priceUnit: ['priceunit', 'soldby', 'unitofmeasure', 'uom'],
    coverage: ['coverage', 'coveragesqft', 'sqftperbox', 'sqftpercase', 'coverageperbox'], perSqft: ['pricepersqft', 'pricesqft', 'persqft']
  };
  const norm = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
  const UNIT_M = { cm: 0.01, mm: 0.001, m: 1, in: 0.0254, inch: 0.0254, inches: 0.0254, ft: 0.3048, feet: 0.3048 };
  function field(row, name) {
    const keys = Object.keys(row);
    for (const a of ALIAS[name]) for (const k of keys) {
      const n = norm(k); if (row[k] === '' || row[k] == null) continue;
      if (n === a) return { v: row[k], unit: null };
      if (name === 'w' || name === 'd' || name === 'h' || name === 'tw' || name === 'tl' || name === 'deep') for (const u of ['inches', 'inch', 'in', 'cm', 'mm', 'ft', 'm']) if (n === a + u) return { v: row[k], unit: u };
    }
    return null;
  }
  const num = v => { const m = String(v == null ? '' : v).replace(/,(?=\d{3}\b)/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
  const unitOf = s => { const m = String(s || '').toLowerCase().match(/\b(inches|inch|in|cm|mm|ft|feet|m)\b|(["″])/); return m ? (m[2] ? 'in' : m[1]) : null; };

  /* ---------- mapping onto the planner ---------- */
  /* First match wins, so the specific phrases come before the general ones. */
  const KEYWORDS = [
    [/wall ?paper|wall ?covering|wall mural/, 'wallpaper'], [/wall ?tiles?|backsplash|subway tile/, 'walltile'],
    [/toilet (seat|paper|brush)|range hood|bed(ding| sheet| linen| skirt)|shower (curtain|head|rod)|bath mat|lamp shade|table lamp|desk lamp/, null],
    [/night ?stand|bedside/, 'nightstand'], [/tv (stand|bench|unit|console)|media (console|unit|stand)/, 'tvstand'],
    [/coffee table/, 'coffee'], [/dining table|kitchen table/, 'dtable'], [/dining chair|kitchen chair/, 'dchair'],
    [/office chair|desk chair|swivel chair|task chair/, 'ochair'], [/kitchen island/, 'island'], [/\bdesks?\b/, 'desk'],
    [/arm ?chair|accent chair|recliner|lounge chair/, 'armchair'], [/sofa|couch|love ?seat|sectional/, 'sofa'],
    [/\brugs?\b/, 'rug'], [/floor lamp/, 'lamp'], [/book ?(case|shel)|shelving unit|shelf unit/, 'shelf'],
    [/wardrobe|armoire/, 'wardrobe'], [/dresser|chests? of drawers/, 'dresser'], [/sideboard|buffet/, 'sideboard'],
    [/linen (cabinet|tower)/, 'bathcab'], [/vanit(y|ies)/, 'vanity'], [/\btoilets?\b/, 'toilet'], [/bath ?tub|\btubs?\b/, 'tub'],
    [/shower (enclosure|kit|stall|cabin)|\bshowers\b/, 'shower'], [/\b(range|stove)s?\b/, 'range'], [/refrigerator|fridge/, 'fridge'],
    [/\bbeds?\b|bed frame/, 'bed'], [/(artificial|potted) plant|\bplants\b/, 'plant'],
    [/vinyl plank|laminate|hardwood|engineered wood|plank floor|\bflooring\b/, 'floor'], [/\btiles?\b/, 'tile'], [/\bpaints?\b/, 'paint']
  ];
  function mapCategory(text) {
    const t = ' ' + String(text || '').toLowerCase().replace(/[_>\/|,-]+/g, ' ') + ' ';
    if (CATS[t.trim()]) return t.trim();
    for (const k of KEYWORDS) if (k[0].test(t)) return k[1];
    return null;
  }
  /* The smallest layout size the product fits inside, so a real product never takes more room than the plan gave it. */
  function slotOf(cat, w, d, shape, deep) {
    const sizes = CATS[cat].sizes;
    /* An L-shaped sofa takes an L-shaped slot: long side, depth of the seat run, and how far the deep end reaches. */
    if (shape && deep > 0) { const si = sizes.findIndex(s => s[5] && s[5].cw && (shape === 'corner') === (s[5].cd > 2.2) && w <= s[0] * 1.03 + 0.02 && deep <= s[5].cd * 1.03 + 0.02); return si >= 0 ? { si, w, d: Math.min(d, sizes[si][1]), ext: { cw: sizes[si][5].cw, cd: deep } } : null; }
    const fits = (a, b) => sizes.findIndex(s => !(s[5] && s[5].cw) && a <= s[0] * 1.03 + 0.02 && b <= s[1] * 1.03 + 0.02);
    let si = fits(w, d); if (si >= 0) return { si, w, d };
    si = fits(d, w); return si >= 0 ? { si, w: d, d: w } : null;
  }
  const COLORS = [['anthracite', 0x3a3d42], ['charcoal', 0x4a4d52], ['dark gr[ae]y', 0x55585d], ['light gr[ae]y', 0xc9ccd0], ['gr[ae]y', 0x8d9196], ['off.?white|cream|ivory', 0xefe8da], ['white', 0xf2f1ed], ['black', 0x1f1f22],
    ['beige|sand|linen', 0xd9cbb4], ['walnut', 0x6b4a36], ['dark brown|espresso', 0x3d2a1b], ['brown', 0x7a5a40], ['oak|natural|birch|pine|bamboo', 0xd9bd94], ['navy', 0x2f3e5c], ['blue', 0x5f7fa3],
    ['green|sage', 0x7f9a82], ['red|burgundy', 0x8f3a34], ['yellow|mustard', 0xd2a941], ['pink|blush', 0xdbb1ad], ['orange|rust|terracotta', 0xb8663d]];
  function colorOf(s) { s = String(s || '').toLowerCase(); for (const c of COLORS) if (new RegExp('\\b(' + c[0] + ')\\b').test(s)) return c[1]; return null; }
  const STYLE_WORDS = [[/scandi|nordic|minimal/, 'scandi'], [/industrial|loft|rustic/, 'loft'], [/modern|contemporary/, 'modern']];
  function tierOf(cat, si, price) {
    let best = 0, gap = Infinity;
    for (let t = 0; t < 3; t++) { const g = Math.abs(Math.log(price / BYID[idOf(cat, 'scandi', t, si)].price)); if (g < gap) { gap = g; best = t; } }
    return best;
  }
  const safeUrl = u => /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null;
  /* A product 3D model: a web address or a .glb file published beside the app (models/sofa.glb). */
  const safeModel = u => { u = String(u || ''); return /^https:\/\/[^\s"'<>]+\.glb(\?[^\s"'<>]*)?$/i.test(u) || /^[a-z0-9_\-\/]+\.glb$/i.test(u) && !u.includes('..') ? u : null; };

  /* One feed row to a catalog item, or {skip: reason}. */
  function toItem(row, store) {
    const get = n => { const f = field(row, n); return f ? f.v : ''; };
    const name = String(get('name')).slice(0, 140), price = num(get('price'));
    if (!name) return { skip: 'no name' };
    const cat = mapCategory(get('category')) || mapCategory(name);
    if (!cat) return { skip: 'category not used by the planner' };
    if (cat === 'cabrun' || cat === 'uppers') return { skip: 'cabinet runs are not imported yet' };
    const C = CATS[cat], sku = String(get('sku') || name).slice(0, 60);
    const it = { id: 's:' + store.id + ':' + sku, store: store.id, supplier: store.name, sku, cat, name, url: safeUrl(get('url')), img: safeUrl(get('image')) };
    const m3 = safeModel(get('model3d')); if (m3) { it.model3d = m3; const rot = num(row.model3d_rot); if (isFinite(rot)) it.model3dRot = rot * Math.PI / 180; }
    /* Prices are shown as they are quoted; a store in another currency says so next to each price. */
    if (store.currency) it.currency = store.currency;
    if (C.area) {
      /* Flooring and tile are priced per square metre; feeds quote a square foot or a box. */
      const per = num(get('perSqft')), cov = num(get('coverage')), pu = String(get('priceUnit')).toLowerCase();
      let m2 = /box|case|carton|roll|piece/.test(pu) && cov > 0 && price > 0 ? price / cov * 10.7639 : per > 0 ? per * 10.7639 : /m2|m²|sq\.? ?m/.test(pu) ? price : /sq\.? ?ft|sqft|ft2|square f/.test(pu) ? price * 10.7639 : cov > 0 && price > 0 ? price / cov * 10.7639 : NaN;
      if (!(m2 > 0)) return { skip: 'no price per sq ft or coverage per box' };
      Object.assign(it, { price: Math.round(m2 * 100) / 100, si: 0, w: 0, d: 0, h: 0 });
      /* Size of one tile or plank and the floor one box covers, when the feed has them. */
      const fa = field(row, 'tw'), fb = field(row, 'tl');
      if (fa && fb) { const a = num(fa.v) * (UNIT_M[fa.unit || unitOf(fa.v) || store.dimUnit] || 0.0254), b = num(fb.v) * (UNIT_M[fb.unit || unitOf(fb.v) || store.dimUnit] || 0.0254); if (a > 0.01 && b > 0.01 && a < 4 && b < 4) { it.tw = Math.min(a, b); it.tl = Math.max(a, b); } }
      if (cov > 0) it.cover = Math.round(cov / 10.7639 * 1000) / 1000;
      if (/piece/.test(pu)) it.perPiece = true;
    } else {
      if (!(price > 0)) return { skip: 'no price' };
      it.price = Math.round(price * 100) / 100;
      if (C.unit) Object.assign(it, { si: 0, w: 0, d: 0, h: 0 });
      else {
        let w, d, h, unit = unitOf(get('unit'));
        const fw = field(row, 'w'), fd = field(row, 'd'), fh = field(row, 'h');
        if (fw && fd) { w = num(fw.v); d = num(fd.v); h = fh ? num(fh.v) : NaN; unit = unit || fw.unit || unitOf(fw.v) || unitOf(fd.v); }
        else { const s = String(get('dims')), m = s.match(/\d+(\.\d+)?/g); if (m && m.length >= 2) { w = +m[0]; d = +m[1]; h = m[2] ? +m[2] : NaN; unit = unit || unitOf(s); } }
        if (!(w > 0 && d > 0)) return { skip: 'no width and depth' };
        const k = UNIT_M[unit || store.dimUnit] || (Math.max(w, d) > 400 ? 0.001 : Math.max(w, d) > 12 ? (store.dimUnit === 'in' ? 0.0254 : 0.01) : 1);
        const fs = field(row, 'deep'), shp = /corner|chaise/.exec(String(get('shape')).toLowerCase());
        const slot = slotOf(cat, w * k, d * k, cat === 'sofa' && shp ? shp[0] : null, fs ? num(fs.v) * (UNIT_M[fs.unit] || k) : 0);
        if (!slot) return { skip: 'larger than the sizes the planner lays out' };
        Object.assign(it, { si: slot.si, w: slot.w, d: slot.d, h: h > 0 ? clamp(h * k, 0.01, 2.6) : C.sizes[slot.si][2] });
        if (slot.ext) it.ext = slot.ext;
      }
    }
    it.tier = tierOf(cat, it.si, it.price);
    const sw = String(get('style')).toLowerCase(), st = STYLE_WORDS.find(x => x[0].test(sw));
    /* Colours of one model at one size are variants of a single product. */
    const cut = name.split(' - '); if (cut.length > 1) { it.group = store.id + ':' + cut[0].toLowerCase() + '|' + Math.round(it.w * 100) + 'x' + Math.round(it.d * 100) + (it.ext ? 'L' : ''); it.variant = cut.slice(1).join(' - ').replace(/\s+\d+x\d+.*$/, '').slice(0, 40); }
    it.style = st ? st[1] : 'scandi'; it.anyStyle = !st; it.color = colorOf(get('color')) != null ? colorOf(get('color')) : colorOf(name);
    return { item: Object.assign(it, paletteOf(cat, it.style, it.tier, it.color)) };
  }

  /* ---------- the registry ---------- */
  /* Puts products of the stores that are switched on into the shared catalog, and takes the rest out. */
  function sync() {
    for (let i = CATALOG.length - 1; i >= 0; i--) if (CATALOG[i].store) { delete BYID[CATALOG[i].id]; CATALOG.splice(i, 1); }
    products.forEach(p => { if (stores[p.store] && stores[p.store].enabled && !BYID[p.id]) { CATALOG.push(p); BYID[p.id] = p; } });
  }
  /* Replaces a store's products with the rows of a feed. Returns {added, total, skipped: {reason: count}}. */
  function importFeed(storeId, text) {
    const store = stores[storeId]; if (!store) throw new Error('Unknown store.');
    const rows = parseFeed(text), skipped = {}, seen = new Set(), items = [];
    if (!rows.length) throw new Error('No product rows found. The file needs a header row and at least one product.');
    const room = MAX - products.filter(p => p.store !== storeId).length;
    rows.forEach(r => {
      const o = toItem(r, store), why = o.skip || (seen.has(o.item.id) ? 'duplicate SKU' : items.length >= room ? 'over the ' + MAX + ' product limit' : null);
      if (why) skipped[why] = (skipped[why] || 0) + 1; else { seen.add(o.item.id); items.push(o.item); }
    });
    products = products.filter(p => p.store !== storeId).concat(items); store.updated = new Date().toISOString().slice(0, 10);
    sync();
    return { added: items.length, total: rows.length, skipped };
  }
  function clear(storeId) { products = products.filter(p => p.store !== storeId); if (stores[storeId]) delete stores[storeId].updated; sync(); }
  function remove(storeId) { clear(storeId); if (!BUILTIN[storeId]) delete stores[storeId]; }
  function setEnabled(storeId, on) { if (stores[storeId]) { stores[storeId].enabled = !!on; sync(); } }
  function add(name, opts) {
    name = String(name || '').trim().slice(0, 40); if (!name) return null;
    let id = norm(name).slice(0, 20) || 'store', n = 2; const base = id; while (stores[id]) id = base + (n++);
    stores[id] = Object.assign({ id, name, enabled: true, dimUnit: 'in', custom: true }, opts || {});
    return id;
  }
  const list = () => Object.keys(stores).map(id => Object.assign({ count: products.filter(p => p.store === id).length }, stores[id]));
  /* Where to buy it: the feed's own link, else a search for the name on the store's site. */
  function linkOf(it) { const s = it && stores[it.store]; return !it || !it.store ? null : it.url || (s && s.search ? s.search + encodeURIComponent(it.name) : null); }

  /* The store product for a slot, or the sample one when no store that is switched on has a match.
     Budget tiers walk the matches from cheapest to dearest. A smaller product may fill a larger slot. */
  function pick(cat, style, tier, si) {
    let c = CATALOG.filter(p => p.store && p.cat === cat && p.si <= si);
    if (!c.length) return BYID[idOf(cat, style, tier, si)];
    const top = Math.max.apply(null, c.map(p => p.si)); c = c.filter(p => p.si === top);
    const m = c.filter(p => p.anyStyle || p.style === style); if (m.length) c = m;
    c.sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1));
    /* one entry per model, so twenty colours of one sofa do not crowd out the others */
    const seen = new Set(); c = c.filter(p => !p.group || (!seen.has(p.group) && seen.add(p.group)));
    return c[Math.round(tier * (c.length - 1) / 2)];
  }
  /* A product with no style of its own is drawn in the style of the home. */
  function styled(it, style) { return it && it.anyStyle && it.style !== style ? Object.assign({}, it, paletteOf(it.cat, style, it.tier, it.color), { style }) : it; }

  function save(storage) { try { storage.setItem(KEY, JSON.stringify({ stores, products })); return true; } catch (e) { return false; } }
  function load(storage) {
    reset();
    try {
      const s = JSON.parse(storage.getItem(KEY)); if (!s) return;
      for (const id in s.stores || {}) { const o = s.stores[id]; if (BUILTIN[id]) { stores[id].enabled = o.enabled !== false; if (o.updated) stores[id].updated = String(o.updated).slice(0, 10); } else if (o && o.name) stores[id] = { id, name: String(o.name).slice(0, 40), enabled: o.enabled !== false, dimUnit: o.dimUnit === 'cm' ? 'cm' : 'in', custom: true, updated: o.updated }; }
      products = (s.products || []).filter(p => p && stores[p.store] && CATS[p.cat] && p.price > 0 && CATS[p.cat].sizes[p.si] && STYLES[p.style] && p.tier >= 0 && p.tier < 3)
        .map(p => Object.assign(p, { url: safeUrl(p.url), img: safeUrl(p.img), model3d: safeModel(p.model3d) || undefined, supplier: stores[p.store].name }, paletteOf(p.cat, p.style, p.tier, p.color)));
    } catch (e) {}
    sync();
  }
  const TEMPLATE = 'sku,name,category,price,width,depth,height,unit,color,style,url,price_unit,coverage_sqft\n' +
    'EXAMPLE-001,Example 3-seat sofa,Sofas,899.00,84,36,33,in,grey,modern,https://example.com/p/001,,\n' +
    'EXAMPLE-002,Example oak vinyl plank,Flooring,54.90,,,,,oak,,https://example.com/p/002,box,23.6\n';
  /* A made-up store, so the import can be tried before a real feed is at hand. */
  const SAMPLE = 'sku,name,category,price,width,depth,height,unit,color,style,url\n' +
    'NF-1001,Harbour sofa 3-seat,Sofas,949,82,36,33,in,dark grey,,\nNF-1002,Harbour loveseat,Sofas,749,62,36,33,in,beige,,\nNF-1010,Tidewater armchair,Armchairs,389,31,32,31,in,navy,,\n' +
    'NF-1020,Dory coffee table,Coffee tables,179,39,21,16,in,oak,,\nNF-1030,Lookoff TV stand,TV stands,259,59,16,20,in,walnut,,\nNF-1031,Lookoff TV stand wide,TV stands,319,70,16,20,in,walnut,,\n' +
    'NF-1040,Fundy bookcase,Bookcases,199,31,12,74,in,white,,\nNF-1050,Cove queen bed,Beds,629,65,83,40,in,oak,,\nNF-1051,Cove king bed,Beds,779,74,83,40,in,oak,,\n' +
    'NF-1060,Cove nightstand,Nightstands,119,18,16,20,in,oak,,\nNF-1070,Signal wardrobe 2-door,Wardrobes,549,47,23,82,in,white,,\nNF-1080,Signal dresser,Dressers,329,39,18,33,in,white,,\n' +
    'NF-1090,Wharf dining table,Dining tables,499,63,35,30,in,walnut,,\nNF-1091,Wharf dining chair,Dining chairs,89,18,20,35,in,black,,\nNF-1100,Ketch desk,Desks,279,55,27,30,in,white,,\n' +
    'NF-1110,Area rug 5 x 7,Rugs,169,84,60,0.5,in,beige,,\nNF-1120,Bath vanity 36 in,Vanities,459,36,20,34,in,white,,\n';

  reset();
  /* Products a project file brings along: each joins its store (a store the browser does not have yet is added by name)
     unless a feed already supplies it. Returns how many were added. */
  function ensure(list) {
    let n = 0;
    (list || []).forEach(p => {
      if (!p || typeof p.id !== 'string' || !p.store || !CATS[p.cat] || !(p.price > 0) || !CATS[p.cat].sizes[p.si] || !STYLES[p.style] || !(p.tier >= 0 && p.tier < 3)) return;
      if (products.some(q => q.id === p.id)) return;
      if (!stores[p.store]) stores[p.store] = { id: String(p.store).slice(0, 24), name: String(p.supplier || p.store).slice(0, 40), enabled: true, dimUnit: 'in', custom: true };
      products.push(Object.assign({}, p, { url: safeUrl(p.url), img: safeUrl(p.img), model3d: safeModel(p.model3d) || undefined, supplier: stores[p.store].name }, paletteOf(p.cat, p.style, p.tier, p.color))); n++;
    });
    sync(); return n;
  }
  return { ensure, parseFeed, toItem, mapCategory, slotOf, importFeed, clear, remove, add, setEnabled, list, linkOf, pick, styled, save, load, reset, TEMPLATE, SAMPLE };
})();
/* A short label for where an item comes from: the store, or the sample style and price tier. */
function itemTag(it) { return it.store ? it.supplier + (it.currency ? ' \u00b7 prices in ' + it.currency : '') : STYLES[it.style].name + ' · ' + TIERS[it.tier].name; }
