'use strict';

const fs = require('fs');
const path = require('path');

/**
 * TODO pinboard: TODOs ordered by priority, stored in `.linecounter/pinboard.json` so the team shares the order.
 *
 *   {
 *     "columns": [{ "id": "high", "title": "High" }, …],          // priority columns, top to bottom = most important first
 *     "cards": [
 *       { "id": "…", "column": "high", "kind": "code", "path": "src/a.js", "tag": "TODO", "text": "…", "line": 12 },
 *       { "id": "…", "column": "low",  "kind": "note", "text": "Write release notes" }
 *     ]
 *   }
 *
 * Code cards are matched to the TODO comments by file + tag + text (line numbers move when code changes; the stored
 * line is only a hint to tell identical comments apart). A card whose comment is gone is reported as `gone` (done?).
 */
const DIR = '.linecounter';
const FILE = 'pinboard.json';
const DEFAULT_COLUMNS = [
  { id: 'high', title: 'High' },
  { id: 'medium', title: 'Medium' },
  { id: 'low', title: 'Low' },
];

const norm = p => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
const normText = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const keyOf = (p, tag, text) => `${norm(p)}|${String(tag || '').toUpperCase()}|${normText(text)}`;

function filePath(root) { return root ? path.join(root, DIR, FILE) : null; }

/** normalized board (never throws; a missing or broken file gives an empty board) */
function load(root) {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(filePath(root), 'utf8')); } catch { /* no board yet */ }
  return sanitize(raw);
}

function sanitize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const columns = Array.isArray(src.columns) && src.columns.length
    ? src.columns.filter(c => c && c.id).map(c => ({ id: String(c.id), title: String(c.title || c.id) }))
    : DEFAULT_COLUMNS.map(c => ({ ...c }));
  const ids = new Set(columns.map(c => c.id));
  const seen = new Set();
  const cards = [];
  for (const c of Array.isArray(src.cards) ? src.cards : []) {
    if (!c || typeof c !== 'object') continue;
    const kind = c.kind === 'note' ? 'note' : 'code';
    if (kind === 'code' && !c.path) continue;
    if (kind === 'note' && !String(c.text || '').trim()) continue;
    let id = String(c.id || '') || `${kind}-${cards.length}-${Math.random().toString(36).slice(2, 8)}`;
    if (seen.has(id)) id += '-' + cards.length;
    seen.add(id);
    const card = { id, column: ids.has(c.column) ? String(c.column) : columns[0].id, kind, text: String(c.text || '').slice(0, 2000) };
    if (kind === 'code') { card.path = norm(c.path); card.tag = String(c.tag || 'TODO').toUpperCase(); if (Number.isFinite(+c.line) && +c.line > 0) card.line = Math.round(+c.line); }
    if (c.note) card.note = String(c.note).slice(0, 2000);
    cards.push(card);
  }
  return { columns, cards };
}

async function save(root, board) {
  const p = filePath(root);
  if (!p) throw new Error('Open a folder first – the pinboard is stored in .linecounter/pinboard.json');
  const clean = sanitize(board);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  return clean;
}

/**
 * Board + current TODO comments → cards with their current location.
 * todos: items of the TODO tracker ({ tag, text, path, abs, line, … }); root: folder that holds .linecounter.
 * Every TODO item gets `pin` (its path relative to root) so the page can pin it.
 */
function resolve(board, todos, root) {
  const items = (todos && todos.items) || [];
  const rel = abs => (root ? norm(path.relative(root, abs)) : norm(abs));
  const byKey = new Map();
  for (const t of items) {
    t.pin = rel(t.abs);
    delete t.pinnedBy;
    const k = keyOf(t.pin, t.tag, t.text);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const used = new Set();
  const cards = board.cards.map(c => {
    if (c.kind !== 'code') return { ...c, state: 'note' };
    const cand = (byKey.get(keyOf(c.path, c.tag, c.text)) || []).filter(t => !used.has(t));
    // identical comments in one file: take the one closest to the stored line
    cand.sort((a, b) => Math.abs(a.line - (c.line || 0)) - Math.abs(b.line - (c.line || 0)));
    const t = cand[0];
    if (!t) return { ...c, state: 'gone', abs: root ? path.join(root, c.path) : c.path };
    used.add(t);
    t.pinnedBy = c.id;
    return { ...c, state: 'open', line: t.line, abs: t.abs, author: t.author, ageDays: t.ageDays, assignee: t.assignee };
  });
  return { file: root ? `${DIR}/${FILE}` : null, columns: board.columns, cards, pinnedCount: used.size };
}

/** ordered list for agents / reports: column by column, top to bottom */
function prioritized(resolved) {
  const out = [];
  for (const col of resolved.columns) {
    let rank = 0;
    for (const c of resolved.cards) if (c.column === col.id) out.push({ priority: col.title, rank: ++rank, ...c });
  }
  return out;
}

module.exports = { load, save, sanitize, resolve, prioritized, keyOf, DEFAULT_COLUMNS, FILE };
