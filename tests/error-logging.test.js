const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createErrorLogStore } = require('../lib/error-log-store');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    const finish = (error, response) => server.close(closeError => {
      if (error || closeError) reject(error || closeError);
      else resolve(response);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          finish(null, { status: res.statusCode, body: text ? JSON.parse(text) : null });
        });
      });
      req.once('error', error => finish(error));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

test('client failures are persisted with sensitive text redacted and only the owner can inspect them', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-error-logs-'));
  const errorLogStore = createErrorLogStore({ filePath: path.join(tempDir, 'error-logs.json') });
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const app = createApp({ errorLogStore });

  const reported = await request(app, {
    method: 'POST',
    requestPath: '/api/client-errors',
    body: {
      kind: 'unhandledrejection',
      message: 'Request failed. Authorization: Bearer secret-token password=123456 apiKey=sk-secret',
      stack: 'Error: failed at HomePage.jsx:44',
      path: '/'
    }
  });
  assert.equal(reported.status, 202);
  const records = errorLogStore.list();
  assert.ok(records.length > 0);
  assert.doesNotMatch(JSON.stringify(records[0]), /secret-token|123456|sk-secret/);
  assert.equal(records[0].kind, 'client.unhandledrejection');

  const login = await request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username: 'choushiyiguai', password: '123456' }
  });
  assert.equal(login.status, 200);

  const readable = await request(app, { requestPath: '/api/admin/error-logs', token: login.body.token });
  assert.equal(readable.status, 200);
  assert.equal(readable.body.entries[0].kind, 'client.unhandledrejection');

  const attributed = await request(app, {
    method: 'POST',
    requestPath: '/api/client-errors',
    token: login.body.token,
    body: { kind: 'api-response', message: '生成失败', source: '/api/chat', method: 'POST', status: 502, path: '/script' }
  });
  assert.equal(attributed.status, 202);
  const attributedEntry = errorLogStore.list()[0];
  assert.equal(attributedEntry.username, 'choushiyiguai');
  assert.equal(attributedEntry.method, 'POST');
  assert.equal(attributedEntry.status, 502);
});

test('browser runtime reports rendering, async, and API failures without exposing request credentials', () => {
  const reporter = read('frontend/src/shared/error-reporting.js');
  const client = read('frontend/src/shared/api/client.js');
  const main = read('frontend/src/user/main.jsx');

  assert.match(reporter, /window\.addEventListener\('error'/);
  assert.match(reporter, /window\.addEventListener\('unhandledrejection'/);
  assert.match(reporter, /fetch\('\/api\/client-errors'/);
  assert.match(reporter, /Authorization.*Bearer/);
  assert.match(client, /reportClientError/);
  assert.match(client, /status: response\.status/);
  assert.match(main, /installClientErrorReporting/);
});

test('admin console exposes a dedicated error log page backed by the owner-only API', () => {
  const app = read('frontend/src/admin/App.jsx');
  const dashboard = read('frontend/src/admin/pages/DashboardPage.jsx');
  const page = read('frontend/src/admin/pages/ErrorLogPage.jsx');

  assert.match(app, /'\/admin\/error-logs'/);
  assert.match(dashboard, /\/admin\/error-logs/);
  assert.match(page, /listAdminErrorLogs/);
  assert.match(page, /错误日志/);
});

test('logged-in users can read only their own automatically recorded API failures', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-user-issues-'));
  const errorLogStore = createErrorLogStore({ filePath: path.join(tempDir, 'error-logs.json') });
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const app = createApp({ errorLogStore });

  const owner = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'choushiyiguai', password: '123456' } });
  const user = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'choushiyiguai1', password: '123456' } });
  errorLogStore.record({ kind: 'client.api-response', message: '用户自己的错误', username: 'choushiyiguai1', path: '/script' });
  errorLogStore.record({ kind: 'server.unhandled', message: '其他用户错误', username: 'choushiyiguai', path: '/settings' });

  const mine = await request(app, { requestPath: '/api/client-errors/mine', token: user.body.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.entries.length, 1);
  assert.equal(mine.body.entries[0].message, '用户自己的错误');
  assert.equal(mine.body.entries[0].stack, undefined);

  assert.equal(owner.status, 200);
});

test('user workspace provides a read-only system log route for automatically recorded failures', () => {
  const app = read('frontend/src/user/App.jsx');
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const page = read('frontend/src/user/pages/IssueLogPage.jsx');
  const pages = read('routes/pages.js');

  assert.match(app, /'\/issues'/);
  assert.match(app, /import\('\.\/pages\/IssueLogPage'\)\.then\(module => \(\{ default: module\.IssueLogPage \}\)\)/);
  assert.match(layout, /问题日志/);
  assert.match(page, /listMyErrorLogs/);
  assert.match(page, /系统自动记录/);
  assert.doesNotMatch(page, /反馈问题|submitIssueReport|Drawer/);
  assert.doesNotMatch(read('frontend/src/shared/api/client.js'), /submitIssueReport/);
  assert.match(pages, /router\.get\('\/issues'/);
});

test('API client records authentication failures with their status before expiring the local session', () => {
  const client = read('frontend/src/shared/api/client.js');
  assert.match(client, /if \(response\.status === 401[\s\S]*?kind: 'api-response'[\s\S]*?status: response\.status[\s\S]*?reportClientError\(failure\)/);
});

test('API failures notify the user through one readable confirmation dialog while preserving diagnostic details in logs', () => {
  const client = read('frontend/src/shared/api/client.js');
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');

  assert.match(client, /new CustomEvent\('qiantie:api-error'/);
  assert.match(client, /status: response\.status/);
  assert.match(layout, /qiantie:api-error/);
  assert.match(layout, /Modal\.error/);
  assert.match(layout, /确定/);
});
