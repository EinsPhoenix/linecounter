'use strict';

const { findDuplicates } = require('./duplicates');

/**
 * Code health report: complexity per function, long functions, parameter lists, duplicated code and secrets.
 * files: analyzed files with .functions, .secrets, .dupPrints (see analyzer.js)
 */
function buildHealth(files, opts = {}) {
  const maxCx = opts.maxComplexity || 15;
  const maxLen = opts.maxFunctionLines || 80;
  const all = [];
  const hotspots = [];
  for (const f of files) {
    if (!f.functions || !f.functions.length) continue;
    let sum = 0, worst = 0;
    for (const fn of f.functions) {
      all.push({ name: fn.name, path: f.path, abs: f.abs, lang: f.lang, line: fn.line, end: fn.end, lines: fn.lines, complexity: fn.complexity, params: fn.params });
      sum += fn.complexity; worst = Math.max(worst, fn.complexity);
    }
    hotspots.push({ path: f.path, abs: f.abs, functions: f.functions.length, complexity: sum, maxComplexity: worst, lines: f.lines });
  }
  const buckets = [[1, 5, '1–5 simple'], [6, 10, '6–10 moderate'], [11, 20, '11–20 complex'], [21, 50, '21–50 very complex'], [51, Infinity, '50+ untestable']];
  const complexityBuckets = buckets.map(([lo, hi, label]) => ({ label, count: all.filter(x => x.complexity >= lo && x.complexity <= hi).length }));
  const lengthBuckets = [[1, 10, '1–10'], [11, 30, '11–30'], [31, 80, '31–80'], [81, 200, '81–200'], [201, Infinity, '200+']]
    .map(([lo, hi, label]) => ({ label, count: all.filter(x => x.lines >= lo && x.lines <= hi).length }));
  const byCx = all.slice().sort((a, b) => b.complexity - a.complexity);
  const byLen = all.slice().sort((a, b) => b.lines - a.lines);
  const overComplex = all.filter(x => x.complexity > maxCx);
  const overLong = all.filter(x => x.lines > maxLen);
  const manyParams = all.filter(x => x.params >= 6).sort((a, b) => b.params - a.params);

  // duplicates
  const dups = opts.duplicates === false ? null : findDuplicates(files, opts.duplicateMinLines || 6);
  const codeLines = files.reduce((s, f) => s + (f.code || 0), 0);
  if (dups) dups.percent = codeLines ? Math.min(100, (dups.duplicatedLines / codeLines) * 100) : 0;

  // secrets
  let secrets = null;
  if (opts.secrets !== false) {
    const items = [];
    for (const f of files) for (const s of f.secrets || []) items.push({ ...s, path: f.path, abs: f.abs });
    const rank = { critical: 3, high: 2, medium: 1, low: 0 };
    items.sort((a, b) => rank[b.severity] - rank[a.severity] || a.path.localeCompare(b.path) || a.line - b.line);
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const s of items) bySeverity[s.severity]++;
    const byRule = {};
    for (const s of items) byRule[s.name] = (byRule[s.name] || 0) + 1;
    secrets = { items: items.slice(0, 300), total: items.length, bySeverity, byRule: Object.entries(byRule).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count) };
  }

  // a simple 0–100 score: start at 100, subtract for each kind of smell (weighted by share)
  const n = Math.max(1, all.length);
  const avg = all.reduce((s, x) => s + x.complexity, 0) / n;
  let score = 100;
  score -= Math.min(30, (overComplex.length / n) * 150);
  score -= Math.min(15, (overLong.length / n) * 80);
  score -= Math.min(20, (dups ? dups.percent : 0) * 1.2);
  score -= Math.min(30, secrets ? secrets.bySeverity.critical * 15 + secrets.bySeverity.high * 8 + secrets.bySeverity.medium * 3 : 0);
  score = Math.max(0, Math.round(score));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';

  return {
    thresholds: { maxComplexity: maxCx, maxFunctionLines: maxLen, duplicateMinLines: opts.duplicateMinLines || 6 },
    functions: all.length, avgComplexity: avg, maxComplexity: byCx.length ? byCx[0].complexity : 0,
    complexityBuckets, lengthBuckets,
    complex: byCx.slice(0, 60), long: byLen.slice(0, 40),
    overComplex: overComplex.length, overLong: overLong.length, manyParams: manyParams.slice(0, 20), manyParamsCount: manyParams.length,
    hotspots: hotspots.sort((a, b) => b.complexity - a.complexity).slice(0, 20),
    duplicates: dups, secrets, score, grade,
  };
}

module.exports = { buildHealth };
