const test = require('node:test');
const assert = require('node:assert/strict');

const novelPanelPage = require('../routes/novel-panel-page');

test('novel panel workbench assets use a reusable cache policy', () => {
  assert.equal(typeof novelPanelPage.getWorkbenchAssetCacheHeaders, 'function');
  assert.deepEqual(novelPanelPage.getWorkbenchAssetCacheHeaders(), {
    'Cache-Control': 'public, max-age=300, must-revalidate'
  });
});

test('novel panel workbench text assets can be served compressed', () => {
  assert.equal(novelPanelPage.shouldCompressWorkbenchAsset('app.js'), true);
  assert.equal(novelPanelPage.shouldCompressWorkbenchAsset('style.css'), true);
  assert.equal(novelPanelPage.shouldCompressWorkbenchAsset('cover.png'), false);
});
