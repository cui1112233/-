import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMART_UNIFIED_PREFIX_PRESET_ID,
  shouldInjectSmartUnifiedStyle,
  normalizeAudioDurationSeconds,
  readAudioDurationFromUrl
} from '../frontend/src/user/pages/scriptGenerationRules.js';

test('frontend Smart Unified decision follows the prefix switch and preset', () => {
  assert.equal(shouldInjectSmartUnifiedStyle({ prefix: { enabled: true, presetId: SMART_UNIFIED_PREFIX_PRESET_ID } }), true);
  assert.equal(shouldInjectSmartUnifiedStyle({ prefix: { enabled: true, presetId: 'other' } }), false);
  assert.equal(shouldInjectSmartUnifiedStyle({ prefix: { enabled: false, presetId: SMART_UNIFIED_PREFIX_PRESET_ID } }), false);
});

test('frontend audio duration preserves actual hundredths', () => {
  assert.equal(normalizeAudioDurationSeconds(28.369), 28.37);
  assert.equal(normalizeAudioDurationSeconds('28'), 28);
  assert.equal(normalizeAudioDurationSeconds(-1), null);
});

test('frontend reads audio metadata and resolves a normalized duration', async () => {
  class FakeAudio {
    duration = 28.01;
    load() { queueMicrotask(() => this.onloadedmetadata()); }
  }
  assert.equal(await readAudioDurationFromUrl('blob:audio', { AudioCtor: FakeAudio }), 28.01);
});
