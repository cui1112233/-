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
