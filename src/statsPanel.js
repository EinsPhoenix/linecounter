'use strict';

const vscode = require('vscode');
const fs = require('fs');

class StatsPanel {
  static show(context, config, data, handlers) {
    StatsPanel.config = config;
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
    const layout = StatsPanel.config ? StatsPanel.config.get('statisticsLayout', 'maximized') : 'maximized';
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
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'vendor', 'd3.min.js'))}"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'graphs.js'))}"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'deps.js'))}"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'health.js'))}"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'trends.js'))}"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'vendor', 'jspdf.umd.min.js'))}"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'vendor', 'html2canvas.min.js'))}"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'export.js'))}"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'vendor', 'three.min.js'))}"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'train3d.js'))}"></script>
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

  defaultDir() {
    return (vscode.workspace.workspaceFolders || [])[0]?.uri.fsPath || require('os').homedir();
  }

  /** Standalone HTML report: styles, scripts and data inlined, works in any browser without VS Code. */
  async exportHtml() {
    const path = require('path');
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(this.defaultDir(), 'code-statistics.html')),
      filters: { HTML: ['html'] },
    });
    if (!uri) return;
    const media = path.join(this.context.extensionUri.fsPath, 'media');
    const read = f => fs.readFileSync(path.join(media, f), 'utf8');
    const safe = t => t.replace(/<\/script/gi, '<\\/script');
    const data = JSON.stringify(this.data).replace(/</g, '\\u003c');
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Code Statistics – ${String(this.data.workspace || '').replace(/[<>&"]/g, '')}</title>
<style>${read('stats.css')}
body.standalone .actions .btn:not([data-act="pdf"]) { display: none; }
</style></head>
<body class="vscode-dark standalone"><div id="app"><div class="loading">Loading…</div></div><div id="tooltip" role="tooltip"></div>
<script>window.__LC_DATA__ = ${data};
window.acquireVsCodeApi = () => ({
  postMessage(m) {
    if (m.type === 'ready') setTimeout(() => window.postMessage({ type: 'data', data: window.__LC_DATA__ }, '*'), 0);
    else if (m.type === 'openUrl') window.open(m.url, '_blank');
    else if (m.type === 'savePdf') { const a = document.createElement('a'); a.href = 'data:application/pdf;base64,' + m.data; a.download = 'code-statistics.pdf'; a.click(); }
    else if (m.type === 'copy' && navigator.clipboard) navigator.clipboard.writeText(m.text);
  },
  getState() { return null; }, setState() {},
});</script>
${['vendor/d3.min.js', 'graphs.js', 'deps.js', 'health.js', 'trends.js', 'vendor/jspdf.umd.min.js', 'vendor/html2canvas.min.js', 'export.js', 'vendor/three.min.js', 'train3d.js', 'stats.js'].map(f => `<script>${safe(read(f))}</script>`).join('\n')}
</body></html>`;
    await fs.promises.writeFile(uri.fsPath, html, 'utf8');
    const open = await vscode.window.showInformationMessage(`HTML report saved to ${uri.fsPath}`, 'Open in browser');
    if (open) await vscode.env.openExternal(uri);
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
      case 'clearHistory':
        if (this.handlers.clearHistory) await this.handlers.clearHistory(msg.projectRoot || '');
        break;
      case 'open':
        await this.handlers.open(msg.abs, msg.line);
        break;
      case 'refresh':
        await this.handlers.refresh();
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(msg.text);
        break;
      case 'reveal': {
        const fsP = require('fs'), pathP = require('path');
        const inside = msg.inEditor && ['package.json', 'METADATA', 'PKG-INFO'].map(f => pathP.join(msg.abs, f)).find(f => fsP.existsSync(f));
        if (inside) await this.handlers.open(inside);
        else await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.abs));
        break;
      }
      case 'savePdf': {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(require('path').join(this.defaultDir(), msg.name || 'code-statistics.pdf')),
          filters: { PDF: ['pdf'] },
        });
        if (!uri) return;
        await fs.promises.writeFile(uri.fsPath, Buffer.from(msg.data, 'base64'));
        const open = await vscode.window.showInformationMessage(`PDF report saved to ${uri.fsPath}`, 'Open');
        if (open) await vscode.env.openExternal(uri);
        break;
      }
      case 'openUrl':
        if (/^https?:\/\//.test(msg.url)) await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      case 'delete': {
        const name = require('path').basename(msg.abs);
        const choice = await vscode.window.showWarningMessage(
          `Delete "${name}"?`,
          { modal: true, detail: `${msg.abs}\n\nThe file is moved to the trash (if supported).` },
          'Move to Trash', 'Delete Permanently');
        if (!choice) return;
        try {
          const uri = vscode.Uri.file(msg.abs);
          try {
            await vscode.workspace.fs.delete(uri, { useTrash: choice === 'Move to Trash' });
          } catch (e) {
            if (choice !== 'Move to Trash') throw e;
            // Trash not available (e.g. remote/headless): ask again before deleting for good
            const again = await vscode.window.showWarningMessage(`The trash is not available. Delete "${name}" permanently?`, { modal: true }, 'Delete Permanently');
            if (!again) return;
            await vscode.workspace.fs.delete(uri, { useTrash: false });
          }
          this.panel.webview.postMessage({ type: 'deleted', abs: msg.abs });
          if (this.handlers.deleted) this.handlers.deleted(msg.abs);
        } catch (e) {
          vscode.window.showErrorMessage(`Could not delete ${name}: ${e.message}`);
        }
        break;
      }
      case 'fullscreen':
        await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
        break;
      case 'maximize':
        await StatsPanel.maximize();
        break;
      case 'export': {
        if (msg.format === 'html') { await this.exportHtml(); return; }
        const isCsv = msg.format === 'csv' || msg.format === 'licenses-csv';
        const isLic = msg.format === 'licenses-csv';
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(require('path').join(
            (vscode.workspace.workspaceFolders || [])[0]?.uri.fsPath || require('os').homedir(),
            isLic ? 'license-report.csv' : isCsv ? 'code-statistics.csv' : 'code-statistics.json')),
          filters: isCsv ? { CSV: ['csv'] } : { JSON: ['json'] },
        });
        if (!uri) return;
        const content = isLic ? licenseCsv(this.data.dependencies) : isCsv ? toCsv(this.data.table) : JSON.stringify(this.data, null, 2);
        await fs.promises.writeFile(uri.fsPath, content, 'utf8');
        vscode.window.showInformationMessage(`Statistics exported to ${uri.fsPath}`);
        break;
      }
    }
  }
}
StatsPanel.current = null;
StatsPanel.wentFullScreen = false;

function licenseCsv(deps) {
  const rows = ((deps && deps.packages) || []).map(p => ({ ...p, manifests: (p.manifests || []).join(' '), vulns: p.vulnCount || 0 }));
  const cols = ['ecosystem', 'name', 'version', 'license', 'category', 'status', 'direct', 'dev', 'installed', 'ignored', 'vulns', 'manifests'];
  const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

function toCsv(rows) {
  const cols = ['rootName', 'path', 'lang', 'ext', 'lines', 'code', 'comment', 'blank', 'size', 'maxLine', 'todo', 'binary'];
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

module.exports = { StatsPanel };
