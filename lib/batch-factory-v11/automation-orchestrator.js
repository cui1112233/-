const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TERMINAL_STATES = new Set(['completed', 'needs_attention', 'paused', 'cancelled']);
const ACTIVE_STATES = new Set(['scheduled', 'running']);
const BOOK_TERMINAL_STATES = new Set(['ready', 'failed', 'blocked']);
const AUTOMATION_RUN_MODES = new Set(['storyboard_only', 'video_no_submit', 'full_submit']);
const AUTOMATION_CONCURRENCIES = new Set([1, 2, 4]);
const AUTOMATION_RETRY_DELAYS_MS = [30_000, 120_000, 300_000];
const AUTOMATION_MAX_STAGE_ATTEMPTS = 3;
// 巨量素材批量自动兜底巡查的节奏：最快 15 秒一次，默认 60 秒一次。
const RECOVERY_MIN_MS = 15_000;
const RECOVERY_DEFAULT_MS = 60_000;
const RECOVERY_OWNER_CONCURRENCY = 2;
// 用户主动暂停/取消的批量，兜底巡查绝不能擅自重启。
const RECOVERY_SKIP_STATES = new Set(['paused', 'cancelled']);

function iso(now = Date.now) {
  return new Date(typeof now === 'function' ? now() : now).toISOString();
}

function text(value) {
  return String(value || '').trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function automationConcurrency(value, fallback = 2) {
  const number = Number(value);
  return AUTOMATION_CONCURRENCIES.has(number) ? number : fallback;
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const list = Array.isArray(items) ? items : [];
  const workerCount = Math.min(list.length, automationConcurrency(concurrency, 2));
  let nextIndex = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < list.length) {
      const item = list[nextIndex];
      nextIndex += 1;
      await iteratee(item);
    }
  }));
}

function retryableAutomationError(error) {
  const message = text(error?.message || error).toLowerCase();
  if (!message) return true;
  return !/(invalid api key|invalid token|token expired|expired token|unauthorized|forbidden|invalid input|invalid json|json parse|parse error|not configured|未配置|无效.*密钥|鉴权失败|权限不足|令牌.*过期|令牌无效|解析.*json|内容违规|不符合平台要求|内容审核|审核拒绝|moderation|content policy)/.test(message);
}

function defaultStatePath() {
  const base = text(process.env.QIANTIE_BATCH_FACTORY_AUTOMATION_DIR)
    || text(process.env.QIANTIE_DATA_DIR)
    || path.join(process.cwd(), 'data');
  return path.join(base, 'batch-factory-v11-automation.json');
}

function jobKey(owner, batchId) {
  return `${encodeURIComponent(text(owner))}:${encodeURIComponent(text(batchId))}`;
}

function requestId(prefix) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function stableRetryInput(value) {
  if (Array.isArray(value)) return value.map(stableRetryInput);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableRetryInput(value[key])]));
  return value;
}

function stageRetryKey(book, stage) {
  // 重试额度只由这个阶段真正会消费的输入决定。不能使用 book.revision：分类、
  // 上传回读等无关 metadata 写入同样会递增它，进而让同一次失败偷偷获得新额度。
  const name = text(stage) || 'unknown';
  const input = {
    stage: name,
    source: text(book?.workingFrontContent || book?.sourceText),
    bookSettings: object(book?.settingsState?.patch)
  };
  if (['compile', 'opening', 'visual', 'video', 'merge', 'upload'].includes(name)) {
    input.directorRevision = text(book?.directorRevision?.id);
    input.videos = (Array.isArray(book?.videos) ? book.videos : []).map(video => ({
      id: text(video?.id),
      visualPrompt: text(video?.visualPrompt),
      settings: object(video?.settingsState?.patch)
    }));
  }
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(stableRetryInput(input))).digest('hex').slice(0, 16);
  return `${name}:${inputHash}`;
}

function effectiveSettings(batch, book) {
  const batchPatch = object(batch?.settingsState?.patch);
  const bookPatch = object(book?.settingsState?.patch);
  const settings = {
    ...batchPatch,
    ...bookPatch,
    publishSettings: {
      ...object(batchPatch.publishSettings),
      ...object(bookPatch.publishSettings)
    }
  };
  if (Object.hasOwn(batchPatch, 'aiPromptConfig') || Object.hasOwn(bookPatch, 'aiPromptConfig')) {
    settings.aiPromptConfig = {
      ...object(batchPatch.aiPromptConfig),
      ...object(bookPatch.aiPromptConfig)
    };
  }
  return settings;
}

function automationRunMode(value, autoPublish = false) {
  const candidate = text(value);
  if (AUTOMATION_RUN_MODES.has(candidate)) return candidate;
  return 'full_submit';
}

function shouldResumeReadyBookForRunMode(state, runMode) {
  if (text(state?.status) !== 'ready') return false;
  const stage = text(state?.stage);
  if (runMode === 'video_no_submit') return stage === 'ready_for_video';
  if (runMode === 'full_submit') return stage === 'ready_for_video' || stage === 'ready_for_upload';
  return false;
}

function requeueReadyBooksForAdvancedRunMode(job) {
  for (const state of Object.values(object(job.books))) {
    if (!shouldResumeReadyBookForRunMode(state, job.runMode)) continue;
    const previousStop = text(state.stage) === 'ready_for_video' ? '分镜' : '视频与合成';
    state.status = 'pending';
    state.stage = text(state.stage) === 'ready_for_video' ? 'video' : 'upload';
    state.message = `执行模式已升级，正在从已完成的${previousStop}继续自动生产`;
    state.error = '';
    state.retryRequested = false;
    state.retryAt = '';
    state.retryKey = '';
  }
}

function queueFinalFailureSweep(job, timestamp = Date.now) {
  if (job.finalFailureSweepAttempted === true) return false;
  let queued = 0;
  for (const state of Object.values(object(job.books))) {
    if (!['failed', 'blocked'].includes(text(state.status))) continue;
    state.status = 'pending';
    state.stage = text(state.stage) || 'pending';
    state.message = '其他小说已完成，正在进行失败项最终自动补跑';
    state.error = '';
    state.retryRequested = true;
    state.retryAt = '';
    state.retryCount = 0;
    state.retryKey = '';
    state.retryLedger = {};
    state.directSourceRetryKey = '';
    state.directSourceError = '';
    queued += 1;
  }
  if (!queued) return false;
  job.finalFailureSweepAttempted = true;
  job.finalFailureSweepAt = iso(timestamp);
  return true;
}

function successfulStage(summary, stage) {
  return (Array.isArray(summary?.runs) ? summary.runs : []).some(run =>
    text(run?.stage) === stage && text(run?.status).toLowerCase() === 'succeeded'
  );
}

function assetsPresent(book) {
  if (Array.isArray(book?.assetRecords) && book.assetRecords.length > 0) return true;
  const assets = object(book?.assets);
  return ['characters', 'scenes', 'props'].some(key => Array.isArray(assets[key]) && assets[key].length > 0);
}

function requiredVideos(book, settings) {
  const videos = Array.isArray(book?.videos) ? book.videos.filter(video => text(video?.id)) : [];
  return settings?.fixedSingleVideo === true ? videos.slice(0, 1) : videos;
}

function visualReady(book, settings) {
  const videos = requiredVideos(book, settings);
  return videos.length > 0 && videos.every(video => text(video?.visualPrompt));
}

function productionTasks(status, bookId) {
  return (Array.isArray(status?.jobs) ? status.jobs : [])
    .filter(job => text(job?.bookId) === text(bookId))
    .flatMap(job => (Array.isArray(job?.tasks) ? job.tasks : []).map(task => ({ ...task, productionJobId: job.id })));
}

function requiredOpeningVariantIndexes(settings) {
  if (settings?.openingEnabled !== true) return [];
  const count = clampInteger(settings?.openingCount, 1, 8, 4);
  return Array.from({ length: Math.max(0, count - 1) }, (_, offset) => offset + 1);
}

function successfulOpeningVariantIndexes(video) {
  const variants = object(video?.settingsState?.patch).openingVariants;
  if (!Array.isArray(variants)) return new Set();
  return new Set(variants
    .filter(variant => text(variant?.status) === 'success' && text(variant?.prompt))
    .map(variant => Number(variant?.index || 0))
    .filter(index => Number.isInteger(index) && index > 0));
}

function requiredOpeningVariantsReady(video, settings) {
  const required = requiredOpeningVariantIndexes(settings);
  if (!required.length) return true;
  const successful = successfulOpeningVariantIndexes(video);
  return required.every(index => successful.has(index));
}

function openingVariantTaskIndexes(video, settings, isFirstVideo) {
  if (settings?.openingEnabled !== true || !isFirstVideo) return null;
  // 任务集合必须来自用户配置，而不是“碰巧成功了几个”。否则部分成功会被
  // 错当成完整结果，少生成的视频也能继续合成和上传。
  return [0, ...requiredOpeningVariantIndexes(settings)];
}

function targetVideoState(book, settings, productionStatus) {
  const videos = requiredVideos(book, settings);
  const tasks = productionTasks(productionStatus, book?.id);
  const byVideo = new Map();
  for (const task of tasks) {
    const videoId = text(task?.videoId);
    if (!videoId) continue;
    const values = byVideo.get(videoId) || [];
    values.push(task);
    byVideo.set(videoId, values);
  }

  const missing = [];
  const active = [];
  const failed = [];
  const succeeded = [];
  let readyVideos = 0;
  videos.forEach((video, position) => {
    const values = byVideo.get(text(video?.id)) || [];
    const variantIndexes = openingVariantTaskIndexes(video, settings, position === 0);
    if (variantIndexes) {
      let succeededIndexes = 0;
      for (const variantIndex of variantIndexes) {
        const subset = values.filter(task => Number(task?.openingVariantIndex || 0) === variantIndex);
        const success = [...subset].reverse().find(task => text(task?.status).toLowerCase() === 'succeeded' && text(task?.mediaUrl));
        const running = [...subset].reverse().find(task => ['queued', 'running'].includes(text(task?.status).toLowerCase()));
        const failure = [...subset].reverse().find(task => ['failed', 'cancelled'].includes(text(task?.status).toLowerCase()));
        if (success) { succeeded.push({ video, task: success, variantIndex }); succeededIndexes += 1; }
        else if (running) active.push({ video, task: running, variantIndex });
        else if (failure) failed.push({ video, task: failure, variantIndex });
        else missing.push({ video, variantIndex });
      }
      if (succeededIndexes === variantIndexes.length) readyVideos += 1;
      return;
    }
    const success = [...values].reverse().find(task => text(task?.status).toLowerCase() === 'succeeded' && text(task?.mediaUrl));
    const running = [...values].reverse().find(task => ['queued', 'running'].includes(text(task?.status).toLowerCase()));
    const failure = [...values].reverse().find(task => ['failed', 'cancelled'].includes(text(task?.status).toLowerCase()));
    if (success) { succeeded.push({ video, task: success }); readyVideos += 1; }
    else if (running) active.push({ video, task: running });
    else if (failure) failed.push({ video, task: failure });
    else missing.push(video);
  });
  return { videos, missing, active, failed, succeeded, ready: videos.length > 0 && readyVideos === videos.length };
}

function mergeState(mergeStatus, bookId) {
  const jobs = (Array.isArray(mergeStatus?.jobs) ? mergeStatus.jobs : [])
    .filter(job => text(job?.bookId) === text(bookId))
    .sort((left, right) => String(left?.updatedAt || left?.createdAt || '').localeCompare(String(right?.updatedAt || right?.createdAt || '')));
  // 同一变体的历史 job 只取最新一条参与聚合：失败后重试成功的书不能让
  // 旧 failed 记录永远阻断 succeeded（否则每 tick 都会重复提交付费合并）。
  const latestByVariant = new Map();
  for (const job of jobs) latestByVariant.set(Number(job?.openingVariantIndex || 0), job); // 升序遍历，后写即最新
  const latest = [...latestByVariant.values()];
  const allSucceeded = latest.filter(job => text(job?.status).toLowerCase() === 'succeeded' && text(job?.outputUrl));
  const active = [...latest].reverse().find(job => ['queued', 'running'].includes(text(job?.status).toLowerCase()));
  const failed = [...latest].reverse().find(job => ['failed', 'cancelled'].includes(text(job?.status).toLowerCase()));
  const succeeded = latest.length > 0 && !active && !failed && allSucceeded.length === latest.length ? allSucceeded : null;
  return { jobs, latest, succeeded, allSucceeded, active, failed };
}

function publicBookState(value) {
  return {
    bookId: value.bookId,
    title: value.title,
    status: value.status,
    stage: value.stage,
    message: value.message,
    error: value.error,
    updatedAt: value.updatedAt,
    attempts: value.attempts || 0,
    retryCount: Number(value.retryCount || 0),
    retryAt: value.retryAt || '',
    // A manual retry has already consumed the failed-book action and is
    // waiting for an admitted production lane.  Expose that fact so callers
    // never present it as an ordinary pending book or as a still-actionable
    // failure at the same time.
    retryRequested: value.retryRequested === true
  };
}

function publicJob(job) {
  if (!job) return { state: 'idle', counts: { total: 0, ready: 0, running: 0, pending: 0, failed: 0, blocked: 0 } };
  return {
    id: job.id,
    batchId: job.batchId,
    state: job.state,
    stopAt: job.stopAt,
    autoPublish: job.autoPublish === true,
    runMode: job.runMode || 'video_no_submit',
    concurrency: automationConcurrency(job.concurrency),
    preset: object(job.preset),
    scheduledAt: job.scheduledAt || '',
    createdAt: job.createdAt,
    startedAt: job.startedAt || '',
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || '',
    lastError: job.lastError || '',
    counts: job.counts || { total: 0, ready: 0, running: 0, pending: 0, failed: 0, blocked: 0 },
    books: Object.values(job.books || {}).map(publicBookState)
  };
}

// Every pass hydrates the active batch and reads durable production state. Keep
// its default cadence aligned with the public runtime snapshot so a large
// batch cannot turn an otherwise idle small public host into a query loop.
function createBatchFactoryAutomationController({ adapter, statePath = defaultStatePath(), pollMs = 15_000, now = Date.now, logger = console, dispatcherConcurrency = 2, recoveryEnabled = true, recoveryMs = RECOVERY_DEFAULT_MS } = {}) {
  if (!adapter || typeof adapter.loadBatch !== 'function' || typeof adapter.runStage !== 'function') {
    throw new Error('Batch Factory automation requires loadBatch and runStage adapters');
  }
  const jobs = new Map();
  const locks = new Set();
  // A slow provider/upload call belongs to one book lane, not to the whole
  // batch. Keep those promises outside the short scheduler lock so another
  // lane can admit the next book as soon as it becomes free.
  const activeBookTasks = new Map();
  const activeBookLimit = clampInteger(dispatcherConcurrency, 1, 4, 2);
  let timer = null;
  let persistChain = Promise.resolve();
  // 兜底巡查是独立常驻的，不随 jobs 空闲而停（这正是"只缺最后一下启动"的批量需要的）。
  let recoveryTimer = null;
  let recoveryChain = Promise.resolve();
  const recoveryInFlight = new Set();

  function persist() {
    const payload = {
      version: 1,
      updatedAt: iso(now),
      jobs: Object.fromEntries([...jobs.entries()].map(([key, job]) => [key, { ...job, _runtime: undefined }]))
    };
    persistChain = persistChain.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
        const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.promises.writeFile(temporary, JSON.stringify(payload, null, 2), { mode: 0o600 });
        await fs.promises.rename(temporary, statePath);
      } catch (error) {
        logger.error?.('[batch-factory-automation] state persistence failed', error);
      }
    });
    return persistChain;
  }

  function loadPersisted() {
    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      let migratedPersistedState = false;
      for (const [key, value] of Object.entries(object(parsed?.jobs))) {
        const job = object(value);
        if (!text(job.owner) || !text(job.batchId)) continue;
        job.books = object(job.books);
        for (const book of Object.values(job.books)) {
          const giantSourceNeverStarted = book?.status === 'blocked'
            && text(book?.stage) === 'source'
            && /巨量素材尚未创建执行器任务|执行器任务排队超过 5 分钟仍未被领取/.test(text(book?.error));
          if (!giantSourceNeverStarted) continue;
          book.status = 'failed';
          book.message = text(book?.error).includes('排队超过')
            ? '滚屏 OCR 未被执行器领取，已停止本书并继续下一本'
            : '未启动本地巨量执行器，已停止本书并继续下一本';
          book.retryRequested = false;
          book.retryAt = '';
          migratedPersistedState = true;
        }
        job.concurrency = automationConcurrency(job.concurrency, activeBookLimit);
        updateCounts(job);
        // A temporary bridge/service outage belongs to the scheduler envelope,
        // not to any book. Older processes stopped the whole batch after three
        // such failures. Revive that envelope whenever unfinished books remain;
        // already failed books keep their own terminal state and retry budget.
        const staleRetryableEnvelope = Number(job.jobRetryCount || 0) < AUTOMATION_MAX_STAGE_ATTEMPTS
          && job.counts.failed === 0
          && job.counts.blocked === 0;
        const stoppedByTransientSchedulerFailure = /总调度/.test(text(job.lastError));
        if (
          job.state === 'needs_attention'
          && (staleRetryableEnvelope || stoppedByTransientSchedulerFailure)
          && (job.counts.running > 0 || job.counts.pending > 0)
        ) {
          job.state = 'running';
          job.completedAt = '';
          job.lastError = '';
          job.jobRetryCount = 0;
          job.jobRetryAt = '';
          migratedPersistedState = true;
        }
        if (job.state === 'running' || job.state === 'scheduled') {
          job.state = job.scheduledAt && new Date(job.scheduledAt).getTime() > now() ? 'scheduled' : 'running';
        }
        jobs.set(key, job);
      }
      if (migratedPersistedState) void persist();
    } catch (error) {
      if (error?.code !== 'ENOENT') logger.error?.('[batch-factory-automation] state load failed', error);
    }
  }

  function ensureTimer() {
    if (timer) return;
    timer = setInterval(() => { void tick(); }, Math.max(1000, pollMs));
    timer.unref?.();
  }

  function stopTimerIfIdle() {
    if ([...jobs.values()].some(job => ACTIVE_STATES.has(job.state))) return;
    if (timer) clearInterval(timer);
    timer = null;
  }

  // -------- 巨量素材批量自动兜底巡查 --------
  // 背景：巨量 OCR 的自动生产只能按照创建时保存的计划恢复。不能因为没有
  // 计划而猜测全自动：那会用空配置消耗模型额度，并让用户误以为预设生效了。
  function giantBooksOf(batch) {
    const books = Array.isArray(batch?.books) ? batch.books : [];
    return books.filter(book => text(book?.sourceMetadata?.sourceMode) === 'giant_material');
  }

  function hasRecoveredSourceArrival(job, batch) {
    return (Array.isArray(batch?.books) ? batch.books : []).some(book => {
      const state = object(job.books?.[book?.id]);
      const retryKey = text(state.retryKey);
      return state.status === 'failed'
        && state.stage === 'source'
        && text(book?.workingFrontContent || book?.sourceText)
        // 兼容已落库的旧失败记录：它们在修复前没有 source retryKey。
        && (!retryKey || retryKey !== stageRetryKey(book, 'source'));
    });
  }

  // 创建时保存的开工计划（每本书的 sourceMetadata.giantAutomationPlan 都一样，取第一条非空的）。
  function savedGiantPlan(batch) {
    for (const book of giantBooksOf(batch)) {
      const plan = object(book?.sourceMetadata?.giantAutomationPlan);
      if (Object.keys(plan).length) return clone(plan);
    }
    return null;
  }

  // OCR 正文回填是素材读取的一部分，不应依赖用户是否选择了自动生产。
  // 自动生产只负责正文就绪后的资产、分镜、视频阶段；两者必须分开巡查。
  async function reconcileOwnerBatchSources(owner, isOwnerRole, batch) {
    if (typeof adapter.reconcileGiantMaterialSource !== 'function') return;
    const batchId = text(batch?.id);
    if (!batchId || !giantBooksOf(batch).length) return;
    // listBatches supplies the durable recovery index, including the current
    // source text, metadata and revisions. Reloading the full workbench here
    // used to hydrate every video, asset and director revision once per minute.
    for (const book of giantBooksOf(batch)) {
      const metadata = object(book?.sourceMetadata);
      if (!text(metadata.executorJobId) || text(book?.workingFrontContent || book?.sourceText) || metadata.contentPending === false) continue;
      try {
        await adapter.reconcileGiantMaterialSource({ owner, isOwner: isOwnerRole, batch, book });
      } catch (error) {
        logger.warn?.('[batch-factory-automation] giant source reconciliation failed', { batchId, bookId: book.id, error: failureMessage(error, 'reconciliation failed') });
      }
    }
  }

  async function recoverOwnerBatch(owner, isOwnerRole, batch) {
    const batchId = text(batch?.id);
    if (!batchId || !giantBooksOf(batch).length) return;
    const key = jobKey(owner, batchId);
    if (recoveryInFlight.has(key)) return;
    const existing = jobs.get(key);
    if (existing) {
      // 正在跑/已排期：不重复启动；用户暂停/取消：尊重用户，不重启。
      if (ACTIVE_STATES.has(existing.state) || RECOVERY_SKIP_STATES.has(existing.state)) return;
      // 只有“source 已失败但随后正文真实到位”可以自动恢复；其他失败项仍需用户显式重试。
      if (existing.state !== 'needs_attention' || !hasRecoveredSourceArrival(existing, batch)) return;
    }
    const savedPlan = savedGiantPlan(batch);
    if (!text(savedPlan?.presetId)) {
      logger.warn?.('[batch-factory-automation] giant batch recovery skipped: saved plan missing', { batchId, owner });
      return;
    }
    if (savedPlan?.scheduledAt && new Date(savedPlan.scheduledAt).getTime() > now()) return;
    recoveryInFlight.add(key);
    try {
      await adapter.startRecovery({ owner, isOwner: isOwnerRole, batch, savedPlan });
      logger.info?.('[batch-factory-automation] giant batch auto-started', { batchId, owner });
    } catch (error) {
      logger.warn?.('[batch-factory-automation] giant batch recovery failed', { batchId, error: failureMessage(error, 'recovery failed') });
    } finally {
      recoveryInFlight.delete(key);
    }
  }

  async function runRecovery() {
    if (typeof adapter.listOwners !== 'function'
      || typeof adapter.listBatches !== 'function'
      || typeof adapter.startRecovery !== 'function') return;
    let owners = [];
    try {
      const raw = await adapter.listOwners();
      owners = (Array.isArray(raw) ? raw : [])
        .map(value => (typeof value === 'string'
          ? { username: value, isOwner: false }
          : { username: text(value?.username), isOwner: value?.isOwner === true }))
        .filter(value => value.username);
    } catch (error) {
      logger.warn?.('[batch-factory-automation] recovery owner list failed', error);
      return;
    }
    await mapWithConcurrency(owners, RECOVERY_OWNER_CONCURRENCY, async ({ username, isOwner }) => {
      let batches = [];
      try {
        batches = await adapter.listBatches(username, isOwner);
      } catch (error) {
        logger.warn?.('[batch-factory-automation] recovery batch list failed', { owner: username, error: failureMessage(error, 'list failed') });
        return;
      }
      for (const batch of Array.isArray(batches) ? batches : []) {
        await reconcileOwnerBatchSources(username, isOwner, batch);
        await recoverOwnerBatch(username, isOwner, batch);
      }
    });
  }

  function scheduleRecovery() {
    if (!recoveryEnabled) return;
    if (typeof adapter.listOwners !== 'function'
      || typeof adapter.listBatches !== 'function'
      || typeof adapter.startRecovery !== 'function') return;
    const intervalMs = clampInteger(recoveryMs, RECOVERY_MIN_MS, 3_600_000, RECOVERY_DEFAULT_MS);
    recoveryTimer = setInterval(() => {
      recoveryChain = recoveryChain
        .then(() => runRecovery())
        .catch(error => logger.error?.('[batch-factory-automation] recovery sweep failed', error));
    }, intervalMs);
    recoveryTimer.unref?.();
    // 服务重启/新功能首发后尽快巡查一次，让已卡住的批量在几秒内被接管。
    setImmediate(() => {
      recoveryChain = recoveryChain
        .then(() => runRecovery())
        .catch(error => logger.error?.('[batch-factory-automation] initial recovery failed', error));
    });
  }

  function updateCounts(job) {
    const values = Object.values(job.books || {});
    const counts = { total: values.length, ready: 0, running: 0, pending: 0, failed: 0, blocked: 0 };
    for (const book of values) {
      if (book.status === 'ready') counts.ready += 1;
      else if (book.status === 'failed') counts.failed += 1;
      else if (book.status === 'blocked') counts.blocked += 1;
      else if (['running', 'waiting'].includes(book.status)) counts.running += 1;
      else counts.pending += 1;
    }
    job.counts = counts;
  }

  function setBook(job, book, patch) {
    const existing = object(job.books?.[book.id]);
    job.books = object(job.books);
    job.books[book.id] = {
      bookId: book.id,
      title: book.title || book.bookId || book.id,
      status: existing.status || 'pending',
      stage: existing.stage || 'pending',
      message: existing.message || '等待自动生产',
      error: existing.error || '',
      retryCount: Number(existing.retryCount || 0),
      retryAt: existing.retryAt || '',
      retryLedger: object(existing.retryLedger),
      retryKey: existing.retryKey || '',
      attempts: existing.attempts || 0,
      updatedAt: iso(now),
      ...existing,
      ...patch,
      bookId: book.id,
      title: book.title || book.bookId || book.id,
      updatedAt: iso(now)
    };
    updateCounts(job);
    job.updatedAt = iso(now);
  }

  function failureMessage(error, fallback) {
    return text(error?.message) || fallback;
  }

  function deferOrFailBook(job, book, stage, label, error) {
    const detail = failureMessage(error, `${label}失败`);
    const current = object(job.books?.[book.id]);
    const retryKey = stageRetryKey(book, stage);
    const ledger = object(current.retryLedger);
    const priorStageAttempts = Number(object(ledger[retryKey]).attempts || 0);
    // 有些阶段（例如供应商已经返回 failed 的 VIDEO、合成回读）不是由
    // executeStage 发起的；第一次看到这种失败也必须计入同一阶段的次数。
    const stageAttempts = Math.max(1, priorStageAttempts);
    const retryLedger = priorStageAttempts > 0
      ? ledger
      : { ...ledger, [retryKey]: { attempts: stageAttempts, lastAttemptAt: iso(now) } };
    const terminal = !retryableAutomationError(error) || stageAttempts >= AUTOMATION_MAX_STAGE_ATTEMPTS;
    if (terminal) {
      const exhausted = stageAttempts >= AUTOMATION_MAX_STAGE_ATTEMPTS && retryableAutomationError(error);
      setBook(job, book, {
        status: 'failed',
        stage,
        message: exhausted ? `${label}连续失败 ${AUTOMATION_MAX_STAGE_ATTEMPTS} 次，已停止并让位` : `${label}失败，已停止并让位`,
        error: detail,
        retryRequested: false,
        retryAt: '',
        retryCount: retryableAutomationError(error) ? stageAttempts : Number(current.retryCount || 0),
        retryLedger,
        retryKey
      });
      return;
    }
    const delay = AUTOMATION_RETRY_DELAYS_MS[Math.max(0, stageAttempts - 1)];
    const retryAt = iso(now() + delay);
    setBook(job, book, {
      status: 'waiting',
      stage,
      message: `${label}暂时失败，将自动重试`,
      error: detail,
      retryCount: stageAttempts,
      retryAt,
      retryRequested: false,
      retryLedger,
      retryKey
    });
  }

  function beginTrackedStageAttempt(job, book, stage, label) {
    const current = object(job.books?.[book.id]);
    const retryKey = stageRetryKey(book, stage);
    const ledger = object(current.retryLedger);
    const stageAttempts = Number(object(ledger[retryKey]).attempts || 0);
    if (stageAttempts >= AUTOMATION_MAX_STAGE_ATTEMPTS) {
      setBook(job, book, {
        status: 'failed',
        stage,
        message: `${label}连续失败 ${AUTOMATION_MAX_STAGE_ATTEMPTS} 次，已停止并让位`,
        retryRequested: false,
        retryAt: '',
        retryCount: stageAttempts,
        retryKey
      });
      return false;
    }
    setBook(job, book, {
      status: 'running',
      stage,
      message: label,
      error: '',
      retryAt: '',
      attempts: Number(current.attempts || 0) + 1,
      retryLedger: { ...ledger, [retryKey]: { attempts: stageAttempts + 1, lastAttemptAt: iso(now) } },
      retryKey
    });
    return true;
  }

  function bookCanRun(job, book, timestamp) {
    const state = object(job.books?.[book.id]);
    if (BOOK_TERMINAL_STATES.has(state.status)) return false;
    const retryAt = new Date(state.retryAt || '').getTime();
    return !(Number.isFinite(retryAt) && retryAt > timestamp);
  }

  function bookPriority(job, book) {
    return object(job.books?.[book.id]).status === 'waiting' ? 1 : 0;
  }

  async function reconcileGiantMaterialSource(job, batch, book) {
    if (typeof adapter.reconcileGiantMaterialSource !== 'function') return false;
    const metadata = object(book?.sourceMetadata);
    if (text(metadata.sourceMode) !== 'giant_material' || !text(metadata.executorJobId)) return false;
    try {
      const result = object(await adapter.reconcileGiantMaterialSource({
        owner: job.owner,
        isOwner: job.isOwner,
        batch,
        book,
        job
      }));
      const state = text(result.state).toLowerCase();
      if (state === 'succeeded') {
        setBook(job, book, {
          status: 'pending',
          stage: 'source',
          message: `OCR 正文已回填${Number(result.characters || 0) > 0 ? `（${Number(result.characters)} 字）` : ''}，正在进入自动生产`,
          error: '',
          retryRequested: false,
          retryAt: ''
        });
        await persist();
        return true;
      }
      if (state === 'failed' || state === 'cancelled') {
        setBook(job, book, {
          status: 'failed',
          stage: 'source',
          message: '滚屏 OCR 读取失败，已停止并让位',
          error: text(result.error) || '执行器未返回可用正文',
          retryRequested: false,
          retryAt: '',
          // 失败时的 source 为空；保存正文后这一指纹会变化，runJob 才能
          // 识别“正文已到位”并从资产提取继续，而不是永久停在 OCR 失败。
          retryKey: stageRetryKey(book, 'source')
        });
        await persist();
        return true;
      }
      if (state === 'queued') {
        // OCR 任务刚派发便仍处于 queued，说明没有在线执行器接手；不能让
        // 它占据自动生产名额等待一个永远不会到来的客户端。
        setBook(job, book, {
          status: 'failed',
          stage: 'source',
          message: '滚屏 OCR 未被执行器领取，已停止本书并继续下一本',
          error: '执行器任务尚未领取；请启动本地巨量执行器后单独重试本书',
          retryRequested: false
        });
        return true;
      }
      if (state === 'leased' || state === 'running' || state === 'cleaning' || state === 'uploading') {
        const leaseExpiresAt = new Date(result.leaseExpiresAt || '').getTime();
        if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= new Date(now()).getTime()) {
          setBook(job, book, {
            status: 'failed',
            stage: 'source',
            message: '滚屏 OCR 执行器已离线，已停止本书并继续下一本',
            error: '执行器租约已过期；请启动本地巨量执行器后单独重试本书',
            retryRequested: false
          });
          return true;
        }
      }
      if (state === 'waiting' || state === 'leased' || state === 'running' || state === 'cleaning' || state === 'uploading') {
        const percent = Math.max(0, Math.min(100, Number(result.progress?.percent || 0)));
        setBook(job, book, {
          status: 'waiting',
          stage: 'source',
          message: percent > 0 ? `滚屏 OCR 读取中 ${percent}%` : '等待滚屏 OCR 回填正文',
          error: '',
          retryRequested: false
        });
        return true;
      }
    } catch (error) {
      // OCR 控制面短暂不可用时保留占位书和任务，下一轮再确认；不能把已在执行器
      // 里的任务误判成失败，更不能要求浏览器继续开着。
      setBook(job, book, {
        status: 'waiting',
        stage: 'source',
        message: '正在确认滚屏 OCR 结果',
        error: failureMessage(error, '读取状态暂不可用'),
        retryRequested: false
      });
      return true;
    }
    return false;
  }

  async function resolveDirectSource(job, batch, book) {
    if (typeof adapter.fetchDirectSource !== 'function') return { attempted: false, succeeded: false, error: '' };
    const previous = object(job.books?.[book.id]);
    const sourceKey = stageRetryKey(book, 'source');
    if (text(previous.directSourceRetryKey) === sourceKey) {
      return { attempted: true, succeeded: false, error: text(previous.directSourceError) || '书城没有返回可用正文' };
    }
    try {
      const result = object(await adapter.fetchDirectSource({
        owner: job.owner,
        isOwner: job.isOwner,
        batch,
        book,
        job
      }));
      if (text(result.state).toLowerCase() === 'succeeded') {
        setBook(job, book, {
          status: 'pending',
          stage: 'source',
          message: `正文已从书城获取${Number(result.characters || 0) > 0 ? `（${Number(result.characters)} 字）` : ''}，正在进入自动生产`,
          error: '',
          retryRequested: false,
          retryAt: '',
          directSourceRetryKey: '',
          directSourceError: ''
        });
        return { attempted: true, succeeded: true, error: '' };
      }
      const error = text(result.error) || '书城没有返回可用正文';
      setBook(job, book, { directSourceRetryKey: sourceKey, directSourceError: error });
      return { attempted: true, succeeded: false, error };
    } catch (error) {
      const detail = failureMessage(error, '书城正文直取失败');
      setBook(job, book, { directSourceRetryKey: sourceKey, directSourceError: detail });
      return { attempted: true, succeeded: false, error: detail };
    }
  }

  async function advanceBook(job, batch, book, productionStatus, mergeStatus) {
    if (job.state !== 'running') return;
    const settings = effectiveSettings(batch, book);
    const previous = object(job.books?.[book.id]);
    const sourceText = text(book?.workingFrontContent || book?.sourceText);
    if (!sourceText) {
      const directSource = await resolveDirectSource(job, batch, book);
      if (directSource.succeeded) return;
      if (await reconcileGiantMaterialSource(job, batch, book)) return;
      // 巨量素材占位书的正文由 Windows 执行器 OCR 异步回填；这里只能等，不能判死。
      // waiting 不在 BOOK_TERMINAL_STATES 里，下一轮 tick 正文到了会自然进入流水线。
      if (text(book?.sourceMetadata?.sourceMode) === 'giant_material') {
        if (!text(book?.sourceMetadata?.executorJobId)) {
          setBook(job, book, {
            status: 'failed',
            stage: 'source',
            message: directSource.attempted ? '书城正文直取失败，已停止本书并继续下一本' : '未启动本地巨量执行器，已停止本书并继续下一本',
            error: directSource.attempted ? directSource.error : '巨量素材尚未创建执行器任务，请启动执行器后重新派发读取任务',
            retryRequested: false
          });
          return;
        }
        setBook(job, book, { status: 'waiting', stage: 'source', message: '等待正文读取（巨量素材）', error: '', retryRequested: false });
      } else if (directSource.attempted) {
        setBook(job, book, { status: 'failed', stage: 'source', message: '书城正文直取失败，已停止本书并继续下一本', error: directSource.error, retryRequested: false });
      } else {
        setBook(job, book, { status: 'blocked', stage: 'source', message: '等待真实小说正文', error: '当前小说没有可用于生产的正文', retryRequested: false });
      }
      return;
    }

    let summary = null;
    try {
      summary = await adapter.getStageSummary(job.owner, job.isOwner, job.batchId, book.id);
    } catch (error) {
      setBook(job, book, { status: 'failed', stage: 'status', message: '阶段状态读取失败', error: failureMessage(error, '阶段状态读取失败') });
      return;
    }

    const executeStage = async (stage, label, mode = 'missing', videoId = '') => {
      const current = object(job.books?.[book.id]);
      const retryKey = stageRetryKey(book, stage);
      const ledger = object(current.retryLedger);
      const stageAttempts = Number(object(ledger[retryKey]).attempts || 0);
      if (stageAttempts >= AUTOMATION_MAX_STAGE_ATTEMPTS) {
        setBook(job, book, {
          status: 'failed',
          stage,
          message: `${label}连续失败 ${AUTOMATION_MAX_STAGE_ATTEMPTS} 次，已停止并让位`,
        retryRequested: false,
        retryAt: '',
        retryCount: stageAttempts,
        retryKey
        });
        await persist();
        return;
      }
      setBook(job, book, {
        status: 'running',
        stage,
        message: label,
        error: '',
        attempts: Number(current.attempts || 0) + 1,
        retryLedger: { ...ledger, [retryKey]: { attempts: stageAttempts + 1, lastAttemptAt: iso(now) } },
        retryKey
      });
      await persist();
      try {
        await adapter.runStage({ owner: job.owner, isOwner: job.isOwner, batch, book, settings, job, stage, mode, videoId, requestId: requestId(`bf-auto-${stage}`) });
        setBook(job, book, { status: stage === 'video' ? 'waiting' : 'pending', stage, message: stage === 'video' ? '视频任务已提交，等待供应商回读' : `${label}完成，等待下一阶段`, error: '', retryRequested: false, retryAt: '' });
      } catch (error) {
        deferOrFailBook(job, book, stage, label, error);
      }
      await persist();
    };

    if (previous.retryRequested === true && previous.stage !== 'merge' && summary?.lastFailed && text(summary.lastFailed.stage) === text(previous.stage) && typeof adapter.retryStage === 'function') {
      const failedStage = text(summary.lastFailed.stage);
      setBook(job, book, { status: 'running', stage: failedStage, message: `正在重试失败阶段：${failedStage}`, error: '', attempts: Number(previous.attempts || 0) + 1 });
      await persist();
      try {
        await adapter.retryStage({ owner: job.owner, isOwner: job.isOwner, batch, book, settings, job, lastFailed: summary.lastFailed, requestId: requestId('bf-auto-retry') });
        setBook(job, book, { status: failedStage === 'video' ? 'waiting' : 'pending', stage: failedStage, message: failedStage === 'video' ? '失败 VIDEO 已重新提交，等待供应商回读' : '失败阶段已重跑，等待下一阶段', error: '', retryRequested: false });
      } catch (error) {
        setBook(job, book, { status: 'failed', stage: failedStage, message: '重试失败阶段失败', error: failureMessage(error, '重试失败阶段失败'), retryRequested: false });
      }
      await persist();
      return;
    }

    if (!successfulStage(summary, 'assets') && !assetsPresent(book)) {
      await executeStage('assets', '正在提取人物、场景和道具');
      return;
    }

    if (settings.audioPlanningEnabled === true && settings.fixedSingleVideo !== true && Number(settings.audioDurationSeconds || 0) <= 0) {
      if (typeof adapter.prepareAudioPlanning !== 'function') {
        setBook(job, book, { status: 'failed', stage: 'audio_planning', message: '生成配音并读取真实时长失败', error: '自动化配音时长适配器未启用', retryRequested: false });
        return;
      }
      setBook(job, book, { status: 'running', stage: 'audio_planning', message: '正在生成配音并读取真实时长', error: '' });
      await persist();
      try {
        await adapter.prepareAudioPlanning({ owner: job.owner, isOwner: job.isOwner, batch, book, settings, job });
        setBook(job, book, { status: 'pending', stage: 'audio_planning', message: '真实配音时长已保存，等待生成分镜', error: '', retryRequested: false });
      } catch (error) {
        setBook(job, book, { status: 'failed', stage: 'audio_planning', message: '生成配音并读取真实时长失败', error: failureMessage(error, '配音时长读取失败'), retryRequested: false });
      }
      await persist();
      return;
    }

    if (!book?.directorRevision || !Array.isArray(book?.videos) || !book.videos.length) {
      await executeStage('director', '正在生成分镜卡与视频提示词', book?.directorRevision ? 'force' : 'missing');
      return;
    }

    if (typeof adapter.compileDirector === 'function' && text(previous.compiledDirectorRevision) !== text(book.directorRevision?.id)) {
      setBook(job, book, { status: 'running', stage: 'compile', message: '正在冻结最终 VIDEO Prompt', error: '' });
      await persist();
      try {
        await adapter.compileDirector({ owner: job.owner, isOwner: job.isOwner, batch, book, settings, job });
        setBook(job, book, { status: 'pending', stage: 'compile', message: '最终 VIDEO Prompt 已冻结', error: '', compiledDirectorRevision: text(book.directorRevision?.id) });
      } catch (error) {
        setBook(job, book, { status: 'failed', stage: 'compile', message: '最终 VIDEO Prompt 编译失败', error: failureMessage(error, '最终 VIDEO Prompt 编译失败'), retryRequested: false });
      }
      await persist();
      return;
    }

    const openingVariantsReady = requiredOpeningVariantsReady(book?.videos?.[0], settings);
    if (
      settings.openingEnabled === true
      && Array.isArray(book?.videos) && book.videos.length >= 2
      && !openingVariantsReady
    ) {
      await executeStage('opening', '正在生成换开头变体提示词');
      return;
    }

    if (job.runMode === 'storyboard_only') {
      setBook(job, book, { status: 'ready', stage: 'ready_for_video', message: '最终分镜提示词已就绪，等待人工生成视频', error: '', retryRequested: false, retryKey: '', retryAt: '' });
      return;
    }

    const visualConfig = object(object(settings.aiPromptConfig).visual);
    if (visualConfig.enabled === true && !successfulStage(summary, 'visual') && !visualReady(book, settings)) {
      await executeStage('visual', '正在生成分镜画面提示词');
      return;
    }

    const videos = targetVideoState(book, settings, productionStatus);
    if (!videos.videos.length) {
      setBook(job, book, { status: 'failed', stage: 'video', message: '没有可生产的分镜', error: '导演阶段没有生成 VIDEO 分镜' });
      return;
    }
    if (videos.active.length) {
      setBook(job, book, { status: 'waiting', stage: 'video', message: `视频生成中：${videos.succeeded.length}/${videos.videos.length}`, error: '', retryRequested: false });
      return;
    }
    if (videos.failed.length) {
      if (previous.retryRequested === true || (previous.status === 'waiting' && Number(previous.retryCount || 0) > 0)) {
        const target = videos.failed[0];
        await executeStage('video', `正在重试失败 VIDEO：${target.video?.label || target.video?.id}`, 'force', text(target.video?.id));
        return;
      }
      const detail = videos.failed.map(item => `${item.video?.label || item.video?.id}：${text(item.task?.errorMessage) || text(item.task?.status)}`).join('；');
      deferOrFailBook(job, book, 'video', '视频生成', new Error(detail || '视频供应商任务失败'));
      return;
    }
    if (!videos.ready) {
      const recentlySubmitted = previous.stage === 'video' && previous.status === 'waiting' && now() - new Date(previous.updatedAt || 0).getTime() < 15000;
      if (recentlySubmitted) {
        setBook(job, book, { status: 'waiting', stage: 'video', message: '视频任务已提交，等待状态写入', error: '' });
        return;
      }
      await executeStage('video', '正在提交缺失的 VIDEO 任务');
      return;
    }

    const uploadType = text(settings?.publishSettings?.uploadVideoType || 'merged');
    if (uploadType === 'individual') {
      setBook(job, book, { status: 'ready', stage: 'ready_for_upload', message: '独立 VIDEO 已就绪，等待人工上传', error: '', retryRequested: false, retryKey: '', retryAt: '' });
      return;
    }

    const merged = mergeState(mergeStatus, book.id);
    if (merged.succeeded && job.runMode === 'full_submit') {
      if (text(book?.sourceMetadata?.websiteSubmitStatus) === 'uploaded') {
        setBook(job, book, { status: 'ready', stage: 'uploaded', message: '视频管理系统已确认视频上传', error: '', retryRequested: false, retryKey: '', retryAt: '' });
        return;
      }
      if (previous.stage === 'upload' && previous.status === 'waiting' && !previous.retryAt) {
        setBook(job, book, { status: 'waiting', stage: 'upload', message: '视频管理系统已接收，等待回读确认', error: '', retryRequested: false });
        return;
      }
      if (typeof adapter.publishBook !== 'function') {
        setBook(job, book, { status: 'blocked', stage: 'upload', message: '视频管理系统自动上传未启用', error: '当前服务没有可用的视频管理系统上传适配器', retryRequested: false });
        return;
      }
      if (!beginTrackedStageAttempt(job, book, 'upload', '正在上传视频管理系统')) {
        await persist();
        return;
      }
      await persist();
      try {
        const uploaded = await adapter.publishBook({ owner: job.owner, isOwner: job.isOwner, batchId: job.batchId, bookId: book.id, batch, book, settings, job });
        if (text(uploaded?.status) === 'confirmed') {
          setBook(job, book, { status: 'ready', stage: 'uploaded', message: '视频管理系统已确认视频上传', error: '', retryRequested: false, retryAt: '', retryKey: '' });
        } else {
          setBook(job, book, { status: 'waiting', stage: 'upload', message: '视频管理系统已接收，等待回读确认', error: '', retryRequested: false });
        }
      } catch (error) {
        deferOrFailBook(job, book, 'upload', '视频管理系统上传', error);
      }
      await persist();
      return;
    }

    if (merged.succeeded) {
      setBook(job, book, { status: 'ready', stage: 'ready_for_upload', message: '最终合成视频已就绪，等待人工上传', error: '', retryRequested: false, retryKey: '', retryAt: '' });
      return;
    }
    if (merged.active) {
      setBook(job, book, { status: 'waiting', stage: 'merge', message: `合成处理中：${merged.allSucceeded.length}/${merged.latest.length}`, error: '', retryRequested: false });
      return;
    }
    if (mergeStatus?.unavailable === true) {
      setBook(job, book, { status: 'blocked', stage: 'merge', message: '合并服务未启用', error: text(mergeStatus.reason) || '当前环境没有可用的合并服务', retryRequested: false });
      return;
    }
    if (merged.failed && previous.retryRequested !== true && !(previous.status === 'waiting' && Number(previous.retryCount || 0) > 0)) {
      deferOrFailBook(job, book, 'merge', '最终合成', new Error(text(merged.failed.errorMessage) || '最终合成任务失败'));
      return;
    }

    const mergeLabel = previous.retryRequested === true ? '正在重新提交最终合成任务' : '正在提交最终合成任务';
    if (!beginTrackedStageAttempt(job, book, 'merge', mergeLabel)) {
      await persist();
      return;
    }
    await persist();
    try {
      const followAudio = settings.audioMergeEnabled === true && Number(settings.audioDurationSeconds || 0) > 0;
      await adapter.submitBookMerge({
        owner: job.owner,
        isOwner: job.isOwner,
        batchId: job.batchId,
        bookId: book.id,
        payload: {
          requestId: requestId('bf-auto-merge'),
          timingMode: followAudio ? 'audio' : 'speed',
          speed: followAudio ? 0 : 1,
          audioDurationSeconds: followAudio ? Number(settings.audioDurationSeconds || 0) : 0
        }
      });
      setBook(job, book, { status: 'waiting', stage: 'merge', message: '合成任务已提交，等待完成', error: '', retryRequested: false });
    } catch (error) {
      deferOrFailBook(job, book, 'merge', '提交合成任务', error);
    }
    await persist();
  }

  async function runJob(job) {
    const key = jobKey(job.owner, job.batchId);
    if (locks.has(key) || job.state !== 'running') return;
    locks.add(key);
    try {
      const batch = await adapter.loadBatch(job.owner, job.isOwner, job.batchId);
      if (!batch) throw new Error('批量作品不存在');
      const books = Array.isArray(batch.books) ? batch.books : [];
      for (const book of books) {
		if (!job.removedBookIDs?.[book.id] && !job.books?.[book.id]) setBook(job, book, { status: 'pending', stage: 'pending', message: '等待自动生产', error: '' });
		const state = object(job.books?.[book.id]);
        const sourceArrivedAfterFailure = state.status === 'failed'
          && state.stage === 'source'
          && text(book?.workingFrontContent || book?.sourceText)
          && (!text(state.retryKey) || state.retryKey !== stageRetryKey(book, 'source'));
        if (BOOK_TERMINAL_STATES.has(state.status) && text(state.stage) && ((text(state.retryKey) && state.retryKey !== stageRetryKey(book, state.stage)) || sourceArrivedAfterFailure)) {
		  // 用户保存了新正文或单书配置后，才允许该阶段自然获得新的三次额度；
		  // 单纯重新点“开始”不会触发这条路径。
		  setBook(job, book, { status: 'pending', stage: state.stage, message: '检测到新的书籍版本，等待重新执行该阶段', error: '', retryCount: 0, retryAt: '', retryRequested: false, retryKey: '' });
		}
      }
      for (const bookId of Object.keys(job.books || {})) {
        if (!books.some(book => text(book?.id) === bookId)) delete job.books[bookId];
      }

      // OCR 是外部执行器任务，不属于 1/2/4 个生产工位。每一轮都先巡查所有
      // 尚无正文的巨量书：这样排在队尾的“未领取/租约过期”任务会立刻失败，
      // 而不会等到前面的书全部跑完才释放用户看到的队列。
      const preflightReconciledBookIDs = new Set();
      // 直取正文会调用外部 121 和写入作品数据，必须服从用户选定的生产工位数。
      // 不能在预检阶段绕过并发限制，一次性把整个批次打到上游。
      await mapWithConcurrency(books, automationConcurrency(job.concurrency, activeBookLimit), async book => {
        if (job.removedBookIDs?.[book.id] || BOOK_TERMINAL_STATES.has(object(job.books?.[book.id]).status)) return;
        if (text(book?.sourceMetadata?.sourceMode) !== 'giant_material') return;
        if (text(book?.workingFrontContent || book?.sourceText)) return;
        const directSource = await resolveDirectSource(job, batch, book);
        if (directSource.succeeded) {
          preflightReconciledBookIDs.add(book.id);
          return;
        }
        if (text(book?.sourceMetadata?.executorJobId)) {
          if (await reconcileGiantMaterialSource(job, batch, book)) preflightReconciledBookIDs.add(book.id);
          return;
        }
        setBook(job, book, {
          status: 'failed',
          stage: 'source',
          message: directSource.attempted ? '书城正文直取失败，已停止本书并继续下一本' : '未启动本地巨量执行器，已停止本书并继续下一本',
          error: directSource.attempted ? directSource.error : '巨量素材尚未创建执行器任务，请启动执行器后单独重试本书',
          retryRequested: false
        });
      });

      const [productionStatus, mergeStatus] = await Promise.all([
        adapter.getProductionStatus(job.owner, job.isOwner, job.batchId),
        adapter.getMergeStatus(job.owner, job.isOwner, job.batchId)
      ]);

      const taskKey = book => `${key}:${text(book?.id)}`;
      const candidates = books.filter(book => !job.removedBookIDs?.[book.id] && !preflightReconciledBookIDs.has(book.id) && !activeBookTasks.has(taskKey(book)) && bookCanRun(job, book, now())).sort((left, right) => bookPriority(job, left) - bookPriority(job, right));
      const admissionLimit = automationConcurrency(job.concurrency, activeBookLimit);
      // 规矩：并发工位只发给会发起新动作的书（pending/中断重跑），严格 2 本 2 本做；
      // waiting 的书是在等外部条件（OCR 回填、供应商回片、合成/上传回读），每轮只做轻量巡检、
      // 不占工位——条件一到立刻自然往下走，绝不能干坐着把后面的书堵死。
      const waitingBooks = candidates.filter(book => {
        const state = object(job.books?.[book.id]);
        // 纯回读（OCR、供应商、上传）不会提交新工作，不占工位；到期重试会重新
        // 调用供应商，必须与新书一起受 1/2/4 并发上限约束。
        return state.status === 'waiting' && !state.retryAt;
      });
      const occupiedSlots = [...activeBookTasks.entries()].filter(([activeKey, active]) => activeKey.startsWith(`${key}:`) && active?.occupiesSlot === true).length;
      const freeSlots = Math.max(0, admissionLimit - occupiedSlots);
      const admittedBooks = candidates.filter(book => {
        const state = object(job.books?.[book.id]);
        return state.status !== 'waiting' || Boolean(state.retryAt);
      }).slice(0, freeSlots);
      for (const book of [...admittedBooks, ...waitingBooks]) {
        const activeKey = taskKey(book);
        const occupiesSlot = admittedBooks.includes(book);
        const promise = advanceBook(job, batch, book, productionStatus, mergeStatus)
          .catch(async error => {
            const state = object(job.books?.[book.id]);
            deferOrFailBook(job, book, text(state.stage) || 'automation', '自动生产', error);
            logger.error?.('[batch-factory-automation] book task failed', { batchId: job.batchId, bookId: book.id, error });
            await persist();
          })
          .finally(async () => {
            activeBookTasks.delete(activeKey);
            updateCounts(job);
            job.updatedAt = iso(now);
            await persist();
          });
        activeBookTasks.set(activeKey, { promise, occupiesSlot });
      }

      updateCounts(job);
      // Reaching the end of one scheduler pass proves the job-level bridge is
      // healthy again. Per-book retry ledgers remain untouched.
      job.jobRetryCount = 0;
      job.jobRetryAt = '';
      if (job.counts.total > 0 && job.counts.ready === job.counts.total) {
        job.state = 'completed';
        job.completedAt = iso(now);
        job.lastError = '';
      } else if (job.counts.running === 0 && job.counts.pending === 0 && (job.counts.failed > 0 || job.counts.blocked > 0)) {
        // A final sweep happens after at least one peer reached the requested
        // stop point.  A batch where nothing ever became runnable retains the
        // existing actionable state instead of repeatedly reissuing the same
        // missing-source/configuration request.
        if (job.counts.ready > 0 && queueFinalFailureSweep(job, now)) {
          job.state = 'running';
          job.completedAt = '';
          job.lastError = `其余小说已完成，正在最终补跑 ${job.counts.failed + job.counts.blocked} 本失败或阻塞小说`;
        } else {
          job.state = job.counts.ready > 0 ? 'paused' : 'needs_attention';
          job.completedAt = iso(now);
          job.lastError = job.counts.ready > 0
            ? `${job.counts.failed} 本失败，${job.counts.blocked} 本阻塞；最终自动补跑仍未成功，任务已暂停`
            : `${job.counts.failed} 本失败，${job.counts.blocked} 本阻塞；没有可完成的同批书籍，等待处理`;
        }
      }
      job.updatedAt = iso(now);
      await persist();
    } catch (error) {
      const detail = failureMessage(error, '自动化运行失败');
      if (retryableAutomationError(error)) {
        const attempts = Math.min(Number(job.jobRetryCount || 0) + 1, AUTOMATION_MAX_STAGE_ATTEMPTS);
        const delayIndex = Math.min(attempts - 1, AUTOMATION_RETRY_DELAYS_MS.length - 1);
        job.jobRetryCount = attempts;
        job.state = 'running';
        job.jobRetryAt = iso(now() + AUTOMATION_RETRY_DELAYS_MS[delayIndex]);
        job.lastError = attempts < AUTOMATION_MAX_STAGE_ATTEMPTS
          ? `${detail} · 总调度自动重试 ${attempts}/${AUTOMATION_MAX_STAGE_ATTEMPTS}`
          : `${detail} · 公共服务暂未恢复，5 分钟后继续；单书队列未停止`;
      } else {
        job.state = 'needs_attention';
        job.jobRetryAt = '';
        job.lastError = `${detail} · 总调度不可自动恢复，已停止`;
      }
      job.updatedAt = iso(now);
      await persist();
      logger.error?.('[batch-factory-automation] job failed', { batchId: job.batchId, error });
    } finally {
      locks.delete(key);
      stopTimerIfIdle();
    }
  }

  async function resumeAfterLiveSourceArrival(job) {
    if (job.state !== 'needs_attention') return false;
    let batch;
    try {
      batch = await adapter.loadBatch(job.owner, job.isOwner, job.batchId);
    } catch (error) {
      logger.warn?.('[batch-factory-automation] live source recovery batch load failed', {
        batchId: job.batchId,
        owner: job.owner,
        error: failureMessage(error, 'load failed')
      });
      return false;
    }
    if (!hasRecoveredSourceArrival(job, batch)) return false;
    job.state = 'running';
    job.completedAt = '';
    job.lastError = '';
    job.updatedAt = iso(now);
    await persist();
    return true;
  }

  async function tick() {
    const timestamp = now();
    for (const job of jobs.values()) {
      if (job.state === 'scheduled') {
        const schedule = new Date(job.scheduledAt || 0).getTime();
        if (Number.isFinite(schedule) && schedule > timestamp) continue;
        job.state = 'running';
        job.startedAt = job.startedAt || iso(now);
        job.updatedAt = iso(now);
        await persist();
      }
      if (job.state === 'needs_attention' && await resumeAfterLiveSourceArrival(job)) void runJob(job);
      if (job.state === 'running') {
        const retryAt = new Date(job.jobRetryAt || '').getTime();
        if (Number.isFinite(retryAt) && retryAt > timestamp) continue;
        void runJob(job);
      }
    }
    stopTimerIfIdle();
  }

  async function start({ owner, isOwner = false, batchId, scheduledAt = '', autoPublish = false, runMode = '', preset = null, concurrency = 2 } = {}) {
    if (!text(owner) || !text(batchId)) throw new Error('owner and batchId are required');
    await adapter.loadBatch(owner, isOwner, batchId);
    const when = text(scheduledAt);
    const scheduleTime = when ? new Date(when).getTime() : NaN;
    if (when && !Number.isFinite(scheduleTime)) throw new Error('定时执行时间无效');
    const timestamp = iso(now);
    const normalizedRunMode = automationRunMode(runMode, autoPublish);
    const normalizedConcurrency = automationConcurrency(concurrency, activeBookLimit);
    const existing = object(jobs.get(jobKey(owner, batchId)));
    const job = {
      id: text(existing.id) || requestId('bf-automation'),
      owner,
      isOwner: isOwner === true,
      batchId,
      state: Number.isFinite(scheduleTime) && scheduleTime > now() ? 'scheduled' : 'running',
      stopAt: normalizedRunMode === 'storyboard_only' ? 'ready_for_video' : normalizedRunMode === 'full_submit' ? 'uploaded' : 'ready_for_upload',
      autoPublish: normalizedRunMode === 'full_submit',
      runMode: normalizedRunMode,
      concurrency: normalizedConcurrency,
      preset: clone(object(preset)),
      // Carry only existing legacy evidence for later repair; execution never reads it.
      ...(Object.hasOwn(existing, 'configSnapshot') ? { configSnapshot: clone(existing.configSnapshot) } : {}),
      scheduledAt: when,
      createdAt: existing.createdAt || timestamp,
      startedAt: Number.isFinite(scheduleTime) && scheduleTime > now() ? '' : (existing.startedAt || timestamp),
      updatedAt: timestamp,
      completedAt: '',
      lastError: '',
      jobRetryCount: 0,
      jobRetryAt: '',
      counts: object(existing.counts),
      books: object(existing.books),
      removedBookIDs: object(existing.removedBookIDs),
      finalFailureSweepAttempted: false,
      finalFailureSweepAt: ''
    };
    requeueReadyBooksForAdvancedRunMode(job);
    jobs.set(jobKey(owner, batchId), job);
    await persist();
    ensureTimer();
    void tick();
    return publicJob(job);
  }

  async function pause({ owner, batchId } = {}) {
    const job = jobs.get(jobKey(owner, batchId));
    if (!job) return publicJob(null);
    if (ACTIVE_STATES.has(job.state)) {
      job.state = 'paused';
      job.updatedAt = iso(now);
      await persist();
    }
    stopTimerIfIdle();
    return publicJob(job);
  }

  async function resume({ owner, batchId } = {}) {
    const job = jobs.get(jobKey(owner, batchId));
    if (!job) throw new Error('当前批量没有可继续的自动化任务');
    if (['paused', 'needs_attention', 'completed'].includes(job.state)) {
      // “继续”只恢复被暂停的调度；不能把已经终止的书重新塞回队列。
      // 重新给额度必须走 retry，并由用户显式发起。
      job.state = 'running';
      job.completedAt = '';
      job.lastError = '';
      job.jobRetryCount = 0;
      job.jobRetryAt = '';
      job.startedAt = job.startedAt || iso(now);
      job.updatedAt = iso(now);
      updateCounts(job);
      await persist();
      ensureTimer();
      void tick();
    }
    return publicJob(job);
  }

  async function retry({ owner, batchId, bookIds = [] } = {}) {
    const job = jobs.get(jobKey(owner, batchId));
    if (!job) throw new Error('当前批量没有自动化任务');
    const selected = new Set((Array.isArray(bookIds) ? bookIds : []).map(text).filter(Boolean));
    for (const value of Object.values(job.books || {})) {
      if (selected.size && !selected.has(value.bookId)) continue;
      if (value.status === 'failed' || value.status === 'blocked' || (value.status === 'waiting' && value.retryAt)) {
        value.status = 'pending';
        value.stage = 'pending';
        value.message = '等待重试';
        value.error = '';
        value.retryRequested = true;
        value.retryAt = '';
        value.retryCount = 0;
        // 用户显式重试的是“这本失败的书”。真实缺失阶段可能早于当前显示阶段
        // （例如 VIDEO 因换开头不完整而失败），所以要给这本书的阶段预算全部
        // 重新开放；已完成阶段仍由实时数据判定，不会因此重做。
        value.retryLedger = {};
        value.retryKey = '';
        // A user-requested retry must also reopen the direct bookstore read.
        // Otherwise an earlier transient 121/bridge failure is remembered
        // forever and this book skips the direct-source path on every retry.
        value.directSourceRetryKey = '';
        value.directSourceError = '';
        value.updatedAt = iso(now);
      }
    }
    job.state = 'running';
    job.completedAt = '';
    job.lastError = '';
    job.jobRetryCount = 0;
    job.jobRetryAt = '';
    job.updatedAt = iso(now);
    updateCounts(job);
    await persist();
    ensureTimer();
    void tick();
    return publicJob(job);
  }

  async function cancel({ owner, batchId } = {}) {
    const job = jobs.get(jobKey(owner, batchId));
    if (!job) return publicJob(null);
    job.state = 'cancelled';
    job.updatedAt = iso(now);
    job.completedAt = iso(now);
    job.lastError = '';
    await persist();
    stopTimerIfIdle();
    return publicJob(job);
  }

  async function removeBook({ owner, batchId, bookId } = {}) {
    const job = jobs.get(jobKey(owner, batchId));
	if (!job) return publicJob(job);
	job.removedBookIDs = object(job.removedBookIDs);
	job.removedBookIDs[bookId] = true;
    delete job.books[bookId];
    updateCounts(job);
    job.updatedAt = iso(now);
    if (!Object.keys(job.books).length) jobs.delete(jobKey(owner, batchId));
    await persist();
    stopTimerIfIdle();
    return publicJob(jobs.get(jobKey(owner, batchId)));
  }

  async function removeBatch({ owner, batchId } = {}) {
    if (!jobs.delete(jobKey(owner, batchId))) return publicJob(null);
    await persist();
    stopTimerIfIdle();
    return publicJob(null);
  }

  function status({ owner, batchId } = {}) {
    return publicJob(jobs.get(jobKey(owner, batchId)));
  }

  // Historical evidence is available only to deliberate maintenance. Never
  // feed this envelope to effectiveSettings or stage execution.
  function legacyConfigSnapshot({ owner, batchId } = {}) {
    const matching = [...jobs.values()].filter(job => job.owner === owner && job.batchId === batchId);
    const job = jobs.get(jobKey(owner, batchId));
    if (!text(owner) || !text(batchId) || matching.length !== 1 || matching[0] !== job) return null;
    const snapshot = job.configSnapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Object.keys(snapshot).length) return null;
    return clone({
      owner, batchId, configSnapshot: snapshot,
      appliedBookIds: Object.entries(job.books).filter(([bookId, state]) =>
        state?.bookId === bookId && state.executionSnapshotApplied === true
      ).map(([bookId]) => bookId)
    });
  }

  loadPersisted();
  if ([...jobs.values()].some(job => ACTIVE_STATES.has(job.state))) {
    ensureTimer();
    setImmediate(() => { void tick(); });
  }
  scheduleRecovery();

  return { start, pause, resume, retry, cancel, removeBook, removeBatch, status, legacyConfigSnapshot, tick, runRecovery, statePath };
}

module.exports = {
  createBatchFactoryAutomationController,
  effectiveSettings,
  targetVideoState,
  mergeState
};
