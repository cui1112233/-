const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBatchFactoryAutomationController, mergeState } = require('./automation-orchestrator');

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

test('mergeState returns empty aggregates when the book has no jobs', () => {
  const state = mergeState({ jobs: [] }, 'book-1');
  assert.deepEqual(state.jobs, []);
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
  assert.equal(state.allSucceeded.length, 1);
});

test('mergeState aggregates all succeeded jobs once every job finished', () => {
  const state = mergeState({
    jobs: [
      { id: 'j1', bookId: 'book-1', status: 'succeeded', outputUrl: 'https://example.com/a.mp4', updatedAt: '2026-09-30T10:00:00Z' },
      { id: 'j2', bookId: 'book-1', status: 'succeeded', outputUrl: 'https://example.com/b.mp4', updatedAt: '2026-09-30T10:01:00Z' }
    ]
  }, 'book-1');
  assert.equal(state.succeeded.length, 2);
  assert.deepEqual(state.succeeded.map(job => job.id), ['j1', 'j2']);
  assert.equal(state.allSucceeded.length, 2);
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

test('automation skips the opening stage when the opening run already succeeded (silent skip)', async () => {
  const runStageCalls = [];
  const adapter = makeAdapter({
    book: makeBook(),
    runs: [{ stage: 'opening', status: 'succeeded' }],
    runStageCalls
  });
  const controller = makeController(adapter);
  await controller.start({ owner: 'alice', batchId: 'batch-1' });
  const seen = await waitFor(() => runStageCalls.length > 0);
  await controller.cancel({ owner: 'alice', batchId: 'batch-1' });
  assert.equal(seen, true);
  assert.equal(runStageCalls.some(call => call.stage === 'opening'), false);
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
