const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const modulePath = path.join(__dirname, '..', 'lib', 'novel-panel', 'workbench-assets');

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workbench-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'clean-core'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), [
    '<script src="/api/novel-panel/runtime-config"></script>',
    '<script src="/novel-panel/workbench/app.js"></script>',
    '<link rel="stylesheet" href="/novel-panel/workbench/style.css">',
    '<script src="/novel-panel/workbench/clean-core/bridge.js"></script>'
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'style.css'), 'body{}\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'window.app=true;\n');
  fs.writeFileSync(path.join(root, 'clean-core', 'bridge.js'), 'console.log("bridge");\n');
  fs.writeFileSync(path.join(root, 'unreferenced.js'), 'must not be hashed');
  return root;
}

test('buildWorkbenchManifest hashes only referenced JS/CSS with sorted deterministic metadata', t => {
  const { buildWorkbenchManifest } = require(modulePath);
  const root = createFixture(t);

  const first = buildWorkbenchManifest(root);
  const second = buildWorkbenchManifest(root);

  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first.assets), ['app.js', 'clean-core/bridge.js', 'style.css']);
  assert.deepEqual(first.assets, {
    'app.js': {
      sha256: '3441747d46f36803a0f0fc3cc106a5225aa65ef288662735f70eb679e586b00c',
      bytes: 17
    },
    'clean-core/bridge.js': {
      sha256: 'b0876224092fbfb7df5729b854b5fe1055c97e9486b5da639d06a776541e8897',
      bytes: 23
    },
    'style.css': {
      sha256: '2708d73bf31c36cdfa1aa466551ed101017280fa546caba4473cfef6e92a93b5',
      bytes: 7
    }
  });
  assert.match(first.version, /^[0-9a-f]{64}$/);
});

test('manifest version and asset hash change when referenced bytes change', t => {
  const { buildWorkbenchManifest } = require(modulePath);
  const root = createFixture(t);
  const before = buildWorkbenchManifest(root);

  fs.writeFileSync(path.join(root, 'app.js'), 'window.app=false;\n');
  const after = buildWorkbenchManifest(root);

  assert.notEqual(after.version, before.version);
  assert.equal(after.assets['app.js'].sha256, 'd17aca187a7bf0915bd011653b574c8263c6cccf195142bdb3e8c15f2553aba0');
  assert.equal(after.assets['app.js'].bytes, 18);
});

test('manifest generation fails with the missing referenced asset in its diagnostic', t => {
  const { buildWorkbenchManifest } = require(modulePath);
  const root = createFixture(t);
  fs.unlinkSync(path.join(root, 'app.js'));

  assert.throws(
    () => buildWorkbenchManifest(root),
    error => error?.code === 'WORKBENCH_ASSET_MISSING' && /app\.js/.test(error.message)
  );
});

test('assertSafeAssetPath rejects traversal, absolute, query, fragment and non-asset paths', () => {
  const { assertSafeAssetPath } = require(modulePath);
  for (const unsafePath of [
    '../app.js', 'clean-core/../../secret.js', '/app.js', 'C:\\app.js',
    'app.js?v=old', 'style.css#old', 'data.json', '', '.', 'clean-core\\app.js'
  ]) {
    assert.throws(() => assertSafeAssetPath(unsafePath), error => error?.code === 'WORKBENCH_ASSET_PATH_UNSAFE', unsafePath);
  }
  assert.equal(assertSafeAssetPath('clean-core/runtime.js'), 'clean-core/runtime.js');
  assert.equal(assertSafeAssetPath('style.css'), 'style.css');
});

test('renderVersionedAssetUrl requires a manifest entry and uses the first 16 hash characters', () => {
  const { renderVersionedAssetUrl } = require(modulePath);
  const manifest = {
    version: 'f'.repeat(64),
    assets: {
      'clean-core/runtime.js': { sha256: '0123456789abcdef'.repeat(4), bytes: 12 }
    }
  };

  assert.equal(
    renderVersionedAssetUrl('clean-core/runtime.js', manifest),
    '/novel-panel/workbench/clean-core/runtime.js?v=0123456789abcdef'
  );
  assert.throws(
    () => renderVersionedAssetUrl('missing.js', manifest),
    error => error?.code === 'WORKBENCH_ASSET_MISSING' && /missing\.js/.test(error.message)
  );
});

test('legacy workbench source keeps its compatibility marker, bridge order and DOM contracts', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'novel-panel', 'workbench', 'index.html'), 'utf8');
  const marker = 'V78 Stable production marker';
  const requiredIds = [
    'novelText', 'characterGuideInput', 'analyzeBtn', 'characters', 'outlineBtn',
    'scenes', 'outputs', 'settingsDialog', 'historyPage', 'ttsDialog'
  ];

  assert.match(html, new RegExp(marker));
  assert.ok(html.indexOf('window.__VIDEO_PROMPT_TOOL_BUILD__') < html.indexOf('/novel-panel/workbench/bridge.js'));
  assert.ok(html.indexOf('/novel-panel/workbench/bridge.js') < html.indexOf('/novel-panel/workbench/app.js'));
  for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
});
