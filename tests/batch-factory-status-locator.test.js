const test = require('node:test');
const assert = require('node:assert/strict');

test('continuous status locator advances through matching books and wraps', async () => {
  const { nextStatusTarget } = await import('../frontend/src/user/pages/batch-factory/workbenchState.js');
  const entries = [
    { id: 'one', displayStatus: '异常' },
    { id: 'two', displayStatus: '待生成' },
    { id: 'three', displayStatus: '异常' }
  ];
  const first = nextStatusTarget(entries, '异常', '全部', 0);
  const second = nextStatusTarget(entries, '异常', '异常', first.position);
  const wrapped = nextStatusTarget(entries, '异常', '异常', second.position);
  assert.equal(first.item.id, 'one');
  assert.equal(second.item.id, 'three');
  assert.equal(wrapped.item.id, 'one');
  assert.equal(nextStatusTarget(entries, '待审核', '待审核', 0).item, null);
});

test('video progress counts each storyboard video instead of each book', async () => {
  const { summarizeVideoProgress } = await import('../frontend/src/user/pages/batch-factory/workbenchState.js');
  const summary = summarizeVideoProgress([
    { directorResult: { storyboard: [{ id: '01' }, { id: '02' }] } },
    { directorResult: { storyboard: [{ id: '01' }] } }
  ]);
  assert.deepEqual(summary, { total: 3, pending: 3, queued: 0, running: 0, succeeded: 0, failed: 0 });
});
