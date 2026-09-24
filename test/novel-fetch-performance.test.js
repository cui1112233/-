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
  assert.ok(injected.indexOf('app.js?v=20260922-retry-progress-r1') < injected.indexOf('v78-novel-fetch-v2.js'));
  assert.match(injected, /app\.js\?v=20260922-retry-progress-r1/);
  assert.match(injected, /v78-novel-fetch-v2\.js\?v=20260925-processing-flow-r1/);
  assert.match(injected, /v78-novel-fetch-v2-run-controls\.js\?v=20260925-text-model-surface-r1/);
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
  assert.match(runtime, /controllers/);
  assert.match(runtime, /function cancel\(key\)/);
});

test('V2 injection normalizes duplicate managed scripts', () => {
  const { injectNovelFetchV2Script } = require(path.join(root, 'lib/novel-fetch-workshop/v2-page.js'));
  const source = '<html><body><script id="qiantie-novel-fetch-task-visibility" src="/batch-rewrite/task-visibility-hotfix.js"></script><script id="qiantie-novel-fetch-task-visibility" src="/batch-rewrite/task-visibility-hotfix.js"></script></body></html>';
  const injected = injectNovelFetchV2Script(source);
  assert.equal((injected.match(/qiantie-novel-fetch-task-visibility/g) || []).length, 1);
});

test('retry status shows deduplicated work and shared pool capacity', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /result\.deduplicated/);
  assert.match(app, /result\.throughput/);
});

test('startup uses a lightweight bootstrap config and avoids eager full config', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  const html = read('frontend/public/batch-rewrite/index.html');
  const config = read('public/batch-rewrite/v78-novel-fetch-v2-config.js');
  assert.match(app, /\/api\/bootstrap/);
  assert.match(app, /knowledge_loaded \? \{ knowledge: state\.config\.knowledge/);
  assert.match(html, /app\.js\?v=20260922-real-date-filter-r1/);
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

test('knowledge tab retains visible zero counts and clears its loading status after a full load', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  const ensureBody = app.match(/async function ensureKnowledgeLoaded\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(app, /String\(value \?\? ""\)/);
  assert.match(ensureBody, /status\.textContent = ""/);
});

test('legacy high-imitation items are visible in the reference library', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  const knowledgeBody = app.match(/function ensureKnowledgeConfig\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(knowledgeBody, /high\.references = asArray\(high\.references\)/);
  assert.match(knowledgeBody, /high\.items/);
  assert.match(knowledgeBody, /reference_text/);
  assert.match(app, /return references\.length \? references : asArray\(high\.items\)/);
});

test('保存普通配置不会把尚未加载的知识库标记为已加载', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /function mergeConfigResponse\(nextConfig\)/);
  assert.match(app, /const knowledgeLoaded = state\.config\?\.knowledge_loaded === true \|\| nextConfig\?\.knowledge_loaded === true/);
  assert.match(app, /knowledge_loaded: knowledgeLoaded/);
});

test('中央模型保存返回完整配置后同步重绘知识库概览', () => {
  const app = read('frontend/public/batch-rewrite/app.js');
  const persistBody = app.match(/async function persistSelectedTextModel\(modelId\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(app, /function mergeConfigResponse\(nextConfig\) \{[\s\S]*renderKnowledgeSummary\(state\.config\.knowledge_summary \|\| \{\}\)/);
  assert.match(persistBody, /mergeConfigResponse\(\{ \.\.\.state\.config, \.\.\.result\.config \}\)/);
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

test('V2 layout script has an explicit cache version for network-submit fixes', () => {
  const { injectNovelFetchV2Script } = require(path.join(root, 'lib/novel-fetch-workshop/v2-page.js'));
  const injected = injectNovelFetchV2Script('<html><body></body></html>');
  assert.match(injected, /v78-novel-fetch-v2-layout\.js\?v=20260917-submit-bridge-r1/);
});

test('network-submit shortcut calls the explicit selected-task submit bridge', () => {
  const layout = read('public/batch-rewrite/v78-novel-fetch-v2-layout.js');
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(app, /window\.qiantieSubmitSelectedTasks\s*=\s*ids\s*=>\s*void submitWebSubmit\(\"selected\", ids\)/);
  assert.match(layout, /window\.qiantieSubmitSelectedTasks\?\.\(/);
  assert.doesNotMatch(layout, /targetId === 'openWebSubmitBtn'\) target\?\.click\(\)/);
});

test('V2 parsed-book selections synchronize with the network-submit task selection', () => {
  const client = read('public/batch-rewrite/v78-novel-fetch-v2.js');
  const app = read('frontend/public/batch-rewrite/app.js');
  assert.match(client, /qiantie-v78-task-selection/);
  assert.match(client, /detail:\s*\{\s*ids\s*\}/);
  assert.match(client, /qiantieV78SelectedTaskIds/);
  assert.match(app, /addEventListener\("qiantie-v78-task-selection"/);
  assert.match(app, /state\.selectedIds = new Set/);
  assert.match(app, /qiantieSubmitSelectedTasks = ids => void submitWebSubmit\("selected", ids\)/);
  assert.match(app, /webSubmitRequestPayload\(mode, force = false, explicitIds = null/);
});

test('manual start is captured by the V2 workflow so the legacy handler cannot append work to the queue tail', () => {
  const client = read('public/batch-rewrite/v78-novel-fetch-v2.js');
  assert.match(client, /function bindV2ProcessButton\(button\)/);
  assert.match(client, /button\.addEventListener\('click',\s*event\s*=>\s*\{/);
  assert.match(client, /event\.stopImmediatePropagation\(\)/);
  assert.match(client, /void startSelectedProcessing\(\)/);
});

test('processing controls mount the saved text-model selector in the final compact run surface', () => {
  const client = read('public/batch-rewrite/v78-novel-fetch-v2.js');
  const controls = read('public/batch-rewrite/v78-novel-fetch-v2-run-controls.js');
  assert.match(controls, /v78RunTextModel/);
  assert.match(controls, /window\.persistSelectedTextModel/);
  assert.match(client, /text_model_id:\s*\(byId\('v78RunTextModel'\)\?\.value \|\| byId\('v78ProcessingTextModel'\)/);
});

test('task page exposes queue summary scopes and current-job progress', () => {
  const client = read('public/batch-rewrite/v78-novel-fetch-v2.js');
  assert.match(client, /v78QueueSummary/);
  assert.match(client, /当前批次/);
  assert.match(client, /历史未完成/);
  assert.match(client, /seenProgressKeys/);
});

test('network submit rejects an empty selected-task request instead of reporting zero groups complete', () => {
  const routes = read('routes/batch-rewrite.js');
  const v2Service = read('lib/novel-fetch-workshop/121-web-submit-service.js');
  const targetSubmit = read('lib/novel-fetch-workshop/target-web-submit.js');
  assert.match(routes, /body\?\.mode === 'selected' && !ids\.length/);
  assert.match(routes, /没有收到选中的任务/);
  assert.match(v2Service, /body\?\.mode === 'selected' && !ids\.length/);
  assert.match(targetSubmit, /const ids = unique\(body\.ids\);\s*if \(!ids\.length\)/s);
  assert.match(v2Service, /MIN_TARGET_TEXT_BYTES = 3 \* 1024/);
  assert.match(v2Service, /groupKey = .*candidate\.version/s);
});

test('novel fetch iframe is visible beneath the loading skeleton', () => {
  const css = read('frontend/src/user/pages/novel-fetch.css');
  assert.doesNotMatch(css, /novel-fetch-frame-shell \.novel-fetch-original-workbench \{ opacity: 0;/);
  assert.match(css, /novel-fetch-loading-overlay/);
});

test('public novel fetch loads the V2-enhanced workbench instead of the bare static file', () => {
  const page = read('frontend/src/user/pages/NovelFetchPage.jsx');
  const server = read('app.js');
  assert.match(page, /src=\{`\/batch-rewrite\/v2\?theme=/);
  assert.match(server, /createNovelFetchV2PageMiddleware/);
  assert.match(server, /app\.get\('\/batch-rewrite\/v2'/);
});
