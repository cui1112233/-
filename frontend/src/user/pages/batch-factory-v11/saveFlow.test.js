import test from 'node:test';
import assert from 'node:assert/strict';
import { runSaveFlow } from './saveFlow.js';

test('successful save closes the editor', async () => {
  let closed = 0;
  const result = await runSaveFlow({ payload: { a: 1 }, onSave: async () => true, onClose: () => { closed += 1; } });
  assert.equal(result, true);
  assert.equal(closed, 1);
});

test('failed save result keeps the editor open', async () => {
  let closed = 0;
  const result = await runSaveFlow({ payload: {}, onSave: async () => false, onClose: () => { closed += 1; } });
  assert.equal(result, false);
  assert.equal(closed, 0);
});

test('thrown save keeps editor open and propagates error', async () => {
  let closed = 0;
  await assert.rejects(() => runSaveFlow({ payload: {}, onSave: async () => { throw new Error('boom'); }, onClose: () => { closed += 1; } }), /boom/);
  assert.equal(closed, 0);
});
