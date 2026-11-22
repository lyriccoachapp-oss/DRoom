'use strict';
/* Floor plan recognition.
   detect(): runs in the browser, no network. Finds enclosed spaces in a plan image and returns their bounding rectangles.
   label(): optional. Asks Claude (when the host offers it) to name the rooms, drop non-rooms and read the scale from dimension text. */
const PlanRecognizer = (function () {
  const TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'office', 'hall'];

  /* Returns [{x, y, w, h, door, ext}] largest first. x, y, w, h are fractions of the image width and height;
     door is {wall, pos} or null; ext says which of the N, S, W, E sides are outside walls. */
  function detect(img) {
    const max = 480, k = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(8, Math.round(img.width * k)), h = Math.max(8, Math.round(img.height * k)), n = w * h;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    return detectPixels(g.getImageData(0, 0, w, h).data, w, h);
  }
  function detectPixels(d, w, h) {
    const n = w * h, lum = new Uint8Array(n), hist = new Array(256).fill(0);
    for (let i = 0; i < n; i++) { const a = d[i * 4 + 3] / 255, v = Math.round((0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a)); lum[i] = v; hist[v]++; }
    /* Otsu threshold separates ink from paper. */
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sb = 0, wb = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) { wb += hist[t]; if (!wb) continue; const wf = n - wb; if (!wf) break; sb += t * hist[t]; const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf); if (v > best) { best = v; thr = t; } }
    const wall = new Uint8Array(n); let ink = 0;
    for (let i = 0; i < n; i++) { wall[i] = lum[i] <= thr ? 1 : 0; ink += wall[i]; }
    if (ink > n / 2) for (let i = 0; i < n; i++) wall[i] = 1 - wall[i];           /* light lines on a dark sheet */
    /* Thicken the ink until doorways close, so each room becomes its own enclosed region. */
    const r = Math.max(3, Math.round(Math.max(w, h) * 0.035)), tmp = new Uint8Array(n), blk = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const o = y * w; let cnt = 0;
      for (let x = 0; x < Math.min(r, w); x++) cnt += wall[o + x];
      for (let x = 0; x < w; x++) { if (x + r < w) cnt += wall[o + x + r]; if (x - r - 1 >= 0) cnt -= wall[o + x - r - 1]; tmp[o + x] = cnt > 0 ? 1 : 0; }
    }
    for (let x = 0; x < w; x++) {
      let cnt = 0;
      for (let y = 0; y < Math.min(r, h); y++) cnt += tmp[y * w + x];
      for (let y = 0; y < h; y++) { if (y + r < h) cnt += tmp[(y + r) * w + x]; if (y - r - 1 >= 0) cnt -= tmp[(y - r - 1) * w + x]; blk[y * w + x] = cnt > 0 ? 1 : 0; }
    }
    /* Flood the outside from the border; what stays unfilled and free is inside the building. */
    const lab = new Int32Array(n), stack = new Int32Array(n); let sp = 0, cur = -1;
    const push = i => { if (!blk[i] && !lab[i]) { lab[i] = cur; stack[sp++] = i; } };
    const fill = cb => { while (sp) { const i = stack[--sp], px = i % w, py = (i - px) / w; if (cb) cb(px, py); if (px > 0) push(i - 1); if (px < w - 1) push(i + 1); if (py > 0) push(i - w); if (py < h - 1) push(i + w); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    fill();
    const out = [];
    for (let i = 0; i < n; i++) {
      if (blk[i] || lab[i]) continue;
      cur = out.length + 1; let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
      push(i); fill((px, py) => { area++; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; });
      out.push({ x0, y0, x1, y1, area });
    }
    /* Doors and outside walls. Along each side of a room, look at the strip where the wall ink should be:
       a clean break of door-like length is a doorway, and a side with open sheet beyond it is an outside wall. */
    const maxSide = Math.max(w, h), minL = Math.max(4, Math.round(maxSide * 0.025)), maxL = Math.round(maxSide * 0.14);
    function side(b, name) {
      const horiz = name === 'N' || name === 'S', a0 = horiz ? b.x0 : b.y0, a1 = horiz ? b.x1 : b.y1;
      const edge = name === 'N' ? b.y0 : name === 'S' ? b.y1 : name === 'W' ? b.x0 : b.x1, dir = (name === 'N' || name === 'W') ? -1 : 1;
      const at = (t, k) => { const q = edge + dir * k, x = horiz ? t : q, y = horiz ? q : t; return (x < 0 || y < 0 || x >= w || y >= h) ? -2 : y * w + x; };
      let run = 0, best = null, ext = 0, cnt = 0;
      const close = end => { if (run >= minL && run <= maxL && (!best || run > best.len)) best = { len: run, mid: end - run / 2 }; run = 0; };
      for (let t = a0; t <= a1; t++) {
        let ink = false;
        for (let k = r - 1; k <= 2 * r + 2 && !ink; k++) { const i = at(t, k); if (i === -2 || wall[i]) ink = true; }
        if (ink) close(t); else run++;
        const i1 = at(t, 3 * r + 3), i2 = at(t, 4 * r + 3); cnt++;
        if (i1 === -2 || i2 === -2 || lab[i1] === -1 || lab[i2] === -1) ext++;
      }
      close(a1 + 1);
      return { gap: best ? { len: best.len, pos: (best.mid - (a0 - r)) / (a1 - a0 + 1 + 2 * r) } : null, ext: ext / cnt > 0.6 };
    }
    /* L-shaped rooms: an empty rectangle in one corner of the room's bounding box. */
    function notch(b, id) {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1, band = Math.max(2, Math.round(Math.min(bw, bh) * 0.04));
      const has = (x0, y0, x1, y1) => { let c = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lab[y * w + x] === id) c++; return c; };
      let best = null;
      for (const corner of ['NE', 'NW', 'SE', 'SW']) {
        const east = corner[1] === 'E', south = corner[0] === 'S';
        const rowY = south ? [b.y1 - band, b.y1] : [b.y0, b.y0 + band], colX = east ? [b.x1 - band, b.x1] : [b.x0, b.x0 + band];
        /* Along the band of rows at that end, how far in from the corner side the room starts; the same for columns. */
        let cw = 0; for (let k = 0; k < bw; k++) { const x = east ? b.x1 - k : b.x0 + k; if (has(x, rowY[0], x, rowY[1])) break; cw++; }
        let cd = 0; for (let k = 0; k < bh; k++) { const y = south ? b.y1 - k : b.y0 + k; if (has(colX[0], y, colX[1], y)) break; cd++; }
        if (cw < bw * 0.18 || cd < bh * 0.18 || cw > bw * 0.85 || cd > bh * 0.85) continue;
        const nx0 = east ? b.x1 - cw + 1 : b.x0, nx1 = east ? b.x1 : b.x0 + cw - 1, ny0 = south ? b.y1 - cd + 1 : b.y0, ny1 = south ? b.y1 : b.y0 + cd - 1;
        if (has(nx0, ny0, nx1, ny1) > cw * cd * 0.04) continue;
        if (!best || cw * cd > best.cw * best.cd) best = { corner, cw, cd };
      }
      return best;
    }
    out.forEach((b, k) => { b.notch = notch(b, k + 1); });
    out.forEach(b => {
      b.ext = {}; let door = null;
      ['N', 'S', 'W', 'E'].forEach(nm => { const sd = side(b, nm); b.ext[nm] = sd.ext; if (sd.gap && (!door || sd.gap.len > door.len)) door = { wall: nm, pos: Math.max(0, Math.min(1, sd.gap.pos)), len: sd.gap.len }; });
      b.door = door ? { wall: door.wall, pos: door.pos } : null;
    });
    return out.map(b => {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
      const X0 = Math.max(0, b.x0 - r), Y0 = Math.max(0, b.y0 - r), X1 = Math.min(w, b.x1 + 1 + r), Y1 = Math.min(h, b.y1 + 1 + r);
      /* Free space is inset by the same wall allowance on the notch walls as on the outer walls, so the notch measured in it is already wall-centre to wall-centre. */
      const cut = b.notch ? { corner: b.notch.corner, w: b.notch.cw / (X1 - X0), h: b.notch.cd / (Y1 - Y0) } : null;
      return { x: X0 / w, y: Y0 / h, w: (X1 - X0) / w, h: (Y1 - Y0) / h, fill: b.area / (bw * bh), px: (X1 - X0) * (Y1 - Y0), door: b.door, ext: b.ext, cut };
    }).filter(b => b.fill >= (b.cut ? 0.4 : 0.5) && b.px >= n * 0.008 && b.w < 0.97 && b.h < 0.97)
      .sort((a, b) => b.px - a.px).slice(0, 16).map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, door: b.door, ext: b.ext, cut: b.cut }));
  }

  /* Room types from size alone, for when no AI is available. `rooms` are in metres: {W, D}. */
  function guessTypes(rooms) {
    const order = rooms.map((r, i) => ({ i, a: r.W * r.D, ar: Math.max(r.W, r.D) / Math.min(r.W, r.D) })).sort((a, b) => b.a - a.a);
    const types = new Array(rooms.length).fill('bedroom'); let kitchen = false;
    order.forEach((o, rank) => {
      if (o.ar > 2.6 || o.a < 3) types[o.i] = 'hall';
      else if (rank === 0) types[o.i] = 'living';
      else if (o.a < 7.5) types[o.i] = 'bathroom';
      else if (!kitchen && o.a >= 7.5 && o.a <= 16 && rank <= 2) { types[o.i] = 'kitchen'; kitchen = true; }
    });
    return types;
  }

  /* Ask Claude to label the detected rectangles. Resolves {width_m, rooms:[{type, name, x, y, w, h}]} or rejects. */
  function label(sample, file, boxes) {
    const list = boxes.map((b, i) => '#' + (i + 1) + ': x=' + b.x.toFixed(3) + ' y=' + b.y.toFixed(3) + ' w=' + b.w.toFixed(3) + ' h=' + b.h.toFixed(3)).join('\n');
    const prompt = 'The image is an architectural floor plan of a home. A detector found these rectangles. ' +
      'Each is given as fractions of the image width and height, origin at the top-left corner:\n' + (list || '(none found)') + '\n\n' +
      'Do three things.\n' +
      '1. For each listed rectangle that really is a room, return an entry with its number in "i", a "type" from ' + JSON.stringify(TYPES) +
      ' (use "hall" for corridors, entries, closets and stairs) and a short English "name". Leave out rectangles that are not rooms, such as a title block, a legend or outdoor space.\n' +
      '2. If a room is clearly missing from the list, add an entry with "i": null and its own bounding rectangle "x", "y", "w", "h" in the same fractions.\n' +
      '3. If the drawing shows dimension labels or a scale bar, work out the real-world width in metres that the FULL image width represents and return it as "width_m". If it cannot be worked out, return null. Convert feet and inches to metres.\n\n' +
      'Reply with only JSON in this shape: {"width_m": 14.2, "rooms": [{"i": 1, "type": "living", "name": "Living room"}, {"i": null, "type": "bathroom", "name": "Bath", "x": 0.61, "y": 0.4, "w": 0.1, "h": 0.12}]}';
    return sample.json(prompt, { images: [file] }).then(res => {
      const rooms = [];
      (res && Array.isArray(res.rooms) ? res.rooms : []).forEach(e => {
        if (!e || TYPES.indexOf(e.type) < 0) return;
        const b = e.i != null && boxes[e.i - 1] ? boxes[e.i - 1] : e;
        const x = Number(b.x), y = Number(b.y), w = Number(b.w), h = Number(b.h);
        if (![x, y, w, h].every(isFinite) || w <= 0.01 || h <= 0.01 || x < -0.05 || y < -0.05 || x + w > 1.05 || y + h > 1.05) return;
        rooms.push({ type: e.type, name: String(e.name || '').slice(0, 24), x, y, w, h, door: b.door || null, ext: b.ext || null, cut: e.i != null ? (b.cut || null) : null });
      });
      const wm = Number(res && res.width_m);
      return { width_m: isFinite(wm) && wm >= 3 && wm <= 80 ? wm : null, rooms };
    });
  }
  /* Printed drawing scale found in a sheet's text, such as 3/16" = 1'-0" or 1:100.
     Returns {ratio, raw} where one unit on paper is `ratio` units in the building, or null. Ported from the CRM takeoff editor. */
  function inches(s) {
    s = s.trim(); let m = s.match(/^(\d+)[-\s](\d+)\/(\d+)$/);
    if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10);
    m = s.match(/^(\d+)\/(\d+)$/); if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
    return /^\d+(?:\.\d+)?$/.test(s) ? parseFloat(s) : null;
  }
  function scaleFromText(raw) {
    if (!raw) return null;
    const text = raw.replace(/[′’ʹ]/g, "'").replace(/[″“”ʺ]/g, '"').replace(/\s+/g, ' ');
    const imp = text.match(/(\d+(?:[-\s]\d+)?\/\d+|\d+(?:\.\d+)?)\s*"\s*=\s*(\d+)\s*'/);
    if (imp) { const paper = inches(imp[1]), feet = parseInt(imp[2], 10); if (paper && paper > 0 && feet > 0) return { ratio: feet * 12 / paper, raw: imp[1].replace(/\s+/g, '') + '" = ' + feet + "'" }; }
    const guarded = text.match(/scale[^0-9]{0,12}1\s*:\s*(\d{1,5})/i);
    if (guarded) { const n = parseInt(guarded[1], 10); if (n > 1) return { ratio: n, raw: '1:' + n }; }
    /* A bare 1:N is trusted only for common drawing scales, so a clock time is not mistaken for one. */
    const bare = text.match(/(?:^|[^\d:])1\s*:\s*(\d{1,5})(?![\d])/);
    if (bare) { const n = parseInt(bare[1], 10); if ([100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 2000, 2500, 5000].indexOf(n) >= 0) return { ratio: n, raw: '1:' + n }; }
    return null;
  }
  /* Detected rooms stop at the faces of the walls between them, so neighbours are a wall thickness apart.
     Pull edges that lie within `tol` metres of each other onto one line, so neighbours share their wall. Changes rooms in place. */
  function snapRooms(rooms, tol) {
    tol = tol || 0.35;
    const snapAxis = (lo, size) => {
      const edges = []; rooms.forEach((r, i) => { edges.push({ i, v: r[lo], end: 0 }); edges.push({ i, v: r[lo] + r[size], end: 1 }); });
      edges.sort((a, b) => a.v - b.v);
      let k = 0;
      while (k < edges.length) {
        let j = k; while (j + 1 < edges.length && edges[j + 1].v - edges[k].v <= tol) j++;
        const mean = Math.round(edges.slice(k, j + 1).reduce((s, e) => s + e.v, 0) / (j - k + 1) * 10) / 10;
        for (let m = k; m <= j; m++) edges[m].to = mean;
        k = j + 1;
      }
      rooms.forEach((r, i) => {
        const a = edges.find(e => e.i === i && e.end === 0).to, b = edges.find(e => e.i === i && e.end === 1).to;
        if (b - a >= 1.6) { r[lo] = a; r[size] = Math.round((b - a) * 10) / 10; }
      });
    };
    snapAxis('x', 'W'); snapAxis('y', 'D');
    return rooms;
  }
  return { detect, detectPixels, guessTypes, label, scaleFromText, snapRooms, TYPES };
})();
