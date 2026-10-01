// @ts-check
// "Code health" section: complexity per function, long functions, duplicated code, hard-coded secrets.
(function () {
  const SEV = {
    critical: { label: 'critical', color: '#ff4d4f' },
    high: { label: 'high', color: '#e0621b' },
    medium: { label: 'medium', color: '#f7ae62' },
    low: { label: 'low', color: '#a0a0a0' },
  };
  const CX_COLORS = ['#6b6b6b', '#a0a0a0', '#f7ae62', '#e0621b', '#ff4d4f'];
  const state = { tab: 'complex', q: '', showAllDups: false, showAllSecrets: false };
  const GRADE_TEXT = {
    A: 'Clean. Suspiciously clean.',
    B: 'Solid, with a few skeletons in the closet.',
    C: 'It works. Nobody knows why.',
    D: 'Refactoring is overdue. Like, years overdue.',
    F: 'Declare technical bankruptcy.',
  };

  const short = s => (s.length > 60 ? s.slice(0, 58) + '…' : s);

  function gauge(score, grade) {
    const a = Math.PI * (1 - score / 100);
    const R = 70, C = 90;
    const x = C + R * Math.cos(a), y = 90 - R * Math.sin(a);
    const color = score >= 80 ? '#a0a0a0' : score >= 65 ? '#f7ae62' : score >= 50 ? '#e0621b' : '#ff4d4f';
    return `<svg viewBox="0 0 180 110" class="hl-gauge">
      <path d="M20 90 A70 70 0 0 1 160 90" class="hl-gauge-bg"/>
      <path d="M20 90 A70 70 0 ${score > 50 ? 0 : 0} 1 ${x.toFixed(1)} ${y.toFixed(1)}" style="stroke:${color}" class="hl-gauge-fg"/>
      <text x="90" y="80" text-anchor="middle" class="hl-grade" style="fill:${color}">${grade}</text>
      <text x="90" y="102" text-anchor="middle" class="hl-score">${score} / 100</text></svg>`;
  }

  function fnRow(ui, f, H, key) {
    const { esc, fmt } = ui;
    const lim = key === 'lines' ? H.thresholds.maxFunctionLines : H.thresholds.maxComplexity;
    const v = key === 'lines' ? f.lines : f.complexity;
    const ratio = Math.min(1, v / (lim * 3));
    const bad = v > lim;
    return `<tr class="clickable" data-abs="${esc(f.abs)}" data-line="${f.line}" title="Open ${esc(f.path)}:${f.line}">
      <td><b class="hl-fn">${esc(f.name)}</b><span class="muted">()</span></td>
      <td class="hl-path">${esc(f.path)}<span class="muted">:${f.line}</span></td>
      <td class="num"><span class="hl-meter"><span style="width:${(ratio * 100).toFixed(0)}%;background:${bad ? (v > lim * 2 ? '#ff4d4f' : '#e0621b') : '#a0a0a0'}"></span></span><b class="${bad ? 'dep-bad' : ''}">${fmt(v)}</b></td>
      <td class="num">${fmt(key === 'lines' ? f.complexity : f.lines)}</td>
      <td class="num">${fmt(f.params)}</td></tr>`;
  }

  function fnTable(ui, H) {
    const q = state.q.toLowerCase();
    const src = state.tab === 'long' ? H.long : state.tab === 'params' ? H.manyParams : H.complex;
    const rows = src.filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    const key = state.tab === 'long' ? 'lines' : 'complexity';
    if (!rows.length) return '<p class="muted">Nothing here. Enjoy the silence.</p>';
    return `<div class="table-scroll small"><table class="grid hl-table"><thead><tr><th>Function</th><th>File</th>
      <th class="num">${key === 'lines' ? 'Lines' : 'Complexity'}</th><th class="num">${key === 'lines' ? 'Complexity' : 'Lines'}</th><th class="num">Params</th></tr></thead>
      <tbody>${rows.map(f => fnRow(ui, f, H, key)).join('')}</tbody></table></div>`;
  }

  function dupsHtml(ui, H) {
    const { esc, fmt } = ui;
    const d = H.duplicates;
    if (!d) return '<p class="muted">Duplicate detection is off (<code>linecounter.health.enabled</code>).</p>';
    if (!d.groups.length) return `<p class="dep-okmsg">No duplicated blocks of ${H.thresholds.duplicateMinLines}+ lines. Copy & paste has left the building.</p>`;
    const shown = state.showAllDups ? d.groups : d.groups.slice(0, 12);
    const loc = o => `<a href="#" class="file hl-loc" data-abs="${esc(o.abs)}" data-line="${o.line}" title="Open ${esc(o.path)} at line ${o.line}">${esc(o.path)}<span class="muted">:${o.line}–${o.end}</span></a>`;
    return `<div class="hl-dups">${shown.map(g => `<div class="hl-dup">
        <span class="hl-dup-len"><b>${fmt(g.lines)}</b> lines</span>
        <span class="hl-dup-locs">${loc(g.occurrences[0])}<span class="hl-dup-eq">≡</span>${loc(g.occurrences[1])}</span></div>`).join('')}</div>
      ${d.groups.length > shown.length ? `<button class="btn" data-hl-alldups>Show all ${fmt(d.groups.length)}</button>` : ''}`;
  }

  function secretsHtml(ui, H) {
    const { esc, fmt } = ui;
    const S = H.secrets;
    if (!S) return '<p class="muted">Secret scanning is off (<code>linecounter.secrets.enabled</code>).</p>';
    if (!S.items.length) return '<p class="dep-okmsg">No hard-coded secrets found. Your keys are where they belong: somewhere else.</p>';
    const shown = state.showAllSecrets ? S.items : S.items.slice(0, 25);
    return `<div class="table-scroll small"><table class="grid"><thead><tr><th>Severity</th><th>Type</th><th>Where</th><th>Match (masked)</th></tr></thead><tbody>
      ${shown.map(s => `<tr class="clickable" data-abs="${esc(s.abs)}" data-line="${s.line}" title="Open ${esc(s.path)}:${s.line}">
        <td><span class="sev" style="background:${SEV[s.severity].color}">${esc(s.severity)}</span></td>
        <td>${esc(s.name)}</td><td class="hl-path">${esc(s.path)}<span class="muted">:${s.line}</span></td>
        <td><code class="hl-secret">${esc(s.preview)}</code></td></tr>`).join('')}
      </tbody></table></div>${S.items.length > shown.length ? `<button class="btn" data-hl-allsecrets>Show all ${fmt(S.items.length)}</button>` : ''}
      <p class="muted hl-note">Values are masked. Rotate every real key that was ever committed – deleting the line does not delete git history.</p>`;
  }

  /** churn (git changes) × complexity scatter – the top right corner is where refactoring pays off most */
  function riskHtml(ui, H) {
    const { esc, fmt, tipAttr } = ui;
    const R = H.risk;
    if (!R || !R.files.length) return '<p class="muted">Needs a git repository with history: files that change often and are complex appear here.</p>';
    const W = 560, Hh = 300, P = 36;
    const lx = v => Math.log10(1 + v), mx = lx(R.maxChurn), my = lx(R.maxComplexity);
    const x = v => P + (lx(v) / mx) * (W - P - 12), y = v => Hh - P - (lx(v) / my) * (Hh - P - 12);
    const maxLines = Math.max(1, ...R.files.map(f => f.lines || 1));
    const dots = R.files.slice().reverse().map(f => {
      const r = 3 + Math.sqrt((f.lines || 1) / maxLines) * 12;
      const c = f.risk >= 60 ? '#ff4d4f' : f.risk >= 35 ? '#e0621b' : f.risk >= 15 ? '#f7ae62' : '#8a8a8a';
      return `<circle cx="${x(f.churn).toFixed(1)}" cy="${y(f.complexity).toFixed(1)}" r="${r.toFixed(1)}" style="fill:${c}" class="hl-risk-dot clickable" data-abs="${esc(f.abs)}" ${tipAttr(`<b>${esc(f.path)}</b><br>changed in ${fmt(f.churn)} commits · total complexity ${fmt(f.complexity)}<br>worst function ${fmt(f.maxComplexity)} · ${fmt(f.lines)} lines<br>risk ${f.risk}/100 · click to open`)}/>`;
    }).join('');
    const top = R.files.slice(0, 8);
    return `<div class="hl-risk">
      <svg viewBox="0 0 ${W} ${Hh}" class="hl-risk-svg">
        <rect x="${(P + (W - P - 12) / 2).toFixed(0)}" y="12" width="${((W - P - 12) / 2).toFixed(0)}" height="${((Hh - P - 12) / 2).toFixed(0)}" class="hl-risk-zone"/>
        <text x="${W - 16}" y="28" text-anchor="end" class="hl-risk-zone-label">refactor first</text>
        <line x1="${P}" y1="${Hh - P}" x2="${W - 8}" y2="${Hh - P}" class="hl-axis"/><line x1="${P}" y1="8" x2="${P}" y2="${Hh - P}" class="hl-axis"/>
        <text x="${(W + P) / 2}" y="${Hh - 8}" text-anchor="middle" class="hl-axis-label">changes (git commits, log scale) →</text>
        <text x="12" y="${(Hh - P) / 2}" text-anchor="middle" class="hl-axis-label" transform="rotate(-90 12 ${(Hh - P) / 2})">complexity (log) →</text>
        ${dots}
      </svg>
      <ol class="hl-risk-list">${top.map(f => `<li class="clickable" data-abs="${esc(f.abs)}"><span class="hl-risk-score" style="background:${f.risk >= 60 ? '#ff4d4f' : f.risk >= 35 ? '#e0621b' : '#6b6b6b'}">${f.risk}</span><span class="hl-path">${esc(f.path)}</span><span class="muted">${fmt(f.churn)}× · cx ${fmt(f.complexity)}</span></li>`).join('')}</ol>
    </div>`;
  }

  function deadHtml(ui, H) {
    const { esc, fmt } = ui;
    const d = H.deadCode;
    if (!d) return '';
    if (!d.items.length) return '<p class="dep-okmsg">Every function is referenced somewhere. No dead weight found.</p>';
    return `<p class="muted hl-note">Functions whose name appears nowhere else in the analyzed files. Methods, decorated handlers, tests and entry points are skipped. <b>exported</b> ones may still be public API of a library.</p>
      <div class="table-scroll small"><table class="grid"><thead><tr><th>Function</th><th>File</th><th class="num">Lines</th><th></th></tr></thead><tbody>
      ${d.items.map(f => `<tr class="clickable" data-abs="${esc(f.abs)}" data-line="${f.line}"><td><b class="hl-fn">${esc(f.name)}</b><span class="muted">()</span></td><td class="hl-path">${esc(f.path)}<span class="muted">:${f.line}</span></td><td class="num">${fmt(f.lines)}</td><td>${f.exported ? '<span class="dep-tag">exported</span>' : '<span class="dep-tag prod">internal</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function render(ui, D) {
    const H = D.health;
    if (!H) return '';
    const { esc, fmt, card, tiles, donut, hbars, icon } = ui;
    const S = H.secrets;
    const secretSub = S ? Object.entries(S.bySeverity).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' · ') || 'none found' : 'off';
    return `
      <div class="hl-top">
        <div class="hl-grade-card card"><div class="card-body">${gauge(H.score, H.grade)}<div class="hl-grade-text">${esc(GRADE_TEXT[H.grade])}</div></div></div>
        ${tiles([
          { label: 'Functions', value: fmt(H.functions), sub: `avg. complexity ${H.avgComplexity.toFixed(1)}` },
          { label: 'Too complex', html: `<span class="${H.overComplex ? 'dep-bad' : ''}">${fmt(H.overComplex)}</span>`, sub: `complexity > ${H.thresholds.maxComplexity}` },
          { label: 'Too long', value: fmt(H.overLong), sub: `more than ${H.thresholds.maxFunctionLines} lines` },
          { label: 'Duplicated code', value: H.duplicates ? H.duplicates.percent.toFixed(1) + '%' : 'off', sub: H.duplicates ? `${fmt(H.duplicates.total)} blocks · ${fmt(H.duplicates.duplicatedLines)} lines` : 'linecounter.health.enabled' },
          { label: 'Secrets', html: S ? `<span class="${S.total ? 'dep-bad' : ''}">${fmt(S.total)}</span>` : 'off', sub: secretSub },
        ])}
      </div>
      <div class="grid-3">
        ${card('Complexity per function', donut(H.complexityBuckets.map((b, i) => ({ label: b.label, value: b.count, color: CX_COLORS[i] })).filter(x => x.value), fmt(H.functions), 'functions'), { sub: 'cyclomatic complexity' })}
        ${card('Function length', hbars(H.lengthBuckets.map((b, i) => ({ label: b.label + ' lines', value: b.count, color: CX_COLORS[i] }))))}
        ${card('Complexity hotspots', H.hotspots.length ? hbars(H.hotspots.slice(0, 10).map(h => ({ label: h.path.split('/').slice(-2).join('/'), value: h.complexity, abs: h.abs, color: h.maxComplexity > H.thresholds.maxComplexity ? '#e0621b' : '#a0a0a0', tip: `<b>${esc(h.path)}</b><br>${fmt(h.functions)} functions · total complexity ${fmt(h.complexity)}<br>worst function: ${fmt(h.maxComplexity)}` }))) : '<p class="muted">No functions found.</p>', { sub: 'total complexity per file · click to open' })}
      </div>
      ${card('Functions', `<div class="table-tools">
          <span class="rant-chips">
            <button class="rant-chip ${state.tab === 'complex' ? 'on' : ''}" data-hl-tab="complex">Most complex</button>
            <button class="rant-chip ${state.tab === 'long' ? 'on' : ''}" data-hl-tab="long">Longest</button>
            <button class="rant-chip ${state.tab === 'params' ? 'on' : ''}" data-hl-tab="params">Too many parameters ${fmt(H.manyParamsCount)}</button>
          </span>
          <input id="hlQ" type="search" placeholder="Filter functions / files…" value="${esc(state.q)}">
        </div><div id="hl-fns">${fnTable(ui, H)}</div>`, { sub: 'click a row to jump to the function', tools: `<button class="btn" data-hl-pdf="health">${icon('pages')} Code health PDF</button>` })}
      <div class="grid-2 hl-bottom">
        ${card('Risk hotspots – churn × complexity', riskHtml(ui, H), { sub: 'often changed and complex = most likely to break' })}
        ${card(`Possibly unused functions <span class="dep-chip ${H.deadCode && H.deadCode.internal ? 'warn' : ''}">${fmt(H.deadCode ? H.deadCode.total : 0)}</span>`, deadHtml(ui, H), { sub: H.deadCode && H.deadCode.total ? `${fmt(H.deadCode.lines)} lines` : '' })}
      </div>
      <div class="grid-2 hl-bottom">
        ${card(`Duplicated code`, `<div id="hl-dups">${dupsHtml(ui, H)}</div>`, { sub: H.duplicates ? `blocks of ${H.thresholds.duplicateMinLines}+ identical lines` : '' })}
        ${card(`${icon('alert')} Hard-coded secrets`, `<div id="hl-secrets">${secretsHtml(ui, H)}</div>`, { sub: S && S.total ? secretSub : '', tools: S ? `<button class="btn" data-hl-pdf="secrets">${icon('pages')} Secrets PDF</button>` : '' })}
      </div>`;
  }

  function rants(ui, D) {
    const H = D.health;
    if (!H) return [];
    const { fmt, esc } = ui;
    const out = [];
    const top = H.complex[0];
    if (top && top.complexity > H.thresholds.maxComplexity * 3) out.push(['🍝', `${esc(top.name)}() in ${esc(top.path.split('/').pop())} has a cyclomatic complexity of ${fmt(top.complexity)}. That's not a function, that's a choose-your-own-adventure book.`]);
    else if (top && top.complexity > H.thresholds.maxComplexity) out.push(['🌀', `${esc(top.name)}() reaches complexity ${fmt(top.complexity)}. Every if-statement is a cry for help.`]);
    if (H.overComplex >= 10) out.push(['🧶', `${fmt(H.overComplex)} functions are more complex than ${H.thresholds.maxComplexity}. Unit tests for them would need their own unit tests.`]);
    const longest = H.long[0];
    if (longest && longest.lines > H.thresholds.maxFunctionLines * 2) out.push(['📜', `${esc(longest.name)}() is ${fmt(longest.lines)} lines long. Scrolling through it counts as cardio.`]);
    const params = H.manyParams[0];
    if (params) out.push(['🧳', `${esc(params.name)}() takes ${fmt(params.params)} parameters. Have you heard of objects?`]);
    const d = H.duplicates;
    if (d && d.percent >= 10) out.push(['📋', `${d.percent.toFixed(0)}% of the code is copy & paste. Ctrl+C, Ctrl+V – the true design pattern.`]);
    else if (d && d.groups.length && d.groups[0].lines >= 30) out.push(['👯', `A ${fmt(d.groups[0].lines)}-line block exists twice (${esc(d.groups[0].occurrences[0].path.split('/').pop())} and ${esc(d.groups[0].occurrences[1].path.split('/').pop())}). DRY stands for “Do Repeat Yourself”, right?`]);
    const S = H.secrets;
    if (S && S.bySeverity.critical) out.push(['🔑', `${fmt(S.bySeverity.critical)} critical secret${S.bySeverity.critical === 1 ? '' : 's'} in the code (${esc(S.items[0].name)} in ${esc(S.items[0].path.split('/').pop())}). Hackers say thanks for the free keys.`]);
    else if (S && S.total) out.push(['🙈', `${fmt(S.total)} possible hard-coded secret${S.total === 1 ? '' : 's'}. “It's just for local testing” – famous last words.`]);
    if (H.deadCode && H.deadCode.internal >= 5) out.push(['🪦', `${fmt(H.deadCode.internal)} functions nobody calls (${fmt(H.deadCode.lines)} lines). A graveyard with syntax highlighting.`]);
    if (H.risk && H.risk.files[0] && H.risk.files[0].risk >= 60) out.push(['💣', `${esc(H.risk.files[0].path.split('/').pop())} changed in ${fmt(H.risk.files[0].churn)} commits and has a total complexity of ${fmt(H.risk.files[0].complexity)}. That's where the next bug is born.`]);
    if (H.grade === 'A' && H.functions > 30) out.push(['🏅', `Code health grade A with ${fmt(H.functions)} functions. Either you're very good or the scanner is very tired.`]);
    return out;
  }

  function refresh(ui, D, id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html(ui, D.health); }

  function handleClick(ui, D, t) {
    if (!D.health) return false;
    const tab = t.closest('[data-hl-tab]');
    if (tab) {
      state.tab = /** @type {HTMLElement} */ (tab).dataset.hlTab || 'complex';
      document.querySelectorAll('[data-hl-tab]').forEach(b => b.classList.toggle('on', b === tab));
      refresh(ui, D, 'hl-fns', fnTable);
      return true;
    }
    if (t.closest('[data-hl-alldups]')) { state.showAllDups = true; refresh(ui, D, 'hl-dups', dupsHtml); return true; }
    if (t.closest('[data-hl-allsecrets]')) { state.showAllSecrets = true; refresh(ui, D, 'hl-secrets', secretsHtml); return true; }
    const pdf = t.closest('[data-hl-pdf]');
    if (pdf && window.LCExport) {
      const kind = /** @type {HTMLElement} */ (pdf).dataset.hlPdf;
      const data = kind === 'secrets' ? LCExport.secretsPdf(D) : LCExport.healthPdf(D);
      ui.post({ type: 'savePdf', data, name: kind === 'secrets' ? 'secrets-report.pdf' : 'code-health-report.pdf' });
      return true;
    }
    return false;
  }

  function handleInput(ui, D, t) {
    if (t.id === 'hlQ' && D.health) { state.q = /** @type {HTMLInputElement} */ (t).value; refresh(ui, D, 'hl-fns', fnTable); return true; }
    return false;
  }

  window.LCHealth = { render, rants, handleClick, handleInput, short };
})();
