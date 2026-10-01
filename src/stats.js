'use strict';

const { buildWordGraph, buildImportGraph, buildFunctionGraph } = require('./graphs');
const { buildHealth } = require('./scanners/health');
const { checkArchitecture } = require('./scanners/architecture');
const { buildOwnership } = require('./scanners/ownership');

/** Aggregates per-file analysis results into the data model shown on the statistics page. */
function aggregate(files, meta) {
  const text = files.filter(f => !f.binary && !f.skipped);
  const sum = key => text.reduce((s, f) => s + f[key], 0);

  const totals = {
    files: files.length,
    textFiles: text.length,
    binaryFiles: files.filter(f => f.binary).length,
    skippedFiles: files.filter(f => f.skipped).length,
    size: files.reduce((s, f) => s + f.size, 0),
    lines: sum('lines'), code: sum('code'), comment: sum('comment'), blank: sum('blank'),
    chars: sum('chars'), words: sum('words'),
    todo: sum('todo'), fixme: sum('fixme'), hack: sum('hack'), wtf: sum('wtf'),
    trailing: sum('trailing'), tabIndent: sum('tabIndent'), spaceIndent: sum('spaceIndent'),
    semicolons: sum('semicolons'), braces: sum('braces'), parens: sum('parens'),
    debugPrints: sum('debugPrints'), emojis: sum('emojis'), fortyTwo: sum('fortyTwo'),
    funcs: sum('funcs'), imports: sum('imports'),
    folders: new Set(files.map(f => f.root + '|' + f.path.split('/').slice(0, -1).join('/'))).size,
  };

  // Group by language / extension
  const group = keyFn => {
    const m = new Map();
    for (const f of files) {
      const k = keyFn(f);
      const g = m.get(k) || { key: k, files: 0, lines: 0, code: 0, comment: 0, blank: 0, size: 0 };
      g.files++; g.lines += f.lines; g.code += f.code; g.comment += f.comment; g.blank += f.blank; g.size += f.size;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.lines - a.lines || b.size - a.size);
  };
  const languages = group(f => (f.binary ? 'Binary' : f.lang));
  const extensions = group(f => f.ext);

  // Top-level folders (per workspace root)
  const multiRoot = new Set(files.map(f => f.root)).size > 1;
  const folders = group(f => {
    const parts = f.path.split('/');
    const top = parts.length > 1 ? parts[0] + '/' : '(root files)';
    return multiRoot ? `${f.rootName}/${top}` : top;
  });

  // File length histogram
  const bucketEdges = [10, 50, 100, 250, 500, 1000, 2500, Infinity];
  const bucketLabels = ['1–10', '11–50', '51–100', '101–250', '251–500', '501–1k', '1k–2.5k', '2.5k+'];
  const histogram = bucketLabels.map(label => ({ label, count: 0 }));
  for (const f of text) {
    if (f.lines === 0) continue;
    histogram[bucketEdges.findIndex(e => f.lines <= e)].count++;
  }

  // Identifier frequencies
  const ids = new Map();
  for (const f of files) {
    if (!f.identifiers) continue;
    for (const [k, v] of Object.entries(f.identifiers)) ids.set(k, (ids.get(k) || 0) + v);
  }
  const identifiers = [...ids.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);

  // Age of files (mtime)
  const now = Date.now();
  const ageEdges = [1, 7, 30, 90, 365, Infinity];
  const ageLabels = ['today', '< 1 week', '< 1 month', '< 3 months', '< 1 year', 'older'];
  const ages = ageLabels.map(label => ({ label, count: 0 }));
  for (const f of files) {
    const days = (now - f.mtime) / 86400000;
    ages[ageEdges.findIndex(e => days <= e)].count++;
  }

  const table = files.map(f => ({
    path: f.path, abs: f.abs, rootName: f.rootName, lang: f.binary ? 'Binary' : f.lang, ext: f.ext,
    lines: f.lines, code: f.code, comment: f.comment, blank: f.blank, size: f.size,
    maxLine: f.maxLine, maxLineNo: f.maxLineNo, todo: f.todo + f.fixme + f.hack, binary: f.binary, skipped: f.skipped, mtime: f.mtime,
    chars: f.chars, trailing: f.trailing, debug: f.debugPrints, emojis: f.emojis, funcs: f.funcs, wtf: f.wtf,
  }));

  const fileEdges = [];
  const limits = meta.graphLimits || {};
  const importGraph = buildImportGraph(text, { libraries: !!meta.includeLibraries, deps: meta.dependencies, edgesOut: fileEdges, maxNodes: limits.maxNodes, maxLinks: limits.maxLinks });
  const graphFiles = new Set(importGraph.nodes.filter(n => !n.library).map(n => n.abs));
  // architecture rules on every import edge; violating edges are marked in the graph
  const pathByAbs = new Map(text.map(f => [f.abs, f.path]));
  const architecture = checkArchitecture(fileEdges, abs => pathByAbs.get(abs), meta.architecture || {});
  if (architecture.total) {
    const bad = new Set(architecture.violations.map(v => v.from.abs + '\n' + v.to.abs));
    for (const l of importGraph.links) if (bad.has(importGraph.nodes[l.s].abs + '\n' + importGraph.nodes[l.t].abs)) l.viol = true;
  }
  const ownership = buildOwnership(text, meta.repos, { staleDays: meta.staleDays });
  const churn = new Map();
  for (const r of meta.repos || []) {
    delete r.fileHistory; delete r.lastByAuthor; // large – summarised in `ownership`
    for (const [abs, c] of r.churnAll || []) churn.set(abs, (churn.get(abs) || 0) + c);
    delete r.churnAll; // large – not needed on the page
  }
  const hopts = { ...(meta.health || {}), churn };
  return {
    generated: now, ...meta, multiRoot,
    totals, languages, extensions, folders, histogram, identifiers, ages, table,
    wordGraph: buildWordGraph(text), importGraph, architecture, ownership,
    functionGraph: meta.maxFunctions === 0 ? null : buildFunctionGraph(text, fileEdges, graphFiles, meta.maxFunctions || 600),
    health: hopts.enabled === false ? null : buildHealth(text, hopts),
  };
}

module.exports = { aggregate };
