const { normalizeTargetVersions, hasExplicitTargetVersions } = require('./target-versions');
const { normalizeAiSlotMethods } = require('./version-selection');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function taskBookId(task) { return String(task?.bookId || task?.book_id || task?.id || ''); }
function taskTimestamp(task) { return String(task?.updatedAt || task?.updated_at || task?.createdAt || task?.created_at || ''); }
function dateKey(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : ''; }
function taskStatusText(task) {
  return [task?.status, task?.originalStatus, task?.original_status, task?.aiStatus, task?.ai_status, task?.classifyStatus, task?.classify_status, task?.error]
    .filter(Boolean).join(' ').toLowerCase();
}
function isCancelledTask(task) { return /(cancelled|canceled|已取消)/i.test(taskStatusText(task)); }
function isTaskUnfinished(task) {
  const text = taskStatusText(task);
  if (!text) return true;
  if (isCancelledTask(task)) return false;
  if (/(failed|error|running|queued|waiting|created|paused|stopping|interrupted|incomplete|失败|错误|处理中|等待|中断|未完成|121异常)/i.test(text)) return true;
  if (/(done|completed|submitted|success|完成|成功)/i.test(text)) return false;
  return true;
}
function isAbnormalTask(task) {
  if (isCancelledTask(task)) return false;
  return /(failed|error|timeout|interrupted|incomplete|失败|错误|超时|中断|未完成|121异常)/i.test(taskStatusText(task));
}
function filterTaskList(tasks, query = {}, now = new Date()) {
  const source = Array.isArray(tasks) ? tasks : [];
  const wantedDate = String(query.date || '').trim();
  const wantedBook = String(query.bookId || query.book_id || '').trim().toLowerCase();
  const wantedStatus = String(query.status || '').trim().toLowerCase();
  const explicit = Boolean(wantedDate || wantedBook || wantedStatus);
  const today = dateKey(now);
  return source.filter(task => {
    const day = dateKey(taskTimestamp(task));
    const id = taskBookId(task).toLowerCase();
    const status = taskStatusText(task);
    if (wantedDate && day !== wantedDate) return false;
    if (wantedBook && !id.includes(wantedBook)) return false;
    if (wantedStatus && !status.includes(wantedStatus)) return false;
    if (explicit) return true;
    return day === today || (day && day < today && isTaskUnfinished(task));
  });
}

function explicitAiTargets(task) {
  if (!hasExplicitTargetVersions(task)) return null;
  return normalizeTargetVersions(task.targetVersions).filter(version => /^ai[1-5]$/.test(version));
}

function toV78Task(task = {}) {
  const explicitTargets = hasExplicitTargetVersions(task) ? normalizeTargetVersions(task.targetVersions) : null;
  const targetAi = explicitAiTargets(task);
  const legacyAiCount = Number(task.aiCount || task.ai_count) || 1;
  const selectedVersions = explicitTargets || normalizeTargetVersions(undefined, legacyAiCount);
  const slotMethods = normalizeAiSlotMethods(
    task.aiSlotMethodsSnapshot || task.ai_slot_methods_snapshot || task.aiSlotMethods || task.ai_slot_methods
  );
  const legacyGenerated = Number(task.aiGeneratedCount || task.ai_generated_count) || 0;
  const explicitGenerated = Array.isArray(task.aiGeneratedVersions)
    ? normalizeTargetVersions(task.aiGeneratedVersions).filter(version => /^ai[1-5]$/.test(version))
    : null;
  const aiFiles = explicitGenerated || (Array.isArray(task.ai_files)
    ? task.ai_files
    : Array.from({ length: legacyGenerated }, (_, index) => `ai${index + 1}`));
  return {
    ...task,
    id: task.bookId || task.book_id || task.id || '',
    book_id: task.bookId || task.book_id || task.id || '',
    book_name: task.bookName || task.book_name || '',
    platform_id: task.platformId || task.platform_id || '',
    platform_name: task.platformName || task.platform_name || '',
    parse_mode: task.parseMode || task.parse_mode || '',
    push_date: task.pushDate || task.push_date || task.pushedAt || task.pushed_at || task.createdAt || task.created_at || '',
    original_status: task.originalStatus || task.original_status || '',
    original_chars: Number(task.originalChars ?? task.original_chars) || 0,
    original_raw_chars: Number(task.originalRawChars ?? task.original_raw_chars) || 0,
    ai_status: task.aiStatus || task.ai_status || '',
    ai_count: targetAi ? targetAi.length : legacyAiCount,
    selected_versions: selectedVersions,
    ai_slot_methods: slotMethods,
    ai_files: aiFiles,
    target_versions: explicitTargets,
    ai_target_versions: targetAi,
    ai_generated_versions: aiFiles,
    classify_status: task.classifyStatus || task.classify_status || '',
    classifier_model: task.classifierModel || task.classifier_model || '',
    sensitive_hit_count: Number(task.sensitiveHitCount ?? task.sensitive_hit_count) || 0,
    sensitive_fixed_count: Number(task.sensitiveFixedCount ?? task.sensitive_fixed_count) || 0,
    sensitive_failed_count: Number(task.sensitiveFailedCount ?? task.sensitive_failed_count) || 0,
    site_submit_status: task.siteSubmitStatus || task.site_submit_status || '',
    site_submit_done_versions: task.siteSubmitDoneVersions || task.site_submit_done_versions || [],
    site_submit_accepted_versions: task.siteSubmitAcceptedVersions || task.site_submit_accepted_versions || [],
    site_submit_failed_versions: task.siteSubmitFailedVersions || task.site_submit_failed_versions || [],
    cancelled: isCancelledTask(task)
  };
}

function normalizeIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [ids]).map(value => String(value || '').trim()).filter(Boolean))];
}

function retryInputText(meta = {}) {
  const headers = ['书籍ID', '书名', '男女频', '风格', '标签', '推荐理由', '评级'];
  const values = [meta.bookId, meta.bookName, meta.gender, meta.style, meta.tags, meta.reason, meta.rating]
    .map(value => String(value || '').replace(/[\t\r\n]+/g, ' ').trim());
  return `${headers.join('\t')}\n${values.join('\t')}`;
}

function createNovelFetchTaskOps({ accountResolver, createStore, tombstones, parseBooks, clock = () => new Date(), applySavedRules, createConfigSnapshot } = {}) {
  if (typeof accountResolver !== 'function') throw new Error('accountResolver is required');
  if (typeof createStore !== 'function') throw new Error('createStore is required');
  if (!tombstones) throw new Error('tombstones is required');
  if (typeof parseBooks !== 'function') throw new Error('parseBooks is required');
  const batchExecutor = (!applySavedRules || !createConfigSnapshot) ? require('./v2-batch-executor') : null;
  const applySavedRulesToOriginal = applySavedRules || batchExecutor.createApplySavedRulesToOriginal();
  const makeConfigSnapshot = createConfigSnapshot || batchExecutor.createConfigStoreSnapshot;

  function accountFor(owner) {
    const account = accountResolver(owner);
    if (!account?.username || account.username !== owner) {
      const error = new Error(`账号 ${owner} 不存在或不可用`);
      error.recoverable = false;
      throw error;
    }
    return account;
  }
  function storeFor(owner) { return createStore({ account: accountFor(owner) }); }

  function processConflicts(owner, payload = {}) {
    const parsed = parseBooks({
      inputText: String(payload.input_text || ''),
      parseMode: payload.parse_mode || 'smart',
      columnPresetId: payload.column_preset_id || '',
      columnOrder: payload.column_order || '',
      styles: []
    });
    const ids = normalizeIds((parsed?.tasks || []).map(task => task.bookId || task.book_id || task.id));
    return ids.filter(id => tombstones.has(owner, id));
  }

  async function previewInput(owner, payload = {}) {
    const store = storeFor(owner);
    const config = typeof store.getConfig === 'function' ? object(await store.getConfig()) : {};
    const styles = typeof store.getStyles === 'function' ? (await store.getStyles() || []) : (Array.isArray(config.styles) ? config.styles : []);
    const parsed = parseBooks({
      inputText: String(payload.input_text || ''),
      parseMode: payload.parse_mode || 'smart',
      columnPresetId: payload.column_preset_id || '',
      columnOrder: payload.column_order || '',
      styles
    });
    return {
      parsed: Number(parsed?.parsed) || 0,
      unique_tasks: Number(parsed?.uniqueTasks) || 0,
      duplicate_count: Number(parsed?.duplicateCount) || 0,
      empty_id_count: Number(parsed?.emptyIdCount) || 0,
      tasks: (Array.isArray(parsed?.tasks) ? parsed.tasks : []).map(task => ({
        ...toV78Task(task),
        source_line: task.sourceLine || task.source_line || '',
        selected: true
      }))
    };
  }

  async function permanentDelete(owner, ids) {
    const normalized = normalizeIds(ids);
    const store = storeFor(owner);
    const result = await store.deleteTasks(owner, normalized);
    tombstones.add(owner, normalized);
    return { deleted: Number(result?.deleted) || normalized.length, tombstoned: normalized };
  }

  function restoreTombstone(owner, bookId) { accountFor(owner); return tombstones.restore(owner, String(bookId || '').trim()); }

  async function list(owner, query = {}) {
    const store = storeFor(owner);
    return filterTaskList(await store.listTasks(owner), query, clock()).map(toV78Task);
  }

  async function setAiCount(owner, ids, aiCount) {
    const count = Number(aiCount);
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('AI 数量必须在 1 到 20 之间');
    const normalized = normalizeIds(ids);
    const store = storeFor(owner);
    const conflicts = [];
    const missing = [];
    const records = [];
    for (const id of normalized) {
      const record = await store.getTask(owner, id);
      if (!record) { missing.push(id); continue; }
      records.push([id, record]);
      const versions = object(record.document?.versions);
      if (Object.keys(versions).some(key => /^ai\d+$/.test(key))) conflicts.push(id);
    }
    if (conflicts.length || missing.length) return { ok: false, conflicts, missing, updated: 0 };
    for (const [id] of records) await store.updateTaskMeta(owner, id, { aiCount: count });
    return { ok: true, conflicts: [], missing: [], updated: records.length, aiCount: count };
  }

  async function cancelSelected(owner, ids) {
    const normalized = normalizeIds(ids);
    const store = storeFor(owner);
    const cancelledAt = clock().toISOString();
    let updated = 0;
    const missing = [];
    for (const id of normalized) {
      const record = await store.getTask(owner, id);
      if (!record?.meta) { missing.push(id); continue; }
      await store.updateTaskMeta(owner, id, {
        status: 'cancelled',
        cancelRequestedAt: cancelledAt,
        cancelledAt,
        error: ''
      });
      if (typeof store.appendLog === 'function') {
        await store.appendLog(owner, id, 'task_cancelled', { source: 'manual_selected', cancelledAt });
      }
      updated += 1;
    }
    return { updated, missing, status: 'cancelled' };
  }

  async function abnormalIds(owner, query = {}) {
    const store = storeFor(owner);
    return filterTaskList(await store.listTasks(owner), query, clock()).filter(isAbnormalTask).map(taskBookId).filter(Boolean);
  }

  async function prepareRetryPayloads(owner, ids) {
    const normalized = normalizeIds(ids);
    const store = storeFor(owner);
    const payloads = [];
    for (const id of normalized) {
      const record = await store.getTask(owner, id);
      if (!record?.meta) continue;
      const meta = record.meta;
      await store.updateTaskMeta(owner, id, {
        status: 'queued',
        cancelRequestedAt: '',
        cancelledAt: '',
        error: ''
      });
      const payload = {
        platform_id: String(meta.platformId || meta.platform_id || '2'),
        input_text: retryInputText(meta),
        parse_mode: 'header',
        max_txt: Number(meta.maxTxt || meta.max_txt) || 4000,
        retry_existing_task: true
      };
      if (hasExplicitTargetVersions(meta)) {
        payload.target_versions = normalizeTargetVersions(meta.targetVersions);
        payload.ai_slot_methods_snapshot = { ...object(meta.aiSlotMethodsSnapshot || meta.ai_slot_methods_snapshot) };
      } else {
        payload.ai_count = Math.max(1, Number(meta.aiCount || meta.ai_count) || 1);
      }
      payloads.push(payload);
    }
    return payloads;
  }

  async function detail(owner, id) {
    const store = storeFor(owner);
    const record = await store.getTask(owner, id);
    if (!record?.meta) return null;
    const meta = record.meta;
    let aiVersions;
    if (hasExplicitTargetVersions(meta)) {
      aiVersions = normalizeTargetVersions(meta.targetVersions).filter(version => /^ai[1-5]$/.test(version));
    } else {
      const versions = object(record.document?.versions);
      aiVersions = Object.keys(versions).filter(version => /^ai\d+$/.test(version)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
      if (!aiVersions.length) aiVersions = Array.from({ length: Number(meta.aiGeneratedCount) || 0 }, (_, index) => `ai${index + 1}`);
    }
    const aiTexts = [];
    for (const version of aiVersions) {
      const text = typeof store.readVersionText === 'function' ? await store.readVersionText(owner, id, version) : String(record.document?.versions?.[version] || '');
      if (String(text || '').trim()) aiTexts.push({ name: version.toUpperCase(), version, text });
    }
    const original = typeof store.readOriginal === 'function' ? await store.readOriginal(owner, id) : String(record.document?.original || '');
    const logs = typeof store.readLogs === 'function' ? await store.readLogs(owner, id) : (Array.isArray(record.document?.logs) ? record.document.logs : []);
    return {
      meta: toV78Task(meta),
      original,
      ai_texts: aiTexts,
      target_versions: hasExplicitTargetVersions(meta) ? normalizeTargetVersions(meta.targetVersions) : null,
      has_original_raw: record.hasOriginalRaw === true || Boolean(record.document?.originalRaw),
      logs
    };
  }

  async function reprocessSensitive(owner, body = {}) {
    const store = storeFor(owner);
    const config = object(await store.getConfig());
    const configStore = makeConfigSnapshot(store, config);
    const all = await store.listTasks(owner);
    let ids;
    if (body.mode === 'selected') ids = normalizeIds(body.ids || []);
    else if (body.mode === 'failed') ids = all.filter(task => /failed|error|失败|错误/i.test(taskStatusText(task)) && !isCancelledTask(task)).map(taskBookId);
    else ids = all.map(taskBookId).filter(Boolean);
    const restoreFromBackup = body.restore_from_backup === true;
    const sensitiveConfig = object(config.sensitive_ai);
    const configuredMode = String(sensitiveConfig.mode || '').trim();
    const mode = ['replace', 'ai_each', 'ai_group'].includes(configuredMode)
      ? configuredMode
      : (sensitiveConfig.enabled === false ? 'replace' : 'ai_each');
    let processed = 0;
    let restored = 0;
    let failed = 0;
    for (const id of normalizeIds(ids)) {
      try {
        const task = await store.getTask(owner, id);
        if (!task?.meta) throw new Error('任务不存在');
        if (restoreFromBackup) {
          if (typeof store.restoreOriginal !== 'function') throw new Error('当前存储不支持恢复原文备份');
          await store.restoreOriginal(owner, id);
          restored += 1;
        }
        await applySavedRulesToOriginal(store, owner, id, config, configStore);
        if (typeof store.appendLog === 'function') {
          await store.appendLog(owner, id, 'sensitive_reprocessed', {
            source: restoreFromBackup ? 'original_backup' : 'current_text',
            mode,
            sensitive_ai_enabled: mode !== 'replace'
          });
        }
        processed += 1;
      } catch (_) {
        failed += 1;
      }
    }
    return { processed, restored, failed, tasks: (await store.listTasks(owner)).map(toV78Task) };
  }

  return {
    processConflicts,
    previewInput,
    permanentDelete,
    restoreTombstone,
    list,
    setAiCount,
    cancelSelected,
    abnormalIds,
    prepareRetryPayloads,
    detail,
    reprocessSensitive
  };
}

module.exports = {
  isCancelledTask,
  isAbnormalTask,
  isTaskUnfinished,
  filterTaskList,
  toV78Task,
  retryInputText,
  createNovelFetchTaskOps
};
