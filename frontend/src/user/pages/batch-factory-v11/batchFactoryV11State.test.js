import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionState,
  batchDirectorActionState,
  intakeCreateState,
  selectBook,
  preserveSparsePatch
} from './batchFactoryV11State.js';

test('unreleased action remains disabled from server capability', () => {
  assert.equal(actionState({ 'director.run': { available: false, reason: 'not released' } }, 'director.run').disabled, true);
});

test('batch Director is disabled when the public Director capability is unavailable', () => {
  const state = batchDirectorActionState({
    capability: { available: false, reason: 'Director slice not released' },
    connected: true,
    batch: { id: 'batch-1' }
  });
  assert.equal(state.disabled, true);
  assert.equal(state.reason, 'Director slice not released');
});

test('batch Director requires a real batch action connection after capability release', () => {
  const state = batchDirectorActionState({
    capability: { available: true },
    connected: false,
    batch: { id: 'batch-1' }
  });
  assert.equal(state.disabled, true);
  assert.equal(state.reason, '等待 Director 批量动作接线');
});

test('batch Director becomes enabled only for a released capability and real batch', () => {
  assert.deepEqual(
    batchDirectorActionState({
      capability: { available: true },
      connected: true,
      batch: { id: 'batch-1' }
    }),
    { disabled: false, reason: '' }
  );
});

test('released action is enabled only from server capability', () => {
  assert.equal(actionState({ 'settings.edit': { available: true } }, 'settings.edit').disabled, false);
});

test('missing capability fails closed', () => {
  const state = actionState({}, 'production.submit');
  assert.equal(state.disabled, true);
  assert.match(state.reason, /未启用|不可用/);
});

test('selecting a Book changes the current Book identity', () => {
  assert.equal(selectBook({ selectedBookId: 'a' }, 'b').selectedBookId, 'b');
});

test('intake handoff does not start Director automatically', () => {
  assert.equal(intakeCreateState({ id: 'i1', consumedAt: '' }).startsDirector, false);
});

test('sparse patch preserves explicit false, empty string and zero', () => {
  const patch = preserveSparsePatch({ enabled: false, body: '', duration: 0, untouched: undefined });
  assert.deepEqual(patch, { enabled: false, body: '', duration: 0 });
});
