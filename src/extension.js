'use strict';

const vscode = require('vscode');
const { LocomotiveConfig } = require('./config');
const { SidebarProvider } = require('./sidebarProvider');
const history = require('./history');
const { computeStatistics } = require('./statistics');
const { StatsPanel } = require('./statsPanel');
const { openFile } = require('./util');

let lastRun = null;

function activate(context) {
  const config = new LocomotiveConfig();

  let gateRequested = false;
  const createStatistics = async (roots, selection, options = {}) => {
    if (!selection || !selection.length) {
      vscode.window.showWarningMessage('LOComotive: no files selected – every file is excluded by your filters.');
      return;
    }
    lastRun = { roots, selection, options };
    const data = await computeStatistics(config, roots, selection, options);
    if (!data) return;
    if (gateRequested) {
      gateRequested = false;
      const g = data.gate;
      const failed = g ? g.checks.filter(c => c.enabled && !c.passed) : [];
      if (g && g.passed) vscode.window.showInformationMessage(`LOComotive quality gate passed (${g.checks.filter(c => c.enabled).length} checks).`);
      else if (g) vscode.window.showErrorMessage(`LOComotive quality gate FAILED: ${failed.map(c => `${c.label} (${c.detail})`).join(' · ')}`);
    }
    if (config.get('history.enabled', true)) {
      try { data.history = await history.record(context, config, data); } catch { data.history = null; }
    }
    StatsPanel.show(context, config, data, {
      open: openFile,
      refresh: () => lastRun && createStatistics(lastRun.roots, lastRun.selection, lastRun.options),
      deleted: () => provider.scan(),
      clearHistory: root => history.clear(context, root),
      savePinboard: board => require('./pinboard').save(config.root, board),
    });
  };

  const provider = new SidebarProvider(context, config, createStatistics);
  config.watch(() => provider.scan());

  // MCP server for LLM agents in VS Code (Copilot agent mode etc., VS Code 1.101+)
  try {
    const lm = /** @type {any} */ (vscode).lm;
    const Def = /** @type {any} */ (vscode).McpStdioServerDefinition;
    if (lm && lm.registerMcpServerDefinitionProvider && Def) {
      context.subscriptions.push(lm.registerMcpServerDefinitionProvider('locomotive.mcp', {
        provideMcpServerDefinitions: () => (vscode.workspace.workspaceFolders || []).map(f => new Def(
          `LOComotive (${f.name})`, process.execPath,
          [vscode.Uri.joinPath(context.extensionUri, 'bin', 'locomotive-mcp.js').fsPath, '--root', f.uri.fsPath],
          { ELECTRON_RUN_AS_NODE: '1' }, context.extension.packageJSON.version)),
      }));
    }
  } catch { /* older VS Code without MCP support */ }

  context.subscriptions.push(
    { dispose: () => config.dispose() },
    vscode.window.registerWebviewViewProvider('locomotive.explorer', provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('locomotive.refresh', () => provider.scan()),
    vscode.commands.registerCommand('locomotive.resetFilters', () => provider.resetFilters()),
    vscode.commands.registerCommand('locomotive.createStatistics', async () => {
      if (!provider.view) await vscode.commands.executeCommand('locomotive.explorer.focus');
      provider.requestStats();
    }),
    vscode.commands.registerCommand('locomotive.savePreset', () => provider.savePreset()),
    vscode.commands.registerCommand('locomotive.copyMcpConfig', async () => {
      const script = vscode.Uri.joinPath(context.extensionUri, 'bin', 'locomotive-mcp.js').fsPath;
      const root = (vscode.workspace.workspaceFolders || [])[0] ? vscode.workspace.workspaceFolders[0].uri.fsPath : '.';
      const json = JSON.stringify({ mcpServers: { locomotive: { command: 'node', args: [script, '--root', root] } } }, null, 2);
      const cli = `claude mcp add locomotive -- node "${script}" --root "${root}"`;
      const pick = await vscode.window.showQuickPick([
        { label: 'Claude Code command', detail: cli, value: cli },
        { label: 'JSON config (Claude Desktop, Cursor, …)', detail: 'mcpServers → locomotive', value: json },
      ], { title: 'Copy the LOComotive MCP server configuration' });
      if (!pick) return;
      await vscode.env.clipboard.writeText(pick.value);
      vscode.window.showInformationMessage('LOComotive MCP configuration copied to the clipboard.');
    }),
    vscode.commands.registerCommand('locomotive.runGate', async () => {
      gateRequested = true;
      if (!provider.view) await vscode.commands.executeCommand('locomotive.explorer.focus');
      provider.requestStats();
    }),
    vscode.commands.registerCommand('locomotive.loadPreset', async () => {
      const items = config.listPresets().map(p => ({ label: p.name, description: p.name === config.activePreset ? 'active' : '', detail: `${p.excluded} exclusions · ${p.hiddenExt} hidden types${p.savedAt ? ' · saved ' + new Date(p.savedAt).toLocaleString() : ''}` }));
      if (!items.length) { vscode.window.showInformationMessage('No presets yet – use "LOComotive: Save Filter Preset" first.'); return; }
      const pick = await vscode.window.showQuickPick(items, { title: 'Load filter preset' });
      if (pick) await provider.loadPreset(pick.label);
    }),
    vscode.commands.registerCommand('locomotive.openWorkspaceSettings', async () => {
      try {
        const defaults = {};
        const props = context.extension.packageJSON.contributes.configuration.properties;
        for (const [k, v] of Object.entries(props)) defaults[k.replace(/^locomotive\./, '')] = v.default;
        const file = await config.ensureSettingsFile(defaults);
        await openFile(file);
      } catch (e) {
        vscode.window.showErrorMessage('LOComotive: ' + e.message);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { config.reload(); provider.scan(); }),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('locomotive')) provider.scan(); }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
