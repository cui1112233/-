const test = require('node:test');
const assert = require('node:assert/strict');
const { registerNovelFetchV2Routes, normalizeProcessPayload, buildRealtimeStatus, queueItemToProcessJob } = require('./v2-api-contract');

test('处理请求只保留字符串文本模型 ID', () => {
  assert.equal(normalizeProcessPayload({ text_model_id: ' text-a ' }).text_model_id, 'text-a');
  assert.equal(normalizeProcessPayload({ text_model_id: { id: 'bad' } }).text_model_id, '');
});

test('实时状态提供安全的队列重试与模型摘要', () => {
  const output = buildRealtimeStatus({
    state: 'running',
    items: [{ id: 'job-1', state: 'waiting_retry', attempts: 2, maxAttempts: 3, error: 'Invalid token', payload: { task_ids: ['book-1'], text_model_id: 'text-a' } }]
  }, []);
  assert.equal(output.counts.waiting_retry, 1);
  assert.deepEqual(output.items, [{ id: 'job-1', status: 'waiting_retry', attempts: 2, max_attempts: 3, error: 'Invalid token', task_ids: ['book-1'], text_model_id: 'text-a' }]);
  assert.equal(JSON.stringify(output).includes('credential'), false);
});

test('处理任务返回自身的逐书进度而非队列事件', () => {
  const job = queueItemToProcessJob({
    id: 'job-1', state: 'running', createdAt: '2026-09-25T00:00:00.000Z',
    progress: [{ book_id: 'book-1', stage: 'fetch', status: 'done', message: '原文已获取', at: '2026-09-25T00:00:01.000Z' }]
  });
  assert.deepEqual(job.progress, [{ book_id: 'book-1', stage: 'fetch', status: 'done', message: '原文已获取', at: '2026-09-25T00:00:01.000Z' }]);
});

function fakeRouter() {
  const routes = new Map();
  return {
    routes,
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
    patch() {}, delete() {}
  };
}

test('队列状态返回全局资源池占用', () => {
  const router = fakeRouter();
  registerNovelFetchV2Routes(router, {
    queue: { status: () => ({ state: 'idle', items: [] }) },
    scheduler: { list: () => [] },
    throughput: { snapshot: () => ({ active: { fetch: 2 }, limits: { fetch: 2 }, paused: true }) }
  });
  let body;
  router.routes.get('GET /process/queue/status')({ username: 'alice' }, { json: value => { body = value; } });
  assert.deepEqual(body.throughput, { active: { fetch: 2 }, limits: { fetch: 2 }, paused: true });
});

test('批量重试回传实际入队数与去重数', async () => {
  const router = fakeRouter();
  registerNovelFetchV2Routes(router, {
    queue: {
      status: () => ({ state: 'idle', items: [] }),
      start: () => ({ accepted: 1, deduplicated: 1, state: 'running', items: [] })
    },
    scheduler: { list: () => [] },
    taskOps: {
      prepareRetryPayloads: async () => [{ retry_stage: 'rewrite' }, { retry_stage: 'rewrite' }],
      list: async () => []
    }
  });
  let body;
  await router.routes.get('POST /tasks/batch-retry')(
    { username: 'alice', body: { ids: ['1002'] } },
    { json: value => { body = value; }, status: () => ({ json: value => { body = value; } }) }
  );
  assert.equal(body.retried, 1);
  assert.equal(body.deduplicated, 1);
});

test('手动开始处理按交互优先级入队，并返回被提升的已有任务', () => {
  const router = fakeRouter();
  let receivedPriority = '';
  registerNovelFetchV2Routes(router, {
    queue: {
      status: () => ({ state: 'running', items: [] }),
      start: (_owner, _items, options) => {
        receivedPriority = options?.priority || '';
        return {
          accepted: 0,
          deduplicated: 1,
          promoted: 1,
          itemIds: ['already-queued'],
          state: 'running',
          items: [{ id: 'already-queued', state: 'queued', createdAt: '2026-09-24T00:00:00.000Z' }]
        };
      }
    },
    scheduler: { list: () => [] },
    taskOps: { processConflicts: () => [] },
    batches: { create: () => ({ id: 'batch-1', createdAt: '2026-09-24T00:00:00.000Z' }) }
  });
  let body;
  router.routes.get('POST /process/start')(
    { username: 'alice', body: { input_text: '2054404988995215768 爸妈吞了我的赔偿款后' } },
    { json: value => { body = value; }, status: () => ({ json: value => { body = value; } }) }
  );
  assert.equal(receivedPriority, 'interactive');
  assert.equal(body.id, 'already-queued');
  assert.equal(body.queue_state, 'queued');
});

test('永久删除会同步取消包含该书的待执行队列项', async () => {
  const router = fakeRouter();
  let cancelled = [];
  registerNovelFetchV2Routes(router, {
    queue: {
      status: () => ({ state: 'running', items: [] }),
      cancelBooks: (_owner, ids) => { cancelled = ids; return { cancelledItemIds: ['queued-job'], stopRequestedBookIds: ['2054404988995215768'] }; }
    },
    scheduler: { list: () => [] },
    taskOps: {
      permanentDelete: async () => ({ deleted: 1, tombstoned: ['2054404988995215768'] })
    }
  });
  let body;
  await router.routes.get('POST /tasks/batch-delete-permanent')(
    { username: 'alice', body: { ids: ['2054404988995215768'] } },
    { json: value => { body = value; } },
    error => { throw error; }
  );
  assert.deepEqual(cancelled, ['2054404988995215768']);
  assert.deepEqual(body.cancelled_queue_item_ids, ['queued-job']);
  assert.deepEqual(body.stop_requested_book_ids, ['2054404988995215768']);
});
