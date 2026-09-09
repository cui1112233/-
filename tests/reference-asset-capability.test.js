const assert = require('node:assert/strict');
const test = require('node:test');

const {
  issueReferenceAssetCapability,
  verifyReferenceAssetCapability
} = require('../lib/novel-panel/reference-asset-capability');

test('reference asset capability is scoped, expiring, and tamper evident', () => {
  const issued = issueReferenceAssetCapability({
    secret: 'test-capability-secret',
    origin: 'https://public.example.test',
    username: 'alice',
    assetType: 'character',
    assetId: 'hero',
    variant: 'main',
    now: () => 1_700_000_000_000,
    ttlSeconds: 600
  });
  const url = new URL(issued);
  assert.equal(url.origin, 'https://public.example.test');
  assert.equal(url.pathname, '/api/reference-assets/h3/character/hero/main');
  assert.equal(verifyReferenceAssetCapability({
    secret: 'test-capability-secret',
    username: url.searchParams.get('u'),
    assetType: 'character',
    assetId: 'hero',
    variant: 'main',
    expiresAt: url.searchParams.get('e'),
    signature: url.searchParams.get('s'),
    now: () => 1_700_000_100_000
  }), true);
  assert.equal(verifyReferenceAssetCapability({
    secret: 'test-capability-secret',
    username: 'bob',
    assetType: 'character',
    assetId: 'hero',
    variant: 'main',
    expiresAt: url.searchParams.get('e'),
    signature: url.searchParams.get('s'),
    now: () => 1_700_000_100_000
  }), false);
  assert.equal(verifyReferenceAssetCapability({
    secret: 'test-capability-secret',
    username: 'alice',
    assetType: 'character',
    assetId: 'hero',
    variant: 'main',
    expiresAt: url.searchParams.get('e'),
    signature: url.searchParams.get('s').replace(/^./, 'x'),
    now: () => 1_700_000_700_000
  }), false);
});
