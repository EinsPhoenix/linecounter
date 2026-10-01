'use strict';

const vscode = require('vscode');
const path = require('path');
const { PRESETS, DEFAULT_PRESETS, scanRoot } = require('./scanner');
const git = require('./git');
const { nonce, openFile, globToRegExp } = require('./util');

const STATE_KEY = 'linecounter.state';
const GITIGNORE_PRESET = { id: 'gitignore', label: 'Everything listed in .gitignore' };
const CUSTOM_PRESET = { id: 'custom', label: 'Custom patterns (linecounter.excludePatterns)' };
const ALL_DEFAULT_PRESETS = [...DEFAULT_PRESETS, GITIGNORE_PRESET.id, CUSTOM_PRESET.id];

/** Webview view in the activity bar: file tree, filters, presets and the "Create Statistics" button. */
class SidebarProvider {
  constructor(context, config, onCreateStats) {
    this.context = context;
    this.config = config;
    this.onCreateStats = onCreateStats;
    this.view = null;
    this.roots = [];
  }

  defaultState() {
    // an active preset from .linecounter/presets.json is the starting point for new workspaces
    const active = this.config.activePreset && this.config.getPreset(this.config.activePreset);
    if (active) return normalizeState(active);
    return { presets: this.config.get('defaultFilters', ALL_DEFAULT_PRESETS), excluded: [], included: [], hiddenExt: [] };
  }

  get state() {
    return normalizeState(this.context.workspaceState.get(STATE_KEY) || this.defaultState());
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
    view.webview.onDidReceiveMessage(msg => this.onMessage(msg).catch(e => vscode.window.showErrorMessage('Line Counter: ' + e.message)));
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
        await this.setState({ excluded: msg.excluded, included: msg.included, hiddenExt: msg.hiddenExt, ...(msg.libraries !== undefined ? { libraries: !!msg.libraries } : {}), ...(msg.base !== undefined ? { base: msg.base || null } : {}) });
        if (msg.rescan) await this.scan();
        break;
      case 'createStats':
        await this.onCreateStats(this.roots, msg.files, { libraries: !!this.state.libraries, base: msg.base || null });
        break;
      case 'open':
        if (this.roots[msg.r]) await openFile(path.join(this.roots[msg.r].path, ...msg.p.split('/')));
        break;
      case 'presetSave':
        await this.savePreset(msg.name);
        break;
      case 'presetLoad':
        await this.loadPreset(msg.name);
        break;
      case 'presetDelete':
        await this.deletePreset(msg.name);
        break;
      case 'openConfig':
        await vscode.commands.executeCommand('linecounter.openWorkspaceSettings');
        break;
    }
  }

  requestStats() {
    this.post({ type: 'requestStats' });
  }

  // ---------- presets (.linecounter/presets.json) ----------
  async savePreset(name) {
    let target = name;
    if (!target) {
      target = await vscode.window.showInputBox({
        title: 'Save filter preset',
        prompt: 'Name of the preset (stored in .linecounter/presets.json)',
        value: this.config.activePreset || '',
        validateInput: v => (v.trim() ? null : 'Please enter a name'),
      });
      if (!target) return;
      target = target.trim();
      if (this.config.getPreset(target) && target !== this.config.activePreset) {
        const ok = await vscode.window.showWarningMessage(`Overwrite preset "${target}"?`, { modal: true }, 'Overwrite');
        if (!ok) return;
      }
    }
    await this.config.savePreset(target, this.state);
    vscode.window.setStatusBarMessage(`Line Counter: preset "${target}" saved to .linecounter/presets.json`, 4000);
    await this.scan();
  }

  async loadPreset(name) {
    if (!name) {
      await this.config.setActive(null);
      await this.scan();
      return;
    }
    const p = this.config.getPreset(name);
    if (!p) return;
    await this.context.workspaceState.update(STATE_KEY, normalizeState(p));
    await this.config.setActive(name);
    await this.scan();
  }

  async deletePreset(name) {
    if (!name) return;
    const ok = await vscode.window.showWarningMessage(`Delete preset "${name}"?`, { modal: true }, 'Delete');
    if (!ok) return;
    await this.config.deletePreset(name);
    await this.scan();
  }

  async resetFilters() {
    await this.context.workspaceState.update(STATE_KEY, undefined);
    await this.config.setActive(null).catch(() => {});
    await this.scan();
  }

  // ---------- scanning ----------
  async scan() {
    this.config.reload(); // pick up manual edits of .linecounter/*.json
    const folders = vscode.workspace.workspaceFolders || [];
    const state = this.state;
    this.post({ type: 'busy', text: 'Scanning workspace…' });
    const patterns = (this.config.get('excludePatterns', []) || []).filter(Boolean).map(globToRegExp);
    const roots = [];
    for (const wf of folders) {
      const rootPath = wf.uri.fsPath;
      const prefix = wf.name + '/';
      const forceScan = new Set(state.included.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)));
      const res = await scanRoot(rootPath, {
        presets: state.presets, forceScan, patterns, maxEntries: this.config.get('maxEntries', 200000),
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
      presets: [...PRESETS.map(p => ({ id: p.id, label: p.label })), GITIGNORE_PRESET,
        { ...CUSTOM_PRESET, label: patterns.length ? `Custom patterns (${patterns.length})` : 'Custom patterns (none configured)' }],
      state,
      userPresets: this.config.listPresets(),
      activePreset: this.config.activePreset,
      hasWorkspace: !!this.config.root,
    });
  }
}

function normalizeState(s) {
  return {
    presets: Array.isArray(s.presets) ? [...new Set(s.presets)] : ALL_DEFAULT_PRESETS,
    excluded: Array.isArray(s.excluded) ? s.excluded : [],
    included: Array.isArray(s.included) ? s.included : [],
    hiddenExt: Array.isArray(s.hiddenExt) ? s.hiddenExt : [],
    libraries: !!s.libraries,
    base: typeof s.base === 'string' && s.base ? s.base : null, // project root folder (tree key "<root>/<rel>")
  };
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

module.exports = { SidebarProvider, ALL_DEFAULT_PRESETS };
