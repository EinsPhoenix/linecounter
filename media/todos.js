// @ts-check
// "TODO tracker": every TODO / FIXME / HACK / XXX / BUG with author and age (git blame).
(function () {
  const TAG_COLOR = { TODO: '#f7ae62', FIXME: '#e0621b', HACK: '#ff4d4f', XXX: '#b8480f', BUG: '#ff4d4f' };
  const state = { tag: '', q: '', limit: 150 };
  const ago = d => (d == null ? '–' : d >= 730 ? `${(d / 365).toFixed(1)} y` : d >= 60 ? `${Math.round(d / 30)} mo` : `${d} d`);

  function rows(ui, T) {
    const { esc } = ui;
    const q = state.q.toLowerCase();
    const list = T.items.filter(t => (!state.tag || t.tag === state.tag) && (!q || `${t.text} ${t.path} ${t.author || ''} ${t.assignee || ''}`.toLowerCase().includes(q)));
    if (!list.length) return '<p class="muted">No TODOs match.</p>';
    return `<div class="table-scroll small"><table class="grid"><thead><tr><th>Age</th><th>Tag</th><th>Comment</th><th>File</th><th>Author</th></tr></thead><tbody>
      ${list.slice(0, state.limit).map(t => `<tr class="clickable" data-abs="${esc(t.abs)}" data-line="${t.line}" title="Open ${esc(t.path)}:${t.line}">
        <td class="num todo-age ${t.ageDays >= 365 ? 'old' : ''}">${t.uncommitted ? '<span class="muted">new</span>' : ago(t.ageDays)}</td>
        <td><span class="sev" style="background:${TAG_COLOR[t.tag] || '#a0a0a0'}">${esc(t.tag)}</span></td>
        <td>${esc(t.text || '(no text)')}${t.assignee ? ` <span class="dep-tag">@${esc(t.assignee)}</span>` : ''}</td>
        <td class="hl-path">${esc(t.path)}<span class="muted">:${t.line}</span></td>
        <td>${t.uncommitted ? '<span class="muted">you (uncommitted)</span>' : esc(t.author || '–')}</td></tr>`).join('')}
      </tbody></table></div>${list.length > state.limit ? `<button class="btn" data-todo-more>Show all ${ui.fmt(list.length)}</button>` : ''}`;
  }

  function render(ui, D) {
    const T = D.todos;
    if (!T) return ui.card('TODO tracker', '<p class="dep-okmsg">No TODO, FIXME, HACK, XXX or BUG comments. Either everything is done, or nobody writes it down.</p>');
    const { esc, fmt, card, tiles, columns, hbars, donut } = ui;
    const o = T.oldest;
    return `${tiles([
        { label: 'Open TODOs', value: fmt(T.total), sub: T.byTag.map(t => `${t.count} ${t.label}`).join(' · ') },
        { label: 'Oldest', html: o ? `<span class="${o.ageDays >= 365 ? 'dep-bad' : ''}">${ago(o.ageDays)}</span>` : '–', sub: o ? `${esc(o.path.split('/').pop())}:${o.line} · ${esc(o.author || '')}` : '' },
        { label: 'Average age', value: T.avgAgeDays != null ? ago(T.avgAgeDays) : '–', sub: `${fmt(T.blamed)} dated with git blame` },
      ])}
      <div class="grid-3">
        ${card('Age of TODOs', columns(T.ages.map(a => ({ label: a.label, value: a.count })), { color: '#e0621b' }))}
        ${card('By tag', donut(T.byTag.map(t => ({ label: t.label, value: t.count, color: TAG_COLOR[t.label] || '#a0a0a0', attrs: `data-todo-tag="${esc(t.label)}"` })), fmt(T.total), 'open'), { sub: 'click to filter' })}
        ${card('Who wrote them', hbars(T.byAuthor.map(a => ({ label: a.label === 'unknown' ? 'not in git' : a.label, value: a.count, color: '#a0a0a0' }))))}
      </div>
      ${card('All TODOs – oldest first', `<div class="table-tools"><span class="rant-chips"><button class="rant-chip ${!state.tag ? 'on' : ''}" data-todo-tag="">All</button>${T.byTag.map(t => `<button class="rant-chip ${state.tag === t.label ? 'on' : ''}" data-todo-tag="${esc(t.label)}">${esc(t.label)} ${fmt(t.count)}</button>`).join('')}</span>
        <input id="todoQ" type="search" placeholder="Filter text, file, author…" value="${esc(state.q)}"></div><div id="todo-rows">${rows(ui, T)}</div>`, { sub: 'click a row to jump to the comment' })}`;
  }

  function refresh(ui, D) { const el = document.getElementById('todo-rows'); if (el) el.innerHTML = rows(ui, D.todos); }

  function handleClick(ui, D, t) {
    if (!D.todos) return false;
    const tag = t.closest('[data-todo-tag]');
    if (tag) {
      state.tag = /** @type {HTMLElement} */ (tag).dataset.todoTag || '';
      document.querySelectorAll('.rant-chip[data-todo-tag]').forEach(b => b.classList.toggle('on', /** @type {HTMLElement} */ (b).dataset.todoTag === state.tag));
      refresh(ui, D);
      return true;
    }
    if (t.closest('[data-todo-more]')) { state.limit = Infinity; refresh(ui, D); return true; }
    return false;
  }
  function handleInput(ui, D, t) {
    if (t.id === 'todoQ' && D.todos) { state.q = /** @type {HTMLInputElement} */ (t).value; refresh(ui, D); return true; }
    return false;
  }
  function rants(ui, D) {
    const T = D.todos;
    if (!T || !T.oldest || T.oldest.ageDays == null) return [];
    const o = T.oldest;
    return o.ageDays >= 365 ? [['🦖', `The oldest TODO (“${ui.esc((o.text || o.tag).slice(0, 60))}” in ${ui.esc(o.path.split('/').pop())}) is ${(o.ageDays / 365).toFixed(1)} years old. At this point it's not a TODO, it's a monument.`]] : [];
  }

  window.LCTodos = { render, handleClick, handleInput, rants };
})();
