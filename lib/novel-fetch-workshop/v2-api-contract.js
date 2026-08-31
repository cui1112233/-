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

function registerNovelFetchV2Routes(router, { queue, scheduler } = {}) {
  if (!router) throw new Error('router is required');
  if (!queue) throw new Error('queue is required');
  if (!scheduler) throw new Error('scheduler is required');

  router.post('/process/queue/start', (req, res) => res.json(queue.start(req.username, queueItemsFromBody(req.body))));
  router.post('/process/queue/pause', (req, res) => res.json(queue.pause(req.username)));
  router.post('/process/queue/resume', (req, res) => res.json(queue.resume(req.username)));
  router.post('/process/queue/stop', (req, res) => res.json(queue.stop(req.username)));
  router.get('/process/queue/status', (req, res) => res.json(queue.status(req.username)));
  router.get('/realtime/status', (req, res) => res.json(buildRealtimeStatus(queue.status(req.username), scheduler.list(req.username))));

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
  return router;
}

module.exports = { queueItemsFromBody, buildRealtimeStatus, registerNovelFetchV2Routes };
