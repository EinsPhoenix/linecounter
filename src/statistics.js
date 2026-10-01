'use strict';

const vscode = require('vscode');
const { runPipeline } = require('./pipeline');

/**
 * Runs the whole analysis for the selected files (with VS Code progress / cancellation) and returns the data model for the statistics page.
 * roots: [{ name, path, gitRepos }], selection: [{ r: rootIndex, p: relPath }]
 */
async function computeStatistics(config, roots, selection, options = {}) {
  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'LOComotive',
    cancellable: true,
  }, (progress, token) => runPipeline(config, roots, selection, { ...options, workspaceName: vscode.workspace.name, configRoot: config.root }, progress, token));
}

module.exports = { computeStatistics };
