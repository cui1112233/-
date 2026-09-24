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
