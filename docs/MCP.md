# MCP server for LLM agents

Line Counter ships a [Model Context Protocol](https://modelcontextprotocol.io) server (stdio, no extra dependencies).
LLM agents get the same analysis as the statistics page as **tools**, to understand a code base before changing it.

## Setup

- **VS Code** (1.101+, Copilot agent mode or other MCP clients in VS Code): the server is registered automatically, one per workspace folder ("Line Counter (folder)").
- **Claude Code:** run *Line Counter: Copy MCP Server Configuration* in VS Code, or
  ```bash
  claude mcp add linecounter -- node /path/to/linecounter/bin/linecounter-mcp.js --root /path/to/project
  ```
- **Claude Desktop / Cursor / other clients:**
  ```json
  { "mcpServers": { "linecounter": { "command": "node", "args": ["/path/to/linecounter/bin/linecounter-mcp.js", "--root", "/path/to/project"] } } }
  ```

Options: `--root FOLDER` (default: current directory), `--offline` (no OSV.dev / registry requests), `--preset NAME` (filter preset from `.linecounter/presets.json`, default: the active one). The server reads `.linecounter/settings.json` like the CLI.

The analysis starts when the server starts and is cached. `refresh_analysis` runs it again.

## Tools

| Tool | What the agent gets |
|---|---|
| `project_overview` | size, languages, health grade, quality gate, vulnerabilities, licenses, cycles, git – the starting point |
| `file_dependencies` | imports, importers, libraries, transitive counts, circular import of one file |
| `impact_of_change` | every file that may break when a file changes (by distance), including affected tests |
| `circular_imports` | all import cycles with a concrete path |
| `dependency_chains` | longest chains, most imported / importing files, biggest blast radius |
| `risk_hotspots` | files most likely to break: git churn × complexity, risk 0–100 |
| `frequently_changed_files` | files with the most commits |
| `complex_functions` | functions by cyclomatic complexity (filter by path / threshold) |
| `find_function` | definition (file:line) plus callers and callees of a function |
| `vulnerabilities` | OSV.dev advisories with severity, CVSS, fixed versions and declaration in the manifest |
| `licenses` | license of every package with category, policy status and what was checked for unknown ones |
| `dependency_usage` | unused and undeclared packages per manifest |
| `secrets` | hard-coded secrets (masked) |
| `code_owners` | main authors, bus factor, stale files, knowledge at risk |
| `todos` | TODO / FIXME / HACK with author and age |
| `todo_pinboard` | the team's TODO priorities from `.linecounter/pinboard.json` (column + rank, current file and line) |
| `architecture_violations` | imports that break `architecture.rules` / `architecture.layers` |
| `unused_functions` | dead code candidates |
| `duplicate_code` | duplicated blocks with both locations |
| `quality_gate` | the same pass / fail checks as CI |
| `compare_branches` | current branch vs. base: files, complexity delta, new TODOs / secrets / dependencies |
| `refresh_analysis` | re-run after changes |

All paths are relative to the root and results are compact JSON (long lists are truncated – use the filters / `limit`).
