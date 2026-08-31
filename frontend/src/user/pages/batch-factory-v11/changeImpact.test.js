import test from 'node:test';
import assert from 'node:assert/strict';
import { createBf11UiAdapter } from './bf11UiAdapter.js';
import { createBf11Runtime } from './bf11Runtime.js';

test('adapter requests V11 change-impact with sparse patch and expected revision', async () => {
  const calls = [];
  const adapter = createBf11UiAdapter({
    getChangeImpact: async (batchId, payload) => {
      calls.push({ batchId, payload });
      return { affectedBooks: 3 };
    }
  });
  const result = await adapter.previewChangeImpact({
    batchId: 'b1',
    patch: { productionMode: 'viral' },
    revision: 7
  });
  assert.deepEqual(calls, [{
    batchId: 'b1',
    payload: { patch: { productionMode: 'viral' }, expectedRevision: 7 }
  }]);
  assert.deepEqual(result, { affectedBooks: 3 });
});

test('runtime returns server change-impact unchanged', async () => {
  const raw = {
    affectedBooks: 3,
    affectedVideos: 9,
    invalidatesDirector: true,
    compatibility: [{ state: 'orphaned' }]
  };
  const runtime = createBf11Runtime({ adapter: {
    previewChangeImpact: async () => raw
  } });
  const result = await runtime.previewChangeImpact({ batchId: 'b1', patch: {}, revision: 7 });
  assert.equal(result.ok, true);
  assert.equal(result.impact, raw);
});

test('runtime surfaces real change-impact failure without synthesizing impact', async () => {
  const runtime = createBf11Runtime({ adapter: {
    previewChangeImpact: async () => {
      const error = new Error('impact unavailable');
      error.status = 503;
      throw error;
    }
  } });
  const result = await runtime.previewChangeImpact({ batchId: 'b1', patch: {} });
  assert.deepEqual(result, { ok: false, status: 503, message: 'impact unavailable' });
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'impact'), false);
});
