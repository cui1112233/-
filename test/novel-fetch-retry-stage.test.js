const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createNovelFetchTaskOps,
  retryStageForTask
} = require('../lib/novel-fetch-workshop/task-ops');
const { runNovelFetchBatch } = require('../lib/novel-fetch-workshop/runner');

function makeOpsStore(record) {
  const updates = [];
  return {
    updates,
    async getTask() { return record; },
    async updateTaskMeta(_owner, _id, patch) {
      updates.push(patch);
      record.meta = { ...record.meta, ...patch };
      return record;
    },
    async listTasks() { return [record.meta]; }
  };
}

test('多阶段失败时重试从最早的 AI 判断阶段开始，并清除旧判断错误', async () => {
  const record = { meta: {
    bookId: '1001', bookName: '测试书', gender: '', style: '', aiCount: 2,
    classifyStatus: 'failed', classifyError: 'AI分类失败',
    originalStatus: 'failed', originalErrorCode: 'UPSTREAM_TIMEOUT',
    aiStatus: 'failed', aiError: 'AI生成失败'
  }, document: {} };
  assert.equal(retryStageForTask(record.meta), 'classify');
  const store = makeOpsStore(record);
  const ops = createNovelFetchTaskOps({
    accountResolver: owner => ({ username: owner }),
    createStore: () => store,
    tombstones: { has: () => false, add() {}, restore() {} },
    parseBooks: () => ({ tasks: [] })
  });
  const payloads = await ops.prepareRetryPayloads('alice', ['1001']);
  assert.equal(payloads[0].retry_stage, 'classify');
  assert.equal(store.updates[0].classifyStatus, '');
  assert.equal(store.updates[0].classifyError, '');
  assert.equal(store.updates[0].originalStatus, undefined);
  assert.equal(store.updates[0].aiStatus, undefined);
});

test('已完成任务不会被“重试失败”再次加入队列', async () => {
  const record = { meta: { bookId: '1000', status: 'done', originalStatus: 'done', aiStatus: 'done' }, document: {} };
  const store = makeOpsStore(record);
  const ops = createNovelFetchTaskOps({
    accountResolver: owner => ({ username: owner }), createStore: () => store,
    tombstones: { has: () => false, add() {}, restore() {} }, parseBooks: () => ({ tasks: [] })
  });
  assert.deepEqual(await ops.prepareRetryPayloads('alice', ['1000']), []);
  assert.equal(store.updates.length, 0);
});

test('原文已完成且 AI1 已存在时，重试只生成缺失 AI 版本，不重新抓取原文', async () => {
  const calls = { fetch: 0, rewrite: [] };
  const record = { meta: {
    bookId: '1002', bookName: '已有原文', gender: '女频', style: '现代', aiCount: 2,
    originalStatus: 'done', aiStatus: 'failed', aiError: 'AI2失败',
    aiGeneratedVersions: ['ai1'], targetVersions: ['ai1', 'ai2']
  }, document: { versions: { ai1: '已有文案' } } };
  const tasks = {
    async saveTasks() {},
    async getTask() { return record; },
    async readOriginal() { return '原文'; },
    async fetchOriginal() { calls.fetch += 1; return { status: 'done' }; },
    async updateTaskMeta(_owner, _id, patch) { record.meta = { ...record.meta, ...patch }; },
    async listTasks() { return [record.meta]; }
  };
  await runNovelFetchBatch({
    username: 'alice',
    payload: { input_text: '书籍ID\t书名\t男女频\t风格\n1002\t已有原文\t女频\t现代', retry_stage: 'rewrite', target_versions: ['ai1', 'ai2'], ai_count: 2 },
    configStore: { getConfig: () => ({ workflow: { auto_classify_missing: true, auto_fetch_original: true, auto_rewrite_after_fetch: true, auto_submit_after_rewrite: false }, fetch: { concurrency: 1 }, rewrite: { default_ai_count: 2 } }), getStyles: () => [], getPlatforms: () => [{ id: '2', name: '知乎付费' }] },
    tasks,
    parseBooks: ({ inputText }) => ({ tasks: [{ bookId: inputText.split('\n')[1].split('\t')[0], bookName: '已有原文', gender: '女频', style: '现代', aiCount: 2 }], duplicateCount: 0, emptyIdCount: 0 }),
    classifyMissingRows: async ({ tasks }) => ({ tasks }),
    applyRules: async () => { throw new Error('不应重复执行原文规则'); },
    generateAiVersions: async ({ task }) => { calls.rewrite.push(task.bookId); return { status: 'done', generated: [{ version: 'ai2', status: 'done' }] }; },
    listTasks: async () => [record.meta]
  });
  assert.equal(calls.fetch, 0);
  assert.deepEqual(calls.rewrite, ['1002']);
});

test('提交重试只携带失败版本，已提交版本保持不变', async () => {
  const record = { meta: {
    bookId: '1003', bookName: '提交重试', gender: '女频', style: '现代', aiCount: 2,
    originalStatus: 'done', aiStatus: 'done', siteSubmitStatus: 'failed',
    siteSubmitDoneVersions: ['ai1'], siteSubmitFailedVersions: ['ai2'],
    targetVersions: ['ai1', 'ai2']
  }, document: {} };
  const store = makeOpsStore(record);
  const ops = createNovelFetchTaskOps({
    accountResolver: owner => ({ username: owner }), createStore: () => store,
    tombstones: { has: () => false, add() {}, restore() {} }, parseBooks: () => ({ tasks: [] })
  });
  const payload = (await ops.prepareRetryPayloads('alice', ['1003']))[0];
  assert.equal(payload.retry_stage, 'submit');
  assert.deepEqual(payload.retry_submit_versions, ['ai2']);
  assert.deepEqual(store.updates[0].siteSubmitDoneVersions, undefined);
});

test('敏感词处理和网站提交失败会进入失败重试列表', async () => {
  const records = [
    { meta: { bookId: '1005', updatedAt: new Date().toISOString(), sensitiveStatus: 'partial', sensitiveFailedCount: 1 } },
    { meta: { bookId: '1006', updatedAt: new Date().toISOString(), siteSubmitStatus: 'submitted', siteSubmitFailedVersions: ['ai2'] } }
  ];
  const ops = createNovelFetchTaskOps({
    accountResolver: owner => ({ username: owner }),
    createStore: () => ({ async listTasks() { return records.map(record => record.meta); } }),
    tombstones: { has: () => false, add() {}, restore() {} }, parseBooks: () => ({ tasks: [] })
  });
  assert.deepEqual(await ops.abnormalIds('alice', { date: '2099-01-01' }), []);
  assert.deepEqual(await ops.abnormalIds('alice'), ['1005', '1006']);
});

test('重试阶段为 classify 时成功分类后不会遗留处理失败状态', async () => {
  const statuses = [];
  const record = { meta: { bookId: '1004', bookName: '分类恢复', gender: '', style: '', aiCount: 1, classifyStatus: 'failed', classifyError: '旧错误' }, document: {} };
  const tasks = {
    async saveTasks(_owner, rows) { statuses.push(rows[0]); record.meta = { ...record.meta, ...rows[0] }; },
    async getTask() { return record; }, async updateTaskMeta(_o, _i, patch) { record.meta = { ...record.meta, ...patch }; },
    async listTasks() { return [record.meta]; }, async readOriginal() { return ''; },
    async fetchOriginal() { return { status: 'failed' }; }
  };
  await runNovelFetchBatch({
    username: 'alice', payload: { input_text: '书籍ID\t书名\t男女频\t风格\n1004\t分类恢复\t\t', retry_stage: 'classify' },
    configStore: { getConfig: () => ({ workflow: { auto_classify_missing: true, auto_fetch_original: false, auto_rewrite_after_fetch: false }, rewrite: {} }), getStyles: () => [], getPlatforms: () => [] },
    tasks, parseBooks: () => ({ tasks: [{ bookId: '1004', bookName: '分类恢复', gender: '', style: '' }], duplicateCount: 0, emptyIdCount: 0 }),
    classifyMissingRows: async ({ tasks: rows }) => ({ tasks: rows.map(task => ({ ...task, gender: '女频', style: '现代', classifyStatus: 'input_ready', classifyError: '' })), errors: [] }),
    listTasks: async () => [record.meta]
  });
  assert.equal(statuses[0].classifyStatus, 'input_ready');
  assert.equal(statuses[0].classifyError, '');
});

test('网站提交阶段重试不受自动提交开关影响且只提交失败版本', async () => {
  const submitted = [];
  const record = { meta: { bookId: '1007', bookName: '提交阶段', gender: '女频', style: '现代', aiCount: 2, originalStatus: 'done', siteSubmitStatus: 'failed', siteSubmitFailedVersions: ['ai2'], targetVersions: ['ai1', 'ai2'] }, document: {} };
  const tasks = {
    async saveTasks() {}, async getTask() { return record; }, async readOriginal() { return '原文'; },
    async updateTaskMeta(_o, _i, patch) { record.meta = { ...record.meta, ...patch }; },
    async listTasks() { return [record.meta]; }
  };
  await runNovelFetchBatch({
    username: 'alice', payload: { input_text: '1007\t提交阶段', retry_stage: 'submit', retry_submit_versions: ['ai2'], target_versions: ['ai1', 'ai2'] },
    configStore: { getConfig: () => ({ workflow: { auto_fetch_original: false, auto_rewrite_after_fetch: false, auto_submit_after_rewrite: false, auto_submit_confirmed: false }, web_submit: { enabled: true }, rewrite: {} }), getStyles: () => [], getPlatforms: () => [] },
    tasks, parseBooks: () => ({ tasks: [{ bookId: '1007', bookName: '提交阶段', gender: '女频', style: '现代' }], duplicateCount: 0, emptyIdCount: 0 }),
    submit: async request => { submitted.push(request); return { success_groups: 1, failed_groups: 0 }; }, listTasks: async () => [record.meta]
  });
  assert.deepEqual(submitted, [{ mode: 'selected', ids: ['1007'], versions: ['ai2'] }]);
});
