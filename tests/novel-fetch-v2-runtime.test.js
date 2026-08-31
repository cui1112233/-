const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createNovelFetchV2Runtime } = require('../lib/novel-fetch-workshop/v2-runtime');

function tempUsersDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-v78-runtime-')); }
function clockAt(iso) {
  let value = new Date(iso);
  return { now: () => new Date(value), set: isoValue => { value = new Date(isoValue); } };
}

test('queue executor delegates payload to one shared executeBatch primitive with owner', async () => {
  const calls = [];
  const runtime = createNovelFetchV2Runtime({
    usersDir: tempUsersDir(),
    executeBatch: async (owner, payload) => { calls.push({ owner, payload }); return { fetched: 1 }; },
    sleep: async () => {}
  });
  runtime.queue.start('alice', [{ input_text: 'A', platform_id: '15' }]);
  const status = await runtime.queue.waitForIdle('alice');
  assert.deepEqual(calls, [{ owner: 'alice', payload: { input_text: 'A', platform_id: '15' } }]);
  assert.equal(status.items[0].state, 'done');
  assert.deepEqual(status.items[0].result, { fetched: 1 });
});

test('due scheduler enqueues its input snapshot for the same owner exactly once', async () => {
  const calls = [];
  const clock = clockAt('2026-08-31T12:00:00.000Z');
  const runtime = createNovelFetchV2Runtime({
    usersDir: tempUsersDir(),
    clock: clock.now,
    executeBatch: async (owner, payload) => { calls.push({ owner, payload }); return { ok: true }; },
    sleep: async () => {}
  });
  runtime.scheduler.create('bob', { runAt: '2026-08-31T11:00:00.000Z', inputSnapshot: { input_text: 'B' } });
  await runtime.tick();
  await runtime.queue.waitForIdle('bob');
  await runtime.tick();
  assert.deepEqual(calls, [{ owner: 'bob', payload: { input_text: 'B' } }]);
  assert.equal(runtime.scheduler.list('bob')[0].status, 'done');
});

test('startScheduler is idempotent and stopScheduler clears polling timer', async () => {
  const runtime = createNovelFetchV2Runtime({ usersDir: tempUsersDir(), executeBatch: async () => ({}), pollIntervalMs: 50 });
  const one = runtime.startScheduler();
  const two = runtime.startScheduler();
  assert.equal(one, two);
  assert.ok(one);
  runtime.stopScheduler();
  assert.equal(runtime.schedulerTimer(), null);
});
