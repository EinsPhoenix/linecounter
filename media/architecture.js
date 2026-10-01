// @ts-check
// "Architecture" section: configurable import rules / layers and their violations.
(function () {
  const EXAMPLE = `// .locomotive/settings.json
{
  "architecture.rules": [
    { "name": "UI never talks to the database", "from": "src/ui/**", "disallow": ["src/db/**"], "allow": ["src/db/types.ts"] },
    { "from": "src/core/**", "disallow": ["src/plugins/**"], "severity": "warning" }
  ],
  "architecture.layers": [
    { "name": "ui", "pattern": "src/ui/**" },
    { "name": "services", "pattern": "src/services/**" },
    { "name": "db", "pattern": "src/db/**" }
  ]
}`;
  let filter = '';

  function listHtml(ui, A) {
    const { esc } = ui;
    const items = A.violations.filter(v => !filter || v.rule === filter);
    if (!items.length) return '<p class="dep-okmsg">No violations. The architecture holds.</p>';
    return `<div class="table-scroll small"><table class="grid"><thead><tr><th>Importing file</th><th></th><th>Imported file</th><th>Rule</th></tr></thead><tbody>
      ${items.slice(0, 400).map(v => `<tr>
        <td><a href="#" class="file" data-abs="${esc(v.from.abs)}">${esc(v.from.path)}</a></td><td class="arch-arrow">→</td>
        <td><a href="#" class="file" data-abs="${esc(v.to.abs)}">${esc(v.to.path)}</a></td>
        <td><span class="sev" style="background:${v.severity === 'warning' ? '#f7ae62' : '#ff4d4f'}">${esc(v.severity)}</span> ${esc(v.rule)}${v.detail ? `<br><span class="muted">${esc(v.detail)}</span>` : ''}</td></tr>`).join('')}
      </tbody></table></div>${items.length > 400 ? `<p class="muted">${items.length - 400} more…</p>` : ''}`;
  }

  function render(ui, D) {
    const A = D.architecture;
    const { esc, fmt, card, tiles, hbars } = ui;
    if (!A || !A.configured) {
      return card('Architecture rules', `<p>Describe which parts of the code may import which – violations show up here and in red in the import graph, and the quality gate can fail on them.</p>
        <pre class="arch-example">${esc(EXAMPLE)}</pre>
        <button class="btn" data-arch-settings>Open .locomotive/settings.json</button>`);
    }
    const errors = A.violations.filter(v => v.severity === 'error').length;
    return `<div id="arch-body">${tiles([
        { label: 'Rules', value: fmt(A.rules.length) },
        { label: 'Violations', html: `<span class="${A.total ? 'dep-bad' : ''}">${fmt(A.total)}</span>`, sub: `${fmt(errors)} errors · ${fmt(A.total - errors)} warnings` },
        { label: 'Imports checked', value: fmt(A.checkedEdges) },
      ])}
      <div class="grid-2 hl-bottom">
        ${card('Rules', hbars(A.rules.map(r => ({ label: r.name, value: r.violations, valueLabel: r.violations ? fmt(r.violations) : '✓', color: r.violations ? (r.severity === 'warning' ? '#f7ae62' : '#ff4d4f') : '#3ddc84', attrs: `data-arch-rule="${esc(r.name)}"`, tip: `<b>${esc(r.name)}</b><br>${fmt(r.violations)} violations<br><i>click to filter</i>` }))), { sub: 'click a rule to filter' })}
        ${card('Violations', `<div class="arch-tools">${filter ? `<span class="dep-filter">${esc(filter)} <button class="link" data-arch-rule="">clear</button></span>` : ''}${A.total ? '<button class="btn" data-arch-graph>Show in import graph</button>' : ''}</div><div id="arch-list">${listHtml(ui, A)}</div>`)}
      </div></div>`;
  }

  function handleClick(ui, D, t) {
    const A = D.architecture;
    if (t.closest('[data-arch-settings]')) { ui.post({ type: 'openSettings' }); return true; }
    if (!A) return false;
    const r = t.closest('[data-arch-rule]');
    if (r) {
      filter = /** @type {HTMLElement} */ (r).dataset.archRule || '';
      const body = document.getElementById('arch-body');
      if (body) body.outerHTML = render(ui, D);
      return true;
    }
    if (t.closest('[data-arch-graph]')) {
      if (window.LCStatsGraphs && LCStatsGraphs.highlightViolations) LCStatsGraphs.highlightViolations();
      return true;
    }
    return false;
  }

  function rants(ui, D) {
    const A = D.architecture;
    if (!A || !A.total) return [];
    const top = A.violations[0];
    return [['🏗️', `${ui.fmt(A.total)} architecture violation${A.total === 1 ? '' : 's'} (e.g. ${ui.esc(top.from.path.split('/').pop())} → ${ui.esc(top.to.path.split('/').pop())}). The architecture diagram is more of a suggestion, apparently.`]];
  }

  window.LCArch = { render, handleClick, rants };
})();
