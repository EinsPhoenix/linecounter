'use strict';
// Rust + Go: manifests, import graph resolution, unused dependencies. Run: node test/rustgo.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { analyzeFiles } = require('../src/analyzer');
const { buildImportGraph } = require('../src/graphs');
const { parseManifest } = require('../src/deps/manifests');
const { analyzeUsage } = require('../src/deps/usage');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-rustgo-'));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
write('rs/Cargo.toml', '[package]\nname = "rsapp"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\nregex = "1"\nunused-crate = "0.3"\nlocal = { path = "../local" }\n\n[dependencies.anyhow]\nversion = "1.0.86"\n\n[dev-dependencies]\npretty_assertions = "1.4"\n');
write('rs/src/main.rs', 'mod net;\nmod util;\nuse crate::net::client::Client;\nuse anyhow::Result;\nuse serde::Deserialize;\nfn main() { util::helper(); }\n');
write('rs/src/util.rs', 'use super::net::client;\npub fn helper() {}\n');
write('rs/src/net/mod.rs', 'pub mod client;\n');
write('rs/src/net/client.rs', 'use regex::Regex;\nuse crate::util::helper;\npub struct Client {}\n');
write('go/go.mod', 'module github.com/acme/svc\n\ngo 1.22\n\nrequire (\n\tgithub.com/spf13/cobra v1.8.0\n\tgolang.org/x/text v0.14.0 // indirect\n)\n\nrequire github.com/stretchr/testify v1.9.0\n');
write('go/cmd/app/main.go', 'package main\n\nimport (\n\t"fmt"\n\n\t"github.com/acme/svc/internal/db"\n\t"github.com/spf13/cobra"\n)\n\nfunc main() { fmt.Println(db.Open(), cobra.Command{}) }\n');
write('go/internal/db/db.go', 'package db\n\nimport "strings"\n\nfunc Open() string { return strings.ToUpper("x") }\n');

(async () => {
  const cargo = parseManifest(path.join(root, 'rs/Cargo.toml'));
  assert.strictEqual(cargo.ecosystem, 'crates.io');
  assert.deepStrictEqual(cargo.deps.map(d => d.name).sort(), ['anyhow', 'pretty_assertions', 'regex', 'serde', 'unused-crate']);
  const gomod = parseManifest(path.join(root, 'go/go.mod'));
  assert.strictEqual(gomod.module, 'github.com/acme/svc');
  assert.strictEqual(gomod.deps.find(d => d.name === 'golang.org/x/text').type, 'indirect');
  assert.strictEqual(gomod.deps.find(d => d.name === 'github.com/stretchr/testify').pinned, 'v1.9.0');

  const rels = ['rs/Cargo.toml', 'rs/src/main.rs', 'rs/src/util.rs', 'rs/src/net/mod.rs', 'rs/src/net/client.rs', 'go/go.mod', 'go/cmd/app/main.go', 'go/internal/db/db.go'];
  const files = await analyzeFiles(rels.map(r => ({ abs: path.join(root, r), rel: r, root })), 1e6);
  files.forEach(f => (f.rootName = 'x'));
  const g = buildImportGraph(files, { libraries: true });
  const edge = (a, b) => g.links.some(l => g.nodes[l.s].path === a && g.nodes[l.t].path === b);
  assert.ok(edge('rs/src/main.rs', 'rs/src/net/mod.rs'), 'mod net;');
  assert.ok(edge('rs/src/main.rs', 'rs/src/util.rs'), 'mod util;');
  assert.ok(edge('rs/src/main.rs', 'rs/src/net/client.rs'), 'use crate::net::client');
  assert.ok(edge('rs/src/util.rs', 'rs/src/net/client.rs'), 'use super::net::client');
  assert.ok(edge('rs/src/net/mod.rs', 'rs/src/net/client.rs'), 'pub mod client;');
  assert.ok(edge('go/cmd/app/main.go', 'go/internal/db/db.go'), 'go import of an internal package');
  assert.ok(g.nodes.some(n => n.library && n.ecosystem === 'crates.io' && n.path === 'regex'), 'crate as library');
  assert.ok(g.nodes.some(n => n.library && n.ecosystem === 'Go' && n.path === 'github.com/spf13/cobra'), 'go module as library');
  assert.ok(!g.nodes.some(n => n.path === 'strings' || n.path === 'std'), 'standard libraries are skipped');

  const usage = analyzeUsage([{ ...cargo, rel: 'rs/Cargo.toml' }, { ...gomod, rel: 'go/go.mod' }], files, { npm: new Map(), py: new Map() });
  const rs = usage.find(u => u.ecosystem === 'crates.io');
  assert.deepStrictEqual(rs.unused.map(u => u.name).sort(), ['pretty_assertions', 'unused-crate']);
  const go = usage.find(u => u.ecosystem === 'Go');
  assert.deepStrictEqual(go.unused.map(u => u.name), ['github.com/stretchr/testify']);
  // TypeScript: tsconfig path aliases, React components, JSX calls
  write('web/tsconfig.json', '{\n  // comment\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } },\n}\n');
  write('web/package.json', '{ "name": "web" }');
  write('web/src/App.tsx', "import { api } from '@/lib/api';\nimport Toolbar from '@/components/Toolbar';\nexport const App = ({ id }: { id: string }) => {\n  const run = useCallback(async (x: string) => {\n    if (x) await api(x);\n  }, []);\n  return <Toolbar title={id} />;\n};\nexport function useThing<T>(\n  a: T,\n): T {\n  return a;\n}\n");
  write('web/src/lib/api.ts', 'export async function api(x: string) { return x; }\n');
  write('web/src/components/Toolbar.tsx', 'export default function Toolbar({ title }: { title: string }) { return <h1>{title}</h1>; }\n');
  const tsRels = ['web/tsconfig.json', 'web/package.json', 'web/src/App.tsx', 'web/src/lib/api.ts', 'web/src/components/Toolbar.tsx'];
  const ts = await analyzeFiles(tsRels.map(r => ({ abs: path.join(root, r), rel: r, root })), 1e6, null, null, { functions: true });
  const tg = buildImportGraph(ts, {});
  const tedge = (a, b) => tg.links.some(l => tg.nodes[l.s].path === a && tg.nodes[l.t].path === b);
  assert.ok(tedge('web/src/App.tsx', 'web/src/lib/api.ts'), '@/lib/api via tsconfig paths');
  assert.ok(tedge('web/src/App.tsx', 'web/src/components/Toolbar.tsx'), '@/components/Toolbar');
  const app = ts.find(f => f.path === 'web/src/App.tsx');
  const fnNames = app.functions.map(x => x.name);
  for (const n of ['App', 'run', 'useThing']) assert.ok(fnNames.includes(n), 'function ' + n);
  assert.strictEqual(app.functions.find(x => x.name === 'App').end, 8, 'App body ends at line 8');
  assert.ok(app.calls.Toolbar && app.calls.api, 'JSX and function calls');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('rustgo.test OK');
})().catch(e => { console.error(e); process.exit(1); });
