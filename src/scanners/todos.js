'use strict';

const path = require('path');
const git = require('../git');

/**
 * TODO tracker: every TODO / FIXME / HACK / XXX / BUG comment with author and age from `git blame`.
 * files: analyzed files (with todoItems), repos: repoStats results (root)
 */
async function buildTodos(files, repos, opts = {}) {
  const withTodos = files.filter(f => f.todoItems);
  if (!withTodos.length) return null;
  const roots = (repos || []).map(r => r.root).sort((a, b) => b.length - a.length);
  const maxFiles = opts.maxFiles || 400;
  const now = opts.now || Date.now();
  const items = [];
  const queue = withTodos.slice(0, maxFiles);
  const work = async f => {
    const root = roots.find(r => f.abs.startsWith(r + path.sep));
    let blame = new Map();
    if (root) {
      try { blame = await git.blameLines(root, path.relative(root, f.abs).split(path.sep).join('/'), f.todoItems.map(t => t.line)); } catch { /* not tracked */ }
    }
    for (const t of f.todoItems) {
      const b = blame.get(t.line);
      items.push({ ...t, path: f.path, abs: f.abs, author: b ? b.author : null, time: b ? b.time : null, ageDays: b && b.time ? Math.floor((now - b.time) / 86400000) : null, uncommitted: !!(b && b.author === 'Not Committed Yet') });
    }
  };
  for (let i = 0; i < queue.length; i += 8) await Promise.all(queue.slice(i, i + 8).map(work));
  for (const f of withTodos.slice(maxFiles)) for (const t of f.todoItems) items.push({ ...t, path: f.path, abs: f.abs, author: null, time: null, ageDays: null });
  items.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
  const count = key => { const m = {}; for (const t of items) { const k = t[key] || 'unknown'; m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, count: n })); };
  const dated = items.filter(t => t.ageDays != null);
  const buckets = [[30, '< 1 month'], [180, '1–6 months'], [365, '6–12 months'], [730, '1–2 years'], [Infinity, '2+ years']];
  return {
    total: items.length, items: items.slice(0, 1500),
    byTag: count('tag'), byAuthor: count('author').slice(0, 15),
    oldest: dated[0] || null, avgAgeDays: dated.length ? Math.round(dated.reduce((s, t) => s + t.ageDays, 0) / dated.length) : null,
    ages: buckets.map(([max, label], i) => ({ label, count: dated.filter(t => t.ageDays <= max && (i === 0 || t.ageDays > buckets[i - 1][0])).length })),
    blamed: dated.length,
  };
}

module.exports = { buildTodos };
