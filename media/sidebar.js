// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const MAX_ROWS = 3000;

  /** @type {any[]} */ let roots = [];
  /** @type {{id:string,label:string,user?:boolean,patterns?:string[],source?:string}[]} */ let presets = [];
  let enabledPresets = new Set();
  let excluded = new Set();
  let included = new Set();
  let hiddenExt = new Set();
  let libraries = false;
  /** project root: key of a folder ("<workspace>/<rel>") whose subtree is analyzed instead of the whole workspace */
  let base = null;
  let expanded = new Set();
  let query = '';
  let pendingStats = false;
  let loaded = false;
  let busyText = '';
  /** @type {{name:string, savedAt:string|null, excluded:number, hiddenExt:number}[]} */ let userPresets = [];
  let activePreset = null;
  let hasWorkspace = true;
  const ui = vscode.getState() || { filtersOpen: true, typesOpen: true };

  /** @type {any[]} */ let allNodes = [];
  /** @type {any[]} */ let rows = [];
  const extCounts = new Map();

  const svg = d => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style="pointer-events:none"><path d="${d}"/></svg>`;
  const SVG = {
    save: svg('M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7'),
    trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
    gear: svg('M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'),
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const extOf = name => {
    const i = name.lastIndexOf('.');
    return i <= 0 || i === name.length - 1 ? '(none)' : '.' + name.slice(i + 1).toLowerCase();
  };

  // ---------- tree model ----------
  function prepare() {
    allNodes = [];
    extCounts.clear();
    roots.forEach((root, r) => {
      root.key = root.name;
      root.c = root.children;
      root.d = 1; root.n = root.name; root.isRoot = true; root.rel = ''; root.r = r; root.depth = 0;
      const walk = (node, parent) => {
        for (const c of node.c || []) {
          c.parent = node;
          c.r = r;
          c.rel = node.rel ? node.rel + '/' + c.n : c.n;
          c.key = root.name + '/' + c.rel;
          c.depth = node.depth + 1;
          allNodes.push(c);
          if (!c.d) {
            c.ext = extOf(c.n);
            extCounts.set(c.ext, (extCounts.get(c.ext) || 0) + 1);
          } else walk(c, node);
        }
      };
      walk(root, null);
    });
    if (!expanded.size) roots.forEach(r => expanded.add(r.key));
    if (base && !baseNode()) base = null; // folder no longer exists
    if (base) expanded.add(base);
  }
  const baseNode = () => (base ? allNodes.find(n => n.d && n.key === base) || null : null);
  /** top-level rows of the tree: the project root folder, or the workspace roots */
  const treeRoots = () => { const b = baseNode(); return b ? [b] : roots; };
  const depthOf = n => n.depth - (baseNode() ? baseNode().depth : 0);

  const selfExcluded = n => !n.isRoot && (excluded.has(n.key) || (!!n.p && !included.has(n.key)));
  function isExcluded(n) {
    if (!n.d && hiddenExt.has(n.ext)) return true;
    for (let x = n; x; x = x.parent) if (selfExcluded(x)) return true;
    return false;
  }
  const excludeReason = n => {
    if (excluded.has(n.key)) return 'excluded';
    if (n.p && !included.has(n.key)) return (presets.find(p => p.id === n.p) || { label: n.p }).label;
    if (!n.d && hiddenExt.has(n.ext)) return 'type hidden';
    return '';
  };

  function matcher() {
    const q = query.trim();
    if (!q) return null;
    if (/[*?]/.test(q)) {
      const re = new RegExp('^' + q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
      return n => re.test(n.n) || re.test(n.rel);
    }
    const lq = q.toLowerCase();
    return q.includes('/') ? n => n.rel.toLowerCase().includes(lq) : n => n.n.toLowerCase().includes(lq);
  }

  function computeRows() {
    rows = [];
    const match = matcher();
    let total = 0;
    if (match) {
      // keep nodes that match or have matching descendants
      const keep = new Set();
      for (const n of allNodes) {
        if (match(n)) {
          n._match = true;
          for (let x = n; x; x = x.parent) { if (keep.has(x)) break; keep.add(x); }
        } else n._match = false;
      }
      const walk = node => {
        for (const c of node.c || []) {
          if (!keep.has(c)) continue;
          total++;
          if (rows.length < MAX_ROWS) rows.push(c);
          if (c.d && (!c._match || expanded.has(c.key))) walk(c);
        }
      };
      for (const r of treeRoots()) { rows.push(r); walk(r); }
      return { total, matches: allNodes.filter(n => n._match).length };
    }
    const walk = node => {
      if (!expanded.has(node.key)) return;
      for (const c of node.c || []) {
        c._match = false;
        total++;
        if (rows.length < MAX_ROWS) rows.push(c);
        if (c.d) walk(c);
      }
    };
    for (const r of treeRoots()) { rows.push(r); walk(r); }
    return { total, matches: 0 };
  }

  function includedFiles() {
    const out = [];
    const walk = node => {
      for (const c of node.c || []) {
        if (selfExcluded(c)) continue;
        if (c.d) walk(c);
        else if (!hiddenExt.has(c.ext)) out.push(c);
      }
    };
    treeRoots().forEach(walk);
    return out;
  }

  function save(rescan) {
    vscode.postMessage({ type: 'saveState', excluded: [...excluded], included: [...included], hiddenExt: [...hiddenExt], libraries, base, rescan: !!rescan });
  }

  function toggle(n) {
    if (n.isRoot) return;
    let rescan = false;
    if (excluded.has(n.key)) excluded.delete(n.key);
    else if (n.p && !included.has(n.key)) { included.add(n.key); rescan = !!n.u; }
    else if (n.p && included.has(n.key)) included.delete(n.key);
    else excluded.add(n.key);
    save(rescan);
    if (rescan) { busyText = 'Scanning ' + n.n + '…'; }
    render();
  }

  // ---------- rendering ----------
  function render() {
    if (!loaded) {
      app.innerHTML = `<div class="empty">${esc(busyText || 'Loading…')}</div>`;
      return;
    }
    if (!roots.length) {
      app.innerHTML = '<div class="empty">Open a folder or workspace to count lines.</div>';
      return;
    }
    const scrollTop = (document.getElementById('tree') || {}).scrollTop || 0;
    const { total, matches } = computeRows();
    const incFiles = includedFiles();
    const bn = baseNode();
    const totalFiles = allNodes.filter(n => !n.d && (!bn || n.key.startsWith(bn.key + '/'))).length;
    const exts = [...extCounts.entries()].sort((a, b) => b[1] - a[1]);
    const incByExt = new Map();
    for (const f of incFiles) incByExt.set(f.ext, (incByExt.get(f.ext) || 0) + 1);

    const presetHtml = presets.filter(p => !p.user).map(p => `
      <label class="check"><input type="checkbox" data-preset="${esc(p.id)}" ${enabledPresets.has(p.id) ? 'checked' : ''}>
      <span>${esc(p.label)}</span></label>`).join('');
    const userFilters = presets.filter(p => p.user);
    const userHtml = `<div class="ufilters">
        <div class="ufilters-title">My filters <span class="muted">(.locomotive/filters.json)</span></div>
        ${userFilters.map(p => `<div class="ufilter">
          <label class="check"><input type="checkbox" data-preset="${esc(p.id)}" ${enabledPresets.has(p.id) ? 'checked' : ''}>
            <span>${esc(p.label)}${p.label !== (p.patterns || []).join(', ') ? ` <span class="muted">${esc((p.patterns || []).join(', '))}</span>` : ''}</span></label>
          ${p.source === 'settings' ? '<span class="muted" title="Defined in locomotive.customFilters">settings</span>' : `<button class="icon-btn2 ufilter-del" data-filter-del="${esc(p.id)}" data-label="${esc(p.label)}" title="Delete this filter">${SVG.trash}</button>`}
        </div>`).join('') || '<div class="muted ufilter-empty">No own filters yet.</div>'}
        <form class="ufilter-add" id="filterAdd">
          <input id="filterPat" type="text" placeholder="Pattern, e.g. */data, *.generated.ts, docs/" spellcheck="false" title="Glob patterns, comma separated. */data = every folder named data below another folder, **/x = anywhere, x/ = folder">
          <input id="filterName" type="text" placeholder="Name (optional)" spellcheck="false">
          <button class="icon-btn2" type="submit" title="Add filter">+</button>
        </form>
      </div>`;

    const extHtml = exts.map(([e, c]) => `
      <label class="chip ${hiddenExt.has(e) ? 'off' : ''}" title="${hiddenExt.has(e) ? 'Hidden – click to show' : 'Shown – click to hide'}">
        <input type="checkbox" data-ext="${esc(e)}" ${hiddenExt.has(e) ? '' : 'checked'}>
        <span class="chip-name">${esc(e)}</span><span class="chip-count">${c}</span>
      </label>`).join('');

    const rowHtml = rows.map((n, i) => {
      const ex = isExcluded(n);
      const self = selfExcluded(n) || (!n.d && hiddenExt.has(n.ext));
      const reason = self ? excludeReason(n) : '';
      const isOpen = n.d && (expanded.has(n.key) || (query && !n._match && !n.isRoot));
      const twisty = n.d ? `<span class="twisty ${isOpen ? 'open' : ''}" data-twisty="${i}" title="Expand / collapse"></span>` : '<span class="twisty none"></span>';
      const icon = n.isRoot || n.key === base ? 'root' : n.d ? (isOpen ? 'folder open' : 'folder') : 'file';
      const title = n.isRoot ? n.n : `${n.rel}\n${ex ? 'Excluded – click to include' : 'Included – click to exclude'}`;
      return `<div class="row ${ex ? 'excluded' : ''} ${self ? 'self' : ''} ${n._match ? 'match' : ''} ${n.isRoot ? 'rootrow' : ''}"
        style="padding-left:${depthOf(n) * 12 + 4}px" data-row="${i}" title="${esc(title)}">
        ${twisty}<span class="icon ${icon}"></span><span class="name">${n._match ? highlight(n.n) : esc(n.n)}</span>
        ${n.u && !ex ? '<span class="badge">not scanned</span>' : ''}
        ${reason ? `<span class="badge">${esc(reason)}</span>` : ''}
        ${n.d && n.key !== base ? `<span class="eye" data-base="${i}" title="Use this folder as project root – statistics, folders and paths are relative to it"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style="pointer-events:none"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></span>` : ''}
        ${n.isRoot || n.d ? '' : `<span class="eye" data-open="${i}" title="Open file"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style="pointer-events:none"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg></span>`}
      </div>`;
    }).join('');

    app.innerHTML = `
      <div class="top">
        <div class="search">
          <input id="q" type="text" placeholder="Search files & folders (supports * and ?)" value="${esc(query)}" spellcheck="false">
          ${query ? '<button class="icon-btn" id="clear" title="Clear search"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : ''}
        </div>
        ${query ? `<div class="search-actions">
          <span class="muted">${matches} match${matches === 1 ? '' : 'es'}</span>
          <button class="link" id="exMatches">Exclude all</button>
          <button class="link" id="inMatches">Include all</button>
          <button class="link" id="saveFilter" title="Save this search as a reusable filter">Save as filter</button>
        </div>` : ''}
      </div>
      <div class="presetbar" title="Filter presets are stored in .locomotive/presets.json">
        <span class="presetbar-label">Preset</span>
        <select id="presetSel" ${hasWorkspace ? '' : 'disabled'}>
          <option value="">${userPresets.length ? '— none —' : '— no presets yet —'}</option>
          ${userPresets.map(p => `<option value="${esc(p.name)}" ${p.name === activePreset ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        <button class="icon-btn2" id="presetSave" title="Save current filters as preset" ${hasWorkspace ? '' : 'disabled'}>${SVG.save}</button>
        <button class="icon-btn2" id="presetDelete" title="Delete selected preset" ${activePreset ? '' : 'disabled'}>${SVG.trash}</button>
        <button class="icon-btn2" id="openConfig" title="Open .locomotive/settings.json">${SVG.gear}</button>
      </div>
      ${baseNode() ? `<div class="basebar" title="Only this folder is analyzed. Paths, folder colors and clusters are relative to it.">
        <span class="basebar-label">Project root</span>
        <span class="basebar-path"><span>${esc(base)}</span></span>
        <button class="icon-btn2" id="baseUp" title="Go one folder up"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
        <button class="icon-btn2" id="baseClear" title="Analyze the whole workspace again"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>` : `<div class="basehint muted">Tip: the <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/></svg> button on a folder makes it the project root.</div>`}
      <details id="filters" ${ui.filtersOpen ? 'open' : ''}>
        <summary>Predefined filters</summary>
        <div class="presets">${presetHtml}</div>
        ${userHtml}
        <label class="check libs-toggle" title="External packages (npm, Python) become nodes in the import graph and the 3D train view. They are not counted in any statistic."><input type="checkbox" id="libToggle" ${libraries ? 'checked' : ''}>
          <span>Show libraries as graph nodes <span class="muted">(not counted)</span></span></label>
      </details>
      <details id="types" ${ui.typesOpen ? 'open' : ''}>
        <summary>File types <span class="muted">(${exts.length - [...hiddenExt].filter(e => extCounts.has(e)).length}/${exts.length} shown)</span></summary>
        <div class="type-actions">
          <button class="link" id="allExt">All</button>
          <button class="link" id="noExt">None</button>
          <button class="link" id="invExt">Invert</button>
        </div>
        <div class="chips">${extHtml || '<span class="muted">No files found</span>'}</div>
      </details>
      <div class="treebar">
        <span class="muted">${incFiles.length.toLocaleString()} of ${totalFiles.toLocaleString()} files included</span>
        <span class="spacer"></span>
        <button class="link" id="expandAll" title="Expand all">Expand</button>
        <button class="link" id="collapseAll" title="Collapse all">Collapse</button>
        <button class="link" id="resetEx" title="Remove all manual exclusions">Reset</button>
      </div>
      ${roots.some(r => r.truncated) ? '<div class="warn">Scan limit reached – some entries are not shown. Increase "locomotive.maxEntries" or exclude large folders.</div>' : ''}
      ${busyText ? `<div class="busy">${esc(busyText)}</div>` : ''}
      <div id="tree" class="tree">${rowHtml}
        ${total > MAX_ROWS ? `<div class="more muted">…and ${(total - MAX_ROWS).toLocaleString()} more – refine your search</div>` : ''}
      </div>
      <div class="bottom">
        <button id="stats" class="primary" ${incFiles.length ? '' : 'disabled'}><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg> Create Statistics</button>
      </div>`;

    const tree = document.getElementById('tree');
    if (tree) tree.scrollTop = scrollTop;
    bind();
  }

  function highlight(name) {
    const q = query.trim();
    if (!q || /[*?]/.test(q) || q.includes('/')) return esc(name);
    const i = name.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + q.length)) + '</mark>' + esc(name.slice(i + q.length));
  }

  let searchTimer = 0;
  function bind() {
    const q = /** @type {HTMLInputElement} */ (document.getElementById('q'));
    q.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query = q.value;
        const pos = q.selectionStart;
        render();
        const nq = /** @type {HTMLInputElement} */ (document.getElementById('q'));
        nq.focus();
        nq.setSelectionRange(pos, pos);
      }, 150);
    });
    q.addEventListener('keydown', e => { if (e.key === 'Escape') { query = ''; render(); } });
    on('clear', () => { query = ''; render(); });
    on('exMatches', () => {
      for (const n of topMatches()) { included.delete(n.key); if (!n.p) excluded.add(n.key); }
      save(); render();
    });
    on('inMatches', () => {
      let rescan = false;
      for (const n of allNodes.filter(n => n._match)) {
        excluded.delete(n.key);
        if (n.p) { included.add(n.key); rescan = rescan || !!n.u; }
        if (!n.d) hiddenExt.delete(n.ext);
      }
      save(rescan); render();
    });
    on('allExt', () => { hiddenExt.clear(); save(); render(); });
    on('noExt', () => { for (const e of extCounts.keys()) hiddenExt.add(e); save(); render(); });
    on('invExt', () => {
      const next = new Set();
      for (const e of extCounts.keys()) if (!hiddenExt.has(e)) next.add(e);
      hiddenExt = next; save(); render();
    });
    on('expandAll', () => { for (const n of allNodes) if (n.d && !isExcluded(n)) expanded.add(n.key); render(); });
    on('collapseAll', () => { expanded = new Set(roots.map(r => r.key)); render(); });
    on('resetEx', () => { excluded.clear(); included.clear(); hiddenExt.clear(); save(true); render(); });
    on('stats', createStats);
    on('baseClear', () => setBase(null));
    on('baseUp', () => { const b = baseNode(); setBase(b && b.parent && !b.parent.isRoot ? b.parent.key : null); });
    const lt = /** @type {HTMLInputElement} */ (document.getElementById('libToggle'));
    if (lt) lt.addEventListener('change', () => { libraries = lt.checked; save(); });
    on('presetSave', () => vscode.postMessage({ type: 'presetSave' }));
    on('saveFilter', () => { const q = query.trim(); if (q) { busyText = 'Saving filter…'; render(); vscode.postMessage({ type: 'filterAdd', patterns: q.includes('/') || /[*?]/.test(q) ? q : '**/*' + q + '*', label: q }); } });
    const fa = document.getElementById('filterAdd');
    if (fa) fa.addEventListener('submit', ev => {
      ev.preventDefault();
      const pat = /** @type {HTMLInputElement} */ (document.getElementById('filterPat')).value.trim();
      const name = /** @type {HTMLInputElement} */ (document.getElementById('filterName')).value.trim();
      if (!pat) return;
      busyText = 'Adding filter…'; render();
      vscode.postMessage({ type: 'filterAdd', patterns: pat, label: name });
    });
    document.querySelectorAll('[data-filter-del]').forEach(b => b.addEventListener('click', ev => {
      ev.preventDefault();
      const el = /** @type {HTMLElement} */ (b);
      vscode.postMessage({ type: 'filterRemove', id: el.dataset.filterDel, label: el.dataset.label });
    }));
    on('presetDelete', () => activePreset && vscode.postMessage({ type: 'presetDelete', name: activePreset }));
    on('openConfig', () => vscode.postMessage({ type: 'openConfig' }));
    const sel = /** @type {HTMLSelectElement} */ (document.getElementById('presetSel'));
    if (sel) sel.addEventListener('change', () => { busyText = 'Loading preset…'; render(); vscode.postMessage({ type: 'presetLoad', name: sel.value }); });

    for (const id of ['filters', 'types']) {
      const d = document.getElementById(id);
      d.addEventListener('toggle', () => {
        ui[id === 'filters' ? 'filtersOpen' : 'typesOpen'] = /** @type {HTMLDetailsElement} */ (d).open;
        vscode.setState(ui);
      });
    }
    document.querySelectorAll('[data-preset]').forEach(el => el.addEventListener('change', () => {
      const id = /** @type {HTMLElement} */ (el).dataset.preset;
      if (/** @type {HTMLInputElement} */ (el).checked) enabledPresets.add(id); else enabledPresets.delete(id);
      busyText = 'Rescanning…';
      render();
      vscode.postMessage({ type: 'setPresets', presets: [...enabledPresets] });
    }));
    document.querySelectorAll('[data-ext]').forEach(el => el.addEventListener('change', () => {
      const e = /** @type {HTMLElement} */ (el).dataset.ext;
      if (/** @type {HTMLInputElement} */ (el).checked) hiddenExt.delete(e); else hiddenExt.add(e);
      save(); render();
    }));
    const tree = document.getElementById('tree');
    tree.addEventListener('click', ev => {
      const t = /** @type {HTMLElement} */ (ev.target);
      if (t.dataset.twisty !== undefined) {
        const n = rows[Number(t.dataset.twisty)];
        if (query && !n._match && !n.isRoot) return; // search results always show the path to a match
        if (expanded.has(n.key)) expanded.delete(n.key); else expanded.add(n.key);
        render();
        return;
      }
      if (t.dataset.base !== undefined) {
        const n = rows[Number(t.dataset.base)];
        setBase(n.isRoot ? null : n.key);
        return;
      }
      if (t.dataset.open !== undefined) {
        const n = rows[Number(t.dataset.open)];
        if (!n.d) vscode.postMessage({ type: 'open', r: n.r, p: n.rel });
        return;
      }
      const row = t.closest('.row');
      if (!row) return;
      const n = rows[Number(/** @type {HTMLElement} */ (row).dataset.row)];
      if (n.isRoot) { if (expanded.has(n.key)) expanded.delete(n.key); else expanded.add(n.key); render(); return; }
      toggle(n);
    });
  }


  /** Matches whose ancestors are not matches themselves (so we don't record redundant exclusions). */
  function topMatches() {
    return allNodes.filter(n => {
      if (!n._match) return false;
      for (let x = n.parent; x; x = x.parent) if (x._match) return false;
      return true;
    });
  }

  function on(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  function setBase(key) {
    base = key;
    if (base) expanded.add(base);
    save();
    render();
  }

  function createStats() {
    const files = includedFiles().map(f => ({ r: f.r, p: f.rel }));
    const b = baseNode();
    vscode.postMessage({ type: 'createStats', files, base: b ? { r: b.r, p: b.rel } : null });
  }

  window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg.type === 'tree') {
      roots = msg.roots;
      presets = msg.presets;
      enabledPresets = new Set(msg.state.presets);
      excluded = new Set(msg.state.excluded);
      included = new Set(msg.state.included);
      hiddenExt = new Set(msg.state.hiddenExt);
      libraries = !!msg.state.libraries;
      base = msg.state.base || null;
      userPresets = msg.userPresets || [];
      activePreset = msg.activePreset || null;
      hasWorkspace = msg.hasWorkspace !== false;
      loaded = true;
      busyText = '';
      prepare();
      render();
      if (pendingStats) { pendingStats = false; createStats(); }
    } else if (msg.type === 'busy') {
      busyText = msg.text;
      render();
    } else if (msg.type === 'requestStats') {
      if (loaded && !busyText) createStats(); else pendingStats = true;
    }
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
