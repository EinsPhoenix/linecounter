'use strict';

const fs = require('fs');
const path = require('path');

/** PEP 503 normalisation of Python distribution names. */
const pyName = n => String(n).toLowerCase().replace(/[-_.]+/g, '-');

const MANIFEST_NAMES = new Set(['package.json', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg']);
const isManifest = name => MANIFEST_NAMES.has(name) || /^requirements.*\.(txt|in)$/i.test(name);

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

/** npm package.json -> declared dependencies */
function parsePackageJson(file) {
  let pkg;
  try { pkg = JSON.parse(readText(file)); } catch { return null; }
  if (!pkg || typeof pkg !== 'object') return null;
  const deps = [];
  const add = (obj, type) => { for (const [name, spec] of Object.entries(obj || {})) deps.push({ name, spec: String(spec), type }); };
  add(pkg.dependencies, 'prod');
  add(pkg.devDependencies, 'dev');
  add(pkg.optionalDependencies, 'optional');
  add(pkg.peerDependencies, 'peer');
  return { ecosystem: 'npm', file, dir: path.dirname(file), name: pkg.name || path.basename(path.dirname(file)), deps, scripts: pkg.scripts || {}, raw: pkg };
}

/** One requirement line like `Django[bcrypt]>=4.2,<5 ; python_version>"3.8"` */
function parseRequirement(line) {
  const l = line.replace(/\s+#.*$/, '').trim();
  if (!l || l.startsWith('#') || l.startsWith('-') || /^[a-z]+\+?[a-z]*:\/\//i.test(l)) return null;
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(l);
  if (!m) return null;
  const spec = m[3].split(';')[0].trim();
  const pin = /^==\s*([^,\s]+)/.exec(spec);
  return { name: m[1], spec, pinned: pin ? pin[1] : null };
}

function parseRequirementsTxt(file) {
  const text = readText(file);
  if (text == null) return null;
  const dev = /dev|test|lint|doc/i.test(path.basename(file));
  const deps = [];
  for (const line of text.split(/\r?\n/)) {
    const r = parseRequirement(line);
    if (r) deps.push({ ...r, type: dev ? 'dev' : 'prod' });
  }
  return { ecosystem: 'PyPI', file, dir: path.dirname(file), name: path.basename(path.dirname(file)), deps };
}

/** Minimal TOML reading for dependency tables and arrays (enough for pyproject.toml / Pipfile). */
function tomlSections(text) {
  const sections = new Map();
  let cur = '';
  sections.set(cur, []);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^\s*\[\[?([^\]]+)\]\]?\s*(#.*)?$/.exec(line);
    if (h) { cur = h[1].trim(); if (!sections.has(cur)) sections.set(cur, []); continue; }
    sections.get(cur).push(line);
  }
  return sections;
}
function tomlArray(lines, key) {
  const text = lines.join('\n');
  const m = new RegExp('^\\s*' + key.replace(/[.-]/g, '\\$&') + '\\s*=\\s*\\[([\\s\\S]*?)\\]', 'm').exec(text);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map(x => x[1] ?? x[2]);
}
function tomlTableKeys(lines) {
  const out = [];
  for (const line of lines) {
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const val = m[2].trim();
    const ver = /^["']([^"']*)["']/.exec(val) || /version\s*=\s*["']([^"']*)["']/.exec(val);
    out.push({ name: m[1], spec: ver ? ver[1] : val });
  }
  return out;
}

function parsePyproject(file) {
  const text = readText(file);
  if (text == null) return null;
  const S = tomlSections(text);
  const deps = [];
  const pushReq = (req, type) => { const r = parseRequirement(req); if (r) deps.push({ ...r, type }); };
  if (S.has('project')) {
    for (const r of tomlArray(S.get('project'), 'dependencies')) pushReq(r, 'prod');
  }
  for (const [sec, lines] of S) {
    if (sec === 'project.optional-dependencies' || sec === 'dependency-groups') {
      const text2 = lines.join('\n');
      for (const m of text2.matchAll(/^\s*([\w.-]+)\s*=\s*\[([\s\S]*?)\]/gm)) {
        for (const q of m[2].matchAll(/"([^"]*)"|'([^']*)'/g)) pushReq(q[1] ?? q[2], /dev|test|lint|doc/i.test(m[1]) ? 'dev' : 'optional');
      }
    }
    if (sec === 'tool.poetry.dependencies' || /^tool\.poetry\.(dev-dependencies|group\.[^.]+\.dependencies)$/.test(sec)) {
      const type = sec === 'tool.poetry.dependencies' ? 'prod' : 'dev';
      for (const d of tomlTableKeys(lines)) if (d.name.toLowerCase() !== 'python') deps.push({ name: d.name, spec: d.spec, pinned: null, type });
    }
  }
  const nameM = S.has('project') ? /^\s*name\s*=\s*["']([^"']+)/m.exec(S.get('project').join('\n')) : null;
  return { ecosystem: 'PyPI', file, dir: path.dirname(file), name: nameM ? nameM[1] : path.basename(path.dirname(file)), deps };
}

function parsePipfile(file) {
  const text = readText(file);
  if (text == null) return null;
  const S = tomlSections(text);
  const deps = [];
  for (const d of tomlTableKeys(S.get('packages') || [])) deps.push({ name: d.name, spec: d.spec, pinned: null, type: 'prod' });
  for (const d of tomlTableKeys(S.get('dev-packages') || [])) deps.push({ name: d.name, spec: d.spec, pinned: null, type: 'dev' });
  return { ecosystem: 'PyPI', file, dir: path.dirname(file), name: path.basename(path.dirname(file)), deps };
}

function parseSetupPy(file) {
  const text = readText(file);
  if (text == null) return null;
  const deps = [];
  const m = /install_requires\s*=\s*\[([\s\S]*?)\]/.exec(text);
  if (m) for (const q of m[1].matchAll(/"([^"]*)"|'([^']*)'/g)) { const r = parseRequirement(q[1] ?? q[2]); if (r) deps.push({ ...r, type: 'prod' }); }
  return deps.length ? { ecosystem: 'PyPI', file, dir: path.dirname(file), name: path.basename(path.dirname(file)), deps } : null;
}

function parseSetupCfg(file) {
  const text = readText(file);
  if (text == null) return null;
  const m = /install_requires\s*=\s*\n((?:[ \t]+.*\n?)+)/.exec(text);
  if (!m) return null;
  const deps = m[1].split('\n').map(parseRequirement).filter(Boolean).map(r => ({ ...r, type: 'prod' }));
  return deps.length ? { ecosystem: 'PyPI', file, dir: path.dirname(file), name: path.basename(path.dirname(file)), deps } : null;
}

function parseManifest(file) {
  const name = path.basename(file);
  if (name === 'package.json') return parsePackageJson(file);
  if (name === 'pyproject.toml') return parsePyproject(file);
  if (name === 'Pipfile') return parsePipfile(file);
  if (name === 'setup.py') return parseSetupPy(file);
  if (name === 'setup.cfg') return parseSetupCfg(file);
  if (/^requirements.*\.(txt|in)$/i.test(name)) return parseRequirementsTxt(file);
  return null;
}

module.exports = { parseManifest, isManifest, parseRequirement, pyName };
