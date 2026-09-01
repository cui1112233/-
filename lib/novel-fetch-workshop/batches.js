'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('../system-store');

function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) { return String(value == null ? '' : value).trim(); }
function nowIso(clock) { return clock().toISOString(); }
function taskId(task) { return text(task?.bookId || task?.book_id || task?.id); }
function taskStatusText(task) {
  return [task?.status, task?.originalStatus, task?.original_status, task?.aiStatus, task?.ai_status, task?.siteSubmitStatus, task?.site_submit_status, task?.error]
    .filter(Boolean).join(' ').toLowerCase();
}
function isCancelled(task) { return /(cancelled|canceled|已取消)/i.test(taskStatusText(task)); }
function isAbnormal(task) {
  if (isCancelled(task)) return false;
  return /(failed|error|timeout|interrupted|incomplete|partial|失败|错误|超时|中断|未完成|121异常)/i.test(taskStatusText(task));
}
function snapshotTaskState(task = {}) {
  return {
    bookId: taskId(task),
    bookName: text(task?.bookName || task?.book_name),
    status: text(task?.status),
    originalStatus: text(task?.originalStatus || task?.original_status),
    aiStatus: text(task?.aiStatus || task?.ai_status),
    siteSubmitStatus: text(task?.siteSubmitStatus || task?.site_submit_status),
    targetVersions: Array.isArray(task?.targetVersions) ? task.targetVersions.slice() : (Array.isArray(task?.target_versions) ? task.target_versions.slice() : []),
    error: text(task?.error || task?.siteSubmitError || task?.site_submit_error)
  };
}
function refreshBatchStatus(record) {
  const summary = object(record?.resultSummary);
  if (Number(summary.cancelled) > 0) return 'cancelled';
  if (Number(summary.fetch_failed) > 0 || Number(summary.rewrite_failed) > 0) return 'partial';
  if ((Array.isArray(record?.taskStates) ? record.taskStates : []).some(isAbnormal)) return 'partial';
  return record?.completedAt ? 'done' : (record?.status || 'running');
}

function createNovelFetchBatches({ usersDir, clock = () => new Date() } = {}) {
  if (!usersDir) throw new Error('usersDir is required');
  const root = path.resolve(usersDir);

  function ownerDir(owner) {
    const value = text(owner);
    if (!value) throw new Error('owner is required');
    return path.join(root, value, 'novel-fetch-workshop');
  }
  function statePath(owner) { return path.join(ownerDir(owner), 'batches.json'); }
  function lockPath(owner) { return path.join(ownerDir(owner), '.batches.lock'); }
  function emptyState() { return { version: 1, currentBatchId: '', batches: [] }; }
  function read(owner) {
    const result = readJsonOrMissing(statePath(owner));
    if (!result.found || !object(result.value)) return emptyState();
    return {
      version: 1,
      currentBatchId: text(result.value.currentBatchId),
      batches: Array.isArray(result.value.batches) ? result.value.batches : []
    };
  }
  function write(owner, state) { writeJsonAtomic(statePath(owner), state); }
  function mutate(owner, action) {
    return withJsonLock(lockPath(owner), () => {
      const state = read(owner);
      const result = action(state);
      write(owner, state);
      return result;
    });
  }
  function makeId() {
    const stamp = nowIso(clock).replace(/[-:TZ.]/g, '').slice(0, 14);
    return `batch-${stamp}-${crypto.randomUUID().slice(0, 6)}`;
  }

  function create(owner, input = {}) {
    return mutate(owner, state => {
      const createdAt = nowIso(clock);
      const record = {
        id: text(input.id) || makeId(),
        createdAt,
        updatedAt: createdAt,
        status: 'running',
        inputSnapshot: clone(input.inputSnapshot ?? ''),
        settingsSnapshot: clone(object(input.settingsSnapshot)),
        taskIds: [...new Set((Array.isArray(input.taskIds) ? input.taskIds : []).map(text).filter(Boolean))],
        taskStates: [],
        sourceBatchId: text(input.sourceBatchId),
        resultSummary: {}
      };
      state.batches.push(record);
      state.currentBatchId = record.id;
      return clone(record);
    });
  }

  function current(owner) {
    const state = read(owner);
    const record = state.batches.find(item => item?.id === state.currentBatchId);
    return record ? clone(record) : null;
  }

  function list(owner) {
    return read(owner).batches.slice().sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))).map(clone);
  }

  function get(owner, id) {
    const record = read(owner).batches.find(item => item?.id === text(id));
    return record ? clone(record) : null;
  }

  function complete(owner, id, result = {}) {
    return mutate(owner, state => {
      const record = state.batches.find(item => item?.id === text(id));
      if (!record) return null;
      const tasks = Array.isArray(result.tasks) ? result.tasks : [];
      const taskStates = tasks.map(snapshotTaskState).filter(item => item.bookId);
      if (taskStates.length) {
        record.taskStates = taskStates;
        record.taskIds = [...new Set(taskStates.map(item => item.bookId))];
      }
      record.updatedAt = nowIso(clock);
      record.completedAt = record.updatedAt;
      record.resultSummary = {
        parsed: Number(result.parsed) || 0,
        fetched: Number(result.fetched) || 0,
        generated_ai_files: Number(result.generated_ai_files) || 0,
        fetch_failed: Number(result.fetch_failed) || 0,
        rewrite_failed: Number(result.rewrite_failed) || 0,
        cancelled: Number(result.cancelled) || 0
      };
      record.status = refreshBatchStatus(record);
      return clone(record);
    });
  }

  function updateTaskState(owner, id, task = {}) {
    return mutate(owner, state => {
      const record = state.batches.find(item => item?.id === text(id));
      if (!record) return null;
      const next = snapshotTaskState(task);
      if (!next.bookId) return clone(record);
      const states = Array.isArray(record.taskStates) ? record.taskStates : [];
      const index = states.findIndex(item => taskId(item) === next.bookId);
      if (index >= 0) states[index] = { ...states[index], ...next };
      else states.push(next);
      record.taskStates = states;
      record.taskIds = [...new Set([...(Array.isArray(record.taskIds) ? record.taskIds : []), next.bookId].map(text).filter(Boolean))];
      record.updatedAt = nowIso(clock);
      record.status = refreshBatchStatus(record);
      return clone(record);
    });
  }

  function prepareRerun(owner, id, mode = 'all') {
    const record = get(owner, id);
    if (!record) return null;
    const normalizedMode = mode === 'abnormal' ? 'abnormal' : 'all';
    const states = Array.isArray(record.taskStates) ? record.taskStates : [];
    const knownIds = record.taskIds?.length ? record.taskIds : states.map(taskId).filter(Boolean);
    const preselectedBookIds = normalizedMode === 'abnormal'
      ? states.filter(isAbnormal).map(taskId).filter(Boolean)
      : knownIds.slice();
    return {
      source_batch_id: record.id,
      mode: normalizedMode,
      input_snapshot: clone(record.inputSnapshot),
      settings_snapshot: clone(record.settingsSnapshot),
      preselected_book_ids: [...new Set(preselectedBookIds)],
      payload: {
        ...clone(object(record.settingsSnapshot)),
        input_text: typeof record.inputSnapshot === 'string' ? record.inputSnapshot : text(record.inputSnapshot?.input_text),
        source_batch_id: record.id
      }
    };
  }

  return { create, current, list, get, complete, updateTaskState, prepareRerun };
}

module.exports = { taskStatusText, isCancelled, isAbnormal, createNovelFetchBatches };
