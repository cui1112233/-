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

test('automation advances a book to ready_for_upload without uploading', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { adapter } = fixture();
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 1 });
  for (let i = 0; i < 10; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.state, 'completed');
  assert.equal(status.counts.ready, 1);
  assert.equal(status.books[0].stage, 'ready_for_upload');
  assert.match(status.books[0].message, /等待人工上传/);
});

test('storyboard-only automation stops after director compilation and never submits VIDEO', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { adapter } = fixture();
  const stages = [];
  adapter.runStage = async ({ book, stage }) => {
    stages.push(stage);
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
  assert.deepEqual(appliedSnapshot, { textModelId: 'text-a' });
  assert.deepEqual(stages, ['assets', 'director']);
  assert.equal(compileCalls, 1);
  assert.equal(status.books[0].stage, 'ready_for_video');
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

test('full-submit upload receives the frozen publish settings instead of live batch settings', async () => {
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
  assert.deepEqual(publishSettings, { organization: 'frozen-org', category: 'FROZEN' });
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
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 2 });
  await controller.tick();
  await wait();
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.books[0].status, 'failed');
  assert.equal(status.books[0].retryCount, 0);
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

test('automation freezes a deep copy of the selected unified preset at start', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { adapter } = fixture();
  let currentTime = 0;
  let appliedSnapshot = null;
  adapter.applyExecutionSnapshot = async ({ configSnapshot: value }) => { appliedSnapshot = value; };
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} }, now: () => currentTime });
  const configSnapshot = { textModelId: 'frozen-text', publishSettings: { organization: 'frozen-org' }, aiPromptConfig: { constraints: { baseSetup: { enabled: false } } } };
  await controller.start({ owner: 'user', batchId: 'batch-1', scheduledAt: '1970-01-01T00:00:01.000Z', runMode: 'storyboard_only', preset: { id: 'preset-1', name: '夜间 H3', version: 1 }, configSnapshot });
  configSnapshot.publishSettings.organization = 'mutated-org';
  configSnapshot.aiPromptConfig.constraints.baseSetup.enabled = true;
  currentTime = 1_000;
  for (let index = 0; index < 4; index += 1) { await controller.tick(); await wait(); }
  assert.equal(appliedSnapshot.publishSettings.organization, 'frozen-org');
  assert.equal(appliedSnapshot.aiPromptConfig.constraints.baseSetup.enabled, false);
});

test('one blocked book does not erase another completed book', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-auto-test-'));
  const { batch, adapter } = fixture();
  batch.books.push({ id: 'book-2', bookId: '102', title: '缺正文', sourceText: '', settingsState: { patch: {} }, videos: [] });
  const controller = createBatchFactoryAutomationController({ adapter, statePath: path.join(directory, 'state.json'), pollMs: 60_000, logger: { error() {} } });
  await controller.start({ owner: 'user', batchId: 'batch-1', concurrency: 2 });
  for (let i = 0; i < 10; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: 'batch-1' });
  assert.equal(status.state, 'needs_attention');
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
  await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1 });
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
  for (let i = 0; i < 6; i += 1) { await controller.tick(); await wait(); }
  const status = controller.status({ owner: 'user', batchId: batch.id });
  assert.equal(status.state, 'completed');
  assert.deepEqual(modes[0], { stage: 'video', mode: 'force', videoId: 'video-1' });
});
