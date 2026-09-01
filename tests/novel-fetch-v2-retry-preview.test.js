const test = require('node:test');
const assert = require('node:assert/strict');

const { createNovelFetchTaskOps } = require('../lib/novel-fetch-workshop/task-ops');

function tombstones() { return { has() { return false; }, add() {}, restore() { return false; } }; }

function createOps(records, updates = []) {
  const config = { styles: ['现代通用'] };
  const store = {
    async getConfig() { return config; },
    async getStyles() { return config.styles; },
    async listTasks() { return Object.values(records).map(item => item.meta); },
    async getTask(_owner, id) { return records[id] || null; },
    async updateTaskMeta(_owner, id, patch) { updates.push([id, patch]); Object.assign(records[id].meta, patch); return records[id].meta; },
    async readOriginal(_owner, id) { return records[id]?.document?.original || ''; },
    async readVersionText(_owner, id, version) { return records[id]?.document?.versions?.[version] || ''; }
  };
  return createNovelFetchTaskOps({
    accountResolver: owner => ({ username: owner }),
    createStore: () => store,
    tombstones: tombstones(),
    parseBooks: ({ inputText }) => ({
      parsed: inputText.trim() ? 2 : 0,
      uniqueTasks: inputText.trim() ? 2 : 0,
      duplicateCount: 0,
      emptyIdCount: 0,
      tasks: inputText.trim() ? [
        { bookId: '10000000001', bookName: 'A', sourceLine: '10000000001\tA' },
        { bookId: '10000000002', bookName: 'B', sourceLine: '10000000002\tB' }
      ] : []
    })
  });
}

test('preview input parses without saving tasks and returns selectable book rows', async () => {
  const ops = createOps({});
  const preview = await ops.previewInput('alice', { input_text: '10000000001\tA\n10000000002\tB', platform_id: '2' });
  assert.equal(preview.unique_tasks, 2);
  assert.deepEqual(preview.tasks.map(item => item.book_id), ['10000000001', '10000000002']);
  assert.equal(preview.tasks.every(item => item.selected === true), true);
});

test('manual retry payload preserves sparse targets and clears cancelled marker before queuing', async () => {
  const updates = [];
  const records = {
    '10000000001': {
      meta: {
        bookId: '10000000001', bookName: 'A', platformId: '2', platformName: '番茄付费', parseMode: 'smart', maxTxt: 4000,
        gender: '女频', style: '现代通用', tags: '爽文', reason: '推荐', rating: 'S',
        targetVersions: ['original', 'ai1', 'ai5'], aiSlotMethodsSnapshot: { ai1: 'instruction', ai5: 'high_imitation' },
        status: 'cancelled', cancelRequestedAt: '2026-09-01T00:00:00.000Z', cancelledAt: '2026-09-01T00:00:00.000Z'
      },
      document: { original: '已存在原文', versions: { ai1: '已存在AI1' } }
    }
  };
  const ops = createOps(records, updates);
  const payloads = await ops.prepareRetryPayloads('alice', ['10000000001']);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].platform_id, '2');
  assert.deepEqual(payloads[0].target_versions, ['original', 'ai1', 'ai5']);
  assert.deepEqual(payloads[0].ai_slot_methods_snapshot, { ai1: 'instruction', ai5: 'high_imitation' });
  assert.equal(Object.hasOwn(payloads[0], 'batch_id'), false, 'task retry must not create or overwrite a historical batch');
  assert.equal(records['10000000001'].meta.cancelRequestedAt, '');
  assert.equal(records['10000000001'].meta.cancelledAt, '');
  assert.equal(records['10000000001'].meta.status, 'queued');
});

test('retry-failed scope excludes cancelled tasks', async () => {
  const records = {
    a: { meta: { bookId: 'a', status: 'failed', updatedAt: '2026-09-01T08:00:00.000Z' }, document: { versions: {} } },
    b: { meta: { bookId: 'b', status: 'cancelled', updatedAt: '2026-09-01T08:00:00.000Z' }, document: { versions: {} } },
    c: { meta: { bookId: 'c', status: 'incomplete', error: 'timeout', updatedAt: '2026-09-01T08:00:00.000Z' }, document: { versions: {} } }
  };
  const ops = createOps(records);
  assert.deepEqual(await ops.abnormalIds('alice', {}, new Date('2026-09-01T12:00:00.000Z')), ['a', 'c']);
});
