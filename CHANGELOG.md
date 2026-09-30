# Changelog

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
