// @ts-check
// "Dependencies" section of the statistics page: licenses, vulnerabilities, unused / undeclared packages.
(function () {
  const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  const SEV_COLOR = { CRITICAL: '#ff4d4f', HIGH: '#e0621b', MEDIUM: '#f7ae62', LOW: '#a0a0a0', UNKNOWN: '#6b6b6b', NONE: '#6b6b6b' };
  const CAT = {
    permissive: { label: 'Permissive', color: '#a0a0a0' },
    'weak-copyleft': { label: 'Weak copyleft', color: '#f7ae62' },
    'strong-copyleft': { label: 'Strong copyleft', color: '#e0621b' },
    'network-copyleft': { label: 'Network copyleft', color: '#ff4d4f' },
    restricted: { label: 'Restricted / custom', color: '#b8480f' },
    unknown: { label: 'Unknown', color: '#5a5a5a' },
  };
  const state = { status: 'flagged', eco: '', scope: '', q: '', sev: '', limit: 150, showAllVulns: false, license: '', category: '' };
  const declLink = (p, esc) => (p.decl || []).filter(d => d.file).map(d => `<a href="#" class="file" data-abs="${esc(d.file)}" ${d.line ? `data-line="${d.line}"` : ''} title="Open the declaration">${esc(d.file.split(/[\\/]/).slice(-2).join('/'))}${d.line ? ':' + d.line : ''}</a>`).join(', ');

  function render(ui, D) {
    const R = D.dependencies;
    const { esc, fmt, card, tiles, donut, hbars, icon } = ui;
    if (!R) return '';
    if (R.error) return card('Dependencies', `<p class="muted">The dependency scan failed: ${esc(R.error)}</p>`);
    if (!R.manifests.length) return card('Dependencies', '<p class="muted">No package manifests (package.json, requirements.txt, pyproject.toml, Pipfile, setup.py) in the selected files.</p>');
    const P = R.packages;
    const direct = P.filter(p => p.direct);
    const flagged = st => P.filter(p => !p.ignored && p.status === st);
    const vulns = R.vulns.items || [];
    const bySev = Object.fromEntries(SEV_ORDER.map(s => [s, vulns.filter(v => (v.severity || 'UNKNOWN') === s || (s === 'UNKNOWN' && v.severity === 'NONE')).length]));
    const unused = R.usage.reduce((s, u) => s + u.unused.filter(x => x.type !== 'tool').length, 0);
    const undeclared = R.usage.reduce((s, u) => s + u.undeclared.length, 0);

    const cats = Object.keys(CAT).map(k => ({ label: CAT[k].label, value: P.filter(p => p.category === k).length, color: CAT[k].color, attrs: `data-dep-cat="${k}"` })).filter(x => x.value);
    const licCount = new Map();
    for (const p of P) licCount.set(p.license, (licCount.get(p.license) || 0) + 1);
    const topLic = [...licCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

    const vulnTile = R.vulns.enabled
      ? (R.vulns.error ? { label: 'Vulnerabilities', value: 'n/a', sub: 'OSV.dev not reachable' } : { label: 'Vulnerabilities', html: `<span class="${vulns.length ? 'dep-bad' : ''}">${fmt(vulns.length)}</span>`, sub: SEV_ORDER.filter(s => bySev[s]).map(s => `${bySev[s]} ${s.toLowerCase()}`).join(' · ') || `${fmt(R.vulns.checked)} packages checked` })
      : { label: 'Vulnerabilities', value: 'off', sub: 'linecounter.vulnerabilities.enabled' };

    return `
      <div class="dep-manifests muted">${R.manifests.map(m => `<a class="file" href="#" data-abs="${esc(m.abs)}">${esc(m.file)}</a> <span class="dep-eco ${m.ecosystem === 'npm' ? 'npm' : 'py'}">${m.ecosystem}</span> ${fmt(m.deps)} deps`).join(' &nbsp;·&nbsp; ')}
        ${R.pythonEnvironments && R.pythonEnvironments.length ? `&nbsp;·&nbsp; Python env: ${R.pythonEnvironments.map(esc).join(', ')}` : ''}</div>
      ${tiles([
        { label: 'Direct dependencies', value: fmt(direct.length), sub: `${fmt(direct.filter(p => p.ecosystem === 'npm').length)} npm · ${fmt(direct.filter(p => p.ecosystem === 'PyPI').length)} Python` },
        { label: 'Packages in total', value: fmt(P.length), sub: `${fmt(P.filter(p => !p.direct).length)} transitive` },
        { label: 'Problematic licenses', html: `<span class="${flagged('problematic').length ? 'dep-bad' : ''}">${fmt(flagged('problematic').length)}</span>`, sub: 'linecounter.licenses.problematic' },
        { label: 'Needs review', value: fmt(flagged('review').length), sub: 'unknown, custom or weak copyleft' },
        vulnTile,
        { label: 'Unused packages', value: fmt(unused), sub: `${fmt(undeclared)} imported but not declared` },
      ])}
      ${card('License overview', `
        <div class="dep-catbar">${cats.map(c => `<span class="dep-catseg clickable" ${c.attrs} style="flex:${c.value};background:${c.color}" ${ui.tipAttr(`<b>${esc(c.label)}</b><br>${fmt(c.value)} packages<br><i>click to list them</i>`)}>${c.value / P.length > 0.07 ? `${esc(c.label)} · ${fmt(c.value)}` : ''}</span>`).join('')}</div>
        <div class="dep-lic-grid">
          <div class="dep-lic-donut">${donut(cats, fmt(P.length), 'packages')}</div>
          <div class="dep-lic-bars">${hbars(topLic.map(([l, c]) => ({ label: l, value: c, color: CAT[(P.find(p => p.license === l) || {}).category || 'unknown'].color, attrs: `data-dep-lic="${esc(l)}"`, tip: `<b>${esc(l)}</b><br>${fmt(c)} packages<br><i>click to list them</i>` })))}</div>
        </div>`, { sub: 'click a category or license to list its packages' })}
      ${card('Dependency hygiene – unused & undeclared', usageHtml(ui, R), { sub: 'click a package to jump to its declaration · click a file to open it' })}
      ${card(`${icon('alert')} Vulnerabilities <span class="muted">via OSV.dev</span>`, `<div id="dep-vulns">${vulnsHtml(ui, R)}</div>`, { sub: R.vulns.enabled && !R.vulns.error ? `${fmt(R.vulns.checked)} packages checked`: '', tools: R.vulns.enabled ? `<button class="btn" data-dep-pdf="vulns">${icon('pages')} Vulnerability PDF</button>` : '' })}
      ${card('License report', `<div class="table-tools dep-tools">
          <select id="depStatus">
            <option value="flagged" ${state.status === 'flagged' ? 'selected' : ''}>Problematic + review</option>
            <option value="problematic" ${state.status === 'problematic' ? 'selected' : ''}>Problematic</option>
            <option value="review" ${state.status === 'review' ? 'selected' : ''}>Needs review</option>
            <option value="ok" ${state.status === 'ok' ? 'selected' : ''}>OK</option>
            <option value="" ${state.status === '' ? 'selected' : ''}>All packages</option>
          </select>
          <select id="depEco"><option value="">npm + Python</option><option value="npm">npm</option><option value="PyPI">Python</option></select>
          <select id="depScope"><option value="">direct + transitive</option><option value="direct">direct only</option><option value="transitive">transitive only</option></select>
          <input id="depQ" type="text" placeholder="Filter packages or licenses…" spellcheck="false">
          <span id="depActive"></span>
          <span class="muted" id="depCount"></span>
          <button class="btn" data-act="licenses-csv">${icon('download')} License CSV</button>
          <button class="btn" data-dep-pdf="licenses">${icon('pages')} License PDF</button>
        </div><div class="table-scroll"><table class="grid" id="depTable"></table></div><div class="table-more" id="depMore"></div>`)}`;
  }

  function usageHtml(ui, R) {
    const { esc, fmt } = ui;
    const blocks = R.usage.filter(u => u.unused.length || u.undeclared.length);
    if (!blocks.length) return '<p class="dep-okmsg">Every declared package is imported somewhere, and every import is declared. Nice.</p>';
    const pkgLink = (u, x) => `<a href="#" class="file dep-pkg" data-abs="${esc(u.abs)}" ${x.line ? `data-line="${x.line}"` : ''} title="Open the declaration in ${esc(u.file)}${x.line ? ':' + x.line : ''}">${esc(x.name)}</a>`;
    const row = (u, x) => `<li class="dep-row"><span class="dep-row-main">${pkgLink(u, x)} <span class="dep-tag ${x.type}">${esc(x.type)}</span></span><span class="dep-row-hint">${esc(x.hint)}</span></li>`;
    return `<div class="dep-hygiene">${blocks.map(u => {
      const real = u.unused.filter(x => x.type !== 'tool');
      const tools = u.unused.filter(x => x.type === 'tool');
      return `<div class="dep-hyg-card">
        <div class="dep-hyg-head">
          <span class="dep-eco ${u.ecosystem === 'npm' ? 'npm' : 'py'}">${u.ecosystem}</span>
          <a href="#" class="file dep-hyg-file" data-abs="${esc(u.abs)}" title="Open ${esc(u.file)}">${esc(u.file)}</a>
          <span class="dep-hyg-chips">${real.length ? `<span class="dep-chip warn">${fmt(real.length)} unused</span>` : ''}${u.undeclared.length ? `<span class="dep-chip bad">${fmt(u.undeclared.length)} undeclared</span>` : ''}${tools.length ? `<span class="dep-chip">${fmt(tools.length)} CLI tools</span>` : ''}</span>
        </div>
        ${real.length ? `<div class="dep-hyg-sec"><div class="dep-hyg-title">Declared but never imported <span class="muted">– remove them or check your configs</span></div><ul class="dep-rows">${real.map(x => row(u, x)).join('')}</ul></div>` : ''}
        ${u.undeclared.length ? `<div class="dep-hyg-sec"><div class="dep-hyg-title">Imported but not declared <span class="muted">– add them to</span> <a href="#" class="file" data-abs="${esc(u.abs)}">${esc(u.file.split('/').pop())}</a></div>
          <ul class="dep-rows">${u.undeclared.map(x => `<li class="dep-row undecl">
            <details><summary><span class="dep-row-main"><b>${esc(x.name)}</b>${x.dist && x.dist !== x.name ? ` <span class="muted">(${esc(x.dist)})</span>` : ''}${x.installed ? ' <span class="dep-tag trans">installed transitively</span>' : ' <span class="dep-tag missing">not installed</span>'}</span>
              <span class="dep-row-hint">used in ${fmt(x.files.length)} file${x.files.length === 1 ? '' : 's'} ▾</span></summary>
              <div class="dep-files">${x.files.map(f => `<a href="#" class="file" data-abs="${esc(f.abs)}" title="Open ${esc(f.path)}">${esc(f.path)}</a>`).join('')}</div></details></li>`).join('')}</ul></div>` : ''}
        ${tools.length ? `<details class="dep-hyg-tools"><summary>${fmt(tools.length)} command-line tool${tools.length === 1 ? '' : 's'} – not imported, probably fine</summary><ul class="dep-rows">${tools.map(x => row(u, x)).join('')}</ul></details>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function vulnsHtml(ui, R) {
    const { esc, fmt } = ui;
    if (!R.vulns.enabled) return '<p class="muted">Vulnerability check is disabled (<code>linecounter.vulnerabilities.enabled</code>).</p>';
    if (R.vulns.error) return `<p class="dep-warn">Could not reach OSV.dev: ${esc(R.vulns.error)}. Check your network / proxy settings or disable the check.</p>`;
    const items = R.vulns.items.filter(v => !state.sev || v.severity === state.sev);
    if (!R.vulns.items.length) return `<p class="dep-okmsg">No known vulnerabilities in ${fmt(R.vulns.checked)} checked packages.</p>${R.vulns.unresolved && R.vulns.unresolved.length ? `<p class="muted">${fmt(R.vulns.unresolved.length)} direct dependencies could not be checked because no exact version is installed or pinned.</p>` : ''}`;
    const chips = `<div class="rant-chips"><button class="rant-chip ${!state.sev ? 'on' : ''}" data-dep-sev="">All ${fmt(R.vulns.items.length)}</button>${SEV_ORDER.map(s => {
      const n = R.vulns.items.filter(v => v.severity === s).length;
      return n ? `<button class="rant-chip ${state.sev === s ? 'on' : ''}" data-dep-sev="${s}"><span class="sev-dot" style="background:${SEV_COLOR[s]}"></span>${s.toLowerCase()} ${fmt(n)}</button>` : '';
    }).join('')}</div>`;
    const shown = state.showAllVulns ? items : items.slice(0, 40);
    return chips + `<div class="table-scroll small"><table class="grid"><thead><tr><th>Severity</th><th>Package</th><th>Advisory</th><th>Summary</th><th>Fixed in</th></tr></thead><tbody>
      ${shown.map(v => `<tr>
        <td><span class="sev" style="background:${SEV_COLOR[v.severity] || SEV_COLOR.UNKNOWN}">${esc(v.severity)}${v.score != null ? ' ' + v.score.toFixed(1) : ''}</span></td>
        <td><b>${(() => { const p = R.packages.find(x => x.name === v.name && x.ecosystem === v.ecosystem && (x.decl || []).length); return p ? `<a href="#" class="file" data-abs="${esc(p.decl[0].file)}" ${p.decl[0].line ? `data-line="${p.decl[0].line}"` : ''} title="Open the declaration to update it">${esc(v.name)}</a>` : esc(v.name); })()}</b>@${esc(v.version)}${v.versionFromRange ? ' <span class="muted">(range)</span>' : ''} <span class="dep-eco ${v.ecosystem === 'npm' ? 'npm' : 'py'}">${v.ecosystem}</span>${v.direct ? '' : ' <span class="muted">transitive</span>'}${v.dev ? ' <span class="muted">dev</span>' : ''}</td>
        <td><a href="#" class="file" data-url="${esc(v.url)}">${esc(v.id)}</a>${v.aliases && v.aliases.length ? `<br><span class="muted">${v.aliases.map(esc).join(', ')}</span>` : ''}</td>
        <td class="dep-summary">${esc(v.summary)}</td>
        <td>${v.fixed && v.fixed.length ? v.fixed.map(esc).join(', ') : '<span class="muted">–</span>'}</td></tr>`).join('')}
      </tbody></table></div>${items.length > shown.length ? `<button class="btn" data-dep-allvulns>Show all ${fmt(items.length)}</button>` : ''}`;
  }

  function renderTable(ui, D) {
    const el = document.getElementById('depTable');
    if (!el) return;
    const { esc, fmt } = ui;
    const q = state.q.toLowerCase();
    let rows = D.dependencies.packages.filter(p =>
      (!state.license || p.license === state.license) && (!state.category || p.category === state.category) &&
      (!state.status || (state.status === 'flagged' ? (p.status === 'problematic' || p.status === 'review') && !p.ignored : p.status === state.status)) &&
      (!state.eco || p.ecosystem === state.eco) &&
      (!state.scope || (state.scope === 'direct' ? p.direct : !p.direct)) &&
      (!q || p.name.toLowerCase().includes(q) || String(p.license).toLowerCase().includes(q)));
    const rank = { problematic: 0, review: 1, ok: 2 };
    rows.sort((a, b) => rank[a.status] - rank[b.status] || Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name));
    const total = rows.length;
    rows = rows.slice(0, state.limit);
    el.innerHTML = `<thead><tr><th>Package</th><th>Version</th><th>License</th><th>Category</th><th>Status</th><th>Scope</th><th class="num">Vulns</th><th>Declared in</th><th></th></tr></thead>
      <tbody>${rows.map(p => `<tr class="${p.decl && p.decl.length || p.dir ? 'clickable' : ''}" ${p.decl && p.decl.length ? `data-abs="${esc(p.decl[0].file)}" ${p.decl[0].line ? `data-line="${p.decl[0].line}"` : ''} title="Open the declaration"` : p.dir ? `data-dep-dir="${esc(p.dir)}" title="Open the package metadata"` : ''}>
        <td><b>${esc(p.name)}</b> <span class="dep-eco ${p.ecosystem === 'npm' ? 'npm' : 'py'}">${p.ecosystem}</span></td>
        <td>${esc(p.versionFromRange ? p.spec : p.version || p.spec || '–')}${p.installed ? '' : ` <span class="muted">${p.latest ? 'latest ' + esc(p.latest) : 'not installed'}</span>`}</td>
        <td>${esc(p.license)}${p.licenseSource === 'registry' ? ' <span class="muted" title="License taken from the public registry because the package is not installed">(registry)</span>' : ''}</td>
        <td><span class="sw" style="background:${(CAT[p.category] || CAT.unknown).color}"></span>${esc((CAT[p.category] || CAT.unknown).label)}</td>
        <td>${p.ignored ? '<span class="dep-status ign">ignored</span>' : `<span class="dep-status ${p.status}">${p.status === 'problematic' ? 'problematic' : p.status === 'review' ? 'review' : 'ok'}</span>`}${p.notAllowed ? ' <span class="muted">not in allowlist</span>' : ''}</td>
        <td>${p.direct ? 'direct' : '<span class="muted">transitive</span>'}${p.dev ? ' <span class="muted">dev</span>' : ''}</td>
        <td class="num">${p.vulnCount ? `<span class="dep-bad">${fmt(p.vulnCount)}</span>` : ''}</td>
        <td class="muted">${declLink(p, esc) || esc((p.manifests || []).join(', '))}</td>
        <td>${p.dir ? `<button class="icon-mini" data-dep-dir="${esc(p.dir)}" title="Open the installed package (package.json / METADATA)">${ui.icon('folder')}</button>` : ''}</td></tr>`).join('')}</tbody>`;
    const act = document.getElementById('depActive');
    if (act) act.innerHTML = state.license || state.category ? `<span class="dep-filter">${esc(state.license || (CAT[state.category] || {}).label || '')} <button class="link" data-dep-clear>clear</button></span>` : '';
    const cnt = document.getElementById('depCount');
    if (cnt) cnt.textContent = `${fmt(total)} packages`;
    const more = document.getElementById('depMore');
    if (more) more.innerHTML = total > state.limit ? `<button class="btn" data-dep-more>Show all ${fmt(total)}</button>` : '';
  }

  /** Event handling; returns true if the event was handled. */
  function handleClick(ui, D, t) {
    const sev = t.closest('[data-dep-sev]');
    if (sev) { state.sev = /** @type {HTMLElement} */ (sev).dataset.depSev; document.getElementById('dep-vulns').innerHTML = vulnsHtml(ui, D.dependencies); return true; }
    if (t.closest('[data-dep-allvulns]')) { state.showAllVulns = true; document.getElementById('dep-vulns').innerHTML = vulnsHtml(ui, D.dependencies); return true; }
    if (t.closest('[data-dep-more]')) { state.limit = Infinity; renderTable(ui, D); return true; }
    const pdfBtn = t.closest('[data-dep-pdf]');
    if (pdfBtn && window.LCExport) {
      const kind = /** @type {HTMLElement} */ (pdfBtn).dataset.depPdf;
      const data = kind === 'licenses' ? LCExport.licensePdf(D) : LCExport.vulnPdf(D);
      ui.post({ type: 'savePdf', data, name: kind === 'licenses' ? 'license-report.pdf' : 'vulnerability-report.pdf' });
      return true;
    }
    const lic = t.closest('[data-dep-lic]');
    const cat = t.closest('[data-dep-cat]');
    if (lic || cat) {
      state.license = lic ? /** @type {HTMLElement} */ (lic).dataset.depLic : '';
      state.category = cat ? /** @type {HTMLElement} */ (cat).dataset.depCat : '';
      state.status = ''; state.limit = Infinity;
      const sel = /** @type {HTMLSelectElement} */ (document.getElementById('depStatus'));
      if (sel) sel.value = '';
      renderTable(ui, D);
      const tbl = document.getElementById('depTable');
      if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    if (t.closest('[data-dep-clear]')) { state.license = ''; state.category = ''; renderTable(ui, D); return true; }
    const url = t.closest('[data-url]');
    if (url) { ui.post({ type: 'openUrl', url: /** @type {HTMLElement} */ (url).dataset.url }); return true; }
    const dir = t.closest('[data-dep-dir]');
    if (dir) { ui.post({ type: 'reveal', abs: /** @type {HTMLElement} */ (dir).dataset.depDir, inEditor: true }); return true; }
    return false;
  }
  function handleInput(ui, D, t) {
    if (t.id === 'depQ') { state.q = t.value; renderTable(ui, D); return true; }
    if (t.id === 'depStatus') { state.status = t.value; renderTable(ui, D); return true; }
    if (t.id === 'depEco') { state.eco = t.value; renderTable(ui, D); return true; }
    if (t.id === 'depScope') { state.scope = t.value; renderTable(ui, D); return true; }
    return false;
  }

  /** Rants about dependencies (used by the Code Rant section). */
  function rants(ui, D) {
    const R = D.dependencies;
    if (!R || !R.packages || !R.packages.length) return [];
    const { fmt, esc } = ui;
    const out = [];
    const P = R.packages;
    const vul = R.vulns.items || [];
    const crit = vul.filter(v => v.severity === 'CRITICAL');
    if (crit.length) out.push(['🚨', `${fmt(crit.length)} CRITICAL vulnerabilit${crit.length === 1 ? 'y' : 'ies'} (e.g. ${esc(crit[0].name)}@${esc(crit[0].version)}). Stop reading this and run the update.`]);
    else if (vul.length) out.push(['🕳️', `${fmt(vul.length)} known vulnerabilities in your dependencies. Hackers love a good open door.`]);
    else if (R.vulns.enabled && !R.vulns.error && R.vulns.checked) out.push(['🛡️', `${fmt(R.vulns.checked)} packages checked, zero known vulnerabilities. Enjoy it while it lasts.`]);
    const gpl = P.filter(p => p.status === 'problematic' && !p.ignored);
    if (gpl.length) out.push(['⚖️', `${fmt(gpl.length)} package${gpl.length === 1 ? '' : 's'} with problematic licenses (${[...new Set(gpl.map(p => p.license))].slice(0, 3).map(esc).join(', ')}). Your lawyer just felt a disturbance in the force.`]);
    const unknown = P.filter(p => p.license === 'Unknown').length;
    if (unknown >= 3) out.push(['🤷', `${fmt(unknown)} packages without any license information. Schrödinger’s licensing.`]);
    const unused = R.usage.flatMap(u => u.unused.filter(x => x.type !== 'tool' && x.type !== 'dev'));
    if (unused.length) out.push(['🧟', `${fmt(unused.length)} dependenc${unused.length === 1 ? 'y is' : 'ies are'} declared but never imported (${unused.slice(0, 3).map(u => esc(u.name)).join(', ')}). Zombie packages, eating your install time.`]);
    const undeclared = R.usage.flatMap(u => u.undeclared);
    if (undeclared.length) out.push(['🎲', `${fmt(undeclared.length)} import${undeclared.length === 1 ? '' : 's'} of packages that are not declared (${undeclared.slice(0, 3).map(u => esc(u.name)).join(', ')}). Works on my machine™.`]);
    const trans = P.filter(p => !p.direct).length;
    const dir = P.filter(p => p.direct).length;
    if (dir && trans / dir >= 20) out.push(['🪆', `${fmt(dir)} direct dependencies pulled in ${fmt(trans)} transitive ones (${Math.round(trans / dir)}×). node_modules is the heaviest object in the universe.`]);
    const tiny = P.filter(p => /^(left-?pad|is-odd|is-even|is-number|isarray|is-array)$/i.test(p.name));
    if (tiny.length) out.push(['🤏', `You depend on ${tiny.map(p => esc(p.name)).join(', ')}. Some things are better written yourself.`]);
    return out;
  }

  window.LCDeps = { render, renderTable, handleClick, handleInput, rants };
})();
