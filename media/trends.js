// @ts-check
// "Trends" section: key numbers of every run over time (history snapshots) and the changes since the last run.
(function () {
  // better = which direction is good (1 = up is good, -1 = down is good, 0 = neutral)
  const METRICS = [
    { key: 'lines', label: 'Lines', better: 0 },
    { key: 'code', label: 'Code lines', better: 0 },
    { key: 'files', label: 'Files', better: 0 },
    { key: 'functions', label: 'Functions', better: 0 },
    { key: 'score', label: 'Health score', better: 1 },
    { key: 'avgComplexity', label: 'Avg. complexity', better: -1, digits: 2 },
    { key: 'overComplex', label: 'Too complex functions', better: -1 },
    { key: 'duplicated', label: 'Duplicated code %', better: -1, digits: 1 },
    { key: 'deadCode', label: 'Unused functions', better: -1 },
    { key: 'todo', label: 'TODO / FIXME / HACK', better: -1 },
    { key: 'vulns', label: 'Vulnerabilities', better: -1 },
    { key: 'licenseProblems', label: 'Problematic licenses', better: -1 },
    { key: 'secrets', label: 'Secrets', better: -1 },
    { key: 'cycles', label: 'Circular imports', better: -1 },
    { key: 'packages', label: 'Packages', better: 0 },
    { key: 'commits', label: 'Commits', better: 0 },
  ];

  function spark(ui, list, m) {
    const { esc, fmt, tipAttr } = ui;
    const pts = list.map(s => ({ t: s.t, v: s[m.key] })).filter(p => p.v != null);
    if (pts.length < 2) return '';
    const W = 260, H = 70, P = 6;
    const vs = pts.map(p => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi === lo) { hi += 1; lo -= 1; }
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const x = t => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
    const y = v => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
    const line = pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${P},${H - P} ${line} ${W - P},${H - P}`;
    const first = pts[0].v, last = pts[pts.length - 1].v;
    const delta = last - first;
    const good = m.better === 0 || delta === 0 ? 'neutral' : (delta > 0) === (m.better > 0) ? 'good' : 'bad';
    const f = v => (m.digits ? Number(v).toFixed(m.digits) : fmt(v));
    return `<div class="tr-card ${good}">
      <div class="tr-head"><span class="tr-label">${esc(m.label)}</span><span class="tr-val">${f(last)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="tr-spark" preserveAspectRatio="none">
        <polygon points="${area}" class="tr-area"/>
        <polyline points="${line}" class="tr-line"/>
        ${pts.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3" class="tr-dot" ${tipAttr(`<b>${esc(m.label)}: ${f(p.v)}</b><br>${new Date(p.t).toLocaleString()}`)}/>`).join('')}
      </svg>
      <div class="tr-foot muted">${delta === 0 ? 'unchanged' : `${delta > 0 ? '+' : ''}${f(delta)}`} since ${new Date(t0).toLocaleDateString()} · ${pts.length} runs</div>
    </div>`;
  }

  function render(ui, D) {
    const { esc, fmt, card } = ui;
    const list = D.history || [];
    if (!list.length) return card('Trends', '<p class="muted">History is off (<code>locomotive.history.enabled</code>).</p>');
    if (list.length < 2) return card('Trends', `<p class="muted">This is the first run for this ${D.projectRoot ? 'project root' : 'workspace'}. Create the statistics again later (or after some commits) and you'll see how lines, complexity, health score, vulnerabilities and more develop over time.</p>`);
    const prev = list[list.length - 2], cur = list[list.length - 1];
    const chips = METRICS.map(m => {
      const a = prev[m.key], b = cur[m.key];
      if (a == null || b == null || a === b) return '';
      const d = b - a;
      const cls = m.better === 0 ? 'neutral' : (d > 0) === (m.better > 0) ? 'good' : 'bad';
      return `<span class="tr-chip ${cls}">${esc(m.label)} <b>${d > 0 ? '+' : ''}${m.digits ? d.toFixed(m.digits) : fmt(d)}</b></span>`;
    }).filter(Boolean);
    // core numbers always, everything else only if it changed at some point
    const CORE = new Set(['lines', 'code', 'functions', 'score']);
    const changed = m => new Set(list.map(s => s[m.key]).filter(v => v != null)).size > 1;
    const shown = METRICS.filter(m => CORE.has(m.key) || changed(m));
    const hidden = METRICS.length - shown.length;
    const cards = shown.map(m => spark(ui, list, m)).filter(Boolean).join('') + (hidden ? `<div class="tr-card tr-more muted">${hidden} more metric${hidden === 1 ? '' : 's'} unchanged in all ${list.length} runs</div>` : '');
    return `${card(`Since the last run <span class="muted">(${new Date(prev.t).toLocaleString()})</span>`, chips.length ? `<div class="tr-chips">${chips.join('')}</div>` : '<p class="muted">Nothing changed.</p>', { tools: '<button class="btn" data-trend-clear title="Forget the history of this workspace / project root">Clear history</button>' })}
      <div class="tr-grid">${cards}</div>`;
  }

  window.LCTrends = { render };
})();
