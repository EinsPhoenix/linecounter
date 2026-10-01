// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const tip = document.getElementById('tooltip');

  /** @type {any} */ let D = null;
  let langColor = new Map();
  const table = { sort: 'lines', dir: -1, filter: '', lang: '', repo: '', limit: 100 };

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (n ?? 0).toLocaleString('en-US');
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const pctStr = (a, b, d = 1) => pct(a, b).toFixed(d) + '%';
  const short = n => {
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return fmt(Math.round(n));
  };
  const compact = n => (n >= 1000 ? short(n >= 1e4 ? n : Math.round(n / 100) * 100).replace(/^(\d+),(\d)\d\d$/, '$1.$2k') : fmt(n));
  const bytes = b => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(1) : b) + ' ' + u[i];
  };
  const date = t => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '–');
  const dur = hours => {
    if (hours < 1) return Math.round(hours * 60) + ' min';
    if (hours < 48) return hours.toFixed(1) + ' h';
    return (hours / 24).toFixed(1) + ' days';
  };
  const fileLink = (f, label, line) => f
    ? `<a class="file" href="#" data-abs="${esc(f.abs)}" ${line ? `data-line="${line}"` : ''} title="Open ${esc(f.path)}">${esc(label || f.path)}</a>`
    : '<span class="muted">–</span>';
  const tipAttr = html => `data-tip="${esc(html)}"`;
  /** Helpers shared with the section modules (deps.js, …) */
  const UI = () => ({
    esc, fmt, pct, pctStr, short, bytes, date, icon, card, tiles, donut, hbars, columns, tipAttr,
    post: m => vscode.postMessage(m),
    data: () => D,
    colorOf, resolveColor: c => (window.LCGraphs ? LCGraphs.resolveColor(c) : c),
    /** re-draw canvas based charts after a theme switch (PDF light mode) */
    onThemeChange: () => { if (treemap) treemap.render(); for (const g of Object.values(graphs)) g.refreshColors(); },
  });
  window.LCUI = UI;

  // Line icons (24x24, stroke = currentColor). No emojis anywhere on the page.
  const ICONS = {
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    maximize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    minimize: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
    screen: 'M3 5h18v12H3zM8 21h8M12 17v4',
    close: 'M6 6l12 12M18 6L6 18',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    file: 'M14 3H6v18h12V7zM14 3v4h4',
    weight: 'M6 8h12l2 12H4zM9 8a3 3 0 0 1 6 0',
    ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
    dot: 'M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 3v3M12 18v3M3 12h3M18 12h3',
    layers: 'M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5',
    type: 'M4 7V5h16v2M12 5v14M9 19h6',
    todo: 'M10 6h10M10 12h10M10 18h10M4 6l1.5 1.5L8 5M4 12h3M4 18h3',
    book: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
    clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
    archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    flame: 'M12 3c1 4 5 5.5 5 10.5a5 5 0 0 1-10 0c0-3 2-4 2-6.5 1.2 1 2 2 3 2.5.3-2.2-.6-4.3 0-6.5z',
    calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
    users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6',
    wrench: 'M14.7 6.3l3 3 3.6-3.6a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
    eyeoff: 'M3 3l18 18M10.6 6.1A9.7 9.7 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.6 3.2M6.1 7.6A15 15 0 0 0 3 12s4 6 9 6a9 9 0 0 0 3.9-.9M9.9 9.9a3 3 0 0 0 4.2 4.2',
    pen: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
    pages: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6M4 7v14h11',
    distance: 'M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3',
    keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
    coffee: 'M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 11h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3',
    coins: 'M12 3c3.9 0 7 1.3 7 3s-3.1 3-7 3-7-1.3-7-3 3.1-3 7-3zM5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6',
    alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
    award: 'M12 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM8.5 14l-1.5 7 5-3 5 3-1.5-7',
    wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7',
    indent: 'M3 6h18M3 18h18M11 10h10M11 14h10M3 9l3 3-3 3',
    bug: 'M8 7h8v8a4 4 0 0 1-8 0zM12 7v12M4 10h4M16 10h4M4 15h4M16 15h4M9 3l1.5 3M15 3l-1.5 3',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
    space: 'M4 13v4h16v-4',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
    smile: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM8 14a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01',
    message: 'M4 5h16v11H9l-5 4z',
    save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
    fossil: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l-3 3',
    repo: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    megaphone: 'M3 10v4h4l7 5V5L7 10zM17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11',
    pause: 'M8 5v14M16 5v14',
    play: 'M7 4l13 8-13 8z',
    wave: 'M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0 2 2 2 2',
    shake: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M5 5l3 3M19 5l-3 3M5 19l3-3M19 19l-3-3M12 2v3M12 19v3',
    target: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 1v4M12 19v4M1 12h4M19 12h4',
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.dot}"/></svg>`;

  // Categorical slots follow the entity (language), never the rank on a given chart.
  const SLOTS = 6;
  function assignColors() {
    langColor = new Map();
    const langs = D.languages.filter(l => l.key !== 'Binary' && l.key !== 'Other' && l.lines > 0);
    langs.slice(0, SLOTS).forEach((l, i) => langColor.set(l.key, `var(--s${i + 1})`));
  }
  const colorOf = lang => langColor.get(lang) || 'var(--s-other)';

  /** Groups languages to the colored top slots + "Other" */
  function langGroups(key) {
    const out = [];
    let other = null;
    for (const l of D.languages) {
      if (!l[key]) continue;
      if (langColor.has(l.key)) out.push({ label: l.key, value: l[key], color: colorOf(l.key), raw: l });
      else {
        other = other || { label: 'Other', value: 0, color: 'var(--s-other)', count: 0 };
        other.value += l[key]; other.count++;
      }
    }
    if (other) out.push(other);
    return out;
  }

  // ---------- chart primitives ----------
  function card(title, body, opts = {}) {
    return `<section class="card ${opts.cls || ''}" ${opts.id ? `id="${opts.id}"` : ''}>
      <header><h3>${title}</h3><span class="head-right">${opts.sub ? `<span class="sub">${opts.sub}</span>` : ''}
        ${opts.tools || ''}<button class="card-fs" data-fs title="Show in full screen (Esc to close)">${icon('maximize')}</button></span></header>
      <div class="card-body">${body}</div></section>`;
  }

  function donut(items, centerValue, centerLabel) {
    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    const R = 80, r = 54, C = 100;
    let a0 = -Math.PI / 2;
    const gap = items.length > 1 ? 0.012 : 0;
    const arcs = items.map(it => {
      const frac = it.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      const s = a0 + gap / 2, e = Math.max(s + 0.001, a1 - gap / 2);
      a0 = a1;
      if (frac >= 0.9999) {
        return `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" style="stroke:${it.color};stroke-width:${R - r}px" class="hit" ${it.attrs || ''} ${tipAttr(`<b>${esc(it.label)}</b><br>${fmt(it.value)} (100%)`)}/>`;
      }
      const large = e - s > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${(C + rad * Math.cos(ang)).toFixed(2)} ${(C + rad * Math.sin(ang)).toFixed(2)}`;
      const d = `M${p(R, s)} A${R} ${R} 0 ${large} 1 ${p(R, e)} L${p(r, e)} A${r} ${r} 0 ${large} 0 ${p(r, s)}Z`;
      return `<path d="${d}" style="fill:${it.color}" class="hit ${it.attrs ? 'clickable' : ''}" ${it.attrs || ''} ${tipAttr(`<b>${esc(it.label)}</b><br>${fmt(it.value)} · ${pctStr(it.value, total)}`)}/>`;
    }).join('');
    const legend = items.map(it => `<li ${it.attrs ? `class="clickable" ${it.attrs}` : ''} ${tipAttr(`<b>${esc(it.label)}</b><br>${fmt(it.value)} · ${pctStr(it.value, total)}`)}>
      <span class="sw" style="background:${it.color}"></span><span class="lg-label">${esc(it.label)}</span>
      <span class="lg-val">${pctStr(it.value, total)}</span></li>`).join('');
    return `<div class="donut-wrap">
      <svg viewBox="0 0 200 200" class="donut" role="img">${arcs}
        <text x="100" y="98" text-anchor="middle" class="donut-big">${esc(centerValue)}</text>
        <text x="100" y="118" text-anchor="middle" class="donut-small">${esc(centerLabel)}</text></svg>
      <ul class="legend">${legend}</ul></div>`;
  }

  /** Horizontal bars. items: {label, value, color?, tip?, abs?, valueLabel?} */
  function hbars(items, opts = {}) {
    const max = Math.max(1, ...items.map(i => i.value));
    return `<div class="hbars">${items.map(it => `
      <div class="hbar ${it.abs || it.attrs ? 'clickable' : ''}" ${it.abs ? `data-abs="${esc(it.abs)}"` : ''} ${it.attrs || ''} ${tipAttr(it.tip || `<b>${esc(it.label)}</b><br>${fmt(it.value)}`)}>
        <span class="hbar-label" title="${esc(it.label)}"><span>${esc(it.label)}</span></span>
        <span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(0.5, pct(it.value, max))}%;background:${it.color || 'var(--s1)'}"></span></span>
        <span class="hbar-val">${esc(it.valueLabel ?? short(it.value))}</span>
      </div>`).join('')}</div>${opts.legend || ''}`;
  }

  /** Stacked horizontal bars (100% or absolute). rows: {label, parts:[{name,value,color}]} */
  function stacked(rows, series) {
    const max = Math.max(1, ...rows.map(r => r.parts.reduce((s, p) => s + p.value, 0)));
    const legend = `<ul class="legend inline">${series.map(s => `<li><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</li>`).join('')}</ul>`;
    return legend + `<div class="hbars">${rows.map(r => {
      const tot = r.parts.reduce((s, p) => s + p.value, 0);
      const t = `<b>${esc(r.label)}</b><br>` + r.parts.map(p => `<span class="sw" style="background:${p.color}"></span>${esc(p.name)}: ${fmt(p.value)} (${pctStr(p.value, tot)})`).join('<br>');
      return `<div class="hbar" ${tipAttr(t)}>
        <span class="hbar-label" title="${esc(r.label)}"><span>${esc(r.label)}</span></span>
        <span class="hbar-track"><span class="stack" style="width:${Math.max(0.5, pct(tot, max))}%">${r.parts.filter(p => p.value > 0).map(p =>
          `<span class="seg" style="flex:${p.value};background:${p.color}"></span>`).join('')}</span></span>
        <span class="hbar-val">${short(tot)}</span></div>`;
    }).join('')}</div>`;
  }

  /** Vertical column chart. items: {label, value, tip?} */
  function columns(items, opts = {}) {
    const max = Math.max(1, ...items.map(i => i.value));
    const every = Math.max(1, Math.ceil(items.length / (opts.maxLabels || 12)));
    const ticks = [max, Math.round(max / 2), 0];
    return `<div class="columns-wrap">
      <div class="yaxis">${ticks.map(t => `<span>${short(t)}</span>`).join('')}</div>
      <div class="columns ${items.length > 40 ? 'dense' : ''}">${items.map((it, i) => `
        <div class="col" ${tipAttr(it.tip || `<b>${esc(it.label)}</b><br>${fmt(it.value)}`)}>
          <div class="col-bar-area"><div class="col-bar" style="height:${pct(it.value, max)}%;background:${opts.color || 'var(--s1)'}"></div></div>
          <div class="col-label">${i % every === 0 ? esc(it.label) : ''}</div>
        </div>`).join('')}</div></div>`;
  }

  function heatmap(matrix) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const max = Math.max(1, ...matrix.flat());
    const steps = ['var(--q1)', 'var(--q2)', 'var(--q3)', 'var(--q4)', 'var(--q5)', 'var(--q6)'];
    let html = '<div class="heatmap"><span></span>';
    for (let h = 0; h < 24; h++) html += `<span class="hm-h">${h % 3 === 0 ? h : ''}</span>`;
    matrix.forEach((row, d) => {
      html += `<span class="hm-d">${days[d]}</span>`;
      row.forEach((v, h) => {
        const bg = v === 0 ? 'var(--q0)' : steps[Math.min(steps.length - 1, Math.floor((v / max) * steps.length - 1e-9))];
        html += `<span class="hm-c" style="background:${bg}" ${tipAttr(`<b>${days[d]} ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59</b><br>${fmt(v)} commit${v === 1 ? '' : 's'}`)}></span>`;
      });
    });
    html += '</div><div class="hm-scale"><span>fewer</span>' + ['var(--q0)', ...steps].map(s => `<span class="hm-c" style="background:${s}"></span>`).join('') + '<span>more</span></div>';
    return html;
  }

  function tiles(list) {
    return `<div class="tiles">${list.map(t => `
      <div class="tile" ${t.tip ? tipAttr(t.tip) : ''}>
        <div class="tile-label">${esc(t.label)}</div>
        <div class="tile-value">${t.html ?? esc(t.value)}</div>
        ${t.sub ? `<div class="tile-sub">${t.sub}</div>` : ''}
      </div>`).join('')}</div>`;
  }

  // ---------- treemap (squarified) ----------
  // ---------- canvas treemap + graphs ----------
  let treemap = null;
  let graphs = {};
  function positionTip(ev) {
    const pad = 14;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  }
  function showTip(html, ev) { tip.innerHTML = html; tip.style.display = 'block'; positionTip(ev); }
  function hideTip() { tip.style.display = 'none'; }
  const topGroup = f => {
    const p = f.path.split('/');
    const top = p.length > 1 ? p[0] + '/' : '(root files)';
    return D.multiRoot ? `${f.rootName}/${top}` : top;
  };

  function renderTreemap() {
    const el = document.getElementById('treemap');
    if (!el || !window.LCGraphs) return;
    if (treemap) { treemap.render(); return; }
    treemap = LCGraphs.Treemap(el, {
      files: D.table,
      colorOf: f => colorOf(f.lang),
      groupOf: topGroup,
      onHover: (f, ev) => (f ? showTip(`<b>${esc(f.path)}</b><br>${esc(f.lang)} · ${fmt(f.lines)} lines · ${bytes(f.size)}<br><i>Click: copy path · Double-click: open · Right-click: more</i>`, ev) : hideTip()),
      onClick: f => copyPath(f.abs),
      onDblClick: f => vscode.postMessage({ type: 'open', abs: f.abs }),
      onContext: (f, ev) => openMenu(f.abs, ev.clientX, ev.clientY),
    });
  }

  const RED = '#ff4d4f';
  const SKULL_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="#ff4d4f" d="M12 2C6.5 2 3 5.6 3 10.2c0 2.6 1.2 4.6 3 5.8V19a1 1 0 0 0 1 1h2v-2h2v2h2v-2h2v2h2a1 1 0 0 0 1-1v-3c1.8-1.2 3-3.2 3-5.8C21 5.6 17.5 2 12 2zM8.5 13.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm7 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM12 16l-1.2-2h2.4z"/></svg>';
  const RED_SOFT = '#ff8a80';
  const AMBER = '#f7ae62';
  const graphTools = id => `<span class="graph-tools">
      <input class="gsearch" type="search" data-graph-search="${id}" placeholder="Search…" title="Highlight matching nodes and zoom to them">
      <button class="gbtn" data-graph="${id}" data-gact="pause" title="Pause / resume">${icon('pause')}</button>
      <button class="gbtn gbtn-text" data-graph="${id}" data-gact="motion" title="Motion: wiggle → calm → still">${icon('wave')}<span>${MOTION_LABEL[motionFor(id)]}</span></button>
      <button class="gbtn" data-graph="${id}" data-gact="shake" title="Re-run the layout">${icon('shake')}</button>
      <button class="gbtn" data-graph="${id}" data-gact="reset" title="Fit to view">${icon('target')}</button>
    </span>`;

  function initWordWeb() {
    const el = document.getElementById('wordweb');
    const G = D.wordGraph;
    if (!el || !window.LCGraphs || !G || !G.words.length) return;
    const maxC = Math.max(...G.words.map(w => w.count));
    const maxL = Math.max(1, ...G.files.map(f => f.lines));
    const nodes = [
      ...G.words.map(w => ({ id: 'w:' + w.id, kind: 'word', label: w.id, count: w.count })),
      ...G.files.map(f => ({ id: 'f:' + f.abs, kind: 'file', f })),
    ];
    const links = G.links.map(l => ({ source: G.words.findIndex(w => w.id === l.w), target: G.words.length + l.f, v: l.v }));
    graphs.wordweb = LCGraphs.ForceGraph(el, {
      nodes, links, motion: motionFor('wordweb'),
      radius: n => (n.kind === 'word' ? 7 + Math.sqrt(n.count / maxC) * 17 : 3 + Math.sqrt(n.f.lines / maxL) * 6),
      color: n => (n.kind === 'word' ? 'var(--s1)' : '#8d8d8d'),
      ring: n => n.kind === 'word',
      label: n => (n.kind === 'word' ? n.label : n.f.path.split('/').pop()),
      showLabel: (n, k) => n.kind === 'word' || k > 1.8,
      labelSize: n => (n.kind === 'word' ? 10 + Math.sqrt(n.count / maxC) * 8 : 10),
      labelInside: n => n.kind === 'word',
      labelColor: n => (n.kind === 'word' ? '#ffffff' : '#d6d6d6'),
      linkWidth: l => 0.6 + Math.log10(l.v + 1),
      linkColor: () => '#9a6a4a',
      distance: () => 70,
      charge: n => (n.kind === 'word' ? -260 : -60),
      onHover: (n, ev) => {
        if (!n) return hideTip();
        showTip(n.kind === 'word'
          ? `<b>${esc(n.label)}</b><br>used ${fmt(n.count)} times`
          : `<b>${esc(n.f.path)}</b><br>${fmt(n.f.lines)} lines<br><i>Click: open · Right-click: more</i>`, ev);
      },
      onClick: n => { if (n.kind === 'file') vscode.postMessage({ type: 'open', abs: n.f.abs }); },
      onContext: (n, ev) => { if (n.kind === 'file') openMenu(n.f.abs, ev.clientX, ev.clientY); },
    });
  }

  function initImportGraph() {
    const el = document.getElementById('importgraph');
    const G = D.importGraph;
    if (!el || !window.LCGraphs || !G || !G.nodes.length) return;
    const maxIn = Math.max(1, ...G.nodes.map(n => n.in));
    const { nodes, links } = importGraphData();
    let colors = LCGraphs.nodeColors(nodes.map(n => n.f));
    impRecolor = list => { colors = LCGraphs.nodeColors(list.map(n => n.f)); };
    const fnTip = f => `<b>${esc(f.name)}()</b> <span style="opacity:.7">function</span><br>${esc(f.filePath)}:${f.line}<br>complexity ${fmt(f.cx)} · ${fmt(f.lines)} lines<br>calls ${fmt(f.out)} · called by ${fmt(f.in)}<br><i>Double-click: open at the function</i>`;
    const g = graphs.importgraph = LCGraphs.ForceGraph(el, {
      nodes, links, arrows: true,
      motion: motionFor('importgraph'),
      layout: 'force',
      layer: n => n.f.layer,
      radius: n => (n.f.fn ? 2.4 + Math.min(5, n.f.cx * 0.18) : Math.max(n.f.library && n.f.vulns ? 7 : 0, 3.5 + Math.sqrt(n.f.in / maxIn) * 13)),
      color: n => (n.f.library ? (n.f.vulns ? RED : '#8d8d8d') : impColorMode === 'folder' ? colors.of(n.f) || '#8d8d8d' : n.f.fn && n.f.cx > (D.health ? D.health.thresholds.maxComplexity : 15) ? '#e0621b' : colorOf(n.f.lang)),
      group: n => LCGraphs.folderOf(n.f),
      groupColor: g => (g.startsWith('lib:') ? '#8d8d8d' : colors.folders.get(g) || '#8d8d8d'),
      groupLabel: (g, count) => `${g.startsWith('lib:') ? g.slice(4) + ' libraries' : g} · ${count}`,
      clusters: impClusters,
      searchText: n => `${n.f.path} ${n.f.filePath || ''}`,
      shape: n => (n.f.fn ? 'diamond' : n.f.library ? (n.f.vulns ? 'skull' : 'square') : 'circle'),
      ringColor: n => (n.f.cycle >= 0 ? RED : null),
      label: n => (n.f.fn ? n.f.path : n.f.library ? n.f.path + (n.f.version ? '@' + n.f.version : '') : n.f.path.split('/').pop()),
      showLabel: (n, k) => (n.f.fn ? k > 2.2 || n.f.in >= 3 : n.f.in >= Math.max(3, maxIn * 0.25) || n.f.cycle >= 0 || (n.f.library && n.f.vulns) || k > 1.7),
      linkColor: l => (l.viol ? '#ff2d6f' : l.cyc ? RED : l.call ? AMBER : l.def ? '#5a5a5a' : '#7c7c7c'),
      linkWidth: l => (l.viol ? 2.6 : l.cyc ? 2.2 : l.call ? 1.1 : l.def ? 0.6 : 0.9),
      linkAlpha: 0.5,
      distance: l => (l.def ? 16 : l.call ? 30 : 45),
      charge: n => (n.f && n.f.fn ? -25 : -90),
      onHover: (n, ev) => (n ? showTip(n.f.fn ? fnTip(n.f) : n.f.library ? libraryTip(n.f) : `<b>${esc(n.f.path)}</b><br>imports ${fmt(n.f.out)}${n.f.dependencies != null ? ` (${fmt(n.f.dependencies)} transitively)` : ''} · imported by ${fmt(n.f.in)}${n.f.dependents != null ? ` (${fmt(n.f.dependents)} transitively)` : ''}${n.f.cycle >= 0 ? '<br><b style="color:' + RED + '">part of a circular import</b>' : ''}<br><i>Click: show dependencies · Double-click: open · Right-click: more</i>`, ev) : hideTip()),
      onClick: n => selectImportNode(n.index),
      onDblClick: n => (n.f.fn ? vscode.postMessage({ type: 'open', abs: n.f.file, line: n.f.line }) : n.f.library ? n.f.dir && vscode.postMessage({ type: 'reveal', abs: n.f.dir, inEditor: true }) : vscode.postMessage({ type: 'open', abs: n.f.abs })),
      onBackground: () => clearImportHighlight(),
      onContext: (n, ev) => { if (!n.f.library) openMenu(n.f.fn ? n.f.file : n.f.abs, ev.clientX, ev.clientY); },
    });
    const input = /** @type {HTMLInputElement} */ (document.getElementById('impFind'));
    if (input) {
      let timer = 0;
      // typing highlights every match; Enter on a single / exact match selects it (dependencies + dependents)
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const q = input.value.trim();
          if (!q) return clearImportHighlight();
          const hits = graphs.importgraph.search(q);
          setImpStatus(hits.length ? `<b>${fmt(hits.length)}</b> match${hits.length === 1 ? '' : 'es'} for “${esc(q)}”${hits.length <= 8 ? ': ' + hits.map(h => esc(h.f.path.split('/').pop())).join(', ') : ''} · press Enter to select` : `Nothing matches “${esc(q)}” in the graph.`);
        }, 180);
      });
      input.addEventListener('change', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) return clearImportHighlight();
        const n = graphs.importgraph.nodes.find(x => x.f.path.toLowerCase() === q) || graphs.importgraph.nodes.find(x => x.f.path.toLowerCase().includes(q));
        if (n) selectImportNode(n.index, true); else setImpStatus(`Nothing matches “${esc(input.value)}” in the graph.`);
      });
    }
  }

  /** nodes / links for the import graph, with functions when switched on */
  let impFns = false;
  let impColorMode = 'folder';
  let impClusters = false;
  let impRecolor = () => {};
  function importGraphData() {
    const src = impFns && window.LCGraphs ? LCGraphs.withFunctions(D.importGraph, D.functionGraph) : D.importGraph;
    return { nodes: src.nodes.map(n => ({ id: n.abs, f: n })), links: src.links.map(l => ({ source: l.s, target: l.t, cyc: l.cyc, call: l.call, def: l.def, viol: l.viol })) };
  }

  /** architecture violations: red links + involved files, zoomed into view */
  window.LCStatsGraphs = {
    highlightViolations() {
      const g = graphs.importgraph;
      if (!g) return;
      const nodesHl = new Map(), linksHl = new Map();
      for (const l of g.links) if (l.viol) { linksHl.set(l, '#ff2d6f'); nodesHl.set(l.source.index, '#ff2d6f'); nodesHl.set(l.target.index, RED_SOFT); }
      g.setHighlight({ nodes: nodesHl, links: linksHl, labels: new Set(nodesHl.keys()) }, true);
      document.getElementById('importgraph').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setImpStatus(`<b style="color:#ff2d6f">${fmt(linksHl.size)}</b> imports break an architecture rule`);
    },
  };

  const libraryTip = f => `<b>${esc(f.path)}</b>${f.version ? '@' + esc(f.version) : ''} <span style="opacity:.7">${esc(f.ecosystem)} library</span>
    ${f.license ? `<br>license: ${esc(f.license)}${f.licenseStatus && f.licenseStatus !== 'ok' ? ` (<b style="color:${f.licenseStatus === 'problematic' ? RED : AMBER}">${esc(f.licenseStatus)}</b>)` : ''}` : ''}
    ${f.vulns ? `<br><b style="color:${RED}">${f.vulns} known vulnerabilit${f.vulns === 1 ? 'y' : 'ies'} (${esc(f.severity || 'unknown')})</b>` : ''}
    <br>imported by ${fmt(f.in)} file${f.in === 1 ? '' : 's'}<br><i>not counted in the statistics</i>`;

  function setImpStatus(html) {
    const el = document.getElementById('impStatus');
    if (el) el.innerHTML = html;
    const clr = document.getElementById('impClear');
    if (clr) clr.disabled = !html;
  }
  function clearImportHighlight() {
    impSelected = null;
    const g = graphs.importgraph;
    if (g) g.setHighlight(null);
    document.querySelectorAll('.imp-item.active').forEach(e => e.classList.remove('active'));
    setImpStatus('');
  }
  /** "folder/file" – enough to tell index.ts files apart */
  const shortPath = p => p.split('/').slice(-2).join('/');
  const pathHtml = files => files.map(f => `<span class="imp-hop" title="${esc(f.path)}">${esc(shortPath(f.path))}</span>`).join(' <span class="imp-arrow">→</span> ');

  /** Highlights a path (list of files) in red; also marks extra member files of a cycle. */
  function highlightPath(files, members) {
    const g = graphs.importgraph;
    if (!g) return;
    const nodesHl = new Map();
    const linksHl = new Map();
    const idx = files.map(f => g.nodeIndex(f.abs));
    for (const f of members || []) { const i = g.nodeIndex(f.abs); if (i >= 0) nodesHl.set(i, RED_SOFT); }
    idx.forEach(i => { if (i >= 0) nodesHl.set(i, RED); });
    for (let k = 0; k < idx.length - 1; k++) {
      const l = g.links.find(x => x.source.index === idx[k] && x.target.index === idx[k + 1]);
      if (l) linksHl.set(l, RED);
    }
    if (members) {
      const set = new Set(members.map(f => g.nodeIndex(f.abs)));
      for (const l of g.links) if (!linksHl.has(l) && set.has(l.source.index) && set.has(l.target.index)) linksHl.set(l, RED_SOFT);
    }
    g.setHighlight({ nodes: nodesHl, links: linksHl, labels: new Set(idx.filter(i => i >= 0)), soft: RED_SOFT }, true);
  }

  /** Click on a file: its (transitive) dependents in red, dependencies in amber. */
  let impSelected = null;
  function selectImportNode(index, focus) {
    const g = graphs.importgraph;
    if (!g) return;
    impSelected = g.nodes[index] ? g.nodes[index].f.abs : null;
    const nodesHl = new Map([[index, '#ffffff']]);
    const linksHl = new Map();
    const walk = (dirOut, color) => {
      const seen = new Set([index]);
      const stack = [index];
      while (stack.length) {
        const v = stack.pop();
        for (const l of g.links) {
          const from = dirOut ? l.source.index : l.target.index;
          const to = dirOut ? l.target.index : l.source.index;
          if (from !== v) continue;
          if (!linksHl.has(l)) linksHl.set(l, color);
          if (!seen.has(to)) { seen.add(to); stack.push(to); if (!nodesHl.has(to)) nodesHl.set(to, color); }
        }
      }
      return seen.size - 1;
    };
    const deps = walk(true, AMBER);
    const users = walk(false, RED);
    // label the selected file and its direct neighbours
    const labels = new Set([index]);
    for (const l of g.links) {
      if (l.source.index === index) labels.add(l.target.index);
      if (l.target.index === index) labels.add(l.source.index);
    }
    g.setHighlight({ nodes: nodesHl, links: linksHl, labels }, !!focus);
    const n = g.nodes[index].f;
    const total = (shown, all) => (all != null && all > shown ? ` (${fmt(all)} in the whole project)` : '');
    setImpStatus(`<b>${esc(n.path)}</b> – depends on <b style="color:${AMBER}">${fmt(deps)}</b> file${deps === 1 ? '' : 's'}${total(deps, n.dependencies)}, <b style="color:${RED}">${fmt(users)}</b> file${users === 1 ? '' : 's'} depend on it${total(users, n.dependents)}${n.cycle >= 0 ? ` · <b style="color:${RED}">in a circular import</b>` : ''}
      <button class="link" data-open-abs="${esc(n.fn ? n.file : n.abs)}" ${n.fn ? `data-open-line="${n.line}"` : ''}>open</button>`);
  }

  const motionFor = id => {
    const m = D.graphMotion || 'auto';
    if (m !== 'auto') return m;
    return id === 'wordweb' ? 'wiggle' : 'calm';
  };
  const MOTIONS = ['wiggle', 'calm', 'still'];
  const MOTION_LABEL = { wiggle: 'Wiggle', calm: 'Calm', still: 'Still' };

  function importSection() {
    const G = D.importGraph;
    if (!G || !G.nodes.length) return '<p class="muted">No imports between the selected files could be resolved (supported: JS/TS, Python, CSS/SCSS/Less, C/C++, HTML).</p>';
    const list = (title, arr, unit, kind) => `<div class="imp-block"><div class="imp-title">${title}</div>${arr.length ? `<ol class="imp-list">${arr.map(x => `<li class="imp-item" ${kind ? `data-imp-node="${esc(x.abs)}"` : `data-abs="${esc(x.abs)}"`} title="${esc(x.path)}"><span class="imp-name">${esc(x.path)}</span><span class="imp-count">${fmt(x.count)} ${unit}</span></li>`).join('')}</ol>` : '<p class="muted">–</p>'}</div>`;
    const cycles = G.cycles.length
      ? `<ol class="imp-list">${G.cycles.map((c, i) => `<li class="imp-item imp-cycle" data-imp-cycle="${i}" title="${esc(c.cycle.map(f => f.path).join(' → '))}">
          <span class="imp-badge red">${c.size} files</span><span class="imp-path">${pathHtml(c.cycle)}</span></li>`).join('')}</ol>`
      : '<p class="imp-ok">No circular imports. Clean architecture, or just lucky.</p>';
    const chains = G.chains.length
      ? `<ol class="imp-list">${G.chains.map((c, i) => `<li class="imp-item imp-chain" data-imp-chain="${i}" title="${esc(c.files.map(f => f.path).join(' → '))}">
          <span class="imp-badge">${c.length} deep</span><span class="imp-path">${pathHtml(c.files)}</span></li>`).join('')}</ol>`
      : '<p class="muted">No chains deeper than 2 files.</p>';
    return `<div class="imp-toolbar">
        <span class="seg" role="group" aria-label="Layout"><span class="seg-label">Layout</span>
          <button class="seg-btn on" data-imp-layout="force">Force</button><button class="seg-btn" data-imp-layout="layered" title="Importers on top, imported files below">Layered</button></span>
        <span class="seg" role="group" aria-label="Motion"><span class="seg-label">Motion</span>
          ${MOTIONS.map(m => `<button class="seg-btn ${motionFor('importgraph') === m ? 'on' : ''}" data-imp-motion="${m}">${MOTION_LABEL[m]}</button>`).join('')}</span>
        <span class="seg" role="group" aria-label="Color"><span class="seg-label">Color</span>
          <button class="seg-btn ${impColorMode === 'folder' ? 'on' : ''}" data-imp-color="folder" title="Files of the same folder share a color (functions: by file)">Folder</button><button class="seg-btn ${impColorMode === 'lang' ? 'on' : ''}" data-imp-color="lang">Language</button></span>
        <button class="seg-btn solo ${impClusters ? 'on' : ''}" data-imp-cluster title="Group files into bubbles per folder – double-click a bubble to zoom into it">Cluster folders</button>
        <input id="impFind" type="search" list="impFiles" placeholder="Search files / functions…" spellcheck="false">
        <datalist id="impFiles">${G.nodes.map(n => `<option value="${esc(n.path)}">`).join('')}</datalist>
        <button class="btn" id="impClear" disabled>${icon('close')} Clear highlight</button>
        ${D.functionGraph && D.functionGraph.fns.length ? `<button class="btn ${impFns ? 'primary' : ''}" data-imp-fns title="Show functions as nodes: file → function, and calls between functions (${fmt(D.functionGraph.fns.length)} of ${fmt(D.functionGraph.total)} functions)">ƒ Functions</button>` : ''}
        <button class="btn primary" data-train="chain" title="Ride a train along a dependency chain through a 3D universe of your files">${icon('play')} 3D Train</button>
        <button class="btn" data-train="free" title="Free roam: drive along any relation (W, A/D, S) starting at the selected file">${icon('play')} 3D Free roam</button>
      </div>
      <div class="imp-summary">
        <span class="imp-chip ${G.cycleCount ? 'red' : 'ok'}">${fmt(G.cycleCount)} circular import${G.cycleCount === 1 ? '' : 's'}${G.cycleCount ? ` · ${fmt(G.filesInCycles)} files involved` : ''}</span>
        <span class="imp-chip">longest chain: ${fmt(G.longestChain)} files</span>
        <span class="imp-chip">${fmt(G.maxLayer + 1)} dependency layers</span>
        <span class="imp-chip">${fmt(G.edgeCount)} imports</span>
      </div>
      <div id="impStatus" class="imp-status"></div>
      <div class="imp-body">
        <div id="importgraph" class="graph imp-graph"></div>
        <aside class="imp-side">
          <div class="imp-block"><div class="imp-title red">Circular imports <span class="muted">click to trace</span></div>${cycles}</div>
          <div class="imp-block"><div class="imp-title">Longest dependency chains <span class="muted">click to trace</span></div>${chains}</div>
          ${G.mostUsedLibraries && G.mostUsedLibraries.length ? `<div class="imp-block"><div class="imp-title">Libraries <span class="muted">${fmt(G.libraryCount)} external packages · not counted</span></div><ol class="imp-list">${G.mostUsedLibraries.map(x => `<li class="imp-item" data-imp-node="${esc(x.abs)}" title="${esc(x.path)}"><span class="imp-name">${x.vulns ? `<span class="lib-skull" title="${x.vulns} vulnerabilities">${SKULL_SVG}</span>` : '<span class="lib-box"></span>'}${esc(x.path)}${x.version ? `<span class="muted">@${esc(x.version)}</span>` : ''}</span><span class="imp-count">${fmt(x.count)} ×</span></li>`).join('')}</ol></div>` : ''}
          ${list('Biggest blast radius <span class="muted">files that break if it breaks</span>', G.blastRadius || [], 'dependents', true)}
          ${list('Most imported', G.mostImported, '×', true)}
          ${list('Imports the most', G.mostImporting, 'imports', true)}
        </aside>
      </div>
      <div class="imp-legend"><span><i class="imp-line"></i> import (arrow = direction)</span><span><i class="imp-line cyc"></i> circular import</span><span><i class="imp-line dep"></i> depends on (selection)</span><span><i class="imp-line user"></i> depended on by (selection)</span>${G.libraryCount ? `<span><span class="lib-box"></span> library</span><span>${SKULL_SVG} library with vulnerabilities</span>` : ''}<span class="muted">node size = how often a file is imported · click a file to trace it, double-click to open</span></div>`;
  }

  // ---------- project structure graph ----------
  let structTree = null;
  const structCollapsed = new Set();
  function buildStructTree() {
    const rootName = D.multiRoot ? 'workspace' : (D.workspace || 'root');
    const root = { id: '/', name: rootName, dir: true, children: new Map(), files: 0, lines: 0, depth: 0 };
    for (const f of D.table) {
      const parts = (D.multiRoot ? f.rootName + '/' + f.path : f.path).split('/');
      let cur = root;
      cur.files++; cur.lines += f.lines;
      for (let i = 0; i < parts.length - 1; i++) {
        const id = cur.id + parts[i] + '/';
        if (!cur.children.has(id)) cur.children.set(id, { id, name: parts[i], dir: true, children: new Map(), files: 0, lines: 0, depth: i + 1, parent: cur });
        cur = cur.children.get(id);
        cur.files++; cur.lines += f.lines;
      }
      cur.children.set(cur.id + parts[parts.length - 1], { id: cur.id + parts[parts.length - 1], name: parts[parts.length - 1], dir: false, f, depth: parts.length, parent: cur });
    }
    return root;
  }
  function structVisible() {
    const nodes = [], links = [];
    const walk = (n, parentIdx) => {
      const idx = nodes.length;
      nodes.push({ id: n.id, t: n });
      if (parentIdx >= 0) links.push({ source: parentIdx, target: idx, file: !n.dir });
      if (n.dir && !structCollapsed.has(n.id)) for (const c of n.children.values()) walk(c, idx);
    };
    walk(structTree, -1);
    return { nodes, links };
  }
  function autoCollapse(limit) {
    // collapse the deepest folders first until the graph fits into `limit` nodes
    const dirs = [];
    const count = n => { let c = 1; if (n.dir) { dirs.push(n); for (const ch of n.children.values()) c += count(ch); } return c; };
    let total = count(structTree);
    dirs.sort((a, b) => b.depth - a.depth || b.files - a.files);
    for (const d of dirs) {
      if (total <= limit) break;
      if (d === structTree) continue;
      let sub = 0;
      const cnt = n => { for (const ch of n.children.values()) { sub++; if (ch.dir && !structCollapsed.has(ch.id)) cnt(ch); } };
      cnt(d);
      structCollapsed.add(d.id);
      total -= sub;
    }
  }
  function initStructure() {
    const el = document.getElementById('structure');
    if (!el || !window.LCGraphs || !D.table.length) return;
    structTree = buildStructTree();
    structCollapsed.clear();
    autoCollapse(Math.min(20000, (D.graphLimits && D.graphLimits.maxNodes) || 1400));
    const maxFiles = Math.max(1, structTree.files);
    const { nodes, links } = structVisible();
    // label budget: only the biggest folders are labelled up front, the rest appear when zooming in
    let labelled = new Set();
    const updateLabels = list => {
      labelled = new Set(list.filter(n => n.t.dir).sort((a, b) => b.t.files - a.t.files).slice(0, 36).map(n => n.id));
    };
    updateLabels(nodes);
    graphs.structure = LCGraphs.ForceGraph(el, {
      nodes, links, motion: motionFor('structure'),
      radius: n => (n.t.dir ? (n.t === structTree ? 16 : 4 + Math.min(16, Math.sqrt(n.t.files / maxFiles) * 30)) : 2.5 + Math.min(5, Math.sqrt(n.t.f.lines) / 12)),
      color: n => (n.t === structTree ? 'var(--s1)' : n.t.dir ? (structCollapsed.has(n.id) ? '#b9521a' : '#5f5f5f') : colorOf(n.t.f.lang)),
      ring: n => n.t.dir,
      label: n => (n.t.dir ? n.t.name + (structCollapsed.has(n.id) ? ` (+${fmt(n.t.files)})` : '') : n.t.name),
      showLabel: (n, k) => (n.t.dir ? labelled.has(n.id) || k > 1.8 : k > 2.8),
      labelSize: n => (n.t === structTree ? 14 : n.t.dir ? 11 : 9),
      linkColor: l => (l.file ? '#5a5a5a' : '#8f4721'),
      linkWidth: l => (l.file ? 0.7 : 1.6),
      linkAlpha: 0.55,
      distance: l => (l.file ? 14 : 34),
      linkStrength: () => 0.9,
      charge: n => (n.t.dir ? -110 : -18),
      collidePad: 1,
      onHover: (n, ev) => {
        if (!n) return hideTip();
        const t = n.t;
        showTip(t.dir
          ? `<b>${esc(t === structTree ? t.name : t.id.slice(1))}</b><br>${fmt(t.files)} files · ${fmt(t.lines)} lines<br><i>Click: ${structCollapsed.has(t.id) ? 'expand' : 'collapse'}</i>`
          : `<b>${esc(t.f.path)}</b><br>${esc(t.f.lang)} · ${fmt(t.f.lines)} lines<br><i>Click: open · Right-click: more</i>`, ev);
      },
      onClick: n => {
        const t = n.t;
        if (!t.dir) { vscode.postMessage({ type: 'open', abs: t.f.abs }); return; }
        if (t === structTree) return;
        if (structCollapsed.has(t.id)) structCollapsed.delete(t.id); else structCollapsed.add(t.id);
        const next = structVisible();
        const pos = new Map(graphs.structure.positions());
        for (const nn of next.nodes) {
          if (!pos.has(nn.id)) { const p = pos.get(t.id) || { x: 0, y: 0 }; nn.x = p.x + (Math.random() - 0.5) * 20; nn.y = p.y + (Math.random() - 0.5) * 20; }
        }
        updateLabels(next.nodes);
        graphs.structure.setData(next.nodes, next.links, true);
      },
      onContext: (n, ev) => { if (!n.t.dir) openMenu(n.t.f.abs, ev.clientX, ev.clientY); },
    });
  }

  /** expands collapsed folders of the structure graph that contain files matching q */
  function revealInStructure(q) {
    const g = graphs.structure;
    q = String(q || '').trim().toLowerCase();
    if (!g || !q || !structCollapsed.size) return;
    let changed = false;
    for (const f of D.table) {
      if (!f.path.toLowerCase().includes(q)) continue;
      const parts = (D.multiRoot ? f.rootName + '/' + f.path : f.path).split('/');
      for (let i = 1; i < parts.length; i++) {
        const id = '/' + parts.slice(0, i).join('/') + '/';
        if (structCollapsed.delete(id)) changed = true;
      }
    }
    if (!changed) return;
    const next = structVisible();
    g.setData(next.nodes, next.links, true);
  }

  function destroyGraphs() {
    for (const g of Object.values(graphs)) g.destroy();
    graphs = {};
    treemap = null;
  }

  /** quality gate result (same checks as the CI command "node bin/linecounter.js gate") */
  function gateHtml() {
    const g = D.gate;
    if (!g) return '';
    const on = g.checks.filter(c => c.enabled);
    return `<div class="gate ${g.passed ? 'pass' : 'fail'}">
      <div class="gate-head"><span class="gate-badge">${g.passed ? '✓ Quality gate passed' : '✗ Quality gate failed'}</span>
        <span class="muted">${on.length} checks · configure in <code>linecounter.gate</code> · same result in CI with <code>node bin/linecounter.js gate</code></span></div>
      <div class="gate-checks">${g.checks.map(c => `<span class="gate-check ${!c.enabled ? 'off' : c.passed ? 'ok' : 'bad'}" ${tipAttr(`<b>${esc(c.label)}</b><br>${esc(c.detail)}${c.items.length && !c.passed ? '<br>' + c.items.slice(0, 6).map(esc).join('<br>') : ''}`)}>${!c.enabled ? '–' : c.passed ? '✓' : '✗'} ${esc(c.label)}${c.enabled && !c.passed ? ` <b>${fmt(c.count)}</b>` : ''}</span>`).join('')}</div>
    </div>`;
  }

  // ---------- sections ----------
  function overview() {
    const t = D.totals;
    const avg = t.textFiles ? t.lines / t.textFiles : 0;
    return tiles([
      { label: 'Total lines', value: fmt(t.lines), sub: `${fmt(t.textFiles)} text files` },
      { label: 'Code lines', value: fmt(t.code), sub: pctStr(t.code, t.lines) + ' of all lines' },
      { label: 'Comment lines', value: fmt(t.comment), sub: pctStr(t.comment, t.lines) + ' of all lines' },
      { label: 'Blank lines', value: fmt(t.blank), sub: pctStr(t.blank, t.lines) + ' of all lines' },
      { label: 'Files', value: fmt(t.files), sub: `${fmt(t.binaryFiles)} binary${t.skippedFiles ? ` · ${fmt(t.skippedFiles)} too large` : ''}` },
      { label: 'Folders', value: fmt(t.folders) },
      { label: 'Total size', value: bytes(t.size), sub: `${fmt(t.chars)} characters` },
      { label: 'Languages', value: fmt(D.languages.filter(l => l.key !== 'Binary').length), sub: `${fmt(D.extensions.length)} file extensions` },
      { label: 'Avg. lines / file', value: avg.toFixed(1), sub: `median ${fmt(median(D.table.filter(f => !f.binary).map(f => f.lines)))}` },
      { label: 'Avg. line length', value: (t.lines ? t.chars / t.lines : 0).toFixed(1) + ' chars' },
      { label: 'Functions (est.)', value: fmt(t.funcs), sub: `${fmt(t.imports)} imports / includes` },
      { label: 'TODO · FIXME · HACK', value: `${fmt(t.todo)} · ${fmt(t.fixme)} · ${fmt(t.hack)}` },
    ]);
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }

  function languageSection() {
    const byLines = langGroups('lines');
    const byFiles = langGroups('files');
    const t = D.totals;
    const series = [
      { name: 'Code', color: 'var(--s1)' },
      { name: 'Comments', color: 'var(--c-comment)' },
      { name: 'Blank', color: 'var(--c-blank)' },
    ];
    const rows = D.languages.filter(l => l.lines > 0).slice(0, 14).map(l => ({
      label: l.key, parts: [
        { name: 'Code', value: l.code, color: 'var(--s1)' },
        { name: 'Comments', value: l.comment, color: 'var(--c-comment)' },
        { name: 'Blank', value: l.blank, color: 'var(--c-blank)' },
      ],
    }));
    const langTable = `<div class="table-scroll small"><table class="grid">
      <thead><tr><th>Language</th><th class="num">Files</th><th class="num">Lines</th><th class="num">Code</th><th class="num">Comments</th><th class="num">Blank</th><th class="num">Size</th><th class="num">Share</th></tr></thead>
      <tbody>${D.languages.map(l => `<tr><td><span class="sw" style="background:${l.key === 'Binary' ? 'var(--s-other)' : colorOf(l.key)}"></span>${esc(l.key)}</td>
        <td class="num">${fmt(l.files)}</td><td class="num">${fmt(l.lines)}</td><td class="num">${fmt(l.code)}</td>
        <td class="num">${fmt(l.comment)}</td><td class="num">${fmt(l.blank)}</td><td class="num">${bytes(l.size)}</td>
        <td class="num">${pctStr(l.lines, t.lines)}</td></tr>`).join('')}</tbody></table></div>`;

    return `<div class="grid-3">
      ${card('Lines by language', donut(byLines, short(t.lines), 'lines'))}
      ${card('Files by language', donut(byFiles, short(t.files), 'files'))}
      ${card('Lines overall', donut([
        { label: 'Code', value: t.code, color: 'var(--s1)' },
        { label: 'Comments', value: t.comment, color: 'var(--c-comment)' },
        { label: 'Blank', value: t.blank, color: 'var(--c-blank)' },
      ].filter(i => i.value), pctStr(t.code, t.lines, 0), 'is code'))}
    </div>
    <div class="grid-2">
      ${card('Code, comments & blank lines per language', stacked(rows, series))}
      ${card('All languages', langTable)}
    </div>`;
  }

  function filesSection() {
    const top = D.table.filter(f => !f.binary).sort((a, b) => b.lines - a.lines).slice(0, 15);
    const topSize = [...D.table].sort((a, b) => b.size - a.size).slice(0, 15);
    const exts = D.extensions.slice(0, 15);
    const folders = D.folders.slice(0, 15);
    return `
    ${card('Treemap – every rectangle is a file, sized by lines', `<div id="treemap" class="treemap"></div>
      <ul class="legend inline">${[...langColor.entries()].map(([l, c]) => `<li><span class="sw" style="background:${c}"></span>${esc(l)}</li>`).join('')}<li><span class="sw" style="background:var(--s-other)"></span>Other</li></ul>`, { sub: 'Click copies the path · double-click opens · right-click for more' })}
    <div class="grid-2">
      ${card('Largest files (lines)', hbars(top.map(f => ({ label: f.path, value: f.lines, color: colorOf(f.lang), abs: f.abs, tip: `<b>${esc(f.path)}</b><br>${esc(f.lang)} · ${fmt(f.lines)} lines<br><i>click to open</i>` }))), { sub: 'Colored by language' })}
      ${card('Largest files (bytes)', hbars(topSize.map(f => ({ label: f.path, value: f.size, valueLabel: bytes(f.size), color: f.binary ? 'var(--s-other)' : colorOf(f.lang), abs: f.abs, tip: `<b>${esc(f.path)}</b><br>${bytes(f.size)}<br><i>click to open</i>` }))))}
      ${card('Top folders (lines)', hbars(folders.map(f => ({ label: f.key, value: f.lines, tip: `<b>${esc(f.key)}</b><br>${fmt(f.lines)} lines · ${fmt(f.files)} files · ${bytes(f.size)}` }))))}
      ${card('File extensions (file count)', hbars(exts.slice().sort((a, b) => b.files - a.files).map(e => ({ label: e.key, value: e.files, tip: `<b>${esc(e.key)}</b><br>${fmt(e.files)} files · ${fmt(e.lines)} lines` }))))}
      ${card('File length distribution', columns(D.histogram.map(h => ({ label: h.label, value: h.count, tip: `<b>${h.label} lines</b><br>${fmt(h.count)} files` }))), { sub: 'Number of files per line-count bucket' })}
      ${card('Last modified', columns(D.ages.map(h => ({ label: h.label, value: h.count, tip: `<b>${h.label}</b><br>${fmt(h.count)} files` })), { color: 'var(--s2)' }), { sub: 'Files by modification time' })}
    </div>`;
  }

  // ---------- hall of fame ----------
  const NO_COMMENT_LANGS = new Set(['JSON', 'Markdown', 'Text', 'CSV', 'Other', 'Binary', 'reStructuredText', 'Jupyter Notebook']);
  const depthOf = f => f.path.split('/').length - 1;
  const nameOf = f => f.path.split('/').pop();
  const ratio = (a, b) => (b ? a / b : 0);
  const FAME = [
    { e: '🏔️', title: 'Longest file', sub: 'Mount Everest of your code base', ok: f => !f.binary && f.lines > 0, key: f => f.lines, d: f => `${fmt(f.lines)} lines` },
    { e: '🐘', title: 'Heaviest file', sub: 'Needs a diet', ok: () => true, key: f => f.size, d: f => bytes(f.size) },
    { e: '📏', title: 'Longest line', sub: 'Horizontal scrolling champion', ok: f => f.maxLine > 0, key: f => f.maxLine, d: f => `${fmt(f.maxLine)} chars in line ${f.maxLineNo}`, line: f => f.maxLineNo },
    { e: '🐜', title: 'Tiniest file', sub: 'Small but proud', ok: f => !f.binary && f.lines > 0, key: f => -f.lines, d: f => `${fmt(f.lines)} line${f.lines === 1 ? '' : 's'}` },
    { e: '🕳️', title: 'Deepest nested', sub: 'Folder spelunking required', ok: () => true, key: depthOf, d: f => `${depthOf(f)} folders deep` },
    { e: '🐍', title: 'Longest file name', sub: 'Descriptive. Very descriptive.', ok: () => true, key: f => nameOf(f).length, d: f => `${nameOf(f).length} characters` },
    { e: '📝', title: 'TODO collector', sub: 'Promises, promises…', ok: f => f.todo > 0, key: f => f.todo, d: f => `${fmt(f.todo)} TODO / FIXME / HACK` },
    { e: '📖', title: 'Best documented', sub: 'Someone actually wrote comments', ok: f => f.lines >= 20 && f.comment > 0, key: f => ratio(f.comment, f.lines), d: f => `${(ratio(f.comment, f.lines) * 100).toFixed(0)}% comments` },
    { e: '🤐', title: 'Silent treatment', sub: 'Biggest file without a single comment', ok: f => f.comment === 0 && f.code >= 30 && !NO_COMMENT_LANGS.has(f.lang), key: f => f.code, d: f => `${fmt(f.code)} lines of code, 0 comments` },
    { e: '🏭', title: 'Function factory', sub: 'Mass production of functions', ok: f => f.funcs > 0, key: f => f.funcs, d: f => `~${fmt(f.funcs)} functions` },
    { e: '🐛', title: 'Debug print champion', sub: 'console.log driven development', ok: f => f.debug > 0, key: f => f.debug, d: f => `${fmt(f.debug)} debug prints` },
    { e: '🌬️', title: 'Airiest file', sub: 'Mostly empty lines', ok: f => !f.binary && f.lines >= 20, key: f => ratio(f.blank, f.lines), d: f => `${(ratio(f.blank, f.lines) * 100).toFixed(0)}% blank lines` },
    { e: '🧱', title: 'Densest file', sub: 'Not a single breath taken', ok: f => !f.binary && f.lines >= 50 && !NO_COMMENT_LANGS.has(f.lang), key: f => -ratio(f.blank, f.lines), d: f => `only ${(ratio(f.blank, f.lines) * 100).toFixed(1)}% blank lines` },
    { e: '📐', title: 'Widest code', sub: 'Highest average line length', ok: f => !f.binary && f.lines >= 20 && !NO_COMMENT_LANGS.has(f.lang) && f.lang !== 'Gitignore & Co', key: f => ratio(f.chars, f.lines), d: f => `Ø ${ratio(f.chars, f.lines).toFixed(0)} chars per line` },
    { e: '🧹', title: 'Whitespace hoarder', sub: 'Trailing spaces everywhere', ok: f => f.trailing > 0, key: f => f.trailing, d: f => `${fmt(f.trailing)} lines with trailing whitespace` },
    { e: '😀', title: 'Emoji artist', sub: 'Code with feelings', ok: f => f.emojis > 0, key: f => f.emojis, d: f => `${fmt(f.emojis)} emojis` },
    { e: '🆕', title: 'Freshest file', sub: 'Still warm', ok: () => true, key: f => f.mtime, d: f => `changed ${date(f.mtime)}` },
    { e: '🦖', title: 'Fossil', sub: 'Untouched the longest', ok: () => true, key: f => -f.mtime, d: f => `last changed ${date(f.mtime)}` },
  ];
  const MEDALS = ['🥇', '🥈', '🥉'];

  function podium(cat) {
    const list = D.table.filter(cat.ok);
    // partial selection of the top 3 (the table can be large)
    const top = [];
    for (const f of list) {
      const k = cat.key(f);
      if (top.length < 3 || k > top[top.length - 1].k) {
        top.push({ f, k });
        top.sort((a, b) => b.k - a.k);
        if (top.length > 3) top.pop();
      }
    }
    return top.map(t => t.f);
  }

  function hallOfFame() {
    const boards = FAME.map(c => ({ c, top: podium(c) })).filter(b => b.top.length);
    // Most decorated file: 3 points for gold, 2 for silver, 1 for bronze
    const score = new Map();
    for (const b of boards) b.top.forEach((f, i) => {
      const s = score.get(f.abs) || { f, pts: 0, gold: 0, cats: [] };
      s.pts += 3 - i; if (i === 0) { s.gold++; s.cats.push(b.c.e); }
      score.set(f.abs, s);
    });
    const champ = [...score.values()].sort((a, b) => b.pts - a.pts || b.gold - a.gold)[0];
    const hero = champ ? `<div class="fame-hero" data-abs="${esc(champ.f.abs)}" title="Open ${esc(champ.f.path)}">
        <span class="fame-hero-emoji">🏆</span>
        <div><div class="fame-hero-label">Most decorated file</div>
          <div class="fame-hero-file">${esc(champ.f.path)}</div>
          <div class="fame-hero-detail">${champ.gold} gold medal${champ.gold === 1 ? '' : 's'} ${champ.cats.join(' ')} · ${champ.pts} points across ${boards.length} categories</div></div>
      </div>` : '';
    return hero + `<div class="fame">${boards.map(({ c, top }) => `
      <div class="fame-item">
        <div class="fame-head"><span class="fame-emoji">${c.e}</span><div><div class="fame-title">${c.title}</div><div class="fame-sub">${esc(c.sub)}</div></div></div>
        <ol class="podium">${top.map((f, i) => `
          <li class="${i === 0 ? 'gold' : ''}"><span class="medal">${MEDALS[i]}</span>
            <div class="podium-body">${fileLink(f, i === 0 ? f.path : nameOf(f), c.line && c.line(f))}
            <span class="fame-detail">${esc(c.d(f))}</span>${i === 0 ? `<span class="fame-roast">“${esc(roastFor(c.title, f))}”</span>` : ''}</div></li>`).join('')}</ol>
      </div>`).join('')}</div>`;
  }

  function funSection() {
    const t = D.totals;
    const kloc = t.code / 1000;
    const pages = t.lines / 50;
    const meters = t.chars * 0.0025;
    const typingHours = t.chars / 200 / 60;
    const readingHours = t.words / 200 / 60;
    const potter = t.words / 76944;
    const coffee = t.code / 100;
    const effort = kloc > 0 ? 2.4 * Math.pow(kloc, 1.05) : 0;
    const schedule = effort > 0 ? 2.5 * Math.pow(effort, 0.38) : 0;
    const wtf = t.todo + t.fixme + t.hack + t.wtf;
    const wtfPerK = kloc ? wtf / kloc : 0;
    const commentRatio = pct(t.comment, t.code + t.comment);
    const grade = commentRatio >= 25 ? 'A' : commentRatio >= 15 ? 'B' : commentRatio >= 10 ? 'C' : commentRatio >= 5 ? 'D' : 'F';
    const blankRatio = pct(t.blank, t.lines);
    const air = blankRatio > 20 ? 'Airy – your code can breathe.' : blankRatio > 10 ? 'Cozy – just right.' : 'Cramped – open a window!';
    const tabWin = t.tabIndent === t.spaceIndent ? 'It’s a tie. Peace in our time.' : t.tabIndent > t.spaceIndent ? 'Team Tabs wins' : 'Team Spaces wins';
    const distance = meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(0)} m`;
    const eiffel = meters / 330;
    const oldest = (D.repos || []).reduce((m, r) => (r.first && (!m || r.first < m) ? r.first : m), null);

    const facts = [
      ['pages', `${fmt(Math.ceil(pages))} pages`, `If you printed everything (50 lines/page), the stack would be <b>${(pages * 0.01).toFixed(1)} cm</b> high.`],
      ['distance', distance, `All characters in one single line (2.5 mm each) – that’s <b>${eiffel.toFixed(1)}×</b> the Eiffel Tower${meters > 42195 ? ' – longer than a marathon!' : ''}.`],
      ['keyboard', dur(typingHours), 'Time to type it all again at 40 words per minute – without a single typo.'],
      ['book', `${potter.toFixed(2)} × Harry Potter`, `${fmt(t.words)} words ≈ ${dur(readingHours)} of reading (Philosopher’s Stone has 76,944 words).`],
      ['coffee', `${fmt(Math.round(coffee))} cups`, 'Estimated coffee consumption (scientifically proven rate: 1 cup per 100 lines of code).'],
      ['coins', `${effort.toFixed(1)} person-months`, `Basic COCOMO estimate – about ${schedule.toFixed(1)} months with ${schedule ? (effort / schedule).toFixed(1) : 0} developers, ≈ €${fmt(Math.round(effort * 6000))}.`],
      ['alert', `${wtfPerK.toFixed(1)} WTF/kLOC`, `The only valid code quality metric. ${fmt(wtf)} TODOs, FIXMEs, HACKs & “magic” comments found.`],
      ['award', `Grade ${grade}`, `Documentation grade: ${commentRatio.toFixed(1)}% of non-blank lines are comments.`],
      ['wind', `${blankRatio.toFixed(1)}% blank`, air],
      ['indent', tabWin, `${fmt(t.tabIndent)} lines indented with tabs vs. ${fmt(t.spaceIndent)} with spaces.`],
      ['bug', fmt(t.debugPrints), 'Debug prints (console.log, print, printf…) – some of them are surely still needed…'],
      ['code', fmt(t.semicolons), `Semicolons. Plus ${fmt(t.braces)} curly braces and ${fmt(t.parens)} parentheses.`],
      ['space', fmt(t.trailing), 'Lines with trailing whitespace – invisible, but they are there.'],
      ['star', fmt(t.fortyTwo), 'Occurrences of 42 – the answer to life, the universe and everything.'],
      ['smile', fmt(t.emojis), 'Emojis hidden in your files.'],
      ['message', fmt(Math.ceil(t.chars / 280)), 'Tweets needed to post the whole code base (280 chars each).'],
      ['save', fmt(Math.ceil(D.totals.size / 1474560)), 'Floppy disks (1.44 MB) required for a backup, 1995 style.'],
      ...(oldest ? [['fossil', `${fmt(Math.floor((Date.now() - oldest) / 86400000))} days`, `Age of the project – first commit on ${date(oldest)}.`]] : []),
    ];
    return `<div class="fun">${facts.map(([ic, big, text]) => `
      <div class="fun-item"><div class="fun-icon">${icon(ic)}</div><div class="fun-big">${esc(big)}</div><div class="fun-text">${text}</div></div>`).join('')}</div>`;
  }

  // ---------- code rant ----------
  const LONG_RANTS = [
    '<b>{n}</b> has {l} lines. That is not a file, that is a novel. 📚 Split it up.',
    '{l} lines? <b>{n}</b> is {x}× over the {m}-line limit. Somewhere the single-responsibility principle is crying. 😢',
    'Scrolling through <b>{n}</b> counts as cardio. 🏃',
    '<b>{n}</b> is where functions go to never be refactored again. 🪦',
    'Nobody has read <b>{n}</b> top to bottom since it passed {m} lines. Nobody. 👀',
    '<b>{n}</b> wants to be three files when it grows up. 🌱',
    'Git blame on <b>{n}</b> is basically a family tree at this point. 🌳',
    'If <b>{n}</b> were a book it would need a table of contents. And an index. 📖',
    '<b>{n}</b>: {l} lines of “I will clean this up later”. 🧹',
    'Your IDE’s minimap for <b>{n}</b> needs its own minimap. 🗺️',
    '<b>{n}</b> has more lines than some operating systems had in the 70s. 🖥️',
    'Opening <b>{n}</b> makes the laptop fan spin up. 🌀',
    '<b>{n}</b> is {x}× the limit. This is how legacy code is born. 👶',
    'Code review for <b>{n}</b>: “LGTM” – said nobody who actually read it. 🙈',
    '<b>{n}</b> has {l} lines. Tolstoy called, he wants his length back. 📖',
    'Somewhere inside <b>{n}</b> there is a small, clean module trying to get out. 🐣',
    '<b>{n}</b> has reached the size where people just add code at the bottom and pray. 🙏',
    'Ctrl+F is the only way to navigate <b>{n}</b>. {l} lines of hide and seek. 🔍',
    '<b>{n}</b> is {x}× the limit. Even the linter gave up and went home. 🏠',
    'The merge conflicts in <b>{n}</b> have merge conflicts. ⚔️',
    '<b>{n}</b> has more lines than your last three pull requests had reviewers combined. Probably. 👥',
    'If <b>{n}</b> were a function it would violate the Geneva Convention. 🚨',
  ];
  const BLANK_RANTS = [
    '<b>{n}</b> is {p}% empty lines. Is this code or a poem? 📜',
    '{p}% whitespace in <b>{n}</b>. Your scroll wheel files a complaint. 🖱️',
    '<b>{n}</b> contains more air than a bag of chips ({p}% blank). 🥔',
    '<b>{n}</b>: {p}% blank lines. Minimalism is nice, but this is just emptiness. 🫥',
    'Mind the gap – <b>{n}</b> is {p}% blank lines. 🚇',
    '<b>{n}</b> is being paid by the line, isn’t it? {p}% of them are empty. 💸',
    'Somebody leaned on the Enter key in <b>{n}</b>. {p}% blank. ⏎',
    '<b>{n}</b> could lose {r} blank lines and nobody would notice. 🤫',
    'Social distancing between the lines of <b>{n}</b> ({p}% blank). 😷',
    '<b>{n}</b> – {p}% blank. Even the code needs space from this code. 🌌',
    '<b>{n}</b> has {r} blank lines too many. The Enter key needs a vacation. 🏖️',
    'Reading <b>{n}</b> feels like reading a text from someone who presses Enter after every word. 📱',
    '<b>{n}</b>: {p}% nothing. Artistic, but not very useful. 🎨',
    'The blank lines in <b>{n}</b> are load-bearing now. Don’t touch them. 🏗️',
    '<b>{n}</b> is {p}% vacuum. NASA wants to study it. 🚀',
  ];
  const LONG_LEVELS = [[1.5, '🙄', 'Mild'], [2.5, '😤', 'Spicy'], [5, '🤬', 'Furious'], [Infinity, '💀', 'Nuclear']];
  const BLANK_LEVELS = [[1.5, '🫧', 'Breezy'], [2.5, '🌬️', 'Drafty'], [4, '🏜️', 'Desert'], [Infinity, '🕳️', 'Void']];
  const MOODS = [[0, '😇', 'Zen', 'Nothing to rant about. Suspicious. Very suspicious.'], [15, '🙂', 'Mildly annoyed', 'A few things here and there. The ranter is sipping tea.'],
    [35, '😒', 'Grumpy', 'The ranter put down the tea.'], [60, '😤', 'Fuming', 'Steam is coming out of the ranter’s ears.'],
    [85, '🤬', 'Livid', 'The ranter has opened a second monitor just to complain.'], [Infinity, '🌋', 'Volcanic', 'Evacuate the repository.']];
  const hash = str => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); };
  const fill = (tpl, vals) => tpl.replace(/\{(\w)\}/g, (_, k) => vals[k]);
  const rantCfg = () => D.rant || { enabled: false };
  const isTooLong = f => rantCfg().enabled && !f.binary && f.lines > rantCfg().maxLines;
  const blankPct = f => (f.lines ? (f.blank / f.lines) * 100 : 0);
  const isTooAiry = f => rantCfg().enabled && !f.binary && f.lines >= 10 && blankPct(f) > rantCfg().maxBlankPercent;
  const level = (levels, v) => levels.findIndex(l => v <= l[0]);
  const longLevel = f => level(LONG_LEVELS, f.lines / rantCfg().maxLines);
  const blankLevel = f => level(BLANK_LEVELS, rantCfg().maxBlankPercent ? blankPct(f) / rantCfg().maxBlankPercent : Infinity);
  const extraBlank = f => Math.max(0, Math.ceil(f.blank - (rantCfg().maxBlankPercent / 100) * f.lines));
  const rantShowAll = { long: false, blank: false };
  const rantLevelFilter = { long: -1, blank: -1 };

  function rantList(kind) {
    const cfg = rantCfg();
    const long = kind === 'long';
    const levels = long ? LONG_LEVELS : BLANK_LEVELS;
    const lvOf = long ? longLevel : blankLevel;
    const all = D.table.filter(long ? isTooLong : isTooAiry)
      .sort((a, b) => (long ? b.lines - a.lines : blankPct(b) - blankPct(a)));
    if (!all.length) {
      return `<p class="rant-empty">${long ? `😌 No file is longer than ${fmt(cfg.maxLines)} lines. Respect.` : `😌 No file has more than ${cfg.maxBlankPercent}% blank lines. Tight.`}</p>`;
    }
    const counts = levels.map((_, i) => all.filter(f => lvOf(f) === i).length);
    const chips = `<div class="rant-chips">
      <button class="rant-chip ${rantLevelFilter[kind] === -1 ? 'on' : ''}" data-rant-lv="${kind}:-1">All ${fmt(all.length)}</button>
      ${levels.map((l, i) => counts[i] ? `<button class="rant-chip lv${i + 1} ${rantLevelFilter[kind] === i ? 'on' : ''}" data-rant-lv="${kind}:${i}">${l[1]} ${l[2]} ${fmt(counts[i])}</button>` : '').join('')}
    </div>`;
    const files = rantLevelFilter[kind] === -1 ? all : all.filter(f => lvOf(f) === rantLevelFilter[kind]);
    const shown = rantShowAll[kind] ? files : files.slice(0, 15);
    const tpls = long ? LONG_RANTS : BLANK_RANTS;
    const items = shown.map(f => {
      const lv = lvOf(f);
      const text = fill(tpls[hash(f.path) % tpls.length], {
        n: esc(nameOf(f)), l: fmt(f.lines), m: fmt(cfg.maxLines), x: (f.lines / cfg.maxLines).toFixed(1), p: blankPct(f).toFixed(0), r: fmt(extraBlank(f)),
      });
      const badge = long ? `${fmt(f.lines)} lines` : `${blankPct(f).toFixed(1)}% blank`;
      return `<li class="rant-item" data-abs="${esc(f.abs)}" title="Open ${esc(f.path)} – ${levels[lv][2]}">
        <span class="rant-emoji" title="${levels[lv][2]}">${levels[lv][1]}</span>
        <span class="rant-badge lv${lv + 1}">${badge}</span>
        <div><div class="rant-text">${text}</div><div class="rant-path">${esc(f.path)}</div></div></li>`;
    }).join('');
    const more = files.length > shown.length ? `<button class="btn" data-rant-all="${kind}">Show all ${fmt(files.length)}</button>` : '';
    return chips + `<ul class="rant-list">${items}</ul>${more}`;
  }

  function bonusRants() {
    const text = D.table.filter(f => !f.binary);
    const pick = (arr, key, n) => arr.sort((a, b) => key(b) - key(a)).slice(0, n);
    const out = [];
    for (const f of pick(text.filter(f => f.maxLine > 200), f => f.maxLine, 3)) out.push(['📏', f, `Line ${f.maxLineNo} of <b>${esc(nameOf(f))}</b> is ${fmt(f.maxLine)} characters long. Horizontal scrolling is not a feature.`, f.maxLineNo]);
    for (const f of pick(text.filter(f => f.debug >= 10), f => f.debug, 2)) out.push(['🐛', f, `<b>${esc(nameOf(f))}</b> has ${fmt(f.debug)} debug prints. Is this production or a crime scene?`]);
    for (const f of pick(text.filter(f => f.todo >= 5), f => f.todo, 2)) out.push(['📝', f, `${fmt(f.todo)} TODOs in <b>${esc(nameOf(f))}</b>. That is not a file, that is a wish list.`]);
    for (const f of pick(text.filter(f => f.comment === 0 && f.code >= 200 && !NO_COMMENT_LANGS.has(f.lang)), f => f.code, 2)) out.push(['🤐', f, `${fmt(f.code)} lines of code in <b>${esc(nameOf(f))}</b> and not one comment. Good luck, future you.`]);
    for (const f of pick(text.filter(f => f.trailing >= 20), f => f.trailing, 2)) out.push(['🧹', f, `<b>${esc(nameOf(f))}</b> hides ${fmt(f.trailing)} lines with trailing whitespace. Invisible mess is still mess.`]);
    for (const f of pick(text.filter(f => f.wtf >= 3), f => f.wtf, 2)) out.push(['🤯', f, `<b>${esc(nameOf(f))}</b> mentions “wtf / magic / ugly” ${fmt(f.wtf)} times. The code is talking to you.`]);
    const G = D.importGraph;
    const byAbs = abs => D.table.find(f => f.abs === abs);
    if (G) {
      for (const c of G.cycles.slice(0, 4)) {
        const f = byAbs(c.cycle[0].abs);
        const names = c.cycle.map(x => `<b>${esc(shortPath(x.path))}</b>`).join(' → ');
        if (f) out.push(['🔁', f, c.size === 2
          ? `${names}. Two files importing each other – a toxic relationship.`
          : `${names}. A ${c.size}-file circle of trust. Nobody knows who started it.`]);
      }
      const ch = G.chains[0];
      if (ch && ch.length >= 6 && byAbs(ch.files[0].abs)) out.push(['⛓️', byAbs(ch.files[0].abs), `A dependency chain ${ch.length} files deep: ${ch.files.map(x => `<b>${esc(x.path.split('/').pop())}</b>`).join(' → ')}. Pull one thread and the sweater unravels.`]);
      const br = (G.blastRadius || [])[0];
      if (br && br.count >= 20 && byAbs(br.abs)) out.push(['💣', byAbs(br.abs), `If <b>${esc(br.path.split('/').pop())}</b> breaks, ${fmt(br.count)} files go down with it. Handle with care.`]);
      const mag = G.mostImported[0];
      if (mag && mag.count >= 8 && byAbs(mag.abs)) out.push(['🧲', byAbs(mag.abs), `<b>${esc(mag.path.split('/').pop())}</b> is imported by ${fmt(mag.count)} files. If it breaks, everything breaks. Sleep well.`]);
      const oct = G.mostImporting[0];
      if (oct && oct.count >= 12 && byAbs(oct.abs)) out.push(['🐙', byAbs(oct.abs), `<b>${esc(oct.path.split('/').pop())}</b> imports ${fmt(oct.count)} other files. An octopus would be jealous.`]);
    }
    if (!out.length) return '<p class="rant-empty">😌 No bonus material. Your code is suspiciously well-behaved.</p>';
    return `<ul class="rant-list">${out.map(([e, f, t, line]) => `<li class="rant-item" data-abs="${esc(f.abs)}" ${line ? `data-line="${line}"` : ''} title="Open ${esc(f.path)}">
      <span class="rant-emoji">${e}</span><div><div class="rant-text">${t}</div><div class="rant-path">${esc(f.path)}</div></div></li>`).join('')}</ul>`;
  }

  function rantSection() {
    const cfg = rantCfg();
    if (!cfg.enabled) return '';
    const t = D.totals;
    const projBlank = pct(t.blank, t.lines);
    const longs = D.table.filter(isTooLong);
    const airy = D.table.filter(isTooAiry);
    const candidates = Math.max(1, D.table.filter(f => !f.binary && f.lines >= 10).length);
    // score: offenders weighted by severity (1..4), relative to the number of real files
    const weight = longs.reduce((s, f) => s + longLevel(f) + 1, 0) + airy.reduce((s, f) => s + blankLevel(f) + 1, 0) * 0.6;
    // 0 = no offenders, 100 = half of all files at the worst level in both categories
    let score = Math.min(100, Math.round((weight / (6.4 * candidates)) * 200));
    if (projBlank > cfg.maxBlankPercent) score = Math.min(100, score + 10);
    const mood = MOODS.find(m => score <= m[0]);
    const worst = longs.sort((a, b) => b.lines - a.lines)[0];
    const overLines = longs.reduce((s, f) => s + f.lines - cfg.maxLines, 0);
    const removable = airy.reduce((s, f) => s + extraBlank(f), 0);
    const projLine = projBlank > cfg.maxBlankPercent
      ? `🏝️ Across the whole project ${projBlank.toFixed(1)}% of all lines are blank – ${fmt(t.blank)} lines of pure nothing (limit ${cfg.maxBlankPercent}%).`
      : `✅ Project-wide only ${projBlank.toFixed(1)}% blank lines – within the ${cfg.maxBlankPercent}% limit.`;
    return `<h2 id="s-rant">Code Rant</h2>
      <div class="rant-head">
        <div class="rant-mood"><span class="rant-mood-emoji">${mood[1]}</span><span class="rant-mood-label">${mood[2]}</span></div>
        <div class="rant-meter-wrap">
          <div class="rant-headline">Rant-o-Meter: ${score}/100 – ${esc(mood[3])}</div>
          <div class="rant-meter"><span class="rant-meter-fill" style="width:${score}%"></span><span class="rant-meter-mark" style="left:${score}%"></span></div>
          <div class="rant-meter-scale">${MOODS.map(m => `<span>${m[1]}</span>`).join('')}</div>
          <div class="muted rant-proj">${esc(projLine)}</div>
        </div>
      </div>
      <div class="rant-stats">
        <div class="rant-stat"><span class="rant-stat-emoji">📚</span><div><b>${fmt(longs.length)}</b> file${longs.length === 1 ? '' : 's'} over ${fmt(cfg.maxLines)} lines</div></div>
        <div class="rant-stat"><span class="rant-stat-emoji">✂️</span><div><b>${fmt(overLines)}</b> lines above the limit in total</div></div>
        <div class="rant-stat"><span class="rant-stat-emoji">🫧</span><div><b>${fmt(airy.length)}</b> file${airy.length === 1 ? '' : 's'} over ${cfg.maxBlankPercent}% blank</div></div>
        <div class="rant-stat"><span class="rant-stat-emoji">🗑️</span><div><b>${fmt(removable)}</b> blank lines could go</div></div>
        ${worst ? `<div class="rant-stat clickable" data-abs="${esc(worst.abs)}" title="Open ${esc(worst.path)}"><span class="rant-stat-emoji">👑</span><div>Worst offender: <b>${esc(nameOf(worst))}</b> (${(worst.lines / cfg.maxLines).toFixed(1)}×)</div></div>` : ''}
      </div>
      ${card('🔥 Project roast', projectRoast(), { sub: 'Nothing personal. Okay, a little personal.' })}
      <div class="grid-2">
        ${card(`📚 Too long – over ${fmt(cfg.maxLines)} lines`, `<div id="rant-long">${rantList('long')}</div>`)}
        ${card(`🫧 Too much air – over ${cfg.maxBlankPercent}% blank`, `<div id="rant-blank">${rantList('blank')}</div>`, { sub: 'files with 10+ lines' })}
      </div>
      ${card('🎁 Bonus rants', bonusRants(), { sub: 'Things nobody asked about' })}
      ${(D.repos || []).map(commitRant).join('')}
      <p class="muted rant-note">Limits come from the settings <code>linecounter.rant.maxFileLines</code> and <code>linecounter.rant.maxBlankPercent</code>.</p>`;
  }

  // ---------- roasts ----------
  const FAME_ROASTS = {
    'Longest file': ['Has its own weather system.', 'Loading… still loading…', 'Visible from space.', 'The IDE asks for a coffee break when opening it.'],
    'Heaviest file': ['Skipped leg day, every day.', 'Would sink a ship.', 'The git server groans a little every time.'],
    'Longest line': ['Ultra-wide monitor sponsored content.', 'Line wrapping has left the chat.', 'Scroll right. Keep scrolling. Almost there.'],
    'Tiniest file': ['Does it even do anything?', 'The intern’s first commit.', 'Proof that size doesn’t matter. Or does it?'],
    'Deepest nested': ['Bring a flashlight.', 'Java developers feel right at home.', 'cd ../../../../../ – the workout.'],
    'Longest file name': ['Autocomplete is carrying this one.', 'Named by a committee.', 'The file name is longer than some functions.'],
    'TODO collector': ['The backlog moved into the code.', 'Future-you has a lot of work to do.', 'TODO: fix TODOs.'],
    'Best documented': ['Someone actually cared. Frame it.', 'Rare footage of documentation in the wild.', 'Probably comments like “// increment i”.'],
    'Silent treatment': ['Not a single comment. Pure confidence.', 'Self-documenting code, they said.', 'Good luck to whoever inherits this.'],
    'Function factory': ['Assembly line of functions. Unionize.', 'Every problem is solved with another function.', 'The single responsibility principle took a day off.'],
    'Debug print champion': ['console.log is not a debugger. Or is it?', 'print("here"), print("here2"), print("HERE!!!")', 'Logs so loud the terminal needs earplugs.'],
    'Airiest file': ['Lots of breathing room. Maybe too much.', 'Blank lines: the cheapest way to look productive.', 'Space – the final frontier.'],
    'Densest file': ['Written by someone who hates the Enter key.', 'Not a single breath taken.', 'Readable only by compilers.'],
    'Widest code': ['80-column rule? Never heard of it.', 'Written on a cinema screen.', 'Horizontal scrolling enthusiasts unite.'],
    'Whitespace hoarder': ['Invisible mess is still mess.', 'Your linter is crying quietly.', 'Spaces at the end of lines: a collector’s item.'],
    'Emoji artist': ['Code with feelings 💅', 'Professional? Never heard of it.', 'Unicode goes brrr.'],
    'Freshest file': ['Still smells like fresh bugs.', 'The ink is not dry yet.', 'Brand new, not yet regretted.'],
    'Fossil': ['Carbon dating recommended.', 'Nobody dares to touch it.', 'Written when jQuery was cool.'],
  };
  const roastFor = (title, f) => { const l = FAME_ROASTS[title]; return l ? l[hash(f.path + title) % l.length] : ''; };

  function projectRoast() {
    const t = D.totals;
    const out = [];
    const langs = D.languages.filter(l => l.key !== 'Binary' && l.lines > 0);
    const has = k => langs.some(l => l.key === k);
    const commentPct = pct(t.comment, t.code + t.comment);
    const avg = t.textFiles ? t.lines / t.textFiles : 0;
    const tiny = D.table.filter(f => !f.binary && f.lines > 0 && f.lines < 10).length;
    const md = D.languages.find(l => l.key === 'Markdown');
    const longest = D.table.reduce((m, f) => (!m || f.maxLine > m.maxLine ? f : m), null);
    if (commentPct < 5) out.push(['💬', `Only ${commentPct.toFixed(1)}% of the non-blank lines are comments. Documentation is apparently passed down orally.`]);
    else if (commentPct > 30) out.push(['📰', `${commentPct.toFixed(0)}% comments. Is this a code base or a blog?`]);
    if (avg > 300) out.push(['📏', `The average file has ${fmt(Math.round(avg))} lines. Microservices, macro files.`]);
    if (t.todo + t.fixme + t.hack >= 20) out.push(['📝', `${fmt(t.todo + t.fixme + t.hack)} TODOs, FIXMEs and HACKs. The backlog lives in the code now.`]);
    if (t.debugPrints >= 20) out.push(['🐛', `${fmt(t.debugPrints)} debug prints. console.log is not a logging framework.`]);
    if (langs.length >= 8) out.push(['🌍', `${langs.length} languages. Is this a project or the Tower of Babel?`]);
    if (has('JavaScript') && has('TypeScript')) out.push(['🤝', 'JavaScript and TypeScript living side by side. Commit to the types already.']);
    if (md && md.lines > t.code * 0.3) out.push(['📚', `Markdown makes up ${pctStr(md.lines, t.lines, 0)} of all lines. More talking than coding.`]);
    if (t.trailing >= 50) out.push(['🧹', `${fmt(t.trailing)} lines with trailing whitespace. Invisible, but we see you.`]);
    if (longest && longest.maxLine > 300) out.push(['➡️', `One line in ${esc(longest.path.split('/').pop())} is ${fmt(longest.maxLine)} characters long. Ultra-wide monitors send their thanks.`]);
    if (t.tabIndent > t.lines * 0.05 && t.spaceIndent > t.lines * 0.05) out.push(['⚔️', `Tabs AND spaces (${fmt(t.tabIndent)} vs. ${fmt(t.spaceIndent)} lines). Pick a side. This is a war.`]);
    if (t.emojis >= 10) out.push(['😜', `${fmt(t.emojis)} emojis hidden in the code. Very professional.`]);
    if (t.files >= 1000) out.push(['🗄️', `${fmt(t.files)} files. Somebody really likes creating files.`]);
    if (t.textFiles && tiny / t.textFiles > 0.25) out.push(['🐜', `${pctStr(tiny, t.textFiles, 0)} of all files have fewer than 10 lines. Was there a sale on files?`]);
    if (t.fortyTwo >= 5) out.push(['🌌', `The number 42 appears ${fmt(t.fortyTwo)} times. Someone knows the answer, but not the question.`]);
    if (t.wtf >= 5) out.push(['🤯', `“wtf”, “magic” or “ugly” written ${fmt(t.wtf)} times. The code is trying to tell you something.`]);
    const G = D.importGraph;
    if (G && G.cycleCount) out.push(['🔁', `${fmt(G.cycleCount)} circular import${G.cycleCount === 1 ? '' : 's'} involving ${fmt(G.filesInCycles)} files. Codependency is not healthy.`]);
    if (G && G.longestChain >= 8) out.push(['⛓️', `The longest import chain is ${fmt(G.longestChain)} files deep. Dependency Jenga, anyone?`]);
    if (G && G.mostImported[0] && G.mostImported[0].count >= 15) out.push(['🧲', `${esc(G.mostImported[0].path.split('/').pop())} is imported by ${fmt(G.mostImported[0].count)} files. Please never break it. No pressure.`]);
    for (const r of D.repos || []) {
      const top = r.authors[0];
      if (r.busFactor === 1 && r.authorCount > 1 && top) out.push(['🚌', `Bus factor 1 in ${esc(r.name)}. Please keep ${esc(top.name)} away from buses.`]);
      if (r.commitCount >= 20 && r.night / r.commitCount > 0.15) out.push(['🦉', `${pctStr(r.night, r.commitCount, 0)} of the commits happened between midnight and 5 am. Sleep is for the weak, apparently.`]);
      if (r.commitCount >= 20 && r.weekend / r.commitCount > 0.3) out.push(['🏖️', `${pctStr(r.weekend, r.commitCount, 0)} weekend commits. Touch grass.`]);
    }
    if (window.LCDeps && D.dependencies) out.push(...LCDeps.rants(UI(), D));
    if (window.LCHealth && D.health) out.push(...LCHealth.rants(UI(), D));
    if (window.LCArch) out.push(...LCArch.rants(UI(), D));
    if (window.LCOwnership) out.push(...LCOwnership.rants(UI(), D));
    if (window.LCTodos) out.push(...LCTodos.rants(UI(), D));
    if (window.LCCompare) out.push(...LCCompare.rants(UI(), D));
    if (!out.length) out.push(['😇', 'We tried to roast this project and found nothing. Suspicious. Very suspicious.']);
    return `<ul class="roast-list">${out.map(([e, t2]) => `<li><span class="rant-emoji">${e}</span><span>${t2}</span></li>`).join('')}</ul>`;
  }

  const WORD_QUIPS = {
    wip: 'Work in progress. Forever in progress.', asdf: 'Keyboard smash detected.', tmp: 'Nothing is more permanent than a temporary fix.',
    temp: 'Nothing is more permanent than a temporary fix.', stuff: 'Very descriptive. Stuff happened.', misc: 'Miscellaneous – the junk drawer of git.',
    oops: 'At least they are honest.', typo: 'Spell checkers exist. Just saying.', final: 'Narrator: it was not the final one.',
    please: 'Begging the CI does not work. We checked.', hack: 'Hacks all the way down.', whatever: 'Passive-aggressive commit detected.',
    idk: 'Neither do we.', wtf: 'The commit history is screaming.', lol: 'Glad someone is having fun.', yolo: 'You only deploy once. Hopefully.',
    again: 'Déjà vu, again.', why: 'The eternal question.', test: 'Testing in production, or testing the commit button?',
    changes: 'Yes, commits usually contain changes. Thanks for clarifying.', update: 'Updated what? The suspense is killing us.',
    minor: 'Minor, they said. 400 changed lines, the diff said.', 'small fix': 'Small fix, big hopes.', 'fixed stuff': 'Which stuff? All the stuff?',
  };
  const quote = e => `<span class="cm-quote" ${tipAttr(`<b>${esc(e.hash)}</b> · ${esc(e.author)}<br>${date(e.time)}`)}>“${esc(e.subject.length > 90 ? e.subject.slice(0, 88) + '…' : e.subject)}”</span>`;

  function commitRant(r) {
    const c = r.commitRant;
    if (!c || !c.total) return '';
    const items = [];
    const ex = list => (list.length ? `<div class="cm-examples">${list.slice(0, 5).map(quote).join('')}</div>` : '');
    if (c.short.count) items.push(['🤏', `<b>${fmt(c.short.count)}</b> commit message${c.short.count === 1 ? '' : 's'} shorter than ${c.minLength} characters (${pctStr(c.short.count, c.total, 0)}). Poetry is about brevity – git is not.`, ex(c.short.examples)]);
    if (c.long.count) items.push(['📜', `<b>${fmt(c.long.count)}</b> subject line${c.long.count === 1 ? '' : 's'} longer than ${c.maxLength} characters – the longest has ${fmt(c.long.examples[0].subject.length)}. That’s not a subject, that’s a memoir.`, ex(c.long.examples.slice(0, 2))]);
    for (const w of c.words.slice(0, 8)) items.push(['🚩', `“<b>${esc(w.word)}</b>” appears in ${fmt(w.count)} commit${w.count === 1 ? '' : 's'}. ${esc(WORD_QUIPS[w.word] || 'Seriously?')}`, ex(w.examples.slice(0, 3))]);
    for (const rp of c.repeats.slice(0, 3)) items.push(['🔁', `“<b>${esc(rp.subject)}</b>” was used <b>${fmt(rp.count)}</b> times as the complete message. Groundhog Day, but with git.`, '']);
    if (c.shouting.count) items.push(['📢', `<b>${fmt(c.shouting.count)}</b> COMMIT MESSAGES ARE SHOUTING. WHY ARE WE YELLING?`, ex(c.shouting.examples)]);
    if (c.exclaim.count) items.push(['❗', `<b>${fmt(c.exclaim.count)}</b> messages with “!!” or “??”. Deep breaths. It’s just code.`, ex(c.exclaim.examples)]);
    if (c.reverts) items.push(['⏪', `<b>${fmt(c.reverts)}</b> reverts. Ctrl+Z, but make it permanent.`, '']);
    if (c.fridayLate.count) items.push(['🍻', `<b>${fmt(c.fridayLate.count)}</b> commits on Friday after 5 pm. Bold move. Very bold.`, ex(c.fridayLate.examples.slice(0, 3))]);
    if (c.lowercase / c.total > 0.5) items.push(['🔡', `${pctStr(c.lowercase, c.total, 0)} of the messages start in lowercase. Capital letters are free, by the way.`, '']);
    if (c.endsWithDot / c.total > 0.1) items.push(['⏺️', `${fmt(c.endsWithDot)} subjects end with a period. It’s a commit, not a letter to grandma.`, '']);
    const bad = c.short.count + c.long.count + c.words.reduce((s, w) => s + w.count, 0) + c.shouting.count;
    const verdict = bad / c.total > 0.4 ? '🗑️ Commit hygiene: dumpster fire.' : bad / c.total > 0.2 ? '😬 Commit hygiene: questionable.' : bad / c.total > 0.05 ? '🙂 Commit hygiene: mostly fine, with some crimes.' : '✨ Commit hygiene: impressively clean.';
    return card(`💬 Commit message rant – ${esc(r.name)}`, `<div class="cm-verdict">${verdict} <span class="muted">${fmt(c.total)} commits checked (merges and bots excluded)</span></div>
      ${items.length ? `<ul class="rant-list cm-list">${items.map(([e, t, x]) => `<li class="cm-item"><span class="rant-emoji">${e}</span><div><div class="rant-text">${t}</div>${x}</div></li>`).join('')}</ul>` : '<p class="rant-empty">😌 Nothing to complain about. Who writes commit messages like that?</p>'}`,
    { sub: `limits: ${c.minLength}–${c.maxLength} chars` });
  }

  function identifierCloud() {
    const ids = D.identifiers;
    if (!ids.length) return '<p class="muted">No identifiers found.</p>';
    const max = ids[0][1], min = ids[ids.length - 1][1];
    const shuffled = ids.map((x, i) => ({ x, k: (i * 7919) % ids.length })).sort((a, b) => a.k - b.k).map(o => o.x);
    return `<div class="cloud">${shuffled.map(([w, c]) => {
      const s = max === min ? 1 : (c - min) / (max - min);
      return `<span style="font-size:${(0.85 + s * 1.9).toFixed(2)}em;font-weight:${s > 0.5 ? 700 : s > 0.2 ? 600 : 400}" class="${s > 0.4 ? 'strong' : ''}" ${tipAttr(`<b>${esc(w)}</b><br>${fmt(c)} times`)}>${esc(w)}</span>`;
    }).join(' ')}</div>`;
  }

  function gitSection() {
    const repos = D.repos || [];
    if (!repos.length) {
      return card('Git', '<p class="muted">No git repository detected in the selected files (or git is not installed).</p>');
    }
    if (repos.length === 1) return repoDetail(repos[0]);
    return repoOverview(repos) + `<div id="repo-detail">${repoDetail(repos.find(r => r.label === gitState.repo) || repos[0])}</div>`;
  }

  // ---------- many repositories: overview table, combined activity, switcher ----------
  const gitState = { repo: null, sort: 'commitCount', dir: -1 };
  function repoOverview(repos) {
    const now = Date.now();
    const DAY = 86400000;
    const sel = gitState.repo || repos.slice().sort((a, b) => b.commitCount - a.commitCount)[0].label;
    gitState.repo = sel;
    const k = gitState.sort;
    const rows = repos.slice().sort((a, b) => {
      const va = k === 'label' ? a.label : k === 'files' ? (a.selection || {}).files : a[k], vb = k === 'label' ? b.label : k === 'files' ? (b.selection || {}).files : b[k];
      return (typeof va === 'string' ? va.localeCompare(vb) : (va || 0) - (vb || 0)) * gitState.dir;
    });
    // last 12 months of activity per repo (sparkline) and combined
    const monthKeys = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const monthsOf = r => { const m = new Map(r.months.map(x => [x.month, x.count])); return monthKeys.map(k2 => m.get(k2) || 0); };
    const maxM = Math.max(1, ...repos.flatMap(monthsOf));
    const spark = r => { const v = monthsOf(r); return `<svg viewBox="0 0 120 24" class="repo-spark">${v.map((c, i) => `<rect x="${i * 10 + 1}" y="${24 - Math.max(c ? 2 : 0.5, (c / maxM) * 24)}" width="8" height="${Math.max(c ? 2 : 0.5, (c / maxM) * 24)}" rx="1.5"/>`).join('')}</svg>`; };
    const colors = window.LCGraphs ? LCGraphs.palette(repos.map(r => r.label)) : new Map();
    const head = (label, key, cls = '') => `<th class="${cls} sortable ${k === key ? (gitState.dir > 0 ? 'asc' : 'desc') : ''}" data-repo-sort="${key}">${label}</th>`;
    const ago = t => { const d = Math.floor((now - t) / DAY); return d < 1 ? 'today' : d < 60 ? `${d} days ago` : d < 730 ? `${Math.round(d / 30)} months ago` : `${(d / 365).toFixed(1)} years ago`; };
    // combined: commits per month across all repos, stacked
    const stackedMonths = monthKeys.map(m => ({ label: m, parts: repos.map(r => ({ name: r.label, value: (r.months.find(x => x.month === m) || {}).count || 0, color: colors.get(r.label) })) }));
    const maxStack = Math.max(1, ...stackedMonths.map(m => m.parts.reduce((s2, p) => s2 + p.value, 0)));
    const combined = `<div class="repo-stack">${stackedMonths.map(m => `<div class="repo-stack-col" ${tipAttr(`<b>${m.label}</b><br>${m.parts.filter(p => p.value).map(p => `<span class="sw" style="background:${p.color}"></span>${esc(p.name)}: ${fmt(p.value)}`).join('<br>') || 'no commits'}`)}>
        <div class="repo-stack-bar">${m.parts.filter(p => p.value).map(p => `<span style="height:${(p.value / maxStack) * 100}%;background:${p.color}"></span>`).join('')}</div><div class="col-label">${m.label.slice(2)}</div></div>`).join('')}</div>
      <ul class="legend inline">${repos.map(r => `<li><span class="sw" style="background:${colors.get(r.label)}"></span>${esc(r.label)}</li>`).join('')}</ul>`;
    const totalCommits = repos.reduce((s2, r) => s2 + r.commitCount, 0);
    const authors = new Set(repos.flatMap(r => r.authors.map(a => a.name.toLowerCase())));
    return `${tiles([
        { label: 'Repositories', value: fmt(repos.length), sub: `${fmt(repos.filter(r => now - r.last < 90 * DAY).length)} active in the last 3 months` },
        { label: 'Commits (all repos)', value: fmt(totalCommits) },
        { label: 'People', value: fmt(authors.size), sub: 'distinct authors across repos' },
        { label: 'Most active', value: rows.slice().sort((a, b) => b.last - a.last)[0].label, sub: `last commit ${ago(Math.max(...repos.map(r => r.last)))}` },
      ])}
      ${card('Repositories', `<div class="table-scroll small"><table class="grid repo-table"><thead><tr>${head('Repository', 'label')}<th>Branch</th>${head('Commits', 'commitCount', 'num')}${head('Authors', 'authorCount', 'num')}${head('Last commit', 'last')}<th>Last 12 months</th>${head('Files', 'files', 'num')}<th class="num">Bus factor</th></tr></thead><tbody>
        ${rows.map(r => `<tr class="clickable ${r.label === sel ? 'sel' : ''} ${now - r.last > 180 * DAY ? 'stale' : ''}" data-repo="${esc(r.label)}" title="${esc(r.root)}">
          <td><span class="sw" style="background:${colors.get(r.label)}"></span><b>${esc(r.label)}</b>${r.remote ? `<div class="muted repo-remote">${esc(r.remote.replace(/^https?:\/\/|\.git$/g, ''))}</div>` : ''}</td>
          <td><code>${esc(r.branch || '–')}</code></td><td class="num">${fmt(r.commitCount)}</td><td class="num">${fmt(r.authorCount)}</td>
          <td>${ago(r.last)}</td><td class="repo-spark-cell" style="color:${colors.get(r.label)}">${spark(r)}</td>
          <td class="num">${fmt((r.selection || {}).files || 0)}</td><td class="num ${r.busFactor === 1 && r.authorCount > 1 ? 'dep-bad' : ''}">${fmt(r.busFactor)}</td></tr>`).join('')}
        </tbody></table></div>`, { sub: 'click a repository for its details · inactive for 6+ months = grey' })}
      ${card('Commits per month – all repositories', combined, { sub: 'last 12 months' })}
      <div class="repo-switch">${repos.map(r => `<button class="rant-chip ${r.label === sel ? 'on' : ''}" data-repo="${esc(r.label)}"><span class="sw" style="background:${colors.get(r.label)}"></span>${esc(r.label)}</button>`).join('')}</div>`;
  }

  function repoDetail(r) {
    {
      const age = r.first ? Math.max(1, Math.round((r.last - r.first) / 86400000)) : 0;
      const topAuthors = r.authors.slice(0, 12);
      const facts = [
        ['moon', `${pctStr(r.night, r.commitCount, 0)}`, 'Night-owl commits (00:00–04:59)'],
        ['sun', `${pctStr(r.weekend, r.commitCount, 0)}`, 'Weekend-warrior commits'],
        ['flame', `${r.streak} day${r.streak === 1 ? '' : 's'}`, `Longest daily commit streak${r.streakEnd ? ` (ended ${date(Date.parse(r.streakEnd))})` : ''}`],
        ['calendar', r.busiestDay ? `${r.busiestDay.count}` : '–', r.busiestDay ? `Commits on the busiest day, ${date(Date.parse(r.busiestDay.day))}` : 'Busiest day'],
        ['users', `${r.busFactor}`, 'Bus factor – authors behind 50% of all commits'],
        ['wrench', `${pctStr(r.fixes, r.commitCount, 0)}`, `of commits are fixes (${fmt(r.fixes)} commits mention fix / bug / typo / oops)`],
        ['eyeoff', fmt(r.lazy), 'Lazy commit messages (“wip”, “update”, “stuff”, “fix”…)'],
        ['pen', `${r.avgMsgLen} chars`, 'Average commit message length'],
      ];
      const msg = (label, c) => c ? `<div class="msg"><span class="muted">${label}</span> <code>${esc(c.hash)}</code> “${esc(c.subject)}” <span class="muted">– ${esc(c.author)}, ${date(c.time)}${c.ins || c.del ? `, +${fmt(c.ins)} / −${fmt(c.del)}` : ''}</span></div>` : '';
      return `<div class="repo">
        <h2 class="repo-title">${icon('repo')} ${esc(r.label || r.name)} <span class="sub">${esc(r.branch || '')}${r.remote ? ' · ' + esc(r.remote) : ''}</span></h2>
        ${tiles([
          { label: 'Commits', value: fmt(r.commitCount) + (r.truncated ? '+' : ''), sub: `${fmt(r.mergeCount)} merges` },
          { label: 'Contributors', value: fmt(r.authorCount) },
          { label: 'First commit', value: date(r.first) },
          { label: 'Last commit', value: date(r.last) },
          { label: 'Project age', value: `${fmt(age)} days`, sub: `${fmt(r.activeDays)} active days` },
          { label: 'Lines added / removed', html: `<span class="plus">+${compact(r.insertions)}</span> / <span class="minus">−${compact(r.deletions)}</span>` },
          { label: 'Branches · Tags', value: `${fmt(r.branchCount)} · ${fmt(r.tagCount)}` },
          { label: 'Commits / active day', value: r.activeDays ? (r.commitCount / r.activeDays).toFixed(1) : '0' },
        ])}
        <div class="grid-2">
          ${card('Commits per month', columns(r.months.map(m => ({ label: m.month, value: m.count, tip: `<b>${m.month}</b><br>${fmt(m.count)} commits` })), { maxLabels: 10 }))}
          ${card('When is code written?', heatmap(r.weekdayHour), { sub: 'Commits by weekday and hour (local time)' })}
          ${card('Top contributors (commits)', hbars(topAuthors.map(a => ({
            label: a.name, value: a.commits,
            tip: `<b>${esc(a.name)}</b><br>${fmt(a.commits)} commits (${pctStr(a.commits, r.commitCount)})<br>+${fmt(a.ins)} / −${fmt(a.del)} lines<br>${date(a.first)} – ${date(a.last)}`,
          }))))}
          ${card('Hotspots – most frequently changed files', hbars(r.hotspots.slice(0, 12).map(h => ({
            label: h.file, value: h.count, abs: h.abs, color: 'var(--s2)',
            tip: `<b>${esc(h.file)}</b><br>changed in ${fmt(h.count)} commits<br><i>click to open</i>`,
          }))))}
        </div>
        ${card('Git fun facts', `<div class="fun small">${facts.map(([i, b, t]) => `<div class="fun-item"><div class="fun-icon">${icon(i)}</div><div class="fun-big">${esc(b)}</div><div class="fun-text">${esc(t)}</div></div>`).join('')}</div>
          <div class="msgs">${msg('Shortest message:', r.shortest)}${msg('Longest message:', r.longest)}${msg('Biggest commit:', r.biggest)}</div>
          ${r.topWords.length ? `<div class="words"><span class="muted">Favourite commit words:</span> ${r.topWords.map(([w, c]) => `<span class="word" ${tipAttr(`${fmt(c)}×`)}>${esc(w)}</span>`).join(' ')}</div>` : ''}`)}
      </div>`;
    }
  }

  // ---------- ranking table ----------
  const COLS = [
    ['#', null, ''], ['File', 'path', ''], ['Language', 'lang', ''], ['Lines', 'lines', 'num'], ['Code', 'code', 'num'],
    ['Comments', 'comment', 'num'], ['Blank', 'blank', 'num'], ['Size', 'size', 'num'], ['Longest line', 'maxLine', 'num'], ['TODOs', 'todo', 'num'], ['Share', null, ''],
  ];
  function tableSection() {
    const langs = [...new Set(D.table.map(f => f.lang))].sort();
    return `<div class="table-tools">
        <input id="tfilter" type="text" placeholder="Filter by path…" value="${esc(table.filter)}" spellcheck="false">
        <select id="tlang"><option value="">All languages</option>${langs.map(l => `<option ${l === table.lang ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        ${(D.repos || []).length > 1 ? `<select id="trepo"><option value="">All repositories</option>${D.repos.map(r => `<option value="${esc(r.label)}" ${r.label === table.repo ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>` : ''}
        <span class="muted" id="tcount"></span>
      </div>
      <div class="table-scroll"><table class="grid ranking" id="ranking"></table></div>
      <div class="table-more" id="tmore"></div>`;
  }

  function renderTable() {
    const el = document.getElementById('ranking');
    if (!el) return;
    const q = table.filter.toLowerCase();
    let rows = D.table.filter(f => (!q || f.path.toLowerCase().includes(q) || (f.rootName || '').toLowerCase().includes(q)) && (!table.lang || f.lang === table.lang) && (!table.repo || f.repo === table.repo));
    const k = table.sort;
    rows.sort((a, b) => {
      const va = a[k], vb = b[k];
      if (typeof va === 'string') return va.localeCompare(vb) * table.dir;
      return ((va || 0) - (vb || 0)) * table.dir || b.lines - a.lines;
    });
    const maxLines = D.table.reduce((m, f) => Math.max(m, f.lines), 1);
    const total = rows.length;
    rows = rows.slice(0, table.limit);
    el.innerHTML = `<thead><tr>${COLS.map(([label, key, cls]) => `<th class="${cls} ${key ? 'sortable' : ''} ${key === k ? (table.dir > 0 ? 'asc' : 'desc') : ''}" ${key ? `data-sort="${key}"` : ''}>${label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((f, i) => `<tr class="clickable" data-abs="${esc(f.abs)}" title="Open ${esc(f.path)}">
        <td class="rank">${i + 1}</td>
        <td class="path">${f.repo ? `<span class="repo-tag">${esc(f.repo)}</span>` : ''}${D.multiRoot ? `<span class="muted">${esc(f.rootName)}/</span>` : ''}${esc(f.path)}</td>
        <td><span class="sw" style="background:${f.binary ? 'var(--s-other)' : colorOf(f.lang)}"></span>${esc(f.lang)}</td>
        <td class="num ${isTooLong(f) ? 'over' : ''}" ${isTooLong(f) ? `title="Longer than ${fmt(rantCfg().maxLines)} lines"` : ''}>${f.binary ? '<span class="muted">binary</span>' : f.skipped ? '<span class="muted">too large</span>' : fmt(f.lines)}</td>
        <td class="num">${fmt(f.code)}</td><td class="num">${fmt(f.comment)}</td><td class="num ${isTooAiry(f) ? 'over' : ''}" ${isTooAiry(f) ? `title="${blankPct(f).toFixed(1)}% blank lines"` : ''}>${fmt(f.blank)}</td>
        <td class="num">${bytes(f.size)}</td><td class="num">${fmt(f.maxLine)}</td><td class="num">${f.todo ? fmt(f.todo) : ''}</td>
        <td class="share"><span class="share-bar" style="width:${pct(f.lines, maxLines)}%;background:${colorOf(f.lang)}"></span></td>
      </tr>`).join('')}</tbody>`;
    document.getElementById('tcount').textContent = `${fmt(total)} files`;
    document.getElementById('tmore').innerHTML = total > table.limit
      ? `<button class="btn" id="showMore">Show ${fmt(Math.min(200, total - table.limit))} more</button> <button class="btn" id="showAll">Show all ${fmt(total)}</button>` : '';
  }

  // ---------- page ----------
  function render() {
    destroyGraphs();
    assignColors();
    const t = D.totals;
    app.innerHTML = `
      <header class="page-head">
        <div>
          <h1>${icon('chart', 'h1-ic')} Code Statistics <span class="ws">${esc(D.workspace || '')}</span></h1>
          <div class="muted">${D.projectRoot ? `project root <b>${esc(D.projectRoot)}</b> · ` : ''}${fmt(t.files)} files · ${fmt(t.lines)} lines · generated ${new Date(D.generated).toLocaleString()}</div>
        </div>
        <nav class="actions">
          <button class="btn" data-act="refresh" title="Recount with the same selection">${icon('refresh')} Refresh</button>
          <button class="btn" data-act="csv">${icon('download')} CSV</button>
          <button class="btn" data-act="json">${icon('download')} JSON</button>
          <button class="btn" data-act="pdf" title="Export a PDF report">${icon('pages')} PDF</button>
          <button class="btn" data-act="html" title="Export a standalone, interactive HTML report">${icon('code')} HTML</button>
          <button class="btn" data-act="maximize" title="Hide side bars and panels">${icon('maximize')} Maximize</button>
          <button class="btn" data-act="fullscreen" title="Toggle window full screen">${icon('screen')} Full screen</button>
        </nav>
      </header>
      <nav class="toc">
        <a href="#s-overview">Overview</a>${D.history ? '<a href="#s-trends">Trends</a>' : ''}<a href="#s-lang">Languages</a><a href="#s-files">Files</a>
        <a href="#s-fame">Hall of Fame</a>${D.dependencies ? '<a href="#s-deps">Dependencies</a>' : ''}${D.architecture ? '<a href="#s-arch">Architecture</a>' : ''}${D.health ? '<a href="#s-health">Code health</a>' : ''}${D.todos !== undefined || D.pinboard ? '<a href="#s-todo">TODOs</a>' : ''}${rantCfg().enabled ? '<a href="#s-rant">Code Rant</a>' : ''}<a href="#s-git">Git</a>${D.compare ? '<a href="#s-cmp">Branches</a>' : ''}${D.ownership ? '<a href="#s-own">Ownership</a>' : ''}<a href="#s-fun">Fun facts</a><a href="#s-ids">Words & connections</a><a href="#s-rank">Ranking</a><a href="#s-struct">Structure</a>
      </nav>
      <main>
        <h2 id="s-overview">Overview</h2>${gateHtml()}${overview()}
        ${window.LCTrends && D.history ? `<h2 id="s-trends">Trends</h2>${LCTrends.render(UI(), D)}` : ''}
        <h2 id="s-lang">Languages</h2>${languageSection()}
        <h2 id="s-files">Files & folders</h2>${filesSection()}
        <h2 id="s-fame">Hall of Fame</h2>${hallOfFame()}
        ${D.dependencies && window.LCDeps ? `<h2 id="s-deps">Dependencies, licenses & vulnerabilities</h2>${LCDeps.render(UI(), D)}` : ''}
        ${window.LCArch && D.architecture ? `<h2 id="s-arch">Architecture</h2>${LCArch.render(UI(), D)}` : ''}
        ${D.health && window.LCHealth ? `<h2 id="s-health">Code health</h2>${LCHealth.render(UI(), D)}` : ''}
        ${window.LCTodos && (D.todos !== undefined || D.pinboard) ? `<h2 id="s-todo">TODO tracker</h2>${window.LCPinboard ? LCPinboard.render(UI(), D) : ''}${D.todos !== undefined ? LCTodos.render(UI(), D) : ''}` : ''}
        ${rantSection()}
        <h2 id="s-git">Git</h2><div id="git-body">${gitSection()}</div>
        ${window.LCCompare && D.compare ? `<h2 id="s-cmp">Branch comparison</h2>${LCCompare.render(UI(), D)}` : ''}
        ${window.LCOwnership && D.ownership ? `<h2 id="s-own">Ownership</h2>${LCOwnership.render(UI(), D)}` : ''}
        <h2 id="s-fun">Fun facts</h2>${funSection()}
        <h2 id="s-ids">Words & connections</h2>
        <div class="grid-2">
          ${card('Word cloud of names in your code', identifierCloud())}
          ${card('Word web – most used words and the files that use them', D.wordGraph && D.wordGraph.words.length ? '<div id="wordweb" class="graph"></div>' : '<p class="muted">No identifiers found.</p>', { sub: 'drag, zoom, hover', tools: graphTools('wordweb') })}
        </div>
        ${card('File connections – who imports whom', importSection(), { sub: D.importGraph ? `${fmt(D.importGraph.edgeCount)} imports between ${fmt(D.importGraph.nodes.length)} files${D.importGraph.truncated ? ` (limit ${fmt(D.importGraph.limits ? D.importGraph.limits.maxNodes : 0)} nodes / ${fmt(D.importGraph.limits ? D.importGraph.limits.maxLinks : 0)} relations – linecounter.graphs.maxNodes / maxLinks)` : ''}` : '', tools: D.importGraph && D.importGraph.nodes.length ? `<span class="graph-tools"><button class="gbtn" data-graph="importgraph" data-gact="pause" title="Pause / resume">${icon('pause')}</button><button class="gbtn" data-graph="importgraph" data-gact="shake" title="Re-run the layout">${icon('shake')}</button><button class="gbtn" data-graph="importgraph" data-gact="reset" title="Fit to view">${icon('target')}</button></span>` : '' })}
        <h2 id="s-rank">File ranking</h2>${tableSection()}
        <h2 id="s-struct">Project structure</h2>
        ${card('Folders and files as a living graph', '<div id="structure" class="graph graph-tall"></div>', { sub: 'click a folder to collapse / expand · click a file to open it', tools: graphTools('structure') })}
      </main>`;
    renderTreemap();
    renderTable();
    if (D.dependencies && window.LCDeps) LCDeps.renderTable(UI(), D);
    initWordWeb();
    initImportGraph();
    initStructure();
  }

  // ---------- events ----------
  app.addEventListener('click', ev => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const act = t.closest('[data-act]');
    if (act) {
      const a = /** @type {HTMLElement} */ (act).dataset.act;
      if (a === 'pdf') { if (window.LCExport) LCExport.openDialog(UI()); return; }
      if (a === 'csv' || a === 'json' || a === 'licenses-csv' || a === 'html') vscode.postMessage({ type: 'export', format: a });
      else vscode.postMessage({ type: a });
      return;
    }
    const sort = t.closest('[data-sort]');
    if (sort) {
      const k = /** @type {HTMLElement} */ (sort).dataset.sort;
      if (table.sort === k) table.dir *= -1; else { table.sort = k; table.dir = ['path', 'lang'].includes(k) ? 1 : -1; }
      renderTable();
      return;
    }
    if (window.LCDeps && D.dependencies && LCDeps.handleClick(UI(), D, t)) { ev.preventDefault(); return; }
    if (window.LCHealth && D.health && LCHealth.handleClick(UI(), D, t)) { ev.preventDefault(); return; }
    if (window.LCArch && LCArch.handleClick(UI(), D, t)) { ev.preventDefault(); return; }
    if (window.LCPinboard && LCPinboard.handleClick(UI(), D, t)) { ev.preventDefault(); return; }
    if (window.LCTodos && LCTodos.handleClick(UI(), D, t)) { ev.preventDefault(); return; }
    if (window.LCCompare && LCCompare.handleClick(UI(), D, t)) { ev.preventDefault(); return; }
    const repoSort = t.closest('[data-repo-sort]');
    const repoPick = !repoSort && t.closest('[data-repo]');
    if (repoSort || repoPick) {
      if (repoSort) { const k2 = /** @type {HTMLElement} */ (repoSort).dataset.repoSort; gitState.dir = gitState.sort === k2 ? -gitState.dir : k2 === 'label' ? 1 : -1; gitState.sort = k2; }
      else gitState.repo = /** @type {HTMLElement} */ (repoPick).dataset.repo;
      const sec = document.getElementById('s-git');
      const wrap = document.getElementById('git-body');
      if (wrap) wrap.innerHTML = gitSection();
      if (repoPick) { const det = document.getElementById('repo-detail'); if (det) det.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else if (sec) sec.scrollIntoView({ block: 'start' });
      return;
    }
    if (t.closest('[data-trend-clear]')) { vscode.postMessage({ type: 'clearHistory', projectRoot: D.projectRoot || '' }); const s = document.getElementById('s-trends'); if (s && s.nextElementSibling) s.nextElementSibling.innerHTML = '<div class="card-body muted">History cleared.</div>'; return; }
    const gb = t.closest('[data-gact]');
    if (gb) {
      const g = graphs[/** @type {HTMLElement} */ (gb).dataset.graph];
      const a = /** @type {HTMLElement} */ (gb).dataset.gact;
      if (!g) return;
      if (a === 'pause') { const on = g.toggleRunning(); gb.innerHTML = icon(on ? 'pause' : 'play'); gb.classList.toggle('off', !on); }
      else if (a === 'motion') {
        const next = MOTIONS[(MOTIONS.indexOf(g.motion) + 1) % MOTIONS.length];
        g.setMotion(next);
        const lbl = gb.querySelector('span');
        if (lbl) lbl.textContent = MOTION_LABEL[next];
      }
      else if (a === 'shake') g.reheat();
      else if (a === 'reset') g.resetView();
      return;
    }
    const trainBtn = t.closest('[data-train]');
    if (trainBtn && window.LCTrain) { LCTrain.open(UI(), D, { selectedAbs: impSelected, mode: /** @type {HTMLElement} */ (trainBtn).dataset.train, functions: impFns }); return; }
    const impLayout = t.closest('[data-imp-layout]');
    if (impLayout && graphs.importgraph) {
      graphs.importgraph.setLayout(/** @type {HTMLElement} */ (impLayout).dataset.impLayout);
      impLayout.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b === impLayout));
      return;
    }
    const impFnBtn = t.closest('[data-imp-fns]');
    if (impFnBtn && graphs.importgraph) {
      impFns = !impFns;
      impFnBtn.classList.toggle('primary', impFns);
      clearImportHighlight();
      const d = importGraphData();
      impRecolor(d.nodes);
      graphs.importgraph.setData(d.nodes, d.links, true);
      return;
    }
    const impColor = t.closest('[data-imp-color]');
    if (impColor && graphs.importgraph) {
      impColorMode = /** @type {HTMLElement} */ (impColor).dataset.impColor;
      impColor.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b === impColor));
      graphs.importgraph.refreshColors();
      return;
    }
    const impCl = t.closest('[data-imp-cluster]');
    if (impCl && graphs.importgraph) {
      impClusters = graphs.importgraph.setClusters(!graphs.importgraph.clusters);
      impCl.classList.toggle('on', impClusters);
      return;
    }
    const impMotion = t.closest('[data-imp-motion]');
    if (impMotion && graphs.importgraph) {
      graphs.importgraph.setMotion(/** @type {HTMLElement} */ (impMotion).dataset.impMotion);
      impMotion.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b === impMotion));
      return;
    }
    const impCycle = t.closest('[data-imp-cycle]');
    const impChain = t.closest('[data-imp-chain]');
    if ((impCycle || impChain) && graphs.importgraph) {
      const G = D.importGraph;
      document.querySelectorAll('.imp-item.active').forEach(e => e.classList.remove('active'));
      const item = /** @type {HTMLElement} */ (impCycle || impChain);
      item.classList.add('active');
      if (impCycle) {
        const c = G.cycles[Number(item.dataset.impCycle)];
        highlightPath(c.cycle, c.files);
        setImpStatus(`<b style="color:${RED}">Circular import (${c.size} files):</b> ${pathHtml(c.cycle)} <button class="link" data-copy-text="${esc(c.cycle.map(f => f.path).join(' -> '))}">copy</button>`);
      } else {
        const c = G.chains[Number(item.dataset.impChain)];
        highlightPath(c.files);
        setImpStatus(`<b style="color:${RED}">Dependency chain (${c.length} files):</b> ${pathHtml(c.files)} <button class="link" data-copy-text="${esc(c.files.map(f => f.path).join(' -> '))}">copy</button>`);
      }
      return;
    }
    const impNode = t.closest('[data-imp-node]');
    if (impNode && graphs.importgraph) {
      const i = graphs.importgraph.nodeIndex(/** @type {HTMLElement} */ (impNode).dataset.impNode);
      if (i >= 0) selectImportNode(i, true);
      return;
    }
    if (t.id === 'impClear' || t.closest('#impClear')) { clearImportHighlight(); const f = /** @type {HTMLInputElement} */ (document.getElementById('impFind')); if (f) f.value = ''; return; }
    const openAbs = t.closest('[data-open-abs]');
    if (openAbs) { const o = /** @type {HTMLElement} */ (openAbs); vscode.postMessage({ type: 'open', abs: o.dataset.openAbs, line: o.dataset.openLine ? Number(o.dataset.openLine) : undefined }); return; }
    const copyText = t.closest('[data-copy-text]');
    if (copyText) {
      const text = /** @type {HTMLElement} */ (copyText).dataset.copyText;
      vscode.postMessage({ type: 'copy', text });
      showToast(`${icon('copy')} Copied path`);
      return;
    }
    const fsBtn = t.closest('[data-fs]');
    if (fsBtn) { toggleCardFullscreen(/** @type {HTMLElement} */ (fsBtn.closest('.card'))); return; }
    const rantLv = t.closest('[data-rant-lv]');
    if (rantLv) {
      const [kind, lv] = /** @type {HTMLElement} */ (rantLv).dataset.rantLv.split(':');
      rantLevelFilter[kind] = Number(lv);
      rantShowAll[kind] = false;
      document.getElementById('rant-' + kind).innerHTML = rantList(kind);
      return;
    }
    const rantAll = t.closest('[data-rant-all]');
    if (rantAll) {
      const kind = /** @type {HTMLElement} */ (rantAll).dataset.rantAll;
      rantShowAll[kind] = true;
      document.getElementById('rant-' + kind).innerHTML = rantList(kind);
      return;
    }
    if (t.id === 'showMore') { table.limit += 200; renderTable(); return; }
    if (t.id === 'showAll') { table.limit = Infinity; renderTable(); return; }
    const toc = t.closest('.toc a');
    if (toc) {
      ev.preventDefault();
      const target = document.querySelector(/** @type {HTMLAnchorElement} */ (toc).getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const open = t.closest('[data-abs]');
    if (open) {
      ev.preventDefault();
      const o = /** @type {HTMLElement} */ (open);
      if (o.classList.contains('deleted')) return;
      if (o.dataset.copy) { copyPath(o.dataset.abs); return; }
      vscode.postMessage({ type: 'open', abs: o.dataset.abs, line: o.dataset.line ? Number(o.dataset.line) : undefined });
    }
  });
  app.addEventListener('dblclick', ev => {
    const o = /** @type {HTMLElement} */ (ev.target).closest('[data-copy]');
    if (o && !o.classList.contains('deleted')) vscode.postMessage({ type: 'open', abs: /** @type {HTMLElement} */ (o).dataset.abs });
  });

  // ---------- card full screen ----------
  function toggleCardFullscreen(cardEl, force) {
    if (!cardEl) return;
    const on = force !== undefined ? force : !cardEl.classList.contains('fs');
    document.querySelectorAll('.card.fs').forEach(c => { if (c !== cardEl) setFs(c, false); });
    setFs(cardEl, on);
    document.body.classList.toggle('has-fs', on);
    if (cardEl.querySelector('#treemap')) requestAnimationFrame(renderTreemap);
  }
  function setFs(cardEl, on) {
    cardEl.classList.toggle('fs', on);
    const b = cardEl.querySelector('[data-fs]');
    if (b) { b.innerHTML = icon(on ? 'minimize' : 'maximize'); b.title = on ? 'Exit full screen (Esc)' : 'Show in full screen (Esc to close)'; }
  }
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (menu.style.display === 'block') { hideMenu(); return; }
    const fs = document.querySelector('.card.fs');
    if (fs) toggleCardFullscreen(/** @type {HTMLElement} */ (fs), false);
  });

  // ---------- context menu, copy, delete ----------
  const menu = document.createElement('div');
  menu.id = 'ctxmenu';
  document.body.appendChild(menu);
  const toast = document.createElement('div');
  toast.id = 'toast';
  document.body.appendChild(toast);
  let toastTimer = 0;
  function showToast(html) {
    toast.innerHTML = html;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function copyPath(abs, relative) {
    const f = D.table.find(x => x.abs === abs);
    const text = relative && f ? f.path : abs;
    vscode.postMessage({ type: 'copy', text });
    showToast(`${icon('copy')} Copied <b>${esc(text)}</b>`);
  }
  function hideMenu() { menu.style.display = 'none'; }
  document.addEventListener('contextmenu', ev => {
    const o = /** @type {HTMLElement} */ (ev.target).closest && /** @type {HTMLElement} */ (ev.target).closest('[data-abs]');
    if (!o || o.classList.contains('deleted')) { hideMenu(); return; }
    ev.preventDefault();
    ev.stopPropagation();
    openMenu(/** @type {HTMLElement} */ (o).dataset.abs, ev.clientX, ev.clientY);
  });
  function openMenu(abs, cx, cy) {
    tip.style.display = 'none';
    const f = D.table.find(x => x.abs === abs);
    menu.dataset.abs = abs;
    menu.innerHTML = `<div class="ctx-title">${esc(f ? f.path : abs)}</div>
      <button data-menu="open">${icon('open')} Open file</button>
      <button data-menu="copy">${icon('copy')} Copy path</button>
      ${f ? `<button data-menu="copyrel">${icon('copy')} Copy relative path</button>` : ''}
      <button data-menu="reveal">${icon('folder')} Reveal in file manager</button>
      <div class="ctx-sep"></div>
      <button data-menu="delete" class="danger">${icon('trash')} Delete file…</button>`;
    menu.style.display = 'block';
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(cx, window.innerWidth - r.width - 6) + 'px';
    menu.style.top = Math.min(cy, window.innerHeight - r.height - 6) + 'px';
  }
  menu.addEventListener('click', ev => {
    const b = /** @type {HTMLElement} */ (ev.target).closest('[data-menu]');
    if (!b) return;
    const abs = menu.dataset.abs;
    const act = /** @type {HTMLElement} */ (b).dataset.menu;
    hideMenu();
    if (act === 'open') vscode.postMessage({ type: 'open', abs });
    else if (act === 'copy') copyPath(abs);
    else if (act === 'copyrel') copyPath(abs, true);
    else if (act === 'reveal') vscode.postMessage({ type: 'reveal', abs });
    else if (act === 'delete') vscode.postMessage({ type: 'delete', abs });
  });
  document.addEventListener('mousedown', ev => {
    if (menu.style.display === 'block' && !menu.contains(/** @type {Node} */ (ev.target))) hideMenu();
  });
  window.addEventListener('blur', hideMenu);
  document.addEventListener('scroll', hideMenu, true);

  function markDeleted(abs) {
    const f = D.table.find(x => x.abs === abs);
    D.table = D.table.filter(x => x.abs !== abs);
    document.querySelectorAll('[data-abs]').forEach(el => {
      if (/** @type {HTMLElement} */ (el).dataset.abs === abs) el.classList.add('deleted');
    });
    if (treemap) treemap.remove(abs);
    renderTable();
    for (const kind of ['long', 'blank']) {
      const el = document.getElementById('rant-' + kind);
      if (el) el.innerHTML = rantList(kind);
    }
    showToast(`${icon('trash')} Deleted <b>${esc(f ? f.path : abs)}</b> – press Refresh to recalculate all statistics`);
  }
  let gsearchTimer = 0;
  app.addEventListener('input', ev => {
    const t = /** @type {HTMLInputElement} */ (ev.target);
    if (t.dataset && t.dataset.graphSearch) {
      clearTimeout(gsearchTimer);
      const id = t.dataset.graphSearch;
      gsearchTimer = setTimeout(() => {
        if (id === 'structure') revealInStructure(t.value);
        const g = graphs[id];
        if (!g) return;
        const hits = g.search(t.value);
        t.classList.toggle('nohit', !!t.value.trim() && !hits.length);
        t.title = t.value.trim() ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'Highlight matching nodes and zoom to them';
      }, 200);
      return;
    }
    if (t.id === 'tfilter') { table.filter = t.value; table.limit = 100; renderTable(); }
    if (window.LCDeps && D.dependencies) LCDeps.handleInput(UI(), D, t);
    if (window.LCHealth && D.health) LCHealth.handleInput(UI(), D, t);
    if (window.LCPinboard && LCPinboard.handleInput(UI(), D, t)) return;
    if (window.LCTodos) LCTodos.handleInput(UI(), D, t);
  });
  app.addEventListener('change', ev => {
    const t = /** @type {HTMLSelectElement} */ (ev.target);
    if (t.id === 'tlang') { table.lang = t.value; table.limit = 100; renderTable(); }
    if (t.id === 'trepo') { table.repo = t.value; table.limit = 100; renderTable(); }
    if (window.LCDeps && D.dependencies && t.id !== 'depQ') LCDeps.handleInput(UI(), D, t);
  });

  // tooltip
  document.addEventListener('mouseover', ev => {
    const el = /** @type {HTMLElement} */ (ev.target).closest && /** @type {HTMLElement} */ (ev.target).closest('[data-tip]');
    if (!el) { tip.style.display = 'none'; return; }
    tip.innerHTML = /** @type {HTMLElement} */ (el).dataset.tip;
    tip.style.display = 'block';
  });
  document.addEventListener('mousemove', ev => {
    if (tip.style.display === 'block') positionTip(ev);
  });
  document.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderTreemap, 150);
  });

  window.addEventListener('message', ev => {
    if (ev.data.type === 'data') {
      D = ev.data.data;
      document.body.classList.remove('has-fs');
      render();
    } else if (ev.data.type === 'deleted') {
      markDeleted(ev.data.abs);
    } else if (ev.data.type === 'compareResult' && window.LCCompare) {
      LCCompare.show(UI(), D, ev.data.result);
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
