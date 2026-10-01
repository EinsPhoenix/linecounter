'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { languageOf } = require('./languages');
const { extractFunctions } = require('./scanners/functions');
const { scanSecrets } = require('./scanners/secrets');
const { parseManifest, isManifest } = require('./deps/manifests');

function git(cwd, args) {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, ...args], { maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/** the branch to compare against: origin/HEAD, then main / master / develop (local or remote) */
async function defaultBase(root, current) {
  const head = await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const cands = [head && head.trim(), 'main', 'master', 'origin/main', 'origin/master', 'develop', 'origin/develop'].filter(Boolean);
  for (const c of cands) {
    if (c === current || c.endsWith('/' + current)) continue;
    if (await git(root, ['rev-parse', '--verify', '--quiet', c + '^{commit}'])) return c;
  }
  return null;
}

async function listBranches(root) {
  const out = await git(root, ['branch', '-a', '--sort=-committerdate', '--format=%(refname:short)']);
  return out ? out.split('\n').map(s => s.trim()).filter(b => b && !/HEAD$/.test(b) && b !== 'origin').slice(0, 200) : [];
}

const complexityOf = (text, lang) => {
  const fns = extractFunctions(text, lang);
  return { total: fns.reduce((s, f) => s + f.complexity, 0), fns };
};

/**
 * Compares the working tree of `root` (HEAD + uncommitted changes) with the merge base of `base`.
 * -> { base, head, mergeBase, ahead, behind, commits, files, totals, complexity, todos, secrets, deps, authors } | { error }
 */
async function compareBranches(root, base, opts = {}) {
  const head = ((await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])) || 'HEAD').trim();
  base = base || (await defaultBase(root, head));
  if (!base) return { error: 'No base branch found (main / master / origin/HEAD). Pick one.', head, branches: await listBranches(root) };
  const mb = ((await git(root, ['merge-base', base, 'HEAD'])) || '').trim();
  if (!mb) return { error: `"${base}" has no common history with ${head}.`, head, base, branches: await listBranches(root) };
  const [counts, log, numstat, nameStatus, diff] = await Promise.all([
    git(root, ['rev-list', '--left-right', '--count', `${base}...HEAD`]),
    git(root, ['log', '--no-merges', '-n', '200', '--format=%h\x1f%an\x1f%at\x1f%s', `${mb}..HEAD`]),
    git(root, ['diff', '--numstat', '-M', mb]),
    git(root, ['diff', '--name-status', '-M', mb]),
    git(root, ['diff', '-U0', '--no-color', '-M', mb]),
  ]);
  const [behind, ahead] = (counts || '0 0').trim().split(/\s+/).map(Number);
  const commits = (log || '').split('\n').filter(Boolean).map(l => { const [hash, author, at, subject] = l.split('\x1f'); return { hash, author, time: Number(at) * 1000, subject }; });
  const authors = Object.entries(commits.reduce((m, c) => ((m[c.author] = (m[c.author] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, commits: n }));

  // files: status + added / deleted lines
  const status = new Map();
  for (const l of (nameStatus || '').split('\n').filter(Boolean)) {
    const p = l.split('\t');
    const s = p[0][0];
    status.set(p[p.length - 1], { status: s === 'A' ? 'added' : s === 'D' ? 'deleted' : s === 'R' ? 'renamed' : 'modified', from: s === 'R' ? p[1] : null });
  }
  const files = [];
  for (const l of (numstat || '').split('\n').filter(Boolean)) {
    const [a, d, ...rest] = l.split('\t');
    let file = rest.join('\t');
    const m = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(file) || /^()(.*) => (.*)()$/.exec(file);
    if (m) file = (m[1] + m[3] + m[4]).replace(/\/\//g, '/');
    const st = status.get(file) || { status: 'modified' };
    files.push({ path: file, abs: path.join(root, file), status: st.status, from: st.from, added: a === '-' ? 0 : Number(a), deleted: d === '-' ? 0 : Number(d), binary: a === '-' });
  }

  // complexity before / after for changed code files
  const maxFiles = opts.maxFiles || 300;
  const newComplex = [], grown = [];
  let cxBefore = 0, cxAfter = 0;
  for (const f of files.filter(x => !x.binary).slice(0, maxFiles)) {
    const lang = languageOf(path.basename(f.path)).name;
    const before = f.status === 'added' ? '' : (await git(root, ['show', `${mb}:${f.from || f.path}`])) || '';
    let after = '';
    if (f.status !== 'deleted') { try { after = fs.readFileSync(f.abs, 'utf8'); } catch { after = ''; } }
    const b = complexityOf(before, lang), a = complexityOf(after, lang);
    if (!b.fns.length && !a.fns.length) continue;
    f.cxBefore = b.total; f.cxAfter = a.total;
    cxBefore += b.total; cxAfter += a.total;
    const old = new Map(b.fns.map(x => [x.name, x]));
    for (const fn of a.fns) {
      const o = old.get(fn.name);
      if (!o) newComplex.push({ name: fn.name, path: f.path, abs: f.abs, line: fn.line, complexity: fn.complexity, lines: fn.lines, isNew: true });
      else if (fn.complexity > o.complexity) grown.push({ name: fn.name, path: f.path, abs: f.abs, line: fn.line, complexity: fn.complexity, before: o.complexity });
    }
  }
  newComplex.sort((x, y) => y.complexity - x.complexity);
  grown.sort((x, y) => (y.complexity - y.before) - (x.complexity - x.before));

  // added lines: new TODOs and secrets
  const todos = [], secrets = [];
  let cur = null, line = 0;
  const addedText = new Map();
  for (const l of (diff || '').split('\n')) {
    if (l.startsWith('+++ ')) { cur = l.startsWith('+++ b/') ? l.slice(6) : null; continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { line = Number(h[1]); continue; }
    if (!cur || l.startsWith('---')) continue;
    if (l.startsWith('+')) {
      const text = l.slice(1);
      const t = /(?:\/\/|#|--|\/\*|\*|<!--)\s*@?(TODO|FIXME|HACK|XXX|BUG)\b(?:\(([^)]{1,40})\))?[:\s-]*(.*)$/.exec(text);
      if (t && todos.length < 300) todos.push({ tag: t[1], text: t[3].trim().slice(0, 160), path: cur, abs: path.join(root, cur), line });
      if (!addedText.has(cur)) addedText.set(cur, []);
      addedText.get(cur).push([line, text]);
      line++;
    }
  }
  for (const [file, lines] of addedText) {
    const text = lines.map(([, t]) => t).join('\n');
    for (const s of scanSecrets(text, 20)) secrets.push({ ...s, path: file, abs: path.join(root, file), line: (lines[s.line - 1] || [s.line])[0] });
  }

  // dependencies: manifests that changed
  const deps = [];
  for (const f of files.filter(x => isManifest(path.basename(x.path)))) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-cmp-'));
    try {
      const before = f.status === 'added' ? null : await git(root, ['show', `${mb}:${f.from || f.path}`]);
      let b = null;
      if (before != null) { const p = path.join(tmp, path.basename(f.path)); fs.writeFileSync(p, before); b = parseManifest(p); }
      const a = f.status === 'deleted' ? null : parseManifest(f.abs);
      const bm = new Map((b ? b.deps : []).map(d => [d.name, d.spec])), am = new Map((a ? a.deps : []).map(d => [d.name, d.spec]));
      for (const [n, spec] of am) if (!bm.has(n)) deps.push({ manifest: f.path, name: n, change: 'added', to: spec });
      for (const [n, spec] of bm) if (!am.has(n)) deps.push({ manifest: f.path, name: n, change: 'removed', from: spec });
      for (const [n, spec] of am) if (bm.has(n) && bm.get(n) !== spec) deps.push({ manifest: f.path, name: n, change: 'changed', from: bm.get(n), to: spec });
    } catch { /* unparsable */ } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  return {
    root, base, head, mergeBase: mb.slice(0, 10), ahead, behind, commits: commits.slice(0, 100), commitCount: commits.length, authors,
    files: files.sort((x, y) => (y.added + y.deleted) - (x.added + x.deleted)).slice(0, 500),
    totals: { files: files.length, added: files.reduce((s, f) => s + f.added, 0), deleted: files.reduce((s, f) => s + f.deleted, 0), newFiles: files.filter(f => f.status === 'added').length, deletedFiles: files.filter(f => f.status === 'deleted').length },
    complexity: { before: cxBefore, after: cxAfter, newFunctions: newComplex.slice(0, 50), grown: grown.slice(0, 50) },
    todos, secrets, deps,
    branches: await listBranches(root),
    generated: Date.now(),
  };
}

module.exports = { compareBranches, defaultBase, listBranches };
