const test = require('node:test');
const assert = require('node:assert/strict');

const { createTosReferenceAssetStore, normalizeTosSdkEndpoint } = require('../lib/novel-panel/tos-reference-assets');
const { createNovelPanelPremiumStore } = require('../lib/novel-panel/premium-store');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function configuredEnv(overrides = {}) {
  return {
    QIANTIE_REFERENCE_ASSET_TOS_ENDPOINT: 'https://tos-cn-beijing.volces.com',
    QIANTIE_REFERENCE_ASSET_TOS_REGION: 'cn-beijing',
    QIANTIE_REFERENCE_ASSET_TOS_BUCKET: 'qiantie',
    QIANTIE_REFERENCE_ASSET_TOS_ACCESS_KEY: 'ak-test',
    QIANTIE_REFERENCE_ASSET_TOS_SECRET_KEY: 'sk-test',
    ...overrides
  };
}

test('TOS reference asset store scopes keys and signs HTTPS GET URLs', async () => {
  const calls = [];
  const client = {
    async putObject(input) { calls.push(input); return { statusCode: 200 }; },
    getPreSignedUrl(input) {
      assert.equal(input.method, 'GET');
      assert.equal(input.bucket, 'qiantie');
      return `https://qiantie.tos-cn-beijing.volces.com/${input.key}?signed=1`;
    }
  };
  const store = createTosReferenceAssetStore({ env: configuredEnv(), client });
  assert.ok(store);
  const result = await store.put({
    username: 'user/name', assetType: 'character', assetId: 'hero_01', variant: 'main',
    body: Buffer.from('image'), contentType: 'image/png'
  });
  assert.equal(result.key, 'reference-assets/user~2Fname/character/hero_01/main.png');
  assert.equal(calls[0].key, result.key);
  assert.equal(calls[0].contentType, 'image/png');
  assert.equal(store.getSignedUrl(result.key).startsWith('https://'), true);
});

test('TOS SDK endpoint removes the URL scheme before bucket host composition', () => {
  assert.equal(normalizeTosSdkEndpoint('https://tos-cn-beijing.volces.com/'), 'tos-cn-beijing.volces.com');
});

test('TOS reference asset store is disabled without complete ECS-only credentials', () => {
  assert.equal(createTosReferenceAssetStore({ env: {} }), null);
  assert.equal(createTosReferenceAssetStore({ env: configuredEnv({ QIANTIE_REFERENCE_ASSET_TOS_SECRET_KEY: '' }) }), null);
});

test('premium store mirrors a local reference asset to TOS and returns a signed URL', async () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-tos-'));
  const uploads = [];
  const tosStore = {
    async putFile(input) { uploads.push(input); return { key: 'reference-assets/user/character/hero/main.png' }; },
    getSignedUrl(key) { return `https://tos.example/${key}?signed=1`; }
  };
  const premium = createNovelPanelPremiumStore({ usersDir, tosStore });
  premium.writeReferenceAssetBytes('user', 'character', 'hero', 'main', Buffer.from('image'), 'image/png');
  const result = await premium.syncReferenceAssetToTos('user', 'character', 'hero', 'main');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].username, 'user');
  assert.equal(result.url, 'https://tos.example/reference-assets/user/character/hero/main.png?signed=1');
});
