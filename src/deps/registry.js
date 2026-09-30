'use strict';

const https = require('https');
const { normalizeLicense, fromClassifiers } = require('./licenses');

/**
 * License lookup in the public registries for packages that are declared but not installed
 * (no node_modules / virtual environment): registry.npmjs.org and pypi.org.
 */
function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' }, timeout: timeoutMs }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(getJson(res.headers.location, timeoutMs)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; if (buf.length > 4e7) req.destroy(new Error('response too large')); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`${url}: HTTP ${res.statusCode}`));
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

async function npmLicense(name, version, timeoutMs) {
  const enc = name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : encodeURIComponent(name);
  let doc;
  try { doc = await getJson(`https://registry.npmjs.org/${enc}/${version ? encodeURIComponent(version) : 'latest'}`, timeoutMs); } catch (e) {
    if (!version) throw e;
    doc = await getJson(`https://registry.npmjs.org/${enc}/latest`, timeoutMs);
  }
  let raw = doc.license;
  if (raw && typeof raw === 'object') raw = raw.type;
  if (!raw && Array.isArray(doc.licenses)) raw = doc.licenses.map(l => (typeof l === 'string' ? l : l.type)).join(' OR ');
  return { license: normalizeLicense(raw), version: doc.version || null };
}

async function pypiLicense(name, version, timeoutMs) {
  let doc;
  try { doc = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/${version ? encodeURIComponent(version) + '/' : ''}json`, timeoutMs); } catch (e) {
    if (!version) throw e;
    doc = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, timeoutMs);
  }
  const info = doc.info || {};
  let license = info.license_expression ? normalizeLicense(info.license_expression) : null;
  if (!license || license === 'Unknown') license = fromClassifiers(info.classifiers || []);
  if ((!license || license === 'Unknown') && info.license && info.license.length < 200) license = normalizeLicense(info.license);
  return { license: license || 'Unknown', version: info.version || null };
}

/**
 * Fills license (and a version for vulnerability checks) of packages that are not installed.
 * packages: report rows ({ ecosystem, name, version, spec, license, installed }), modified in place.
 */
async function fillFromRegistry(packages, opts = {}) {
  const timeoutMs = opts.timeoutMs || 10000;
  const todo = packages.filter(p => !p.installed && (!p.license || p.license === 'Unknown'));
  let failed = 0;
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async p => {
      const exact = p.version || null;
      try {
        const r = p.ecosystem === 'npm' ? await npmLicense(p.name, exact, timeoutMs) : await pypiLicense(p.name, exact, timeoutMs);
        p.license = r.license;
        p.licenseSource = 'registry';
        if (!p.version) { p.version = lowerBound(p.spec) || null; p.versionFromRange = !!p.version; p.latest = r.version; }
      } catch { failed++; }
    }));
    if (failed > 5 && failed === i + Math.min(8, todo.length - i)) break; // registry not reachable at all
  }
  return { looked: todo.length, failed };
}

module.exports = { fillFromRegistry, lowerBound };
