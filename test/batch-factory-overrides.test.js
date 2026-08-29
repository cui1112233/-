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

test('统一设置和覆盖设置直接委托给 Go/MySQL 持久化 API', () => {
  assert.match(controlsSource, /batch-factory\/batches\/\$\{encodeURIComponent\(batchId\)\}\/settings/);
  assert.match(controlsSource, /\$\{itemPath\}\/overrides/);
  assert.match(controlsSource, /\$\{itemPath\}\/videos\/\$\{encodeURIComponent\(scope\.videoId\)\}\/overrides/);
  assert.doesNotMatch(controlsSource, /batch-factory\/settings\/canonicalize/);
  assert.doesNotMatch(controlsSource, /batch-factory\/overrides\/canonicalize/);
});
