const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const compose = fs.readFileSync(path.join(root, 'deploy/v88-public/docker-compose.yml'), 'utf8');
const reviewCompose = fs.readFileSync(path.join(root, 'docker-compose.v88-review.yml'), 'utf8');
const reviewEnv = fs.readFileSync(path.join(root, '.env.v88-review.example'), 'utf8');
const webSubmit = fs.readFileSync(path.join(root, 'lib/novel-fetch-workshop/121-web-submit-service.js'), 'utf8');
const browserClient = fs.readFileSync(path.join(root, 'lib/novel-fetch-workshop/121-browser-client.js'), 'utf8');
const composition = fs.readFileSync(path.join(root, 'lib/novel-fetch-workshop/v2-compose.js'), 'utf8');

test('V88 keeps the private Worker available without making it the default login path', () => {
  assert.match(compose, /^  browser-worker:/m);
  assert.match(compose, /QIANTIE_121_BROWSER_WORKER_URL: http:\/\/browser-worker:8787/);
  assert.match(compose, /^      - browser-worker$/m);
  assert.match(compose, /^  browser_sessions:/m);
  assert.match(reviewCompose, /novel-fetch-121-worker|QIANTIE_121_BROWSER_WORKER_URL|QIANTIE_121_WORKER_SECRET/);
  assert.match(reviewEnv, /QIANTIE_V88_WORKER_DATA_DIR|QIANTIE_V88_WORKER_IMAGE|QIANTIE_V88_121_WORKER_SECRET|QIANTIE_V88_121_STORAGE_STATE_SECRET/);
  assert.equal(fs.existsSync(path.join(root, 'deploy/v88-public/docker-compose.browser-worker.yml')), true);
});

test('121 status checks preserve the direct API compatibility label', () => {
  assert.match(webSubmit, /视频管理系统接口/);
});

test('121 direct API client is the default and Worker requires explicit opt-in', () => {
  assert.match(browserClient, /TARGET_LOGIN_PATH/);
  assert.match(browserClient, /buildLoginRequest/);
  assert.match(browserClient, /TARGET_UPLOAD_PATH/);
  assert.match(browserClient, /httpClient/);
  assert.doesNotMatch(browserClient, /QIANTIE_121_BROWSER_WORKER_URL/);
  assert.match(composition, /QIANTIE_121_USE_BROWSER_WORKER/);
  assert.match(composition, /121-browser-client/);
  assert.match(composition, /121-browser-worker-client/);
});
