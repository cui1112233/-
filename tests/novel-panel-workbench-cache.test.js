const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildWorkbenchManifest } = require('../lib/novel-panel/workbench-assets');
const { createNovelPanelPageRouter } = require('../routes/novel-panel-page');

const immutableCache = 'public, max-age=31536000, immutable';
const revalidateCache = 'private, max-age=0, must-revalidate';
const realWorkbenchRoot = path.join(__dirname, '..', 'public', 'novel-panel', 'workbench');

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workbench-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'clean-core'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), [
    '<!doctype html><html><head>',
    '<link rel="stylesheet" href="/novel-panel/workbench/style.css">',
    '</head><body><main id="novelText"></main>',
    '<!-- V78 Stable production marker -->',
    '<script>window.__VIDEO_PROMPT_TOOL_BUILD__={version:"v78"};</script>',
    '<script src="/novel-panel/workbench/bridge.js"></script>',
    '<script src="/novel-panel/workbench/app.js"></script>',
    '<script src="/novel-panel/workbench/clean-core/runtime.js"></script>',
    '</body></html>'
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'style.css'), 'body{}\n');
  fs.writeFileSync(path.join(root, 'bridge.js'), 'window.bridge=true;\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'window.app=true;\n');
  fs.writeFileSync(path.join(root, 'clean-core', 'runtime.js'), 'window.runtime=true;\n');
  return root;
}

function createServer(t, root, options = {}) {
  const app = express();
  app.use('/novel-panel', createNovelPanelPageRouter({ workbenchRoot: root, ...options }));
  const server = http.createServer(app);
  t.after(() => new Promise(resolve => server.close(resolve)));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function localResources(html) {
  return [...html.matchAll(/(?:src|href)=["'](\/novel-panel\/workbench\/[^"']+)["']/g)].map(match => match[1]);
}

test('delivered HTML versions every local JS/CSS resource and each hash URL has immutable verified bytes', async t => {
  const root = realWorkbenchRoot;
  const manifest = buildWorkbenchManifest(root);
  const baseUrl = await createServer(t, root);

  const page = await fetch(`${baseUrl}/novel-panel/workbench`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get('cache-control') || '', /no-store/);
  assert.match(page.headers.get('content-security-policy') || '', /sandbox allow-scripts/);
  assert.match(html, /V78 Stable production marker/);
  assert.ok(html.indexOf('window.__VIDEO_PROMPT_TOOL_BUILD__') < html.indexOf('bridge.js?v='));
  assert.ok(html.indexOf('bridge.js?v=') < html.indexOf('app.js?v='));

  const resources = localResources(html);
  assert.equal(resources.length, Object.keys(manifest.assets).length);
  for (const resourceUrl of resources) {
    const response = await fetch(`${baseUrl}${resourceUrl}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const relativePath = new URL(resourceUrl, baseUrl).pathname.replace('/novel-panel/workbench/', '');
    assert.equal(response.status, 200, resourceUrl);
    assert.ok(bytes.length > 0, resourceUrl);
    assert.equal(response.headers.get('cache-control'), immutableCache, resourceUrl);
    assert.equal(bytes.length, manifest.assets[relativePath].bytes, resourceUrl);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.assets[relativePath].sha256, resourceUrl);
  }
});

test('non-versioned and mismatched asset URLs retain the safe revalidation policy', async t => {
  const root = createFixture(t);
  const baseUrl = await createServer(t, root);

  for (const requestPath of [
    '/novel-panel/workbench/app.js',
    '/novel-panel/workbench/app.js?v=0000000000000000'
  ]) {
    const response = await fetch(`${baseUrl}${requestPath}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), revalidateCache);
  }
});

test('an absent manifest serves original URLs and emits an actionable fallback diagnostic', async t => {
  const root = createFixture(t);
  const diagnostics = [];
  const baseUrl = await createServer(t, root, {
    manifest: null,
    logger: { error: message => diagnostics.push(message) }
  });

  const response = await fetch(`${baseUrl}/novel-panel/workbench/index.html`);
  const html = await response.text();
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.match(html, /src="\/novel-panel\/workbench\/app\.js"/);
  assert.doesNotMatch(html, /app\.js\?v=/);
  assert.ok(diagnostics.some(message => /manifest/i.test(message) && /revalidation/i.test(message)));
});

test('asset drift cannot retain immutable caching or stale versioned HTML', async t => {
  const root = createFixture(t);
  const manifest = buildWorkbenchManifest(root);
  const diagnostics = [];
  const baseUrl = await createServer(t, root, {
    manifest,
    logger: { error: message => diagnostics.push(message) }
  });
  const oldHash = manifest.assets['app.js'].sha256.slice(0, 16);
  fs.writeFileSync(path.join(root, 'app.js'), 'window.app=false;\n');

  const asset = await fetch(`${baseUrl}/novel-panel/workbench/app.js?v=${oldHash}`);
  assert.equal(asset.headers.get('cache-control'), revalidateCache);
  const page = await fetch(`${baseUrl}/novel-panel/workbench`);
  const html = await page.text();
  assert.match(html, /src="\/novel-panel\/workbench\/app\.js"/);
  assert.doesNotMatch(html, new RegExp(`app\\.js\\?v=${oldHash}`));
  assert.ok(diagnostics.some(message => /changed/i.test(message) && /restart|regenerate/i.test(message)));
});
