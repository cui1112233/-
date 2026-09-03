const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('版本集合固定为原文和 AI1 到 AI5，并保留稀疏选择', () => {
  const selection = require('../lib/novel-fetch-workshop/version-selection');
  assert.deepEqual(selection.VERSION_ORDER, ['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
  assert.deepEqual(selection.normalizeSelectedVersions(['AI5', 'ai1', 'ai5', 'invalid']), ['ai1', 'ai5']);
});

test('旧任务仍能从 aiCount 推导目标版本', () => {
  const selection = require('../lib/novel-fetch-workshop/version-selection');
  assert.deepEqual(selection.taskSelectedVersions({ aiCount: 2 }), ['original', 'ai1', 'ai2']);
});

test('版本对应配置档覆盖原文和 AI1 到 AI5，并丢弃未知版本', () => {
  const selection = require('../lib/novel-fetch-workshop/version-selection');
  assert.deepEqual(selection.normalizeProfileBindings({
    original: 'p-original',
    ai1: 'p-ai1',
    ai5: 'p-ai5',
    ai6: 'ignored'
  }), {
    original: 'p-original',
    ai1: 'p-ai1',
    ai5: 'p-ai5'
  });
});

test('主线工作区是版本配置入口，不再保留旧解析入口', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/app.js'), 'utf8');
  for (const label of ['版本对应配置档', '同步批量后台配置', '同步批量风格类型', 'AI5']) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /解析格式|列顺序|默认AI文案数量/);
  assert.match(app, /processBtn/);
  assert.match(app, /selected_versions/);
  assert.match(app, /ai_slot_methods/);
});
