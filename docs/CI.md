# Quality gate in CI

The extension ships a command line tool that runs the **same analysis** as the statistics page and fails the build
when a check of `linecounter.gate` fails.

```bash
node bin/linecounter.js gate [folder] [--preset NAME] [--json gate.json] [--markdown gate.md] [--offline] [--quiet]
node bin/linecounter.js report [folder] --json data.json      # the full data model (all statistics) as JSON
```

- **Exit codes:** `0` = passed, `1` = a check failed, `2` = error.
- **Settings** come from `<folder>/.linecounter/settings.json` plus the defaults. Filters come from the active preset in `.linecounter/presets.json` (or `--preset NAME`), including its exclusions and project root, and from `.linecounter/filters.json`.
- **`--offline`** skips OSV.dev and the registries (no network).
- **GitHub Actions:** the Markdown summary is appended to `$GITHUB_STEP_SUMMARY` automatically.

## Configuration

```jsonc
// .linecounter/settings.json
{
  "gate": {
    "vulnerabilities": "critical",   // critical | high | medium | low | off
    "secrets": "high",               // critical | high | medium | off
    "problematicLicenses": true,     // uses licenses.problematic / licenses.allowed
    "unknownLicenses": false,
    "architecture": "error",         // error | warning | off (architecture.rules / architecture.layers)
    "maxComplexity": 40,             // optional
    "minHealthScore": 60,            // optional
    "maxDuplicatedPercent": 10,      // optional
    "circularImports": false
  }
}
```

## GitHub Actions example

The CLI is part of the extension package. `linecounter.vsix` is a zip file, so the CI can unpack it:

```yaml
name: quality-gate
on: [push, pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # full history for churn / ownership statistics
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Get Line Counter
        run: |
          # adjust the branch / tag to the one that holds the linecounter.vsix you want
          curl -sSL -o lc.vsix https://raw.githubusercontent.com/EinsPhoenix/linecounter/main/linecounter.vsix
          unzip -q lc.vsix -d lc
      - name: Quality gate
        run: node lc/extension/bin/linecounter.js gate . --json gate.json
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: quality-gate, path: gate.json }
```

Inside VS Code the same checks run with **Line Counter: Run Quality Gate**. The result is also shown at the top of the statistics page.
