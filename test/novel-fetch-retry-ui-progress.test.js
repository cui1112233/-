const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('重试失败只把当前可见的失败任务按表格顺序加入队列', () => {
  const source = read('frontend/public/batch-rewrite/app.js');
  const deployed = read('frontend/dist/batch-rewrite/app.js');

  for (const content of [source, deployed]) {
    assert.match(content, /function failedTaskIds\(tasks\)/);
    assert.match(content, /const ids = mode === "selected" \? selectedTaskIds\(\) : failedTaskIds\(state\.tasks\)/);
    assert.match(content, /body: JSON\.stringify\(\{ mode: "selected", ids, sensitive_ai_enabled: sensitiveAiProcessEnabled\(\) \}\)/);
  }
});

test('失败重试入队后通知 V2 立即刷新并持续轮询逐条状态', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  const v2 = read('public/batch-rewrite/v78-novel-fetch-v2.js');

  assert.match(app, /new CustomEvent\("qiantie-novel-fetch-retry-queued"/);
  assert.match(v2, /window\.addEventListener\('qiantie-novel-fetch-retry-queued'/);
  assert.match(v2, /invalidate\('\/tasks'\)/);
  assert.match(v2, /startPolling\(refreshAllData\)/);
});
