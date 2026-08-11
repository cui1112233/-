const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');

const root = path.resolve(__dirname, '..');
const workbenchRoot = path.join(root, 'public', 'novel-panel', 'workbench');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    const finish = (error, response) => {
      server.close(closeError => {
        if (error || closeError) reject(error || closeError);
        else resolve(response);
      });
    };

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => finish(null, {
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
        }));
      });
      request.once('error', error => finish(error));
      if (payload) request.write(payload);
      request.end();
    });
  });
}

function requestRaw(app, requestPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const finish = (error, response) => {
      server.close(closeError => {
        if (error || closeError) reject(error || closeError);
        else resolve(response);
      });
    };

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      http.get({ hostname: '127.0.0.1', port: server.address().port, path: requestPath }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => finish(null, {
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        }));
      }).once('error', error => finish(error));
    });
  });
}

function writeFakeV77Source(sourceRoot) {
  fs.mkdirSync(path.join(sourceRoot, 'templates'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'static', 'character-core'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'templates', 'index.html'), [
    '<link rel="stylesheet" href="/static/style.css?v={{ asset_version }}" />',
    '<script>if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(() => {}).catch(() => {});\nif ("caches" in window) caches.keys().then(() => {}).catch(() => {});</script>',
    '<script src="/static/outline-quality-gate.js?v={{ asset_version }}"></script>',
    '<script src="/static/app.js?v={{ asset_version }}"></script>',
    '<script src="/static/character-core/character-core.js?v={{ asset_version }}"></script>'
  ].join('\n'));
  fs.writeFileSync(path.join(sourceRoot, 'static', 'style.css'), 'body{}');
  fs.writeFileSync(path.join(sourceRoot, 'static', 'app.js'), 'window.app = true;');
  fs.writeFileSync(path.join(sourceRoot, 'static', 'outline-quality-gate.js'), 'window.gate = true;');
  fs.writeFileSync(path.join(sourceRoot, 'static', 'character-core', 'character-core.js'), 'window.core = true;');
}

function readTree(rootPath) {
  const entries = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const filePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) entries.push(...readTree(filePath).map(item => `${entry.name}/${item}`));
    else entries.push(`${entry.name}:${fs.readFileSync(filePath, 'utf8')}`);
  }
  return entries;
}

test('synced V77 workbench keeps its required controls and local assets', () => {
  const html = fs.readFileSync(path.join(workbenchRoot, 'index.html'), 'utf8');
  const requiredIds = [
    'novelText', 'characterGuideInput', 'appearanceReference', 'analyzeBtn',
    'optimizeAllCharactersBtn', 'characters', 'relationshipGraphList', 'outlineBtn',
    'scenes', 'outputs', 'mergeBtn', 'segments', 'instructionCenterPage',
    'settingsDialog', 'historyDialog', 'ttsDialog'
  ];
  const requiredAssetPaths = [
    '/novel-panel/workbench/style.css',
    '/novel-panel/workbench/outline-quality-gate.js',
    '/novel-panel/workbench/app.js',
    '/novel-panel/workbench/character-core/character-core.js'
  ];

  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing V77 control #${id}`);
  }
  for (const assetPath of requiredAssetPaths) {
    assert.match(html, new RegExp(`(?:href|src)=["']${assetPath}["']`), `missing local asset ${assetPath}`);
  }
  assert.match(html, /src=["']\/novel-panel\/workbench\/bridge\.js["']/);
  assert.doesNotMatch(html, /\{\{\s*asset_version\s*\}\}/);
  assert.doesNotMatch(html, /getRegistrations|caches\.keys/);

  const bundle = [
    html,
    fs.readFileSync(path.join(workbenchRoot, 'bridge.js'), 'utf8'),
    fs.readFileSync(path.join(workbenchRoot, 'app.js'), 'utf8'),
    fs.readFileSync(path.join(workbenchRoot, 'outline-quality-gate.js'), 'utf8'),
    fs.readFileSync(path.join(workbenchRoot, 'character-core', 'character-core.js'), 'utf8')
  ].join('\n');
  assert.doesNotMatch(bundle, /127\.0\.0\.1|8818|\.exe(?:\s|["'`]|$)/i);
});

test('sync keeps the existing workbench on source failure and produces stable output', t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-sync-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const sourceRoot = path.join(tempRoot, 'source');
  const targetRoot = path.join(tempRoot, 'public', 'novel-panel', 'workbench');
  const scriptPath = path.join(tempRoot, 'scripts', 'sync-novel-panel-assets.js');
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts', 'sync-novel-panel-assets.js'), scriptPath);
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(path.join(targetRoot, 'sentinel.txt'), 'retain-this-exactly');

  const runSync = () => spawnSync(process.execPath, [scriptPath], {
    cwd: tempRoot,
    env: { ...process.env, NOVEL_PANEL_V77_SOURCE: sourceRoot },
    encoding: 'utf8'
  });

  const failed = runSync();
  assert.notEqual(failed.status, 0);
  assert.equal(fs.readFileSync(path.join(targetRoot, 'sentinel.txt'), 'utf8'), 'retain-this-exactly');

  writeFakeV77Source(sourceRoot);
  assert.equal(runSync().status, 0);
  const first = readTree(targetRoot);
  assert.equal(runSync().status, 0);
  assert.deepEqual(readTree(targetRoot), first);
  assert.doesNotMatch(fs.readFileSync(path.join(targetRoot, 'index.html'), 'utf8'), /getRegistrations|caches\.keys/);

  fs.writeFileSync(path.join(sourceRoot, 'templates', 'index.html'), '<script src="/static/app.js"></script>');
  assert.notEqual(runSync().status, 0);
  assert.deepEqual(readTree(targetRoot), first);
});

test('qiantie navigation renders the V77 workbench in a same-origin iframe', () => {
  const userApp = read('frontend/src/user/App.jsx');
  const userLayout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const novelPanelPage = read('frontend/src/user/pages/NovelPanelPage.jsx');
  const pagesRouter = read('routes/pages.js');

  assert.match(userApp, /pathname === '\/novel-panel'/);
  assert.match(userLayout, /href: '\/novel-panel'/);
  assert.match(novelPanelPage, /<iframe/);
  assert.match(novelPanelPage, /const workbenchSrc =/);
  assert.match(novelPanelPage, /src=\{workbenchSrc\}/);
  assert.match(novelPanelPage, /sandbox="allow-scripts allow-forms allow-downloads allow-modals"/);
  assert.match(novelPanelPage, /event\.source !== frameRef\.current\?\.contentWindow/);
  assert.match(novelPanelPage, /startsWith\('\/api\/novel-panel\/'\)/);
  assert.match(novelPanelPage, /MessageChannel/);
  assert.match(novelPanelPage, /handshakeConsumedRef/);
  assert.match(novelPanelPage, /handshakeConsumedRef\.current \|\|/);
  assert.match(novelPanelPage, /data\.nonce !== sessionNonceRef\.current/);
  assert.match(novelPanelPage, /port1\.onmessage/);
  assert.match(novelPanelPage, /portRef\.current\.close\(\)/);
  assert.match(novelPanelPage, /port !== portRef\.current/);
  assert.match(novelPanelPage, /event\.source\.postMessage\(\{ type: 'qiantie-v77-port'/);
  assert.match(novelPanelPage, /target\.postMessage\(\{ type: 'novel-panel-api-response', id, \.\.\.response \}\)/);
  assert.doesNotMatch(novelPanelPage, /target\.postMessage\(\{ type: 'novel-panel-api-response'[\s\S]{0,160}'\*'/);
  assert.match(novelPanelPage, /useLayoutEffect/);
  assert.match(pagesRouter, /router\.get\('\/novel-panel'/);
});

test('workbench and direct index both receive the opaque-origin CSP and revalidate assets', async t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-csp-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const app = createApp({ accountStore: createAccountStore({ systemDir }), tokenMap: new Map() });
  const [workbench, directIndex, stylesheet] = await Promise.all([
    requestRaw(app, '/novel-panel/workbench'),
    requestRaw(app, '/novel-panel/workbench/index.html'),
    requestRaw(app, '/novel-panel/workbench/style.css')
  ]);
  for (const response of [workbench, directIndex]) {
    assert.equal(response.status, 200);
    assert.match(response.headers['content-security-policy'] || '', /sandbox allow-scripts allow-forms allow-downloads allow-modals/);
    assert.match(response.headers['cache-control'] || '', /no-store/);
  }
  assert.equal(stylesheet.status, 200);
  assert.equal(stylesheet.headers['cache-control'], 'private, max-age=0, must-revalidate');
});

test('novel-panel API requires Bearer authentication and honestly reports pending handlers', async t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-api-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const app = createApp({ accountStore: createAccountStore({ systemDir }), tokenMap: new Map() });
  const login = await request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username: 'choushiyiguai', password: '123456' }
  });
  assert.equal(login.status, 200);

  const unauthenticated = await request(app, { method: 'POST', requestPath: '/api/novel-panel/analyze' });
  assert.equal(unauthenticated.status, 401);

  const pending = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/analyze',
    token: login.body.token
  });
  assert.equal(pending.status, 501);
  assert.deepEqual(pending.body, {
    error: 'Novel panel API is not available yet',
    code: 'NOVEL_PANEL_API_PENDING'
  });
});

test('bridge retries its nonce handshake, then keeps API bodies off window messages', async () => {
  const nativeFetchCalls = [];
  const handshakeMessages = [];
  const beaconCalls = [];
  const windowListeners = { message: [], pagehide: [], beforeunload: [] };
  const retryTimers = new Map();
  const clearedTimers = [];
  let nextTimerId = 1;
  const nativeFetch = (...args) => {
    nativeFetchCalls.push(args);
    return Promise.resolve({ ok: true });
  };
  const navigator = {
    sendBeacon(...args) {
      beaconCalls.push(args);
      return false;
    }
  };
  const context = {
    window: {
      location: { href: 'https://qiantie.test/novel-panel/workbench?nonce=nonce-1', search: '?nonce=nonce-1' },
      fetch: nativeFetch,
      parent: { postMessage: (...args) => handshakeMessages.push(args) },
      addEventListener: () => {}
    },
    navigator,
    URL,
    URLSearchParams,
    Headers,
    Request,
    Blob,
    Response,
    MessageChannel: class MessageChannel {
      constructor() {
        this.port1 = { posted: [], close() { this.closed = true; }, start() {} };
        this.port2 = { posted: [], close() { this.closed = true; }, start() {} };
      }
    },
    Promise,
    setTimeout,
    clearTimeout,
    setInterval(callback, delay) {
      const id = nextTimerId++;
      retryTimers.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) {
      clearedTimers.push(id);
      retryTimers.delete(id);
    }
  };
  context.window.addEventListener = (type, listener) => {
    windowListeners[type]?.push(listener);
  };
  vm.createContext(context);
  const bridge = fs.readFileSync(path.join(workbenchRoot, 'bridge.js'), 'utf8');
  assert.doesNotMatch(bridge, /auth_token|localStorage/);
  vm.runInContext(bridge, context);
  assert.equal(handshakeMessages.length, 1);
  assert.equal(handshakeMessages[0][0].type, 'qiantie-v77-handshake');
  assert.equal(handshakeMessages[0][0].nonce, 'nonce-1');
  assert.equal(retryTimers.size, 1);
  const retry = [...retryTimers.values()][0];
  assert.equal(retry.delay, 150);

  // The initial handshake has no parent listener. The retry is the first one it receives.
  retry.callback();
  assert.equal(handshakeMessages.length, 2);

  const childPort = {
    posted: [],
    postMessage(message) { this.posted.push(message); },
    close() { this.closed = true; },
    start() {}
  };
  for (const listener of windowListeners.message) {
    listener({
      source: context.window.parent,
      data: { type: 'qiantie-v77-port', nonce: 'nonce-1' },
      ports: [childPort]
    });
  }
  assert.equal(childPort.started, undefined);
  assert.equal(retryTimers.size, 0);
  assert.equal(clearedTimers.length, 1);

  const stalePort = { posted: [], postMessage(message) { this.posted.push(message); }, close() {}, start() {} };
  for (const listener of windowListeners.message) {
    listener({
      source: context.window.parent,
      data: { type: 'qiantie-v77-port', nonce: 'nonce-1' },
      ports: [stalePort]
    });
  }

  const apiRequest = context.window.fetch('/api/analyze', { method: 'POST', body: '{}' });
  assert.equal(childPort.posted[0].path, '/api/novel-panel/analyze');
  assert.equal(stalePort.posted.length, 0);
  assert.equal(childPort.posted[0].method, 'POST');
  childPort.onmessage({ data: { type: 'novel-panel-api-response', id: childPort.posted[0].id, status: 501, headers: { 'content-type': 'application/json' }, text: '{"error":"pending"}' } });
  const apiResponse = await apiRequest;
  assert.equal(apiResponse.status, 501);
  assert.equal(await apiResponse.text(), '{"error":"pending"}');

  const mappedRequest = context.window.fetch('/api/novel-panel/analyze', { method: 'POST', body: '{}' });
  assert.equal(childPort.posted[1].path, '/api/novel-panel/analyze');
  assert.doesNotMatch(childPort.posted[1].path, /novel-panel\/novel-panel/);
  childPort.onmessage({ data: { type: 'novel-panel-api-response', id: childPort.posted[1].id, status: 501, headers: {}, text: '' } });
  await mappedRequest;

  const nonApiOptions = { method: 'GET' };
  await context.window.fetch('/static/x', nonApiOptions);
  assert.equal(nativeFetchCalls[0][0], '/static/x');
  assert.equal(nativeFetchCalls[0][1], nonApiOptions);

  assert.equal(navigator.sendBeacon('/api/character-core/project-lease', JSON.stringify({ lease: true })), true);
  assert.equal(beaconCalls.length, 0);
  assert.equal(childPort.posted[2].path, '/api/novel-panel/character-core/project-lease');
  assert.equal(childPort.posted[2].method, 'POST');
  childPort.onmessage({ data: { type: 'novel-panel-api-response', id: childPort.posted[2].id, status: 501, headers: {}, text: '' } });

  assert.equal(navigator.sendBeacon('/api/novel-panel/already-routed', 'event'), true);
  assert.equal(childPort.posted[3].path, '/api/novel-panel/already-routed');
  childPort.onmessage({ data: { type: 'novel-panel-api-response', id: childPort.posted[3].id, status: 501, headers: {}, text: '' } });
  assert.equal(beaconCalls.length, 0);

  assert.equal(navigator.sendBeacon('/telemetry', 'event'), false);
  assert.deepEqual(beaconCalls, [['/telemetry', 'event']]);
  assert.equal(handshakeMessages.length, 2);
  assert.equal(windowListeners.pagehide.length, 1);
  assert.equal(windowListeners.beforeunload.length, 1);
  windowListeners.pagehide[0]();
  assert.equal(childPort.closed, true);
  assert.equal(retryTimers.size, 0);
});
