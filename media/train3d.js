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
    const hull = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.85, roughness: 0.28 });
    const hullLight = new THREE.MeshStandardMaterial({ color: 0x9a9aa2, metalness: 0.8, roughness: 0.3 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xe0621b, metalness: 0.5, roughness: 0.35, emissive: 0x5a1e04 });
    const neon = new THREE.MeshBasicMaterial({ color: 0xffa24d });
    const glass = new THREE.MeshStandardMaterial({ color: 0x241208, metalness: 0.2, roughness: 0.05, emissive: 0xf7ae62, emissiveIntensity: 0.35, transparent: true, opacity: 0.9 });
    const glowTex = glowTexture('rgba(255,150,60,.9)');
    const bobs = [];
    const glowSprite = (scale, opacity) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity }));
      s.scale.setScalar(scale);
      return s;
    };
    /** hover pads + glow below a car (no wheels – it floats over the rails) */
    const pads = (group, len) => {
      for (const z of [-len / 3, len / 3]) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 1.1), hull); pad.position.set(0, -0.95, z); group.add(pad);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.9), neon); glow.position.set(0, -1.1, z); group.add(glow);
        const g = glowSprite(3.2, 0.45); g.position.set(0, -1.2, z); group.add(g);
      }
    };
    // locomotive: sleek capsule, front along -z
    const loco = new THREE.Group();
    const lb = new THREE.Group(); loco.add(lb); bobs.push(lb);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, 4.4, 8, 20), hull);
    body.rotation.x = Math.PI / 2; body.scale.set(1, 1, 0.85); lb.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.6, 24), accent);
    nose.rotation.x = -Math.PI / 2; nose.position.set(0, -0.05, -3.9); nose.scale.set(1, 0.7, 1); lb.add(nose);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    canopy.scale.set(0.95, 0.75, 1.9); canopy.position.set(0, 0.55, -1.2); lb.add(canopy);
    for (const x of [-1.27, 1.27]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 5.6), neon); stripe.position.set(x, 0.05, 0); lb.add(stripe);
    }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 1.8), accent); fin.position.set(0, 1.25, 2.1); fin.rotation.x = -0.35; lb.add(fin);
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 0.9, 20), hull); engine.rotation.x = Math.PI / 2; engine.position.set(0, 0, 3.4); lb.add(engine);
    const flame = new THREE.Mesh(new THREE.CircleGeometry(0.62, 20), neon); flame.position.set(0, 0, 3.86); lb.add(flame);
    const exhaust = glowSprite(4.5, 0.8); exhaust.position.set(0, 0, 4.4); lb.add(exhaust);
    const lamp = glowSprite(2.2, 0.9); lamp.material.color = new THREE.Color(0xfff1c8); lamp.position.set(0, 0.1, -5.1); lb.add(lamp);
    pads(lb, 5);
    const head = new THREE.SpotLight(0xfff1c8, 140, 120, Math.PI / 8, 0.5, 1.8);
    head.position.set(0, 0.3, -5);
    const target = new THREE.Object3D(); target.position.set(0, -2, -30); loco.add(target); head.target = target;
    loco.add(head);
    train.add(loco);
    const wagons = [];
    for (let i = 0; i < 3; i++) {
      const wg = new THREE.Group();
      const wb = new THREE.Group(); wg.add(wb); bobs.push(wb);
      const shell = new THREE.Mesh(new THREE.CapsuleGeometry(1.15, 3.6, 8, 18), i % 2 ? hullLight : hull);
      shell.rotation.x = Math.PI / 2; shell.scale.set(1, 1, 0.85); wb.add(shell);
      for (const x of [-1.16, 1.16]) {
        for (let k = -1; k <= 1; k++) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.35, 0.8), neon); win.position.set(x, 0.3, k * 1.2); wb.add(win);
        }
      }
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.1, 8, 24), accent); band.scale.set(1.15, 0.97, 1); band.position.z = -2.3; wb.add(band);
      pads(wb, 4);
      train.add(wg);
      wagons.push(wg);
    }
    return { train, loco, wagons, bobs, exhaust, chimneyLocal: new THREE.Vector3(0, 0, 4.2) };
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
    // functions: the longest call chain
    if (G.functions) {
      let best = [];
      G.nodes.forEach((n, i) => { if (n.fn && n.out && !n.in) { const p = longestFrom({ nodes: G.nodes, links: G.links.filter(l => l.call) }, i); if (p.length > best.length) best = p; } });
      if (best.length > 2) routes.unshift({ label: `Longest call chain: ${G.nodes[best[0]].path} (${best.length} functions)`, path: best, loop: false });
    }
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
    const G0 = D.importGraph;
    if (!G0 || !G0.nodes.length) return;
    const G = opts.functions && window.LCGraphs && D.functionGraph ? LCGraphs.withFunctions(G0, D.functionGraph) : G0;
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
        ${D.functionGraph && D.functionGraph.fns.length ? `<button data-t3="functions" class="${opts.functions ? 'on' : ''}" title="Show functions as stations: file → function and calls between functions">ƒ Functions</button>` : ''}
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
    const radiusOf = n => (n.fn ? 3 + Math.min(4, (n.cx || 1) * 0.25) : n.library && n.vulns ? 7 : n.library ? 4 + Math.sqrt(n.in / maxIn) * 4 : 6 + Math.sqrt(n.in / maxIn) * 14);
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
        sk.scale.setScalar(r * 3.2);
        group.add(sk);
        group.add(new THREE.PointLight(0xff3030, 60, 60, 1.5));
        const hit = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hit.userData.i = i; group.add(hit); pickables.push(hit);
      } else if (n.fn) {
        // functions: small glowing crystals near their file
        r = radiusOf(n);
        const color = ui.resolveColor(ui.colorOf(n.lang));
        const hot = n.cx > (D.health ? D.health.thresholds.maxComplexity : 15);
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: hot ? 0xe0621b : color, emissive: hot ? 0x5a1a04 : 0x1a1a1a, metalness: 0.6, roughness: 0.25, flatShading: true }));
        gem.userData.i = i; gem.userData.spin = 0.6 + Math.random() * 0.6;
        group.add(gem); pickables.push(gem);
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
    // ---- the rail network: tracks run over the planets ----
    // Every relation leaves a planet on its upper half (towards the other planet). On top of each planet a
    // turntable joins the "spokes" to all its relations – that's where tracks cross and the train switches.
    const UPV = new THREE.Vector3(0, 1, 0);
    const trackR = i => (G.nodes[i].library && !G.nodes[i].vulns ? bodies[i].r * 1.25 : bodies[i].r) + 2.2;
    const pole = i => pos[i].clone().add(new THREE.Vector3(0, trackR(i), 0));
    const station = pole;
    const relKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
    const pairs = new Map(); // "lo-hi" -> { a, b, cyc, vuln }
    for (const l of G.links) {
      if (l.s === l.t) continue;
      const key = relKey(l.s, l.t);
      const p = pairs.get(key) || { a: Math.min(l.s, l.t), b: Math.max(l.s, l.t), cyc: false, vuln: false, fn: false };
      p.cyc = p.cyc || !!l.cyc;
      p.vuln = p.vuln || !!(G.nodes[l.t].library && G.nodes[l.t].vulns);
      p.fn = p.fn || !!l.fn;
      pairs.set(key, p);
    }
    // azimuth of each relation around its planet, spread so that tracks don't sit on top of each other
    const azimuth = G.nodes.map(() => new Map());
    const polar = G.nodes.map(() => new Map());
    G.nodes.forEach((_, i) => {
      const list = [...nb[i].keys()].filter(o => o !== i).map(o => {
        const to = pos[o].clone().sub(pos[i]);
        const el = to.clone().normalize().y;
        return { o, az: Math.atan2(to.z, to.x), th: 0.32 + (1 - el) * 0.2 };
      }).sort((x, y) => x.az - y.az);
      const n = list.length;
      const minSep = n > 1 ? Math.min(0.55, (Math.PI * 2 / n) * 0.8) : 0;
      for (let it = 0; it < 30 && n > 1; it++) {
        for (let k = 0; k < n; k++) {
          const x = list[k], y = list[(k + 1) % n];
          let gap = y.az - x.az;
          if (k === n - 1) gap += Math.PI * 2;
          if (gap < minSep) { const push = (minSep - gap) / 2; x.az -= push; y.az += push; }
        }
      }
      for (const x of list) { azimuth[i].set(x.o, x.az); polar[i].set(x.o, x.th); }
    });
    const dirOf = (i, az, th) => new THREE.Vector3(Math.cos(az) * Math.sin(th), Math.cos(th), Math.sin(az) * Math.sin(th));
    /** where the relation to `o` leaves planet i */
    const endDir = (i, o) => dirOf(i, azimuth[i].get(o) ?? 0, polar[i].get(o) ?? 0.8);
    const endPoint = (i, o) => pos[i].clone().add(endDir(i, o).multiplyScalar(trackR(i)));
    /** heading at the end point when leaving planet i (down the meridian, away from the pole) */
    const endTangent = (i, o) => {
      const az = azimuth[i].get(o) ?? 0, th = polar[i].get(o) ?? 0.8;
      return new THREE.Vector3(Math.cos(az) * Math.cos(th), -Math.sin(th), Math.sin(az) * Math.cos(th)).normalize();
    };
    /** arc over planet i from direction d0 to d1 (great circle), as points */
    function surfaceArc(i, d0, d1, from = 0, to = 1, step = 1.2) {
      const R = trackR(i);
      const ang = d0.angleTo(d1);
      const n = Math.max(2, Math.ceil((ang * R * (to - from)) / step));
      const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion().setFromUnitVectors(d0, d1);
      const pts = [];
      for (let s = 0; s <= n; s++) {
        const q = q0.clone().slerp(q1, from + (to - from) * (s / n));
        pts.push(pos[i].clone().add(d0.clone().applyQuaternion(q).multiplyScalar(R)));
      }
      return pts;
    }
    const curveCache = new Map();
    /** track between the end points of a and b (the same geometry in both directions) */
    function segCurve(a, b) {
      const key = a + '>' + b;
      if (!curveCache.has(key)) {
        const A = endPoint(a, b), B = endPoint(b, a);
        const k = Math.max(4, Math.min(45, A.distanceTo(B) * 0.26));
        const c1 = A.clone().add(endTangent(a, b).multiplyScalar(k)), c2 = B.clone().add(endTangent(b, a).multiplyScalar(k));
        curveCache.set(a + '>' + b, new THREE.CubicBezierCurve3(A, c1, c2, B));
        curveCache.set(b + '>' + a, new THREE.CubicBezierCurve3(B.clone(), c2.clone(), c1.clone(), A.clone()));
      }
      return curveCache.get(key);
    }
    /** the train's way over planet b: from the end of relation `from` over the turntable to relation `to` */
    function hubCurve(b, from, to) {
      const up = UPV.clone();
      const pts = [];
      if (from != null) pts.push(...surfaceArc(b, endDir(b, from), up, 0, 0.82));
      else pts.push(pole(b));
      if (to != null) pts.push(...surfaceArc(b, up, endDir(b, to), from != null ? 0.18 : 0.02, 1));
      const clean = pts.filter((p, k) => k === 0 || p.distanceTo(pts[k - 1]) > 0.3);
      if (clean.length < 2) clean.push(clean[0].clone().add(new THREE.Vector3(0.1, 0, 0)));
      return new THREE.CatmullRomCurve3(clean, false, 'centripetal');
    }
    /** the spoke from the turntable to relation o (rendered rails) */
    const spokeCurve = (i, o) => new THREE.CatmullRomCurve3(surfaceArc(i, UPV.clone(), endDir(i, o), 0.12, 1), false, 'centripetal');

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
    /** "down" for rails: towards the planet on the hubs, world-down in space */
    function railFrame(p, t, hub) {
      let down = hub != null ? pos[hub].clone().sub(p).normalize() : new THREE.Vector3(0, -1, 0);
      let side = new THREE.Vector3().crossVectors(t, down);
      if (side.lengthSq() < 1e-4) { down = new THREE.Vector3(0, -1, 0); side = new THREE.Vector3().crossVectors(t, down); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); }
      side.normalize();
      down = new THREE.Vector3().crossVectors(side, t).normalize().multiplyScalar(-1);
      return { side, down };
    }
    /** two glowing rails + sleeper matrices along a curve */
    function railTubes(curve, sleepers, hub, radius = 0.13) {
      const len = curve.getLength();
      const segs = Math.max(6, Math.round(len / 2));
      const tubes = [];
      for (const s of [-1, 1]) {
        const pts = [];
        for (let k = 0; k <= segs; k++) {
          const u = k / segs;
          const p = curve.getPointAt(u), t = curve.getTangentAt(u);
          const f = railFrame(p, t, hub);
          pts.push(p.add(f.side.multiplyScalar(s * 0.95)).add(f.down.multiplyScalar(1.25)));
        }
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, 5, false));
      }
      if (sleepers) {
        const m = new THREE.Matrix4(), basis = new THREE.Matrix4();
        for (let d = 1; d < len; d += 2.6) {
          const u = d / len;
          const p = curve.getPointAt(u), t = curve.getTangentAt(u);
          const f = railFrame(p, t, hub);
          basis.makeBasis(f.side, f.down.clone().multiplyScalar(-1), t);
          m.copy(basis).setPosition(p.clone().add(f.down.multiplyScalar(1.4)));
          sleepers.push(m.clone());
        }
      }
      return tubes;
    }
    const railMats = {
      steel: new THREE.MeshStandardMaterial({ color: 0xb8b2ac, emissive: 0x2a1a10, metalness: 0.9, roughness: 0.3 }),
      red: new THREE.MeshStandardMaterial({ color: 0xff4d4f, emissive: 0x661010, metalness: 0.8, roughness: 0.3 }),
      vuln: new THREE.MeshStandardMaterial({ color: 0x9a2a2a, emissive: 0x3a0808, metalness: 0.7, roughness: 0.4 }),
      fn: new THREE.MeshStandardMaterial({ color: 0xf7ae62, emissive: 0x4a2408, metalness: 0.6, roughness: 0.4 }),
      sleeper: new THREE.MeshStandardMaterial({ color: 0x2c2c30, emissive: 0x120804, metalness: 0.6, roughness: 0.5 }),
      table: new THREE.MeshStandardMaterial({ color: 0x3a3a40, emissive: 0x1a0c04, metalness: 0.8, roughness: 0.35 }),
      tableEdge: new THREE.MeshBasicMaterial({ color: 0xe0621b }),
      route: new THREE.MeshBasicMaterial({ color: 0xffa24d, transparent: true, opacity: 0.9 }),
      routeRed: new THREE.MeshBasicMaterial({ color: 0xff4d4f, transparent: true, opacity: 0.9 }),
    };
    {
      const byMat = { steel: [], red: [], vuln: [], fn: [] };
      const sleeperM = [];
      const matOf = p => (p.cyc ? 'red' : p.vuln ? 'vuln' : p.fn ? 'fn' : 'steel');
      for (const p of pairs.values()) {
        byMat[matOf(p)].push(...railTubes(segCurve(p.a, p.b), sleeperM, null));
        byMat[matOf(p)].push(...railTubes(spokeCurve(p.a, p.b), sleeperM, p.a), ...railTubes(spokeCurve(p.b, p.a), sleeperM, p.b));
      }
      for (const [k, geos] of Object.entries(byMat)) if (geos.length) scene.add(new THREE.Mesh(mergeGeometries(geos), railMats[k]));
      if (sleeperM.length) {
        const im = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.16, 0.45), railMats.sleeper, sleeperM.length);
        sleeperM.forEach((m, i) => im.setMatrixAt(i, m));
        scene.add(im);
      }
      // turntables on top of every planet with relations (where the tracks cross)
      const tables = G.nodes.map((_, i) => i).filter(i => nb[i].size);
      if (tables.length) {
        const disc = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 0.3, 32), railMats.table, tables.length);
        const edge = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.04, 1.04, 0.12, 32, 1, true), railMats.tableEdge, tables.length);
        tables.forEach((i, k) => {
          const rad = Math.max(3.2, trackR(i) * 0.36);
          const m = new THREE.Matrix4().compose(pole(i).add(new THREE.Vector3(0, -1.45, 0)), new THREE.Quaternion(), new THREE.Vector3(rad, 1, rad));
          disc.setMatrixAt(k, m); edge.setMatrixAt(k, m);
        });
        scene.add(disc, edge);
      }
    }
    // chain mode: the route glows between the rails
    const routeGroup = new THREE.Group();
    scene.add(routeGroup);
    function glowTube(curve, hub, r = 0.32) {
      const len = curve.getLength();
      const n = Math.max(6, Math.round(len / 3));
      const pts = [];
      for (let s = 0; s <= n; s++) {
        const u = s / n, p = curve.getPointAt(u);
        pts.push(p.add(railFrame(p, curve.getTangentAt(u), hub).down.multiplyScalar(1.3)));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, r, 5, false);
    }
    function highlightRoute(r) {
      routeGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      routeGroup.clear();
      if (!r) return;
      const geos = [];
      const P = r.path;
      const n = P.length - 1 + (r.loop ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const a = P[k], b = P[(k + 1) % P.length];
        if (a === b) continue;
        geos.push(glowTube(segCurve(a, b), null), glowTube(spokeCurve(a, b), a), glowTube(spokeCurve(b, a), b));
      }
      if (geos.length) routeGroup.add(new THREE.Mesh(mergeGeometries(geos), r.cycle ? railMats.routeRed : railMats.route));
    }

    // ---- junction indicators: the way over the turntable for each option ----
    const choiceGroup = new THREE.Group();
    scene.add(choiceGroup);
    function showChoices(node, options, sel, from) {
      choiceGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      choiceGroup.clear();
      if (!options) return;
      options.forEach((o, k) => {
        const on = k === sel;
        const c = hubCurve(node, from ?? null, o);
        const tube = new THREE.Mesh(glowTube(c, node, on ? 0.5 : 0.22),
          new THREE.MeshBasicMaterial({ color: on ? 0xffb46b : 0x777777, transparent: true, opacity: on ? 0.95 : 0.45 }));
        tube.position.y += 0.9;
        choiceGroup.add(tube);
        if (on) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 12), new THREE.MeshBasicMaterial({ color: 0xffb46b }));
          const end = c.getPointAt(1), t = c.getTangentAt(1);
          cone.position.copy(end).add(new THREE.Vector3(0, 1.2, 0));
          cone.quaternion.setFromUnitVectors(UPV, t);
          choiceGroup.add(cone);
        }
      });
    }

    // ---- train ----
    const T = buildTrain();
    scene.add(T.train);
    const smoke = [];
    const smokeTex = glowTexture('rgba(255,140,50,.9)');

    const S = {
      mode: routes.length ? 'chain' : 'free', drive: 'auto', cam: 'chase', paused: false, speed: 1,
      yaw: 0, pitch: 0.5, dist: 40, orbitTarget: new THREE.Vector3(), orbitDist: 400,
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
    // key bindings (setting linecounter.train.keys)
    const K = { forward: 'w', back: 's', left: 'a', right: 'd', up: 'q', down: 'e', snap: 'r', fly: 'x', camera: 'c' };
    for (const [k, v] of Object.entries(D.trainKeys || {})) if (k in K && typeof v === 'string' && v.trim()) K[k] = v.trim().toLowerCase() === 'space' ? ' ' : v.trim().toLowerCase();
    const KB = k => `<b>${esc(K[k] === ' ' ? 'Space' : K[k].length === 1 ? K[k].toUpperCase() : K[k])}</b>`;

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
    const name = i => { const n = G.nodes[i]; return n.fn ? `${n.path} · ${n.filePath.split('/').pop()}` : n.library ? `${n.path}${n.version ? '@' + n.version : ''}` : n.path.split('/').slice(-2).join('/'); };

    function setSeg(a, b, d) {
      const curve = segCurve(a, b);
      S.seg = { a, b, curve, len: curve.getLength() };
      S.d = Math.min(d || 0, S.seg.len);
      S.gate = S.seg.len; // the end point on the next planet – decisions happen there
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
      const { a, b } = S.seg;
      startLink(hubCurve(b, a, c), over => {
        if (S.mode === 'chain') S.k = wrap(S.k + S.dir, S.route.path.length);
        setSeg(b, c, over);
      });
    }
    /** continue from the current portal to relation c (back the same way means turning around) */
    function go(c) {
      if (c === S.seg.a) { startTurn(); return; }
      linkThrough(c);
    }
    /** index of the relation that continues most straight */
    function straightest(node, options) {
      const prev = S.seg ? S.seg.a : null;
      const dirIn = prev != null ? endTangent(node, prev).multiplyScalar(-1) : new THREE.Vector3(0, 0, -1);
      let sel = 0, best = -Infinity;
      options.forEach((o, k) => {
        const dot = endTangent(node, o).dot(dirIn);
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
      setSeg(P[0], P[1] ?? P[0], 0);
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
      S.mode = 'free'; S.route = null; S.finished = false; S.v = 0; S.turn = null; S.fly = null; S.link = null; S.dwell = 0;
      S.visits = new Map([[node, 1]]);
      highlightRoute(null);
      stopsEl.innerHTML = '';
      const options = [...nb[node].keys()];
      S.seg = null;
      S.waiting = { node, options, sel: 0, prev: null, start: true };
      S.needRelease = keys.has(K.forward);
      if (options.length && S.drive === 'auto') { const o = options[Math.floor(Math.random() * options.length)]; setSeg(node, o, 0); seedTrail(); }
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
      showChoices(b, options, sel, a);
    }
    /** manual: W at a junction confirms the selected relation */
    function confirmChoice() {
      const w = S.waiting;
      if (!w || !w.options.length) return;
      const o = w.options[w.sel];
      if (w.start) {
        S.waiting = null;
        showChoices(null);
        startLink(hubCurve(w.node, null, o), over => setSeg(w.node, o, over));
        return;
      }
      S.waiting = null;
      showChoices(null);
      go(o);
    }

    // ---- turning around: hover, spin 180° with all wagons, land on the track back ----
    const tmpObj = new THREE.Object3D();
    function poseQuat(p, dir, u) { orient(tmpObj, p, dir, u); return tmpObj.quaternion.clone(); }
    function startTurn() {
      if (!S.seg || S.turn || S.link) return;
      const { a, b, len } = S.seg;
      const c2 = segCurve(b, a);
      const d2 = Math.max(0, Math.min(len, len - S.d + trainLength()));
      const trail2 = trailAlong(c2, len, d2);
      const cars = [T.loco, ...T.wagons];
      const to = cars.map((o, k) => {
        const pose = k === 0 ? { p: c2.getPointAt(d2 / len), dir: c2.getTangentAt(d2 / len) } : wagonPose(trail2, k * 7) || { p: c2.getPointAt(d2 / len), dir: c2.getTangentAt(d2 / len) };
        return { p: pose.p, q: poseQuat(pose.p, pose.dir, upAt(pose.p)) };
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
      for (let d = 0; d <= len; d += 4) trackSamples.push({ a: p.a, b: p.b, d, len, p: c.getPointAt(d / len) });
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
      const dT = Math.min(len - 1, d + Math.min(30, 8 + Math.sqrt(bd) * 0.4));
      const target = Math.max(0, dT);
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
      const steer = (keys.has(K.left) ? 1 : 0) - (keys.has(K.right) ? 1 : 0);
      const climb = (keys.has(K.up) ? 1 : 0) - (keys.has(K.down) ? 1 : 0);
      f.yaw += steer * 1.3 * dt;
      f.pitch = Math.max(-1.3, Math.min(1.3, f.pitch + climb * 1.0 * dt));
      if (S.drive === 'auto') f.v += (maxV - f.v) * Math.min(1, dt * 1.5);
      else if (keys.has(K.forward)) f.v = Math.min(maxV * 1.6, f.v + maxV * 1.3 * dt);
      else if (keys.has(K.back)) f.v = Math.max(0, f.v - maxV * 2 * dt);
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
        ? `${S.drive === 'manual' ? `${KB('forward')} thrust · ${KB('back')} brake` : 'Cruise control'} · ${KB('left')}/${KB('right')} steer · ${KB('up')}/${KB('down')} climb / dive · ${KB('snap')} snap onto the nearest relation · ${KB('camera')} camera`
        : S.drive === 'manual'
          ? `${KB('forward')} drive · ${KB('back')} turn around${S.mode === 'free' ? ` · ${KB('left')}/${KB('right')} choose the relation at a junction${S.autoChoose ? ' (auto-choose on)' : ` – release and press ${KB('forward')} again to go`}` : ''} · ${KB('fly')} fly · ${KB('camera')} camera · drag to look`
          : `Auto pilot${S.mode === 'free' ? ' – picks a random relation at every junction' : ''} · <b>Space</b> pause · <b>↑</b>/<b>↓</b> speed · ${KB('fly')} fly · ${KB('camera')} camera · drag to look`;
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
      if (b.dataset.t3 === 'functions') {
        const here = S.seg ? S.seg.a : S.waiting ? S.waiting.node : startNode;
        const hn = G.nodes[here];
        const abs = hn && hn.fn ? hn.file : hn && hn.abs;
        const next = { ...opts, functions: !opts.functions, selectedAbs: abs, mode: S.mode === 'chain' ? 'chain' : 'free', drive: S.drive };
        setTimeout(() => open(ui, D, next), 0);
        return;
      }
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
      setSeg(S.route.path[k], S.route.path[k + 1], 0);
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
        ${n.fn ? `<div>function in ${esc(n.filePath)}:${n.line}</div><div>complexity ${n.cx} · ${n.lines} lines · calls ${n.out} · called by ${n.in}</div>` : n.library ? `<div>${esc(n.ecosystem)} library${n.license ? ` · ${esc(n.license)}` : ''}</div>${n.vulns ? `<div class="t3-red">💀 ${n.vulns} known vulnerabilit${n.vulns === 1 ? 'y' : 'ies'} (${esc(n.severity || 'unknown')})</div>` : ''}`
        : `<div>imports ${n.out} · imported by ${n.in}${n.dependents != null ? ` · ${n.dependents} depend on it` : ''}</div>${n.cycle >= 0 ? '<div class="t3-red">part of a circular import</div>' : ''}${vulnerableFiles.has(i) ? '<div class="t3-red">💀 imports a vulnerable package</div>' : ''}`}
        <div class="t3-info-actions">${n.fn ? `<button data-open="${esc(n.file)}" data-line="${n.line}">Open function</button>` : !n.library ? `<button data-open="${esc(n.abs)}">Open file</button>` : ''}<button data-roam="${i}">Free roam from here</button><button data-ride="${i}">Ride its longest chain</button></div>`;
      infoEl.classList.add('show');
    }
    infoEl.addEventListener('click', ev => {
      const b = /** @type {HTMLElement} */ (ev.target).closest('button');
      if (!b) return;
      if (b.dataset.open) ui.post({ type: 'open', abs: b.dataset.open, line: b.dataset.line ? Number(b.dataset.line) : undefined });
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
      if (keys.has(k) && [K.back, K.left, K.right, K.camera, K.fly, K.snap].includes(k)) return; // no key repeat for toggles
      keys.add(k);
      if (k === ' ') { S.paused = !S.paused; ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { S.speed = Math.min(4, S.speed + 0.2); speed.value = String(S.speed); }
      else if (ev.key === 'ArrowDown') { S.speed = Math.max(0.2, S.speed - 0.2); speed.value = String(S.speed); }
      else if (k === K.camera) setCam(S.cam === 'chase' ? 'cab' : S.cam === 'cab' ? 'orbit' : 'chase');
      else if (k === K.back) reverse();
      else if (k === K.fly) { if (S.fly) snapToTrack(); else if (!S.turn) startFly(); }
      else if (k === K.snap && S.fly) snapToTrack();
      else if ((k === K.left || k === K.right) && S.waiting && S.waiting.options.length > 1) {
        const w = S.waiting;
        w.sel = (w.sel + (k === K.right ? 1 : -1) + w.options.length) % w.options.length;
        showChoices(w.node, w.options, w.sel, w.start ? null : w.prev);
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
    /** pushes a point (the camera) out of planets */
    function keepOutside(p) {
      for (let i = 0; i < bodies.length; i++) {
        const min = trackR(i) + 5;
        const d = p.distanceTo(pos[i]);
        if (d < min) p.sub(pos[i]).normalize().multiplyScalar(min).add(pos[i]);
      }
    }
    /** "up" for the train: away from the planet it drives over, world up out in space */
    function upAt(p) {
      let best = null, bd = Infinity;
      for (let i = 0; i < bodies.length; i++) {
        if (!nb[i].size) continue;
        const d = p.distanceTo(pos[i]) - trackR(i);
        if (d < bd) { bd = d; best = i; }
      }
      if (best == null || bd > 16) return UPV.clone();
      const radial = p.clone().sub(pos[best]).normalize();
      const w = Math.max(0, Math.min(1, 1 - bd / 16));
      return UPV.clone().lerp(radial, w * w * (3 - 2 * w)).normalize();
    }
    function orient(obj, p, dir, u) {
      obj.up.copy(u || UPV);
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
          if (keys.has(K.forward)) S.v = Math.min(maxV, S.v + maxV * 1.2 * dt);
          else S.v = Math.max(0, S.v - maxV * 1.5 * dt);
        }
        advance(S.v * dt);
      }
      if (S.waiting && S.drive === 'manual') {
        if (!keys.has(K.forward)) S.needRelease = false;
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
            const c = hubCurve(w.node, null, o);
            lp = c.getPointAt(0); fwd = c.getTangentAt(0.05);
          } else { lp = station(w ? w.node : startNode).add(new THREE.Vector3(0, bodies[w ? w.node : startNode].r + 3, 0)); fwd = new THREE.Vector3(0, 0, -1); }
          if (!S.trail.length || S.trail[S.trail.length - 1].distanceTo(lp) > 0.5) {
            S.trail = [];
            for (let x = -trainLength() - 6; x <= 0; x += 1) S.trail.push(lp.clone().add(fwd.clone().multiplyScalar(x)));
          }
        }
        orient(T.loco, lp, fwd, upAt(lp));
        const last = S.trail[S.trail.length - 1];
        if (!last || last.distanceTo(lp) > 0.4) { S.trail.push(lp.clone()); if (S.trail.length > 400) S.trail.shift(); }
        T.wagons.forEach((w, k) => {
          const pose = wagonPose(S.trail, (k + 1) * 7);
          w.visible = !!pose;
          if (pose) orient(w, pose.p, pose.dir, upAt(pose.p));
        });
      }
      // ion trail from the engine, hover bobbing, engine glow with the throttle
      const tNow = clock.elapsedTime;
      T.bobs.forEach((b, k) => { b.position.y = Math.sin(tNow * 2.4 + k * 0.9) * 0.18; });
      T.exhaust.material.opacity = 0.35 + Math.min(1, S.v / 30) * 0.6;
      if (!S.paused && S.v > 0.5 && Math.random() < 0.7) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.5, blending: THREE.AdditiveBlending }));
        s.position.copy(T.loco.localToWorld(T.chimneyLocal.clone()));
        s.scale.setScalar(1.2);
        s.userData.life = 0;
        scene.add(s); smoke.push(s);
      }
      for (let k = smoke.length - 1; k >= 0; k--) {
        const s = smoke[k];
        s.userData.life += dt;
        s.scale.setScalar(1.4 + s.userData.life * 2.5);
        s.material.opacity = Math.max(0, 0.55 - s.userData.life * 0.45);
        if (s.userData.life > 1.2) { scene.remove(s); s.material.dispose(); smoke.splice(k, 1); }
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
        camera.quaternion.copy(T.loco.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08 - (S.pitch - 0.5) * 0.6, S.yaw * 0.6, 0, 'YXZ')));
      } else if (S.cam === 'chase') {
        // follow from behind using the mostly horizontal travel direction (steep tracks would put the camera below the train)
        const flat = new THREE.Vector3(locoFwd.x, locoFwd.y * 0.25, locoFwd.z);
        if (flat.lengthSq() < 0.05) flat.set(0, 0, -1);
        flat.normalize();
        const back = flat.multiplyScalar(-1).applyAxisAngle(up, S.yaw);
        const base = T.loco.position;
        const eye = base.clone().add(back.multiplyScalar(S.dist * Math.cos(S.pitch))).add(new THREE.Vector3(0, S.dist * Math.sin(S.pitch) + 3, 0));
        camera.position.lerp(eye, ease(S.turn ? 3 : 6));
        keepOutside(camera.position);
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
        nextEl.innerHTML = S.finished ? `<span class="t3-muted">End of the line.</span> Press ${KB('back')} to turn around or pick another route.` : `<span class="t3-muted">Next stop</span> ${esc(name(S.seg.b))}${G.nodes[S.seg.b].cycle >= 0 ? ' <span class="t3-red">(circular import)</span>' : ''}`;
        const posK = Math.max(0, P.indexOf(S.seg.a));
        const frac = (posK + (S.dir > 0 ? 1 : -1) * Math.min(1, S.d / S.seg.len)) / Math.max(1, P.length - 1);
        progEl.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%';
        stopsEl.querySelectorAll('.t3-stop').forEach((el, k) => { el.classList.toggle('here', P[k] === S.seg.a); el.classList.toggle('next', P[k] === S.seg.b); });
        choiceEl.innerHTML = '';
      } else if (S.mode === 'fly') {
        progEl.style.width = '0%';
        nowEl.innerHTML = '<span class="t3-muted">Off the rails</span> – free flight';
        nextEl.innerHTML = `${Math.round(S.v)} u/s · press ${KB('snap')} to snap onto the nearest relation`;
        choiceEl.innerHTML = '';
      } else {
        progEl.style.width = S.seg ? ((S.d / S.seg.len) * 100).toFixed(1) + '%' : '0%';
        if (S.waiting) {
          const w = S.waiting;
          nowEl.innerHTML = `<span class="t3-muted">${w.dead ? 'Dead end at' : 'Junction at'}</span> ${esc(name(w.node))}`;
          if (w.dead) { nextEl.innerHTML = S.drive === 'manual' ? `Dead end – press ${KB('back')} to turn around.` : 'Dead end – turning around…'; choiceEl.innerHTML = ''; }
          else if (!w.options.length) { nextEl.innerHTML = 'This file has no relations. Pick another planet (click it).'; choiceEl.innerHTML = ''; }
          else {
            nextEl.innerHTML = S.drive === 'manual' ? `Choose a relation with ${KB('left')} / ${KB('right')}, ${S.needRelease ? `release and press ${KB('forward')} again` : `drive with ${KB('forward')}`}` : '';
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
