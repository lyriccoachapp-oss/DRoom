'use strict';
/* App state, UI wiring and the shopping list. */
(function () {
  const KEY = 'droom.home.v2';
  const SIZE = { living: [4.8, 4.0], bedroom: [3.8, 3.6], kitchen: [3.8, 3.2], bathroom: [2.4, 2.2], dining: [4.0, 3.6], office: [3.2, 3.0] };
  let uid = 1;
  const newId = () => 'r' + Date.now().toString(36) + (uid++);
  function makeRoom(type, x, y, W, D) {
    return { id: newId(), name: ROOMS[type].name, type, x, y, W, D, doorWall: 'S', doorPos: 0.82, winWall: 'N', winPos: 0.5, overrides: {}, removed: [] };
  }
  function defaults() {
    const a = makeRoom('living', 0, 0, 5.4, 4.2), b = makeRoom('bedroom', 5.4, 0, 4.0, 3.6), k = makeRoom('kitchen', 0, 4.2, 3.8, 3.2), t = makeRoom('bathroom', 5.4, 3.6, 2.4, 2.2);
    b.doorPos = 0.2; k.doorWall = 'N'; k.winWall = 'S'; t.doorWall = 'W'; t.doorPos = 0.7; t.winWall = 'E';
    return { style: 'scandi', budget: 20000, units: 'ft', rooms: [a, b, k, t], roomId: a.id, view: 'plan' };
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
      if (Math.min(a.x + a.W, b.x + b.W) - Math.max(a.x, b.x) > 0.05 && Math.min(a.y + a.D, b.y + b.D) - Math.max(a.y, b.y) > 0.05) { clash.add(a.id); clash.add(b.id); names.push(a.name + ' and ' + b.name); }
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
      $('#inW').value = r.W; $('#inD').value = r.D; $('#outW').textContent = fmtLen(r.W); $('#outD').textContent = fmtLen(r.D);
    }
    const area = state.rooms.reduce((s, x) => s + x.W * x.D, 0);
    $('#homeDims').textContent = state.rooms.length + (state.rooms.length === 1 ? ' room · ' : ' rooms · ') + fmtArea(area);
    $('#hint').textContent = state.view === 'plan' ? 'Drag rooms, corners and markers to edit the plan'
      : state.view === 'walk' ? 'Drag to look around · W A S D or arrows to walk'
      : 'Drag to rotate · scroll to zoom · tap furniture to swap it';
    $('#walkpad').hidden = state.view !== 'walk';
    $('#plan').style.display = state.view === 'plan' ? '' : 'none';
    $('#cv').hidden = state.view === 'plan' || !has3d;
    $('#fail').hidden = state.view === 'plan' || has3d;
  }
  const REASON = { budget: 'over budget', space: 'does not fit', removed: 'removed by you' };
  function renderList() {
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
  function select(s, scroll) {
    sel = s; if (s) state.roomId = s.roomId;
    renderSide(); renderList(); PlanEditor.render(); Scene3D.setSelected(sel);
    if (scroll && s) { const n = document.querySelector('.item.sel'); if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' }); }
  }
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
    state.view = v; save(); renderSide();
    if (v !== 'plan') { if (sceneStale) syncScene(); Scene3D.setView(v, planOf(state.roomId) || plans[0]); Scene3D.resize(); }
  });
  $('#inBudget').addEventListener('input', e => { state.budget = parseInt(e.target.value, 10); update(); });
  $('#inName').addEventListener('input', e => { const r = room(); if (r) { r.name = e.target.value.trim() || ROOMS[r.type].name; update(); } });
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
  [['#padF', 'padF'], ['#padB', 'padB']].forEach(a => {
    const b = $(a[0]);
    b.addEventListener('pointerdown', e => { e.preventDefault(); Scene3D.hold(a[1], true); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => Scene3D.hold(a[1], false)));
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
  $('#inTrace').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { const img = new Image(); img.onload = () => { trace = { src: rd.result, aspect: img.width / img.height || 1, width: 12, opacity: 0.5 }; PlanEditor.refit(); traceUi(); PlanEditor.render(); }; img.src = rd.result; };
    rd.readAsDataURL(f);
  });
  $('#inTraceW').addEventListener('input', e => { if (trace) { trace.width = parseFloat(e.target.value); PlanEditor.refit(); traceUi(); PlanEditor.render(); } });
  $('#inTraceO').addEventListener('input', e => { if (trace) { trace.opacity = parseFloat(e.target.value); traceUi(); PlanEditor.render(); } });
  $('#btnTraceOff').addEventListener('click', () => { trace = null; $('#inTrace').value = ''; PlanEditor.refit(); traceUi(); PlanEditor.render(); });
  has3d = Scene3D.init($('#cv'), $('#stage'), s => select(s, true));
  update(true); hist.push(snapshot()); hi = 0; histButtons();
  if (state.view !== 'plan') { Scene3D.setView(state.view, planOf(state.roomId) || plans[0]); Scene3D.resize(); }
})();
