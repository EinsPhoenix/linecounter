'use strict';

const { execFile } = require('child_process');
const path = require('path');

function git(cwd, args) {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, ...args], { maxBuffer: 512 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

async function repoRoot(dir) {
  const out = await git(dir, ['rev-parse', '--show-toplevel']);
  return out ? path.resolve(out.trim()) : null;
}

/** Paths (relative to dir, '/'-separated) that git ignores. Directories end with '/'. */
async function ignoredPaths(dir) {
  const out = await git(dir, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']);
  if (!out) return [];
  return out.split('\0').filter(Boolean);
}

const SEP = '\x1f';
const REC = '\x1e';

const DEFAULT_COMMIT_WORDS = ['wip', 'asdf', 'tmp', 'temp', 'stuff', 'misc', 'oops', 'typo', 'final', 'please', 'hack',
  'whatever', 'idk', 'wtf', 'lol', 'yolo', 'again', 'why', 'test', 'changes', 'update', 'fixed stuff', 'small fix', 'minor'];

/** Collects commit messages worth ranting about. */
function commitRant(commits, opts) {
  const minLen = opts.minLength || 10;
  const maxLen = opts.maxLength || 72;
  const words = (opts.words && opts.words.length ? opts.words : DEFAULT_COMMIT_WORDS).map(w => String(w).toLowerCase()).filter(Boolean);
  const ex = c => ({ hash: c.hash.slice(0, 8), subject: c.subject, author: c.author, time: c.time });
  const own = commits.filter(c => !c.merge && !/^(merge|revert "revert)/i.test(c.subject) && !/\[bot\]|dependabot|renovate/i.test(c.author));
  const short = own.filter(c => c.subject.trim().length < minLen && !/^v?\d+(\.\d+)+(-[\w.]+)?$/.test(c.subject.trim()));
  const long = own.filter(c => c.subject.length > maxLen).sort((a, b) => b.subject.length - a.subject.length);
  const wordHits = [];
  for (const w of words) {
    const re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i');
    const hits = own.filter(c => re.test(c.subject));
    if (hits.length) wordHits.push({ word: w, count: hits.length, examples: hits.slice(0, 5).map(ex) });
  }
  wordHits.sort((a, b) => b.count - a.count);
  const shouting = own.filter(c => c.subject.length >= 6 && /[A-Z]{4}/.test(c.subject) && c.subject === c.subject.toUpperCase());
  const exclaim = own.filter(c => /!!|\?\?|\?!/.test(c.subject));
  const counts = new Map();
  for (const c of own) { const k = c.subject.trim().toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); }
  const repeats = [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([subject, count]) => ({ subject, count }));
  const reverts = commits.filter(c => /^revert/i.test(c.subject)).length;
  const fridayLate = own.filter(c => { const d = new Date(c.time); return d.getDay() === 5 && d.getHours() >= 17; });
  const lowercase = own.filter(c => /^[a-z]/.test(c.subject)).length;
  const endsWithDot = own.filter(c => /[^.]\.$/.test(c.subject)).length;
  const pack = arr => ({ count: arr.length, examples: arr.slice(0, 8).map(ex) });
  return {
    minLength: minLen, maxLength: maxLen, total: own.length,
    short: pack(short), long: pack(long), words: wordHits.slice(0, 12), shouting: pack(shouting), exclaim: pack(exclaim),
    repeats, reverts, fridayLate: pack(fridayLate), lowercase, endsWithDot,
  };
}

async function repoStats(root, maxCommits, rantOpts = {}) {
  const [branch, remote, branches, tags, logOut, nameOut] = await Promise.all([
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(root, ['remote', 'get-url', 'origin']),
    git(root, ['branch', '-a', '--format=%(refname:short)']),
    git(root, ['tag']),
    git(root, ['log', `-n${maxCommits}`, '--no-color', `--format=${REC}%H${SEP}%an${SEP}%ae${SEP}%at${SEP}%P${SEP}%s`, '--shortstat']),
    git(root, ['log', `-n${maxCommits}`, '--no-color', '--no-merges', '--format=', '--name-only']),
  ]);
  if (logOut === null) return null;

  const commits = [];
  for (const rec of logOut.split(REC)) {
    if (!rec.trim()) continue;
    const nl = rec.indexOf('\n');
    const head = nl === -1 ? rec : rec.slice(0, nl);
    const rest = nl === -1 ? '' : rec.slice(nl + 1);
    const [hash, author, email, at, parents, subject] = head.split(SEP);
    const ins = /(\d+) insertion/.exec(rest);
    const del = /(\d+) deletion/.exec(rest);
    const files = /(\d+) files? changed/.exec(rest);
    commits.push({
      hash, author, email, time: Number(at) * 1000,
      merge: (parents || '').trim().split(' ').length > 1,
      subject: subject || '',
      ins: ins ? Number(ins[1]) : 0,
      del: del ? Number(del[1]) : 0,
      files: files ? Number(files[1]) : 0,
    });
  }

  // Authors (merged by name)
  const authorMap = new Map();
  for (const c of commits) {
    const a = authorMap.get(c.author) || { name: c.author, commits: 0, ins: 0, del: 0, first: c.time, last: c.time };
    a.commits++; a.ins += c.ins; a.del += c.del;
    a.first = Math.min(a.first, c.time); a.last = Math.max(a.last, c.time);
    authorMap.set(c.author, a);
  }
  const authors = [...authorMap.values()].sort((a, b) => b.commits - a.commits);

  // Hotspots
  const churn = new Map();
  if (nameOut) {
    for (const f of nameOut.split('\n')) {
      if (!f) continue;
      churn.set(f, (churn.get(f) || 0) + 1);
    }
  }
  const hotspots = [...churn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([file, count]) => ({ file, abs: path.join(root, file), count }));

  // Time distributions
  const weekdayHour = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const months = new Map();
  const days = new Map();
  for (const c of commits) {
    const d = new Date(c.time);
    weekdayHour[(d.getDay() + 6) % 7][d.getHours()]++; // Monday = 0
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.set(mk, (months.get(mk) || 0) + 1);
    const dk = `${mk}-${String(d.getDate()).padStart(2, '0')}`;
    days.set(dk, (days.get(dk) || 0) + 1);
  }
  let firstTime = null, lastTime = null;
  for (const c of commits) {
    if (firstTime === null || c.time < firstTime) firstTime = c.time;
    if (lastTime === null || c.time > lastTime) lastTime = c.time;
  }
  // Fill month gaps so the timeline is continuous
  const monthList = [];
  if (commits.length) {
    const first = new Date(firstTime);
    const last = new Date(lastTime);
    const cur = new Date(first.getFullYear(), first.getMonth(), 1);
    while (cur <= last) {
      const mk = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      monthList.push({ month: mk, count: months.get(mk) || 0 });
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  // Longest streak of consecutive commit days
  const dayKeys = [...days.keys()].sort();
  let streak = 0, best = 0, bestEnd = null, prev = null;
  for (const k of dayKeys) {
    const t = Date.parse(k + 'T12:00:00');
    streak = prev !== null && Math.round((t - prev) / 86400000) === 1 ? streak + 1 : 1;
    if (streak > best) { best = streak; bestEnd = k; }
    prev = t;
  }
  let busiestDay = null;
  for (const [k, v] of days) if (!busiestDay || v > busiestDay.count) busiestDay = { day: k, count: v };

  // Commit message words
  const words = new Map();
  const stop = new Set(['the', 'a', 'an', 'to', 'and', 'of', 'in', 'for', 'on', 'with', 'from', 'into', 'is', 'at', 'by', 'merge', 'branch', 'pull', 'request', 'remote-tracking', 'origin']);
  for (const c of commits) {
    for (const w of c.subject.toLowerCase().split(/[^a-z0-9äöüß\-]+/)) {
      if (w.length < 3 || stop.has(w)) continue;
      words.set(w, (words.get(w) || 0) + 1);
    }
  }
  const topWords = [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  const nonMerge = commits.filter(c => !c.merge);
  const night = commits.filter(c => { const h = new Date(c.time).getHours(); return h < 5; }).length;
  const weekend = commits.filter(c => { const d = new Date(c.time).getDay(); return d === 0 || d === 6; }).length;
  const fixes = commits.filter(c => /\b(fix|fixed|fixes|bug|hotfix|oops|typo)\b/i.test(c.subject)).length;
  const lazy = commits.filter(c => /^(wip|update|updates|changes|stuff|asdf|test|\.|minor|misc|fix)$/i.test(c.subject.trim())).length;
  const shortest = nonMerge.reduce((m, c) => (!m || c.subject.length < m.subject.length ? c : m), null);
  const longest = nonMerge.reduce((m, c) => (!m || c.subject.length > m.subject.length ? c : m), null);
  const biggest = nonMerge.reduce((m, c) => (!m || c.ins + c.del > m.ins + m.del ? c : m), null);

  // Bus factor: minimal number of authors covering >= 50% of commits
  let acc = 0, bus = 0;
  for (const a of authors) { if (acc >= commits.length / 2) break; acc += a.commits; bus++; }

  const pick = c => c && { hash: c.hash.slice(0, 8), subject: c.subject, author: c.author, time: c.time, ins: c.ins, del: c.del };

  return {
    root, name: path.basename(root),
    branch: branch ? branch.trim() : null,
    remote: remote ? remote.trim() : null,
    branchCount: branches ? branches.split('\n').filter(Boolean).length : 0,
    tagCount: tags ? tags.split('\n').filter(Boolean).length : 0,
    commitCount: commits.length, truncated: commits.length >= maxCommits,
    mergeCount: commits.length - nonMerge.length,
    first: firstTime,
    last: lastTime,
    insertions: commits.reduce((s, c) => s + c.ins, 0),
    deletions: commits.reduce((s, c) => s + c.del, 0),
    authors: authors.slice(0, 30), authorCount: authors.length,
    hotspots, weekdayHour, months: monthList,
    streak: best, streakEnd: bestEnd, busiestDay,
    activeDays: days.size,
    topWords, night, weekend, fixes, lazy, busFactor: bus,
    avgMsgLen: nonMerge.length ? Math.round(nonMerge.reduce((s, c) => s + c.subject.length, 0) / nonMerge.length) : 0,
    shortest: pick(shortest), longest: pick(longest), biggest: pick(biggest),
    commitRant: commitRant(commits, rantOpts),
  };
}

module.exports = { repoRoot, repoStats, ignoredPaths };
