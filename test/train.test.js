'use strict';
// Tests for the 3D train layout: hubs with hundreds of relations must not blow the layout up. Run: node test/train.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

class Vector3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } length() { return Math.hypot(this.x, this.y, this.z); } }
const window = { THREE: { Vector3 } };
new Function('window', 'THREE', fs.readFileSync(path.join(__dirname, '../media/train3d.js'), 'utf8'))(window, window.THREE);
const { layout3d } = window.LCTrain;

// 300 files, 40 libraries; every file imports 10 of them (a typical Python project with "libraries as graph nodes")
const nodes = [], links = [];
for (let i = 0; i < 300; i++) nodes.push({ layer: 0 });
for (let i = 0; i < 40; i++) nodes.push({ library: true, layer: 0 });
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 300; i++) for (let k = 0; k < 10; k++) links.push({ s: i, t: 300 + Math.floor(rnd() ** 2 * 40) });

const pos = layout3d(nodes, links, false);
const max = Math.max(...pos.map(p => p.length()));
assert.ok(pos.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)), 'all positions finite');
assert.ok(max < 20000, `layout stays bounded (max distance ${Math.round(max)})`);
console.log(`train.test OK (max distance ${Math.round(max)})`);
