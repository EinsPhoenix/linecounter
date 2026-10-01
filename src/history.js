'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Snapshots of the key numbers of every statistics run – the page draws trends from them
 * ("lines over time", "health score", "vulnerabilities" …) and shows what changed since the last run.
 * Stored per workspace (VS Code workspace state); optionally also in .linecounter/history.json (shareable).
 */
const MAX = 200;

function snapshotOf(d) {
  const H = d.health || {};
  const R = d.dependencies || {};
  const vulns = (R.vulns && R.vulns.items) || [];
  return {
    t: d.generated,
    files: d.totals.files, lines: d.totals.lines, code: d.totals.code, comment: d.totals.comment, blank: d.totals.blank, todo: d.totals.todo + d.totals.fixme + d.totals.hack,
    functions: H.functions || 0, avgComplexity: H.avgComplexity ? Math.round(H.avgComplexity * 100) / 100 : 0, overComplex: H.overComplex || 0,
    score: H.score ?? null, grade: H.grade || null, duplicated: H.duplicates ? Math.round(H.duplicates.percent * 10) / 10 : null,
    secrets: H.secrets ? H.secrets.total : null, deadCode: H.deadCode ? H.deadCode.total : null,
    packages: (R.packages || []).length, vulns: vulns.length, critical: vulns.filter(v => v.severity === 'CRITICAL' || v.severity === 'HIGH').length,
    licenseProblems: (R.packages || []).filter(p => p.status === 'problematic' && !p.ignored).length,
    cycles: d.importGraph ? d.importGraph.cycleCount : 0,
    commits: (d.repos || []).reduce((s, r) => s + r.commitCount, 0),
  };
}

/** Adds the snapshot of `data` and returns the history (oldest first). Runs within 10 minutes replace the last one. */
async function record(context, config, data) {
  const key = 'linecounter.history:' + (data.projectRoot || '');
  let list = context.workspaceState.get(key) || [];
  const file = config.dir ? path.join(config.dir, 'history.json') : null;
  const toFile = config.get('history.saveToFile', false);
  if (toFile && file) {
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      const fromFile = (stored[data.projectRoot || ''] || []);
      if (fromFile.length > list.length) list = fromFile;
    } catch { /* no file yet */ }
  }
  const snap = snapshotOf(data);
  const last = list[list.length - 1];
  if (last && snap.t - last.t < 10 * 60 * 1000) list = list.slice(0, -1);
  list = [...list, snap].slice(-MAX);
  await context.workspaceState.update(key, list);
  if (toFile && file) {
    try {
      let stored = {};
      try { stored = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
      stored[data.projectRoot || ''] = list;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(stored, null, 1) + '\n');
    } catch { /* read-only workspace */ }
  }
  return list;
}

async function clear(context, projectRoot) {
  await context.workspaceState.update('linecounter.history:' + (projectRoot || ''), []);
}

module.exports = { record, clear, snapshotOf };
