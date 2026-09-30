// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const tip = document.getElementById('tooltip');

  /** @type {any} */ let D = null;
  let langColor = new Map();
  const table = { sort: 'lines', dir: -1, filter: '', lang: '', limit: 100 };

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

  // Categorical slots follow the entity (language), never the rank on a given chart.
  const SLOTS = 7;
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
      <header><h3>${title}</h3>${opts.sub ? `<span class="sub">${opts.sub}</span>` : ''}</header>
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
        return `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" style="stroke:${it.color}" stroke-width="${R - r}" class="hit" ${tipAttr(`<b>${esc(it.label)}</b><br>${fmt(it.value)} (100%)`)}/>`;
      }
      const large = e - s > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${(C + rad * Math.cos(ang)).toFixed(2)} ${(C + rad * Math.sin(ang)).toFixed(2)}`;
      const d = `M${p(R, s)} A${R} ${R} 0 ${large} 1 ${p(R, e)} L${p(r, e)} A${r} ${r} 0 ${large} 0 ${p(r, s)}Z`;
      return `<path d="${d}" style="fill:${it.color}" class="hit" ${tipAttr(`<b>${esc(it.label)}</b><br>${fmt(it.value)} · ${pctStr(it.value, total)}`)}/>`;
    }).join('');
    const legend = items.map(it => `<li ${tipAttr(`<b>${esc(it.label)}</b><br>${fmt(it.value)} · ${pctStr(it.value, total)}`)}>
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
      <div class="hbar ${it.abs ? 'clickable' : ''}" ${it.abs ? `data-abs="${esc(it.abs)}"` : ''} ${tipAttr(it.tip || `<b>${esc(it.label)}</b><br>${fmt(it.value)}`)}>
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
  function squarify(items, x, y, w, h) {
    const out = [];
    const total = items.reduce((s, i) => s + i.value, 0);
    if (!total || w <= 0 || h <= 0) return out;
    const scale = (w * h) / total;
    const nodes = items.map(i => ({ ...i, area: i.value * scale }));
    let row = [];
    const worst = (r, side) => {
      const s = r.reduce((a, n) => a + n.area, 0);
      let mx = 0, mn = Infinity;
      for (const n of r) { mx = Math.max(mx, n.area); mn = Math.min(mn, n.area); }
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    const layoutRow = (r) => {
      const s = r.reduce((a, n) => a + n.area, 0);
      if (w >= h) {
        const cw = s / h; let cy = y;
        for (const n of r) { const ch = n.area / cw; out.push({ ...n, x, y: cy, w: cw, h: ch }); cy += ch; }
        x += cw; w -= cw;
      } else {
        const ch = s / w; let cx = x;
        for (const n of r) { const cw = n.area / ch; out.push({ ...n, x: cx, y, w: cw, h: ch }); cx += cw; }
        y += ch; h -= ch;
      }
    };
    for (const n of nodes) {
      const side = Math.min(w, h);
      if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
      else { layoutRow(row); row = [n]; }
    }
    if (row.length) layoutRow(row);
    return out;
  }

  function renderTreemap() {
    const el = document.getElementById('treemap');
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    const files = D.table.filter(f => f.lines > 0).sort((a, b) => b.lines - a.lines);
    const MAXN = 400;
    const shown = files.slice(0, MAXN);
    const rest = files.slice(MAXN).reduce((s, f) => s + f.lines, 0);
    const items = shown.map(f => ({ value: f.lines, f }));
    if (rest) items.push({ value: rest, rest: files.length - MAXN });
    const rects = squarify(items, 0, 0, W, H);
    el.innerHTML = rects.map(r => {
      const big = r.w > 70 && r.h > 28;
      if (r.rest) {
        return `<div class="tm" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:var(--s-other)" ${tipAttr(`<b>${r.rest} smaller files</b><br>${fmt(r.value)} lines`)}>${big ? `<span>${r.rest} more…</span>` : ''}</div>`;
      }
      const f = r.f;
      const name = f.path.split('/').pop();
      return `<div class="tm clickable" data-abs="${esc(f.abs)}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${colorOf(f.lang)}"
        ${tipAttr(`<b>${esc(f.path)}</b><br>${esc(f.lang)} · ${fmt(f.lines)} lines · ${bytes(f.size)}<br><i>click to open</i>`)}>${big ? `<span>${esc(name)}</span>` : ''}</div>`;
    }).join('');
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
      { name: 'Comments', color: 'var(--s3)' },
      { name: 'Blank', color: 'var(--s-other)' },
    ];
    const rows = D.languages.filter(l => l.lines > 0).slice(0, 14).map(l => ({
      label: l.key, parts: [
        { name: 'Code', value: l.code, color: 'var(--s1)' },
        { name: 'Comments', value: l.comment, color: 'var(--s3)' },
        { name: 'Blank', value: l.blank, color: 'var(--s-other)' },
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
        { label: 'Comments', value: t.comment, color: 'var(--s3)' },
        { label: 'Blank', value: t.blank, color: 'var(--s-other)' },
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
      <ul class="legend inline">${[...langColor.entries()].map(([l, c]) => `<li><span class="sw" style="background:${c}"></span>${esc(l)}</li>`).join('')}<li><span class="sw" style="background:var(--s-other)"></span>Other</li></ul>`, { sub: 'Click a file to open it' })}
    <div class="grid-2">
      ${card('Largest files (lines)', hbars(top.map(f => ({ label: f.path, value: f.lines, color: colorOf(f.lang), abs: f.abs, tip: `<b>${esc(f.path)}</b><br>${esc(f.lang)} · ${fmt(f.lines)} lines<br><i>click to open</i>` }))), { sub: 'Colored by language' })}
      ${card('Largest files (bytes)', hbars(topSize.map(f => ({ label: f.path, value: f.size, valueLabel: bytes(f.size), color: f.binary ? 'var(--s-other)' : colorOf(f.lang), abs: f.abs, tip: `<b>${esc(f.path)}</b><br>${bytes(f.size)}<br><i>click to open</i>` }))))}
      ${card('Top folders (lines)', hbars(folders.map(f => ({ label: f.key, value: f.lines, tip: `<b>${esc(f.key)}</b><br>${fmt(f.lines)} lines · ${fmt(f.files)} files · ${bytes(f.size)}` }))))}
      ${card('File extensions (file count)', hbars(exts.slice().sort((a, b) => b.files - a.files).map(e => ({ label: e.key, value: e.files, tip: `<b>${esc(e.key)}</b><br>${fmt(e.files)} files · ${fmt(e.lines)} lines` }))))}
      ${card('File length distribution', columns(D.histogram.map(h => ({ label: h.label, value: h.count, tip: `<b>${h.label} lines</b><br>${fmt(h.count)} files` }))), { sub: 'Number of files per line-count bucket' })}
      ${card('Last modified', columns(D.ages.map(h => ({ label: h.label, value: h.count, tip: `<b>${h.label}</b><br>${fmt(h.count)} files` })), { color: 'var(--s2)' }), { sub: 'Files by modification time' })}
    </div>`;
  }

  function hallOfFame() {
    const r = D.records;
    const items = [
      ['🏔️', 'Longest file', r.longestFile, r.longestFile && `${fmt(r.longestFile.lines)} lines`],
      ['🐘', 'Heaviest file', r.biggestFile, r.biggestFile && bytes(r.biggestFile.size)],
      ['📏', 'Longest line', r.longestLine, r.longestLine && `${fmt(r.longestLine.maxLine)} chars in line ${r.longestLine.maxLineNo}`, r.longestLine && r.longestLine.maxLineNo],
      ['🐜', 'Tiniest file', r.smallestFile, r.smallestFile && `${fmt(r.smallestFile.lines)} line${r.smallestFile.lines === 1 ? '' : 's'}`],
      ['🕳️', 'Deepest nested', r.deepestFile, r.deepestFile && `${r.deepestFile.depth} folders deep`],
      ['🐍', 'Longest file name', r.longestName, r.longestName && `${r.longestName.nameLen} characters`],
      ['📝', 'Most TODOs', r.mostTodos, r.mostTodos && `${r.mostTodos.count} TODO / FIXME / HACK`],
      ['📖', 'Best commented', r.mostCommented, r.mostCommented && `${(r.mostCommented.ratio * 100).toFixed(0)}% comments`],
      ['🆕', 'Most recently changed', r.newestFile, r.newestFile && date(r.newestFile.mtime ?? D.table.find(f => f.abs === r.newestFile.abs)?.mtime)],
      ['🦖', 'Untouched the longest', r.oldestFile, r.oldestFile && date(D.table.find(f => f.abs === r.oldestFile.abs)?.mtime)],
    ].filter(i => i[2]);
    return `<div class="fame">${items.map(([icon, title, f, detail, line]) => `
      <div class="fame-item"><span class="fame-icon">${icon}</span><div>
        <div class="fame-title">${title}</div>
        <div class="fame-file">${fileLink(f, f.path, line)}</div>
        <div class="fame-detail">${esc(detail)}</div></div></div>`).join('')}</div>`;
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
    const air = blankRatio > 20 ? 'Airy – your code can breathe 🌬️' : blankRatio > 10 ? 'Cozy – just right 🛋️' : 'Cramped – open a window! 🥵';
    const tabWin = t.tabIndent === t.spaceIndent ? 'It’s a tie. Peace in our time.' : t.tabIndent > t.spaceIndent ? 'Team Tabs wins ⇥' : 'Team Spaces wins ␣';
    const distance = meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(0)} m`;
    const eiffel = meters / 330;
    const oldest = (D.repos || []).reduce((m, r) => (r.first && (!m || r.first < m) ? r.first : m), null);

    const facts = [
      ['📄', `${fmt(Math.ceil(pages))} pages`, `If you printed everything (50 lines/page), the stack would be <b>${(pages * 0.01).toFixed(1)} cm</b> high.`],
      ['📏', distance, `All characters in one single line (2.5 mm each) – that’s <b>${eiffel.toFixed(1)}×</b> the Eiffel Tower${meters > 42195 ? ' or more than a marathon! 🏃' : ''}.`],
      ['⌨️', dur(typingHours), 'Time to type it all again at 40 words per minute – without a single typo.'],
      ['📚', `${potter.toFixed(2)} × Harry Potter`, `${fmt(t.words)} words ≈ ${dur(readingHours)} of reading (Philosopher’s Stone has 76,944 words).`],
      ['☕', `${fmt(Math.round(coffee))} cups`, 'Estimated coffee consumption (scientifically proven rate: 1 cup per 100 lines of code).'],
      ['💰', `${effort.toFixed(1)} person-months`, `Basic COCOMO estimate – about ${schedule.toFixed(1)} months with ${schedule ? (effort / schedule).toFixed(1) : 0} developers, ≈ €${fmt(Math.round(effort * 6000))}.`],
      ['🤬', `${wtfPerK.toFixed(1)} WTF/kLOC`, `The only valid code quality metric. ${fmt(wtf)} TODOs, FIXMEs, HACKs & “magic” comments found.`],
      ['📖', `Grade ${grade}`, `Documentation grade: ${commentRatio.toFixed(1)}% of non-blank lines are comments.`],
      ['🫁', `${blankRatio.toFixed(1)}% blank`, air],
      ['⚔️', tabWin, `${fmt(t.tabIndent)} lines indented with tabs vs. ${fmt(t.spaceIndent)} with spaces.`],
      ['🐛', fmt(t.debugPrints), 'Debug prints (console.log, print, printf…) – some of them are surely still needed…'],
      ['😶', fmt(t.semicolons), `Semicolons. Plus ${fmt(t.braces)} curly braces and ${fmt(t.parens)} parentheses.`],
      ['🧹', fmt(t.trailing), 'Lines with trailing whitespace – invisible, but they are there.'],
      ['🌌', fmt(t.fortyTwo), 'Occurrences of 42 – the answer to life, the universe and everything.'],
      ['😀', fmt(t.emojis), 'Emojis hidden in your files.'],
      ['🐦', fmt(Math.ceil(t.chars / 280)), 'Tweets needed to post the whole code base (280 chars each).'],
      ['💾', fmt(Math.ceil(D.totals.size / 1474560)), 'Floppy disks (1.44 MB) required for a backup, 1995 style.'],
      ...(oldest ? [['🦕', `${fmt(Math.floor((Date.now() - oldest) / 86400000))} days`, `Age of the project – first commit on ${date(oldest)}.`]] : []),
    ];
    return `<div class="fun">${facts.map(([icon, big, text]) => `
      <div class="fun-item"><div class="fun-icon">${icon}</div><div class="fun-big">${esc(big)}</div><div class="fun-text">${text}</div></div>`).join('')}</div>`;
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
    return repos.map(r => {
      const age = r.first ? Math.max(1, Math.round((r.last - r.first) / 86400000)) : 0;
      const topAuthors = r.authors.slice(0, 12);
      const facts = [
        ['🦉', `${pctStr(r.night, r.commitCount, 0)}`, 'Night-owl commits (00:00–04:59)'],
        ['🏖️', `${pctStr(r.weekend, r.commitCount, 0)}`, 'Weekend-warrior commits'],
        ['🔥', `${r.streak} day${r.streak === 1 ? '' : 's'}`, `Longest daily commit streak${r.streakEnd ? ` (ended ${date(Date.parse(r.streakEnd))})` : ''}`],
        ['📅', r.busiestDay ? `${r.busiestDay.count}` : '–', r.busiestDay ? `Commits on the busiest day, ${date(Date.parse(r.busiestDay.day))}` : 'Busiest day'],
        ['🚌', `${r.busFactor}`, 'Bus factor – authors behind 50% of all commits'],
        ['🔧', `${pctStr(r.fixes, r.commitCount, 0)}`, `of commits are fixes (${fmt(r.fixes)} commits mention fix / bug / typo / oops)`],
        ['🙈', fmt(r.lazy), 'Lazy commit messages (“wip”, “update”, “stuff”, “fix”…)'],
        ['✍️', `${r.avgMsgLen} chars`, 'Average commit message length'],
      ];
      const msg = (label, c) => c ? `<div class="msg"><span class="muted">${label}</span> <code>${esc(c.hash)}</code> “${esc(c.subject)}” <span class="muted">– ${esc(c.author)}, ${date(c.time)}${c.ins || c.del ? `, +${fmt(c.ins)} / −${fmt(c.del)}` : ''}</span></div>` : '';
      return `<div class="repo">
        <h2 class="repo-title">📦 ${esc(r.name)} <span class="sub">${esc(r.branch || '')}${r.remote ? ' · ' + esc(r.remote) : ''}</span></h2>
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
        ${card('Git fun facts', `<div class="fun small">${facts.map(([i, b, t]) => `<div class="fun-item"><div class="fun-icon">${i}</div><div class="fun-big">${esc(b)}</div><div class="fun-text">${esc(t)}</div></div>`).join('')}</div>
          <div class="msgs">${msg('Shortest message:', r.shortest)}${msg('Longest message:', r.longest)}${msg('Biggest commit:', r.biggest)}</div>
          ${r.topWords.length ? `<div class="words"><span class="muted">Favourite commit words:</span> ${r.topWords.map(([w, c]) => `<span class="word" ${tipAttr(`${fmt(c)}×`)}>${esc(w)}</span>`).join(' ')}</div>` : ''}`)}
      </div>`;
    }).join('');
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
        <span class="muted" id="tcount"></span>
      </div>
      <div class="table-scroll"><table class="grid ranking" id="ranking"></table></div>
      <div class="table-more" id="tmore"></div>`;
  }

  function renderTable() {
    const el = document.getElementById('ranking');
    if (!el) return;
    const q = table.filter.toLowerCase();
    let rows = D.table.filter(f => (!q || f.path.toLowerCase().includes(q) || (f.rootName || '').toLowerCase().includes(q)) && (!table.lang || f.lang === table.lang));
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
        <td class="path">${D.multiRoot ? `<span class="muted">${esc(f.rootName)}/</span>` : ''}${esc(f.path)}</td>
        <td><span class="sw" style="background:${f.binary ? 'var(--s-other)' : colorOf(f.lang)}"></span>${esc(f.lang)}</td>
        <td class="num">${f.binary ? '<span class="muted">binary</span>' : f.skipped ? '<span class="muted">too large</span>' : fmt(f.lines)}</td>
        <td class="num">${fmt(f.code)}</td><td class="num">${fmt(f.comment)}</td><td class="num">${fmt(f.blank)}</td>
        <td class="num">${bytes(f.size)}</td><td class="num">${fmt(f.maxLine)}</td><td class="num">${f.todo ? fmt(f.todo) : ''}</td>
        <td class="share"><span class="share-bar" style="width:${pct(f.lines, maxLines)}%;background:${colorOf(f.lang)}"></span></td>
      </tr>`).join('')}</tbody>`;
    document.getElementById('tcount').textContent = `${fmt(total)} files`;
    document.getElementById('tmore').innerHTML = total > table.limit
      ? `<button class="btn" id="showMore">Show ${fmt(Math.min(200, total - table.limit))} more</button> <button class="btn" id="showAll">Show all ${fmt(total)}</button>` : '';
  }

  // ---------- page ----------
  function render() {
    assignColors();
    const t = D.totals;
    app.innerHTML = `
      <header class="page-head">
        <div>
          <h1>📊 Code Statistics <span class="ws">${esc(D.workspace || '')}</span></h1>
          <div class="muted">${fmt(t.files)} files · ${fmt(t.lines)} lines · generated ${new Date(D.generated).toLocaleString()}</div>
        </div>
        <nav class="actions">
          <button class="btn" data-act="refresh" title="Recount with the same selection">⟳ Refresh</button>
          <button class="btn" data-act="csv">⤓ CSV</button>
          <button class="btn" data-act="json">⤓ JSON</button>
          <button class="btn" data-act="maximize" title="Hide side bars and panels">⤢ Maximize</button>
          <button class="btn" data-act="fullscreen" title="Toggle window full screen">⛶ Full screen</button>
        </nav>
      </header>
      <nav class="toc">
        <a href="#s-overview">Overview</a><a href="#s-lang">Languages</a><a href="#s-files">Files</a>
        <a href="#s-fame">Hall of Fame</a><a href="#s-git">Git</a><a href="#s-fun">Fun facts</a><a href="#s-ids">Identifiers</a><a href="#s-rank">Ranking</a>
      </nav>
      <main>
        <h2 id="s-overview">Overview</h2>${overview()}
        <h2 id="s-lang">Languages</h2>${languageSection()}
        <h2 id="s-files">Files & folders</h2>${filesSection()}
        <h2 id="s-fame">Hall of Fame</h2>${hallOfFame()}
        <h2 id="s-git">Git</h2>${gitSection()}
        <h2 id="s-fun">Fun facts</h2>${funSection()}
        <h2 id="s-ids">Most used identifiers</h2>${card('Word cloud of names in your code', identifierCloud())}
        <h2 id="s-rank">File ranking</h2>${tableSection()}
      </main>`;
    renderTreemap();
    renderTable();
  }

  // ---------- events ----------
  app.addEventListener('click', ev => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const act = t.closest('[data-act]');
    if (act) {
      const a = /** @type {HTMLElement} */ (act).dataset.act;
      if (a === 'csv' || a === 'json') vscode.postMessage({ type: 'export', format: a });
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
      vscode.postMessage({ type: 'open', abs: o.dataset.abs, line: o.dataset.line ? Number(o.dataset.line) : undefined });
    }
  });
  app.addEventListener('input', ev => {
    const t = /** @type {HTMLInputElement} */ (ev.target);
    if (t.id === 'tfilter') { table.filter = t.value; table.limit = 100; renderTable(); }
  });
  app.addEventListener('change', ev => {
    const t = /** @type {HTMLSelectElement} */ (ev.target);
    if (t.id === 'tlang') { table.lang = t.value; table.limit = 100; renderTable(); }
  });

  // tooltip
  document.addEventListener('mouseover', ev => {
    const el = /** @type {HTMLElement} */ (ev.target).closest && /** @type {HTMLElement} */ (ev.target).closest('[data-tip]');
    if (!el) { tip.style.display = 'none'; return; }
    tip.innerHTML = /** @type {HTMLElement} */ (el).dataset.tip;
    tip.style.display = 'block';
  });
  document.addEventListener('mousemove', ev => {
    if (tip.style.display !== 'block') return;
    const pad = 14;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
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
      render();
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
