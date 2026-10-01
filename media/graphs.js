// @ts-check
/* global d3 */
// Canvas based visualisations for the statistics page: grouped treemap and animated force graphs.
(function () {
  const cssVar = n => getComputedStyle(document.body).getPropertyValue(n).trim();
  const resolveColor = c => {
    const m = /var\((--[\w-]+)\)/.exec(c || '');
    return m ? cssVar(m[1]) || '#888' : c || '#888';
  };
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function makeCanvas(container, layers = 1) {
    container.innerHTML = '';
    container.style.position = container.style.position || 'relative';
    const canvases = [];
    for (let i = 0; i < layers; i++) {
      const c = document.createElement('canvas');
      c.style.position = 'absolute';
      c.style.left = '0';
      c.style.top = '0';
      if (i > 0) c.style.pointerEvents = 'none';
      container.appendChild(c);
      canvases.push(c);
    }
    const state = { w: 0, h: 0, dpr: 1 };
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      state.w = Math.max(10, container.clientWidth);
      state.h = Math.max(10, container.clientHeight);
      state.dpr = dpr;
      for (const c of canvases) {
        c.width = Math.round(state.w * dpr);
        c.height = Math.round(state.h * dpr);
        c.style.width = state.w + 'px';
        c.style.height = state.h + 'px';
        c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    resize();
    return { canvases, ctxs: canvases.map(c => c.getContext('2d')), state, resize };
  }

  // ---------------------------------------------------------------- treemap
  function squarify(items, x, y, w, h) {
    const out = [];
    const total = items.reduce((s, i) => s + i.value, 0);
    if (!total || w <= 0 || h <= 0) return out;
    const scale = (w * h) / total;
    const nodes = items.filter(i => i.value > 0).map(i => ({ item: i, area: i.value * scale }));
    let row = [];
    let rowSum = 0;
    const worst = (sum, mx, mn, side) => Math.max((side * side * mx) / (sum * sum), (sum * sum) / (side * side * mn));
    let rmx = 0, rmn = Infinity;
    const layoutRow = () => {
      if (w >= h) {
        const cw = rowSum / h; let cy = y;
        for (const n of row) { const ch = n.area / cw; out.push({ item: n.item, x, y: cy, w: cw, h: ch }); cy += ch; }
        x += cw; w -= cw;
      } else {
        const ch = rowSum / w; let cx = x;
        for (const n of row) { const cw = n.area / ch; out.push({ item: n.item, x: cx, y, w: cw, h: ch }); cx += cw; }
        y += ch; h -= ch;
      }
      row = []; rowSum = 0; rmx = 0; rmn = Infinity;
    };
    for (const n of nodes) {
      const side = Math.min(w, h);
      if (!row.length) { row.push(n); rowSum = n.area; rmx = rmn = n.area; continue; }
      const nSum = rowSum + n.area;
      if (worst(nSum, Math.max(rmx, n.area), Math.min(rmn, n.area), side) <= worst(rowSum, rmx, rmn, side)) {
        row.push(n); rowSum = nSum; rmx = Math.max(rmx, n.area); rmn = Math.min(rmn, n.area);
      } else { layoutRow(); row.push(n); rowSum = n.area; rmx = rmn = n.area; }
    }
    if (row.length) layoutRow();
    return out;
  }

  /**
   * Treemap of every file (no "other" bucket), grouped by top-level folder, drawn on canvas.
   * opts: { files, colorOf(file), groupOf(file), onHover(file|null, ev), onClick(file, ev), onDblClick(file), onContext(file, ev) }
   */
  function Treemap(container, opts) {
    const cv = makeCanvas(container, 2);
    const [ctx, over] = cv.ctxs;
    let files = opts.files;
    let rects = [];
    let groups = [];
    let hovered = null;

    function layout() {
      const { w, h } = cv.state;
      const byGroup = new Map();
      for (const f of files) {
        if (!(f.lines > 0)) continue;
        const g = opts.groupOf(f);
        if (!byGroup.has(g)) byGroup.set(g, { name: g, value: 0, files: [] });
        const G = byGroup.get(g);
        G.value += f.lines; G.files.push(f);
      }
      const gl = [...byGroup.values()].sort((a, b) => b.value - a.value);
      groups = squarify(gl, 0, 0, w, h);
      rects = [];
      for (const g of groups) {
        const G = g.item;
        const head = g.w > 70 && g.h > 50 ? 16 : 0;
        const pad = g.w > 12 && g.h > 12 ? 2 : 0;
        g.head = head;
        const fs = G.files.sort((a, b) => b.lines - a.lines).map(f => ({ value: f.lines, f }));
        for (const r of squarify(fs, g.x + pad, g.y + pad + head, g.w - pad * 2, g.h - pad * 2 - head)) {
          rects.push({ f: r.item.f, x: r.x, y: r.y, w: r.w, h: r.h });
        }
      }
    }

    function draw() {
      const { w, h } = cv.state;
      ctx.clearRect(0, 0, w, h);
      const bg = cssVar('--bg') || '#1b1b1b';
      const colorCache = new Map();
      const col = f => {
        const c = opts.colorOf(f);
        if (!colorCache.has(c)) colorCache.set(c, resolveColor(c));
        return colorCache.get(c);
      };
      for (const g of groups) {
        ctx.fillStyle = '#262626';
        ctx.fillRect(g.x, g.y, g.w, g.h);
      }
      for (const r of rects) {
        ctx.fillStyle = col(r.f);
        if (r.w >= 2 && r.h >= 2) ctx.fillRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        else ctx.fillRect(r.x, r.y, Math.max(r.w, 0.6), Math.max(r.h, 0.6));
      }
      ctx.textBaseline = 'top';
      ctx.font = '600 11px ' + (cssVar('--vscode-font-family') || 'sans-serif');
      for (const r of rects) {
        if (r.w < 60 || r.h < 18) continue;
        const c = col(r.f);
        ctx.fillStyle = isDark(c) ? '#f2f2f2' : '#141414';
        const name = r.f.path.split('/').pop();
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x + 3, r.y + 2, r.w - 6, r.h - 4); ctx.clip();
        ctx.fillText(fit(ctx, name, r.w - 8), r.x + 5, r.y + 4);
        ctx.restore();
      }
      for (const g of groups) {
        ctx.strokeStyle = bg; ctx.lineWidth = 2;
        ctx.strokeRect(g.x, g.y, g.w, g.h);
        if (g.head) {
          ctx.fillStyle = '#d9d6d2';
          ctx.font = '700 11px ' + (cssVar('--vscode-font-family') || 'sans-serif');
          ctx.fillText(fit(ctx, g.item.name + '  ·  ' + g.item.value.toLocaleString('en-US') + ' lines', g.w - 10), g.x + 5, g.y + 3);
        }
      }
    }

    function drawHover() {
      over.clearRect(0, 0, cv.state.w, cv.state.h);
      if (!hovered) return;
      over.strokeStyle = '#ffffff'; over.lineWidth = 2;
      over.strokeRect(hovered.x + 1, hovered.y + 1, Math.max(1, hovered.w - 2), Math.max(1, hovered.h - 2));
    }

    function hit(ev) {
      const b = cv.canvases[0].getBoundingClientRect();
      const x = ev.clientX - b.left, y = ev.clientY - b.top;
      for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
      }
      return null;
    }
    const c0 = cv.canvases[0];
    c0.style.cursor = 'pointer';
    c0.addEventListener('mousemove', ev => {
      const r = hit(ev);
      if (r !== hovered) { hovered = r; drawHover(); }
      opts.onHover(r ? r.f : null, ev);
    });
    c0.addEventListener('mouseleave', ev => { hovered = null; drawHover(); opts.onHover(null, ev); });
    c0.addEventListener('click', ev => { const r = hit(ev); if (r) opts.onClick(r.f, ev); });
    c0.addEventListener('dblclick', ev => { const r = hit(ev); if (r) opts.onDblClick(r.f, ev); });
    c0.addEventListener('contextmenu', ev => { const r = hit(ev); if (r) { ev.preventDefault(); ev.stopPropagation(); opts.onContext(r.f, ev); } });

    function render() { cv.resize(); layout(); draw(); drawHover(); }
    render();
    return {
      render,
      remove(abs) { files = files.filter(f => f.abs !== abs); hovered = null; render(); },
      count: () => rects.length,
    };
  }

  /** Small vector skull (used for packages with known vulnerabilities). */
  function drawSkull(c, x, y, r, color) {
    c.save();
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y - r * 0.15, r * 0.85, Math.PI * 0.95, Math.PI * 0.05, false); // cranium
    c.lineTo(x + r * 0.55, y + r * 0.55);
    c.lineTo(x - r * 0.55, y + r * 0.55);
    c.closePath(); c.fill();
    c.fillRect(x - r * 0.45, y + r * 0.45, r * 0.9, r * 0.45); // jaw
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(x - r * 0.33, y - r * 0.1, r * 0.24, 0, Math.PI * 2); c.fill(); // eyes
    c.beginPath(); c.arc(x + r * 0.33, y - r * 0.1, r * 0.24, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(x, y + r * 0.12); c.lineTo(x - r * 0.1, y + r * 0.32); c.lineTo(x + r * 0.1, y + r * 0.32); c.closePath(); c.fill(); // nose
    for (let i = -1; i <= 1; i++) c.fillRect(x + i * r * 0.22 - r * 0.04, y + r * 0.6, r * 0.08, r * 0.3); // teeth gaps
    c.restore();
  }

  function isDark(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return false;
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b < 110;
  }
  function fit(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1; }
    return lo ? text.slice(0, lo) + '…' : '';
  }

  // ---------------------------------------------------------------- force graph
  /**
   * Force-directed graph on canvas with zoom, pan, drag, hover and path highlighting.
   * opts: {
   *   nodes, links (source/target = node index), radius(n), color(n), label(n), showLabel(n, k),
   *   linkColor(l), linkWidth(l), linkAlpha, distance(l), charge(n), arrows, collidePad,
   *   ring(n) -> bool | ringColor(n) -> color|null, layer(n) -> number (for the layered layout),
   *   motion: 'wiggle' | 'calm' | 'still', layout: 'force' | 'layered',
   *   onClick(n, ev), onDblClick(n, ev), onBackground(ev), onContext(n, ev), onHover(n|null, ev)
   * }
   */
  function ForceGraph(container, opts) {
    const cv = makeCanvas(container, 1);
    const ctx = cv.ctxs[0];
    const canvas = cv.canvases[0];
    let nodes = [], links = [], adj = new Map();
    let transform = d3.zoomIdentity;
    let hovered = null;
    let running = true;
    let visible = false;
    let everVisible = false;
    let fitted = false;
    let motion = reducedMotion() ? 'calm' : (opts.motion || 'calm');
    let layout = opts.layout || 'force';
    let highlight = null; // { nodes: Map(index -> color), links: Map(link -> color) }
    let colorCache = new Map();
    const col = c => { if (!colorCache.has(c)) colorCache.set(c, resolveColor(c)); return colorCache.get(c); };
    const nodeR = n => (opts.radius ? opts.radius(n) : 4);
    // ---- clusters: nodes of one group (e.g. folder) gather around their own anchor inside a soft bubble ----
    let clusters = !!opts.clusters;
    let groups = new Map(); // key -> { key, n, x, y, r, color, label, hull }
    const groupOf = n => (opts.group ? opts.group(n) : null);
    function computeGroups() {
      groups = new Map();
      if (!opts.group) return;
      for (const n of nodes) {
        const g = groupOf(n);
        if (g == null) continue;
        let e = groups.get(g);
        if (!e) groups.set(g, (e = { key: g, n: 0, area: 0 }));
        e.n++;
        e.area += Math.pow(nodeR(n) + 9, 2) * Math.PI;
      }
      // anchors: circles packed without overlap, sized by the space the members need
      const list = [...groups.values()].sort((a, b) => b.n - a.n);
      for (const e of list) { e.r = Math.sqrt(e.area / Math.PI) * 1.5 + 26; e.color = opts.groupColor ? opts.groupColor(e.key) : '#888'; e.label = opts.groupLabel ? opts.groupLabel(e.key, e.n) : String(e.key); }
      const packed = list.map(e => ({ r: e.r + 22, e }));
      d3.packSiblings(packed);
      for (const p of packed) { p.e.x = p.x; p.e.y = p.y; }
    }
    function applyClusters() {
      computeGroups();
      if (clusters && groups.size > 1) {
        const anchor = n => groups.get(groupOf(n));
        sim.force('x', d3.forceX(n => (anchor(n) ? anchor(n).x : 0)).strength(n => (anchor(n) ? 0.16 : 0.02)));
        sim.force('y', d3.forceY(n => (anchor(n) ? anchor(n).y : 0)).strength(n => (anchor(n) ? 0.16 : 0.02)));
        sim.force('link').strength(l => (groupOf(l.source) === groupOf(l.target) ? 0.35 : 0.012));
        sim.force('charge').distanceMax(160);
        sim.force('collide').radius(n => nodeR(n) + 4);
      } else {
        sim.force('charge').distanceMax(400);
        sim.force('collide').radius(n => nodeR(n) + (opts.collidePad ?? 2));
        applyLayout();
      }
    }
    function drawHulls(k) {
      if (!clusters || groups.size < 2) return;
      const pts = new Map();
      for (const n of nodes) {
        const g = groupOf(n);
        if (g == null || !groups.has(g)) continue;
        if (!pts.has(g)) pts.set(g, []);
        const r = nodeR(n) + 12;
        for (let a = 0; a < 8; a++) pts.get(g).push([n.x + Math.cos(a * Math.PI / 4) * r, n.y + Math.sin(a * Math.PI / 4) * r]);
      }
      ctx.save();
      ctx.lineJoin = 'round';
      for (const [g, list] of pts) {
        const e = groups.get(g);
        const hull = d3.polygonHull(list);
        if (!hull) continue;
        e.hull = hull;
        const c = col(e.color);
        ctx.beginPath();
        hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.globalAlpha = highlight ? 0.04 : 0.09;
        ctx.fillStyle = c; ctx.fill();
        ctx.globalAlpha = highlight ? 0.15 : 0.45;
        ctx.strokeStyle = c; ctx.lineWidth = 1.4 / k; ctx.stroke();
        // label above the bubble
        let top = hull[0];
        for (const p of hull) if (p[1] < top[1]) top = p;
        const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
        ctx.globalAlpha = highlight ? 0.35 : 0.9;
        ctx.font = `600 ${Math.max(10, 12 / Math.sqrt(k))}px var(--vscode-font-family, system-ui)`;
        ctx.fillStyle = c;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(e.label, cx, top[1] - 4 / k);
      }
      ctx.restore();
    }

    const sim = d3.forceSimulation()
      .force('link', d3.forceLink().distance(l => (opts.distance ? opts.distance(l) : 40)).strength(l => (opts.linkStrength ? opts.linkStrength(l) : 0.4)))
      .force('charge', d3.forceManyBody().strength(n => (opts.charge ? opts.charge(n) : -60)).distanceMax(400))
      .force('x', d3.forceX(0).strength(0.04))
      .force('y', d3.forceY(0).strength(0.04))
      .force('collide', d3.forceCollide(n => nodeR(n) + (opts.collidePad ?? 2)))
      .on('tick', () => {
        if (motion === 'wiggle') jiggle();
        if (!fitted && sim.alpha() < 0.12) { fitted = true; fitView(600); }
        draw();
      });

    function applyLayout() {
      if (layout === 'layered' && opts.layer) {
        const maxL = Math.max(1, ...nodes.map(n => opts.layer(n)));
        const gap = Math.max(60, Math.min(120, 900 / maxL));
        sim.force('y', d3.forceY(n => (opts.layer(n) - maxL / 2) * gap).strength(0.9));
        sim.force('x', d3.forceX(0).strength(0.015));
        sim.force('link').strength(0.08);
      } else {
        sim.force('y', d3.forceY(0).strength(0.04));
        sim.force('x', d3.forceX(0).strength(0.04));
        sim.force('link').strength(l => (opts.linkStrength ? opts.linkStrength(l) : 0.4));
      }
    }

    function applyMotion() {
      // calm and still settle quickly and then stop moving completely
      sim.velocityDecay(motion === 'wiggle' ? 0.4 : 0.55);
      sim.alphaDecay(motion === 'wiggle' ? 0.02 : motion === 'calm' ? 0.035 : 0.08);
    }

    const t0 = performance.now();
    function jiggle() {
      // gentle organic wobble: every node follows its own slow sine wave
      const t = (performance.now() - t0) / 1000;
      for (const n of nodes) {
        if (n.fx != null) continue;
        n.vx += Math.sin(t * 0.9 + n.index * 1.7) * 0.06;
        n.vy += Math.cos(t * 0.8 + n.index * 2.3) * 0.06;
      }
    }

    function setData(newNodes, newLinks, keepPositions) {
      const old = new Map(nodes.map(n => [n.id, n]));
      nodes = newNodes.map((n, i) => {
        const o = keepPositions && old.get(n.id);
        return Object.assign(n, o ? { x: o.x, y: o.y, vx: o.vx, vy: o.vy } : {}, { index: i });
      });
      if (!keepPositions) {
        // start compact in the middle -> "explosion" intro animation
        for (const n of nodes) { n.x = (Math.random() - 0.5) * 30; n.y = (Math.random() - 0.5) * 30; }
      }
      links = newLinks.map(l => ({ ...l }));
      if (keepPositions) {
        // new nodes appear next to a node they are linked to
        for (const l of links) {
          const a = nodes[typeof l.source === 'object' ? l.source.index : l.source], b = nodes[typeof l.target === 'object' ? l.target.index : l.target];
          if (!a || !b) continue;
          if (a.x != null && b.x == null) { b.x = a.x + (Math.random() - 0.5) * 20; b.y = a.y + (Math.random() - 0.5) * 20; }
          else if (b.x != null && a.x == null) { a.x = b.x + (Math.random() - 0.5) * 20; a.y = b.y + (Math.random() - 0.5) * 20; }
        }
      }
      adj = new Map();
      const pairKeys = new Set();
      for (const l of links) {
        const a = typeof l.source === 'object' ? l.source.index : l.source;
        const b = typeof l.target === 'object' ? l.target.index : l.target;
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a).add(b); adj.get(b).add(a);
        pairKeys.add(a + '>' + b);
      }
      // A -> B and B -> A get curved lines so both directions stay visible
      for (const l of links) {
        const a = typeof l.source === 'object' ? l.source.index : l.source;
        const b = typeof l.target === 'object' ? l.target.index : l.target;
        l.curve = pairKeys.has(b + '>' + a);
      }
      sim.nodes(nodes);
      sim.force('link').links(links);
      applyLayout();
      applyClusters();
      applyMotion();
      sim.alpha(keepPositions ? 0.5 : 1);
      if (!keepPositions) fitted = false;
      if (motion === 'still' && visible) settleNow();
      keepAlive();
      draw();
    }

    function settleNow() {
      sim.stop();
      sim.alpha(1);
      for (let i = 0; i < 260 && sim.alpha() > sim.alphaMin(); i++) sim.tick();
      fitted = true;
      fitView(0);
      draw();
    }

    function bounds(list) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of list) {
        const r = nodeR(n) + 14;
        x0 = Math.min(x0, n.x - r); y0 = Math.min(y0, n.y - r);
        x1 = Math.max(x1, n.x + r); y1 = Math.max(y1, n.y + r);
      }
      return { x0, y0, x1, y1 };
    }

    /** Zooms so that the given nodes (default: all) are visible. */
    function fitView(duration, list) {
      const ns = list && list.length ? list : nodes;
      if (!ns.length) return;
      const { x0, y0, x1, y1 } = bounds(ns);
      const { w, h } = cv.state;
      const k = Math.max(0.15, Math.min(list ? 3 : 2.5, 0.9 * Math.min(w / (x1 - x0 || 1), h / (y1 - y0 || 1))));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const t = d3.zoomIdentity.translate(-cx * k, -cy * k).scale(k);
      const sel = d3.select(canvas);
      if (duration) sel.transition().duration(duration).call(zoom.transform, t); else sel.call(zoom.transform, t);
    }

    function keepAlive() {
      sim.alphaTarget(motion === 'wiggle' && running && visible ? 0.012 : 0);
      if (running && visible && motion !== 'still') sim.restart(); else sim.stop();
    }

    function linkPath(l) {
      const s = l.source, t = l.target;
      if (!l.curve) return { sx: s.x, sy: s.y, tx: t.x, ty: t.y, cx: null, cy: null };
      const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      const dx = t.x - s.x, dy = t.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = Math.min(40, len * 0.18);
      return { sx: s.x, sy: s.y, tx: t.x, ty: t.y, cx: mx - (dy / len) * off, cy: my + (dx / len) * off };
    }

    function drawArrow(p, t, sz) {
      const r = nodeR(t) + 2;
      const fx = p.cx ?? p.sx, fy = p.cy ?? p.sy;
      const a = Math.atan2(p.ty - fy, p.tx - fx);
      const ax = p.tx - Math.cos(a) * r, ay = p.ty - Math.sin(a) * r;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - Math.cos(a - 0.45) * sz, ay - Math.sin(a - 0.45) * sz);
      ctx.lineTo(ax - Math.cos(a + 0.45) * sz, ay - Math.sin(a + 0.45) * sz);
      ctx.closePath(); ctx.fill();
    }

    function draw() {
      const { w, h } = cv.state;
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + transform.x, h / 2 + transform.y);
      ctx.scale(transform.k, transform.k);
      const k = transform.k;
      const nb = hovered ? adj.get(hovered.index) || new Set() : null;
      const hl = highlight;
      const drawLink = (l, color, alpha, width) => {
        const p = linkPath(l);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(p.sx, p.sy);
        if (p.cx != null) ctx.quadraticCurveTo(p.cx, p.cy, p.tx, p.ty); else ctx.lineTo(p.tx, p.ty);
        ctx.stroke();
        if (opts.arrows) { ctx.fillStyle = color; drawArrow(p, l.target, (hl && hl.links.has(l) ? 8 : 5) / Math.sqrt(k)); }
      };
      drawHulls(k);
      // links – normal ones first, highlighted ones on top
      for (const l of links) {
        if (hl && hl.links.has(l)) continue;
        const hot = hovered && (l.source === hovered || l.target === hovered);
        const base = opts.linkAlpha || 0.35;
        const alpha = hl ? 0.05 : hovered ? (hot ? 0.95 : 0.06) : base;
        const width = ((opts.linkWidth ? opts.linkWidth(l) : 1) * (hot ? 1.6 : 1)) / Math.sqrt(k);
        drawLink(l, col(opts.linkColor ? opts.linkColor(l) : '#8a8a8a'), alpha, width);
      }
      if (hl) for (const [l, c] of hl.links) drawLink(l, col(c), c === hl.soft ? 0.55 : 0.95, (c === hl.soft ? 1.3 : 3) / Math.sqrt(k));
      // nodes
      for (const n of nodes) {
        const hc = hl && hl.nodes.get(n.index);
        const dim = hl ? !hc : hovered && n !== hovered && !nb.has(n.index);
        ctx.globalAlpha = dim ? (hl ? 0.12 : 0.15) : 1;
        const r = nodeR(n) * (hc ? 1.25 : 1);
        ctx.fillStyle = col(opts.color ? opts.color(n) : '#e0621b');
        const shape = opts.shape ? opts.shape(n) : 'circle';
        if (shape === 'skull') { drawSkull(ctx, n.x, n.y, r * 1.25, ctx.fillStyle); ctx.beginPath(); ctx.arc(n.x, n.y, r * 1.3, 0, Math.PI * 2); }
        else if (shape === 'square') {
          ctx.beginPath();
          const s = r * 1.7, rr = r * 0.45;
          ctx.moveTo(n.x - s / 2 + rr, n.y - s / 2);
          ctx.arcTo(n.x + s / 2, n.y - s / 2, n.x + s / 2, n.y + s / 2, rr);
          ctx.arcTo(n.x + s / 2, n.y + s / 2, n.x - s / 2, n.y + s / 2, rr);
          ctx.arcTo(n.x - s / 2, n.y + s / 2, n.x - s / 2, n.y - s / 2, rr);
          ctx.arcTo(n.x - s / 2, n.y - s / 2, n.x + s / 2, n.y - s / 2, rr);
          ctx.closePath(); ctx.fill();
        } else if (shape === 'diamond') {
          ctx.beginPath();
          const s = r * 1.35;
          ctx.moveTo(n.x, n.y - s); ctx.lineTo(n.x + s, n.y); ctx.lineTo(n.x, n.y + s); ctx.lineTo(n.x - s, n.y);
          ctx.closePath(); ctx.fill();
        } else { ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill(); }
        const ringC = hc || (opts.ringColor && opts.ringColor(n));
        if (ringC) {
          ctx.lineWidth = (hc ? 3 : 2.2) / k; ctx.strokeStyle = col(ringC); ctx.stroke();
        } else if (n === hovered || (opts.ring && opts.ring(n))) {
          ctx.lineWidth = 2 / k; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        }
      }
      // labels
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const n of nodes) {
        const hc = hl && hl.nodes.get(n.index);
        const dim = hl ? !hc : hovered && n !== hovered && !nb.has(n.index);
        const labelled = hl && hl.labels ? hl.labels.has(n.index) || (hc && k > 3) : hc;
        const show = labelled || n === hovered || (!hl && nb && nb.has(n.index)) || (!hl && opts.showLabel && opts.showLabel(n, k));
        if (!show || !opts.label) continue;
        const text = opts.label(n);
        if (!text) continue;
        const size = (opts.labelSize ? opts.labelSize(n) : 11) / Math.sqrt(k) * (hc ? 1.1 : 1);
        ctx.font = `${opts.labelWeight ? opts.labelWeight(n) : 600} ${size}px ${cssVar('--vscode-font-family') || 'sans-serif'}`;
        ctx.globalAlpha = dim ? 0.2 : 1;
        const y = opts.labelInside && opts.labelInside(n) ? n.y : n.y - nodeR(n) * (hc ? 1.25 : 1) - size * 0.8;
        ctx.lineWidth = 3 / k; ctx.strokeStyle = 'rgba(20,20,20,.9)';
        ctx.strokeText(text, n.x, y);
        ctx.fillStyle = hc ? col(hc) : opts.labelColor ? col(opts.labelColor(n)) : '#ececec';
        ctx.fillText(text, n.x, y);
      }
      // layer guides for the layered layout
      ctx.restore();
    }

    const toGraph = ev => {
      const b = canvas.getBoundingClientRect();
      const x = (ev.clientX - b.left - cv.state.w / 2 - transform.x) / transform.k;
      const y = (ev.clientY - b.top - cv.state.h / 2 - transform.y) / transform.k;
      return [x, y];
    };
    const findNode = ev => {
      const [x, y] = toGraph(ev);
      let best = null, bd = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < nodeR(n) + 4 / transform.k && d < bd) { best = n; bd = d; }
      }
      return best;
    };

    const zoom = d3.zoom().scaleExtent([0.08, 10])
      .filter(ev => (ev.type === 'wheel' || ev.type === 'dblclick' || !findNode(ev)) && !ev.button)
      .on('zoom', ev => { transform = ev.transform; draw(); });
    d3.select(canvas).call(zoom).on('dblclick.zoom', null);

    let dragNode = null, dragMoved = false;
    canvas.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const n = findNode(ev);
      if (!n) return;
      dragNode = n; dragMoved = false;
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', ev => {
      if (dragNode) {
        const [x, y] = toGraph(ev);
        if (!dragMoved) { dragMoved = true; sim.alphaTarget(0.25).restart(); }
        dragNode.fx = x; dragNode.fy = y;
        if (motion === 'still') { dragNode.x = x; dragNode.y = y; draw(); }
        return;
      }
      const n = findNode(ev);
      if (n !== hovered) { hovered = n; canvas.style.cursor = n ? 'pointer' : 'grab'; draw(); }
      if (opts.onHover) opts.onHover(n, ev);
    });
    canvas.addEventListener('pointerup', ev => {
      if (!dragNode) return;
      const n = dragNode;
      dragNode = null;
      // in calm/still mode a dragged node stays where it was dropped
      if (motion === 'wiggle') { n.fx = null; n.fy = null; }
      sim.alphaTarget(0);
      if (dragMoved && motion === 'still') setTimeout(() => sim.stop(), 600);
      keepAlive();
      if (motion === 'still' && dragMoved) sim.alpha(0.2).restart();
      if (!dragMoved && opts.onClick) opts.onClick(n, ev);
    });
    canvas.addEventListener('click', ev => {
      if (!findNode(ev) && opts.onBackground) opts.onBackground(ev);
    });
    const groupAt = ev => {
      if (!clusters) return null;
      const r = canvas.getBoundingClientRect();
      const { w, h } = cv.state;
      const x = (ev.clientX - r.left - w / 2 - transform.x) / transform.k, y = (ev.clientY - r.top - h / 2 - transform.y) / transform.k;
      for (const e of groups.values()) if (e.hull && d3.polygonContains(e.hull, [x, y])) return e;
      return null;
    };
    canvas.addEventListener('dblclick', ev => {
      const n = findNode(ev);
      if (n && opts.onDblClick) { opts.onDblClick(n, ev); return; }
      const g = !n && groupAt(ev);
      if (g) fitView(500, nodes.filter(x => groupOf(x) === g.key)); // zoom into a cluster
    });
    canvas.addEventListener('mouseleave', ev => { hovered = null; draw(); if (opts.onHover) opts.onHover(null, ev); });
    canvas.addEventListener('contextmenu', ev => {
      const n = findNode(ev);
      if (n && opts.onContext) { ev.preventDefault(); ev.stopPropagation(); opts.onContext(n, ev); }
    });
    canvas.style.cursor = 'grab';

    // pause the simulation while the graph is scrolled out of view
    const io = new IntersectionObserver(entries => {
      visible = entries.some(e => e.isIntersecting);
      if (visible && !everVisible) {
        everVisible = true;
        if (motion === 'still') settleNow();
        else {
          // play the intro "explosion" the first time the graph scrolls into view
          for (const n of nodes) { n.x = (Math.random() - 0.5) * 30; n.y = (Math.random() - 0.5) * 30; n.vx = 0; n.vy = 0; }
          fitted = false;
          transform = d3.zoomIdentity;
          sim.alpha(1);
        }
      }
      keepAlive();
    });
    io.observe(container);
    let lastSize = '';
    const ro = new ResizeObserver(() => {
      const size = container.clientWidth + 'x' + container.clientHeight;
      if (size === lastSize) return;
      lastSize = size;
      cv.resize();
      if (fitted) fitView(300); else draw();
    });
    ro.observe(container);

    setData(opts.nodes, opts.links, false);

    return {
      setData,
      toggleRunning() { running = !running; keepAlive(); return running; },
      /** 'wiggle' (organic wobble), 'calm' (settles and stops) or 'still' (static layout, no animation) */
      setMotion(m) {
        motion = m;
        for (const n of nodes) if (m === 'wiggle') { n.fx = null; n.fy = null; }
        applyMotion();
        if (m === 'still') settleNow(); else { sim.alpha(0.3); keepAlive(); }
        return motion;
      },
      get motion() { return motion; },
      setLayout(l) {
        layout = l;
        for (const n of nodes) { n.fx = null; n.fy = null; }
        applyLayout();
        fitted = false;
        if (motion === 'still') settleNow(); else { sim.alpha(0.9); keepAlive(); }
        return layout;
      },
      get layout() { return layout; },
      /** h: { nodes: Map(nodeIndex -> color), links: Map(link -> color) } or null; focus zooms to it */
      setHighlight(h, focus) {
        highlight = h && (h.nodes.size || h.links.size) ? h : null;
        draw();
        if (highlight && focus) fitView(500, [...highlight.nodes.keys()].map(i => nodes[i]));
      },
      /** index lookup helpers for callers */
      nodeIndex(id) { const n = nodes.find(x => x.id === id); return n ? n.index : -1; },
      get links() { return links; },
      get nodes() { return nodes; },
      resetView() { fitView(450); },
      reheat() {
        for (const n of nodes) { n.fx = null; n.fy = null; }
        if (motion === 'still') settleNow(); else { sim.alpha(0.8); keepAlive(); }
      },
      refreshColors() { colorCache = new Map(); draw(); },
      positions() { return nodes.map(n => [n.id, { x: n.x, y: n.y }]); },
      get running() { return running; },
      destroy() { sim.stop(); io.disconnect(); ro.disconnect(); },
      /** group nodes into bubbles (e.g. by folder) */
      setClusters(on) {
        clusters = !!on;
        for (const n of nodes) { n.fx = null; n.fy = null; }
        applyClusters();
        fitted = false;
        if (motion === 'still') settleNow(); else { sim.alpha(0.9); keepAlive(); }
        return clusters;
      },
      get clusters() { return clusters; },
      /** highlights all nodes whose label / search text contains q and zooms to them; returns the matches */
      search(q) {
        q = String(q || '').trim().toLowerCase();
        if (!q) { highlight = null; draw(); return []; }
        const text = n => ((opts.searchText ? opts.searchText(n) : '') + ' ' + (opts.label ? opts.label(n) : '') + ' ' + n.id).toLowerCase();
        const hits = nodes.filter(n => text(n).includes(q));
        highlight = hits.length ? { nodes: new Map(hits.map(n => [n.index, opts.searchColor || '#ffb46b'])), links: new Map(), labels: new Set(hits.map(n => n.index)) } : null;
        draw();
        if (hits.length) fitView(500, hits.length > 60 ? null : hits);
        return hits;
      },
      /** group key -> color (after clustering) */
      get groups() { return groups; },
    };
  }

  /**
   * Import graph + functions: every function becomes a node linked to its file ("defines"),
   * calls link the calling function (or file) to the called function. Returns { nodes, links } in the import graph format.
   */
  function withFunctions(G, FG) {
    if (!FG || !FG.fns.length) return G;
    const idx = new Map(G.nodes.map((n, i) => [n.abs, i]));
    const nodes = G.nodes.slice();
    const links = G.links.slice();
    const base = nodes.length;
    const fnIndex = [];
    FG.fns.forEach((f, k) => {
      const file = idx.get(f.file);
      if (file == null) { fnIndex[k] = -1; return; }
      const parent = G.nodes[file];
      fnIndex[k] = nodes.length;
      nodes.push({ abs: f.file + '#' + f.name + ':' + f.line, file: f.file, line: f.line, path: f.name + '()', filePath: f.path, name: f.name, fn: true,
        lang: parent.lang, cx: f.cx, lines: f.lines, in: 0, out: 0, layer: (parent.layer || 0) + 1, cycle: -1 });
      links.push({ s: file, t: fnIndex[k], fn: true, def: true });
    });
    for (const c of FG.calls) {
      const t = fnIndex[c.t];
      const s = c.s >= 0 ? fnIndex[c.s] : idx.get(c.file);
      if (t == null || t < 0 || s == null || s < 0 || s === t) continue;
      links.push({ s, t, fn: true, call: true, n: c.n });
    }
    for (let i = base; i < nodes.length; i++) { nodes[i] = { ...nodes[i] }; }
    for (const l of links) { if (l.call) { if (nodes[l.s].fn) nodes[l.s].out++; nodes[l.t].in++; } }
    return { ...G, nodes, links, functions: nodes.length - base };
  }

  // distinct, muted colors for folders / files (orange and gray first, then cooler tones)
  const PALETTE = ['#e0621b', '#6c8ebf', '#7fa37a', '#b39ddb', '#f2c14e', '#5fb3b3', '#d9738c', '#a8a8a8', '#b8480f', '#8fb8e8', '#c9a26b', '#9a7fb8',
    '#e6a57e', '#6f9f6f', '#d4b44a', '#7a8aa0', '#ff9a57', '#a0c4a8', '#c47a5a', '#5f7fbf'];
  /** stable key -> color map; the most frequent keys get the first (most distinct) colors */
  function palette(keys) {
    const count = new Map();
    for (const k of keys) count.set(k, (count.get(k) || 0) + 1);
    const out = new Map();
    [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || String(a).localeCompare(String(b))).forEach((k, i) => out.set(k, PALETTE[i % PALETTE.length]));
    return out;
  }
  /** folder of a graph node: files by their directory, functions by their file, libraries by ecosystem */
  const folderOf = n => (n.fn ? n.filePath.split('/').slice(0, -1).join('/') || '(root)' : n.library ? 'lib:' + n.ecosystem : n.path.split('/').slice(0, -1).join('/') || '(root)');
  /** colors for a graph: files by folder, functions by file (so functions of different files differ) */
  function nodeColors(nodes) {
    const folders = palette(nodes.filter(n => !n.library && !n.fn).map(folderOf));
    const filesWithFns = palette(nodes.filter(n => n.fn).map(n => n.file));
    return {
      folders,
      of: n => (n.library ? null : n.fn ? filesWithFns.get(n.file) : folders.get(folderOf(n))),
    };
  }

  window.LCGraphs = { Treemap, ForceGraph, resolveColor, drawSkull, withFunctions, palette, folderOf, nodeColors, PALETTE };
})();
