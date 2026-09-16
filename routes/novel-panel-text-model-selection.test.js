const test = require('node:test');
const assert = require('node:assert/strict');
const novelPanelRouter = require('./novel-panel');

test('小说面板使用后台目录中选定的文本模型运行配置', () => {
  const resolved = novelPanelRouter._private.resolvePanelTextConfig({
    username: 'alice',
    selectedModelId: 'custom-gpt-5-4',
    baseConfig: {
      baseUrl: 'https://legacy.example/v1',
      model: 'legacy-model',
      apiKey: 'legacy-key'
    },
    resolveRuntimeModel(username, kind, modelId) {
      assert.equal(username, 'alice');
      assert.equal(kind, 'text');
      assert.equal(modelId, 'custom-gpt-5-4');
      return {
        id: modelId,
        baseUrl: 'https://api.example/v1',
        modelId: 'gpt-5.4',
        credential: 'catalog-key'
      };
    }
  });

  assert.deepEqual(resolved, {
    baseUrl: 'https://api.example/v1',
    model: 'gpt-5.4',
    apiKey: 'catalog-key'
  });
});

test('小说面板没有选择模型时保留旧默认配置兼容行为', () => {
  const baseConfig = { baseUrl: 'https://legacy.example/v1', model: 'legacy-model', apiKey: 'legacy-key' };
  assert.deepEqual(
    novelPanelRouter._private.resolvePanelTextConfig({ username: 'alice', selectedModelId: '', baseConfig }),
    baseConfig
  );
});
