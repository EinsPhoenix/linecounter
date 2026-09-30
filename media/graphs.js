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
   * Animated ("wiggly") force-directed graph on canvas with zoom, pan, drag and hover highlighting.
   * opts: {
   *   nodes, links (source/target = node index), radius(n), color(n), label(n), showLabel(n, k),
   *   linkColor(l), linkWidth(l), distance, charge, arrows, collide,
   *   onClick(n, ev), onContext(n, ev), onHover(n|null, ev), tip(n)
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
    let wiggle = !reducedMotion();
    let colorCache = new Map();
    const col = c => { if (!colorCache.has(c)) colorCache.set(c, resolveColor(c)); return colorCache.get(c); };

    const sim = d3.forceSimulation()
      .force('link', d3.forceLink().distance(l => (opts.distance ? opts.distance(l) : 40)).strength(l => (opts.linkStrength ? opts.linkStrength(l) : 0.4)))
      .force('charge', d3.forceManyBody().strength(n => (opts.charge ? opts.charge(n) : -60)).distanceMax(400))
      .force('x', d3.forceX(0).strength(0.04))
      .force('y', d3.forceY(0).strength(0.04))
      .force('collide', d3.forceCollide(n => nodeR(n) + (opts.collidePad ?? 2)))
      .alphaDecay(0.02)
      .on('tick', () => {
        if (wiggle) jiggle();
        if (!fitted && sim.alpha() < 0.12) { fitted = true; fitView(600); }
        draw();
      });

    let t0 = performance.now();
    function jiggle() {
      // gentle organic wobble: every node follows its own slow sine wave
      const t = (performance.now() - t0) / 1000;
      for (const n of nodes) {
        if (n.fx != null) continue;
        n.vx += Math.sin(t * 0.9 + n.index * 1.7) * 0.06;
        n.vy += Math.cos(t * 0.8 + n.index * 2.3) * 0.06;
      }
    }

    const nodeR = n => (opts.radius ? opts.radius(n) : 4);

    function setData(newNodes, newLinks, keepPositions) {
      const old = new Map(nodes.map(n => [n.id, n]));
      nodes = newNodes.map((n, i) => {
        const o = keepPositions && old.get(n.id);
        return Object.assign(n, o ? { x: o.x, y: o.y, vx: o.vx, vy: o.vy } : {}, { index: i });
      });
      if (!keepPositions) {
        // start compact in the middle -> nice "explosion" intro animation
        for (const n of nodes) { n.x = (Math.random() - 0.5) * 30; n.y = (Math.random() - 0.5) * 30; }
      }
      links = newLinks.map(l => ({ ...l, source: l.source, target: l.target }));
      adj = new Map();
      for (const l of links) {
        const a = typeof l.source === 'object' ? l.source.index : l.source;
        const b = typeof l.target === 'object' ? l.target.index : l.target;
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a).add(b); adj.get(b).add(a);
      }
      sim.nodes(nodes);
      sim.force('link').links(links);
      sim.alpha(keepPositions ? 0.5 : 1);
      if (!keepPositions) fitted = false;
      keepAlive();
      draw();
    }

    /** Zooms so that all nodes are visible. */
    function fitView(duration) {
      if (!nodes.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) {
        const r = nodeR(n) + 14;
        x0 = Math.min(x0, n.x - r); y0 = Math.min(y0, n.y - r);
        x1 = Math.max(x1, n.x + r); y1 = Math.max(y1, n.y + r);
      }
      const { w, h } = cv.state;
      const k = Math.max(0.15, Math.min(2.5, 0.92 * Math.min(w / (x1 - x0 || 1), h / (y1 - y0 || 1))));
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const t = d3.zoomIdentity.translate(-cx * k, -cy * k).scale(k);
      const sel = d3.select(canvas);
      if (duration) sel.transition().duration(duration).call(zoom.transform, t); else sel.call(zoom.transform, t);
    }

    function keepAlive() {
      sim.alphaTarget(wiggle && running && visible ? 0.012 : 0);
      if (running && visible) sim.restart(); else sim.stop();
    }

    function draw() {
      const { w, h } = cv.state;
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + transform.x, h / 2 + transform.y);
      ctx.scale(transform.k, transform.k);
      const k = transform.k;
      const nb = hovered ? adj.get(hovered.index) || new Set() : null;
      // links
      for (const l of links) {
        const s = l.source, t = l.target;
        const hot = hovered && (s === hovered || t === hovered);
        ctx.globalAlpha = hovered ? (hot ? 0.95 : 0.06) : (opts.linkAlpha || 0.35);
        ctx.strokeStyle = col(opts.linkColor ? opts.linkColor(l) : '#8a8a8a');
        ctx.lineWidth = ((opts.linkWidth ? opts.linkWidth(l) : 1) * (hot ? 1.6 : 1)) / Math.sqrt(k);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        if (opts.arrows) {
          const r = nodeR(t) + 2;
          const a = Math.atan2(t.y - s.y, t.x - s.x);
          const ax = t.x - Math.cos(a) * r, ay = t.y - Math.sin(a) * r;
          const sz = 5 / Math.sqrt(k);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - Math.cos(a - 0.45) * sz, ay - Math.sin(a - 0.45) * sz);
          ctx.lineTo(ax - Math.cos(a + 0.45) * sz, ay - Math.sin(a + 0.45) * sz);
          ctx.closePath(); ctx.fill();
        }
      }
      // nodes
      for (const n of nodes) {
        const dim = hovered && n !== hovered && !nb.has(n.index);
        ctx.globalAlpha = dim ? 0.15 : 1;
        const r = nodeR(n);
        ctx.fillStyle = col(opts.color ? opts.color(n) : '#e0621b');
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        if (n === hovered || (opts.ring && opts.ring(n))) {
          ctx.lineWidth = 2 / k; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        }
      }
      // labels
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const n of nodes) {
        const dim = hovered && n !== hovered && !nb.has(n.index);
        const show = n === hovered || (nb && nb.has(n.index)) || (opts.showLabel && opts.showLabel(n, k));
        if (!show || !opts.label) continue;
        const text = opts.label(n);
        if (!text) continue;
        const size = (opts.labelSize ? opts.labelSize(n) : 11) / Math.sqrt(k);
        ctx.font = `${opts.labelWeight ? opts.labelWeight(n) : 600} ${size}px ${cssVar('--vscode-font-family') || 'sans-serif'}`;
        ctx.globalAlpha = dim ? 0.2 : 1;
        const y = opts.labelInside && opts.labelInside(n) ? n.y : n.y - nodeR(n) - size * 0.8;
        ctx.lineWidth = 3 / k; ctx.strokeStyle = 'rgba(20,20,20,.85)';
        ctx.strokeText(text, n.x, y);
        ctx.fillStyle = opts.labelColor ? col(opts.labelColor(n)) : '#ececec';
        ctx.fillText(text, n.x, y);
      }
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

    const zoom = d3.zoom().scaleExtent([0.1, 8])
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
      sim.alphaTarget(0.3).restart();
    });
    canvas.addEventListener('pointermove', ev => {
      if (dragNode) {
        const [x, y] = toGraph(ev);
        dragNode.fx = x; dragNode.fy = y; dragMoved = true;
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
      n.fx = null; n.fy = null;
      keepAlive();
      if (!dragMoved && opts.onClick) opts.onClick(n, ev);
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
        // play the intro "explosion" the first time the graph scrolls into view
        everVisible = true;
        for (const n of nodes) { n.x = (Math.random() - 0.5) * 30; n.y = (Math.random() - 0.5) * 30; n.vx = 0; n.vy = 0; }
        fitted = false;
        transform = d3.zoomIdentity;
        sim.alpha(1);
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
      toggleWiggle() { wiggle = !wiggle; keepAlive(); return wiggle; },
      resetView() { fitView(450); },
      reheat() { sim.alpha(0.8); keepAlive(); },
      refreshColors() { colorCache = new Map(); draw(); },
      positions() { return nodes.map(n => [n.id, { x: n.x, y: n.y }]); },
      get running() { return running; },
      get wiggle() { return wiggle; },
      destroy() { sim.stop(); io.disconnect(); ro.disconnect(); },
    };
  }

  window.LCGraphs = { Treemap, ForceGraph, resolveColor };
})();
