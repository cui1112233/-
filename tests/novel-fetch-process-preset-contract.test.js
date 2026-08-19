const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('system preset catalog seeds novel-fetch process presets', () => {
  const catalog = read('lib/system-preset-catalog.js');
  assert.match(catalog, /id: 'novel-fetch-induce'/);
  assert.match(catalog, /operation: 'induce'/);
  assert.match(catalog, /id: 'novel-fetch-hook'/);
  assert.match(catalog, /operation: 'hook'/);
  assert.match(catalog, /format: 'novel-fetch-process'/);
});

test('publicPreset exposes processOperation for novel-fetch-process', () => {
  const store = read('lib/preset-store.js');
  assert.match(store, /protocolLock\?\.format === 'novel-fetch-process'/);
  assert.match(store, /processOperation: preset\.protocolLock\.operation/);
});

test('admin preset library includes novel-fetch module', () => {
  const page = read('frontend/src/admin/pages/PresetLibraryPage.jsx');
  assert.match(page, /label: '小说获取'/);
  assert.match(page, /value: 'novel-fetch'/);
});

test('app wires novel-fetch router with presetStore', () => {
  const app = read('app.js');
  assert.match(app, /createNovelFetchRouter\(\{ presetStore: resolvedPresetStore, novelFetchStore: resolvedNovelFetchStore \}\)/);
});
