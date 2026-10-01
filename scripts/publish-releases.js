#!/usr/bin/env node
'use strict';
// Creates a GitHub Release (tag v<version>) for every releases/linecounter-<version>.vsix that has none yet.
// Release notes come from the matching CHANGELOG.md section. Needs the gh CLI and GH_TOKEN (used by the Release workflow).
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

function changelogSections() {
  const text = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const out = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^## \[?(\d+\.\d+\.\d+)\]?/.exec(line);
    if (m) { current = m[1]; out[current] = []; continue; }
    if (current) out[current].push(line);
  }
  for (const v of Object.keys(out)) out[v] = out[v].join('\n').trim();
  return out;
}

function existingTags() {
  if (dryRun) return new Set();
  const json = execFileSync('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName'], { cwd: root, encoding: 'utf8' });
  return new Set(JSON.parse(json).map((r) => r.tagName));
}

const versions = fs.readdirSync(path.join(root, 'releases'))
  .map((f) => /^linecounter-(\d+\.\d+\.\d+)\.vsix$/.exec(f))
  .filter(Boolean)
  .map((m) => m[1])
  .sort(cmp);
const latest = versions[versions.length - 1];
const notes = changelogSections();
const have = existingTags();

for (const v of versions) {
  const tag = `v${v}`;
  if (have.has(tag)) continue;
  const asset = path.join(root, 'releases', `linecounter-${v}.vsix`);
  const body = `${notes[v] || '_No changelog entry._'}\n\n### Install\n\n\`\`\`bash\ncode --install-extension linecounter-${v}.vsix\n\`\`\`\n\nor in VS Code: *Extensions → … → Install from VSIX…*`;
  const notesFile = path.join(os.tmpdir(), `notes-${v}.md`);
  fs.writeFileSync(notesFile, body);
  // Same file under a fixed name, so .../releases/latest/download/linecounter.vsix always works.
  const stableDir = fs.mkdtempSync(path.join(os.tmpdir(), `lc-${v}-`));
  const stable = path.join(stableDir, 'linecounter.vsix');
  fs.copyFileSync(asset, stable);
  const args = ['release', 'create', tag, asset, stable, '--title', `Line Counter ${v}`, '--notes-file', notesFile,
    '--target', process.env.GITHUB_SHA || 'main', `--latest=${v === latest}`];
  console.log(`${dryRun ? '[dry-run] ' : ''}gh ${args.join(' ')}`);
  if (!dryRun) execFileSync('gh', args, { cwd: root, stdio: 'inherit' });
}
console.log(`Done: ${versions.length} packaged version(s), latest ${latest}.`);
