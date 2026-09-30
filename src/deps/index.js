'use strict';

const path = require('path');
const { parseManifest, isManifest, pyName } = require('./manifests');
const { npmInstalled, findSitePackages, pyInstalled, pyLockVersions } = require('./installed');
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
  // ---- licenses of packages that are not installed: ask the registries ----
  if (opts.fetchFromRegistry) {
    if (opts.onProgress) opts.onProgress('Looking up licenses of packages that are not installed (npm / PyPI registry)…');
    try { report.registry = await fillFromRegistry([...pkgMap.values()], { timeoutMs: opts.registryTimeoutMs || 10000 }); } catch (e) { report.registry = { error: e.message }; }
    for (const p of pkgMap.values()) if (p.licenseSource === 'registry') Object.assign(p, judge(p.license));
  }
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
