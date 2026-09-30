'use strict';

const vscode = require('vscode');
const fs = require('fs');

class StatsPanel {
  static show(context, data, handlers) {
    if (StatsPanel.current) {
      StatsPanel.current.handlers = handlers;
      StatsPanel.current.update(data);
      StatsPanel.current.panel.reveal(vscode.ViewColumn.One);
      StatsPanel.maximize();
      return;
    }
    StatsPanel.current = new StatsPanel(context, data, handlers);
    StatsPanel.maximize();
  }

  /** Makes the statistics page take the whole window, depending on `linecounter.statisticsLayout`. */
  static async maximize() {
    const layout = vscode.workspace.getConfiguration('linecounter').get('statisticsLayout', 'maximized');
    if (layout === 'normal') return;
    const tryCmd = async (...cmds) => {
      for (const c of cmds) {
        try { await vscode.commands.executeCommand(c); return true; } catch { /* not available in this VS Code version */ }
      }
      return false;
    };
    await tryCmd('workbench.action.closePanel');
    await tryCmd('workbench.action.closeAuxiliaryBar');
    const all = await vscode.commands.getCommands(true);
    if (all.includes('workbench.action.maximizeEditorHideSidebar')) {
      await tryCmd('workbench.action.maximizeEditorHideSidebar');
    } else {
      await tryCmd('workbench.action.closeSidebar');
      if (all.includes('workbench.action.joinAllGroups')) await tryCmd('workbench.action.joinAllGroups');
    }
    if (layout === 'fullscreen' && !StatsPanel.wentFullScreen) {
      StatsPanel.wentFullScreen = true;
      await tryCmd('workbench.action.toggleFullScreen');
    }
  }

  constructor(context, data, handlers) {
    this.context = context;
    this.handlers = handlers;
    this.data = data;
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('linecounter.stats', 'Code Statistics', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [media],
    });
    this.panel.iconPath = vscode.Uri.joinPath(media, 'icon.svg');
    const w = this.panel.webview;
    const n = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    w.html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource} 'unsafe-inline'; script-src 'nonce-${n}'; img-src ${w.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${w.asWebviewUri(vscode.Uri.joinPath(media, 'stats.css'))}"><title>Code Statistics</title></head>
<body><div id="app"><div class="loading">Crunching numbers…</div></div><div id="tooltip" role="tooltip"></div>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'stats.js'))}"></script></body></html>`;

    w.onDidReceiveMessage(msg => this.onMessage(msg), null, context.subscriptions);
    this.panel.onDidDispose(() => {
      StatsPanel.current = null;
      if (StatsPanel.wentFullScreen) {
        StatsPanel.wentFullScreen = false;
        vscode.commands.executeCommand('workbench.action.toggleFullScreen');
      }
      // bring the Line Counter sidebar back
      vscode.commands.executeCommand('workbench.view.extension.linecounter');
    });
  }

  update(data) {
    this.data = data;
    this.panel.webview.postMessage({ type: 'data', data });
  }

  async onMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this.update(this.data);
        break;
      case 'open':
        await this.handlers.open(msg.abs, msg.line);
        break;
      case 'refresh':
        await this.handlers.refresh();
        break;
      case 'fullscreen':
        await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
        break;
      case 'maximize':
        await StatsPanel.maximize();
        break;
      case 'export': {
        const isCsv = msg.format === 'csv';
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(require('path').join(
            (vscode.workspace.workspaceFolders || [])[0]?.uri.fsPath || require('os').homedir(),
            isCsv ? 'code-statistics.csv' : 'code-statistics.json')),
          filters: isCsv ? { CSV: ['csv'] } : { JSON: ['json'] },
        });
        if (!uri) return;
        const content = isCsv ? toCsv(this.data.table) : JSON.stringify(this.data, null, 2);
        await fs.promises.writeFile(uri.fsPath, content, 'utf8');
        vscode.window.showInformationMessage(`Statistics exported to ${uri.fsPath}`);
        break;
      }
    }
  }
}
StatsPanel.current = null;
StatsPanel.wentFullScreen = false;

function toCsv(rows) {
  const cols = ['rootName', 'path', 'lang', 'ext', 'lines', 'code', 'comment', 'blank', 'size', 'maxLine', 'todo', 'binary'];
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

module.exports = { StatsPanel };
