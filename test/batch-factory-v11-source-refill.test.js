const test = require('node:test');
const assert = require('node:assert/strict');
const { refillMissingBatchFactoryBookSource } = require('../lib/batch-factory-v11/source-refill');

test('Batch Factory V11 source refill carries 121 category/genre and derives gender', async () => {
  let captured;
  await refillMissingBatchFactoryBookSource({
    book: {
      bookId: '7673480334440139800',
      platform: '番茄付费',
      revision: 2,
      sourceText: '',
      sourceMetadata: { sourceMode: 'manual_original' }
    },
    platforms: [{ id: '2', name: '番茄付费' }],
    fetchDirectOriginal: async () => ({
      text: '第一章\n正文', rawText: '第一章\n正文', attempts: 1,
      bookinfo: { book_name: '港岛雨停，再无爱意', category: '男生生活', genre: 8 }
    }),
    captureSource: async payload => { captured = payload; return { book: payload }; }
  });

  assert.equal(captured.sourceMetadata.category, '男生生活');
  assert.equal(captured.sourceMetadata.genre, 8);
  assert.equal(captured.sourceMetadata.gender, '男频');
  assert.equal(captured.sourceMetadata.genderSource, '121_category');
  assert.equal(captured.sourceTitle, '港岛雨停，再无爱意');
  assert.equal(captured.sourceMetadata.sourceBookTitle, '港岛雨停，再无爱意');
});

test('Batch Factory V11 source refill does not overwrite an existing manual gender', async () => {
  let captured;
  await refillMissingBatchFactoryBookSource({
    book: {
      bookId: '7673480334440139801',
      platform: '番茄付费',
      revision: 3,
      sourceText: '',
      sourceMetadata: { gender: '女频', genderSource: 'input', sourceMode: 'manual_original' }
    },
    platforms: [{ id: '2', name: '番茄付费' }],
    fetchDirectOriginal: async () => ({
      text: '正文', attempts: 1,
      bookinfo: { category: '男生生活', genre: 8 }
    }),
    captureSource: async payload => { captured = payload; return { book: payload }; }
  });

  assert.equal(captured.sourceMetadata.category, '男生生活');
  assert.equal(captured.sourceMetadata.genre, 8);
  assert.equal(captured.sourceMetadata.gender, '女频');
  assert.equal(captured.sourceMetadata.genderSource, 'input');
});

test('Batch Factory V11 maps Yangguang YG to 121 Dianzhong and persists the resolved platform', async () => {
  let captured;
  let requestedPlatformId;
  await refillMissingBatchFactoryBookSource({
    book: {
      bookId: '11010508364',
      platform: 'YG',
      revision: 1,
      sourceText: '',
      sourceMetadata: { platformCode: 'YG' }
    },
    platforms: [{ id: '4', name: '点众付费' }],
    fetchDirectOriginal: async ({ platformId }) => {
      requestedPlatformId = platformId;
      return { text: '原文正文', attempts: 1, bookinfo: { book_name: '阳光来源测试书' } };
    },
    captureSource: async payload => { captured = payload; return { book: payload }; }
  });

  assert.equal(requestedPlatformId, '4');
  assert.equal(captured.sourceMetadata.platformCode, 'YG');
  assert.equal(captured.sourceMetadata.platformId, '4');
});

test('Batch Factory V11 prefers the imported platform ID over the giant-material display name', async () => {
  let requestedPlatformId;
  let captured;
  await refillMissingBatchFactoryBookSource({
    book: {
      bookId: '7680846321393224766',
      platform: '常读',
      revision: 1,
      sourceText: '',
      sourceMetadata: { sourceMode: 'giant_material', platformCode: 'CD', platformId: '2' }
    },
    fetchDirectOriginal: async ({ platformId }) => {
      requestedPlatformId = platformId;
      return { text: '书城正文', attempts: 1, bookinfo: { work_title: '测试书' } };
    },
    captureSource: async payload => { captured = payload; return { ok: true }; }
  });

  assert.equal(requestedPlatformId, '2');
  assert.equal(captured.sourceMetadata.platformId, '2');
});

test('Batch Factory V11 maps 常读/CD to 121 platform 2 when imported numeric ID is absent', async () => {
  let requestedPlatformId;
  await refillMissingBatchFactoryBookSource({
    book: {
      bookId: '7687803827877071897',
      platform: '常读',
      revision: 1,
      sourceText: '',
      sourceMetadata: { sourceMode: 'giant_material', platformCode: 'CD' }
    },
    fetchDirectOriginal: async ({ platformId }) => {
      requestedPlatformId = platformId;
      return { text: '书城正文', attempts: 1 };
    },
    captureSource: async () => ({ ok: true })
  });

  assert.equal(requestedPlatformId, '2');
});
