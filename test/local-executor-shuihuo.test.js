const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LOCAL_EXECUTOR_VIDEO_MODEL,
  buildLocalVideoPayload,
  localTaskView,
  localMediaView,
  localExecutorAvailability,
  createLocalExecutorTaskStore
} = require('../lib/local-executor-shuihuo');

test('local executor video model has numeric id for batch selector', () => {
  assert.equal(typeof LOCAL_EXECUTOR_VIDEO_MODEL.id, 'number');
  assert.equal(LOCAL_EXECUTOR_VIDEO_MODEL.kind, 'video');
  assert.equal(LOCAL_EXECUTOR_VIDEO_MODEL.adapterKind, 'local_executor_video');
});

test('prompt-only segment creates a valid text-to-video payload', () => {
  const payload = buildLocalVideoPayload({ projectId: 7, segment: { id: 12, videoPrompt: '雨夜追车' } });
  assert.deepEqual(payload, { projectId: 7, segmentId: 12, prompt: '雨夜追车', images: [] });
});

test('successful local executor job maps back to source task and video media', () => {
  const mapping = { sourceTaskId: 'lev_1', localJobId: 'lej_1', projectId: 7, segmentId: 12, modelId: 7801001, createdAt: '2026-09-01T00:00:00Z' };
  const job = { id: 'lej_1', state: 'succeeded', artifactId: 'lea_abc', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:02:00Z' };
  const task = localTaskView(mapping, job);
  const media = localMediaView(mapping, job);
  assert.equal(task.id, 'lev_1');
  assert.equal(task.status, 'succeeded');
  assert.equal(task.providerTaskId, 'lej_1');
  assert.equal(media.taskId, 'lev_1');
  assert.equal(media.segmentId, 12);
  assert.equal(media.kind, 'video');
  assert.equal(media.id, 'lexmedia_lea_abc');
});

test('task mapping store persists and isolates owners', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-store-'));
  const filePath = path.join(dir, 'tasks.json');
  const store = createLocalExecutorTaskStore({ filePath });
  store.upsert('alice', { sourceTaskId: 'lev_1', localJobId: 'lej_1', projectId: 7, segmentId: 12, modelId: 7801001 });
  store.upsert('bob', { sourceTaskId: 'lev_2', localJobId: 'lej_2', projectId: 7, segmentId: 13, modelId: 7801001 });
  const reopened = createLocalExecutorTaskStore({ filePath });
  assert.deepEqual(reopened.list('alice', 7).map(x => x.sourceTaskId), ['lev_1']);
  assert.equal(reopened.find('bob', 'lev_1'), null);
  reopened.upsert('alice', { sourceTaskId: 'lev_1', localJobId: 'lej_retry', projectId: 7, segmentId: 12, modelId: 7801001 });
  assert.equal(reopened.find('alice', 'lev_1').localJobId, 'lej_retry');
});

test('local executor is ready only when an online account can still run video', () => {
  assert.equal(localExecutorAvailability([]).ready, false);
  assert.equal(localExecutorAvailability([{ online: false, accounts: { available: 1 } }]).ready, false);
  assert.equal(localExecutorAvailability([{ online: true, accounts: { quotaExhausted: 2, available: 0, busy: 0 } }]).ready, false);
  assert.deepEqual(localExecutorAvailability([{ online: true, accounts: { available: 0, busy: 1 } }]), { ready: true, reason: '' });
  assert.deepEqual(localExecutorAvailability([{ online: true, accounts: { available: 1, busy: 0 } }]), { ready: true, reason: '' });
});
