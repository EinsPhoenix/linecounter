'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Predefined filters. A folder/file that matches is excluded by default and its
 * contents are not scanned (keeps huge folders like node_modules cheap).
 */
const PRESETS = [
  { id: 'node_modules', label: 'node_modules', dirs: ['node_modules', 'bower_components', 'jspm_packages'] },
  { id: 'venv', label: 'Python venv / cache', dirs: ['venv', '.venv', 'env', '.env', 'virtualenv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', 'site-packages', '.ipynb_checkpoints'], isVenv: true },
  { id: 'vcs', label: 'VCS (.git, .svn, .hg)', dirs: ['.git', '.svn', '.hg'] },
  { id: 'build', label: 'Build output (dist, build, out, target…)', dirs: ['dist', 'build', 'out', 'target', 'bin', 'obj', '.next', '.nuxt', '.svelte-kit', '.output', 'coverage', '.gradle', '.dart_tool', 'DerivedData', '.parcel-cache', '.turbo'] },
  { id: 'ide', label: 'IDE folders (.idea, .vs, .vscode)', dirs: ['.idea', '.vs', '.vscode', '.vscode-test'] },
  { id: 'vendor', label: 'vendor / Pods / third_party', dirs: ['vendor', 'Pods', 'third_party', 'Carthage'] },
  { id: 'lockfiles', label: 'Lock files', files: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'Pipfile.lock', 'go.sum', 'bun.lockb', 'uv.lock'] },
  { id: 'minified', label: 'Minified / maps (*.min.js, *.map)', patterns: [/\.min\.(js|css)$/i, /\.map$/i] },
  { id: 'binary', label: 'Binaries & media (images, archives…)', patterns: [/\.(png|jpe?g|gif|bmp|ico|webp|tiff?|psd|mp[34]|wav|ogg|flac|avi|mov|mkv|webm|zip|tar|gz|tgz|bz2|xz|7z|rar|jar|war|exe|dll|so|dylib|o|a|lib|class|pyc|pyo|wasm|pdf|docx?|xlsx?|pptx?|ttf|otf|woff2?|eot|sqlite3?|db|bin|dat|pkl|npy|npz|h5|onnx|pt|vsix)$/i] },
];

const DEFAULT_PRESETS = PRESETS.map(p => p.id);

function presetFor(name, isDir, fullPath, enabled, rel, custom) {
  if (custom && custom.length && enabled.has('custom') && custom.some(r => r.test(rel))) return 'custom';
  for (const p of PRESETS) {
    if (!enabled.has(p.id)) continue;
    if (isDir) {
      if (p.dirs && p.dirs.includes(name)) return p.id;
      // A venv is recognised by its pyvenv.cfg, whatever the folder is called
      if (p.isVenv && fs.existsSync(path.join(fullPath, 'pyvenv.cfg'))) return p.id;
    } else {
      if (p.files && p.files.includes(name)) return p.id;
      if (p.patterns && p.patterns.some(r => r.test(name))) return p.id;
    }
  }
  return undefined;
}

/**
 * Recursively scans a root folder.
 * Node shape (kept small, it is sent to the webview):
 *   { n: name, d?: 1 (dir), c?: children, p?: presetId, s?: size, u?: 1 (not scanned) }
 */
async function scanRoot(rootPath, opts) {
  const enabled = new Set(opts.presets);
  const forceScan = opts.forceScan || new Set(); // relative paths the user re-included
  const custom = opts.patterns || [];
  const state = { count: 0, limit: opts.maxEntries || 200000, truncated: false, gitRepos: [] };

  async function walk(abs, rel) {
    let entries;
    try {
      entries = await fs.promises.readdir(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => {
      const ad = a.isDirectory(), bd = b.isDirectory();
      if (ad !== bd) return ad ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    const out = [];
    for (const e of entries) {
      if (state.count >= state.limit) { state.truncated = true; break; }
      if (e.isSymbolicLink()) continue;
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? rel + '/' + e.name : e.name;
      state.count++;
      if (e.name === '.git') state.gitRepos.push(abs);
      if (e.isDirectory()) {
        const node = { n: e.name, d: 1 };
        const p = presetFor(e.name, true, childAbs, enabled, childRel + '/', custom);
        if (p) node.p = p;
        // Never descend into .git; don't descend into preset folders unless re-included
        if (e.name === '.git' || (p && !forceScan.has(childRel))) {
          node.u = 1;
          node.c = [];
        } else {
          node.c = await walk(childAbs, childRel);
        }
        out.push(node);
      } else if (e.isFile()) {
        const node = { n: e.name };
        const p = presetFor(e.name, false, childAbs, enabled, childRel, custom);
        if (p) node.p = p;
        out.push(node);
      }
    }
    return out;
  }

  const children = await walk(rootPath, '');
  return { children, truncated: state.truncated, count: state.count, gitRepos: state.gitRepos };
}

module.exports = { PRESETS, DEFAULT_PRESETS, scanRoot };
