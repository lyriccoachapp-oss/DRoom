'use strict';
/* Fills Canadian Home Depot rows with the specifications of the same model on the US site.
   Canadian results carry no specification table, so thickness, finish, material, colour and the true box coverage are
   taken from the US row with the same model number. Canadian price, link and photo stay; the US price is kept beside it.

     node tools/merge-homedepot.js catalog/homedepot-ca.json catalog/homedepot-us.json catalog/homedepot-ca.json */
const fs = require('fs');

const SPEC = ['thickness_in', 'pieces_per_box', 'color', 'finish', 'material', 'look', 'use'];
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function merge(ca, us) {
  const byModel = new Map(us.filter(p => p.model).map(p => [norm(p.model), p]));
  let matched = 0, coverage = 0;
  const rows = ca.map(p => {
    const u = p.model && byModel.get(norm(p.model));
    if (!u) return p;
    matched++;
    const o = Object.assign({}, p, { price_usd: u.price, url_us: u.url, specs_from: 'us' });
    SPEC.forEach(k => { if (o[k] == null && u[k] != null) o[k] = u[k]; });
    if (!o.tile_width_in && u.tile_width_in) { o.tile_width_in = u.tile_width_in; o.tile_length_in = u.tile_length_in; }
    /* A Canadian roll or box whose coverage was assumed takes the US figure, and its price per area is worked out again. */
    if (o.coverage_assumed && u.coverage_sqft > 0 && !u.coverage_assumed) {
      o.coverage_sqft = u.coverage_sqft; delete o.coverage_assumed; o.price_per_sqft = Math.round(o.price / o.coverage_sqft * 100) / 100; coverage++;
    }
    return o;
  });
  return { rows, matched, coverage };
}

if (require.main === module) {
  const [caFile, usFile, out] = process.argv.slice(2);
  if (!caFile || !usFile) { console.error('Usage: node tools/merge-homedepot.js CA.json US.json [OUT.json]'); process.exit(1); }
  const ca = JSON.parse(fs.readFileSync(caFile, 'utf8')), us = JSON.parse(fs.readFileSync(usFile, 'utf8'));
  const r = merge(ca.products, us.products);
  fs.writeFileSync(out || caFile, JSON.stringify(Object.assign({}, ca, { products: r.rows }), null, 1));
  console.log('Canadian rows ' + ca.products.length + ', matched on the US site ' + r.matched + ', coverage corrected ' + r.coverage + '.');
}
module.exports = { merge };
