const assert = require('node:assert/strict');
const test = require('node:test');

async function constraintsModule() {
  return import(`../frontend/src/user/pages/scriptConstraints.js?test=${Date.now()}`);
}

test('one-off constraint choices are not persisted for the next generation', async () => {
  const { constraintsForNextGeneration } = await constraintsModule();
  const next = constraintsForNextGeneration({
    enabled: false,
    baseSetup: { enabled: true },
    quality: { enabled: true, source: 'draft', body: '4K' }
  });

  assert.equal(next.enabled, false);
  assert.equal(next.baseSetup.enabled, false);
  assert.equal(next.quality.enabled, false);
});

test('future-output switch persists enabled child choices', async () => {
  const { constraintsForNextGeneration } = await constraintsModule();
  const next = constraintsForNextGeneration({ enabled: true, baseSetup: { enabled: true } });

  assert.equal(next.enabled, true);
  assert.equal(next.baseSetup.enabled, true);
});

test('shortdrama retains one-off child constraints for the current request', async () => {
  const { constraintsForFormat } = await constraintsModule();
  const current = constraintsForFormat({
    enabled: false,
    baseSetup: { enabled: true },
    quality: { enabled: true, source: 'draft', body: '4K' }
  }, 'shortdrama');

  assert.equal(current.baseSetup.enabled, true);
  assert.equal(current.quality.enabled, true);
});
