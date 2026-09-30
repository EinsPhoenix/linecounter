# Changelog

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
