function queueItemsFromBody(body = {}) {
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.payloads)) return body.payloads;
  if (body.payload && typeof body.payload === 'object') return [body.payload];
  return [];
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
    : (queueState === 'failed' || queueState === 'stopped' ? 'failed' : 'running');
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

function registerNovelFetchV2Routes(router, { queue, scheduler, taskOps } = {}) {
  if (!router) throw new Error('router is required');
  if (!queue) throw new Error('queue is required');
  if (!scheduler) throw new Error('scheduler is required');

  router.post('/process/queue/start', (req, res) => res.json(queue.start(req.username, queueItemsFromBody(req.body))));
  router.post('/process/queue/pause', (req, res) => res.json(queue.pause(req.username)));
  router.post('/process/queue/resume', (req, res) => res.json(queue.resume(req.username)));
  router.post('/process/queue/stop', (req, res) => res.json(queue.stop(req.username)));
  router.get('/process/queue/status', (req, res) => res.json(queue.status(req.username)));
  router.get('/realtime/status', (req, res) => res.json(buildRealtimeStatus(queue.status(req.username), scheduler.list(req.username))));

  router.post('/process/start', (req, res) => {
    try {
      const conflicts = taskOps && typeof taskOps.processConflicts === 'function'
        ? taskOps.processConflicts(req.username, req.body || {})
        : [];
      if (conflicts.length) return res.status(410).json({ error: 'permanently_deleted', book_ids: conflicts });
      const state = queue.start(req.username, [req.body || {}]);
      const items = Array.isArray(state.items) ? state.items : [];
      const item = items[items.length - 1];
      if (!item?.id) return res.status(500).json({ error: 'v2_process_job_not_created' });
      return res.json(queueItemToProcessJob(item));
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
  }
  return router;
}

module.exports = { queueItemsFromBody, buildRealtimeStatus, queueItemToProcessJob, processJobsFromQueueState, registerNovelFetchV2Routes };
