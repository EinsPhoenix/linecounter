'use strict';
// Tests for the dependency scanner (manifests, licenses, usage, vulnerabilities with a mocked OSV client).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanDependencies } = require('../src/deps');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-deps-'));
const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };

// npm project
w('package.json', JSON.stringify({ name: 'demo', scripts: { lint: 'eslint .' }, dependencies: { lodash: '^4.17.15', leftpad: '1.0.0', 'gpl-lib': '^1.0.0' }, devDependencies: { eslint: '^8.0.0', 'unused-dev': '^1.0.0' } }));
w('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {
  '': { name: 'demo' },
  'node_modules/lodash': { version: '4.17.15', license: 'MIT' },
  'node_modules/leftpad': { version: '1.0.0', license: 'WTFPL' },
  'node_modules/gpl-lib': { version: '1.2.0', license: 'GPL-3.0-only' },
  'node_modules/eslint': { version: '8.57.0', license: 'MIT', dev: true },
  'node_modules/unused-dev': { version: '1.0.0', license: 'MIT', dev: true },
  'node_modules/transitive-agpl': { version: '2.0.0', license: 'AGPL-3.0' },
} }));
const jsFile = w('src/index.js', "const _ = require('lodash');\nimport x from 'gpl-lib/sub';\nimport fs from 'node:fs';\nimport chalk from 'chalk';\nimport './local.js';\n");
// python project with a fake virtualenv
w('py/requirements.txt', 'requests==2.19.0\nPyYAML>=6\nnumpy\npytest\n');
w('py/.venv/pyvenv.cfg', 'home = /usr/bin');
const sp = 'py/.venv/lib/python3.11/site-packages';
w(`${sp}/requests-2.19.0.dist-info/METADATA`, 'Metadata-Version: 2.1\nName: requests\nVersion: 2.19.0\nLicense: Apache 2.0\nRequires-Dist: idna\n');
w(`${sp}/PyYAML-6.0.1.dist-info/METADATA`, 'Metadata-Version: 2.1\nName: PyYAML\nVersion: 6.0.1\nClassifier: License :: OSI Approved :: MIT License\n');
w(`${sp}/PyYAML-6.0.1.dist-info/top_level.txt`, '_yaml\nyaml\n');
w(`${sp}/numpy-1.26.0.dist-info/METADATA`, 'Metadata-Version: 2.1\nName: numpy\nVersion: 1.26.0\nLicense-Expression: BSD-3-Clause\n');
w(`${sp}/idna-3.4.dist-info/METADATA`, 'Metadata-Version: 2.1\nName: idna\nVersion: 3.4\nClassifier: License :: OSI Approved :: BSD License\n');
w(`${sp}/chardet-3.0.dist-info/METADATA`, 'Metadata-Version: 2.1\nName: chardet\nVersion: 3.0\nLicense: LGPL\n');
w(`${sp}/chardet-3.0.dist-info/top_level.txt`, 'chardet\n');
const pyFile = w('py/app.py', 'import os\nimport requests\nimport yaml\nfrom chardet import detect\nfrom . import helpers\nimport helpers\n');
w('py/helpers.py', 'x = 1\n');

const f = (abs, lang, deps) => ({ abs, path: path.relative(root, abs).split(path.sep).join('/'), name: path.basename(abs), root, rootName: 'demo', lang, deps });
const files = [
  f(path.join(root, 'package.json'), 'JSON', null),
  f(jsFile, 'JavaScript', ['lodash', 'gpl-lib/sub', 'node:fs', 'chalk', './local.js']),
  f(path.join(root, 'py/requirements.txt'), 'Text', null),
  f(pyFile, 'Python', ['os', 'requests', 'yaml', 'chardet', '.', 'helpers']),
];

const osvCalls = [];
const client = async (url, body) => {
  osvCalls.push(url);
  if (url.endsWith('/querybatch')) return { results: body.queries.map(q => (q.package.name === 'lodash' ? { vulns: [{ id: 'GHSA-p6mc-m468-83gw' }] } : q.package.name === 'requests' ? { vulns: [{ id: 'PYSEC-2018-28' }] } : {})) };
  if (url.includes('GHSA-p6mc')) return { id: 'GHSA-p6mc-m468-83gw', summary: 'Prototype Pollution in lodash', aliases: ['CVE-2020-8203'], severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H' }], database_specific: { severity: 'HIGH' }, affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.19' }] }] }] };
  return { id: 'PYSEC-2018-28', details: 'Requests before 2.20.0 sends an HTTP Authorization header to an http URI upon receiving a same-hostname https-to-http redirect', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N' }], affected: [{ package: { name: 'requests' }, ranges: [{ events: [{ fixed: '2.20.0' }] }] }] };
};

(async () => {
  const policy = { problematic: ['GPL*', 'AGPL*'], review: ['LGPL*', 'Unknown'], allowed: [] };
  const r = await scanDependencies(files, { policy, includeTransitiveLicenses: true, vulnerabilities: { enabled: true, includeTransitive: false, client } });
  const pkg = n => r.packages.find(p => p.name === n);
  assert.strictEqual(r.manifests.length, 2);
  assert.strictEqual(pkg('gpl-lib').status, 'problematic');
  assert.strictEqual(pkg('transitive-agpl').status, 'problematic');
  assert.strictEqual(pkg('transitive-agpl').direct, false);
  assert.strictEqual(pkg('lodash').status, 'ok');
  assert.strictEqual(pkg('PyYAML').license, 'MIT');
  assert.strictEqual(pkg('requests').license, 'Apache-2.0');
  assert.strictEqual(pkg('chardet').status, 'review', 'LGPL transitive python package needs review');
  assert.strictEqual(pkg('pytest').installed, false);
  // usage
  const npmU = r.usage.find(u => u.ecosystem === 'npm');
  assert.deepStrictEqual(npmU.unused.map(u => u.name).sort(), ['leftpad', 'unused-dev']);
  assert.deepStrictEqual(npmU.undeclared.map(u => u.name), ['chalk']);
  const pyU = r.usage.find(u => u.ecosystem === 'PyPI');
  assert.deepStrictEqual(pyU.unused.map(u => u.name), ['numpy', 'pytest']);
  assert.strictEqual(pyU.unused.find(u => u.name === 'pytest').type, 'tool');
  assert.deepStrictEqual(pyU.undeclared.map(u => u.name), ['chardet']);
  // vulnerabilities (direct only)
  assert.strictEqual(r.vulns.error, null);
  assert.deepStrictEqual(r.vulns.items.map(v => [v.name, v.severity, v.fixed[0]]), [['requests', 'HIGH', '2.20.0'], ['lodash', 'HIGH', '4.17.19']]);
  assert.strictEqual(r.vulns.items[0].score, 7.5);
  assert.strictEqual(pkg('lodash').vulnCount, 1);
  fs.rmSync(root, { recursive: true, force: true });
  console.log('deps.test OK');
})().catch(e => { console.error(e); process.exit(1); });
