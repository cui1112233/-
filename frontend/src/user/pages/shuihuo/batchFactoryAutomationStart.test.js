import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureBatchAutomationStarted } from './batchFactoryAutomationStart.js';

test('starts immediate full automation for a newly imported batch', async () => {
  const calls = [];
  const result = await ensureBatchAutomationStarted('batch-1', {
    getStatus: async () => ({ automation: { state: 'idle' } }),
    listPresets: async () => ({ presets: [{ id: 'preset-1' }] }),
    start: async (batchId, payload) => { calls.push({ batchId, payload }); return { automation: { state: 'running' } }; }
  });

  assert.equal(result.started, true);
  assert.deepEqual(calls, [{
    batchId: 'batch-1',
    payload: { presetId: 'preset-1', runMode: 'full_submit', autoPublish: true, concurrency: 2 }
  }]);
});

test('does not replace an already running imported batch automation', async () => {
  let started = false;
  const result = await ensureBatchAutomationStarted('batch-1', {
    getStatus: async () => ({ automation: { state: 'running' } }),
    listPresets: async () => ({ presets: [{ id: 'preset-1' }] }),
    start: async () => { started = true; }
  });

  assert.equal(result.started, false);
  assert.equal(result.reason, 'active');
  assert.equal(started, false);
});
