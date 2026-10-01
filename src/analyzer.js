'use strict';

const fs = require('fs');
const path = require('path');
const { languageOf, extensionOf } = require('./languages');
const { extractFunctions, callSites, KIND_OF } = require('./scanners/functions');
const { scanSecrets } = require('./scanners/secrets');
const { fingerprints } = require('./scanners/duplicates');


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
async function analyzeFile(absPath, relPath, root, maxBytes, scan = {}) {
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
    identifiers: null, deps: null,
    functions: null, calls: null, secrets: null, dupPrints: null,
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

  result.deps = extractDeps(text, lang.name);
  if (/^(tsconfig|jsconfig)([.\w-]*)?\.json$/i.test(name)) result.tsPaths = readTsPaths(text);
  if (/^vite\.config\.[cm]?[jt]s$|^webpack\.config\.[cm]?[jt]s$|^vitest\.config\.[cm]?[jt]s$/i.test(name)) result.aliases = readBundlerAliases(text);
  if (name === 'go.mod') { const m = /^\s*module\s+(\S+)/m.exec(text); if (m) result.goModule = m[1]; }
  if (name === 'Cargo.toml') { const m = /^\s*\[package\][^[]*?^\s*name\s*=\s*"([^"]+)"/ms.exec(text); if (m) result.crateName = m[1]; }

  // code health scanners
  const isCode = !!KIND_OF[lang.name];
  if (isCode && scan.functions !== false) {
    const fns = extractFunctions(text, lang.name);
    if (fns.length) result.functions = fns;
    if (fns.length || result.deps) result.calls = callSites(text, lang.name);
  }
  if (scan.secrets && !(scan.secretIgnore && scan.secretIgnore(relPath))) {
    const found = scanSecrets(text);
    if (found.length) result.secrets = found;
  }
  if (isCode && scan.duplicates) result.dupPrints = fingerprints(text, scan.dupMinLines || 6);

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

const DEP_PATTERNS = {
  // only real import statements: anchored at the start of a line, no quotes before "from"
  js: [
    /^[ \t]*(?:import|export)[ \t]+(?:type[ \t]+)?[^;'"`]*?\bfrom[ \t]*['"]([^'"\n]+)['"]/gm,
    /^[ \t]*import[ \t]*['"]([^'"\n]+)['"]/gm,
    /\b(?:require|import)[ \t]*\([ \t]*['"]([^'"\n]+)['"][ \t]*\)/g,
  ],
  css: [/@(?:import|use|forward)\s+(?:url\()?\s*['"]([^'"\n]+)['"]/g],
  c: [/^[ \t]*#[ \t]*include[ \t]*"([^"\n]+)"/gm],
  py: [/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import\b/gm, /^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm],
  html: [/(?:src|href)\s*=\s*["']([^"':#?\n]+\.(?:m?js|ts|css))["']/g],
  go: [/^[ \t]*import[ \t]+(?:[\w.]+[ \t]+)?"([^"\n]+)"/gm, /^[ \t]+(?:[\w.]+[ \t]+)?"([^"\n]+)"[ \t]*$/gm],
  rs: [
    /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+(?:::)?([\w]+(?:::[\w]+)*)/gm,
    /^[ \t]*extern[ \t]+crate[ \t]+(\w+)/gm,
  ],
};
const DEP_KIND = {
  JavaScript: 'js', JSX: 'js', TypeScript: 'js', TSX: 'js', Vue: 'js', Svelte: 'js', Astro: 'js',
  CSS: 'css', SCSS: 'css', Less: 'css', C: 'c', 'C++': 'c', 'Objective-C': 'c', Python: 'py', HTML: 'html', Go: 'go', Rust: 'rs',
};
const VALID_SPEC = /^[\w@.~/#:+-]{1,200}$/;

/** Removes comments (and Python docstrings) so that example code in them is not taken as an import. */
function stripComments(text, kind) {
  const blank = m => m.replace(/[^\n]/g, ' ');
  if (kind === 'py') return text.replace(/("""|''')[\s\S]*?\1/g, blank).replace(/^[ \t]*#.*$/gm, '');
  if (kind === 'js' || kind === 'css' || kind === 'c' || kind === 'go' || kind === 'rs') return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, '');
  return text;
}

/** Import / include / require specifiers of a file (resolved to files later). */
function extractDeps(text, langName) {
  const kind = DEP_KIND[langName];
  if (!kind || text.length > 1000000) return null;
  const out = new Set();
  const kinds = kind === 'html' ? ['html', 'js'] : [kind];
  for (const k of kinds) {
    let src = stripComments(text, k);
    if (k === 'go') {
      // only the import declarations (single imports and import blocks)
      src = [...src.matchAll(/^[ \t]*import[ \t]*\(([\s\S]*?)\)|^[ \t]*import[ \t]+[^(\n]*$/gm)].map(m => (m[1] != null ? m[1] : m[0])).join('\n');
    }
    if (k === 'rs') {
      // "mod foo;" declares a submodule file
      for (const m of src.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm)) out.add('mod:' + m[1]);
    }
    for (const re of DEP_PATTERNS[k]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) && out.size < 300) {
        const isPlainPyImport = k === 'py' && !m[0].trimStart().startsWith('from');
        const specs = isPlainPyImport ? m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0]) : [m[1].trim()];
        for (const spec of specs) if (spec && VALID_SPEC.test(spec)) out.add(spec);
      }
    }
  }
  return out.size ? [...out] : null;
}

/** compilerOptions.baseUrl / paths of a tsconfig.json or jsconfig.json (comments and trailing commas allowed) */
function readTsPaths(text) {
  try {
    const json = JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '').replace(/,(\s*[}\]])/g, '$1'));
    const co = json.compilerOptions || {};
    if (!co.paths && !co.baseUrl) return null;
    return { baseUrl: co.baseUrl || '.', paths: co.paths || {} };
  } catch { return null; }
}
/** aliases like  '@': path.resolve(__dirname, './src')  or  { find: '@', replacement: '/src' }  in vite / webpack configs */
function readBundlerAliases(text) {
  const out = {};
  for (const m of text.matchAll(/['"]?([@~#$][\w/-]*)['"]?\s*:\s*(?:path\.(?:resolve|join)\([^'"]*|fileURLToPath\(new URL\()?\s*['"]([./\w-]+)['"]/g)) out[m[1]] = m[2].replace(/^\.\//, '');
  for (const m of text.matchAll(/find:\s*['"]([^'"]+)['"]\s*,\s*replacement:\s*(?:path\.(?:resolve|join)\([^'"]*|fileURLToPath\(new URL\()?\s*['"]([./\w-]+)['"]/g)) out[m[1]] = m[2].replace(/^\.\//, '');
  return Object.keys(out).length ? out : null;
}

/** Runs analyzeFile over many files with bounded concurrency. */
async function analyzeFiles(files, maxBytes, onProgress, token, scan = {}) {
  const results = new Array(files.length);
  let next = 0, done = 0;
  const workers = Array.from({ length: 16 }, async () => {
    while (next < files.length) {
      if (token && token.isCancellationRequested) return;
      const i = next++;
      const f = files[i];
      results[i] = await analyzeFile(f.abs, f.rel, f.root, maxBytes, scan);
      done++;
      if (onProgress && done % 50 === 0) onProgress(done, files.length);
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

module.exports = { analyzeFiles, classifyLines };
