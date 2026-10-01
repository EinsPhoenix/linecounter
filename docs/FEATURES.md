# LOComotive – Features in Detail

This page describes **what each feature does, what you can expect and where the limits are**. A summary is in the [README](../README.md).

---

## Contents

1. [Language Support](#language-support)
2. [Sidebar, Filters and Presets](#sidebar-filters-and-presets)
3. [Statistics Page](#statistics-page)
4. [Trends](#trends)
5. [Architecture](#architecture)
6. [Branch Comparison](#branch-comparison)
7. [TODO Tracker](#todo-tracker)
8. [Ownership (Git)](#ownership-git)
9. [Code Health](#code-health)
10. [Dependencies, Licenses and Vulnerabilities](#dependencies-licenses-and-vulnerabilities)
11. [Graphs (2D)](#graphs-2d)
12. [Dependency Express (3D Train)](#dependency-express-3d-train)
13. [Quality Gate (CI)](#quality-gate-ci)
14. [MCP Server for LLM Agents](#mcp-server-for-llm-agents)
15. [Exports and PDFs](#exports-and-pdfs)
16. [What the Extension Does Not Do](#what-the-extension-does-not-do)

---

## Language Support

**Line counting** (code, comment and blank lines) works for 74 languages and file types, including JavaScript, TypeScript, Python, Java, Kotlin, C, C++, C#, Go, Rust, Swift, PHP, Ruby, Lua, Dart, SQL, Shell, HTML, CSS, YAML, JSON, Markdown and Dockerfile.

The deeper analyses vary by language:

| Language | Import graph | Functions & complexity | Cross-function calls | Packages, licenses, vulnerabilities |
|---|---|---|---|---|
| JavaScript / TypeScript / JSX / TSX / Vue / Svelte | ✅ relative paths, `tsconfig`/`jsconfig` `paths` + `baseUrl`, Vite/Webpack aliases, `@/` convention | ✅ functions, arrow functions, methods, generics, `useCallback`/`memo` wrappers | ✅ incl. JSX (`<Component />`) | ✅ npm (`package.json`, lockfiles from npm, pnpm and yarn, workspaces) |
| Python | ✅ absolute and relative imports | ✅ `def`, `async def` | ✅ | ✅ PyPI (`requirements*.txt`, `pyproject.toml` (PEP 621, Poetry, uv, PDM), `Pipfile`, `setup.py`, `setup.cfg`) |
| Rust | ✅ `mod x;`, `use crate::…`, `use super::…`, `use self::…` | ✅ `fn` | ✅ | ✅ crates.io (`Cargo.toml`, `Cargo.lock`) |
| Go | ✅ package imports via the module path from `go.mod` | ✅ `func`, methods | ✅ | ✅ Go modules (`go.mod`, `go.sum`) |
| Java, Kotlin, Scala, C#, C, C++, Swift, PHP, Ruby, Lua, Dart | C/C++: `#include "…"`, others – | ✅ | ✅ (name matching within the same file) | – |
| CSS / SCSS / Less, HTML | ✅ `@import`, `@use`, `<script src>`, `<link href>` | – | – | – |

**What to expect:** The analysis uses robust patterns, not a full compiler. For typical code this is very accurate. With exotic syntax (macros, generated code, heavily nested template literals) a function may occasionally be missed or a boundary may shift slightly.

---

## Sidebar, Filters and Presets

<img src="images/sidebar.png" alt="Sidebar" width="340">

- **Tree of all files and folders.** Click to exclude or re-include a file or folder.
- **Search.** Filters the tree live.
- **Predefined filters.** Exclude typical folders like `node_modules`, `venv`, `.git`, build folders and caches.
- **`.gitignore`** is optionally respected.
- **File extensions.** All detected extensions can be individually shown or hidden.
- **Custom filters.**
  - Under *Predefined filters → My filters* you create custom filters: a pattern (or multiple, comma-separated) and an optional name, e.g. `*/data`, `*.generated.ts` or `docs/`.
  - `*/data` or `**/data` matches any folder named `data` at any depth.
  - Each filter is its own checkbox, is saved in presets and stored in `.locomotive/filters.json` so the team can share it.
  - From a sidebar search you can create a filter directly with *Save as filter*.
  - Filters from the `locomotive.customFilters` setting (`[{ "label": "…", "patterns": ["…"] }]`) also appear.
- **Project root.** If your actual projects live deeper than the folder opened in VS Code (e.g. `Graphoenix` is open, the projects are in `Graphoenix/facgraph/…`), click the target icon on a folder. Then:
  - The tree shows only that folder.
  - Statistics count only its files.
  - All paths, folder charts, folder colors, clusters and planets are relative to it. Subfolders become their own groups instead of everything being lumped under `facgraph/`.
  - The *Project root* bar shows the path; ↑ goes one level up, ✕ analyzes the whole workspace again.
  - The root is saved per workspace and in presets.
  - Git repos are still detected, even when they are higher up.
- **Presets.** Save excluded files, filters and extensions as a named preset in `.locomotive/presets.json`. The file can be committed so the whole team uses the same settings.
- **Libraries as graph nodes.** External packages then appear in the graph and in the 3D train. They are not counted in statistics.

---

## Statistics Page

![Statistics page](images/overview.png)

![Languages](images/languages.png)

![Treemap](images/treemap.png)

![Project roast](images/roast.png)

The page opens maximized or in full screen. Every chart has its own full-screen button.

| Section | What you get |
|---|---|
| Overview | Lines, code, comments, blank lines, files, folders, size |
| Languages | Shares per language and extension |
| Files | Treemap of all files, grouped by folder. Click copies the path; the context menu opens or deletes the file. |
| Hall of Fame | 18 categories (longest file, longest line, most TODOs …) with podium and roast |
| Dependencies | See [below](#dependencies-licenses-and-vulnerabilities) |
| Code health | See [below](#code-health) |
| Code Rant | Rant-o-Meter, rants about long files, too many blank lines, commit messages, dependencies and code health |
| Git | Commits, authors, heatmap, hotspots, bus factor; repos are detected automatically. With multiple repos: overview table (branch, commits, authors, last commit, 12-month activity, bus factor, inactive repos greyed out, sortable), combined commit chart, repo switcher for details and a repo filter in the ranking |
| Fun facts | Printed pages, typing time, COCOMO, coffee … |
| Words & connections | Word cloud, Word Web and import graph |
| Ranking | Sortable table of all files; click opens the file |
| Structure | Folders and files as a graph; folders expand and collapse |

All thresholds (e.g. how many lines make a file "too long") are in the settings or in `.locomotive/settings.json`.

---

## Trends

- **Snapshot per run.** Each run saves the metrics per workspace or project root: lines, functions, complexity, health score, duplicates, unused functions, TODOs, vulnerabilities, license issues, secrets, cycles and commits.
- **"Since the last run".** Shows the changes since the last run. Green means better, red means worse.
- **Curves.** For every metric that changed there is a trend curve.
- **Merging.** Runs within 10 minutes are merged.
- **Storage.** Stored locally in the workspace state (`locomotive.history.enabled`). With `locomotive.history.saveToFile` the history is also saved to `.locomotive/history.json` and can be shared with the team. *Clear history* resets it.

## Architecture

![Architecture rules](images/architecture.png)

- **Rules** in `.locomotive/settings.json` or VS Code settings:
  ```jsonc
  "architecture.rules": [
    { "name": "UI never talks to the database", "from": "src/ui/**", "disallow": ["src/db/**"], "allow": ["src/db/types.ts"] },
    { "from": "src/core/**", "disallow": ["src/plugins/**"], "severity": "warning" }
  ],
  "architecture.layers": [
    { "name": "ui", "pattern": "src/ui/**" }, { "name": "services", "pattern": "src/services/**" }, { "name": "db", "pattern": "src/db/**" }
  ]
  ```
- **`rules`:** Files matching `from` must not import anything matching `disallow`. Exceptions go in `allow`.
- **`layers`:** Layers are ordered top to bottom. A layer may only import layers below it.
- **Checked** against every actual import (JS/TS with aliases, Python, Rust, Go, C/C++, CSS). Paths are relative to the project root.
- **Display.**
  - The *Architecture* section shows violations per rule; clicking a rule filters the list.
  - *Show in import graph* highlights the violating edges in pink-red.
  - Violations generate a rant and can fail the quality gate.

## Branch Comparison

- **Automatic.** When you are not on the base branch, the statistics page compares the current state (HEAD plus uncommitted changes) with the merge base of the base branch. The base is determined automatically (`origin/HEAD`, `main`, `master` or `develop`) or set explicitly via `locomotive.compare.baseBranch`.
- **Manual.** Any other branch can be selected, then *Compare*.
- **What you see.**
  - Commits ahead and behind, changed files with ± lines and complexity before and after per file.
  - New and more complex functions.
  - New TODOs and **new secrets** in the added lines.
  - Changed dependencies from `package.json`, `requirements`, `pyproject.toml`, `Cargo.toml` and `go.mod`.
  - The branch's commits with authors.
- **Disable:** `locomotive.compare.enabled`.

## TODO Tracker

- **What is found.** Every comment with `TODO`, `FIXME`, `HACK`, `XXX` or `BUG`. An assignment like `TODO(alice):` is shown as `@alice`.
- **Age and author.** Come from `git blame` of the respective line. Uncommitted lines are marked "new".
- **Display.**
  - Metrics: count, oldest TODO, average age.
  - Charts: age, tag, author.
  - Table: oldest first, filterable by tag and text; clicking jumps to the line.
- **Disable:** `locomotive.todos.enabled`.

### Pinboard – TODOs by Priority

![Pinboard](images/pinboard.png)

At the top of the TODO section on the statistics page there is a pinboard with the columns **High**, **Medium** and **Low**. The most important item is at the top of each column.

- **Sorting.** On the right are all TODOs from the code that are not yet on the board ("Unsorted from the code", filterable). Drag & drop them into a column or click **H / M / L**.
- **Reorder.** Move cards via drag & drop or the arrow buttons: ▲ ▼ changes the order, ◀ ▶ changes the column. ✕ removes a TODO from the board (back to "Unsorted") or deletes a note.
- **Jump to code.** Every code card shows `file:line`; clicking opens the file at that exact line.
- **Notes.** Use "+ Note" to create tasks that are not in the code.
- **Stored in `.locomotive/pinboard.json`** in the workspace, immediately after every change. The file can be committed so the team shares the same priorities.
- **Robust against code changes.** Cards are identified by file, tag and text, not by line number. If a TODO moves down, the card shows the new line. If the comment is gone, the card is struck through ("Not in the code anymore – done?") and can be removed.
- **For LLM agents.** The MCP tool `todo_pinboard` provides the priorities so an agent knows what to work on next.

File structure:

```json
{
  "columns": [{ "id": "high", "title": "High" }, { "id": "medium", "title": "Medium" }, { "id": "low", "title": "Low" }],
  "cards": [
    { "id": "todo-…", "column": "high", "kind": "code", "path": "src/parser.js", "tag": "TODO", "text": "handle empty input", "line": 42 },
    { "id": "note-…", "column": "low", "kind": "note", "text": "Write release notes" }
  ]
}
```

The columns can be renamed or extended in the file (e.g. "Next sprint").

## Ownership (Git)

![Who owns the code](images/ownership.png)

![Knowledge at risk](images/knowledge-at-risk.png)

![When code is written](images/commit-heatmap.png)

![Commits per month](images/commits-per-month.png)

![Git fun facts](images/git-fun-facts.png)

- **Who owns the code.** The main author of each file is whoever has the most commits on it. Duplicate names in different cases are merged, bots (dependabot, renovate …) are ignored. This gives the total lines per person.
- **Ownership per folder.** A colored bar shows the author shares plus the bus factor (how many people wrote half the code). Folders with a bus factor of 1 are red.
- **Stale files.** Files with no commit in `locomotive.ownership.staleDays` days (default 365). Are they still needed?
- **Knowledge at risk.** Files where at least 60 % was written by someone who has not committed in over 6 months.
- **Age of last change** per file as a chart, plus rants.

## Code Health

![Complexity per function](images/complexity.png)

![Risk hotspots](images/risk-hotspots.png)

- **Grade A–F and score 0–100.**
  - Deductions for overly complex functions, overly long functions, duplicated code and secrets.
  - The grade is a trend indicator, not a quality judgment of an individual project.
- **Cyclomatic complexity per function.**
  - Counted as 1 + branches (`if`, `for`, `while`, `case`, `catch`, `&&`, `||`, `?:`, `??`).
  - Nested functions are measured separately and are not double-counted.
  - The threshold is configurable: `locomotive.health.maxComplexity`, default 15.
- **Long functions.**
  - Threshold: `locomotive.health.maxFunctionLines`, default 80.
  - Functions with 6 or more parameters are also listed.
- **Hotspots.** Files with the highest total complexity. Clicking opens the file; clicking a function jumps directly to the line.
- **Risk hotspots (churn × complexity).**
  - A scatter plot shows how often a file was changed in git (x) and how complex it is (y); the dot size represents file length.
  - Files in the top right are the most likely to contain the next bug.
  - Score 0–100, clicking opens the file. Requires a git repo with history.
- **Possibly unused functions.**
  - Reported are standalone functions whose name does not appear anywhere else in the analyzed code.
  - Excluded are methods and object properties (often called by frameworks), functions with a decorator or annotation (route handlers, `@Override`), tests and known entry points (`main`, `activate`, lifecycle hooks).
  - Exported functions are flagged because they may be public API of a library.
- **Duplicated code.**
  - Found are blocks of 6 or more identical lines; whitespace and comments are ignored and trivial lines are skipped.
  - Both locations are clickable.
  - Renamed variables are not detected as duplicates; this is intentional to avoid false positives.
- **Secrets scanner.**
  - Detected are AWS, GitHub, GitLab, Slack, Stripe, Google, OpenAI, Anthropic, npm, SendGrid and Twilio keys, private keys, JWTs, connection strings with passwords and hard-coded passwords.
  - For passwords the scanner checks entropy so placeholders like `changeme` are not flagged.
  - Values are **always masked**.
  - Test and example files are excluded via `locomotive.secrets.ignore`.
- **PDFs:** Code health report and secrets report.

---

## Dependencies, Licenses and Vulnerabilities

![License overview](images/licenses.png)

- **Ecosystems:** npm, PyPI, crates.io (Rust), Go modules. Direct and transitive packages are captured; versions come from lockfiles or installed packages.
- **Licenses of all packages.** For every package with an unknown or non-standard license a chain of sources is checked. Each attempt is logged and shown in the *Unknown & custom licenses* card.
  1. Local metadata: `node_modules`, `site-packages` (METADATA, classifiers, License-Expression), Cargo cache, Go module cache, LICENSE files
  2. Registry: registry.npmjs.org, pypi.org, crates.io, proxy.golang.org
  3. The **package archive itself** (`.tgz`, wheel, sdist, `.crate`, Go `.zip`): LICENSE, COPYING and NOTICE texts and the license fields inside
  4. deps.dev (Open Source Insights by Google)
  5. The GitHub license of the repository
- **When a package stays "Unknown":** Only when no source provides anything, e.g. private packages or a typo in the name (registry returns 404). "Custom" means: there is a license text but no standard license. Both require manual review.
- **License policy.** What counts as problematic or needs review is configured in `locomotive.licenses.problematic`, `.review` and `.allowed` (globs like `GPL*`). For `MIT OR GPL` the best option counts, for `AND` the worst.
- **Vulnerabilities.** Queried via OSV.dev for all four ecosystems, with CVSS score, advisory link and the version that fixes the issue.
- **Dependency hygiene.**
  - Declared but never imported packages: clicking jumps to the line in the manifest.
  - Imported but undeclared packages: with a list of the files that use them.
  - CLI tools (pytest, ruff, …) and plugins in configs are taken into account.
- **Network.** Online queries can be disabled (`locomotive.licenses.fetchFromRegistry`, `locomotive.vulnerabilities.enabled`). Only local information is used then.

---

## Graphs (2D)

![Import graph](images/import-graph.png)

![Folders and files as a graph](images/structure-graph.png)

- **Word Web.** The most frequent identifiers and the files that use them.
- **Import graph.** Who imports whom.
  - Circular imports are red; the longest chains are highlighted.
  - Clicking a file shows all dependencies (amber) and all dependents (red).
  - **Color: Folder or Language.** With *Folder*, files in the same folder share a color; functions take the color of their file.
  - **Cluster folders.** Files group by folder into labeled bubbles without overlap. Cross-folder edges barely pull anymore. Double clicking into a bubble zooms in.
  - **ƒ Functions.** Functions become diamond nodes. They are connected to their file and to the functions they call; calls only count along actual imports, keeping the mapping reliable.
  - **Search.** As you type, all matches (files and functions) are highlighted, the view zooms in, and Enter selects the match.
- **Structure.** Folders and files as a graph. The search automatically expands folders containing matches.
- **Zoom.**
  - Mouse wheel and touchpad zoom smoothly toward the pointer; pinch zoom is faster.
  - Bottom right there are **+ / − / ⤢** and the current zoom level.
  - Keyboard over the graph: **+**, **−** and **0** (fit all).
  - Double click on empty space zooms in; Shift + double click zooms out.
  - The zoom range is 2 % to 4000 %.
- **Large graphs.**
  - Limits are configurable: `locomotive.graphs.maxNodes` (default **20,000**) and `locomotive.graphs.maxLinks` (default **40,000**). Cycles are always shown.
  - Above about 2,500 nodes only the visible area is drawn; labels appear when zooming in; above 4,000 nodes the layout is computed once instead of animated. A test with 20,000 nodes and 40,000 relationships ran smoothly.
  - The 3D train has its own limits because the 3D layout grows quadratically and every rail costs GPU memory:
    - `locomotive.train.maxNodes`: planets, default **800**. The most connected files are kept.
    - `locomotive.train.maxLinks`: relationships as rails, default **2,400**. Priority goes to cycles, dependency chains and relationships to vulnerable libraries, then the most connected ones.
    - `locomotive.train.detail`: `auto` (default; above 300 planets or 900 relationships coarser rails, planets and turntables), `high` (always full detail) or `low` (always reduced, for weak GPUs).
  - If the 3D view stays grey or is slow, lower `train.maxLinks` / `train.maxNodes` or set `train.detail` to `low`.
- **Motion.** *Wiggle*, *Calm* or *Still*, configurable via `locomotive.graphs.motion`.

---

## Dependency Express (3D Train)

![Dependency Express](images/train-3d.png)

A train rides through your project as a universe.

- **World.**
  - Files are planets. **Planets in the same folder share the same color**; the legend bottom left shows the folders.
  - Libraries are metal cubes, vulnerable packages are skulls.
  - Functions are crystals in the color of their file.
- **Rails.**
  - Every relationship is a glossy maglev guideway with neon edges in which light flows.
  - The rails run **over** the planets; at the pole they cross on a turntable.
  - Cycles are red, function calls are light amber.
- **Train.**
  - A streamlined locomotive in chrome and clearcoat with a canopy cockpit, light strips, fin, winglets and twin thrusters; plus passenger pods with window strips.
  - The train hovers slightly. When turning it lifts off and rotates with all cars.
- **Driven trail.**
  - Every driven relationship and every switch path is marked **green**. The more often you drive a section, the **thicker** the line.
  - The *Trail* button shows how many relationships you have driven and clears the trail.
- **Modes.**
  - **Chain:** follows chains, loops (cycles), the longest call chain or a Grand Tour.
  - **Free roam:** W drives; at junctions you pick with A/D. With *Auto-choose* on, the train takes the straightest continuation without stopping.
  - **Fly:** The train leaves the rails. W/S control thrust and brake, A/D steer, Q/E climb and dive, R snaps back on.
- **Auto-pilot.** Drives at constant speed. The dwell time per planet is 0 to 5 seconds; at 0 the train drives through without braking.
- **Cameras.**
  - **Chase:** follows the train from behind.
  - **Cab:** cockpit; the camera rotates with the train.
  - **Free cam:** free in space.
- **Keys** can be changed via `locomotive.train.keys`.

**Performance:** For very large projects (several hundred nodes with functions) the setup takes one to two seconds. Use `locomotive.graphs.maxFunctions` to limit the number of functions.

---

## Quality Gate (CI)

- **Checks:** critical vulnerabilities, secrets, problematic (optionally also unknown) licenses and architecture violations. Optionally also maximum complexity, minimum health score, duplicate share and circular imports. What counts is configured in `locomotive.gate`.
- **Statistics page:** shows the result at the very top.
- **In VS Code:** *LOComotive: Run Quality Gate* reports the result.
- **In CI:** `node bin/locomotive.js gate .` fails with exit code 1. Details and a GitHub Actions example are in [CI.md](CI.md).

## MCP Server for LLM Agents

- **Purpose.** The extension provides an MCP server. Agents like Copilot, Claude Code or Claude Desktop get the analysis as tools:
  - What breaks if I change this file?
  - Risk hotspots and frequently changed files
  - Vulnerabilities, licenses, unused packages
  - Cycles, functions and their callers, ownership, TODOs, architecture violations, quality gate and branch comparison
- **In VS Code** (version 1.101+) the server is registered automatically.
- **For other clients** *LOComotive: Copy MCP Server Configuration* copies the configuration.
- **Details** and the tool list are in [MCP.md](MCP.md).

## Exports and PDFs

| Export | Content |
|---|---|
| PDF | Freely selectable sections of the statistics page, A4 or Letter, light or dark, with cover page |
| License PDF | Policy, licenses in use, Unknown/Custom with audit trail, all packages |
| Vulnerability PDF | Affected packages with target version, all advisories |
| Code health PDF | Complexity, long functions, hotspots, duplicates |
| Secrets PDF | Findings by severity and type, masked, with recommendations |
| HTML | Interactive report for any browser |
| CSV / JSON | Raw data |

---

## What the Extension Does Not Do

- It **does not modify code** and **does not install packages**. Only deleting a file via the treemap context menu changes anything, and only after a confirmation via the trash.
- It **does not replace legal advice**. The license report shows what the packages declare.
- The secrets scanner does not replace a dedicated CI scanner, but catches the typical mistakes early.
- Only queries to package registries, OSV.dev, deps.dev and GitHub go online. Code never leaves your machine.
