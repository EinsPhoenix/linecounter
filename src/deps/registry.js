'use strict';

const https = require('https');
const { normalizeLicense, fromClassifiers, sniffLicenseText } = require('./licenses');
const { download, licenseFromArchive } = require('./archive');

/**
 * Thorough license lookup for every package whose license is Unknown or Custom (installed or not).
 * Sources, in this order – every attempt is recorded in `package.licenseTrail`:
 *   1. registry metadata   (registry.npmjs.org, pypi.org, crates.io, proxy.golang.org)
 *   2. the package archive (LICENSE / COPYING texts and metadata inside the .tgz / wheel / sdist / .crate / .zip)
 *   3. deps.dev            (Google's Open Source Insights, all ecosystems)
 *   4. GitHub              (license API of the repository the package points to)
 */
function getJson(url, timeoutMs, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'locomotive-vscode (license check)', ...headers }, timeout: timeoutMs }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(getJson(new URL(res.headers.location, url).toString(), timeoutMs, headers)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; if (buf.length > 4e7) req.destroy(new Error('response too large')); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** "^4.17.15" -> "4.17.15", "~=2.0" -> "2.0", ">=1.2,<2" -> "1.2" (lower bound of a range) */
function lowerBound(spec) {
  const m = /(\d+(?:\.\d+){0,3}(?:[-.]?[a-z]+\d*)?)/i.exec(String(spec || ''));
  return m && !/^\s*(<|!=)/.test(spec) ? m[1] : null;
}

const known = l => l && l !== 'Unknown' && l !== 'Custom';
const githubRepo = url => {
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/i.exec(String(url || ''));
  return m ? `${m[1]}/${m[2]}` : null;
};
/** Go module path escaping for the module proxy: upper case letters become "!" + lower case */
const goEscape = p => p.replace(/[A-Z]/g, c => '!' + c.toLowerCase());

/** per-ecosystem registry step: -> { license, version, archive: { url, kind }, repo } */
const REGISTRY = {
  async npm(p, t) {
    const enc = p.name.startsWith('@') ? '@' + encodeURIComponent(p.name.slice(1)) : encodeURIComponent(p.name);
    let doc;
    try { doc = await getJson(`https://registry.npmjs.org/${enc}/${p.version ? encodeURIComponent(p.version) : 'latest'}`, t); } catch (e) {
      if (!p.version) throw e;
      doc = await getJson(`https://registry.npmjs.org/${enc}/latest`, t);
    }
    let raw = doc.license;
    if (raw && typeof raw === 'object') raw = raw.type;
    if (!raw && Array.isArray(doc.licenses)) raw = doc.licenses.map(l => (typeof l === 'string' ? l : l.type)).join(' OR ');
    return { license: normalizeLicense(raw), version: doc.version, archive: doc.dist && doc.dist.tarball ? { url: doc.dist.tarball, kind: 'tar' } : null, repo: githubRepo(doc.repository && (doc.repository.url || doc.repository)) || githubRepo(doc.homepage) };
  },
  async PyPI(p, t) {
    let doc;
    try { doc = await getJson(`https://pypi.org/pypi/${encodeURIComponent(p.name)}/${p.version ? encodeURIComponent(p.version) + '/' : ''}json`, t); } catch (e) {
      if (!p.version) throw e;
      doc = await getJson(`https://pypi.org/pypi/${encodeURIComponent(p.name)}/json`, t);
    }
    const info = doc.info || {};
    let license = info.license_expression ? normalizeLicense(info.license_expression) : null;
    if (!known(license)) license = fromClassifiers(info.classifiers || []) || license;
    if (!known(license) && info.license) license = info.license.length < 200 ? normalizeLicense(info.license) : sniffLicenseText(info.license) || 'Custom';
    const files = doc.urls || [];
    const pick = files.find(f => f.packagetype === 'bdist_wheel') || files.find(f => f.packagetype === 'sdist');
    const urls = Object.values(info.project_urls || {}).concat(info.home_page || []);
    return { license: license || 'Unknown', version: info.version, archive: pick ? { url: pick.url, kind: pick.packagetype === 'bdist_wheel' ? 'zip' : 'tar' } : null, repo: urls.map(githubRepo).find(Boolean) || null };
  },
  async 'crates.io'(p, t) {
    const v = p.version || (await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(p.name)}`, t)).crate.max_stable_version;
    const doc = await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(p.name)}/${encodeURIComponent(v)}`, t);
    const ver = doc.version || {};
    return { license: normalizeLicense(ver.license), version: v, archive: { url: `https://static.crates.io/crates/${p.name}/${p.name}-${v}.crate`, kind: 'tar' }, repo: githubRepo(ver.repository) };
  },
  async Go(p, t) {
    const mod = goEscape(p.name);
    let v = p.version;
    if (!v) v = (await getJson(`https://proxy.golang.org/${mod}/@latest`, t)).Version;
    const repo = /^github\.com\//.test(p.name) ? p.name.split('/').slice(1, 3).join('/') : null;
    // Go modules have no license field – the answer is always in the module zip
    return { license: 'Unknown', version: v, archive: { url: `https://proxy.golang.org/${mod}/@v/${goEscape(v)}.zip`, kind: 'zip' }, repo };
  },
};
const DEPSDEV_SYSTEM = { npm: 'npm', PyPI: 'pypi', 'crates.io': 'cargo', Go: 'go' };

async function lookupOne(p, opts) {
  const t = opts.timeoutMs || 10000;
  const trail = p.licenseTrail || (p.licenseTrail = []);
  const set = (license, source) => { p.license = license; p.licenseSource = source; };
  let reg = null;
  // 1) registry metadata
  const step = REGISTRY[p.ecosystem];
  if (step) {
    try {
      reg = await step(p, t);
      trail.push({ source: 'registry', result: reg.license });
      if (!p.version && reg.version) { p.version = p.spec ? lowerBound(p.spec) || reg.version : reg.version; p.versionFromRange = !!p.spec; p.latest = reg.version; }
      if (known(reg.license)) { set(reg.license, 'registry'); return; }
    } catch (e) { trail.push({ source: 'registry', result: /HTTP 404/.test(e.message) ? 'failed: package not found in the registry (HTTP 404) – private, renamed or a typo?' : 'failed: ' + e.message }); }
  }
  // 2) the package archive
  if (reg && reg.archive && opts.archives !== false) {
    try {
      const buf = await download(reg.archive.url, { timeoutMs: t * 2 });
      const r = licenseFromArchive(buf, reg.archive.kind);
      trail.push({ source: 'archive', result: r ? `${r.license} (${r.source})` : 'no license file in the package' });
      if (r && known(r.license)) { set(r.license, 'archive'); return; }
      if (r && r.license === 'Custom' && !known(p.license)) set('Custom', 'archive');
    } catch (e) { trail.push({ source: 'archive', result: 'failed: ' + e.message }); }
  }
  // 3) deps.dev
  const sys = DEPSDEV_SYSTEM[p.ecosystem];
  const version = p.version || (reg && reg.version);
  if (sys && version && opts.depsDev !== false) {
    try {
      const doc = await getJson(`https://api.deps.dev/v3/systems/${sys}/packages/${encodeURIComponent(p.name)}/versions/${encodeURIComponent(p.ecosystem === 'Go' && !/^v/.test(version) ? 'v' + version : version)}`, t);
      const lic = (doc.licenses || []).filter(l => l && l !== 'non-standard');
      trail.push({ source: 'deps.dev', result: lic.length ? lic.join(' AND ') : 'no license' });
      if (lic.length) { set(normalizeLicense(lic.join(' AND ')), 'deps.dev'); return; }
    } catch (e) { trail.push({ source: 'deps.dev', result: 'failed: ' + e.message }); }
  }
  // 4) GitHub repository license
  const repo = reg && reg.repo;
  if (repo && opts.github !== false) {
    try {
      const doc = await getJson(`https://api.github.com/repos/${repo}/license`, t, { Accept: 'application/vnd.github+json' });
      const spdx = doc.license && doc.license.spdx_id;
      trail.push({ source: `github.com/${repo}`, result: spdx || 'no license' });
      if (spdx && spdx !== 'NOASSERTION') { set(normalizeLicense(spdx), 'github'); return; }
      if (doc.content) {
        const id = sniffLicenseText(Buffer.from(doc.content, 'base64').toString('utf8'));
        if (id) { set(id, 'github'); return; }
      }
    } catch (e) { trail.push({ source: `github.com/${repo}`, result: 'failed: ' + e.message }); }
  }
  if (!p.license) p.license = 'Unknown';
}

/**
 * Resolves licenses of all packages with an Unknown / Custom license (and fills versions of packages that
 * are not installed, needed for the vulnerability check). packages are modified in place.
 */
async function fillFromRegistry(packages, opts = {}) {
  const todo = packages.filter(p => !p.ignored && (!p.license || p.license === 'Unknown' || p.license === 'Custom' || (!p.installed && !p.version)));
  let failed = 0, resolved = 0;
  const conc = opts.concurrency || 8;
  for (let i = 0; i < todo.length; i += conc) {
    const batch = todo.slice(i, i + conc);
    await Promise.all(batch.map(async p => {
      const before = p.license;
      try { await lookupOne(p, opts); } catch { failed++; }
      if (!known(before) && known(p.license)) resolved++;
      if (p.licenseTrail && p.licenseTrail.length && p.licenseTrail.every(x => /^failed/.test(x.result))) failed++;
    }));
    if (opts.onProgress) opts.onProgress(`Looking up licenses… ${Math.min(i + conc, todo.length)}/${todo.length}`);
    if (i === 0 && failed >= batch.length && batch.length >= 4) break; // nothing reachable (offline)
  }
  return { looked: todo.length, resolved, failed };
}

module.exports = { fillFromRegistry, lowerBound, lookupOne, githubRepo, goEscape };
