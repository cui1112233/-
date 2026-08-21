import test from 'node:test';
import assert from 'node:assert/strict';
import { hasYDVideoSource } from '../frontend/src/user/pages/shuihuo/videoInput.js';

const segment = { id: 36 };

test('YD accepts a current segment primary image', async () => {
  const available = await hasYDVideoSource({
    readModel: { media: [{ segmentId: 36, kind: 'image', isPrimary: true }] },
    segmentId: segment.id,
    listAssetImages: async () => ({ images: [] })
  });
  assert.equal(available, true);
});

test('YD accepts a bound scene asset image and rejects a segment with no visual source', async () => {
  const sceneWithImage = {
    media: [],
    assets: [{ id: 12, category: 'scene', referenceObjectKey: '' }],
    segmentAssetIDs: { 36: [12] }
  };
  assert.equal(await hasYDVideoSource({
    readModel: sceneWithImage,
    segmentId: segment.id,
    listAssetImages: async assetId => ({ images: assetId === 12 ? [{ id: 4, isPrimary: true }] : [] })
  }), true);

  assert.equal(await hasYDVideoSource({
    readModel: { media: [], assets: [], segmentAssetIDs: { 36: [] } },
    segmentId: segment.id,
    listAssetImages: async () => ({ images: [] })
  }), false);
});
