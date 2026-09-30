'use strict';

const path = require('path');
const { parseManifest, isManifest, pyName } = require('./manifests');
const { npmInstalled, findSitePackages, pyInstalled, pyLockVersions, cargoLock, cargoLocalLicense, goLocalLicense, goSumModules } = require('./installed');
const { classifyLicense } = require('./licenses');
const { checkVulnerabilities } = require('./vulns');
const { analyzeUsage } = require('./usage');
const { fillFromRegistry } = require('./registry');

const EXACT_VERSION = /^v?(\d+\.\d+(\.\d+)?([-.+][\w.]+)?)$/;

/**
 * Dependency report: licenses, vulnerabilities and unused / undeclared packages for npm and Python projects.
 * files: analyzed files (with abs, path, root, rootName, lang, deps)
 * opts: { policy, includeTransitiveLicenses, vulnerabilities: { enabled, includeTransitive }, ignorePackages, onProgress }
 */
async function scanDependencies(files, opts) {
  const report = { manifests: [], packages: [], usage: [], vulns: { enabled: !!(opts.vulnerabilities && opts.vulnerabilities.enabled), items: [], checked: 0, error: null }, policy: opts.policy };
  const manifestFiles = files.filter(f => isManifest(f.name || path.basename(f.abs)) && !/[\\/]node_modules[\\/]|[\\/]site-packages[\\/]/.test(f.abs));
  const manifests = manifestFiles.map(f => { const m = parseManifest(f.abs); if (m) { m.rel = (f.rootName ? f.rootName + '/' : '') + f.path; m.rootPath = f.root; } return m; }).filter(m => m && m.deps.length);
  if (!manifests.length) return report;
  report.manifests = manifests.map(m => ({ ecosystem: m.ecosystem, file: m.rel, abs: m.file, name: m.name, deps: m.deps.length }));

  const ignore = new Set((opts.ignorePackages || []).map(s => String(s).toLowerCase()));
  const judge = lic => classifyLicense(lic || 'Unknown', opts.policy);

  // ---- npm ----
  const npmByDir = new Map();
  const npmManifestNames = manifests.filter(x => x.ecosystem === 'npm').map(x => x.name);
  const pkgMap = new Map(); // key -> package row
  for (const m of manifests.filter(x => x.ecosystem === 'npm')) {
    if (!npmByDir.has(m.dir)) npmByDir.set(m.dir, npmInstalled(m.dir));
    const inst = npmByDir.get(m.dir);
    const direct = new Map(m.deps.map(d => [d.name, d]));
    const own = new Set(npmManifestNames);
    const add = (name, info, d) => {
      const key = `npm|${name}|${info ? info.version : d && d.spec}`;
      const existing = pkgMap.get(key);
      if (existing) { if (d) { existing.direct = true; existing.dev = existing.dev && d.type === 'dev'; if (!existing.manifests.includes(m.rel)) { existing.manifests.push(m.rel); existing.decl.push({ file: m.file, line: d.line }); } } return; }
      const version = info ? info.version : (d && EXACT_VERSION.test(d.spec) ? d.spec.replace(/^v/, '') : null);
      if (own.has(name)) return; // the project itself (workspaces)
      const license = (info && info.license) || 'Unknown';
      pkgMap.set(key, {
        ecosystem: 'npm', name, version, spec: d ? d.spec : null, license, ...judge(license),
        direct: !!d, dev: d ? d.type === 'dev' : !!(info && info.dev), installed: !!(info && (info.dir || info.license)), manifests: [m.rel],
        decl: d ? [{ file: m.file, line: d.line }] : [],
        dir: info ? info.dir : null, ignored: ignore.has(name.toLowerCase()),
      });
    };
    for (const d of m.deps) add(d.name, inst.get(d.name), d);
    if (opts.includeTransitiveLicenses) for (const [name, info] of inst) if (!direct.has(name)) add(name, info, null);
  }

  // ---- Python ----
  const pyManifests = manifests.filter(x => x.ecosystem === 'PyPI');
  let pyInst = new Map();
  if (pyManifests.length) {
    const dirs = [...new Set([...pyManifests.map(m => m.dir), ...pyManifests.map(m => m.rootPath).filter(Boolean)])];
    pyInst = pyInstalled(findSitePackages(dirs));
    const lockVersions = new Map();
    for (const d of dirs) for (const [k, v] of pyLockVersions(d)) lockVersions.set(k, v);
    const declaredAll = new Set();
    const ownPy = new Set(pyManifests.map(m => pyName(m.name)));
    for (const m of pyManifests) {
      for (const d of m.deps) {
        const n = pyName(d.name);
        declaredAll.add(n);
        const info = pyInst.get(n);
        const version = info ? info.version : lockVersions.get(n) || d.pinned || null;
        const key = `py|${n}|${version}`;
        const existing = pkgMap.get(key);
        if (existing) { existing.direct = true; if (!existing.manifests.includes(m.rel)) { existing.manifests.push(m.rel); existing.decl.push({ file: m.file, line: d.line }); } continue; }
        const license = info ? info.license : 'Unknown';
        pkgMap.set(key, {
          ecosystem: 'PyPI', name: info ? info.name : d.name, version, spec: d.spec || null, license, ...judge(license),
          direct: true, dev: d.type === 'dev', installed: !!info, manifests: [m.rel], dir: info ? info.dir : null, ignored: ignore.has(n),
          decl: [{ file: m.file, line: d.line }],
        });
      }
    }
    if (opts.includeTransitiveLicenses) {
      for (const [n, info] of pyInst) {
        if (declaredAll.has(n) || ownPy.has(n) || ['pip', 'setuptools', 'wheel', 'distribute', 'pkg-resources'].includes(n)) continue;
        pkgMap.set(`py|${n}|${info.version}`, {
          ecosystem: 'PyPI', name: info.name, version: info.version, spec: null, license: info.license, ...judge(info.license),
          direct: false, dev: false, installed: true, manifests: [], dir: info.dir, ignored: ignore.has(n), decl: [],
        });
      }
    }
  }
  // ---- Rust (crates.io) ----
  for (const m of manifests.filter(x => x.ecosystem === 'crates.io')) {
    const lock = cargoLock(m.dir);
    const locked = new Map();
    for (const p of lock ? lock.packages : []) { if (!locked.has(p.name)) locked.set(p.name, []); locked.get(p.name).push(p.version); }
    const own = new Set(manifests.filter(x => x.ecosystem === 'crates.io').map(x => x.name));
    const addCrate = (name, version, d) => {
      const key = `cargo|${name}|${version || (d && d.spec)}`;
      const existing = pkgMap.get(key);
      if (existing) { if (d) { existing.direct = true; if (!existing.manifests.includes(m.rel)) { existing.manifests.push(m.rel); existing.decl.push({ file: m.file, line: d.line }); } } return; }
      const local = version ? cargoLocalLicense(name, version) : null;
      const license = local ? local.license : 'Unknown';
      pkgMap.set(key, {
        ecosystem: 'crates.io', name, version: version || null, spec: d ? d.spec : null, license, ...judge(license), licenseSource: local ? 'cargo cache' : null,
        direct: !!d, dev: d ? d.type !== 'prod' : false, installed: !!local, manifests: d ? [m.rel] : [], decl: d ? [{ file: m.file, line: d.line }] : [],
        dir: local ? local.dir : null, ignored: ignore.has(name.toLowerCase()),
      });
    };
    const direct = new Set();
    for (const d of m.deps) {
      if (d.spec === 'workspace') continue;
      const crate = d.crate || d.name;
      direct.add(crate);
      const versions = locked.get(crate) || [];
      addCrate(crate, versions[versions.length - 1] || d.pinned || null, d);
    }
    if (opts.includeTransitiveLicenses && lock) for (const p of lock.packages) if (p.registry && !direct.has(p.name) && !own.has(p.name)) addCrate(p.name, p.version, null);
  }

  // ---- Go modules ----
  for (const m of manifests.filter(x => x.ecosystem === 'Go')) {
    const addMod = (name, version, d) => {
      const key = `go|${name}|${version}`;
      const existing = pkgMap.get(key);
      if (existing) { if (d) { existing.direct = existing.direct || d.type !== 'indirect'; if (!existing.manifests.includes(m.rel)) { existing.manifests.push(m.rel); existing.decl.push({ file: m.file, line: d.line }); } } return; }
      const local = goLocalLicense(name, version);
      const license = local ? local.license : 'Unknown';
      pkgMap.set(key, {
        ecosystem: 'Go', name, version, spec: d ? d.spec : null, license, ...judge(license), licenseSource: local ? 'module cache' : null,
        direct: !!d && d.type !== 'indirect', dev: false, installed: !!local, manifests: d ? [m.rel] : [], decl: d ? [{ file: m.file, line: d.line }] : [],
        dir: local ? local.dir : null, ignored: ignore.has(name.toLowerCase()),
      });
    };
    for (const d of m.deps) addMod(d.name, d.pinned, d);
    if (opts.includeTransitiveLicenses) for (const x of goSumModules(m.dir)) if (x.name !== m.module) addMod(x.name, x.version, null);
  }

  // ---- licenses that are still unknown: registry -> package archive -> deps.dev -> GitHub ----
  if (opts.fetchFromRegistry) {
    if (opts.onProgress) opts.onProgress('Looking up unknown licenses (registries, package archives, deps.dev, GitHub)…');
    try { report.registry = await fillFromRegistry([...pkgMap.values()], { timeoutMs: opts.registryTimeoutMs || 10000, onProgress: opts.onProgress }); } catch (e) { report.registry = { error: e.message }; }
  }
  for (const p of pkgMap.values()) Object.assign(p, judge(p.license));
  report.packages = [...pkgMap.values()].sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name));
  report.pythonEnvironments = pyInst.size ? [...new Set([...pyInst.values()].map(p => path.dirname(p.dir)))] : [];

  // ---- unused / undeclared ----
  try {
    report.usage = analyzeUsage(manifests, files, { npm: npmByDir, py: pyInst });
  } catch (e) {
    report.usage = [];
    report.usageError = e.message;
  }

  // ---- vulnerabilities ----
  if (report.vulns.enabled) {
    const toCheck = report.packages.filter(p => p.version && !p.ignored && (p.direct || opts.vulnerabilities.includeTransitive));
    report.vulns.unresolved = report.packages.filter(p => p.direct && !p.version).map(p => `${p.ecosystem}:${p.name}`);
    if (opts.onProgress) opts.onProgress(`Checking ${toCheck.length} packages for known vulnerabilities (OSV.dev)…`);
    try {
      const res = await checkVulnerabilities(toCheck.map(p => ({ ecosystem: p.ecosystem, name: p.name, version: p.version, direct: p.direct, dev: p.dev })), { timeoutMs: opts.vulnerabilities.timeoutMs || 20000, client: opts.vulnerabilities.client });
      report.vulns.checked = res.checked;
      for (const r of res.results) for (const v of r.vulns) report.vulns.items.push({ ecosystem: r.ecosystem, name: r.name, version: r.version, direct: r.direct, dev: r.dev, ...v });
      const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0, UNKNOWN: 0 };
      report.vulns.items.sort((a, b) => rank[b.severity] - rank[a.severity] || (b.score || 0) - (a.score || 0));
      for (const p of report.packages) p.vulnCount = report.vulns.items.filter(v => v.name === p.name && v.version === p.version && v.ecosystem === p.ecosystem).length;
    } catch (e) {
      report.vulns.error = e.message;
    }
  }
  return report;
}

module.exports = { scanDependencies };
