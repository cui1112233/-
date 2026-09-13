const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveV11GoBaseUrl,
  enrichBatchFactorySystemPresetConfig,
  redactBatchFactorySystemPromptBodies
} = require('../routes/batch-factory-v11');

test('V11 uses its dedicated upstream when configured', () => {
  assert.equal(
    resolveV11GoBaseUrl({
      QIANTIE_BATCH_FACTORY_V11_BASE_URL: 'http://batch-factory-v11:4000',
      QIANTIE_GO_BASE_URL: 'http://backend:4000'
    }),
    'http://batch-factory-v11:4000'
  );
});

test('V11 keeps the legacy Go upstream as its compatibility fallback', () => {
  assert.equal(resolveV11GoBaseUrl({ QIANTIE_GO_BASE_URL: 'http://backend:4000' }), 'http://backend:4000');
});

test('V11 resolves a selected Batch Factory system preset only on the trusted hop', () => {
  const presetStore = {
    getPublished(id) {
      return id === 'batch-video-meta'
        ? { id, module: 'batch-factory', name: '视频提示词', version: 3, protocolLock: { slot: 'batch.video-meta' } }
        : null;
    }
  };
  const body = enrichBatchFactorySystemPresetConfig({
    patch: { aiPromptConfig: { video: { enabled: true, presetId: 'batch-video-meta', prompt: '' } } }
  }, presetStore, (_store, id) => id === 'batch-video-meta' ? '受保护的视频系统提示词' : '');

  assert.equal(body.patch.aiPromptConfig.video.prompt, '受保护的视频系统提示词');
  assert.equal(body.patch.aiPromptConfig.video.presetName, '视频提示词');
  assert.equal(body.patch.aiPromptConfig.video.presetVersion, 3);
  assert.equal(body.patch.aiPromptConfig.video.presetSlot, 'batch.video-meta');
});

test('V11 rejects a system preset outside the Batch Factory category', () => {
  const presetStore = { getPublished: () => ({ id: 'shuihuo-video-prompt', module: 'shuihuo-production' }) };
  assert.throws(
    () => enrichBatchFactorySystemPresetConfig({ patch: { aiPromptConfig: { video: { presetId: 'shuihuo-video-prompt' } } } }, presetStore, () => 'secret'),
    /批量工厂系统预设词/
  );
});

test('V11 never returns stored system preset bodies to the browser', () => {
  const response = redactBatchFactorySystemPromptBodies({
    batch: { settingsState: { patch: { aiPromptConfig: { video: { presetId: 'batch-video-meta', prompt: '受保护正文' } } } } }
  });
  assert.equal(response.batch.settingsState.patch.aiPromptConfig.video.prompt, undefined);
  assert.equal(response.batch.settingsState.patch.aiPromptConfig.video.presetId, 'batch-video-meta');
});
