#!/usr/bin/env node
'use strict';
/**
 * LOComotive CLI – the same analysis as the VS Code extension, for CI pipelines.
 *
 *   node bin/locomotive.js gate   [folder] [--preset NAME] [--json report.json] [--markdown summary.md] [--offline]
 *   node bin/locomotive.js report [folder] --json data.json
 *
 * gate: exits with code 1 if a check of locomotive.gate fails (critical vulnerabilities, secrets, problematic licenses,
 * architecture violations, …). Settings come from <folder>/.locomotive/settings.json (+ defaults), the active filter
 * preset (or --preset) from .locomotive/presets.json, own filters from .locomotive/filters.json.
 */
const fs = require('fs');
const path = require('path');
const { configDir } = require('../src/configDir');
const { scanRoot, DEFAULT_PRESETS } = require('../src/scanner');
const { runPipeline } = require('../src/pipeline');
const { evaluateGate, gateMarkdown } = require('../src/gate');
const { globToRegExp } = require('../src/glob');
const git = require('../src/git');

function readJson(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8').replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s || '').replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(raw);
  } catch { return null; }
}

function headlessConfig(root, overrides) {
  const pkg = require('../package.json');
  const conf = pkg.contributes.configuration;
  const props = Array.isArray(conf) ? Object.assign({}, ...conf.map(c => c.properties)) : conf.properties;
  const defaults = Object.fromEntries(Object.entries(props).map(([k, v]) => [k.replace(/^locomotive\./, ''), v.default]));
  const file = readJson(path.join(configDir(root), 'settings.json')) || {};
  const nested = (obj, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' && k in o ? o[k] : undefined), obj);
  return {
    dir: configDir(root),
    get(key, def) {
      if (overrides[key] !== undefined) return overrides[key];
      const v = file[key] ?? file['locomotive.' + key] ?? file['linecounter.' + key] ?? nested(file, key);
      if (v !== undefined) return v;
      return defaults[key] !== undefined ? defaults[key] : def;
    },
  };
}

function parseArgs(argv) {
  const out = { cmd: argv[0] || 'gate', folder: '.', flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out.flags[k] = next; i++; } else out.flags[k] = true; } else out.folder = a;
  }
  return out;
}

async function collectFiles(root, config, presetName) {
  const store = readJson(path.join(configDir(root), 'presets.json')) || { presets: {} };
  const preset = presetName ? store.presets[presetName] : store.active ? store.presets[store.active] : null;
  if (presetName && !preset) throw new Error(`preset "${presetName}" not found in .locomotive/presets.json`);
  const enabled = preset ? preset.presets : config.get('defaultFilters', [...DEFAULT_PRESETS, 'gitignore', 'custom']);
  const filterFile = readJson(path.join(configDir(root), 'filters.json')) || { filters: [] };
  const userFilters = [...(filterFile.filters || []), ...(config.get('customFilters', []) || [])].map(f => {
    const label = String(f.label || (f.patterns || []).join(', ')).trim();
    return { id: 'cf:' + label.toLowerCase().replace(/[^\w*./-]+/g, '-'), res: (f.patterns || []).map(p => globToRegExp(String(p).trim().replace(/^\*\//, '**/'))) };
  });
  const patterns = (config.get('excludePatterns', []) || []).filter(Boolean).map(globToRegExp);
  const name = path.basename(root);
  const res = await scanRoot(root, { presets: enabled, patterns, userFilters, maxEntries: config.get('maxEntries', 200000) });
  if (enabled.includes('gitignore')) {
    for (const entry of await git.ignoredPaths(root)) {
      let list = res.children, node = null;
      for (const part of entry.replace(/\/$/, '').split('/')) { node = list && list.find(c => c.n === part); if (!node) break; list = node.c; }
      if (node && !node.p) node.p = 'gitignore';
    }
  }
  const excluded = new Set((preset && preset.excluded) || []);
  const hidden = new Set((preset && preset.hiddenExt) || []);
  const files = [];
  const extOf = n => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i).toLowerCase() : '(none)'; };
  const walk = (nodes, rel) => {
    for (const n of nodes) {
      const r = rel ? rel + '/' + n.n : n.n;
      if (n.p || excluded.has(name + '/' + r)) continue;
      if (n.d) walk(n.c || [], r); else if (!hidden.has(extOf(n.n))) files.push({ r: 0, p: r });
    }
  };
  walk(res.children, '');
  const baseKey = preset && preset.base;
  const base = baseKey && baseKey.startsWith(name + '/') ? { r: 0, p: baseKey.slice(name.length + 1) } : null;
  return { roots: [{ name, path: root, gitRepos: res.gitRepos }], files, base, preset: preset ? presetName || store.active : null };
}

/** full analysis of a folder (used by the CLI and the MCP server) */
async function analyze(folder, opts = {}) {
  const root = path.resolve(folder);
  const overrides = opts.offline ? { 'vulnerabilities.enabled': false, 'licenses.fetchFromRegistry': false } : {};
  const config = headlessConfig(root, overrides);
  const log = msg => { if (!opts.quiet) process.stderr.write(`[locomotive] ${msg}\n`); };
  const { roots, files, base } = await collectFiles(root, config, opts.preset);
  const data = await runPipeline(config, roots, files, { base, workspaceName: path.basename(root), configRoot: root }, { report: m => m && m.message && log(m.message) });
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help || !['gate', 'report'].includes(args.cmd)) {
    console.log('Usage: locomotive gate|report [folder] [--preset NAME] [--json FILE] [--markdown FILE] [--offline]');
    process.exit(args.flags.help ? 0 : 2);
  }
  const root = path.resolve(args.folder);
  const overrides = args.flags.offline ? { 'vulnerabilities.enabled': false, 'licenses.fetchFromRegistry': false } : {};
  const config = headlessConfig(root, overrides);
  const log = msg => { if (!args.flags.quiet) process.stderr.write(`[locomotive] ${msg}\n`); };
  log(`scanning ${root}`);
  const { roots, files, base, preset } = await collectFiles(root, config, args.flags.preset);
  log(`${files.length} files${preset ? ` (preset "${preset}")` : ''}${base ? ` · project root ${base.p}` : ''}`);
  const data = await runPipeline(config, roots, files, { base, workspaceName: path.basename(root), configRoot: root }, { report: m => m && m.message && log(m.message) });
  if (args.cmd === 'report') {
    const out = args.flags.json || 'locomotive-report.json';
    fs.writeFileSync(out, JSON.stringify(data));
    log(`report written to ${out}`);
    return;
  }
  const res = evaluateGate(data, config.get('gate', {}));
  const md = gateMarkdown(res);
  process.stdout.write(md);
  if (args.flags.markdown) fs.writeFileSync(args.flags.markdown, md);
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); } catch { /* not writable */ } }
  if (args.flags.json) fs.writeFileSync(args.flags.json, JSON.stringify(res, null, 2));
  process.exitCode = res.passed ? 0 : 1;
}

if (require.main === module) main().catch(e => { console.error(`[locomotive] ${e.stack || e.message}`); process.exit(2); });

module.exports = { analyze, headlessConfig, collectFiles };
