'use strict';

const https = require('https');

/**
 * Vulnerability lookup via the OSV.dev API (https://osv.dev) for npm and PyPI packages.
 * Only package names and versions are sent.
 */
const OSV = 'https://api.osv.dev/v1';

function postJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data || '') },
      timeout: timeoutMs,
    }, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`OSV ${res.statusCode}: ${buf.slice(0, 120)}`));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('OSV request timed out')));
    req.on('error', reject);
    if (data && body !== undefined) req.write(data);
    req.end();
  });
}
const getJson = (url, timeoutMs) => postJson(url, undefined, timeoutMs);

// ---- CVSS v3.x base score (from the vector string) ----
const W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, AC: { L: 0.77, H: 0.44 },
  PR: { U: { N: 0.85, L: 0.62, H: 0.27 }, C: { N: 0.85, L: 0.68, H: 0.5 } },
  UI: { N: 0.85, R: 0.62 }, CIA: { H: 0.56, L: 0.22, N: 0 },
};
const roundUp = x => { const i = Math.round(x * 100000); return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10; };
function cvss3Score(vector) {
  const m = {};
  for (const part of String(vector).split('/')) { const [k, v] = part.split(':'); m[k] = v; }
  if (!m.AV || !m.S) return null;
  const S = m.S === 'C' ? 'C' : 'U';
  const iss = 1 - (1 - W.CIA[m.C]) * (1 - W.CIA[m.I]) * (1 - W.CIA[m.A]);
  const impact = S === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  const expl = 8.22 * W.AV[m.AV] * W.AC[m.AC] * W.PR[S][m.PR] * W.UI[m.UI];
  if (!(impact > 0)) return 0;
  return S === 'U' ? roundUp(Math.min(impact + expl, 10)) : roundUp(Math.min(1.08 * (impact + expl), 10));
}
const scoreToSeverity = s => (s == null ? 'UNKNOWN' : s >= 9 ? 'CRITICAL' : s >= 7 ? 'HIGH' : s >= 4 ? 'MEDIUM' : s > 0 ? 'LOW' : 'NONE');

/** Severity + score + fixed versions of one OSV record for a given package. */
function describeVuln(v, pkgName) {
  let score = null;
  for (const s of v.severity || []) {
    if (/^CVSS_V3/.test(s.type)) { const sc = cvss3Score(s.score); if (sc != null) score = Math.max(score ?? 0, sc); }
  }
  let severity = null;
  const ds = (v.database_specific && v.database_specific.severity) || null;
  if (ds) severity = String(ds).toUpperCase().replace('MODERATE', 'MEDIUM');
  if (!severity) {
    for (const a of v.affected || []) {
      const s = a.database_specific && a.database_specific.severity;
      if (s) { severity = String(s).toUpperCase().replace('MODERATE', 'MEDIUM'); break; }
      const es = a.ecosystem_specific && a.ecosystem_specific.severity;
      if (es) { severity = String(es).toUpperCase().replace('MODERATE', 'MEDIUM'); break; }
    }
  }
  if (!severity) severity = scoreToSeverity(score);
  const fixed = new Set();
  for (const a of v.affected || []) {
    if (a.package && pkgName && a.package.name && a.package.name.toLowerCase() !== pkgName.toLowerCase()) continue;
    for (const r of a.ranges || []) for (const e of r.events || []) if (e.fixed) fixed.add(e.fixed);
  }
  const ref = (v.references || []).find(r => r.type === 'ADVISORY') || (v.references || [])[0];
  return {
    id: v.id, aliases: (v.aliases || []).filter(a => /^CVE-/.test(a)),
    summary: v.summary || (v.details ? v.details.split('\n')[0].slice(0, 200) : ''),
    severity, score, fixed: [...fixed].slice(0, 5), published: v.published || null,
    url: ref ? ref.url : `https://osv.dev/vulnerability/${v.id}`,
  };
}

/**
 * packages: [{ ecosystem: 'npm'|'PyPI', name, version }]
 * -> { results: [{ ...pkg, vulns: [describeVuln] }], error? }
 */
async function checkVulnerabilities(packages, opts = {}) {
  const timeout = opts.timeoutMs || 20000;
  const post = opts.client ? (url, body) => opts.client(url, body) : (url, body) => postJson(url, body, timeout);
  const get = opts.client ? url => opts.client(url) : url => getJson(url, timeout);
  const maxDetails = opts.maxDetails || 250;
  const list = packages.filter(p => p.name && p.version);
  const results = [];
  const ids = new Map(); // vuln id -> packages
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const res = await post(`${OSV}/querybatch`, { queries: chunk.map(p => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) });
    (res.results || []).forEach((r, j) => {
      const pkg = { ...chunk[j], vulnIds: (r.vulns || []).map(v => v.id) };
      results.push(pkg);
      for (const id of pkg.vulnIds) { if (!ids.has(id)) ids.set(id, []); ids.get(id).push(pkg); }
    });
  }
  const details = new Map();
  const todo = [...ids.keys()].slice(0, maxDetails);
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async id => {
      try { details.set(id, await get(`${OSV}/vulns/${encodeURIComponent(id)}`)); } catch { /* keep id only */ }
    }));
  }
  for (const r of results) {
    r.vulns = r.vulnIds.map(id => (details.has(id) ? describeVuln(details.get(id), r.name) : { id, aliases: [], summary: '', severity: 'UNKNOWN', score: null, fixed: [], url: `https://osv.dev/vulnerability/${id}` }));
    delete r.vulnIds;
  }
  return { results, checked: list.length, truncatedDetails: ids.size > maxDetails };
}

module.exports = { checkVulnerabilities, cvss3Score, describeVuln, scoreToSeverity };
