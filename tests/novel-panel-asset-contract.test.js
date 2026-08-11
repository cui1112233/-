const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
