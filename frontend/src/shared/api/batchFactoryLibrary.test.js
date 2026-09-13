import assert from 'node:assert/strict';
import test from 'node:test';
import { createBatchFactoryLibrary } from './batchFactoryLibrary.js';

test('creates a V11 batch containing the submitted novel instead of using a Shuihuo project API', async () => {
  const calls = [];
  const library = createBatchFactoryLibrary({
    listBatches: async () => ({ batches: [] }),
    createBatch: async payload => {
      calls.push(payload);
      return { batch: { id: 'batch-42', ...payload } };
    }
  });

  const batch = await library.createDocument({
    title: '  夜雨  ',
    sourceText: '第一行\n第二行',
    filename: '夜雨.txt'
  });

  assert.equal(batch.id, 'batch-42');
  assert.deepEqual(calls, [{
    title: '夜雨',
    books: [{
      title: '夜雨',
      sourceText: '第一行\n第二行',
      txtFileName: '夜雨.txt',
      sourceMetadata: { importSource: 'manual-file', fileName: '夜雨.txt' }
    }]
  }]);
});

test('returns the V11-owned batch collection for the copied library view', async () => {
  const batches = [{ id: 'batch-1', title: '作品文档', books: [{ id: 'book-1' }] }];
  const library = createBatchFactoryLibrary({
    listBatches: async () => ({ batches }),
    createBatch: async () => { throw new Error('not used'); }
  });

  assert.equal(await library.listDocuments(), batches);
});
