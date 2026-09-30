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

/** Converts a glob (`*`, `**`, `?`) into a RegExp matching a '/'-separated relative path. */
function globToRegExp(glob) {
  let g = String(glob).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const anchored = g.startsWith('/');
  if (anchored) g = g.slice(1);
  // like .gitignore: a slash only at the end does not anchor the pattern
  const hasInnerSlash = g.replace(/\/+$/, '').includes('/');
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        re += g[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += g[i + 2] === '/' ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // patterns without a slash match the name anywhere, like .gitignore
  const prefix = anchored || hasInnerSlash ? '^' : '(?:^|/)';
  return new RegExp(prefix + re + '(?:/.*)?$', 'i');
}

module.exports = { nonce, openFile, globToRegExp };
