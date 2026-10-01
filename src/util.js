'use strict';

const vscode = require('vscode');

function nonce() {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** Opens a file in the editor, optionally at a 1-based line. Binary files open with their default viewer. */
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

const { globToRegExp } = require('./glob');

module.exports = { nonce, openFile, globToRegExp };
