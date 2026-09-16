const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ai = require('../lib/novel-fetch-workshop/ai');
const { createConfigStoreSnapshot } = require('../lib/novel-fetch-workshop/v2-batch-executor');

test('小说获取改文统一解析当前用户选定的中央文本模型', () => {
  const configStore = {
    getAiConfig() {
      return {
        text_model_id: 'custom-gpt-5-4',
        ai: { timeout_seconds: 90, max_tokens: 800 },
        ai_assignments: { rewrite: '__current__' }
      };
    },
    resolveRuntimeModel(modelId) {
      assert.equal(modelId, 'custom-gpt-5-4');
      return { kind: 'text', baseUrl: 'https://api.example/v1', modelId: 'gpt-5.4', credential: 'secret' };
    }
  };
  assert.deepEqual(ai.resolveAiSettings(configStore, 'rewrite'), {
    baseUrl: 'https://api.example/v1', apiKey: 'secret', model: 'gpt-5.4',
    timeout_seconds: 90, max_tokens: 800
  });
});

test('小说获取配置界面只展示中央文本模型下拉框并调用模型目录接口', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'batch-rewrite', 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'batch-rewrite', 'app.js'), 'utf8');
  assert.match(html, /id="textModelSelect"/);
  assert.doesNotMatch(html, /id="aiBaseUrl"|id="aiApiKey"|id="aiModel"/);
  assert.match(html, /class="section legacy-api-presets"[^>]*aria-hidden="true"/);
  assert.match(source, /\/api\/models\?kind=text/);
  assert.match(source, /text_model_id/);
});

test('小说获取队列执行器把中央文本模型和运行时解析器传给分类器', () => {
  const calls = [];
  const configStore = createConfigStoreSnapshot({}, {
    text_model_id: 'custom-gpt-5-4',
    ai: { timeout_seconds: 90 },
    ai_presets: [],
    ai_assignments: { classifier: '__current__' }
  }, {
    resolveRuntimeModel(modelId) {
      calls.push(modelId);
      return { modelId: 'gpt-5.4', baseUrl: 'https://api.example/v1', credential: 'secret' };
    }
  });

  assert.equal(configStore.getAiConfig().text_model_id, 'custom-gpt-5-4');
  assert.deepEqual(configStore.resolveRuntimeModel('custom-gpt-5-4'), {
    modelId: 'gpt-5.4', baseUrl: 'https://api.example/v1', credential: 'secret'
  });
  assert.deepEqual(calls, ['custom-gpt-5-4']);
});
