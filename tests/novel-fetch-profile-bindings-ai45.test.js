const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routeSource = fs.readFileSync(path.resolve(__dirname, '../routes/batch-rewrite.js'), 'utf8');

test('版本对应配置档后端绑定覆盖 original 和 AI1 到 AI5', () => {
  const match = routeSource.match(/function normalizeProfileBindings\(value\) \{[\s\S]*?Object\.fromEntries\(\[([^\]]+)\]\.map\(version/);
  assert.ok(match, 'normalizeProfileBindings 应使用显式版本列表');
  const versions = [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
  assert.deepEqual(versions, ['original', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
});
