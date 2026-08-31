function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function createConfigStoreSnapshot(tasks, config = {}) {
  const snapshot = object(config);
  return {
    getConfig: () => snapshot,
    getAiConfig: () => ({
      ai: object(snapshot.ai),
      ai_presets: Array.isArray(snapshot.ai_presets) ? snapshot.ai_presets : [],
      ai_assignments: object(snapshot.ai_assignments)
    }),
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

function createV78NovelFetchBatchExecutor(options = {}) {
  const accountResolver = options.accountResolver;
  if (typeof accountResolver !== 'function') throw new Error('accountResolver is required');
  const createStore = options.createStore || require('./mysql-store').createMySQLWorkshopStore;
  const runBatch = options.runBatch || require('./runner').runNovelFetchBatch;
  const parseBooks = options.parseBooks || require('./parse').parseBooks;
  const classifyMissingRows = options.classifyMissingRows || require('./classifier').classifyMissingRows;
  const applyRules = options.applyRules || createApplySavedRulesToOriginal();
  const generateAiVersions = options.generateAiVersions || require('./rewrite').generateAiVersions;
  const runCleanup = options.runCleanup || require('./cleanup').runNovelFetchCleanup;

  return async function executeBatch(owner, payload) {
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
    const configStore = createConfigStoreSnapshot(tasks, config);
    const report = typeof options.report === 'function' ? event => options.report(owner, event) : () => {};
    const result = await runBatch({
      username: owner,
      payload,
      configStore,
      tasks,
      parseBooks,
      classifyMissingRows,
      applyRules,
      generateAiVersions,
      submit: typeof options.submit === 'function' ? request => options.submit(owner, request) : undefined,
      webSessionReady: typeof options.webSessionReady === 'function' ? () => options.webSessionReady(owner) : undefined,
      syncSiteStyles: typeof options.syncSiteStyles === 'function' ? () => options.syncSiteStyles(owner) : undefined,
      listTasks: typeof tasks.listTasks === 'function' ? () => tasks.listTasks(owner) : undefined,
      report
    });

    const storage = object(config.storage);
    if (storage.cleanup_enabled !== true) return result;
    try {
      const cleanup = await runCleanup({ owner, store: tasks, policy: storage });
      report({ type: 'storage_cleanup', status: 'done', message: `旧任务自动清理完成：删除 ${cleanup.deleted || 0} 个。`, cleanup });
      return { ...result, cleanup };
    } catch (error) {
      const message = error?.message || String(error);
      report({ type: 'storage_cleanup', status: 'warning', message: `旧任务自动清理失败：${message}` });
      return { ...result, cleanup_error: message };
    }
  };
}

module.exports = { createConfigStoreSnapshot, createApplySavedRulesToOriginal, createV78NovelFetchBatchExecutor };
