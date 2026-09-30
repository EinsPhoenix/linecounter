'use strict';

const path = require('path').posix;

/**
 * Word web: the most used identifiers and the files that use them most.
 * Nodes are words and files, links connect a file to a word it uses (weight = count).
 */
function buildWordGraph(files, opts = {}) {
  const maxWords = opts.maxWords || 24;
  const filesPerWord = opts.filesPerWord || 4;
  const totals = new Map();
  for (const f of files) {
    if (!f.identifiers) continue;
    for (const [w, c] of Object.entries(f.identifiers)) totals.set(w, (totals.get(w) || 0) + c);
  }
  const words = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxWords);
  const fileIdx = new Map();
  const nodesFiles = [];
  const links = [];
  for (const [w] of words) {
    const users = files.filter(f => f.identifiers && f.identifiers[w])
      .sort((a, b) => b.identifiers[w] - a.identifiers[w]).slice(0, filesPerWord);
    for (const f of users) {
      if (!fileIdx.has(f.abs)) {
        fileIdx.set(f.abs, nodesFiles.length);
        nodesFiles.push({ abs: f.abs, path: f.path, lang: f.lang, lines: f.lines });
      }
    }
  }
  // connect every chosen file to every chosen word it uses noticeably (not only the top users)
  const wordSet = new Set(words.map(w => w[0]));
  for (const nf of nodesFiles) {
    const f = files.find(x => x.abs === nf.abs);
    for (const w of wordSet) {
      const c = f.identifiers[w];
      if (c && c >= 3) links.push({ w, f: fileIdx.get(nf.abs), v: c });
    }
  }
  return { words: words.map(([id, count]) => ({ id, count })), files: nodesFiles, links };
}

const JS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.json', '.d.ts',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.vue'];
const CSS_EXT = ['', '.css', '.scss', '.sass', '.less'];

/** File dependency graph from import / require / include / @import statements. */
function buildImportGraph(files, opts = {}) {
  const maxNodes = opts.maxNodes || 400;
  const byKey = new Map(); // "root|rel" -> file
  for (const f of files) byKey.set(f.root + '|' + f.path, f);
  const has = (root, rel) => byKey.get(root + '|' + rel);

  const resolve = (f, spec) => {
    const dir = path.dirname(f.path) === '.' ? '' : path.dirname(f.path);
    const tryList = (base, exts) => {
      for (const e of exts) {
        const cand = path.normalize(base + e).replace(/^\.\//, '');
        if (cand.startsWith('..')) return null;
        const hit = has(f.root, cand);
        if (hit) return hit;
      }
      return null;
    };
    if (f.lang === 'Python') {
      const m = /^(\.*)(.*)$/.exec(spec);
      const dots = m[1].length;
      const mod = m[2].replace(/\./g, '/');
      const bases = [];
      if (dots) {
        let d = dir;
        for (let i = 1; i < dots; i++) d = path.dirname(d) === '.' ? '' : path.dirname(d);
        bases.push(d);
      } else {
        // absolute module: try from the file's folder upwards to the root
        let d = dir;
        for (;;) { bases.push(d); if (!d) break; d = path.dirname(d) === '.' ? '' : path.dirname(d); }
      }
      for (const b of bases) {
        if (!mod) continue;
        const base = b ? b + '/' + mod : mod;
        const hit = tryList(base, ['.py', '/__init__.py']);
        if (hit) return hit;
      }
      return null;
    }
    if (/^[a-z]+:/i.test(spec)) return null; // urls, node: builtins
    const isCss = ['CSS', 'SCSS', 'Less'].includes(f.lang);
    const isC = ['C', 'C++', 'Objective-C'].includes(f.lang);
    if (spec.startsWith('/')) return tryList(spec.slice(1), isCss ? CSS_EXT : JS_EXT);
    if (spec.startsWith('.') || isC || isCss || f.lang === 'HTML') {
      const base = dir ? dir + '/' + spec : spec;
      if (isCss) {
        const hit = tryList(base, CSS_EXT);
        if (hit) return hit;
        return tryList(path.join(path.dirname(base), '_' + path.basename(base)), CSS_EXT);
      }
      if (isC) return tryList(base, ['']) || tryList(spec, ['']);
      return tryList(base, JS_EXT);
    }
    // bare specifiers ("src/utils" style path aliases) – try from the root
    return tryList(spec, JS_EXT);
  };

  const edges = new Map();
  for (const f of files) {
    if (!f.deps) continue;
    for (const spec of f.deps) {
      const t = resolve(f, spec);
      if (!t || t === f) continue;
      edges.set(f.abs + '\n' + t.abs, [f, t]);
    }
  }
  const degree = new Map();
  const inDeg = new Map();
  const outDeg = new Map();
  for (const [a, b] of edges.values()) {
    degree.set(a, (degree.get(a) || 0) + 1);
    degree.set(b, (degree.get(b) || 0) + 1);
    outDeg.set(a, (outDeg.get(a) || 0) + 1);
    inDeg.set(b, (inDeg.get(b) || 0) + 1);
  }
  const chosen = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxNodes).map(e => e[0]);
  const idx = new Map(chosen.map((f, i) => [f, i]));
  const nodes = chosen.map(f => ({ abs: f.abs, path: f.path, rootName: f.rootName, lang: f.lang, lines: f.lines, in: inDeg.get(f) || 0, out: outDeg.get(f) || 0 }));
  const links = [];
  for (const [a, b] of edges.values()) {
    if (idx.has(a) && idx.has(b)) links.push({ s: idx.get(a), t: idx.get(b) });
  }
  // mutual imports (A -> B and B -> A)
  const cycles = [];
  for (const [a, b] of edges.values()) {
    if (a.abs < b.abs && edges.has(b.abs + '\n' + a.abs)) cycles.push([a.path, b.path, a.abs, b.abs]);
  }
  const top = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([f, c]) => ({ path: f.path, abs: f.abs, count: c }));
  return {
    nodes, links, edgeCount: edges.size, truncated: degree.size > maxNodes,
    mostImported: top(inDeg, 5), mostImporting: top(outDeg, 5), cycles: cycles.slice(0, 20), cycleCount: cycles.length,
  };
}

module.exports = { buildWordGraph, buildImportGraph };
