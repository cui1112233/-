import assert from 'node:assert/strict';
import test from 'node:test';
import { videoProviderForModel } from './videoProviderBinding.js';

test('uses the provider required by known video models and preserves the configured fallback otherwise', () => {
  assert.equal(videoProviderForModel('minimax-h3-video', 'personal_api'), 'autodl_comfyui');
  assert.equal(videoProviderForModel('custom-video-model', 'doubao_local_executor'), 'doubao_local_executor');
});

test('binds Seedance 2.0 to its YFAI provider instead of the legacy personal provider', async () => {
  const { videoProviderForModel } = await import('./videoProviderBinding.js');
  assert.equal(videoProviderForModel('seedance-2-0-official', 'personal_api'), 'yfai_seedance');
});
