const path = require('node:path');
const { createPresetStore } = require('./lib/preset-store');
const { seedSystemPresets } = require('./lib/system-preset-catalog');

const store = createPresetStore({ systemDir: path.join(__dirname, 'data', 'system') });
seedSystemPresets(store, 'choushiyiguai');
const preset = store.getPublished('script-format-shotlist');
if (!preset) throw new Error('script-format-shotlist was not seeded');
process.stdout.write(`${preset.id}\t${preset.name}\t${preset.status}\n`);
