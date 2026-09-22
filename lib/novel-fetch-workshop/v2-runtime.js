const { createQueueStore } = require('./queue-store');
const { createNovelFetchQueue } = require('./queue');
const { createNovelFetchScheduler } = require('./scheduler');
const { createNovelFetchThroughputController } = require('./throughput-controller');

function createNovelFetchV2Runtime({
  usersDir,
  executeBatch,
  throughput = createNovelFetchThroughputController(),
  sleep,
  clock = () => new Date(),
  pollIntervalMs = 1000,
  onSchedulerError = () => {}
} = {}) {
  if (!usersDir) throw new Error('usersDir is required');
  if (typeof executeBatch !== 'function') throw new Error('executeBatch is required');

  const store = createQueueStore({ usersDir, clock });
  const queue = createNovelFetchQueue({
    store,
    sleep,
      execute: (item, control = {}) => executeBatch(item.owner, item.payload, {
        ...item,
        throughput,
        shouldStop: typeof control.shouldStop === 'function' ? control.shouldStop : item.isStopRequested,
        report: typeof control.report === 'function' ? control.report : () => {}
      })
  });
  const scheduler = createNovelFetchScheduler({
    usersDir,
    clock,
    execute: item => {
      const state = queue.start(item.owner, [{ ...(item.inputSnapshot || {}), scheduled: true, auto_submit: item.autoSubmit !== false }]);
      return { queueState: state.state, queuedItems: state.items.length };
    }
  });

  let timer = null;
  let ticking = null;

  async function tick() {
    if (ticking) return ticking;
    ticking = scheduler.runAllDue().finally(() => { ticking = null; });
    return ticking;
  }

  function startScheduler() {
    if (timer) return timer;
    void tick().catch(onSchedulerError);
    timer = setInterval(() => { void tick().catch(onSchedulerError); }, Math.max(50, Number(pollIntervalMs) || 1000));
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  function stopScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    store,
    queue,
    scheduler,
    throughput,
    tick,
    startScheduler,
    stopScheduler,
    schedulerTimer: () => timer
  };
}

module.exports = { createNovelFetchV2Runtime };
