// 改文工作台：后端路由（工厂函数）
// 把 Task 1-6 的模块（parse / classifier / tasks / rewrite / config / ai / jobs）串成 HTTP 接口，
// 由 app.js 挂载到 /api/novel-fetch-workshop，供前端改文工作台调用。
// 鉴权用 middleware/auth 的 apiAuth；tasks / configStore 为必填依赖（测试可注入 mock）。
const express = require('express');
const { apiAuth } = require('../middleware/auth');
const aiModule = require('../lib/novel-fetch-workshop/ai');
const rulesModule = require('../lib/novel-fetch-workshop/rules');
const { createKnowledgeStore } = require('../lib/novel-fetch-workshop/knowledge');
const { createOpeningStore } = require('../lib/novel-fetch-workshop/opening');
const { createJobsStore } = require('../lib/novel-fetch-workshop/jobs');

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
  parse = require('../lib/novel-fetch-workshop/parse'),
  systemDir,
  jobsStore,
  knowledgeStore,
  openingStore,
  rules = rulesModule
} = {}) {
  if (!tasks || !configStore) throw new Error('tasks 与 configStore 为必填依赖');
  const router = express.Router();
  router.use(auth);

  // ===== 后台作业：process 流水线执行器（复用解析→分类→保存→抓取→改文，逐步 addStep）=====
  // 供 POST /process/start 的后台 worker 使用；result 结构对齐 POST /process 的响应契约。
  async function executeProcessJob({ workflow, tasksToProcess, addStep }) {
    const username = workflow && workflow.username;
    const body = workflow && workflow.body && typeof workflow.body === 'object' ? workflow.body : {};
    const { platformId = '2', inputText, parseMode = 'smart', columnPresetId, columnOrder = '', maxTxt, aiCount } = body;
    const config = configStore.getConfig() || {};
    const wf = config.workflow || {};

    // 1. 解析批量清单
    addStep({ step: 'parse', status: 'running', detail: '开始解析批量清单' });
    const parsedResult = parse.parseBooks({
      inputText,
      parseMode,
      columnPresetId,
      columnOrder,
      styles: configStore.getStyles()
    });
    const parsedTasks = parsedResult.tasks || [];
    addStep({
      step: 'parse',
      status: 'done',
      detail: `解析完成：共 ${parsedResult.parsed} 行，有效 ${parsedResult.uniqueTasks} 个ID，重复 ${parsedResult.duplicateCount}，空ID ${parsedResult.emptyIdCount}`
    });

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
    let tasksToProcess2 = parsedTasks;
    let classifyErrors = [];

    // 3. 可选：AI 分类回填缺失的男女频/风格
    if (wf.auto_classify_missing && tasksToProcess2.length) {
      addStep({ step: 'classify', status: 'running', detail: 'AI 分类补齐男女频/风格' });
      const classifyResult = await classifier.classifyMissingRows({ configStore, tasks: tasksToProcess2 });
      classifyErrors = (classifyResult && classifyResult.errors) || [];
      tasksToProcess2 = (classifyResult && classifyResult.tasks) || tasksToProcess2;
      addStep({
        step: 'classify',
        status: classifyErrors.length ? 'warning' : 'done',
        detail: classifyErrors.length ? `分类完成，${classifyErrors.length} 条失败：${String(classifyErrors[0]).slice(0, 120)}` : '风格类型/男女频补齐流程已执行'
      });
    } else {
      addStep({ step: 'classify', status: 'skipped', detail: '配置关闭了自动补齐风格类型/男女频' });
    }

    // 4. 保存任务
    if (tasksToProcess2.length) await tasks.saveTasks(username, tasksToProcess2);

    // 5. 可选：按配置并发抓取原文（单任务失败不中断整批）
    let fetched = 0;
    let fetchFailed = 0;
    const fetchedDone = new Set();
    const concurrency = (config.fetch && config.fetch.concurrency) || 4;
    if (wf.auto_fetch_original && tasksToProcess2.length) {
      const results = await runWithConcurrency(tasksToProcess2, concurrency, async task => {
        const result = await tasks.fetchOriginal(username, task.bookId, task.maxTxt);
        return { task, status: (result && result.status) || 'failed' };
      });
      for (const item of results) {
        if (item.ok && item.value && item.value.status === 'done') {
          fetched++;
          fetchedDone.add(item.value.task.bookId);
          addStep({ step: 'fetch', status: 'done', bookId: item.value.task.bookId, detail: `${item.value.task.bookId} 原文已抓取` });
        } else {
          fetchFailed++;
          const bookId = item.value && item.value.task ? item.value.task.bookId : '';
          addStep({ step: 'fetch', status: 'failed', bookId, detail: `${bookId} 抓取失败` });
        }
      }
    } else {
      addStep({ step: 'fetch', status: 'skipped', detail: '配置关闭了自动抓取原文，本次只保存任务信息' });
    }

    // 6. 可选：对原文成功的任务逐个生成 AI 改文版本（单任务失败不中断整批）
    let generatedAiFiles = 0;
    if (wf.auto_rewrite_after_fetch && tasksToProcess2.length) {
      addStep({ step: 'rewrite', status: 'running', detail: '开始生成 AI 改文版本' });
      for (const task of tasksToProcess2) {
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
          const doneCount = (result && result.generated || []).filter(item => item && item.status === 'done').length;
          generatedAiFiles += doneCount;
        } catch (error) {
          // 单任务改文异常只计数，不中断后续任务
          fetchFailed++;
        }
      }
      addStep({ step: 'rewrite', status: 'done', detail: `AI文案生成完成：生成 ${generatedAiFiles} 个文件` });
    } else {
      addStep({ step: 'rewrite', status: 'skipped', detail: '配置关闭了抓取后自动改文，本次不自动生成AI文案' });
    }

    const list = await tasks.listTasks(username);
    return {
      parsed: parsedResult.parsed,
      emptyIdCount: parsedResult.emptyIdCount,
      uniqueTasks: parsedResult.uniqueTasks,
      duplicateCount: parsedResult.duplicateCount,
      classifyErrors,
      fetched,
      fetchFailed,
      generatedAiFiles,
      tasks: list || []
    };
  }

  // 后台作业 store：可注入（测试），否则用 systemDir 创建并注入流水线执行器
  const jobs = jobsStore || (systemDir
    ? createJobsStore({
        systemDir,
        executor: async (ctx) => executeProcessJob(ctx)
      })
    : null);
  const knowledge = knowledgeStore || (systemDir ? createKnowledgeStore({ systemDir }) : null);
  const opening = openingStore || (systemDir ? createOpeningStore({ systemDir, styles: configStore.getStyles() }) : null);
  const readKnowledge = kind => {
    if (!knowledge) throw new Error('知识库未启用（缺少 systemDir）');
    return knowledge.list(kind);
  };

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

  // POST /process/start：异步后台作业（body 同 /process），返回 { jobId }；进度经 jobs 接口轮询
  router.post('/process/start', async (req, res) => {
    try {
      const username = req.username;
      const inputText = (req.body && req.body.inputText) || '';
      if (!String(inputText).trim()) return res.status(400).json({ ok: false, error: '请输入书籍信息' });
      if (!jobs) return res.status(500).json({ ok: false, error: '后台作业未启用（缺少 systemDir）' });
      const jobId = jobs.startProcessJob({
        workflow: { username, body: req.body || {} },
        tasksToProcess: []
      });
      return res.json({ jobId, status: 'running' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '启动后台作业失败' });
    }
  });

  // GET /process/jobs/latest：最近作业列表（?limit=10，默认 10）
  router.get('/process/jobs/latest', (req, res) => {
    try {
      if (!jobs) return res.status(500).json({ ok: false, error: '后台作业未启用（缺少 systemDir）' });
      const limit = Math.floor(Number(req.query.limit) || 10);
      const jobList = jobs.listLatest(limit);
      return res.json({ jobs: jobList || [] });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '获取作业列表失败' });
    }
  });

  // GET /process/jobs/:jobId：作业详情（steps / status / result / error）
  router.get('/process/jobs/:jobId', (req, res) => {
    try {
      if (!jobs) return res.status(500).json({ ok: false, error: '后台作业未启用（缺少 systemDir）' });
      const job = jobs.getJob(String(req.params.jobId || '').trim());
      if (!job) return res.status(404).json({ ok: false, error: '处理任务不存在' });
      return res.json(job);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '获取作业详情失败' });
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

  // GET /tasks/:bookId：任务详情（meta + 清洗后原文 + 原始备份存在性 + 日志 + AI 版本 + 敏感词/提交日志）
  router.get('/tasks/:bookId', async (req, res) => {
    try {
      const username = req.username;
      const bookId = String(req.params.bookId || '').trim();
      const task = await tasks.getTask(username, bookId);
      if (!task) return res.status(404).json({ ok: false, error: '任务不存在' });
      const original = await tasks.readOriginal(username, bookId);
      const logs = await tasks.readLogs(username, bookId);
      const aiVersions = await tasks.listAiVersions(username, bookId);
      const sensitiveRecords = await tasks.readSensitiveRecords(username, bookId);
      const submitLog = await tasks.readSiteSubmitLog(username, bookId);
      const submitResult = await tasks.readSiteSubmitResult(username, bookId);
      return res.json({
        meta: task.meta || {},
        original,
        hasOriginalRaw: task.hasOriginalRaw === true,
        logs: logs || [],
        ai_versions: aiVersions || [],
        sensitive_log: {
          sensitive_hits: (sensitiveRecords && sensitiveRecords.sensitive_hits) || {},
          sensitive_fixed: (sensitiveRecords && sensitiveRecords.sensitive_fixed) || {},
          logs: (logs || []).filter(item => {
            const eventText = String((item && (item.event || item.raw)) || '').toLowerCase();
            return eventText.includes('sensitive') || eventText.includes('敏感') || eventText.includes('rules_applied') || eventText.includes('original_fetched');
          })
        },
        submit_log: submitLog || [],
        submit_result: submitResult || {}
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || '获取任务详情失败' });
    }
  });

  // POST /tasks/batch-retry：批量重试（body { ids: [] }），按「分类→抓取→AI」逐级补跑
  router.post('/tasks/batch-retry', async (req, res) => {
    try {
      const username = req.username;
      const ids = (req.body && Array.isArray(req.body.ids)) ? req.body.ids : [];

      // 逐级补跑依赖：分类用 classifier，抓取用 tasks.fetchOriginal，AI 用 rewrite.generateAiVersions
      const retryClassify = async (u, meta) => {
        if (meta.style && meta.gender) {
          if (meta.classifyStatus === 'failed' || meta.classifyStatus === 'waiting_ai_config') {
            return tasks.updateTaskMeta(u, meta.bookId, { classifyStatus: 'input_ready', classifyError: '' });
          }
          return meta;
        }
        const row = {
          bookId: meta.bookId, paidBookId: meta.paidBookId, freeBookId: meta.freeBookId,
          bookName: meta.bookName, style: meta.style, gender: meta.gender,
          tags: meta.tags, reason: meta.reason, rating: meta.rating,
          sourceLine: meta.sourceLine, parseMode: meta.parseMode, parseColumns: meta.parseColumns
        };
        const classifyResult = await classifier.classifyMissingRows({ configStore, tasks: [row] });
        const updated = (classifyResult && classifyResult.tasks && classifyResult.tasks[0]) || row;
        return tasks.updateTaskMeta(u, meta.bookId, {
          style: updated.style, styleSource: updated.styleSource,
          gender: updated.gender, genderSource: updated.genderSource,
          classifyStatus: updated.classifyStatus, classifyError: updated.classifyError,
          classifyConfidence: updated.classifyConfidence, classifyReason: updated.classifyReason,
          classifierModel: updated.classifierModel
        });
      };
      const generateAi = async (u, bookId, count) => {
        const current = await tasks.getTask(u, bookId);
        if (!current || !current.meta || current.meta.originalStatus !== 'done') return { status: 'skipped' };
        return rewrite.generateAiVersions({ configStore, tasks, username: u, task: current.meta, count });
      };

      const result = await tasks.batchRetry(username, ids, {
        retryClassify,
        fetchOriginal: (u, bookId, maxTxt) => tasks.fetchOriginal(u, bookId, maxTxt),
        generateAi
      });
      const list = await tasks.listTasks(username);
      return res.json({ ok: true, ...result, tasks: list || [] });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '批量重试失败' });
    }
  });

  // POST /tasks/:bookId/restore-original：从原始备份恢复清洗后原文
  router.post('/tasks/:bookId/restore-original', async (req, res) => {
    try {
      const username = req.username;
      const bookId = String(req.params.bookId || '').trim();
      const task = await tasks.getTask(username, bookId);
      if (!task) return res.status(404).json({ ok: false, error: '任务不存在' });
      const result = await tasks.restoreOriginal(username, bookId);
      const current = await tasks.getTask(username, bookId);
      if (!result || result.status === 'failed') {
        return res.status(400).json({ ok: false, error: (current && current.meta && current.meta.error) || '恢复失败' });
      }
      return res.json({ ok: true, task: current });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '恢复原文失败' });
    }
  });

  // GET /tasks/:bookId/sensitive-log：敏感词命中/修复记录 + 相关事件日志
  router.get('/tasks/:bookId/sensitive-log', async (req, res) => {
    try {
      const username = req.username;
      const bookId = String(req.params.bookId || '').trim();
      const task = await tasks.getTask(username, bookId);
      if (!task) return res.status(404).json({ ok: false, error: '任务不存在' });
      const logs = await tasks.readLogs(username, bookId);
      const records = await tasks.readSensitiveRecords(username, bookId);
      return res.json({
        meta: task.meta || {},
        sensitive_hits: (records && records.sensitive_hits) || {},
        sensitive_fixed: (records && records.sensitive_fixed) || {},
        logs: (logs || []).filter(item => {
          const eventText = String((item && (item.event || item.raw)) || '').toLowerCase();
          return eventText.includes('sensitive') || eventText.includes('敏感') || eventText.includes('rules_applied') || eventText.includes('original_fetched');
        })
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || '获取敏感词日志失败' });
    }
  });

  // GET /tasks/:bookId/site-submit-log：网站提交日志（site_submit jsonl 存在则读，否则空数组）
  router.get('/tasks/:bookId/site-submit-log', async (req, res) => {
    try {
      const username = req.username;
      const bookId = String(req.params.bookId || '').trim();
      const task = await tasks.getTask(username, bookId);
      if (!task) return res.status(404).json({ ok: false, error: '任务不存在' });
      const logs = await tasks.readSiteSubmitLog(username, bookId);
      const result = await tasks.readSiteSubmitResult(username, bookId);
      return res.json({
        meta: task.meta || {},
        result: result || {},
        logs: logs || []
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || '获取提交日志失败' });
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

  // POST /rules/preview：预览规则排版并返回分阶段 trace
  router.post('/rules/preview', (req, res) => {
    try {
      const { text = '', scope = 'original', layoutConfig = {}, knowledge: suppliedKnowledge } = req.body || {};
      const knowledgeData = suppliedKnowledge || {
        layout_rules: readKnowledge('layout_rules'),
        symbol_rules: readKnowledge('symbol_rules'),
        chapter_rules: readKnowledge('chapter_rules')
      };
      const trace = rules.processDocumentTrace(text, scope, layoutConfig, knowledgeData);
      const result = rules.processDocumentText(text, scope, layoutConfig, knowledgeData);
      return res.json({ ok: true, result, trace });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '规则排版预览失败' });
    }
  });

  // POST /rules/suggest：根据样本文案生成规则建议
  router.post('/rules/suggest', async (req, res) => {
    try {
      const { text = '', ruleType, goal, currentConfig } = req.body || {};
      const settings = aiModule.resolveAiSettings(configStore, 'rewrite');
      const result = await rules.suggestRulesWithAi(aiModule, text, {
        settings, ruleType, goal, currentConfig
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '生成规则建议失败' });
    }
  });

  // GET /knowledge/summary：知识库与规则库数量汇总
  router.get('/knowledge/summary', (req, res) => {
    try {
      if (!knowledge) return res.status(500).json({ ok: false, error: '知识库未启用（缺少 systemDir）' });
      return res.json({ ok: true, summary: knowledge.getSummary() });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || '读取知识库汇总失败' });
    }
  });

  // GET /knowledge/:kind：读取知识库或只读规则库
  router.get('/knowledge/:kind', (req, res) => {
    try {
      return res.json({ ok: true, kind: req.params.kind, data: readKnowledge(req.params.kind) });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '读取知识库失败' });
    }
  });

  // POST /knowledge/:kind：保存知识条目
  router.post('/knowledge/:kind', (req, res) => {
    try {
      if (!knowledge) return res.status(500).json({ ok: false, error: '知识库未启用（缺少 systemDir）' });
      return res.json(knowledge.save(req.params.kind, req.body && (req.body.item || req.body)));
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '保存知识条目失败' });
    }
  });

  // DELETE /knowledge/:kind/:id：删除知识条目
  router.delete('/knowledge/:kind/:id', (req, res) => {
    try {
      if (!knowledge) return res.status(500).json({ ok: false, error: '知识库未启用（缺少 systemDir）' });
      return res.json(knowledge.remove(req.params.kind, req.params.id));
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '删除知识条目失败' });
    }
  });

  // POST /knowledge/:kind/:id/optimize：AI 优化知识条目
  router.post('/knowledge/:kind/:id/optimize', async (req, res) => {
    try {
      if (!knowledge) return res.status(500).json({ ok: false, error: '知识库未启用（缺少 systemDir）' });
      const settings = aiModule.resolveAiSettings(configStore, 'rewrite');
      return res.json(await knowledge.optimizeItem(
        { kind: req.params.kind, id: req.params.id }, aiModule, settings
      ));
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '优化知识条目失败' });
    }
  });

  // POST /opening/analyze：AI 拆解爆款开头（结果由前端确认后保存）
  router.post('/opening/analyze', async (req, res) => {
    try {
      const settings = aiModule.resolveAiSettings(configStore, 'rewrite');
      return res.json(await opening.analyze(aiModule, settings, req.body && req.body.text));
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '开头分析失败' });
    }
  });

  // POST /opening/save：保存开头词条
  router.post('/opening/save', (req, res) => {
    try {
      if (!opening) return res.status(500).json({ ok: false, error: '知识库未启用（缺少 systemDir）' });
      return res.json(opening.save(req.body && (req.body.item || req.body)));
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '保存开头词失败' });
    }
  });

  // POST /opening/normalize：去重并规范化开头词库
  router.post('/opening/normalize', (req, res) => {
    try {
      if (!opening) return res.status(500).json({ ok: false, error: '知识库未启用（缺少 systemDir）' });
      return res.json(opening.normalize());
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || '规范化开头词失败' });
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
