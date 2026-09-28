const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../lib/reference-asset-public-url');

function withEnvironment(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] == null) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('H3 reference asset URLs use the configured HTTPS base and signed expiry', () => {
  const { publicReferenceAssetUrl, verifyReferenceAssetSignature } = require(modulePath);
  withEnvironment({
    QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL: 'https://app.yzcm.site/',
    QIANTIE_REFERENCE_ASSET_SIGNING_SECRET: 'test-only-secret'
  }, () => {
    const url = new URL(publicReferenceAssetUrl({
      username: 'user/name',
      assetType: 'character',
      assetId: 'hero_01',
      variant: 'main',
      ttlSeconds: 600
    }));
    assert.equal(url.origin, 'https://app.yzcm.site');
    assert.equal(url.pathname, '/api/novel-panel/reference-assets/public/user%2Fname/character/hero_01/main');
    const expiresAt = Number(url.searchParams.get('expires'));
    assert.ok(expiresAt > Math.floor(Date.now() / 1000));
    assert.equal(verifyReferenceAssetSignature({
      username: 'user/name', assetType: 'character', assetId: 'hero_01', variant: 'main', expiresAt
    }, url.searchParams.get('sig')), true);
    assert.equal(verifyReferenceAssetSignature({
      username: 'user/name', assetType: 'character', assetId: 'hero_01', variant: 'main', expiresAt
    }, 'bad-signature'), false);
  });
});

test('H3 reference asset URLs reject HTTP bases and missing configuration in Chinese', () => {
  const { publicReferenceAssetUrl } = require(modulePath);
  const input = { username: 'user', assetType: 'scene', assetId: 'scene_01', variant: 'source' };
  withEnvironment({
    QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL: 'http://app.yzcm.site',
    QIANTIE_REFERENCE_ASSET_SIGNING_SECRET: 'test-only-secret'
  }, () => assert.throws(() => publicReferenceAssetUrl(input), /必须使用 HTTPS/));
  withEnvironment({
    QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL: null,
    QIANTIE_REFERENCE_ASSET_SIGNING_SECRET: 'test-only-secret'
  }, () => assert.throws(() => publicReferenceAssetUrl(input), /需要配置 HTTPS 公网地址/));
});

test('provider reference asset URLs allow an explicitly enabled HTTP public entrypoint', () => {
  const { publicReferenceAssetUrl } = require(modulePath);
  withEnvironment({
    QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL: 'http://115.190.156.223:3000',
    QIANTIE_REFERENCE_ASSET_SIGNING_SECRET: 'test-only-secret',
    QIANTIE_REFERENCE_ASSET_ALLOW_HTTP: 'true'
  }, () => {
    const url = new URL(publicReferenceAssetUrl({ username: 'owner', assetType: 'character', assetId: 'wife', variant: 'main' }));
    assert.equal(url.protocol, 'http:');
    assert.equal(url.host, '115.190.156.223:3000');
    assert.match(url.pathname, /^\/api\/novel-panel\/reference-assets\/public\/owner\/character\/wife\/main$/);
    assert.ok(url.searchParams.get('sig'));
  });
});
