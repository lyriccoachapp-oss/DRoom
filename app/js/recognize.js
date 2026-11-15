'use strict';
/* Floor plan recognition.
   detect(): runs in the browser, no network. Finds enclosed spaces in a plan image and returns their bounding rectangles.
   label(): optional. Asks Claude (when the host offers it) to name the rooms, drop non-rooms and read the scale from dimension text. */
const PlanRecognizer = (function () {
  const TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'office', 'hall'];

  /* Returns [{x, y, w, h}] as fractions of the image width and height, largest first. */
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
    return out.map(b => {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
      const X0 = Math.max(0, b.x0 - r), Y0 = Math.max(0, b.y0 - r), X1 = Math.min(w, b.x1 + 1 + r), Y1 = Math.min(h, b.y1 + 1 + r);
      return { x: X0 / w, y: Y0 / h, w: (X1 - X0) / w, h: (Y1 - Y0) / h, fill: b.area / (bw * bh), px: (X1 - X0) * (Y1 - Y0) };
    }).filter(b => b.fill >= 0.5 && b.px >= n * 0.008 && b.w < 0.97 && b.h < 0.97)
      .sort((a, b) => b.px - a.px).slice(0, 16).map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
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
        rooms.push({ type: e.type, name: String(e.name || '').slice(0, 24), x, y, w, h });
      });
      const wm = Number(res && res.width_m);
      return { width_m: isFinite(wm) && wm >= 3 && wm <= 80 ? wm : null, rooms };
    });
  }
  return { detect, detectPixels, guessTypes, label, TYPES };
})();
