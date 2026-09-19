const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ai = require('../lib/novel-fetch-workshop/ai');
const classifier = require('../lib/novel-fetch-workshop/classifier');
const rewrite = require('../lib/novel-fetch-workshop/rewrite');
const { createConfigStoreSnapshot } = require('../lib/novel-fetch-workshop/v2-batch-executor');
const { createNovelFetchTaskOps, toV78Task } = require('../lib/novel-fetch-workshop/task-ops');

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

test('小说获取选择文本模型后立即持久化当前用户配置', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'batch-rewrite', 'app.js'), 'utf8');
  assert.match(source, /function persistSelectedTextModel\(/);
  assert.match(source, /select\.value = value;[\s\S]*persistSelectedTextModel\(value\)/);
  assert.match(source, /app_config:\s*\{\s*text_model_id:\s*id/);
});

test('小说获取启动任务携带已选文本模型快照', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'batch-rewrite', 'app.js'), 'utf8');
  assert.match(source, /const payload = \{[\s\S]*text_model_id:\s*textModelId/s);
});

test('小说获取工作台路由把中央文本模型选择和运行时解析器传入 AI 层', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'novel-fetch-workshop.js'), 'utf8');
  assert.match(route, /text_model_id/);
  assert.match(route, /resolveRuntimeModel/);
});

test('批量改文路由从 app_config 节点读取中央文本模型', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'batch-rewrite.js'), 'utf8');
  assert.match(route, /config\.app_config\?\.text_model_id/);
  assert.match(route, /config\.app_config\?\.textModelId/);
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

test('中央文本模型未选择时拒绝回退到旧版文本模型配置', () => {
  const configStore = {
    getAiConfig() {
      return { ai: {}, ai_assignments: {}, text_model_id: '' };
    },
    getConfig() {
      return {
        provider: 'openai',
        baseUrl: 'https://api.example/v1',
        model: 'gemini-3.5-flash-maxthinking',
        apiKey: 'legacy-secret'
      };
    }
  };

  const settings = ai.resolveAiSettings(configStore, 'classifier');
  assert.equal(settings.baseUrl, '');
  assert.equal(settings.apiKey, '');
  assert.equal(settings.model, '');
  assert.equal(settings.runtimeError, '请先在小说获取页面选择文本模型');
});

test('小说获取分类和改文只使用下拉框选择的中央文本模型', () => {
  const calls = [];
  const configStore = {
    getAiConfig() {
      return {
        text_model_id: 'selected-gpt-5-4',
        ai: { base_url: 'https://legacy.example/v1', api_key: 'legacy-secret', model: 'legacy-model' },
        ai_presets: [{ id: 'classifier-preset', base_url: 'https://preset.example/v1', api_key: 'preset-secret', model: 'preset-model' }],
        ai_assignments: { classifier: 'classifier-preset', rewrite: 'classifier-preset', sensitive_fix: 'classifier-preset' }
      };
    },
    resolveRuntimeModel(modelId) {
      calls.push(modelId);
      return { kind: 'text', baseUrl: 'https://api.example/v1', modelId: 'gpt-5.4', credential: 'central-secret' };
    }
  };

  const settings = ai.resolveAiSettings(configStore, 'classifier');
  assert.equal(settings.baseUrl, 'https://api.example/v1');
  assert.equal(settings.apiKey, 'central-secret');
  assert.equal(settings.model, 'gpt-5.4');
  assert.deepEqual(calls, ['selected-gpt-5-4']);
});

test('中央文本模型已选择但运行时解析器缺失时明确返回中文配置错误', () => {
  const settings = ai.resolveAiSettings({
    getAiConfig: () => ({ text_model_id: 'selected-gpt-5-4', ai: {} })
  }, 'classifier');
  assert.equal(settings.baseUrl, '');
  assert.equal(settings.apiKey, '');
  assert.equal(settings.model, '');
  assert.equal(settings.runtimeError, '统一文本模型服务不可用，请联系管理员');
});

test('小说获取 AI 判断失败时在任务列表和详情中显示具体中文原因', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'batch-rewrite', 'app.js'), 'utf8');
  assert.match(source, /classify_error/);
  assert.match(source, /classifyStatusDisplay[\s\S]*classify_error/);
  assert.match(source, /classifyDetailText[\s\S]*classify_error/);
  assert.match(source, /分类错误/);
});

test('小说获取任务接口保留 AI 判断错误原因并在重试时清理旧错误', async () => {
  assert.equal(toV78Task({ classifyError: 'AI分类配置不可用：文本模型未启用' }).classify_error, 'AI分类配置不可用：文本模型未启用');
  assert.equal(toV78Task({ aiError: '请先在小说获取页面选择文本模型' }).ai_error, '请先在小说获取页面选择文本模型');
  const updates = [];
  const taskOps = createNovelFetchTaskOps({
    accountResolver: (username) => ({ username }),
    createStore: () => ({
      getTask: async () => ({ meta: { bookId: 'book-1', bookName: '测试书', platformId: '2', aiCount: 1, classifyStatus: 'failed', classifyError: '旧错误' } }),
      updateTaskMeta: async (...args) => updates.push(args),
    }),
    tombstones: { has: () => false },
    parseBooks: () => ({ tasks: [] }),
    applySavedRules: async () => {},
    createConfigSnapshot: () => ({})
  });
  const payloads = await taskOps.prepareRetryPayloads('tester', ['book-1']);
  assert.equal(payloads.length, 1);
  assert.equal(updates[0][2].classifyStatus, '');
  assert.equal(updates[0][2].classifyError, '');
  assert.equal(payloads[0].retry_stage, 'classify');
});

test('中央文本模型解析失败时分类器保留任务并返回中文配置原因', async () => {
  const tasks = [{ bookId: '2080000000000000001', bookName: '测试书', style: '', gender: '' }];
  const configStore = {
    getAiConfig() {
      return { text_model_id: 'missing-text-model', ai: {}, ai_assignments: {} };
    },
    getStyles() {
      return ['现代通用'];
    },
    resolveRuntimeModel() {
      throw new Error('文本模型不可用、未配置或尚未启用');
    }
  };

  const result = await classifier.classifyMissingRows({ configStore, tasks });

  assert.equal(result.errors.length, 1);
  assert.equal(tasks[0].classifyStatus, 'waiting_ai_config');
  assert.equal(tasks[0].classifyError, 'AI分类配置不可用：文本模型不可用、未配置或尚未启用');
});

test('小说获取改文模型配置错误在任务列表中显示中文原因', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'batch-rewrite', 'app.js'), 'utf8');
  assert.match(source, /aiStatusDisplay[\s\S]*ai_error/);
});

test('小说获取改文在中央模型不可用时保留等待状态和中文原因', async () => {
  const updates = [];
  const result = await rewrite.generateAiVersion({
    configStore: {
      getConfig: () => ({}),
      getAiConfig: () => ({ text_model_id: 'selected-gpt-5-4' }),
      resolveRuntimeModel: () => { throw new Error('文本模型不可用、未配置或尚未启用'); }
    },
    tasks: {
      readOriginal: async () => '原文内容',
      updateTaskMeta: async (_username, _bookId, patch) => updates.push(patch)
    },
    username: 'tester',
    task: { bookId: 'book-1', originalStatus: 'done' },
    aiIndex: 1,
    count: 1
  });
  assert.equal(result.status, 'waiting_ai_config');
  assert.equal(result.error, '文本模型不可用、未配置或尚未启用');
  assert.deepEqual(updates[0], { aiStatus: 'waiting_ai_config', aiCurrentVersion: '', aiError: '文本模型不可用、未配置或尚未启用' });
});

test('队列执行器兼容从旧配置的 app_config 节点读取中央文本模型', () => {
  const calls = [];
  const configStore = createConfigStoreSnapshot({}, {
    app_config: { text_model_id: 'custom-gpt-5-4' }
  }, {
    resolveRuntimeModel(modelId) {
      calls.push(modelId);
      return { modelId: 'gpt-5.4', baseUrl: 'https://api.example/v1', credential: 'secret' };
    }
  });

  assert.equal(configStore.getAiConfig().text_model_id, 'custom-gpt-5-4');
  assert.deepEqual(ai.resolveAiSettings(configStore, 'classifier'), {
    baseUrl: 'https://api.example/v1', apiKey: 'secret', model: 'gpt-5.4'
  });
  assert.deepEqual(calls, ['custom-gpt-5-4']);
});
