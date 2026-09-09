import test from 'node:test';
import assert from 'node:assert/strict';

test('builds character and scene image requests from current fields', async () => {
  const { buildEntityImageRequest } = await import('./scriptEntityImages.js');
  assert.deepEqual(buildEntityImageRequest({
    entityType: 'scene',
    entityId: 'scene-1',
    fields: { 名称: '医院急诊走廊', 描述: '冰冷的医院走廊' },
    novelText: '林悦走进医院。',
    visualStyle: '悬疑动漫'
  }), {
    asset_type: 'scene',
    asset_id: 'scene-1',
    description: '名称：医院急诊走廊\n描述：冰冷的医院走廊',
    context: '林悦走进医院。',
    style: '悬疑动漫'
  });
});

test('generated image becomes main only when entity has no main image', async () => {
  const { mergeEntityImageState } = await import('./scriptEntityImages.js');
  const existing = mergeEntityImageState({
    imageUrls: ['https://old.example/a.png'],
    mainImageUrl: 'https://old.example/a.png'
  }, { url: 'https://new.example/b.png' });
  assert.deepEqual(existing.imageUrls, ['https://old.example/a.png', 'https://new.example/b.png']);
  assert.equal(existing.mainImageUrl, 'https://old.example/a.png');

  const first = mergeEntityImageState({ imageUrls: [] }, { url: 'https://new.example/b.png' });
  assert.deepEqual(first.imageUrls, ['https://new.example/b.png']);
  assert.equal(first.mainImageUrl, 'https://new.example/b.png');
});

test('reference asset URLs retain the asset id needed for deleting a later image', async () => {
  const { referenceAssetLocation } = await import('./scriptEntityImages.js');
  assert.deepEqual(
    referenceAssetLocation('/api/novel-panel/reference-assets/file/character/hero-mabc123/main?_=1'),
    { assetType: 'character', assetId: 'hero-mabc123', variant: 'main' }
  );
  assert.equal(referenceAssetLocation('https://cdn.example.test/ref.png'), null);
});

test('changing only entity media does not invalidate generated script text', async () => {
  const { entityContentChanged } = await import('./scriptEntityImages.js');
  assert.equal(entityContentChanged({ data: { 名称: '林悦', 外形: '年轻孕妇' } }, { 名称: '林悦', 外形: '年轻孕妇' }), false);
  assert.equal(entityContentChanged({ data: { 名称: '林悦', 外形: '年轻孕妇' } }, { 名称: '林悦', 外形: '白发孕妇' }), true);
});
