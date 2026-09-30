'use strict';

const vscode = require('vscode');
const path = require('path');
const { PRESETS, DEFAULT_PRESETS, scanRoot } = require('./scanner');
const { analyzeFiles } = require('./analyzer');
const { aggregate } = require('./stats');
const git = require('./git');
const { StatsPanel } = require('./statsPanel');

const STATE_KEY = 'linecounter.state';
const GITIGNORE_PRESET = { id: 'gitignore', label: 'Everything listed in .gitignore' };

function nonce() {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

class SidebarProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.roots = [];
  }

  get state() {
    return this.context.workspaceState.get(STATE_KEY) || {
      presets: [...DEFAULT_PRESETS, GITIGNORE_PRESET.id], excluded: [], included: [], hiddenExt: [],
    };
  }

  async setState(patch) {
    await this.context.workspaceState.update(STATE_KEY, { ...this.state, ...patch });
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const n = nonce();
    const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.css'));
    const js = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.js'));
    view.webview.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource} 'unsafe-inline'; img-src data:; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}"><title>Line Counter</title></head>
<body><div id="app"></div><script nonce="${n}" src="${js}"></script></body></html>`;

    view.webview.onDidReceiveMessage(msg => this.onMessage(msg));
  }

  post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  async onMessage(msg) {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        await this.scan();
        break;
      case 'setPresets':
        await this.setState({ presets: msg.presets });
        await this.scan();
        break;
      case 'saveState':
        await this.setState({ excluded: msg.excluded, included: msg.included, hiddenExt: msg.hiddenExt });
        if (msg.rescan) await this.scan();
        break;
      case 'createStats':
        await createStatistics(this.context, this.roots, msg.files);
        break;
      case 'open':
        if (this.roots[msg.r]) await openFile(path.join(this.roots[msg.r].path, ...msg.p.split('/')));
        break;
    }
  }

  requestStats() {
    this.post({ type: 'requestStats' });
  }

  async scan() {
    const folders = vscode.workspace.workspaceFolders || [];
    const state = this.state;
    const cfg = vscode.workspace.getConfiguration('linecounter');
    this.post({ type: 'busy', text: 'Scanning workspace…' });
    const roots = [];
    for (const wf of folders) {
      const rootPath = wf.uri.fsPath;
      const prefix = wf.name + '/';
      const forceScan = new Set(state.included.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)));
      const res = await scanRoot(rootPath, {
        presets: state.presets, forceScan, maxEntries: cfg.get('maxEntries', 200000),
      });
      if (state.presets.includes(GITIGNORE_PRESET.id)) {
        markIgnored(res.children, await git.ignoredPaths(rootPath));
      }
      roots.push({ name: wf.name, path: rootPath, children: res.children, truncated: res.truncated, count: res.count, gitRepos: res.gitRepos });
    }
    this.roots = roots;
    this.post({
      type: 'tree',
      roots: roots.map(r => ({ name: r.name, children: r.children, truncated: r.truncated, count: r.count })),
      presets: [...PRESETS.map(p => ({ id: p.id, label: p.label })), GITIGNORE_PRESET],
      state,
    });
  }
}

/** Marks nodes listed by `git ls-files --ignored` with the gitignore preset. */
function markIgnored(children, ignored) {
  for (const entry of ignored) {
    const parts = entry.replace(/\/$/, '').split('/');
    let list = children, node = null;
    for (const part of parts) {
      node = list && list.find(c => c.n === part);
      if (!node) break;
      list = node.c;
    }
    if (node && !node.p) node.p = GITIGNORE_PRESET.id;
  }
}

async function openFile(abs, line) {
  const uri = vscode.Uri.file(abs);
  try {
    if (line) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      await vscode.window.showTextDocument(doc, { preview: false, selection: new vscode.Range(pos, pos) });
    } else {
      await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Could not open ${abs}: ${e.message}`);
  }
}

let lastRun = null;
let sidebar = null;

async function createStatistics(context, roots, selection) {
  if (!selection || !selection.length) {
    vscode.window.showWarningMessage('Line Counter: no files selected – every file is excluded by your filters.');
    return;
  }
  lastRun = { roots, selection };
  const cfg = vscode.workspace.getConfiguration('linecounter');
  const maxBytes = cfg.get('maxFileSizeKB', 2048) * 1024;
  const maxCommits = cfg.get('maxCommits', 20000);

  const data = await vscode.window.withProgress({
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

    // Git repositories: found while scanning + the repos containing each workspace folder
    progress.report({ increment: 80 - reported, message: 'Reading git history…' });
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
        minLength: cfg.get('rant.commitMinLength', 10),
        maxLength: cfg.get('rant.commitMaxLength', 72),
        words: cfg.get('rant.commitWords', []),
      });
      if (stats) {
        stats.fileCount = results.filter(f => f.abs.startsWith(prefix)).length;
        repos.push(stats);
      }
    }
    progress.report({ increment: 20, message: 'Building charts…' });
    return aggregate(results, {
      workspace: vscode.workspace.name || roots.map(r => r.name).join(', '),
      repos,
      rant: {
        enabled: cfg.get('rant.enabled', true),
        maxLines: Math.max(1, cfg.get('rant.maxFileLines', 500)),
        maxBlankPercent: Math.max(0, cfg.get('rant.maxBlankPercent', 10)),
      },
    });
  });
  if (!data) return;

  StatsPanel.show(context, data, {
    open: openFile,
    refresh: () => lastRun && createStatistics(context, lastRun.roots, lastRun.selection),
    deleted: () => sidebar && sidebar.scan(),
  });
}

function activate(context) {
  const provider = new SidebarProvider(context);
  sidebar = provider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('linecounter.explorer', provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('linecounter.refresh', () => provider.scan()),
    vscode.commands.registerCommand('linecounter.resetFilters', async () => {
      await context.workspaceState.update(STATE_KEY, undefined);
      await provider.scan();
    }),
    vscode.commands.registerCommand('linecounter.createStatistics', async () => {
      if (!provider.view) await vscode.commands.executeCommand('linecounter.explorer.focus');
      provider.requestStats();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.scan()),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
