const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAgentStore } = require('../lib/agent-store');

function createUsersDir(t) {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-agent-store-'));
  t.after(() => fs.rmSync(usersDir, { recursive: true, force: true }));
  return usersDir;
}

test('migrates valid legacy history once into an account-local history task without deleting the source', t => {
  const usersDir = createUsersDir(t);
  const legacyDir = path.join(usersDir, 'writer_a');
  const legacyPath = path.join(legacyDir, 'agent-history.json');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(legacyPath, JSON.stringify([
    {
      role: 'user',
      content: '帮我检查第一集冲突',
      createdAt: '2026-08-12T00:00:00.000Z',
      context: { novelText: 'secret' },
      arbitrary: 'must-not-persist'
    },
    { role: 'assistant', content: '先让矛盾提前出现。', createdAt: '2026-08-12T00:01:00.000Z' },
    { role: 'system', content: '不应迁移', createdAt: '2026-08-12T00:02:00.000Z' }
  ]));
  const store = createAgentStore({ usersDir, id: () => 'legacy-task' });

  assert.deepEqual(store.listTasks('writer_a'), [{
    id: 'legacy-task',
    title: '历史聊天',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:01:00.000Z',
    messageCount: 2,
    preview: '先让矛盾提前出现。'
  }]);
  assert.deepEqual(store.getTask('writer_a', 'legacy-task').messages.map(({ role, content }) => ({ role, content })), [
    { role: 'user', content: '帮我检查第一集冲突' },
    { role: 'assistant', content: '先让矛盾提前出现。' }
  ]);
  assert.equal(fs.existsSync(legacyPath), true);
  assert.equal(store.listTasks('writer_a').length, 1);
  const persisted = JSON.parse(fs.readFileSync(path.join(legacyDir, 'agent-tasks.json'), 'utf8'));
  assert.equal(persisted.version, 1);
  assert.deepEqual(persisted.tasks[0].messages[0], {
    role: 'user',
    content: '帮我检查第一集冲突',
    createdAt: '2026-08-12T00:00:00.000Z'
  });
});

test('keeps tasks isolated by account and names a new task from the first 20 Unicode characters', t => {
  const usersDir = createUsersDir(t);
  let sequence = 0;
  const store = createAgentStore({
    usersDir,
    id: () => `task-${++sequence}`,
    now: () => '2026-08-12T00:00:00.000Z'
  });
  const task = store.createTask('writer_a');
  const firstMessage = '😀这是一个超过二十个Unicode字符的任务标题测试内容';
  store.append('writer_a', task.id, { role: 'user', content: firstMessage, context: { scriptOutput: '不应落盘' } });
  store.append('writer_a', task.id, { role: 'assistant', content: '答复内容' });
  const otherTask = store.createTask('writer_b');

  assert.equal(store.getTask('writer_a', task.id).title, Array.from(firstMessage).slice(0, 20).join(''));
  assert.equal(store.getTask('writer_b', task.id), null);
  assert.equal(store.getTask('writer_b', otherTask.id).messages.length, 0);
  assert.equal(fs.readFileSync(path.join(usersDir, 'writer_a', 'agent-tasks.json'), 'utf8').includes('不应落盘'), false);
});

test('renames, clears, and deletes only the requested task', t => {
  const usersDir = createUsersDir(t);
  let sequence = 0;
  const store = createAgentStore({
    usersDir,
    id: () => `task-${++sequence}`,
    now: () => '2026-08-12T00:00:00.000Z'
  });
  const first = store.createTask('writer_a');
  const second = store.createTask('writer_a');
  store.append('writer_a', first.id, { role: 'user', content: '第一段' });
  store.append('writer_a', second.id, { role: 'user', content: '第二段' });

  assert.equal(store.renameTask('writer_a', first.id, '  手动任务名  ').title, '手动任务名');
  store.clearTaskMessages('writer_a', first.id);
  assert.equal(store.getTask('writer_a', first.id).messages.length, 0);
  assert.equal(store.getTask('writer_a', first.id).title, '手动任务名');
  assert.equal(store.getTask('writer_a', second.id).messages[0].content, '第二段');
  assert.equal(store.deleteTask('writer_a', second.id), true);
  assert.equal(store.getTask('writer_a', second.id), null);
  assert.equal(store.getTask('writer_a', first.id).id, first.id);
});

test('rejects invalid messages and titles and enforces task and message limits', t => {
  const usersDir = createUsersDir(t);
  let sequence = 0;
  const store = createAgentStore({
    usersDir,
    maxTasks: 2,
    maxEntries: 2,
    id: () => `task-${++sequence}`,
    now: () => '2026-08-12T00:00:00.000Z'
  });
  const first = store.createTask('writer_a');
  store.createTask('writer_a');

  assert.throws(() => store.createTask('writer_a'), /任务数量已达上限/);
  assert.throws(() => store.append('writer_a', first.id, { role: 'system', content: 'hidden' }), /Invalid agent message/);
  assert.throws(() => store.append('writer_a', first.id, { role: 'user', content: ' ' }), /Invalid agent message/);
  assert.throws(() => store.append('writer_a', first.id, { role: 'user', content: 'a'.repeat(12001) }), /Invalid agent message/);
  assert.throws(() => store.renameTask('writer_a', first.id, ' '), /任务标题不合法/);
  assert.throws(() => store.renameTask('writer_a', first.id, '字'.repeat(81)), /任务标题不合法/);
  store.append('writer_a', first.id, { role: 'user', content: 'a' });
  store.append('writer_a', first.id, { role: 'assistant', content: 'b' });
  store.append('writer_a', first.id, { role: 'user', content: 'c' });
  assert.deepEqual(store.getTask('writer_a', first.id).messages.map(message => message.content), ['b', 'c']);
});

test('clamps injected task and message limits to the 100-entry persistence maximum', t => {
  const usersDir = createUsersDir(t);
  let sequence = 0;
  const store = createAgentStore({
    usersDir,
    maxTasks: 101,
    maxEntries: 101,
    id: () => `task-${++sequence}`,
    now: () => '2026-08-12T00:00:00.000Z'
  });
  const task = store.createTask('writer_a');

  for (let index = 0; index < 101; index += 1) {
    store.append('writer_a', task.id, { role: 'user', content: String(index) });
  }
  for (let index = 1; index < 100; index += 1) store.createTask('writer_a');

  assert.equal(store.getTask('writer_a', task.id).messages.length, 100);
  assert.equal(store.getTask('writer_a', task.id).messages[0].content, '1');
  assert.throws(() => store.createTask('writer_a'), /任务数量已达上限/);
});

test('initializes an absent task document and migrates an absent document from legacy history', t => {
  const usersDir = createUsersDir(t);
  const store = createAgentStore({ usersDir, id: () => 'initialized-task' });
  const emptyTask = store.createTask('writer_a');
  const legacyDir = path.join(usersDir, 'writer_b');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'agent-history.json'), JSON.stringify([
    { role: 'user', content: '旧记录', createdAt: '2026-08-12T00:00:00.000Z' }
  ]));

  assert.equal(emptyTask.id, 'initialized-task');
  assert.equal(store.listTasks('writer_b')[0].title, '历史聊天');
});

test('preserves existing unreadable or schema-invalid task documents without mutation', t => {
  const usersDir = createUsersDir(t);
  const store = createAgentStore({ usersDir });
  const userDir = path.join(usersDir, 'writer_a');
  const taskFile = path.join(userDir, 'agent-tasks.json');
  fs.mkdirSync(userDir, { recursive: true });

  for (const original of ['{ not valid JSON', JSON.stringify({ version: 99, tasks: [] })]) {
    fs.writeFileSync(taskFile, original);
    assert.throws(() => store.createTask('writer_a'), /Agent task data is unreadable/);
    assert.equal(fs.readFileSync(taskFile, 'utf8'), original);
  }
});

test('persists a mutated task document privately without relying on stale temporary files', t => {
  const usersDir = createUsersDir(t);
  const store = createAgentStore({ usersDir, id: () => 'predictable-task' });
  const task = store.createTask('writer_a');
  const userDir = path.join(usersDir, 'writer_a');
  const predictableTemp = path.join(
    userDir,
    `.agent-tasks.${Buffer.from(task.id).toString('hex')}.tmp`
  );
  fs.writeFileSync(predictableTemp, 'stale', { mode: 0o644 });

  store.append('writer_a', task.id, { role: 'user', content: '更新状态' });

  const taskFile = path.join(userDir, 'agent-tasks.json');
  assert.equal(fs.statSync(taskFile).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(taskFile, 'utf8')).tasks[0].messages.at(-1).content, '更新状态');
  assert.equal(fs.readFileSync(predictableTemp, 'utf8'), 'stale');
});
