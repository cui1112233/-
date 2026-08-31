const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createQueueStore } = require('../lib/novel-fetch-workshop/queue-store');
const { createNovelFetchQueue } = require('../lib/novel-fetch-workshop/queue');

function tempUsersDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-v78-queue-')); }

async function waitUntil(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('wait timeout');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('queue store is owner scoped and recovers stale running items as queued', () => {
  const usersDir = tempUsersDir();
  const store = createQueueStore({ usersDir });
  store.replace('alice', { state: 'running', items: [{ id: 'a', state: 'running', payload: { book: 1 }, attempts: 1 }], events: [] });
  store.replace('bob', { state: 'idle', items: [{ id: 'b', state: 'done', payload: { book: 2 }, attempts: 1 }], events: [] });

  const alice = store.load('alice');
  const bob = store.load('bob');
  assert.equal(alice.state, 'idle');
  assert.equal(alice.items[0].state, 'queued');
  assert.equal(alice.events.at(-1).type, 'recovered_after_restart');
  assert.equal(bob.items[0].id, 'b');
  assert.equal(bob.items[0].state, 'done');
});

test('queue starts, pauses between items, resumes and finishes', async () => {
  const store = createQueueStore({ usersDir: tempUsersDir() });
  const seen = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const queue = createNovelFetchQueue({
    store,
    execute: async item => {
      seen.push(item.payload.id);
      if (item.payload.id === 1) await firstGate;
      return { ok: true };
    },
    sleep: async () => {}
  });

  queue.start('alice', [{ id: 1 }, { id: 2 }]);
  await waitUntil(() => seen.length === 1);
  queue.pause('alice');
  releaseFirst();
  await waitUntil(() => queue.status('alice').state === 'paused');
  assert.deepEqual(seen, [1]);

  queue.resume('alice');
  await queue.waitForIdle('alice');
  assert.deepEqual(seen, [1, 2]);
  assert.equal(queue.status('alice').state, 'idle');
  assert.deepEqual(queue.status('alice').items.map(item => item.state), ['done', 'done']);
});

test('recoverable failure retries with bounded backoff and non-recoverable failure stops retrying', async () => {
  const store = createQueueStore({ usersDir: tempUsersDir() });
  const sleeps = [];
  const attempts = new Map();
  const queue = createNovelFetchQueue({
    store,
    sleep: async ms => { sleeps.push(ms); },
    execute: async item => {
      const count = (attempts.get(item.payload.id) || 0) + 1;
      attempts.set(item.payload.id, count);
      if (item.payload.id === 'retry' && count < 3) {
        const error = new Error('temporary');
        error.recoverable = true;
        throw error;
      }
      if (item.payload.id === 'fatal') {
        const error = new Error('fatal');
        error.recoverable = false;
        throw error;
      }
      return { ok: true };
    }
  });

  queue.start('alice', [{ id: 'retry' }, { id: 'fatal' }]);
  await queue.waitForIdle('alice');
  assert.equal(attempts.get('retry'), 3);
  assert.equal(attempts.get('fatal'), 1);
  assert.deepEqual(sleeps, [2000, 5000]);
  assert.deepEqual(queue.status('alice').items.map(item => item.state), ['done', 'failed']);
});

test('stop prevents later queued work and queues for different owners remain independent', async () => {
  const store = createQueueStore({ usersDir: tempUsersDir() });
  const seen = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = createNovelFetchQueue({
    store,
    execute: async item => {
      seen.push(`${item.owner}:${item.payload.id}`);
      if (item.owner === 'alice' && item.payload.id === 1) await gate;
      return { ok: true };
    },
    sleep: async () => {}
  });

  queue.start('alice', [{ id: 1 }, { id: 2 }]);
  queue.start('bob', [{ id: 9 }]);
  await waitUntil(() => seen.includes('alice:1') && seen.includes('bob:9'));
  queue.stop('alice');
  release();
  await Promise.all([queue.waitForIdle('alice'), queue.waitForIdle('bob')]);

  assert.equal(seen.includes('alice:2'), false);
  assert.equal(queue.status('alice').items[1].state, 'stopped');
  assert.equal(queue.status('bob').items[0].state, 'done');
});
