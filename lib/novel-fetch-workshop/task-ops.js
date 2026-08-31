function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function taskBookId(task) { return String(task?.bookId || task?.book_id || task?.id || ''); }
function taskTimestamp(task) { return String(task?.updatedAt || task?.updated_at || task?.createdAt || task?.created_at || ''); }
function dateKey(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : ''; }
function taskStatusText(task) {
  return [task?.status, task?.originalStatus, task?.original_status, task?.aiStatus, task?.ai_status, task?.classifyStatus, task?.classify_status, task?.error]
    .filter(Boolean).join(' ').toLowerCase();
}
function isTaskUnfinished(task) {
  const text = taskStatusText(task);
  if (!text) return true;
  if (/(failed|error|running|queued|waiting|created|paused|stopping|interrupted|失败|错误|处理中|等待)/i.test(text)) return true;
  if (/(done|completed|submitted|success|完成|成功)/i.test(text)) return false;
  return true;
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

function normalizeIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [ids]).map(value => String(value || '').trim()).filter(Boolean))];
}

function createNovelFetchTaskOps({ accountResolver, createStore, tombstones, parseBooks, clock = () => new Date() } = {}) {
  if (typeof accountResolver !== 'function') throw new Error('accountResolver is required');
  if (typeof createStore !== 'function') throw new Error('createStore is required');
  if (!tombstones) throw new Error('tombstones is required');
  if (typeof parseBooks !== 'function') throw new Error('parseBooks is required');

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
    return filterTaskList(await store.listTasks(owner), query, clock());
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

  return { processConflicts, permanentDelete, restoreTombstone, list, setAiCount };
}

module.exports = { isTaskUnfinished, filterTaskList, createNovelFetchTaskOps };
