const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createNovelPanelPremiumStore } = require('../lib/novel-panel/premium-store');

test('reference images retain immutable revisions and source resolves to the newest revision', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-reference-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createNovelPanelPremiumStore({ usersDir: root });
  const first = store.writeReferenceAssetRevision('tester', 'character', 'hero_1', 'source', Buffer.from('one'), 'image/png');
  const second = store.writeReferenceAssetRevision('tester', 'character', 'hero_1', 'source', Buffer.from('two'), 'image/jpeg');

  assert.match(first.revision, /^source_\d+_[a-f0-9]{12}$/);
  assert.match(second.revision, /^source_\d+_[a-f0-9]{12}$/);
  assert.notEqual(first.filePath, second.filePath);
  assert.equal(store.assetFilePath('tester', 'character', 'hero_1', second.revision), second.filePath);
  assert.equal(store.assetFilePath('tester', 'character', 'hero_1', 'source'), second.filePath);
  assert.match(store.referenceAssetPublicUrl('character', 'hero_1', second.revision, false), new RegExp(`/${second.revision}$`));
});
