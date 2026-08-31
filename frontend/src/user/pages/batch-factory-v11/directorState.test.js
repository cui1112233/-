import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compatibilitySummary,
  directorActionState,
  directorRevisionLabel,
  fixedVideoLabel,
  hookActionState,
  hookStatusLabel
} from './directorState.js';

test('viral mode requires approved Hook before Director action is available', () => {
  const state = directorActionState({
    book: { mode: 'viral', hook: { status: 'draft' } },
    capability: { available: true },
    connected: true
  });
  assert.equal(state.disabled, true);
  assert.match(state.reason, /Hook/);
});

test('original mode follows server director capability', () => {
  const state = directorActionState({
    book: { mode: 'original' },
    capability: { available: true },
    connected: true
  });
  assert.equal(state.disabled, false);
});

test('fixed single VIDEO label uses server maximum duration', () => {
  assert.equal(fixedVideoLabel({ maxDurationSeconds: 10 }), '固定单 VIDEO，最长 10 秒');
});

test('compatibility summary preserves orphaned server result', () => {
  assert.equal(compatibilitySummary([{ state: 'orphaned', videoId: 'v-old' }]), '1 个旧 VIDEO 覆盖已孤立');
});

test('hook generation is only available for viral mode with server capability', () => {
  assert.equal(hookActionState({ book: { mode: 'original' }, capability: { available: true }, connected: true }).disabled, true);
  assert.equal(hookActionState({ book: { mode: 'viral' }, capability: { available: true }, connected: true }).disabled, false);
});

test('approved hook cannot be approved again', () => {
  const state = hookActionState({
    book: { mode: 'viral', hook: { status: 'approved' } },
    capability: { available: true },
    action: 'approve',
    connected: true
  });
  assert.equal(state.disabled, true);
});

test('hook and director labels are derived from server state only', () => {
  assert.equal(hookStatusLabel({ status: 'draft' }), '待审核');
  assert.equal(hookStatusLabel({ status: 'approved' }), '已批准');
  assert.equal(directorRevisionLabel({ id: 'r7', revision: 7 }), 'Director Revision 7');
});

test('actions remain fail closed until callback wiring exists', () => {
  assert.equal(directorActionState({ book: { mode: 'original' }, capability: { available: true }, connected: false }).disabled, true);
  assert.equal(hookActionState({ book: { mode: 'viral' }, capability: { available: true }, connected: false }).disabled, true);
});
