const test = require('node:test');
const assert = require('node:assert/strict');
const { createNovelFetchThroughputController } = require('./throughput-controller');

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('condition not reached');
}

test('共享抓取池最多同时执行两个任务', async () => {
  let active = 0;
  let peak = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const controller = createNovelFetchThroughputController({
    limits: { fetch: 2, rewrite: 2, submit: 1 },
    readLoad: () => 0
  });
  const jobs = [1, 2, 3].map(() => controller.run('fetch', async () => {
    active += 1;
    peak = Math.max(peak, active);
    await gate;
    active -= 1;
  }));

  await waitUntil(() => controller.snapshot().active.fetch === 2);
  assert.equal(peak, 2);
  assert.equal(controller.snapshot().waiting.fetch, 1);
  release();
  await Promise.all(jobs);
});

test('负载暂停后只在低于恢复阈值时领取新任务', async () => {
  let load = 0.8;
  const sleepers = [];
  const controller = createNovelFetchThroughputController({
    readLoad: () => load,
    sleep: () => new Promise(resolve => sleepers.push(resolve))
  });
  const pending = controller.run('rewrite', async () => 'ran');
  await waitUntil(() => controller.snapshot().paused === true && sleepers.length === 1);
  load = 0.7;
  sleepers.shift()();
  await waitUntil(() => sleepers.length === 1);
  assert.equal(controller.snapshot().paused, true);
  load = 0.6;
  sleepers.shift()();
  const result = await pending;
  assert.equal(result, 'ran');
  assert.equal(controller.snapshot().paused, false);
});
