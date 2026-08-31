import test from 'node:test';
import assert from 'node:assert/strict';
import { directorActionState, fixedVideoLabel, compatibilitySummary } from './directorState.js';

test('viral mode requires approved Hook before Director action is available', () => {
  const state = directorActionState({
    book: { mode: 'viral', hook: { status: 'draft' } },
    capability: { available: true }
  });
  assert.equal(state.disabled, true);
  assert.match(state.reason, /Hook/);
});

test('original mode follows server director capability', () => {
  const state = directorActionState({
    book: { mode: 'original' },
    capability: { available: true }
  });
  assert.equal(state.disabled, false);
});

test('fixed single VIDEO label uses server maximum duration', () => {
  assert.equal(fixedVideoLabel({ maxDurationSeconds: 10 }), '固定单 VIDEO，最长 10 秒');
});

test('compatibility summary preserves orphaned server result', () => {
  assert.equal(compatibilitySummary([{ state: 'orphaned', videoId: 'v-old' }]), '1 个旧 VIDEO 覆盖已孤立');
});
