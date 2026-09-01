const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createQueueStore } = require('../lib/novel-fetch-workshop/queue-store');
const { createNovelFetchQueue } = require('../lib/novel-fetch-workshop/queue');

function tempUsersDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-v78-queue-stop-')); }

async function waitUntil(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('wait timeout');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('in-flight executor can observe queue stop request and finish its current atomic step', async () => {
  const store = createQueueStore({ usersDir: tempUsersDir() });
  let releaseStep;
  const gate = new Promise(resolve => { releaseStep = resolve; });
  let entered = false;
  let controlSeen = null;
  const observations = [];

  const queue = createNovelFetchQueue({
    store,
    sleep: async () => {},
    execute: async (_item, control) => {
      controlSeen = control;
      entered = true;
      observations.push(control.shouldStop());
      await gate;
      observations.push(control.shouldStop());
      return { saved_current_step: true };
    }
  });

  queue.start('alice', [{ id: 'first' }, { id: 'later' }]);
  await waitUntil(() => entered);
  assert.equal(typeof controlSeen?.shouldStop, 'function');
  queue.stop('alice');
  releaseStep();
  await queue.waitForIdle('alice');

  assert.deepEqual(observations, [false, true]);
  const state = queue.status('alice');
  assert.equal(state.items[0].state, 'done', '当前原子步骤允许完成并保存');
  assert.equal(state.items[0].result.saved_current_step, true);
  assert.equal(state.items[1].state, 'stopped', '停止后不再启动后续队列项');
});
