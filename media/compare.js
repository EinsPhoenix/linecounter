// @ts-check
// "Branch comparison": the current branch (incl. uncommitted changes) against a base branch.
(function () {
  const STATUS = { added: '#3ddc84', deleted: '#ff4d4f', renamed: '#6c8ebf', modified: '#f7ae62' };

  function picker(ui, C) {
    const { esc } = ui;
    return `<div class="cmp-picker">
      <span class="muted">Compare <b>${esc(C.head || 'HEAD')}</b> with</span>
      <select id="cmpBase">${(C.branches || []).filter(b => b !== C.head).map(b => `<option value="${esc(b)}" ${b === C.base ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <button class="btn primary" data-cmp-run data-root="${esc(C.root || '')}">Compare</button>
      <span id="cmpBusy" class="muted"></span></div>`;
  }

  function body(ui, C) {
    const { esc, fmt, card, tiles, hbars } = ui;
    if (C.error) return `<p class="dep-warn">${esc(C.error)}</p>`;
    if (C.idle) return `<p class="muted">You are on <b>${esc(C.head || '')}</b>${C.base ? ` – the base branch` : ''}. Pick another branch above to see what differs.</p>`;
    const dcx = C.complexity.after - C.complexity.before;
    const fileRows = C.files.slice(0, 200).map(f => `<tr class="${f.status === 'deleted' ? '' : 'clickable'}" ${f.status === 'deleted' ? '' : `data-abs="${esc(f.abs)}"`}>
      <td><span class="sev" style="background:${STATUS[f.status]}">${f.status}</span></td><td class="hl-path">${esc(f.path)}${f.from ? ` <span class="muted">← ${esc(f.from)}</span>` : ''}</td>
      <td class="num cmp-add">+${fmt(f.added)}</td><td class="num cmp-del">−${fmt(f.deleted)}</td>
      <td class="num">${f.cxAfter != null ? `${fmt(f.cxBefore)} → <b class="${f.cxAfter > f.cxBefore ? 'dep-bad' : ''}">${fmt(f.cxAfter)}</b>` : '<span class="muted">–</span>'}</td></tr>`).join('');
    return `${tiles([
        { label: 'Commits', value: `${fmt(C.ahead)} ahead`, sub: `${fmt(C.behind)} behind ${esc(C.base)} · merge base ${esc(C.mergeBase)}` },
        { label: 'Files changed', value: fmt(C.totals.files), sub: `${fmt(C.totals.newFiles)} new · ${fmt(C.totals.deletedFiles)} deleted` },
        { label: 'Lines', html: `<span class="cmp-add">+${fmt(C.totals.added)}</span> <span class="cmp-del">−${fmt(C.totals.deleted)}</span>` },
        { label: 'Complexity', html: `<span class="${dcx > 0 ? 'dep-bad' : 'cmp-add'}">${dcx > 0 ? '+' : ''}${fmt(dcx)}</span>`, sub: `${fmt(C.complexity.before)} → ${fmt(C.complexity.after)} in changed files` },
        { label: 'New TODOs', value: fmt(C.todos.length) },
        { label: 'New secrets', html: `<span class="${C.secrets.length ? 'dep-bad' : ''}">${fmt(C.secrets.length)}</span>` },
        { label: 'Dependency changes', value: fmt(C.deps.length), sub: `${C.deps.filter(d => d.change === 'added').length} added · ${C.deps.filter(d => d.change === 'removed').length} removed` },
      ])}
      ${C.secrets.length ? `<div class="cmp-alert">🔑 This branch adds hard-coded secrets: ${C.secrets.map(s => `<a href="#" class="file" data-abs="${esc(s.abs)}" data-line="${s.line}">${esc(s.path)}:${s.line} (${esc(s.name)})</a>`).join(', ')}</div>` : ''}
      ${card('Changed files', `<div class="table-scroll small"><table class="grid"><thead><tr><th></th><th>File</th><th class="num">Added</th><th class="num">Deleted</th><th class="num">Complexity</th></tr></thead><tbody>${fileRows}</tbody></table></div>`, { sub: 'biggest changes first · complexity before → after' })}
      <div class="grid-2 hl-bottom">
        ${card('New or more complex functions', C.complexity.newFunctions.length || C.complexity.grown.length ? `<div class="table-scroll small"><table class="grid"><thead><tr><th>Function</th><th>File</th><th class="num">Complexity</th></tr></thead><tbody>
          ${[...C.complexity.newFunctions.map(f => ({ ...f, label: 'new' })), ...C.complexity.grown.map(f => ({ ...f, label: `was ${f.before}` }))].sort((a, b) => b.complexity - a.complexity).slice(0, 40).map(f => `<tr class="clickable" data-abs="${esc(f.abs)}" data-line="${f.line}"><td><b class="hl-fn">${esc(f.name)}</b>() <span class="dep-tag">${esc(f.label)}</span></td><td class="hl-path">${esc(f.path)}:${f.line}</td><td class="num"><b class="${f.complexity > 15 ? 'dep-bad' : ''}">${fmt(f.complexity)}</b></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="dep-okmsg">No function got more complex.</p>')}
        ${card('Commits in this branch', C.commits.length ? `<ol class="cmp-commits">${C.commits.slice(0, 30).map(c => `<li><code>${esc(c.hash)}</code> ${esc(c.subject)} <span class="muted">· ${esc(c.author)} · ${new Date(c.time).toLocaleDateString()}</span></li>`).join('')}</ol>${C.authors.length ? `<div class="muted">by ${C.authors.map(a => `${esc(a.name)} (${a.commits})`).join(', ')}</div>` : ''}` : '<p class="muted">No commits yet – only uncommitted changes.</p>')}
      </div>
      <div class="grid-2 hl-bottom">
        ${card('Dependency changes', C.deps.length ? `<ul class="dep-rows">${C.deps.map(d => `<li class="dep-row"><span class="dep-row-main"><b>${esc(d.name)}</b> <span class="dep-tag ${d.change === 'removed' ? 'prod' : d.change === 'added' ? 'trans' : ''}">${d.change}</span></span><span class="dep-row-hint">${d.from ? esc(d.from) + ' → ' : ''}${esc(d.to || '')} · ${esc(d.manifest)}</span></li>`).join('')}</ul>` : '<p class="muted">No manifest changes.</p>')}
        ${card('New TODOs', C.todos.length ? `<ul class="dep-rows">${C.todos.map(t => `<li class="dep-row clickable" data-abs="${esc(t.abs)}" data-line="${t.line}"><span class="dep-row-main"><b>${esc(t.tag)}</b> ${esc(t.text)}</span><span class="dep-row-hint">${esc(t.path)}:${t.line}</span></li>`).join('')}</ul>` : '<p class="dep-okmsg">No new TODOs.</p>')}
      </div>`;
  }

  function render(ui, D) {
    const C = D.compare;
    if (!C) return '';
    return `<div id="cmp-root">${picker(ui, C)}<div id="cmp-body">${body(ui, C)}</div></div>`;
  }

  function handleClick(ui, D, t) {
    const b = t.closest('[data-cmp-run]');
    if (!b) return false;
    const sel = /** @type {HTMLSelectElement} */ (document.getElementById('cmpBase'));
    const busy = document.getElementById('cmpBusy');
    if (busy) busy.textContent = 'comparing…';
    ui.post({ type: 'compare', root: /** @type {HTMLElement} */ (b).dataset.root, base: sel ? sel.value : '' });
    return true;
  }

  /** result from the extension */
  function show(ui, D, result) {
    D.compare = { ...result, branches: result.branches || (D.compare && D.compare.branches) || [] };
    const el = document.getElementById('cmp-root');
    if (el) el.outerHTML = render(ui, D);
  }

  function rants(ui, D) {
    const C = D.compare;
    if (!C || C.idle || C.error) return [];
    const out = [];
    if (C.secrets.length) out.push(['🔑', `This branch adds ${ui.fmt(C.secrets.length)} hard-coded secret${C.secrets.length === 1 ? '' : 's'}. Please don't merge your passwords.`]);
    if (C.totals.added > 3000) out.push(['🐘', `${ui.fmt(C.totals.added)} added lines in one branch. Reviewers will "LGTM" this without reading, guaranteed.`]);
    if (C.complexity.after - C.complexity.before > 50) out.push(['🧩', `This branch adds ${ui.fmt(C.complexity.after - C.complexity.before)} points of complexity. Future you is not amused.`]);
    return out;
  }

  window.LCCompare = { render, handleClick, show, rants };
})();
