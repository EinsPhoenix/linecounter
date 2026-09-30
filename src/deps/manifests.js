'use strict';

const fs = require('fs');
const path = require('path');

/** PEP 503 normalisation of Python distribution names. */
const pyName = n => String(n).toLowerCase().replace(/[-_.]+/g, '-');

const MANIFEST_NAMES = new Set(['package.json', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg', 'Cargo.toml', 'go.mod']);
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
/** Reads a TOML array value (strings may contain "]", e.g. "pydantic[email]>=2"). */
function tomlArray(lines, key) {
  const text = lines.join('\n');
  const m = new RegExp('^\\s*' + key.replace(/[.-]/g, '\\$&') + '\\s*=\\s*\\[', 'm').exec(text);
  if (!m) return [];
  return readTomlArrayFrom(text, m.index + m[0].length);
}
function readTomlArrayFrom(text, i) {
  const out = [];
  let depth = 1;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const q = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      const end = text.indexOf(q, i + q.length);
      if (end < 0) break;
      if (depth === 1) out.push(text.slice(i + q.length, end));
      i = end + q.length;
      continue;
    }
    if (c === '#') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl; continue; }
    if (c === '[') depth++;
    if (c === ']') depth--;
    i++;
  }
  return out;
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
    if (sec === 'project.optional-dependencies' || sec === 'dependency-groups' || sec === 'tool.uv' || sec === 'tool.pdm.dev-dependencies') {
      const text2 = lines.join('\n');
      const re = /^\s*([\w.-]+)\s*=\s*\[/gm;
      let m;
      while ((m = re.exec(text2))) {
        const group = m[1];
        if (sec === 'tool.uv' && group !== 'dev-dependencies') continue;
        const dev = sec !== 'project.optional-dependencies' || /dev|test|lint|doc|type/i.test(group);
        for (const req of readTomlArrayFrom(text2, m.index + m[0].length)) pushReq(req, dev ? 'dev' : 'optional');
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

/** Rust Cargo.toml: [dependencies], [dev-dependencies], [build-dependencies], target specific and workspace tables */
function parseCargoToml(file) {
  const text = readText(file);
  if (text == null) return null;
  const deps = [];
  let section = '';
  let pkgName = null, inPackage = false;
  let sub = null; // [dependencies.foo] style table
  const typeOf = sec => (/(^|\.)dev-dependencies$/.test(sec) ? 'dev' : /(^|\.)build-dependencies$/.test(sec) ? 'build' : 'prod');
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (h) {
      section = h[1].trim().replace(/\s+/g, '');
      inPackage = section === 'package';
      const m = /^(?:target\.[^.]+(?:\.[^.]+)*\.|workspace\.)?((?:dev-|build-)?dependencies)\.("?)([\w-]+)\2$/.exec(section.replace(/'[^']*'/g, 'X'));
      sub = m ? { name: m[3], type: typeOf(m[1]) } : null;
      if (sub) deps.push({ name: sub.name, spec: '', type: sub.type });
      continue;
    }
    if (inPackage) { const n = /^\s*name\s*=\s*"([^"]+)"/.exec(line); if (n) pkgName = n[1]; continue; }
    if (sub) {
      const v = /^\s*version\s*=\s*"([^"]+)"/.exec(line);
      if (v) deps[deps.length - 1].spec = v[1];
      const pk = /^\s*package\s*=\s*"([^"]+)"/.exec(line);
      if (pk) { deps[deps.length - 1].crate = pk[1]; }
      continue;
    }
    if (!/(^|\.)((dev-|build-)?dependencies)$/.test(section)) continue;
    const m = /^\s*("?)([\w-]+)\1\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    const val = m[3].trim();
    let spec = '', crate = null;
    if (val.startsWith('"')) spec = val.replace(/^"|"$/g, '');
    else {
      const v = /version\s*=\s*"([^"]+)"/.exec(val); if (v) spec = v[1];
      const pk = /package\s*=\s*"([^"]+)"/.exec(val); if (pk) crate = pk[1];
      if (/\b(path|workspace)\s*=/.test(val) && !v) spec = /path\s*=/.test(val) ? 'path' : 'workspace';
    }
    deps.push({ name: m[2], spec, type: typeOf(section), crate });
  }
  // local path / workspace crates are not packages of the registry
  const out = deps.filter(d => d.spec !== 'path').map(d => ({ ...d, pinned: /^=\s*\d/.test(d.spec) ? d.spec.replace(/^=\s*/, '') : null }));
  return { ecosystem: 'crates.io', file, dir: path.dirname(file), name: pkgName || path.basename(path.dirname(file)), deps: out };
}

/** Go go.mod: module path and required modules (exact versions, "// indirect" = transitive) */
function parseGoMod(file) {
  const text = readText(file);
  if (text == null) return null;
  const mod = /^\s*module\s+(\S+)/m.exec(text);
  const deps = [];
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) { inBlock = true; continue; }
    if (inBlock && line === ')') { inBlock = false; continue; }
    const m = (inBlock ? /^(\S+)\s+(v[^\s/]+)(.*)$/ : /^require\s+(\S+)\s+(v[^\s/]+)(.*)$/).exec(line);
    if (!m) continue;
    deps.push({ name: m[1], spec: m[2], pinned: m[2], type: /\/\/\s*indirect/.test(m[3]) ? 'indirect' : 'prod' });
  }
  return { ecosystem: 'Go', file, dir: path.dirname(file), name: mod ? mod[1] : path.basename(path.dirname(file)), module: mod ? mod[1] : null, deps };
}

/** 1-based line of a dependency declaration in the manifest text (for "open at line"). */
function declarationLine(text, name, ecosystem) {
  const lines = text.split(/\r?\n/);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = ecosystem === 'npm'
    ? new RegExp(`"${esc}"\\s*:`)
    : ecosystem === 'Go' ? new RegExp(`(^|\\s)${esc}\\s+v`)
    : ecosystem === 'crates.io' ? new RegExp(`^\\s*("?)${esc}\\1\\s*=|dependencies\\.${esc}\\]`)
    : new RegExp(`(^|["'\\s])${esc.replace(/[-_.]+/g, '[-_.]')}\\s*(\\[|=|>|<|~|!|;|"|'|,|$)`, 'i');
  const i = lines.findIndex(l => re.test(l));
  return i >= 0 ? i + 1 : null;
}

function parseManifest(file) {
  const m = parseManifestRaw(file);
  if (m) {
    const text = readText(file) || '';
    for (const d of m.deps) d.line = declarationLine(text, d.name, m.ecosystem);
  }
  return m;
}

function parseManifestRaw(file) {
  const name = path.basename(file);
  if (name === 'package.json') return parsePackageJson(file);
  if (name === 'pyproject.toml') return parsePyproject(file);
  if (name === 'Pipfile') return parsePipfile(file);
  if (name === 'setup.py') return parseSetupPy(file);
  if (name === 'setup.cfg') return parseSetupCfg(file);
  if (name === 'Cargo.toml') return parseCargoToml(file);
  if (name === 'go.mod') return parseGoMod(file);
  if (/^requirements.*\.(txt|in)$/i.test(name)) return parseRequirementsTxt(file);
  return null;
}

module.exports = { parseManifest, isManifest, parseRequirement, pyName };
