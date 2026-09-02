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

test('final prompt preview reads effective settings and compiled prompt from Go', async () => {
  const calls = [];
  const api = {
    getEffectiveSettings: async (...args) => { calls.push(['effective', ...args]); return { effectiveSettings: { snapshotHash: 's1' } }; },
    getFinalPrompt: async (...args) => { calls.push(['prompt', ...args]); return { finalPrompt: { compiledPrompt: 'ready' } }; }
  };
  const result = await createBf11UiAdapter(api).previewFinalPrompt({ batchId: 'b1', bookId: 'k1', videoId: 'v1' });
  assert.deepEqual(calls, [['effective', 'b1', 'k1', 'v1'], ['prompt', 'b1', 'k1', 'v1']]);
  assert.equal(result.effectiveSettings.snapshotHash, 's1');
  assert.equal(result.finalPrompt.compiledPrompt, 'ready');
});

test('batch management, prompt persistence, production and merge actions use the V11 API client', async () => {
  const calls = [];
  const api = {
    listBatches: async () => ({ batches: [{ id: 'b1', books: [] }] }),
    createBatch: async payload => ({ batch: { id: 'b2', title: payload.title } }),
    saveDraft: async payload => { calls.push(['draft', payload]); return payload; },
    createPrompt: async payload => { calls.push(['prompt', payload]); return payload; },
    runBatchDirector: async id => { calls.push(['director', id]); return { id }; },
    saveVideoOverride: async (...args) => { calls.push(['video', ...args]); return args; },
    submitBatchMerge: async (...args) => { calls.push(['merge', ...args]); return args; }
  };
  const adapter = createBf11UiAdapter(api);
  assert.equal((await adapter.listBatches())[0].id, 'b1');
  assert.equal((await adapter.createBatch({ title: 'new' })).batch.id, 'b2');
  await adapter.saveDraft({ key: 'k' });
  await adapter.createPrompt({ name: 'p' });
  await adapter.runBatchDirector({ batchId: 'b1' });
  await adapter.saveVideoPrompt({ batchId: 'b1', bookId: 'k1', videoId: 'v1', visualPrompt: 'x', revision: 2 });
  await adapter.runMerge({ batchId: 'b1', requestId: 'r1', timingMode: 'speed', speed: '1.5', ttsSpeed: 1.7 });
  assert.equal(calls[0][0], 'draft');
  assert.equal(calls[1][0], 'prompt');
  assert.deepEqual(calls[2], ['director', 'b1']);
  assert.deepEqual(calls[3].slice(0, 4), ['video', 'b1', 'k1', 'v1']);
  assert.deepEqual(calls[4], ['merge', 'b1', { requestId: 'r1', timingMode: 'speed', speed: 1.5, ttsSpeed: 1.7 }]);
});
