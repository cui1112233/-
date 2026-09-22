import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFactoryPlatformOptions } from './batchFactoryPlatformOptions.js';

test('batch intake renders the shared Novel Fetch platform ID and name', () => {
  assert.deepEqual(
    batchFactoryPlatformOptions([{ id: '2', name: '番茄付费' }]),
    [{ value: '2', label: '番茄付费' }]
  );
});

test('batch intake omits incomplete platform records', () => {
  assert.deepEqual(batchFactoryPlatformOptions([{ id: '', name: '无编号' }, { id: '15', name: '' }]), []);
});

test('batch intake keeps a usable built-in catalog when the shared directory is unavailable', () => {
  assert.deepEqual(
    batchFactoryPlatformOptions([], { fallback: true }),
    [
      { value: '1', label: '黑岩付费' },
      { value: '2', label: '番茄付费' },
      { value: '3', label: '七猫付费' },
      { value: '4', label: '点众付费' },
      { value: '7', label: '番茄免费' },
      { value: '15', label: '知乎付费' },
      { value: '20', label: '掌阅付费' },
      { value: '26', label: '卓越付费' },
      { value: '29', label: '九州书城' },
      { value: '31', label: '掌文付费' }
    ]
  );
});
