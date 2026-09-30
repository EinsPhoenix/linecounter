'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Workspace configuration stored in a `.linecounter/` folder next to the code, so it can be committed and shared:
 *
 *   .linecounter/settings.json  – overrides for the `linecounter.*` VS Code settings
 *                                 (keys with or without the "linecounter." prefix)
 *   .linecounter/presets.json   – named filter presets (excluded files/folders, hidden file types, predefined filters)
 *
 * Values in .linecounter/settings.json win over user/workspace settings.
 */
const DIR = '.linecounter';
const SETTINGS_FILE = 'settings.json';
const PRESETS_FILE = 'presets.json';

class LineCounterConfig {
  constructor() {
    this.fileSettings = {};
    this.presetStore = { presets: {} };
    this.listeners = [];
    this.watchers = [];
    this.reload();
  }

  /** Folder that holds .linecounter (the first workspace folder). */
  get root() {
    const f = (vscode.workspace.workspaceFolders || [])[0];
    return f ? f.uri.fsPath : null;
  }

  get dir() { return this.root ? path.join(this.root, DIR) : null; }
  get settingsPath() { return this.dir ? path.join(this.dir, SETTINGS_FILE) : null; }
  get presetsPath() { return this.dir ? path.join(this.dir, PRESETS_FILE) : null; }

  reload() {
    this.fileSettings = readJson(this.settingsPath) || {};
    const store = readJson(this.presetsPath);
    this.presetStore = store && typeof store === 'object' && store.presets ? store : { presets: {} };
  }

  /** Effective value: .linecounter/settings.json > VS Code settings > default. */
  get(key, def) {
    const fsVal = this.fileSettings[key] ?? this.fileSettings['linecounter.' + key] ?? nested(this.fileSettings, key);
    if (fsVal !== undefined) return fsVal;
    return vscode.workspace.getConfiguration('linecounter').get(key, def);
  }

  /** Where a value comes from – shown in the UI. */
  source(key) {
    if (this.fileSettings[key] !== undefined || this.fileSettings['linecounter.' + key] !== undefined || nested(this.fileSettings, key) !== undefined) return DIR;
    return 'settings';
  }

  // ---------- presets ----------
  listPresets() {
    return Object.entries(this.presetStore.presets || {})
      .map(([name, p]) => ({ name, savedAt: p.savedAt || null, excluded: (p.excluded || []).length, hiddenExt: (p.hiddenExt || []).length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getPreset(name) { return (this.presetStore.presets || {})[name] || null; }
  get activePreset() { return this.presetStore.active || null; }

  async savePreset(name, state) {
    this.presetStore.presets[name] = {
      presets: state.presets, excluded: state.excluded, included: state.included, hiddenExt: state.hiddenExt, libraries: !!state.libraries,
      savedAt: new Date().toISOString(),
    };
    this.presetStore.active = name;
    await this.writePresets();
  }

  async deletePreset(name) {
    delete this.presetStore.presets[name];
    if (this.presetStore.active === name) this.presetStore.active = null;
    await this.writePresets();
  }

  async setActive(name) {
    this.presetStore.active = name || null;
    await this.writePresets();
  }

  async writePresets() {
    if (!this.dir) throw new Error('Open a folder first – presets are stored in .linecounter/presets.json');
    await fs.promises.mkdir(this.dir, { recursive: true });
    await fs.promises.writeFile(this.presetsPath, JSON.stringify(this.presetStore, null, 2) + '\n', 'utf8');
  }

  /** Creates .linecounter/settings.json with the current effective values (if missing) and returns its path. */
  async ensureSettingsFile(defaults) {
    if (!this.dir) throw new Error('Open a folder first');
    await fs.promises.mkdir(this.dir, { recursive: true });
    if (!fs.existsSync(this.settingsPath)) {
      const content = {};
      for (const key of Object.keys(defaults)) content[key] = this.get(key, defaults[key]);
      await fs.promises.writeFile(this.settingsPath, JSON.stringify(content, null, 2) + '\n', 'utf8');
      this.reload();
    }
    return this.settingsPath;
  }

  /** Watch .linecounter/*.json and notify listeners on change. */
  watch(onChange) {
    this.listeners.push(onChange);
    if (this.watchers.length || !this.root) return;
    const pattern = new vscode.RelativePattern(this.root, `${DIR}/*.json`);
    const w = vscode.workspace.createFileSystemWatcher(pattern);
    let timer = null;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.reload();
        for (const l of this.listeners) l();
      }, 200);
    };
    w.onDidChange(fire); w.onDidCreate(fire); w.onDidDelete(fire);
    this.watchers.push(w);
  }

  dispose() { for (const w of this.watchers) w.dispose(); this.watchers = []; }
}

function readJson(p) {
  if (!p) return null;
  try {
    // allow comments and trailing commas like VS Code settings files
    const raw = fs.readFileSync(p, 'utf8')
      .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Supports nested objects too: { "rant": { "maxFileLines": 400 } } */
function nested(obj, key) {
  let cur = obj;
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

module.exports = { LineCounterConfig, readJson, DIR };
