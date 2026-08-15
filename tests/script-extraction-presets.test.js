const test = require('node:test');
const assert = require('node:assert/strict');

test('filters extraction presets and migrates legacy selection values', async () => {
  const { filterExtractionPresets, selectAvailableExtractionPreset } = await import('../frontend/src/user/pages/scriptExtractionPresets.js');
  const presets = filterExtractionPresets([
    { id: 'script-extract', name: '管理员新名称', kind: 'base', extractionPreset: true },
    { id: 'script-hook', name: '爆款开头', kind: 'base', extractionPreset: false }
  ]);
  assert.deepEqual(presets.map(item => item.name), ['管理员新名称']);
  assert.equal(selectAvailableExtractionPreset('standard', presets), 'script-extract');
  assert.equal(selectAvailableExtractionPreset('hidden-id', presets), 'script-extract');
});
