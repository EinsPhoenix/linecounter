'use strict';

const fs = require('fs');
const path = require('path');
const { languageOf, extensionOf } = require('./languages');

const KEYWORDS = new Set(('the and for with this that from import export return const let var function def class '
  + 'if else elif while true false null none undefined self public private protected static void int string new '
  + 'async await try catch except finally raise throw break continue case switch default package include using '
  + 'namespace struct enum interface type extends implements yield lambda pass not are was were not you your '
  + 'can will has have but all any http https www com org div span').split(' '));

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Classifies each line as code / comment / blank using the language's comment syntax. */
function classifyLines(lines, comments) {
  let code = 0, comment = 0, blank = 0;
  let inBlock = null; // closing token of the currently open block comment
  const lineTokens = comments.line;
  const blocks = comments.block;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inBlock) comment++; else blank++;
      continue;
    }
    let hasCode = false, hasComment = false;
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        hasComment = true;
        const end = line.indexOf(inBlock, i);
        if (end === -1) { i = line.length; break; }
        i = end + inBlock.length;
        inBlock = null;
        continue;
      }
      // skip whitespace
      if (line[i] === ' ' || line[i] === '\t') { i++; continue; }
      let matched = false;
      for (const t of lineTokens) {
        if (line.startsWith(t, i)) { hasComment = true; i = line.length; matched = true; break; }
      }
      if (matched) break;
      for (const [open, close] of blocks) {
        if (line.startsWith(open, i)) {
          hasComment = true;
          inBlock = close;
          i += open.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      hasCode = true;
      // The rest of the line: look for a block comment start that spills into next lines
      let next = line.length;
      let nextBlock = null;
      for (const [open, close] of blocks) {
        const k = line.indexOf(open, i + 1);
        if (k !== -1 && k < next) { next = k; nextBlock = [open, close]; }
      }
      if (!nextBlock) break;
      const closeIdx = line.indexOf(nextBlock[1], next + nextBlock[0].length);
      if (closeIdx === -1) { inBlock = nextBlock[1]; break; }
      i = closeIdx + nextBlock[1].length;
    }
    if (hasCode) code++;
    else if (hasComment) comment++;
    else blank++;
  }
  return { code, comment, blank };
}

function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * Analyzes a single file. Returns null if it cannot be read.
 */
async function analyzeFile(absPath, relPath, root, maxBytes) {
  let stat;
  try { stat = await fs.promises.stat(absPath); } catch { return null; }
  const name = path.basename(absPath);
  const lang = languageOf(name);
  const result = {
    path: relPath, abs: absPath, root, name,
    ext: extensionOf(name), lang: lang.name,
    size: stat.size, mtime: stat.mtimeMs,
    binary: false, skipped: false,
    lines: 0, code: 0, comment: 0, blank: 0,
    chars: 0, words: 0, maxLine: 0, maxLineNo: 0,
    trailing: 0, tabIndent: 0, spaceIndent: 0,
    todo: 0, fixme: 0, hack: 0, wtf: 0,
    semicolons: 0, braces: 0, parens: 0, debugPrints: 0, emojis: 0, fortyTwo: 0,
    funcs: 0, imports: 0, depth: relPath.split('/').length - 1,
    identifiers: null,
  };
  if (stat.size > maxBytes) { result.skipped = true; return result; }
  let buf;
  try { buf = await fs.promises.readFile(absPath); } catch { return null; }
  if (isBinary(buf)) { result.binary = true; return result; }

  const text = buf.toString('utf8');
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); // trailing newline isn't a line
  result.lines = lines.length;
  result.chars = text.length;

  const cls = classifyLines(lines, lang.comments);
  result.code = cls.code; result.comment = cls.comment; result.blank = cls.blank;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > result.maxLine) { result.maxLine = l.length; result.maxLineNo = i + 1; }
    if (/[ \t]+$/.test(l)) result.trailing++;
    if (l.startsWith('\t')) result.tabIndent++;
    else if (l.startsWith('  ')) result.spaceIndent++;
  }

  result.words = countMatches(text, /\S+/g);
  result.todo = countMatches(text, /\bTODO\b/g);
  result.fixme = countMatches(text, /\bFIXME\b/g);
  result.hack = countMatches(text, /\b(HACK|XXX)\b/g);
  result.wtf = countMatches(text, /\b(wtf|WTF|damn|Damn|ugly|Ugly|magic|Magic)\b/g);
  result.semicolons = countMatches(text, /;/g);
  result.braces = countMatches(text, /[{}]/g);
  result.parens = countMatches(text, /[()]/g);
  result.debugPrints = countMatches(text, /\b(console\.(log|debug)|print|println|printf|System\.out\.print\w*|fmt\.Print\w*|puts|var_dump|dd|echo)\s*\(/g);
  result.emojis = countMatches(text, /\p{Extended_Pictographic}/gu);
  result.fortyTwo = countMatches(text, /\b42\b/g);
  result.funcs = countMatches(text, /\b(function|def|func|fn|fun|sub)\s+\w+|=>\s*[{(]?/g);
  result.imports = countMatches(text, /^\s*(import|from\s+\S+\s+import|#include|using\s+[\w.]+;|require\(|use\s+[\w:]+)/gm);

  // Identifier frequencies (only for code-ish files, capped for speed)
  if (lang.name !== 'Other' && !['JSON', 'CSV', 'Text', 'Markdown', 'XML'].includes(lang.name) && text.length < 500000) {
    const ids = {};
    const re = /[A-Za-z_][A-Za-z0-9_]{2,30}/g;
    let m;
    while ((m = re.exec(text))) {
      const w = m[0];
      if (KEYWORDS.has(w.toLowerCase())) continue;
      ids[w] = (ids[w] || 0) + 1;
    }
    result.identifiers = ids;
  }
  return result;
}

/** Runs analyzeFile over many files with bounded concurrency. */
async function analyzeFiles(files, maxBytes, onProgress, token) {
  const results = new Array(files.length);
  let next = 0, done = 0;
  const workers = Array.from({ length: 16 }, async () => {
    while (next < files.length) {
      if (token && token.isCancellationRequested) return;
      const i = next++;
      const f = files[i];
      results[i] = await analyzeFile(f.abs, f.rel, f.root, maxBytes);
      done++;
      if (onProgress && done % 50 === 0) onProgress(done, files.length);
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

module.exports = { analyzeFiles, classifyLines };
