import test from 'node:test';
import assert from 'node:assert/strict';
import {
  batchFactoryBatchFromResponse,
  batchFactoryProjectsFrom,
  isBatchFactoryV11Project
} from './batchFactoryProjects.js';

test('V11 batches retain their upstream ID when shown in the shared personal works list', () => {
  const [project] = batchFactoryProjectsFrom([{ id: 'batch-42', title: '九月批量', books: [] }]);

  assert.deepEqual(project, {
    id: 'batch:batch-42',
    batchId: 'batch-42',
    name: '九月批量',
    productionMode: 'batch_factory',
    source: 'batch_factory_v11',
    createdAt: undefined,
    updatedAt: undefined,
    batch: { id: 'batch-42', title: '九月批量', books: [] }
  });
  assert.equal(isBatchFactoryV11Project(project), true);
});

test('a legacy Shuihuo project marked batch_factory never calls the V11 batch endpoint', () => {
  assert.equal(isBatchFactoryV11Project({ id: 'water-1', productionMode: 'batch_factory' }), false);
});

test('malformed V11 list entries are omitted instead of producing a /batches/ request', () => {
  assert.deepEqual(batchFactoryProjectsFrom([{ title: '缺少编号' }, null]), []);
});

test('a V11 batch detail response is unwrapped before the novel list reads its books', () => {
  const batch = batchFactoryBatchFromResponse({ batch: { id: 'batch-42', title: '九月批量', books: [{ id: 'book-1' }] } });

  assert.equal(batch.id, 'batch-42');
  assert.equal(batch.books.length, 1);
});
