const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createNovelFetchBatches } = require('../lib/novel-fetch-workshop/batches');

function tempUsersDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-v78-batches-'));
}

function clockSequence(values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

test('current batch survives store recreation and previous batch remains historical', () => {
  const usersDir = tempUsersDir();
  const first = createNovelFetchBatches({
    usersDir,
    clock: clockSequence(['2026-09-01T08:00:00.000Z', '2026-09-01T08:00:01.000Z'])
  });
  const batchA = first.create('alice', {
    inputSnapshot: '10000000001\tA',
    settingsSnapshot: { platform_id: '2', target_versions: ['ai1', 'ai3'] },
    taskIds: ['10000000001']
  });

  const reopened = createNovelFetchBatches({
    usersDir,
    clock: clockSequence(['2026-09-01T09:00:00.000Z', '2026-09-01T09:00:01.000Z'])
  });
  assert.equal(reopened.current('alice').id, batchA.id);

  const batchB = reopened.create('alice', {
    inputSnapshot: '10000000002\tB',
    settingsSnapshot: { platform_id: '15', target_versions: ['original', 'ai5'] },
    taskIds: ['10000000002']
  });
  assert.equal(reopened.current('alice').id, batchB.id);
  assert.deepEqual(reopened.list('alice').map(item => item.id), [batchB.id, batchA.id]);
  assert.equal(reopened.get('alice', batchA.id).settingsSnapshot.platform_id, '2');
});

test('abnormal rerun preselects failures and timeouts but not cancelled tasks', () => {
  const usersDir = tempUsersDir();
  const batches = createNovelFetchBatches({ usersDir });
  const batch = batches.create('alice', {
    inputSnapshot: '10000000001\tA\n10000000002\tB\n10000000003\tC',
    settingsSnapshot: { platform_id: '2', target_versions: ['ai1', 'ai3'] },
    taskIds: ['10000000001', '10000000002', '10000000003']
  });
  batches.complete('alice', batch.id, {
    fetch_failed: 1,
    tasks: [
      { bookId: '10000000001', status: 'failed', error: '抓取失败' },
      { bookId: '10000000002', status: 'cancelled', aiStatus: 'cancelled' },
      { bookId: '10000000003', status: 'incomplete', error: 'timeout' }
    ]
  });

  const prepared = batches.prepareRerun('alice', batch.id, 'abnormal');
  assert.equal(prepared.source_batch_id, batch.id);
  assert.deepEqual(prepared.preselected_book_ids, ['10000000001', '10000000003']);
  assert.equal(prepared.payload.input_text.includes('10000000002'), true, 'rerun keeps the immutable original input snapshot');
  assert.deepEqual(prepared.settings_snapshot.target_versions, ['ai1', 'ai3']);
});

test('rerun preparation never creates or replaces a batch', () => {
  const usersDir = tempUsersDir();
  const batches = createNovelFetchBatches({ usersDir });
  const source = batches.create('alice', {
    inputSnapshot: '10000000001\tA',
    settingsSnapshot: { platform_id: '2' },
    taskIds: ['10000000001']
  });
  const before = batches.list('alice').map(item => item.id);
  const prepared = batches.prepareRerun('alice', source.id, 'all');
  const after = batches.list('alice').map(item => item.id);

  assert.deepEqual(after, before);
  assert.deepEqual(prepared.preselected_book_ids, ['10000000001']);
  assert.equal(prepared.payload.source_batch_id, source.id);
});
