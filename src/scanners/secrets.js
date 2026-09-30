'use strict';

/**
 * Hard-coded secret detection: well-known token formats plus "password = '...'" style assignments
 * with a high-entropy value. Values are masked – the report never contains the full secret.
 */
const RULES = [
  { id: 'aws-access-key', name: 'AWS access key', severity: 'critical', re: /\b((?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16})\b/g },
  { id: 'aws-secret', name: 'AWS secret key', severity: 'critical', re: /aws.{0,20}?(?:secret|private).{0,20}?['"]([A-Za-z0-9/+=]{40})['"]/gi },
  { id: 'private-key', name: 'Private key', severity: 'critical', re: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/g },
  { id: 'github-token', name: 'GitHub token', severity: 'critical', re: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { id: 'gitlab-token', name: 'GitLab token', severity: 'critical', re: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g },
  { id: 'slack-token', name: 'Slack token', severity: 'high', re: /\b(xox[abposr]-[A-Za-z0-9-]{10,})\b/g },
  { id: 'slack-webhook', name: 'Slack webhook', severity: 'high', re: /(https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9_]+)/g },
  { id: 'stripe-key', name: 'Stripe secret key', severity: 'critical', re: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,})\b/g },
  { id: 'google-api-key', name: 'Google API key', severity: 'high', re: /\b(AIza[0-9A-Za-z_-]{35})\b/g },
  { id: 'openai-key', name: 'OpenAI API key', severity: 'critical', re: /\b(sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,})\b/g },
  { id: 'anthropic-key', name: 'Anthropic API key', severity: 'critical', re: /\b(sk-ant-[A-Za-z0-9_-]{30,})\b/g },
  { id: 'npm-token', name: 'npm token', severity: 'high', re: /\b(npm_[A-Za-z0-9]{36})\b/g },
  { id: 'sendgrid-key', name: 'SendGrid key', severity: 'high', re: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g },
  { id: 'twilio-key', name: 'Twilio key', severity: 'high', re: /\b(SK[0-9a-fA-F]{32})\b/g },
  { id: 'jwt', name: 'JSON Web Token', severity: 'medium', re: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g },
  { id: 'db-url', name: 'Connection string with password', severity: 'high', re: /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^:\s'"/]+:([^@\s'"]{4,})@[^\s'"]+)/g, secretGroup: 2 },
  { id: 'assignment', name: 'Hard-coded password / secret', severity: 'medium',
    re: /\b([A-Za-z_]*(?:password|passwd|pwd|secret|api_?key|apikey|access_?token|auth_?token|client_?secret|private_?key)[A-Za-z_]*)["']?\s*(?:=|:|:=|=>)\s*["']([^"'\s]{8,})["']/gi, secretGroup: 2, entropy: true },
];

const PLACEHOLDER = /^(?:x+|\*+|\.+|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%\(?\w*\)?s?|changeme|change_me|password|secret|example|your[_-].*|dummy|test.*|fake.*|sample.*|null|none|undefined|todo|redacted|placeholder|process\.env.*|os\.environ.*)$/i;

function entropy(s) {
  const f = {};
  for (const c of s) f[c] = (f[c] || 0) + 1;
  let e = 0;
  for (const k in f) { const p = f[k] / s.length; e -= p * Math.log2(p); }
  return e;
}

function mask(v) {
  if (v.startsWith('-----BEGIN')) return v;
  if (v.length <= 8) return v[0] + '•'.repeat(v.length - 1);
  return v.slice(0, 4) + '•'.repeat(Math.min(12, v.length - 6)) + v.slice(-2);
}

/**
 * @returns {{ line: number, rule: string, name: string, severity: string, preview: string }[]}
 */
function scanSecrets(text, max = 50) {
  if (text.length > 2000000) return [];
  const out = [];
  const seen = new Set();
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineOf = idx => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text)) && out.length < max) {
      const value = m[r.secretGroup || 1];
      if (!value) continue;
      if (PLACEHOLDER.test(value)) continue;
      if (r.entropy && (entropy(value) < 3.0 || /^[a-z]+$/i.test(value) || /^[A-Z_]+$/.test(value))) continue;
      const line = lineOf(m.index);
      const key = line + ':' + value;
      if (seen.has(key)) continue;
      seen.add(key);
      const full = m[0];
      out.push({ line, rule: r.id, name: r.name, severity: r.severity, preview: full.replace(value, mask(value)).slice(0, 120) });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

module.exports = { scanSecrets, entropy, mask, RULES };
