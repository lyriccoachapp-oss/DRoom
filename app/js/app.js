'use strict';
/* App state, UI wiring and the shopping list. */
(function () {
  const KEY = 'droom.home.v2';
  const SIZE = { living: [4.8, 4.0], bedroom: [3.8, 3.6], kitchen: [3.8, 3.2], bathroom: [2.4, 2.2], dining: [4.0, 3.6], office: [3.2, 3.0], hall: [3.0, 1.6] };
  let uid = 1;
  const newId = () => 'r' + Date.now().toString(36) + (uid++);
  function makeRoom(type, x, y, W, D) {
    return { id: newId(), name: ROOMS[type].name, type, x, y, W, D, doorWall: 'S', doorPos: 0.82, winWall: 'N', winPos: 0.5, overrides: {}, removed: [] };
  }
  function defaults() {
    /* Sample home: every room opens onto the hallway or the living room, so all of it can be walked. */
    const a = makeRoom('living', 0, 0, 5.4, 4.2), h = makeRoom('hall', 5.4, 0, 1.4, 5.8), b = makeRoom('bedroom', 6.8, 0, 4.0, 3.6),
      t = makeRoom('bathroom', 6.8, 3.6, 2.4, 2.2), k = makeRoom('kitchen', 0, 4.2, 3.8, 3.2);
    a.doorWall = 'E'; a.doorPos = 0.7; a.winWall = 'N';
    h.doorWall = 'S'; h.doorPos = 0.5; h.winWall = 'N';
    b.doorWall = 'W'; b.doorPos = 0.5; b.winWall = 'N';
    t.doorWall = 'W'; t.doorPos = 0.5; t.winWall = 'E';
    k.doorWall = 'N'; k.doorPos = 0.82; k.winWall = 'S';
    return { style: 'scandi', budget: 20000, units: 'ft', rooms: [a, h, b, t, k], roomId: a.id, view: 'plan' };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.rooms) && STYLES[s.style]) {
        s.rooms = s.rooms.filter(r => ROOMS[r.type] && r.W && r.D);
        s.rooms.forEach(r => { r.overrides = r.overrides || {}; r.removed = r.removed || []; });
        return s;
      }
    } catch (e) {}
    return null;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  const state = load() || defaults();
  UNITS.v = state.units === 'm' ? 'm' : 'ft';
  let plans = [], sel = null, toast = '', has3d = false, sceneStale = true, trace = null, clash = new Set();
  const hist = []; let hi = -1, htimer = null;
  const room = () => state.rooms.find(r => r.id === state.roomId) || null;
  const planOf = id => plans.find(p => p.room.id === id);

  function generateAll() {
    const wsum = state.rooms.reduce((s, r) => s + ROOMS[r.type].weight, 0) || 1, notes = [];
    plans = state.rooms.map(r => planRoom(r, state.style, Math.round(state.budget * ROOMS[r.type].weight / wsum), notes));
    if (notes.length) toast = notes.join(' ');
    if (sel) { const p = planOf(sel.roomId); if (!p || !p.lines.some(l => l.cat === sel.cat)) sel = null; }
    if (!room() && state.rooms.length) state.roomId = state.rooms[0].id;
    clash = new Set(); const names = [];
    state.rooms.forEach((a, i) => state.rooms.slice(i + 1).forEach(b => {
      const hit = roomRects(a).some(p => roomRects(b).some(q => Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) > 0.05 && Math.min(p.z1, q.z1) - Math.max(p.z0, q.z0) > 0.05));
      if (hit) { clash.add(a.id); clash.add(b.id); names.push(a.name + ' and ' + b.name); }
    }));
    clashText = names.length ? 'Rooms overlap: ' + names.join('; ') + '. Move or resize one of them.' : '';
  }
  let clashText = '';
  /* ---------- undo / redo ---------- */
  const snapshot = () => JSON.stringify({ style: state.style, budget: state.budget, rooms: state.rooms });
  function histButtons() { $('#btnUndo').disabled = hi <= 0; $('#btnRedo').disabled = hi >= hist.length - 1; }
  function record() {
    clearTimeout(htimer);
    htimer = setTimeout(() => { const s = snapshot(); if (hist[hi] === s) return; hist.length = hi + 1; hist.push(s); if (hist.length > 80) hist.shift(); hi = hist.length - 1; histButtons(); }, 350);
  }
  function restore(i) {
    if (i < 0 || i >= hist.length) return;
    clearTimeout(htimer); hi = i; const s = JSON.parse(hist[i]);
    state.style = s.style; state.budget = s.budget; state.rooms = s.rooms; sel = null; PlanEditor.refit(); update(true); histButtons();
  }

  /* ---------- rendering ---------- */
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function press(box, v) { box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false')); }
  function renderSide() {
    press($('#segStyle'), state.style); press($('#segUnits'), UNITS.v); press($('#segView'), state.view);
    $('#inBudget').value = state.budget; $('#outBudget').textContent = money(state.budget);
    const ul = $('#roomList'); ul.textContent = '';
    state.rooms.forEach(r => {
      const li = el('li'), b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', r.id === state.roomId ? 'true' : 'false');
      b.append(el('span', '', r.name), el('small', 'num', fmtLen(r.W) + ' × ' + fmtLen(r.D)));
      b.addEventListener('click', () => { state.roomId = r.id; update(); });
      li.appendChild(b); ul.appendChild(li);
    });
    const r = room(); $('#roomGrp').hidden = !r;
    if (r) {
      const nm = $('#inName'); if (document.activeElement !== nm) nm.value = r.name;
      $('#selType').value = r.type;
      $('#selShape').value = cutOf(r) ? r.cut.corner : '';
      const dd = doorOf(r), ws = $('#selDoorW');
      $('#selDoor').value = dd.type;
      Array.from(ws.options).forEach(op => { const v = parseFloat(op.value); op.textContent = UNITS.v === 'm' ? Math.round(v * 100) + ' cm' : Math.round(v / 0.0254) + ' in'; });
      ws.value = Array.from(ws.options).map(op => op.value).sort((a, b) => Math.abs(a - dd.width) - Math.abs(b - dd.width))[0];
      $('#btnDoorSide').hidden = dd.type === 'open';
      $('#btnDoorSide').textContent = dd.type === 'swing' ? 'Flip hinge side' : 'Slide the other way';
      $('#btnDoorSwing').hidden = dd.type !== 'swing';
      $('#btnDoorSwing').textContent = dd.swing === 'in' ? 'Open outward' : 'Open inward';
      $('#inW').value = r.W; $('#inD').value = r.D; $('#outW').textContent = fmtLen(r.W); $('#outD').textContent = fmtLen(r.D);
    }
    const area = state.rooms.reduce((s, x) => s + roomArea(x), 0);
    $('#homeDims').textContent = state.rooms.length + (state.rooms.length === 1 ? ' room · ' : ' rooms · ') + fmtArea(area);
    $('#hint').textContent = state.view === 'plan' ? 'Drag rooms, corners and markers to edit the plan'
      : state.view === 'walk' ? 'Click floor to walk · double-click furniture · drag to look · wheel to step'
      : 'Drag to rotate · scroll to zoom · double-click furniture to swap it';
    $('#walkpad').hidden = state.view !== 'walk' || !has3d;
    $('#mini').toggleAttribute('hidden', state.view !== 'walk' || !has3d);
    const wr = $('#walkRooms'); wr.hidden = state.view !== 'walk' || !has3d || state.rooms.length < 2; wr.textContent = '';
    if (!wr.hidden) state.rooms.forEach(r => { const b = el('button', '', r.name); b.type = 'button'; b.dataset.id = r.id; b.setAttribute('aria-pressed', r.id === state.roomId ? 'true' : 'false'); b.addEventListener('click', () => { state.roomId = r.id; Scene3D.goRoom(r.id); renderSide(); }); wr.appendChild(b); });
    $('#plan').style.display = state.view === 'plan' ? '' : 'none';
    $('#cv').hidden = state.view === 'plan' || !has3d;
    $('#fail').hidden = state.view === 'plan' || has3d;
  }
  const REASON = { budget: 'over budget', space: 'does not fit', removed: 'removed by you' };
  function renderList() {
    renderCard();
    const total = plans.reduce((s, p) => s + p.total, 0), over = total > state.budget;
    $('#sumTotal').textContent = money(total); $('#sumOf').textContent = 'of ' + money(state.budget);
    $('#bar').classList.toggle('over', over); $('#barFill').style.width = clamp(total / state.budget * 100, 0, 100) + '%';
    const st = $('#status'); st.classList.toggle('over', over);
    st.textContent = !plans.length ? 'Add a room to get a list.' : over ? 'The minimum set is ' + money(total - state.budget) + ' over budget.' : 'Within budget. ' + money(state.budget - total) + ' left.';
    const t = $('#toast'); t.hidden = !toast; t.textContent = toast;
    const cl = $('#clash'); cl.hidden = !clashText; cl.textContent = clashText;
    const box = $('#groups'); box.textContent = '';
    plans.forEach(p => {
      const r = p.room, g = el('div', 'rgroup'), head = el('div', 'rhead');
      head.append(el('span', '', r.name), el('small', 'num', money(p.total) + ' of ' + money(p.budget)));
      g.appendChild(head);
      const ul = el('ul', 'items');
      p.lines.forEach(l => {
        const it = l.item, on = sel && sel.roomId === r.id && sel.cat === l.cat, li = el('li', 'item' + (on ? ' sel' : ''));
        const hd = el('button', 'item-head'); hd.type = 'button'; hd.setAttribute('aria-expanded', on ? 'true' : 'false');
        const sw = el('span', 'sw'); sw.style.background = hex(it.swatch);
        const mid = el('span'); mid.append(el('div', 'nm', it.name + (l.area ? ', ' + fmtArea(l.qty) : l.qty > 1 ? ' × ' + l.qty : '')), el('div', 'meta num', fmtDims(it)));
        const pr = el('span', 'pr num', money(it.price * l.qty)); pr.appendChild(el('small', '', STYLES[it.style].name + ' · ' + TIERS[it.tier].name));
        hd.append(sw, mid, pr); hd.addEventListener('click', () => select(on ? null : { roomId: r.id, cat: l.cat })); li.appendChild(hd);
        if (on) li.appendChild(altsFor(p, l));
        ul.appendChild(li);
      });
      g.appendChild(ul);
      if (p.excluded.length) {
        const out = el('ul', 'out');
        p.excluded.forEach(x => {
          const li = el('li'); li.appendChild(el('span', '', CATS[x.cat].name + ': ' + REASON[x.reason]));
          if (x.reason === 'removed') { const b = el('button', 'linkbtn ok', 'Put back'); b.type = 'button'; b.addEventListener('click', () => { r.removed = r.removed.filter(c => c !== x.cat); update(); }); li.appendChild(b); }
          out.appendChild(li);
        });
        g.appendChild(out);
      }
      box.appendChild(g);
    });
  }
  function altsFor(p, l) {
    const r = p.room, it = l.item, body = el('div', 'item-body'), hd = el('div', 'hd');
    hd.appendChild(el('span', '', it.supplier + ' · alternatives'));
    if (!ROOMS[r.type].required.includes(l.cat)) {
      const rm = el('button', 'linkbtn', 'Remove from room'); rm.type = 'button';
      rm.addEventListener('click', () => { r.removed.push(l.cat); delete r.overrides[l.cat]; sel = null; update(); });
      hd.appendChild(rm);
    }
    body.appendChild(hd);
    const alts = el('div', 'alts'), fit = {};
    CATALOG.filter(a => a.cat === l.cat).sort((a, b) => (a.style === state.style ? 0 : 1) - (b.style === state.style ? 0 : 1) || a.price - b.price).forEach(a => {
      const b = el('button', 'alt'); b.type = 'button';
      const ok = a.si === it.si || (fit[a.si] !== undefined ? fit[a.si] : (fit[a.si] = canFit(p, l.cat, a.si)));
      const s2 = el('span', 'sw'); s2.style.background = hex(a.swatch);
      const m2 = el('span'); m2.append(el('div', 'nm', a.name), el('div', 'meta num', ok ? STYLES[a.style].name + ' · ' + TIERS[a.tier].name + ' · ' + fmtDims(a) : 'does not fit'));
      const dlt = (a.price - it.price) * l.qty;
      const d = el('span', 'delta num' + (dlt > 0 ? ' up' : dlt < 0 ? ' down' : ''), a.id === it.id ? 'selected' : (dlt > 0 ? '+' : dlt < 0 ? '−' : '') + money(Math.abs(dlt)));
      b.append(s2, m2, d);
      if (a.id === it.id) b.setAttribute('aria-current', 'true');
      if (!ok) b.disabled = true;
      b.addEventListener('click', () => { r.overrides[l.cat] = a.id; update(); });
      alts.appendChild(b);
    });
    body.appendChild(alts);
    return body;
  }
  /* A pick in the 3D view opens a card over the view, so nobody has to scroll away from the walk to swap a piece. */
  let cardOpen = false;
  function select(s, from3d) {
    sel = s; if (s) state.roomId = s.roomId;
    cardOpen = !!(s && from3d && state.view !== 'plan');
    renderSide(); renderList(); PlanEditor.render(); Scene3D.setSelected(sel);
  }
  function renderCard() {
    const card = $('#itemCard'), p = sel && planOf(sel.roomId), l = p && p.lines.find(x => x.cat === sel.cat);
    card.hidden = !(cardOpen && l && state.view !== 'plan');
    if (card.hidden) return;
    const it = l.item;
    $('#icName').textContent = it.name + (l.area ? ', ' + fmtArea(l.qty) : l.qty > 1 ? ' \u00d7 ' + l.qty : '');
    $('#icMeta').textContent = p.room.name + ' \u00b7 ' + fmtDims(it);
    $('#icPrice').textContent = money(it.price * l.qty);
    $('#icClose').textContent = state.view === 'walk' ? 'Back to walking' : 'Close';
    const body = $('#icBody'); body.textContent = ''; body.appendChild(altsFor(p, l));
    /* The card lists only what fits this room; the full list with sizes that do not fit stays in the shopping list. */
    body.querySelectorAll('.alt:disabled').forEach(n => n.remove());
  }
  function closeCard() { cardOpen = false; select(null); }
  $('#icClose').addEventListener('click', closeCard);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && cardOpen) closeCard(); });
  function syncScene() {
    if (state.view === 'plan') { sceneStale = true; return; }
    Scene3D.build(plans, state.style); Scene3D.setSelected(sel); sceneStale = false;
  }
  function update(skipHistory) {
    generateAll(); save(); renderSide(); renderList(); PlanEditor.render(); syncScene(); toast = '';
    if (skipHistory !== true) record();
  }

  /* ---------- wiring ---------- */
  function seg(id, fn) { $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (b) fn(b.dataset.v); }); }
  seg('#segStyle', v => { state.style = v; state.rooms.forEach(r => r.overrides = {}); update(); });
  seg('#segUnits', v => { state.units = UNITS.v = v; update(); });
  $('#selType').addEventListener('change', e => { const v = e.target.value, r = room(); if (!r || r.type === v) return; if (r.name === ROOMS[r.type].name) r.name = ROOMS[v].name; r.type = v; r.overrides = {}; r.removed = []; sel = null; update(); });
  seg('#segView', v => {
    const fromPlan = state.view === 'plan';
    if (state.view === 'walk' && has3d) state.walk = Scene3D.pose();
    state.view = v; if (v === 'plan') cardOpen = false; save(); renderSide(); renderList();
    if (v !== 'plan' && fromPlan) Scene3D.regrow();
    if (v !== 'plan') { if (sceneStale) syncScene(); Scene3D.setView(v, planOf(state.roomId) || plans[0], v === 'walk' ? state.walk : null); Scene3D.resize(); }
  });
  /* The walk position is kept with the project, so the Walk tab (or a reload) returns to the same spot and view. */
  const keepPose = () => { if (state.view === 'walk' && has3d) { state.walk = Scene3D.pose(); save(); } };
  window.addEventListener('pagehide', keepPose);
  document.addEventListener('visibilitychange', () => { if (document.hidden) keepPose(); });
  $('#inBudget').addEventListener('input', e => { state.budget = parseInt(e.target.value, 10); update(); });
  $('#inName').addEventListener('input', e => { const r = room(); if (r) { r.name = e.target.value.trim() || ROOMS[r.type].name; update(); } });
  $('#selDoor').addEventListener('change', e => { const r = room(); if (r) { r.doorType = e.target.value; update(); } });
  $('#selDoorW').addEventListener('change', e => { const r = room(); if (r) { r.doorWidth = parseFloat(e.target.value); update(); } });
  $('#btnDoorSide').addEventListener('click', () => { const r = room(); if (r) { r.doorSide = doorOf(r).side === 'left' ? 'right' : 'left'; update(); } });
  $('#btnDoorSwing').addEventListener('click', () => { const r = room(); if (r) { r.doorSwing = doorOf(r).swing === 'in' ? 'out' : 'in'; update(); } });
  $('#selShape').addEventListener('change', e => {
    const r = room(); if (!r) return; const v = e.target.value;
    if (!v) delete r.cut;
    else if (r.W < 2.8 || r.D < 2.8) { e.target.value = ''; toast = 'A room needs to be at least 9\u2032 \u00d7 9\u2032 (2.8 m) on both sides to take an L shape.'; update(); return; }
    else r.cut = { corner: v, w: r.cut ? r.cut.w : Math.round(r.W * 4) / 10, d: r.cut ? r.cut.d : Math.round(r.D * 4) / 10 };
    r.overrides = {}; update();
  });
  $('#inW').addEventListener('input', e => { const r = room(); if (r) { r.W = parseFloat(e.target.value); update(); } });
  $('#inD').addEventListener('input', e => { const r = room(); if (r) { r.D = parseFloat(e.target.value); update(); } });
  function addRoom(type) {
    const x = state.rooms.length ? Math.max.apply(null, state.rooms.map(r => r.x + r.W)) : 0;
    const y = state.rooms.length ? Math.min.apply(null, state.rooms.map(r => r.y)) : 0;
    const r = makeRoom(type, x, y, SIZE[type][0], SIZE[type][1]);
    const n = state.rooms.filter(o => o.type === type).length; if (n) r.name = ROOMS[type].name + ' ' + (n + 1);
    state.rooms.push(r); state.roomId = r.id; PlanEditor.refit(); update();
  }
  $('#addRow').addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (b) addRoom(b.dataset.add); });
  $('#delRoom').addEventListener('click', () => { state.rooms = state.rooms.filter(r => r.id !== state.roomId); state.roomId = state.rooms.length ? state.rooms[0].id : null; sel = null; PlanEditor.refit(); update(); });
  $('#btnReset').addEventListener('click', () => { state.rooms.forEach(r => { r.overrides = {}; r.removed = []; }); sel = null; update(); });
  $('#btnCopy').addEventListener('click', () => {
    const lines = ['DRoom shopping list, ' + STYLES[state.style].name + ' style'];
    plans.forEach(p => {
      lines.push('', p.room.name + ' (' + fmtLen(p.room.W) + ' × ' + fmtLen(p.room.D) + ')');
      p.lines.forEach(l => lines.push('- ' + l.item.name + (l.area ? ', ' + fmtArea(l.qty) : l.qty > 1 ? ' × ' + l.qty : '') + ', ' + fmtDims(l.item) + ', ' + money(l.item.price * l.qty)));
    });
    lines.push('', 'Total: ' + money(plans.reduce((s, p) => s + p.total, 0)) + ' (budget ' + money(state.budget) + ')');
    const b = $('#btnCopy'), done = ok => { b.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => b.textContent = 'Copy list', 1600); };
    try { navigator.clipboard.writeText(lines.join('\n')).then(() => done(true), () => done(false)); } catch (e) { done(false); }
  });
  [['#padF', 'padF'], ['#padB', 'padB'], ['#padL', 'padL'], ['#padR', 'padR']].forEach(a => {
    const b = $(a[0]), off = () => { Scene3D.hold(a[1], false); b.classList.remove('on'); };
    b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) {} Scene3D.hold(a[1], true); b.classList.add('on'); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, off));
    b.addEventListener('contextmenu', e => e.preventDefault());
  });

  /* ---------- boot ---------- */
  const fail = el('div', 'fail', '3D view is not available in this browser. The plan and the shopping list still work.'); fail.id = 'fail'; fail.hidden = true;
  $('#stage').appendChild(fail);
  PlanEditor.init($('#plan'), () => ({ rooms: state.rooms, plans, roomId: state.roomId, sel, trace, clash }), () => update(), id => { state.roomId = id; });
  $('#btnUndo').addEventListener('click', () => restore(hi - 1));
  $('#btnRedo').addEventListener('click', () => restore(hi + 1));
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    const t = e.target.tagName; if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
    e.preventDefault(); restore(e.shiftKey ? hi + 1 : hi - 1);
  });
  /* floor plan image to trace over; kept in memory only */
  function traceUi() {
    $('#traceCtl').hidden = !trace; if (!trace) return;
    $('#inTraceW').value = trace.width; $('#outTraceW').textContent = fmtLen(trace.width);
    $('#inTraceO').value = trace.opacity; $('#outTraceO').textContent = Math.round(trace.opacity * 100) + '%';
  }
  function useImage(src, file, width, note) {
    const img = new Image();
    img.onload = () => { trace = { src, aspect: img.width / img.height || 1, width: width || 12, opacity: 0.5, img, file }; say(note || 'Plan loaded. Press Detect rooms, then check the scale.'); PlanEditor.refit(); traceUi(); PlanEditor.render(); };
    img.onerror = () => say('This file could not be opened as a picture.');
    img.src = src;
  }
  /* pdf.js is fetched only when someone opens a PDF. */
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  function loadPdfJs() {
    return new Promise((res, rej) => {
      if (window.pdfjsLib) { res(window.pdfjsLib); return; }
      const sc = document.createElement('script'); sc.src = PDFJS + 'pdf.min.js';
      sc.onload = () => { if (!window.pdfjsLib) { rej(new Error('pdf.js missing')); return; } window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(window.pdfjsLib); };
      sc.onerror = () => rej(new Error('pdf.js failed to load'));
      document.head.appendChild(sc);
    });
  }
  async function usePdf(file) {
    say('Opening the PDF…');
    try {
      const lib = await loadPdfJs(), doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise, page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(4, 2000 / Math.max(base.width, base.height)) });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      /* A scale printed on the sheet gives the real size of the page: page width on paper times the ratio. */
      let width = null, note = 'Plan loaded' + (doc.numPages > 1 ? ' from page 1 of ' + doc.numPages : '') + '. Press Detect rooms, then check the scale.';
      try {
        const tc = await page.getTextContent(), sc = PlanRecognizer.scaleFromText(tc.items.map(i => i.str).join(' '));
        const wm = sc ? base.width / 72 * 0.0254 * sc.ratio : 0;
        if (wm >= 3 && wm <= 200) { width = wm; note = 'Plan loaded. Scale ' + sc.raw + ' was read from the sheet, so sizes should already be right. Press Detect rooms.'; }
      } catch (e) {}
      useImage(c.toDataURL('image/png'), blob, width, note);
    } catch (e) { say('This PDF could not be opened. Save the plan page as a picture and load that.'); }
  }
  $('#inTrace').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) { usePdf(f); return; }
    const rd = new FileReader(); rd.onload = () => useImage(rd.result, f); rd.readAsDataURL(f);
  });
  $('#inTraceW').addEventListener('input', e => { if (trace) { trace.width = parseFloat(e.target.value); PlanEditor.refit(); traceUi(); PlanEditor.render(); } });
  $('#inTraceO').addEventListener('input', e => { if (trace) { trace.opacity = parseFloat(e.target.value); traceUi(); PlanEditor.render(); } });
  /* ---------- recognition and scale ---------- */
  function say(t) { const m = $('#traceMsg'); m.hidden = !t; m.textContent = t || ''; }
  function rescale(k) {
    if (!isFinite(k) || k <= 0) return;
    if (trace) trace.width = clamp(trace.width * k, 1, 200);
    state.rooms.forEach(r => { r.x = Math.round(r.x * k * 10) / 10; r.y = Math.round(r.y * k * 10) / 10; r.W = clamp(Math.round(r.W * k * 10) / 10, 1.6, 12); r.D = clamp(Math.round(r.D * k * 10) / 10, 1.6, 12); });
  }
  function roomsFromBoxes(list) {
    const hgt = trace.width / trace.aspect, rooms = list.map(b => {
      const W = clamp(Math.round(b.w * trace.width * 10) / 10, 1.6, 12), D = clamp(Math.round(b.h * hgt * 10) / 10, 1.6, 12);
      const r = makeRoom(b.type, Math.round(b.x * trace.width * 10) / 10, Math.round(b.y * hgt * 10) / 10, W, D);
      if (b.name) r.name = b.name; return r;
    });
    const cx = rooms.reduce((s, r) => s + r.x + r.W / 2, 0) / rooms.length, cy = rooms.reduce((s, r) => s + r.y + r.D / 2, 0) / rooms.length;
    const seen = {};
    rooms.forEach(r => {
      const dx = cx - (r.x + r.W / 2), dy = cy - (r.y + r.D / 2);
      r.doorWall = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'); r.winWall = OPP[r.doorWall]; r.doorPos = 0.5; r.winPos = 0.5;
      const b = list[rooms.indexOf(r)];
      if (b.cut && b.cut.w > 0 && b.cut.h > 0 && r.W >= 2.8 && r.D >= 2.8) r.cut = { corner: b.cut.corner, w: Math.round(b.cut.w * r.W * 10) / 10, d: Math.round(b.cut.h * r.D * 10) / 10 };
      if (b.door) { r.doorWall = b.door.wall; r.doorPos = b.door.pos; r.winWall = OPP[r.doorWall]; }
      if (b.ext) {                                   /* window on the longest outside wall that is not the door wall */
        const cand = ['N', 'S', 'W', 'E'].filter(wl => b.ext[wl] && wl !== r.doorWall).sort((p, q) => (q === 'N' || q === 'S' ? r.W : r.D) - (p === 'N' || p === 'S' ? r.W : r.D));
        if (cand.length) r.winWall = cand[0];
      }
      seen[r.name] = (seen[r.name] || 0) + 1; if (seen[r.name] > 1) r.name = (r.name + ' ' + seen[r.name]).slice(0, 24);
    });
    return rooms;
  }
  let busy = false;
  $('#btnDetect').addEventListener('click', async () => {
    if (!trace || busy) return;
    busy = true; $('#btnDetect').disabled = true; say('Looking for rooms\u2026');
    try {
      const boxes = PlanRecognizer.detect(trace.img);
      let list = null, how = '';
      try {
        const sample = window.claude && window.claude.use ? await window.claude.use('sample') : null;
        const lim = sample ? await sample.limits().catch(() => null) : null;
        if (sample && lim && lim.images) {
          say('Found ' + boxes.length + ' enclosed spaces. Asking Claude to name them and read the scale\u2026');
          const res = await PlanRecognizer.label(sample, trace.file, boxes);
          if (res.rooms.length) { list = res.rooms; how = 'named by Claude'; if (res.width_m) { trace.width = res.width_m; how += ', scale read from the drawing'; } }
        }
      } catch (e) { /* AI is optional: fall back to size-based guesses */ }
      if (!list) {
        if (!boxes.length) { say('No enclosed rooms found in this picture. Add rooms by hand over it.'); return; }
        const hgt = trace.width / trace.aspect, types = PlanRecognizer.guessTypes(boxes.map(b => ({ W: b.w * trace.width, D: b.h * hgt })));
        list = boxes.map((b, i) => Object.assign({ type: types[i] }, b)); how = 'types guessed from size';
      }
      state.rooms = roomsFromBoxes(list); state.roomId = state.rooms[0].id; sel = null;
      PlanEditor.refit(); traceUi(); update();
      say('Found ' + state.rooms.length + ' rooms (' + how + '). Check the scale with Set scale, then fix anything that is off. Undo brings the old plan back.');
    } finally { busy = false; $('#btnDetect').disabled = false; }
  });
  let calPts = null;
  $('#btnCal').addEventListener('click', () => {
    calPts = null; $('#calRow').hidden = true; say('Click the two ends of a wall or dimension line whose real length you know.');
    PlanEditor.calibrate((a, b) => {
      calPts = [a, b]; $('#calLabel').textContent = UNITS.v === 'm' ? 'Metres' : 'Feet'; $('#calRow').hidden = false; $('#inCal').value = ''; $('#inCal').focus();
      say('Now type the real length of that line and press Apply.');
    });
    if (state.view !== 'plan') $('#segView button[data-v=plan]').click();
  });
  function applyCal() {
    if (!calPts) return;
    const txt = $('#inCal').value.replace(',', '.').trim(), m = txt.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i);
    if (!m) { say('Type a number, for example 12.5' + (UNITS.v === 'm' ? '' : ' or 12\' 6"') + '.'); return; }
    const real = UNITS.v === 'm' ? parseFloat(m[1]) : parseFloat(m[1]) * 0.3048 + (m[2] ? parseFloat(m[2]) * 0.0254 : 0);
    const meas = Math.hypot(calPts[0].x - calPts[1].x, calPts[0].y - calPts[1].y);
    if (!(real > 0) || meas < 0.05) { say('That line is too short. Press Set scale and try again.'); return; }
    rescale(real / meas); calPts = null; $('#calRow').hidden = true; PlanEditor.endCalibrate(); PlanEditor.refit(); traceUi(); update();
    say('Scale set: the picture is ' + fmtLen(trace ? trace.width : 0) + ' wide.');
  }
  $('#btnCalOk').addEventListener('click', applyCal);
  $('#inCal').addEventListener('keydown', e => { if (e.key === 'Enter') applyCal(); });
  $('#btnTraceOff').addEventListener('click', () => { say(''); $('#calRow').hidden = true; PlanEditor.endCalibrate(); trace = null; $('#inTrace').value = ''; PlanEditor.refit(); traceUi(); PlanEditor.render(); });
  has3d = Scene3D.init($('#cv'), $('#stage'), s => select(s, true), $('#mini'));
  /* While walking, the room chips show the room you are standing in. */
  $('#cv').addEventListener('roomchange', e => { document.querySelectorAll('#walkRooms button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === e.detail ? 'true' : 'false')); });
  update(true); hist.push(snapshot()); hi = 0; histButtons();
  if (state.view !== 'plan') { Scene3D.setView(state.view, planOf(state.roomId) || plans[0], state.walk); Scene3D.resize(); }
})();
