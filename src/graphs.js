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

  // ---- edges over all files ----
  const edges = new Map();
  for (const f of files) {
    if (!f.deps) continue;
    for (const spec of f.deps) {
      const t = resolve(f, spec);
      if (!t || t === f) continue;
      edges.set(f.abs + '\n' + t.abs, [f, t]);
    }
  }
  return analyzeDependencies([...edges.values()], maxNodes);
}

/**
 * Graph analysis on file -> file import edges:
 * circular imports (strongly connected components), longest dependency chains, layers, blast radius.
 */
function analyzeDependencies(edgeList, maxNodes) {
  const all = [];
  const id = new Map();
  const node = f => { if (!id.has(f)) { id.set(f, all.length); all.push(f); } return id.get(f); };
  const out = [], inn = [];
  const E = edgeList.map(([a, b]) => [node(a), node(b)]);
  for (let i = 0; i < all.length; i++) { out.push([]); inn.push([]); }
  for (const [a, b] of E) { out[a].push(b); inn[b].push(a); }
  const N = all.length;

  // Tarjan SCC (iterative)
  const index = new Int32Array(N).fill(-1), low = new Int32Array(N), onStack = new Uint8Array(N);
  const comp = new Int32Array(N).fill(-1);
  const stack = [];
  let idx = 0, compCount = 0;
  for (let s = 0; s < N; s++) {
    if (index[s] !== -1) continue;
    const work = [[s, 0]];
    index[s] = low[s] = idx++; stack.push(s); onStack[s] = 1;
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      if (top[1] < out[v].length) {
        const w = out[v][top[1]++];
        if (index[w] === -1) {
          index[w] = low[w] = idx++; stack.push(w); onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
        if (low[v] === index[v]) {
          let w;
          do { w = stack.pop(); onStack[w] = 0; comp[w] = compCount; } while (w !== v);
          compCount++;
        }
      }
    }
  }
  const members = Array.from({ length: compCount }, () => []);
  for (let v = 0; v < N; v++) members[comp[v]].push(v);
  const cyclicComps = members.map((m, c) => ({ c, m })).filter(x => x.m.length > 1).sort((a, b) => b.m.length - a.m.length);

  // one readable cycle path per strongly connected component (BFS back to the start node)
  const cyclePath = (m, c) => {
    const start = m.reduce((best, v) => (inn[v].length + out[v].length > inn[best].length + out[best].length ? v : best), m[0]);
    const prev = new Map([[start, -1]]);
    const q = [start];
    while (q.length) {
      const v = q.shift();
      for (const w of out[v]) {
        if (comp[w] !== c) continue;
        if (w === start) {
          const path = [start];
          for (let x = v; x !== start; x = prev.get(x)) path.splice(1, 0, x);
          path.push(start);
          return path;
        }
        if (!prev.has(w)) { prev.set(w, v); q.push(w); }
      }
    }
    return [start, start];
  };
  const ref = v => ({ path: all[v].path, abs: all[v].abs });
  const cycles = cyclicComps.slice(0, 50).map(({ c, m }) => ({
    size: m.length,
    files: m.map(ref),
    cycle: cyclePath(m, c).map(ref),
  }));

  // condensation DAG -> layers (longest path from sources) and longest chains
  const cOut = Array.from({ length: compCount }, () => new Set());
  const cIn = new Int32Array(compCount);
  for (const [a, b] of E) {
    const ca = comp[a], cb = comp[b];
    if (ca !== cb && !cOut[ca].has(cb)) { cOut[ca].add(cb); cIn[cb]++; }
  }
  const order = [];
  const indeg = Int32Array.from(cIn);
  const q = [];
  for (let c = 0; c < compCount; c++) if (!indeg[c]) q.push(c);
  while (q.length) { const c = q.shift(); order.push(c); for (const d of cOut[c]) if (--indeg[d] === 0) q.push(d); }
  // layer = distance from importers ("entry points") -> used for the layered layout
  const layer = new Int32Array(compCount);
  for (const c of order) for (const d of cOut[c]) layer[d] = Math.max(layer[d], layer[c] + 1);
  // longest chain ending in each component
  const best = new Int32Array(compCount).fill(1), from = new Int32Array(compCount).fill(-1);
  for (const c of order) for (const d of cOut[c]) if (best[c] + 1 > best[d]) { best[d] = best[c] + 1; from[d] = c; }
  const rep = members.map(m => m.reduce((b, v) => (inn[v].length > inn[b].length ? v : b), m[0]));
  const ends = [...Array(compCount).keys()].filter(c => best[c] >= 3).sort((a, b) => best[b] - best[a]);
  const chains = [];
  const usedEnds = new Set();
  for (const c of ends) {
    if (chains.length >= 8) break;
    const path = [];
    for (let x = c; x !== -1; x = from[x]) path.unshift(x);
    const key = path[0];
    if (usedEnds.has(key) && chains.length >= 3) continue; // prefer chains from different entry points
    usedEnds.add(key);
    chains.push({ length: path.length, files: path.map(x => ref(rep[x])) });
  }

  // transitive dependents ("blast radius") and dependencies per file
  const reach = (start, adj) => {
    const seen = new Uint8Array(N); seen[start] = 1;
    const st = [start]; let n = 0;
    while (st.length) { const v = st.pop(); for (const w of adj[v]) if (!seen[w]) { seen[w] = 1; n++; st.push(w); } }
    return n;
  };

  // ---- choose the nodes to draw: cycles and chains first, then the most connected files ----
  const degree = v => out[v].length + inn[v].length;
  const chosen = [];
  const chosenSet = new Set();
  const add = v => { if (!chosenSet.has(v) && chosen.length < maxNodes) { chosenSet.add(v); chosen.push(v); } };
  for (const { m } of cyclicComps) for (const v of m) add(v);
  for (const ch of chains) for (const f of ch.files) add(id.get(all.find(x => x.abs === f.abs)));
  [...Array(N).keys()].sort((a, b) => degree(b) - degree(a)).forEach(add);
  const pos = new Map(chosen.map((v, i) => [v, i]));
  const inCycle = v => members[comp[v]].length > 1;
  const nodes = chosen.map(v => {
    const f = all[v];
    return {
      abs: f.abs, path: f.path, rootName: f.rootName, lang: f.lang, lines: f.lines,
      in: inn[v].length, out: out[v].length, layer: layer[comp[v]],
      cycle: inCycle(v) ? comp[v] : -1,
      dependents: N <= 4000 ? reach(v, inn) : null,
      dependencies: N <= 4000 ? reach(v, out) : null,
    };
  });
  const links = [];
  for (const [a, b] of E) {
    if (pos.has(a) && pos.has(b)) links.push({ s: pos.get(a), t: pos.get(b), cyc: comp[a] === comp[b] });
  }
  const top = (arr, n) => arr.slice().sort((x, y) => y.count - x.count).slice(0, n);
  const counts = (adj) => all.map((f, v) => ({ path: f.path, abs: f.abs, count: adj[v].length })).filter(x => x.count);
  const blast = nodes.filter(n => n.dependents).map(n => ({ path: n.path, abs: n.abs, count: n.dependents }));
  return {
    nodes, links, edgeCount: E.length, truncated: N > maxNodes,
    mostImported: top(counts(inn), 5), mostImporting: top(counts(out), 5), blastRadius: top(blast, 5),
    cycles, cycleCount: cyclicComps.length, filesInCycles: cyclicComps.reduce((s, x) => s + x.m.length, 0),
    chains, longestChain: chains.length ? chains[0].length : 0, maxLayer: Math.max(0, ...nodes.map(n => n.layer)),
  };
}

module.exports = { buildWordGraph, buildImportGraph, analyzeDependencies };
