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

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const count = Math.max(1, Math.floor(Number(limit) || 1));
  const runners = Array.from({ length: Math.min(count, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = { ok: true, value: await worker(items[index]) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  });
  await Promise.all(runners);
  return results;
}

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
    site_submit_accepted_versions: task.siteSubmitAcceptedVersions || [],
    site_submit_failed_versions: task.siteSubmitFailedVersions || []
  };
}

function legacyMeta(meta = {}) { return snakeTask(meta); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function idFrom(value) { return String(value || '').trim(); }
function countEntries(value) { return Array.isArray(value) ? value.length : 0; }

function normalizeUploadProfiles(value) {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    const source = object(item);
    const name = String(source.name || `配置档 ${index + 1}`).trim();
    return {
      id: String(source.id || `profile_${index + 1}`).trim(), name, enabled: source.enabled !== false,
      platform_id: String(source.platform_id || source.platformId || '').trim(),
      gender: String(source.gender || '').replace('频', '').trim(), style: String(source.style || '').trim(),
      is_default: source.is_default === true,
      // 配置档只保存用户明确填写的覆盖项；不能在这里补默认值，
      // 否则“仅改速度”的配置档会意外覆盖全局的字体、关键词等设置。
      advanced: { ...object(source.advanced || source.config_data) }
    };
  }).filter(item => item.id && item.name);
}

function normalizeProfileBindings(value) {
  const source = object(value);
  return Object.fromEntries(['original', 'ai1', 'ai2', 'ai3'].map(version => [version, String(source[version] || '').trim()]));
}

function selectUploadProfile(cfg, meta, version) {
  const profiles = normalizeUploadProfiles(cfg.upload_profiles).filter(item => item.enabled);
  if (!profiles.length) return null;
  const bindings = normalizeProfileBindings(cfg.profile_bindings);
  const bound = profiles.find(item => item.id === bindings[version]);
  if (bound) return bound;
  const gender = String(meta.gender || '').replace('频', '').trim();
  const platformId = String(meta.platformId || '').trim();
  const style = String(meta.style || '').trim();
  const scored = profiles.map(profile => ({ profile, score:
    (profile.platform_id && profile.platform_id === platformId ? 4 : profile.platform_id ? -100 : 0) +
    (profile.gender && profile.gender === gender ? 2 : profile.gender ? -100 : 0) +
    (profile.style && profile.style === style ? 1 : profile.style ? -100 : 0)
  })).filter(item => item.score >= 0).sort((left, right) => right.score - left.score);
  return scored[0]?.profile || profiles.find(item => item.is_default) || profiles[0];
}

function readTargetField(data, names) {
  const sources = [object(data), object(data?.data), object(data?.result)];
  for (const source of sources) {
    for (const name of names) {
      const value = source[name];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
  }
  return '';
}

function summarizeTargetReceipt(data) {
  const remoteId = readTargetField(data, ['task_id', 'taskId', 'job_id', 'jobId', 'queue_id', 'queueId', 'execution_id', 'executionId']);
  const remoteStatus = readTargetField(data, ['task_status', 'taskStatus', 'job_status', 'jobStatus', 'queue_status', 'queueStatus', 'status']).toLowerCase();
  const uploadResult = object(data?.result);
  const successResult = object(uploadResult.success);
  const failedResult = object(uploadResult.failed);
  const successFiles = Array.isArray(successResult.files) ? successResult.files : [];
  const failedFiles = Array.isArray(failedResult.files) ? failedResult.files : [];
  const successCount = Math.max(0, Number(successResult.count) || successFiles.length);
  const failedCount = Math.max(0, Number(failedResult.count) || failedFiles.length);
  const failedReasons = failedFiles.map(item => String(object(item).reason || object(item).message || '')).filter(Boolean);
  const uploadError = failedCount > 0
    ? `121 上传失败：${failedReasons.join('；') || `有 ${failedCount} 个文件被拒绝`}`
    : (Object.keys(uploadResult).length > 0 && successCount < 1 ? '121 未确认接收到上传文件' : '');
  const verified = !uploadError && (successCount > 0 || Boolean(remoteId) || ['queued', 'queueing', 'running', 'executing', 'created'].includes(remoteStatus));
  let raw = '';
  try { raw = JSON.stringify(data); } catch (_) { raw = String(data || ''); }
  return {
    remote_id: remoteId,
    remote_status: remoteStatus,
    verified,
    upload_success_count: successCount,
    upload_failed_count: failedCount,
    upload_error: uploadError,
    response: raw.slice(0, 4000),
    message: readTargetField(data, ['message', 'msg'])
  };
}

function appendSubmitTrace(trace, step, status, detail, extra = {}) {
  trace.push({ step, status, detail, time: new Date().toISOString(), ...extra });
}

function parseTargetJson(value) {
  if (!value || typeof value !== 'string') return {};
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function summarizeRemoteBookRecord(data, bookId, fields, advanced) {
  const rows = Array.isArray(data?.data) ? data.data : [];
  const record = rows.find(item => String(object(item).bookid || '') === String(bookId)) || null;
  if (!record) return { status: '待确认', found: false, detail: '121 上传接口已确认文件，但列表暂未返回该书号记录' };
  const row = object(record);
  const jianData = parseTargetJson(row.jian_data);
  const actual = {
    platform_id: String(row.book_platform ?? ''), gender: String(row.gender ?? ''), style: String(row.style ?? ''),
    jieya_num: Number(jianData?.jieya?.jieya_num ?? -1), gunping_num: Number(jianData?.gunping?.gunping_num ?? -1)
  };
  const expected = {
    platform_id: String(fields.platform_id), gender: String(fields.gender), style: String(fields.style),
    jieya_num: Number(advanced.jieyaNum), gunping_num: Number(advanced.gunpingNum)
  };
  const mismatches = Object.keys(expected).filter(key => expected[key] !== actual[key]);
  return {
    status: mismatches.length ? '待确认' : '完成', found: true,
    detail: mismatches.length ? `121 已找到记录，但参数待核对：${mismatches.join('、')}` : '121 后台已找到对应书号，平台、风格与素材数量一致',
    remote_id: String(row.id || ''), remote_time: String(row.addtime || ''), expected, actual, mismatches
  };
}

async function verifyTargetBookRecord(httpClient, sessionCookie, bookId, fields, advanced) {
  const response = await httpClient({ method: 'GET', url: target.buildTargetBookListUrl(bookId), headers: { Cookie: sessionCookie } });
  if (target.isLoginPage(response.body)) throw new Error('121 登录会话已失效，无法核验后台记录');
  let data = {};
  try { data = JSON.parse(response.body); } catch (_) { throw new Error('121 列表核验返回了非 JSON 内容'); }
  if (data.success !== true) throw new Error(data.message || data.msg || '121 列表核验失败');
  return summarizeRemoteBookRecord(data, bookId, fields, advanced);
}

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
    const savedConfig = await tasks.getConfig();
    const savedKnowledge = object(savedConfig.knowledge);
    const fallbackKnowledge = {};
    if (!Object.keys(savedKnowledge).length) {
      for (const kind of LEGACY_KINDS) fallbackKnowledge[kind] = knowledge.list(kind);
    }
    const config = Object.keys(savedKnowledge).length ? savedConfig : { ...savedConfig, knowledge: fallbackKnowledge };
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
        auto_submit_after_rewrite: current.workflow?.auto_submit_after_rewrite === true,
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

  function processSavedRules(text, scope, config) {
    return rules.processConfiguredDocumentText(text, scope, config);
  }

  async function applySavedRulesToVersion(tasks, username, bookId, version, config) {
    // 规则入口与真实存储分开，以便兼容只负责抓取的测试/桥接实现。
    const isOriginal = version === 'original';
    const read = isOriginal ? tasks.readOriginal : tasks.readVersionText;
    const save = isOriginal ? tasks.saveOriginalText : tasks.saveVersionText;
    if (typeof read !== 'function' || typeof save !== 'function') return false;
    const text = isOriginal ? await read.call(tasks, username, bookId) : await read.call(tasks, username, bookId, version);
    if (!text) return false;
    const processed = processSavedRules(text, isOriginal ? 'original' : 'ai', config);
    if (processed === text) return false;
    if (isOriginal) await save.call(tasks, username, bookId, processed);
    else await save.call(tasks, username, bookId, version, processed);
    return true;
  }

  function applySavedRulesToOriginal(tasks, username, bookId, config) {
    return applySavedRulesToVersion(tasks, username, bookId, 'original', config);
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

  async function listSiteSubmitHistory(req) {
    const { tasks } = await resources(req);
    const records = await listTasks(req);
    const entries = [];
    for (const record of records) {
      if (typeof tasks.readSiteSubmitLog !== 'function') continue;
      const logs = await tasks.readSiteSubmitLog(req.username, record.id);
      for (const item of logs) entries.push({
        book_id: record.id,
        book_name: record.book_name || '',
        platform_name: record.platform_name || '',
        version: item?.version || '',
        status: item?.status || '',
        group_id: item?.group_id || '',
        material_allocation: item?.material_allocation || null,
        error: item?.error || '',
        time: item?.time || item?.updated_at || ''
      });
    }
    return entries.sort((left, right) => String(right.time).localeCompare(String(left.time))).slice(0, 200);
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
    const maxAiCount = Math.max(1, Math.min(Number(config.rewrite?.max_ai_count) || 5, 20));
    const defaultAiCount = Math.max(1, Math.min(Number(config.rewrite?.default_ai_count) || 1, maxAiCount));
    const prepared = (parsed.tasks || []).map(item => ({
      ...item,
      platformId: String(payload.platform_id || '2'),
      platformName: platform.name || String(payload.platform_id || '2'),
      maxTxt: Number(payload.max_txt) || Number(config.fetch?.default_max_txt) || 4000,
      aiCount: Math.max(1, Math.min(Number(payload.ai_count) || defaultAiCount, maxAiCount))
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
      const fetchedResults = await runWithConcurrency(classified, config.fetch?.concurrency || 1, async task => {
        const result = await tasks.fetchOriginal(req.username, task.bookId, task.maxTxt);
        if (result?.status !== 'done') return { task, done: false };
        await applySavedRulesToOriginal(tasks, req.username, task.bookId, config);
        return { task, done: true };
      });
      for (const [index, item] of fetchedResults.entries()) {
        const task = item?.value?.task || classified[index];
        if (item?.ok && item.value?.done) {
          fetched++;
          fetchedIds.push(task.bookId);
          report({ type: 'fetch', status: 'done', book_id: task.bookId, message: `${task.bookId} 原文已抓取并套用处理规则。` });
        } else {
          fetchFailed++;
          report({ type: 'fetch', status: 'failed', book_id: task?.bookId || '', message: `${task?.bookId || '任务'} 原文抓取失败。` });
        }
      }
    }
    let generated = 0;
    if (workflow.auto_rewrite_after_fetch) {
      const rewriteResults = await runWithConcurrency(fetchedIds, config.ai?.max_concurrency || 1, async bookId => {
        const task = await tasks.getTask(req.username, bookId);
        return rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: task?.meta, count: task?.meta?.aiCount || 1 });
      });
      for (const item of rewriteResults) generated += (item?.value?.generated || []).filter(entry => entry.status === 'done').length;
      report({ type: 'rewrite', status: 'done', message: `AI 文案生成 ${generated} 个版本。` });
    } else {
      report({ type: 'rewrite', status: 'skipped', message: '配置未开启抓取后自动改文。' });
    }
    if (workflow.auto_submit_after_rewrite === true && workflow.auto_submit_confirmed === true && config.web_submit?.enabled === true && fetchedIds.length) {
      const submitted = await submitTasks(req, { mode: 'selected', ids: fetchedIds, versions: ['ai1'] });
      report({ type: 'submit', status: submitted.failed_groups ? 'warning' : 'done', message: `网站提交：成功 ${submitted.success_groups || 0} 组，失败 ${submitted.failed_groups || 0} 组。` });
    } else {
      report({ type: 'submit', status: 'skipped', message: '未开启自动网站提交；文案已保留，需在网站提交页确认后再提交。' });
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
    return {
      enabled: cfg.enabled === true,
      username: cfg.username || '',
      password: '',
      password_masked: Boolean(cfg.password_masked),
      submit_versions: Array.isArray(cfg.submit_versions) && cfg.submit_versions.length ? cfg.submit_versions : ['ai1'],
      skip_submitted: cfg.skip_submitted !== false,
      min_text_chars: Math.max(0, Math.min(Number(cfg.min_text_chars) || 0, 100000)),
      retry_times: Math.max(0, Math.min(Number(cfg.retry_times) || 1, 5)),
      advanced: target.normalizeBookAdvanced(cfg.advanced),
      upload_profiles: normalizeUploadProfiles(cfg.upload_profiles),
      profile_bindings: normalizeProfileBindings(cfg.profile_bindings),
      target: target.TARGET_HOST
    };
  }

  async function currentWebConfig(req) {
    const { current } = await readConfig(req);
    const cfg = object(current.web_submit);
    return {
      ...cfg,
      min_text_chars: Math.max(0, Math.min(Number(cfg.min_text_chars) || 0, 100000)),
      retry_times: Math.max(0, Math.min(Number(cfg.retry_times) || 1, 5)),
      advanced: target.normalizeBookAdvanced(cfg.advanced),
      upload_profiles: normalizeUploadProfiles(cfg.upload_profiles),
      profile_bindings: normalizeProfileBindings(cfg.profile_bindings)
    };
  }

  async function saveWebConfig(req, incoming) {
    const { tasks, current } = await readConfig(req);
    const existing = object(current.web_submit);
    const received = object(incoming);
    const clean = {
      enabled: received.enabled === true,
      username: String(received.username || existing.username || '').trim(),
      password_masked: Boolean(existing.password_masked),
      submit_versions: Array.isArray(received.submit_versions) && received.submit_versions.length ? received.submit_versions : ['ai1'],
      skip_submitted: received.skip_submitted !== false,
      min_text_chars: Math.max(0, Math.min(Number(received.min_text_chars) || 0, 100000)),
      retry_times: Math.max(0, Math.min(Number(received.retry_times) || 1, 5)),
      advanced: target.normalizeBookAdvanced(received.advanced),
      upload_profiles: normalizeUploadProfiles(received.upload_profiles),
      profile_bindings: normalizeProfileBindings(received.profile_bindings)
    };
    if (typeof received.password === 'string') clean.password = received.password;
    const password = String(clean.password || '');
    delete clean.password;
    if (password && novelFetchStore) {
      // 目标站登录页先建立 PHP 会话，再向当前的 JSON 登录接口提交凭据。
      const loginPage = await httpClient({ method: 'GET', url: target.buildLoginPageUrl() });
      const initialCookie = target.cookieHeaderFromSetCookie(loginPage.headers);
      const login = await httpClient(target.buildLoginRequest(String(clean.username || ''), password, initialCookie));
      let data = {};
      try { data = JSON.parse(login.body); } catch (_) {}
      if (data.success !== true) throw new Error(data.message || '目标站登录失败');
      const cookie = target.mergeCookieHeaders(initialCookie, target.cookieHeaderFromSetCookie(login.headers));
      if (!cookie) throw new Error('目标站登录未返回会话');
      novelFetchStore.setSession(req.username, cookie);
      clean.password_masked = true;
    }
    await tasks.saveConfig({ ...current, web_submit: clean });
    return publicWebSubmit(clean);
  }

  async function planSubmission(req, body) {
    const ids = await selectTaskIds(req, body);
    const webConfig = await currentWebConfig(req);
    const versions = Array.isArray(body?.versions) && body.versions.length
      ? body.versions
      : (Array.isArray(webConfig.submit_versions) && webConfig.submit_versions.length ? webConfig.submit_versions : ['ai1']);
    const { tasks } = await resources(req);
    const groupsById = new Map();
    const skipped = [];
    const candidatesByBook = new Map();
    for (const id of ids) {
      const task = await tasks.getTask(req.username, id);
      if (!task?.meta) { skipped.push({ id, status: 'failed', error: '任务不存在' }); continue; }
      for (const version of versions) {
        const content = await tasks.readVersionText(req.username, id, version);
        if (!content) { skipped.push({ id, version, status: 'skipped', error: '未找到正文版本' }); continue; }
        const size = Buffer.byteLength(content);
        if (webConfig.min_text_chars > 0 && String(content).length < webConfig.min_text_chars) { skipped.push({ id, version, status: 'file_too_small', error: `文案少于 ${webConfig.min_text_chars} 字`, size }); continue; }
        const submitted = task.meta.siteSubmitDoneVersions || [];
        const acceptedPending = task.meta.siteSubmitAcceptedVersions || [];
        if (webConfig.skip_submitted !== false && submitted.includes(version)) {
          skipped.push({ id, version, status: 'skipped', error: '该版本已确认提交；如需重复提交请开启“允许二次提交已成功版本”' });
          continue;
        }
        if (webConfig.skip_submitted !== false && acceptedPending.includes(version)) {
          skipped.push({ id, version, status: 'awaiting_confirmation', error: '121 已接收文件，但尚未确认生成任务；如需重新上传请开启“允许二次提交已成功版本”' });
          continue;
        }
        const candidates = candidatesByBook.get(id) || [];
        candidates.push({ id, version, size, task, profile: selectUploadProfile(webConfig, task.meta, version) });
        candidatesByBook.set(id, candidates);
      }
    }
    for (const candidates of candidatesByBook.values()) {
      // 同一本书的素材额度只使用一次；按本书本次选中的文案版本均分给每次上传。
      const allocations = target.distributeBookMaterials(webConfig.advanced, candidates.length);
      candidates.forEach((candidate, index) => {
        const { id, version, size, task, profile } = candidate;
        const profileAdvanced = target.normalizeAdvanced({ ...webConfig.advanced, ...(profile?.advanced || {}), jieyaNum: allocations[index].jieyaNum, gunpingNum: allocations[index].gunpingNum });
        const profileId = profile?.id || 'default';
        const groupId = `${task.meta.platformId}-${task.meta.gender}-${task.meta.style}-${version}-${profileId}`;
        const group = groupsById.get(groupId) || { group_id: groupId, status: 'ready', version, summary: { ...snakeTask(task.meta), profile_id: profileId, profile_name: profile?.name || '默认上传参数' }, advanced: target.normalizeBookAdvanced(webConfig.advanced), items: [] };
        group.items.push({ id, version, size, advanced: profileAdvanced, profile_id: profileId, profile_name: profile?.name || '默认上传参数' });
        groupsById.set(groupId, group);
      });
    }
    return { material_limit: target.PER_BOOK_MATERIAL_LIMIT, groups: [...groupsById.values()], skipped };
  }

  async function submitTasks(req, body) {
    if (!novelFetchStore) throw new Error('目标站会话存储未启用');
    const webConfig = await currentWebConfig(req);
    if (webConfig.enabled !== true) throw new Error('网站提交尚未启用；请先保存账号并勾选“启用网站提交”');
    const session = novelFetchStore.getSession(req.username);
    if (!session?.cookie) throw new Error('请先在网站提交页保存账号密码并登录目标站');
    const plan = await planSubmission(req, body);
    const { tasks } = await resources(req);
    let successGroups = 0;
    let acceptedGroups = 0;
    let failedGroups = 0;
    for (const group of plan.groups) {
      let groupFailed = false;
      let groupAwaitingConfirmation = false;
      for (const item of group.items) {
        const task = await tasks.getTask(req.username, item.id);
        const content = await tasks.readVersionText(req.username, item.id, item.version);
        const trace = [];
        try {
          const fields = target.buildUploadFields({ platformId: task.meta.platformId, gender: task.meta.gender === '男频' ? '男' : task.meta.gender === '女频' ? '女' : task.meta.gender, style: task.meta.style, advanced: item.advanced || webConfig.advanced });
          appendSubmitTrace(trace, '本地参数校验', '完成', `121 参数：平台 ${fields.platform_id} / 性别 ${fields.gender} / 风格 ${fields.style} / 解压 ${fields.jieya_num} / 滚屏 ${fields.gunping_num}`, { fields: { platform_id: fields.platform_id, gender: fields.gender, style: fields.style, jieya_num: fields.jieya_num, gunping_num: fields.gunping_num } });
          const filename = target.buildTargetUploadFilename(item.id);
          const upload = target.buildMultipart(fields, { filename, content });
          appendSubmitTrace(trace, '准备上传文件', '完成', `已生成 ${filename}，${Buffer.byteLength(content)} 字节`, { file: filename, bytes: Buffer.byteLength(content), version: item.version });
          let data = {};
          let attempts = 0;
          let lastError = null;
          for (let attempt = 0; attempt <= webConfig.retry_times; attempt += 1) {
            try {
              attempts += 1;
              appendSubmitTrace(trace, '调用 121 上传接口', '提交中', `第 ${attempts} 次请求 ${target.TARGET_UPLOAD_PATH}`, { attempt: attempts });
              const response = await httpClient({ method: 'POST', url: `http://${target.TARGET_HOST}${target.TARGET_UPLOAD_PATH}`, headers: { 'Content-Type': `multipart/form-data; boundary=${upload.boundary}`, Cookie: session.cookie }, body: upload.body });
              try { data = JSON.parse(response.body); } catch (_) { data = {}; }
              if (data.success === true) { lastError = null; break; }
              lastError = new Error(data.message || data.msg || '上传失败');
              appendSubmitTrace(trace, '121 上传接口响应', '失败', lastError.message, { attempt: attempts });
            } catch (error) { lastError = error; }
          }
          if (lastError) throw lastError;
          const receipt = summarizeTargetReceipt(data);
          if (receipt.upload_error) {
            appendSubmitTrace(trace, '121 文件处理结果', '失败', receipt.upload_error, { upload_success_count: receipt.upload_success_count, upload_failed_count: receipt.upload_failed_count });
            throw new Error(receipt.upload_error);
          }
          appendSubmitTrace(trace, '121 文件处理结果', receipt.verified ? '完成' : '待确认', receipt.verified ? `121 已确认接收 ${receipt.upload_success_count} 个文件` : '121 未返回逐文件结果，等待人工核验', { upload_success_count: receipt.upload_success_count, upload_failed_count: receipt.upload_failed_count });
          try {
            receipt.remote_record = await verifyTargetBookRecord(httpClient, session.cookie, item.id, fields, item.advanced || webConfig.advanced);
            appendSubmitTrace(trace, '121 后台记录核验', receipt.remote_record.status, receipt.remote_record.detail, receipt.remote_record);
          } catch (error) {
            receipt.remote_record = { status: '待确认', found: false, detail: error.message || '121 后台记录核验失败' };
            appendSubmitTrace(trace, '121 后台记录核验', '待确认', receipt.remote_record.detail);
          }
          if (receipt.verified) {
            await tasks.updateTaskMeta(req.username, item.id, {
              siteSubmitStatus: 'submitted',
              siteSubmitDoneVersions: [...new Set([...(task.meta.siteSubmitDoneVersions || []), item.version])],
              siteSubmitAcceptedVersions: (task.meta.siteSubmitAcceptedVersions || []).filter(version => version !== item.version)
            });
            if (typeof tasks.appendSiteSubmitLog === 'function') await tasks.appendSiteSubmitLog(req.username, item.id, { status: 'submitted', version: item.version, group_id: group.group_id, material_allocation: item.advanced, retries: Math.max(0, attempts - 1), remote_receipt: receipt, execution_trace: trace, time: new Date().toISOString() });
          } else {
            groupAwaitingConfirmation = true;
            item.status = 'accepted_pending';
            item.remote_receipt = receipt;
            await tasks.updateTaskMeta(req.username, item.id, {
              siteSubmitStatus: 'accepted_pending',
              siteSubmitAcceptedVersions: [...new Set([...(task.meta.siteSubmitAcceptedVersions || []), item.version])]
            });
            if (typeof tasks.appendSiteSubmitLog === 'function') await tasks.appendSiteSubmitLog(req.username, item.id, { status: 'accepted_pending', version: item.version, group_id: group.group_id, material_allocation: item.advanced, retries: Math.max(0, attempts - 1), remote_receipt: receipt, execution_trace: trace, time: new Date().toISOString() });
          }
        } catch (error) {
          groupFailed = true;
          item.error = error.message || '上传失败';
          appendSubmitTrace(trace, '提交结束', '失败', item.error);
          await tasks.updateTaskMeta(req.username, item.id, { siteSubmitStatus: 'failed', siteSubmitFailedVersions: [...new Set([...(task.meta.siteSubmitFailedVersions || []), item.version])] });
          if (typeof tasks.appendSiteSubmitLog === 'function') await tasks.appendSiteSubmitLog(req.username, item.id, { status: 'failed', version: item.version, group_id: group.group_id, material_allocation: item.advanced, error: item.error, execution_trace: trace, time: new Date().toISOString() });
        }
      }
      group.status = groupFailed ? 'failed' : groupAwaitingConfirmation ? 'accepted_pending' : 'submitted';
      if (groupFailed) failedGroups++;
      else if (groupAwaitingConfirmation) acceptedGroups++;
      else successGroups++;
    }
    return { ...plan, success_groups: successGroups, accepted_groups: acceptedGroups, failed_groups: failedGroups, tasks: await listTasks(req) };
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
  router.post('/tasks/batch-retry', async (req, res) => { try { const ids = await selectTaskIds(req, req.body); const { tasks, configStore: store } = await resources(req); const config = object(store.getConfig()); let retried = 0; let failed = 0; for (const id of ids) { const task = await tasks.getTask(req.username, id); if (!task) { failed++; continue; } const result = await tasks.fetchOriginal(req.username, id, task.meta.maxTxt || 4000); if (result?.status !== 'done') { failed++; continue; } await applySavedRulesToOriginal(tasks, req.username, id, config); if (config.workflow?.auto_rewrite_after_fetch) await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: (await tasks.getTask(req.username, id)).meta, count: task.meta.aiCount || 1 }); retried++; } res.json({ retried, failed, tasks: await listTasks(req) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/tasks/apply-rules', async (req, res) => { try {
    const ids = await selectTaskIds(req, req.body);
    const { tasks, configStore: store } = await resources(req);
    const config = object(store.getConfig());
    const scope = ['original', 'ai', 'both'].includes(req.body?.scope) ? req.body.scope : 'both';
    let applied = 0;
    for (const id of ids) {
      if (scope === 'original' || scope === 'both') if (await applySavedRulesToVersion(tasks, req.username, id, 'original', config)) applied++;
      if (scope === 'ai' || scope === 'both') {
        const task = await tasks.getTask(req.username, id);
        const count = Number(task?.meta?.aiGeneratedCount) || 0;
        for (let index = 1; index <= count; index++) if (await applySavedRulesToVersion(tasks, req.username, id, `ai${index}`, config)) applied++;
      }
    }
    res.json({ applied, failed: 0, tasks: await listTasks(req) });
  } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/tasks/:id', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) return res.status(404).json({ error: '任务不存在' }); const count = Number(task.meta.aiGeneratedCount) || 0; const aiTexts = []; for (let index = 1; index <= count; index++) aiTexts.push({ name: `AI${index}`, text: await tasks.readVersionText(req.username, req.params.id, `ai${index}`) }); res.json({ meta: legacyMeta(task.meta), original: await tasks.readOriginal(req.username, req.params.id), ai_texts: aiTexts, has_original_raw: task.hasOriginalRaw === true, logs: await tasks.readLogs(req.username, req.params.id) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/tasks/:id/fetch', async (req, res) => { try { const { tasks, configStore: store } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task) throw new Error('任务不存在'); const result = await tasks.fetchOriginal(req.username, req.params.id, task.meta.maxTxt || 4000); if (result.status !== 'done') throw new Error('原文抓取失败'); await applySavedRulesToOriginal(tasks, req.username, req.params.id, object(store.getConfig())); res.json({ ok: true }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/tasks/:id/restore-original', async (req, res) => { try {
    const { tasks, configStore: store } = await resources(req);
    if (typeof tasks.restoreOriginal !== 'function') throw new Error('当前存储不支持恢复原文');
    await tasks.restoreOriginal(req.username, req.params.id);
    await applySavedRulesToOriginal(tasks, req.username, req.params.id, object(store.getConfig()));
    res.json({ task: await tasks.getTask(req.username, req.params.id) });
  } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/tasks/:id/generate-ai', async (req, res) => { try { const { tasks, configStore: store } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); if (!task?.meta) throw new Error('任务不存在'); const config = object(store.getConfig()); const max = Math.max(1, Math.min(Number(config.rewrite?.max_ai_count) || 5, 20)); const count = Math.max(1, Math.min(Number(req.body?.count) || 1, max)); const result = await rewrite.generateAiVersions({ configStore: store, tasks, username: req.username, task: task.meta, count }); res.json({ task: result }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/tasks/:id/sensitive-log', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); res.json({ meta: legacyMeta(task?.meta || {}), sensitive_hits: { hits: [] }, sensitive_fixed: { items: [] }, logs: task ? await tasks.readLogs(req.username, req.params.id) : [] }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/tasks/:id/rules-trace', async (req, res) => { try { const { tasks, configStore: store } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); const text = task ? await tasks.readOriginal(req.username, req.params.id) : ''; res.json({ meta: legacyMeta(task?.meta || {}), stages: rules.processConfiguredDocumentTrace(text, 'original', object(store.getConfig())) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.get('/tasks/:id/site-submit-log', async (req, res) => { try { const { tasks } = await resources(req); const task = await tasks.getTask(req.username, req.params.id); const logs = typeof tasks.readSiteSubmitLog === 'function' ? await tasks.readSiteSubmitLog(req.username, req.params.id) : []; res.json({ meta: legacyMeta(task?.meta || {}), result: logs.at(-1) || {}, logs }); } catch (error) { res.status(400).json({ error: error.message }); } });

  router.get('/knowledge', async (req, res) => { try { res.json({ summary: summarizeKnowledge(await requestKnowledge(req)) }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/knowledge/optimize', async (req, res) => { try { const kind = req.body?.library_type; const item = object(req.body?.item); const saved = knowledge.save(kind, item); const { configStore: store } = await resources(req); const settings = ai.resolveAiSettings(store, 'rewrite'); res.json(await knowledge.optimizeItem({ kind, id: saved.item.id }, ai, settings)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/opening/analyze', async (req, res) => { try { const { configStore: store } = await resources(req); const settings = ai.resolveAiSettings(store, 'rewrite'); res.json(await opening.analyze(ai, settings, req.body?.source_text)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/opening/save', (req, res) => { try { res.json(opening.save(req.body?.item)); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/opening/normalize', (req, res) => { try { res.json(opening.normalize()); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/ai/test', async (req, res) => { try { const { configStore: store } = await resources(req); const settings = req.body?.settings || ai.resolveAiSettings(store, req.body?.purpose || 'classifier'); const result = await ai.chatCompletion(settings, [{ role: 'user', content: '请只回复：ok' }], { temperature: 0 }); res.json({ ok: true, content: result.text || '' }); } catch (error) { res.status(400).json({ error: error.message }); } });
  router.post('/rules/preview', async (req, res) => { try { const { configStore: store } = await resources(req); const text = String(req.body?.text || ''); res.json({ processed: processSavedRules(text, req.body?.scope || 'original', object(store.getConfig())) }); } catch (error) { res.status(400).json({ error: error.message }); } });
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
  router.get('/web-submit/history', async (req, res) => { try { res.json({ records: await listSiteSubmitHistory(req) }); } catch (error) { res.status(400).json({ error: error.message }); } });
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
