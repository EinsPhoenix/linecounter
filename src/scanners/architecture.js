'use strict';

const { globToRegExp } = require('../glob');

/**
 * Architecture rules checked against the real import edges.
 *
 *   rules:  [{ name?, from: "src/ui/**", disallow: ["src/db/**"], allow?: ["src/db/types.ts"], severity?: "error" | "warning" }]
 *           -> files matching `from` must not import files matching `disallow` (unless they match `allow`)
 *   layers: [{ name: "ui", pattern: "src/ui/**" }, { name: "services", pattern: "src/services/**" }, { name: "db", pattern: "src/db/**" }]
 *           -> ordered top to bottom: a layer may import layers below it, never layers above it
 *
 * edges: [[fromAbs, toAbs]], pathOf: abs -> relative path ("/"-separated)
 */
function checkArchitecture(edges, pathOf, config = {}) {
  const compile = list => (Array.isArray(list) ? list : list ? [list] : []).map(g => { try { return globToRegExp(String(g)); } catch { return null; } }).filter(Boolean);
  const rules = (config.rules || []).filter(r => r && r.from && r.disallow).map((r, i) => ({
    name: r.name || `${r.from} ↛ ${[].concat(r.disallow).join(', ')}`,
    severity: r.severity === 'warning' ? 'warning' : 'error',
    from: compile(r.from), disallow: compile(r.disallow), allow: compile(r.allow), index: i, violations: 0,
  }));
  const layers = (config.layers || []).filter(l => l && l.pattern).map((l, i) => ({ name: l.name || l.pattern, re: compile(l.pattern), rank: i }));
  const layerOf = p => layers.find(l => l.re.some(r => r.test(p)));
  const layerRule = layers.length ? { name: `Layers: ${layers.map(l => l.name).join(' → ')}`, severity: 'error', violations: 0, layered: true } : null;

  const violations = [];
  let checked = 0;
  for (const [a, b] of edges) {
    const pa = pathOf(a), pb = pathOf(b);
    if (!pa || !pb) continue;
    checked++;
    for (const r of rules) {
      if (!r.from.some(x => x.test(pa))) continue;
      if (!r.disallow.some(x => x.test(pb)) || r.allow.some(x => x.test(pb))) continue;
      r.violations++;
      violations.push({ rule: r.name, severity: r.severity, from: { path: pa, abs: a }, to: { path: pb, abs: b } });
    }
    if (layerRule) {
      const la = layerOf(pa), lb = layerOf(pb);
      if (la && lb && lb.rank < la.rank) {
        layerRule.violations++;
        violations.push({ rule: layerRule.name, severity: 'error', from: { path: pa, abs: a }, to: { path: pb, abs: b }, detail: `${la.name} must not import ${lb.name} (higher layer)` });
      }
    }
  }
  const all = [...rules.map(r => ({ name: r.name, severity: r.severity, violations: r.violations })), ...(layerRule ? [{ name: layerRule.name, severity: 'error', violations: layerRule.violations }] : [])];
  return { configured: all.length > 0, rules: all, violations: violations.slice(0, 1000), total: violations.length, checkedEdges: checked };
}

module.exports = { checkArchitecture };
