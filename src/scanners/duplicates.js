'use strict';

/**
 * Duplicate code detection: every line is normalized (whitespace, comments, trivial lines removed),
 * windows of N significant lines are hashed, and equal hashes in different places become duplicate blocks.
 */
const TRIVIAL = /^(?:[{}()[\];,]*|else|end|pass|return;?|break;?|continue;?|\}\s*else\s*\{|try\s*\{?|finally\s*\{?|<\/?\w+>|import .*|from .* import .*|#include .*|using .*;|package .*;?|"use strict";?|'use strict';?)$/;

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Hash per window of `size` significant lines: [hash, startLine, endLine][] (1-based). */
function fingerprints(text, size = 6, max = 20000) {
  if (text.length > 1500000) return null;
  const rows = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\/\/.*$|#(?![!{\[]).*$/, '').replace(/\s+/g, ' ').trim();
    if (t.length < 4 || TRIVIAL.test(t)) continue;
    rows.push([fnv(t), i + 1]);
  }
  const out = [];
  for (let i = 0; i + size <= rows.length && out.length < max; i++) {
    let h = 0x811c9dc5;
    for (let k = 0; k < size; k++) { h ^= rows[i + k][0]; h = Math.imul(h, 16777619) >>> 0; }
    out.push([h >>> 0, rows[i][1], rows[i + size - 1][1]]);
  }
  return out;
}

/**
 * files: [{ path, abs, dupPrints }] -> duplicate groups [{ lines, occurrences: [{ path, abs, line, end }] }]
 * Overlapping windows are merged into the longest runs.
 */
function findDuplicates(files, size = 6, maxGroups = 200) {
  const where = new Map(); // hash -> [[fileIdx, start, end]]
  files.forEach((f, fi) => {
    if (!f.dupPrints) return;
    for (const [h, s, e] of f.dupPrints) {
      const list = where.get(h);
      if (list) { if (list.length < 20) list.push([fi, s, e]); } else where.set(h, [[fi, s, e]]);
    }
  });
  // mark duplicated windows per file, then merge consecutive windows that share the same partner file
  const runs = new Map(); // key "fileA|fileB" -> [[startA, endA, startB, endB]]
  for (const list of where.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && j < 6; j++) {
        let [a, b] = [list[i], list[j]];
        if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) [a, b] = [b, a];
        if (a[0] === b[0] && a[2] >= b[1]) continue; // overlapping inside one file
        const key = a[0] + '|' + b[0];
        const arr = runs.get(key) || [];
        const last = arr[arr.length - 1];
        const delta = b[1] - a[1];
        if (last && a[1] <= last[1] + 1 + 3 && a[1] >= last[0] && b[1] - a[1] === last[4]) { last[1] = Math.max(last[1], a[2]); last[3] = Math.max(last[3], b[2]); }
        else arr.push([a[1], a[2], b[1], b[2], delta]);
        runs.set(key, arr);
      }
    }
  }
  const groups = [];
  for (const [key, arr] of runs) {
    const [fa, fb] = key.split('|').map(Number);
    for (const [sa, ea, sb, eb] of arr) {
      const len = Math.max(ea - sa, eb - sb) + 1;
      groups.push({ lines: len, occurrences: [
        { path: files[fa].path, abs: files[fa].abs, line: sa, end: ea },
        { path: files[fb].path, abs: files[fb].abs, line: sb, end: eb },
      ] });
    }
  }
  groups.sort((x, y) => y.lines - x.lines);
  const duplicatedLines = groups.reduce((s, g) => s + g.lines, 0);
  return { groups: groups.slice(0, maxGroups), total: groups.length, duplicatedLines };
}

module.exports = { fingerprints, findDuplicates, fnv };
