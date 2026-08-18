// 改文工作台：后端路由（工厂函数）
// 把 Task 1-6 的模块（parse / classifier / tasks / rewrite / config / ai）串成 HTTP 接口，
// 由 app.js 挂载到 /api/novel-fetch-workshop，供前端改文工作台（Task 8）调用。
// 鉴权用 middleware/auth 的 apiAuth；tasks / configStore 为必填依赖（测试可注入 mock）。
const express = require('express');
const { apiAuth } = require('../middleware/auth');
const aiModule = require('../lib/novel-fetch-workshop/ai');

// 并发限制执行器：把 items 按 limit 并发执行 worker，单任务异常不影响整体（结果按原序返回）
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runner = async () => {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = { ok: true, value: await worker(items[current]) };
      } catch (error) {
        results[current] = { ok: false, value: null, error };
      }
    }
  };
  const count = Math.max(1, Math.floor(Number(limit) || 1));
  const runners = [];
  for (let i = 0; i < Math.min(count, items.length); i++) runners.push(runner());
  await Promise.all(runners);
  return results;
}

function createNovelFetchWorkshopRouter({
  auth = apiAuth,
  tasks,
  configStore,
  classifier = require('../lib/novel-fetch-workshop/classifier'),
  rewrite = require('../lib/novel-fetch-workshop/rewrite'),
  parse = require('../lib/novel-fetch-workshop/parse')
} = {}) {
  if (!tasks || !configStore) throw new Error('tasks 与 configStore 为必填依赖');
  const router = express.Router();
  router.use(auth);

  // POST /process：解析批量清单 →（可选）AI 分类 → 保存任务 →（可选）并发抓原文 →（可选）AI 改文
  router.post('/process', async (req, res) => {
    try {
      const username = req.username;
      const { platformId = '2', inputText, parseMode = 'smart', columnPresetId, columnOrder = '', maxTxt, aiCount } = req.body || {};
      const config = configStore.getConfig() || {};
      const workflow = config.workflow || {};

      // 1. 解析批量清单
      const parsedResult = parse.parseBooks({
        inputText,
        parseMode,
        columnPresetId,
        columnOrder,
        styles: configStore.getStyles()
      });
      const parsedTasks = parsedResult.tasks || [];

      // 2. 任务携带平台信息与抓取/改文参数
      const platforms = configStore.getPlatforms() || [];
      const platform = platforms.find(item => item && String(item.id) === String(platformId));
      const platformName = platform ? platform.name : platformId;
      const defaultMaxTxt = (config.fetch && config.fetch.default_max_txt) || 4000;
      const defaultAiCount = (config.rewrite && config.rewrite.default_ai_count) || 1;
      const resolvedMaxTxt = maxTxt != null ? maxTxt : defaultMaxTxt;
      const resolvedAiCount = aiCount != null ? aiCount : defaultAiCount;
      for (const task of parsedTasks) {
        task.platformId = platformId;
        task.platformName = platformName;
        task.maxTxt = resolvedMaxTxt;
        task.aiCount = resolvedAiCount;
      }
      let tasksToProcess = parsedTasks;
      let classifyErrors = [];

      // 3. 可选：AI 分类回填缺失的男女频/风格（classifyMissingRows 内部用真实 ai.js，不 mock）
      if (workflow.auto_classify_missing && tasksToProcess.length) {
        const classifyResult = await classifier.classifyMissingRows({ configStore, tasks: tasksToProcess });
        classifyErrors = (classifyResult && classifyResult.errors) || [];
        tasksToProcess = (classifyResult && classifyResult.tasks) || tasksToProcess;
      }

      // 4. 保存任务
      if (tasksToProcess.length) await tasks.saveTasks(username, tasksToProcess);

      // 5. 可选：按配置并发抓取原文（单任务失败不中断整批，计入 fetchFailed）
      let fetched = 0;
      let fetchFailed = 0;
      const fetchedDone = new Set();
      const concurrency = (config.fetch && config.fetch.concurrency) || 4;
      if (workflow.auto_fetch_original && tasksToProcess.length) {
        const results = await runWithConcurrency(tasksToProcess, concurrency, async task => {
          const result = await tasks.fetchOriginal(username, task.bookId, task.maxTxt);
          return { task, status: (result && result.status) || 'failed' };
        });
        for (const item of results) {
          if (item.ok && item.value && item.value.status === 'done') {
            fetched++;
            fetchedDone.add(item.value.task.bookId);
          } else {
            fetchFailed++;
          }
        }
      }

      // 6. 可选：对原文成功的任务逐个生成 AI 改文版本（单任务失败不中断整批）
      //    改文失败并入 fetchFailed 计数：响应契约固定 9 字段，无法新增字段，
      //    故把改文异常计入 fetchFailed（语义扩展为"处理失败计数"，与 generatedAiFiles 的成功计数配对），
      //    成功仍累计到 generatedAiFiles；任一任务抛异常（如 AI 版本文件磁盘写失败）只计数不中断后续任务。
      let generatedAiFiles = 0;
      if (workflow.auto_rewrite_after_fetch && tasksToProcess.length) {
        for (const task of tasksToProcess) {
          if (!fetchedDone.has(task.bookId)) continue;
          try {
            const current = await tasks.getTask(username, task.bookId);
            if (!current || !current.meta || current.meta.originalStatus !== 'done') continue;
            const result = await rewrite.generateAiVersions({
              configStore,
              tasks,
              username,
              task: current.meta,
              count: task.aiCount
            });
            generatedAiFiles += (result && result.generated || []).filter(item => item && item.status === 'done').length;
          } catch (error) {
            // 单任务改文异常（如 AI 版本文件磁盘写失败）只计数，不中断后续任务
            fetchFailed++;
          }
        }
      }

      const list = await tasks.listTasks(username);
      return res.json({
        parsed: parsedResult.parsed,
        emptyIdCount: parsedResult.emptyIdCount,
        uniqueTasks: parsedResult.uniqueTasks,
        duplicateCount: parsedResult.duplicateCount,
        classifyErrors,
        fetched,
        fetchFailed,
        generatedAiFiles,
        tasks: list || []
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // GET /tasks：任务列表
  router.get('/tasks', async (req, res) => {
    try {
      const list = await tasks.listTasks(req.username);
      return res.json({ tasks: list || [] });
    } catch (error) {
      return res.status(500).json({ error: error.message || '获取任务列表失败' });
    }
  });

  // DELETE /tasks：批量删除任务（body { ids: [] }），返回删除统计与最新任务列表
  router.delete('/tasks', async (req, res) => {
    try {
      const username = req.username;
      const ids = (req.body && Array.isArray(req.body.ids)) ? req.body.ids : [];
      const result = await tasks.deleteTasks(username, ids);
      const list = await tasks.listTasks(username);
      return res.json({
        ok: true,
        requested: result.requested,
        deleted: result.deleted,
        results: (result && result.results) || [],
        tasks: list || []
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '删除任务失败' });
    }
  });

  // GET /tasks/:bookId：任务详情（meta + 清洗后原文 + 原始备份存在性 + 日志）
  router.get('/tasks/:bookId', async (req, res) => {
    try {
      const username = req.username;
      const bookId = String(req.params.bookId || '').trim();
      const task = await tasks.getTask(username, bookId);
      if (!task) return res.status(404).json({ ok: false, error: '任务不存在' });
      const original = await tasks.readOriginal(username, bookId);
      const logs = await tasks.readLogs(username, bookId);
      return res.json({
        meta: task.meta || {},
        original,
        hasOriginalRaw: task.hasOriginalRaw === true,
        logs: logs || []
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || '获取任务详情失败' });
    }
  });

  // POST /tasks/:bookId/fetch：抓取单本原文
  router.post('/tasks/:bookId/fetch', async (req, res) => {
    try {
      const username = req.username;
      const bookId = String(req.params.bookId || '').trim();
      const task = await tasks.getTask(username, bookId);
      if (!task) return res.status(400).json({ ok: false, error: '任务不存在' });
      const { maxTxt } = req.body || {};
      const resolvedMaxTxt = maxTxt != null ? maxTxt : ((task.meta && task.meta.maxTxt) || 4000);
      const result = await tasks.fetchOriginal(username, bookId, resolvedMaxTxt);
      const current = await tasks.getTask(username, bookId);
      if (!result || result.status === 'failed') {
        const errorText = (current && current.meta && current.meta.error) || '抓取失败';
        return res.status(400).json({ ok: false, error: errorText });
      }
      return res.json({ task: current });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '抓取失败' });
    }
  });

  // POST /tasks/:bookId/generate-ai：生成 AI 改文版本（数量 1~20）
  router.post('/tasks/:bookId/generate-ai', async (req, res) => {
    try {
      const username = req.username;
      const bookId = String(req.params.bookId || '').trim();
      const task = await tasks.getTask(username, bookId);
      if (!task) return res.status(404).json({ ok: false, error: '任务不存在' });
      let { count = 1 } = req.body || {};
      count = Math.floor(Number(count));
      if (!Number.isFinite(count)) count = 1;
      if (count < 1 || count > 20) return res.status(400).json({ ok: false, error: '生成数量需为 1~20 的整数' });
      await rewrite.generateAiVersions({ configStore, tasks, username, task: task.meta, count });
      const current = await tasks.getTask(username, bookId);
      return res.json({ task: current });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '生成失败' });
    }
  });

  // GET /config：读取工作台配置（主配置 / 平台表 / 风格表 / AI 配置）
  router.get('/config', (req, res) => {
    try {
      return res.json({
        appConfig: configStore.getConfig(),
        platforms: configStore.getPlatforms(),
        styles: configStore.getStyles(),
        aiConfig: configStore.getAiConfig()
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || '读取配置失败' });
    }
  });

  // POST /config：保存工作台配置（一期仅持久化 appConfig；platforms/styles 忽略）
  router.post('/config', (req, res) => {
    try {
      const { appConfig } = req.body || {};
      if (appConfig && typeof appConfig === 'object') {
        configStore.saveConfig(appConfig);
      }
      return res.json({ ok: true, config: configStore.getConfig() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '保存配置失败' });
    }
  });

  // POST /ai/test：AI 接口连通性测试
  router.post('/ai/test', async (req, res) => {
    try {
      const { purpose = 'rewrite' } = req.body || {};
      const settings = aiModule.resolveAiSettings(configStore, purpose);
      const response = await aiModule.chatCompletion(settings, [
        { role: 'system', content: '你是接口连通性测试助手。' },
        { role: 'user', content: '请只回复：ok' }
      ], { temperature: 0 });
      const text = (response && response.text) || '';
      return res.json({ ok: true, content: text.slice(0, 200) });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || 'AI 接口测试失败' });
    }
  });

  return router;
}

module.exports = { createNovelFetchWorkshopRouter };
