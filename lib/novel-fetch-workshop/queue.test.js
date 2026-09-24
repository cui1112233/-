const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNovelFetchQueue } = require('./queue');
const { createQueueStore } = require('./queue-store');

test('活动中的相同重试键只会进入队列一次', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const state = { state: 'idle', items: [], events: [] };
  const store = {
    load: () => structuredClone(state), read: () => structuredClone(state),
    replace: (_owner, next) => Object.assign(state, structuredClone(next))
  };
  const queue = createNovelFetchQueue({ store, execute: async () => gate });
  const first = queue.start('alice', [{ retry_idempotency_key: 'alice:1002:rewrite:ai2' }]);
  const second = queue.start('alice', [{ retry_idempotency_key: 'alice:1002:rewrite:ai2' }]);
  assert.equal(first.accepted, 1);
  assert.equal(second.deduplicated, 1);
  assert.equal(queue.status('alice').items.length, 1);
  assert.match(queue.status('alice').items[0].leaseExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
  release();
  await queue.waitForIdle('alice');
});

test('手动任务会提升已有的相同排队项，且不打断正在执行的任务', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const state = {
    state: 'running',
    activeItemId: 'running',
    items: [
      { id: 'running', state: 'running', payload: { input_text: '历史正在执行' }, attempts: 1 },
      { id: 'older', state: 'queued', payload: { input_text: '历史排队任务' }, attempts: 0 },
      { id: 'requested', state: 'queued', payload: { input_text: '2054404988995215768 爸妈吞了我的赔偿款后' }, attempts: 0 }
    ],
    events: []
  };
  const store = {
    load: () => structuredClone(state), read: () => structuredClone(state),
    replace: (_owner, next) => Object.assign(state, structuredClone(next))
  };
  const queue = createNovelFetchQueue({ store, execute: async () => gate });

  const result = queue.start('alice', [{ input_text: '2054404988995215768 爸妈吞了我的赔偿款后' }], { priority: 'interactive' });
  const after = queue.status('alice').items;

  assert.equal(result.accepted, 0);
  assert.equal(result.deduplicated, 1);
  assert.equal(result.promoted, 1);
  assert.deepEqual(after.map(item => item.id), ['running', 'requested', 'older']);
  assert.equal(after.find(item => item.id === 'running').state, 'running');
  release();
});

test('删除书籍会停止含该书的待执行队列项，其他书继续保留', () => {
  const state = {
    state: 'running',
    items: [
      { id: 'target', state: 'queued', payload: { input_text: '2054404988995215768 爸妈吞了我的赔偿款后' }, attempts: 0 },
      { id: 'other', state: 'queued', payload: { input_text: '2084992034306373466 三颗还颜丹' }, attempts: 0 }
    ], events: []
  };
  const store = {
    load: () => structuredClone(state), read: () => structuredClone(state),
    replace: (_owner, next) => Object.assign(state, structuredClone(next))
  };
  const queue = createNovelFetchQueue({ store, execute: async () => ({ ok: true }) });

  const result = queue.cancelBooks('alice', ['2054404988995215768']);

  assert.deepEqual(result.cancelledItemIds, ['target']);
  assert.equal(queue.status('alice').items.find(item => item.id === 'target').state, 'stopped');
  assert.equal(queue.status('alice').items.find(item => item.id === 'other').state, 'queued');
});

test('进程重启后运行中的租约会重新排队，避免任务永久卡住', () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-throughput-'));
  const now = new Date('2026-09-22T12:00:00.000Z');
  const store = createQueueStore({ usersDir, clock: () => now });
  store.replace('alice', {
    state: 'running', events: [], items: [
      { id: 'stale', state: 'running', leaseExpiresAt: '2026-09-22T11:59:59.000Z' },
      { id: 'live', state: 'running', leaseExpiresAt: '2026-09-22T12:01:00.000Z' }
    ]
  });
  const loaded = store.load('alice');
  assert.equal(loaded.items.find(item => item.id === 'stale').state, 'queued');
  assert.equal(loaded.items.find(item => item.id === 'live').state, 'queued');
  fs.rmSync(usersDir, { recursive: true, force: true });
});

test('恢复后的排队任务会自动重新启动，不会只停留在 queued', async () => {
  const state = {
    state: 'idle',
    items: [{ id: 'recovered-item', state: 'queued', payload: { bookId: '2054404988995215768' }, attempts: 1 }],
    events: []
  };
  const executed = [];
  const store = {
    load: () => structuredClone(state),
    read: () => structuredClone(state),
    replace: (_owner, next) => Object.assign(state, structuredClone(next))
  };
  const queue = createNovelFetchQueue({
    store,
    execute: async item => { executed.push(item.id); return { ok: true }; }
  });

  queue.status('alice');
  await new Promise(resolve => setTimeout(resolve, 0));
  await queue.waitForIdle('alice');

  assert.deepEqual(executed, ['recovered-item']);
  assert.equal(queue.status('alice').items[0].state, 'done');
});
