#!/usr/bin/env node
'use strict';
/**
 * Line Counter MCP server (Model Context Protocol over stdio, JSON-RPC 2.0, no dependencies).
 * Gives LLM agents tools for the import graph, impact of changes, risk hotspots, vulnerabilities, licenses,
 * ownership, TODOs, architecture rules, quality gate and branch comparison of a project.
 *
 *   node bin/linecounter-mcp.js [--root FOLDER] [--offline] [--preset NAME]
 *
 * Claude Code:     claude mcp add linecounter -- node /path/to/linecounter/bin/linecounter-mcp.js --root /path/to/project
 * Claude Desktop:  { "mcpServers": { "linecounter": { "command": "node", "args": ["/path/to/bin/linecounter-mcp.js", "--root", "/path/to/project"] } } }
 */
const path = require('path');
const readline = require('readline');
const { listTools, callTool } = require('../src/mcp/tools');
const { analyze } = require('./linecounter.js');

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf('--' + name); return i < 0 ? def : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true; };
const root = path.resolve(flag('root', process.env.LINECOUNTER_ROOT || process.cwd()));
const offline = !!flag('offline', process.env.LINECOUNTER_OFFLINE === '1');
const preset = flag('preset', undefined);
const PROTOCOL = '2025-06-18';

let cache = null; // { data, at }
let running = null;
async function data(force) {
  if (cache && !force) return cache.data;
  if (!running) {
    running = analyze(root, { offline, preset: typeof preset === 'string' ? preset : undefined, quiet: true })
      .then(d => { cache = { data: d, at: Date.now() }; return d; })
      .finally(() => { running = null; });
  }
  return running;
}

const EXTRA = [
  { name: 'compare_branches', description: 'Compare the current branch (incl. uncommitted changes) with a base branch: ahead/behind, changed files, complexity delta, new or grown functions, new TODOs, new secrets, dependency changes.', inputSchema: { type: 'object', properties: { base: { type: 'string', description: 'base branch, default: origin/HEAD, main or master' } } } },
  { name: 'refresh_analysis', description: 'Re-run the analysis (after code changes). Other tools use a cached analysis.', inputSchema: { type: 'object', properties: {} } },
];

async function runTool(name, args) {
  if (name === 'refresh_analysis') { const d = await data(true); return { refreshed: true, files: d.totals.files, generated: new Date(d.generated).toISOString() }; }
  if (name === 'compare_branches') {
    const d = await data();
    const repo = (d.repos || [])[0];
    if (!repo) return { error: 'not a git repository' };
    const r = await require('../src/compare').compareBranches(repo.root, args.base);
    if (r.error) return r;
    const rel = p => path.relative(root, path.join(repo.root, p)).split(path.sep).join('/');
    return {
      base: r.base, head: r.head, ahead: r.ahead, behind: r.behind, totals: r.totals,
      complexity: { before: r.complexity.before, after: r.complexity.after, newOrGrown: [...r.complexity.newFunctions, ...r.complexity.grown].slice(0, 30).map(f => ({ name: f.name, path: rel(f.path), line: f.line, complexity: f.complexity, before: f.before })) },
      files: r.files.slice(0, 100).map(f => ({ path: rel(f.path), status: f.status, added: f.added, deleted: f.deleted, complexityBefore: f.cxBefore, complexityAfter: f.cxAfter })),
      newTodos: r.todos.map(t => ({ ...t, path: rel(t.path), abs: undefined })), newSecrets: r.secrets.map(s => ({ name: s.name, severity: s.severity, path: rel(s.path), line: s.line, preview: s.preview })),
      dependencyChanges: r.deps, commits: r.commits.slice(0, 30),
    };
  }
  return callTool(await data(), name, args);
}

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: params && params.protocolVersion ? params.protocolVersion : PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'linecounter', title: 'Line Counter – code statistics, dependencies & risk', version: require('../package.json').version },
      instructions: `Code analysis of ${root}. Start with project_overview. Before changing a file, call impact_of_change / file_dependencies; for risky areas use risk_hotspots; for dependency questions use vulnerabilities, licenses and dependency_usage. The first call analyzes the project (may take a while); call refresh_analysis after big changes.`,
    });
  }
  if (method === 'notifications/initialized' || (method && method.startsWith('notifications/'))) return; // notifications get no answer
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: [...listTools(), ...EXTRA] });
  if (method === 'tools/call') {
    try {
      const result = await runTool(params.name, params.arguments || {});
      let text = JSON.stringify(result, null, 1);
      if (text.length > 60000) text = text.slice(0, 60000) + '\n… (truncated – use a filter or limit)';
      return reply(id, { content: [{ type: 'text', text }], isError: !!(result && result.error) });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'parse error'); }
  handle(msg).catch(e => msg.id !== undefined && fail(msg.id, -32603, e.message));
});
// start analysing right away so the first tool call is fast
if (!flag('lazy', false)) data().catch(e => process.stderr.write(`[linecounter-mcp] analysis failed: ${e.message}\n`));
