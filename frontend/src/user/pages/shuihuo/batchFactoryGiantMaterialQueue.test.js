import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGiantMaterialQueue,
  parseGiantMaterialIds,
  queueSummary,
  runSequentialGiantMaterialQueue
} from './batchFactoryGiantMaterialQueue.js';

test('parses newline, comma and Chinese punctuation while deduplicating IDs', () => {
  const parsed = parseGiantMaterialIds(' 7689285397448523826\n7613606077155459091, 7689285397448523826；bad ');
  assert.deepEqual(parsed.valid, ['7689285397448523826', '7613606077155459091']);
  assert.deepEqual(parsed.invalid, ['bad']);
});

test('creates visible pending items with stable IDs', () => {
  const queue = createGiantMaterialQueue('7689285397448523826\n7613606077155459091');
  assert.deepEqual(queue.map(item => ({ id: item.id, status: item.status, stage: item.stage })), [
    { id: '7689285397448523826', status: 'pending', stage: 'idle' },
    { id: '7613606077155459091', status: 'pending', stage: 'idle' }
  ]);
});

test('runs one item at a time and keeps a failed item retryable', async () => {
  const queue = createGiantMaterialQueue('7689285397448523826\n7613606077155459091');
  const events = [];
  let active = 0;
  let maxActive = 0;
  const result = await runSequentialGiantMaterialQueue(queue, async item => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${item.id}`);
    await Promise.resolve();
    active -= 1;
    if (item.id.endsWith('091')) throw new Error('OCR_NO_TEXT');
    return { title: 'ok' };
  }, { onState: (item, state) => events.push(`${state.status}:${item.id}`) });

  assert.equal(maxActive, 1);
  assert.deepEqual(events, [
    'running:7689285397448523826',
    'start:7689285397448523826',
    'success:7689285397448523826',
    'running:7613606077155459091',
    'start:7613606077155459091',
    'error:7613606077155459091'
  ]);
  assert.equal(result[0].status, 'success');
  assert.equal(result[1].status, 'error');
  assert.equal(result[1].error, 'OCR_NO_TEXT');
  assert.deepEqual(queueSummary(result), { total: 2, pending: 0, running: 0, success: 1, skipped: 0, error: 1 });
});
