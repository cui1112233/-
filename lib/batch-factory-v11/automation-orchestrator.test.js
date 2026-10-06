const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBatchFactoryAutomationController, effectiveSettings, mergeState, targetVideoState, retryableAutomationError } = require('./automation-orchestrator');

async function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}

function makeBook(overrides = {}) {
  return {
    id: 'book-1',
    title: '测试书',
    workingFrontContent: '这是一段可用于生产的真实小说正文。',
    directorRevision: { id: 'rev-1' },
    assetRecords: [{ id: 'asset-1' }],
    videos: [
      { id: 'video-1', label: 'VIDEO01', settingsState: { patch: {} } },
      { id: 'video-2', label: 'VIDEO02', settingsState: { patch: {} } }
    ],
    settingsState: { patch: { openingEnabled: true } },
    ...overrides
  };
}

function makeAdapter({ book, runs = [], runStageCalls }) {
  const batch = { id: 'batch-1', books: [book], settingsState: { patch: {} } };
  return {
    loadBatch: async () => batch,
    getStageSummary: async () => ({ runs }),
    getProductionStatus: async () => ({ jobs: [] }),
    getMergeStatus: async () => ({ jobs: [] }),
    runStage: async payload => { runStageCalls.push(payload); return { ok: true }; }
  };
}

function makeController(adapter) {
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-orchestrator-test-')), 'automation.json');
  return createBatchFactoryAutomationController({ adapter, statePath, logger: { error() {} } });
}

test('provider content-policy rejection is terminal instead of consuming automatic retries', () => {
  assert.equal(retryableAutomationError(new Error('内容不符合平台规范，请调整提示词或图片后重试')), false);
});

test('giant-material direct-source preflight honors the configured book concurrency', async t => {
  const books = Array.from({ length: 5 }, (_, index) => makeBook({
    id: `book-${index + 1}`,
    title: `巨量书 ${index + 1}`,
    workingFrontContent: '',
    sourceText: '',
    sourceMetadata: { sourceMode: 'giant_material' }
  }));
  let activeReads = 0;
  let maxActiveReads = 0;
  let completedReads = 0;
  const controller = makeController({
    loadBatch: async () => ({ id: 'batch-1', books, settingsState: { patch: {} } }),
    fetchDirectSource: async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise(resolve => setTimeout(resolve, 30));
      activeReads -= 1;
      completedReads += 1;
      return { state: 'succeeded', characters: 100 };
    },
    getProductionStatus: async () => ({ jobs: [] }),
    getMergeStatus: async () => ({ jobs: [] }),
    runStage: async () => ({ ok: true })
  });
  t.after(async () => { await controller.cancel({ owner: 'alice', batchId: 'batch-1' }); });

  await controller.start({ owner: 'alice', batchId: 'batch-1', concurrency: 2 });
  assert.equal(await waitFor(() => completedReads === books.length), true);
  assert.equal(maxActiveReads, 2);
});

test('active automation schedules its expensive batch refresh no faster than the public status refresh', async t => {
  const scheduled = [];
  const originalSetInterval = global.setInterval;
  global.setInterval = (_handler, delay) => {
    scheduled.push(delay);
    return { unref() {} };
  };
  t.after(() => { global.setInterval = originalSetInterval; });

  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-orchestrator-poll-')), 'automation.json');
  const controller = createBatchFactoryAutomationController({
    statePath,
    recoveryEnabled: false,
    adapter: {
      loadBatch: async () => ({ id: 'batch-1', books: [], settingsState: { patch: {} } }),
      getProductionStatus: async () => ({ jobs: [] }),
      getMergeStatus: async () => ({ jobs: [] }),
      runStage: async () => ({})
    },
    logger: { error() {} }
  });

  await controller.start({ owner: 'alice', batchId: 'batch-1' });

  assert.deepEqual(scheduled, [15_000]);
});

test('legacy repair evidence is detached, scoped and requires applied book markers', () => {
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-repair-evidence-')), 'automation.json');
  fs.writeFileSync(statePath, JSON.stringify({ jobs: { 'alice:batch-1': {
    owner: 'alice', batchId: 'batch-1', state: 'paused', configSnapshot: { textModelId: 'old' },
    books: { copied: { bookId: 'copied', executionSnapshotApplied: true }, manual: { bookId: 'manual' } }
  } } }));
  const controller = createBatchFactoryAutomationController({ statePath, adapter: { loadBatch: async () => ({}), runStage: async () => ({}) }, recoveryEnabled: false });
  const evidence = controller.legacyConfigSnapshot({ owner: 'alice', batchId: 'batch-1' });
  assert.deepEqual(evidence, { owner: 'alice', batchId: 'batch-1', configSnapshot: { textModelId: 'old' }, appliedBookIds: ['copied'] });
  evidence.configSnapshot.textModelId = 'changed';
  evidence.appliedBookIds.push('manual');
  assert.equal(controller.legacyConfigSnapshot({ owner: 'alice', batchId: 'batch-1' }).configSnapshot.textModelId, 'old');
  assert.deepEqual(controller.legacyConfigSnapshot({ owner: 'alice', batchId: 'batch-1' }).appliedBookIds, ['copied']);
  assert.equal(controller.legacyConfigSnapshot({ owner: 'bob', batchId: 'batch-1' }), null);
  assert.equal(controller.legacyConfigSnapshot({ owner: 'alice', batchId: 'missing' }), null);
});

for (const jobs of [
  { 'alice:batch-1': { owner: 'alice', batchId: 'batch-1', configSnapshot: [] } },
  { 'alice:batch-1': { owner: 'bob', batchId: 'batch-1', configSnapshot: { textModelId: 'old' } } },
  { 'alice:batch-1': { owner: 'alice', batchId: 'batch-1', configSnapshot: { textModelId: 'old' } }, duplicate: { owner: 'alice', batchId: 'batch-1', configSnapshot: { textModelId: 'different' } } }
]) {
  test('malformed or ambiguous historical jobs provide no repair evidence', () => {
    const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-repair-invalid-')), 'automation.json');
    fs.writeFileSync(statePath, JSON.stringify({ jobs }));
    const controller = createBatchFactoryAutomationController({ statePath, adapter: { loadBatch: async () => ({}), runStage: async () => ({}) }, recoveryEnabled: false });
    assert.equal(controller.legacyConfigSnapshot({ owner: 'alice', batchId: 'batch-1' }), null);
  });
}

test('reads a later batch model change for an inheriting book', () => {
  assert.equal(effectiveSettings(
    { settingsState: { patch: { textModelId: 'text-new' } } },
    { settingsState: { patch: {} } }
  ).textModelId, 'text-new');
});

test('keeps an explicit book model over the batch default', () => {
  assert.equal(effectiveSettings(
    { settingsState: { patch: { textModelId: 'text-batch' } } },
    { settingsState: { patch: { textModelId: 'text-book' } } }
  ).textModelId, 'text-book');
});

test('keeps an explicit blank book model instead of restoring the batch model', () => {
  const settings = effectiveSettings(
    { settingsState: { patch: { textModelId: 'text-batch' } } },
    { settingsState: { patch: { textModelId: '' } } }
  );
  assert.equal(Object.hasOwn(settings, 'textModelId'), true);
  assert.equal(settings.textModelId, '');
});

test('ignores a historical job snapshot while merging sparse publish overrides', () => {
  assert.deepEqual(effectiveSettings(
    { settingsState: { patch: { textModelId: 'text-new', publishSettings: { organization: 'current-org', category: 'NEW_BOOK' } } } },
    { settingsState: { patch: { publishSettings: { category: 'FINISHED_BOOK' } } } },
    { configSnapshot: { textModelId: 'text-old', publishSettings: { organization: 'old-org' } } }
  ), {
    textModelId: 'text-new',
    publishSettings: { organization: 'current-org', category: 'FINISHED_BOOK' }
  });
});

test('merges sparse book prompt overrides without removing unified prompt modules', () => {
  assert.deepEqual(effectiveSettings(
    { settingsState: { patch: { aiPromptConfig: { assets: { enabled: true }, visual: { enabled: true } } } } },
    { settingsState: { patch: { aiPromptConfig: { visual: { enabled: false } } } } }
  ).aiPromptConfig, {
    assets: { enabled: true },
    visual: { enabled: false }
  });
});

test('scheduled stages use the current batch model without freezing sparse book overrides', async () => {
  let timestamp = Date.parse('2026-10-02T10:00:00.000Z');
  const book = makeBook({ assetRecords: [], settingsState: { patch: {} } });
  const batch = { id: 'batch-1', books: [book], settingsState: { patch: { textModelId: 'text-old' } } };
  const calls = [];
  let snapshotApplications = 0;
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-live-settings-test-')), 'automation.json');
  const controller = createBatchFactoryAutomationController({
    statePath,
    now: () => timestamp,
    logger: { error() {} },
    adapter: {
      ...makeAdapter({ book, runStageCalls: calls }),
      loadBatch: async () => batch,
      applyExecutionSnapshot: async ({ configSnapshot }) => {
        snapshotApplications += 1;
        book.settingsState.patch = { ...configSnapshot };
      }
    }
  });
  try {
    await controller.start({
      owner: 'alice', batchId: batch.id,
      scheduledAt: '2026-10-02T10:01:00.000Z',
      configSnapshot: { textModelId: 'text-old' }
    });
    batch.settingsState.patch.textModelId = 'text-new';
    timestamp += 60_000;
    await controller.tick();
    assert.equal(await waitFor(() => calls.length > 0 || snapshotApplications > 0), true);
    assert.equal(snapshotApplications, 0);
    assert.equal(calls[0].stage, 'assets');
    assert.equal(calls[0].settings.textModelId, 'text-new');
    assert.deepEqual(book.settingsState.patch, {});
    await controller.pause({ owner: 'alice', batchId: batch.id });
    const saved = Object.values(JSON.parse(fs.readFileSync(statePath, 'utf8')).jobs)[0];
    assert.equal(Object.hasOwn(saved, 'configSnapshot'), false);
  } finally {
    await controller.pause({ owner: 'alice', batchId: batch.id });
  }
});

for (const recovery of [false, true]) {
  test(`${recovery ? 'source-arrival recovery' : 'explicit restart'} preserves legacy snapshot evidence while stages use live settings`, async () => {
    let timestamp = Date.parse('2026-10-02T10:00:00.000Z');
    const legacySnapshot = { textModelId: 'legacy-text', publishSettings: { organization: 'legacy-org' } };
    const book = makeBook({ assetRecords: [], settingsState: { patch: {} } });
    if (recovery) book.sourceMetadata = {
      sourceMode: 'giant_material',
      giantAutomationPlan: { presetId: 'preset-1', runMode: 'storyboard_only', concurrency: 1 }
    };
    const batch = { id: 'batch-1', books: [book], settingsState: { patch: { textModelId: 'text-current' } } };
    const calls = [];
    let snapshotApplications = 0;
    let recoveries = 0;
    const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-legacy-evidence-test-')), 'automation.json');
    fs.writeFileSync(statePath, JSON.stringify({ version: 1, jobs: { 'alice:batch-1': {
      id: 'legacy-job', owner: 'alice', batchId: batch.id,
      state: recovery ? 'needs_attention' : 'paused',
      configSnapshot: legacySnapshot,
      books: { [book.id]: {
        bookId: book.id, status: recovery ? 'failed' : 'pending',
        stage: recovery ? 'source' : 'configuration', executionSnapshotApplied: true
      } }
    } } }));
    const controller = createBatchFactoryAutomationController({
      statePath, now: () => timestamp, recoveryEnabled: false, logger: { error() {} },
      adapter: {
        ...makeAdapter({ book, runStageCalls: calls }),
        loadBatch: async () => batch,
        applyExecutionSnapshot: async () => { snapshotApplications += 1; },
        listOwners: () => ['alice'],
        listBatches: async () => [batch],
        startRecovery: async ({ owner, isOwner, batch: current, savedPlan }) => {
          recoveries += 1;
          return controller.start({ owner, isOwner, batchId: current.id, ...savedPlan });
        }
      }
    });
    try {
      if (recovery) await controller.runRecovery();
      else await controller.start({ owner: 'alice', batchId: batch.id, scheduledAt: '2026-10-02T10:01:00.000Z' });
      const saved = Object.values(JSON.parse(fs.readFileSync(statePath, 'utf8')).jobs)[0];
      assert.equal(saved.id, 'legacy-job');
      assert.deepEqual(saved.configSnapshot, legacySnapshot);
      assert.equal(saved.books[book.id].executionSnapshotApplied, true);
      if (!recovery) {
        timestamp += 60_000;
        await controller.tick();
      }
      assert.equal(await waitFor(() => calls.length > 0), true);
      assert.equal(calls[0].stage, 'assets');
      assert.equal(calls[0].settings.textModelId, 'text-current');
      assert.equal(snapshotApplications, 0);
      assert.deepEqual(book.settingsState.patch, {});
      assert.equal(recoveries, recovery ? 1 : 0);
      await controller.pause({ owner: 'alice', batchId: batch.id });
      const afterStage = Object.values(JSON.parse(fs.readFileSync(statePath, 'utf8')).jobs)[0];
      assert.deepEqual(afterStage.configSnapshot, legacySnapshot);
      assert.equal(afterStage.books[book.id].executionSnapshotApplied, true);
    } finally {
      await controller.pause({ owner: 'alice', batchId: batch.id });
    }
  });
}

test('mergeState returns empty aggregates when the book has no jobs', () => {
  const state = mergeState({ jobs: [] }, 'book-1');
  assert.deepEqual(state.jobs, []);
  assert.deepEqual(state.latest, []);
  assert.equal(state.succeeded, null);
  assert.deepEqual(state.allSucceeded, []);
  assert.equal(state.active, undefined);
  assert.equal(state.failed, undefined);
});

test('mergeState keeps succeeded null while any job is still active', () => {
  const state = mergeState({
    jobs: [
      { id: 'j1', bookId: 'book-1', status: 'succeeded', outputUrl: 'https://example.com/a.mp4', updatedAt: '2026-09-30T10:00:00Z' },
      { id: 'j2', bookId: 'book-1', status: 'running', updatedAt: '2026-09-30T10:01:00Z' }
    ]
  }, 'book-1');
  assert.equal(state.succeeded, null);
  assert.equal(state.active?.id, 'j2');
  assert.equal(state.allSucceeded.length, 0);
  assert.equal(state.latest.length, 1);
});

test('mergeState aggregates all succeeded jobs once every variant finished', () => {
  const state = mergeState({
    jobs: [
      { id: 'j1', bookId: 'book-1', openingVariantIndex: 0, status: 'succeeded', outputUrl: 'https://example.com/a.mp4', updatedAt: '2026-09-30T10:00:00Z' },
      { id: 'j2', bookId: 'book-1', openingVariantIndex: 1, status: 'succeeded', outputUrl: 'https://example.com/b.mp4', updatedAt: '2026-09-30T10:01:00Z' }
    ]
  }, 'book-1');
  assert.equal(state.succeeded.length, 2);
  assert.deepEqual(state.succeeded.map(job => job.id), ['j1', 'j2']);
  assert.equal(state.allSucceeded.length, 2);
  assert.equal(state.latest.length, 2);
  assert.equal(state.active, undefined);
  assert.equal(state.failed, undefined);
});

test('mergeState treats a failed job as blocking success', () => {
  const state = mergeState({
    jobs: [
      { id: 'j1', bookId: 'book-1', status: 'succeeded', outputUrl: 'https://example.com/a.mp4', updatedAt: '2026-09-30T10:00:00Z' },
      { id: 'j2', bookId: 'book-1', status: 'failed', errorMessage: 'boom', updatedAt: '2026-09-30T10:01:00Z' }
    ]
  }, 'book-1');
  assert.equal(state.succeeded, null);
  assert.equal(state.failed?.id, 'j2');
});

test('mergeState counts cancelled jobs as failed (regression guard)', () => {
  const state = mergeState({
    jobs: [
      { id: 'j1', bookId: 'book-1', status: 'succeeded', outputUrl: 'https://example.com/a.mp4', updatedAt: '2026-09-30T10:00:00Z' },
      { id: 'j2', bookId: 'book-1', status: 'cancelled', updatedAt: '2026-09-30T10:01:00Z' }
    ]
  }, 'book-1');
  assert.equal(state.succeeded, null);
  assert.equal(state.failed?.id, 'j2');
});

test('mergeState ignores jobs belonging to other books', () => {
  const state = mergeState({
    jobs: [
      { id: 'j1', bookId: 'book-2', status: 'succeeded', outputUrl: 'https://example.com/a.mp4', updatedAt: '2026-09-30T10:00:00Z' },
      { id: 'j2', bookId: 'book-1', status: 'succeeded', outputUrl: 'https://example.com/b.mp4', updatedAt: '2026-09-30T10:01:00Z' }
    ]
  }, 'book-1');
  assert.equal(state.jobs.length, 1);
  assert.equal(state.succeeded.length, 1);
  assert.equal(state.succeeded[0].id, 'j2');
});

test('mergeState lets a retried variant recover from an earlier failure', () => {
  const state = mergeState({
    jobs: [
      { id: 'j1', bookId: 'book-1', openingVariantIndex: 0, status: 'failed', errorMessage: 'boom', updatedAt: '2026-09-30T10:00:00Z' },
      { id: 'j2', bookId: 'book-1', openingVariantIndex: 0, status: 'succeeded', outputUrl: 'https://example.com/a.mp4', updatedAt: '2026-09-30T10:01:00Z' }
    ]
  }, 'book-1');
  assert.equal(state.failed, undefined);
  assert.equal(state.active, undefined);
  assert.ok(Array.isArray(state.succeeded));
  assert.equal(state.succeeded.length, 1);
  assert.equal(state.succeeded[0].id, 'j2');
});

test('mergeState judges each variant by its newest job only', () => {
  const state = mergeState({
    jobs: [
      { id: 'j1', bookId: 'book-1', openingVariantIndex: 0, status: 'succeeded', outputUrl: 'https://example.com/a.mp4', updatedAt: '2026-09-30T10:00:00Z' },
      { id: 'j2', bookId: 'book-1', openingVariantIndex: 1, status: 'succeeded', outputUrl: 'https://example.com/b.mp4', updatedAt: '2026-09-30T10:01:00Z' },
      { id: 'j3', bookId: 'book-1', openingVariantIndex: 1, status: 'failed', errorMessage: 'boom', updatedAt: '2026-09-30T10:02:00Z' }
    ]
  }, 'book-1');
  assert.equal(state.succeeded, null);
  assert.equal(state.failed?.id, 'j3');
  assert.equal(state.latest.length, 2);
  assert.equal(state.allSucceeded.length, 1);
});

function variantBook() {
  return {
    id: 'book-1',
    videos: [
      {
        id: 'video-1',
        label: 'VIDEO01',
        settingsState: {
          patch: {
            openingVariants: [
              { index: 1, label: '变体1', prompt: '开场一', status: 'success', durationSec: 2.5 },
              { index: 2, label: '变体2', prompt: '开场二', status: 'success', durationSec: 2.5 }
            ]
          }
        }
      },
      { id: 'video-2', label: 'VIDEO02', settingsState: { patch: {} } }
    ]
  };
}

function productionWithTasks(tasks) {
  return { jobs: [{ id: 'job-1', bookId: 'book-1', tasks }] };
}

test('targetVideoState keeps the book unready while successful variants lack tasks', () => {
  const state = targetVideoState(variantBook(), { openingEnabled: true, openingCount: 3 }, productionWithTasks([
    { videoId: 'video-1', openingVariantIndex: 0, status: 'succeeded', mediaUrl: 'https://example.com/v0.mp4' },
    { videoId: 'video-2', status: 'succeeded', mediaUrl: 'https://example.com/v2.mp4' }
  ]));
  assert.equal(state.ready, false);
  assert.equal(state.succeeded.length, 2);
  assert.equal(state.missing.length, 2);
  assert.deepEqual(state.missing.map(item => item.variantIndex), [1, 2]);
});

test('targetVideoState surfaces failed and active variant tasks for the opening video', () => {
  const state = targetVideoState(variantBook(), { openingEnabled: true, openingCount: 3 }, productionWithTasks([
    { videoId: 'video-1', openingVariantIndex: 0, status: 'succeeded', mediaUrl: 'https://example.com/v0.mp4' },
    { videoId: 'video-1', openingVariantIndex: 1, status: 'failed', errorMessage: 'boom' },
    { videoId: 'video-1', openingVariantIndex: 2, status: 'running' },
    { videoId: 'video-2', status: 'succeeded', mediaUrl: 'https://example.com/v2.mp4' }
  ]));
  assert.equal(state.ready, false);
  assert.equal(state.failed.length, 1);
  assert.equal(state.failed[0].variantIndex, 1);
  assert.equal(state.failed[0].video.id, 'video-1');
  assert.equal(state.active.length, 1);
  assert.equal(state.active[0].variantIndex, 2);
});

test('targetVideoState reports ready once every successful variant has a merged video', () => {
  const state = targetVideoState(variantBook(), { openingEnabled: true, openingCount: 3 }, productionWithTasks([
    { videoId: 'video-1', openingVariantIndex: 0, status: 'succeeded', mediaUrl: 'https://example.com/v0.mp4' },
    { videoId: 'video-1', openingVariantIndex: 1, status: 'succeeded', mediaUrl: 'https://example.com/v1.mp4' },
    { videoId: 'video-1', openingVariantIndex: 2, status: 'succeeded', mediaUrl: 'https://example.com/v2a.mp4' },
    { videoId: 'video-2', status: 'succeeded', mediaUrl: 'https://example.com/v2.mp4' }
  ]));
  assert.equal(state.ready, true);
  assert.equal(state.succeeded.length, 4);
});

test('targetVideoState ignores variants when opening is disabled', () => {
  const state = targetVideoState(variantBook(), { openingEnabled: false }, productionWithTasks([
    { videoId: 'video-1', status: 'succeeded', mediaUrl: 'https://example.com/v0.mp4' },
    { videoId: 'video-2', status: 'succeeded', mediaUrl: 'https://example.com/v2.mp4' }
  ]));
  assert.equal(state.ready, true);
  assert.equal(state.succeeded.length, 2);
});

test('automation runs the opening stage before video when variants are not ready', async () => {
  const runStageCalls = [];
  const adapter = makeAdapter({ book: makeBook(), runs: [], runStageCalls });
  const controller = makeController(adapter);
  await controller.start({ owner: 'alice', batchId: 'batch-1' });
  const seen = await waitFor(() => runStageCalls.length > 0);
  await controller.cancel({ owner: 'alice', batchId: 'batch-1' });
  assert.equal(seen, true);
  assert.equal(runStageCalls[0].stage, 'opening');
});

test('automation skips the opening stage when successful variants already exist', async () => {
  const runStageCalls = [];
  const book = makeBook();
  book.settingsState.patch.openingCount = 2;
  book.videos[0].settingsState.patch.openingVariants = [
    { index: 1, label: '变体1', prompt: '新的开场', status: 'success', durationSec: 2.5 }
  ];
  const adapter = makeAdapter({ book, runs: [], runStageCalls });
  const controller = makeController(adapter);
  await controller.start({ owner: 'alice', batchId: 'batch-1' });
  const seen = await waitFor(() => runStageCalls.length > 0);
  await controller.cancel({ owner: 'alice', batchId: 'batch-1' });
  assert.equal(seen, true);
  assert.equal(runStageCalls.some(call => call.stage === 'opening'), false);
});

test('automation reruns opening when only some required variants succeeded', async () => {
  const runStageCalls = [];
  const book = makeBook();
  book.settingsState.patch.openingCount = 4;
  book.videos[0].settingsState.patch.openingVariants = [
    { index: 1, label: '变体1', prompt: '只有一个开场', status: 'success', durationSec: 2.5 },
    { index: 2, label: '变体2', prompt: '', status: 'failed', failureReason: '格式错误' }
  ];
  const adapter = makeAdapter({ book, runs: [], runStageCalls });
  const controller = makeController(adapter);
  await controller.start({ owner: 'alice', batchId: 'batch-1' });
  const seen = await waitFor(() => runStageCalls.length > 0);
  await controller.cancel({ owner: 'alice', batchId: 'batch-1' });
  assert.equal(seen, true);
  assert.equal(runStageCalls[0].stage, 'opening');
});

test('automation trusts saved required variants instead of a stale opening success run', async () => {
  const runStageCalls = [];
  const book = makeBook();
  book.settingsState.patch.openingCount = 3;
  book.videos[0].settingsState.patch.openingVariants = [
    { index: 1, label: '变体1', prompt: '开场一', status: 'success', durationSec: 2.5 },
    { index: 2, label: '变体2', prompt: '', status: 'failed', failureReason: '旧格式缺少时长' }
  ];
  const adapter = makeAdapter({
    book,
    runs: [{ stage: 'opening', status: 'succeeded', inputRevision: 'rev-1' }],
    runStageCalls
  });
  const controller = makeController(adapter);
  await controller.start({ owner: 'alice', batchId: 'batch-1' });
  const seen = await waitFor(() => runStageCalls.length > 0);
  await controller.cancel({ owner: 'alice', batchId: 'batch-1' });
  assert.equal(seen, true);
  assert.equal(runStageCalls[0].stage, 'opening');
});

test('automation regenerates opening variants when the director revision changed', async () => {
  const runStageCalls = [];
  const adapter = makeAdapter({
    book: makeBook(),
    runs: [{ stage: 'opening', status: 'succeeded', inputRevision: 'rev-old' }],
    runStageCalls
  });
  const controller = makeController(adapter);
  await controller.start({ owner: 'alice', batchId: 'batch-1' });
  const seen = await waitFor(() => runStageCalls.length > 0);
  await controller.cancel({ owner: 'alice', batchId: 'batch-1' });
  assert.equal(seen, true);
  assert.equal(runStageCalls.some(call => call.stage === 'opening'), true);
});

test('automation skips the opening stage when openingEnabled is off', async () => {
  const runStageCalls = [];
  const book = makeBook();
  book.settingsState.patch.openingEnabled = false;
  const adapter = makeAdapter({ book, runs: [], runStageCalls });
  const controller = makeController(adapter);
  await controller.start({ owner: 'alice', batchId: 'batch-1' });
  const seen = await waitFor(() => runStageCalls.length > 0);
  await controller.cancel({ owner: 'alice', batchId: 'batch-1' });
  assert.equal(seen, true);
  assert.equal(runStageCalls.some(call => call.stage === 'opening'), false);
});

test('explicit failed-book retry clears every stage attempt budget for that book', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-retry-ledger-test-'));
  const statePath = path.join(directory, 'automation.json');
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, jobs: {
    'alice:batch-1': {
      id: 'job-1', owner: 'alice', batchId: 'batch-1', state: 'needs_attention',
      books: {
        'book-1': {
          bookId: 'book-1', title: '测试书', status: 'failed', stage: 'video',
          directSourceRetryKey: 'source:stale',
          directSourceError: '旧的书城读取错误',
          retryKey: 'video:current', retryLedger: {
            'opening:required-before-video': { attempts: 3 },
            'video:current': { attempts: 1 }
          }
        }
      }
    }
  } }));
  const never = new Promise(() => {});
  const controller = createBatchFactoryAutomationController({
    statePath,
    recoveryEnabled: false,
    logger: { error() {} },
    adapter: { loadBatch: async () => never, runStage: async () => ({}) }
  });
  await controller.retry({ owner: 'alice', batchId: 'batch-1', bookIds: ['book-1'] });
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8')).jobs['alice:batch-1'].books['book-1'];
  assert.deepEqual(saved.retryLedger, {});
  assert.equal(saved.directSourceRetryKey, '');
  assert.equal(saved.directSourceError, '');
  await controller.pause({ owner: 'alice', batchId: 'batch-1' });
});

test('service restart resumes a stale needs_attention job when no book is failed or blocked', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-restart-resume-test-'));
  const statePath = path.join(directory, 'automation.json');
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, jobs: {
    'alice:batch-1': {
      id: 'job-1', owner: 'alice', batchId: 'batch-1', state: 'needs_attention',
      books: {
        'book-1': {
          bookId: 'book-1', title: '测试书', status: 'waiting', stage: 'opening',
          retryAt: '2026-10-02T10:00:00.000Z', retryCount: 1
        }
      }
    }
  } }));
  const never = new Promise(() => {});
  const controller = createBatchFactoryAutomationController({
    statePath,
    recoveryEnabled: false,
    pollMs: 60_000,
    logger: { error() {} },
    adapter: { loadBatch: async () => never, runStage: async () => ({}) }
  });
  assert.equal(controller.status({ owner: 'alice', batchId: 'batch-1' }).state, 'running');
  await controller.pause({ owner: 'alice', batchId: 'batch-1' });
});

test('transient job-level failures keep backing off until the bridge recovers', async () => {
  let timestamp = Date.parse('2026-10-02T10:00:00.000Z');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-job-retry-test-'));
  const statePath = path.join(directory, 'automation.json');
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, jobs: {
    'alice:batch-1': {
      id: 'job-1', owner: 'alice', batchId: 'batch-1', state: 'running',
      books: { 'book-1': { bookId: 'book-1', title: '测试书', status: 'pending', stage: 'pending' } }
    }
  } }));
  let loadAttempts = 0;
  const controller = createBatchFactoryAutomationController({
    statePath,
    now: () => timestamp,
    recoveryEnabled: false,
    pollMs: 60_000,
    logger: { error() {} },
    adapter: {
      loadBatch: async () => {
        loadAttempts += 1;
        if (loadAttempts <= 3) throw new Error('fetch failed');
        return { id: 'batch-1', books: [] };
      },
      getProductionStatus: async () => ({ jobs: [] }),
      getMergeStatus: async () => ({ jobs: [] }),
      runStage: async () => ({})
    }
  });
  const savedJob = () => JSON.parse(fs.readFileSync(statePath, 'utf8')).jobs['alice:batch-1'];
  assert.equal(await waitFor(() => savedJob().jobRetryCount === 1), true);
  assert.equal(controller.status({ owner: 'alice', batchId: 'batch-1' }).state, 'running');

  timestamp += 30_001;
  await controller.tick();
  assert.equal(await waitFor(() => savedJob().jobRetryCount === 2), true);

  timestamp += 120_001;
  await controller.tick();
  assert.equal(await waitFor(() => savedJob().jobRetryCount === 3), true);
  assert.equal(savedJob().state, 'running');
  assert.equal(savedJob().jobRetryCount, 3);

  timestamp += 300_001;
  await controller.tick();
  assert.equal(await waitFor(() => savedJob().jobRetryCount === 0), true);
  assert.equal(loadAttempts, 4);
});

test('service restart revives an exhausted transient job while unfinished books remain', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-job-retry-exhausted-test-'));
  const statePath = path.join(directory, 'automation.json');
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, jobs: {
    'alice:batch-1': {
      id: 'job-1', owner: 'alice', batchId: 'batch-1', state: 'needs_attention', jobRetryCount: 3,
      lastError: 'fetch failed · 总调度连续失败 3 次，已停止',
      books: {
        'book-1': { bookId: 'book-1', title: '失败书', status: 'failed', stage: 'assets' },
        'book-2': { bookId: 'book-2', title: '待生产书', status: 'pending', stage: 'pending' }
      }
    }
  } }));
  const controller = createBatchFactoryAutomationController({
    statePath,
    recoveryEnabled: false,
    logger: { error() {} },
    adapter: { loadBatch: async () => ({}), runStage: async () => ({}) }
  });
  assert.equal(controller.status({ owner: 'alice', batchId: 'batch-1' }).state, 'running');
});

test('non-retryable job-level authentication failure stops immediately', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-job-hard-failure-test-'));
  const statePath = path.join(directory, 'automation.json');
  const controller = createBatchFactoryAutomationController({
    statePath,
    recoveryEnabled: false,
    pollMs: 60_000,
    logger: { error() {} },
    adapter: {
      loadBatch: async () => { throw new Error('unauthorized'); },
      runStage: async () => ({})
    }
  });
  await assert.rejects(controller.start({ owner: 'alice', batchId: 'batch-1' }), /unauthorized/);
});
