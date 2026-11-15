'use strict';
/* 3D view of the whole home: dollhouse orbit, top view and eye-level walk. */
const Scene3D = (function () {
  const H = 2.7, keys = {};
  const cam = { theta: 0.5, phi: 0.9, radius: 12, x: 0, z: 0, yaw: 0, pitch: -0.05, key: '' };
  let T = null, canvas, stage, plans = [], view = 'orbit', sel = null, onPick = function () {};
  let bb = { x0: 0, z0: 0, x1: 5, z1: 4 }, texes = [];

  function init(c, s, pickCb) {
    canvas = c; stage = s; onPick = pickCb;
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
    if (seg.side && r.door.wall === seg.side) ops.push({ t0: r.door.t - seg.t0 - 0.45, t1: r.door.t - seg.t0 + 0.45, y0: 0, y1: 2.05, door: true });
    if (seg.side && r.win.wall === seg.side) { const w0 = r.win.t - seg.t0 - 0.7, w1 = w0 + 1.4; if (!(ops.length && w0 < ops[0].t1 && w1 > ops[0].t0)) ops.push({ t0: w0, t1: w1, y0: 0.9, y1: 2.2 }); }
    ops.forEach(op => { op.t0 = clamp(op.t0, 0, L); op.t1 = clamp(op.t1, 0, L); });
    ops.sort((a, b) => a.t0 - b.t0);
    let cur = 0;
    ops.forEach(op => {
      if (op.t1 - op.t0 < 0.2) return;
      box(cur, op.t0, 0, H, wm); box(op.t0, op.t1, 0, op.y0, wm); box(op.t0, op.t1, op.y1, H, wm); cur = op.t1;
      if (op.door) {
        const ang = 1.3, d = [dir[0] * Math.cos(ang) + n[0] * Math.sin(ang), dir[1] * Math.cos(ang) + n[1] * Math.sin(ang)];
        const hinge = pt(op.t0), piv = new THREE.Group();
        piv.position.set(hinge[0] + n[0] * WT, 0, hinge[1] + n[1] * WT); piv.rotation.y = Math.atan2(-d[1], d[0]);
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.86, 2.0, 0.04), M(shade(S.wood[1], -0.12), 0.7)); leaf.position.set(0.43, 1.0, 0); leaf.castShadow = true;
        piv.add(leaf); g.add(piv);
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
    clearGroup(T.roomG); clearGroup(T.furnG); walls = [];
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
      const fl = outlineMesh(o, fmat, false); fl.receiveShadow = true; g.add(fl);
      g.add(outlineMesh(o, M(0xf7f6f3, 1), true));
      wallSegments(r).forEach(seg => g.add(buildWall(r, o, seg, wm, white, S)));
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
    if (cam.key !== key) { cam.key = key; cam.radius = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0) * 1.4 + 4; if (!inside(cam.x, cam.z)) { cam.x = cx; cam.z = cz; } }
    highlight(); T.dirty = true;
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
  /* Walking stays inside rooms; a point near a shared edge of two rectangles (a doorway between rooms, or the two halves of an L) is allowed. */
  function inside(x, z) {
    const rects = []; plans.forEach(pl => rects.push.apply(rects, roomRects(pl.room)));
    const inR = (q, m) => x >= q.x0 + m && x <= q.x1 - m && z >= q.z0 + m && z <= q.z1 - m;
    return rects.some(q => inR(q, 0.15)) || rects.filter(q => inR(q, -0.16)).length > 1;
  }
  function enterWalk(pl) {
    if (!pl) return;
    const r = pl.r, o = pl.room, n = WALLS[r.door.wall].n, pt = wallPoint(r, r.door.wall, r.door.t);
    cam.x = o.x + clamp(pt[0] + n[0] * 0.7, 0.3, r.W - 0.3); cam.z = o.y + clamp(pt[1] + n[1] * 0.7, 0.3, r.D - 0.3);
    cam.yaw = Math.atan2(-(o.x + r.W / 2 - cam.x), -(o.y + r.D / 2 - cam.z)); cam.pitch = -0.08;
  }
  function setView(v, pl) { view = v; if (v === 'walk') enterWalk(pl); if (T) T.dirty = true; }
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
    if (view === 'walk') {
      const f = (keys.KeyW || keys.ArrowUp || keys.padF ? 1 : 0) - (keys.KeyS || keys.ArrowDown || keys.padB ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), tr = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0);
      if (f || s || tr) {
        const v = 0.045; cam.yaw += tr * 0.03;
        const nx = cam.x + (-Math.sin(cam.yaw) * f + Math.cos(cam.yaw) * s) * v, nz = cam.z + (-Math.cos(cam.yaw) * f - Math.sin(cam.yaw) * s) * v;
        if (inside(nx, nz)) { cam.x = nx; cam.z = nz; } else if (inside(nx, cam.z)) cam.x = nx; else if (inside(cam.x, nz)) cam.z = nz;
        T.dirty = true;
      }
    }
    if (canvas.clientWidth && (T.dirty || T.growing)) { T.dirty = false; placeCamera(); T.growing = animateWalls(); T.renderer.render(T.scene, T.camera); }
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
      else { cam.yaw += dx * 0.005; cam.pitch = clamp(cam.pitch + dy * 0.004, -1.1, 1.1); }
      T.dirty = true;
    });
    const end = e => {
      const had = ptr.has(e.pointerId); ptr.delete(e.pointerId); if (ptr.size < 2) pinch = 0;
      if (had && e.type === 'pointerup' && moved < 6) pick(e);
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => { if (view !== 'orbit') return; e.preventDefault(); cam.radius = clamp(cam.radius * (1 + e.deltaY * 0.001), 2.5, 60); T.dirty = true; }, { passive: false });
    window.addEventListener('keydown', e => {
      if (view !== 'walk' || canvas.hidden) return; const t = e.target.tagName; if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return;
      if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)) { keys[e.code] = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  }
  function pick(e) {
    const rc = canvas.getBoundingClientRect(), v = new THREE.Vector2((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height * 2 - 1));
    const ray = new THREE.Raycaster(); ray.setFromCamera(v, T.camera);
    let hit = null;
    for (const h of ray.intersectObjects(T.furnG.children, true)) { let o = h.object; while (o && !o.userData.cat) o = o.parent; if (o) { hit = o.userData; if (hit.cat !== 'rug') break; } }
    onPick(hit ? { roomId: hit.roomId, cat: hit.cat } : null);
  }
  function hold(key, on) { keys[key] = on; }
  function regrow() { wallMemo = {}; walls.forEach(wl => { wl.cur = 0.02; wl.g.scale.y = 0.02; }); if (T) T.growing = true; }
  return { init, build, setView, setSelected, resize, hold, regrow, refresh: function () { if (T) T.dirty = true; } };
})();
