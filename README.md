# Line Counter & Code Statistics

VS-Code-Extension, die alle Dateien und Ordner des Workspaces rekursiv als Baum in der Sidebar anzeigt. Dort filterst du die Auswahl und erzeugst mit einem Klick eine Statistik-Seite im Vollbild.

## Installation

Die fertig gepackte Extension liegt im Repo: **`linecounter.vsix`**

```bash
code --install-extension linecounter.vsix
```

Alternativ in VS Code: *Extensions → „…“ → Install from VSIX…*

## Sidebar („Line Counter“ in der Activity Bar)

- **Baum aller Dateien und Ordner** (rekursiv, Multi-Root-Workspaces werden unterstützt)
- **Klick auf eine Datei oder einen Ordner schließt ihn aus** (durchgestrichen). Ein erneuter Klick nimmt ihn wieder auf. Mit dem Pfeil klappst du Ordner auf und zu, `↗` öffnet die Datei.
- **Suchleiste**: filtert den Baum live. Wildcards (`*.test.js`, `?`) und Pfade (`src/utils`) funktionieren. Mit *Exclude all* oder *Include all* schließt du alle Treffer auf einmal aus oder wieder ein.
- **Vordefinierte Filter** (per Checkbox): `node_modules`, Python-venv/Caches (auch venvs mit anderem Namen, erkannt über `pyvenv.cfg`), `.git`, Build-Output (`dist`, `build`, `out`, `target`, …), IDE-Ordner, `vendor`, Lock-Files, minifizierte Dateien, Binärdateien/Medien und optional alles aus `.gitignore`.
  Ausgeschlossene Preset-Ordner werden nicht gescannt. Das hält große Workspaces schnell. Klickst du einen solchen Ordner an, wird er nachgeladen und eingeschlossen.
- **Dateitypen**: alle erkannten Endungen mit Anzahl als Chips. Ein Klick blendet einen Typ aus oder ein, dazu gibt es *All*, *None* und *Invert*.
- Die Auswahl wird pro Workspace gespeichert.
- **📊 Create Statistics** startet die Auswertung.

## Statistik-Seite (öffnet maximiert oder im Vollbild)

- **Übersicht**: Zeilen gesamt, Code, Kommentare, Leerzeilen, Dateien, Ordner, Größe, Sprachen, Ø Zeilen/Datei, Median, Ø Zeilenlänge, geschätzte Funktionen, Imports, TODO/FIXME/HACK
- **Sprachen**: Donut-Charts (Zeilen, Dateien, Code/Kommentar/Leer), gestapelte Balken pro Sprache, Sprachtabelle
- **Dateien und Ordner**: Treemap aller Dateien (Klick öffnet die Datei), größte Dateien nach Zeilen und Bytes, Top-Ordner, Dateiendungen, Verteilung der Dateilängen, letzte Änderung
- **Hall of Fame**: längste Datei, schwerste Datei, längste Zeile (öffnet direkt an der Zeile), kleinste Datei, tiefste Verschachtelung, längster Dateiname, meiste TODOs, am besten kommentiert, neueste und älteste Datei
- **Git** (Repos werden automatisch erkannt, auch verschachtelte): Commits, Contributors, erster und letzter Commit, Projektalter, +/− Zeilen, Branches und Tags, Commits pro Monat, Heatmap nach Wochentag × Uhrzeit, Top-Contributors, Hotspots (am häufigsten geänderte Dateien)
- **Git-Fun-Facts**: Nachteulen-Commits, Wochenend-Commits, längste Commit-Serie, busiest day, Bus-Factor, Fix-Quote, faule Commit-Messages, kürzeste und längste Message, größter Commit, Lieblingswörter
- **Fun Facts**: gedruckte Seiten und Stapelhöhe, Länge des Codes in einer Zeile (× Eiffelturm), Tippzeit, „× Harry Potter“, Kaffeeverbrauch, COCOMO-Aufwand und -Kosten, WTF/kLOC, Doku-Note, Tabs vs. Spaces, Debug-Prints, Semikolons, Trailing Whitespace, Vorkommen von 42, Emojis, Tweets, Disketten
- **Word Cloud** der meistgenutzten Bezeichner
- **Ranglisten-Tabelle** aller Dateien: sortierbar nach jeder Spalte, Filter nach Pfad und Sprache. Ein Klick öffnet die Datei.
- Export als **CSV** oder **JSON**, *Refresh*, *Maximize*, *Full screen*

## Einstellungen

| Setting | Default | Beschreibung |
|---|---|---|
| `linecounter.statisticsLayout` | `maximized` | `maximized` blendet Sidebars und Panel aus, `fullscreen` schaltet zusätzlich das Fenster in den Vollbildmodus, `normal` öffnet die Seite als normalen Tab |
| `linecounter.maxFileSizeKB` | `2048` | Größere Dateien zählen nur mit ihrer Größe |
| `linecounter.maxEntries` | `200000` | Maximale Anzahl gescannter Einträge |
| `linecounter.maxCommits` | `20000` | Maximale Anzahl gelesener Commits pro Repo |

## Entwicklung

Reines JavaScript, kein Build-Schritt.

```bash
npm install
npm test          # Smoke-Test (Scanner, Analyzer, Git, Aggregation)
npm run package   # erzeugt linecounter.vsix
```

Zum Debuggen öffnest du den Ordner in VS Code und startest mit `F5` einen Extension Development Host.

```
src/extension.js   Aktivierung, Sidebar-Provider, Ablauf „Create Statistics“
src/scanner.js     Rekursiver Scan und vordefinierte Filter
src/analyzer.js    Zeilen-Klassifizierung (Code/Kommentar/Leer) und Kennzahlen pro Datei
src/languages.js   Spracherkennung und Kommentarsyntax
src/git.js         Git-Auswertung (log, shortstat, Hotspots, …)
src/stats.js       Aggregation für die Statistik-Seite
src/statsPanel.js  Webview-Panel (Vollbild, Datei öffnen, Export)
media/             Webview-UI (Sidebar und Statistik-Seite, Charts ohne externe Libraries)
```
