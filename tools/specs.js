'use strict';
/* Reads finishing-material facts out of a product title and its specification table:
   what it is, the size of one piece, how much a box covers, colour and finish.
   Pure functions, shared by the collectors and their tests. */

const UNIT_IN = { in: 1, inch: 1, inches: 1, '"': 1, ft: 12, feet: 12, foot: 12, mm: 1 / 25.4, cm: 1 / 2.54, m: 39.3701 };
/* "7-1/8", "7 1/8", "3/8", "12.5" -> number */
function fraction(s) {
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)?(?:[\s-]+)?(?:(\d+)\s*\/\s*(\d+))?$/);
  if (!m || (m[1] == null && m[2] == null)) return NaN;
  return (m[1] ? parseFloat(m[1]) : 0) + (m[2] ? m[2] / m[3] : 0);
}
const NUM = '(\\d+\\s*\\/\\s*\\d+|\\d+(?:\\.\\d+)?(?:[\\s-]+\\d+\\s*\\/\\s*\\d+)?)';
const UNIT = '(inches|inch|in|feet|foot|ft|mm|cm|m|")';
/* One length with an optional unit, in inches. `fallback` is the unit to assume when none is written. */
function inches(text, fallback) {
  const m = String(text == null ? '' : text).toLowerCase().match(new RegExp(NUM + '\\s*-?\\s*' + UNIT + '?(?![a-z])'));
  if (!m) return NaN;
  const v = fraction(m[1]), u = m[2] || fallback || 'in';
  return v * (UNIT_IN[u] || 1);
}
/* "12 in. x 24 in.", "7.1-inch W x 48-inch L", "300 x 600 mm" -> [a, b] in inches */
function pairFromText(text) {
  const re = new RegExp(NUM + '\\s*-?\\s*' + UNIT + '?\\.?\\s*(?:w|l|wide|long|width|length)?\\.?\\s*[x×]\\s*' + NUM + '\\s*-?\\s*' + UNIT + '?(?![a-z])', 'i');
  /* A title may lead with the thickness ("6.5mm x 7.5 in. W x 47.6 in. L"); the first pair with both sides over an inch is the face. */
  const t = String(text || '').toLowerCase(), g = new RegExp(re.source, 'gi');
  let m;
  while ((m = g.exec(t))) {
    const u2 = m[4], u1 = m[2] || u2 || 'in', a = fraction(m[1]) * (UNIT_IN[u1] || 1), b = fraction(m[3]) * (UNIT_IN[u2 || u1] || 1);
    if (a >= 1 && b >= 1) return [a, b];
    g.lastIndex = m.index + 1;
  }
  return null;
}
const round = (v, n) => Math.round(v * Math.pow(10, n)) / Math.pow(10, n);

/* What the product is, for the planner: 'tile' (floor), 'walltile', 'floor' (plank and sheet flooring), 'wallpaper', 'paint'. */
function kindOf(title, specs) {
  const t = ' ' + String(title || '').toLowerCase() + ' ', all = t + ' ' + specs.map(s => s.name + ' ' + s.value).join(' ').toLowerCase();
  if (/grout|adhesive|mortar|thinset|underlay|trim|transition|moulding|molding|sealer|cleaner|spacer|primer|brush|roller|sample/.test(t)) return null;
  /* Shower and tub wall kits are panels, not tile. */
  if (/\bkit\b|surround|wall panel|shower wall|backer ?board/.test(t)) return null;
  /* Sold by the pallet, hundreds of square feet at a time: not a room's worth. */
  if (/pallet/.test(t)) return null;
  if (/wall ?paper|wall ?covering|wall mural/.test(t)) return 'wallpaper';
  if (/\bpaint\b/.test(t) && !/spray|marker|pen\b/.test(t)) return 'paint';
  if (/\btiles?\b|mosaic|porcelain|ceramic/.test(t)) {
    const use = (specs.find(s => /tile use|application|recommended (use|location)|approved use|suitable/i.test(s.name)) || {}).value || '';
    const floorOk = /floor/i.test(use) || /floor/.test(t), wallOnly = (/wall|backsplash/i.test(use) && !/floor/i.test(use)) || (/wall tile|backsplash|subway/.test(t) && !/floor/.test(t));
    if (/peel|ceiling/.test(t) && !floorOk) return 'walltile';
    return wallOnly && !floorOk ? 'walltile' : 'tile';
  }
  if (/vinyl|laminate|hardwood|engineered|bamboo|cork|plank|flooring/.test(t) || /flooring/.test(all.slice(0, 400))) return 'floor';
  return null;
}
const find = (specs, re, not) => { const s = specs.find(x => re.test(x.name) && !(not && not.test(x.name))); return s ? s.value : null; };

/* title + [{name, value}] -> facts about a finishing material, or null when it is not one. Lengths in inches, coverage in sq ft. */
function parseMaterial(title, specs) {
  specs = (specs || []).filter(s => s && s.name && s.value != null).map(s => ({ name: String(s.name), value: String(s.value) }));
  const kind = kindOf(title, specs);
  if (!kind) return null;
  const out = { kind };
  const unitIn = name => { const m = String(name).toLowerCase().match(/\((in|inch|inches|ft|mm|cm|m)\.?\)/); return m ? m[1] : null; };
  const len = re => { const s = specs.find(x => re.test(x.name) && !/package|box|case|carton|roll|pallet|shipping/i.test(x.name)); return s ? inches(s.value, unitIn(s.name)) : NaN; };
  let w = len(/^(actual |nominal |product |tile |plank |piece |assembled )*width\b/i), l = len(/^(actual |nominal |product |tile |plank |piece |assembled )*(length|depth)\b/i);
  if (!(w > 0 && l > 0)) { const p = pairFromText(find(specs, /size|dimension/i) || '') || pairFromText(title); if (p) { w = p[0]; l = p[1]; } }
  if (w > 0 && l > 0) { out.width_in = round(Math.min(w, l), 2); out.length_in = round(Math.max(w, l), 2); }
  const th = len(/thickness/i); if (th > 0) out.thickness_in = round(th, 3);
  /* Coverage of one box, case or roll. */
  const cov = specs.find(x => /coverage|sq(uare|\.)? ?(ft|feet|foot).*(case|box|carton|roll|package)|(case|box|carton|roll|package).*sq(uare|\.)? ?(ft|feet|foot)/i.test(x.name));
  if (cov) { const v = parseFloat(String(cov.value).replace(/,/g, '')); if (v > 0) out.coverage_sqft = round(/m2|m²|sq\.? ?m\b|square met/i.test(cov.name + ' ' + cov.value) ? v * 10.7639 : v, 2); }
  const pcs = find(specs, /(pieces|tiles|planks|pcs).*(case|box|carton|package)|number of pieces/i); if (pcs && parseInt(pcs, 10) > 0) out.pieces_per_box = parseInt(pcs, 10);
  /* Home Depot Canada puts the box coverage in the title: "(15.5 sq.ft. / case)", "56 sq. ft. Pre-Pasted Wallpaper". */
  if (!out.coverage_sqft) { const c = String(title || '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*sq\.?\s*f(?:ee)?t\.?/); if (c && parseFloat(c[1]) > 0) { out.coverage_sqft = parseFloat(c[1]); out.coverage_from_title = true; } }
  if (!out.coverage_sqft && out.pieces_per_box && out.width_in) out.coverage_sqft = round(out.pieces_per_box * out.width_in * out.length_in / 144, 2);
  if (kind === 'wallpaper' && !out.coverage_sqft) { const rw = len(/roll width/i) || w, rl = inches(find(specs, /roll length/i) || '', 'ft') || l; if (rw > 0 && rl > 0) out.coverage_sqft = round(rw * rl / 144, 2); }
  const text = (re, not) => { const v = find(specs, re, not); return v ? v.trim().slice(0, 60) : undefined; };
  out.color = text(/^(colou?r family|colou?r\/finish family|colou?r|shade)\b/i);
  out.finish = text(/finish|surface|sheen|gloss/i, /colou?r/i);
  out.material = text(/^(material|tile material|flooring material|product type|type)\b/i);
  out.look = text(/look|pattern|design|style/i);
  const use = text(/tile use|application|recommended (use|location)|approved use/i); if (use) out.use = use;
  return out;
}

module.exports = { fraction, inches, pairFromText, kindOf, parseMaterial };
