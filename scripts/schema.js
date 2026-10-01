'use strict';
// Regenerates schemas/settings.schema.json from the settings in package.json (keys with and without "locomotive.").
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const conf = pkg.contributes.configuration;
const props = Array.isArray(conf) ? Object.assign({}, ...conf.map(c => c.properties)) : conf.properties;
const out = {};
for (const [key, def] of Object.entries(props)) {
  const clean = { ...def };
  delete clean.scope; delete clean.order; delete clean.markdownDescription;
  if (!clean.description && def.markdownDescription) clean.description = def.markdownDescription;
  out[key.replace(/^locomotive\./, '')] = clean;
  out[key] = clean;
}
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'LOComotive workspace settings (.locomotive/settings.json)',
  description: "Overrides the locomotive.* VS Code settings for this workspace. Keys may be written with or without the 'locomotive.' prefix.",
  type: 'object',
  properties: out,
};
fs.writeFileSync(path.join(root, 'schemas', 'settings.schema.json'), JSON.stringify(schema, null, 2) + '\n');
console.log(`schema: ${Object.keys(props).length} settings`);
