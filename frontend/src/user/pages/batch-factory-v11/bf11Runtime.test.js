import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBf11Runtime,
  createdBatchIdFrom,
  settingsStateFrom,
  workbenchStateFromLoad
} from './bf11Runtime.js';

test('workbenchStateFromLoad never invents demo books when no batch exists', () => {
  const state = workbenchStateFromLoad({ capabilities: {}, batches: [], selectedBatch: null });
  assert.equal(state.phase, 'ready');
  assert.equal(state.batch, null);
  assert.deepEqual(state.books, []);
});

test('settingsStateFrom preserves explicit false empty string and zero', () => {
  const state = settingsStateFrom({ patch: { enabled: false, body: '', duration: 0 }, revision: 7 });
  assert.deepEqual(state.patch, { enabled: false, body: '', duration: 0 });
  assert.equal(state.revision, 7);
});

test('runtime load returns error state instead of demo fallback', async () => {
  const runtime = createBf11Runtime({ adapter: { loadWorkbench: async () => { const error = new Error('V11 unavailable'); error.status = 503; throw error; } } });
  const state = await runtime.load();
  assert.equal(state.phase, 'error');
  assert.equal(state.status, 503);
  assert.match(state.message, /V11 unavailable/);
  assert.equal('batch' in state && state.batch !== null, false);
});

test('runtime save replaces local patch with server SettingsState', async () => {
  const calls = [];
  const runtime = createBf11Runtime({ adapter: {
    loadWorkbench: async () => ({}),
    saveDrawer: async input => {
      calls.push(input);
      return { patch: { qualityEnabled: false, negative: '' }, revision: 9, compatibility: [] };
    }
  } });
  const result = await runtime.save({ scope: 'book', batchId: 'b1', bookId: 'k1', patch: { qualityEnabled: false, negative: '' }, revision: 8 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.patch, { qualityEnabled: false, negative: '' });
  assert.equal(result.state.revision, 9);
  assert.equal(calls[0].revision, 8);
});

test('runtime save treats 409 as revision conflict and does not claim success', async () => {
  const runtime = createBf11Runtime({ adapter: {
    loadWorkbench: async () => ({}),
    saveDrawer: async () => { const error = new Error('stale revision'); error.status = 409; throw error; }
  } });
  const result = await runtime.save({ scope: 'video', batchId: 'b1', bookId: 'k1', videoId: 'v1', patch: { enabled: false }, revision: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.match(result.message, /刷新/);
});

test('created batch id is read from server response without starting Director', async () => {
  assert.equal(createdBatchIdFrom({ batch: { id: 'b9' } }), 'b9');
  assert.equal(createdBatchIdFrom({ id: 'b8' }), 'b8');
  const runtime = createBf11Runtime({ adapter: {
    createBatchFromIntake: async () => ({ batch: { id: 'b9' } })
  } });
  const result = await runtime.createBatchFromIntake({ intakeId: 'i1' });
  assert.equal(result.ok, true);
  assert.equal(result.startsDirector, false);
  assert.equal(createdBatchIdFrom(result.raw), 'b9');
});

test('runtime Director actions surface server failure and never claim local success', async () => {
  const runtime = createBf11Runtime({ adapter: {
    runHook: async () => ({ hook: { id: 'h1' } }),
    approveHook: async () => { const error = new Error('Hook stale'); error.status = 409; throw error; },
    runDirector: async () => ({ directorRevision: { id: 'd1' } })
  } });
  assert.equal((await runtime.runHook({ batchId: 'b1', bookId: 'k1' })).ok, true);
  const failed = await runtime.approveHook({ batchId: 'b1', bookId: 'k1', hookId: 'h1' });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 409);
  assert.match(failed.message, /Hook stale/);
  assert.equal((await runtime.runDirector({ batchId: 'b1', bookId: 'k1' })).ok, true);
});

test('runtime final prompt preview returns only server compiler output', async () => {
  const runtime = createBf11Runtime({ adapter: {
    previewFinalPrompt: async input => ({ finalPrompt: { compiledPrompt: input.videoId }, effectiveSettings: { snapshotHash: 'h1' } })
  } });
  const result = await runtime.previewFinalPrompt({ batchId: 'b1', bookId: 'k1', videoId: 'v1' });
  assert.equal(result.ok, true);
  assert.equal(result.raw.finalPrompt.compiledPrompt, 'v1');
  assert.equal(result.raw.effectiveSettings.snapshotHash, 'h1');
});
