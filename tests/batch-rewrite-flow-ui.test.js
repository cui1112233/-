const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const app = fs.readFileSync(path.join(__dirname, '..', 'frontend/public/batch-rewrite/app.js'), 'utf8');
const uploadRoute = fs.readFileSync(path.join(__dirname, '..', 'routes/novel-fetch-upload.js'), 'utf8');
const browserClient = fs.readFileSync(path.join(__dirname, '..', 'lib/novel-fetch-workshop/121-browser-client.js'), 'utf8');

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

test('登录弹窗在配置尚未加载时也能收口，不会因空配置永久停在验证中', () => {
  assert.match(app, /\.\.\.\(state\.config\?\.web_submit \|\| \{\}\)/);
  assert.match(app, /webLoginSubmit"\)\.disabled = false/);
  assert.match(app, /dialog\.addEventListener\("submit"/);
});

test('服务端 121 Browser Worker 客户端区分普通请求和登录请求超时预算', () => {
  assert.match(uploadRoute, /browserClient\.login\(/);
  assert.match(uploadRoute, /browserClient\.test\(/);
  assert.match(browserClient, /timeoutMs\s*=\s*Number\(process\.env\.QIANTIE_121_CLIENT_TIMEOUT_MS\)\s*\|\|\s*40_000/);
  assert.match(browserClient, /loginTimeoutMs\s*=\s*Number\(process\.env\.QIANTIE_121_CLIENT_LOGIN_TIMEOUT_MS\)\s*\|\|\s*55_000/);
  assert.match(browserClient, /requestTimeoutMs\s*=\s*timeoutMs/);
  assert.match(browserClient, /login:\s*input\s*=>\s*request\([^\n]*requestTimeoutMs:\s*loginTimeoutMs/);
  assert.match(browserClient, /refresh:\s*input\s*=>\s*request\([^\n]*requestTimeoutMs:\s*loginTimeoutMs/);
  assert.match(browserClient, /new AbortController\(\)/);
  assert.match(browserClient, /BROWSER_WORKER_TIMEOUT/);
});