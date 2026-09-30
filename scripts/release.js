#!/usr/bin/env node
'use strict';
// Packages the extension into releases/linecounter-<version>.vsix and copies it to linecounter.vsix (latest).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const out = path.join(root, 'releases', `linecounter-${version}.vsix`);
fs.mkdirSync(path.dirname(out), { recursive: true });
execSync(`npx vsce package --skip-license --out "${out}"`, { cwd: root, stdio: 'inherit' });
fs.copyFileSync(out, path.join(root, 'linecounter.vsix'));
console.log(`\nReleased ${path.relative(root, out)} and updated linecounter.vsix`);
