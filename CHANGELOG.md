# Changelog

## 2.0.2
- README, FEATURES.md and all documentation translated to English
- Updated description to comprehensively cover all features (MCP server, vulnerability scanner, secrets detection, code health, quality gate for CI)

## 2.0.1
- README: PayPal donation button

## 2.0.0
- **New name: LOComotive – Code Statistics, Lines of Code & Complexity** (formerly "Line Counter"). New extension id `einsphoenix.locomotive`; settings and commands are now `locomotive.*`, the project folder is `.locomotive/`, the CLI `bin/locomotive.js`, the MCP server `bin/locomotive-mcp.js` (`LOCOMOTIVE_ROOT`)
- Migration: an existing `.linecounter/` folder is still used as long as there is no `.locomotive/`; `linecounter.*` keys in that folder and in the VS Code settings are still read when the new key is not set
- Release files are now `locomotive-<version>.vsix` / `locomotive.vsix`

## 1.15.2
- New display name "Code Statistics – Lines of Code, Complexity & Git Insights" and a description and tags that are found when searching for code, statistics, lines, LOC, complexity … (the extension id `linecounter`, settings and commands stay the same)

## 1.15.1
- Packaging: declares `@types/vscode` 1.74.0 (matching `engines.vscode`) – the Marketplace analysis failed with "Value cannot be null. Parameter name: v1" without it

## 1.15.0
- TODO pinboard: order TODOs by priority (High / Medium / Low columns) with drag & drop or arrow buttons, pin TODOs from the code, add notes; every code card links to its file and line
- Stored in `.linecounter/pinboard.json` (shareable via git); cards follow their comment when lines move, and are marked "done?" when the comment is gone
- MCP tool `todo_pinboard`: the team's priorities for LLM agents

## 1.14.6
- 3D train: new settings `linecounter.train.maxLinks` (relations drawn as rails, default 2400) and `linecounter.train.detail` (`auto` / `high` / `low` level of detail)

## 1.14.5
- 3D train: fixed the grey screen on big projects – hubs such as libraries imported by hundreds of files made the 3D layout explode to infinite coordinates, and the rail sampling then used up all memory of the webview
- 3D train: level of detail for big universes (coarser rails, planets and turntables; at most 3 relations per node on average are drawn as rails), about 3× fewer triangles
- 3D train: errors and a lost GPU context are now shown as a message instead of a dead view; only the first 6 vulnerable libraries get a real light

## 1.14.4
- Documentation with screenshots: README quick start and gallery, images in every FEATURES section, complete table of contents
- README badges work for the private repository and link to release, download, CI, changelog and license
- 3D train: the Exit button no longer overlaps the stops list

## 1.14.3
- Downloads as GitHub Releases (one per version with the `.vsix`, notes from this changelog), CI workflow (tests + packaging), README badges and download section, MIT license
- CI docs download the vsix from the latest release

## 1.14.2
- README: overview table of all features with links to FEATURES, CI and MCP docs

## 1.14.1
- Many git repositories: overview table (branch, commits, authors, last commit, 12-month activity, files, bus factor; sortable, inactive repos greyed out), combined commits-per-month chart, repository switcher instead of one long page, repository tag + filter in the file ranking, unique names for repos with the same folder name

## 1.14.0
- Graphs: zoom around the mouse pointer, zoom controls (+ / − / fit / level), smooth wheel and pinch, keyboard +/−/0, double-click zoom; limits configurable (`graphs.maxNodes` 20000 / `graphs.maxLinks` 40000, `train.maxNodes` 800) with fast rendering of huge graphs
- Own filters (e.g. `*/data`) as sidebar checkboxes, stored in `.linecounter/filters.json` and in presets; "Save as filter" from a search
- Architecture rules (`architecture.rules` / `architecture.layers`) with a violations section and red edges in the import graph
- Quality gate for CI: `node bin/linecounter.js gate` (exit code 1), VS Code command, gate card on the statistics page, docs/CI.md
- Code ownership from git: owners, bus factor per folder, stale files, knowledge at risk
- TODO tracker with author and age from git blame
- Branch comparison: current branch vs. base (files, complexity delta, new functions, TODOs, secrets, dependency changes)
- MCP server for LLM agents (21 tools: impact of change, risk hotspots, vulnerabilities, licenses, ownership, …), registered in VS Code, docs/MCP.md

## 1.13.0
- Trends: every run stores a snapshot (per workspace / project root); "since the last run" deltas and trend charts for lines, functions, complexity, health score, duplicates, unused functions, TODOs, vulnerabilities, licenses, secrets, cycles; optional shared `.linecounter/history.json`
- Risk hotspots: git churn × complexity scatter with a "refactor first" zone and a risk score per file
- Possibly unused functions (dead code) with exported / internal marking; methods, decorated handlers, tests and entry points are skipped
- both in the Code health PDF and in the rants

## 1.12.0
- Project root: pick any folder in the sidebar (target icon) as the root of the analysis – paths, folder charts, colors, clusters and planets are relative to it; stored per workspace and in presets
- 3D train: the streamlined body was mounted backwards – the nose now points forward and the headlights, nose ring and lamp sit on the hull instead of floating in front of it

## 1.11.1
- Rust: functions named like keywords of other languages (e.g. `new`) are recognised again
- docs/FEATURES.md: every feature explained – what it does, what to expect, limits and the language support matrix

## 1.11.0
- Licenses of all packages: thorough lookup (registry, LICENSE files inside the package archive, deps.dev, GitHub) with a trail of what was checked; new "Unknown & custom licenses" card and PDF section
- Rust (Cargo.toml / Cargo.lock) and Go (go.mod / go.sum): dependencies, licenses, vulnerabilities, unused crates / modules, import graph (mod, crate::, super::, Go packages)
- TypeScript / JavaScript: tsconfig / jsconfig paths, vite / webpack aliases and "@/" imports are resolved; functions with generics, multi-line parameters, useCallback / memo wrappers and JSX component calls are recognised
- Planets and graph nodes colored by folder (functions by file), folder legend in 3D
- 2D import graph: cluster folders into bubbles (double-click to zoom in), color by folder or language, live search; search fields for all graphs
- 3D: glossy maglev guideways with flowing neon edges, streamlined chrome train with canopy, fins and twin thrusters, reflections
- Driven trail: relations you already drove are marked in green, thicker the more often you drove them

## 1.10.0
- Code health section: cyclomatic complexity per function, long functions, too many parameters, hotspot files, duplicated code, grade A–F with rants
- Secrets scanner (cloud / VCS / payment / AI API keys, private keys, JWTs, connection strings, hard-coded passwords) with masked output
- Code health PDF and Secrets PDF
- Functions as graph nodes (toggle "ƒ Functions") in the import graph and in the 3D train, longest call chain route
- 3D train: tracks run over the planets and meet on turntables (no tunnels or rings), the train follows the planet surface, spacey maglev train
- Configurable train keys (`linecounter.train.keys`), Q/E climb and dive, R snaps back onto the rails
- Redesigned dependency section: license overview with category bar, dependency hygiene cards per manifest with expandable file lists

## 1.9.0
- Dependency scan: npm workspaces / monorepos, pnpm and yarn lockfiles, symlinked `node_modules`, licenses from the npm / PyPI registry when a package is not installed (`linecounter.licenses.fetchFromRegistry`)
- Robust import detection (comments and docstrings ignored, extras like `pydantic[email]` in pyproject), the project's own package is no longer listed
- Clickable dependency report: declarations jump to the line in package.json / requirements / pyproject, undeclared imports list the files that use them, charts filter the table
- 3D train: every relation is a permanent Bézier track through the planets with crossings and tunnel portals, smooth switches between relations, the train always drives nose first
- Turning around: the train hovers, spins 180° with all wagons and the camera, and lands on the track back
- Manual junctions need W released and pressed again; optional Auto-choose takes the straightest track
- Adjustable station stop (0–5 s, 0 = no stopping), faster and smoother driving, frame-rate independent camera
- Cab camera follows the train's rotation; planets spaced out without overlaps
- Fly mode: leave the rails and fly freely, E snaps back onto the nearest relation

## 1.8.0
- Toggle "Show libraries as graph nodes": external npm / PyPI packages appear in the import graph (not counted in any statistic), vulnerable ones as skulls
- 3D "Dependency Express" (three.js): files as planets, libraries as metal cubes, vulnerable packages as skulls, relations as lines
- Chain mode (ride chains / circular lines with stations) and free roam mode (W drive, A/D choose relation, S turn around), auto pilot with random routes and dead-end turnarounds
- Labels only for nearby / looked-at objects, chase / cab / free camera

## 1.7.0
- PDF export of the statistics page (choose sections, A4/Letter, dark or light printer-friendly theme, cover page with key numbers)
- Separate License report PDF and Vulnerability report PDF (searchable text tables)
- Standalone interactive HTML report (works in any browser, includes PDF export)

## 1.6.0
- Dependency, license and vulnerability report for npm and Python (new section on the statistics page)
- License report with SPDX normalisation, categories and a configurable policy (`linecounter.licenses.*`), CSV export
- Vulnerability report via OSV.dev with CVSS v3 scores, advisory links and fixed versions (`linecounter.vulnerabilities.*`)
- Unused and undeclared packages for npm and Python
- Dependency rants in the project roast

## 1.5.0
- Import graph: circular imports of any length (Tarjan SCC), always drawn in red; click a cycle to trace its path in red
- Longest dependency chains with path, click to trace in red, copy path
- Click a file: transitive dependents in red, dependencies in amber, counts for the whole project
- Blast radius list, file search, layered layout (importers on top), curved edges for mutual imports
- Motion modes wiggle / calm / still (setting `linecounter.graphs.motion`), dragged nodes stay in place when calm/still
- More rants: circles of trust, dependency Jenga, blast radius

## 1.4.0
- Filter presets: save / load / delete named presets (excluded files, hidden file types, predefined filters) in `.linecounter/presets.json`
- Workspace settings in `.linecounter/settings.json` override the VS Code settings (JSON schema, comments allowed, live reload)
- `linecounter.excludePatterns`: custom .gitignore-style glob patterns as a predefined filter
- `linecounter.defaultFilters`: predefined filters enabled in new workspaces
- Code split into modules (config, sidebar provider, statistics, util)
- Versioned releases in `releases/`, git tags per version

## 1.3.0
- Canvas treemap grouped by folder, shows every file (no "other" block)
- Animated word web, import graph and project structure graph (d3)
- Commit message rant, project roast, Hall of Fame roasts

## 1.2.0
- Hall of Fame with podiums and 18 categories, Code Rant with rant-o-meter, severity levels and bonus rants

## 1.1.0
- Dark orange / gray theme, SVG icons, chart full screen, copy path / delete files, Code Rant

## 1.0.0
- Initial release: file tree with filters, full-screen statistics, git insights, fun facts, file ranking
