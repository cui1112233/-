const assert = require('node:assert/strict');
const test = require('node:test');
const { h3ReferenceUrl, verifyReferenceAssetSignature } = require('../lib/reference-asset-public-url');

test('internal reference asset URLs become short-lived HTTPS links for H3', () => {
  const before = { ...process.env };
  process.env.QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL = 'https://qiantie.example.test';
  process.env.QIANTIE_REFERENCE_ASSET_SIGNING_SECRET = 'test-signing-secret';
  try {
    const url = new URL(h3ReferenceUrl('/api/novel-panel/reference-assets/file/character/hero_1/source_1710000000000_aabbccddeeff', 'alice'));
    assert.equal(url.protocol, 'https:');
    assert.match(url.pathname, /\/reference-assets\/public\/alice\/character\/hero_1\/source_1710000000000_aabbccddeeff$/);
    assert.equal(verifyReferenceAssetSignature({ username: 'alice', assetType: 'character', assetId: 'hero_1', variant: 'source_1710000000000_aabbccddeeff', expiresAt: Number(url.searchParams.get('expires')) }, url.searchParams.get('sig')), true);
  } finally {
    for (const key of ['QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL', 'QIANTIE_REFERENCE_ASSET_SIGNING_SECRET']) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  }
});

test('H3 rejects internal reference links until a HTTPS public base is configured', () => {
  const before = { ...process.env };
  delete process.env.QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL;
  process.env.QIANTIE_REFERENCE_ASSET_SIGNING_SECRET = 'test-signing-secret';
  try {
    assert.throws(() => h3ReferenceUrl('/api/novel-panel/reference-assets/file/scene/room_1/source_1710000000000_aabbccddeeff', 'alice'), /HTTPS 公网地址/);
  } finally {
    for (const key of ['QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL', 'QIANTIE_REFERENCE_ASSET_SIGNING_SECRET']) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  }
});

test('H3 rejects signed asset URLs when the dedicated signing secret is absent', () => {
  const before = { ...process.env };
  process.env.QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL = 'https://qiantie.example.test';
  delete process.env.QIANTIE_REFERENCE_ASSET_SIGNING_SECRET;
  process.env.QIANTIE_BRIDGE_SECRET = 'bridge-secret-must-not-sign-assets';
  try {
    assert.throws(() => h3ReferenceUrl('/api/novel-panel/reference-assets/file/scene/room_1/source_1710000000000_aabbccddeeff', 'alice'), /签名密钥/);
  } finally {
    for (const key of ['QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL', 'QIANTIE_REFERENCE_ASSET_SIGNING_SECRET', 'QIANTIE_BRIDGE_SECRET']) {
      if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    }
  }
});
