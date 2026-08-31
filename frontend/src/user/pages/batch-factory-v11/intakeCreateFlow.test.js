import test from 'node:test';
import assert from 'node:assert/strict';
import { createBf11UiAdapter } from './bf11UiAdapter.js';
import { createBf11Runtime } from './bf11Runtime.js';

test('adapter creates a V11 batch from intake only when explicitly invoked', async () => {
  const calls = [];
  const adapter = createBf11UiAdapter({
    createBatchFromIntake: async (intakeId, payload) => {
      calls.push({ intakeId, payload });
      return { batch: { id: 'b-new' } };
    }
  });
  const result = await adapter.createBatchFromIntake({ intakeId: 'i1', payload: {} });
  assert.deepEqual(calls, [{ intakeId: 'i1', payload: {} }]);
  assert.equal(result.batch.id, 'b-new');
});

test('runtime reports explicit intake batch creation success without starting Director', async () => {
  const runtime = createBf11Runtime({ adapter: {
    createBatchFromIntake: async input => ({ batch: { id: 'b-new' }, received: input })
  } });
  const result = await runtime.createBatchFromIntake({ intakeId: 'i1' });
  assert.equal(result.ok, true);
  assert.equal(result.raw.batch.id, 'b-new');
  assert.equal(result.startsDirector, false);
});

test('runtime surfaces intake batch creation failure without claiming success', async () => {
  const runtime = createBf11Runtime({ adapter: {
    createBatchFromIntake: async () => {
      const error = new Error('intake not ready');
      error.status = 409;
      throw error;
    }
  } });
  const result = await runtime.createBatchFromIntake({ intakeId: 'i1' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.startsDirector, false);
  assert.match(result.message, /intake not ready/);
});
