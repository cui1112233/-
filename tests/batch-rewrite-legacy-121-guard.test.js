const test = require('node:test');
const assert = require('node:assert/strict');
const { createLegacy121MutationGuard } = require('../lib/novel-fetch-workshop/legacy-121-guard');

function callGuard(method, path) {
  const guard = createLegacy121MutationGuard();
  let nextCalled = false;
  const response = { statusCode: 200, body: null };
  const req = { method, path };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return body; }
  };
  guard(req, res, () => { nextCalled = true; });
  return { ...response, nextCalled };
}

for (const path of [
  '/web-submit/config',
  '/web-submit/sync-configs',
  '/web-submit/sync-styles',
  '/web-submit/test-visible',
  '/web-submit/submit',
  '/process'
]) {
  test(`candidate fallthrough blocks legacy mutation POST ${path}`, () => {
    const result = callGuard('POST', path);
    assert.equal(result.statusCode, 410);
    assert.equal(result.body.code, 'legacy_121_mutation_disabled');
    assert.equal(result.nextCalled, false);
  });
}

test('read-only and V2-safe routes may continue to the core app', () => {
  assert.equal(callGuard('GET', '/web-submit/history').nextCalled, true);
  assert.equal(callGuard('POST', '/web-submit/preview').nextCalled, true);
  assert.equal(callGuard('GET', '/tasks').nextCalled, true);
});
