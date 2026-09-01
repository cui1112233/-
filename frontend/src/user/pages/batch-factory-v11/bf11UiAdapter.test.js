import test from 'node:test';
import assert from 'node:assert/strict';
import { createBf11UiAdapter, toV10ViewBatch } from './bf11UiAdapter.js';

test('loadWorkbench reads capabilities first and never creates an intake batch automatically', async () => {
  const calls = [];
  const api = {
    getCapabilities: async () => { calls.push('capabilities'); return { 'batch.read': { available: true } }; },
    listBatches: async () => { calls.push('batches'); return { batches: [{ id: 'b1', books: [] }] }; },
    getBatch: async id => { calls.push(`batch:${id}`); return { batch: { id, books: [] } }; },
    getIntake: async id => { calls.push(`intake:${id}`); return { intake: { id, consumedAt: '' } }; },
    createBatchFromIntake: async () => { calls.push('CREATE'); return {}; }
  };
  const adapter = createBf11UiAdapter(api);
  const state = await adapter.loadWorkbench({ intakeId: 'i1' });
  assert.equal(calls[0], 'capabilities');
  assert.equal(calls.includes('CREATE'), false);
  assert.equal(state.intake.id, 'i1');
  assert.equal(state.startsDirector, false);
});

test('saveDrawer sends a sparse batch patch including explicit false and empty string', async () => {
  let received;
  const api = {
    saveBatchSettings: async (batchId, input) => {
      received = { batchId, input };
      return { patch: input.patch, revision: 8 };
    }
  };
  const adapter = createBf11UiAdapter(api);
  const result = await adapter.saveDrawer({
    scope: 'batch',
    batchId: 'b1',
    patch: { enabled: false, body: '', omit: undefined },
    revision: 7
  });
  assert.deepEqual(received, {
    batchId: 'b1',
    input: { patch: { enabled: false, body: '' }, expectedRevision: 7 }
  });
  assert.equal(result.revision, 8);
});

test('saveDrawer routes book and video scopes without calculating inheritance', async () => {
  const calls = [];
  const api = {
    saveBookOverride: async (...args) => { calls.push(['book', ...args]); return { patch: args[2].patch }; },
    saveVideoOverride: async (...args) => { calls.push(['video', ...args]); return { patch: args[3].patch }; }
  };
  const adapter = createBf11UiAdapter(api);
  await adapter.saveDrawer({ scope: 'book', batchId: 'b1', bookId: 'k1', patch: { quality: 'x' }, revision: 2 });
  await adapter.saveDrawer({ scope: 'video', batchId: 'b1', bookId: 'k1', videoId: 'v1', patch: { negativeEnabled: false }, revision: 3 });
  assert.equal(calls[0][0], 'book');
  assert.equal(calls[1][0], 'video');
  assert.deepEqual(calls[1][4].patch, { negativeEnabled: false });
});

test('toV10ViewBatch maps books to view items but preserves server status', () => {
  const view = toV10ViewBatch({ id: 'b1', mode: 'original', books: [{ id: 'k1', title: 'A', status: 'server-status', videos: [{ id: 'v1' }] }] });
  assert.equal(view.items[0].id, 'k1');
  assert.equal(view.items[0].status, 'server-status');
  assert.deepEqual(view.items[0].videos, [{ id: 'v1' }]);
});

test('Director actions use only V11 API client methods and immutable identities', async () => {
  const calls = [];
  const api = {
    runHook: async (...args) => { calls.push(['hook', ...args]); return { hook: { id: 'h1' } }; },
    approveHook: async (...args) => { calls.push(['approve', ...args]); return { hook: { id: 'h1', status: 'approved' } }; },
    runDirector: async (...args) => { calls.push(['director', ...args]); return { directorRevision: { id: 'd1' } }; }
  };
  const adapter = createBf11UiAdapter(api);
  await adapter.runHook({ batchId: 'b1', bookId: 'k1' });
  await adapter.approveHook({ batchId: 'b1', bookId: 'k1', hookId: 'h1' });
  await adapter.runDirector({ batchId: 'b1', bookId: 'k1' });
  assert.deepEqual(calls, [
    ['hook', 'b1', 'k1'],
    ['approve', 'b1', 'k1', 'h1'],
    ['director', 'b1', 'k1']
  ]);
});
