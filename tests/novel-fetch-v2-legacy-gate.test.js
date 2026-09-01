const test = require('node:test');
const assert = require('node:assert/strict');
const {
  V2_OWNED_LEGACY_MUTATIONS,
  isV2OwnedLegacyMutation,
  legacyV2MutationGate
} = require('../lib/novel-fetch-workshop/v2-legacy-gate');

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('legacy gate inventories every mutation path already owned by V2', () => {
  assert.deepEqual([...V2_OWNED_LEGACY_MUTATIONS].sort(), [
    'POST /process/start',
    'POST /tasks/reprocess-sensitive',
    'POST /web-submit/config',
    'POST /web-submit/preview',
    'POST /web-submit/submit',
    'POST /web-submit/sync-configs',
    'POST /web-submit/sync-styles',
    'POST /web-submit/test-visible'
  ].sort());
});

test('legacy gate blocks only V2-owned duplicate mutations and preserves compatibility-only legacy mutations', () => {
  assert.equal(isV2OwnedLegacyMutation({ method: 'POST', path: '/process/start' }), true);
  assert.equal(isV2OwnedLegacyMutation({ method: 'POST', path: '/web-submit/submit' }), true);
  assert.equal(isV2OwnedLegacyMutation({ method: 'POST', path: '/tasks/reprocess-sensitive' }), true);

  // These remain intentionally legacy-compatible because the V2 design says to keep them.
  assert.equal(isV2OwnedLegacyMutation({ method: 'POST', path: '/tasks/batch-retry' }), false);
  assert.equal(isV2OwnedLegacyMutation({ method: 'POST', path: '/tasks/batch-delete' }), false);
  assert.equal(isV2OwnedLegacyMutation({ method: 'POST', path: '/tasks/123/generate-ai' }), false);
  assert.equal(isV2OwnedLegacyMutation({ method: 'GET', path: '/web-submit/config' }), false);
});

test('legacy duplicate mutation fails closed instead of falling through to old implementation', () => {
  const middleware = legacyV2MutationGate();
  const res = response();
  let nextCalls = 0;
  middleware({ method: 'POST', path: '/web-submit/test-visible' }, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 0);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'V2_ROUTE_REQUIRED');
});

test('legacy compatibility mutation continues to its existing handler', () => {
  const middleware = legacyV2MutationGate();
  const res = response();
  let nextCalls = 0;
  middleware({ method: 'POST', path: '/tasks/batch-retry' }, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(res.body, undefined);
});
