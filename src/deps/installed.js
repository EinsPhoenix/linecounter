'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeLicense, sniffLicenseText, fromClassifiers } = require('./licenses');
const { pyName } = require('./manifests');

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };

function licenseFromDir(dir) {
  for (const n of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING', 'license', 'license.md', 'LICENSE-MIT']) {
    const t = readText(path.join(dir, n));
    if (t) return sniffLicenseText(t);
  }
  return null;
}

function npmLicense(pkg, dir) {
  let raw = pkg.license;
  if (raw && typeof raw === 'object') raw = raw.type;
  if (!raw && Array.isArray(pkg.licenses)) raw = pkg.licenses.map(l => (typeof l === 'string' ? l : l.type)).join(' OR ');
  let lic = normalizeLicense(raw);
  if ((lic === 'Unknown' || lic === 'Custom') && dir) lic = licenseFromDir(dir) || lic;
  return lic;
}

/**
 * All npm packages installed for a project directory.
 * Uses package-lock.json (v2/v3 contains versions and licenses) and falls back to node_modules.
 * -> Map(name -> { name, version, license, dev, dir, source })
 */
function npmInstalled(projectDir) {
  const out = new Map();
  const lock = readJson(path.join(projectDir, 'package-lock.json')) || readJson(path.join(projectDir, 'npm-shrinkwrap.json'));
  if (lock && lock.packages) {
    for (const [key, v] of Object.entries(lock.packages)) {
      if (!key || !v || v.link) continue;
      const i = key.lastIndexOf('node_modules/');
      if (i < 0) continue;
      const name = key.slice(i + 'node_modules/'.length);
      const nested = key.indexOf('node_modules/') !== i;
      if (out.has(name) && nested) continue; // keep the hoisted (top level) version
      const dir = path.join(projectDir, key);
      let license = v.license ? normalizeLicense(v.license) : null;
      if (license === 'Custom' && /^see licen[cs]e in /i.test(String(v.license))) {
        const t = readText(path.join(dir, String(v.license).replace(/^see licen[cs]e in /i, '').trim()));
        license = (t && sniffLicenseText(t)) || 'Custom';
      }
      if (!license) {
        const pkg = readJson(path.join(dir, 'package.json'));
        license = pkg ? npmLicense(pkg, dir) : 'Unknown';
      }
      out.set(name, { name, version: v.version || null, license, dev: !!v.dev, optional: !!v.optional, dir, source: 'package-lock.json' });
    }
    if (out.size) return out;
  }
  // node_modules fallback (top level + scoped packages)
  const nm = path.join(projectDir, 'node_modules');
  let entries = [];
  try { entries = fs.readdirSync(nm, { withFileTypes: true }); } catch { return out; }
  const addPkg = (dir, name) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (pkg) out.set(name, { name, version: pkg.version || null, license: npmLicense(pkg, dir), dev: false, dir, source: 'node_modules' });
  };
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    if (e.name.startsWith('@')) {
      let sub = [];
      try { sub = fs.readdirSync(path.join(nm, e.name), { withFileTypes: true }); } catch { /* ignore */ }
      for (const s of sub) if (s.isDirectory()) addPkg(path.join(nm, e.name, s.name), `${e.name}/${s.name}`);
    } else addPkg(path.join(nm, e.name), e.name);
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

module.exports = { npmInstalled, findSitePackages, pyInstalled, pyLockVersions, parseMetadata };
