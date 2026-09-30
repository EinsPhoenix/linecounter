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
  const state = { status: 'flagged', eco: '', scope: '', q: '', sev: '', limit: 150, showAllVulns: false };

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

    const cats = Object.keys(CAT).map(k => ({ label: CAT[k].label, value: P.filter(p => p.category === k).length, color: CAT[k].color })).filter(x => x.value);
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
      <div class="grid-3">
        ${card('License categories', donut(cats, fmt(P.length), 'packages'))}
        ${card('Licenses', hbars(topLic.map(([l, c]) => ({ label: l, value: c, color: CAT[(P.find(p => p.license === l) || {}).category || 'unknown'].color, tip: `<b>${esc(l)}</b><br>${fmt(c)} packages` }))))}
        ${card('Unused & undeclared', usageHtml(ui, R))}
      </div>
      ${card(`${icon('alert')} Vulnerabilities <span class="muted">via OSV.dev</span>`, `<div id="dep-vulns">${vulnsHtml(ui, R)}</div>`, { sub: R.vulns.enabled && !R.vulns.error ? `${fmt(R.vulns.checked)} packages checked` : '' })}
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
          <span class="muted" id="depCount"></span>
          <button class="btn" data-act="licenses-csv">${icon('download')} License CSV</button>
        </div><div class="table-scroll"><table class="grid" id="depTable"></table></div><div class="table-more" id="depMore"></div>`)}`;
  }

  function usageHtml(ui, R) {
    const { esc, fmt } = ui;
    const blocks = R.usage.filter(u => u.unused.length || u.undeclared.length);
    if (!blocks.length) return '<p class="muted">Every declared package is imported somewhere, and every import is declared. Nice.</p>';
    return blocks.map(u => `<div class="dep-usage">
      <div class="dep-usage-head"><span class="dep-eco ${u.ecosystem === 'npm' ? 'npm' : 'py'}">${u.ecosystem}</span> ${esc(u.file)}</div>
      ${u.unused.length ? `<div class="dep-usage-title">Possibly unused (${fmt(u.unused.length)})</div><ul class="dep-list">${u.unused.map(x => `<li><b>${esc(x.name)}</b> <span class="dep-tag ${x.type}">${esc(x.type)}</span> <span class="muted">${esc(x.hint)}</span></li>`).join('')}</ul>` : ''}
      ${u.undeclared.length ? `<div class="dep-usage-title">Imported but not declared (${fmt(u.undeclared.length)})</div><ul class="dep-list">${u.undeclared.map(x => `<li><b>${esc(x.name)}</b>${x.dist && x.dist !== x.name ? ` <span class="muted">(${esc(x.dist)})</span>` : ''} <span class="muted">in ${x.files.map(esc).join(', ')}${x.installed ? ' · installed transitively' : ''}</span></li>`).join('')}</ul>` : ''}
    </div>`).join('');
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
        <td><b>${esc(v.name)}</b>@${esc(v.version)} <span class="dep-eco ${v.ecosystem === 'npm' ? 'npm' : 'py'}">${v.ecosystem}</span>${v.direct ? '' : ' <span class="muted">transitive</span>'}${v.dev ? ' <span class="muted">dev</span>' : ''}</td>
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
      (!state.status || (state.status === 'flagged' ? (p.status === 'problematic' || p.status === 'review') && !p.ignored : p.status === state.status)) &&
      (!state.eco || p.ecosystem === state.eco) &&
      (!state.scope || (state.scope === 'direct' ? p.direct : !p.direct)) &&
      (!q || p.name.toLowerCase().includes(q) || String(p.license).toLowerCase().includes(q)));
    const rank = { problematic: 0, review: 1, ok: 2 };
    rows.sort((a, b) => rank[a.status] - rank[b.status] || Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name));
    const total = rows.length;
    rows = rows.slice(0, state.limit);
    el.innerHTML = `<thead><tr><th>Package</th><th>Version</th><th>License</th><th>Category</th><th>Status</th><th>Scope</th><th class="num">Vulns</th><th>Declared in</th></tr></thead>
      <tbody>${rows.map(p => `<tr class="${p.dir ? 'clickable' : ''}" ${p.dir ? `data-dep-dir="${esc(p.dir)}"` : ''} title="${p.dir ? 'Open the package folder' : ''}">
        <td><b>${esc(p.name)}</b> <span class="dep-eco ${p.ecosystem === 'npm' ? 'npm' : 'py'}">${p.ecosystem}</span></td>
        <td>${esc(p.version || p.spec || '–')}${p.installed ? '' : ' <span class="muted">not installed</span>'}</td>
        <td>${esc(p.license)}</td>
        <td><span class="sw" style="background:${(CAT[p.category] || CAT.unknown).color}"></span>${esc((CAT[p.category] || CAT.unknown).label)}</td>
        <td>${p.ignored ? '<span class="dep-status ign">ignored</span>' : `<span class="dep-status ${p.status}">${p.status === 'problematic' ? 'problematic' : p.status === 'review' ? 'review' : 'ok'}</span>`}${p.notAllowed ? ' <span class="muted">not in allowlist</span>' : ''}</td>
        <td>${p.direct ? 'direct' : '<span class="muted">transitive</span>'}${p.dev ? ' <span class="muted">dev</span>' : ''}</td>
        <td class="num">${p.vulnCount ? `<span class="dep-bad">${fmt(p.vulnCount)}</span>` : ''}</td>
        <td class="muted">${esc((p.manifests || []).join(', '))}</td></tr>`).join('')}</tbody>`;
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
