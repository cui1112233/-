const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('V2 page injects a shared runtime before feature scripts', () => {
  const fs = require('node:fs');
  const page = read('lib/novel-fetch-workshop/v2-page.js');
  assert.match(page, /v78-novel-fetch-v2-runtime\.js/);
  assert.match(page, /qiantie-novel-fetch-runtime/);
  assert.match(page, /APP_SCRIPT_TAG_RE/);
  assert.match(page, /source\.replace\(APP_SCRIPT_TAG_RE, `\$\{RUNTIME_TAG\}/);
  const { injectNovelFetchV2Script } = require(path.join(root, 'lib/novel-fetch-workshop/v2-page.js'));
  const html = fs.readFileSync(path.join(root, 'frontend/public/batch-rewrite/index.html'), 'utf8');
  const injected = injectNovelFetchV2Script(html);
  assert.ok(injected.indexOf('v78-novel-fetch-v2-runtime.js') < injected.indexOf('app.js?v='));
  assert.ok(injected.indexOf('app.js?v=') < injected.indexOf('v78-novel-fetch-v2.js'));
});

test('runtime provides single-flight requests and activity-aware polling', () => {
  const runtime = read('public/batch-rewrite/v78-novel-fetch-v2-runtime.js');
  assert.match(runtime, /singleFlight/);
  assert.match(runtime, /inFlight/);
  assert.match(runtime, /5000/);
  assert.match(runtime, /If-None-Match/);
  assert.match(runtime, /response\.status === 304/);
  assert.match(runtime, /resource === '\/config'.*invalidate\('\/bootstrap'\)/s);
  assert.match(runtime, /syncAuthScope/);
  assert.match(runtime, /scope:\$\{authScope\}/);
  assert.match(runtime, /stopPolling/);
  assert.match(runtime, /isActiveTask/);
});

test('startup uses a lightweight bootstrap config and avoids eager full config', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  const html = read('frontend/public/batch-rewrite/index.html');
  const config = read('public/batch-rewrite/v78-novel-fetch-v2-config.js');
  assert.match(app, /\/api\/bootstrap/);
  assert.match(app, /knowledge_loaded \? \{ knowledge: state\.config\.knowledge/);
  assert.match(html, /app\.js\?v=20260916-performance-r1/);
  assert.match(config, /loadAdvancedConfig/);
  assert.match(config, /data-tab=\\?\"config/);
});

test('knowledge tab lazily loads the full config before rendering its libraries', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /async function ensureKnowledgeLoaded\(\)/);
  assert.match(app, /api\("\/api\/config"\)/);
  assert.match(app, /knowledge_loaded: true/);
  const ensureBody = app.match(/async function ensureKnowledgeLoaded\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(ensureBody, /renderKnowledgeSummary\(state\.config\.knowledge_summary \|\| \{\}\)/);
  assert.match(app, /await ensureKnowledgeLoaded\(\);\s*renderLibraryManager/s);
});

test('batch rewrite config has user cache and ETag support', () => {
  const routes = read('routes/batch-rewrite.js');
  assert.match(routes, /CONFIG_CACHE_TTL_MS/);
  assert.match(routes, /if-none-match/);
  assert.match(routes, /ETag/);
  assert.match(routes, /router\.get\('\/bootstrap'/);
});

test('batch rewrite static assets use a short public cache while HTML stays uncached', () => {
  const app = read('app.js');
  assert.match(app, /public, max-age=300/);
  assert.match(app, /no-store, no-cache/);
});

test('one refresh coordinator owns activity polling', () => {
  const client = read('public/batch-rewrite/v78-novel-fetch-v2.js');
  const layout = read('public/batch-rewrite/v78-novel-fetch-v2-layout.js');
  assert.match(client, /refreshAllData/);
  assert.match(client, /startPolling/);
  assert.match(client, /stopPolling/);
  assert.doesNotMatch(layout, /setInterval\(refreshImageLayoutData/);
});

test('novel fetch iframe is visible beneath the loading skeleton', () => {
  const css = read('frontend/src/user/pages/novel-fetch.css');
  assert.doesNotMatch(css, /novel-fetch-frame-shell \.novel-fetch-original-workbench \{ opacity: 0;/);
  assert.match(css, /novel-fetch-loading-overlay/);
});
