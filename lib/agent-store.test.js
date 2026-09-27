const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAgentStore } = require('./agent-store');

function setup() {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-store-'));
  let nextId = 0;
  const store = createAgentStore({
    usersDir,
    id: () => `task-${++nextId}`,
    now: () => '2026-09-24T00:00:00.000Z'
  });
  return { usersDir, store };
}

function createTask(store, username) {
  return store.createTask(username);
}

test('旧 agent-tasks.json 任务读取时提供默认画布且返回深拷贝', () => {
  const { usersDir, store } = setup();
  const task = createTask(store, 'alice');
  const first = store.getCanvas('alice', task.id);
  assert.deepEqual(first, { version: 1, revision: 0, nodes: [], edges: [] });

  first.nodes.push({ id: 'n1', type: 'copy', status: 'pending', position: { x: 1, y: 2 }, version: 1, sourceNodeIds: [], title: '标题', summary: '摘要' });
  assert.deepEqual(store.getCanvas('alice', task.id), { version: 1, revision: 0, nodes: [], edges: [] });
  assert.ok(fs.existsSync(path.join(usersDir, 'alice', 'agent-tasks.json')));
});

test('画布保存使用乐观版本冲突保护并递增 revision', () => {
  const { store } = setup();
  const task = createTask(store, 'alice');
  const canvas = {
    version: 1,
    revision: 0,
    nodes: [{ id: 'n1', type: 'copy', status: 'pending', position: { x: 10, y: 20 }, version: 1, sourceNodeIds: [], title: '标题', summary: '摘要' }],
    edges: []
  };
  const saved = store.saveCanvas('alice', task.id, canvas, 0);
  assert.equal(saved.ok, true);
  assert.equal(saved.canvas.revision, 1);
  assert.equal(store.getCanvas('alice', task.id).nodes[0].title, '标题');

  const conflict = store.saveCanvas('alice', task.id, { ...canvas, nodes: [] }, 0);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.canvas.revision, 1);
  assert.equal(store.getCanvas('alice', task.id).nodes.length, 1);
});

test('画布校验拒绝非法坐标、节点类型状态和边引用', () => {
  const { store } = setup();
  const task = createTask(store, 'alice');
  const base = { version: 1, revision: 0, nodes: [], edges: [] };
  for (const invalid of [
    { ...base, nodes: [{ id: 'n1', type: 'copy', status: 'pending', position: { x: Infinity, y: 0 }, version: 1, sourceNodeIds: [] }] },
    { ...base, nodes: [{ id: 'n1', type: 'unknown', status: 'pending', position: { x: 0, y: 0 }, version: 1, sourceNodeIds: [] }] },
    { ...base, nodes: [{ id: 'n1', type: 'copy', status: 'unknown', position: { x: 0, y: 0 }, version: 1, sourceNodeIds: [] }] },
    { ...base, edges: [{ id: 'e1', source: 'missing', target: 'missing' }] }
  ]) {
    assert.throws(() => store.saveCanvas('alice', task.id, invalid, 0), /画布|canvas/i);
  }
});

test('执行记录支持追加、更新、查询并限制摘要且过滤敏感字段', () => {
  const { store } = setup();
  const task = createTask(store, 'alice');
  const entry = store.appendExecution('alice', task.id, {
    status: 'running',
    summary: '执行中',
    startedAt: '2026-09-24T00:00:00.000Z',
    token: 'do-not-store',
    password: 'do-not-store'
  });
  assert.equal(entry.status, 'running');
  assert.equal(entry.summary, '执行中');
  assert.equal(entry.token, undefined);
  assert.equal(entry.password, undefined);

  const updated = store.updateExecution('alice', task.id, entry.id, { status: 'succeeded', summary: '已完成' });
  assert.equal(updated.status, 'succeeded');
  assert.deepEqual(store.getExecutions('alice', task.id), [updated]);
  assert.throws(
    () => store.appendExecution('alice', task.id, { status: 'done', summary: 'x'.repeat(10001) }),
    /执行|summary|摘要/i
  );
});

test('其他用户不可读取或写入任务画布和执行记录', () => {
  const { store } = setup();
  const task = createTask(store, 'alice');
  assert.equal(store.getCanvas('bob', task.id), null);
  assert.equal(store.saveCanvas('bob', task.id, { version: 1, revision: 0, nodes: [], edges: [] }, 0), null);
  assert.equal(store.appendExecution('bob', task.id, { status: 'running', summary: 'x' }), null);
  assert.deepEqual(store.getExecutions('bob', task.id), []);
  assert.equal(store.updateExecution('bob', task.id, 'missing', { status: 'done' }), null);
});
