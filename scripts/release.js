#!/usr/bin/env node
'use strict';
// Packages the extension into releases/locomotive-<version>.vsix and copies it to locomotive.vsix (latest).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const out = path.join(root, 'releases', `locomotive-${version}.vsix`);
fs.mkdirSync(path.dirname(out), { recursive: true });
// keep the static version badge in the README in sync (the repo is private, so shields.io cannot read releases)
const readme = path.join(root, 'README.md');
fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/badge\/release-v[\d.]+-/, `badge/release-v${version}-`));
execSync(`npx vsce package --out "${out}"`, { cwd: root, stdio: 'inherit' });
fs.copyFileSync(out, path.join(root, 'locomotive.vsix'));
console.log(`\nReleased ${path.relative(root, out)} and updated locomotive.vsix`);
