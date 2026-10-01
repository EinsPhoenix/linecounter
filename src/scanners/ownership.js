'use strict';

/**
 * Code ownership from git: who wrote (most of) each file / folder, files nobody touched for a long time,
 * and knowledge at risk (files whose main author has not committed for a long time).
 * files: analyzed files, repos: repoStats results (with fileHistory + lastByAuthor)
 */
function buildOwnership(files, repos, opts = {}) {
  const staleDays = opts.staleDays || 365;
  const now = opts.now || Date.now();
  const hist = new Map();
  const lastByAuthor = {};
  for (const r of repos || []) {
    for (const [abs, h] of r.fileHistory || []) hist.set(abs, h);
    for (const [a, t] of Object.entries(r.lastByAuthor || {})) lastByAuthor[a] = Math.max(lastByAuthor[a] || 0, t);
  }
  if (!hist.size) return null;
  const DAY = 86400000;
  const rows = [];
  for (const f of files) {
    const h = hist.get(f.abs);
    if (!h) continue;
    const authors = Object.entries(h.authors).sort((a, b) => b[1] - a[1]);
    const total = authors.reduce((s, [, n]) => s + n, 0);
    const [owner, n] = authors[0];
    rows.push({
      path: f.path, abs: f.abs, lines: f.lines, owner, share: Math.round((n / total) * 100), authors: authors.length, commits: total,
      last: h.last, first: h.first, ageDays: Math.floor((now - h.last) / DAY),
      ownerGoneDays: lastByAuthor[owner] ? Math.floor((now - lastByAuthor[owner]) / DAY) : null,
    });
  }
  // folders (first two levels): owner distribution weighted by lines
  const folders = new Map();
  for (const r of rows) {
    const parts = r.path.split('/');
    for (let d = 1; d <= Math.min(2, parts.length - 1); d++) {
      const key = parts.slice(0, d).join('/');
      let e = folders.get(key);
      if (!e) folders.set(key, (e = { folder: key, files: 0, lines: 0, owners: {} }));
      e.files++; e.lines += r.lines;
      e.owners[r.owner] = (e.owners[r.owner] || 0) + Math.max(1, r.lines);
    }
  }
  const folderList = [...folders.values()].map(e => {
    const owners = Object.entries(e.owners).sort((a, b) => b[1] - a[1]);
    const total = owners.reduce((s, [, v]) => s + v, 0);
    let acc = 0, bus = 0;
    for (const [, v] of owners) { if (acc >= total / 2) break; acc += v; bus++; }
    return { folder: e.folder, files: e.files, lines: e.lines, owners: owners.slice(0, 6).map(([name, v]) => ({ name, share: Math.round((v / total) * 100) })), busFactor: bus };
  }).filter(f => f.files >= 2).sort((a, b) => b.lines - a.lines).slice(0, 60);

  const authorsTotal = {};
  for (const r of rows) authorsTotal[r.owner] = (authorsTotal[r.owner] || 0) + r.lines;
  const owners = Object.entries(authorsTotal).sort((a, b) => b[1] - a[1]).map(([name, lines]) => ({ name, lines, files: rows.filter(r => r.owner === name).length, lastCommit: lastByAuthor[name] || null }));

  const stale = rows.filter(r => r.ageDays >= staleDays).sort((a, b) => b.ageDays - a.ageDays);
  const atRisk = rows.filter(r => r.ownerGoneDays != null && r.ownerGoneDays >= Math.min(180, staleDays) && r.share >= 60).sort((a, b) => b.lines - a.lines);
  return {
    staleDays, files: rows.length,
    owners: owners.slice(0, 30), folders: folderList,
    stale: stale.slice(0, 200), staleCount: stale.length, staleLines: stale.reduce((s, r) => s + r.lines, 0),
    atRisk: atRisk.slice(0, 100), atRiskCount: atRisk.length,
    ages: [[30, 'last month'], [90, '1–3 months'], [365, '3–12 months'], [730, '1–2 years'], [Infinity, 'older']].map(([max, label], i, arr) => ({ label, count: rows.filter(r => r.ageDays <= max && (i === 0 || r.ageDays > arr[i - 1][0])).length })),
  };
}

module.exports = { buildOwnership };
