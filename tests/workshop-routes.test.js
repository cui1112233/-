// 改文工作台：后端路由测试（routes/novel-fetch-workshop.js）
// 覆盖 /process 解析建任务、/tasks 列表、/tasks/:bookId 详情、/config 读取，
// 以及 /process 含自动分类/抓取/改文的完整链路（注入 mock 的 classifier/rewrite/fetch）。
const express = require('express');
const { test } = require('node:test');
const assert = require('node:assert');
const { createNovelFetchWorkshopRouter } = require('../routes/novel-fetch-workshop');

// 请求辅助：简单 fetch 风格
function req(app, { method = 'GET', path, body }) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const u = `http://127.0.0.1:${port}${path}`;
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      fetch(u, opts).then(async res => {
        const text = await res.text();
        server.close();
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.status, body: json });
      }).catch(e => { server.close(); resolve({ status: 0, body: null, error: e }); });
    });
  });
}

function makeApp({ tasks, configStore, classifier, rewrite, systemDir, knowledgeStore, openingStore } = {}) {
  const noopAuth = (req, res, next) => { req.username = 'u1'; next(); };
  const options = { auth: noopAuth, tasks, configStore, systemDir, knowledgeStore, openingStore };
  if (classifier) options.classifier = classifier;
  if (rewrite) options.rewrite = rewrite;
  return express().use(express.json()).use('/api/novel-fetch-workshop', createNovelFetchWorkshopRouter(options));
}

test('POST /process 解析并创建任务', async () => {
  const tasks = {
    saveTasks: async () => ({ saved: 1 }),
    listTasks: async () => [{ bookId: '1', bookName: '书' }]
  };
  const configStore = {
    getStyles: () => ['现代女主'],
    getPlatforms: () => [{ id: '2', name: '番茄付费' }],
    getConfig: () => ({ workflow: { auto_classify_missing: false, auto_fetch_original: false, auto_rewrite_after_fetch: false } })
  };
  const app = makeApp({ tasks, configStore });
  const r = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/process', body: { inputText: '1\t书A\t\t女频\t\t', parseMode: 'smart', columnPresetId: 'sample_input' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.uniqueTasks, 1);
  assert.equal(r.body.tasks[0].bookId, '1');
});

test('GET /tasks 与 GET /tasks/:bookId', async () => {
  const tasks = { listTasks: async () => [], getTask: async (u, id) => id === 'x' ? { meta: { bookId: 'x' } } : null, readOriginal: () => '正文', readLogs: () => [] };
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({}) };
  const app = makeApp({ tasks, configStore });
  const r1 = await req(app, { path: '/api/novel-fetch-workshop/tasks' });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body.tasks, []);
  const r2 = await req(app, { path: '/api/novel-fetch-workshop/tasks/x' });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.meta.bookId, 'x');
  const r3 = await req(app, { path: '/api/novel-fetch-workshop/tasks/nope' });
  assert.equal(r3.status, 404);
});

test('GET /config 与 POST /ai/test', async () => {
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({ workflow: {} }), getAiConfig: () => ({ ai: {}, ai_presets: [], ai_assignments: {} }) };
  const app = makeApp({ tasks: {}, configStore });
  const r1 = await req(app, { path: '/api/novel-fetch-workshop/config' });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.appConfig);
});

test('DELETE /tasks 批量删除任务并返回最新列表', async () => {
  let deletedIds = null;
  const tasks = {
    deleteTasks: (u, ids) => {
      deletedIds = ids;
      return {
        requested: ids.length,
        deleted: ids.length,
        results: ids.map(id => ({ bookId: id, deleted: true }))
      };
    },
    listTasks: async () => []
  };
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({}) };
  const app = makeApp({ tasks, configStore });
  const r = await req(app, { method: 'DELETE', path: '/api/novel-fetch-workshop/tasks', body: { ids: ['1', '2'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(deletedIds, ['1', '2']);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.requested, 2);
  assert.equal(r.body.deleted, 2);
  assert.deepEqual(r.body.results, [{ bookId: '1', deleted: true }, { bookId: '2', deleted: true }]);
  assert.deepEqual(r.body.tasks, []);
});

test('POST /tasks 批量重试与恢复原文', async () => {
  const retried = [];
  const restored = [];
  const tasks = {
    getTask: async (u, id) => id === 'missing' ? null : { meta: { bookId: id, maxTxt: 3000 } },
    fetchOriginal: async (u, id, maxTxt) => { retried.push([u, id, maxTxt]); return { status: 'done' }; },
    restoreOriginal: async (u, id) => { restored.push([u, id]); return { status: 'done' }; },
    listTasks: async () => [{ bookId: '1' }]
  };
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({}) };
  const app = makeApp({ tasks, configStore });

  const retriedResponse = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/tasks/batch-retry', body: { ids: ['1', '2'] } });
  assert.equal(retriedResponse.status, 200);
  assert.deepEqual(retried, [['u1', '1', 3000], ['u1', '2', 3000]]);
  assert.deepEqual(retriedResponse.body.tasks, [{ bookId: '1' }]);

  const restoredResponse = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/tasks/1/restore-original' });
  assert.equal(restoredResponse.status, 200);
  assert.deepEqual(restored, [['u1', '1']]);
});

test('POST /process 自动分类/抓取/改文 全链路（注入 mock）', async () => {
  const tasks = {
    saveTasks: async () => ({ saved: 1 }),
    listTasks: async () => [{ bookId: '1', bookName: '书A', originalStatus: 'done' }],
    fetchOriginal: async () => ({ status: 'done' }),
    getTask: async (u, id) => ({ meta: { bookId: id, originalStatus: 'done', maxTxt: 4000, aiCount: 2 } })
  };
  const configStore = {
    getStyles: () => ['现代女主'],
    getPlatforms: () => [{ id: '2', name: '番茄付费' }],
    getConfig: () => ({
      workflow: { auto_classify_missing: true, auto_fetch_original: true, auto_rewrite_after_fetch: true },
      fetch: { concurrency: 2, default_max_txt: 4000 },
      rewrite: { default_ai_count: 2 }
    })
  };
  const classifier = { classifyMissingRows: async ({ tasks: list }) => ({ tasks: list, errors: ['AI分类失败：示例'] }) };
  const rewrite = { generateAiVersions: async () => ({ status: 'done', generated: [{ status: 'done' }, { status: 'done' }] }) };
  const app = makeApp({ tasks, configStore, classifier, rewrite });
  const r = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/process', body: { inputText: '1\t书A\t\t女频\t\t', platformId: '2', parseMode: 'smart', columnPresetId: 'sample_input' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.uniqueTasks, 1);
  assert.deepEqual(r.body.classifyErrors, ['AI分类失败：示例']);
  assert.equal(r.body.fetched, 1);
  assert.equal(r.body.fetchFailed, 0);
  assert.equal(r.body.generatedAiFiles, 2);
});

test('知识库与爆款开头路由委托注入的数据存储', async () => {
  const calls = [];
  const knowledgeStore = {
    getSummary: () => ({ high_imitation: 1 }),
    list: kind => ({ items: [{ id: `${kind}_1` }] }),
    save: (kind, item) => { calls.push(['save', kind, item]); return { ok: true, item }; },
    remove: (kind, id) => { calls.push(['remove', kind, id]); return { ok: true, removed: true }; },
    optimizeItem: async ({ kind, id }) => { calls.push(['optimize', kind, id]); return { ok: true }; }
  };
  const openingStore = {
    analyze: async (ai, settings, text) => { calls.push(['analyze', text]); return { ok: true, items: [] }; },
    save: item => { calls.push(['opening-save', item]); return { ok: true, item }; },
    normalize: () => { calls.push(['normalize']); return { ok: true, removed: 1 }; }
  };
  const configStore = {
    getStyles: () => [],
    getPlatforms: () => [],
    getConfig: () => ({}),
    getAiConfig: () => ({ ai: {}, ai_presets: [], ai_assignments: {} })
  };
  const app = makeApp({ tasks: {}, configStore, knowledgeStore, openingStore });

  const summary = await req(app, { path: '/api/novel-fetch-workshop/knowledge/summary' });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.summary.high_imitation, 1);
  const list = await req(app, { path: '/api/novel-fetch-workshop/knowledge/high_imitation' });
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].id, 'high_imitation_1');
  const saved = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/knowledge/high_imitation', body: { item: { title: '示例' } } });
  assert.equal(saved.status, 200);
  const deleted = await req(app, { method: 'DELETE', path: '/api/novel-fetch-workshop/knowledge/high_imitation/hi_1' });
  assert.equal(deleted.status, 200);
  const optimized = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/knowledge/high_imitation/hi_1/optimize' });
  assert.equal(optimized.status, 200);
  const analyzed = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/opening/analyze', body: { text: '开头原文' } });
  assert.equal(analyzed.status, 200);
  const openingSaved = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/opening/save', body: { item: { text: '开头词' } } });
  assert.equal(openingSaved.status, 200);
  const normalized = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/opening/normalize' });
  assert.equal(normalized.status, 200);
  assert.deepEqual(calls, [
    ['save', 'high_imitation', { title: '示例' }],
    ['remove', 'high_imitation', 'hi_1'],
    ['optimize', 'high_imitation', 'hi_1'],
    ['analyze', '开头原文'],
    ['opening-save', { text: '开头词' }],
    ['normalize']
  ]);
});

test('规则预览返回排版结果与 trace', async () => {
  const tasks = {};
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({ layout: { apply_to_ai: true } }) };
  const rules = {
    processDocumentText: (text) => `排版：${text}`,
    processDocumentTrace: () => [{ stage: 'raw', title: '抓取原文/raw', changed: false, samples: [] }]
  };
  const app = express().use(express.json()).use('/api/novel-fetch-workshop', createNovelFetchWorkshopRouter({
    auth: (req, res, next) => { req.username = 'u1'; next(); }, tasks, configStore, rules
  }));
  const response = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/rules/preview', body: { text: '示例正文', scope: 'ai' } });
  assert.equal(response.status, 200);
  assert.equal(response.body.text, '排版：示例正文');
  assert.equal(response.body.trace[0].stage, 'raw');
});

test('POST /process 改文单任务失败不中断整批（注入 mock）', async () => {
  // 回归：改文步骤任一任务抛异常（如 AI 版本文件磁盘写失败）不得使 /process 500，
  // 第一个任务正常生成，失败计入 fetchFailed（契约固定 9 字段，改文失败并入 fetchFailed 计数）。
  const tasks = {
    saveTasks: async () => ({ saved: 2 }),
    listTasks: async () => [
      { bookId: '1', bookName: '书A', originalStatus: 'done' },
      { bookId: '2', bookName: '书B', originalStatus: 'done' }
    ],
    fetchOriginal: async () => ({ status: 'done' }),
    getTask: async (u, id) => ({ meta: { bookId: id, originalStatus: 'done', maxTxt: 4000, aiCount: 1 } })
  };
  const configStore = {
    getStyles: () => ['现代女主'],
    getPlatforms: () => [{ id: '2', name: '番茄付费' }],
    getConfig: () => ({
      workflow: { auto_classify_missing: false, auto_fetch_original: true, auto_rewrite_after_fetch: true },
      fetch: { concurrency: 4, default_max_txt: 4000 },
      rewrite: { default_ai_count: 1 }
    })
  };
  // 第 1 个任务成功生成 1 个版本；第 2 个任务抛异常（模拟 AI 版本写盘失败）
  const rewrite = {
    generateAiVersions: async ({ task }) => {
      if (task.bookId === '2') throw new Error('AI版本写盘失败');
      return { status: 'done', generated: [{ status: 'done' }] };
    }
  };
  const app = makeApp({ tasks, configStore, rewrite });
  const r = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/process', body: { inputText: '1\t书A\t\t女频\t\t\n2\t书B\t\t女频\t\t', platformId: '2', parseMode: 'smart', columnPresetId: 'sample_input' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.uniqueTasks, 2);
  assert.equal(r.body.fetched, 2);
  assert.equal(r.body.generatedAiFiles, 1);
  assert.equal(r.body.fetchFailed, 1);
});
