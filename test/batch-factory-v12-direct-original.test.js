const test = require('node:test');
const assert = require('node:assert/strict');
const { refillMissingBatchFactoryBookSource } = require('../routes/batch-factory-v12');

test('direct retrieval preserves giant metadata and records bookstore completion', async () => {
  let captured;
  await refillMissingBatchFactoryBookSource({
    book: {
      id: 'book-1', bookId: '10122315', platform: '七猫', revision: 3, sourceText: '',
      sourceMetadata: { sourceMode: 'giant_material', giantMaterialId: '7689285397448523826', originalReadStrategy: 'direct_first', originalReadStage: 'direct', contentPending: true }
    },
    platforms: [{ id: '1', name: '七猫' }],
    now: () => new Date('2026-10-01T00:00:00.000Z'),
    fetchDirectOriginal: async () => ({ text: '书城正文', attempts: 1, bookinfo: { work_title: '原书名' } }),
    captureSource: async payload => { captured = payload; return { book: payload }; }
  });
  assert.equal(captured.sourceText, '书城正文');
  assert.equal(captured.sourceMetadata.sourceMode, 'giant_material');
  assert.equal(captured.sourceMetadata.giantMaterialId, '7689285397448523826');
  assert.equal(captured.sourceMetadata.originalReadStage, 'completed');
  assert.equal(captured.sourceMetadata.originalReadVia, 'bookstore');
  assert.equal(captured.sourceMetadata.contentPending, false);
});

test('direct retrieval never replaces a saved source', async () => {
  let called = false;
  await assert.rejects(() => refillMissingBatchFactoryBookSource({
    book: { bookId: '10122315', platform: '七猫', sourceText: '已保存正文' },
    fetchDirectOriginal: async () => { called = true; return { text: '不应读取' }; },
    captureSource: async () => ({})
  }), /当前书已有正文，不能覆盖/);
  assert.equal(called, false);
});
