import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultModelIdForKind, withDefaultImageModel } from '../frontend/src/user/pages/shuihuo/modelDefaults.js';

const models = [
  { id: 3, kind: 'text', adapterKind: 'text_completion' },
  { id: 0, kind: 'image', adapterKind: 'account_openai_compatible_image' },
  { id: 8, kind: 'image', adapterKind: 'generic_http' }
];

test('water production defaults an unset image selection to the configured account image model', () => {
  assert.equal(defaultModelIdForKind(models, 'image', null), 0);
  assert.deepEqual(withDefaultImageModel({ imageModelId: null, imagePrefix: '' }, models), { imageModelId: 0, imagePrefix: '' });
});

test('water production preserves explicit selections and only defaults a unique video model', () => {
  assert.equal(defaultModelIdForKind(models, 'image', 8), 8);
  assert.equal(defaultModelIdForKind([{ id: 5, kind: 'video', adapterKind: 'yd_video' }], 'video', null), 5);
  assert.equal(defaultModelIdForKind([{ id: 5, kind: 'video' }, { id: 6, kind: 'video' }], 'video', null), undefined);
  assert.equal(defaultModelIdForKind([{ id: 8, kind: 'image', adapterKind: 'generic_http' }], 'image', null), undefined);
});
