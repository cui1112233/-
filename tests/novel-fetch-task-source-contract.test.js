const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkshopTasks } = require('../lib/novel-fetch-workshop/tasks');

function tempUsersDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-v88-source-task-'));
}

async function createTaskStore(fetchUpstream) {
  const usersDir = tempUsersDir();
  const tasks = createWorkshopTasks({
    usersDir,
    fetchUpstream,
    fetchConfig: { retries: 1, timeout_seconds: 7 }
  });
  await tasks.saveTasks('tester', [{ bookId: 'book-1', platformId: '15', platformName: '知乎付费', maxTxt: 4000 }]);
  return { tasks, usersDir };
}

test('local source fetch retries one transient failure and keeps raw/processed text separately', async () => {
  let calls = 0;
  const { tasks } = await createTaskStore(async (bookId, platformId, maxTxt, options) => {
    calls += 1;
    assert.equal(bookId, 'book-1');
    assert.equal(platformId, '15');
    assert.equal(maxTxt, 4000);
    assert.equal(options.timeoutMs, 7000);
    assert.equal(options.attempt, calls);
    if (calls === 1) {
      const error = new Error('temporary source failure');
      error.code = 'UPSTREAM_TIMEOUT';
      error.recoverable = true;
      throw error;
    }
    return { text: '第一行\r\n\r\n第二行', bookinfo: { book_name: '测试书' } };
  });

  const result = await tasks.fetchOriginal('tester', 'book-1', 4000);

  assert.deepEqual(result, { status: 'done', attempts: 2 });
  assert.equal(calls, 2);
  assert.equal(tasks.readOriginalRaw('tester', 'book-1'), '第一行\r\n\r\n第二行');
  assert.equal(tasks.readOriginal('tester', 'book-1'), '第一行\n第二行');
  const detail = tasks.getTask('tester', 'book-1');
  assert.equal(detail.meta.originalStatus, 'done');
  assert.equal(detail.meta.status, 'original_done');
  assert.equal(detail.meta.bookName, '测试书');
  assert.equal(detail.meta.originalFetchAttempts, 2);
  assert.equal(detail.meta.originalErrorCode, '');
  assert.equal(tasks.readLogs('tester', 'book-1').at(-1).event, 'original_fetched');
  assert.equal(tasks.readLogs('tester', 'book-1').at(-1).data.attempts, 2);
});

test('empty source response is a failed task with explicit code and no false success', async () => {
  const { tasks } = await createTaskStore(async () => ({ code: 200, data: '' }));

  const result = await tasks.fetchOriginal('tester', 'book-1', 4000);

  assert.deepEqual(result, { status: 'failed', attempts: 2, code: 'EMPTY_ORIGINAL' });
  const detail = tasks.getTask('tester', 'book-1');
  assert.equal(detail.meta.originalStatus, 'failed');
  assert.equal(detail.meta.status, 'original_failed');
  assert.equal(detail.meta.originalFetchAttempts, 2);
  assert.equal(detail.meta.originalErrorCode, 'EMPTY_ORIGINAL');
  assert.equal(detail.meta.error, '未获取到原文内容');
  assert.equal(tasks.readOriginalRaw('tester', 'book-1'), '');
  assert.equal(tasks.readOriginal('tester', 'book-1'), '');
  const failure = tasks.readLogs('tester', 'book-1').at(-1);
  assert.equal(failure.event, 'original_fetch_failed');
  assert.equal(failure.data.code, 'EMPTY_ORIGINAL');
  assert.equal(failure.data.attempts, 2);
});

test('one failed source task does not erase another book or become a batch success', async () => {
  const usersDir = tempUsersDir();
  const tasks = createWorkshopTasks({
    usersDir,
    fetchConfig: { retries: 0 },
    fetchUpstream: async bookId => bookId === 'book-fail' ? ({ code: 500, msg: '源站拒绝' }) : ({ text: '成功正文' })
  });
  await tasks.saveTasks('tester', [
    { bookId: 'book-ok', platformId: '15' },
    { bookId: 'book-fail', platformId: '15' }
  ]);

  const results = await Promise.all([
    tasks.fetchOriginal('tester', 'book-ok', 4000),
    tasks.fetchOriginal('tester', 'book-fail', 4000)
  ]);

  assert.equal(results[0].status, 'done');
  assert.equal(results[1].status, 'failed');
  assert.equal(tasks.getTask('tester', 'book-ok').meta.originalStatus, 'done');
  assert.equal(tasks.getTask('tester', 'book-fail').meta.originalStatus, 'failed');
  assert.equal(tasks.readOriginal('tester', 'book-ok'), '成功正文');
  assert.equal(tasks.readOriginal('tester', 'book-fail'), '');
});
