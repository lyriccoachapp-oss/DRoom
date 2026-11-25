'use strict';
/* Project files and the client report.
   A project file is JSON: the home (rooms, style, budget, units, construction settings) plus the store products the
   plan uses, so a home opened on another computer keeps its chosen products even without the store feeds.
   The report is a PDF: summary, floor plan, a 3D view when one is available, the estimate with quantities, prices and
   links to each product, and the code check. jsPDF is loaded from cdnjs only when a report is made. */
const ProjectFile = (function () {
  const FORMAT = 'droom-project', VERSION = 1;
  const KEEP = ['style', 'budget', 'units', 'rooms', 'build', 'sizes'];
  /* Store products the plan uses: what is on the lists and what is chosen by hand. */
  function usedProducts(plans) {
    const out = new Map();
    plans.forEach(pl => {
      pl.lines.forEach(l => { if (l.item.store) out.set(l.item.id, l.item); });
      Object.values(pl.room.overrides || {}).forEach(id => { const it = BYID[id]; if (it && it.store) out.set(id, it); });
    });
    return [...out.values()].map(it => {
      const o = {}; ['id', 'store', 'supplier', 'sku', 'cat', 'name', 'url', 'img', 'price', 'si', 'w', 'd', 'h', 'tier', 'style', 'anyStyle', 'color', 'tw', 'tl', 'cover', 'perPiece', 'currency', 'ext', 'group', 'variant'].forEach(k => { if (it[k] !== undefined) o[k] = it[k]; });
      return o;
    });
  }
  function toJSON(state, plans) {
    const home = {}; KEEP.forEach(k => { if (state[k] !== undefined) home[k] = state[k]; });
    return JSON.stringify({ format: FORMAT, version: VERSION, saved: new Date().toISOString(), home, products: usedProducts(plans) }, null, 1);
  }
  /* Reads a project file. Throws with a plain message when it is not one. Rooms of unknown types are dropped. */
  function parse(text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error('This file is not a DRoom project.'); }
    if (!j || j.format !== FORMAT || !j.home || !Array.isArray(j.home.rooms)) throw new Error('This file is not a DRoom project.');
    if (j.version > VERSION) throw new Error('This project was saved by a newer version of DRoom.');
    const h = j.home, rooms = h.rooms.filter(r => r && ROOMS[r.type] && r.W > 0 && r.D > 0 && isFinite(r.x) && isFinite(r.y)).map(r => Object.assign({}, r, { overrides: r.overrides || {}, removed: r.removed || [] }));
    if (!rooms.length) throw new Error('The project has no rooms.');
    return { home: { style: STYLES[h.style] ? h.style : 'scandi', budget: clamp(Number(h.budget) || 20000, 1000, 1e6), units: h.units === 'm' ? 'm' : 'ft', rooms, build: h.build, sizes: h.sizes }, products: Array.isArray(j.products) ? j.products : [], saved: j.saved };
  }
  return { toJSON, parse, usedProducts };
})();

const Report = (function () {
  const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  /* The estimate as rows: one per shopping-list line, with what to buy and where. */
  function rows(plans) {
    const out = [];
    plans.forEach(pl => pl.lines.forEach(l => {
      const it = l.item, bx = boxesFor(l);
      const qty = l.unit ? l.qty + ' ' + l.unit : l.area ? fmtArea(l.qty) + (bx ? ' (' + bx + boxWord(l, bx) + ')' : '') : String(l.qty);
      out.push({ room: pl.room.name, name: it.name, detail: fmtDims(it), qty, total: it.price * l.qty, store: it.store ? it.supplier : 'Sample catalog', currency: it.currency || '', url: Stores.linkOf(it) });
    }));
    return out;
  }
  /* Helvetica in a PDF knows only Latin-1; anything else becomes plain text that reads the same. */
  const pdfText = s => String(s == null ? '' : s).replace(/[′]/g, "'").replace(/[″]/g, '"').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/·/g, '-').replace(/…/g, '...').replace(/✓/g, 'OK').replace(/[^\x20-\x7e\xa0-\xff]/g, '');
  function loadJsPdf() {
    return new Promise((res, rej) => {
      if (window.jspdf && window.jspdf.jsPDF) { res(window.jspdf.jsPDF); return; }
      const sc = document.createElement('script'); sc.src = JSPDF;
      sc.onload = () => window.jspdf && window.jspdf.jsPDF ? res(window.jspdf.jsPDF) : rej(new Error('The PDF library did not load.'));
      sc.onerror = () => rej(new Error('The PDF library could not be loaded.'));
      document.head.appendChild(sc);
    });
  }
  /* An SVG document as a PNG data URL, drawn on a white page. */
  function svgToPng(svgText, width) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      img.onload = () => { const k = width / (img.naturalWidth || width), c = document.createElement('canvas'); c.width = width; c.height = Math.round((img.naturalHeight || width) * k); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res({ data: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height }); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('The plan could not be drawn.')); };
      img.src = url;
    });
  }
  /* Builds the PDF. o: {plans, state, takeoff, checks, view3d: {image, shape} | null, date}. Resolves an ArrayBuffer. */
  async function build(o) {
    const JsPDF = await loadJsPdf(), doc = new JsPDF({ unit: 'pt', format: 'letter', compress: true });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40, ink = [28, 28, 30], muted = [110, 110, 116], accent = [217, 83, 30];
    let y = M;
    const t = (s, x, yy, size, opt) => { doc.setFontSize(size || 10); doc.text(Array.isArray(s) ? s.map(pdfText) : pdfText(s), x, yy, opt || {}); };
    const color = c => doc.setTextColor(c[0], c[1], c[2]);
    const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
    /* Lines of text that fit a width at a font size; the size is set first, since the split measures with it. */
    const wrap = (s, width, size) => { doc.setFontSize(size); return doc.splitTextToSize(pdfText(s), width); };
    const fit = (s, width, size) => wrap(s, width, size)[0] || '';
    const plans = o.plans, R = rows(plans), total = R.reduce((s, r) => s + r.total, 0), mixed = new Set(R.map(r => r.currency || 'CAD')).size > 1;
    /* Summary */
    doc.setFont('helvetica', 'bold'); color(ink); t('Home design and estimate', M, y + 14, 20);
    doc.setFont('helvetica', 'normal'); color(muted);
    t(o.date + '  -  ' + STYLES[o.state.style].name + ' style  -  ' + plans.length + ' rooms, ' + fmtArea(plans.reduce((s, p) => s + p.r.area, 0)), M, y + 34, 10);
    color(ink); doc.setFont('helvetica', 'bold'); t('Estimate total ' + money(total), W - M, y + 14, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal'); color(muted); t('Budget ' + money(o.state.budget), W - M, y + 30, 10, { align: 'right' });
    y += 54;
    /* Floor plan */
    try {
      const png = await svgToPng(BuildDrawing.toSvgText(plans, o.takeoff, o.date), 1600), maxH = o.view3d ? 300 : 420, k = Math.min((W - 2 * M) / png.w, maxH / png.h);
      doc.addImage(png.data, 'JPEG', M + ((W - 2 * M) - png.w * k) / 2, y, png.w * k, png.h * k); y += png.h * k + 12;
    } catch (e) { color(muted); t('The floor plan could not be drawn.', M, y + 12, 10); y += 24; }
    /* 3D view */
    if (o.view3d && o.view3d.image) {
      const ar = o.view3d.shape === 'portrait' ? 1.5 : o.view3d.shape === 'square' ? 1 : 2 / 3, w = Math.min(W - 2 * M, (H - M - y) / ar);
      if (w > 200) { doc.addImage(o.view3d.image, 'JPEG', M + ((W - 2 * M) - w) / 2, y, w, w * ar); y += w * ar + 12; }
    }
    /* Estimate */
    doc.addPage(); y = M;
    doc.setFont('helvetica', 'bold'); color(ink); t('Estimate', M, y + 12, 16); y += 30;
    const cols = [M, M + 238, M + 352, M + 450], head = ['Item', 'Quantity', 'Store', 'Total'];
    const rowH = 30;
    let room = null;
    R.forEach(r => {
      if (r.room !== room) {
        need(rowH * 2); room = r.room; const sub = R.filter(x => x.room === room).reduce((s, x) => s + x.total, 0);
        doc.setFont('helvetica', 'bold'); color(ink); t(room, M, y + 12, 11); t(money(sub), W - M, y + 12, 11, { align: 'right' }); y += 18;
        doc.setFont('helvetica', 'normal'); color(muted); head.forEach((h, i) => t(h, i === 3 ? W - M : cols[i], y + 9, 8, i === 3 ? { align: 'right' } : {})); y += 6;
        doc.setDrawColor(220, 220, 224); doc.line(M, y + 4, W - M, y + 4); y += 6;
      }
      need(rowH);
      const name = fit(r.name, 228, 9.5);
      color(ink); doc.setFontSize(9.5);
      if (r.url) { doc.setTextColor(accent[0], accent[1], accent[2]); doc.textWithLink(name, cols[0], y + 11, { url: r.url }); color(ink); } else t(name, cols[0], y + 11, 9.5);
      color(muted); t(fit(r.detail, 228, 8), cols[0], y + 23, 8);
      color(ink); t(fit(r.qty, 108, 9.5), cols[1], y + 11, 9.5);
      t(fit(r.store, 92, 9), cols[2], y + 11, 9);
      t(money(r.total) + (r.currency && mixed ? ' ' + r.currency : ''), W - M, y + 11, 9.5, { align: 'right' });
      y += rowH;
    });
    need(40); doc.setDrawColor(28, 28, 30); doc.line(M, y, W - M, y); y += 18;
    doc.setFont('helvetica', 'bold'); color(ink); t('Total', M, y, 12); t(money(total), W - M, y, 12, { align: 'right' }); y += 18;
    doc.setFont('helvetica', 'normal'); color(muted);
    const notes = ['Product names in orange link to the product in the store. Prices are as of the last store feed and change; check them before you order.',
      'Flooring, tile and wallpaper include 10% for waste and cuts. Boxes are counted from the coverage the store gives.'];
    if (mixed) notes.push('Prices are in more than one currency (marked on each line); the total adds them without conversion.');
    notes.forEach(s => { const ls = wrap(s, W - 2 * M, 8.5); need(ls.length * 11 + 4); t(ls, M, y, 8.5); y += ls.length * 11 + 4; });
    /* Code check */
    if (o.checks && o.checks.length) {
      need(80); y += 14; doc.setFont('helvetica', 'bold'); color(ink); t('Code check', M, y, 16); y += 14;
      doc.setFont('helvetica', 'normal'); color(muted); const hd = wrap(CODE.name, W - 2 * M, 8.5); t(hd, M, y + 4, 8.5); y += hd.length * 11 + 8;
      const order = { fail: 0, warn: 1, pass: 2, info: 3 }, label = { fail: 'TO FIX', warn: 'CONFIRM', pass: 'MET', info: 'NOTE' }, tone = { fail: [196, 50, 30], warn: [170, 110, 20], pass: [30, 130, 80], info: muted };
      o.checks.slice().sort((a, b) => order[a.status] - order[b.status]).forEach(c => {
        const body = wrap(c.detail, W - 2 * M - 70, 8.5); need(body.length * 11 + 22);
        doc.setFont('helvetica', 'bold'); color(tone[c.status]); t(label[c.status], M, y + 10, 8);
        color(ink); t(c.title + (c.room ? ' - ' + c.room : '') + '  (' + c.ref + ')', M + 70, y + 10, 9.5);
        doc.setFont('helvetica', 'normal'); color(muted); t(body, M + 70, y + 22, 8.5); y += body.length * 11 + 18;
      });
      const nc = wrap(CODE_NOT_CHECKED + ' This is a design aid, not a permit review.', W - 2 * M, 8); need(nc.length * 11 + 14); y += 8; t(nc, M, y + 4, 8); y += nc.length * 11 + 6;
    }
    /* page numbers */
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); color(muted); doc.text('DRoom  -  page ' + i + ' of ' + n, W / 2, H - 20, { align: 'center' }); }
    return doc.output('arraybuffer');
  }
  return { rows, build, pdfText };
})();
