// @ts-check
// "Pinboard": TODOs and notes ordered by priority (drag & drop), stored in .locomotive/pinboard.json.
(function () {
  const TAG_COLOR = { TODO: '#f7ae62', FIXME: '#e0621b', HACK: '#ff4d4f', XXX: '#b8480f', BUG: '#ff4d4f', NOTE: '#7aa2d6' };
  const state = { q: '', limit: 60, saveTimer: 0, status: '', installed: false, drag: null };
  const ago = d => (d == null ? '' : d >= 730 ? `${(d / 365).toFixed(1)} y` : d >= 60 ? `${Math.round(d / 30)} mo` : `${d} d`);
  const newId = kind => `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  /** the board lives in D.pinboard (resolved by the extension); TODO items know whether they are pinned (pinnedBy) */
  const board = D => D.pinboard;
  const items = D => (D.todos && D.todos.items) || [];
  const unpinned = D => items(D).filter(t => !t.pinnedBy);

  function cardHtml(ui, D, c) {
    const { esc } = ui;
    const B = board(D);
    const col = B.columns.findIndex(x => x.id === c.column);
    const tag = c.kind === 'note' ? 'NOTE' : c.tag;
    const where = c.kind === 'code'
      ? `<a class="file pb-loc" href="#" data-abs="${esc(c.abs || '')}" data-line="${c.line || 1}" title="Open ${esc(c.path)}:${c.line || ''}">${esc(c.path)}<span class="muted">:${c.line || '?'}</span></a>`
      : '<span class="muted">note</span>';
    const meta = [c.author && c.author !== 'Not Committed Yet' ? esc(c.author) : '', c.ageDays != null ? ago(c.ageDays) : '', c.assignee ? `@${esc(c.assignee)}` : ''].filter(Boolean).join(' · ');
    return `<div class="pb-card ${c.state === 'gone' ? 'gone' : ''}" draggable="true" data-pb-id="${esc(c.id)}">
      <div class="pb-head"><span class="sev" style="background:${TAG_COLOR[tag] || '#a0a0a0'}">${esc(tag)}</span>
        <span class="pb-tools">
          <button data-pb-move="up" title="Higher priority (move up)">▲</button><button data-pb-move="down" title="Lower priority (move down)">▼</button>
          <button data-pb-move="left" ${col <= 0 ? 'disabled' : ''} title="Move to the column on the left">◀</button><button data-pb-move="right" ${col >= B.columns.length - 1 ? 'disabled' : ''} title="Move to the column on the right">▶</button>
          <button data-pb-remove title="${c.kind === 'note' ? 'Delete note' : 'Unpin (back to unsorted)'}">✕</button>
        </span></div>
      <div class="pb-text">${esc(c.text || '(no text)')}</div>
      <div class="pb-foot">${where}${meta ? `<span class="muted">${meta}</span>` : ''}</div>
      ${c.state === 'gone' ? '<div class="pb-gone">Not in the code anymore – done? <button data-pb-remove>Remove</button></div>' : ''}
    </div>`;
  }

  function inboxHtml(ui, D) {
    const { esc } = ui;
    const q = state.q.toLowerCase();
    const list = unpinned(D).filter(t => !q || `${t.tag} ${t.text} ${t.path} ${t.author || ''}`.toLowerCase().includes(q));
    const B = board(D);
    const rows = list.slice(0, state.limit).map(t => {
      const i = items(D).indexOf(t);
      return `<div class="pb-card inbox" draggable="true" data-pb-todo="${i}">
        <div class="pb-head"><span class="sev" style="background:${TAG_COLOR[t.tag] || '#a0a0a0'}">${esc(t.tag)}</span>
          <span class="pb-tools">${B.columns.map(c => `<button data-pb-pin="${esc(c.id)}" title="Pin to ${esc(c.title)}">${esc(c.title.slice(0, 1))}</button>`).join('')}</span></div>
        <div class="pb-text">${esc(t.text || '(no text)')}</div>
        <div class="pb-foot"><a class="file pb-loc" href="#" data-abs="${esc(t.abs)}" data-line="${t.line}" title="Open ${esc(t.path)}:${t.line}">${esc(t.path)}<span class="muted">:${t.line}</span></a>${t.ageDays != null ? `<span class="muted">${ago(t.ageDays)}</span>` : ''}</div>
      </div>`;
    }).join('');
    return `${rows || `<p class="muted pb-empty">${items(D).length ? 'Every TODO from the code is on the board.' : 'No TODO comments in the code.'}</p>`}${list.length > state.limit ? `<button class="btn" data-pb-more>Show all ${ui.fmt(list.length)}</button>` : ''}`;
  }

  function boardHtml(ui, D) {
    const { esc } = ui;
    const B = board(D);
    const cols = B.columns.map(col => {
      const cards = B.cards.filter(c => c.column === col.id);
      return `<div class="pb-col" data-pb-col="${esc(col.id)}">
        <div class="pb-col-head"><b>${esc(col.title)}</b><span class="dep-chip">${cards.length}</span></div>
        <div class="pb-list" data-pb-drop="${esc(col.id)}">${cards.map(c => cardHtml(ui, D, c)).join('') || '<p class="muted pb-empty">Drop TODOs here</p>'}</div>
        <input class="pb-add" data-pb-add="${esc(col.id)}" type="text" placeholder="+ Note (Enter)" maxlength="500">
      </div>`;
    }).join('');
    const open = unpinned(D).length;
    return `<div class="pb-board" style="--pb-cols:${B.columns.length}">${cols}
      <div class="pb-col pb-inbox">
        <div class="pb-col-head"><b>Unsorted from the code</b><span class="dep-chip">${open}</span></div>
        <input id="pbQ" type="search" placeholder="Filter TODOs…" value="${esc(state.q)}">
        <div class="pb-list" data-pb-drop="">${inboxHtml(ui, D)}</div>
      </div></div>`;
  }

  function render(ui, D) {
    if (!board(D)) return '';
    install(ui);
    const B = board(D);
    const gone = B.cards.filter(c => c.state === 'gone').length;
    return ui.card('Pinboard – TODOs by priority', `<div id="pinboard">${boardHtml(ui, D)}</div>`, {
      sub: `drag cards to order them · top = most important · saved in ${ui.esc(B.file || '.locomotive/pinboard.json')}${gone ? ` · ${gone} done?` : ''} <span id="pb-status" class="muted">${ui.esc(state.status)}</span>`,
    });
  }

  function refresh(ui, D) {
    const el = document.getElementById('pinboard');
    if (el) el.innerHTML = boardHtml(ui, D);
  }

  /** persists the order (debounced) – only the stored fields, not the resolved location */
  function save(ui, D) {
    clearTimeout(state.saveTimer);
    setStatus('saving…');
    state.saveTimer = setTimeout(() => {
      const B = board(D);
      ui.post({ type: 'savePinboard', board: { columns: B.columns, cards: B.cards.map(c => Object.fromEntries(['id', 'column', 'kind', 'path', 'tag', 'text', 'line', 'note'].filter(k => c[k] !== undefined).map(k => [k, c[k]]))) } });
    }, 250);
  }
  function setStatus(s) { state.status = s; const el = document.getElementById('pb-status'); if (el) el.textContent = s; }

  // ---------- board operations ----------
  function pin(D, todoIndex, column, before) {
    const t = items(D)[todoIndex];
    if (!t || t.pinnedBy) return;
    const c = { id: newId('todo'), column, kind: 'code', path: t.pin || t.path, tag: t.tag, text: t.text || '', line: t.line, state: 'open', abs: t.abs, author: t.author, ageDays: t.ageDays, assignee: t.assignee };
    t.pinnedBy = c.id;
    insert(D, c, column, before);
  }
  function insert(D, c, column, before) {
    const B = board(D);
    c.column = column;
    const at = before ? B.cards.findIndex(x => x.id === before) : -1;
    if (at >= 0) B.cards.splice(at, 0, c);
    else {
      // append after the last card of that column (keeps the array grouped and stable)
      let last = -1;
      B.cards.forEach((x, i) => { if (x.column === column) last = i; });
      B.cards.splice(last + 1 || B.cards.length, 0, c);
    }
  }
  function take(D, id) {
    const B = board(D);
    const i = B.cards.findIndex(c => c.id === id);
    return i >= 0 ? B.cards.splice(i, 1)[0] : null;
  }
  function remove(D, id) {
    const c = take(D, id);
    if (!c) return;
    for (const t of items(D)) if (t.pinnedBy === id) delete t.pinnedBy;
  }
  function move(D, id, dir) {
    const B = board(D);
    const c = B.cards.find(x => x.id === id);
    if (!c) return;
    if (dir === 'left' || dir === 'right') {
      const k = B.columns.findIndex(x => x.id === c.column) + (dir === 'left' ? -1 : 1);
      if (k < 0 || k >= B.columns.length) return;
      take(D, id);
      insert(D, c, B.columns[k].id, null);
      return;
    }
    const same = B.cards.filter(x => x.column === c.column);
    const k = same.indexOf(c) + (dir === 'up' ? -1 : 1);
    if (k < 0 || k >= same.length) return;
    const other = same[k];
    const a = B.cards.indexOf(c), b = B.cards.indexOf(other);
    B.cards[a] = other; B.cards[b] = c;
  }

  function handleClick(ui, D, t) {
    if (!board(D) || !t.closest('#pinboard')) return false;
    const card = /** @type {HTMLElement|null} */ (t.closest('[data-pb-id]'));
    const mv = t.closest('[data-pb-move]');
    if (mv && card) { move(D, card.dataset.pbId || '', /** @type {HTMLElement} */ (mv).dataset.pbMove); refresh(ui, D); save(ui, D); return true; }
    if (t.closest('[data-pb-remove]') && card) { remove(D, card.dataset.pbId || ''); refresh(ui, D); save(ui, D); return true; }
    const pinBtn = t.closest('[data-pb-pin]');
    const todo = /** @type {HTMLElement|null} */ (t.closest('[data-pb-todo]'));
    if (pinBtn && todo) { pin(D, Number(todo.dataset.pbTodo), /** @type {HTMLElement} */ (pinBtn).dataset.pbPin || '', null); refresh(ui, D); save(ui, D); return true; }
    if (t.closest('[data-pb-more]')) { state.limit = Infinity; refresh(ui, D); return true; }
    return false; // file links are opened by the page
  }
  function handleInput(ui, D, t) {
    if (t.id === 'pbQ' && board(D)) {
      state.q = /** @type {HTMLInputElement} */ (t).value;
      const list = document.querySelector('.pb-inbox .pb-list');
      if (list) list.innerHTML = inboxHtml(ui, D);
      return true;
    }
    return false;
  }

  /** drag & drop + Enter in the note fields; installed once, works on whatever board is rendered */
  function install(ui) {
    if (state.installed) return;
    state.installed = true;
    const D = () => ui.data();
    const marker = document.createElement('div');
    marker.className = 'pb-marker';
    document.addEventListener('dragstart', ev => {
      const el = /** @type {HTMLElement} */ (ev.target);
      if (!(el instanceof HTMLElement) || !el.closest('#pinboard')) return;
      const card = /** @type {HTMLElement|null} */ (el.closest('.pb-card'));
      if (!card) return;
      state.drag = card.dataset.pbId ? { id: card.dataset.pbId } : { todo: Number(card.dataset.pbTodo) };
      card.classList.add('dragging');
      if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', 'pinboard'); }
    });
    document.addEventListener('dragend', () => {
      state.drag = null;
      marker.remove();
      document.querySelectorAll('.pb-card.dragging').forEach(e => e.classList.remove('dragging'));
      document.querySelectorAll('.pb-list.over').forEach(e => e.classList.remove('over'));
    });
    const target = ev => {
      const list = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (ev.target).closest && /** @type {HTMLElement} */ (ev.target).closest('#pinboard .pb-list'));
      if (!list) return null;
      const cards = [...list.querySelectorAll('.pb-card:not(.dragging)')];
      const before = /** @type {HTMLElement|undefined} */ (cards.find(c => { const r = c.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; }));
      return { list, before };
    };
    document.addEventListener('dragover', ev => {
      if (!state.drag) return;
      const tg = target(ev);
      if (!tg) return;
      ev.preventDefault();
      document.querySelectorAll('.pb-list.over').forEach(e => { if (e !== tg.list) e.classList.remove('over'); });
      tg.list.classList.add('over');
      if (tg.list.dataset.pbDrop) { if (tg.before) tg.list.insertBefore(marker, tg.before); else tg.list.appendChild(marker); } else marker.remove();
    });
    document.addEventListener('drop', ev => {
      if (!state.drag) return;
      const tg = target(ev);
      if (!tg) return;
      ev.preventDefault();
      const data = D();
      const column = tg.list.dataset.pbDrop || '';
      const before = tg.before && tg.before.dataset.pbId ? tg.before.dataset.pbId : null;
      const d = state.drag;
      state.drag = null;
      marker.remove();
      if (!column) { // dropped on "unsorted": unpin code cards, notes stay
        if (d.id) { const c = board(data).cards.find(x => x.id === d.id); if (c && c.kind === 'code') remove(data, d.id); }
      } else if (d.id) {
        if (d.id === before) return;
        const c = take(data, d.id);
        if (c) insert(data, c, column, before);
      } else pin(data, d.todo, column, before);
      refresh(ui, data);
      save(ui, data);
    });
    document.addEventListener('keydown', ev => {
      const el = /** @type {HTMLInputElement} */ (ev.target);
      if (ev.key !== 'Enter' || !(el instanceof HTMLInputElement) || !el.dataset.pbAdd) return;
      const text = el.value.trim();
      if (!text) return;
      ev.preventDefault();
      const data = D();
      insert(data, { id: newId('note'), kind: 'note', text, state: 'note', column: el.dataset.pbAdd }, el.dataset.pbAdd, null);
      refresh(ui, data);
      save(ui, data);
      const again = /** @type {HTMLInputElement|null} */ (document.querySelector(`#pinboard [data-pb-add="${el.dataset.pbAdd}"]`));
      if (again) again.focus();
    });
    window.addEventListener('message', ev => {
      if (ev.data && ev.data.type === 'pinboardSaved') setStatus(ev.data.error ? `not saved: ${ev.data.error}` : 'saved');
    });
  }

  window.LCPinboard = { render, handleClick, handleInput };
})();
