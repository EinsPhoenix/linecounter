'use strict';

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const { pyName } = require('./manifests');

const NODE_BUILTINS = new Set(builtinModules.flatMap(m => [m, m.replace(/^node:/, '')]));
const PY_STDLIB = new Set(require('./python-stdlib.json'));

// Python distributions whose import name differs from the package name
const PY_IMPORT_ALIASES = {
  pyyaml: ['yaml'], pillow: ['PIL'], 'beautifulsoup4': ['bs4'], 'scikit-learn': ['sklearn'], 'scikit-image': ['skimage'],
  'opencv-python': ['cv2'], 'opencv-python-headless': ['cv2'], 'python-dateutil': ['dateutil'], 'python-dotenv': ['dotenv'],
  'pyjwt': ['jwt'], 'pymysql': ['pymysql'], 'mysqlclient': ['MySQLdb'], 'psycopg2-binary': ['psycopg2'], 'psycopg-binary': ['psycopg'],
  'protobuf': ['google'], 'google-cloud-storage': ['google'], 'attrs': ['attr', 'attrs'], 'pycryptodome': ['Crypto'],
  'pyserial': ['serial'], 'pyusb': ['usb'], 'python-magic': ['magic'], 'msgpack-python': ['msgpack'], 'typing-extensions': ['typing_extensions'],
  'discord.py': ['discord'], 'python-multipart': ['multipart'], 'djangorestframework': ['rest_framework'], 'pyopenssl': ['OpenSSL'],
  'faiss-cpu': ['faiss'], 'tensorflow-gpu': ['tensorflow'], 'ruamel.yaml': ['ruamel'], 'websocket-client': ['websocket'], 'pywin32': ['win32api', 'win32con', 'pywintypes'],
};
// Tools that are used from the command line / config instead of being imported
const PY_TOOLS = new Set(['pytest', 'black', 'flake8', 'mypy', 'ruff', 'isort', 'pylint', 'coverage', 'tox', 'nox', 'pre-commit', 'setuptools', 'wheel', 'pip', 'twine',
  'build', 'sphinx', 'gunicorn', 'uvicorn', 'ipython', 'jupyter', 'notebook', 'jupyterlab', 'ipykernel', 'bandit', 'autopep8', 'yapf', 'pytest-cov', 'pytest-mock',
  'pytest-asyncio', 'hatchling', 'poetry-core', 'pdm-backend', 'mkdocs', 'mkdocs-material', 'invoke', 'watchdog', 'pyinstaller', 'cython', 'types-requests']);
const NPM_IMPLICIT = new Set(['typescript', 'tslib', 'npm', 'pnpm', 'yarn', 'husky', 'lint-staged', 'rimraf', 'cross-env', 'concurrently', 'npm-run-all', 'nodemon',
  'ts-node', 'tsx', 'prettier', 'eslint', 'jest', 'vitest', 'mocha', 'nyc', 'c8', '@vscode/vsce', 'vsce', 'patch-package', 'standard-version', 'semantic-release',
  'autoprefixer', 'postcss', 'tailwindcss', 'sass', 'less', 'stylelint', 'webpack-cli', 'vite', 'esbuild', 'rollup', 'turbo', 'lerna', 'nx', 'sharp']);

const npmPackageOf = spec => {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || /^[a-z]+:/i.test(spec) && !spec.startsWith('node:')) return null;
  if (spec.startsWith('node:')) return spec;
  if (/^[~#]/.test(spec) || spec.startsWith('@/')) return null; // path aliases
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

/** Text of config files in a project folder where tools/plugins are referenced by name. */
function configText(dir, manifest) {
  let text = JSON.stringify({ scripts: manifest.scripts || {}, ...Object.fromEntries(Object.entries(manifest.raw || {}).filter(([k]) => !/^(dependencies|devDependencies|peerDependencies|optionalDependencies|name|version|description)$/.test(k))) });
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { /* ignore */ }
  for (const e of entries) {
    if (/^(\.?[\w-]*rc(\.\w+)?|[\w.-]*\.config\.[cm]?[jt]s|tsconfig.*\.json|\.babelrc|babel\.config\.\w+|jest\.config\.\w+|\.eslintrc.*|\.prettierrc.*|\.stylelintrc.*|\.mocharc.*|angular\.json|nx\.json|turbo\.json|Makefile|Dockerfile|docker-compose\.ya?ml|\.github)$/i.test(e)) {
      const p = path.join(dir, e);
      try { if (fs.statSync(p).isFile() && fs.statSync(p).size < 300000) text += '\n' + readText(p); } catch { /* ignore */ }
    }
  }
  const gh = path.join(dir, '.github', 'workflows');
  try { for (const w of fs.readdirSync(gh)) text += '\n' + readText(path.join(gh, w)); } catch { /* ignore */ }
  return text;
}

/**
 * Finds unused declared dependencies and imports of undeclared packages.
 * manifests: parsed manifests; files: analyzed files with .abs, .lang, .deps (import specifiers);
 * installed: { npm: Map(dir -> Map(name -> pkg)), py: Map(name -> dist) }
 */
function analyzeUsage(manifests, files, installed) {
  const byDir = manifests.slice().sort((a, b) => b.dir.length - a.dir.length);
  const ownerOf = (abs, eco) => byDir.find(m => m.ecosystem === eco && (abs.startsWith(m.dir + path.sep) || abs === m.dir));
  const results = [];
  for (const m of manifests) results.push({ manifest: m, used: new Map(), undeclared: new Map() });
  const res = m => results.find(r => r.manifest === m);

  for (const f of files) {
    if (!f.deps) continue;
    const isPy = f.lang === 'Python';
    const eco = isPy ? 'PyPI' : f.lang === 'Rust' ? 'crates.io' : f.lang === 'Go' ? 'Go' : 'npm';
    const owner = ownerOf(f.abs, eco);
    if (!owner) continue;
    const r = res(owner);
    const use = (key) => { if (!r.used.has(key)) r.used.set(key, []); if (r.used.get(key).length < 5 && !r.used.get(key).some(x => x.abs === f.abs)) r.used.get(key).push({ path: f.path, abs: f.abs }); };
    for (const spec of f.deps) {
      if (eco === 'crates.io') {
        if (spec.startsWith('mod:')) continue;
        const top = spec.split('::')[0];
        if (!['std', 'core', 'alloc', 'crate', 'self', 'super', 'proc_macro', 'test'].includes(top)) use(top);
        continue;
      }
      if (eco === 'Go') {
        if (!spec.split('/')[0].includes('.')) continue; // standard library
        if (owner.module && (spec === owner.module || spec.startsWith(owner.module + '/'))) continue;
        use(spec);
        continue;
      }
      if (isPy) {
        if (spec.startsWith('.')) continue;
        const top = spec.split('.')[0];
        if (!top || PY_STDLIB.has(top)) continue;
        if (!r.used.has(top)) r.used.set(top, []);
        if (r.used.get(top).length < 5) r.used.get(top).push({ path: f.path, abs: f.abs });
      } else {
        const pkg = npmPackageOf(spec);
        if (!pkg || NODE_BUILTINS.has(pkg) || pkg.startsWith('node:')) continue;
        if (!r.used.has(pkg)) r.used.set(pkg, []);
        if (r.used.get(pkg).length < 5) r.used.get(pkg).push({ path: f.path, abs: f.abs });
      }
    }
  }

  const out = [];
  for (const r of results) {
    const m = r.manifest;
    const unused = [], undeclared = [];
    if (m.ecosystem === 'crates.io') {
      const norm = n => n.replace(/-/g, '_');
      const declared = new Set(m.deps.map(d => norm(d.name)));
      for (const d of m.deps) {
        if (d.spec === 'workspace' || r.used.has(norm(d.name))) continue;
        // macros / derives are often only used as attributes (#[derive(Serialize)]), tests use dev-dependencies
        unused.push({ name: d.name, type: d.type === 'prod' ? 'prod' : 'dev', spec: d.spec, line: d.line, hint: d.type === 'prod' ? 'never used with use / path (check macros and derives)' : `${d.type}-dependency not used in the scanned files` });
      }
      for (const [name, where] of r.used) if (!declared.has(name) && name !== norm(m.name)) undeclared.push({ name, files: where, installed: false });
    } else if (m.ecosystem === 'Go') {
      for (const d of m.deps) {
        if (d.type === 'indirect') continue;
        if ([...r.used.keys()].some(k => k === d.name || k.startsWith(d.name + '/'))) continue;
        unused.push({ name: d.name, type: 'prod', spec: d.spec, line: d.line, hint: 'never imported (go mod tidy removes it)' });
      }
      for (const [name, where] of r.used) {
        if (m.deps.some(d => name === d.name || name.startsWith(d.name + '/'))) continue;
        undeclared.push({ name, files: where, installed: false });
      }
    } else if (m.ecosystem === 'npm') {
      const cfg = configText(m.dir, m);
      const hasTs = /"typescript"|tsconfig/.test(cfg) || fs.existsSync(path.join(m.dir, 'tsconfig.json'));
      const declared = new Set(m.deps.map(d => d.name));
      const inst = installed.npm.get(m.dir) || new Map();
      for (const d of m.deps) {
        if (r.used.has(d.name) || d.type === 'peer') continue;
        const base = d.name.startsWith('@types/') ? d.name.slice(7).replace(/^(.+)__(.+)$/, '@$1/$2') : null;
        if (base && (r.used.has(base) || NODE_BUILTINS.has(base) || base === 'node' || hasTs)) continue;
        const escaped = d.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let bins = [];
        const pkg = inst.get(d.name);
        if (pkg && pkg.dir) {
          try { const pj = JSON.parse(readText(path.join(pkg.dir, 'package.json'))); bins = typeof pj.bin === 'string' ? [d.name.split('/').pop()] : Object.keys(pj.bin || {}); } catch { /* ignore */ }
        }
        const inConfig = new RegExp(`(^|[^\\w@/-])${escaped}([^\\w-]|$)`).test(cfg) || bins.some(b => new RegExp(`(^|[\\s"'/])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s"']|$)`).test(cfg));
        const pluginLike = /(eslint-(plugin|config)|babel-(plugin|preset)|@babel\/|prettier-plugin|stylelint-|postcss-|@types\/|webpack-|rollup-plugin|vite-plugin|@vitejs\/|karma-|jest-)/.test(d.name);
        if (inConfig) continue;
        if (NPM_IMPLICIT.has(d.name) && (d.type === 'dev' || hasTs)) continue;
        unused.push({ name: d.name, type: d.type, spec: d.spec, line: d.line, hint: pluginLike ? 'plugin/preset not referenced in any config' : d.type === 'dev' ? 'dev tool not referenced in scripts or configs' : 'never imported' });
      }
      // modules provided by the host environment
      const hostProvided = new Set();
      if (m.raw && m.raw.engines && m.raw.engines.vscode) hostProvided.add('vscode');
      if (m.raw && m.raw.engines && m.raw.engines.electron) hostProvided.add('electron');
      for (const [name, where] of r.used) {
        if (declared.has(name) || name === m.name || hostProvided.has(name)) continue;
        undeclared.push({ name, files: where, installed: inst.has(name) });
      }
    } else {
      const localTop = new Set();
      try {
        for (const e of fs.readdirSync(m.dir, { withFileTypes: true })) {
          if (e.isFile() && e.name.endsWith('.py')) localTop.add(e.name.slice(0, -3));
          if (e.isDirectory()) { localTop.add(e.name); if (e.name === 'src') { try { for (const s of fs.readdirSync(path.join(m.dir, 'src'))) localTop.add(s.replace(/\.py$/, '')); } catch { /* ignore */ } } }
        }
      } catch { /* ignore */ }
      for (const f of files) if (f.lang === 'Python') { const top = f.path.split('/')[0].replace(/\.py$/, ''); localTop.add(top); }
      const importNames = d => {
        const n = pyName(d.name);
        const inst = installed.py.get(n);
        const names = new Set(inst ? inst.topLevel : []);
        for (const a of PY_IMPORT_ALIASES[n] || []) names.add(a);
        names.add(d.name.replace(/[-.]/g, '_').toLowerCase());
        names.add(d.name.replace(/[-.]/g, '_'));
        return [...names];
      };
      const provided = new Map();
      for (const d of m.deps) for (const i of importNames(d)) provided.set(i, d.name);
      for (const d of m.deps) {
        if (importNames(d).some(i => r.used.has(i))) continue;
        const tool = PY_TOOLS.has(pyName(d.name)) || /^(types-|pytest-|flake8-|mypy-)/.test(pyName(d.name));
        unused.push({ name: d.name, type: tool ? 'tool' : d.type, spec: d.spec, line: d.line, hint: tool ? 'tool used from the command line (not imported)' : 'never imported' });
      }
      const instByImport = new Map();
      for (const dist of installed.py.values()) for (const t of dist.topLevel) instByImport.set(t, dist.name);
      for (const [name, where] of r.used) {
        if (provided.has(name) || localTop.has(name) || PY_STDLIB.has(name)) continue;
        undeclared.push({ name, files: where, installed: instByImport.has(name), dist: instByImport.get(name) || null });
      }
    }
    out.push({ ecosystem: m.ecosystem, file: m.rel || m.file, abs: m.file, name: m.name, unused, undeclared });
  }
  return out;
}

module.exports = { analyzeUsage, npmPackageOf, PY_IMPORT_ALIASES, PY_STDLIB, NODE_BUILTINS };
