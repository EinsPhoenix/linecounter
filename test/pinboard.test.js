'use strict';
// Tests for the TODO pinboard (.locomotive/pinboard.json): matching cards to moved comments, gone cards, save/load. Run: node test/pinboard.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pinboard = require('../src/pinboard');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-pin-'));
const abs = p => path.join(root, p);
(async () => {
  // empty board: default columns
  const empty = pinboard.load(root);
  assert.deepStrictEqual(empty.columns.map(c => c.id), ['high', 'medium', 'low']);
  assert.strictEqual(empty.cards.length, 0);

  await pinboard.save(root, {
    cards: [
      { id: 'a', column: 'high', kind: 'code', path: 'src/a.js', tag: 'todo', text: 'Fix  the parser', line: 10 },
      { id: 'b', column: 'high', kind: 'code', path: 'src/a.js', tag: 'TODO', text: 'dup', line: 50 },
      { id: 'c', column: 'low', kind: 'code', path: 'src/gone.js', tag: 'FIXME', text: 'was fixed', line: 3 },
      { id: 'd', column: 'nope', kind: 'note', text: 'Write release notes' },
      { id: 'e', column: 'low', kind: 'note', text: '   ' }, // empty note is dropped
    ],
  });
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.locomotive', 'pinboard.json'), 'utf8'));
  assert.strictEqual(saved.cards.length, 4, 'empty note dropped');
  assert.strictEqual(saved.cards.find(c => c.id === 'd').column, 'high', 'unknown column falls back to the first');
  assert.strictEqual(saved.cards[0].tag, 'TODO');

  // the comments moved: parser TODO is now on line 14, two identical "dup" comments on lines 20 and 48
  const todos = { items: [
    { tag: 'TODO', text: 'fix the parser', line: 14, abs: abs('src/a.js'), path: 'src/a.js' },
    { tag: 'TODO', text: 'dup', line: 20, abs: abs('src/a.js'), path: 'src/a.js' },
    { tag: 'TODO', text: 'dup', line: 48, abs: abs('src/a.js'), path: 'src/a.js' },
    { tag: 'HACK', text: 'not pinned', line: 2, abs: abs('src/b.js'), path: 'src/b.js' },
  ] };
  const r = pinboard.resolve(pinboard.load(root), todos, root);
  const by = id => r.cards.find(c => c.id === id);
  assert.strictEqual(by('a').state, 'open');
  assert.strictEqual(by('a').line, 14, 'follows the moved comment (text matched case/space-insensitive)');
  assert.strictEqual(by('b').line, 48, 'identical comments: the one closest to the stored line');
  assert.strictEqual(by('c').state, 'gone');
  assert.strictEqual(by('d').state, 'note');
  assert.strictEqual(todos.items[0].pinnedBy, 'a');
  assert.strictEqual(todos.items[1].pinnedBy, undefined);
  assert.strictEqual(todos.items[3].pin, 'src/b.js');
  const order = pinboard.prioritized(r).map(c => `${c.priority}#${c.rank}:${c.id}`);
  assert.deepStrictEqual(order, ['High#1:a', 'High#2:b', 'High#3:d', 'Low#1:c']);

  // broken file -> empty board instead of a crash
  fs.writeFileSync(path.join(root, '.locomotive', 'pinboard.json'), '{ broken');
  assert.strictEqual(pinboard.load(root).cards.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
  console.log('pinboard.test OK');
})().catch(e => { console.error(e); process.exit(1); });
