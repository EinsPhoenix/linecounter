'use strict';

/**
 * Tools for LLM agents (Model Context Protocol). Every tool works on the analysis data `D` (same model as the
 * statistics page) and returns compact JSON. Paths are relative to the analyzed project root.
 */
const SEV = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0, NONE: 0 };
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined && o[k] !== null).map(k => [k, o[k]]));
const norm = p => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
const matches = (filePath, q) => { const a = norm(filePath).toLowerCase(), b = norm(q).toLowerCase(); return a === b || a.endsWith('/' + b) || a.includes(b); };

/** adjacency over ALL resolved import edges (not only the drawn graph) */
function graphIndex(D) {
  if (D.__gi) return D.__gi;
  const G = D.importGraph || { nodes: [], links: [] };
  const out = new Map(), inn = new Map();
  const nodes = G.nodes;
  for (const l of G.links) {
    const a = nodes[l.s].path, b = nodes[l.t].path;
    if (!out.has(a)) out.set(a, new Set()); out.get(a).add(b);
    if (!inn.has(b)) inn.set(b, new Set()); inn.get(b).add(a);
  }
  Object.defineProperty(D, '__gi', { value: { out, inn, nodes }, enumerable: false });
  return D.__gi;
}
const findFile = (D, q) => {
  const exact = D.table.find(f => norm(f.path) === norm(q));
  if (exact) return exact;
  const hits = D.table.filter(f => matches(f.path, q));
  return hits.length === 1 ? hits[0] : hits.length ? { ambiguous: hits.slice(0, 15).map(f => f.path) } : null;
};
const reach = (start, adj, max = 2000) => {
  const seen = new Map([[start, 0]]); const q = [start];
  while (q.length && seen.size < max) { const v = q.shift(); for (const w of adj.get(v) || []) if (!seen.has(w)) { seen.set(w, seen.get(v) + 1); q.push(w); } }
  seen.delete(start);
  return [...seen].sort((a, b) => a[1] - b[1]).map(([path, depth]) => ({ path, depth }));
};

const TOOLS = [
  {
    name: 'project_overview',
    description: 'Overview of the analyzed project: size, languages, code health grade, quality gate, vulnerabilities, licenses, cycles, git activity. Start here.',
    inputSchema: { type: 'object', properties: {} },
    run(D) {
      const H = D.health || {}, R = D.dependencies || {};
      return {
        project: D.workspace, projectRoot: D.projectRoot || null, generated: new Date(D.generated).toISOString(),
        totals: pick(D.totals, ['files', 'lines', 'code', 'comment', 'blank', 'folders']),
        languages: D.languages.slice(0, 10).map(l => ({ language: l.key, files: l.files, lines: l.lines })),
        health: H.grade ? { grade: H.grade, score: H.score, functions: H.functions, avgComplexity: Math.round(H.avgComplexity * 10) / 10, tooComplex: H.overComplex, duplicatedPercent: H.duplicates ? Math.round(H.duplicates.percent * 10) / 10 : null, secrets: H.secrets ? H.secrets.total : null, unusedFunctions: H.deadCode ? H.deadCode.total : null } : null,
        qualityGate: D.gate ? { passed: D.gate.passed, failed: D.gate.checks.filter(c => c.enabled && !c.passed).map(c => `${c.label}: ${c.detail}`) } : null,
        dependencies: R.packages ? { packages: R.packages.length, direct: R.packages.filter(p => p.direct).length, vulnerabilities: (R.vulns && R.vulns.items.length) || 0, problematicLicenses: R.packages.filter(p => p.status === 'problematic').length, unknownLicenses: R.packages.filter(p => p.license === 'Unknown').length } : null,
        imports: D.importGraph ? { edges: D.importGraph.edgeCount, circularImports: D.importGraph.cycleCount, longestChain: D.importGraph.longestChain } : null,
        architectureViolations: D.architecture && D.architecture.configured ? D.architecture.total : null,
        todos: D.todos ? D.todos.total : 0,
        git: (D.repos || []).map(r => ({ repo: r.name, branch: r.branch, commits: r.commitCount, authors: r.authorCount, last: new Date(r.last).toISOString() })),
      };
    },
  },
  {
    name: 'file_dependencies',
    description: 'What a file imports and which files import it (direct and transitive), plus libraries it uses and whether it is part of a circular import.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'file path (relative, or a unique suffix like "utils/api.ts")' } }, required: ['path'] },
    run(D, a) {
      const f = findFile(D, a.path);
      if (!f) return { error: `no file matching "${a.path}"` };
      if (f.ambiguous) return { error: 'ambiguous path', candidates: f.ambiguous };
      const { out, inn, nodes } = graphIndex(D);
      const imports = [...(out.get(f.path) || [])];
      const node = nodes.find(n => n.path === f.path);
      const cycle = (D.importGraph.cycles || []).find(c => c.files.some(x => x.path === f.path));
      return {
        file: f.path, lines: f.lines, language: f.lang,
        imports: imports.filter(p => !nodes.find(n => n.path === p && n.library)),
        libraries: imports.filter(p => nodes.find(n => n.path === p && n.library)),
        importedBy: [...(inn.get(f.path) || [])],
        transitiveDependencies: reach(f.path, out).length, transitiveDependents: reach(f.path, inn).length,
        inCircularImport: cycle ? cycle.cycle.map(x => x.path) : null,
        layer: node ? node.layer : null,
      };
    },
  },
  {
    name: 'impact_of_change',
    description: 'Blast radius: every file that (transitively) depends on the given file and may break when it changes, ordered by distance; also tests among them.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'number', default: 100 } }, required: ['path'] },
    run(D, a) {
      const f = findFile(D, a.path);
      if (!f || f.ambiguous) return f ? { error: 'ambiguous path', candidates: f.ambiguous } : { error: `no file matching "${a.path}"` };
      const { inn } = graphIndex(D);
      const deps = reach(f.path, inn);
      return { file: f.path, affectedFiles: deps.length, direct: deps.filter(d => d.depth === 1).map(d => d.path), all: deps.slice(0, a.limit || 100), tests: deps.filter(d => /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.\w+$|_test\.\w+$|^test_/.test(d.path)).map(d => d.path) };
    },
  },
  {
    name: 'circular_imports',
    description: 'All circular import groups with one concrete cycle path each.',
    inputSchema: { type: 'object', properties: {} },
    run(D) { const G = D.importGraph || {}; return { count: G.cycleCount || 0, cycles: (G.cycles || []).map(c => ({ files: c.size, path: c.cycle.map(x => x.path) })) }; },
  },
  {
    name: 'dependency_chains',
    description: 'The longest import chains and the most imported / most importing files (architecture hubs).',
    inputSchema: { type: 'object', properties: {} },
    run(D) { const G = D.importGraph || {}; return { longestChains: (G.chains || []).map(c => c.files.map(x => x.path)), mostImported: G.mostImported, mostImporting: G.mostImporting, biggestBlastRadius: G.blastRadius }; },
  },
  {
    name: 'risk_hotspots',
    description: 'Files most likely to break: changed often in git AND complex (churn × complexity), with a 0–100 risk score.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
    run(D, a) { const R = D.health && D.health.risk; return R ? { files: R.files.slice(0, a.limit || 20).map(r => pick(r, ['path', 'risk', 'churn', 'complexity', 'maxComplexity', 'lines', 'functions'])) } : { error: 'no git history available' }; },
  },
  {
    name: 'frequently_changed_files',
    description: 'Files changed in the most commits (git churn) per repository.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 25 } } },
    run(D, a) { return { repos: (D.repos || []).map(r => ({ repo: r.name, files: r.hotspots.slice(0, a.limit || 25).map(h => ({ path: h.file, commits: h.count })) })) }; },
  },
  {
    name: 'complex_functions',
    description: 'Functions ordered by cyclomatic complexity (optionally only in one file / folder or above a threshold), with file and line.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, minComplexity: { type: 'number' }, limit: { type: 'number', default: 30 } } },
    run(D, a) {
      const H = D.health; if (!H) return { error: 'code health analysis is off' };
      const list = H.complex.filter(f => (!a.path || matches(f.path, a.path)) && (a.minComplexity == null || f.complexity >= a.minComplexity));
      return { threshold: H.thresholds.maxComplexity, functions: list.slice(0, a.limit || 30).map(f => pick(f, ['name', 'path', 'line', 'complexity', 'lines', 'params'])) };
    },
  },
  {
    name: 'find_function',
    description: 'Where a function is defined (file:line, complexity) and which functions / files call it (only calls along real imports).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run(D, a) {
      const FG = D.functionGraph; if (!FG) return { error: 'function graph not available' };
      const defs = FG.fns.map((f, i) => ({ ...f, i })).filter(f => f.name === a.name || f.name.toLowerCase() === String(a.name).toLowerCase());
      return { definitions: defs.map(f => ({ path: f.path, line: f.line, complexity: f.cx, lines: f.lines, calledBy: FG.calls.filter(c => c.t === f.i).map(c => (c.s >= 0 ? `${FG.fns[c.s].name}() in ${FG.fns[c.s].path}` : `top level of ${D.table.find(x => x.abs === c.file) ? D.table.find(x => x.abs === c.file).path : c.file}`)), calls: FG.calls.filter(c => c.s === f.i).map(c => `${FG.fns[c.t].name}() in ${FG.fns[c.t].path}`) })) };
    },
  },
  {
    name: 'vulnerabilities',
    description: 'Known vulnerabilities (OSV.dev) of npm / PyPI / crates.io / Go packages with severity, CVSS, advisory and fixed versions, plus where the package is declared.',
    inputSchema: { type: 'object', properties: { minSeverity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] }, package: { type: 'string' } } },
    run(D, a) {
      const R = D.dependencies; if (!R || !R.vulns) return { error: 'dependency scan is off' };
      if (R.vulns.error) return { error: `OSV.dev not reachable: ${R.vulns.error}` };
      const min = SEV[String(a.minSeverity || 'LOW').toUpperCase()] || 0;
      const list = R.vulns.items.filter(v => (SEV[v.severity] || 0) >= min && (!a.package || v.name === a.package));
      const declared = v => { const p = R.packages.find(x => x.name === v.name && x.ecosystem === v.ecosystem && x.decl && x.decl.length); return p ? p.decl.map(d => `${d.file}${d.line ? ':' + d.line : ''}`) : []; };
      return { checkedPackages: R.vulns.checked, count: list.length, vulnerabilities: list.slice(0, 100).map(v => ({ ...pick(v, ['ecosystem', 'name', 'version', 'id', 'severity', 'score', 'summary', 'fixed', 'url']), aliases: v.aliases, direct: v.direct, declaredIn: declared(v) })) };
    },
  },
  {
    name: 'licenses',
    description: 'License of every package (npm, PyPI, crates.io, Go) with category and policy status; filter by status (problematic / review / ok), license or package. Unknown ones include what was checked.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['problematic', 'review', 'ok'] }, license: { type: 'string' }, package: { type: 'string' }, limit: { type: 'number', default: 200 } } },
    run(D, a) {
      const R = D.dependencies; if (!R || !R.packages) return { error: 'dependency scan is off' };
      const list = R.packages.filter(p => (!a.status || p.status === a.status) && (!a.license || String(p.license).toLowerCase().includes(String(a.license).toLowerCase())) && (!a.package || p.name === a.package));
      const summary = {}; for (const p of R.packages) summary[p.license] = (summary[p.license] || 0) + 1;
      return { policy: R.policy, summary, count: list.length, packages: list.slice(0, a.limit || 200).map(p => ({ ...pick(p, ['ecosystem', 'name', 'version', 'license', 'category', 'status', 'direct', 'dev', 'licenseSource']), checked: p.licenseTrail ? p.licenseTrail.map(t => `${t.source}: ${t.result}`) : undefined })) };
    },
  },
  {
    name: 'dependency_usage',
    description: 'Declared but unused packages and imported but undeclared packages per manifest (with the files that use them and the manifest line).',
    inputSchema: { type: 'object', properties: {} },
    run(D) { const R = D.dependencies; return R ? { manifests: R.usage.map(u => ({ manifest: u.file, ecosystem: u.ecosystem, unused: u.unused.map(x => pick(x, ['name', 'type', 'hint', 'line'])), undeclared: u.undeclared.map(x => ({ name: x.name, installedTransitively: x.installed, usedIn: x.files.map(f => f.path) })) })) } : { error: 'dependency scan is off' }; },
  },
  {
    name: 'secrets',
    description: 'Hard-coded secrets found in the code (values are masked) with file and line.',
    inputSchema: { type: 'object', properties: {} },
    run(D) { const S = D.health && D.health.secrets; return S ? { count: S.total, bySeverity: S.bySeverity, findings: S.items.map(s => pick(s, ['severity', 'name', 'path', 'line', 'preview'])) } : { error: 'secret scanning is off' }; },
  },
  {
    name: 'code_owners',
    description: 'Ownership from git for a file or folder (main author, share, last change, bus factor), or the whole project; also stale files and knowledge at risk.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'file or folder; empty = whole project' } } },
    run(D, a) {
      const O = D.ownership; if (!O) return { error: 'no git history available' };
      if (!a.path) return { owners: O.owners.slice(0, 15), busFactor1Folders: O.folders.filter(f => f.busFactor === 1).map(f => f.folder), staleFiles: O.staleCount, knowledgeAtRisk: O.atRisk.slice(0, 20).map(r => pick(r, ['path', 'owner', 'share', 'ownerGoneDays'])) };
      const folder = O.folders.find(f => matches(f.folder, a.path));
      const files = [...O.stale, ...O.atRisk].filter(r => matches(r.path, a.path));
      return { folder: folder || null, staleOrAtRisk: files.slice(0, 30).map(r => pick(r, ['path', 'owner', 'share', 'ageDays', 'ownerGoneDays'])) };
    },
  },
  {
    name: 'todos',
    description: 'Open TODO / FIXME / HACK / XXX / BUG comments with author and age (git blame), oldest first; filter by path or tag.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'number', default: 50 } } },
    run(D, a) { const T = D.todos; if (!T) return { count: 0, todos: [] }; const list = T.items.filter(t => (!a.path || matches(t.path, a.path)) && (!a.tag || t.tag === String(a.tag).toUpperCase())); return { count: list.length, todos: list.slice(0, a.limit || 50).map(t => pick(t, ['tag', 'text', 'assignee', 'path', 'line', 'author', 'ageDays'])) }; },
  },
  {
    name: 'architecture_violations',
    description: 'Imports that break the configured architecture rules / layers (linecounter.architecture.*).',
    inputSchema: { type: 'object', properties: {} },
    run(D) { const A = D.architecture; return A && A.configured ? { rules: A.rules, violations: A.violations.map(v => ({ rule: v.rule, severity: v.severity, from: v.from.path, to: v.to.path, detail: v.detail })) } : { configured: false, hint: 'add "architecture.rules" / "architecture.layers" to .linecounter/settings.json' }; },
  },
  {
    name: 'unused_functions',
    description: 'Free functions whose name appears nowhere else in the code (dead code candidates; exported ones may be public API).',
    inputSchema: { type: 'object', properties: {} },
    run(D) { const d = D.health && D.health.deadCode; return d ? { count: d.total, functions: d.items.map(f => pick(f, ['name', 'path', 'line', 'lines', 'exported'])) } : { error: 'code health analysis is off' }; },
  },
  {
    name: 'duplicate_code',
    description: 'Duplicated code blocks (identical normalized lines) with both locations.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 30 } } },
    run(D, a) { const d = D.health && D.health.duplicates; return d ? { percent: Math.round(d.percent * 10) / 10, blocks: d.groups.slice(0, a.limit || 30).map(g => ({ lines: g.lines, locations: g.occurrences.map(o => `${o.path}:${o.line}-${o.end}`) })) } : { error: 'duplicate detection is off' }; },
  },
  {
    name: 'quality_gate',
    description: 'Result of the quality gate (vulnerabilities, secrets, licenses, architecture, …) – the same checks the CI runs.',
    inputSchema: { type: 'object', properties: {} },
    run(D) { return D.gate ? { passed: D.gate.passed, checks: D.gate.checks.map(c => ({ check: c.label, enabled: c.enabled, passed: c.passed, detail: c.detail, items: c.passed ? undefined : c.items })) } : { error: 'gate not evaluated' }; },
  },
];

function listTools() { return TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })); }
function callTool(D, name, args) {
  const t = TOOLS.find(x => x.name === name);
  if (!t) throw new Error(`unknown tool ${name}`);
  return t.run(D, args || {});
}

module.exports = { listTools, callTool, TOOLS };
