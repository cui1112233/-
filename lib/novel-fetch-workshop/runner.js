const {
  normalizeWorkflowPolicy,
  shortOriginalDecision,
  shouldReclassifyStyle,
  effectiveRewriteConcurrency,
  splitSubmitBatches
} = require('./workflow-policy');

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

async function readSavedOriginal(tasks, username, bookId) {
  if (typeof tasks.readOriginal === 'function') return String(await tasks.readOriginal(username, bookId) || '');
  if (typeof tasks.getTask === 'function') {
    const record = await tasks.getTask(username, bookId);
    return String(record?.document?.original || '');
  }
  return '';
}

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
  webSessionReady,
  syncSiteStyles,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  report = () => {}
} = {}) {
  if (!username) throw new Error('username is required');
  if (!tasks || typeof tasks.saveTasks !== 'function') throw new Error('tasks store is required');
  if (!configStore || typeof configStore.getConfig !== 'function') throw new Error('configStore is required');
  if (typeof parseBooks !== 'function') throw new Error('parseBooks is required');

  const inputText = String(payload?.input_text || '');
  if (!inputText.trim()) throw new Error('请输入书籍信息');

  const config = object(await Promise.resolve(configStore.getConfig()));
  const policy = normalizeWorkflowPolicy(config);
  const workflow = object(config.workflow);

  if (policy.workflow.auto_sync_site_styles) {
    try {
      const ready = typeof webSessionReady === 'function' ? await webSessionReady() : false;
      if (ready && typeof syncSiteStyles === 'function') {
        await syncSiteStyles();
        report({ type: 'style_sync', status: 'done', message: '121 风格目录已在本批处理开始前同步。' });
      } else {
        report({ type: 'style_sync', status: 'warning', message: '未检测到可用 121 登录会话，已跳过自动风格同步。' });
      }
    } catch (error) {
      report({ type: 'style_sync', status: 'warning', message: `121 风格同步失败：${error?.message || String(error)}` });
    }
  }

  const styles = typeof configStore.getStyles === 'function' ? (await Promise.resolve(configStore.getStyles()) || []) : [];
  const parsed = parseBooks({
    inputText,
    parseMode: payload?.parse_mode || 'smart',
    columnPresetId: payload?.column_preset_id || '',
    columnOrder: payload?.column_order || '',
    styles
  });
  const platforms = typeof configStore.getPlatforms === 'function' ? (await Promise.resolve(configStore.getPlatforms()) || []) : [];
  const platformId = String(payload?.platform_id || '2');
  const platform = platforms.find(item => String(item?.id) === platformId) || {};
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
  const classifyErrors = [];
  if (workflow.auto_classify_missing !== false && prepared.length && typeof classifyMissingRows === 'function') {
    const result = await classifyMissingRows({ configStore, tasks: prepared });
    classified = result?.tasks || prepared;
    classifyErrors.push(...(result?.errors || []));
  }
  if (policy.workflow.auto_reclassify_invalid_style && classified.length && typeof classifyMissingRows === 'function') {
    const indexes = [];
    const candidates = [];
    classified.forEach((task, index) => {
      if (String(task?.style || '').trim() && shouldReclassifyStyle(task.style, styles, true)) {
        indexes.push(index);
        candidates.push({ ...task, style: '', styleSource: '', classifyStatus: '', classifyError: '' });
      }
    });
    if (candidates.length) {
      const result = await classifyMissingRows({ configStore, tasks: candidates });
      const repaired = result?.tasks || candidates;
      indexes.forEach((targetIndex, position) => { classified[targetIndex] = repaired[position] || classified[targetIndex]; });
      classifyErrors.push(...(result?.errors || []));
    }
  }
  await tasks.saveTasks(username, classified);
  report({ type: 'classify', status: classifyErrors.length ? 'warning' : 'done', message: classifyErrors.length ? classifyErrors.join('；') : '风格和男女频补齐完成。' });

  let rawFetched = 0;
  let fetched = 0;
  let fetchFailed = 0;
  let skippedShortOriginal = 0;
  const fetchedIds = [];
  if (workflow.auto_fetch_original !== false) {
    const fetchedResults = await runWithConcurrency(classified, config.fetch?.concurrency || 1, async task => {
      const result = await tasks.fetchOriginal(username, task.bookId, task.maxTxt);
      if (result?.status !== 'done') return { task, done: false };
      const original = (policy.fetch.skip_short_original && policy.fetch.min_original_chars > 0)
        ? await readSavedOriginal(tasks, username, task.bookId) : '';
      const short = shortOriginalDecision(original, policy.fetch);
      if (short.skipped) {
        if (typeof tasks.updateTaskMeta === 'function') {
          await tasks.updateTaskMeta(username, task.bookId, { status: 'skipped_short_original', shortOriginalChars: short.chars, minOriginalChars: policy.fetch.min_original_chars });
        }
        return { task, done: true, skippedShort: true, chars: short.chars };
      }
      if (typeof applyRules === 'function') await applyRules(tasks, username, task.bookId, config, configStore);
      return { task, done: true, skippedShort: false };
    });
    for (const [index, item] of fetchedResults.entries()) {
      const task = item?.value?.task || classified[index];
      if (item?.ok && item.value?.done) {
        rawFetched += 1;
        if (item.value.skippedShort) {
          skippedShortOriginal += 1;
          report({ type: 'fetch', status: 'warning', book_id: task.bookId, message: `${task.bookId} 原文仅 ${item.value.chars} 字，低于阈值 ${policy.fetch.min_original_chars}，已保留 raw 原文并跳过后续改文。` });
          continue;
        }
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
    const rewriteConcurrency = effectiveRewriteConcurrency({ ...object(config.ai), force_serial_batch: policy.ai.force_serial_batch });
    const rewriteResults = await runWithConcurrency(fetchedIds, rewriteConcurrency, async bookId => {
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
    if (policy.web_submit.flush_seconds > 0) await sleep(policy.web_submit.flush_seconds * 1000);
    let successGroups = 0;
    let failedGroups = 0;
    for (const ids of splitSubmitBatches(fetchedIds, policy.web_submit.batch_size)) {
      const submitted = await submit({ mode: 'selected', ids, versions: ['ai1'] });
      successGroups += Number(submitted?.success_groups) || 0;
      failedGroups += Number(submitted?.failed_groups) || 0;
    }
    report({ type: 'submit', status: failedGroups ? 'warning' : 'done', message: `网站提交：成功 ${successGroups} 组，失败 ${failedGroups} 组。` });
  } else {
    report({ type: 'submit', status: 'skipped', message: '未开启自动网站提交；文案已保留，需在网站提交页确认后再提交。' });
  }

  return {
    parsed: parsed?.parsed || prepared.length,
    unique_tasks: parsed?.uniqueTasks || prepared.length,
    duplicate_count: parsed?.duplicateCount || 0,
    empty_id_count: parsed?.emptyIdCount || 0,
    classify_errors: classifyErrors,
    raw_fetched: rawFetched,
    fetched,
    skipped_short_original: skippedShortOriginal,
    process_failed: 0,
    rewrite_failed: rewriteFailed,
    fetch_failed: fetchFailed,
    generated_ai_files: generated,
    tasks: typeof listTasks === 'function' ? await listTasks() : []
  };
}

module.exports = { runWithConcurrency, runNovelFetchBatch };
