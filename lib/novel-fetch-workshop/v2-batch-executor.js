function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
const { normalizeTargetVersions } = require('./target-versions');
const { createTargetAwareAiGenerator } = require('./target-rewrite');
const { normalizeProductionRetentionDays } = require('../production-retention');

// 队列中的模型选择是提交时的执行快照。不能在真正开始执行时重新用
// 当前全局配置覆盖它，否则排队期间切换模型会让任务调用错误的上游模型。
function withQueuedTextModelSnapshot(config, payload) {
  const selectedModelId = String(payload?.text_model_id || payload?.textModelId || '').trim();
  if (!selectedModelId) return config;
  const source = object(config);
  return {
    ...source,
    text_model_id: selectedModelId,
    ...(Object.keys(object(source.app_config)).length
      ? { app_config: { ...object(source.app_config), text_model_id: selectedModelId } }
      : {})
  };
}

function createConfigStoreSnapshot(tasks, config = {}, { resolveRuntimeModel } = {}) {
  const snapshot = object(config);
  const appConfig = object(snapshot.app_config);
  const selectedModelId = String(
    snapshot.text_model_id || snapshot.textModelId ||
    appConfig.text_model_id || appConfig.textModelId || ''
  );
  return {
    getConfig: () => snapshot,
    getAiConfig: () => ({
      ai: object(snapshot.ai),
      ai_presets: Array.isArray(snapshot.ai_presets) ? snapshot.ai_presets : [],
      ai_assignments: object(snapshot.ai_assignments),
      text_model_id: selectedModelId
    }),
    ...(typeof resolveRuntimeModel === 'function' ? { resolveRuntimeModel } : {}),
    getPlatforms: () => Array.isArray(snapshot.platforms) ? snapshot.platforms : (typeof tasks?.getPlatforms === 'function' ? tasks.getPlatforms() : []),
    getStyles: () => Array.isArray(snapshot.styles) ? snapshot.styles : (typeof tasks?.getStyles === 'function' ? tasks.getStyles() : [])
  };
}

function createApplySavedRulesToOriginal({ rulesModule, sensitiveModule, aiModule } = {}) {
  const rules = rulesModule || require('./rules');
  const sensitive = sensitiveModule || require('./sensitive-v2');
  const ai = aiModule || require('./ai');
  const processSensitive = sensitive.processSensitiveTextV2 || sensitive.processSensitiveText;
  if (typeof processSensitive !== 'function') throw new Error('sensitive processor is required');

  return async function applySavedRulesToOriginal(tasks, username, bookId, config, configStore) {
    if (typeof tasks?.readOriginal !== 'function' || typeof tasks?.saveOriginalText !== 'function') return false;
    const text = await tasks.readOriginal(username, bookId);
    if (!text) return false;
    const layoutRules = object(object(config?.knowledge).layout_rules);
    const runSensitive = config?.layout?.apply_sensitive !== false && layoutRules.apply_sensitive_replace !== false;
    const ruleConfig = runSensitive
      ? { ...config, layout: { ...object(config?.layout), sensitive_ai_enabled: true } }
      : config;
    let processed = rules.processConfiguredDocumentText(text, 'original', ruleConfig);
    let entry = null;
    if (runSensitive) {
      const task = typeof tasks.getTask === 'function' ? await tasks.getTask(username, bookId) : null;
      const sensitiveConfig = object(config?.sensitive_ai);
      const configuredMode = String(sensitiveConfig.mode || '').trim();
      const mode = ['replace', 'ai_each', 'ai_group'].includes(configuredMode)
        ? configuredMode
        : (sensitiveConfig.enabled === false ? 'replace' : 'ai_each');
      const aiEnabled = mode !== 'replace';
      const aiSettings = aiEnabled ? ai.resolveAiSettings(configStore, 'sensitive_fix') : {};
      const result = await processSensitive({
        text: processed,
        settings: {
          ...sensitiveConfig,
          mode,
          enabled: aiEnabled,
          config,
          scope: 'original',
          bookId,
          bookName: task?.meta?.bookName || '',
          style: task?.meta?.style || '',
          gender: task?.meta?.gender || '',
          aiSettings
        },
        ai
      });
      processed = result.text;
      const fixedItems = Array.isArray(result?.fixedItems) ? result.fixedItems : [];
      const failedCount = fixedItems.filter(item => item?.status === 'failed').length;
      entry = {
        mode: result?.mode || mode,
        status: failedCount ? 'partial' : (result?.hits?.length ? 'done' : 'skipped'),
        hit_count: Array.isArray(result?.hits) ? result.hits.length : 0,
        fixed_count: Number(result?.fixedCount) || 0,
        failed_count: failedCount,
        fallback_count: fixedItems.filter(item => item?.fallback_from_ai === true).length,
        model: aiEnabled ? (aiSettings.model || '') : '',
        updated_at: new Date().toISOString(),
        hits: Array.isArray(result?.hits) ? result.hits : [],
        items: fixedItems
      };
      if (typeof tasks.updateTaskMeta === 'function') await tasks.updateTaskMeta(username, bookId, {
        sensitiveMode: entry.mode,
        sensitiveStatus: entry.status,
        sensitiveHitCount: entry.hit_count,
        sensitiveFixedCount: entry.fixed_count,
        sensitiveFailedCount: entry.failed_count,
        sensitiveFallbackCount: entry.fallback_count,
        sensitiveModel: entry.model
      });
      if (typeof tasks.appendLog === 'function') await tasks.appendLog(username, bookId, 'sensitive_processed', entry);
    }
    if (processed === text) return Boolean(entry);
    await tasks.saveOriginalText(username, bookId, processed);
    return true;
  };
}

function explicitTargetVersions(payload = {}) {
  if (Array.isArray(payload.targetVersions)) return normalizeTargetVersions(payload.targetVersions);
  if (Array.isArray(payload.target_versions)) return normalizeTargetVersions(payload.target_versions);
  return null;
}

function createBatchParseBooks(parseBooks, payload, config) {
  const targets = explicitTargetVersions(payload);
  const slotMethods = object(payload.aiSlotMethodsSnapshot || payload.ai_slot_methods_snapshot || object(config.rewrite).ai_slot_methods);
  return function parseBooksForBatch(args) {
    const result = parseBooks(args);
    if (!targets) return result;
    return {
      ...result,
      tasks: (Array.isArray(result?.tasks) ? result.tasks : []).map(task => ({
        ...task,
        targetVersions: targets.slice(),
        aiSlotMethodsSnapshot: { ...slotMethods }
      }))
    };
  };
}

function createV78NovelFetchBatchExecutor(options = {}) {
  const accountResolver = options.accountResolver;
  if (typeof accountResolver !== 'function') throw new Error('accountResolver is required');
  const createStore = options.createStore || require('./mysql-store').createMySQLWorkshopStore;
  const runBatch = options.runBatch || require('./runner').runNovelFetchBatch;
  const parseBooks = options.parseBooks || require('./parse').parseBooks;
  const classifyMissingRows = options.classifyMissingRows || require('./classifier').classifyMissingRows;
  const applyRules = options.applyRules || createApplySavedRulesToOriginal();
  const generateAiVersions = options.generateAiVersions || createTargetAwareAiGenerator();
  const runCleanup = options.runCleanup || require('./cleanup').runNovelFetchCleanup;

  return async function executeBatch(owner, payload, executionContext = {}) {
    const account = await Promise.resolve(accountResolver(owner));
    if (!account?.username || account.username !== owner) {
      const error = new Error(`账号 ${owner} 不存在或不可用`);
      error.recoverable = false;
      throw error;
    }
    const tasks = createStore({
      targetBaseUrl: options.targetBaseUrl,
      bridgeSecret: options.bridgeSecret,
      account
    });
    const config = object(await tasks.getConfig());
    const executionConfig = withQueuedTextModelSnapshot(config, payload);
    const configStore = createConfigStoreSnapshot(tasks, executionConfig, {
      resolveRuntimeModel: typeof options.resolveRuntimeModel === 'function'
        ? modelId => options.resolveRuntimeModel(owner, 'text', modelId)
        : undefined
    });
    const report = event => {
      if (typeof executionContext.report === 'function') executionContext.report(event);
      if (typeof options.report === 'function') options.report(owner, event);
    };
    const batchParseBooks = createBatchParseBooks(parseBooks, payload || {}, config);
    const shouldStop = typeof executionContext.isStopRequested === 'function'
      ? executionContext.isStopRequested
      : () => false;
    const result = await runBatch({
      username: owner,
      payload,
      configStore,
      tasks,
      parseBooks: batchParseBooks,
      classifyMissingRows,
      applyRules,
      generateAiVersions,
      submit: typeof options.submit === 'function' ? request => options.submit(owner, request) : undefined,
      webSessionReady: typeof options.webSessionReady === 'function' ? () => options.webSessionReady(owner) : undefined,
      syncSiteStyles: typeof options.syncSiteStyles === 'function' ? () => options.syncSiteStyles(owner) : undefined,
      listTasks: typeof tasks.listTasks === 'function' ? () => tasks.listTasks(owner) : undefined,
      shouldStop,
      throughput: executionContext.throughput || options.throughput,
      report
    });

    const storage = object(config.storage);
    const globalConfig = typeof options.retentionConfigReader === 'function'
      ? (options.retentionConfigReader(owner) || {})
      : null;
    const retentionDays = normalizeProductionRetentionDays(globalConfig?.productionRetentionDays, storage.retention_days);
    const cleanupPolicy = { cleanup_enabled: true, retention_days: retentionDays };
    try {
      const cleanup = await runCleanup({ owner, store: tasks, policy: cleanupPolicy });
      report({ type: 'storage_cleanup', status: 'done', message: `旧任务自动清理完成：删除 ${cleanup.deleted || 0} 个。`, cleanup });
      return { ...result, cleanup };
    } catch (error) {
      const message = error?.message || String(error);
      report({ type: 'storage_cleanup', status: 'warning', message: `旧任务自动清理失败：${message}` });
      return { ...result, cleanup_error: message };
    }
  };
}

module.exports = {
  createConfigStoreSnapshot,
  withQueuedTextModelSnapshot,
  createApplySavedRulesToOriginal,
  explicitTargetVersions,
  createBatchParseBooks,
  createV78NovelFetchBatchExecutor
};
