const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controlsPath = path.join(__dirname, '..', 'routes', 'batch-factory-controls.js');
const controlsSource = fs.readFileSync(controlsPath, 'utf8');

test('Node 兼容层不再实现 sparse override 业务归一化', () => {
  assert.doesNotMatch(controlsSource, /function\s+normalizeSparseOverride\s*\(/);
  assert.doesNotMatch(controlsSource, /OVERRIDE_KEYS/);
});

test('Node 兼容层不再自行解析绑定视频模型能力', () => {
  assert.doesNotMatch(controlsSource, /resolveBoundVideoSettings/);
  assert.doesNotMatch(controlsSource, /normalizeProductionExtras/);
});

test('统一设置和覆盖设置都委托给 Go canonicalization API', () => {
  assert.match(controlsSource, /\/api\/shuihuo-production\/batch-factory\/settings\/canonicalize/);
  assert.match(controlsSource, /\/api\/shuihuo-production\/batch-factory\/overrides\/canonicalize/);
});
