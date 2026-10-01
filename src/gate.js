'use strict';

/**
 * Quality gate: turns the statistics data into pass / fail checks (used by the CLI for CI pipelines,
 * the "Run Quality Gate" command and the card on the statistics page).
 *
 * locomotive.gate = {
 *   vulnerabilities: "critical" | "high" | "medium" | "low" | "off",   // fail at this severity or worse
 *   secrets: "critical" | "high" | "medium" | "off",
 *   problematicLicenses: true,
 *   unknownLicenses: false,
 *   architecture: "error" | "warning" | "off",
 *   maxComplexity: null,          // fail if any function is more complex
 *   minHealthScore: null,         // fail below this score
 *   maxDuplicatedPercent: null,
 *   circularImports: false,
 * }
 */
const DEFAULTS = { vulnerabilities: 'critical', secrets: 'high', problematicLicenses: true, unknownLicenses: false, architecture: 'error', maxComplexity: null, minHealthScore: null, maxDuplicatedPercent: null, circularImports: false };
const VULN_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0, NONE: 0 };
const SECRET_RANK = { critical: 3, high: 2, medium: 1, low: 0 };

function evaluateGate(D, cfg = {}) {
  const c = { ...DEFAULTS, ...(cfg || {}) };
  const checks = [];
  const add = (id, label, enabled, failures, detail) => checks.push({ id, label, enabled, passed: !enabled || failures.length === 0, count: failures.length, detail: enabled ? detail(failures) : 'off', items: failures.slice(0, 20) });

  const R = D.dependencies;
  const vulnMin = String(c.vulnerabilities || 'off').toUpperCase();
  const vulns = R && R.vulns ? R.vulns.items.filter(v => VULN_RANK[v.severity] >= (VULN_RANK[vulnMin] ?? 99)) : [];
  add('vulnerabilities', `No ${vulnMin.toLowerCase()}+ vulnerabilities`, vulnMin !== 'OFF' && !!R, vulns.map(v => `${v.ecosystem} ${v.name}@${v.version}: ${v.id} (${v.severity})`), f => (f.length ? `${f.length} found` : R && R.vulns && R.vulns.error ? `OSV.dev not reachable: ${R.vulns.error}` : 'none'));
  if (R && R.vulns && R.vulns.error && vulnMin !== 'OFF') checks[checks.length - 1].warning = `vulnerabilities could not be checked: ${R.vulns.error}`;

  const H = D.health;
  const secMin = String(c.secrets || 'off').toLowerCase();
  const secrets = H && H.secrets ? H.secrets.items.filter(s => SECRET_RANK[s.severity] >= (SECRET_RANK[secMin] ?? 99)) : [];
  add('secrets', `No ${secMin}+ hard-coded secrets`, secMin !== 'off' && !!(H && H.secrets), secrets.map(s => `${s.path}:${s.line} ${s.name}`), f => (f.length ? `${f.length} found` : 'none'));

  const pkgs = R ? R.packages.filter(p => !p.ignored) : [];
  add('licenses', 'No problematic licenses', !!c.problematicLicenses && !!R, pkgs.filter(p => p.status === 'problematic').map(p => `${p.ecosystem} ${p.name}: ${p.license}`), f => (f.length ? `${f.length} packages` : 'none'));
  add('unknownLicenses', 'No unknown licenses', !!c.unknownLicenses && !!R, pkgs.filter(p => p.license === 'Unknown').map(p => `${p.ecosystem} ${p.name}`), f => (f.length ? `${f.length} packages` : 'none'));

  const A = D.architecture;
  const archMin = String(c.architecture || 'off');
  const arch = A ? A.violations.filter(v => archMin === 'warning' || v.severity === 'error') : [];
  add('architecture', 'No architecture violations', archMin !== 'off' && !!(A && A.configured), arch.map(v => `${v.from.path} → ${v.to.path} (${v.rule})`), f => (f.length ? `${f.length} violations` : 'none'));

  if (c.maxComplexity != null && H) add('complexity', `No function with complexity > ${c.maxComplexity}`, true, H.complex.filter(f => f.complexity > c.maxComplexity).map(f => `${f.path}:${f.line} ${f.name}() = ${f.complexity}`), f => (f.length ? `${f.length}${f.length >= 60 ? '+' : ''} functions` : 'none'));
  if (c.minHealthScore != null && H) add('health', `Health score ≥ ${c.minHealthScore}`, true, H.score < c.minHealthScore ? [`score ${H.score} (${H.grade})`] : [], f => (f.length ? f[0] : `score ${H.score} (${H.grade})`));
  if (c.maxDuplicatedPercent != null && H && H.duplicates) add('duplicates', `Duplicated code ≤ ${c.maxDuplicatedPercent}%`, true, H.duplicates.percent > c.maxDuplicatedPercent ? [`${H.duplicates.percent.toFixed(1)}%`] : [], f => (f.length ? f[0] : `${H.duplicates.percent.toFixed(1)}%`));
  const G = D.importGraph;
  if (c.circularImports && G) add('cycles', 'No circular imports', true, G.cycles.map(x => x.cycle.map(f => f.path).join(' → ')), f => (f.length ? `${G.cycleCount} cycles` : 'none'));

  const active = checks.filter(x => x.enabled);
  return { passed: active.every(x => x.passed), checks, config: c, generated: D.generated };
}

/** Markdown summary (e.g. for $GITHUB_STEP_SUMMARY or a PR comment) */
function gateMarkdown(res, title = 'LOComotive quality gate') {
  const lines = [`## ${res.passed ? '✅' : '❌'} ${title}: ${res.passed ? 'passed' : 'FAILED'}`, '', '| Check | Result | Details |', '|---|---|---|'];
  for (const c of res.checks) lines.push(`| ${c.label} | ${!c.enabled ? '➖ off' : c.passed ? '✅ pass' : '❌ fail'} | ${String(c.detail).replace(/\|/g, '\\|')}${c.warning ? ' ⚠️ ' + c.warning : ''} |`);
  const failed = res.checks.filter(c => c.enabled && !c.passed);
  for (const c of failed) { lines.push('', `### ${c.label}`, ...c.items.map(i => `- ${i}`), c.count > c.items.length ? `- … and ${c.count - c.items.length} more` : ''); }
  return lines.join('\n') + '\n';
}

module.exports = { evaluateGate, gateMarkdown, GATE_DEFAULTS: DEFAULTS };
