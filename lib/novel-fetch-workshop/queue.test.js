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
