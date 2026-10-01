'use strict';
// Smoke test for the non-UI parts: scan -> analyze -> git -> aggregate. Run: npm test
const path = require('path');
const assert = require('assert');
const { scanRoot, DEFAULT_PRESETS } = require('../src/scanner');
const { analyzeFiles, classifyLines } = require('../src/analyzer');
const { aggregate } = require('../src/stats');
const git = require('../src/git');

(async () => {
  const c = classifyLines(['// a', 'x = 1; /* b', 'c */', '', '  ', 'y /* z */ = 2', '/* only */'], { line: ['//'], block: [['/*', '*/']] });
  assert.deepStrictEqual(c, { code: 2, comment: 3, blank: 2 });
  const py = classifyLines(['"""doc', 'more', '"""', 'x = 1  # c', '# only'], { line: ['#'], block: [['"""', '"""']] });
  assert.deepStrictEqual(py, { code: 1, comment: 4, blank: 0 });

  const root = process.env.ROOT || path.resolve(__dirname, '..');
  const res = await scanRoot(root, { presets: DEFAULT_PRESETS });
  const nm = res.children.find(c => c.n === 'node_modules');
  if (!process.env.ROOT) assert.ok(nm && nm.p === 'node_modules' && nm.u, 'node_modules should be preset-excluded and not scanned');

  const files = [];
  const walk = (nodes, rel) => {
    for (const n of nodes) {
      const r = rel ? rel + '/' + n.n : n.n;
      if (n.p) continue;
      if (n.d) walk(n.c, r); else files.push({ abs: path.join(root, r), rel: r, root });
    }
  };
  walk(res.children, '');
  const results = await analyzeFiles(files, 2 * 1024 * 1024, null, null, { functions: true, duplicates: true, secrets: true, dupMinLines: 6 });
  results.forEach(r => (r.rootName = 'linecounter'));
  const repoPath = await git.repoRoot(root);
  const repos = repoPath ? [await git.repoStats(repoPath, 1000)].filter(Boolean) : [];
  const data = aggregate(results, { workspace: 'linecounter', repos });
  assert.ok(data.totals.lines > 0);
  assert.ok(data.health && data.health.functions > 50, 'functions should be detected');
  assert.ok(data.health.complex[0].complexity >= data.health.complex[1].complexity);
  assert.ok(data.functionGraph && data.functionGraph.fns.length > 0 && data.functionGraph.calls.length > 0, 'function graph');
  assert.ok(data.health.deadCode && Array.isArray(data.health.deadCode.items), 'dead code report');
  const snap = require('../src/history').snapshotOf(data);
  assert.ok(snap.lines === data.totals.lines && snap.functions === data.health.functions, 'history snapshot');
  if (process.argv[2]) require('fs').writeFileSync(process.argv[2], JSON.stringify(data));
  console.log(`OK – ${data.totals.files} files, ${data.totals.lines} lines, ${data.languages.length} languages, ${repos.length} repo(s)`);
})().catch(e => { console.error(e); process.exit(1); });
