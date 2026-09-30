'use strict';

const vscode = require('vscode');
const path = require('path');
const { analyzeFiles } = require('./analyzer');
const { aggregate } = require('./stats');
const git = require('./git');
const { scanDependencies } = require('./deps');

/**
 * Runs the whole analysis for the selected files and returns the data model for the statistics page.
 * roots: [{ name, path, gitRepos }], selection: [{ r: rootIndex, p: relPath }]
 */
async function computeStatistics(config, roots, selection, options = {}) {
  const maxBytes = config.get('maxFileSizeKB', 2048) * 1024;
  const maxCommits = config.get('maxCommits', 20000);

  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Line Counter',
    cancellable: true,
  }, async (progress, token) => {
    const files = selection.map(s => {
      const root = roots[s.r];
      return { abs: path.join(root.path, ...s.p.split('/')), rel: s.p, root: root.path, rootName: root.name };
    });
    progress.report({ message: `Analyzing ${files.length} files…` });
    let reported = 0;
    const results = await analyzeFiles(files, maxBytes, (done, total) => {
      const pct = (done / total) * 80;
      progress.report({ increment: pct - reported, message: `Analyzing files ${done}/${total}` });
      reported = pct;
    }, token);
    if (token.isCancellationRequested) return null;
    const rootNames = new Map(roots.map(r => [r.path, r.name]));
    for (const r of results) r.rootName = rootNames.get(r.root);

    progress.report({ increment: 80 - reported, message: 'Reading git history…' });
    const repos = await gitRepos(config, roots, results, maxCommits);

    let dependencies = null;
    if (config.get('dependencies.enabled', true)) {
      progress.report({ message: 'Scanning dependencies, licenses and vulnerabilities…' });
      try {
        dependencies = await scanDependencies(results, dependencyOptions(config, msg => progress.report({ message: msg })));
      } catch (e) {
        dependencies = { error: e.message, manifests: [], packages: [], usage: [], vulns: { enabled: false, items: [] } };
      }
    }

    progress.report({ increment: 20, message: 'Building charts…' });
    return aggregate(results, {
      dependencies,
      includeLibraries: !!options.libraries,
      workspace: vscode.workspace.name || roots.map(r => r.name).join(', '),
      repos,
      graphMotion: config.get('graphs.motion', 'auto'),
      trainKeys: config.get('train.keys', {}),
      rant: {
        enabled: config.get('rant.enabled', true),
        maxLines: Math.max(1, config.get('rant.maxFileLines', 500)),
        maxBlankPercent: Math.max(0, config.get('rant.maxBlankPercent', 10)),
      },
    });
  });
}

function dependencyOptions(config, onProgress) {
  return {
    policy: {
      problematic: config.get('licenses.problematic', []),
      review: config.get('licenses.review', []),
      allowed: config.get('licenses.allowed', []),
    },
    ignorePackages: config.get('licenses.ignorePackages', []),
    includeTransitiveLicenses: config.get('licenses.includeTransitive', true),
    fetchFromRegistry: config.get('licenses.fetchFromRegistry', true),
    vulnerabilities: {
      enabled: config.get('vulnerabilities.enabled', true),
      includeTransitive: config.get('vulnerabilities.includeTransitive', true),
      timeoutMs: config.get('vulnerabilities.timeoutSeconds', 20) * 1000,
    },
    onProgress,
  };
}

/** Git repositories found while scanning plus the repos containing each workspace folder. */
async function gitRepos(config, roots, results, maxCommits) {
  const candidates = new Set();
  for (const r of roots) {
    for (const g of r.gitRepos) candidates.add(path.resolve(g));
    const top = await git.repoRoot(r.path);
    if (top) candidates.add(top);
  }
  const repos = [];
  for (const repoPath of candidates) {
    const prefix = repoPath.endsWith(path.sep) ? repoPath : repoPath + path.sep;
    if (!results.some(f => f.abs.startsWith(prefix))) continue; // repo not part of the selection
    const stats = await git.repoStats(repoPath, maxCommits, {
      minLength: config.get('rant.commitMinLength', 10),
      maxLength: config.get('rant.commitMaxLength', 72),
      words: config.get('rant.commitWords', []),
    });
    if (stats) {
      stats.fileCount = results.filter(f => f.abs.startsWith(prefix)).length;
      repos.push(stats);
    }
  }
  return repos;
}

module.exports = { computeStatistics };
