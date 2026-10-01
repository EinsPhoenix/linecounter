'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Folder next to the code that holds settings, presets, filters, pinboard and history: `.locomotive/`.
 * Projects set up before the rename keep working: an existing `.linecounter/` is used as long as there is no `.locomotive/`.
 */
const DIR = '.locomotive';
const LEGACY_DIR = '.linecounter';

function configDirName(root) {
  if (!root || fs.existsSync(path.join(root, DIR))) return DIR;
  return fs.existsSync(path.join(root, LEGACY_DIR)) ? LEGACY_DIR : DIR;
}

function configDir(root) { return root ? path.join(root, configDirName(root)) : null; }

module.exports = { DIR, LEGACY_DIR, configDirName, configDir };
