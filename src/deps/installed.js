'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizeLicense, sniffLicenseText, fromClassifiers } = require('./licenses');
const { pyName } = require('./manifests');

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };

function licenseFromDir(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  const found = [];
  for (const n of entries.filter(e => /^(un)?licen[cs]e([-._][\w.-]+)?(\.(md|txt|rst))?$|^copying(\.(md|txt))?$/i.test(e)).sort()) {
    const t = readText(path.join(dir, n));
    const id = t && sniffLicenseText(t);
    if (id && !found.includes(id)) found.push(id);
  }
  return found.length ? found.join(' OR ') : null;
}

function npmLicense(pkg, dir) {
  let raw = pkg.license;
  if (raw && typeof raw === 'object') raw = raw.type;
  if (!raw && Array.isArray(pkg.licenses)) raw = pkg.licenses.map(l => (typeof l === 'string' ? l : l.type)).join(' OR ');
  let lic = normalizeLicense(raw);
  if ((lic === 'Unknown' || lic === 'Custom') && dir) lic = licenseFromDir(dir) || lic;
  return lic;
}

/** Directories from `dir` upwards (at most `max` levels). */
function ancestors(dir, max = 6) {
  const out = [];
  let d = path.resolve(dir);
  for (let i = 0; i <= max; i++) {
    out.push(d);
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return out;
}
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }; // follows symlinks (pnpm)
const posixRel = (from, to) => path.relative(from, to).split(path.sep).join('/');
const cleanVersion = v => (v ? String(v).replace(/^[=v]+/, '').replace(/\(.*$/, '').trim() : null);

/** Versions from pnpm-lock.yaml (v5–v9) for one importer (project folder). */
function pnpmVersions(lockText, rel) {
  const out = new Map();
  const lines = lockText.split(/\r?\n/);
  const want = rel || '.';
  let inImporters = false, inImporter = false, section = null, pkg = null;
  for (const line of lines) {
    if (/^importers:/.test(line)) { inImporters = true; continue; }
    if (/^\S/.test(line) && !/^importers:/.test(line)) inImporters = false;
    if (inImporters) {
      const imp = /^ {2}(\S.*?):\s*$/.exec(line);
      if (imp) { inImporter = imp[1].replace(/^['"]|['"]$/g, '') === want; section = null; continue; }
      if (!inImporter) continue;
      const sec = /^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/.exec(line);
      if (sec) { section = sec[1]; continue; }
      if (!section) continue;
      const dep = /^ {6}(\S+?):\s*(.*)$/.exec(line);
      if (dep) {
        pkg = dep[1].replace(/^['"]|['"]$/g, '');
        if (dep[2] && !/^\s*$/.test(dep[2])) out.set(pkg, { version: cleanVersion(dep[2]), dev: section === 'devDependencies' }); // v5 style
        continue;
      }
      const ver = /^ {8}version:\s*(.*)$/.exec(line);
      if (ver && pkg) out.set(pkg, { version: cleanVersion(ver[1].replace(/^['"]|['"]$/g, '')), dev: section === 'devDependencies' });
    }
  }
  // lock files without importers (single project, v5): top-level dependencies:
  if (!out.size) {
    let sec = null;
    for (const line of lines) {
      const s = /^(dependencies|devDependencies|optionalDependencies):\s*$/.exec(line);
      if (s) { sec = s[1]; continue; }
      if (/^\S/.test(line)) sec = null;
      const d = sec && /^ {2}(\S+?):\s*(\S.*)$/.exec(line);
      if (d) out.set(d[1].replace(/^['"]|['"]$/g, ''), { version: cleanVersion(d[2]), dev: sec === 'devDependencies' });
    }
  }
  return out;
}

/** Versions from yarn.lock (classic and berry). */
function yarnVersions(lockText) {
  const out = new Map();
  for (const block of lockText.split(/\r?\n\r?\n/)) {
    const head = /^"?((?:@[^@/\s"]+\/)?[^@\s",]+)@/m.exec(block);
    const ver = /^\s+version:?\s+"?([^"\s]+)"?/m.exec(block);
    if (head && ver && !out.has(head[1])) out.set(head[1], { version: ver[1], dev: false });
  }
  return out;
}

/**
 * All npm packages installed for a project directory.
 * Looks for package-lock.json / pnpm-lock.yaml / yarn.lock and node_modules in the project folder and
 * its parents (npm / pnpm / yarn workspaces), follows symlinks (pnpm) and reads licenses from the lock
 * file or the installed package.json.
 * -> Map(name -> { name, version, license, dev, dir, source })
 */
function npmInstalled(projectDir) {
  const out = new Map();
  const dirs = ancestors(projectDir);
  // ---- lock files ----
  for (const d of dirs) {
    const lock = readJson(path.join(d, 'package-lock.json')) || readJson(path.join(d, 'npm-shrinkwrap.json'));
    if (lock && lock.packages) {
      const rel = posixRel(d, projectDir);
      const prefixes = rel ? [`${rel}/node_modules/`, 'node_modules/'] : ['node_modules/'];
      for (const prefix of prefixes) {
        for (const [key, v] of Object.entries(lock.packages)) {
          if (!v || v.link || !key.startsWith(prefix)) continue;
          const name = key.slice(prefix.length);
          if (name.includes('/node_modules/') || out.has(name)) continue; // nested copies / already found closer
          const dir = path.join(d, key);
          let license = v.license ? normalizeLicense(v.license) : null;
          if (license === 'Custom' && /^see licen[cs]e in /i.test(String(v.license))) {
            const t = readText(path.join(dir, String(v.license).replace(/^see licen[cs]e in /i, '').trim()));
            license = (t && sniffLicenseText(t)) || 'Custom';
          }
          out.set(name, { name, version: v.version || null, license, dev: !!v.dev, optional: !!v.optional, dir, source: 'package-lock.json' });
        }
      }
      break;
    }
    const pnpm = readText(path.join(d, 'pnpm-lock.yaml'));
    if (pnpm) {
      for (const [name, v] of pnpmVersions(pnpm, posixRel(d, projectDir))) if (!out.has(name)) out.set(name, { name, version: v.version, license: null, dev: v.dev, dir: null, source: 'pnpm-lock.yaml' });
      break;
    }
    const yarn = readText(path.join(d, 'yarn.lock'));
    if (yarn) {
      for (const [name, v] of yarnVersions(yarn)) if (!out.has(name)) out.set(name, { name, version: v.version, license: null, dev: false, dir: null, source: 'yarn.lock' });
      break;
    }
  }
  // ---- node_modules (project folder first, then hoisted ones in parent folders) ----
  const readPkg = (dir, name) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg) return;
    const cur = out.get(name);
    if (cur && cur.license && cur.dir) return;
    out.set(name, {
      name, version: (cur && cur.version) || pkg.version || null,
      license: (cur && cur.license) || npmLicense(pkg, dir), dev: cur ? cur.dev : false, dir,
      source: cur ? cur.source : 'node_modules',
    });
  };
  for (const d of dirs) {
    const nm = path.join(d, 'node_modules');
    let entries = [];
    try { entries = fs.readdirSync(nm); } catch { continue; }
    for (const e of entries) {
      if (e.startsWith('.')) continue;
      const p = path.join(nm, e);
      if (e.startsWith('@')) {
        let sub = [];
        try { sub = fs.readdirSync(p); } catch { /* ignore */ }
        for (const s2 of sub) if (isDir(path.join(p, s2))) readPkg(path.join(p, s2), `${e}/${s2}`);
      } else if (isDir(p)) readPkg(p, e);
    }
  }
  return out;
}

/** site-packages folders of virtual environments near a project directory. */
function findSitePackages(dirs) {
  const found = new Set();
  const tryEnv = env => {
    for (const lib of ['lib', 'lib64']) {
      let pys = [];
      try { pys = fs.readdirSync(path.join(env, lib)).filter(n => /^python\d/.test(n)); } catch { /* ignore */ }
      for (const py of pys) { const sp = path.join(env, lib, py, 'site-packages'); if (exists(sp)) found.add(sp); }
    }
    const win = path.join(env, 'Lib', 'site-packages');
    if (exists(win)) found.add(win);
  };
  for (const d of dirs) {
    for (const n of ['.venv', 'venv', 'env', '.env', 'virtualenv', '.virtualenv']) tryEnv(path.join(d, n));
    let children = [];
    try { children = fs.readdirSync(d, { withFileTypes: true }); } catch { /* ignore */ }
    for (const c of children) if (c.isDirectory() && exists(path.join(d, c.name, 'pyvenv.cfg'))) tryEnv(path.join(d, c.name));
  }
  return [...found];
}

/** Parses RFC 822 style METADATA / PKG-INFO headers. */
function parseMetadata(text) {
  const head = text.split(/\r?\n\r?\n/)[0];
  const fields = {};
  const classifiers = [];
  const requires = [];
  let last = null;
  for (const line of head.split(/\r?\n/)) {
    if (/^\s/.test(line) && last) { fields[last] += '\n' + line.trim(); continue; }
    const m = /^([\w-]+):\s?(.*)$/.exec(line);
    if (!m) continue;
    last = m[1];
    if (m[1] === 'Classifier') classifiers.push(m[2]);
    else if (m[1] === 'Requires-Dist') requires.push(m[2]);
    else fields[m[1]] = m[2];
  }
  return { fields, classifiers, requires };
}

/**
 * Installed Python distributions in the given site-packages folders.
 * -> Map(normalizedName -> { name, version, license, topLevel: [import names], requires: [names], dir })
 */
function pyInstalled(sitePackages) {
  const out = new Map();
  for (const sp of sitePackages) {
    let entries = [];
    try { entries = fs.readdirSync(sp); } catch { continue; }
    for (const e of entries) {
      if (!/\.(dist-info|egg-info)$/.test(e)) continue;
      const dir = path.join(sp, e);
      const meta = readText(path.join(dir, 'METADATA')) || readText(path.join(dir, 'PKG-INFO'));
      if (!meta) continue;
      const { fields, classifiers, requires } = parseMetadata(meta);
      if (!fields.Name) continue;
      let license = fields['License-Expression'] ? normalizeLicense(fields['License-Expression']) : null;
      if (!license || license === 'Unknown') license = fromClassifiers(classifiers);
      if ((!license || license === 'Unknown') && fields.License) license = normalizeLicense(fields.License.split('\n')[0]);
      if (!license || license === 'Unknown' || license === 'Custom') {
        let files = [];
        try { files = fs.readdirSync(dir).concat(exists(path.join(dir, 'licenses')) ? fs.readdirSync(path.join(dir, 'licenses')).map(f => 'licenses/' + f) : []); } catch { /* ignore */ }
        const lf = files.find(f => /licen[cs]e|copying/i.test(f));
        if (lf) license = sniffLicenseText(readText(path.join(dir, lf)) || '') || license || 'Unknown';
      }
      const top = (readText(path.join(dir, 'top_level.txt')) || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const name = fields.Name;
      out.set(pyName(name), {
        name, version: fields.Version || null, license: license || 'Unknown',
        topLevel: top.length ? top : [name.replace(/-/g, '_').toLowerCase()],
        requires: requires.filter(r => !/extra\s*==/.test(r)).map(r => pyName(/^[A-Za-z0-9._-]+/.exec(r)?.[0] || '')).filter(Boolean),
        dir, source: path.basename(sp),
      });
    }
  }
  return out;
}

/** Versions from Python lock files when no virtual environment is present. */
function pyLockVersions(dir) {
  const out = new Map();
  const pip = readJson(path.join(dir, 'Pipfile.lock'));
  if (pip) for (const sec of ['default', 'develop']) for (const [n, v] of Object.entries(pip[sec] || {})) if (v.version) out.set(pyName(n), v.version.replace(/^==/, ''));
  for (const lockName of ['poetry.lock', 'uv.lock', 'pdm.lock']) {
    const t = readText(path.join(dir, lockName));
    if (!t) continue;
    for (const block of t.split(/\n\[\[package\]\]\n/).slice(1)) {
      const n = /^name\s*=\s*"([^"]+)"/m.exec(block), v = /^version\s*=\s*"([^"]+)"/m.exec(block);
      if (n && v) out.set(pyName(n[1]), v[1]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Rust
/** Versions from the nearest Cargo.lock: Map(name -> [versions]) plus all locked registry packages */
function cargoLock(dir) {
  for (const d of ancestors(dir, 6)) {
    const text = readText(path.join(d, 'Cargo.lock'));
    if (!text) continue;
    const pkgs = [];
    for (const block of text.split(/\[\[package\]\]/).slice(1)) {
      const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block), version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block), source = /^\s*source\s*=\s*"([^"]+)"/m.exec(block);
      if (name && version) pkgs.push({ name: name[1], version: version[1], registry: !!(source && /registry/.test(source[1])) });
    }
    return { file: path.join(d, 'Cargo.lock'), packages: pkgs };
  }
  return null;
}
/** License of a crate that cargo already downloaded (~/.cargo/registry/src/<index>/<name>-<version>) */
function cargoLocalLicense(name, version) {
  const home = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
  let indexes = [];
  try { indexes = fs.readdirSync(path.join(home, 'registry', 'src')); } catch { return null; }
  for (const idx of indexes) {
    const dir = path.join(home, 'registry', 'src', idx, `${name}-${version}`);
    const toml = readText(path.join(dir, 'Cargo.toml'));
    if (!toml) continue;
    const m = /^\s*license\s*=\s*"([^"]+)"/m.exec(toml);
    const lic = m ? normalizeLicense(m[1]) : licenseFromDir(dir);
    return { license: lic || 'Unknown', dir };
  }
  return null;
}

// ---------------------------------------------------------------- Go
const goEscape = p => p.replace(/[A-Z]/g, c => '!' + c.toLowerCase());
/** License of a module in the local module cache (GOMODCACHE / GOPATH/pkg/mod) */
function goLocalLicense(mod, version) {
  const roots = [process.env.GOMODCACHE, process.env.GOPATH && path.join(process.env.GOPATH.split(path.delimiter)[0], 'pkg', 'mod'), path.join(os.homedir(), 'go', 'pkg', 'mod')].filter(Boolean);
  for (const r of roots) {
    const dir = path.join(r, ...goEscape(mod).split('/').slice(0, -1), goEscape(mod).split('/').pop() + '@' + version);
    if (!exists(dir)) continue;
    return { license: licenseFromDir(dir) || 'Unknown', dir };
  }
  return null;
}
/** Every module listed in go.sum next to go.mod (the full, transitive module graph) */
function goSumModules(dir) {
  const text = readText(path.join(dir, 'go.sum'));
  if (!text) return [];
  const seen = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\S+)\s+(v[^\s/]+?)(\/go\.mod)?\s+h1:/.exec(line);
    if (m && !m[3]) seen.set(m[1], m[2]);
  }
  return [...seen].map(([name, version]) => ({ name, version }));
}

module.exports = { npmInstalled, findSitePackages, pyInstalled, pyLockVersions, parseMetadata, cargoLock, cargoLocalLicense, goLocalLicense, goSumModules, licenseFromDir };
