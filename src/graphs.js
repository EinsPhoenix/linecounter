'use strict';

const path = require('path').posix;
const { npmPackageOf, PY_IMPORT_ALIASES, PY_STDLIB, NODE_BUILTINS } = require('./deps/usage');

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
  const dirOf = p => (path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p));
  // Go: module paths (go.mod) and the .go files per package folder
  const goMods = files.filter(f => f.goModule).map(f => ({ root: f.root, dir: dirOf(f.path), module: f.goModule })).sort((a, b) => b.module.length - a.module.length);
  const goPkgs = new Map();
  for (const f of files) if (f.lang === 'Go' && !/_test\.go$/.test(f.path)) { const k = f.root + '|' + dirOf(f.path); if (!goPkgs.has(k)) goPkgs.set(k, []); goPkgs.get(k).push(f); }
  const localCrates = new Set(files.filter(f => f.crateName).map(f => f.crateName.replace(/-/g, '_')));
  const rustFile = (root, base) => has(root, base + '.rs') || has(root, base + '/mod.rs');
  /** module folder of a Rust file: foo.rs -> foo/, mod.rs / lib.rs / main.rs -> their folder */
  const rustModDir = f => (/(^|\/)(mod|lib|main)\.rs$/.test(f.path) ? dirOf(f.path) : f.path.replace(/\.rs$/, ''));
  const rustCrateSrc = f => { const i = f.path.lastIndexOf('src/'); return i >= 0 ? f.path.slice(0, i + 3) : dirOf(f.path); };
  const rustPath = (root, base, segs) => {
    for (let k = segs.length; k >= 1; k--) {
      const hit = rustFile(root, (base ? base + '/' : '') + segs.slice(0, k).join('/'));
      if (hit) return hit;
    }
    return null;
  };

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
    if (f.lang === 'Go') {
      const m = goMods.find(g => g.root === f.root && (spec === g.module || spec.startsWith(g.module + '/')));
      if (!m) return null;
      const rel = [m.dir, spec.slice(m.module.length + 1)].filter(Boolean).join('/');
      const pkg = goPkgs.get(f.root + '|' + rel);
      return pkg ? pkg.slice().sort((a, b) => a.path.localeCompare(b.path)).slice(0, 4) : null;
    }
    if (f.lang === 'Rust') {
      if (spec.startsWith('mod:')) {
        const base = rustModDir(f);
        return rustFile(f.root, (base ? base + '/' : '') + spec.slice(4));
      }
      const segs = spec.split('::');
      if (segs[0] === 'crate') return rustPath(f.root, rustCrateSrc(f), segs.slice(1));
      if (segs[0] === 'self') return rustPath(f.root, rustModDir(f), segs.slice(1));
      if (segs[0] === 'super') {
        let base = /(^|\/)(mod|lib|main)\.rs$/.test(f.path) ? dirOf(dirOf(f.path)) : dirOf(f.path);
        let rest = segs.slice(1);
        while (rest[0] === 'super') { base = dirOf(base); rest = rest.slice(1); }
        return rustPath(f.root, base, rest);
      }
      if (localCrates.has(segs[0])) return null; // another crate of the workspace
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

  // ---- external libraries (optional): bare imports that are not files of the project ----
  const libs = new Map();
  const libInfo = libraryLookup(opts.deps);
  const libraryOf = (f, spec) => {
    if (!opts.libraries) return null;
    let eco, name;
    if (f.lang === 'Python') {
      if (spec.startsWith('.')) return null;
      name = spec.split('.')[0];
      if (!name || PY_STDLIB.has(name)) return null;
      eco = 'PyPI';
    } else if (f.lang === 'Rust') {
      if (spec.startsWith('mod:')) return null;
      name = spec.split('::')[0];
      if (!name || RUST_STD.has(name) || localCrates.has(name)) return null;
      eco = 'crates.io';
    } else if (f.lang === 'Go') {
      const first = spec.split('/')[0];
      if (!first.includes('.')) return null; // standard library
      if (goMods.some(g => spec === g.module || spec.startsWith(g.module + '/'))) return null;
      name = /^(github\.com|gitlab\.com|bitbucket\.org|golang\.org\/x|gopkg\.in)\//.test(spec) ? spec.split('/').slice(0, first === 'golang.org' ? 3 : 3).join('/') : spec.split('/').slice(0, 3).join('/');
      eco = 'Go';
    } else if (JS_LANGS.has(f.lang)) {
      name = npmPackageOf(spec);
      if (!name || NODE_BUILTINS.has(name) || name.startsWith('node:')) return null;
      eco = 'npm';
    } else return null;
    const key = `lib:${eco}:${name}`;
    if (!libs.has(key)) {
      const info = libInfo(eco, name) || {};
      libs.set(key, {
        abs: key, path: info.name || name, name: info.name || name, lang: 'Library', lines: 0, library: true, ecosystem: eco,
        version: info.version || null, license: info.license || null, licenseStatus: info.status || null,
        vulns: info.vulns || 0, severity: info.severity || null, dir: info.dir || null,
      });
    }
    return libs.get(key);
  };

  // ---- edges over all files ----
  const edges = new Map();
  for (const f of files) {
    if (!f.deps) continue;
    for (const spec of f.deps) {
      const r = resolve(f, spec) || libraryOf(f, spec);
      for (const t of Array.isArray(r) ? r : [r]) {
        if (!t || t === f) continue;
        edges.set(f.abs + '\n' + t.abs, [f, t]);
      }
    }
  }
  if (opts.edgesOut) for (const [a, b] of edges.values()) if (!b.library) opts.edgesOut.push([a.abs, b.abs]);
  const g = analyzeDependencies([...edges.values()], maxNodes + libs.size);
  g.libraryCount = libs.size;
  g.vulnerableLibraries = [...libs.values()].filter(l => l.vulns).length;
  return g;
}

const RUST_STD = new Set(['std', 'core', 'alloc', 'proc_macro', 'test', 'crate', 'self', 'super', 'Self']);
const JS_LANGS = new Set(['JavaScript', 'JSX', 'TypeScript', 'TSX', 'Vue', 'Svelte', 'Astro']);

/** Finds version, license and vulnerabilities of a library in the dependency report. */
function libraryLookup(report) {
  if (!report || !report.packages) return () => null;
  const aliasToDist = new Map();
  for (const [dist, names] of Object.entries(PY_IMPORT_ALIASES)) for (const n of names) aliasToDist.set(n.toLowerCase(), dist);
  const norm = n => String(n).toLowerCase().replace(/[-_.]+/g, '-');
  const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0, NONE: 0 };
  return (eco, name) => {
    const fuzzy = eco === 'PyPI' || eco === 'crates.io';
    const want = eco === 'PyPI' ? norm(aliasToDist.get(name.toLowerCase()) || name) : fuzzy ? norm(name) : name;
    const same = x => x.ecosystem === eco && (fuzzy ? norm(x.name) === want : x.name === want || (eco === 'Go' && want.startsWith(x.name + '/')));
    const p = report.packages.find(x => same(x) && x.direct) || report.packages.find(same);
    if (!p) return null;
    const vulns = ((report.vulns && report.vulns.items) || []).filter(v => v.ecosystem === eco && v.name === p.name && v.version === p.version);
    const worst = vulns.reduce((w, v) => (!w || rank[v.severity] > rank[w] ? v.severity : w), null);
    return { name: p.name, version: p.version, license: p.license, status: p.status, vulns: vulns.length, severity: worst, dir: p.dir };
  };
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
      ...(f.library ? { library: true, ecosystem: f.ecosystem, version: f.version, license: f.license, licenseStatus: f.licenseStatus, vulns: f.vulns, severity: f.severity, dir: f.dir } : {}),
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
  const counts = (adj) => all.map((f, v) => ({ path: f.path, abs: f.abs, count: adj[v].length, library: !!f.library })).filter(x => x.count && !x.library);
  const blast = nodes.filter(n => n.dependents && !n.library).map(n => ({ path: n.path, abs: n.abs, count: n.dependents }));
  const libUse = all.map((f, v) => ({ path: f.path, abs: f.abs, count: inn[v].length, library: !!f.library, vulns: f.vulns || 0, severity: f.severity || null, version: f.version || null })).filter(x => x.library);
  return {
    nodes, links, edgeCount: E.length, truncated: N > maxNodes,
    mostImported: top(counts(inn), 5), mostImporting: top(counts(out), 5), blastRadius: top(blast, 5), mostUsedLibraries: top(libUse, 8),
    cycles, cycleCount: cyclicComps.length, filesInCycles: cyclicComps.reduce((s, x) => s + x.m.length, 0),
    chains, longestChain: chains.length ? chains[0].length : 0, maxLayer: Math.max(0, ...nodes.map(n => n.layer)),
  };
}

// names that exist in nearly every code base – linking calls by these names would be guesswork
const AMBIGUOUS = new Set(['__init__', 'constructor', 'main', 'init', 'run', 'get', 'set', 'update', 'render', 'toString', 'handle', 'handler',
  'setup', 'close', 'open', 'start', 'stop', 'create', 'delete', 'remove', 'add', 'load', 'save', 'test', 'call', 'apply', 'build', 'parse',
  'process', 'execute', 'next', 'reset', 'clear', 'push', 'pop', 'map', 'filter', 'forEach', 'reduce', 'find', 'then', 'catch', 'emit', 'on', 'off']);

/**
 * Functions as graph nodes: file -> function ("defines") and caller -> callee ("calls").
 * A call counts only inside the same file or into a file that the caller's file imports.
 * files: analyzed files (with .functions / .calls), fileEdges: [[fromAbs, toAbs]], allowed: Set of file abs to include
 */
function buildFunctionGraph(files, fileEdges, allowed, maxFunctions = 600) {
  const imports = new Map();
  for (const [a, b] of fileEdges) { if (!imports.has(a)) imports.set(a, new Set()); imports.get(a).add(b); }
  const byName = new Map();
  const fileFns = new Map();
  const fns = [];
  for (const f of files) {
    if (!f.functions || !allowed.has(f.abs)) continue;
    const list = [];
    for (const fn of f.functions) {
      const e = { file: f.abs, path: f.path, name: fn.name, line: fn.line, end: fn.end, cx: fn.complexity, lines: fn.lines, idx: -1, used: 0 };
      list.push(e);
      if (!byName.has(fn.name)) byName.set(fn.name, []);
      byName.get(fn.name).push(e);
    }
    fileFns.set(f.abs, list);
  }
  const callsRaw = [];
  for (const f of files) {
    if (!f.calls || !allowed.has(f.abs)) continue;
    const own = fileFns.get(f.abs) || [];
    const imp = imports.get(f.abs) || new Set();
    for (const [name, lines] of Object.entries(f.calls)) {
      const defs = byName.get(name);
      if (!defs || AMBIGUOUS.has(name)) continue;
      const cands = defs.filter(d => d.file === f.abs || imp.has(d.file));
      if (!cands.length || cands.length > 2) continue;
      const target = cands.find(d => d.file === f.abs) || cands[0];
      for (const line of lines) {
        if (target.file === f.abs && line >= target.line && line <= target.end && line === target.line) continue;
        // innermost function around the call site is the caller
        let caller = null;
        for (const fn of own) if (line >= fn.line && line <= fn.end && (!caller || fn.end - fn.line < caller.end - caller.line)) caller = fn;
        if (caller === target) continue; // recursion
        callsRaw.push([caller, f.abs, target]);
        target.used++;
        if (caller) caller.used++;
      }
    }
  }
  // keep the most connected functions (then the most complex ones)
  const ranked = [...fileFns.values()].flat().sort((a, b) => b.used - a.used || b.cx - a.cx).slice(0, maxFunctions);
  ranked.forEach((fn, i) => { fn.idx = i; });
  const seen = new Map();
  for (const [caller, file, target] of callsRaw) {
    if (target.idx < 0 || (caller && caller.idx < 0)) continue;
    const key = (caller ? 'f' + caller.idx : 'F' + file) + '>' + target.idx;
    const e = seen.get(key);
    if (e) e.n++; else seen.set(key, { s: caller ? caller.idx : -1, file, t: target.idx, n: 1 });
  }
  return {
    fns: ranked.map(fn => ({ file: fn.file, path: fn.path, name: fn.name, line: fn.line, end: fn.end, cx: fn.cx, lines: fn.lines })),
    calls: [...seen.values()],
    total: [...fileFns.values()].reduce((s, l) => s + l.length, 0),
  };
}

module.exports = { buildWordGraph, buildImportGraph, analyzeDependencies, buildFunctionGraph };
