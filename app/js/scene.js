'use strict';
/* 3D view of the whole home: dollhouse orbit, top view and eye-level walk. */
const Scene3D = (function () {
  const H = 2.7, keys = {};
  const cam = { theta: 0.5, phi: 0.9, radius: 12, x: 0, z: 0, yaw: 0, pitch: -0.05, key: '' };
  let T = null, canvas, stage, plans = [], view = 'orbit', sel = null, onPick = function () {};
  let walkTest = null, path = null, floors = [], lastT = 0, mini = null, hover = null, dest = null, hot = null, hotBox = null;
  let bb = { x0: 0, z0: 0, x1: 5, z1: 4 }, texes = [];

  function init(c, s, pickCb, miniSvg) {
    canvas = c; stage = s; onPick = pickCb; mini = miniSvg || null;
    if (typeof THREE === 'undefined') return false;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200); camera.rotation.order = 'YXZ';
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d939c, 0.58));
    const sun = new THREE.DirectionalLight(0xfff1dc, 0.62); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    const roomG = new THREE.Group(), furnG = new THREE.Group(); scene.add(roomG); scene.add(furnG);
    T = { renderer, scene, camera, sun, roomG, furnG, box: null, dirty: true };
    /* Floor rings: one follows the pointer in walk view, one marks where you are walking to. */
    const ring = (op) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 32), new THREE.MeshBasicMaterial({ color: 0xffb52e, transparent: true, opacity: op, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 5; scene.add(m); return m; };
    hover = ring(0.55); dest = ring(0.95);
    if (mini) mini.addEventListener('click', miniClick);
    bindInput();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);
    new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (window.matchMedia) try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) {}
    applyTheme(); resize(); tick();
    return true;
  }
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function applyTheme() { if (!T) return; T.scene.background = new THREE.Color(cssVar('--stage') || '#DCE2E8'); highlight(); }
  function clearGroup(g) { while (g.children.length) { const c = g.children[0]; g.remove(c); c.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } }
  function plane(w, h, mat, pos, rotY) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(pos[0], pos[1], pos[2]); m.rotation.y = rotY; return m; }

  /* One solid wall with real thickness, a door opening with an open leaf and a glazed window opening.
     The wall is a group scaled along Y, so it can grow from the floor and drop to a stub when it would block the view. */
  const WT = 0.06, LOW = 0.05;
  let walls = [], wallMemo = {};
  function buildWall(r, o, seg, wm, white, S) {
    const n = seg.n, g = new THREE.Group(), L = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
    const dir = [(seg.b[0] - seg.a[0]) / L, (seg.b[1] - seg.a[1]) / L], hz = Math.abs(dir[0]) > 0.5;
    const pt = t => [seg.a[0] + dir[0] * t, seg.a[1] + dir[1] * t];
    const box = (t0, t1, y0, y1, mat, depth, off) => {
      if (t1 - t0 < 0.005 || y1 - y0 < 0.005) return null;
      const d = depth || WT, c = pt((t0 + t1) / 2), q = (off == null ? d / 2 : off);
      const m = new THREE.Mesh(new THREE.BoxGeometry(hz ? t1 - t0 : d, y1 - y0, hz ? d : t1 - t0), mat);
      m.position.set(c[0] + n[0] * q, (y0 + y1) / 2, c[1] + n[1] * q); m.receiveShadow = true; g.add(m); return m;
    };
    /* Openings sit on the room's sides; t on a side is shifted to t along this segment. */
    const ops = [];
    const dw = r.door.width + 0.04;
    if (seg.side && r.door.wall === seg.side) ops.push({ t0: r.door.t - seg.t0 - dw / 2, t1: r.door.t - seg.t0 + dw / 2, y0: 0, y1: 2.05, door: true });
    if (seg.side && r.win.wall === seg.side) { const w0 = r.win.t - seg.t0 - 0.7, w1 = w0 + 1.4; if (!(ops.length && w0 < ops[0].t1 && w1 > ops[0].t0)) ops.push({ t0: w0, t1: w1, y0: 0.9, y1: 2.2 }); }
    ops.forEach(op => { op.t0 = clamp(op.t0, 0, L); op.t1 = clamp(op.t1, 0, L); });
    ops.sort((a, b) => a.t0 - b.t0);
    let cur = 0;
    ops.forEach(op => {
      if (op.t1 - op.t0 < 0.2) return;
      box(cur, op.t0, 0, H, wm); box(op.t0, op.t1, 0, op.y0, wm); box(op.t0, op.t1, op.y1, H, wm); cur = op.t1;
      if (op.door) {
        const dr = r.door, lw = dr.width, wood = M(shade(S.wood[1], -0.12), 0.7), left = dr.side === 'left';
        if (dr.type === 'swing') {
          /* Hinge at the chosen end; the leaf stands open about 75 degrees into the room or out of it. */
          const a = left ? dir : [-dir[0], -dir[1]], nn = dr.swing === 'in' ? n : [-n[0], -n[1]], ang = 1.3;
          const d = [a[0] * Math.cos(ang) + nn[0] * Math.sin(ang), a[1] * Math.cos(ang) + nn[1] * Math.sin(ang)];
          const hinge = pt(left ? op.t0 : op.t1), face = dr.swing === 'in' ? WT : 0, piv = new THREE.Group();
          piv.position.set(hinge[0] + n[0] * face, 0, hinge[1] + n[1] * face); piv.rotation.y = Math.atan2(-d[1], d[0]);
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.02, 2.0, 0.04), wood); leaf.position.set((lw - 0.02) / 2, 1.0, 0); leaf.castShadow = true;
          piv.add(leaf); g.add(piv);
        } else if (dr.type === 'pocket') {
          /* Most of the leaf is hidden inside the wall on its sliding side; a third shows in the opening. */
          const sh = left ? -0.7 * lw : 0.7 * lw; box(op.t0 + sh, op.t1 + sh, 0, 2.02, wood, 0.034, WT / 2);
        } else if (dr.type === 'barn') {
          /* The leaf hangs on a rail on the room side of the wall, slid open beside the opening. */
          const sh = left ? -(lw - 0.04) : lw - 0.04;
          box(op.t0 + sh - 0.03, op.t1 + sh + 0.03, 0.02, 2.12, wood, 0.04, WT + 0.035);
          const rail = left ? [op.t0 - lw - 0.08, op.t1 + 0.04] : [op.t0 - 0.04, op.t1 + lw + 0.08];
          box(rail[0], rail[1], 2.16, 2.2, M(0x1c1c1e, 0.5, 0.5), 0.03, WT + 0.035);
        }
      } else {
        box(op.t0, op.t1, op.y0, op.y1, new THREE.MeshStandardMaterial({ color: lin(0xcfe5f4), transparent: true, opacity: 0.45, roughness: 0.1 }), 0.012, WT / 2);
        box(op.t0, op.t1, op.y0, op.y0 + 0.04, white, WT + 0.02, WT / 2); box(op.t0, op.t1, op.y1 - 0.04, op.y1, white, WT + 0.02, WT / 2);
        const mid = (op.t0 + op.t1) / 2; box(mid - 0.02, mid + 0.02, op.y0, op.y1, white, WT + 0.02, WT / 2);
      }
    });
    box(cur, L, 0, H, wm);
    const key = o.id + ':' + seg.a.join(',') + ':' + seg.b.join(','), c = pt(L / 2), start = wallMemo[key] == null ? 0.02 : wallMemo[key];
    g.scale.y = start;
    walls.push({ g, key, nx: -n[0], nz: -n[1], cx: o.x + c[0], cz: o.y + c[1], cur: start });
    return g;
  }
  /* A flat mesh in the room's outline. Floor faces up from y = 0, ceiling faces down at y = H. */
  function outlineMesh(room, mat, ceiling) {
    const pts = roomPolygon(room), sh = new THREE.Shape();
    pts.forEach((p, i) => { const y = ceiling ? p[1] : -p[1]; if (i) sh.lineTo(p[0], y); else sh.moveTo(p[0], y); });
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat);
    m.rotation.x = ceiling ? Math.PI / 2 : -Math.PI / 2; if (ceiling) m.position.y = H;
    return m;
  }
  function animateWalls() {
    const cp = T.camera.position; let moving = false;
    walls.forEach(wl => {
      const target = view === 'walk' ? 1 : ((cp.x - wl.cx) * wl.nx + (cp.z - wl.cz) * wl.nz > 0 ? LOW : 1);
      if (Math.abs(target - wl.cur) > 0.002) { wl.cur += (target - wl.cur) * 0.16; moving = true; } else wl.cur = target;
      wl.g.scale.y = wl.cur; wallMemo[wl.key] = wl.cur;
    });
    return moving;
  }
  function build(p, style) {
    plans = p;
    if (!T) return;
    clearGroup(T.roomG); clearGroup(T.furnG); walls = []; floors = []; path = null; if (dest) dest.visible = false; hot = null; if (hotBox) { T.scene.remove(hotBox); hotBox = null; }
    texes.forEach(t => t.dispose()); texes = [];
    if (!plans.length) { T.dirty = true; return; }
    const S = STYLES[style];
    bb = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    plans.forEach(pl => { const o = pl.room; bb.x0 = Math.min(bb.x0, o.x); bb.z0 = Math.min(bb.z0, o.y); bb.x1 = Math.max(bb.x1, o.x + o.W); bb.z1 = Math.max(bb.z1, o.y + o.D); });
    const white = M(0xfbfaf7, 0.8), wm = M(S.wall, 1), base = floorTexture(style);
    plans.forEach(pl => {
      const r = pl.r, o = pl.room, g = new THREE.Group(); g.position.set(o.x, 0, o.y);
      const fin = pl.lines.find(l => l.area);
      let fmat;
      if (fin) {
        const tile = fin.cat === 'tile', tex = (tile ? tileTexture(fin.item.c1) : base).clone(); tex.needsUpdate = true;
        tex.repeat.set(tile ? 1 / 1.6 : 1 / 2.2, tile ? 1 / 1.6 : 1 / 2.2); texes.push(tex);
        fmat = new THREE.MeshStandardMaterial({ map: tex, roughness: tile ? 0.45 : 0.75 });
      } else fmat = M(0x9a9a98, 0.95);
      const fl = outlineMesh(o, fmat, false); fl.receiveShadow = true; fl.userData.floor = true; g.add(fl); floors.push(fl);
      g.add(outlineMesh(o, M(0xf7f6f3, 1), true));
      const wmr = /^#[0-9a-f]{6}$/i.test(o.wallColor || '') ? M(parseInt(o.wallColor.slice(1), 16), 1) : wm;
      wallSegments(r).forEach(seg => g.add(buildWall(r, o, seg, wmr, white, S)));
      T.roomG.add(g);
      const byCat = {}; pl.lines.forEach(l => byCat[l.cat] = l.item);
      pl.placed.forEach(q => {
        const it = byCat[q.cat]; if (!it) return;
        const fg = new THREE.Group(); BUILD[it.cat](fg, it);
        fg.position.set(o.x + q.cx, 0, o.y + q.cz); fg.rotation.y = q.rot; fg.userData = { roomId: o.id, cat: q.cat };
        T.furnG.add(fg);
      });
    });
    const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2, ext = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0) / 2 + 3;
    T.sun.position.set(cx + 6, 11, cz + 5); T.sun.target.position.set(cx, 0, cz);
    const sc = T.sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 0.5; sc.far = 40; sc.updateProjectionMatrix();
    const key = [bb.x0, bb.z0, bb.x1, bb.z1].join(',');
    walkTest = walkArea(plans);
    if (cam.key !== key) { cam.key = key; cam.radius = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0) * 1.4 + 4; }
    if (!inside(cam.x, cam.z)) enterWalk(plans.find(p => p.room.id === cam.roomId) || plans[0]);
    drawMini();
    highlight(); T.dirty = true;
  }
  /* A light outline on the piece under the pointer, so it is clear what a double-click will pick. */
  function setHot(h) {
    if (!T || (h && hot && h.roomId === hot.roomId && h.cat === hot.cat) || (!h && !hot)) return;
    hot = h; if (hotBox) { T.scene.remove(hotBox); hotBox = null; }
    if (h && !(sel && sel.roomId === h.roomId && sel.cat === h.cat)) {
      hotBox = new THREE.Group();
      T.furnG.children.filter(c => c.userData.roomId === h.roomId && c.userData.cat === h.cat).forEach(c => hotBox.add(new THREE.BoxHelper(c, 0xffb52e)));
      T.scene.add(hotBox);
    }
    canvas.style.cursor = h ? 'pointer' : '';
    T.dirty = true;
  }
  function highlight() {
    if (!T) return;
    if (T.box) { T.scene.remove(T.box); T.box = null; }
    if (sel) {
      const g = new THREE.Group(), col = new THREE.Color(cssVar('--accent') || '#C8501F');
      T.furnG.children.filter(c => c.userData.roomId === sel.roomId && c.userData.cat === sel.cat).forEach(c => g.add(new THREE.BoxHelper(c, col)));
      T.box = g; T.scene.add(g);
    }
    T.dirty = true;
  }
  /* Walls block; doors let you through (see walkArea). */
  function inside(x, z) { return walkTest ? walkTest(x, z) : true; }
  /* Stand just inside the room's door, looking into the room; fall back to the middle of its largest part. */
  function enterWalk(pl) {
    if (!pl) return;
    const r = pl.r, o = pl.room, n = WALLS[r.door.wall].n, pt = wallPoint(r, r.door.wall, r.door.t), q = maxRects(r)[0];
    const mx = o.x + (q.x0 + q.x1) / 2, mz = o.y + (q.z0 + q.z1) / 2;
    cam.x = o.x + pt[0] + n[0] * 0.8; cam.z = o.y + pt[1] + n[1] * 0.8;
    if (!inside(cam.x, cam.z)) { cam.x = mx; cam.z = mz; }
    cam.yaw = Math.hypot(mx - cam.x, mz - cam.z) > 0.3 ? Math.atan2(-(mx - cam.x), -(mz - cam.z)) : Math.atan2(n[0], n[1]);
    cam.pitch = -0.06; cam.roomId = o.id; path = null; if (dest) dest.visible = false;
    if (canvas) canvas.dispatchEvent(new CustomEvent('roomchange', { detail: o.id }));
    if (T) T.dirty = true; drawMini();
  }
  /* Entering the walk view puts you back where you last stood, if that spot still exists; otherwise at the room's door. */
  function setView(v, pl, pose) {
    view = v;
    if (v === 'walk') {
      if (pose && isFinite(pose.x) && isFinite(pose.z) && inside(pose.x, pose.z)) {
        cam.x = pose.x; cam.z = pose.z; cam.yaw = pose.yaw || 0; cam.pitch = clamp(pose.pitch || 0, -1.1, 1.1); path = null; if (dest) dest.visible = false; onMoved();
      } else enterWalk(pl);
    }
    if (T) T.dirty = true; if (hover) hover.visible = false; setHot(null); drawMini();
  }
  function pose() { return { x: cam.x, z: cam.z, yaw: cam.yaw, pitch: cam.pitch, roomId: cam.roomId }; }
  /* Walk to a point on the floor along the shortest way through doors. */
  function walkTo(p) {
    if (!walkTest) return false;
    const pp = findPath(walkTest, [cam.x, cam.z], p);
    if (!pp || !pp.length) {
      /* No way on foot (the room's door may open outside): step straight into the room that was clicked. */
      const pl = plans.find(q => roomRects(q.room).some(r => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.z0 && p[1] <= r.z1));
      if (!pl) return false;
      enterWalk(pl); if (inside(p[0], p[1])) { cam.x = p[0]; cam.z = p[1]; }
      onMoved(); return true;
    }
    path = pp; const e = pp[pp.length - 1]; dest.position.set(e[0], 0.012, e[1]); dest.visible = true; T.dirty = true;
    return true;
  }
  function goRoom(id) { const pl = plans.find(p => p.room.id === id); if (pl) enterWalk(pl); }
  /* ---------- mini-map ---------- */
  const SNS = 'http://www.w3.org/2000/svg';
  function sv(name, attrs, parent) { const e = document.createElementNS(SNS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  let miniMe = null;
  function drawMini() {
    if (!mini || !plans.length) return;
    mini.textContent = '';
    const pad = 0.6;
    mini.setAttribute('viewBox', [bb.x0 - pad, bb.z0 - pad, bb.x1 - bb.x0 + 2 * pad, bb.z1 - bb.z0 + 2 * pad].join(' '));
    plans.forEach(pl => {
      const o = pl.room;
      sv('path', { d: 'M ' + roomPolygon(o).map(p => (o.x + p[0]) + ' ' + (o.y + p[1])).join(' L ') + ' Z', class: 'mroom' + (o.id === cam.roomId ? ' on' : '') }, mini);
      const r = pl.r, w = r.door.width, a = wallPoint(r, r.door.wall, r.door.t - w / 2), b = wallPoint(r, r.door.wall, r.door.t + w / 2);
      sv('line', { x1: o.x + a[0], y1: o.y + a[1], x2: o.x + b[0], y2: o.y + b[1], class: 'mdoor' }, mini);
    });
    miniMe = sv('g', { class: 'mme' }, mini);
    sv('path', { d: 'M 0 0 L -0.9 -1.6 A 1.85 1.85 0 0 1 0.9 -1.6 Z', class: 'mcone' }, miniMe);
    sv('circle', { cx: 0, cy: 0, r: 0.28, class: 'mdot' }, miniMe);
    moveMini();
  }
  function moveMini() {
    if (!miniMe) return;
    /* yaw 0 looks toward -z (up on the map); the cone is drawn pointing up. */
    miniMe.setAttribute('transform', 'translate(' + cam.x + ' ' + cam.z + ') rotate(' + (-cam.yaw * 180 / Math.PI) + ')');
  }
  function miniClick(e) {
    if (view !== 'walk') return;
    const pt = mini.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = mini.getScreenCTM(); if (!m) return;
    const w = pt.matrixTransform(m.inverse()); walkTo([w.x, w.y]);
  }
  function setSelected(s) { sel = s; highlight(); }
  function placeCamera() {
    const c = T.camera, cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
    if (view === 'walk') { c.fov = 72; c.position.set(cam.x, 1.6, cam.z); c.rotation.set(cam.pitch, cam.yaw, 0); }
    else { c.fov = 50; c.position.set(cx + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta), 0.7 + cam.radius * Math.cos(cam.phi), cz + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta)); c.lookAt(cx, 0.7, cz); }
    c.updateProjectionMatrix();
  }
  function tick() {
    requestAnimationFrame(tick);
    if (!T || !plans.length) return;
    const now = performance.now(), dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0); lastT = now;
    if (view === 'walk') {
      const f = (keys.KeyW || keys.ArrowUp || keys.padF ? 1 : 0) - (keys.KeyS || keys.ArrowDown || keys.padB ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      const tr = (keys.ArrowLeft || keys.KeyQ || keys.padL ? 1 : 0) - (keys.ArrowRight || keys.KeyE || keys.padR ? 1 : 0);
      if (f || s || tr) {
        path = null; dest.visible = false;
        const v = (keys.ShiftLeft || keys.ShiftRight ? 2.6 : 1.5) * dt; cam.yaw += tr * 1.9 * dt;
        const nx = cam.x + (-Math.sin(cam.yaw) * f + Math.cos(cam.yaw) * s) * v, nz = cam.z + (-Math.cos(cam.yaw) * f - Math.sin(cam.yaw) * s) * v;
        if (inside(nx, nz)) { cam.x = nx; cam.z = nz; } else if (inside(nx, cam.z)) cam.x = nx; else if (inside(cam.x, nz)) cam.z = nz;
        T.dirty = true; onMoved();
      } else if (path) {
        /* Follow the planned route: turn toward the next point while walking, slow down on sharp turns. */
        const tg = path[0], dx = tg[0] - cam.x, dz = tg[1] - cam.z, d = Math.hypot(dx, dz);
        let dy = Math.atan2(-dx, -dz) - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (d > 0.05) cam.yaw += dy * Math.min(1, dt * 7);
        const stp = 1.6 * dt * (Math.abs(dy) > 1.1 ? 0.25 : 1);
        if (d <= stp) { cam.x = tg[0]; cam.z = tg[1]; path.shift(); if (!path.length) { path = null; dest.visible = false; } }
        else { cam.x += dx / d * stp; cam.z += dz / d * stp; }
        cam.pitch += (-0.06 - cam.pitch) * Math.min(1, dt * 4);
        T.dirty = true; onMoved();
      }
    }
    if (canvas.clientWidth && (T.dirty || T.growing)) { T.dirty = false; placeCamera(); T.growing = animateWalls(); T.renderer.render(T.scene, T.camera); }
  }
  /* Which room you are in, for the mini-map and for re-entering after an edit. */
  function onMoved() {
    const pl = plans.find(p => roomRects(p.room).some(q => cam.x >= q.x0 && cam.x <= q.x1 && cam.z >= q.z0 && cam.z <= q.z1));
    if (pl && pl.room.id !== cam.roomId) { cam.roomId = pl.room.id; drawMini(); canvas.dispatchEvent(new CustomEvent('roomchange', { detail: pl.room.id })); } else moveMini();
  }
  function resize() {
    if (!T) return; const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    T.renderer.setSize(w, h, false); T.camera.aspect = w / h; T.dirty = true;
  }
  function bindInput() {
    const ptr = new Map(); let moved = 0, pinch = 0;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0;
      if (ptr.size === 2) { const a = [...ptr.values()]; pinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
    });
    canvas.addEventListener('pointermove', e => {
      const p = ptr.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (ptr.size === 2) { const a = [...ptr.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); if (pinch && view === 'orbit') cam.radius = clamp(cam.radius * pinch / d, 2.5, 60); pinch = d; }
      else if (view === 'orbit') { cam.theta -= dx * 0.008; cam.phi = clamp(cam.phi - dy * 0.006, 0.05, 1.5); }
      else { cam.yaw += dx * 0.005; cam.pitch = clamp(cam.pitch + dy * 0.004, -1.1, 1.1); moveMini(); }
      T.dirty = true;
    });
    /* In walk view a ring on the floor shows where a click would take you. */
    canvas.addEventListener('pointermove', e => {
      if (ptr.size || !floors.length || e.pointerType === 'touch') { if (hover.visible) { hover.visible = false; T.dirty = true; } return; }
      const h = firstHit(e), furn = h && h.cat && h.cat !== 'rug';
      setHot(furn ? { roomId: h.roomId, cat: h.cat } : null);
      const ok = view === 'walk' && h && !furn && inside(h.x, h.z);
      if (hover.visible !== !!ok || ok) { hover.visible = !!ok; if (ok) hover.position.set(h.x, 0.011, h.z); T.dirty = true; }
    });
    canvas.addEventListener('pointerleave', () => { setHot(null); if (hover.visible) { hover.visible = false; T.dirty = true; } });
    /* Double-click picks a piece of furniture; single clicks walk, so nothing is chosen by accident. */
    canvas.addEventListener('dblclick', e => {
      const h = firstHit(e);
      if (h && h.cat) { path = null; if (dest) dest.visible = false; setHot(null); onPick({ roomId: h.roomId, cat: h.cat }); }
    });
    const end = e => {
      const had = ptr.has(e.pointerId); ptr.delete(e.pointerId); if (ptr.size < 2) pinch = 0;
      if (had && e.type === 'pointerup' && moved < 6) pick(e);
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (view === 'orbit') { cam.radius = clamp(cam.radius * (1 + e.deltaY * 0.001), 2.5, 60); T.dirty = true; return; }
      /* In the walk view the wheel steps forward and back, at most half a metre per notch. */
      path = null; if (dest) dest.visible = false;
      const st = clamp(-e.deltaY * (e.deltaMode === 1 ? 0.12 : 0.004), -0.5, 0.5);
      for (let k = 0, n = Math.ceil(Math.abs(st) / 0.05); k < n; k++) {
        const v = st / n, nx = cam.x - Math.sin(cam.yaw) * v, nz = cam.z - Math.cos(cam.yaw) * v;
        if (inside(nx, nz)) { cam.x = nx; cam.z = nz; } else if (inside(nx, cam.z)) cam.x = nx; else if (inside(cam.x, nz)) cam.z = nz; else break;
      }
      T.dirty = true; onMoved();
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (view !== 'walk' || canvas.hidden) return; const t = e.target.tagName; if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
      if (/^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code)) { keys[e.code] = true; if (!/^Shift/.test(e.code)) e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  }
  function rayFrom(e) {
    const rc = canvas.getBoundingClientRect(), v = new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height * 2 - 1));
    const ray = new THREE.Raycaster(); ray.setFromCamera(v, T.camera); return ray;
  }
  /* The nearest thing under the pointer: a piece of furniture {roomId, cat, x, z} or the floor {x, z}. */
  function firstHit(e) {
    for (const h of rayFrom(e).intersectObjects(T.furnG.children.concat(floors), true)) {
      let o = h.object; while (o && !o.userData.cat && !o.userData.floor) o = o.parent;
      if (!o) continue;
      return { roomId: o.userData.roomId, cat: o.userData.cat || null, x: h.point.x, z: h.point.z };
    }
    return null;
  }
  /* A single click walks to the floor spot (or rug) in the walk view; in the overview a click on empty space clears the selection. */
  function pick(e) {
    const h = firstHit(e);
    if (view === 'walk') { if (h && (!h.cat || h.cat === 'rug')) walkTo([h.x, h.z]); return; }
    if (!h || !h.cat) onPick(null);
  }
  function hold(key, on) { keys[key] = on; }
  /* A clean picture of the current view for the photo render: no rings or selection boxes, cropped to the nearest
     of 3:2, 2:3 or 1:1 and scaled to the size the image model takes. Returns {image, shape} or null. */
  function snapshot() {
    if (!T || !plans.length) return null;
    const hidden = [hover, dest, T.box, hotBox].filter(o => o && o.visible); hidden.forEach(o => { o.visible = false; });
    placeCamera(); T.renderer.render(T.scene, T.camera);
    const cw = canvas.width, ch = canvas.height, a = cw / ch;
    const shape = a > 1.2 ? 'landscape' : a < 0.84 ? 'portrait' : 'square', out = { landscape: [1536, 1024], portrait: [1024, 1536], square: [1024, 1024] }[shape];
    const ta = out[0] / out[1], sw = a > ta ? ch * ta : cw, sh = a > ta ? ch : cw / ta;
    const c = document.createElement('canvas'); c.width = out[0]; c.height = out[1];
    c.getContext('2d').drawImage(canvas, (cw - sw) / 2, (ch - sh) / 2, sw, sh, 0, 0, out[0], out[1]);
    hidden.forEach(o => { o.visible = true; }); T.dirty = true;
    return { image: c.toDataURL('image/jpeg', 0.92), shape, view: view === 'walk' ? 'walk' : 'orbit', roomId: cam.roomId };
  }
  function regrow() { wallMemo = {}; walls.forEach(wl => { wl.cur = 0.02; wl.g.scale.y = 0.02; }); if (T) T.growing = true; }
  return { init, build, setView, setSelected, resize, hold, regrow, goRoom, walkTo, pose, snapshot, refresh: function () { if (T) T.dirty = true; } };
})();
