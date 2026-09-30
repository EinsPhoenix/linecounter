'use strict';

/** Aggregates per-file analysis results into the data model shown on the statistics page. */
function aggregate(files, meta) {
  const text = files.filter(f => !f.binary && !f.skipped);
  const sum = key => text.reduce((s, f) => s + f[key], 0);

  const totals = {
    files: files.length,
    textFiles: text.length,
    binaryFiles: files.filter(f => f.binary).length,
    skippedFiles: files.filter(f => f.skipped).length,
    size: files.reduce((s, f) => s + f.size, 0),
    lines: sum('lines'), code: sum('code'), comment: sum('comment'), blank: sum('blank'),
    chars: sum('chars'), words: sum('words'),
    todo: sum('todo'), fixme: sum('fixme'), hack: sum('hack'), wtf: sum('wtf'),
    trailing: sum('trailing'), tabIndent: sum('tabIndent'), spaceIndent: sum('spaceIndent'),
    semicolons: sum('semicolons'), braces: sum('braces'), parens: sum('parens'),
    debugPrints: sum('debugPrints'), emojis: sum('emojis'), fortyTwo: sum('fortyTwo'),
    funcs: sum('funcs'), imports: sum('imports'),
    folders: new Set(files.map(f => f.root + '|' + f.path.split('/').slice(0, -1).join('/'))).size,
  };

  // Group by language / extension
  const group = keyFn => {
    const m = new Map();
    for (const f of files) {
      const k = keyFn(f);
      const g = m.get(k) || { key: k, files: 0, lines: 0, code: 0, comment: 0, blank: 0, size: 0 };
      g.files++; g.lines += f.lines; g.code += f.code; g.comment += f.comment; g.blank += f.blank; g.size += f.size;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.lines - a.lines || b.size - a.size);
  };
  const languages = group(f => (f.binary ? 'Binary' : f.lang));
  const extensions = group(f => f.ext);

  // Top-level folders (per workspace root)
  const multiRoot = new Set(files.map(f => f.root)).size > 1;
  const folders = group(f => {
    const parts = f.path.split('/');
    const top = parts.length > 1 ? parts[0] + '/' : '(root files)';
    return multiRoot ? `${f.rootName}/${top}` : top;
  });

  // File length histogram
  const bucketEdges = [10, 50, 100, 250, 500, 1000, 2500, Infinity];
  const bucketLabels = ['1–10', '11–50', '51–100', '101–250', '251–500', '501–1k', '1k–2.5k', '2.5k+'];
  const histogram = bucketLabels.map(label => ({ label, count: 0 }));
  for (const f of text) {
    if (f.lines === 0) continue;
    histogram[bucketEdges.findIndex(e => f.lines <= e)].count++;
  }

  // Identifier frequencies
  const ids = new Map();
  for (const f of files) {
    if (!f.identifiers) continue;
    for (const [k, v] of Object.entries(f.identifiers)) ids.set(k, (ids.get(k) || 0) + v);
  }
  const identifiers = [...ids.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);

  // Age of files (mtime)
  const now = Date.now();
  const ageEdges = [1, 7, 30, 90, 365, Infinity];
  const ageLabels = ['today', '< 1 week', '< 1 month', '< 3 months', '< 1 year', 'older'];
  const ages = ageLabels.map(label => ({ label, count: 0 }));
  for (const f of files) {
    const days = (now - f.mtime) / 86400000;
    ages[ageEdges.findIndex(e => days <= e)].count++;
  }

  const by = (arr, fn) => arr.reduce((m, f) => (!m || fn(f) > fn(m) ? f : m), null);
  const ref = f => f && { path: f.path, abs: f.abs, rootName: f.rootName, lines: f.lines, size: f.size, maxLine: f.maxLine, maxLineNo: f.maxLineNo };
  const nonEmpty = text.filter(f => f.lines > 0);

  const records = {
    longestFile: ref(by(text, f => f.lines)),
    biggestFile: ref(by(files, f => f.size)),
    longestLine: ref(by(text, f => f.maxLine)),
    smallestFile: ref(by(nonEmpty, f => -f.lines)),
    deepestFile: ref(by(files, f => f.depth)),
    longestName: ref(by(files, f => f.name.length)),
    mostTodos: ref(by(text.filter(f => f.todo + f.fixme + f.hack > 0), f => f.todo + f.fixme + f.hack)),
    mostCommented: ref(by(text.filter(f => f.lines >= 20), f => f.comment / f.lines)),
    newestFile: ref(by(files, f => f.mtime)),
    oldestFile: ref(by(files, f => -f.mtime)),
  };
  if (records.deepestFile) records.deepestFile.depth = by(files, f => f.depth).depth;
  if (records.longestName) records.longestName.nameLen = by(files, f => f.name.length).name.length;
  if (records.mostTodos) { const f = by(text.filter(f => f.todo + f.fixme + f.hack > 0), f => f.todo + f.fixme + f.hack); records.mostTodos.count = f.todo + f.fixme + f.hack; }
  if (records.mostCommented) { const f = by(text.filter(f => f.lines >= 20), f => f.comment / f.lines); records.mostCommented.ratio = f.comment / f.lines; }

  const table = files.map(f => ({
    path: f.path, abs: f.abs, rootName: f.rootName, lang: f.binary ? 'Binary' : f.lang, ext: f.ext,
    lines: f.lines, code: f.code, comment: f.comment, blank: f.blank, size: f.size,
    maxLine: f.maxLine, todo: f.todo + f.fixme + f.hack, binary: f.binary, skipped: f.skipped, mtime: f.mtime,
  }));

  return {
    generated: now, ...meta, multiRoot,
    totals, languages, extensions, folders, histogram, identifiers, ages, records, table,
  };
}

module.exports = { aggregate };
