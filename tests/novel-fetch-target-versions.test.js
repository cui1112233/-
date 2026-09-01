const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTargetVersions,
  effectiveTargetVersions,
  targetAiIndexes,
  readyTargetVersions,
  pendingTargetVersions
} = require('../lib/novel-fetch-workshop/target-versions');

test('稀疏版本保持 V78 固定顺序并去重', () => {
  assert.deepEqual(
    normalizeTargetVersions(['ai5', 'original', 'ai1', 'ai3', 'ai1']),
    ['original', 'ai1', 'ai3', 'ai5']
  );
});

test('选择 AI3 不隐含 AI1 或 AI2', () => {
  assert.deepEqual(targetAiIndexes({ targetVersions: ['ai3'] }), [3]);
});

test('显式空目标不会回退成 AI1', () => {
  assert.deepEqual(effectiveTargetVersions({ targetVersions: [] }, ['ai1']), []);
});

test('旧任务没有 targetVersions 时继续兼容 aiCount', () => {
  assert.deepEqual(effectiveTargetVersions({ aiCount: 3 }, []), ['original', 'ai1', 'ai2', 'ai3']);
});

test('提交网络只取得已经真实完成的目标版本', () => {
  const task = { targetVersions: ['original', 'ai1', 'ai3'] };
  assert.deepEqual(
    readyTargetVersions(task, { hasOriginal: true, aiVersions: ['ai1'] }),
    ['original', 'ai1']
  );
});

test('再次提交只补未 confirmed 的已完成目标版本', () => {
  const task = { targetVersions: ['original', 'ai1', 'ai3'] };
  assert.deepEqual(
    pendingTargetVersions(task, { hasOriginal: true, aiVersions: ['ai1', 'ai3'] }, ['original', 'ai1']),
    ['ai3']
  );
});
