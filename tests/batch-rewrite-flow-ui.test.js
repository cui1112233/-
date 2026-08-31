const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const app = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/batch-rewrite/app.js'), 'utf8');

test('121 登录验证必须有超时并在结束时恢复按钮', () => {
  assert.match(app, /const PLATFORM_API_TIMEOUT_MS = \d+;/);
  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /signal:\s*controller\.signal/);
  assert.match(app, /验证请求超时，请检查网络后重试/);
  assert.match(app, /webLoginSubmit"\)\.disabled = false/);
  assert.match(app, /novelFetchPlatformApi\("\/api\/novel-fetch-upload\/upload-login"/);
});

test('121 会话验证使用同一超时封装并在 finally 中恢复按钮', () => {
  assert.match(app, /novelFetchPlatformApi\("\/api\/batch-rewrite\/web-submit\/test-visible"/);
  assert.match(app, /finally\s*\{[\s\S]*button\.disabled = false;/);
});
