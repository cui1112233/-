const { normalizeTargetVersions } = require('./target-versions');

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeProcessPayload(body = {}) {
  const source = { ...object(body) };
  const rawVersions = Array.isArray(source.selected_versions)
    ? source.selected_versions
    : (Array.isArray(source.target_versions)
      ? source.target_versions
      : (Array.isArray(source.targetVersions) ? source.targetVersions : null));
  if (rawVersions) {
    const targetVersions = normalizeTargetVersions(rawVersions);
    if (!targetVersions.length) {
      const error = new Error('请至少选择一个文案版本');
      error.status = 400;
      throw error;
    }
    source.target_versions = targetVersions;
    delete source.selected_versions;
    delete source.targetVersions;
  }

  const methods = source.ai_slot_methods_snapshot
    || source.aiSlotMethodsSnapshot
    || source.ai_slot_methods;
  if (methods && typeof methods === 'object' && !Array.isArray(methods)) {
    source.ai_slot_methods_snapshot = { ...methods };
    delete source.aiSlotMethodsSnapshot;
    delete source.ai_slot_methods;
  }
  return source;
}

function queueItemsFromBody(body = {}) {
  if (Array.isArray(body.items)) return body.items.map(normalizeProcessPayload);
  if (Array.isArray(body.payloads)) return body.payloads.map(normalizeProcessPayload);
  if (body.payload && typeof body.payload === 'object') return [normalizeProcessPayload(body.payload)];
  return [];
}

function batchSettingsSnapshot(payload = {}) {
  const snapshot = { ...(payload && typeof payload === 'object' ? payload : {}) };
  delete snapshot.input_text;
  delete snapshot.batch_id;
  return snapshot;
}

function attachBatch(owner, payload = {}, batches) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (!batches || typeof batches.create !== 'function' || source.batch_id) return source;
  const batch = batches.create(owner, {
    inputSnapshot: String(source.input_text || ''),
    settingsSnapshot: batchSettingsSnapshot(source),
    taskIds: Array.isArray(source.task_ids) ? source.task_ids : [],
    sourceBatchId: source.source_batch_id || ''
  });
  return { ...source, batch_id: batch.id };
}

function buildRealtimeStatus(queueState = {}, schedules = []) {
  const items = Array.isArray(queueState.items) ? queueState.items : [];
  const count = state => items.filter(item => item?.state === state).length;
  return {
    active: ['running', 'paused', 'stopping'].includes(queueState.state),
    state: queueState.state || 'idle',
    counts: {
      total: items.length,
      queued: count('queued'),
      running: count('running'),
      waiting_retry: count('waiting_retry'),
      done: count('done'),
      failed: count('failed'),
      stopped: count('stopped')
    },
    queue: queueState,
    schedules: Array.isArray(schedules) ? schedules : [],
    updated_at: queueState.updatedAt || ''
  };
}

function queueItemToProcessJob(item = {}) {
  const queueState = String(item.state || 'queued');
  const status = queueState === 'done'
    ? 'done'
    : (queueState === 'stopped' ? 'cancelled' : (queueState === 'failed' ? 'failed' : 'running'));
  const createdAt = String(item.createdAt || '');
  const startedAt = String(item.startedAt || createdAt);
  const completedAt = String(item.completedAt || '');
  return {
    id: String(item.id || ''),
    status,
    queue_state: queueState,
    started_at: startedAt,
    updated_at: completedAt || startedAt || createdAt,
    ...(completedAt ? { completed_at: completedAt } : {}),
    attempts: Math.max(0, Number(item.attempts) || 0),
    steps: [],
    result: item.result ?? null,
    error: String(item.error || (queueState === 'stopped' ? '处理任务已停止' : ''))
  };
}

function processJobsFromQueueState(state = {}, limit = 20) {
  const max = Math.max(1, Math.min(Number(limit) || 20, 20));
  return (Array.isArray(state.items) ? state.items : [])
    .map(queueItemToProcessJob)
    .filter(job => job.id)
    .sort((left, right) => String(right.updated_at || right.started_at).localeCompare(String(left.updated_at || left.started_at)))
    .slice(0, max);
}

function processErrorStatus(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 400;
}

function registerNovelFetchV2Routes(router, { queue, scheduler, taskOps, batches } = {}) {
  if (!router) throw new Error('router is required');
  if (!queue) throw new Error('queue is required');
  if (!scheduler) throw new Error('scheduler is required');

  router.post('/process/queue/start', (req, res) => {
    const items = queueItemsFromBody(req.body).map(payload => attachBatch(req.username, payload, batches));
    return res.json(queue.start(req.username, items));
  });
  router.post('/process/queue/pause', (req, res) => res.json(queue.pause(req.username)));
  router.post('/process/queue/resume', (req, res) => res.json(queue.resume(req.username)));
  router.post('/process/queue/stop', (req, res) => res.json(queue.stop(req.username)));
  router.get('/process/queue/status', (req, res) => res.json(queue.status(req.username)));
  router.get('/realtime/status', (req, res) => res.json(buildRealtimeStatus(queue.status(req.username), scheduler.list(req.username))));
  if (taskOps && typeof taskOps.previewInput === 'function') {
    router.post('/process/preview', async (req, res) => {
      try { return res.json(await taskOps.previewInput(req.username, normalizeProcessPayload(req.body || {}))); }
      catch (error) { return res.status(processErrorStatus(error)).json({ error: error?.message || '输入解析失败' }); }
    });
  }

  router.post('/process/start', (req, res) => {
    try {
      const normalizedBody = normalizeProcessPayload(req.body || {});
      const conflicts = taskOps && typeof taskOps.processConflicts === 'function'
        ? taskOps.processConflicts(req.username, normalizedBody)
        : [];
      if (conflicts.length) return res.status(410).json({ error: 'permanently_deleted', book_ids: conflicts });
      const payload = attachBatch(req.username, normalizedBody, batches);
      const state = queue.start(req.username, [payload]);
      const items = Array.isArray(state.items) ? state.items : [];
      const item = items[items.length - 1];
      if (!item?.id) return res.status(500).json({ error: 'v2_process_job_not_created' });
      return res.json({ ...queueItemToProcessJob(item), ...(payload.batch_id ? { batch_id: payload.batch_id } : {}) });
    } catch (error) {
      return res.status(processErrorStatus(error)).json({ error: error?.message || 'V2 处理任务创建失败', ...(error?.code ? { code: error.code } : {}) });
    }
  });
  router.get('/process/jobs/latest', (req, res) => {
    try {
      const jobs = processJobsFromQueueState(queue.status(req.username), req.query?.limit || 1);
      return res.json({ latest: jobs[0] || {}, jobs });
    } catch (error) {
      return res.status(processErrorStatus(error)).json({ error: error?.message || 'V2 处理记录读取失败' });
    }
  });
  router.get('/process/jobs/:id', (req, res) => {
    try {
      const state = queue.status(req.username);
      const item = (Array.isArray(state.items) ? state.items : []).find(entry => String(entry?.id || '') === String(req.params?.id || ''));
      if (!item) return res.status(404).json({ error: '处理任务不存在' });
      return res.json(queueItemToProcessJob(item));
    } catch (error) {
      return res.status(processErrorStatus(error)).json({ error: error?.message || 'V2 处理记录读取失败' });
    }
  });

  if (batches) {
    router.get('/batches/current', (req, res) => res.json({ batch: typeof batches.current === 'function' ? batches.current(req.username) : null }));
    router.get('/batches', (req, res) => res.json({ batches: typeof batches.list === 'function' ? batches.list(req.username) : [] }));
    router.post('/batches/:id/rerun', (req, res) => {
      const mode = req.body?.mode === 'abnormal' ? 'abnormal' : 'all';
      const prepared = typeof batches.prepareRerun === 'function' ? batches.prepareRerun(req.username, req.params.id, mode) : null;
      if (!prepared) return res.status(404).json({ error: 'batch_not_found' });
      return res.json(prepared);
    });
  }

  router.get('/schedules', (req, res) => res.json({ schedules: scheduler.list(req.username) }));
  router.post('/schedules', (req, res) => res.status(201).json(scheduler.create(req.username, req.body || {})));
  router.patch('/schedules/:id', (req, res) => {
    const item = scheduler.update(req.username, req.params.id, req.body || {});
    if (!item) return res.status(404).json({ error: 'schedule_not_found' });
    return res.json(item);
  });
  router.delete('/schedules/:id', (req, res) => {
    if (!scheduler.remove(req.username, req.params.id)) return res.status(404).json({ error: 'schedule_not_found' });
    return res.json({ deleted: true, id: req.params.id });
  });

  if (taskOps) {
    router.get('/tasks', async (req, res, next) => {
      try { return res.json({ tasks: await taskOps.list(req.username, req.query || {}) }); }
      catch (error) { return next(error); }
    });
    if (typeof taskOps.detail === 'function') {
      router.get('/tasks/:id', async (req, res, next) => {
        try {
          const detail = await taskOps.detail(req.username, req.params.id);
          if (!detail) return res.status(404).json({ error: '任务不存在' });
          return res.json(detail);
        } catch (error) { return next(error); }
      });
    }
    if (typeof taskOps.prepareRetryPayloads === 'function') {
      router.post('/tasks/batch-retry', async (req, res) => {
        try {
          const mode = req.body?.mode === 'failed' ? 'failed' : 'selected';
          const ids = mode === 'failed' && typeof taskOps.abnormalIds === 'function'
            ? await taskOps.abnormalIds(req.username, req.body?.query || {})
            : (Array.isArray(req.body?.ids) ? req.body.ids : []);
          const payloads = await taskOps.prepareRetryPayloads(req.username, ids);
          if (payloads.length) queue.start(req.username, payloads);
          const tasks = typeof taskOps.list === 'function' ? await taskOps.list(req.username, req.body?.query || {}) : [];
          return res.json({ retried: payloads.length, failed: 0, tasks });
        } catch (error) {
          return res.status(processErrorStatus(error)).json({ error: error?.message || '重试失败' });
        }
      });
    }
    if (typeof taskOps.cancelSelected === 'function') {
      router.post('/tasks/stop-selected', async (req, res, next) => {
        try { return res.json(await taskOps.cancelSelected(req.username, req.body?.ids || [])); }
        catch (error) { return next(error); }
      });
    }
    router.post('/tasks/batch-delete-permanent', async (req, res, next) => {
      try { return res.json(await taskOps.permanentDelete(req.username, req.body?.ids || [])); }
      catch (error) { return next(error); }
    });
    router.post('/tasks/:id/restore-tombstone', (req, res, next) => {
      try { return res.json({ restored: taskOps.restoreTombstone(req.username, req.params.id), id: req.params.id }); }
      catch (error) { return next(error); }
    });
    router.post('/tasks/batch-ai-count', async (req, res, next) => {
      try {
        const result = await taskOps.setAiCount(req.username, req.body?.ids || [], req.body?.ai_count);
        if (!result.ok) return res.status(409).json(result);
        return res.json(result);
      } catch (error) {
        if (/1.*20/.test(error?.message || '')) return res.status(400).json({ error: error.message });
        return next(error);
      }
    });
    if (typeof taskOps.reprocessSensitive === 'function') {
      router.post('/tasks/reprocess-sensitive', async (req, res) => {
        try { return res.json(await taskOps.reprocessSensitive(req.username, req.body || {})); }
        catch (error) { return res.status(processErrorStatus(error)).json({ error: error?.message || '敏感词重处理失败' }); }
      });
    }
  }
  return router;
}

module.exports = {
  queueItemsFromBody,
  normalizeProcessPayload,
  batchSettingsSnapshot,
  attachBatch,
  buildRealtimeStatus,
  queueItemToProcessJob,
  processJobsFromQueueState,
  registerNovelFetchV2Routes
};
