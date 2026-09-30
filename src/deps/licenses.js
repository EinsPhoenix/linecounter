'use strict';

/**
 * License normalisation (free text / classifiers -> SPDX ids) and classification against configurable lists.
 */
const ALIASES = [
  [/^(the )?mit( license)?$|^mit\/x11$|^expat$/i, 'MIT'],
  [/^mit-0$/i, 'MIT-0'],
  [/^isc( license)?$/i, 'ISC'],
  [/^0bsd$/i, '0BSD'],
  [/bsd.*(2|two)[- ]clause|simplified bsd|freebsd/i, 'BSD-2-Clause'],
  [/bsd.*(3|three)[- ]clause|new bsd|modified bsd|revised bsd/i, 'BSD-3-Clause'],
  [/^bsd( license)?$|^bsd-style/i, 'BSD-3-Clause'],
  [/apache.*2(\.0)?|^apache software license$|^apache$|^asl 2/i, 'Apache-2.0'],
  [/^(the )?unlicense$/i, 'Unlicense'],
  [/cc0|public domain dedication/i, 'CC0-1.0'],
  [/^public domain$/i, 'Public-Domain'],
  [/python software foundation|^psf|^psfl|python-2\.0/i, 'PSF-2.0'],
  [/^zlib/i, 'Zlib'],
  [/historical permission notice|^hpnd$/i, 'HPND'],
  [/artistic.*2/i, 'Artistic-2.0'],
  [/blueoak/i, 'BlueOak-1.0.0'],
  [/wtfpl/i, 'WTFPL'],
  [/affero|agpl.*3|agplv3/i, 'AGPL-3.0'],
  [/lesser.*(v?2\.1|version 2\.1)|lgpl.*2\.1|lgplv2\.1/i, 'LGPL-2.1'],
  [/lesser.*(v?3|version 3)|lgpl.*3|lgplv3/i, 'LGPL-3.0'],
  [/lesser|lgpl|library general public/i, 'LGPL'],
  [/gpl.*v?2|general public license.*(v?2|version 2)|gplv2/i, 'GPL-2.0'],
  [/gpl.*v?3|general public license.*(v?3|version 3)|gplv3/i, 'GPL-3.0'],
  [/^gpl$|general public license/i, 'GPL'],
  [/mozilla.*2|mpl.*2/i, 'MPL-2.0'],
  [/mozilla|mpl/i, 'MPL'],
  [/eclipse.*2|epl.*2/i, 'EPL-2.0'],
  [/eclipse|epl/i, 'EPL-1.0'],
  [/cddl/i, 'CDDL-1.0'],
  [/eupl.*1\.2|european union public/i, 'EUPL-1.2'],
  [/server side public|sspl/i, 'SSPL-1.0'],
  [/business source|busl/i, 'BUSL-1.1'],
  [/cc-by-nc|noncommercial|non-commercial/i, 'CC-BY-NC-4.0'],
  [/cc-by-sa|sharealike/i, 'CC-BY-SA-4.0'],
  [/cc-by|creative commons attribution/i, 'CC-BY-4.0'],
  [/^unlicensed$|proprietary|all rights reserved|commercial/i, 'Proprietary'],
];

const SPDX_LIKE = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/** Normalises one license string to an SPDX-ish id ("Unknown" if empty). Expressions keep their structure. */
function normalizeLicense(raw) {
  if (raw == null) return 'Unknown';
  let s = String(raw).trim().replace(/\s+/g, ' ');
  if (!s || /^(unknown|none|n\/a|null|undefined|UNKNOWN)$/i.test(s)) return 'Unknown';
  if (/^see license in/i.test(s)) return 'Custom';
  if (s.length > 200) return sniffLicenseText(s) || 'Custom';
  // SPDX expressions like "(MIT OR Apache-2.0)"
  if (/\s(OR|AND|WITH)\s/.test(s)) {
    return s.replace(/[()]/g, ' ').split(/\s+(OR|AND|WITH)\s+/).map((part, i) => (i % 2 ? part : normalizeLicense(part))).join(' ');
  }
  s = s.replace(/^\(|\)$/g, '').trim();
  const known = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'AGPL-3.0', 'MPL-2.0'];
  const exact = known.find(k => k.toLowerCase() === s.toLowerCase().replace(/-(only|or-later)$/, '').replace(/\+$/, ''));
  if (exact) return exact;
  for (const [re, id] of ALIASES) if (re.test(s)) return id;
  return SPDX_LIKE.test(s) ? s : 'Custom';
}

/** Identifies common license texts (LICENSE files). */
function sniffLicenseText(text) {
  const t = String(text).slice(0, 4000);
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0';
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 3/i.test(t)) return 'LGPL-3.0';
  if (/GNU LESSER GENERAL PUBLIC LICENSE|GNU LIBRARY GENERAL PUBLIC/i.test(t)) return 'LGPL-2.1';
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 3/i.test(t)) return 'GPL-3.0';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return 'GPL-2.0';
  if (/Mozilla Public License,? v(ersion)?\.? ?2/i.test(t)) return 'MPL-2.0';
  if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(t)) return 'Apache-2.0';
  if (/Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose/i.test(t)) return 'ISC';
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name|endorse or promote/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return 'Unlicense';
  if (/Server Side Public License/i.test(t)) return 'SSPL-1.0';
  if (/Business Source License/i.test(t)) return 'BUSL-1.1';
  return null;
}

/** Classifier list of Python metadata -> SPDX id */
function fromClassifiers(classifiers) {
  const lic = classifiers.filter(c => c.startsWith('License ::')).map(c => c.split('::').pop().trim()).filter(x => !/^OSI Approved$/i.test(x));
  return lic.length ? normalizeLicense(lic.join(' OR ')) : null;
}

const CATEGORY = [
  [/^(AGPL|SSPL)/i, 'network-copyleft'],
  [/^GPL/i, 'strong-copyleft'],
  [/^(LGPL|MPL|EPL|CDDL|EUPL|CC-BY-SA|OSL|CPL)/i, 'weak-copyleft'],
  [/^(CC-BY-NC|BUSL|Proprietary|Custom)/i, 'restricted'],
  [/^Unknown$/i, 'unknown'],
];
const CATEGORY_RANK = { permissive: 0, unknown: 1, 'weak-copyleft': 2, restricted: 3, 'strong-copyleft': 4, 'network-copyleft': 5 };

function categoryOfId(id) {
  for (const [re, c] of CATEGORY) if (re.test(id)) return c;
  return 'permissive';
}

const globRe = g => new RegExp('^' + String(g).trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

/**
 * Evaluates a normalised license (maybe an OR/AND expression) against the policy.
 * policy: { problematic: [globs], review: [globs], allowed: [globs] }
 * -> { category, status: 'ok' | 'review' | 'problematic', matched }
 */
function classifyLicense(license, policy) {
  const prob = (policy.problematic || []).map(globRe);
  const rev = (policy.review || []).map(globRe);
  const allow = (policy.allowed || []).map(globRe);
  const judge = id => {
    const cat = categoryOfId(id);
    if (prob.some(r => r.test(id))) return { id, cat, status: 'problematic' };
    if (allow.length && !allow.some(r => r.test(id))) return { id, cat, status: 'problematic', notAllowed: true };
    if (rev.some(r => r.test(id))) return { id, cat, status: 'review' };
    return { id, cat, status: 'ok' };
  };
  const rank = { ok: 0, review: 1, problematic: 2 };
  // OR: the licensee may choose -> best option; AND: all apply -> worst option
  const orParts = license.split(/\s+OR\s+/);
  const options = orParts.map(part => {
    const ids = part.split(/\s+AND\s+/).map(p => p.split(/\s+WITH\s+/)[0].trim()).filter(Boolean);
    const judged = ids.map(judge);
    return judged.reduce((w, j) => (rank[j.status] > rank[w.status] || (rank[j.status] === rank[w.status] && CATEGORY_RANK[j.cat] > CATEGORY_RANK[w.cat]) ? j : w));
  });
  const best = options.reduce((b, o) => (rank[o.status] < rank[b.status] || (rank[o.status] === rank[b.status] && CATEGORY_RANK[o.cat] < CATEGORY_RANK[b.cat]) ? o : b));
  return { category: best.cat, status: best.status, matched: best.id, notAllowed: !!best.notAllowed };
}

module.exports = { normalizeLicense, sniffLicenseText, fromClassifiers, classifyLicense, categoryOfId };
