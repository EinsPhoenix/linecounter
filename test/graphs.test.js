'use strict';
// Tests for the dependency analysis (cycles, chains, layers, blast radius). Run: node test/graphs.test.js
const assert = require('assert');
const { analyzeDependencies } = require('../src/graphs');

const f = p => ({ path: p, abs: '/r/' + p, lang: 'JavaScript', lines: 10 });
const F = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'x', 'y'].map(n => [n, f(n + '.js')]));
const edges = [
  [F.a, F.b], [F.b, F.c], [F.c, F.a], // cycle a -> b -> c -> a
  [F.c, F.d], [F.d, F.e],             // chain continues to d -> e
  [F.x, F.y], [F.y, F.x],             // mutual import x <-> y
  [F.x, F.a],
];
const g = analyzeDependencies(edges, 100);
assert.strictEqual(g.cycleCount, 2, 'two cycles');
assert.strictEqual(g.cycles[0].size, 3);
const c0 = g.cycles[0].cycle.map(x => x.path);
assert.strictEqual(c0[0], c0[c0.length - 1], 'cycle path returns to its start');
assert.strictEqual(c0.length, 4);
assert.strictEqual(g.filesInCycles, 5);
// longest chain in the condensation: {x,y} -> {a,b,c} -> d -> e
assert.strictEqual(g.longestChain, 4);
assert.deepStrictEqual(g.chains[0].files.slice(-2).map(x => x.path), ['d.js', 'e.js']);
const node = p => g.nodes.find(n => n.path === p);
assert.strictEqual(node('e.js').dependents, 6, 'everything depends on e');
assert.strictEqual(node('x.js').dependencies, 6);
assert.ok(node('e.js').layer > node('d.js').layer && node('d.js').layer > node('a.js').layer, 'layers follow the imports');
assert.ok(g.links.filter(l => l.cyc).length === 5, 'cycle edges are flagged');
console.log('graphs.test OK');
