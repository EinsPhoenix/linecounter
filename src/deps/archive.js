'use strict';

const https = require('https');
const zlib = require('zlib');
const { sniffLicenseText, normalizeLicense } = require('./licenses');

/**
 * Downloads package archives (npm .tgz, PyPI wheel / sdist, crates.io .crate, Go module .zip) and reads the license
 * from the files inside: LICENSE / COPYING texts, plus the license fields of package.json, PKG-INFO / METADATA and Cargo.toml.
 */
function download(url, { timeoutMs = 15000, maxBytes = 30e6, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'linecounter-vscode (license check)', ...headers }, timeout: timeoutMs }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), { timeoutMs, maxBytes, headers }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url}: HTTP ${res.statusCode}`)); }
      const chunks = [];
      let size = 0;
      res.on('data', c => { size += c.length; if (size > maxBytes) req.destroy(new Error('archive too large')); else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Entries of a (possibly gzipped) tar archive: [{ name, data }] – only files whose name matches `want`. */
function tarEntries(buf, want) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const out = [];
  let off = 0;
  let longName = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every(b => b === 0)) break;
    let name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8) || 0;
    const type = String.fromCharCode(header[156]);
    const dataStart = off + 512;
    if (type === 'L') longName = buf.subarray(dataStart, dataStart + size).toString('utf8').replace(/\0.*$/s, '');
    else {
      if (longName) { name = longName; longName = null; }
      if ((type === '0' || type === '\0') && want(name) && size < 2e6) out.push({ name, data: buf.subarray(dataStart, dataStart + size) });
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Entries of a zip archive (wheel, Go module) whose name matches `want`. */
function zipEntries(buf, want) {
  // find the end of central directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (!want(name) || csize > 2e6) continue;
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    const raw = buf.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    try { out.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : raw }); } catch { /* skip broken entry */ }
  }
  return out;
}

const LICENSE_FILE = /(^|\/)(un)?licen[cs]e([-._][\w.-]+)?(\.(md|txt|rst))?$|(^|\/)copying(\.(md|txt))?$|(^|\/)notice(\.(md|txt))?$/i;
const META_FILE = /(^|\/)(package\.json|PKG-INFO|METADATA|Cargo\.toml)$/;
/** depth of a path inside the archive (top-level folder of tarballs does not count) */
const depth = n => n.replace(/^\.?\//, '').split('/').length;

/**
 * Reads the license of a package archive.
 * -> { license, source: 'LICENSE' | 'package.json' | 'METADATA' | 'Cargo.toml', files: [names] } or null
 */
function licenseFromArchive(buf, kind) {
  const want = n => (LICENSE_FILE.test(n) || META_FILE.test(n)) && depth(n) <= (kind === 'zip' ? 4 : 3);
  const entries = kind === 'zip' ? zipEntries(buf, want) : tarEntries(buf, want);
  if (!entries.length) return null;
  entries.sort((a, b) => depth(a.name) - depth(b.name));
  // 1) declared license in metadata files
  for (const e of entries.filter(x => META_FILE.test(x.name))) {
    const text = e.data.toString('utf8');
    let raw = null;
    if (/package\.json$/.test(e.name)) {
      try { const j = JSON.parse(text); raw = typeof j.license === 'object' && j.license ? j.license.type : j.license || (Array.isArray(j.licenses) ? j.licenses.map(l => (typeof l === 'string' ? l : l.type)).join(' OR ') : null); } catch { /* ignore */ }
    } else if (/Cargo\.toml$/.test(e.name)) {
      const m = /^\s*license\s*=\s*"([^"]+)"/m.exec(text);
      raw = m ? m[1] : null;
    } else {
      const expr = /^License-Expression:\s*(.+)$/m.exec(text);
      const cls = [...text.matchAll(/^Classifier:\s*License ::(.+)$/gm)].map(m => m[1].split('::').pop().trim()).filter(x => !/^OSI Approved$/i.test(x));
      const lic = /^License:\s*(.+)$/m.exec(text);
      raw = expr ? expr[1] : cls.length ? cls.join(' OR ') : lic && lic[1].length < 100 ? lic[1] : null;
    }
    const n = raw ? normalizeLicense(raw) : null;
    if (n && n !== 'Unknown' && n !== 'Custom') return { license: n, source: e.name.split('/').pop(), files: entries.map(x => x.name) };
  }
  // 2) license texts (several files like LICENSE-MIT + LICENSE-APACHE -> dual license)
  const found = [];
  for (const e of entries.filter(x => LICENSE_FILE.test(x.name))) {
    const id = sniffLicenseText(e.data.toString('utf8'));
    if (id && !found.includes(id)) found.push(id);
  }
  if (found.length) return { license: found.join(' OR '), source: 'LICENSE text', files: entries.map(x => x.name) };
  const hasText = entries.some(x => LICENSE_FILE.test(x.name));
  return hasText ? { license: 'Custom', source: 'LICENSE text (not a standard license)', files: entries.map(x => x.name) } : null;
}

module.exports = { download, tarEntries, zipEntries, licenseFromArchive };
