const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const assert = require('node:assert');
const { createWorkshopTasks, normalizeNewlines, dropEmptyLines } = require('../lib/novel-fetch-workshop/tasks');

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-workshop-tasks-'));

test('normalizeNewlines 与 dropEmptyLines 基础清洗', () => {
  assert.equal(normalizeNewlines('a\r\nb\r'), 'a\nb\n');
  assert.equal(dropEmptyLines('a\n\n\nb\n'), 'a\nb');
});

test('saveTasks 落 meta/index；fetchOriginal 存 raw+清洗后原文并更新状态', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: '第一行\r\n\r\n第二行\r\n', bookinfo: { book_name: '书名' } }) });
  const r = await store.saveTasks('u1', [{ bookId: '123', bookName: '书名', platformId: '2', platformName: '番茄付费', gender: '女频', style: '现代女主' }]);
  assert.equal(r.saved, 1);
  const res = await store.fetchOriginal('u1', '123', 4000);
  assert.equal(res.status, 'done');
  assert.equal(store.readOriginalRaw('u1', '123'), '第一行\r\n\r\n第二行\r\n');
  assert.equal(store.readOriginal('u1', '123'), '第一行\n第二行'); // 清洗后
  assert.equal(store.readVersionText('u1', '123', 'edited'), '第一行\n第二行');
  const meta = store.getTask('u1', '123').meta;
  assert.equal(meta.originalStatus, 'done');
  assert.equal(meta.status, 'original_done');
  assert.equal(meta.bookName, '书名');
});

test('saveTasks 重复 ID 合并（非空值补齐）', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: 'x' }) });
  const r = await store.saveTasks('u1', [
    { bookId: '9', bookName: 'A', gender: '' },
    { bookId: '9', bookName: 'B', gender: '女频' }
  ]);
  assert.equal(r.saved, 1);
  const meta = store.getTask('u1', '9').meta;
  assert.equal(meta.bookName, 'B'); // 后出现非空覆盖
  assert.equal(meta.gender, '女频');
});

test('readVersionText 读 ai 版本；pathForAiVersion 路径正确', async () => {
  const dir = makeTempDir();
  const store = createWorkshopTasks({ usersDir: dir, fetchUpstream: async () => ({ text: 'x' }) });
  await store.saveTasks('u1', [{ bookId: '5' }]);
  const p = store.pathForAiVersion('u1', '5', 2);
  assert.ok(p.includes('novel-fetch-workshop'));
  assert.ok(p.endsWith(path.join('ai', 'ai2', '5.txt')));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '版本2内容', 'utf8');
  assert.equal(store.readVersionText('u1', '5', 'ai2'), '版本2内容');
  assert.equal(store.readVersionText('u1', '5', 'ai9'), '');
});

test('appendLog/readLogs 记录事件', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: 'x' }) });
  await store.saveTasks('u1', [{ bookId: '7' }]);
  store.appendLog('u1', '7', 'original_fetched', { ok: true });
  const logs = store.readLogs('u1', '7');
  assert.equal(logs.length, 2); // task_saved + original_fetched
  assert.equal(logs[1].event, 'original_fetched');
});

test('deleteTasks 删除全部文件并更新 index；restoreOriginal 从备份恢复', async () => {
  const dir = makeTempDir();
  const store = createWorkshopTasks({ usersDir: dir, fetchUpstream: async () => ({ text: 'a\r\n\r\nb\r\n' }) });
  await store.saveTasks('u1', [{ bookId: '3' }]);
  await store.fetchOriginal('u1', '3', 4000);
  const rst = await store.restoreOriginal('u1', '3');
  assert.equal(rst.status, 'done');
  assert.equal(store.getTask('u1', '3').meta.status, 'original_restored');
  const del = store.deleteTasks('u1', ['3']);
  assert.equal(del.deleted, 1);
  assert.equal(store.getTask('u1', '3'), null);
  assert.deepEqual(store.listTasks('u1'), []);
});

test('saveTasks/deleteTasks 拒绝路径穿越的 bookId（白名单校验）', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: 'x' }) });
  // saveTasks 写入侧：含 ..\ 的 bookId 必须被拒绝，不能越出任务目录写 meta
  await assert.rejects(
    store.saveTasks('u1', [{ bookId: '..\\..\\escape', bookName: 'x' }]),
    /非法的书籍ID/
  );
  // deleteTasks 删除侧：同样必须被拒绝
  assert.throws(() => store.deleteTasks('u1', ['..\\escape']), /非法的书籍ID/);
  // 白名单允许合法字符（点、连字符、下划线、数字字母）
  const dir = makeTempDir();
  const store2 = createWorkshopTasks({ usersDir: dir, fetchUpstream: async () => ({ text: 'x' }) });
  const r = await store2.saveTasks('u1', [{ bookId: 'a_b-c.d123', bookName: '合法' }]);
  assert.equal(r.saved, 1);
  assert.ok(store2.getTask('u1', 'a_b-c.d123'));
});

test('updateTaskMeta 合并 patch 并刷新 updatedAt', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: 'x' }) });
  await store.saveTasks('u1', [{ bookId: '8', bookName: '书名' }]);
  const before = store.getTask('u1', '8').meta.updatedAt;
  await store.updateTaskMeta('u1', '8', { aiStatus: 'done', aiGeneratedCount: 2, rewriteKnowledge: { strategy: 'instruction' } });
  const meta = store.getTask('u1', '8').meta;
  assert.equal(meta.aiStatus, 'done');
  assert.equal(meta.aiGeneratedCount, 2);
  assert.deepEqual(meta.rewriteKnowledge, { strategy: 'instruction' });
  assert.ok(meta.updatedAt >= before); // updatedAt 刷新
  // 不存在的任务直接报错
  await assert.rejects(store.updateTaskMeta('u1', 'nope', { aiStatus: 'done' }), /任务不存在/);
});

test('batchRetry 逐级补跑：分类→抓取→AI（注入 stub 步骤）', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: '第一行\r\n\r\n第二行\r\n' }) });
  await store.saveTasks('u1', [{
    bookId: '1', bookName: '书', status: 'created',
    classifyStatus: 'failed', originalStatus: 'failed', aiStatus: 'failed', aiCount: 1
  }]);
  const calls = [];
  const deps = {
    retryClassify: async (username, meta) => {
      calls.push('classify');
      return store.updateTaskMeta(username, meta.bookId, {
        style: '现代女主', styleSource: 'ai', gender: '女频', genderSource: 'ai',
        classifyStatus: 'classified', classifyError: ''
      });
    },
    fetchOriginal: async (username, bookId) => {
      calls.push('fetch');
      return store.fetchOriginal(username, bookId, 4000);
    },
    generateAi: async (username, bookId, count) => {
      calls.push('generate');
      return store.updateTaskMeta(username, bookId, { aiStatus: 'done', aiGeneratedCount: count, aiError: '' });
    }
  };
  const result = await store.batchRetry('u1', ['1'], deps);
  assert.equal(result.requested, 1);
  assert.equal(result.retried, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(calls, ['classify', 'fetch', 'generate']);
  const meta = store.getTask('u1', '1').meta;
  assert.equal(meta.style, '现代女主');
  assert.equal(meta.classifyStatus, 'classified');
  assert.equal(meta.originalStatus, 'done');
  // 分类补跑后进入 retry_done 而不是保留 failed
  assert.equal(meta.status, 'retry_done');
});

test('batchRetry 全部环节已成功 → 不补跑并标记 retry_done', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: 'a\r\nb\r\n' }) });
  await store.saveTasks('u1', [{
    bookId: '1', bookName: '书', style: '现代女主', gender: '女频',
    classifyStatus: 'classified', status: 'original_done', originalStatus: 'done', aiStatus: 'done'
  }]);
  await store.fetchOriginal('u1', '1', 4000);
  const calls = [];
  const deps = {
    retryClassify: async (u, meta) => { calls.push('classify'); return meta; },
    fetchOriginal: async () => { calls.push('fetch'); return { status: 'skipped' }; },
    generateAi: async () => { calls.push('generate'); return { status: 'skipped' }; }
  };
  const result = await store.batchRetry('u1', ['1'], deps);
  assert.equal(result.requested, 1);
  assert.equal(result.retried, 1);
  assert.deepEqual(calls, []);
  const meta = store.getTask('u1', '1').meta;
  assert.equal(meta.status, 'retry_done');
});

test('batchRetry 任务不存在 → 该条 failed；空 ids 安全', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: 'x' }) });
  const result = await store.batchRetry('u1', ['nope'], {});
  assert.equal(result.requested, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results[0].ok, false);
  const empty = await store.batchRetry('u1', [], {});
  assert.equal(empty.requested, 0);
  assert.equal(empty.retried, 0);
  assert.equal(empty.failed, 0);
});

test('listTasks 合并敏感词/提交状态（无提交文件时为空兜底）', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: 'x' }) });
  await store.saveTasks('u1', [{ bookId: '1', bookName: '书', sensitiveStatus: 'done', sensitiveHitCount: 3, sensitiveFixedCount: 2 }]);
  const list = store.listTasks('u1');
  assert.equal(list.length, 1);
  assert.equal(list[0].sensitiveStatus, 'done');
  assert.equal(list[0].sensitiveHitCount, 3);
  assert.equal(list[0].sensitiveFixedCount, 2);
  // 提交状态空兜底
  assert.equal(list[0].site_submit_status, '');
  assert.deepEqual(list[0].site_submit_done_versions, []);
  assert.deepEqual(list[0].site_submit_failed_versions, []);
});

test('siteSubmitSummary 读提交结果；readSiteSubmitLog 读 jsonl（缺失时空）', async () => {
  const dir = makeTempDir();
  const store = createWorkshopTasks({ usersDir: dir, fetchUpstream: async () => ({ text: 'x' }) });
  await store.saveTasks('u1', [{ bookId: '1' }]);
  // 缺失时空结构
  const empty = store.siteSubmitSummary('u1', '1');
  assert.equal(empty.site_submit_status, '');
  assert.deepEqual(empty.site_submit_done_versions, []);
  assert.deepEqual(store.readSiteSubmitLog('u1', '1'), []);
  // 写入提交结果后能读到状态
  store.writeSiteSubmitResult('u1', '1', {
    status: 'submitted',
    versions: { ai1: { status: 'submitted' }, ai2: { status: 'failed', error: '文件过小' } },
    last_group_id: 'g1',
    updated_at: '2026-08-20T10:00:00+08:00'
  });
  const summary = store.siteSubmitSummary('u1', '1');
  assert.equal(summary.site_submit_status, 'submitted');
  assert.deepEqual(summary.site_submit_done_versions, ['ai1']);
  assert.deepEqual(summary.site_submit_failed_versions, ['ai2']);
  assert.equal(summary.site_submit_group_id, 'g1');
  assert.equal(summary.site_submit_error, '文件过小');
  // 提交日志 jsonl
  store.appendSiteSubmitLog('u1', '1', 'site_submit_submitted', { version: 'ai1' });
  const logs = store.readSiteSubmitLog('u1', '1');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, 'site_submit_submitted');
});

test('listAiVersions 列出 ai 版本（含全文与 chars）', async () => {
  const store = createWorkshopTasks({ usersDir: makeTempDir(), fetchUpstream: async () => ({ text: 'x' }) });
  await store.saveTasks('u1', [{ bookId: '5' }]);
  const p = store.pathForAiVersion('u1', '5', 1);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '版本1内容', 'utf8');
  const p2 = store.pathForAiVersion('u1', '5', 3);
  fs.mkdirSync(path.dirname(p2), { recursive: true });
  fs.writeFileSync(p2, '版本3内容更长', 'utf8');
  const versions = store.listAiVersions('u1', '5');
  assert.equal(versions.length, 2);
  assert.equal(versions[0].name, 'ai1');
  assert.equal(versions[0].text, '版本1内容');
  assert.equal(versions[0].chars, 5);
  assert.equal(versions[1].name, 'ai3');
  // 无版本任务返回空数组
  await store.saveTasks('u1', [{ bookId: '9' }]);
  assert.deepEqual(store.listAiVersions('u1', '9'), []);
});
