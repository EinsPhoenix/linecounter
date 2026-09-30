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
- **Klick auf eine Datei oder einen Ordner schließt ihn aus** (durchgestrichen). Ein erneuter Klick nimmt ihn wieder auf. Mit dem Pfeil klappst du Ordner auf und zu, das Pfeil-Symbol rechts öffnet die Datei.
- **Suchleiste**: filtert den Baum live. Wildcards (`*.test.js`, `?`) und Pfade (`src/utils`) funktionieren. Mit *Exclude all* oder *Include all* schließt du alle Treffer auf einmal aus oder wieder ein.
- **Vordefinierte Filter** (per Checkbox): `node_modules`, Python-venv/Caches (auch venvs mit anderem Namen, erkannt über `pyvenv.cfg`), `.git`, Build-Output (`dist`, `build`, `out`, `target`, …), IDE-Ordner, `vendor`, Lock-Files, minifizierte Dateien, Binärdateien/Medien und optional alles aus `.gitignore`.
  Ausgeschlossene Preset-Ordner werden nicht gescannt. Das hält große Workspaces schnell. Klickst du einen solchen Ordner an, wird er nachgeladen und eingeschlossen.
- **Dateitypen**: alle erkannten Endungen mit Anzahl als Chips. Ein Klick blendet einen Typ aus oder ein, dazu gibt es *All*, *None* und *Invert*.
- Die Auswahl wird pro Workspace gespeichert.
- **Create Statistics** startet die Auswertung.

## Statistik-Seite (öffnet maximiert oder im Vollbild)

Die Seite nutzt ein festes Farbschema aus dunklem Orange und Grau mit SVG-Icons. Nur die Hall of Fame und der Code Rant verwenden Emojis. **Jedes Diagramm** hat oben rechts einen Vollbild-Button, mit `Esc` geht es zurück.

- **Übersicht**: Zeilen gesamt, Code, Kommentare, Leerzeilen, Dateien, Ordner, Größe, Sprachen, Ø Zeilen/Datei, Median, Ø Zeilenlänge, geschätzte Funktionen, Imports, TODO/FIXME/HACK
- **Sprachen**: Donut-Charts (Zeilen, Dateien, Code/Kommentar/Leer), gestapelte Balken pro Sprache, Sprachtabelle
- **Dateien und Ordner**: Treemap **aller** Dateien (Canvas, nach Ordnern gruppiert, ohne Sammelblock „Other“, auch bei zehntausenden Dateien), größte Dateien nach Zeilen und Bytes, Top-Ordner, Dateiendungen, Verteilung der Dateilängen, letzte Änderung
  - **Treemap-Kachel:** Ein **Linksklick kopiert den Pfad** in die Zwischenablage, ein Doppelklick öffnet die Datei.
  - **Rechtsklick** (auch in Rangliste, Balken und Rant-Listen): Datei öffnen, Pfad bzw. relativen Pfad kopieren, im Dateimanager anzeigen oder **Datei löschen**. Beim Löschen kommt eine Sicherheitsabfrage, danach landet die Datei im Papierkorb oder wird endgültig gelöscht.
- **Hall of Fame**: 18 Kategorien mit Podest (🥇🥈🥉), darunter längste und schwerste Datei, längste Zeile (öffnet direkt an der Stelle), kleinste Datei, tiefste Verschachtelung, längster Name, TODO-Sammler, am besten dokumentiert, „Silent treatment“ (viel Code, kein Kommentar), Function Factory, Debug-Print-Champion, luftigste und dichteste Datei, breitester Code, Whitespace-Hoarder, Emoji-Artist, neueste Datei und Fossil. Die Hero-Karte 🏆 zeigt die meistdekorierte Datei.
- **Code Rant**: lästert über Dateien über der Zeilengrenze (Standard **500**) und über Dateien mit mehr als **10 %** Leerzeilen.
  - **Rant-o-Meter** (0–100) mit Stimmung von 😇 Zen bis 🌋 Volcanic
  - **Kennzahlen:** Zeilen über dem Limit, überflüssige Leerzeilen, schlimmster Übeltäter 👑
  - **Eskalationsstufen** zum Filtern: 🙄 Mild, 😤 Spicy, 🤬 Furious, 💀 Nuclear für zu lange Dateien und 🫧 Breezy, 🌬️ Drafty, 🏜️ Desert, 🕳️ Void für zu viele Leerzeilen
  - **🔥 Project roast:** Sprüche über Kommentarquote, Dateigröße, TODOs, Sprachen-Mix, Tabs vs. Spaces, Bus-Factor, Nachtschichten und mehr
  - **🎁 Bonus-Rants:** sehr lange Zeilen, Debug-Prints, TODO-Wunschlisten, Code ohne Kommentare, Trailing Whitespace, gegenseitige Imports, Import-Magneten
  - **💬 Commit message rant** (pro Repo): zu kurze und zu lange Messages, verbotene Begriffe (wip, asdf, tmp, final, please, …) mit Beispielen, immer gleiche Messages, SHOUTING, „!!“ und „??“, Reverts, Commits am Freitag nach 17 Uhr, Kleinschreibung, Punkt am Ende
  - Jeder Hall-of-Fame-Gewinner bekommt einen eigenen Roast.
  - Betroffene Werte sind in der Rangliste orange markiert.
- **Git** (Repos werden automatisch erkannt, auch verschachtelte): Commits, Contributors, erster und letzter Commit, Projektalter, +/− Zeilen, Branches und Tags, Commits pro Monat, Heatmap nach Wochentag × Uhrzeit, Top-Contributors, Hotspots (am häufigsten geänderte Dateien)
- **Git-Fun-Facts**: Nachteulen-Commits, Wochenend-Commits, längste Commit-Serie, busiest day, Bus-Factor, Fix-Quote, faule Commit-Messages, kürzeste und längste Message, größter Commit, Lieblingswörter
- **Fun Facts**: gedruckte Seiten und Stapelhöhe, Länge des Codes in einer Zeile (× Eiffelturm), Tippzeit, „× Harry Potter“, Kaffeeverbrauch, COCOMO-Aufwand und -Kosten, WTF/kLOC, Doku-Note, Tabs vs. Spaces, Debug-Prints, Semikolons, Trailing Whitespace, Vorkommen von 42, Emojis, Tweets, Disketten
- **Words & connections**
  - Word Cloud der meistgenutzten Bezeichner
  - **Word Web:** ein animierter, wackelnder Force-Graph aus den häufigsten Wörtern und den Dateien, die sie am meisten verwenden
  - **File connections:** ein Graph, wer wen importiert (JS/TS, Python, CSS/SCSS/Less, C/C++, HTML). Gegenseitige Imports sind hervorgehoben, dazu Listen „Most imported“, „Imports the most“ und „Mutual imports“.
  - Alle Graphen lassen sich zoomen, verschieben und per Drag bewegen. Hover hebt die Nachbarn hervor. Die Buttons oben rechts pausieren die Animation, schalten das Wackeln ein und aus, schütteln den Graphen durch und setzen den Zoom zurück. Die Einblend-Animation startet, sobald ein Graph ins Bild scrollt.
- **Ranglisten-Tabelle** aller Dateien: sortierbar nach jeder Spalte, Filter nach Pfad und Sprache. Ein Klick öffnet die Datei.
- **Project structure** (ganz am Ende): Ordner und Dateien als lebender Force-Graph. Ein Klick auf einen Ordner klappt ihn zu oder auf, ein Klick auf eine Datei öffnet sie. Große Projekte starten teilweise zugeklappt, damit der Graph flüssig bleibt.
- Export als **CSV** oder **JSON**, *Refresh*, *Maximize*, *Full screen*

## Einstellungen

| Setting | Default | Beschreibung |
|---|---|---|
| `linecounter.statisticsLayout` | `maximized` | `maximized` blendet Sidebars und Panel aus, `fullscreen` schaltet zusätzlich das Fenster in den Vollbildmodus, `normal` öffnet die Seite als normalen Tab |
| `linecounter.rant.enabled` | `true` | Abschnitt „Code Rant“ anzeigen |
| `linecounter.rant.maxFileLines` | `500` | Rant über Dateien, die länger als diese Zeilenzahl sind |
| `linecounter.rant.maxBlankPercent` | `10` | Rant, wenn mehr als dieser Prozentsatz der Zeilen leer ist (Dateien ab 10 Zeilen und das gesamte Projekt) |
| `linecounter.rant.commitMinLength` | `10` | Commit-Messages, die kürzer sind, bekommen einen Rant |
| `linecounter.rant.commitMaxLength` | `72` | Commit-Messages, die länger sind, bekommen einen Rant |
| `linecounter.rant.commitWords` | `[]` | Begriffe, die in Commit-Messages einen Rant auslösen (leer bedeutet die eingebaute Liste) |
| `linecounter.maxFileSizeKB` | `2048` | Größere Dateien zählen nur mit ihrer Größe |
| `linecounter.maxEntries` | `200000` | Maximale Anzahl gescannter Einträge |
| `linecounter.maxCommits` | `20000` | Maximale Anzahl gelesener Commits pro Repo |

## Entwicklung

Reines JavaScript, kein Build-Schritt. d3 (ISC-Lizenz) liegt fertig in `media/vendor/`, die Webview lädt nichts aus dem Internet.

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
src/git.js         Git-Auswertung (log, shortstat, Hotspots, Commit-Rant, …)
src/graphs.js      Daten für Word Web und Import-Graph
src/stats.js       Aggregation für die Statistik-Seite
src/statsPanel.js  Webview-Panel (Vollbild, Datei öffnen, Export)
media/             Webview-UI (Sidebar, Statistik-Seite, graphs.js = Canvas-Treemap + Force-Graphen)
```
