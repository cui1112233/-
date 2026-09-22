const test = require('node:test');
const assert = require('node:assert/strict');
const { planNovelFetchCleanup } = require('./cleanup');

const now = new Date('2026-09-15T00:00:00.000Z');

test('自动清理只删除超过保留期的已完成任务', () => {
  const plan = planNovelFetchCleanup([
    { bookId: 'done-old', status: 'done', updatedAt: '2026-09-01T00:00:00.000Z' },
    { bookId: 'done-new', status: 'done', updatedAt: '2026-09-10T00:00:00.000Z' },
    { bookId: 'running-old', status: 'running', updatedAt: '2026-08-01T00:00:00.000Z' },
    { bookId: 'failed-old', status: 'failed', updatedAt: '2026-08-01T00:00:00.000Z' },
  ], { cleanup_enabled: true, retention_days: 7 }, now);

  assert.deepEqual(plan.deleteIds, ['done-old']);
  assert.equal(plan.kept, 3);
});

test('关闭自动清理时不删除任何任务', () => {
  const plan = planNovelFetchCleanup([
    { bookId: 'done-old', status: 'done', updatedAt: '2026-08-01T00:00:00.000Z' },
  ], { cleanup_enabled: false, retention_days: 7 }, now);

  assert.equal(plan.enabled, false);
  assert.deepEqual(plan.deleteIds, []);
});
