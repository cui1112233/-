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
  assert.equal(payloads[0].retry_idempotency_key, 'alice:1001:classify:');
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

test('AI 文案全部失败时任务总状态回写为 ai_failed', async () => {
  const record = { meta: { bookId: '1002-failed', originalStatus: 'done', aiCount: 1 }, document: {} };
  const updates = [];
  const tasks = {
    async saveTasks() {},
    async getTask() { return record; },
    async readOriginal() { return '原文'; },
    async updateTaskMeta(_owner, _id, patch) { updates.push(patch); record.meta = { ...record.meta, ...patch }; },
    async listTasks() { return [record.meta]; }
  };
  await runNovelFetchBatch({
    username: 'alice',
    payload: { input_text: '书籍ID\t书名\t男女频\t风格\n1002-failed\t失败书\t女频\t现代', retry_stage: 'rewrite' },
    configStore: { getConfig: () => ({ workflow: { auto_classify_missing: false, auto_fetch_original: false, auto_rewrite_after_fetch: true, auto_submit_after_rewrite: false }, rewrite: { default_ai_count: 1 } }), getStyles: () => [], getPlatforms: () => [{ id: '2', name: '知乎付费' }] },
    tasks,
    parseBooks: () => ({ tasks: [{ bookId: '1002-failed', bookName: '失败书', gender: '女频', style: '现代', aiCount: 1 }], duplicateCount: 0, emptyIdCount: 0 }),
    generateAiVersions: async () => ({ status: 'failed', generated: [], error: 'AI接口拒绝了该提示词（内容安全策略）' }),
    listTasks: async () => [record.meta]
  });
  assert.equal(record.meta.status, 'ai_failed');
  assert.equal(record.meta.aiStatus, 'failed');
  assert.equal(record.meta.aiError, 'AI接口拒绝了该提示词（内容安全策略）');
  assert.equal(updates.some(patch => patch.status === 'ai_failed'), true);
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
  assert.deepEqual((await ops.abnormalIds('alice')).sort(), ['1005', '1006']);
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
  assert.equal(statuses.at(-1).classifyStatus, 'input_ready');
  assert.equal(statuses.at(-1).classifyError, '');
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

test('定时任务在网站提交已启用且会话可用时默认自动提交', async () => {
  const submitted = [];
  const record = { meta: { bookId: '1008', bookName: '定时提交', gender: '女频', style: '现代', originalStatus: 'done' }, document: {} };
  const tasks = {
    async saveTasks() {}, async getTask() { return record; }, async readOriginal() { return '原文'; },
    async fetchOriginal() { return { status: 'done' }; },
    async updateTaskMeta(_owner, _id, patch) { record.meta = { ...record.meta, ...patch }; }, async listTasks() { return [record.meta]; }
  };
  await runNovelFetchBatch({
    username: 'alice',
    payload: { input_text: '1008\t定时提交', scheduled: true, target_versions: ['original'] },
    configStore: { getConfig: () => ({ workflow: { auto_fetch_original: true, auto_rewrite_after_fetch: false, auto_submit_after_rewrite: false, auto_submit_confirmed: false }, web_submit: { enabled: true }, fetch: { concurrency: 1 }, rewrite: {} }), getStyles: () => [], getPlatforms: () => [] },
    tasks, parseBooks: () => ({ tasks: [{ bookId: '1008', bookName: '定时提交', gender: '女频', style: '现代' }], duplicateCount: 0, emptyIdCount: 0 }),
    submit: async request => { submitted.push(request); return { success_groups: 1, failed_groups: 0 }; }, listTasks: async () => [record.meta]
  });
  assert.deepEqual(submitted, [{ mode: 'selected', ids: ['1008'], versions: ['original'] }]);
});

test('改文完成且未启用自动提交时保留待上传状态', async () => {
  const record = { meta: { bookId: '1009', bookName: '待上传', gender: '女频', style: '现代', originalStatus: 'done' }, document: {} };
  const tasks = {
    async saveTasks() {}, async getTask() { return record; }, async readOriginal() { return '原文'; },
    async updateTaskMeta(_owner, _id, patch) { record.meta = { ...record.meta, ...patch }; }, async listTasks() { return [record.meta]; }
  };
  await runNovelFetchBatch({
    username: 'alice', payload: { input_text: '1009\t待上传', retry_stage: 'rewrite', target_versions: ['ai1'] },
    configStore: { getConfig: () => ({ workflow: { auto_fetch_original: false, auto_rewrite_after_fetch: true, auto_submit_after_rewrite: false, auto_submit_confirmed: false }, web_submit: { enabled: true }, rewrite: {} }), getStyles: () => [], getPlatforms: () => [] },
    tasks, parseBooks: () => ({ tasks: [{ bookId: '1009', bookName: '待上传', gender: '女频', style: '现代' }], duplicateCount: 0, emptyIdCount: 0 }),
    generateAiVersions: async () => ({ status: 'done', generated: [{ version: 'ai1', status: 'done' }] }), listTasks: async () => [record.meta]
  });
  assert.equal(record.meta.siteSubmitStatus, 'pending_upload');
  assert.deepEqual(record.meta.siteSubmitPendingVersions, ['ai1']);
});

test('定时自动上传启动前先持久化待上传状态，避免会话失败丢失队列', async () => {
  const record = { meta: { bookId: '1010', bookName: '会话失败', gender: '女频', style: '现代', originalStatus: 'done' }, document: {} };
  const tasks = {
    async saveTasks() {}, async getTask() { return record; }, async readOriginal() { return '原文'; },
    async updateTaskMeta(_owner, _id, patch) { record.meta = { ...record.meta, ...patch }; }, async listTasks() { return [record.meta]; }
  };
  await assert.rejects(runNovelFetchBatch({
    username: 'alice', payload: { input_text: '1010\t会话失败', scheduled: true, retry_stage: 'rewrite', target_versions: ['ai1'] },
    configStore: { getConfig: () => ({ workflow: { auto_fetch_original: false, auto_rewrite_after_fetch: true }, web_submit: { enabled: true }, rewrite: {} }), getStyles: () => [], getPlatforms: () => [] },
    tasks, parseBooks: () => ({ tasks: [{ bookId: '1010', bookName: '会话失败', gender: '女频', style: '现代' }], duplicateCount: 0, emptyIdCount: 0 }),
    generateAiVersions: async () => ({ status: 'done', generated: [{ version: 'ai1', status: 'done' }] }),
    submit: async () => { throw new Error('121 会话失效'); }, listTasks: async () => [record.meta]
  }), /121 会话失效/);
  assert.equal(record.meta.siteSubmitStatus, 'pending_upload');
  assert.deepEqual(record.meta.siteSubmitPendingVersions, ['ai1']);
});
