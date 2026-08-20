// 改文工作台：后端路由测试（routes/novel-fetch-workshop.js）
// 覆盖 /process 解析建任务、/tasks 列表、/tasks/:bookId 详情、/config 读取，
// 以及 /process 含自动分类/抓取/改文的完整链路（注入 mock 的 classifier/rewrite/fetch）。
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const assert = require('node:assert');
const { createNovelFetchWorkshopRouter } = require('../routes/novel-fetch-workshop');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workshop-routes-'));

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

function makeApp({ tasks, configStore, classifier, rewrite, jobsStore } = {}) {
  const noopAuth = (req, res, next) => { req.username = 'u1'; next(); };
  const options = { auth: noopAuth, tasks, configStore, systemDir: makeTempDir() };
  if (classifier) options.classifier = classifier;
  if (rewrite) options.rewrite = rewrite;
  if (jobsStore) options.jobsStore = jobsStore;
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
  const tasks = {
    listTasks: async () => [],
    getTask: async (u, id) => id === 'x' ? { meta: { bookId: 'x' } } : null,
    readOriginal: () => '正文',
    readLogs: () => [],
    listAiVersions: async () => [],
    readSensitiveRecords: async () => ({ sensitive_hits: {}, sensitive_fixed: {} }),
    readSiteSubmitLog: async () => [],
    readSiteSubmitResult: async () => null
  };
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

test('POST /process/start 返回 jobId；GET jobs/latest 与 jobs/:jobId 可查询', async () => {
  const started = [];
  const jobsStore = {
    startProcessJob: ({ workflow, tasksToProcess }) => {
      started.push({ workflow, tasksToProcess });
      return 'job_123';
    },
    getJob: (id) => id === 'job_123' ? { id: 'job_123', status: 'done', steps: [], result: {} } : null,
    listLatest: (n) => [{ id: 'job_123', status: 'done', steps: [], updatedAt: '2026-08-20T10:00:00+08:00' }]
  };
  const tasks = { saveTasks: async () => ({}), listTasks: async () => [] };
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({}) };
  const app = makeApp({ tasks, configStore, jobsStore });

  const r1 = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/process/start', body: { inputText: '1\t书A', platformId: '2' } });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.jobId, 'job_123');
  assert.equal(started.length, 1);
  assert.equal(started[0].workflow.username, 'u1');
  assert.equal(started[0].workflow.body.inputText, '1\t书A');

  const r2 = await req(app, { path: '/api/novel-fetch-workshop/process/jobs/latest?limit=5' });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.jobs.length, 1);
  assert.equal(r2.body.jobs[0].id, 'job_123');

  const r3 = await req(app, { path: '/api/novel-fetch-workshop/process/jobs/job_123' });
  assert.equal(r3.status, 200);
  assert.equal(r3.body.id, 'job_123');

  const r4 = await req(app, { path: '/api/novel-fetch-workshop/process/jobs/nope' });
  assert.equal(r4.status, 404);
});

test('POST /process/start 空 inputText 返回 400', async () => {
  const jobsStore = { startProcessJob: () => 'job_x', getJob: () => null, listLatest: () => [] };
  const tasks = { saveTasks: async () => ({}), listTasks: async () => [] };
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({}) };
  const app = makeApp({ tasks, configStore, jobsStore });
  const r = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/process/start', body: { inputText: '   ' } });
  assert.equal(r.status, 400);
});

test('POST /tasks/batch-retry 调 stub tasks.batchRetry', async () => {
  let called = null;
  const tasks = {
    batchRetry: async (username, ids, deps) => {
      called = { username, ids, hasDeps: Boolean(deps && typeof deps.retryClassify === 'function') };
      return { requested: 2, retried: 1, failed: 1, results: [{ id: '1', ok: true }, { id: '2', ok: false, error: '任务不存在' }] };
    },
    listTasks: async () => []
  };
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({}) };
  const app = makeApp({ tasks, configStore });
  const r = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/tasks/batch-retry', body: { ids: ['1', '2'] } });
  assert.equal(r.status, 200);
  assert.equal(called.username, 'u1');
  assert.deepEqual(called.ids, ['1', '2']);
  assert.equal(called.hasDeps, true);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.requested, 2);
  assert.equal(r.body.retried, 1);
  assert.equal(r.body.failed, 1);
  assert.equal(r.body.results[1].error, '任务不存在');
});

test('POST /tasks/:bookId/restore-original 恢复原文', async () => {
  const tasks = {
    getTask: async (u, id) => id === 'x' ? { meta: { bookId: 'x' } } : null,
    restoreOriginal: async () => ({ status: 'done' }),
    listTasks: async () => []
  };
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({}) };
  const app = makeApp({ tasks, configStore });
  const r = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/tasks/x/restore-original' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const r2 = await req(app, { method: 'POST', path: '/api/novel-fetch-workshop/tasks/nope/restore-original' });
  assert.equal(r2.status, 404);
});

test('GET /tasks/:bookId/sensitive-log 与 site-submit-log', async () => {
  const tasks = {
    getTask: async (u, id) => id === 'x' ? { meta: { bookId: 'x' } } : null,
    readLogs: async () => [{ event: 'task_saved' }, { event: 'sensitive_ai_partial' }],
    readSensitiveRecords: async () => ({ sensitive_hits: { hit_count: 1, hits: [{ keyword: '小三' }] }, sensitive_fixed: { fixed_count: 1 } }),
    readSiteSubmitLog: async () => [{ event: 'site_submit_submitted' }],
    readSiteSubmitResult: async () => ({ status: 'submitted', versions: { ai1: { status: 'submitted' } } })
  };
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({}) };
  const app = makeApp({ tasks, configStore });
  const r1 = await req(app, { path: '/api/novel-fetch-workshop/tasks/x/sensitive-log' });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.sensitive_hits.hit_count, 1);
  assert.equal(r1.body.logs.length, 1); // 只保留 sensitive 相关事件
  assert.equal(r1.body.logs[0].event, 'sensitive_ai_partial');
  const r2 = await req(app, { path: '/api/novel-fetch-workshop/tasks/x/site-submit-log' });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.logs.length, 1);
  assert.equal(r2.body.result.status, 'submitted');
  const r3 = await req(app, { path: '/api/novel-fetch-workshop/tasks/nope/sensitive-log' });
  assert.equal(r3.status, 404);
});

test('GET /tasks/:bookId 详情含 ai_versions / sensitive_log / submit_log', async () => {
  const tasks = {
    getTask: async () => ({ meta: { bookId: 'x' }, hasOriginalRaw: true }),
    readOriginal: async () => '正文',
    readLogs: async () => [],
    listAiVersions: async () => [{ name: 'ai1', text: '版本全文', chars: 4, exists: true }],
    readSensitiveRecords: async () => ({ sensitive_hits: {}, sensitive_fixed: {} }),
    readSiteSubmitLog: async () => [],
    readSiteSubmitResult: async () => null
  };
  const configStore = { getStyles: () => [], getPlatforms: () => [], getConfig: () => ({}) };
  const app = makeApp({ tasks, configStore });
  const r = await req(app, { path: '/api/novel-fetch-workshop/tasks/x' });
  assert.equal(r.status, 200);
  assert.equal(r.body.meta.bookId, 'x');
  assert.equal(r.body.original, '正文');
  assert.ok(r.body.hasOriginalRaw === true);
  assert.equal(r.body.ai_versions.length, 1);
  assert.equal(r.body.ai_versions[0].text, '版本全文');
  assert.ok(r.body.sensitive_log && typeof r.body.sensitive_log === 'object');
  assert.deepEqual(r.body.submit_log, []); // 空数组兜底
});
