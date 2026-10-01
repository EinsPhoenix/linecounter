## Was Line Counter kann

**Sidebar & Filter**
- Dateibaum des Workspaces mit Live-Suche (Wildcards, Pfade), Ausschluss per Klick
- Vordefinierte Filter (node_modules, venvs, Build-Output, Lock-Files, Binärdateien, `.gitignore` …) und eigene Filter wie `*/data`
- Dateitypen als Chips ein-/ausblenden, Presets und Einstellungen in `.linecounter/` (teilbar im Team)
- Beliebigen Ordner als Projekt-Root wählen

**Statistik-Seite (Vollbild)**
- Zeilen (Code/Kommentar/Leer) für 74 Sprachen, Sprach-Charts, Treemap, Rangliste aller Dateien
- Hall of Fame, Rants und Fun Facts
- Git-Statistiken: Commits, Autoren, Aktivität, Hotspots; mehrere Repositories mit Übersicht und Umschalter
- Trends über alle Läufe mit „seit dem letzten Lauf“-Deltas

**Code Health**
- Komplexität pro Funktion (JS/TS, Python, Rust, Go, Java, C#, C/C++ u. v. m.)
- Risiko-Hotspots (Git-Churn × Komplexität), möglicherweise ungenutzte Funktionen
- Duplikate und Secrets im Code
- TODO-Tracker mit Autor und Alter aus `git blame`
- Code Ownership: Owner, Bus-Factor pro Ordner, verwaiste Dateien

**Dependencies**
- Lizenzen aller Pakete aus npm, PyPI, crates.io und Go-Modulen, problematische Lizenzen konfigurierbar
- Schwachstellen über OSV mit CVSS-Schweregrad
- Ungenutzte und nicht deklarierte Pakete

**Architektur & Vergleich**
- Architekturregeln und Schichten (z. B. „`ui/` darf nicht `db/` importieren“), Verstöße rot im Graphen
- Branch-Vergleich: aktueller Branch gegen Basis (Dateien, Komplexität, neue Funktionen, TODOs, Abhängigkeiten)

**Graphen**
- Import- und Funktionsgraph mit Zyklen, Ordner-Clustern, Farben und Suche, bis 20.000 Knoten
- Zoom zum Mauszeiger, Pinch, Tastatur
- „Dependency Express“: 3D-Zug fährt durch das Projekt

**Automatisierung**
- Quality Gate für CI: `node bin/linecounter.js gate` (Exit-Code 1 bei Verstößen)
- MCP-Server mit 21 Tools für LLM-Agenten (Impact einer Änderung, Risiko, Schwachstellen, Lizenzen …)
- PDF-Exporte (Statistik, Code Health, Lizenzen, Schwachstellen)
