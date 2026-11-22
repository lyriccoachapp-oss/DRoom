'use strict';
/* Construction drawing: a clean, dimensioned floor plan built from the rooms, with doors, windows, plumbing fixtures,
   the drain routes and the panel from the takeoff. Drawn with inline attributes only, so the SVG can be saved as a file. */
const BuildDrawing = (function () {
  const NS = 'http://www.w3.org/2000/svg', S = 100, FONT = 'Arial, Helvetica, sans-serif';
  const LIGHT = { paper: '#FFFFFF', ink: '#151B21', muted: '#5A6471', faint: '#C9CED4', water: '#1F6FB5', power: '#A86A00' };
  const FIX = { toilet: 'WC', vanity: 'LAV', tub: 'TUB', shower: 'SHWR', cabrun: 'KITCHEN', range: 'RANGE', fridge: 'REF', island: 'ISLAND' };
  function el(name, attrs, parent, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function cssPalette() {
    const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return { paper: v('--plan-room') || LIGHT.paper, ink: v('--ink') || LIGHT.ink, muted: v('--muted') || LIGHT.muted, faint: v('--line') || LIGHT.faint, water: v('--plan-win') || LIGHT.water, power: v('--sun') || LIGHT.power };
  }
  function draw(svg, plans, t, pal, date) {
    pal = pal || cssPalette();
    svg.textContent = '';
    if (!plans.length) { svg.setAttribute('viewBox', '0 0 600 400'); el('text', { x: 300, y: 200, 'text-anchor': 'middle', 'font-family': FONT, 'font-size': 22, fill: pal.muted }, svg, 'Add rooms on the Plan tab to get a drawing'); return; }
    const bb = homeBox(plans), ML = 1.7, MT = 1.7, MR = 0.9, MB = 2.1;
    const vx = (bb.x0 - ML) * S, vy = (bb.z0 - MT) * S, vw = (bb.x1 - bb.x0 + ML + MR) * S, vh = (bb.z1 - bb.z0 + MT + MB) * S;
    svg.setAttribute('viewBox', [vx, vy, vw, vh].join(' '));
    el('rect', { x: vx, y: vy, width: vw, height: vh, fill: pal.paper }, svg);
    const txt = (x, y, s, size, o) => el('text', Object.assign({ x, y, 'font-family': FONT, 'font-size': size, fill: pal.ink, 'text-anchor': 'middle' }, o || {}), svg, s);
    const ln = (x1, y1, x2, y2, o) => el('line', Object.assign({ x1, y1, x2, y2, stroke: pal.ink, 'stroke-width': 2 }, o || {}), svg);

    /* fixtures first, so walls sit on top of them */
    plans.forEach(pl => pl.placed.forEach(q => {
      if (!FIX[q.cat]) return;
      const x = (pl.room.x + q.cx - q.hx) * S, y = (pl.room.y + q.cz - q.hz) * S, w = q.hx * 2 * S, h = q.hz * 2 * S;
      el('rect', { x, y, width: w, height: h, rx: 4, fill: 'none', stroke: pal.muted, 'stroke-width': 2 }, svg);
      if (q.cat === 'toilet') el('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: Math.min(w, h) * 0.32, ry: Math.min(w, h) * 0.4, fill: 'none', stroke: pal.muted, 'stroke-width': 2 }, svg);
      if (Math.min(w, h) > 38) txt(x + w / 2, y + h / 2 + 4, FIX[q.cat], 12, { fill: pal.muted });
    }));
    /* drains: dashed, heavier for bigger pipe */
    const P = t.plumbing;
    P.routes.forEach(r => el('polyline', { points: r.pts.map(p => (p[0] * S) + ',' + (p[1] * S)).join(' '), fill: 'none', stroke: pal.water, 'stroke-width': r.size * 2, 'stroke-dasharray': '14 9', 'stroke-linejoin': 'round' }, svg));
    /* walls */
    t.runs.forEach(r => {
      const h = r.o === 'h';
      ln((h ? r.a : r.c) * S, (h ? r.c : r.a) * S, (h ? r.b : r.c) * S, (h ? r.c : r.b) * S, { 'stroke-width': r.ext ? 16 : 11, 'stroke-linecap': 'square' });
    });
    /* openings */
    plans.forEach(pl => {
      const o = pl.room, r = pl.r, pt = (w, tt, off) => { const p = wallPoint(r, w, tt), n = WALLS[w].n; return [(o.x + p[0] + n[0] * (off || 0)) * S, (o.y + p[1] + n[1] * (off || 0)) * S]; };
      const d = r.door, a = pt(d.wall, d.t - d.width / 2), b = pt(d.wall, d.t + d.width / 2);
      ln(a[0], a[1], b[0], b[1], { stroke: pal.paper, 'stroke-width': 20 });
      if (d.type === 'swing') {
        const left = d.side === 'left', hinge = left ? d.t - d.width / 2 : d.t + d.width / 2, dir = left ? 1 : -1, s = d.swing === 'in' ? 1 : -1, arc = [];
        for (let k = 0; k <= 12; k++) { const th = Math.PI / 2 * k / 12; arc.push(pt(d.wall, hinge + dir * d.width * Math.cos(th), s * d.width * Math.sin(th))); }
        const hp = pt(d.wall, hinge), tip = arc[arc.length - 1];
        ln(hp[0], hp[1], tip[0], tip[1], { 'stroke-width': 3 });
        el('polyline', { points: arc.map(p => p.join(',')).join(' '), fill: 'none', stroke: pal.muted, 'stroke-width': 1.5 }, svg);
      } else if (d.type === 'pocket' || d.type === 'barn') {
        const left = d.side === 'left', off = d.type === 'barn' ? 0.12 : 0, p1 = pt(d.wall, left ? d.t - d.width * 1.5 : d.t + d.width / 2, off), p2 = pt(d.wall, left ? d.t - d.width / 2 : d.t + d.width * 1.5, off);
        ln(p1[0], p1[1], p2[0], p2[1], { 'stroke-width': 3, 'stroke-dasharray': d.type === 'pocket' ? '8 6' : '' });
      }
      const w = r.win, wa = pt(w.wall, w.t - 0.7), wb = pt(w.wall, w.t + 0.7);
      ln(wa[0], wa[1], wb[0], wb[1], { stroke: pal.paper, 'stroke-width': 20 });
      [-0.05, 0, 0.05].forEach(k => { const p1 = pt(w.wall, w.t - 0.7, k), p2 = pt(w.wall, w.t + 0.7, k); ln(p1[0], p1[1], p2[0], p2[1], { 'stroke-width': 1.5 }); });
    });
    /* stack, sewer exit and panel */
    if (P.stack) {
      el('circle', { cx: P.stack[0] * S, cy: P.stack[1] * S, r: 9, fill: pal.paper, stroke: pal.water, 'stroke-width': 3 }, svg);
      txt(P.exit[0] * S, P.exit[1] * S + (P.exit[1] >= bb.z1 - 1e-6 ? 34 : P.exit[1] <= bb.z0 + 1e-6 ? -22 : 4), P.main + '" TO SEWER', 13, { fill: pal.water, 'font-weight': 700, 'text-anchor': P.exit[0] <= bb.x0 + 1e-6 ? 'end' : P.exit[0] >= bb.x1 - 1e-6 ? 'start' : 'middle', dx: P.exit[0] <= bb.x0 + 1e-6 ? -14 : P.exit[0] >= bb.x1 - 1e-6 ? 14 : 0 });
    }
    const E = t.electrical;
    if (E.panel) {
      const px = E.panel[0] * S, py = E.panel[1] * S;
      el('rect', { x: px - 16, y: py - 16, width: 32, height: 32, fill: pal.power, stroke: pal.ink, 'stroke-width': 2 }, svg);
      txt(px, py + 5, 'P', 15, { 'font-weight': 700 });
    }
    /* room labels */
    plans.forEach(pl => {
      const o = pl.room, q = maxRects(pl.r)[0], cx = (o.x + (q.x0 + q.x1) / 2) * S, cy = (o.y + (q.z0 + q.z1) / 2) * S, f = clamp(Math.min(q.x1 - q.x0, q.z1 - q.z0) * S * 0.085, 13, 25);
      const back = el('rect', { fill: pal.paper, opacity: 0.82, rx: 4 }, svg), nameW = o.name.length * f * 0.62 + 16, dimsT = fmtLen(o.W) + ' × ' + fmtLen(o.D), w = Math.max(nameW, dimsT.length * f * 0.46 + 16);
      back.setAttribute('x', cx - w / 2); back.setAttribute('y', cy - f * 1.5); back.setAttribute('width', w); back.setAttribute('height', f * 3.5);
      txt(cx, cy - f * 0.35, o.name.toUpperCase(), f, { 'font-weight': 700 });
      txt(cx, cy + f * 0.75, dimsT, f * 0.78, { fill: pal.muted });
      txt(cx, cy + f * 1.7, fmtArea(pl.r.area), f * 0.78, { fill: pal.muted });
    });
    /* dimension chains along the top and the left, with the overall size outside them */
    const dimH = (x1, x2, y, big) => { ln(x1 * S, y * S, x2 * S, y * S, { 'stroke-width': 1.5 }); [x1, x2].forEach(x => { ln(x * S, y * S - 9, x * S, y * S + 9, { 'stroke-width': 1.5 }); ln(x * S - 6, y * S + 6, x * S + 6, y * S - 6, { 'stroke-width': 2.5 }); }); if (x2 - x1 > 0.55) txt((x1 + x2) / 2 * S, y * S - 9, fmtLen(x2 - x1), big ? 19 : 15, big ? { 'font-weight': 700 } : {}); };
    const dimV = (z1, z2, x, big) => { ln(x * S, z1 * S, x * S, z2 * S, { 'stroke-width': 1.5 }); [z1, z2].forEach(z => { ln(x * S - 9, z * S, x * S + 9, z * S, { 'stroke-width': 1.5 }); ln(x * S - 6, z * S + 6, x * S + 6, z * S - 6, { 'stroke-width': 2.5 }); }); if (z2 - z1 > 0.55) { const cx = x * S - 9, cy = (z1 + z2) / 2 * S; txt(cx, cy, fmtLen(z2 - z1), big ? 19 : 15, Object.assign({ transform: 'rotate(-90 ' + cx + ' ' + cy + ')' }, big ? { 'font-weight': 700 } : {})); } };
    const uniq = a => Array.from(new Set(a.map(v => Math.round(v * 100) / 100))).sort((x, y) => x - y);
    const xs = uniq(t.runs.filter(r => r.o === 'v').map(r => r.c).concat([bb.x0, bb.x1])), zs = uniq(t.runs.filter(r => r.o === 'h').map(r => r.c).concat([bb.z0, bb.z1]));
    for (let i = 0; i < xs.length - 1; i++) dimH(xs[i], xs[i + 1], bb.z0 - 0.6);
    for (let i = 0; i < zs.length - 1; i++) dimV(zs[i], zs[i + 1], bb.x0 - 0.6);
    dimH(bb.x0, bb.x1, bb.z0 - 1.2, true); dimV(bb.z0, bb.z1, bb.x0 - 1.2, true);
    /* title block and legend */
    const ty = (bb.z1 + 0.75) * S, tx = bb.x0 * S, tw = (bb.x1 - bb.x0) * S;
    el('rect', { x: tx, y: ty, width: tw, height: 110, fill: 'none', stroke: pal.ink, 'stroke-width': 2 }, svg);
    txt(tx + 14, ty + 34, 'FLOOR PLAN', 24, { 'text-anchor': 'start', 'font-weight': 700 });
    txt(tx + 14, ty + 60, plans.length + (plans.length === 1 ? ' room' : ' rooms') + ' · ' + fmtArea(t.area) + ' · walls ' + t.opt.height + ' ft · studs at ' + t.opt.spacing + ' in', 15, { 'text-anchor': 'start', fill: pal.muted });
    txt(tx + 14, ty + 86, 'Outside walls ' + fmtLen(t.ext) + ' · inside walls ' + fmtLen(t.int) + ' · dashed blue: drains · P: electrical panel', 13, { 'text-anchor': 'start', fill: pal.muted });
    txt(tx + tw - 14, ty + 34, 'DRoom', 20, { 'text-anchor': 'end', 'font-weight': 700 });
    txt(tx + tw - 14, ty + 60, date || '', 14, { 'text-anchor': 'end', fill: pal.muted });
    txt(tx + tw - 14, ty + 86, 'Preliminary. Not for construction.', 13, { 'text-anchor': 'end', fill: pal.muted });
  }
  /* The drawing as a standalone SVG file, always on white paper. */
  function toSvgText(plans, t, date) {
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('xmlns', NS);
    draw(svg, plans, t, LIGHT, date);
    const vb = svg.getAttribute('viewBox').split(' ').map(Number); svg.setAttribute('width', Math.round(vb[2])); svg.setAttribute('height', Math.round(vb[3]));
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  }
  return { draw, toSvgText };
})();
