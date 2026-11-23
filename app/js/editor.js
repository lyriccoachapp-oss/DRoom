'use strict';
/* 2D plan editor (SVG). Drag a room to move it, the corner handle to resize it, and the door or window marker along the walls. */
const PlanEditor = (function () {
  const NS = 'http://www.w3.org/2000/svg', S = 100, MIN = 1.6, MAX = 12;
  let svg, get, onChange, onSelect, drag = null, fitted = false, cal = null;
  const snap = v => Math.round(v * 10) / 10;
  function el(name, attrs, parent, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function init(node, getter, changeCb, selectCb) {
    svg = node; get = getter; onChange = changeCb; onSelect = selectCb;
    svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  }
  function world(e) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse()); return { x: p.x / S, y: p.y / S };
  }
  function fit(rooms) {
    let x0 = 0, y0 = 0, x1 = 6, y1 = 4;
    const tr = get().trace;
    if (rooms.length || tr) { x0 = y0 = Infinity; x1 = y1 = -Infinity; rooms.forEach(o => { x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x + o.W); y1 = Math.max(y1, o.y + o.D); }); }
    if (tr) { x0 = Math.min(x0, 0); y0 = Math.min(y0, 0); x1 = Math.max(x1, tr.width); y1 = Math.max(y1, tr.width / tr.aspect); }
    const pad = 1.4;
    svg.setAttribute('viewBox', [(x0 - pad) * S, (y0 - pad) * S, (x1 - x0 + pad * 2) * S, (y1 - y0 + pad * 2) * S].join(' '));
    fitted = true;
  }
  /* World-space end points of an opening of width `wd` centred at t on wall w. */
  function opening(o, r, w, t, wd) {
    const a = wallPoint(r, w, t - wd / 2), b = wallPoint(r, w, t + wd / 2), c = wallPoint(r, w, t);
    return { x1: (o.x + a[0]) * S, y1: (o.y + a[1]) * S, x2: (o.x + b[0]) * S, y2: (o.y + b[1]) * S, cx: (o.x + c[0]) * S, cy: (o.y + c[1]) * S };
  }
  /* Plan symbol for the door, drawn the way architectural plans show it. */
  function doorSymbol(o, r, g) {
    const dr = r.door, w = dr.width, n = WALLS[dr.wall].n, hz = WALLS[dr.wall].horiz, along = hz ? [1, 0] : [0, 1], left = dr.side === 'left';
    const P = (t, off) => { const p = wallPoint(r, dr.wall, t); return [(o.x + p[0] + n[0] * off) * S, (o.y + p[1] + n[1] * off) * S]; };
    const t0 = dr.t - w / 2, t1 = dr.t + w / 2;
    if (dr.type === 'swing') {
      /* Leaf drawn fully open, plus the quarter circle its edge sweeps. */
      const hinge = left ? t0 : t1, a = left ? 1 : -1, s = dr.swing === 'in' ? 1 : -1, pts = [];
      for (let k = 0; k <= 12; k++) {
        const th = Math.PI / 2 * k / 12, lt = hinge + a * w * Math.cos(th), off = s * w * Math.sin(th);
        pts.push(P(lt, off));
      }
      const h = P(hinge, 0), tip = pts[pts.length - 1];
      el('line', { x1: h[0], y1: h[1], x2: tip[0], y2: tip[1], class: 'leaf' }, g);
      el('polyline', { points: pts.map(p => p.join(',')).join(' '), class: 'swingarc' }, g);
    } else if (dr.type === 'pocket') {
      const a = left ? P(t0 - w, 0.03) : P(t1, 0.03), b = left ? P(t0 + 0.15 * w, 0.03) : P(t1 + w, 0.03);
      el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'leaf pocket' }, g);
    } else if (dr.type === 'barn') {
      const a = left ? P(t0 - w, 0.1) : P(t1 - 0.04, 0.1), b = left ? P(t0 + 0.04, 0.1) : P(t1 + w, 0.1);
      el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'leaf barn' }, g);
    }
  }
  function render() {
    const st = get();
    if (!drag || !fitted) fit(st.rooms);
    svg.textContent = '';
    const defs = el('defs', {}, svg), pat = el('pattern', { id: 'grid', width: S, height: S, patternUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M ' + S + ' 0 L 0 0 0 ' + S, class: 'gridline' }, pat);
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    el('rect', { x: vb[0], y: vb[1], width: vb[2], height: vb[3], fill: 'url(#grid)' }, svg);
    if (st.trace) el('image', { href: st.trace.src, x: 0, y: 0, width: st.trace.width * S, height: st.trace.width / st.trace.aspect * S, opacity: st.trace.opacity, preserveAspectRatio: 'none', 'pointer-events': 'none' }, svg);
    if (!st.rooms.length) { el('text', { x: vb[0] + vb[2] / 2, y: vb[1] + vb[3] / 2, class: 'hintText', 'text-anchor': 'middle' }, svg, st.trace ? 'Detect rooms or add them by hand' : 'Add a room to start'); drawCal(); return; }
    st.rooms.forEach((o, i) => {
      const pl = st.plans[i], on = o.id === st.roomId, g = el('g', { class: 'rm' + (on ? ' on' : '') + (st.clash && st.clash.has(o.id) ? ' clash' : '') }, svg);
      el('path', { d: 'M ' + roomPolygon(o).map(p => ((o.x + p[0]) * S) + ' ' + ((o.y + p[1]) * S)).join(' L ') + ' Z', class: 'room', 'data-act': 'move', 'data-room': o.id }, g);
      /* Floor kept free in front of doors and drawers, and where a neighbouring room's door opens onto this one. */
      if (pl) pl.placed.filter(q => q.clear && (q.cat === 'wardrobe' || q.cat === 'dresser' || q.cat === 'fridge' || q.cat === 'range')).map(q => q.clear).concat(pl.r.keepClear.filter(z => z.foreign)).forEach(z => el('rect', { x: (o.x + z.cx - z.hx) * S, y: (o.y + z.cz - z.hz) * S, width: z.hx * 2 * S, height: z.hz * 2 * S, class: 'clr' }, g));
      if (pl) pl.placed.filter(q => q.cat !== 'uppers').sort((a, b) => (b.flat ? 1 : 0) - (a.flat ? 1 : 0)).forEach(q => el('rect', { x: (o.x + q.cx - q.hx) * S, y: (o.y + q.cz - q.hz) * S, width: q.hx * 2 * S, height: q.hz * 2 * S, rx: 6, class: 'furn' + (q.flat ? ' rug' : '') + (st.sel && st.sel.roomId === o.id && st.sel.cat === q.cat ? ' sel' : '') }, g));
      if (pl) {
        const d = opening(o, pl.r, pl.r.door.wall, pl.r.door.t, pl.r.door.width + 0.04), w = opening(o, pl.r, pl.r.win.wall, pl.r.win.t, 1.4);
        el('line', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, class: 'door' }, g);
        doorSymbol(o, pl.r, g);
        el('line', { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, class: 'win' }, g);
        if (on) {
          el('circle', { cx: d.cx, cy: d.cy, r: 16, class: 'grip', 'data-act': 'door', 'data-room': o.id }, g);
          el('circle', { cx: w.cx, cy: w.cy, r: 16, class: 'grip win', 'data-act': 'win', 'data-room': o.id }, g);
          /* The resize handle sits on the south-east corner, or beside the notch when the notch takes that corner. */
          const c = cutOf(o), rz = c && c.corner === 'SE' ? [o.x + c.x0, o.y + o.D] : [o.x + o.W, o.y + o.D];
          el('rect', { x: rz[0] * S - 18, y: rz[1] * S - 18, width: 36, height: 36, rx: 6, class: 'grip size', 'data-act': 'resize', 'data-room': o.id }, g);
          if (c) {
            const ix = o.x + (c.x0 === 0 ? c.x1 : c.x0), iz = o.y + (c.z0 === 0 ? c.z1 : c.z0);
            el('rect', { x: ix * S - 15, y: iz * S - 15, width: 30, height: 30, rx: 15, class: 'grip notch', 'data-act': 'notch', 'data-room': o.id }, g);
          }
        }
      }
      const lab = el('text', { x: o.x * S - 6, y: o.y * S - 22, class: 'rname' }, g, o.name + '  ');
      el('tspan', { class: 'rsize' }, lab, fmtLen(o.W) + ' \u00d7 ' + fmtLen(o.D));
    });
    drawCal();
  }
  function drawCal() {
    if (!cal) return;
    if (cal.pts.length === 2) el('line', { x1: cal.pts[0].x * S, y1: cal.pts[0].y * S, x2: cal.pts[1].x * S, y2: cal.pts[1].y * S, class: 'calline' }, svg);
    cal.pts.forEach(p => el('circle', { cx: p.x * S, cy: p.y * S, r: 14, class: 'calpt' }, svg));
  }
  function down(e) {
    if (cal && cal.pts.length < 2) {
      e.preventDefault(); cal.pts.push(world(e)); render();
      if (cal.pts.length === 2) cal.cb(cal.pts[0], cal.pts[1]);
      return;
    }
    const t = e.target.closest ? e.target.closest('[data-act]') : null; if (!t) return;
    const st = get(), room = st.rooms.find(o => o.id === t.dataset.room); if (!room) return;
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch (err) {}
    const p = world(e);
    drag = { act: t.dataset.act, room, sx: p.x, sy: p.y, ox: room.x, oy: room.y };
    onSelect(room.id);
  }
  function edgeSnap(v, size, others, axis) {
    const cands = []; others.forEach(o => { const a = axis === 'x' ? o.x : o.y, b = a + (axis === 'x' ? o.W : o.D); cands.push(a, b); });
    for (const c of cands) { if (Math.abs(c - v) < 0.16) return c; if (Math.abs(c - (v + size)) < 0.16) return c - size; }
    return v;
  }
  function move(e) {
    if (!drag) return;
    const p = world(e), o = drag.room, others = get().rooms.filter(x => x !== o);
    if (drag.act === 'move') {
      o.x = edgeSnap(snap(drag.ox + p.x - drag.sx), o.W, others, 'x');
      o.y = edgeSnap(snap(drag.oy + p.y - drag.sy), o.D, others, 'y');
    } else if (drag.act === 'notch') {
      const c = cutOf(o); if (!c) return;
      const px = snap(p.x - o.x), pz = snap(p.y - o.y);
      o.cut.w = Math.round(clamp(c.x0 === 0 ? px : o.W - px, 0.5, o.W - 1.2) * 10) / 10;
      o.cut.d = Math.round(clamp(c.z0 === 0 ? pz : o.D - pz, 0.5, o.D - 1.2) * 10) / 10;
    } else if (drag.act === 'resize') {
      let W = snap(p.x - o.x), D = snap(p.y - o.y);
      others.forEach(x => { [x.x, x.x + x.W].forEach(c => { if (Math.abs(c - (o.x + W)) < 0.16) W = c - o.x; }); [x.y, x.y + x.D].forEach(c => { if (Math.abs(c - (o.y + D)) < 0.16) D = c - o.y; }); });
      o.W = clamp(snap(W), MIN, MAX); o.D = clamp(snap(D), MIN, MAX);
    } else {
      const px = p.x - o.x, pz = p.y - o.y;
      const ds = [['N', Math.abs(pz), px / o.W], ['S', Math.abs(pz - o.D), px / o.W], ['W', Math.abs(px), pz / o.D], ['E', Math.abs(px - o.W), pz / o.D]].sort((a, b) => a[1] - b[1])[0];
      const pos = clamp(ds[2], 0, 1);
      if (drag.act === 'door') { o.doorWall = ds[0]; o.doorPos = pos; } else { o.winWall = ds[0]; o.winPos = pos; }
    }
    onChange();
  }
  function up() { if (!drag) return; drag = null; render(); onChange(); }
  /* Scale calibration: the next two clicks mark the ends of a known length. */
  function calibrate(cb) { cal = { pts: [], cb }; render(); }
  function endCalibrate() { cal = null; render(); }
  return { init, render, calibrate, endCalibrate, refit: function () { fitted = false; } };
})();
