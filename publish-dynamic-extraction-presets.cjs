const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const source = path.join(root, '.worktrees', 'script-dynamic-extraction-presets');
const files = [
  'lib/system-preset-catalog.js',
  'lib/preset-store.js',
  'routes/chat.js',
  'frontend/src/user/pages/scriptExtractionPresets.js',
  'frontend/src/user/pages/scriptDraftStorage.js',
  'frontend/src/user/pages/ScriptPage.jsx',
  'tests/system-preset-catalog.test.js',
  'tests/script-extraction-presets.test.js',
  'tests/script-extraction-preset-ui-contract.test.js'
];

for (const relativePath of files) {
  const from = path.join(source, relativePath);
  const to = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

const presetPath = path.join(root, 'data', 'system', 'presets.json');
const presets = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
let migrated = 0;
for (const preset of presets) {
  if (!['script-extract', 'script-extract-novel-panel'].includes(preset.id)) continue;
  if (preset.protocolLock?.format === 'extract') continue;
  preset.protocolLock = { ...(preset.protocolLock || {}), format: 'extract' };
  migrated += 1;
}
fs.writeFileSync(presetPath, `${JSON.stringify(presets, null, 2)}\n`, 'utf8');
process.stdout.write(`Published ${files.length} files and migrated ${migrated} preset versions\n`);
