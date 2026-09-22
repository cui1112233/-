const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createNovelFetchScheduler } = require('../lib/novel-fetch-workshop/scheduler');
const { runNovelFetchBatch } = require('../lib/novel-fetch-workshop/runner');

test('scheduled records default to automatic upload intent', async () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-fetch-schedules-'));
  let now = new Date('2026-09-20T04:00:00.000Z');
  const received = [];
  const scheduler = createNovelFetchScheduler({
    usersDir,
    clock: () => now,
    execute: async item => { received.push(item); return { queued: true }; }
  });
  scheduler.create('alice', { runAt: '2026-09-20T04:05:00.000Z', inputSnapshot: { input_text: '1001\t定时书' } });
  now = new Date('2026-09-20T04:06:00.000Z');
  await scheduler.runDue('alice');

  assert.equal(scheduler.list('alice')[0].autoSubmit, true);
  assert.equal(received[0].autoSubmit, true);
});

test('scheduled processing without a submit service keeps a pending upload state', async () => {
  const record = { meta: { bookId: '1002', bookName: '待上传定时书' } };
  const tasks = {
    async saveTasks() {},
    async getTask() { return record; },
    async readOriginal() { return ''; },
    async fetchOriginal() { return { status: 'done' }; },
    async updateTaskMeta(_owner, _id, patch) { record.meta = { ...record.meta, ...patch }; },
    async listTasks() { return [record.meta]; }
  };
  await runNovelFetchBatch({
    username: 'alice',
    payload: { input_text: '1002\t待上传定时书', scheduled: true, auto_submit: true, target_versions: ['ai1'] },
    configStore: {
      getConfig: () => ({ workflow: { auto_fetch_original: true, auto_rewrite_after_fetch: true }, web_submit: { enabled: true }, fetch: { concurrency: 1 }, rewrite: {} }),
      getStyles: () => [],
      getPlatforms: () => [{ id: '2', name: '知乎付费' }]
    },
    tasks,
    parseBooks: () => ({ tasks: [{ bookId: '1002', bookName: '待上传定时书' }], duplicateCount: 0, emptyIdCount: 0 }),
    classifyMissingRows: async ({ tasks: rows }) => ({ tasks: rows }),
    applyRules: async () => {},
    generateAiVersions: async () => ({ status: 'done', generated: [{ version: 'ai1', status: 'done' }] }),
    listTasks: async () => [record.meta]
  });

  assert.equal(record.meta.siteSubmitStatus, 'pending_upload');
  assert.deepEqual(record.meta.siteSubmitPendingVersions, ['ai1']);
});
