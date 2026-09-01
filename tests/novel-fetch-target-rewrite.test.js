const test = require('node:test');
const assert = require('node:assert/strict');
const { createTargetAwareAiGenerator } = require('../lib/novel-fetch-workshop/target-rewrite');

function fakeTasks(initial = {}) {
  const versions = { ...initial };
  const patches = [];
  return {
    versions,
    patches,
    async readVersionText(_owner, _bookId, version) { return versions[version] || ''; },
    async saveVersionText(_owner, _bookId, version, value) { versions[version] = value; },
    async updateTaskMeta(_owner, _bookId, patch) { patches.push(patch); }
  };
}

test('AI1 + AI3 只执行两个稀疏槽位', async () => {
  const tasks = fakeTasks();
  const calls = [];
  const generate = createTargetAwareAiGenerator({
    generateAiVersion: async ({ aiIndex }) => {
      calls.push(aiIndex);
      tasks.versions[`ai${aiIndex}`] = `正文${aiIndex}`;
      return { status: 'done', versionText: `正文${aiIndex}`, error: '' };
    }
  });
  const result = await generate({ tasks, username: 'alice', task: { bookId: '1', targetVersions: ['ai1', 'ai3'] } });
  assert.deepEqual(calls, [1, 3]);
  assert.deepEqual(result.generatedVersions, ['ai1', 'ai3']);
  assert.equal(result.status, 'done');
});

test('已有 AI1 时重试只补 AI3', async () => {
  const tasks = fakeTasks({ ai1: '已有AI1' });
  const calls = [];
  const generate = createTargetAwareAiGenerator({
    generateAiVersion: async ({ aiIndex }) => {
      calls.push(aiIndex);
      tasks.versions[`ai${aiIndex}`] = `正文${aiIndex}`;
      return { status: 'done', versionText: `正文${aiIndex}`, error: '' };
    }
  });
  const result = await generate({ tasks, username: 'alice', task: { bookId: '1', targetVersions: ['ai1', 'ai3'] } });
  assert.deepEqual(calls, [3]);
  assert.equal(result.generated[0].skipped, true);
  assert.deepEqual(result.generatedVersions, ['ai1', 'ai3']);
});

test('只选择 AI3 不会调用 AI1/AI2', async () => {
  const tasks = fakeTasks();
  const calls = [];
  const generate = createTargetAwareAiGenerator({
    generateAiVersion: async ({ aiIndex }) => {
      calls.push(aiIndex);
      tasks.versions[`ai${aiIndex}`] = 'ok';
      return { status: 'done', versionText: 'ok', error: '' };
    }
  });
  await generate({ tasks, username: 'alice', task: { bookId: '1', targetVersions: ['ai3'] } });
  assert.deepEqual(calls, [3]);
});
