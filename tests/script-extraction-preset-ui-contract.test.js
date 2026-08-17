const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'ScriptPage.jsx'), 'utf8');

test('script page renders extraction options from the published preset catalog', () => {
  assert.match(source, /filterExtractionPresets/);
  assert.match(source, /selectAvailableExtractionPreset/);
  assert.match(source, /extractionPresets\.map/);
  assert.doesNotMatch(source, /label: '剧本标准提取', value: 'standard'/);
  assert.doesNotMatch(source, /label: '小说面板提取', value: 'novelPanel'/);
});
