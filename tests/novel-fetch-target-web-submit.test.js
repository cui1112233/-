const test = require('node:test');
const assert = require('node:assert/strict');
const { createTargetAwareWebSubmit } = require('../lib/novel-fetch-workshop/target-web-submit');

function baseService(calls) {
  return {
    getConfig() {}, saveConfig() {}, environment() {}, testVisible() {}, syncConfigs() {}, syncStyles() {}, ensureSession() {},
    async preview(owner, body) { calls.push(['preview', owner, body]); return { groups: [{ version: body.versions?.join(',') }], skipped: [] }; },
    async submit(owner, body) { calls.push(['submit', owner, body]); return { groups: [{ version: body.versions?.join(',') }], skipped: [], success_groups: 1, accepted_groups: 0, failed_groups: 0, tasks: [] }; }
  };
}

function storeWith(records) {
  return {
    async getTask(_owner, id) { return records[id] || null; },
    async readVersionText(_owner, id, version) { return records[id]?.document?.versions?.[version] || (version === 'original' ? records[id]?.document?.original || '' : ''); },
    async listTasks() { return Object.values(records).map(item => item.meta); }
  };
}

test('提交网络只把该书已经完成的目标版本交给 121', async () => {
  const calls = [];
  const records = {
    a: { meta: { bookId: 'a', targetVersions: ['original', 'ai1', 'ai3'] }, document: { original: '原文', versions: { ai1: 'AI1', ai3: '' } } }
  };
  const service = createTargetAwareWebSubmit({
    service: baseService(calls),
    accountResolver: owner => ({ username: owner }),
    createStore: () => storeWith(records)
  });
  await service.submit('alice', { mode: 'selected', ids: ['a'], versions: ['ai5'] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][2].versions, ['original', 'ai1']);
});

test('不同书的目标版本互不串用', async () => {
  const calls = [];
  const records = {
    a: { meta: { bookId: 'a', targetVersions: ['ai1'] }, document: { versions: { ai1: 'A1', ai3: '不应上传' } } },
    b: { meta: { bookId: 'b', targetVersions: ['ai3'] }, document: { versions: { ai1: '不应上传', ai3: 'B3' } } }
  };
  const service = createTargetAwareWebSubmit({
    service: baseService(calls),
    accountResolver: owner => ({ username: owner }),
    createStore: () => storeWith(records)
  });
  await service.submit('alice', { mode: 'selected', ids: ['a', 'b'] });
  assert.deepEqual(calls.map(call => call[2].versions), [['ai1'], ['ai3']]);
});

test('旧任务没有 targetVersions 时保持 V78 原提交参数', async () => {
  const calls = [];
  const records = { a: { meta: { bookId: 'a', aiCount: 2 }, document: { versions: { ai1: 'A1', ai2: 'A2' } } } };
  const service = createTargetAwareWebSubmit({
    service: baseService(calls),
    accountResolver: owner => ({ username: owner }),
    createStore: () => storeWith(records)
  });
  await service.submit('alice', { mode: 'selected', ids: ['a'], versions: ['ai1'] });
  assert.deepEqual(calls[0][2].versions, ['ai1']);
});

test('提交网络后把这本书最新网站提交状态回写到所属历史批次', async () => {
  const calls = [];
  const synced = [];
  const records = {
    a: { meta: { bookId: 'a', batchId: 'batch-a', targetVersions: ['ai1'] }, document: { versions: { ai1: 'A1' } } }
  };
  const base = baseService(calls);
  base.submit = async (owner, body) => {
    calls.push(['submit', owner, body]);
    records.a.meta.siteSubmitStatus = '121异常';
    records.a.meta.error = '121 登录会话已失效';
    return { groups: [], skipped: [], success_groups: 0, accepted_groups: 0, failed_groups: 1, tasks: [] };
  };
  const service = createTargetAwareWebSubmit({
    service: base,
    accountResolver: owner => ({ username: owner }),
    createStore: () => storeWith(records),
    onTaskUpdated(owner, meta) { synced.push([owner, { ...meta }]); }
  });

  await service.submit('alice', { mode: 'selected', ids: ['a'] });
  assert.equal(synced.length, 1);
  assert.equal(synced[0][0], 'alice');
  assert.equal(synced[0][1].batchId, 'batch-a');
  assert.equal(synced[0][1].siteSubmitStatus, '121异常');
});
