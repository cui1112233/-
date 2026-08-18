process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456', choushiyiguai1: '123456', choushiyiguai2: '123456', choushiyiguai3: '123456', choushiyiguai4: '123456', choushiyiguai5: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

test('novel-panel outline gate and issue page diagnostics remain wired without a new layout', () => {
  const workbench = fs.readFileSync(path.join(__dirname, '..', 'public', 'novel-panel', 'workbench', 'app.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'novel-panel.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'shared', 'api', 'client.js'), 'utf8');
  const issuePage = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'user', 'pages', 'IssueLogPage.jsx'), 'utf8');

  // V78 workbench surfaces AI/API failures through the shared error formatter.
  assert.match(workbench, /formatApiError/);
  assert.match(workbench, /apiError/);

  // Backend outline writes remain protected by the V77-compatible quality gate.
  assert.match(routes, /validateOutlineApplyGate/);
  assert.match(routes, /applied: false/);
  assert.match(routes, /rejected_shots/);

  assert.match(client, /listNovelPanelAiDiagnostics/);
  assert.match(client, /\/api\/novel-panel\/diagnostics/);
  assert.match(issuePage, /listNovelPanelAiDiagnostics/);
  assert.match(issuePage, /diagnostics\.diagnostics/);
});

test('novel workbench routes TTS generation through the authenticated same-origin proxy', () => {
  const workbench = read('public/novel-panel/workbench/app.js');

  assert.match(workbench, /const TTS_API_URL = "\/api\/tts";/);
  assert.doesNotMatch(workbench, /const TTS_API_URL = "http:\/\/tts2\.121w\.com\/v1\/audio\/speech";/);
  assert.match(workbench, /text\(errorData\?\.error\?\.message\) \|\| text\(errorData\?\.message\)/);
});
const vm = require('node:vm');
const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const novelPanelRouter = require('../routes/novel-panel');

const root = path.resolve(__dirname, '..');
const workbenchRoot = path.join(root, 'public', 'novel-panel', 'workbench');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function extractFunctionBody(source, name) {
  const declaration = new RegExp(`(?:function\\s+${name}\\s*\\([^)]*\\)|const\\s+${name}\\s*=\\s*(?:\\([^)]*\\)|[^=()]+)\\s*=>)\\s*\\{`).exec(source);
  assert.ok(declaration, `missing ${name} definition`);
  return extractDelimited(source, declaration.index + declaration[0].lastIndexOf('{'), '{', '}');
}

function extractDelimited(source, start, open, close) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    if (source[index] === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  assert.fail(`unclosed ${open} delimiter`);
}

function extractThemeEffectBody(source) {
  const effects = /useEffect\s*\(\s*\(\)\s*=>\s*\{/g;
  for (let effect = effects.exec(source); effect; effect = effects.exec(source)) {
    const bodyStart = effect.index + effect[0].lastIndexOf('{');
    const body = extractDelimited(source, bodyStart, '{', '}');
    const afterBody = source.slice(bodyStart + body.length + 2, bodyStart + body.length + 96);
    if (/^\s*,\s*\[theme\]\s*\)/.test(afterBody)) return body;
  }
  assert.fail('missing useEffect theme synchronization with [theme] dependency');
}

function exactSelectorRuleBlocks(source, selector) {
  const blocks = [];
  const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, comment => ' '.repeat(comment.length));
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|[{}])\\s*${escapedSelector}\\s*\\{`, 'g');
  for (let match = rule.exec(uncommented); match; match = rule.exec(uncommented)) {
    const openBrace = match.index + match[0].lastIndexOf('{');
    let depth = 1;
    let quote = null;
    let end = openBrace + 1;
    for (; end < uncommented.length && depth > 0; end += 1) {
      const character = uncommented[end];
      if (quote) {
        if (character === '\\') end += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
      }
    }
    if (depth !== 0) assert.fail(`unclosed CSS rule for ${selector}`);
    blocks.push(source.slice(openBrace + 1, end - 1));
  }
  return blocks;
}

function cssDeclarations(block) {
  return new Map([...block.matchAll(/([\w-]+)\s*:\s*([^;{}]+)\s*;/g)].map(([, property, value]) => [property, value.trim()]));
}

function lastExactSelectorRuleBlock(source, selector) {
  const blocks = exactSelectorRuleBlocks(source, selector);
  assert.ok(blocks.length, `missing CSS rule for ${selector}`);
  return blocks.at(-1);
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

function writeFakeV78Source(sourceRoot) {
  fs.mkdirSync(path.join(sourceRoot, 'templates'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'static', 'character-core'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'static', 'clean-core'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'templates', 'index.html'), [
    '<link rel="stylesheet" href="/static/style.css?v={{ asset_version }}" />',
    '<script>if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(() => {}).catch(() => {});\nif ("caches" in window) caches.keys().then(() => {}).catch(() => {});</script>',
    '<script src="/static/app.js?v={{ asset_version }}"></script>',
    '<script src="/static/character-core/character-core.js?v={{ asset_version }}"></script>',
    '<script src="/static/clean-core/release.js?v={{ asset_version }}"></script>',
    '<script src="/static/clean-core/runtime.js?v={{ asset_version }}"></script>'
  ].join('\n'));
  fs.writeFileSync(path.join(sourceRoot, 'static', 'style.css'), 'body{}');
  fs.writeFileSync(path.join(sourceRoot, 'static', 'app.js'), 'const TTS_API_URL = "http://tts2.121w.com/v1/audio/speech";\nwindow.app = true;');
  fs.writeFileSync(path.join(sourceRoot, 'static', 'character-core', 'character-core.js'), 'window.core = true;');
  fs.writeFileSync(path.join(sourceRoot, 'static', 'clean-core', 'release.js'), 'window.release = true;');
  fs.writeFileSync(path.join(sourceRoot, 'static', 'clean-core', 'runtime.js'), 'window.runtime = true;');
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

test('synced V78 workbench keeps its required controls and local assets', () => {
  const html = fs.readFileSync(path.join(workbenchRoot, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(workbenchRoot, 'app.js'), 'utf8');
  const requiredIds = [
    'novelText', 'characterGuideInput', 'appearanceReference', 'analyzeBtn',
    'optimizeAllCharactersBtn', 'characters', 'relationshipGraphList', 'outlineBtn',
    'scenes', 'outputs', 'mergeBtn', 'segments', 'instructionCenterPage',
    'settingsDialog', 'historyPage', 'ttsDialog'
  ];
  const requiredAssetPaths = [
    '/novel-panel/workbench/style.css',
    '/novel-panel/workbench/app.js',
    '/novel-panel/workbench/character-core/character-core.js',
    '/novel-panel/workbench/clean-core/release.js',
    '/novel-panel/workbench/clean-core/runtime.js'
  ];

  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing V78 control #${id}`);
  }
  for (const assetPath of requiredAssetPaths) {
    assert.match(html, new RegExp(`(?:href|src)=["']${assetPath}["']`), `missing local asset ${assetPath}`);
  }
  assert.match(html, /src=["']\/novel-panel\/workbench\/bridge\.js["']/);
  assert.doesNotMatch(html, /\{\{\s*asset_version\s*\}\}/);
  assert.doesNotMatch(html, /getRegistrations|caches\.keys/);
  assert.doesNotMatch(html, /outline-quality-gate\.js/);
  assert.match(appJs, /v78\.3\.0\.2/);

  const bundle = [
    html,
    fs.readFileSync(path.join(workbenchRoot, 'bridge.js'), 'utf8'),
    appJs,
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
  fs.copyFileSync(path.join(root, 'scripts', 'novel-panel-bridge.js'), path.join(tempRoot, 'scripts', 'novel-panel-bridge.js'));
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

  writeFakeV78Source(sourceRoot);
  assert.equal(runSync().status, 0);
  const first = readTree(targetRoot);
  assert.equal(runSync().status, 0);
  assert.deepEqual(readTree(targetRoot), first);
  assert.doesNotMatch(fs.readFileSync(path.join(targetRoot, 'index.html'), 'utf8'), /getRegistrations|caches\.keys/);

  fs.writeFileSync(path.join(sourceRoot, 'templates', 'index.html'), '<script src="/static/app.js"></script>');
  assert.notEqual(runSync().status, 0);
  assert.deepEqual(readTree(targetRoot), first);
});

test('qiantie navigation renders the V78 workbench in a same-origin iframe', () => {
  const userApp = read('frontend/src/user/App.jsx');
  const userLayout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const novelPanelPage = read('frontend/src/user/pages/NovelPanelPage.jsx');
  const bridge = read('public/novel-panel/workbench/bridge.js');
  const style = read('public/novel-panel/workbench/style.css');
  const pagesRouter = read('routes/pages.js');

  assert.match(userApp, /'\/novel-panel': NovelPanelPage/);
  assert.match(userLayout, /href: '\/novel-panel'/);
  assert.match(novelPanelPage, /<iframe/);
  assert.match(novelPanelPage, /const workbenchSrc =/);
  assert.match(novelPanelPage, /src=\{workbenchSrc\}/);
  assert.match(novelPanelPage, /sandbox="allow-scripts allow-forms allow-downloads allow-modals"/);
  const syncThemeBody = extractFunctionBody(novelPanelPage, 'syncTheme');
  const handleFrameLoadBody = extractFunctionBody(novelPanelPage, 'handleFrameLoad');
  const themeEffectBody = extractThemeEffectBody(novelPanelPage);
  assert.match(syncThemeBody, /frame\?\.contentWindow\?\.postMessage\(\s*\{\s*type:\s*'qiantie-theme-sync'\s*,\s*theme:\s*normalizeTheme\(theme\)\s*\}\s*,\s*'\*'\s*\)/);
  assert.doesNotMatch(syncThemeBody, /(?:token|auth|apiKey|project|data)\s*:/i);
  assert.match(novelPanelPage, /onLoad=\{handleFrameLoad\}/);
  assert.match(handleFrameLoadBody, /syncTheme\(frameRef\.current, theme\)/);
  assert.match(themeEffectBody, /syncTheme\(frameRef\.current, theme\)/);
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
  assert.match(novelPanelPage, /window\.addEventListener\('pageshow', handlePageShow\)/);
  assert.match(novelPanelPage, /handshakeConsumedRef\.current = false/);
  assert.match(bridge, /event\.source !== window\.parent/);
  assert.match(bridge, /data\.type !== 'qiantie-theme-sync'/);
  assert.match(bridge, /data\.theme !== 'dark'\s*&&\s*data\.theme !== 'light'/);
  assert.match(bridge, /document\.documentElement\.dataset\.theme = data\.theme/);
  assert.doesNotMatch(bridge, /localStorage\.(?:getItem|setItem)\([^\n]*theme/i);
  assert.match(bridge, /bodyBase64/);
  // The V78 workbench ships a self-contained theme; it still accepts the shell
  // theme attribute without leaking shell state into its own tokens.
  assert.match(style, /:root\s*\{/);
  assert.match(style, /--bg:/);
  assert.match(style, /--surface:/);
  const readyDeclarations = cssDeclarations(lastExactSelectorRuleBlock(style, '.status-pill.ready'));
  assert.equal(readyDeclarations.get('color'), 'var(--success)');
  assert.equal(readyDeclarations.get('border-color'), '#bfe7d7');
  assert.equal(readyDeclarations.get('background'), '#eafff5');
  const outputGroupHeadDeclarations = cssDeclarations(lastExactSelectorRuleBlock(style, '.output-group-head'));
  assert.equal(outputGroupHeadDeclarations.get('color'), '#2f4380');
  assert.match(pagesRouter, /router\.get\('\/novel-panel'/);
});

test('novel-panel iframe uses an isolated instance, guarded local drafts, and abortable bridge requests', () => {
  const novelPanelPage = read('frontend/src/user/pages/NovelPanelPage.jsx');
  const workbench = read('public/novel-panel/workbench/app.js');
  const bridge = read('public/novel-panel/workbench/bridge.js');
  const characterCore = read('public/novel-panel/workbench/character-core/character-core.js');
  const saveDraftBody = extractFunctionBody(workbench, 'scheduleDraftSave');
  const restoreDraftBody = extractFunctionBody(workbench, 'restoreLocalDraft');
  const handleFrameLoadBody = extractFunctionBody(novelPanelPage, 'handleFrameLoad');

  const createInstanceIdBody = extractFunctionBody(novelPanelPage, 'createInstanceId');
  assert.match(createInstanceIdBody, /crypto\?\.randomUUID/);
  assert.match(novelPanelPage, /instanceIdRef\s*=\s*useRef\(createInstanceId\(\)\)/);
  assert.match(novelPanelPage, /&instance=\$\{encodeURIComponent\(instanceIdRef\.current\)\}/);
  assert.match(novelPanelPage, /controllersRef\s*=\s*useRef\(new Map\(\)\)/);
  assert.match(novelPanelPage, /new AbortController\(\)/);
  assert.match(novelPanelPage, /controller\.abort\(/);
  assert.match(novelPanelPage, /data\?\.type === 'novel-panel-api-cancel'/);
  // V78 CharacterCore reads the isolated per-frame instance from the query string.
  assert.match(characterCore, /URLSearchParams\(globalThis\.location\?\.search \|\| ""\)\.get\("instance"\)/);
  assert.match(characterCore, /const currentInstance = \(\) => \{/);
  assert.match(characterCore, /\.get\("instance"\) \|\| new URLSearchParams\(globalThis\.location\?\.search \|\| ""\)\.get\("session"\)/);

  // V78 keeps the local draft guarded so the sandboxed iframe degrades safely
  // instead of throwing on storage access.
  assert.match(saveDraftBody, /localStorage\.setItem\(DRAFT_KEY, serialized\)/);
  assert.match(saveDraftBody, /catch \(error\) \{/);
  assert.match(restoreDraftBody, /localStorage\.getItem/);

  assert.match(bridge, /type:\s*'novel-panel-api-cancel'/);
  assert.match(bridge, /function rejectPendingRequests\(\)[\s\S]*cancelPendingRequest/);
  assert.match(bridge, /API bridge timed out[\s\S]*cancelPendingRequest/);
  assert.match(bridge, /signal\?\.addEventListener\?\.\('abort'/);
  assert.match(bridge, /cancelPendingRequest\(id, createAbortError\(signal\.reason\)\)/);
  assert.match(bridge, /qiantie-v77-bridge-closing/);
  // V78 routes project leases through the authenticated same-origin API.
  assert.match(characterCore, /\/api\/character-core\/project-lease/);
  assert.match(characterCore, /function projectLease\(action="check", projectId=appState\.projectId, force=false\)/);
  assert.match(
    handleFrameLoadBody,
    /portRef\.current\.close\(\);\s*portRef\.current = null;\s*handshakeConsumedRef\.current = false/
  );
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
    const csp = response.headers['content-security-policy'] || '';
    assert.match(csp, /sandbox allow-scripts allow-forms allow-downloads allow-modals/);
    assert.match(csp, /style-src 'self' 'unsafe-inline' http:\/\/127\.0\.0\.1:\d+/);
    assert.match(csp, /script-src 'self' 'unsafe-inline' http:\/\/127\.0\.0\.1:\d+/);
    assert.match(response.headers['cache-control'] || '', /no-store/);
  }
  assert.equal(stylesheet.status, 200);
  assert.equal(stylesheet.headers['cache-control'], 'private, max-age=0, must-revalidate');
});

test('novel-panel API requires Bearer authentication and returns usable settings instead of 501', async t => {
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

  const settings = await request(app, {
    requestPath: '/api/novel-panel/settings',
    token: login.body.token
  });
  assert.equal(settings.status, 200);
  assert.equal(typeof settings.body.api_key_configured, 'boolean');
  assert.equal(typeof settings.body.ai_timeout_seconds, 'number');

  const savedSettings = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/settings',
    token: login.body.token,
    body: { ai_timeout_seconds: 400 }
  });
  assert.equal(savedSettings.status, 200);
  assert.equal(savedSettings.body.settings.ai_timeout_seconds, 400);

  const runtimeConfig = await request(app, {
    requestPath: '/api/novel-panel/runtime-config',
    token: login.body.token
  });
  assert.equal(runtimeConfig.status, 200);
  assert.equal(runtimeConfig.body.ai_timeout_seconds, 400);

  const health = await request(app, {
    requestPath: '/api/novel-panel/character-core/health',
    token: login.body.token
  });
  assert.equal(health.status, 200);
  assert.equal(health.body.character_core_version, 2);
  assert.equal(health.body.app_version, 'v78.3.0.2');

  const characterCore = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/character-core/analyze',
    body: {},
    token: login.body.token
  });
  assert.equal(characterCore.status, 400);
  assert.match(characterCore.body.error, /CharacterCore请求缺少分析提示词/);

  const analysis = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/analyze',
    body: {},
    token: login.body.token
  });
  assert.equal(analysis.status, 400);
  assert.match(analysis.body.error, /小说原文/);
  assert.notEqual(analysis.body.code, 'NOVEL_PANEL_API_PENDING');

  const legacyScenePrompts = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/generate-scene-prompts',
    body: {},
    token: login.body.token
  });
  assert.equal(legacyScenePrompts.status, 400);
  assert.match(legacyScenePrompts.body.error, /小说原文/);

  const missingEndpoint = await request(app, {
    method: 'POST',
    requestPath: '/api/novel-panel/missing-action',
    body: {},
    token: login.body.token
  });
  assert.equal(missingEndpoint.status, 404);
  assert.equal(missingEndpoint.body.code, 'NOVEL_PANEL_ENDPOINT_NOT_FOUND');
  assert.match(missingEndpoint.body.error, /POST \/api\/novel-panel\/missing-action/);
});

test('novel-panel labels upstream 401 as an API credential failure', () => {
  assert.equal(
    novelPanelRouter._private.upstreamErrorMessage(new Error('上游模型返回 HTTP 401')),
    '模型服务认证失败：当前 API Key 被上游拒绝。请在小说面板“设置”中更新 API Key，或确认 Base URL 与该 Key 属于同一服务。'
  );
});

test('novel-panel labels a TLS reset as an upstream network failure', () => {
  assert.equal(
    novelPanelRouter._private.upstreamErrorMessage(new Error('Client network socket disconnected before secure TLS connection was established')),
    '模型服务网络连接失败：连接在 TLS 建立前被断开。请在 ClashX Meta 中切换“🤖 AI”的可用节点后重试。'
  );
});

test('bridge retries its nonce handshake, then keeps API bodies off window messages', async () => {
  const nativeFetchCalls = [];
  const handshakeMessages = [];
  const beaconCalls = [];
  const windowListeners = { message: [], pagehide: [], pageshow: [], beforeunload: [], 'qiantie-v77-bridge-closing': [] };
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
      addEventListener: () => {},
      dispatchEvent: () => true
    },
    document: { documentElement: { dataset: {} } },
    navigator,
    URL,
    URLSearchParams,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
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
  context.window.dispatchEvent = event => {
    for (const listener of windowListeners[event?.type] || []) listener(event);
    return true;
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

  for (const listener of windowListeners.message) {
    listener({
      source: context.window.parent,
      data: { type: 'qiantie-theme-sync', theme: 'light' }
    });
  }
  assert.equal(context.document.documentElement.dataset.theme, 'light');
  for (const listener of windowListeners.message) {
    listener({ source: {}, data: { type: 'qiantie-theme-sync', theme: 'dark' } });
    listener({ source: context.window.parent, data: { type: 'unexpected', theme: 'dark' } });
    listener({ source: context.window.parent, data: { type: 'qiantie-theme-sync', theme: 'system' } });
  }
  assert.equal(context.document.documentElement.dataset.theme, 'light');

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

  const ttsRequest = context.window.fetch('/api/tts', { method: 'POST', body: '{}' });
  assert.equal(childPort.posted[2].path, '/api/tts');
  childPort.onmessage({ data: { type: 'novel-panel-api-response', id: childPort.posted[2].id, status: 200, headers: { 'content-type': 'audio/mpeg' }, text: '' } });
  assert.equal((await ttsRequest).status, 200);

  const nonApiOptions = { method: 'GET' };
  await context.window.fetch('/static/x', nonApiOptions);
  assert.equal(nativeFetchCalls[0][0], '/static/x');
  assert.equal(nativeFetchCalls[0][1], nonApiOptions);

  assert.equal(navigator.sendBeacon('/api/character-core/project-lease', JSON.stringify({ lease: true })), true);
  assert.equal(beaconCalls.length, 0);
  assert.equal(childPort.posted[3].path, '/api/novel-panel/character-core/project-lease');
  assert.equal(childPort.posted[3].method, 'POST');
  childPort.onmessage({ data: { type: 'novel-panel-api-response', id: childPort.posted[3].id, status: 501, headers: {}, text: '' } });

  assert.equal(navigator.sendBeacon('/api/novel-panel/already-routed', 'event'), true);
  assert.equal(childPort.posted[4].path, '/api/novel-panel/already-routed');
  childPort.onmessage({ data: { type: 'novel-panel-api-response', id: childPort.posted[4].id, status: 501, headers: {}, text: '' } });
  assert.equal(beaconCalls.length, 0);

  assert.equal(navigator.sendBeacon('/telemetry', 'event'), false);
  assert.deepEqual(beaconCalls, [['/telemetry', 'event']]);
  assert.equal(handshakeMessages.length, 2);
  assert.equal(windowListeners.pagehide.length, 1);
  assert.equal(windowListeners.pageshow.length, 1);
  assert.equal(windowListeners.beforeunload.length, 1);
  windowListeners.pagehide[0]({ persisted: true });
  assert.equal(childPort.closed, true);
  assert.equal(retryTimers.size, 0);

  windowListeners.pageshow[0]({ persisted: true });
  assert.equal(handshakeMessages.length, 3);
  assert.equal(retryTimers.size, 1);

  const restoredPort = {
    posted: [],
    postMessage(message) { this.posted.push(message); },
    close() { this.closed = true; },
    start() {}
  };
  for (const listener of windowListeners.message) {
    listener({
      source: context.window.parent,
      data: { type: 'qiantie-v77-port', nonce: 'nonce-1' },
      ports: [restoredPort]
    });
  }
  assert.equal(retryTimers.size, 0);
  const restoredRequest = context.window.fetch('/api/analyze', { method: 'POST', body: '{}' });
  assert.equal(restoredPort.posted[0].path, '/api/novel-panel/analyze');
  restoredPort.onmessage({ data: { type: 'novel-panel-api-response', id: restoredPort.posted[0].id, status: 501, headers: {}, text: '' } });
  assert.equal((await restoredRequest).status, 501);
  assert.equal(childPort.posted.length, 5);

  const abortController = new AbortController();
  const abortReason = new Error('user stopped the request');
  const abortStart = restoredPort.posted.length;
  const abortRequest = context.window.fetch('/api/analyze', {
    method: 'POST',
    body: '{}',
    signal: abortController.signal
  });
  const abortMessage = restoredPort.posted[abortStart];
  abortController.abort(abortReason);
  try {
    // The bridge runs in a VM context here, so compare the serialized channel
    // payload rather than the VM object's prototype.
    assert.deepEqual(JSON.parse(JSON.stringify(restoredPort.posted.slice(abortStart + 1))), [{ type: 'novel-panel-api-cancel', id: abortMessage.id }]);
    await assert.rejects(abortRequest, error => error === abortReason);
  } finally {
    restoredPort.onmessage({ data: { type: 'novel-panel-api-response', id: abortMessage.id, status: 200, headers: {}, text: '' } });
    await abortRequest.catch(() => {});
  }

  let releaseRoutedBeforeClose = false;
  context.window.addEventListener('qiantie-v77-bridge-closing', () => {
    releaseRoutedBeforeClose = !restoredPort.closed;
    context.navigator.sendBeacon('/api/character-core/project-lease', JSON.stringify({ action: 'release' }));
  });
  const releaseStart = restoredPort.posted.length;
  windowListeners.pagehide[0]({ persisted: false });
  assert.equal(releaseRoutedBeforeClose, true);
  const releaseMessage = restoredPort.posted[releaseStart];
  assert.equal(releaseMessage.path, '/api/novel-panel/character-core/project-lease');
  assert.equal(releaseMessage.method, 'POST');
  assert.deepEqual(restoredPort.posted.slice(releaseStart + 1), []);
  restoredPort.onmessage({ data: { type: 'novel-panel-api-response', id: releaseMessage.id, status: 204, headers: {}, text: '' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(restoredPort.closed, true);
  assert.equal(retryTimers.size, 0);
});
