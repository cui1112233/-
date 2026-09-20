const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createNovelFetchBatches } = require('../lib/novel-fetch-workshop/batches');
const { attachBatch } = require('../lib/novel-fetch-workshop/v2-api-contract');

test('completed batch keeps only its submitted task ids and input order', () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-fetch-batches-'));
  const batches = createNovelFetchBatches({
    usersDir,
    clock: () => new Date('2026-09-20T04:00:00.000Z')
  });
  const submitted = ['book-8', 'book-2', 'book-5', 'book-1', 'book-7', 'book-3', 'book-6', 'book-4'];
  const batch = batches.create('tester', { taskIds: submitted });

  batches.complete('tester', batch.id, {
    tasks: [...submitted, 'old-9', 'old-10', 'old-11'].map(bookId => ({
      bookId,
      status: 'done',
      originalStatus: 'done'
    }))
  });

  const current = batches.current('tester');
  assert.deepEqual(current.taskIds, submitted);
  assert.deepEqual(current.taskStates.map(task => task.bookId), submitted);
});

test('queue payload carries the persisted batch creation time', () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-fetch-batch-payload-'));
  const batches = createNovelFetchBatches({
    usersDir,
    clock: () => new Date('2026-09-20T04:00:00.000Z')
  });
  const payload = attachBatch('tester', { input_text: '1001\t测试书', task_ids: ['1001'] }, batches);

  assert.equal(payload.batch_created_at, '2026-09-20T04:00:00.000Z');
});
