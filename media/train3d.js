// @ts-check
/* global THREE */
// "Dependency Express": ride a train along an import chain through a 3D space where files are planets,
// libraries are metal moons, vulnerable packages are skulls and imports are the relations between them.
(function () {
  const LABEL_NEAR = 70;       // labels for everything closer than this
  const LABEL_LOOK_DEG = 7;    // …and for what the camera looks at
  const LABEL_LOOK_DIST = 420;
  const MAX_LABELS = 36;

  let session = null;

  // ---------------------------------------------------------------- layout
  /** Simple 3D force layout (fine for a few hundred nodes). */
  /**
   * Force layout in 3D. `radii` (optional) are the visual radii of the bodies – they get extra room so planets,
   * rings and tunnel portals never overlap.
   */
  function layout3d(nodes, links, layered, radii) {
    const n = nodes.length;
    const R = radii || nodes.map(() => 6);
    const spread = 160 + Math.cbrt(n) * 90;
    const P = nodes.map((nd, i) => ({
      x: (Math.random() - 0.5) * spread, y: layered ? -(nd.layer || 0) * 70 : (Math.random() - 0.5) * spread, z: (Math.random() - 0.5) * spread, vx: 0, vy: 0, vz: 0, i,
    }));
    const L = links.map(l => [l.s, l.t]);
    for (let it = 0; it < 260; it++) {
      const alpha = 1 - it / 260;
      for (let a = 0; a < n; a++) {
        const pa = P[a];
        for (let b = a + 1; b < n; b++) {
          const pb = P[b];
          let dx = pa.x - pb.x, dy = pa.y - pb.y, dz = pa.z - pb.z;
          let d2 = dx * dx + dy * dy + dz * dz + 0.01;
          if (d2 > 250000) continue;
          const f = (4200 / d2) * alpha;
          const d = Math.sqrt(d2);
          dx /= d; dy /= d; dz /= d;
          pa.vx += dx * f; pa.vy += dy * f; pa.vz += dz * f;
          pb.vx -= dx * f; pb.vy -= dy * f; pb.vz -= dz * f;
        }
      }
      for (const [s, t] of L) {
        const a = P[s], b = P[t];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const f = (d - (85 + R[s] + R[t])) * 0.02 * alpha;
        a.vx += dx / d * f; a.vy += dy / d * f; a.vz += dz / d * f;
        b.vx -= dx / d * f; b.vy -= dy / d * f; b.vz -= dz / d * f;
      }
      for (const p of P) {
        p.vx -= p.x * 0.003 * alpha; p.vz -= p.z * 0.003 * alpha;
        if (layered) p.vy += (-(nodes[p.i].layer || 0) * 70 - p.y) * 0.08; else p.vy -= p.y * 0.003 * alpha;
        p.x += p.vx; p.y += p.vy; p.z += p.vz;
        p.vx *= 0.6; p.vy *= 0.6; p.vz *= 0.6;
      }
    }
    // hard collision pass: bodies (incl. rings and portals) keep a clear gap
    for (let it = 0; it < 80; it++) {
      let moved = false;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const pa = P[a], pb = P[b];
          let dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
          const min = (R[a] + R[b]) * 2 + 30;
          if (d >= min) continue;
          const push = (min - d) / 2 + 0.01;
          if (d < 0.02) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dz = Math.random() - 0.5; }
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          dx /= len; dy /= len; dz /= len;
          pa.x -= dx * push; pa.y -= dy * push; pa.z -= dz * push;
          pb.x += dx * push; pb.y += dy * push; pb.z += dz * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    // centre
    const c = P.reduce((m, p) => ({ x: m.x + p.x / n, y: m.y + p.y / n, z: m.z + p.z / n }), { x: 0, y: 0, z: 0 });
    return P.map(p => new THREE.Vector3(p.x - c.x, p.y - c.y, p.z - c.z));
  }

  // ---------------------------------------------------------------- textures
  function planetTexture(base) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    const col = new THREE.Color(base);
    g.fillStyle = '#' + col.getHexString();
    g.fillRect(0, 0, 256, 128);
    // bands and storms
    for (let i = 0; i < 26; i++) {
      const y = Math.random() * 128, h = 2 + Math.random() * 12;
      const c2 = col.clone().offsetHSL((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.28);
      g.globalAlpha = 0.25 + Math.random() * 0.5;
      g.fillStyle = '#' + c2.getHexString();
      g.fillRect(0, y, 256, h);
    }
    for (let i = 0; i < 5; i++) {
      g.globalAlpha = 0.35;
      g.fillStyle = '#' + col.clone().offsetHSL(0, 0, 0.2).getHexString();
      g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 128, 6 + Math.random() * 14, 3 + Math.random() * 6, 0, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function glowTexture(color) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }

  function skullTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,60,60,.55)');
    grd.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    g.font = '150px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('💀', 128, 140);
    // vector fallback underneath in case the emoji font is missing
    if (window.LCGraphs && !emojiSupported(g)) window.LCGraphs.drawSkull(g, 128, 128, 70, '#f2f2f2');
    return new THREE.CanvasTexture(cv);
  }
  function emojiSupported(g) {
    const d = g.getImageData(118, 130, 20, 20).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && (d[i] !== d[i + 1] || d[i + 1] !== d[i + 2])) return true;
    return false;
  }

  function starField(count, radius) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(radius * (0.6 + Math.random() * 0.4));
      pos.set([v.x, v.y, v.z], i * 3);
      const c = new THREE.Color().setHSL(Math.random() < 0.2 ? 0.07 : 0.6, 0.3, 0.6 + Math.random() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9 }));
  }

  // ---------------------------------------------------------------- train model
  function buildTrain() {
    const train = new THREE.Group();
    const orange = new THREE.MeshStandardMaterial({ color: 0xe0621b, metalness: 0.4, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.7, roughness: 0.4 });
    const gray = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.5, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xf7ae62, emissive: 0xf7ae62, emissiveIntensity: 0.6 });
    const wheels = (group, len) => {
      for (const z of [-len / 3, len / 3]) for (const x of [-1.1, 1.1]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.35, 16), dark);
        w.rotation.z = Math.PI / 2; w.position.set(x, -0.9, z); group.add(w);
      }
    };
    // locomotive (points along -z, lookAt makes -z the travel direction)
    const loco = new THREE.Group();
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4.2, 20), orange);
    boiler.rotation.x = Math.PI / 2; boiler.position.set(0, 0.3, -0.8); loco.add(boiler);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 1.8), orange); cab.position.set(0, 0.8, 1.9); loco.add(cab);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.25, 2.2), dark); roof.position.set(0, 2.1, 1.9); loco.add(roof);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.7, 0.9), glass); win.position.set(0, 1.2, 1.9); loco.add(win);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.3, 12), dark); chimney.position.set(0, 1.7, -2.2); loco.add(chimney);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.9, 20), dark); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.3, -3.3); loco.add(nose);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 6.4), dark); base.position.set(0, -0.6, 0); loco.add(base);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff1c8 })); lamp.position.set(0, 0.8, -3.5); loco.add(lamp);
    const head = new THREE.SpotLight(0xfff1c8, 140, 120, Math.PI / 8, 0.5, 1.8);
    head.position.set(0, 0.8, -3.5);
    const target = new THREE.Object3D(); target.position.set(0, -2, -30); loco.add(target); head.target = target;
    loco.add(head);
    wheels(loco, 6);
    train.add(loco);
    const wagons = [];
    for (let i = 0; i < 3; i++) {
      const wg = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.9, 5), i % 2 ? gray : orange);
      body.position.y = 0.4; wg.add(body);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.35, 5.02), glass); stripe.position.y = 0.8; wg.add(stripe);
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 5.4), dark); b.position.y = -0.65; wg.add(b);
      wheels(wg, 5);
      train.add(wg);
      wagons.push(wg);
    }
    return { train, loco, wagons, chimneyLocal: new THREE.Vector3(0, 2.5, -2.2) };
  }

  // ---------------------------------------------------------------- routes
  function routesFor(G, selectedAbs) {
    const idx = new Map(G.nodes.map((n, i) => [n.abs, i]));
    const routes = [];
    const toIdx = files => files.map(f => idx.get(f.abs)).filter(i => i !== undefined);
    const short = p => p.split('/').slice(-2).join('/');
    if (selectedAbs && idx.has(selectedAbs)) {
      const path = longestFrom(G, idx.get(selectedAbs));
      if (path.length > 1) routes.push({ label: `From ${short(G.nodes[path[0]].path)} (${path.length} stops)`, path, loop: false });
    }
    G.chains.forEach((c, i) => {
      const p = toIdx(c.files);
      if (p.length > 1) routes.push({ label: `Chain #${i + 1}: ${short(c.files[0].path)} → … (${p.length} stops)`, path: p, loop: false });
    });
    G.cycles.slice(0, 10).forEach((c, i) => {
      const p = toIdx(c.cycle).slice(0, -1);
      if (p.length > 1) routes.push({ label: `Circular line #${i + 1} (${c.size} files)`, path: p, loop: true, cycle: true });
    });
    // grand tour: most imported files
    const hubs = G.nodes.map((n, i) => ({ n, i })).filter(x => !x.n.library).sort((a, b) => b.n.in - a.n.in).slice(0, 8).map(x => x.i);
    if (hubs.length > 2) routes.push({ label: `Grand tour of the ${hubs.length} most imported files`, path: hubs, loop: true });
    return routes;
  }
  function longestFrom(G, start) {
    const out = G.nodes.map(() => []);
    for (const l of G.links) out[l.s].push(l.t);
    let best = [start];
    const seen = new Set([start]);
    let budget = 20000;
    const dfs = (v, path) => {
      if (--budget < 0) return;
      if (path.length > best.length) best = path.slice();
      for (const w of out[v]) if (!seen.has(w)) { seen.add(w); path.push(w); dfs(w, path); path.pop(); seen.delete(w); }
    };
    dfs(start, [start]);
    return best;
  }

  // ---------------------------------------------------------------- main
  function storeGet(k) { try { return window.localStorage.getItem(k); } catch { return null; } }
  function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch { /* storage unavailable */ } }

  function open(ui, D, opts = {}) {
    if (!window.THREE) { alert('3D view not available (three.js failed to load).'); return; }
    const G = D.importGraph;
    if (!G || !G.nodes.length) return;
    close();
    const { esc } = ui;
    const routes = routesFor(G, opts.selectedAbs);
    const idxOf = new Map(G.nodes.map((n, i) => [n.abs, i]));
    // undirected neighbours for free roaming (relations in both directions)
    const nb = G.nodes.map(() => new Map());
    for (const l of G.links) { nb[l.s].set(l.t, 'imports'); if (!nb[l.t].has(l.s)) nb[l.t].set(l.s, 'imported by'); }
    let startNode = opts.selectedAbs && idxOf.has(opts.selectedAbs) ? idxOf.get(opts.selectedAbs) : G.nodes.reduce((b, n, i) => (nb[i].size > nb[b].size ? i : b), 0);

    const root = document.createElement('div');
    root.id = 'train3d';
    root.innerHTML = `
      <div class="t3-labels"></div>
      <div class="t3-top">
        <div class="t3-title">Dependency Express</div>
        <span class="t3-seg"><button data-mode="chain">Chain</button><button data-mode="free">Free roam</button><button data-mode="fly" title="Leave the rails (X) – E snaps back onto the nearest relation">Fly</button></span>
        <select class="t3-route">${routes.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join('')}</select>
        <span class="t3-seg"><button data-drive="auto">Auto</button><button data-drive="manual">Manual</button></span>
        <span class="t3-seg"><button data-cam="chase" class="on">Chase</button><button data-cam="cab">Cab</button><button data-cam="orbit">Free cam</button></span>
        <button data-t3="autochoose" title="Manual free roam: take the straightest relation at junctions instead of stopping">Auto-choose: off</button>
        <label class="t3-speed">Speed <input type="range" min="0.2" max="4" step="0.1" value="1"></label>
        <label class="t3-speed t3-stoptime" title="How long the auto pilot stops at each planet – 0 rolls straight through">Stop <input type="range" min="0" max="5" step="0.5" value="1"><span>1 s</span></label>
        <button data-t3="pause">Pause</button>
        <button data-t3="close" class="t3-close">Exit (Esc)</button>
      </div>
      <div class="t3-station"><div class="t3-now"></div><div class="t3-next"></div><div class="t3-progress"><span></span></div><div class="t3-choice"></div></div>
      <div class="t3-stops"></div>
      <div class="t3-info"></div>
      <div class="t3-help"></div>`;
    document.body.appendChild(root);
    document.body.classList.add('has-train');

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    root.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07070a);
    scene.fog = new THREE.FogExp2(0x07070a, 0.0006);
    const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.PointLight(0xffd2a0, 2.2, 0, 0);
    sun.position.set(0, 400, 200);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x8899ff, 0x201008, 0.35));
    scene.add(starField(4000, 2500));
    for (let i = 0; i < 4; i++) {
      const neb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(['rgba(224,98,27,.35)', 'rgba(120,120,160,.25)', 'rgba(247,174,98,.25)', 'rgba(80,60,120,.3)'][i]), depthWrite: false, transparent: true }));
      neb.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(1400));
      neb.scale.setScalar(900 + Math.random() * 600);
      scene.add(neb);
    }

    // ---- planets, libraries, skulls ----
    const maxIn = Math.max(1, ...G.nodes.map(n => n.in));
    const radiusOf = n => (n.library && n.vulns ? 5 : n.library ? 2.4 + Math.sqrt(n.in / maxIn) * 3 : 2.5 + Math.sqrt(n.in / maxIn) * 9);
    const pos = layout3d(G.nodes, G.links, false, G.nodes.map(radiusOf));
    const vulnerableFiles = new Set();
    for (const l of G.links) if (G.nodes[l.t].library && G.nodes[l.t].vulns) vulnerableFiles.add(l.s);
    const skullTex = skullTexture();
    const planetGeo = new THREE.SphereGeometry(1, 32, 20);
    const bodies = [];
    const pickables = [];
    G.nodes.forEach((n, i) => {
      const group = new THREE.Group();
      group.position.copy(pos[i]);
      let r;
      if (n.library && n.vulns) {
        r = radiusOf(n);
        const sk = new THREE.Sprite(new THREE.SpriteMaterial({ map: skullTex, transparent: true, depthWrite: false }));
        sk.scale.setScalar(16);
        group.add(sk);
        group.add(new THREE.PointLight(0xff3030, 60, 60, 1.5));
        const hit = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hit.userData.i = i; group.add(hit); pickables.push(hit);
      } else if (n.library) {
        r = radiusOf(n);
        const cube = new THREE.Mesh(new THREE.BoxGeometry(r * 1.4, r * 1.4, r * 1.4), new THREE.MeshStandardMaterial({ color: 0x8d8d8d, metalness: 0.85, roughness: 0.3 }));
        cube.rotation.set(Math.random(), Math.random(), 0);
        cube.userData.i = i; cube.userData.spin = 0.2 + Math.random() * 0.5;
        group.add(cube); pickables.push(cube);
      } else {
        r = radiusOf(n);
        const color = ui.resolveColor(ui.colorOf(n.lang));
        const planet = new THREE.Mesh(planetGeo, new THREE.MeshStandardMaterial({ map: planetTexture(color), roughness: 0.85, metalness: 0.05 }));
        planet.scale.setScalar(r);
        planet.rotation.z = (Math.random() - 0.5) * 0.6;
        planet.userData.i = i; planet.userData.spin = 0.05 + Math.random() * 0.2;
        group.add(planet); pickables.push(planet);
        const atmo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(n.cycle >= 0 ? 'rgba(255,77,79,.55)' : 'rgba(247,174,98,.35)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        atmo.scale.setScalar(r * 3.2);
        atmo.userData.atmo = atmo.material.opacity;
        group.add(atmo);
        if (n.in >= Math.max(4, maxIn * 0.3) || n.cycle >= 0) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 1.9, 48), new THREE.MeshBasicMaterial({ color: n.cycle >= 0 ? 0xff4d4f : 0xf7ae62, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
          ring.rotation.x = Math.PI / 2.4;
          group.add(ring);
        }
        if (vulnerableFiles.has(i)) {
          const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: skullTex, transparent: true, depthWrite: false }));
          moon.scale.setScalar(4.5);
          moon.userData.orbit = { r: r + 4, speed: 0.8 + Math.random() };
          group.add(moon);
        }
      }
      scene.add(group);
      bodies.push({ group, r, n });
    });
    // ---- the rail network: every relation is a track through the planets' centres ----
    const station = i => pos[i].clone();
    const exitDepth = i => bodies[i].r + 1.5; // distance from a planet's centre to its tunnel portal
    const curveCache = new Map();
    /** track from a to b (the same geometry in both directions) */
    function segCurve(a, b) {
      const key = a + '>' + b;
      if (!curveCache.has(key)) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const pa = pos[lo], pb = pos[hi];
        // cubic Bézier with a gentle arch: smooth everywhere, no hard corners
        const lift = new THREE.Vector3(0, pa.distanceTo(pb) * 0.1, 0);
        const c1 = pa.clone().lerp(pb, 1 / 3).add(lift), c2 = pa.clone().lerp(pb, 2 / 3).add(lift);
        curveCache.set(lo + '>' + hi, new THREE.CubicBezierCurve3(pa.clone(), c1, c2, pb.clone()));
        curveCache.set(hi + '>' + lo, new THREE.CubicBezierCurve3(pb.clone(), c2.clone(), c1.clone(), pa.clone()));
      }
      return curveCache.get(key);
    }
    const pairs = new Map(); // "lo-hi" -> { a, b, cyc, vuln }
    for (const l of G.links) {
      const lo = Math.min(l.s, l.t), hi = Math.max(l.s, l.t);
      const key = lo + '-' + hi;
      const p = pairs.get(key) || { a: lo, b: hi, cyc: false, vuln: false };
      p.cyc = p.cyc || !!l.cyc;
      p.vuln = p.vuln || !!(G.nodes[l.t].library && G.nodes[l.t].vulns);
      pairs.set(key, p);
    }

    function mergeGeometries(geos) {
      let vCount = 0, iCount = 0;
      for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
      const P = new Float32Array(vCount * 3), N = new Float32Array(vCount * 3), I = new Uint32Array(iCount);
      let vo = 0, io = 0;
      for (const g of geos) {
        P.set(g.attributes.position.array, vo * 3);
        N.set(g.attributes.normal.array, vo * 3);
        const gi = g.index.array;
        for (let k = 0; k < gi.length; k++) I[io + k] = gi[k] + vo;
        vo += g.attributes.position.count; io += gi.length;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(P, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      out.setIndex(new THREE.BufferAttribute(I, 1));
      return out;
    }
    /** two rail tubes below a curve (+ sleeper matrices outside the planets) */
    function railTubes(curve, a, b, sleepers, radius = 0.14) {
      const len = curve.getLength();
      const segs = Math.max(8, Math.round(len / 2.5));
      const tubes = [];
      const upV = new THREE.Vector3(0, 1, 0);
      for (const side of [-1, 1]) {
        const pts = [];
        for (let s = 0; s <= segs; s++) {
          const u = s / segs;
          const p = curve.getPointAt(u), t = curve.getTangentAt(u);
          let sv = new THREE.Vector3().crossVectors(t, upV);
          if (sv.lengthSq() < 1e-4) sv.set(1, 0, 0);
          sv.normalize();
          pts.push(p.add(sv.multiplyScalar(side * 0.95)).add(new THREE.Vector3(0, -1.25, 0)));
        }
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, 5, false));
      }
      if (sleepers) {
        const q = new THREE.Quaternion(), m = new THREE.Matrix4();
        const from = exitDepth(a), to = len - exitDepth(b);
        for (let d = from; d < to; d += 2.6) {
          const u = d / len;
          const p = curve.getPointAt(u), t = curve.getTangentAt(u);
          q.setFromRotationMatrix(new THREE.Matrix4().lookAt(p, p.clone().add(t), upV));
          m.compose(p.clone().add(new THREE.Vector3(0, -1.4, 0)), q, new THREE.Vector3(1, 1, 1));
          sleepers.push(m.clone());
        }
      }
      return tubes;
    }
    const railMats = {
      steel: new THREE.MeshStandardMaterial({ color: 0xb0aaa4, emissive: 0x1c1410, metalness: 0.9, roughness: 0.35 }),
      red: new THREE.MeshStandardMaterial({ color: 0xff4d4f, emissive: 0x661010, metalness: 0.8, roughness: 0.3 }),
      vuln: new THREE.MeshStandardMaterial({ color: 0x9a2a2a, emissive: 0x3a0808, metalness: 0.7, roughness: 0.4 }),
      sleeper: new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 }),
      portal: new THREE.MeshStandardMaterial({ color: 0xf7ae62, emissive: 0xe0621b, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.4 }),
      portalRed: new THREE.MeshStandardMaterial({ color: 0xff4d4f, emissive: 0xff2020, emissiveIntensity: 0.8 }),
      route: new THREE.MeshBasicMaterial({ color: 0xffa24d, transparent: true, opacity: 0.9 }),
      routeRed: new THREE.MeshBasicMaterial({ color: 0xff4d4f, transparent: true, opacity: 0.9 }),
    };
    {
      const byMat = { steel: [], red: [], vuln: [] };
      const sleeperM = [];
      const portals = { portal: [], portalRed: [] };
      const q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
      for (const p of pairs.values()) {
        const curve = segCurve(p.a, p.b);
        byMat[p.cyc ? 'red' : p.vuln ? 'vuln' : 'steel'].push(...railTubes(curve, p.a, p.b, sleeperM));
        // tunnel portals where the track enters a planet (they also mark the junctions)
        const len = curve.getLength();
        for (const [node, u] of [[p.a, exitDepth(p.a) / len], [p.b, 1 - exitDepth(p.b) / len]]) {
          if (u <= 0 || u >= 1 || !bodies[node]) continue;
          const pt = curve.getPointAt(u), t = curve.getTangentAt(u);
          q.setFromUnitVectors(zAxis, t);
          portals[p.cyc ? 'portalRed' : 'portal'].push(new THREE.Matrix4().compose(pt.clone().add(new THREE.Vector3(0, -0.4, 0)), q, new THREE.Vector3(1, 1, 1)));
        }
      }
      for (const [k, geos] of Object.entries(byMat)) if (geos.length) scene.add(new THREE.Mesh(mergeGeometries(geos), railMats[k]));
      if (sleeperM.length) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.18, 0.5), railMats.sleeper, sleeperM.length);
        sleeperM.forEach((m, i) => im.setMatrixAt(i, m));
        scene.add(im);
      }
      for (const [k, list] of Object.entries(portals)) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(new THREE.TorusGeometry(2.4, 0.3, 8, 24), railMats[k], list.length);
        list.forEach((m, i) => im.setMatrixAt(i, m));
        scene.add(im);
      }
    }
    // chain mode: the route glows between the rails
    const routeGroup = new THREE.Group();
    scene.add(routeGroup);
    function highlightRoute(r) {
      routeGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      routeGroup.clear();
      if (!r) return;
      const geos = [];
      const P = r.path;
      for (let k = 0; k < P.length - 1 + (r.loop ? 1 : 0); k++) {
        const curve = segCurve(P[k], P[(k + 1) % P.length]);
        const len = curve.getLength();
        const pts = [];
        const n = Math.max(8, Math.round(len / 3));
        for (let s = 0; s <= n; s++) pts.push(curve.getPointAt(s / n).add(new THREE.Vector3(0, -1.3, 0)));
        geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, 0.32, 5, false));
      }
      if (geos.length) routeGroup.add(new THREE.Mesh(mergeGeometries(geos), r.cycle ? railMats.routeRed : railMats.route));
    }

    // ---- junction indicators (choices at a portal) ----
    const choiceGroup = new THREE.Group();
    scene.add(choiceGroup);
    function showChoices(node, options, sel) {
      choiceGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      choiceGroup.clear();
      if (!options) return;
      options.forEach((o, k) => {
        const c = segCurve(node, o);
        const len = c.getLength();
        const u0 = Math.min(0.9, exitDepth(node) / len), u1 = Math.min(1, u0 + 24 / len);
        const pts = [];
        for (let s = 0; s <= 14; s++) pts.push(c.getPointAt(u0 + (u1 - u0) * s / 14).add(new THREE.Vector3(0, 0.6, 0)));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, k === sel ? 0.55 : 0.25, 6),
          new THREE.MeshBasicMaterial({ color: k === sel ? 0xffb46b : 0x777777, transparent: true, opacity: k === sel ? 0.95 : 0.45 }));
        choiceGroup.add(tube);
        if (k === sel) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 12), new THREE.MeshBasicMaterial({ color: 0xffb46b }));
          const end = pts[pts.length - 1], before = pts[pts.length - 2];
          cone.position.copy(end);
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(before).normalize());
          choiceGroup.add(cone);
        }
      });
    }

    // ---- train ----
    const T = buildTrain();
    scene.add(T.train);
    const smoke = [];
    const smokeTex = glowTexture('rgba(230,230,230,.8)');

    const S = {
      mode: routes.length ? 'chain' : 'free', drive: 'auto', cam: 'chase', paused: false, speed: 1,
      yaw: 0, pitch: 0.36, dist: 44, orbitTarget: new THREE.Vector3(), orbitDist: 400,
      seg: null,          // { a, b, curve, len }
      d: 0,               // distance travelled on seg
      v: 0,               // velocity
      waiting: null,      // { node, options, sel } – junction in manual free roam
      dwell: 0,
      finished: false,
      route: null, k: 0, dir: 1, // chain mode: index of seg.a in route.path, travel direction
      visits: new Map(),
      trail: [],          // recent loco positions for the wagons
      gate: 0,            // distance of the portal before seg.b – decisions happen there
      link: null,         // { curve, len, d, onEnd } – Bézier switch through a planet (or back onto the rails)
      turn: null,         // turning animation
      fly: null,          // { yaw, pitch, v } – off the rails
      autoChoose: storeGet('lc.train.autoChoose') === '1',
      stopSec: Math.max(0, Math.min(5, Number(storeGet('lc.train.stopSec') ?? 1) || 0)),
      needRelease: false, // manual: W must be released before it confirms a junction
      camLook: new THREE.Vector3(),
    };
    const keys = new Set();

    const top = /** @type {HTMLElement} */ (root.querySelector('.t3-top'));
    const sel = /** @type {HTMLSelectElement} */ (root.querySelector('.t3-route'));
    const speed = /** @type {HTMLInputElement} */ (root.querySelector('.t3-speed input'));
    const stopIn = /** @type {HTMLInputElement} */ (root.querySelector('.t3-stoptime input'));
    const labelsEl = /** @type {HTMLElement} */ (root.querySelector('.t3-labels'));
    const nowEl = /** @type {HTMLElement} */ (root.querySelector('.t3-now'));
    const nextEl = /** @type {HTMLElement} */ (root.querySelector('.t3-next'));
    const progEl = /** @type {HTMLElement} */ (root.querySelector('.t3-progress span'));
    const choiceEl = /** @type {HTMLElement} */ (root.querySelector('.t3-choice'));
    const stopsEl = /** @type {HTMLElement} */ (root.querySelector('.t3-stops'));
    const infoEl = /** @type {HTMLElement} */ (root.querySelector('.t3-info'));
    const helpEl = /** @type {HTMLElement} */ (root.querySelector('.t3-help'));
    const name = i => { const n = G.nodes[i]; return n.library ? `${n.path}${n.version ? '@' + n.version : ''}` : n.path.split('/').slice(-2).join('/'); };

    function setSeg(a, b, d) {
      const curve = segCurve(a, b);
      S.seg = { a, b, curve, len: curve.getLength() };
      S.d = Math.min(d || 0, S.seg.len);
      S.gate = Math.max(S.d, S.seg.len - exitDepth(b)); // the tunnel portal before the next planet
      S.link = null;
      S.waiting = null;
      showChoices(null);
    }
    const trainLength = () => T.wagons.length * 7;
    /** points along a curve behind distance d (extrapolated before its start) – the wagons stand on them */
    function trailAlong(curve, len, d) {
      const out = [];
      const start = d - trainLength() - 6;
      if (start < 0) {
        const p0 = curve.getPointAt(0), t0 = curve.getTangentAt(0);
        for (let x = start; x < 0; x += 1) out.push(p0.clone().add(t0.clone().multiplyScalar(x)));
      }
      for (let x = Math.max(0, start); x <= d; x += 1) out.push(curve.getPointAt(Math.min(1, x / len)));
      return out;
    }
    function seedTrail() { S.trail = S.seg ? trailAlong(S.seg.curve, S.seg.len, S.d) : []; }
    const optionsAt = (node, prev) => [...nb[node].keys()].filter(o => o !== prev);
    const stopTime = () => (S.drive === 'auto' ? S.stopSec : 0);

    /** smooth Bézier from p0 (heading t0) to p3 (heading t3) */
    function bezierLink(p0, t0, p3, t3) {
      const k = Math.max(1.5, p0.distanceTo(p3) * 0.42);
      return new THREE.CubicBezierCurve3(p0.clone(), p0.clone().add(t0.clone().multiplyScalar(k)), p3.clone().sub(t3.clone().multiplyScalar(k)), p3.clone());
    }
    function startLink(curve, onEnd, auto) { S.link = { curve, len: Math.max(0.01, curve.getLength()), d: 0, onEnd, auto: !!auto }; }
    /** the switch inside planet b: from the portal of (a,b) to the portal of (b,c) without a kink */
    function linkThrough(c) {
      const { b, curve, len } = S.seg;
      const u0 = Math.min(1, S.d / len);
      const c2 = segCurve(b, c), l2 = c2.getLength();
      const d2 = Math.min(l2 * 0.45, exitDepth(b));
      const bez = bezierLink(curve.getPointAt(u0), curve.getTangentAt(u0), c2.getPointAt(d2 / l2), c2.getTangentAt(d2 / l2));
      startLink(bez, over => {
        if (S.mode === 'chain') S.k = wrap(S.k + S.dir, S.route.path.length);
        setSeg(b, c, d2 + over);
      });
    }
    /** continue from the current portal to relation c (back the same way means turning around) */
    function go(c) {
      if (c === S.seg.a) { startTurn(); return; }
      linkThrough(c);
    }
    /** index of the relation that continues most straight */
    function straightest(node, options) {
      const dirIn = S.seg ? S.seg.curve.getTangentAt(Math.min(1, S.d / S.seg.len)) : new THREE.Vector3(0, 0, -1);
      let sel = 0, best = -Infinity;
      options.forEach((o, k) => {
        const c = segCurve(node, o);
        const dot = c.getTangentAt(Math.min(1, exitDepth(node) / c.getLength())).dot(dirIn);
        if (dot > best) { best = dot; sel = k; }
      });
      return sel;
    }

    // ---- chain mode ----
    function startChain(r) {
      S.mode = 'chain'; S.route = r; S.k = 0; S.dir = 1; S.finished = false; S.v = 0; S.turn = null; S.fly = null;
      S.dwell = Math.min(0.8, S.stopSec);
      highlightRoute(r);
      const P = r.path;
      setSeg(P[0], P[1] ?? P[0], exitDepth(P[0]));
      seedTrail();
      renderStops();
      syncButtons();
    }
    const wrap = (k, n) => (S.route.loop ? (k + n) % n : k);
    /** node after the current segment's target on the route, or null at the end of the line */
    function chainTarget() {
      const P = S.route.path;
      const k2 = wrap(S.k + 2 * S.dir, P.length);
      return k2 < 0 || k2 >= P.length ? null : P[k2];
    }

    // ---- free roam ----
    function startFree(node) {
      S.mode = 'free'; S.route = null; S.finished = false; S.v = 0; S.turn = null; S.fly = null; S.link = null;
      S.visits = new Map([[node, 1]]);
      highlightRoute(null);
      stopsEl.innerHTML = '';
      const options = [...nb[node].keys()];
      S.seg = null;
      S.waiting = { node, options, sel: 0, prev: null, start: true };
      S.needRelease = keys.has('w');
      if (options.length && S.drive === 'auto') { const o = options[Math.floor(Math.random() * options.length)]; setSeg(node, o, exitDepth(node)); seedTrail(); }
      else if (options.length) showChoices(node, options, 0);
      syncButtons();
    }

    /** reached the portal of the next planet: decide how to continue */
    function decide() {
      const { a, b } = S.seg;
      if (S.mode === 'chain') {
        const n2 = chainTarget();
        if (n2 == null) {
          if (S.drive === 'auto') { S.dwell = stopTime(); startTurn(); } else { S.finished = true; S.v = 0; }
          return;
        }
        S.dwell = stopTime(); // station stop (0 = roll straight through)
        go(n2);
        return;
      }
      S.visits.set(b, (S.visits.get(b) || 0) + 1);
      const options = optionsAt(b, a);
      if (!options.length) {
        // dead end: auto turns around, manual waits for S
        if (S.drive === 'auto') { S.dwell = stopTime(); startTurn(); }
        else { S.waiting = { node: b, options: [], sel: 0, prev: a, dead: true }; S.v = 0; }
        return;
      }
      if (options.length === 1) { go(options[0]); return; } // straight on, no choice needed
      if (S.drive === 'auto') {
        const least = Math.min(...options.map(o => S.visits.get(o) || 0));
        const cand = options.filter(o => (S.visits.get(o) || 0) === least);
        S.dwell = stopTime();
        go(cand[Math.floor(Math.random() * cand.length)]);
        return;
      }
      const sel = straightest(b, options);
      if (S.autoChoose) { go(options[sel]); return; }
      // manual: stop at the portal; W has to be released and pressed again to continue
      S.waiting = { node: b, options, sel, prev: a };
      S.v = 0;
      S.needRelease = true;
      showChoices(b, options, sel);
    }
    /** manual: W at a junction confirms the selected relation */
    function confirmChoice() {
      const w = S.waiting;
      if (!w || !w.options.length) return;
      const o = w.options[w.sel];
      if (w.start) { setSeg(w.node, o, exitDepth(w.node)); seedTrail(); return; }
      S.waiting = null;
      showChoices(null);
      go(o);
    }

    // ---- turning around: hover, spin 180° with all wagons, land on the track back ----
    const tmpObj = new THREE.Object3D();
    function poseQuat(p, dir) { orient(tmpObj, p, dir); return tmpObj.quaternion.clone(); }
    function startTurn() {
      if (!S.seg || S.turn || S.link) return;
      const { a, b, len } = S.seg;
      const c2 = segCurve(b, a);
      const d2 = Math.max(Math.min(len - exitDepth(a), len - S.d + trainLength()), Math.min(exitDepth(b), len - exitDepth(a)));
      const trail2 = trailAlong(c2, len, d2);
      const cars = [T.loco, ...T.wagons];
      const to = cars.map((o, k) => {
        const pose = k === 0 ? { p: c2.getPointAt(d2 / len), dir: c2.getTangentAt(d2 / len) } : wagonPose(trail2, k * 7) || { p: c2.getPointAt(d2 / len), dir: c2.getTangentAt(d2 / len) };
        return { p: pose.p, q: poseQuat(pose.p, pose.dir) };
      });
      const from = cars.map(o => ({ p: o.position.clone(), q: o.quaternion.clone() }));
      const pivot = from.reduce((m, c) => m.add(c.p), new THREE.Vector3()).multiplyScalar(1 / from.length);
      S.turn = { t: 0, dur: 1.9, cars, from, to, pivot, after: () => {
        if (S.mode === 'chain') { S.k = wrap(S.k + S.dir, S.route.path.length); S.dir = -S.dir; }
        setSeg(b, a, d2);
        S.trail = trail2;
      } };
      S.v = 0;
      S.waiting = null;
      S.finished = false;
      showChoices(null);
    }
    function stepTurn(dt) {
      const tr = S.turn;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const sm = x => x * x * (3 - 2 * x);
      const t = tr.t;
      const lift = 6 * (t < 0.25 ? sm(t / 0.25) : t > 0.8 ? sm((1 - t) / 0.2) : 1); // up – spin – down
      const e = sm(Math.max(0, Math.min(1, (t - 0.22) / 0.58)));
      const qRot = new THREE.Quaternion().setFromAxisAngle(up, Math.PI * e);
      tr.cars.forEach((o, k) => {
        const f = tr.from[k], g = tr.to[k];
        const p = f.p.clone().sub(tr.pivot).applyAxisAngle(up, Math.PI * e).add(tr.pivot).lerp(g.p, e);
        o.position.copy(p).add(new THREE.Vector3(0, lift, 0));
        o.quaternion.copy(qRot.clone().multiply(f.q)).slerp(g.q, e);
        o.visible = true;
      });
      if (tr.t >= 1) { const after = tr.after; S.turn = null; after(); }
    }
    function reverse() {
      if (S.fly) return;
      if (S.drive === 'auto' || S.turn || S.link || !S.seg) return;
      startTurn();
    }

    // ---- fly: leave the rails and move freely; E snaps back onto the nearest relation ----
    const trackSamples = [];
    for (const p of pairs.values()) {
      const c = segCurve(p.a, p.b), len = c.getLength();
      for (let d = exitDepth(p.a); d <= len - exitDepth(p.b); d += 4) trackSamples.push({ a: p.a, b: p.b, d, len, p: c.getPointAt(d / len) });
    }
    function startFly() {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(T.loco.quaternion);
      S.fly = { yaw: Math.atan2(-fwd.x, -fwd.z), pitch: Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 0.5, v: Math.max(S.v, 0) };
      S.mode = 'fly'; S.seg = null; S.link = null; S.waiting = null; S.turn = null; S.route = null; S.finished = false;
      highlightRoute(null); showChoices(null); stopsEl.innerHTML = '';
      syncButtons();
    }
    function snapToTrack() {
      if (!trackSamples.length) return;
      const lp = T.loco.position, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(T.loco.quaternion);
      let best = null, bd = Infinity;
      for (const s of trackSamples) { const d = s.p.distanceToSquared(lp); if (d < bd) { bd = d; best = s; } }
      let { a, b, d, len } = best;
      if (segCurve(a, b).getTangentAt(d / len).dot(fwd) < 0) { [a, b] = [b, a]; d = len - d; }
      const c = segCurve(a, b);
      const dT = Math.min(len - exitDepth(b) - 1, d + Math.min(30, 8 + Math.sqrt(bd) * 0.4));
      const target = Math.max(exitDepth(a), dT);
      const bez = bezierLink(lp, fwd, c.getPointAt(target / len), c.getTangentAt(target / len));
      const v = Math.max(S.fly ? S.fly.v : 0, S.speed * 12);
      S.fly = null;
      S.mode = 'free'; S.visits = new Map([[a, 1]]); S.finished = false;
      S.seg = null; S.waiting = null;
      S.v = v;
      startLink(bez, over => { setSeg(a, b, target + over); }, true);
      syncButtons();
    }
    function stepFly(dt, maxV) {
      const f = S.fly;
      const steer = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0);
      const climb = (keys.has('r') ? 1 : 0) - (keys.has('f') ? 1 : 0);
      f.yaw += steer * 1.3 * dt;
      f.pitch = Math.max(-1.3, Math.min(1.3, f.pitch + climb * 1.0 * dt));
      if (S.drive === 'auto') f.v += (maxV - f.v) * Math.min(1, dt * 1.5);
      else if (keys.has('w')) f.v = Math.min(maxV * 1.6, f.v + maxV * 1.3 * dt);
      else if (keys.has('s')) f.v = Math.max(0, f.v - maxV * 2 * dt);
      else f.v = Math.max(0, f.v - maxV * 0.35 * dt);
      S.v = f.v;
      const fwd = new THREE.Vector3(-Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), -Math.cos(f.yaw) * Math.cos(f.pitch));
      const lp = T.loco.position.clone().add(fwd.clone().multiplyScalar(f.v * dt));
      return { lp, fwd };
    }

    /** moves the train `dist` along track and switches, stopping at decisions */
    function advance(dist) {
      for (let guard = 0; dist > 1e-6 && guard < 8; guard++) {
        if (S.dwell > 0 || S.turn || S.waiting || S.finished) return;
        if (S.link) {
          const rem = S.link.len - S.link.d;
          if (dist < rem) { S.link.d += dist; return; }
          const l = S.link;
          S.link = null;
          l.onEnd(0);
          dist -= rem;
          continue;
        }
        if (!S.seg) return;
        const rem = S.gate - S.d;
        if (dist < rem) { S.d += dist; return; }
        S.d = S.gate;
        dist -= Math.max(0, rem);
        decide();
      }
    }

    function renderStops() {
      if (S.mode !== 'chain') { stopsEl.innerHTML = ''; return; }
      const r = S.route;
      stopsEl.innerHTML = `<div class="t3-stops-title">${r.loop ? 'Circular line' : 'Stops'}</div>` + r.path.map((i, k) => `<div class="t3-stop" data-stop="${k}"><span class="t3-dot ${G.nodes[i].cycle >= 0 ? 'red' : ''}"></span>${esc(name(i))}</div>`).join('');
    }
    function syncButtons() {
      top.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.mode === S.mode));
      top.querySelectorAll('[data-drive]').forEach(b => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.drive === S.drive));
      top.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.cam === S.cam));
      sel.style.display = S.mode === 'chain' ? '' : 'none';
      const ac = top.querySelector('[data-t3="autochoose"]');
      ac.textContent = 'Auto-choose: ' + (S.autoChoose ? 'on' : 'off');
      ac.classList.toggle('on', S.autoChoose);
      ac.style.display = S.mode === 'free' && S.drive === 'manual' ? '' : 'none';
      stopIn.value = String(S.stopSec);
      stopIn.nextElementSibling.textContent = S.stopSec + ' s';
      helpEl.innerHTML = S.mode === 'fly'
        ? `${S.drive === 'manual' ? '<b>W</b> thrust · <b>S</b> brake' : 'Cruise control'} · <b>A</b>/<b>D</b> steer · <b>R</b>/<b>F</b> climb / dive · <b>E</b> snap onto the nearest relation · <b>C</b> camera`
        : S.drive === 'manual'
          ? `<b>W</b> drive · <b>S</b> turn around${S.mode === 'free' ? ` · <b>A</b>/<b>D</b> choose the relation at a junction${S.autoChoose ? ' (auto-choose on)' : ' – release and press <b>W</b> again to go'}` : ''} · <b>X</b> fly · <b>C</b> camera · drag to look`
          : `Auto pilot${S.mode === 'free' ? ' – picks a random relation at every junction' : ''} · <b>Space</b> pause · <b>↑</b>/<b>↓</b> speed · <b>X</b> fly · <b>C</b> camera · drag to look`;
    }
    function setCam(c) {
      S.cam = c;
      if (c === 'orbit') { S.orbitTarget.copy(T.loco.position); S.orbitDist = 160; }
      syncButtons();
    }

    top.addEventListener('click', ev => {
      const b = /** @type {HTMLElement} */ (ev.target).closest('button');
      if (!b) return;
      if (b.dataset.cam) setCam(b.dataset.cam);
      if (b.dataset.drive) {
        S.drive = b.dataset.drive;
        if (S.drive === 'auto' && S.waiting) {
          const w = S.waiting;
          if (w.dead) startTurn();
          else if (w.options.length) { w.sel = Math.floor(Math.random() * w.options.length); confirmChoice(); }
        }
        if (S.drive === 'auto' && S.finished) { S.finished = false; startTurn(); }
        syncButtons();
      }
      if (b.dataset.mode === 'chain' && routes.length) startChain(routes[Number(sel.value) || 0]);
      if (b.dataset.mode === 'free') {
        if (S.fly) snapToTrack();
        else startFree(S.seg ? (S.d > S.seg.len / 2 ? S.seg.b : S.seg.a) : startNode);
      }
      if (b.dataset.mode === 'fly' && !S.fly && !S.turn) startFly();
      if (b.dataset.t3 === 'autochoose') { S.autoChoose = !S.autoChoose; storeSet('lc.train.autoChoose', S.autoChoose ? '1' : '0'); syncButtons(); }
      if (b.dataset.t3 === 'pause') { S.paused = !S.paused; b.textContent = S.paused ? 'Resume' : 'Pause'; }
      if (b.dataset.t3 === 'close') close();
      b.blur();
    });
    sel.addEventListener('change', () => { startChain(routes[Number(sel.value)]); sel.blur(); });
    speed.addEventListener('input', () => { S.speed = Number(speed.value); });
    stopIn.addEventListener('input', () => {
      S.stopSec = Number(stopIn.value);
      if (S.stopSec === 0) S.dwell = 0;
      storeSet('lc.train.stopSec', String(S.stopSec));
      syncButtons();
    });
    stopsEl.addEventListener('click', ev => {
      const s = /** @type {HTMLElement} */ (ev.target).closest('[data-stop]');
      if (!s || S.mode !== 'chain') return;
      const k = Math.min(Number(s.dataset.stop), S.route.path.length - 2);
      S.k = k; S.dir = 1; S.finished = false; S.turn = null;
      setSeg(S.route.path[k], S.route.path[k + 1], exitDepth(S.route.path[k]));
      seedTrail();
    });

    // mouse look / orbit / picking
    let drag = null;
    renderer.domElement.addEventListener('pointerdown', ev => { drag = { x: ev.clientX, y: ev.clientY, moved: false }; });
    const onMove = ev => {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = ev.clientX; drag.y = ev.clientY;
      S.yaw -= dx * 0.005;
      S.pitch = Math.max(-1.2, Math.min(1.35, S.pitch + dy * 0.004));
    };
    const onUp = ev => { if (drag && !drag.moved && ev.target === renderer.domElement) pick(ev); drag = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('wheel', ev => {
      ev.preventDefault();
      if (S.cam === 'orbit') S.orbitDist = Math.max(20, Math.min(2500, S.orbitDist * (1 + ev.deltaY * 0.001)));
      else S.dist = Math.max(8, Math.min(120, S.dist * (1 + ev.deltaY * 0.001)));
    }, { passive: false });
    const raycaster = new THREE.Raycaster();
    function pick(ev) {
      const m = new THREE.Vector2((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(m, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (!hit) { infoEl.classList.remove('show'); return; }
      const i = hit.object.userData.i;
      const n = G.nodes[i];
      infoEl.innerHTML = `<div class="t3-info-title">${esc(n.path)}${n.library && n.version ? '@' + esc(n.version) : ''}</div>
        ${n.library ? `<div>${esc(n.ecosystem)} library${n.license ? ` · ${esc(n.license)}` : ''}</div>${n.vulns ? `<div class="t3-red">💀 ${n.vulns} known vulnerabilit${n.vulns === 1 ? 'y' : 'ies'} (${esc(n.severity || 'unknown')})</div>` : ''}`
        : `<div>imports ${n.out} · imported by ${n.in}${n.dependents != null ? ` · ${n.dependents} depend on it` : ''}</div>${n.cycle >= 0 ? '<div class="t3-red">part of a circular import</div>' : ''}${vulnerableFiles.has(i) ? '<div class="t3-red">💀 imports a vulnerable package</div>' : ''}`}
        <div class="t3-info-actions">${!n.library ? `<button data-open="${esc(n.abs)}">Open file</button>` : ''}<button data-roam="${i}">Free roam from here</button><button data-ride="${i}">Ride its longest chain</button></div>`;
      infoEl.classList.add('show');
    }
    infoEl.addEventListener('click', ev => {
      const b = /** @type {HTMLElement} */ (ev.target).closest('button');
      if (!b) return;
      if (b.dataset.open) ui.post({ type: 'open', abs: b.dataset.open });
      if (b.dataset.roam) { startFree(Number(b.dataset.roam)); infoEl.classList.remove('show'); }
      if (b.dataset.ride) {
        const path = longestFrom(G, Number(b.dataset.ride));
        if (path.length < 2) { infoEl.insertAdjacentHTML('beforeend', '<div class="t3-red">No outgoing imports – end of the line.</div>'); return; }
        const r = { label: `From ${name(path[0])} (${path.length} stops)`, path, loop: false };
        routes.unshift(r);
        sel.innerHTML = routes.map((x, k) => `<option value="${k}">${esc(x.label)}</option>`).join('');
        sel.value = '0';
        startChain(r);
        infoEl.classList.remove('show');
      }
    });
    const onKey = ev => {
      const k = ev.key.toLowerCase();
      if (ev.key === 'Escape') { close(); ev.stopPropagation(); return; }
      if (/^(input|select)$/i.test(/** @type {HTMLElement} */ (ev.target).tagName) && ev.key !== 'Escape') return;
      if (ev.type === 'keyup') { keys.delete(k); return; }
      if (keys.has(k) && ['s', 'a', 'd', 'c', 'x', 'e'].includes(k)) return; // no key repeat for toggles
      keys.add(k);
      if (k === ' ') { S.paused = !S.paused; ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { S.speed = Math.min(4, S.speed + 0.2); speed.value = String(S.speed); }
      else if (ev.key === 'ArrowDown') { S.speed = Math.max(0.2, S.speed - 0.2); speed.value = String(S.speed); }
      else if (k === 'c') setCam(S.cam === 'chase' ? 'cab' : S.cam === 'cab' ? 'orbit' : 'chase');
      else if (k === 's') reverse();
      else if (k === 'x') { if (S.fly) snapToTrack(); else if (!S.turn) startFly(); }
      else if (k === 'e' && S.fly) snapToTrack();
      else if ((k === 'a' || k === 'd') && S.waiting && S.waiting.options.length > 1) {
        const w = S.waiting;
        w.sel = (w.sel + (k === 'd' ? 1 : -1) + w.options.length) % w.options.length;
        showChoices(w.node, w.options, w.sel);
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    // ---- labels: nearby or looked-at objects ----
    const labelPool = [];
    const tmp = new THREE.Vector3(), camDir = new THREE.Vector3();
    function updateLabels() {
      camera.getWorldDirection(camDir);
      const cand = [];
      const routeSet = new Set(S.mode === 'chain' && S.route ? S.route.path : S.waiting ? S.waiting.options : []);
      bodies.forEach((b, i) => {
        tmp.copy(b.group.position);
        const d = tmp.distanceTo(camera.position);
        const toNode = tmp.clone().sub(camera.position).normalize();
        const ang = Math.acos(Math.max(-1, Math.min(1, toNode.dot(camDir)))) * 180 / Math.PI;
        if (ang > 80) return;
        const looked = ang < LABEL_LOOK_DEG + b.r * 0.4 && d < LABEL_LOOK_DIST;
        if (d < LABEL_NEAR + b.r * 2 || looked || (routeSet.has(i) && d < LABEL_LOOK_DIST * 1.5)) cand.push({ i, d, looked });
      });
      cand.sort((a, b) => a.d - b.d);
      const shown = cand.slice(0, MAX_LABELS);
      while (labelPool.length < shown.length) { const el = document.createElement('div'); el.className = 't3-label'; labelsEl.appendChild(el); labelPool.push(el); }
      const placed = [];
      labelPool.forEach((el, k) => {
        const c = shown[k];
        if (!c) { el.style.display = 'none'; return; }
        const b = bodies[c.i];
        tmp.copy(b.group.position).add(new THREE.Vector3(0, b.r + 2.5, 0)).project(camera);
        if (tmp.z > 1) { el.style.display = 'none'; return; }
        const n = G.nodes[c.i];
        const x = (tmp.x * 0.5 + 0.5) * window.innerWidth, y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
        // skip labels that would overlap a closer one (closer labels were placed first)
        const w = name(c.i).length * 7 + 16;
        const box = { x0: x - w / 2, x1: x + w / 2, y0: y - 22, y1: y };
        const important = routeSet.has(c.i) || (S.waiting && S.waiting.options[S.waiting.sel] === c.i);
        if (!important && placed.some(p => p.x0 < box.x1 && box.x0 < p.x1 && p.y0 < box.y1 && box.y0 < p.y1)) { el.style.display = 'none'; return; }
        placed.push(box);
        el.style.display = 'block';
        el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
        el.style.opacity = String(Math.max(0.35, Math.min(1, 1.3 - c.d / LABEL_LOOK_DIST)));
        const choice = S.waiting && S.waiting.options[S.waiting.sel] === c.i;
        el.className = 't3-label' + (n.library && n.vulns ? ' vuln' : n.cycle >= 0 ? ' cyc' : routeSet.has(c.i) ? ' route' : '') + (c.looked ? ' looked' : '') + (choice ? ' choice' : '');
        el.textContent = (n.library && n.vulns ? '💀 ' : '') + name(c.i);
      });
    }

    // ---- wagons follow the loco's trail ----
    function wagonPose(trail, distBack) {
      let acc = 0;
      for (let k = trail.length - 1; k > 0; k--) {
        const p1 = trail[k], p0 = trail[k - 1];
        const seg = p1.distanceTo(p0);
        if (acc + seg >= distBack) {
          const t = (distBack - acc) / seg;
          const p = p1.clone().lerp(p0, t);
          return { p, dir: p1.clone().sub(p0).normalize() };
        }
        acc += seg;
      }
      return null;
    }

    // ---- animation loop ----
    const clock = new THREE.Clock();
    const up = new THREE.Vector3(0, 1, 0);
    function orient(obj, p, dir) {
      obj.position.copy(p);
      obj.lookAt(p.clone().sub(dir)); // lookAt turns +z to the target, the model's front is -z -> front faces dir
    }
    function frame() {
      if (session !== me) return;
      me.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, clock.getDelta());
      const maxV = S.speed * 26;
      // ---- movement ----
      let lp, fwd;
      if (S.turn) {
        stepTurn(dt);
      } else if (S.fly) {
        if (!S.paused) ({ lp, fwd } = stepFly(dt, maxV));
        else { lp = T.loco.position.clone(); fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(T.loco.quaternion); }
      } else if ((S.seg || S.link) && !S.paused && !S.finished && !S.waiting) {
        if (S.dwell > 0) { S.dwell -= dt; S.v = 0; }
        else if (S.drive === 'auto' || (S.link && S.link.auto)) {
          // with station stops the train brakes into the portal, with 0 s it rolls straight through
          const toGate = S.link || !S.seg ? Infinity : S.gate - S.d;
          const slow = S.stopSec > 0 ? Math.max(0.25, Math.min(1, toGate / 22)) : 1;
          S.v += (maxV * slow - S.v) * Math.min(1, dt * 3);
        } else {
          if (keys.has('w')) S.v = Math.min(maxV, S.v + maxV * 1.2 * dt);
          else S.v = Math.max(0, S.v - maxV * 1.5 * dt);
        }
        advance(S.v * dt);
      }
      if (S.waiting && S.drive === 'manual') {
        if (!keys.has('w')) S.needRelease = false;
        else if (!S.needRelease && S.waiting.options.length) confirmChoice();
      }
      // ---- place train ----
      if (S.turn) {
        lp = T.loco.position.clone();
        fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(T.loco.quaternion);
      } else {
        if (S.fly) {
          if (!lp) { lp = T.loco.position.clone(); fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(T.loco.quaternion); }
        } else if (S.link) {
          const u = Math.min(1, S.link.d / S.link.len);
          lp = S.link.curve.getPointAt(u);
          fwd = S.link.curve.getTangentAt(u);
        } else if (S.seg) {
          const u = Math.min(1, Math.max(0, S.d / S.seg.len));
          lp = S.seg.curve.getPointAt(u);
          fwd = S.seg.curve.getTangentAt(u);
        } else {
          // standing at the start planet: the loco waits at the portal of the selected track
          const w = S.waiting;
          const o = w && w.options.length ? w.options[w.sel] : null;
          if (o != null) {
            const c = segCurve(w.node, o);
            const u = Math.min(0.95, exitDepth(w.node) / c.getLength());
            lp = c.getPointAt(u); fwd = c.getTangentAt(u);
          } else { lp = station(w ? w.node : startNode).add(new THREE.Vector3(0, bodies[w ? w.node : startNode].r + 3, 0)); fwd = new THREE.Vector3(0, 0, -1); }
          if (!S.trail.length || S.trail[S.trail.length - 1].distanceTo(lp) > 0.5) {
            S.trail = [];
            for (let x = -trainLength() - 6; x <= 0; x += 1) S.trail.push(lp.clone().add(fwd.clone().multiplyScalar(x)));
          }
        }
        orient(T.loco, lp, fwd);
        const last = S.trail[S.trail.length - 1];
        if (!last || last.distanceTo(lp) > 0.4) { S.trail.push(lp.clone()); if (S.trail.length > 400) S.trail.shift(); }
        T.wagons.forEach((w, k) => {
          const pose = wagonPose(S.trail, (k + 1) * 7);
          w.visible = !!pose;
          if (pose) orient(w, pose.p, pose.dir);
        });
      }
      // smoke
      if (!S.paused && S.v > 0.5 && Math.random() < 0.6) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.5 }));
        s.position.copy(T.loco.localToWorld(T.chimneyLocal.clone()));
        s.scale.setScalar(1.2);
        s.userData.life = 0;
        scene.add(s); smoke.push(s);
      }
      for (let k = smoke.length - 1; k >= 0; k--) {
        const s = smoke[k];
        s.userData.life += dt;
        s.position.y += dt * 3;
        s.scale.setScalar(1.2 + s.userData.life * 4);
        s.material.opacity = Math.max(0, 0.5 - s.userData.life * 0.25);
        if (s.userData.life > 2) { scene.remove(s); s.material.dispose(); smoke.splice(k, 1); }
      }
      const t = clock.elapsedTime;
      for (const b of bodies) {
        for (const c of b.group.children) {
          if (c.userData.spin) c.rotation.y += c.userData.spin * dt;
          if (c.userData.orbit) { const o = c.userData.orbit; c.position.set(Math.cos(t * o.speed) * o.r, Math.sin(t * o.speed * 0.7) * 2, Math.sin(t * o.speed) * o.r); }
          if (c.userData.atmo !== undefined) {
            // fade the glow when the camera comes close, otherwise it fills the whole screen
            const dist = camera.position.distanceTo(b.group.position);
            c.material.opacity = c.userData.atmo * Math.max(0, Math.min(1, (dist - b.r * 2) / (b.r * 6)));
          }
        }
      }
      // ---- camera ----
      const locoFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(T.loco.quaternion);
      const ease = k => 1 - Math.exp(-dt * k); // frame-rate independent smoothing
      if (S.cam === 'cab') {
        // first person: sits in the loco and turns with it (not with the world)
        camera.position.copy(T.loco.localToWorld(new THREE.Vector3(0, 3.6, 1.6)));
        camera.quaternion.copy(T.loco.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08 - (S.pitch - 0.36) * 0.6, S.yaw * 0.6, 0, 'YXZ')));
      } else if (S.cam === 'chase') {
        // follow from behind using the mostly horizontal travel direction (steep tracks would put the camera below the train)
        const flat = new THREE.Vector3(locoFwd.x, locoFwd.y * 0.25, locoFwd.z);
        if (flat.lengthSq() < 0.05) flat.set(0, 0, -1);
        flat.normalize();
        const back = flat.multiplyScalar(-1).applyAxisAngle(up, S.yaw);
        const base = T.loco.position;
        const eye = base.clone().add(back.multiplyScalar(S.dist * Math.cos(S.pitch))).add(new THREE.Vector3(0, S.dist * Math.sin(S.pitch) + 3, 0));
        camera.position.lerp(eye, ease(S.turn ? 3 : 6));
        S.camLook.lerp(base.clone().add(locoFwd.clone().multiplyScalar(8)), ease(10));
        camera.lookAt(S.camLook);
      } else {
        const tgt = S.orbitTarget.lerp(T.loco.position, ease(1.5));
        const eye = tgt.clone().add(new THREE.Vector3(Math.cos(S.pitch) * Math.sin(S.yaw), Math.sin(S.pitch), Math.cos(S.pitch) * Math.cos(S.yaw)).multiplyScalar(S.orbitDist));
        camera.position.lerp(eye, ease(6));
        camera.lookAt(tgt);
      }
      // ---- HUD ----
      if (S.mode === 'chain' && S.route) {
        const P = S.route.path;
        const cur = S.seg ? (S.d < 0.5 ? S.seg.a : null) : null;
        nowEl.innerHTML = cur != null ? `<span class="t3-muted">Station</span> ${esc(name(cur))}` : `<span class="t3-muted">Between</span> ${esc(name(S.seg.a))}`;
        nextEl.innerHTML = S.finished ? '<span class="t3-muted">End of the line.</span> Press <b>S</b> to turn around or pick another route.' : `<span class="t3-muted">Next stop</span> ${esc(name(S.seg.b))}${G.nodes[S.seg.b].cycle >= 0 ? ' <span class="t3-red">(circular import)</span>' : ''}`;
        const posK = Math.max(0, P.indexOf(S.seg.a));
        const frac = (posK + (S.dir > 0 ? 1 : -1) * Math.min(1, S.d / S.seg.len)) / Math.max(1, P.length - 1);
        progEl.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%';
        stopsEl.querySelectorAll('.t3-stop').forEach((el, k) => { el.classList.toggle('here', P[k] === S.seg.a); el.classList.toggle('next', P[k] === S.seg.b); });
        choiceEl.innerHTML = '';
      } else if (S.mode === 'fly') {
        progEl.style.width = '0%';
        nowEl.innerHTML = '<span class="t3-muted">Off the rails</span> – free flight';
        nextEl.innerHTML = `${Math.round(S.v)} u/s · press <b>E</b> to snap onto the nearest relation`;
        choiceEl.innerHTML = '';
      } else {
        progEl.style.width = S.seg ? ((S.d / S.seg.len) * 100).toFixed(1) + '%' : '0%';
        if (S.waiting) {
          const w = S.waiting;
          nowEl.innerHTML = `<span class="t3-muted">${w.dead ? 'Dead end at' : 'Junction at'}</span> ${esc(name(w.node))}`;
          if (w.dead) { nextEl.innerHTML = S.drive === 'manual' ? 'Dead end – press <b>S</b> to turn around.' : 'Dead end – turning around…'; choiceEl.innerHTML = ''; }
          else if (!w.options.length) { nextEl.innerHTML = 'This file has no relations. Pick another planet (click it).'; choiceEl.innerHTML = ''; }
          else {
            nextEl.innerHTML = S.drive === 'manual' ? `Choose a relation with <b>A</b> / <b>D</b>, ${S.needRelease ? 'release and press <b>W</b> again' : 'drive with <b>W</b>'}` : '';
            choiceEl.innerHTML = w.options.map((o, k) => `<div class="t3-opt ${k === w.sel ? 'sel' : ''}"><span class="t3-rel">${esc(nb[w.node].get(o))}</span> ${esc(name(o))}${G.nodes[o].library && G.nodes[o].vulns ? ' <span class="t3-red">💀</span>' : ''}${o === w.prev ? ' <span class="t3-muted">(back)</span>' : ''}</div>`).join('');
          }
        } else if (S.seg) {
          nowEl.innerHTML = `<span class="t3-muted">From</span> ${esc(name(S.seg.a))} <span class="t3-muted">(${esc(nb[S.seg.a].get(S.seg.b) || '')})</span>`;
          nextEl.innerHTML = `<span class="t3-muted">Heading to</span> ${esc(name(S.seg.b))}${G.nodes[S.seg.b].library && G.nodes[S.seg.b].vulns ? ' <span class="t3-red">💀 vulnerable</span>' : ''}`;
          choiceEl.innerHTML = '';
        }
      }
      updateLabels();
      renderer.render(scene, camera);
    }

    const me = {
      raf: 0,
      state: S,
      dispose: () => {
        cancelAnimationFrame(me.raf);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKey, true);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
        renderer.dispose();
        root.remove();
        document.body.classList.remove('has-train');
      },
    };
    session = me;
    S.drive = opts.drive || 'auto';
    if (opts.mode === 'free' || !routes.length) startFree(startNode);
    else startChain(routes[0]);
    camera.position.set(0, 200, 400);
    frame();
  }

  function close() {
    if (session) { const s = session; session = null; s.dispose(); }
  }

  window.LCTrain = { open, close, routesFor, layout3d, get session() { return session; } };
})();
