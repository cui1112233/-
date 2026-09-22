const os = require('node:os');

const DEFAULT_LIMITS = Object.freeze({ fetch: 2, rewrite: 2, submit: 1 });
const PAUSE_AT = 0.75;
const RESUME_AT = 0.60;

function normalizeLimits(overrides = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([stage, fallback]) => {
    const value = Math.floor(Number(overrides[stage]) || fallback);
    return [stage, Math.max(1, value)];
  }));
}

function defaultLoad() {
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Number(os.loadavg()[0]) / Math.max(1, Number(cores) || 1);
}

function createNovelFetchThroughputController({
  limits,
  readLoad = defaultLoad,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  pauseAt = PAUSE_AT,
  resumeAt = RESUME_AT,
  waitMs = 250
} = {}) {
  const normalizedLimits = normalizeLimits(limits);
  const active = Object.fromEntries(Object.keys(DEFAULT_LIMITS).map(stage => [stage, 0]));
  const waiting = Object.fromEntries(Object.keys(DEFAULT_LIMITS).map(stage => [stage, 0]));
  let paused = false;
  let lastLoad = 0;

  function readPressure() {
    const value = Number(readLoad());
    lastLoad = Number.isFinite(value) && value >= 0 ? value : 0;
    if (!paused && lastLoad >= pauseAt) paused = true;
    else if (paused && lastLoad <= resumeAt) paused = false;
    return paused;
  }

  function snapshot() {
    return {
      limits: { ...normalizedLimits },
      active: { ...active },
      waiting: { ...waiting },
      paused,
      load: lastLoad,
      pauseAt,
      resumeAt
    };
  }

  async function acquire(stage, shouldStop) {
    if (!Object.hasOwn(normalizedLimits, stage)) throw new Error(`unknown throughput stage: ${stage}`);
    for (;;) {
      if (typeof shouldStop === 'function' && shouldStop()) {
        const error = new Error('任务已停止，未继续领取新的处理步骤');
        error.code = 'STOP_REQUESTED';
        error.recoverable = false;
        throw error;
      }
      const pressurePaused = readPressure();
      if (!pressurePaused && active[stage] < normalizedLimits[stage]) {
        active[stage] += 1;
        return () => { active[stage] = Math.max(0, active[stage] - 1); };
      }
      waiting[stage] += 1;
      try { await sleep(waitMs); } finally { waiting[stage] = Math.max(0, waiting[stage] - 1); }
    }
  }

  async function run(stage, work, { shouldStop } = {}) {
    if (typeof work !== 'function') throw new Error('throughput work must be a function');
    const release = await acquire(stage, shouldStop);
    try { return await work(); } finally { release(); }
  }

  return { run, snapshot };
}

module.exports = {
  DEFAULT_LIMITS,
  PAUSE_AT,
  RESUME_AT,
  defaultLoad,
  createNovelFetchThroughputController
};
