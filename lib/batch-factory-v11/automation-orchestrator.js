const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TERMINAL_STATES = new Set(['completed', 'needs_attention', 'cancelled']);
const ACTIVE_STATES = new Set(['scheduled', 'running']);
const BOOK_TERMINAL_STATES = new Set(['ready', 'failed', 'blocked']);
const AUTOMATION_RUN_MODES = new Set(['storyboard_only', 'video_no_submit', 'full_submit']);
const AUTOMATION_CONCURRENCIES = new Set([1, 2, 4]);
const AUTOMATION_RETRY_DELAYS_MS = [30_000, 120_000, 300_000];
const AUTOMATION_MAX_STAGE_ATTEMPTS = 3;

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

function retryableAutomationError(error) {
  const message = text(error?.message || error).toLowerCase();
  if (!message) return true;
  return !/(invalid api key|unauthorized|forbidden|invalid input|not configured|未配置|无效.*密钥|鉴权失败|权限不足)/.test(message);
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

function stageRetryKey(book, stage) {
  // 同一正文、同一阶段才共享自动重试次数。正文被重新写入时自然获得一轮新机会；
  // 不能让 assets 阶段的一次临时失败吞掉 director 阶段的重试额度。
  const source = text(book?.workingFrontContent || book?.sourceText);
  const sourceHash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  return `${text(stage) || 'unknown'}:${sourceHash}`;
}

function effectiveSettings(batch, book, job = null) {
  const batchPatch = object(job?.configSnapshot);
  const liveBatchPatch = object(batch?.settingsState?.patch);
  const bookPatch = object(book?.settingsState?.patch);
  return {
    ...(Object.keys(batchPatch).length ? batchPatch : liveBatchPatch),
    ...bookPatch,
    publishSettings: {
      ...object((Object.keys(batchPatch).length ? batchPatch : liveBatchPatch).publishSettings),
      ...object(bookPatch.publishSettings)
    }
  };
}

function automationRunMode(value, autoPublish = false) {
  const candidate = text(value);
  if (AUTOMATION_RUN_MODES.has(candidate)) return candidate;
  return autoPublish === true ? 'full_submit' : 'video_no_submit';
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

function openingVariantTaskIndexes(video, settings, isFirstVideo) {
  if (settings?.openingEnabled !== true || !isFirstVideo) return null;
  const variants = object(video?.settingsState?.patch).openingVariants;
  if (!Array.isArray(variants)) return null;
  const indexes = [...new Set(variants
    .filter(variant => text(variant?.status) === 'success')
    .map(variant => Number(variant?.index || 0))
    .filter(index => Number.isInteger(index) && index > 0))];
  if (!indexes.length) return null;
  // 需求任务集合 = 变体 0（原始分镜）+ 每个成功变体的 index。
  return [0, ...indexes];
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
    retryAt: value.retryAt || ''
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

function createBatchFactoryAutomationController({ adapter, statePath = defaultStatePath(), pollMs = 2500, now = Date.now, logger = console, dispatcherConcurrency = 2 } = {}) {
  if (!adapter || typeof adapter.loadBatch !== 'function' || typeof adapter.runStage !== 'function') {
    throw new Error('Batch Factory automation requires loadBatch and runStage adapters');
  }
  const jobs = new Map();
  const locks = new Set();
  const activeBookLimit = clampInteger(dispatcherConcurrency, 1, 4, 2);
  let timer = null;
  let persistChain = Promise.resolve();

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
      for (const [key, value] of Object.entries(object(parsed?.jobs))) {
        const job = object(value);
        if (!text(job.owner) || !text(job.batchId)) continue;
        job.books = object(job.books);
        job.concurrency = automationConcurrency(job.concurrency, activeBookLimit);
        if (job.state === 'running' || job.state === 'scheduled') {
          job.state = job.scheduledAt && new Date(job.scheduledAt).getTime() > now() ? 'scheduled' : 'running';
        }
        jobs.set(key, job);
      }
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
        retryLedger
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
      retryLedger
    });
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
          retryAt: ''
        });
        await persist();
        return true;
      }
      if (state === 'waiting' || state === 'running' || state === 'queued') {
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

  async function advanceBook(job, batch, book, productionStatus, mergeStatus) {
    if (job.state !== 'running') return;
    const settings = effectiveSettings(batch, book, job);
    const previous = object(job.books?.[book.id]);
    const sourceText = text(book?.workingFrontContent || book?.sourceText);
    if (!sourceText) {
      if (await reconcileGiantMaterialSource(job, batch, book)) return;
      // 巨量素材占位书的正文由 Windows 执行器 OCR 异步回填；这里只能等，不能判死。
      // waiting 不在 BOOK_TERMINAL_STATES 里，下一轮 tick 正文到了会自然进入流水线。
      if (text(book?.sourceMetadata?.sourceMode) === 'giant_material') {
        setBook(job, book, { status: 'waiting', stage: 'source', message: '等待正文读取（巨量素材）', error: '', retryRequested: false });
      } else {
        setBook(job, book, { status: 'blocked', stage: 'source', message: '等待真实小说正文', error: '当前小说没有可用于生产的正文', retryRequested: false });
      }
      return;
    }

    if (Object.keys(object(job.configSnapshot)).length && previous.executionSnapshotApplied !== true && typeof adapter.applyExecutionSnapshot === 'function') {
      setBook(job, book, { status: 'running', stage: 'configuration', message: '正在冻结本书自动化配置', error: '' });
      await persist();
      try {
        await adapter.applyExecutionSnapshot({ owner: job.owner, isOwner: job.isOwner, batch, book, configSnapshot: job.configSnapshot, job });
        setBook(job, book, { status: 'pending', stage: 'configuration', message: '自动化配置已冻结', error: '', executionSnapshotApplied: true });
      } catch (error) {
        setBook(job, book, { status: 'failed', stage: 'configuration', message: '自动化配置冻结失败', error: failureMessage(error, '自动化配置冻结失败'), retryRequested: false });
      }
      await persist();
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
          retryCount: stageAttempts
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
        retryLedger: { ...ledger, [retryKey]: { attempts: stageAttempts + 1, lastAttemptAt: iso(now) } }
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

    if (!book?.directorRevision && settings.audioPlanningEnabled === true && settings.fixedSingleVideo !== true && Number(settings.audioDurationSeconds || 0) <= 0) {
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

    const firstVideoPatch = object(book?.videos?.[0]?.settingsState?.patch);
    const openingVariantsReady = Array.isArray(firstVideoPatch.openingVariants)
      && firstVideoPatch.openingVariants.some(variant => text(variant?.status) === 'success' && text(variant?.prompt));
    // 换开头只覆盖当前导演分镜版本：重新生成导演分镜会重建 Video（变体丢失），
    // 旧 revision 的成功记录不能再抑制换开头阶段。
    const currentRevisionId = text(book?.directorRevision?.id);
    const openingDoneForRevision = (Array.isArray(summary?.runs) ? summary.runs : []).some(run =>
      text(run?.stage) === 'opening' && text(run?.status).toLowerCase() === 'succeeded' && text(run?.inputRevision) === currentRevisionId
    );
    if (
      settings.openingEnabled === true
      && Array.isArray(book?.videos) && book.videos.length >= 2
      && !openingVariantsReady
      && !openingDoneForRevision
    ) {
      await executeStage('opening', '正在生成换开头变体提示词');
      return;
    }

    if (job.runMode === 'storyboard_only') {
      setBook(job, book, { status: 'ready', stage: 'ready_for_video', message: '最终分镜提示词已就绪，等待人工生成视频', error: '', retryRequested: false });
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
      setBook(job, book, { status: 'ready', stage: 'ready_for_upload', message: '独立 VIDEO 已就绪，等待人工上传', error: '', retryRequested: false });
      return;
    }

    const merged = mergeState(mergeStatus, book.id);
    if (merged.succeeded && job.runMode === 'full_submit') {
      if (text(book?.sourceMetadata?.websiteSubmitStatus) === 'uploaded') {
        setBook(job, book, { status: 'ready', stage: 'uploaded', message: '视频管理系统已确认视频上传', error: '', retryRequested: false });
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
      setBook(job, book, { status: 'running', stage: 'upload', message: '正在上传视频管理系统', error: '' });
      await persist();
      try {
        const uploaded = await adapter.publishBook({ owner: job.owner, isOwner: job.isOwner, batchId: job.batchId, bookId: book.id, batch, book, settings, job });
        if (text(uploaded?.status) === 'confirmed') {
          setBook(job, book, { status: 'ready', stage: 'uploaded', message: '视频管理系统已确认视频上传', error: '', retryRequested: false, retryAt: '' });
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
      setBook(job, book, { status: 'ready', stage: 'ready_for_upload', message: '最终合成视频已就绪，等待人工上传', error: '', retryRequested: false });
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

    setBook(job, book, { status: 'running', stage: 'merge', message: previous.retryRequested === true ? '正在重新提交最终合成任务' : '正在提交最终合成任务', error: '' });
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
      }
      for (const bookId of Object.keys(job.books || {})) {
        if (!books.some(book => text(book?.id) === bookId)) delete job.books[bookId];
      }

      const [productionStatus, mergeStatus] = await Promise.all([
        adapter.getProductionStatus(job.owner, job.isOwner, job.batchId),
        adapter.getMergeStatus(job.owner, job.isOwner, job.batchId)
      ]);

      const candidates = books.filter(book => !job.removedBookIDs?.[book.id] && bookCanRun(job, book, now())).sort((left, right) => bookPriority(job, left) - bookPriority(job, right));
      const admissionLimit = automationConcurrency(job.concurrency, activeBookLimit);
      // 规矩：并发工位只发给会发起新动作的书（pending/中断重跑），严格 2 本 2 本做；
      // waiting 的书是在等外部条件（OCR 回填、供应商回片、合成/上传回读），每轮只做轻量巡检、
      // 不占工位——条件一到立刻自然往下走，绝不能干坐着把后面的书堵死。
      const waitingBooks = candidates.filter(book => object(job.books?.[book.id]).status === 'waiting');
      const freshBooks = candidates.filter(book => object(job.books?.[book.id]).status !== 'waiting').slice(0, admissionLimit);
      await Promise.all([...freshBooks, ...waitingBooks].map(book => advanceBook(job, batch, book, productionStatus, mergeStatus)));

      updateCounts(job);
      if (job.counts.total > 0 && job.counts.ready === job.counts.total) {
        job.state = 'completed';
        job.completedAt = iso(now);
        job.lastError = '';
      } else if (job.counts.running === 0 && job.counts.pending === 0 && (job.counts.failed > 0 || job.counts.blocked > 0)) {
        job.state = 'needs_attention';
        job.completedAt = iso(now);
        job.lastError = `${job.counts.failed} 本失败，${job.counts.blocked} 本阻塞`;
      }
      job.updatedAt = iso(now);
      await persist();
    } catch (error) {
      job.state = 'needs_attention';
      job.lastError = failureMessage(error, '自动化运行失败');
      job.updatedAt = iso(now);
      await persist();
      logger.error?.('[batch-factory-automation] job failed', { batchId: job.batchId, error });
    } finally {
      locks.delete(key);
      stopTimerIfIdle();
    }
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
      if (job.state === 'running') void runJob(job);
    }
    stopTimerIfIdle();
  }

  async function start({ owner, isOwner = false, batchId, scheduledAt = '', autoPublish = false, runMode = '', preset = null, configSnapshot = null, concurrency = 2 } = {}) {
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
      configSnapshot: clone(object(configSnapshot)),
      scheduledAt: when,
      createdAt: existing.createdAt || timestamp,
      startedAt: Number.isFinite(scheduleTime) && scheduleTime > now() ? '' : (existing.startedAt || timestamp),
      updatedAt: timestamp,
      completedAt: '',
      lastError: '',
      counts: object(existing.counts),
      books: object(existing.books),
      removedBookIDs: object(existing.removedBookIDs)
    };
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
        value.retryLedger = {};
        value.updatedAt = iso(now);
      }
    }
    job.state = 'running';
    job.completedAt = '';
    job.lastError = '';
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

  loadPersisted();
  if ([...jobs.values()].some(job => ACTIVE_STATES.has(job.state))) {
    ensureTimer();
    setImmediate(() => { void tick(); });
  }

  return { start, pause, resume, retry, cancel, removeBook, removeBatch, status, tick, statePath };
}

module.exports = {
  createBatchFactoryAutomationController,
  effectiveSettings,
  targetVideoState,
  mergeState
};
