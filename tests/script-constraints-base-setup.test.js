const test = require('node:test');
const assert = require('node:assert/strict');

test('base setup remains enabled for older saved constraint drafts until explicitly disabled', async () => {
  const { normalizeScriptConstraints } = await import('../frontend/src/user/pages/scriptConstraints.js');
  assert.equal(normalizeScriptConstraints({ enabled: true }).baseSetup.enabled, true);
  assert.equal(normalizeScriptConstraints({ baseSetup: { enabled: false } }).baseSetup.enabled, false);
});
