async function runWithConcurrency(items, limit, worker) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return [];
  const results = new Array(source.length);
  let cursor = 0;
  const count = Math.max(1, Math.floor(Number(limit) || 1));
  const runners = Array.from({ length: Math.min(count, source.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= source.length) return;
      try { results[index] = { ok: true, value: await worker(source[index], index) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  });
  await Promise.all(runners);
  return results;
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

async function runNovelFetchBatch({
  username,
  payload,
  configStore,
  tasks,
  parseBooks,
  classifyMissingRows,
  applyRules,
  generateAiVersions,
  submit,
  listTasks,
  report = () => {}
} = {}) {
  if (!username) throw new Error('username is required');
  if (!tasks || typeof tasks.saveTasks !== 'function') throw new Error('tasks store is required');
  if (!configStore || typeof configStore.getConfig !== 'function') throw new Error('configStore is required');
  if (typeof parseBooks !== 'function') throw new Error('parseBooks is required');

  const inputText = String(payload?.input_text || '');
  if (!inputText.trim()) throw new Error('请输入书籍信息');

  const config = object(await Promise.resolve(configStore.getConfig()));
  const parsed = parseBooks({
    inputText,
    parseMode: payload?.parse_mode || 'smart',
    columnPresetId: payload?.column_preset_id || '',
    columnOrder: payload?.column_order || '',
    styles: typeof configStore.getStyles === 'function' ? (await Promise.resolve(configStore.getStyles()) || []) : []
  });
  const platforms = typeof configStore.getPlatforms === 'function' ? (await Promise.resolve(configStore.getPlatforms()) || []) : [];
  const platformId = String(payload?.platform_id || '2');
  const platform = platforms.find(item => String(item?.id) === platformId) || {};
  const workflow = object(config.workflow);
  const maxAiCount = Math.max(1, Math.min(Number(config.rewrite?.max_ai_count) || 5, 20));
  const defaultAiCount = Math.max(1, Math.min(Number(config.rewrite?.default_ai_count) || 1, maxAiCount));
  const prepared = (parsed?.tasks || []).map(item => ({
    ...item,
    platformId,
    platformName: platform.name || platformId,
    maxTxt: Number(payload?.max_txt) || Number(config.fetch?.default_max_txt) || 4000,
    aiCount: Math.max(1, Math.min(Number(payload?.ai_count) || defaultAiCount, maxAiCount))
  }));

  report({ type: 'parse', status: 'done', message: `解析完成：有效 ${prepared.length} 个任务。` });

  let classified = prepared;
  let classifyErrors = [];
  if (workflow.auto_classify_missing !== false && prepared.length && typeof classifyMissingRows === 'function') {
    const result = await classifyMissingRows({ configStore, tasks: prepared });
    classified = result?.tasks || prepared;
    classifyErrors = result?.errors || [];
  }
  await tasks.saveTasks(username, classified);
  report({ type: 'classify', status: classifyErrors.length ? 'warning' : 'done', message: classifyErrors.length ? classifyErrors.join('；') : '风格和男女频补齐完成。' });

  let fetched = 0;
  let fetchFailed = 0;
  const fetchedIds = [];
  if (workflow.auto_fetch_original !== false) {
    const fetchedResults = await runWithConcurrency(classified, config.fetch?.concurrency || 1, async task => {
      const result = await tasks.fetchOriginal(username, task.bookId, task.maxTxt);
      if (result?.status !== 'done') return { task, done: false };
      if (typeof applyRules === 'function') await applyRules(tasks, username, task.bookId, config, configStore);
      return { task, done: true };
    });
    for (const [index, item] of fetchedResults.entries()) {
      const task = item?.value?.task || classified[index];
      if (item?.ok && item.value?.done) {
        fetched += 1;
        fetchedIds.push(task.bookId);
        report({ type: 'fetch', status: 'done', book_id: task.bookId, message: `${task.bookId} 原文已抓取并套用处理规则。` });
      } else {
        fetchFailed += 1;
        report({ type: 'fetch', status: 'failed', book_id: task?.bookId || '', message: `${task?.bookId || '任务'} 原文抓取失败。` });
      }
    }
  } else {
    report({ type: 'fetch', status: 'skipped', message: '配置未开启自动抓取原文。' });
  }

  let generated = 0;
  let rewriteFailed = 0;
  if (workflow.auto_rewrite_after_fetch) {
    const rewriteResults = await runWithConcurrency(fetchedIds, config.ai?.max_concurrency || 1, async bookId => {
      if (typeof generateAiVersions !== 'function') throw new Error('generateAiVersions is required');
      const task = await tasks.getTask(username, bookId);
      return generateAiVersions({ configStore, tasks, username, task: task?.meta, count: task?.meta?.aiCount || 1 });
    });
    for (const [index, item] of rewriteResults.entries()) {
      if (!item?.ok) {
        rewriteFailed += 1;
        report({ type: 'rewrite', status: 'failed', book_id: fetchedIds[index], message: `${fetchedIds[index]} AI 文案生成失败：${item.error?.message || '未知错误'}` });
        continue;
      }
      generated += (item.value?.generated || []).filter(entry => entry.status === 'done').length;
    }
    report({ type: 'rewrite', status: rewriteFailed ? 'warning' : 'done', message: `AI 文案生成 ${generated} 个版本${rewriteFailed ? `，失败 ${rewriteFailed} 本` : ''}。` });
  } else {
    report({ type: 'rewrite', status: 'skipped', message: '配置未开启抓取后自动改文。' });
  }

  if (workflow.auto_submit_after_rewrite === true && workflow.auto_submit_confirmed === true && config.web_submit?.enabled === true && fetchedIds.length && typeof submit === 'function') {
    const submitted = await submit({ mode: 'selected', ids: fetchedIds, versions: ['ai1'] });
    report({ type: 'submit', status: submitted?.failed_groups ? 'warning' : 'done', message: `网站提交：成功 ${submitted?.success_groups || 0} 组，失败 ${submitted?.failed_groups || 0} 组。` });
  } else {
    report({ type: 'submit', status: 'skipped', message: '未开启自动网站提交；文案已保留，需在网站提交页确认后再提交。' });
  }

  return {
    parsed: parsed?.parsed || prepared.length,
    unique_tasks: parsed?.uniqueTasks || prepared.length,
    duplicate_count: parsed?.duplicateCount || 0,
    empty_id_count: parsed?.emptyIdCount || 0,
    classify_errors: classifyErrors,
    raw_fetched: fetched,
    fetched,
    process_failed: 0,
    rewrite_failed: rewriteFailed,
    fetch_failed: fetchFailed,
    generated_ai_files: generated,
    tasks: typeof listTasks === 'function' ? await listTasks() : []
  };
}

module.exports = { runWithConcurrency, runNovelFetchBatch };
