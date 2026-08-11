const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workbenchRoot = path.join(root, 'public', 'novel-panel', 'workbench');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
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

  const bundle = [
    html,
    fs.readFileSync(path.join(workbenchRoot, 'bridge.js'), 'utf8'),
    fs.readFileSync(path.join(workbenchRoot, 'app.js'), 'utf8'),
    fs.readFileSync(path.join(workbenchRoot, 'outline-quality-gate.js'), 'utf8'),
    fs.readFileSync(path.join(workbenchRoot, 'character-core', 'character-core.js'), 'utf8')
  ].join('\n');
  assert.doesNotMatch(bundle, /127\.0\.0\.1|8818|\.exe(?:\s|["'`]|$)/i);
});

test('qiantie navigation renders the V77 workbench in a same-origin iframe', () => {
  const userApp = read('frontend/src/user/App.jsx');
  const userLayout = read('frontend/src/shared/layouts/UserLayout.jsx');
  const novelPanelPage = read('frontend/src/user/pages/NovelPanelPage.jsx');
  const pagesRouter = read('routes/pages.js');

  assert.match(userApp, /pathname === '\/novel-panel'/);
  assert.match(userLayout, /href: '\/novel-panel'/);
  assert.match(novelPanelPage, /<iframe/);
  assert.match(novelPanelPage, /src="\/novel-panel\/workbench"/);
  assert.match(pagesRouter, /router\.get\('\/novel-panel'/);
});

test('bridge maps V77 fetch and lease beacons through the authenticated novel-panel API', async () => {
  const fetchCalls = [];
  const beaconCalls = [];
  const nativeFetch = (...args) => {
    fetchCalls.push(args);
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
      location: { origin: 'https://qiantie.test' },
      fetch: nativeFetch
    },
    navigator,
    localStorage: { getItem: key => key === 'auth_token' ? 'test-token' : null },
    URL,
    URLSearchParams,
    Headers,
    Request,
    Blob,
    Promise
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(workbenchRoot, 'bridge.js'), 'utf8'), context);

  await context.window.fetch('/api/analyze', { method: 'POST', body: '{}' });
  assert.equal(fetchCalls[0][0], 'https://qiantie.test/api/novel-panel/analyze');
  assert.equal(fetchCalls[0][1].headers.get('Authorization'), 'Bearer test-token');

  await context.window.fetch('/api/novel-panel/analyze', { method: 'POST', body: '{}' });
  assert.equal(fetchCalls[1][0], 'https://qiantie.test/api/novel-panel/analyze');
  assert.doesNotMatch(fetchCalls[1][0], /novel-panel\/novel-panel/);
  assert.equal(fetchCalls[1][1].headers.get('Authorization'), 'Bearer test-token');

  assert.equal(navigator.sendBeacon('/api/character-core/project-lease', JSON.stringify({ lease: true })), true);
  await Promise.resolve();
  assert.equal(beaconCalls.length, 0);
  assert.equal(fetchCalls[2][0], 'https://qiantie.test/api/novel-panel/character-core/project-lease');
  assert.equal(fetchCalls[2][1].method, 'POST');
  assert.equal(fetchCalls[2][1].keepalive, true);
  assert.equal(fetchCalls[2][1].headers.get('Authorization'), 'Bearer test-token');
  assert.equal(fetchCalls[2][1].headers.get('Content-Type'), 'application/json');

  assert.equal(navigator.sendBeacon('/api/novel-panel/already-routed', 'event'), false);
  assert.equal(navigator.sendBeacon('/telemetry', 'event'), false);
  assert.deepEqual(beaconCalls, [
    ['/api/novel-panel/already-routed', 'event'],
    ['/telemetry', 'event']
  ]);
});
