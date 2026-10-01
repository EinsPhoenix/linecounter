'use strict';
// TODO tracker with git blame. Run: node test/todos.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { analyzeFiles } = require('../src/analyzer');
const { buildTodos } = require('../src/scanners/todos');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-todo-'));
const run = (args, env) => execFileSync('git', ['-C', root, ...args], { env: { ...process.env, ...env }, stdio: 'pipe' });
try { run(['init', '-q']); } catch { console.log('todos.test skipped (git not available)'); process.exit(0); }
run(['config', 'user.email', 'a@example.com']); run(['config', 'user.name', 'Alice']);
const commit = (file, text, date, who) => {
  fs.writeFileSync(path.join(root, file), text);
  run(['add', file]);
  run(['-c', `user.name=${who}`, 'commit', '-q', '-m', 'c', '--date', date], { GIT_COMMITTER_DATE: date });
};
commit('old.js', 'function a() {}\n// TODO: remove this hack before release\n', '2019-03-01T10:00:00', 'Alice');
commit('new.py', 'def b():\n    pass  # FIXME(bob): handle None\n', '2025-01-01T10:00:00', 'Bob');
fs.appendFileSync(path.join(root, 'new.py'), '# HACK not committed yet\n');

(async () => {
  const files = await analyzeFiles(['old.js', 'new.py'].map(r => ({ abs: path.join(root, r), rel: r, root })), 1e6);
  const t = await buildTodos(files, [{ root: fs.realpathSync(root) }].concat([{ root }]), { now: Date.parse('2026-01-01') });
  assert.strictEqual(t.total, 3);
  const old = t.items.find(x => x.path === 'old.js');
  assert.strictEqual(old.author, 'Alice');
  assert.strictEqual(old.tag, 'TODO');
  assert.strictEqual(old.text, 'remove this hack before release');
  assert.ok(old.ageDays > 2400, 'about 6.8 years old');
  const fix = t.items.find(x => x.tag === 'FIXME');
  assert.strictEqual(fix.author, 'Bob');
  assert.strictEqual(fix.text, 'handle None');
  assert.strictEqual(t.oldest.path, 'old.js');
  assert.ok(t.items.find(x => x.tag === 'HACK').uncommitted, 'uncommitted lines are recognised');
  // branch comparison
  run(['add', 'new.py']); run(['commit', '-q', '-m', 'hack']);
  const baseBranch = run(['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
  run(['checkout', '-q', '-b', 'feature']);
  commit('feat.js', 'export function decide(a, b) {\n  if (a && b) return 1;\n  // TODO: tidy\n  return a ? 2 : 3;\n}\nconst k = "ghp_' + 'x'.repeat(36) + '";\n', '2025-06-01T10:00:00', 'Carol');
  const { compareBranches } = require('../src/compare');
  const c = await compareBranches(root, baseBranch);
  assert.strictEqual(c.ahead, 1);
  assert.strictEqual(c.totals.newFiles, 1);
  assert.strictEqual(c.complexity.newFunctions[0].name, 'decide');
  assert.strictEqual(c.todos.length, 1);
  assert.strictEqual(c.secrets.length, 1, 'github token in the added lines');
  fs.rmSync(root, { recursive: true, force: true });
  console.log('todos.test OK (incl. branch comparison)');
})().catch(e => { console.error(e); process.exit(1); });
