// Original batch-rewrite UI compatibility layer.  The imported browser assets
// keep their original request contract while data stays in this application's
// authenticated workshop and upload stores.
const crypto = require('node:crypto');
const express = require('express');
const { apiAuth } = require('../middleware/auth');
const { createMySQLWorkshopStore } = require('../lib/novel-fetch-workshop/mysql-store');
const { getKnowledgeStore } = require('../lib/novel-fetch-workshop/knowledge');
const { createOpeningStore } = require('../lib/novel-fetch-workshop/opening');
const ai = require('../lib/novel-fetch-workshop/ai');
const classifier = require('../lib/novel-fetch-workshop/classifier');
const rewrite = require('../lib/novel-fetch-workshop/rewrite');
const parse = require('../lib/novel-fetch-workshop/parse');
const rules = require('../lib/novel-fetch-workshop/rules');
const target = require('../lib/target-upload');
const { PLATFORMS, STYLE_NAMES } = require('./novel-fetch');

const jobs = new Map();
const LEGACY_KINDS = ['high_imitation', 'opening_phrases', 'rewrite_templates', 'layout_rules', 'symbol_rules', 'chapter_rules'];

function snakeTask(task = {}) {
  const aiCount = Number(task.aiCount) || 1;
  const aiGenerated = Number(task.aiGeneratedCount) || 0;
  return {
    ...task,
    id: task.bookId || task.id || '',
    book_id: task.bookId || task.id || '',
    book_name: task.bookName || '',
    platform_id: task.platformId || '',
    platform_name: task.platformName || '',
    parse_mode: task.parseMode || '',
    original_status: task.originalStatus || '',
    original_chars: task.originalChars || 0,
    original_raw_chars: task.originalRawChars || 0,
    ai_status: task.aiStatus || '',
    ai_count: aiCount,
    ai_files: Array.from({ length: aiGenerated }, (_, index) => `ai${index + 1}`),
    classify_status: task.classifyStatus || '',
    classifier_model: task.classifierModel || '',
    sensitive_hit_count: task.sensitiveHitCount || 0,
    sensitive_fixed_count: task.sensitiveFixedCount || 0,
    sensitive_failed_count: task.sensitiveFailedCount || 0,
    site_submit_status: task.siteSubmitStatus || '',
    site_submit_done_versions: task.siteSubmitDoneVersions || [],
    site_submit_failed_versions: task.siteSubmitFailedVersions || []
  };
}

function legacyMeta(meta = {}) { return snakeTask(meta); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function idFrom(value) { return String(value || '').trim(); }
function countEntries(value) { return Array.isArray(value) ? value.length : 0; }

function summarizeKnowledge(knowledge) {
  const source = object(knowledge);
  const highImitation = object(source.high_imitation);
  const openingPhrases = object(source.opening_phrases);
  const rewriteTemplates = object(source.rewrite_templates);
  const layoutRules = object(source.layout_rules);
  const symbolRules = object(source.symbol_rules);
  const chapterRules = object(source.chapter_rules);
  const openingStyles = countEntries(openingPhrases.styles)
    || new Set((openingPhrases.items || []).map(item => String(item?.style || item?.category || '').trim()).filter(Boolean)).size;

  return {
    opening_phrases: countEntries(openingPhrases.items),
    opening_styles: openingStyles,
    rewrite_profiles: countEntries(rewriteTemplates.profiles) || countEntries(rewriteTemplates.items),
    temporary_instructions: countEntries(rewriteTemplates.temporary_instructions),
    high_imitation_prompts: countEntries(highImitation.prompts),
    high_imitation_references: countEntries(highImitation.references) || countEntries(highImitation.items),
    sensitive_rules: countEntries(layoutRules.sensitive_rules) || countEntries(layoutRules.sensitiveKeywords),
    symbol_rules: countEntries(symbolRules.symbol_rules),
    pair_fill_rules: countEntries(symbolRules.pair_fill_rules),
    chapter_exact_rules: countEntries(chapterRules.chapter_exact_rules),
    chapter_inline_rules: countEntries(chapterRules.chapter_inline_rules)
  };
}

function isFailed(task) {
  return [task.status, task.originalStatus, task.aiStatus, task.classifyStatus, task.error]
    .join(' ').toLowerCase().includes('failed');
}

function createBatchRewriteRouter({
  auth = apiAuth,
  targetBaseUrl,
  bridgeSecret,
  systemDir,
  novelFetchStore,
  tasksFactory,
  configStore,
  knowledgeStore,
  openingStore,
  httpClient = target.requestHttp
} = {}) {
  const router = express.Router();
  router.use(auth);
  const knowledge = knowledgeStore || getKnowledgeStore(systemDir);
  const opening = openingStore || createOpeningStore({ systemDir, styles: [] });

  async function resources(req) {
    if (tasksFactory) return tasksFactory(req);
    const tasks = createMySQLWorkshopStore({ targetBaseUrl, bridgeSecret, account: req.auth?.account });
    const config = await tasks.getConfig();
    return {
      tasks,
      config,
      configStore: configStore || {
        getConfig: () => config,
        getAiConfig: () => ({ ai: config.ai || {}, ai_presets: config.ai_presets || [], ai_assignments: config.ai_assignments || {} }),
        getPlatforms: () => config.platforms || PLATFORMS,
        getStyles: () => config.styles || STYLE_NAMES
      }
    };
  }

  async function readConfig(req) {
    const { tasks, config, configStore: store } = await resources(req);
    const current = object(config || store.getConfig());
    const platforms = Array.isArray(current.platforms) ? current.platforms : (store.getPlatforms?.() || PLATFORMS);
    const styles = Array.isArray(current.styles) ? current.styles : (store.getStyles?.() || STYLE_NAMES);
    const savedKnowledge = object(current.knowledge);
    const knowledgeData = Object.keys(savedKnowledge).length ? savedKnowledge : {};
    if (!Object.keys(knowledgeData).length) {
      for (const kind of LEGACY_KINDS) knowledgeData[kind] = knowledge.list(kind);
    }
    const appConfig = {
      ...current,
      workflow: {
        auto_classify_missing: current.workflow?.auto_classify_missing !== false,
        auto_fetch_original: current.workflow?.auto_fetch_original !== false,
        auto_rewrite_after_fetch: current.workflow?.auto_rewrite_after_fetch !== false,
        auto_submit_after_rewrite: current.workflow?.auto_submit_after_rewrite !== false,
        auto_sync_site_styles: current.workflow?.auto_sync_site_styles !== false,
        auto_reclassify_invalid_style: current.workflow?.auto_reclassify_invalid_style !== false,
        ...object(current.workflow)
      }
    };
    return {
      tasks,
      store,
      current: appConfig,
      response: {
        app_config: appConfig,
        platforms,
        styles,
        sensitive: current.sensitive || { groups: [] },
        web_submit: publicWebSubmit(current.web_submit),
        knowledge: knowledgeData,
        knowledge_summary: summarizeKnowledge(knowledgeData),
        parse_modes: parse.PARSE_MODES.map(id => ({ id, name: id })),
        column_presets: parse.COLUMN_PRESETS,
        work_form: current.work_form || {}
      }
    };
  }

  async function requestKnowledge(req) {
    return (await readConfig(req)).response.knowledge;
  }

  function ruleKnowledge(knowledgeData) {
    return {
      layout_rules: object(knowledgeData.layout_rules),
      symbol_rules: object(knowledgeData.symbol_rules),
      chapter_rules: object(knowledgeData.chapter_rules)
    };
  }

  async function saveConfig(req, payload) {
    const { tasks, current } = await readConfig(req);
    const body = object(payload);
    const next = {
      ...current,
      ...(object(body.app_config)),
      ...(Array.isArray(body.platforms) ? { platforms: body.platforms } : {}),
      ...(Array.isArray(body.styles) ? { styles: body.styles } : {}),
      ...(body.sensitive ? { sensitive: body.sensitive } : {}),
      ...(body.knowledge ? { knowledge: body.knowledge } : {})
    };
    await tasks.saveConfig(next);
    return readConfig(req);
  }

  async function listTasks(req) {
    const { tasks } = await resources(req);
    return (await tasks.listTasks(req.username)).map(snakeTask);
  }

  async function selectTaskIds(req, body) {
    const requested = Array.isArray(body?.ids) ? body.ids.map(idFrom).filter(Boolean) : [];
    if (body?.mode === 'selected') return requested;
    const all = await listTasks(req);
    if (body?.mode === 'failed') return all.filter(isFailed).map(task => task.id);
    return all.map(task => task.id);
  }

  async function processPayload(req, payload, report = () => {}) {
    const { tasks, configStore: store } = await resources(req);
    const inputText = String(payload?.input_text || '');
    if (!inputText.trim()) throw new Error('请输入书籍信息');
    const config = object(store.getConfig());
    const parsed = parse.parseBooks({
      inputText,
      parseMode: payload.parse_mode || 'smart',
      columnPresetId: payload.column_preset_id || '',
      columnOrder: payload.column_order || '',
      styles: store.getStyles?.() || []
    });
    const platforms = store.getPlatforms?.() || [];
    const platform = platforms.find(item => String(item.id) === String(payload.platform_id || '2')) || {};
    const workflow = object(config.workflow);
    const prepared = (parsed.tasks || []).map(item => ({
      ...item,
      platformId: String(payload.platform_id || '2'),
      platformName: platform.name || String(payload.platform_id || '2'),
      maxTxt: Number(payload.max_txt) || Number(config.fetch?.default_max_txt) || 4000,
      aiCount: Number(payload.ai_count) || Number(config.rewrite?.default_ai_count) || 1
    }));
    report({ type: 'parse', status: 'done', message: `解析完成：有效 ${prepared.length} 个任务。` });
    let classified = prepared;
    let classifyErrors = [];
    if (workflow.auto_classify_missing !== false && prepared.length) {
      const result = await classifier.classifyMissingRows({ configStore: store, tasks: prepared });
      classified = result.tasks || prepared;
      classifyErrors = result.errors || [];
    }
    await tasks.saveTasks(req.username, classified);
    report({ type: 'classify', status: classifyErrors.length ? 'warning' : 'done', message: classifyErrors.length ? classifyErrors.join('；') : '风格和男女频补齐完成。' });
    let fetched = 0;
    let fetchFailed = 0;
    const fetchedIds = [];
    if (workflow.auto_fetch_original !== false) {
      for (const task of classified) {
        const result = await tasks.fetchOriginal(req.username, task.bookId, task.maxTxt);
        if (result?.status === 'done') { fetched++; fetchedIds.push(task.bookId); report({ type: 'fetch', status: 'done', book_id: task.bookId, message: `${task.bookId} 原文已抓取。` }); }
        else { fetchFailed++; report({ type: 'fetch', status: 'failed', book_id: task.bookId, message: `${task.bookId} 原文抓取失败。` }); }
      }
    }
    let generated = 0;
    if (workflow.auto_rewrite_after_fetch) {
      for (const bookId of fetchedIds) {
        const task = await tasks.getTask(req.username, bookId);
        const result = await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: task?.meta, count: task?.meta?.aiCount || 1 });
        generated += (result.generated || []).filter(item => item.status === 'done').length;
      }
      report({ type: 'rewrite', status: 'done', message: `AI 文案生成 ${generated} 个版本。` });
    } else {
      report({ type: 'rewrite', status: 'skipped', message: '配置未开启抓取后自动改文。' });
    }
    if (workflow.auto_submit_after_rewrite && fetchedIds.length) {
      const submitted = await submitTasks(req, { mode: 'selected', ids: fetchedIds, versions: ['ai1'] });
      report({ type: 'submit', status: submitted.failed_groups ? 'warning' : 'done', message: `网站提交：成功 ${submitted.success_groups || 0} 组，失败 ${submitted.failed_groups || 0} 组。` });
    } else {
      report({ type: 'submit', status: 'skipped', message: '配置未开启改文后自动提交。' });
    }
    return {
      parsed: parsed.parsed || prepared.length,
      unique_tasks: parsed.uniqueTasks || prepared.length,
      duplicate_count: parsed.duplicateCount || 0,
      empty_id_count: parsed.emptyIdCount || 0,
      classify_errors: classifyErrors,
      raw_fetched: fetched,
      fetched,
      process_failed: 0,
      fetch_failed: fetchFailed,
      generated_ai_files: generated,
      tasks: await listTasks(req)
    };
  }

  function publicWebSubmit(value = {}) {
    const cfg = object(value);
    return { ...cfg, password: '', password_masked: Boolean(cfg.password_masked), username: cfg.username || '', enabled: cfg.enabled !== false, style_catalog: cfg.style_catalog || Object.keys(target.STYLE_ID), upload_profiles: cfg.upload_profiles || [] };
  }

  async function currentWebConfig(req) {
    const { current } = await readConfig(req);
    return object(current.web_submit);
  }

  async function saveWebConfig(req, incoming) {
    const { tasks, current } = await readConfig(req);
    const clean = { ...object(current.web_submit), ...object(incoming) };
    const password = String(clean.password || '');
    delete clean.password;
    if (password && novelFetchStore) {
      const login = await httpClient({ method: 'GET', url: target.buildLoginUrl(String(clean.username || ''), password) });
      let data = {};
      try { data = JSON.parse(login.body); } catch (_) {}
      if (data.success !== true) throw new Error(data.message || '目标站登录失败');
      const cookies = login.headers?.['set-cookie'];
      const cookie = Array.isArray(cookies) ? cookies.map(item => item.split(';')[0]).join('; ') : '';
      if (!cookie) throw new Error('目标站登录未返回会话');
      novelFetchStore.setSession(req.username, cookie);
      clean.password_masked = true;
    }
    await tasks.saveConfig({ ...current, web_submit: clean });
    return publicWebSubmit(clean);
  }

  async function planSubmission(req, body) {
    const ids = await selectTaskIds(req, body);
    const versions = Array.isArray(body?.versions) && body.versions.length ? body.versions : ['ai1'];
    const { tasks } = await resources(req);
    const groups = [];
    const skipped = [];
    for (const id of ids) {
      const task = await tasks.getTask(req.username, id);
      if (!task?.meta) { skipped.push({ id, status: 'failed', error: '任务不存在' }); continue; }
      for (const version of versions) {
        const content = await tasks.readVersionText(req.username, id, version);
        if (!content) { skipped.push({ id, version, status: 'skipped', error: '未找到正文版本' }); continue; }
        groups.push({ group_id: `${task.meta.platformId}-${task.meta.gender}-${task.meta.style}-${version}`, status: 'ready', version, summary: snakeTask(task.meta), items: [{ id, version, size: Buffer.byteLength(content) }] });
      }
    }
    return { groups, skipped };
  }

  async function submitTasks(req, body) {
    if (!novelFetchStore) throw new Error('目标站会话存储未启用');
    const session = novelFetchStore.getSession(req.username);
    if (!session?.cookie) throw new Error('请先在网站提交页保存账号密码并登录目标站');
    const plan = await planSubmission(req, body);
    const { tasks } = await resources(req);
    let successGroups = 0;
    let failedGroups = 0;
    for (const group of plan.groups) {
      const item = group.items[0];
      const task = await tasks.getTask(req.username, item.id);
      const content = await tasks.readVersionText(req.username, item.id, item.version);
      try {
        const fields = target.buildUploadFields({ platformId: task.meta.platformId, gender: task.meta.gender === '男频' ? '男' : task.meta.gender === '女频' ? '女' : task.meta.gender, style: task.meta.style, advanced: {} });
        const upload = target.buildMultipart(fields, { filename: `${item.id}-${item.version}.txt`, content });
        const response = await httpClient({ method: 'POST', url: `http://${target.TARGET_HOST}${target.TARGET_UPLOAD_PATH}`, headers: { 'Content-Type': `multipart/form-data; boundary=${upload.boundary}`, Cookie: session.cookie }, body: upload.body });
        let data = {};
        try { data = JSON.parse(response.body); } catch (_) {}
        if (data.success !== true) throw new Error(data.message || data.msg || '上传失败');
        group.status = 'submitted';
        successGroups++;
        await tasks.updateTaskMeta(req.username, item.id, { siteSubmitStatus: 'submitted', siteSubmitDoneVersions: [...new Set([...(task.meta.siteSubmitDoneVersions || []), item.version])] });
        if (typeof tasks.appendSiteSubmitLog === 'function') await tasks.appendSiteSubmitLog(req.username, item.id, { status: 'submitted', version: item.version, time: new Date().toISOString() });
      } catch (error) {
        group.status = 'failed';
        group.error = error.message || '上传失败';
        failedGroups++;
        await tasks.updateTaskMeta(req.username, item.id, { siteSubmitStatus: 'failed', siteSubmitFailedVersions: [...new Set([...(task.meta.siteSubmitFailedVersions || []), item.version])] });
        if (typeof tasks.appendSiteSubmitLog === 'function') await tasks.appendSiteSubmitLog(req.username, item.id, { status: 'failed', version: item.version, error: group.error, time: new Date().toISOString() });
      }
    }
    return { ...plan, success_groups: successGroups, failed_groups: failedGroups, tasks: await listTasks(req) };
  }

  router.get('/config', async (req, res) => { try { res.json((await readConfig(req)).response); } catch (error) { res.status(500).json({ error: error.message }); } });
  router.post('/config', async (req, res) => { try { res.json({ ok: true, config: (await saveConfig(req, req.body)).response }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/work-form', async (req, res) => { try { const state = object(req.body?.state); const { tasks, current } = await readConfig(req); await tasks.saveConfig({ ...current, work_form: state }); res.json({ ok: true, state }); } catch (error) { res.status(400).json({ error: error.message }); } });

  router.post('/process/start', async (req, res) => {
    const id = crypto.randomUUID();
    const job = { id, status: 'running', steps: [], result: null, error: '' };
    jobs.set(`${req.username}:${id}`, job);
    res.json(job);
    setImmediate(async () => {
      try { job.result = await processPayload(req, req.body, step => job.steps.push(step)); job.status = 'done'; }
      catch (error) { job.status = 'failed'; job.error = error.message || '处理失败'; }
    });
  });
  router.post('/process', async (req, res) => { try { res.json(await processPayload(req, req.body)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/process/jobs/latest', (req, res) => { const job = [...jobs.entries()].filter(([key]) => key.startsWith(`${req.username}:`)).at(-1)?.[1] || {}; res.json({ latest: job, jobs: job.id ? [job] : [] }); });
  router.get('/process/jobs/:id', (req, res) => { const job = jobs.get(`${req.username}:${req.params.id}`); if (!job) return res.status(404).json({ error: '处理任务不存在' }); return res.json(job); });

  router.get('/tasks', async (req, res) => { try { res.json({ tasks: await listTasks(req) }); } catch (error) { res.status(500).json({ error: error.message }); } });
  router.post('/tasks/batch-delete', async (req, res) => { try { const ids = await selectTaskIds(req, req.body); const { tasks } = await resources(req); const result = await tasks.deleteTasks(req.username, ids); res.json({ ...result, failed: 0, tasks: await listTasks(req) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/tasks/batch-retry', async (req, res) => { try { const ids = await selectTaskIds(req, req.body); const { tasks, configStore: store } = await resources(req); let retried = 0; let failed = 0; for (const id of ids) { const task = await tasks.getTask(req.username, id); if (!task) { failed++; continue; } const result = await tasks.fetchOriginal(req.username, id, task.meta.maxTxt || 4000); if (result?.status !== 'done') { failed++; continue; } if (store.getConfig().workflow?.auto_rewrite_after_fetch) await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: (await tasks.getTask(req.username, id)).meta, count: task.meta.aiCount || 1 }); retried++; } res.json({ retried, failed, tasks: await listTasks(req) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/tasks/apply-rules', async (req, res) => { try { const ids = await selectTaskIds(req, req.body); const { tasks } = await resources(req); const accountKnowledge = ruleKnowledge(await requestKnowledge(req)); let applied = 0; for (const id of ids) { const text = await tasks.readOriginal(req.username, id); if (!text) continue; const processed = rules.processDocumentText(text, 'original', {}, accountKnowledge); if (typeof tasks.saveOriginalText === 'function') await tasks.saveOriginalText(req.username, id, processed); applied++; } res.json({ applied, failed: 0, tasks: await listTasks(req) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/tasks/:id', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) return res.status(404).json({ error: '任务不存在' }); const count = Number(task.meta.aiGeneratedCount) || 0; const aiTexts = []; for (let index = 1; index <= count; index++) aiTexts.push({ name: `AI${index}`, text: await tasks.readVersionText(req.username, req.params.id, `ai${index}`) }); res.json({ meta: legacyMeta(task.meta), original: await tasks.readOriginal(req.username, req.params.id), ai_texts: aiTexts, has_original_raw: task.hasOriginalRaw === true, logs: await tasks.readLogs(req.username, req.params.id) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/tasks/:id/fetch', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task) throw new Error('任务不存在'); const result = await tasks.fetchOriginal(req.username, req.params.id, task.meta.maxTxt || 4000); if (result.status !== 'done') throw new Error('原文抓取失败'); res.json({ ok: true }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/tasks/:id/restore-original', async (req, res) => { try { const { tasks } = await resources(req); res.json({ task: await tasks.restoreOriginal(req.username, req.params.id) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/tasks/:id/generate-ai', async (req, res) => { try { const { tasks, configStore: store } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) throw new Error('任务不存在'); const result = await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: task.meta, count: Number(req.body?.count) || 1 }); res.json({ task: result }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/tasks/:id/sensitive-log', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); res.json({ meta: legacyMeta(task?.meta || {}), sensitive_hits: { hits: [] }, sensitive_fixed: { items: [] }, logs: task ? await tasks.readLogs(req.username, req.params.id) : [] }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/tasks/:id/rules-trace', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); const text = task ? await tasks.readOriginal(req.username, req.params.id) : ''; res.json({ meta: legacyMeta(task?.meta || {}), stages: rules.processDocumentTrace(text, 'original', {}, ruleKnowledge(await requestKnowledge(req))) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/tasks/:id/site-submit-log', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); const logs = typeof tasks.readSiteSubmitLog === 'function' ? await tasks.readSiteSubmitLog(req.username, req.params.id) : []; res.json({ meta: legacyMeta(task?.meta || {}), result: logs.at(-1) || {}, logs }); } catch (error) { res.status(400).json({ error: error.message }); } });

  router.get('/knowledge', async (req, res) => { try { res.json({ summary: summarizeKnowledge(await requestKnowledge(req)) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/knowledge/optimize', async (req, res) => { try { const kind = req.body?.library_type; const item = object(req.body?.item); const saved = knowledge.save(kind, item); const { configStore: store } = await resources(req); const settings = ai.resolveAiSettings(store, 'rewrite'); res.json(await knowledge.optimizeItem({ kind, id: saved.item.id }, ai, settings)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/opening/analyze', async (req, res) => { try { const { configStore: store } = await resources(req); const settings = ai.resolveAiSettings(store, 'rewrite'); res.json(await opening.analyze(ai, settings, req.body?.source_text)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/opening/save', (req, res) => { try { res.json(opening.save(req.body?.item)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/opening/normalize', (req, res) => { try { res.json(opening.normalize()); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/ai/test', async (req, res) => { try { const { configStore: store } = await resources(req); const settings = req.body?.settings || ai.resolveAiSettings(store, req.body?.purpose || 'classifier'); const result = await ai.chatCompletion(settings, [{ role: 'user', content: '请只回复：ok' }], { temperature: 0 }); res.json({ ok: true, content: result.text || '' }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/rules/preview', async (req, res) => { try { const text = String(req.body?.text || ''); res.json({ processed: rules.processDocumentText(text, req.body?.scope || 'original', {}, ruleKnowledge(await requestKnowledge(req))) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/rules/ai-suggest', async (req, res) => {
    try {
      const { configStore: store } = await resources(req);
      const settings = ai.resolveAiSettings(store, 'rewrite');
      const ruleType = String(req.body?.rule_type || 'sensitive');
      const response = await ai.chatCompletion(settings, [
        { role: 'system', content: '你是批量小说改文系统规则助手。只输出可直接保存的 JSON 规则对象，不要解释。' },
        { role: 'user', content: JSON.stringify({ rule_type: ruleType, sample_text: req.body?.sample_text || '', goal: req.body?.goal || '生成可直接使用的规则建议。' }) }
      ], { temperature: 0.2 });
      res.json({ ok: true, suggestions: ai.parseAiJsonContent(response.text || '') });
    } catch (error) { res.status(400).json({ error: error.message || '规则建议生成失败' }); }
  });

  router.get('/web-submit/config', async (req, res) => res.json({ settings: publicWebSubmit(await currentWebConfig(req)) }));
  router.post('/web-submit/config', async (req, res) => { try { res.json({ ok: true, settings: await saveWebConfig(req, req.body?.settings), tasks: await listTasks(req) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/web-submit/environment', (req, res) => { const session = novelFetchStore?.getSession(req.username); res.json({ ok: Boolean(session), checks: [{ name: '目标站登录会话', ok: Boolean(session), detail: session ? '已登录' : '未登录' }, { name: '上传接口', ok: true, detail: target.TARGET_UPLOAD_PATH }] }); });
  router.post('/web-submit/sync-configs', async (req, res) => res.json({ ok: true, settings: publicWebSubmit(await currentWebConfig(req)), groups: [] }));
  router.post('/web-submit/sync-styles', async (req, res) => res.json({ ok: true, settings: publicWebSubmit(await currentWebConfig(req)), styles: Object.keys(target.STYLE_ID), style_sync: { new_count: Object.keys(target.STYLE_ID).length, added: [], removed: [] } }));
  router.post('/web-submit/test-visible', async (req, res) => {
    try {
      const session = novelFetchStore?.getSession(req.username);
      if (!session?.cookie) throw new Error('请先保存账号密码并登录目标站');
      const check = await httpClient({ method: 'GET', url: `http://${target.TARGET_HOST}${target.TARGET_CHECK_PATH}`, headers: { Cookie: session.cookie } });
      const ok = target.isDashboard(check.body);
      res.json({ ok, output: [], result: { checks: { login_session: ok, upload_endpoint: target.TARGET_UPLOAD_PATH } } });
    } catch (error) { res.status(400).json({ ok: false, error: error.message || '验证失败' }); }
  });
  router.post('/web-submit/preview', async (req, res) => { try { res.json(await planSubmission(req, req.body)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/web-submit/submit', async (req, res) => { try { res.json(await submitTasks(req, req.body)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/logs', async (req, res) => { try { const { tasks } = await resources(req); const records = await listTasks(req); const logs = []; for (const task of records.slice(0, 100)) for (const item of await tasks.readLogs(req.username, task.id)) logs.push({ ...item, book_id: task.id }); res.json({ logs: logs.slice(-500).reverse() }); } catch (error) { res.status(400).json({ error: error.message }); } });

  return router;
}

module.exports = { createBatchRewriteRouter, snakeTask };
