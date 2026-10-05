const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBatchFactoryAutomationController } = require('../lib/batch-factory-v11/automation-orchestrator');

function wait(ms = 10) { return new Promise(resolve => setTimeout(resolve, ms)); }

function fixture() {
  const batch = {
    id: 'batch-1',
    settingsState: { patch: { publishSettings: { uploadVideoType: 'merged' } } },
    books: [{ id: 'book-1', bookId: '101', title: '测试小说', sourceText: '正文', settingsState: { patch: {} }, assetRecords: [], videos: [] }]
  };
  const summaries = new Map();
  const production = { batchId: batch.id, jobs: [] };
  const merge = { batchId: batch.id, jobs: [] };
  const summary = bookId => summaries.get(bookId) || { bookId, runs: [] };
  const succeed = (bookId, stage) => {
    const current = summary(bookId);
    summaries.set(bookId, { ...current, runs: [...current.runs, { stage, status: 'succeeded' }] });
  };
  return {
    batch,
    adapter: {
      async loadBatch() { return batch; },
      async getStageSummary(_owner, _isOwner, _batchId, bookId) { return summary(bookId); },
      async getProductionStatus() { return production; },
      async getMergeStatus() { return merge; },
      async runStage({ book, stage }) {
        if (stage === 'assets') { book.assetRecords = [{ id: 'a1', kind: 'character' }]; succeed(book.id, stage); }
        if (stage === 'director') { book.directorRevision = { id: 'd1' }; book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '' }]; succeed(book.id, stage); }
        if (stage === 'visual') { book.videos[0].visualPrompt = '画面提示词'; succeed(book.id, stage); }
        if (stage === 'video') {
          production.jobs.push({ id: 'p1', bookId: book.id, tasks: [{ id: 't1', videoId: 'video-1', status: 'succeeded', mediaUrl: '/media/video.mp4' }] });
          succeed(book.id, stage);
        }
      },
      async submitBookMerge({ bookId }) { merge.jobs.push({ id: 'm1', bookId, status: 'succeeded', outputUrl: '/media/merged.mp4' }); }
    }
  };
}

test('video-only automation advances a book to ready_for_upload without uploading', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { adapter } = fixture();
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 1, runMode: 'video_no_submit' });
  for (let i = 0; i < 10; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.state, 'completed');
  assert.equal(status.counts.ready, 1);
  assert.equal(status.books[0].stage, 'ready_for_upload');
  assert.match(status.books[0].message, /等待人工上传/);
});

test('automation defaults to full submission after merged video is ready', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { adapter } = fixture();
  let publishCalls = 0;
  adapter.publishBook = async () => {
    publishCalls += 1;
    return { status: 'confirmed', receipt: { remoteRecord: { found: true, headVideo: true } } };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 1 });
  for (let i = 0; i < 12; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.runMode, 'full_submit');
  assert.equal(status.books[0].stage, 'uploaded');
  assert.equal(publishCalls, 1);
});

test('storyboard-only automation stops after director compilation and never submits VIDEO', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  batch.settingsState.patch.textModelId = 'text-current';
  const stages = [];
  const models = [];
  adapter.runStage = async ({ book, stage, settings }) => {
    stages.push(stage);
    models.push(settings.textModelId);
    if (stage === 'assets') { book.assetRecords = [{ id: 'a1', kind: 'character' }]; }
    if (stage === 'director') { book.directorRevision = { id: 'd1' }; book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '最终 Prompt' }]; }
    if (stage === 'video') throw new Error('storyboard-only mode must not submit VIDEO');
  };
  let compileCalls = 0;
  let appliedSnapshot = null;
  adapter.applyExecutionSnapshot = async ({ configSnapshot }) => { appliedSnapshot = configSnapshot; };
  adapter.compileDirector = async () => { compileCalls += 1; };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });

  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 1, runMode: 'storyboard_only', preset: { id: 'preset-1', version: 3, name: '夜间短剧' }, configSnapshot: { textModelId: 'text-a' } });
  for (let i = 0; i < 9; i += 1) { await controller.tick(); await wait(); }

  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.state, 'completed');
  assert.equal(status.runMode, 'storyboard_only');
  assert.equal(status.preset.id, 'preset-1');
  assert.equal(status.preset.version, 3);
  assert.equal(appliedSnapshot, null);
  assert.deepEqual(models, ['text-current', 'text-current']);
  assert.deepEqual(batch.books[0].settingsState.patch, {});
  assert.deepEqual(stages, ['assets', 'director']);
  assert.equal(compileCalls, 1);
  assert.equal(status.books[0].stage, 'ready_for_video');
});

test('upgrading a completed storyboard job to full submission continues from ready_for_video', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-upgrade-mode-'));
  const { adapter } = fixture();
  let publishCalls = 0;
  adapter.publishBook = async () => {
    publishCalls += 1;
    return { status: 'confirmed', receipt: { remoteRecord: { found: true, headVideo: true } } };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', runMode: 'storyboard_only', concurrency: 1 });
  for (let i = 0; i < 9; i += 1) { await controller.tick(); await wait(); }
  assert.equal(controller.status({ owner: 'user', batchId: 'batch-1' }).books[0].stage, 'ready_for_video');

  await controller.start({ owner: 'user', batchId: 'batch-1', runMode: 'full_submit', concurrency: 1 });
  for (let i = 0; i < 12; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.state, 'completed');
  assert.equal(status.books[0].stage, 'uploaded');
  assert.equal(publishCalls, 1);
});

test('audio-planned automation measures and saves duration before running director', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-audio-'));
  const { batch, adapter } = fixture();
  batch.settingsState.patch.audioPlanningEnabled = true;
  const order = [];
  adapter.prepareAudioPlanning = async ({ book }) => {
    order.push('audio');
    book.settingsState.patch.audioDurationSeconds = 12.34;
  };
  const originalRunStage = adapter.runStage;
  adapter.runStage = async input => { order.push(input.stage); return originalRunStage(input); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'storyboard_only' });
  for (let i = 0; i < 7; i += 1) { await controller.tick(); await wait(); }
  assert.deepEqual(order.slice(0, 3), ['assets', 'audio', 'director']);
});

test('audio-planned automation measures duration when an existing director is reused', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-existing-director-audio-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  batch.settingsState.patch.audioPlanningEnabled = true;
  book.assetRecords = [{ id: 'a1', kind: 'character' }];
  book.directorRevision = { id: 'd-existing' };
  book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '最终 Prompt' }];
  let measurements = 0;
  adapter.prepareAudioPlanning = async ({ book: target }) => {
    measurements += 1;
    target.settingsState.patch.audioDurationSeconds = 12.34;
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });

  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'storyboard_only' });
  for (let i = 0; i < 3; i += 1) { await controller.tick(); await wait(); }

  assert.equal(measurements, 1);
  assert.equal(book.settingsState.patch.audioDurationSeconds, 12.34);
  assert.equal(controller.status({ owner: 'user', batchId: batch.id }).books[0].stage, 'ready_for_video');
});

test('retrying a failed VIDEO measures newly missing audio before retrying the failed stage', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-retry-audio-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  batch.settingsState.patch.audioPlanningEnabled = true;
  batch.settingsState.patch.audioDurationSeconds = 12.34;
  book.assetRecords = [{ id: 'a1', kind: 'character' }];
  book.directorRevision = { id: 'd-existing' };
  book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '最终 Prompt' }];
  adapter.runStage = async ({ stage }) => { if (stage === 'video') throw new Error('invalid API key'); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'video_no_submit' });
  for (let i = 0; i < 12; i += 1) { await controller.tick(); await wait(); }
  assert.equal(controller.status({ owner: 'user', batchId: batch.id }).books[0].status, 'failed');

  const order = [];
  batch.settingsState.patch.audioDurationSeconds = 0;
  adapter.getStageSummary = async () => ({ bookId: book.id, lastFailed: { stage: 'video' }, runs: [{ stage: 'video', status: 'failed' }] });
  adapter.prepareAudioPlanning = async ({ book: target }) => { order.push('audio'); target.settingsState.patch.audioDurationSeconds = 12.34; };
  adapter.retryStage = async () => { order.push('retry'); };
  await controller.retry({ owner: 'user', batchId: batch.id, bookIds: [book.id] });
  for (let i = 0; i < 3; i += 1) { await controller.tick(); await wait(); }

  assert.deepEqual(order, ['audio']);
});

test('automation skips visual prompt generation when that AI option is not enabled', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-no-visual-'));
  const { batch, adapter } = fixture();
  batch.settingsState.patch.aiPromptConfig = { visual: { enabled: false } };
  const stages = [];
  const originalRunStage = adapter.runStage;
  adapter.runStage = async input => { stages.push(input.stage); return originalRunStage(input); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'video_no_submit' });
  for (let i = 0; i < 9; i += 1) { await controller.tick(); await wait(); }
  assert.equal(stages.includes('visual'), false);
  assert.equal(stages.includes('video'), true);
});

test('automation with autoPublish uploads a confirmed merged book exactly once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { adapter } = fixture();
  let publishCalls = 0;
  adapter.publishBook = async () => {
    publishCalls += 1;
    return { status: 'confirmed', receipt: { remoteRecord: { found: true, headVideo: true } } };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 1, autoPublish: true });
  for (let i = 0; i < 12; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.state, 'completed');
  assert.equal(status.books[0].stage, 'uploaded');
  assert.equal(publishCalls, 1);
});

test('full-submit upload receives current batch publish settings after a live change', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  let publishSettings = null;
  adapter.publishBook = async ({ settings }) => {
    publishSettings = settings.publishSettings;
    return { status: 'confirmed', receipt: { remoteRecord: { found: true, headVideo: true } } };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({
    owner: 'user', batchId: 'batch-1', runMode: 'full_submit',
    configSnapshot: { publishSettings: { organization: 'frozen-org', category: 'FROZEN' } }
  });
  batch.settingsState.patch.publishSettings = { organization: 'live-org', category: 'LIVE' };
  for (let i = 0; i < 12; i += 1) { await controller.tick(); await wait(); }
  assert.deepEqual(publishSettings, { organization: 'live-org', category: 'LIVE' });
});

test('automation freezes the requested per-job concurrency and defaults old callers to two books', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { adapter } = fixture();
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, dispatcherConcurrency: 1 });
  const started = await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 4, runMode: 'storyboard_only' });
  assert.equal(started.concurrency, 4);
  const persisted = JSON.parse(fs.readFileSync(controller.statePath, 'utf8'));
  assert.equal(Object.values(persisted.jobs)[0].concurrency, 4);

  const fallback = await controller.start({ owner: 'user', batchId: 'batch-2', runMode: 'storyboard_only' });
  assert.equal(fallback.concurrency, 2);
});

test('ten-book automation honors the frozen four-book admission limit', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  batch.books = Array.from({ length: 10 }, (_, index) => ({ id: `book-${index + 1}`, bookId: String(index + 1), title: `小说 ${index + 1}`, sourceText: '正文', settingsState: { patch: {} }, assetRecords: [], videos: [] }));
  let active = 0;
  let maximum = 0;
  adapter.runStage = async ({ book, stage }) => {
    assert.equal(stage, 'assets');
    active += 1;
    maximum = Math.max(maximum, active);
    await wait(25);
    book.assetRecords = [{ id: `asset-${book.id}`, kind: 'character' }];
    active -= 1;
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, dispatcherConcurrency: 1 });
  const started = await controller.start({ owner: 'user', batchId: batch.id, concurrency: 4, runMode: 'storyboard_only' });
  assert.equal(started.concurrency, 4);
  await wait(70);
  assert.equal(maximum, 4);
  assert.equal(controller.status({ owner: 'user', batchId: batch.id }).concurrency, 4);
});

test('a transient failure waits for retry without occupying the next book slot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  batch.books.push({ id: 'book-2', bookId: '102', title: '第二本', sourceText: '正文', settingsState: { patch: {} }, assetRecords: [{ id: 'ready-asset', kind: 'character' }], videos: [] });
  let currentTime = 0;
  const actions = [];
  adapter.runStage = async ({ book, stage }) => {
    actions.push(`${book.id}:${stage}`);
    if (book.id === 'book-1' && stage === 'assets') throw new Error('provider temporarily unavailable');
    if (book.id === 'book-2' && stage === 'director') { book.directorRevision = { id: 'd2' }; book.videos = [{ id: 'v2', label: 'VIDEO02', visualPrompt: '最终提示词' }]; }
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime, dispatcherConcurrency: 1 });
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1, runMode: 'storyboard_only' });
  await controller.tick();
  await wait();
  await controller.tick();
  await wait();
  const status = controller.status({ owner: 'user', batchId: batch.id });
  const retrying = status.books.find(book => book.bookId === 'book-1');
  assert.equal(retrying.status, 'waiting');
  assert.equal(retrying.retryCount, 1);
  assert.equal(retrying.retryAt, '1970-01-01T00:00:30.000Z');
  assert.deepEqual(actions, ['book-1:assets', 'book-2:director']);
});

test('invalid API keys remain terminal instead of consuming automatic retries', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { adapter } = fixture();
  adapter.runStage = async () => { throw new Error('personal video provider did not create a task: Invalid API key'); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 2, runMode: 'video_no_submit' });
  await controller.tick();
  await wait();
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.books[0].status, 'failed');
  assert.equal(status.books[0].retryCount, 0);
});

test('a transient stage gets at most three automatic attempts before it yields the slot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-retry-cap-'));
  const { batch, adapter } = fixture();
  let currentTime = 0;
  let attempts = 0;
  adapter.runStage = async () => { attempts += 1; throw new Error('provider temporarily unavailable'); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime });
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1, runMode: 'storyboard_only' });
  await wait();
  currentTime = 30_000;
  await controller.tick(); await wait();
  currentTime = 150_000;
  await controller.tick(); await wait();
  currentTime = 450_000;
  await controller.tick(); await wait();
  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(attempts, 3);
  assert.equal(status.books[0].status, 'failed');
  assert.match(status.books[0].message, /已停止并让位/);
});

test('a batch with no runnable peer remains actionable instead of looping a hard failure', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-restart-cap-'));
  const { batch, adapter } = fixture();
  let attempts = 0;
  adapter.runStage = async () => { attempts += 1; throw new Error('invalid input: director returned invalid JSON'); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'video_no_submit', concurrency: 1 });
  await wait();
  for (let i = 0; i < 5; i += 1) { await controller.tick(); await wait(); }
  assert.equal(attempts, 1);
  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.state, 'needs_attention');
  assert.equal(status.books[0].status, 'failed');
  assert.match(status.lastError, /没有可完成的同批书籍/);
});

test('a failed book yields its slot, then is retried only after the other book reaches its stop point', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-final-sweep-'));
  const { batch, adapter } = fixture();
  batch.books.push({ id: 'book-2', bookId: '102', title: '第二本', sourceText: '正文', settingsState: { patch: {} }, assetRecords: [], videos: [] });
  const actions = [];
  adapter.runStage = async ({ book, stage }) => {
    actions.push(`${book.id}:${stage}`);
    if (book.id === 'book-1' && stage === 'assets') throw new Error('invalid API key');
    if (book.id === 'book-2' && stage === 'assets') book.assetRecords = [{ id: 'a2', kind: 'character' }];
    if (book.id === 'book-2' && stage === 'director') {
      book.directorRevision = { id: 'd2' };
      book.videos = [{ id: 'v2', label: 'VIDEO02', visualPrompt: '最终提示词' }];
    }
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, dispatcherConcurrency: 1 });
  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'storyboard_only', concurrency: 1 });
  for (let i = 0; i < 12; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.state, 'paused');
  assert.equal(status.books.find(book => book.bookId === 'book-2').stage, 'ready_for_video');
  assert.deepEqual(actions.filter(value => value === 'book-1:assets').length, 2);
  assert.ok(actions.indexOf('book-1:assets', 1) > actions.indexOf('book-2:director'));
});

test('an explicit retry gives the failed stage a fresh three-attempt budget', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-explicit-retry-budget-'));
  const { batch, adapter } = fixture();
  let currentTime = 0;
  let attempts = 0;
  adapter.runStage = async () => { attempts += 1; throw new Error('provider temporarily unavailable'); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime });
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
  await wait();
  currentTime = 30_000; await controller.tick(); await wait();
  currentTime = 150_000; await controller.tick(); await wait();
  assert.equal(controller.status({ owner: 'user', batchId: batch.id }).books[0].status, 'failed');
  await controller.retry({ owner: 'user', batchId: batch.id, bookIds: [batch.books[0].id] });
  await controller.tick(); await wait();
  assert.equal(attempts, 4);
  assert.equal(controller.status({ owner: 'user', batchId: batch.id }).books[0].status, 'waiting');
});

test('a changed stage input gets a new retry budget, while metadata-only changes do not', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-revised-book-retry-'));
  const { batch, adapter } = fixture();
  let currentTime = 0;
  let attempts = 0;
  adapter.runStage = async () => { attempts += 1; throw new Error('provider temporarily unavailable'); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime });
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
  await wait();
  currentTime = 30_000; await controller.tick(); await wait();
  currentTime = 150_000; await controller.tick(); await wait();
  assert.equal(attempts, 3);
  assert.equal(controller.status({ owner: 'user', batchId: batch.id }).books[0].status, 'failed');

  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
  await controller.tick(); await wait();
  assert.equal(attempts, 3);

  batch.books[0].revision = 1;
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
  await controller.tick(); await wait();
  assert.equal(attempts, 3);

  batch.books[0].workingFrontContent = '修改后的生产正文';
  batch.books[0].revision = 2;
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
  await wait();
  assert.equal(attempts, 4);
  assert.equal(controller.status({ owner: 'user', batchId: batch.id }).books[0].status, 'waiting');
});

test('removing one book clears only that book automation state', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-delete-test-'));
  const { adapter } = fixture();
  adapter.loadBatch = async () => ({ id: 'batch-1', books: [
    { id: 'book-1', title: 'one', sourceText: 'one', settingsState: { patch: {} }, assetRecords: [], videos: [] },
    { id: 'book-2', title: 'two', sourceText: 'two', settingsState: { patch: {} }, assetRecords: [], videos: [] }
  ] });
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 1 });
  await controller.removeBook({ owner: 'user', batchId: 'batch-1', bookId: 'book-1' });
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.deepEqual(status.books.map(book => book.bookId), ['book-2']);
});

test('an explicit single-book retry resets a failed book and resumes from its missing stage', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-resume-'));
  const { adapter } = fixture();
  let attempts = 0;
  adapter.runStage = async ({ book, stage }) => {
    if (stage !== 'assets') return;
    attempts += 1;
    if (attempts === 1) throw new Error('invalid API key');
    book.assetRecords = [{ id: 'a1', kind: 'character' }];
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 1, runMode: 'storyboard_only' });
  await controller.tick();
  await wait();
  assert.equal(controller.status({ owner: 'user', batchId: 'batch-1' }).books[0].status, 'failed');

  const resumed = await controller.retry({ owner: 'user', batchId: 'batch-1', bookIds: ['book-1'] });
  assert.equal(resumed.state, 'running');
  assert.equal(resumed.books[0].status, 'pending');
  assert.equal(resumed.books[0].retryRequested, true);

  await controller.tick();
  await wait();
  assert.equal(attempts, 2);
});

test('a transient provider VIDEO failure is retried only for that VIDEO after its backoff', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  book.assetRecords = [{ id: 'a1', kind: 'character' }];
  book.directorRevision = { id: 'd1' };
  book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '提示词' }];
  let currentTime = 0;
  let production = { batchId: batch.id, jobs: [{ id: 'p-failed', bookId: book.id, tasks: [{ id: 't-failed', videoId: 'video-1', status: 'failed', errorMessage: 'provider temporary timeout' }] }] };
  const retried = [];
  adapter.getProductionStatus = async () => production;
  adapter.runStage = async ({ stage, mode, videoId }) => {
    retried.push({ stage, mode, videoId });
    production = { batchId: batch.id, jobs: [{ id: 'p-succeeded', bookId: book.id, tasks: [{ id: 't-succeeded', videoId: 'video-1', status: 'succeeded', mediaUrl: '/media/video.mp4' }] }] };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime });
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 2 });
  await controller.tick();
  await wait();
  let status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.books[0].status, 'waiting');
  assert.equal(status.books[0].retryAt, '1970-01-01T00:00:30.000Z');
  currentTime = 30_000;
  await controller.tick();
  await wait();
  assert.deepEqual(retried, [{ stage: 'video', mode: 'force', videoId: 'video-1' }]);
});

test('a provider content-moderation VIDEO failure stops without blind automatic retries', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-content-moderation-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  book.assetRecords = [{ id: 'a1', kind: 'character' }];
  book.directorRevision = { id: 'd1' };
  book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '提示词' }];
  adapter.getProductionStatus = async () => ({
    batchId: batch.id,
    jobs: [{
      id: 'p-moderated',
      bookId: book.id,
      tasks: [{ id: 't-moderated', videoId: 'video-1', status: 'failed', errorMessage: '内容违规或不符合平台要求，请调整后重试' }]
    }]
  });
  let submissions = 0;
  adapter.runStage = async ({ stage }) => {
    if (stage === 'video') submissions += 1;
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });

  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1, runMode: 'video_no_submit' });
  await controller.tick();
  await wait();

  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.books[0].status, 'failed');
  assert.equal(status.books[0].stage, 'video');
  assert.equal(status.books[0].retryAt, '');
  assert.equal(status.books[0].retryCount, 0);
  assert.match(status.books[0].error, /内容违规或不符合平台要求/);
  assert.equal(submissions, 0);
});

test('a transient merge failure retries only that book after its backoff', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  book.assetRecords = [{ id: 'a1', kind: 'character' }];
  book.directorRevision = { id: 'd1' };
  book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '提示词' }];
  let currentTime = 0;
  let merge = { batchId: batch.id, jobs: [{ id: 'm-failed', bookId: book.id, status: 'failed', errorMessage: 'merge worker timeout' }] };
  let submissions = 0;
  adapter.getProductionStatus = async () => ({ batchId: batch.id, jobs: [{ id: 'p-ok', bookId: book.id, tasks: [{ id: 't-ok', videoId: 'video-1', status: 'succeeded', mediaUrl: '/media/video.mp4' }] }] });
  adapter.getMergeStatus = async () => merge;
  adapter.submitBookMerge = async ({ bookId }) => {
    submissions += 1;
    merge = { batchId: batch.id, jobs: [{ id: 'm-ok', bookId, status: 'succeeded', outputUrl: '/media/merged.mp4' }] };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime });
  await controller.start({ owner: 'user', batchId: batch.id });
  await controller.tick();
  await wait();
  let status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.books[0].status, 'waiting');
  assert.equal(status.books[0].stage, 'merge');
  assert.equal(status.books[0].retryAt, '1970-01-01T00:00:30.000Z');
  currentTime = 30_000;
  await controller.tick();
  await wait();
  assert.equal(submissions, 1);
});

test('a transient video-management upload failure retries only after merged media exists', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  book.assetRecords = [{ id: 'a1', kind: 'character' }];
  book.directorRevision = { id: 'd1' };
  book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '提示词' }];
  let currentTime = 0;
  let calls = 0;
  adapter.getProductionStatus = async () => ({ batchId: batch.id, jobs: [{ id: 'p-ok', bookId: book.id, tasks: [{ id: 't-ok', videoId: 'video-1', status: 'succeeded', mediaUrl: '/media/video.mp4' }] }] });
  adapter.getMergeStatus = async () => ({ batchId: batch.id, jobs: [{ id: 'm-ok', bookId: book.id, status: 'succeeded', outputUrl: '/media/merged.mp4' }] });
  adapter.publishBook = async () => {
    calls += 1;
    if (calls === 1) throw new Error('upload gateway timeout');
    return { status: 'confirmed', receipt: { remoteRecord: { found: true, headVideo: true } } };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime });
  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'full_submit' });
  await controller.tick();
  await wait();
  let status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.books[0].status, 'waiting');
  assert.equal(status.books[0].stage, 'upload');
  currentTime = 30_000;
  await controller.tick();
  await wait();
  assert.equal(calls, 2);
});

test('video-management upload stops after three transient failures and yields the book slot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-upload-cap-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  book.assetRecords = [{ id: 'a1', kind: 'character' }];
  book.directorRevision = { id: 'd1' };
  book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '提示词' }];
  let currentTime = 0;
  let calls = 0;
  adapter.getProductionStatus = async () => ({ batchId: batch.id, jobs: [{ id: 'p-ok', bookId: book.id, tasks: [{ id: 't-ok', videoId: 'video-1', status: 'succeeded', mediaUrl: '/media/video.mp4' }] }] });
  adapter.getMergeStatus = async () => ({ batchId: batch.id, jobs: [{ id: 'm-ok', bookId: book.id, status: 'succeeded', outputUrl: '/media/merged.mp4' }] });
  adapter.publishBook = async () => { calls += 1; throw new Error('upload gateway timeout'); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime });

  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'full_submit', concurrency: 1 });
  await wait();
  currentTime = 30_000; await controller.tick(); await wait();
  currentTime = 150_000; await controller.tick(); await wait();

  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(calls, 3);
  assert.equal(status.books[0].status, 'failed');
  assert.equal(status.books[0].retryCount, 3);
  assert.match(status.books[0].message, /已停止并让位/);
});

test('one slow upload does not hold the batch lock after another lane becomes free', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-upload-yield-'));
  const { batch, adapter } = fixture();
  const readyBook = id => ({
    id, bookId: id, title: id, sourceText: '正文', settingsState: { patch: {} },
    assetRecords: [{ id: `asset-${id}`, kind: 'character' }],
    directorRevision: { id: `director-${id}` },
    videos: [{ id: `video-${id}`, label: 'VIDEO01', visualPrompt: '提示词' }]
  });
  batch.books = [readyBook('book-1'), readyBook('book-2'), readyBook('book-3')];
  adapter.getStageSummary = async (_owner, _isOwner, _batchId, bookId) => ({ bookId, runs: [{ stage: 'assets', status: 'succeeded' }, { stage: 'director', status: 'succeeded' }] });
  adapter.getProductionStatus = async () => ({ batchId: batch.id, jobs: batch.books.map(book => ({ bookId: book.id, tasks: [{ videoId: `video-${book.id}`, status: 'succeeded', mediaUrl: `/media/${book.id}.mp4` }] })) });
  adapter.getMergeStatus = async () => ({ batchId: batch.id, jobs: batch.books.map(book => ({ bookId: book.id, status: 'succeeded', outputUrl: `/media/${book.id}-merged.mp4` })) });
  const never = new Promise(() => {});
  const published = [];
  adapter.publishBook = async ({ book }) => {
    published.push(book.id);
    if (book.id === 'book-1') return never;
    return { status: 'confirmed' };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });

  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'full_submit', concurrency: 2 });
  for (let i = 0; i < 8; i += 1) { await controller.tick(); await wait(15); }

  assert.ok(published.includes('book-1'));
  assert.ok(published.includes('book-2'));
  assert.ok(published.includes('book-3'), `book-3 should start after book-2 frees one lane, got: ${published.join(',')}`);
  assert.equal(published.filter(id => id === 'book-2').length, 1);
  assert.equal(published.filter(id => id === 'book-3').length, 1);
  for (let i = 0; i < 10 && controller.status({ owner: 'user', batchId: batch.id }).books.find(book => book.bookId === 'book-3').stage !== 'uploaded'; i += 1) await wait(10);
  const finalStatus = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(finalStatus.books.find(book => book.bookId === 'book-3').stage, 'uploaded', JSON.stringify(finalStatus));
  await controller.cancel({ owner: 'user', batchId: batch.id });
});

test('scheduled automation ignores preset snapshots and preserves sparse book overrides', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  let currentTime = 0;
  let appliedSnapshot = null;
  adapter.applyExecutionSnapshot = async ({ configSnapshot: value }) => { appliedSnapshot = value; };
  batch.books[0].settingsState.patch = { openingEnabled: false };
  const settingsSeen = [];
  const originalRunStage = adapter.runStage;
  adapter.runStage = async input => { settingsSeen.push(input.settings); return originalRunStage(input); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime });
  const configSnapshot = { textModelId: 'frozen-text', publishSettings: { organization: 'frozen-org' }, aiPromptConfig: { constraints: { baseSetup: { enabled: false } } } };
  await controller.start({ owner: 'user', batchId: 'batch-1', scheduledAt: '1970-01-01T00:00:01.000Z', runMode: 'storyboard_only', preset: { id: 'preset-1', name: '夜间 H3', version: 1 }, configSnapshot });
  configSnapshot.publishSettings.organization = 'mutated-org';
  configSnapshot.aiPromptConfig.constraints.baseSetup.enabled = true;
  batch.settingsState.patch = { textModelId: 'text-current', publishSettings: { organization: 'live-org' }, aiPromptConfig: { constraints: { baseSetup: { enabled: true } } } };
  currentTime = 1_000;
  for (let index = 0; index < 4; index += 1) { await controller.tick(); await wait(); }
  assert.equal(appliedSnapshot, null);
  assert.ok(settingsSeen.length > 0);
  for (const settings of settingsSeen) {
    assert.equal(settings.textModelId, 'text-current');
    assert.equal(settings.publishSettings.organization, 'live-org');
    assert.equal(settings.aiPromptConfig.constraints.baseSetup.enabled, true);
    assert.equal(settings.openingEnabled, false);
  }
  assert.deepEqual(batch.books[0].settingsState.patch, { openingEnabled: false });
  const saved = Object.values(JSON.parse(fs.readFileSync(controller.statePath, 'utf8')).jobs)[0];
  assert.equal(Object.hasOwn(saved, 'configSnapshot'), false);
});

test('one blocked book does not erase another completed book', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  batch.books.push({ id: 'book-2', bookId: '102', title: '缺正文', sourceText: '', settingsState: { patch: {} }, videos: [] });
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 2, runMode: 'video_no_submit' });
  for (let i = 0; i < 10; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.state, 'paused');
  assert.equal(status.counts.ready, 1);
  assert.equal(status.counts.blocked, 1);
});

test('retry regenerates only a failed VIDEO and then completes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  book.assetRecords = [{ id: 'a1', kind: 'character' }];
  book.directorRevision = { id: 'd1' };
  book.videos = [{ id: 'video-1', label: 'VIDEO01', visualPrompt: '画面提示词' }];
  let production = { batchId: batch.id, jobs: [{ id: 'p-fail', bookId: book.id, tasks: [{ id: 't-fail', videoId: 'video-1', status: 'failed', errorMessage: '供应商失败' }] }] };
  const merge = { batchId: batch.id, jobs: [] };
  const modes = [];
  adapter.getStageSummary = async () => ({ bookId: book.id, runs: [{ stage: 'assets', status: 'succeeded' }, { stage: 'director', status: 'succeeded' }, { stage: 'visual', status: 'succeeded' }] });
  adapter.getProductionStatus = async () => production;
  adapter.getMergeStatus = async () => merge;
  adapter.runStage = async ({ stage, mode, videoId }) => {
    modes.push({ stage, mode, videoId });
    if (stage === 'video') production = { batchId: batch.id, jobs: [{ id: 'p-ok', bookId: book.id, tasks: [{ id: 't-ok', videoId: 'video-1', status: 'succeeded', mediaUrl: '/media/video.mp4' }] }] };
  };
  adapter.submitBookMerge = async ({ bookId }) => { merge.jobs.push({ id: 'm-ok', bookId, status: 'succeeded', outputUrl: '/media/merged.mp4' }); };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1, runMode: 'video_no_submit' });
  for (let i = 0; i < 10; i += 1) {
    await controller.tick();
    await wait();
    if (controller.status({ owner: 'user', batchId: batch.id }).state === 'needs_attention') break;
  }
  const waiting = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(waiting.state, 'running');
  assert.equal(waiting.books[0].status, 'waiting');
  assert.ok(waiting.books[0].retryAt);
  await controller.retry({ owner: 'user', batchId: batch.id });
  for (let i = 0; i < 12; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.state, 'completed');
  assert.deepEqual(modes[0], { stage: 'video', mode: 'force', videoId: 'video-1' });
});

test('giant placeholder without an executor task fails that book and lets the next book run', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  batch.books.push({ id: 'book-2', bookId: '102', title: '巨量占位', sourceText: '', sourceMetadata: { sourceMode: 'giant_material', contentPending: true }, settingsState: { patch: {} }, assetRecords: [], videos: [] });
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', runMode: 'video_no_submit', concurrency: 2 });
  for (let i = 0; i < 12; i += 1) { await controller.tick(); await wait(); }
  let status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.books[0].status, 'ready');
  assert.equal(status.books[1].status, 'failed');
  assert.equal(status.books[1].stage, 'source');
  assert.match(status.books[1].message, /未启动.*执行器/);
  assert.match(status.books[1].error, /执行器任务/);
  assert.equal(status.counts.failed, 1);
  assert.equal(status.state, 'paused');
});

test('automation fetches a giant placeholder directly before requiring an executor', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-direct-source-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  book.sourceText = '';
  book.sourceMetadata = { sourceMode: 'giant_material', contentPending: true };
  let directFetches = 0;
  adapter.fetchDirectSource = async ({ book: requestedBook }) => {
    directFetches += 1;
    requestedBook.sourceText = '从书城直接获取的完整正文';
    requestedBook.sourceMetadata = { ...requestedBook.sourceMetadata, contentPending: false, originalReadVia: 'bookstore' };
    return { state: 'succeeded', characters: requestedBook.sourceText.length };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });

  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'video_no_submit', concurrency: 1 });
  for (let i = 0; i < 10; i += 1) { await controller.tick(); await wait(); }

  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(directFetches, 1);
  assert.equal(status.state, 'completed');
  assert.equal(status.books[0].status, 'ready');
  assert.equal(status.books[0].stage, 'ready_for_upload');
});

test('a direct-source failure stops only that giant book and releases the next book', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-direct-source-failure-'));
  const { batch, adapter } = fixture();
  batch.books[0].sourceText = '';
  batch.books[0].sourceMetadata = { sourceMode: 'giant_material', contentPending: true };
  batch.books.push({ id: 'book-2', bookId: '102', title: '下一本', sourceText: '下一本可生产正文', settingsState: { patch: {} }, assetRecords: [], videos: [] });
  let directFetches = 0;
  adapter.fetchDirectSource = async () => {
    directFetches += 1;
    return { state: 'failed', error: '书城无正文' };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });

  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'video_no_submit', concurrency: 1 });
  for (let i = 0; i < 10; i += 1) { await controller.tick(); await wait(); }

  const status = controller.status({ owner: 'user', batchId: batch.id });
  const failed = status.books.find(item => item.bookId === 'book-1');
  const next = status.books.find(item => item.bookId === 'book-2');
  assert.equal(directFetches, 2);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.stage, 'source');
  assert.match(failed.message, /书城正文直取失败/);
  assert.match(failed.error, /书城无正文/);
  assert.equal(next.status, 'ready');
  assert.equal(status.state, 'paused');
});

test('a queued giant OCR task fails immediately and frees its automation slot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-queued-giant-'));
  const { batch, adapter } = fixture();
  batch.books[0].sourceText = '';
  batch.books[0].sourceMetadata = { sourceMode: 'giant_material', contentPending: true, executorJobId: 'giant-job-queued' };
  adapter.reconcileGiantMaterialSource = async () => ({ state: 'queued', queuedAt: '2026-10-02T00:00:00.000Z' });
  const controller = createBatchFactoryAutomationController({
    adapter,
    statePath: path.join(directory, 'state.json'),
    pollMs: 60_000,
    now: () => new Date('2026-10-02T00:00:01.000Z'),
    logger: { error() {} }
  });

  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
  for (let i = 0; i < 3; i += 1) { await controller.tick(); await wait(); }

  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.state, 'needs_attention');
  assert.equal(status.books[0].status, 'failed');
  assert.match(status.books[0].message, /未被执行器领取/);
  assert.match(status.books[0].error, /尚未领取/);
});

test('a giant OCR task with an expired executor lease fails and frees its automation slot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-expired-giant-'));
  const { batch, adapter } = fixture();
  batch.books[0].sourceText = '';
  batch.books[0].sourceMetadata = { sourceMode: 'giant_material', contentPending: true, executorJobId: 'giant-job-expired' };
  adapter.reconcileGiantMaterialSource = async () => ({
    state: 'running',
    leaseExpiresAt: '2026-10-02T00:00:00.000Z',
    progress: { percent: 90 }
  });
  const controller = createBatchFactoryAutomationController({
    adapter,
    statePath: path.join(directory, 'state.json'),
    pollMs: 60_000,
    now: () => new Date('2026-10-02T00:00:01.000Z'),
    logger: { error() {} }
  });

  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
  for (let i = 0; i < 3; i += 1) { await controller.tick(); await wait(); }

  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.state, 'needs_attention');
  assert.equal(status.books[0].status, 'failed');
  assert.match(status.books[0].message, /执行器已离线/);
  assert.match(status.books[0].error, /租约已过期/);
});

test('a queued giant OCR task is failed during the preflight sweep even when it is not next in line', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-preflight-giant-'));
  const { batch, adapter } = fixture();
  batch.books.push({
    id: 'book-2', bookId: '102', title: '排在后面的巨量书', sourceText: '',
    sourceMetadata: { sourceMode: 'giant_material', contentPending: true, executorJobId: 'giant-job-later' },
    settingsState: { patch: {} }, assetRecords: [], videos: []
  });
  adapter.reconcileGiantMaterialSource = async () => ({ state: 'queued' });
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });

  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
  for (let i = 0; i < 2; i += 1) { await controller.tick(); await wait(); }

  const status = controller.status({ owner: 'user', batchId: batch.id });
  const giant = status.books.find(book => book.bookId === 'book-2');
  assert.equal(giant.status, 'failed');
  assert.match(giant.message, /未被执行器领取/);
});

test('reload migrates historic unclaimed giant OCR blocks into failed books', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-giant-migrate-'));
  const statePath = path.join(directory, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    jobs: {
      'user:batch-1': {
        owner: 'user', batchId: 'batch-1', state: 'needs_attention', books: {
          'book-1': {
            bookId: 'book-1', title: '历史巨量书', status: 'blocked', stage: 'source',
            message: '未启动本地巨量执行器，无法读取正文',
            error: '巨量素材尚未创建执行器任务，请启动执行器后重新派发读取任务'
          }
        }
      }
    }
  }));
  const { adapter } = fixture();
  const controller = createBatchFactoryAutomationController({ adapter, statePath, pollMs: 60_000, logger: { error() {} } });
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.books[0].status, 'failed');
  assert.match(status.books[0].message, /已停止本书并继续下一本/);
  assert.equal(status.counts.failed, 1);
});

test('server reconciliation saves a completed giant OCR result without a browser being open', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-giant-reconcile-'));
  const { batch, adapter } = fixture();
  batch.books[0].sourceText = '';
  batch.books[0].sourceMetadata = {
    sourceMode: 'giant_material',
    contentPending: true,
    executorJobId: 'giant-job-1',
    giantAutomationPlan: { presetId: 'preset-1', runMode: 'storyboard_only' }
  };
  let reconciled = 0;
  adapter.reconcileGiantMaterialSource = async ({ book }) => {
    reconciled += 1;
    book.sourceText = '执行器已经识别出的正文';
    book.sourceMetadata = { ...book.sourceMetadata, contentPending: false, originalReadStage: 'completed', originalReadVia: 'ocr' };
    return { state: 'succeeded', characters: book.sourceText.length };
  };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1, runMode: 'storyboard_only' });
  await wait();
  let status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(reconciled, 1);
  assert.equal(status.books[0].stage, 'source');
  assert.match(status.books[0].message, /正文已回填/);
  await controller.tick();
  await wait();
  status = controller.status({ owner: 'user', batchId: batch.id });
  assert.notEqual(status.books[0].stage, 'source');
});

test('a giant OCR failure resumes automatically when live source text arrives later', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-giant-live-source-'));
  const { batch, adapter } = fixture();
  const book = batch.books[0];
  book.sourceText = '';
  book.sourceMetadata = {
    sourceMode: 'giant_material',
    contentPending: true,
    executorJobId: 'giant-job-failed'
  };
  let assetRuns = 0;
  adapter.reconcileGiantMaterialSource = async () => ({ state: 'failed', error: '滚屏 OCR 未完成' });
  adapter.runStage = async ({ stage }) => {
    if (stage === 'assets') assetRuns += 1;
  };
  const controller = createBatchFactoryAutomationController({
    adapter,
    statePath: path.join(directory, 'state.json'),
    pollMs: 60_000,
    logger: { error() {} }
  });

  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
  await wait();
  assert.equal(controller.status({ owner: 'user', batchId: batch.id }).books[0].status, 'failed');

  book.sourceText = '已保存的生产正文';
  book.sourceMetadata = { ...book.sourceMetadata, contentPending: false };
  await controller.tick();
  await wait();

  assert.equal(assetRuns, 1);
  assert.equal(controller.status({ owner: 'user', batchId: batch.id }).books[0].status, 'pending');
});

test('non-giant book without source text still blocks as before', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  batch.books.push({ id: 'book-2', bookId: '102', title: '缺正文', sourceText: '', sourceMetadata: {}, settingsState: { patch: {} }, assetRecords: [], videos: [] });
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 2 });
  for (let i = 0; i < 4; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.counts.blocked, 1);
});

test('books waiting on external conditions do not block later books whose videos are ready', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-waiting-yield-'));
  const { batch, adapter } = fixture();
  const readyBook = (id, videoId) => ({
    id, title: id, sourceText: '正文', settingsState: { patch: {} },
    assetRecords: [{ id: `asset-${id}`, kind: 'character' }],
    directorRevision: { id: `director-${id}` },
    videos: [{ id: videoId, label: 'VIDEO01', visualPrompt: '画面提示词' }]
  });
  batch.books = [
    { id: 'book-1', title: '巨量等正文', sourceText: '', sourceMetadata: { sourceMode: 'giant_material', contentPending: true }, settingsState: { patch: {} }, videos: [] },
    readyBook('book-2', 'video-2'),
    readyBook('book-3', 'video-3'),
    readyBook('book-4', 'video-4')
  ];
  const production = { batchId: batch.id, jobs: [
    { bookId: 'book-2', tasks: [{ videoId: 'video-2', status: 'running' }] },
    { bookId: 'book-3', tasks: [{ videoId: 'video-3', status: 'running' }] },
    { bookId: 'book-4', tasks: [{ videoId: 'video-4', status: 'running' }] }
  ] };
  const merge = { batchId: batch.id, jobs: [] };
  const summaries = new Map(['book-2', 'book-3', 'book-4'].map(id => [id, { bookId: id, runs: [{ stage: 'assets', status: 'succeeded' }, { stage: 'director', status: 'succeeded' }] }]));
  adapter.getStageSummary = async (_owner, _isOwner, _batchId, bookId) => summaries.get(bookId) || { bookId, runs: [] };
  adapter.getProductionStatus = async () => production;
  adapter.getMergeStatus = async () => merge;
  const submittedMerges = [];
  adapter.submitBookMerge = async ({ bookId }) => {
    submittedMerges.push(bookId);
    merge.jobs.push({ id: `merge-${bookId}`, bookId, status: 'running' });
  };
  const unexpectedStages = [];
  adapter.runStage = async ({ book, stage }) => { unexpectedStages.push(`${book.id}:${stage}`); };

  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: batch.id, runMode: 'video_no_submit', concurrency: 2 });
  // 前两轮把四本书都送入 waiting（1 本等正文，3 本等视频回读）
  await controller.tick(); await wait();
  await controller.tick(); await wait();
  // 供应商只回好了排在最后的 book-4
  const book4Job = production.jobs.find(job => job.bookId === 'book-4');
  book4Job.tasks = [{ videoId: 'video-4', status: 'succeeded', mediaUrl: '/media/video-4.mp4' }];
  // 连续多轮巡检：即使前面三本书一直干等，book-4 也必须被发现并提交合成
  for (let i = 0; i < 5; i += 1) { await controller.tick(); await wait(); }
  assert.ok(submittedMerges.includes('book-4'), `book-4 should reach merge even while earlier books wait, got: ${submittedMerges.join(',')}`);
  assert.deepEqual(unexpectedStages, []);
  // 合成完成后继续自动走到待上传
  const mergeJob = merge.jobs.find(job => job.bookId === 'book-4');
  mergeJob.status = 'succeeded';
  mergeJob.outputUrl = '/media/merged-4.mp4';
  for (let i = 0; i < 3; i += 1) { await controller.tick(); await wait(); }
  const state = controller.status({ owner: 'user', batchId: batch.id }).books.find(book => book.bookId === 'book-4');
  assert.equal(state.stage, 'ready_for_upload');
});

// -------- 巨量批量自动兜底巡查的回归测试 --------

function recoveryFixture({ savedPlan = null, batchId = 'giant-batch-1' } = {}) {
  const normalizedPlan = savedPlan ? { presetId: 'preset-1', ...savedPlan } : null;
  const batch = {
    id: batchId,
    title: '巨量批量',
    settingsState: { patch: { publishSettings: { organization: 'org' } } },
    books: [{
      id: 'g-book-1', bookId: '201', title: '巨量书', sourceText: '',
      sourceMetadata: { sourceMode: 'giant_material', contentPending: true, ...(normalizedPlan ? { giantAutomationPlan: normalizedPlan } : {}) },
      settingsState: { patch: {} }, assetRecords: [], videos: []
    }]
  };
  const base = fixture();
  const recoveries = [];
  let controller;
  const adapter = {
    ...base.adapter,
    async loadBatch() { return batch; },
    async listOwners() { return [{ username: 'user', isOwner: true }]; },
    async listBatches() { return [batch]; },
    async startRecovery({ owner, batch: currentBatch, savedPlan: plan }) {
      recoveries.push({ owner, batchId: currentBatch.id, plan });
      const runModeValue = String(plan?.runMode || 'full_submit');
      await controller.start({
        owner,
        batchId: currentBatch.id,
        runMode: runModeValue,
        autoPublish: runModeValue === 'full_submit',
        concurrency: plan?.concurrency,
        configSnapshot: currentBatch.settingsState.patch
      });
    }
  };
  return { batch, adapter, recoveries, setController(value) { controller = value; } };
}

const silentLogger = () => ({ error() {}, warn() {}, info() {}, debug() {} });

test('recovery sweep bounds cross-account batch reads to two concurrent requests', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-concurrency-'));
  let inFlight = 0;
  let peak = 0;
  const adapter = {
    ...fixture().adapter,
    async listOwners() {
      return ['owner-1', 'owner-2', 'owner-3', 'owner-4'];
    },
    async listBatches() {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await wait(15);
      inFlight -= 1;
      return [];
    },
    async startRecovery() {}
  };
  const controller = createBatchFactoryAutomationController({
    adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryEnabled: false, logger: silentLogger()
  });

  await controller.runRecovery();

  assert.equal(peak, 2);
});

test('recovery sweep leaves a giant batch without a saved plan idle instead of guessing full automation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-'));
  const setup = recoveryFixture();
  const controller = createBatchFactoryAutomationController({
    adapter: setup.adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryEnabled: false, logger: silentLogger()
  });
  setup.setController(controller);
  await controller.runRecovery();
  assert.equal(setup.recoveries.length, 0);
  const status = controller.status({ owner: 'user', batchId: 'giant-batch-1' });
  assert.equal(status.state, 'idle');
});

test('recovery sweep backfills a completed giant OCR result without starting automation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-ocr-only-'));
  const setup = recoveryFixture();
  setup.batch.books[0].sourceMetadata.executorJobId = 'giant-job-complete';
  let reconciled = 0;
  setup.adapter.reconcileGiantMaterialSource = async ({ book }) => {
    reconciled += 1;
    book.sourceText = '已从 OCR 回填的正文';
    book.sourceMetadata = { ...book.sourceMetadata, contentPending: false, originalReadStage: 'completed', originalReadVia: 'ocr' };
    return { state: 'succeeded', characters: book.sourceText.length };
  };
  const controller = createBatchFactoryAutomationController({
    adapter: setup.adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryEnabled: false, logger: silentLogger()
  });
  setup.setController(controller);

  await controller.runRecovery();

  assert.equal(reconciled, 1);
  assert.equal(setup.batch.books[0].sourceText, '已从 OCR 回填的正文');
  assert.equal(setup.batch.books[0].sourceMetadata.contentPending, false);
  assert.equal(setup.recoveries.length, 0);
});

test('recovery sweep reconciles from its lightweight list payload without reloading the full batch', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-lightweight-'));
  const setup = recoveryFixture();
  setup.batch.books[0].sourceMetadata.executorJobId = 'giant-job-complete';
  let fullLoads = 0;
  let reconciled = 0;
  setup.adapter.loadBatch = async () => { fullLoads += 1; throw new Error('full batch must not be loaded by recovery sweep'); };
  setup.adapter.reconcileGiantMaterialSource = async () => { reconciled += 1; return { state: 'waiting' }; };
  const controller = createBatchFactoryAutomationController({
    adapter: setup.adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryEnabled: false, logger: silentLogger()
  });
  setup.setController(controller);

  await controller.runRecovery();

  assert.equal(fullLoads, 0);
  assert.equal(reconciled, 1);
});

test('recovery sweep restarts only a source-failed giant batch after live text arrives', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-live-source-'));
  const setup = recoveryFixture({ savedPlan: { runMode: 'video_no_submit', concurrency: 1 } });
  const book = setup.batch.books[0];
  book.sourceMetadata.executorJobId = 'giant-job-failed';
  setup.adapter.reconcileGiantMaterialSource = async () => ({ state: 'failed', error: '滚屏 OCR 未完成' });
  const controller = createBatchFactoryAutomationController({
    adapter: setup.adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryEnabled: false, logger: silentLogger()
  });
  setup.setController(controller);

  await controller.start({ owner: 'user', batchId: setup.batch.id, runMode: 'video_no_submit', concurrency: 1 });
  await wait();
  assert.equal(controller.status({ owner: 'user', batchId: setup.batch.id }).state, 'needs_attention');

  book.sourceText = '之后写入的生产正文';
  book.sourceMetadata = { ...book.sourceMetadata, contentPending: false };
  await controller.runRecovery();

  assert.equal(setup.recoveries.length, 1);
  assert.equal(setup.recoveries[0].batchId, setup.batch.id);
});

test('recovery sweep honors the saved plan: video_no_submit with concurrency 1', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-plan-'));
  const setup = recoveryFixture({ savedPlan: { runMode: 'video_no_submit', concurrency: 1 } });
  setup.batch.books[0].sourceMetadata.executorJobId = 'giant-job-running';
  setup.adapter.reconcileGiantMaterialSource = async () => ({ state: 'running', progress: { percent: 1 } });
  const controller = createBatchFactoryAutomationController({
    adapter: setup.adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryEnabled: false, logger: silentLogger()
  });
  setup.setController(controller);
  await controller.runRecovery();
  const status = controller.status({ owner: 'user', batchId: 'giant-batch-1' });
  assert.equal(status.state, 'running');
  assert.equal(status.runMode, 'video_no_submit');
  assert.equal(status.autoPublish, false);
  assert.equal(status.concurrency, 1);
});

test('recovery sweep never restarts active, paused or cancelled jobs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-skip-'));
  const setup = recoveryFixture();
  const controller = createBatchFactoryAutomationController({
    adapter: setup.adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryEnabled: false, logger: silentLogger()
  });
  setup.setController(controller);
  await controller.start({ owner: 'user', batchId: 'giant-batch-1', runMode: 'full_submit', autoPublish: true });
  await controller.runRecovery();
  assert.equal(setup.recoveries.length, 0);
  await controller.pause({ owner: 'user', batchId: 'giant-batch-1' });
  await controller.runRecovery();
  assert.equal(setup.recoveries.length, 0);
  await controller.cancel({ owner: 'user', batchId: 'giant-batch-1' });
  await controller.runRecovery();
  assert.equal(setup.recoveries.length, 0);
});

test('recovery sweep waits for a future scheduled plan and starts once it is due', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-schedule-'));
  const setup = recoveryFixture({ savedPlan: { runMode: 'full_submit', scheduledAt: '2999-01-01T00:00:00.000Z' } });
  const controller = createBatchFactoryAutomationController({
    adapter: setup.adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryEnabled: false, logger: silentLogger()
  });
  setup.setController(controller);
  await controller.runRecovery();
  assert.equal(setup.recoveries.length, 0);
  setup.batch.books[0].sourceMetadata.giantAutomationPlan.scheduledAt = '2000-01-01T00:00:00.000Z';
  await controller.runRecovery();
  assert.equal(setup.recoveries.length, 1);
});

test('recovery sweep ignores non-giant batches and survives a failing recovery attempt', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-error-'));
  const setup = recoveryFixture({ savedPlan: {} });
  const normalBatch = {
    id: 'normal-batch',
    settingsState: { patch: {} },
    books: [{ id: 'n-book-1', sourceMetadata: {}, settingsState: { patch: {} } }]
  };
  setup.adapter.listBatches = async () => [normalBatch, setup.batch];
  let failNext = true;
  const originalStartRecovery = setup.adapter.startRecovery;
  setup.adapter.startRecovery = async input => {
    if (failNext) { failNext = false; throw new Error('temporary recovery error'); }
    return originalStartRecovery(input);
  };
  const warnings = [];
  const controller = createBatchFactoryAutomationController({
    adapter: setup.adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryEnabled: false,
    logger: { ...silentLogger(), warn() { warnings.push(1); } }
  });
  setup.setController(controller);

  await assert.doesNotReject(controller.runRecovery());
  assert.equal(setup.recoveries.length, 0); // 尝试失败，不算开工
  assert.equal(warnings.length, 1);
  await controller.runRecovery(); // 故障解除，巡查下一轮必须能重新启动
  assert.equal(setup.recoveries.length, 1);
  assert.equal(setup.recoveries[0].batchId, 'giant-batch-1');
});

test('recovery sweep runs automatically shortly after controller creation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-recovery-auto-'));
  const setup = recoveryFixture({ savedPlan: {} });
  const controller = createBatchFactoryAutomationController({
    adapter: setup.adapter, statePath: path.join(directory, 'state.json'),
    pollMs: 60_000, recoveryMs: 60_000, logger: silentLogger()
  });
  setup.setController(controller);
  await wait(80);
  assert.equal(setup.recoveries.length, 1);
});

// 路由层 startRecovery 适配器的冒烟测试。
// 上一轮的 "text is not defined" 事故说明：只测编排器、不测路由真实代码，
// 适配器内部的引用错误会一路漏到公网。这里通过替换编排器工厂，把路由闭包
// 内部构造的 adapter 捕获出来，直接执行真实的 startRecovery。
function captureRouterRecoveryAdapter(presetStore, routerOptions = {}) {
  const orchestrator = require('../lib/batch-factory-v11/automation-orchestrator');
  const originalFactory = orchestrator.createBatchFactoryAutomationController;
  let captured = null;
  const starts = [];
  orchestrator.createBatchFactoryAutomationController = options => {
    captured = options.adapter;
    return {
      start: async args => { starts.push(args); return { state: 'running' }; },
      pause() {}, resume() {}, retry() {}, cancel() {}, removeBook() {}, removeBatch() {},
      status() { return { state: 'idle' }; }
    };
  };
  delete require.cache[require.resolve('../routes/batch-factory-v11')];
  const { createBatchFactoryV11Router } = require('../routes/batch-factory-v11');
  createBatchFactoryV11Router({
    accountStore: { listAccounts: () => [] },
    automationPresetStore: presetStore,
    logger: { error() {}, warn() {}, info() {} },
    ...routerOptions
  });
  return {
    adapter: captured,
    starts,
    restore() {
      orchestrator.createBatchFactoryAutomationController = originalFactory;
      delete require.cache[require.resolve('../routes/batch-factory-v11')];
    }
  };
}

test('router startRecovery rejects a missing giant plan instead of defaulting to full automation', async () => {
  const presetStore = { list: async () => [], get: async () => null };
  const setup = captureRouterRecoveryAdapter(presetStore);
  try {
    const batch = { id: 'b1', settingsState: { patch: { textModelId: 'm1' } } };
    await assert.rejects(
      () => setup.adapter.startRecovery({ owner: 'u', isOwner: false, batch, savedPlan: null }),
      error => error?.code === 'GIANT_AUTOMATION_PLAN_MISSING'
    );
    assert.equal(setup.starts.length, 0);
  } finally {
    setup.restore();
  }
});

test('router startRecovery honors its saved plan without copying preset configuration', async () => {
  const presets = new Map([['p1', { id: 'p1', name: '夜间', version: 3, config: { textModelId: 'from-preset' } }]]);
  const presetStore = { list: async () => [...presets.values()], get: async (_owner, id) => presets.get(id) };
  const setup = captureRouterRecoveryAdapter(presetStore, {
    configReader: () => ({
      model: 'provider-current-text',
      modelCatalogVersion: 1,
      modelCatalog: [{
        id: 'current-text', kind: 'text', displayName: '当前文本模型', providerType: 'openai_compatible',
        baseUrl: 'https://models.example.test/v1', modelId: 'provider-current-text', credential: 'test-key', enabled: true
      }]
    })
  });
  try {
    const batch = { id: 'b2', settingsState: { patch: { openingEnabled: false } } };
    await setup.adapter.startRecovery({
      owner: 'user', isOwner: true, batch,
      savedPlan: { presetId: 'p1', runMode: 'video_no_submit', concurrency: 1, scheduledAt: '2026-10-02T10:01:00.000Z' }
    });
    assert.equal(setup.starts[0].runMode, 'video_no_submit');
    assert.equal(setup.starts[0].autoPublish, false);
    assert.equal(setup.starts[0].concurrency, 1);
    assert.equal(setup.starts[0].preset.id, 'p1');
    assert.equal(setup.starts[0].scheduledAt, '2026-10-02T10:01:00.000Z');
    assert.equal(Object.hasOwn(setup.starts[0], 'configSnapshot'), false);
    assert.deepEqual(batch.settingsState.patch, { openingEnabled: false });
  } finally {
    setup.restore();
  }
});

// "继承引擎配置"纯函数测试
const { applyEngineConfigInheritance } = require('../routes/batch-factory-v11');

async function runRecoveryWithRealStageAdapter(t, { batchPatch = {}, bookPatch = {}, defaultEnabled = true } = {}) {
  const orchestrator = require('../lib/batch-factory-v11/automation-orchestrator');
  const originalFactory = orchestrator.createBatchFactoryAutomationController;
  let controller;
  let adapter;
  const outgoing = [];
  const batch = {
    id: 'batch-1', settingsState: { patch: { automationPresetSnapshot: { id: 'p1', name: '冻结预设', version: 1 }, ...batchPatch } },
    books: [{ id: 'book-1', sourceText: '真实生产正文', settingsState: { patch: bookPatch }, assetRecords: [], videos: [] }]
  };
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-real-stage-')), 'state.json');
  const configReader = () => ({ model: 'provider-default', modelCatalog: [
    { id: 'account-default', kind: 'text', modelId: 'provider-default', enabled: defaultEnabled, baseUrl: 'http://default.local/v1', credential: 'default-fixture-key' },
    { id: 'book-text', kind: 'text', modelId: 'provider-book', enabled: true, baseUrl: 'http://book.local/v1', credential: 'book-fixture-key' },
    { id: 'batch-text', kind: 'text', modelId: 'provider-batch', enabled: true, baseUrl: 'http://batch.local/v1', credential: 'batch-fixture-key' }
  ] });
  orchestrator.createBatchFactoryAutomationController = options => {
    adapter = options.adapter;
    controller = originalFactory(options);
    return controller;
  };
  delete require.cache[require.resolve('../routes/batch-factory-v11')];
  try {
    require('../routes/batch-factory-v11').createBatchFactoryV11Router({
      automationStatePath: statePath, automationPollMs: 60_000, automationRecoveryEnabled: false,
      automationPresetStore: {}, configReader,
      memberStore: { getMember: username => ({ username, active: true, role: 'manager' }) },
      goBaseUrl: 'http://go.local', bridgeSecret: 'fixture-secret', logger: silentLogger(),
      fetchImpl: async (url, init) => {
        const pathname = new URL(url).pathname;
        if (init.method === 'GET' && pathname === '/api/batch-factory/v11/batches/batch-1') return new Response(JSON.stringify({ batch }));
        if (init.method === 'GET' && /\/(?:status|merge-status)$/.test(pathname)) return new Response(JSON.stringify({ jobs: [] }));
        if (init.method === 'GET' && pathname.endsWith('/stages')) return new Response(JSON.stringify({ summary: { runs: [] } }));
        assert.equal(init.method, 'POST');
        assert.equal(pathname, '/api/batch-factory/v11/batches/batch-1/books/book-1/stages/assets');
        outgoing.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ ok: true }));
      }
    });
  } finally {
    orchestrator.createBatchFactoryAutomationController = originalFactory;
    delete require.cache[require.resolve('../routes/batch-factory-v11')];
  }
  t.after(() => controller.cancel({ owner: 'stage-test-user', batchId: batch.id }));
  await adapter.startRecovery({ owner: 'stage-test-user', isOwner: true, batch, savedPlan: { presetId: 'p1', runMode: 'storyboard_only', concurrency: 1 } });
  for (let i = 0; i < 4; i += 1) {
    await controller.tick();
    await wait();
    if (outgoing.length || controller.status({ owner: 'stage-test-user', batchId: batch.id }).books?.[0]?.error) break;
  }
  const status = controller.status({ owner: 'stage-test-user', batchId: batch.id });
  await controller.pause({ owner: 'stage-test-user', batchId: batch.id });
  const saved = Object.values(JSON.parse(fs.readFileSync(statePath, 'utf8')).jobs)[0];
  assert.equal(Object.hasOwn(saved, 'configSnapshot'), false);
  assert.deepEqual(batch.books[0].settingsState.patch, bookPatch);
  return { outgoing, status };
}

for (const { name, options, model, endpoint } of [
  { name: 'enabled account default', options: {}, model: 'provider-default', endpoint: 'http://default.local/v1/chat/completions' },
  { name: 'sparse explicit book model over a disabled default and batch model', options: { batchPatch: { textModelId: 'batch-text' }, bookPatch: { textModelId: 'book-text' }, defaultEnabled: false }, model: 'provider-book', endpoint: 'http://book.local/v1/chat/completions' },
  { name: 'explicit batch model', options: { batchPatch: { textModelId: 'batch-text' } }, model: 'provider-batch', endpoint: 'http://batch.local/v1/chat/completions' }
]) {
  test(`real controller and stage adapter dispatch the ${name}`, async t => {
    const { outgoing } = await runRecoveryWithRealStageAdapter(t, options);
    assert.equal(outgoing.length, 1);
    assert.equal(outgoing[0].textProvider.model, model);
    assert.equal(outgoing[0].textProvider.endpoint, endpoint);
    assert.equal(outgoing[0].mode, 'missing');
  });
}

for (const { name, options } of [
  { name: 'disabled account default', options: { defaultEnabled: false } },
  { name: 'explicit blank batch model', options: { batchPatch: { textModelId: '' } } },
  { name: 'sparse explicit blank book model', options: { batchPatch: { textModelId: 'batch-text' }, bookPatch: { textModelId: '' } } }
]) {
  test(`real controller and stage adapter reject ${name} before dispatch`, async t => {
    const { outgoing, status } = await runRecoveryWithRealStageAdapter(t, options);
    assert.deepEqual(outgoing, []);
    assert.equal(status.books[0].stage, 'assets');
    assert.match(status.books[0].error, /选择已启用的文本模型/);
  });
}

test('engine inheritance retains an explicit blank model instead of falling back', () => {
  assert.deepEqual(applyEngineConfigInheritance({ textModelId: '' }, { model: 'default-text', modelCatalog: [] }), { textModelId: '' });
});

test('engine inheritance fills the account default text model when batch snapshot has none', () => {
  const accountConfig = { model: 'default-text', modelCatalog: [] };
  const result = applyEngineConfigInheritance({}, accountConfig);
  assert.equal(result.textModelId, 'default-text');
});

test('engine inheritance never overrides an explicitly selected batch model', () => {
  const accountConfig = { model: 'default-text', modelCatalog: [] };
  const result = applyEngineConfigInheritance({ textModelId: 'batch-pick' }, accountConfig);
  assert.equal(result.textModelId, 'batch-pick');
});

test('engine inheritance skips a default model that is explicitly disabled in the catalog', () => {
  const accountConfig = {
    model: 'disabled-model',
    modelCatalog: [{ id: 'disabled-model', kind: 'text', enabled: false }]
  };
  const result = applyEngineConfigInheritance({}, accountConfig);
  assert.equal(result.textModelId, undefined);
});

test('engine inheritance works for legacy configs without a catalog and tolerates missing config', () => {
  assert.equal(applyEngineConfigInheritance({}, { model: 'legacy-model' }).textModelId, 'legacy-model');
  assert.deepEqual(applyEngineConfigInheritance({}, null), {});
  assert.deepEqual(applyEngineConfigInheritance({ keep: 1 }, { model: '' }), { keep: 1 });
});
