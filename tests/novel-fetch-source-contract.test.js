const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'shared', 'api', 'novelFetch.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const v2RouteSource = fs.readFileSync(path.join(root, 'routes', 'batch-rewrite-v2.js'), 'utf8');
const v2ComposeSource = fs.readFileSync(path.join(root, 'lib', 'novel-fetch-workshop', 'v2-compose.js'), 'utf8');
const fetchRouteSource = fs.readFileSync(path.join(root, 'routes', 'novel-fetch.js'), 'utf8');
const uploadRouteSource = fs.readFileSync(path.join(root, 'routes', 'novel-fetch-upload.js'), 'utf8');
const batchRewriteSource = fs.readFileSync(path.join(root, 'routes', 'batch-rewrite.js'), 'utf8');

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

function countText(source, text) {
  return source.split(text).length - 1;
}

test('novel-fetch frontend actions point at the unique v88 backend mount points', () => {
  const expectedApiPaths = [
    ['/api/novel-fetch', 'fetchNovelContent'],
    ['/api/novel-fetch-upload/upload-login', 'uploadLogin'],
    ['/api/novel-fetch-upload/upload-session', 'getUploadSession'],
    ['/api/novel-fetch-upload/upload-batch', 'uploadBatch'],
    ['/api/batch-rewrite/web-submit/config', 'getWebSubmitConfig'],
    ['/api/batch-rewrite/web-submit/config', 'saveWebSubmitConfig'],
    ['/api/batch-rewrite/web-submit/environment', 'checkWebSubmitEnvironment'],
    ['/api/batch-rewrite/web-submit/sync-configs', 'syncWebSubmitConfigs'],
    ['/api/batch-rewrite/web-submit/sync-styles', 'syncWebSubmitStyles'],
    ['/api/batch-rewrite/web-submit/test-visible', 'testWebSubmitVisible'],
    ['/api/batch-rewrite/web-submit/preview', 'previewWebSubmit'],
    ['/api/batch-rewrite/web-submit/submit', 'startWebSubmit']
  ];

  for (const [apiPath, functionName] of expectedApiPaths) {
    assert.match(apiSource, new RegExp(`function ${functionName}[\\s\\S]*?apiRequest\\('${apiPath.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}'`), `${functionName} must use ${apiPath}`);
  }
  assert.doesNotMatch(apiSource, /\/api\/novel-fetch-web-submit\//, 'frontend must not call an unmounted legacy prefix');

  assert.equal(count(appSource, /app\.use\('\/api\/novel-fetch',\s*createNovelFetchRouter\(/g), 1);
  assert.equal(count(appSource, /app\.use\('\/api\/novel-fetch-upload',\s*createNovelFetchUploadRouter\(/g), 1);
  assert.equal(count(appSource, /app\.use\('\/api\/batch-rewrite',\s*createBatchRewriteRouter\(/g), 1);
  assert.equal(count(fetchRouteSource, /router\.post\('\/'/g), 1, 'original fetch has one route');
  assert.equal(count(uploadRouteSource, /router\.post\('\/upload-login'/g), 1);
  assert.equal(count(uploadRouteSource, /router\.get\('\/upload-session'/g), 1);
  assert.equal(count(uploadRouteSource, /router\.post\('\/upload-batch'/g), 1);
  for (const [method, route] of [
    ['get', '/web-submit/config'],
    ['post', '/web-submit/config'],
    ['get', '/web-submit/environment'],
    ['post', '/web-submit/sync-configs'],
    ['post', '/web-submit/sync-styles'],
    ['post', '/web-submit/test-visible'],
    ['post', '/web-submit/preview'],
    ['post', '/web-submit/submit']
  ]) {
    assert.equal(count(batchRewriteSource, new RegExp(`router\\.${method}\\('${route.replace('/', '\\/')}`)), 1, `${method.toUpperCase()} ${route} must have one backend handler`);
  }
});

test('V2 web-submit is the first and single external handler before the legacy core fallback', () => {
  const attachAt = serverSource.indexOf('attachV78NovelFetchV2({');
  const coreMountAt = serverSource.indexOf('app.use(coreApp);');
  assert.ok(attachAt >= 0, 'server must attach V2');
  assert.ok(coreMountAt > attachAt, 'V2 must run before coreApp fallback');
  assert.equal(count(v2ComposeSource, /shellApp\.use\('\/api\/batch-rewrite'/g), 1);
  assert.equal(count(appSource, /app\.use\('\/api\/batch-rewrite',\s*createBatchRewriteRouter\(/g), 1);
  for (const [method, route] of [
    ['get', '/web-submit/config'],
    ['post', '/web-submit/config'],
    ['get', '/web-submit/environment'],
    ['post', '/web-submit/sync-configs'],
    ['post', '/web-submit/sync-styles'],
    ['post', '/web-submit/test-visible'],
    ['post', '/web-submit/preview'],
    ['post', '/web-submit/submit']
  ]) {
    const routeText = `router.${method}('${route}`;
    assert.equal(countText(v2RouteSource, routeText), 1, `V2 ${method.toUpperCase()} ${route} must have one handler`);
    assert.equal(countText(batchRewriteSource, routeText), 1, `legacy ${method.toUpperCase()} ${route} must remain one fallback handler`);
  }
});

test('V2 web-submit errors use a safe public message instead of returning raw sensitive exception text', async () => {
  const { registerWebSubmitRoutes } = require('../routes/batch-rewrite-v2');
  const routes = [];
  const router = {
    get(route, handler) { routes.push({ method: 'get', route, handler }); return this; },
    post(route, handler) { routes.push({ method: 'post', route, handler }); return this; }
  };
  const webSubmit = { async getConfig() { throw new Error('password=secret-pw Cookie=private-cookie Authorization=private-token'); } };
  registerWebSubmitRoutes(router, webSubmit);
  const endpoint = routes.find(item => item.method === 'get' && item.route === '/web-submit/config');
  const res = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await endpoint.handler({ username: 'alice' }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, '121 操作失败');
  assert.doesNotMatch(JSON.stringify(res.body), /secret-pw|private-cookie|private-token/);
});
