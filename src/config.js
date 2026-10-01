'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Workspace configuration stored in a `.locomotive/` folder next to the code, so it can be committed and shared:
 *
 *   .locomotive/settings.json  – overrides for the `locomotive.*` VS Code settings
 *                                 (keys with or without the "locomotive." prefix)
 *   .locomotive/presets.json   – named filter presets (excluded files/folders, hidden file types, predefined filters)
 *
 * Values in .locomotive/settings.json win over user/workspace settings.
 */
const { DIR, LEGACY_DIR, configDir, configDirName } = require('./configDir');
const SETTINGS_FILE = 'settings.json';
const PRESETS_FILE = 'presets.json';
const FILTERS_FILE = 'filters.json';

class LocomotiveConfig {
  constructor() {
    this.fileSettings = {};
    this.presetStore = { presets: {} };
    this.listeners = [];
    this.watchers = [];
    this.reload();
  }

  /** Folder that holds .locomotive (the first workspace folder). */
  get root() {
    const f = (vscode.workspace.workspaceFolders || [])[0];
    return f ? f.uri.fsPath : null;
  }

  get dir() { return configDir(this.root); }
  get dirName() { return configDirName(this.root); }
  get settingsPath() { return this.dir ? path.join(this.dir, SETTINGS_FILE) : null; }
  get presetsPath() { return this.dir ? path.join(this.dir, PRESETS_FILE) : null; }
  get filtersPath() { return this.dir ? path.join(this.dir, FILTERS_FILE) : null; }

  reload() {
    this.fileSettings = readJson(this.settingsPath) || {};
    const store = readJson(this.presetsPath);
    this.presetStore = store && typeof store === 'object' && store.presets ? store : { presets: {} };
    const filters = readJson(this.filtersPath);
    this.filterStore = filters && Array.isArray(filters.filters) ? filters : { filters: [] };
  }

  // ---------- custom filters (.locomotive/filters.json + locomotive.customFilters) ----------
  /** [{ id, label, patterns, source }] – every filter becomes its own checkbox in the sidebar */
  listCustomFilters() {
    const out = [];
    const add = (f, source) => {
      if (!f || !Array.isArray(f.patterns) || !f.patterns.length) return;
      const label = String(f.label || f.patterns.join(', ')).trim();
      const id = 'cf:' + label.toLowerCase().replace(/[^\w*./-]+/g, '-');
      if (!out.some(x => x.id === id)) out.push({ id, label, patterns: f.patterns.map(String).filter(Boolean), source });
    };
    for (const f of this.filterStore.filters || []) add(f, this.dirName + '/' + FILTERS_FILE);
    for (const f of this.get('customFilters', []) || []) add(f, 'settings');
    return out;
  }

  async addCustomFilter(label, patterns) {
    if (!this.dir) throw new Error('Open a folder first – filters are stored in .locomotive/filters.json');
    const list = (this.filterStore.filters || []).filter(f => String(f.label).trim() !== label);
    list.push({ label, patterns });
    this.filterStore = { filters: list };
    await fs.promises.mkdir(this.dir, { recursive: true });
    await fs.promises.writeFile(this.filtersPath, JSON.stringify(this.filterStore, null, 2) + '\n', 'utf8');
  }

  async removeCustomFilter(id) {
    const list = (this.filterStore.filters || []).filter(f => 'cf:' + String(f.label || f.patterns.join(', ')).trim().toLowerCase().replace(/[^\w*./-]+/g, '-') !== id);
    this.filterStore = { filters: list };
    if (this.dir) await fs.promises.writeFile(this.filtersPath, JSON.stringify(this.filterStore, null, 2) + '\n', 'utf8');
  }

  /** Effective value: .locomotive/settings.json > VS Code settings > default. */
  get(key, def) {
    const fsVal = this.fileSettings[key] ?? this.fileSettings['locomotive.' + key] ?? this.fileSettings['linecounter.' + key] ?? nested(this.fileSettings, key);
    if (fsVal !== undefined) return fsVal;
    const cfg = vscode.workspace.getConfiguration('locomotive');
    // settings from before the rename (linecounter.*) still count as long as the new key is not set
    const i = cfg.inspect ? cfg.inspect(key) : null;
    const own = i && [i.globalValue, i.workspaceValue, i.workspaceFolderValue].some(v => v !== undefined);
    if (i && !own) {
      const legacy = vscode.workspace.getConfiguration('linecounter').get(key);
      if (legacy !== undefined) return legacy;
    }
    return cfg.get(key, def);
  }

  /** Where a value comes from – shown in the UI. */
  source(key) {
    if (this.fileSettings[key] !== undefined || this.fileSettings['locomotive.' + key] !== undefined || nested(this.fileSettings, key) !== undefined) return this.dirName;
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
      presets: state.presets, excluded: state.excluded, included: state.included, hiddenExt: state.hiddenExt, libraries: !!state.libraries, base: state.base || null,
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
    if (!this.dir) throw new Error('Open a folder first – presets are stored in .locomotive/presets.json');
    await fs.promises.mkdir(this.dir, { recursive: true });
    await fs.promises.writeFile(this.presetsPath, JSON.stringify(this.presetStore, null, 2) + '\n', 'utf8');
  }

  /** Creates .locomotive/settings.json with the current effective values (if missing) and returns its path. */
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

  /** Watch .locomotive/*.json and notify listeners on change. */
  watch(onChange) {
    this.listeners.push(onChange);
    if (this.watchers.length || !this.root) return;
    const pattern = new vscode.RelativePattern(this.root, `{${DIR},${LEGACY_DIR}}/*.json`);
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

module.exports = { LocomotiveConfig, readJson, DIR };
