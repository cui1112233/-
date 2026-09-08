const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'frontend', 'src', 'shared', 'api', 'novelFetch.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const fetchRouteSource = fs.readFileSync(path.join(root, 'routes', 'novel-fetch.js'), 'utf8');
const uploadRouteSource = fs.readFileSync(path.join(root, 'routes', 'novel-fetch-upload.js'), 'utf8');
const batchRewriteSource = fs.readFileSync(path.join(root, 'routes', 'batch-rewrite.js'), 'utf8');

function count(source, pattern) {
  return (source.match(pattern) || []).length;
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
