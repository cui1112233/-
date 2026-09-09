import test from 'node:test';
import assert from 'node:assert/strict';
import * as batchFactoryV11 from '../../../shared/api/batchFactoryV11.js';
import * as scriptVideo from '../../../shared/api/scriptVideo.js';
import { createBf11UiAdapter } from './bf11UiAdapter.js';

test('shared clients expose one unified video-model catalog boundary', () => {
  assert.equal(typeof batchFactoryV11.getVideoModels, 'function');
  assert.equal(typeof scriptVideo.listScriptVideoModels, 'function');
});

test('V11 workbench reads and exposes server video models', async () => {
  let catalogCalls = 0;
  const api = {
    getCapabilities: async () => ({}),
    listBatches: async () => ({ batches: [{ id: 'b1', books: [] }] }),
    getBatch: async id => ({ batch: { id, books: [] } }),
    getConfigVersions: async () => ({ configVersions: [] }),
    getVideoModels: async () => {
      catalogCalls += 1;
      return { videoModels: [{ id: 'minimax-h3', label: 'MiniMax H3', provider: 'autodl_comfyui', maxDuration: 15 }] };
    },
    getVideoProviderStatus: async provider => ({ provider, configured: provider === 'autodl_comfyui', model: provider === 'autodl_comfyui' ? 'minimax-h3' : '' }),
    listLocalExecutors: async () => ({ executors: [] })
  };
  const state = await createBf11UiAdapter(api).loadWorkbench();
  assert.equal(catalogCalls, 1);
  assert.deepEqual(state.videoModels, [{ id: 'minimax-h3', label: 'MiniMax H3', provider: 'autodl_comfyui', maxDuration: 15 }]);
});

test('V11 production never falls back to personal_api when provider was not saved', async () => {
  let called = false;
  const api = {
    submitBatchProduction: async () => { called = true; return {}; }
  };
  await assert.rejects(
    () => createBf11UiAdapter(api).runProduction({ batchId: 'b1', requestId: 'r1' }),
    /视频提供方|provider|模型/
  );
  assert.equal(called, false);
});
